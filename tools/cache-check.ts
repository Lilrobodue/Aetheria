// tools/cache-check.ts — dev-only browser checks for utils/playlistCache.ts (v14.5).
//
// Served by `npm run dev` at /tools/cache-check.html (never built or deployed).
// Every test runs against a throwaway database and the page deletes it at the
// end, so the real library is never read or written. Writes are counted per
// object store by wrapping IDBObjectStore's write methods.

import type { Song } from '../types';
import {
  __setCacheDbNameForTests,
  openDB,
  saveBlobs,
  saveMetaAndState,
  deleteTracksFromCache,
  restorePlaylist,
  clearPlaylistCache,
  saveBlobsNow,
  debouncedSaveMeta,
  cancelPendingSaves,
  waitForBlobSaves,
  flushPendingSave,
} from '../utils/playlistCache';

const RUN = `aetheria-cache-check-${Date.now()}`;
const dbNames: string[] = [];
function useDb(suffix: string): void {
  const name = `${RUN}-${suffix}`;
  dbNames.push(name);
  __setCacheDbNameForTests(name);
}

// --- write instrumentation ---------------------------------------------------
// Every write is counted. A write named in `failing` (e.g. 'meta.put') fails
// the way a real quota error does: its whole transaction aborts, taking any
// other write in that transaction with it.
const writes: string[] = [];
const failing = new Set<string>();
for (const method of ['put', 'add', 'delete', 'clear'] as const) {
  const original = (IDBObjectStore.prototype as any)[method];
  (IDBObjectStore.prototype as any)[method] = function (this: IDBObjectStore, ...args: unknown[]) {
    const name = `${this.name}.${method}`;
    writes.push(name);
    const request = original.apply(this, args);
    if (failing.has(name)) this.transaction.abort();
    return request;
  };
}

// v16.0.1: hold the success of every indexedDB.open made while `openGate` is set (openDB sets onsuccess on the
// request it gets back), so a save can be kept "still opening its connection" (U6).
let openGate: Promise<void> | null = null;
let heldOpens = 0;
const realOpen = IDBFactory.prototype.open;
IDBFactory.prototype.open = function (this: IDBFactory, ...args: unknown[]) {
  const request: IDBOpenDBRequest = (realOpen as any).apply(this, args);
  const gate = openGate;
  if (!gate) return request;
  heldOpens++;
  return new Proxy(request, {
    set(t, k, v) {
      if (k === 'onsuccess' && typeof v === 'function') {
        t.onsuccess = (ev) => { gate.then(() => v.call(t, ev)); };
        return true;
      }
      (t as any)[k] = v;
      return true;
    },
    get(t, k) {
      const x = (t as any)[k];
      return typeof x === 'function' ? x.bind(t) : x;
    },
  });
} as typeof IDBFactory.prototype.open;

// What the module reports to the App: failures, and saves that stored everything.
const cacheErrors: { count: number; reason: string; what: string; seq: number }[] = [];
const cacheOks: { what: string; seq: number }[] = [];
window.addEventListener('aetheria:cache-error', (e) => cacheErrors.push((e as CustomEvent).detail));
window.addEventListener('aetheria:cache-ok', (e) => cacheOks.push((e as CustomEvent).detail));

const MB = 1024 * 1024;
const FULL = { quota: MB, usage: MB };
const ROOMY = { quota: 1e12, usage: 0 };

/** Run `fn` while navigator.storage.estimate reports a full device. */
async function withFullStorage(fn: () => Promise<void>): Promise<void> {
  const storage = navigator.storage as any;
  const had = Object.prototype.hasOwnProperty.call(storage, 'estimate');
  storage.estimate = async () => FULL;
  try {
    await fn();
  } finally {
    if (!had) delete storage.estimate;
  }
}

/** Hold the next audio saves inside their free-space check, all answering
 *  `answer` once `release()` is called. `inEstimate()` resolves when a save
 *  gets there — and fails, rather than hanging the page, if none does within
 *  5 s. `restore()` puts the real estimate back. */
function gateEstimate(answer: { quota: number; usage: number }) {
  const storage = navigator.storage as any;
  const had = Object.prototype.hasOwnProperty.call(storage, 'estimate');
  let entered!: () => void;
  const reached = new Promise<void>((resolve) => (entered = resolve));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  storage.estimate = async () => {
    entered();
    await gate;
    return answer;
  };
  const inEstimate = () =>
    Promise.race([
      reached,
      sleep(5000).then(() => {
        throw new Error('the save never reached its free-space check');
      }),
    ]);
  const restore = () => {
    release();
    if (!had) delete storage.estimate;
  };
  return { inEstimate, release, restore };
}

// --- helpers -----------------------------------------------------------------
function song(id: string, extra: Partial<Song> = {}, bytes = 8): Song {
  const data = new Uint8Array(bytes);
  data.set([82, 73, 70, 70, 0, 1, 2, 3].slice(0, bytes));
  const file = new File([data], `${id}.wav`, { type: 'audio/wav' });
  return { file, id, name: `Track ${id}`, duration: 10, ...extra };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function keys(store: string): Promise<string[]> {
  const db = await openDB();
  const k = (await req(db.transaction(store, 'readonly').objectStore(store).getAllKeys())) as string[];
  db.close();
  return k.map(String).sort();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The 'current' state record of the database in use, or null. */
async function stateRecord(): Promise<any | null> {
  const db = await openDB();
  const r = await req(db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('current'));
  db.close();
  return r ?? null;
}

/** A store's keys in the database named `name` (not the one in use). */
async function keysIn(name: string, store: string): Promise<string[]> {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const k = db.objectStoreNames.contains(store)
    ? ((await req(db.transaction(store, 'readonly').objectStore(store).getAllKeys())) as string[])
    : [];
  db.close();
  return k.map(String).sort();
}

/** Poll `read` until `ok` holds, for at most `ms`. */
async function waitFor<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<T> {
  const until = Date.now() + ms;
  let v = await read();
  while (!ok(v) && Date.now() < until) {
    await sleep(50);
    v = await read();
  }
  return v;
}

/** debouncedSaveMeta opens the flush connection when a save is first scheduled; give it time to open. */
const flushConnectionOpens = () => sleep(250);

/** A synthetic hide (or show): document.visibilityState reads `hidden`, and visibilitychange fires. */
function setHidden(hidden: boolean): void {
  if (hidden) Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  else delete (document as any).visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
}

// --- tests -------------------------------------------------------------------
type Test = { name: string; run: () => Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => Promise<void>): void {
  tests.push({ name, run });
}
function expect(ok: boolean, what: string): void {
  if (!ok) throw new Error(what);
}

const a = song('a');
const b = song('b');
const c = song('c');

// v16.0.1, U1 — FIRST, before any restorePlaylist on this page: until a restore has settled, the load gate is closed
// for the debounce's timer and for the flush. It ends by opening the gate (a restore), as the App's launch does, so
// the tests below run with it open: otherwise "Clear cancels pending saves" and "Cancelling only the metadata save"
// would pass because of the gate, not because of what they test.
test('U1. The load gate: before the saved library is read back neither the debounce timer nor the flush writes; after the restore the held save does; a restore that brings a library writes nothing as it settles, so the App drops a save of an import alone', async () => {
  useDb('u1-gate');
  const p1 = song('fl1a');
  const p2 = song('fl1b');
  writes.length = 0;
  debouncedSaveMeta([p1, p2], [p1, p2], 0, null, 528, 50);
  await sleep(400);
  expect(!writes.some((w) => w.startsWith('playlist-state.') || w.startsWith('meta.')),
    `the 50 ms timer wrote nothing in 400 ms (saw ${writes.join(' ')})`);
  expect(flushPendingSave() === false, 'the flush declines before a restore');
  await sleep(200);
  expect(writes.length === 0, `the flush wrote nothing (saw ${writes.join(' ')})`);
  const restored = await restorePlaylist();
  expect(restored === null, 'the restore of an empty database finds nothing');
  const rec = await waitFor(stateRecord, (r) => !!r, 1500);
  expect(rec?.playlistOrder?.join() === 'fl1a,fl1b',
    `the held save wrote once the restore had settled (saw ${JSON.stringify(rec)})`);

  // v16.0.1 fix: the App's half. A restore that brings a library is followed, in the microtasks right after it
  // resolves, by the App's cancelPendingSaves('meta'): that drops a save scheduled before it landed, which holds only
  // what was imported meanwhile. So the gate opening must write nothing by itself. (A restore running closes the gate
  // again, as StrictMode's second one does.)
  useDb('u1-gate-stored');
  const stored = [song('fl1c'), song('fl1d')];
  await saveBlobs(stored, stored);
  await saveMetaAndState(stored, stored, 0, null, 528); // the stored library (not gated: written now)
  let release!: () => void;
  openGate = new Promise<void>((r) => (release = r));
  heldOpens = 0;
  const restoring = restorePlaylist(); // its indexedDB.open is held: the gate stays closed while it runs
  openGate = null;
  let back: Awaited<ReturnType<typeof restorePlaylist>> = null;
  let atSettle: string[] = [];
  try {
    expect(heldOpens === 1, `the restore is held opening its connection (held ${heldOpens})`);
    const imported = song('fl1e');
    writes.length = 0;
    debouncedSaveMeta([imported], [imported], 0, null, 528, 50); // an import while the library restores
    await sleep(400);
    expect(flushPendingSave() === false, 'the flush declines while a restore runs');
    expect(writes.length === 0, `nothing written while the restore runs (saw ${writes.join(' ')})`);
  } finally {
    release();
    back = await restoring;
    atSettle = writes.slice();
    cancelPendingSaves('meta'); // the App's continuation
  }
  expect(back?.originalPlaylist.map((s) => s.id).join() === 'fl1c,fl1d', 'the restore brings the stored library');
  expect(!atSettle.some((w) => w.startsWith('playlist-state.') || w.startsWith('meta.')),
    `the restore settling wrote nothing itself (saw ${atSettle.join(' ')})`);
  await sleep(400);
  const kept = await stateRecord();
  expect(!writes.some((w) => w.startsWith('playlist-state.')) && kept?.originalOrder?.join() === 'fl1c,fl1d',
    `the save of the import alone was dropped: the record still names the stored library (saw ${writes.join(' ')}; ${JSON.stringify(kept?.originalOrder)})`);
});

test('A shrinking list deletes no stored audio (blob save is add-only)', async () => {
  useDb('addonly');
  await saveBlobs([a, b, c], [a, b, c]);
  expect((await keys('blobs')).join() === 'a,b,c', 'three blobs stored');
  writes.length = 0;
  // The v14.4 data-loss shape: the library collapses to a one-track mix.
  await saveBlobs([a], [a]);
  expect(!writes.some((w) => w.startsWith('blobs.delete')), `no blob deletes (saw ${writes.join(' ')})`);
  expect((await keys('blobs')).join() === 'a,b,c', 'all three blobs still stored');
});

test('A metadata save writes no audio and never clears the meta store', async () => {
  useDb('meta');
  await saveBlobs([a, b, c], [a, b, c]);
  writes.length = 0;
  await saveMetaAndState([a, b, c], [a, b, c], 0, null, 528);
  expect(!writes.some((w) => w.startsWith('blobs.')), `no blob writes (saw ${writes.join(' ')})`);
  expect(!writes.includes('meta.clear'), 'meta store not cleared');
  // A shrunken list keeps the other tracks' stored analysis.
  await saveMetaAndState([a], [a], 0, null, 528);
  expect((await keys('meta')).join() === 'a,b,c', 'meta for b and c kept');
});

test('An explicit delete removes audio and metadata, and a pending save cannot bring it back', async () => {
  useDb('delete');
  const oldLists: [Song[], Song[]] = [[a, b, c], [a, b, c]];
  await saveBlobs(...oldLists);
  await saveMetaAndState(...oldLists, 0, null, 528);
  await deleteTracksFromCache(['b']);
  expect((await keys('blobs')).join() === 'a,c', 'blob b deleted');
  expect((await keys('meta')).join() === 'a,c', 'meta b deleted');
  // Saves scheduled before the delete still hold b.
  await saveBlobs(...oldLists);
  await saveMetaAndState(...oldLists, 0, null, 528);
  expect((await keys('blobs')).join() === 'a,c', 'b not re-added by a stale blob save');
  expect((await keys('meta')).join() === 'a,c', 'b not re-added by a stale meta save');
});

test('Clear cancels pending saves, and nothing is written afterwards', async () => {
  useDb('clear');
  const d = song('d');
  await saveBlobs([a, c], [a, c]);
  saveBlobsNow([a, c, d], [a, c, d], 50);
  debouncedSaveMeta([a, c, d], [a, c, d], 0, null, 528, 50);
  await clearPlaylistCache();
  await sleep(400);
  expect((await keys('blobs')).length === 0, 'no blobs after Clear');
  expect((await keys('meta')).length === 0, 'no meta after Clear');
  expect((await keys('playlist-state')).length === 0, 'no state after Clear');
});

test('A save already running when Clear lands writes nothing (epoch)', async () => {
  useDb('inflight-clear');
  const e = song('e');
  const f = song('f');
  // Not awaited: the save is between its reads and its write when Clear runs.
  const running = saveBlobs([e, f], [e, f]);
  await clearPlaylistCache();
  await running;
  expect((await keys('blobs')).length === 0, 'the in-flight save wrote nothing after Clear');
});

test('A delete issued while a save is running is not undone by that save (tombstone)', async () => {
  useDb('inflight-delete');
  const g = song('g');
  const h = song('h');
  const running = saveBlobs([g, h], [g, h]);
  await deleteTracksFromCache(['h']);
  await running;
  expect((await keys('blobs')).join() === 'g', `only g stored (saw ${(await keys('blobs')).join()})`);
});

test('A v14.4-shaped database restores; library duplicates are removed and orphans reported', async () => {
  useDb('restore');
  const x = song('x');
  // Seed raw records the way v14.4 stored them, including a library that a
  // walk's repeats leaked into and an orphan blob the library no longer lists.
  const db = await openDB();
  const tx = db.transaction(['blobs', 'meta', 'playlist-state'], 'readwrite');
  for (const s of [a, b, c, x]) {
    tx.objectStore('blobs').put({ id: s.id, fileBlob: s.file, fileName: s.file.name, fileType: s.file.type });
    tx.objectStore('meta').put({ id: s.id, name: s.name, duration: 10, closestSolfeggio: 528 });
  }
  tx.objectStore('playlist-state').put({
    key: 'current',
    playlistOrder: ['a', 'b', 'a'],
    originalOrder: ['a', 'b', 'b', 'a', 'c'],
    currentSongIndex: 2,
    loShuWalkMode: null,
    selectedSolfeggio: 528,
    savedAt: Date.now(),
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  const restored = await restorePlaylist();
  expect(!!restored, 'restore returned a playlist');
  expect(restored!.playlist.map((s) => s.id).join() === 'a,b,a', 'play order kept as saved (walk repeats allowed)');
  expect(restored!.originalPlaylist.map((s) => s.id).join() === 'a,b,c', 'library de-duplicated');
  expect(restored!.orphans.map((s) => s.id).join() === 'x', 'orphan x reported');
  expect(restored!.currentSongIndex === 2, 'cursor kept');
  expect(restored!.originalPlaylist[2].closestSolfeggio === 528, 'metadata joined');
});

test('A failed metadata prune does not stop the restore', async () => {
  useDb('prune-fails');
  // Fresh tracks: ids deleted by an earlier test stay tombstoned this session.
  const u = song('u');
  const v = song('v');
  await saveBlobs([u, v], [u, v]);
  await saveMetaAndState([u, v], [u, v], 0, null, 528);
  // Metadata with no audio: the restore prunes it, and here the prune throws.
  const db = await openDB();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ id: 'ghost', name: 'Ghost' });
  await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()));
  db.close();
  failing.add('meta.delete');
  try {
    const restored = await restorePlaylist();
    expect(!!restored, 'restore returned a playlist');
    expect(restored!.originalPlaylist.map((s) => s.id).join() === 'u,v',
      `library restored (saw ${restored!.originalPlaylist.map((s) => s.id).join()})`);
  } finally {
    failing.delete('meta.delete');
  }
});

test('Reload can wait for a blob save in progress (waitForBlobSaves)', async () => {
  useDb('wait-blobs');
  const p = song('p');
  const q = song('q');
  // Hold the save in its free-space check for 200 ms: a wait that returned at
  // once would read the store before the write.
  const g = gateEstimate(ROOMY);
  try {
    saveBlobsNow([p, q], [p, q], 0);
    await g.inEstimate();
    setTimeout(g.release, 200);
    await waitForBlobSaves();
    const stored = (await keys('blobs')).join();
    expect(stored === 'p,q', `both stored once the wait resolves (saw ${stored})`);
  } finally {
    g.restore();
  }
});

test('A delete during the free-space check is neither written back, counted for room, nor reported', async () => {
  useDb('delete-in-check');
  const s1 = song('s1');
  const t1 = song('t1');
  let g = gateEstimate(ROOMY);
  try {
    const run = saveBlobs([s1, t1], [s1, t1]);
    await g.inEstimate();
    await deleteTracksFromCache(['t1']);
    g.release();
    await run;
  } finally {
    g.restore();
  }
  let stored = (await keys('blobs')).join();
  expect(stored === 's1', `the deleted track is not written back (saw ${stored})`);

  // On a full device the report counts only the track that is still wanted.
  useDb('delete-in-check-full');
  const s2 = song('s2');
  const t2 = song('t2');
  cacheErrors.length = 0;
  g = gateEstimate(FULL);
  try {
    const run = saveBlobs([s2, t2], [s2, t2]);
    await g.inEstimate();
    await deleteTracksFromCache(['t2']);
    g.release();
    await run;
  } finally {
    g.restore();
  }
  expect(cacheErrors.length === 1 && cacheErrors[0].count === 1,
    `storage-full reported for 1 track (saw ${JSON.stringify(cacheErrors)})`);

  // And the room needed is sized without it: 60 MB free fits a small track
  // plus the 50 MB margin, but not the 30 MB one that was deleted meanwhile.
  useDb('delete-in-check-sized');
  const small = song('small');
  const big = song('big', {}, 30 * MB);
  cacheErrors.length = 0;
  g = gateEstimate({ quota: 60 * MB, usage: 0 });
  try {
    const run = saveBlobs([small, big], [small, big]);
    await g.inEstimate();
    await deleteTracksFromCache(['big']);
    g.release();
    await run;
  } finally {
    g.restore();
  }
  stored = (await keys('blobs')).join();
  expect(stored === 'small' && cacheErrors.length === 0,
    `the small track is stored and nothing reported (saw ${stored}; ${JSON.stringify(cacheErrors)})`);
});

test('A Clear during the free-space check writes and reports nothing', async () => {
  for (const full of [false, true]) {
    useDb(`clear-in-check-${full ? 'full' : 'roomy'}`);
    const u1 = song('u1');
    const v1 = song('v1');
    cacheErrors.length = 0;
    const g = gateEstimate(full ? FULL : ROOMY);
    try {
      const run = saveBlobs([u1, v1], [u1, v1]);
      await g.inEstimate();
      await clearPlaylistCache();
      g.release();
      await run;
    } finally {
      g.restore();
    }
    expect((await keys('blobs')).length === 0, `nothing written after Clear (${full ? 'full' : 'roomy'})`);
    expect(cacheErrors.length === 0, `nothing reported after Clear (saw ${JSON.stringify(cacheErrors)})`);
  }
});

test('Blob saves run one at a time, in order: a later save never re-counts an earlier one', async () => {
  // Two saves called back to back while the first is held in its free-space
  // check with 60 MB free. The first stores x; the second must see x stored
  // and need room only for the 30 MB y (80 MB with the margin: too much). Run
  // side by side, the second counted x as missing too, and its seq said
  // nothing about which snapshot was newer.
  useDb('serial');
  const x = song('x1');
  const y = song('y1', {}, 30 * MB);
  cacheErrors.length = 0;
  cacheOks.length = 0;
  const events: string[] = [];
  const onErr = (e: Event) => events.push(`error:${(e as CustomEvent).detail.seq}`);
  const onOk = (e: Event) => events.push(`ok:${(e as CustomEvent).detail.seq}`);
  window.addEventListener('aetheria:cache-error', onErr);
  window.addEventListener('aetheria:cache-ok', onOk);
  const g = gateEstimate({ quota: 60 * MB, usage: 0 });
  try {
    const first = saveBlobs([x], [x]);
    const second = saveBlobs([x, y], [x, y]);
    await g.inEstimate();
    g.release();
    await Promise.all([first, second]);
  } finally {
    g.restore();
    window.removeEventListener('aetheria:cache-error', onErr);
    window.removeEventListener('aetheria:cache-ok', onOk);
  }
  expect((await keys('blobs')).join() === 'x1', 'the first save stored x');
  expect(cacheErrors.length === 1 && cacheErrors[0].count === 1,
    `the second save reported only y (saw ${JSON.stringify(cacheErrors)})`);
  const [okEvent, errEvent] = events;
  const seqOf = (s: string) => Number(s.split(':')[1]);
  expect(events.length === 2 && okEvent.startsWith('ok') && errEvent.startsWith('error') && seqOf(okEvent) < seqOf(errEvent),
    `first save's success comes first with the lower seq (saw ${events.join(' ')})`);
});

test('A save that starts after a failure and stores everything says so (cache-ok, later seq)', async () => {
  useDb('cache-ok');
  const w1 = song('w1');
  cacheErrors.length = 0;
  cacheOks.length = 0;
  await withFullStorage(() => saveBlobs([w1], [w1]));
  expect(cacheErrors.length === 1, 'the full device was reported');
  await saveBlobs([w1], [w1]); // room now
  const failedSeq = cacheErrors[0].seq;
  expect(cacheOks.some((o) => o.what === 'tracks' && o.seq > failedSeq),
    `a later save reported success (errors ${JSON.stringify(cacheErrors)}, oks ${JSON.stringify(cacheOks)})`);
  expect((await keys('blobs')).join() === 'w1', 'and the track is stored');
});

test('Cancelling only the metadata save leaves a pending blob save to run', async () => {
  useDb('cancel-meta');
  const r = song('r');
  saveBlobsNow([r], [r], 50);
  debouncedSaveMeta([r], [r], 0, null, 528, 50);
  cancelPendingSaves('meta');
  await sleep(300);
  await waitForBlobSaves();
  expect((await keys('blobs')).join() === 'r', 'the blob save ran');
  expect((await keys('playlist-state')).length === 0, 'the metadata save did not');
});

test('Storage-full is reported, but not for a save a Clear cancelled', async () => {
  useDb('storage-full');
  const s = song('s');
  const t = song('t');
  await withFullStorage(async () => {
    cacheErrors.length = 0;
    await saveBlobs([s, t], [s, t]);
    expect(cacheErrors.length === 1 && cacheErrors[0].reason === 'storage-full' && cacheErrors[0].count === 2,
      `a full device is reported for both tracks (saw ${JSON.stringify(cacheErrors)})`);
    cacheErrors.length = 0;
    const running = saveBlobs([s, t], [s, t]);
    await clearPlaylistCache();
    await running;
    expect(cacheErrors.length === 0, `nothing reported for the cancelled save (saw ${JSON.stringify(cacheErrors)})`);
  });
  expect((await keys('blobs')).length === 0, 'nothing stored');
});

test('A failed metadata save is reported, and the library order is still saved', async () => {
  useDb('meta-fails');
  cacheErrors.length = 0;
  failing.add('meta.put');
  try {
    await saveMetaAndState([a], [a], 0, null, 528);
  } finally {
    failing.delete('meta.put');
  }
  expect(cacheErrors.length === 1 && cacheErrors[0].what === 'state',
    `reported as a state error (saw ${JSON.stringify(cacheErrors)})`);
  expect((await keys('playlist-state')).join() === 'current', 'the state record (written first) is saved');
});

test('Key-analysis and visual-envelope fields survive a save and a restore; a malformed chroma is dropped', async () => {
  // Analyse tracks (v15.1). Fresh ids: the tombstones of earlier tests persist on this page.
  useDb('keys');
  const chroma = [0.1, 0.05, 0.2, 0.03, 0.12, 0.08, 0.04, 0.15, 0.02, 0.11, 0.06, 0.04];
  const band = (seed: number) => Uint8Array.from({ length: 40 }, (_, i) => (i * 7 + seed) % 256);
  const env = { fps: 20, sub: band(1), bass: band(2), mid: band(3), high: band(4) };
  const ka = song('ka', { chroma, chromaA4Hz: 441.15, musicKey: 'Dm', keyConfidence: 0.825, chromaVersion: 1, visualEnvelope: env });
  const kb = song('kb', { chroma: new Float32Array(12).fill(1 / 12) as any, chromaA4Hz: 440, musicKey: 'C', keyConfidence: 0.7, chromaVersion: 1 });
  const kc = song('kc', { chromaVersion: 1, analysisFailedV: 1 });
  await saveBlobs([ka, kb, kc], [ka, kb, kc]);
  await saveMetaAndState([ka, kb, kc], [ka, kb, kc], 0, null, 528);
  const restored = await restorePlaylist();
  expect(!!restored, 'restore returned a playlist');
  const by = new Map(restored!.originalPlaylist.map((s) => [s.id, s]));
  const a1 = by.get('ka');
  const b1 = by.get('kb');
  const c1 = by.get('kc');
  expect(!!a1 && !!b1 && !!c1, `all three restored (saw ${[...by.keys()].join()})`);
  expect(Array.isArray(a1!.chroma) && a1!.chroma!.length === 12 && a1!.chroma!.every((v, i) => v === chroma[i]),
    `ka's chroma is the same plain Array of 12 (saw ${JSON.stringify(a1!.chroma)})`);
  expect(a1!.chromaA4Hz === 441.15 && a1!.musicKey === 'Dm' && a1!.keyConfidence === 0.825 && a1!.chromaVersion === 1,
    `ka's key fields are kept (saw ${a1!.chromaA4Hz} ${a1!.musicKey} ${a1!.keyConfidence} ${a1!.chromaVersion})`);
  const v = a1!.visualEnvelope;
  const same = (x: unknown, y: Uint8Array) => x instanceof Uint8Array && x.length === y.length && x.every((b, i) => b === y[i]);
  expect(!!v && v.fps === 20 && same(v.sub, env.sub) && same(v.bass, env.bass) && same(v.mid, env.mid) && same(v.high, env.high),
    "ka's visualEnvelope comes back with the same bytes");
  expect(b1!.chroma === undefined && b1!.chromaA4Hz === undefined && b1!.musicKey === undefined &&
    b1!.keyConfidence === undefined && b1!.chromaVersion === undefined,
    `kb's malformed chroma drops every key field (saw ${JSON.stringify({ c: b1!.chroma, v: b1!.chromaVersion, k: b1!.musicKey })})`);
  expect(c1!.chromaVersion === 1 && c1!.analysisFailedV === 1 && c1!.chroma === undefined,
    `kc keeps chromaVersion and analysisFailedV, with no chroma (saw ${c1!.chromaVersion} ${c1!.analysisFailedV})`);
});

// --- v16.0.1: the hide flush (U1 is at the top) -------------------------------
// flushPendingSave is what the module's visibilitychange (hidden), pagehide and freeze listeners call; the tests call
// it directly, and dispatch the events where the event is the point. Fresh ids: tombstones persist on this page.

test('U2. With nothing pending, the flush and a hide, pagehide or freeze write nothing', async () => {
  useDb('u2-idle');
  cancelPendingSaves();
  writes.length = 0;
  expect(flushPendingSave() === false, 'nothing to flush');
  setHidden(true);
  setHidden(false);
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  document.dispatchEvent(new Event('freeze'));
  await sleep(300);
  expect(writes.length === 0, `nothing written (saw ${writes.join(' ')})`);
});

test('U3. The flush runs the pending save now: its own lists, the state record first and at once, no audio, and its timer cancelled', async () => {
  useDb('u3-flush');
  const p1 = song('fl3a');
  const p2 = song('fl3b');
  const p3 = song('fl3c');
  const walk = { mode: 'A', segments: null, phases: null, steps: [0, 1, 2] } as any;
  const queue = { waiting: [1], played: [] } as any;
  debouncedSaveMeta([p1], [p1], 0, null, 528, 5000); // the first schedule opens the flush connection
  await flushConnectionOpens();
  writes.length = 0;
  debouncedSaveMeta([p3, p1, p2], [p1, p2, p3], 2, walk, 639, 50, queue);
  expect(flushPendingSave() === true, 'the flush ran');
  const atReturn = writes.slice();
  await sleep(400); // the cancelled timer was 50 ms
  expect(atReturn.join() === 'playlist-state.put',
    `the state record was put before the flush returned, through the open connection (saw ${atReturn.join(' ') || 'nothing'})`);
  const rec = await stateRecord();
  expect(!!rec && rec.playlistOrder.join() === 'fl3c,fl3a,fl3b' && rec.originalOrder.join() === 'fl3a,fl3b,fl3c' &&
    rec.currentSongIndex === 2 && rec.loShuWalkMode === 'A' && JSON.stringify(rec.walk) === JSON.stringify(walk) &&
    JSON.stringify(rec.queue) === JSON.stringify(queue) && rec.selectedSolfeggio === 639,
    `the record holds the pending save's lists (saw ${JSON.stringify(rec)})`);
  expect(writes[0] === 'playlist-state.put' && writes.indexOf('meta.put') > 0,
    `the state record before any metadata (saw ${writes.join(' ')})`);
  expect(writes.filter((w) => w === 'playlist-state.put').length === 1 && writes.filter((w) => w === 'meta.put').length === 3,
    `one save: the cancelled timer wrote nothing more (saw ${writes.join(' ')})`);
  expect(!writes.some((w) => w.startsWith('blobs.')), `no audio written (saw ${writes.join(' ')})`);
});

test('U4. A Clear drops the pending save: a flush after it writes nothing', async () => {
  useDb('u4-clear');
  const p = song('fl4');
  debouncedSaveMeta([p], [p], 0, null, 528, 5000);
  await flushConnectionOpens();
  await clearPlaylistCache();
  writes.length = 0;
  expect(flushPendingSave() === false, 'nothing to flush after the Clear');
  await sleep(400);
  expect(writes.length === 0, `nothing written (saw ${writes.join(' ')})`);
  for (const store of ['blobs', 'meta', 'playlist-state']) {
    expect((await keys(store)).length === 0, `the ${store} store stays empty`);
  }
});

test('U5. A delete after the save was scheduled: the flush does not bring the deleted track’s metadata back', async () => {
  useDb('u5-delete');
  const x = song('fl5a');
  const y = song('fl5b');
  await saveBlobs([x, y], [x, y]);
  await saveMetaAndState([x, y], [x, y], 0, null, 528);
  debouncedSaveMeta([x, y], [x, y], 1, null, 528, 5000); // still lists fl5b
  await flushConnectionOpens();
  await deleteTracksFromCache(['fl5b']);
  expect(flushPendingSave() === true, 'the flush ran');
  await sleep(400);
  expect((await keys('meta')).join() === 'fl5a', `fl5b's metadata stays deleted (saw ${(await keys('meta')).join()})`);
  expect((await keys('blobs')).join() === 'fl5a', `and its audio (saw ${(await keys('blobs')).join()})`);
});

test('U6. An older save still opening its connection when the flush writes does not put its older play state back (the version guard)', async () => {
  useDb('u6-order');
  const o1 = song('fl6a');
  const o2 = song('fl6b');
  const o3 = song('fl6c');
  const lists: [Song[], Song[]] = [[o1, o2, o3], [o1, o2, o3]];
  debouncedSaveMeta(...lists, 0, null, 528, 5000);
  await flushConnectionOpens();
  let release!: () => void;
  openGate = new Promise<void>((r) => (release = r));
  heldOpens = 0;
  const older = saveMetaAndState(...lists, 1, null, 528); // cursor 1; its indexedDB.open is held
  openGate = null;
  try {
    expect(heldOpens === 1, `the older save is held opening its connection (held ${heldOpens})`);
    debouncedSaveMeta(...lists, 2, null, 528, 5000); // the newer change: cursor 2
    expect(flushPendingSave() === true, 'the flush ran');
    const flushed = await waitFor(stateRecord, (r) => r?.currentSongIndex === 2, 1500);
    expect(flushed?.currentSongIndex === 2, `the flush wrote the newer cursor (saw ${flushed?.currentSongIndex})`);
  } finally {
    release();
  }
  await older;
  await sleep(100);
  const rec = await stateRecord();
  expect(rec?.currentSongIndex === 2, `the record keeps the newer cursor, 2 (saw ${rec?.currentSongIndex})`);
});

test('U7. The kept flush connection never blocks a database delete', async () => {
  useDb('u7-delete-db');
  const name = dbNames[dbNames.length - 1];
  const p = song('fl7');
  debouncedSaveMeta([p], [p], 0, null, 528, 5000); // opens the flush connection on this database
  await flushConnectionOpens();
  cancelPendingSaves('meta');
  let blocked = false;
  const outcome = await new Promise<string>((resolve) => {
    const r = indexedDB.deleteDatabase(name);
    r.onblocked = () => { blocked = true; };
    r.onsuccess = () => resolve('deleted');
    r.onerror = () => resolve('error');
    setTimeout(() => resolve('still waiting after 3 s'), 3000);
  });
  expect(outcome === 'deleted' && !blocked, `the delete went through at once (${outcome}${blocked ? ', blocked first' : ''})`);
});

test('U8. A switch of database drops the flush connection: the next flush writes to the new database', async () => {
  useDb('u8-first');
  const first = dbNames[dbNames.length - 1];
  const p = song('fl8');
  debouncedSaveMeta([p], [p], 0, null, 528, 5000); // the flush connection opens on the first database
  await flushConnectionOpens();
  cancelPendingSaves('meta');
  useDb('u8-second');
  debouncedSaveMeta([p], [p], 0, null, 528, 5000);
  await flushConnectionOpens();
  expect(flushPendingSave() === true, 'the flush ran');
  await sleep(400);
  expect((await keys('playlist-state')).join() === 'current', 'the record is in the second database');
  expect((await keysIn(first, 'playlist-state')).length === 0, 'and not in the first');
});

/** While `fn` runs, every state transaction made fails after it was issued: its commit() aborts it instead (as when
 *  the browser force-closes the kept connection, or the disk fails), so nothing throws where it is made. Returns how
 *  many were made to fail. */
function failingStateWrites(fn: () => void): number {
  const proto = IDBDatabase.prototype as any;
  const real = proto.transaction;
  let made = 0;
  proto.transaction = function (this: IDBDatabase, ...args: unknown[]) {
    const tx: IDBTransaction = real.apply(this, args);
    if (args[0] === 'playlist-state') {
      made++;
      (tx as any).commit = () => tx.abort();
    }
    return tx;
  };
  try {
    fn();
  } finally {
    proto.transaction = real;
  }
  return made;
}

test('U9. The flush’s own state write fails after it was issued: the record is written again through a fresh connection, then the metadata; but never over a newer save’s record', async () => {
  useDb('u9-fallback');
  const x = song('fl9a');
  const y = song('fl9b');
  debouncedSaveMeta([x], [x], 0, null, 528, 5000); // the first schedule opens the flush connection
  await flushConnectionOpens();
  debouncedSaveMeta([y, x], [x, y], 1, null, 639, 5000);
  writes.length = 0;
  const errors0 = cacheErrors.length;
  let ran = false;
  const failed = failingStateWrites(() => { ran = flushPendingSave(); });
  expect(ran, 'the flush ran');
  expect(failed === 1, `the flush wrote through the kept connection, and that write was made to fail (${failed})`);
  const rec = await waitFor(stateRecord, (r) => r?.selectedSolfeggio === 639, 1500);
  expect(!!rec && rec.playlistOrder.join() === 'fl9b,fl9a' && rec.originalOrder.join() === 'fl9a,fl9b' &&
    rec.currentSongIndex === 1 && rec.selectedSolfeggio === 639,
    `the record was written again (saw ${JSON.stringify(rec)})`);
  const meta = await waitFor(() => keys('meta'), (k) => k.length === 2, 1000);
  expect(meta.join() === 'fl9a,fl9b', `then the metadata (saw ${meta.join()})`);
  expect(writes.filter((w) => w === 'playlist-state.put').length === 2,
    `the failed put, then one through a fresh connection (saw ${writes.join(' ')})`);
  expect(!cacheErrors.slice(errors0).some((e) => e.what === 'state'), 'no failure reported: it was stored');

  // The version guard holds for the rewrite too: the flush fails again, its rewrite is held opening its connection,
  // and a newer save writes its record meanwhile. The rewrite must not put the older one back.
  debouncedSaveMeta([x, y], [x, y], 0, null, 741, 5000);
  let release!: () => void;
  openGate = new Promise<void>((r) => (release = r));
  heldOpens = 0;
  let newer: Promise<void> | null = null;
  try {
    expect(failingStateWrites(() => { ran = flushPendingSave(); }) === 1 && ran, 'the flush ran, and its write was made to fail');
    await waitFor(async () => heldOpens, (n) => n >= 1, 1500);
    openGate = null;
    expect(heldOpens === 1, `the rewrite is held opening its connection (held ${heldOpens})`);
    newer = saveMetaAndState([y, x], [x, y], 1, null, 852); // a newer save
    const landed = await waitFor(stateRecord, (r) => r?.selectedSolfeggio === 852, 1500);
    expect(landed?.selectedSolfeggio === 852, `the newer save wrote its record (saw ${landed?.selectedSolfeggio})`);
  } finally {
    openGate = null;
    release();
    await newer;
  }
  await sleep(300);
  const after = await stateRecord();
  expect(after?.selectedSolfeggio === 852, `the rewrite yielded to the newer record (saw ${after?.selectedSolfeggio})`);
});

// --- runner ------------------------------------------------------------------
(async () => {
  const list = document.getElementById('tests')!;
  let failures = 0;
  const failedNames: string[] = [];
  for (const t of tests) {
    const li = document.createElement('li');
    try {
      await t.run();
      li.className = 'pass';
      li.textContent = `PASS  ${t.name}`;
    } catch (err) {
      failures++;
      failedNames.push(`${t.name}: ${(err as Error).message}`);
      li.className = 'fail';
      li.textContent = `FAIL  ${t.name}: ${(err as Error).message}`;
    }
    list.appendChild(li);
  }
  for (const name of dbNames) indexedDB.deleteDatabase(name);
  const result = document.getElementById('result')!;
  result.textContent = failures
    ? `FAILURES: ${failures} of ${tests.length} — ${failedNames.join('; ')}`
    : `ALL PASS (${tests.length})`;
  result.className = failures ? 'fail' : 'pass';
})();
