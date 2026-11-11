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
  // v16.1: saved playlists (V1-V12).
  readSavedPlaylists,
  writePlaylistRecords,
  playlistWriteFailure,
  // v16.8.5: big libraries save (B1-B9).
  __setCacheLimitsForTests,
  __resetPersistRequestForTests,
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
// v16.1: the same writes with their keys ('playlist-state.put(pl:p…)', 'playlist-state.delete(range(..pl:))').
const keyedWrites: string[] = [];
const keyOfWrite = (method: string, args: unknown[]): string => {
  const a = args[0] as any;
  if (method === 'clear') return '*';
  if (method === 'delete') return a instanceof IDBKeyRange ? `range(${a.lower ?? ''}..${a.upper ?? ''})` : String(a);
  return String(a?.key ?? a?.id ?? '?');
};
const failing = new Set<string>();
// v16.8.5: a real quota error, faked. While `quota` is set, an audio put that would take its transaction past what
// the committed transactions left (`quota.left` bytes) makes that whole transaction abort, as Chrome does at commit
// (in a microtask, after the save has put the rest of its batch and is waiting for the commit), and its requests' and
// its own error read as a QuotaExceededError DOMException (a plain abort() reads as AbortError, which the module
// rightly reports as 'write-failed'). The estimate is never consulted.
// v16.8.5 fix round 1 (T4): `form: 'commit'` is Chrome's own form instead (the build's quota-result.json): every put of
// that transaction succeeds, then it aborts from the success of its last pending put, so no request fails and only
// 'abort' fires (the module's txDone settles through onabort, not onerror). Request errors on 'blobs' are counted in
// blobRequestErrors either way.
let quota: { left: number; form?: 'pending' | 'commit' } | null = null;
const quotaTxs = new WeakSet<IDBTransaction>();
const pendingPuts = new WeakMap<IDBTransaction, number>();
let blobRequestErrors = 0;
// v16.8.5 fix round 1 (A3): a put of one of these ids throws, as a DataCloneError does, before it is made.
const throwOn = new Set<string>();
const txBytes = new WeakMap<IDBTransaction, number>();
const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
for (const [proto, owner] of [[IDBRequest.prototype, 'request'], [IDBTransaction.prototype, 'transaction']] as const) {
  const real = Object.getOwnPropertyDescriptor(proto, 'error')!;
  Object.defineProperty(proto, 'error', {
    configurable: true,
    enumerable: real.enumerable,
    get(this: IDBRequest | IDBTransaction) {
      const tx = owner === 'request' ? (this as IDBRequest).transaction : (this as IDBTransaction);
      return tx && quotaTxs.has(tx) ? quotaError() : real.get!.call(this);
    },
  });
}
// v16.8.5: every audio batch, a readwrite transaction on 'blobs' alone as writeNewBlobs makes them, with the ids it put
// (blobBatches), and the order things happened in (events: 'batch#n' as each is made, 'persist', ...).
const blobBatches: string[][] = [];
const batchOf = new WeakMap<IDBTransaction, string[]>();
const events: string[] = [];
for (const method of ['put', 'add', 'delete', 'clear'] as const) {
  const original = (IDBObjectStore.prototype as any)[method];
  (IDBObjectStore.prototype as any)[method] = function (this: IDBObjectStore, ...args: unknown[]) {
    const name = `${this.name}.${method}`;
    if (name === 'blobs.put' && throwOn.has(String((args[0] as any)?.id))) {
      throw new DOMException('The object could not be cloned.', 'DataCloneError');
    }
    writes.push(name);
    keyedWrites.push(`${name}(${keyOfWrite(method, args)})`);
    const request = original.apply(this, args);
    if (failing.has(name)) this.transaction.abort();
    if (name === 'blobs.put') {
      const tx = this.transaction;
      batchOf.get(tx)?.push(String((args[0] as any)?.id));
      pendingPuts.set(tx, (pendingPuts.get(tx) ?? 0) + 1);
      request.addEventListener('error', () => { blobRequestErrors++; });
      request.addEventListener('success', () => {
        const left = (pendingPuts.get(tx) ?? 1) - 1;
        pendingPuts.set(tx, left);
        // Chrome's form: the last put has succeeded, and the commit is refused.
        if (left === 0 && quotaTxs.has(tx) && quota?.form === 'commit') { try { tx.abort(); } catch { /* already over */ } }
      });
      const q = quota;
      if (q && !quotaTxs.has(tx)) {
        if (!txBytes.has(tx)) {
          txBytes.set(tx, 0);
          tx.addEventListener('complete', () => { q.left -= txBytes.get(tx) ?? 0; });
        }
        const bytes = (txBytes.get(tx) ?? 0) + ((args[0] as any)?.fileBlob?.size ?? 0);
        txBytes.set(tx, bytes);
        if (bytes > q.left) {
          quotaTxs.add(tx);
          if (q.form !== 'commit') queueMicrotask(() => { try { tx.abort(); } catch { /* already over */ } });
        }
      }
    }
    return request;
  };
}

/** Run `fn` while the audio has `bytes` of room (see `quota` above), refused in `form`; the room is gone again afterwards. */
async function withQuota(bytes: number, fn: () => Promise<void>, form: 'pending' | 'commit' = 'pending'): Promise<void> {
  quota = { left: bytes, form };
  try {
    await fn();
  } finally {
    quota = null;
  }
}

/** `run`, failing rather than hanging the page when it doesn't settle within `ms` (a save that never ends). */
async function within<T>(ms: number, what: string, run: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(what)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

// v16.8.5: hold a save, until release(), at one of two points:
//   'keys'   its read of the stored tracks (every getAllKeys on 'blobs' while held, the point the old free-space check
//            held them at: between the read and the first write);
//   'batch'  the commit of the n-th audio batch made from now on (committed; the save goes on once released).
// reached() resolves when a save gets there, and fails, rather than hanging the page, if none does within 5 s.
// restore() releases and takes the hold away.
let keyHold: { gate: Promise<void>; entered: () => void } | null = null;
let batchHold: { left: number; gate: Promise<void>; entered: () => void } | null = null;
function holdSave(at: 'keys' | 'batch', n = 1) {
  let entered!: () => void;
  const reachedP = new Promise<void>((resolve) => (entered = resolve));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  if (at === 'keys') keyHold = { gate, entered };
  else batchHold = { left: n, gate, entered };
  const reached = () =>
    Promise.race([
      reachedP,
      sleep(5000).then(() => {
        throw new Error(`no save reached its ${at === 'keys' ? 'read of the stored tracks' : `batch ${n}`}`);
      }),
    ]);
  const restore = () => {
    release();
    if (at === 'keys') keyHold = null;
    else batchHold = null;
  };
  return { reached, release, restore };
}
/** A request whose success is delivered only once `gate` resolves (the module sets onsuccess on what it gets back). */
function heldRequest<T extends IDBRequest>(request: T, gate: Promise<void>): T {
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
}
// v16.8.5 fix round 2 (B15, B16): a save that fails before it knows its tracks. While `keysFail` is set, a read of the
// stored tracks (getAllKeys on 'blobs') fails (its transaction aborts: the request's error event); while `openFail` is
// set, opening a database fails (asked at an older version than the database's: a VersionError). Each counted.
let keysFail = false;
let openFail = false;
let keysFailed = 0;
let opensFailed = 0;
const realGetAllKeys = IDBObjectStore.prototype.getAllKeys;
IDBObjectStore.prototype.getAllKeys = function (this: IDBObjectStore, ...args: unknown[]) {
  const request = (realGetAllKeys as any).apply(this, args);
  if (keysFail && this.name === 'blobs') {
    keysFailed++;
    try { this.transaction.abort(); } catch { /* already over */ }
    return request;
  }
  const hold = keyHold;
  if (this.name !== 'blobs' || !hold) return request;
  hold.entered();
  return heldRequest(request, hold.gate);
} as typeof IDBObjectStore.prototype.getAllKeys;
const realTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: unknown[]) {
  const tx: IDBTransaction = (realTransaction as any).apply(this, args);
  if (args[0] !== 'blobs' || args[1] !== 'readwrite') return tx;
  const ids: string[] = [];
  blobBatches.push(ids);
  batchOf.set(tx, ids);
  const n = blobBatches.length;
  events.push(`batch#${n}`);
  // v16.8.5 fix round 1 (T7): its commit, when it happens (before the module hears of it: this listener comes first).
  tx.addEventListener('complete', () => events.push(`commit#${n}`));
  const hold = batchHold;
  if (!hold || --hold.left !== 0) return tx;
  // The held batch's settling reaches the module only once released: its commit, or (fix round 1, A4's test) its
  // failure, the requests' errors and the abort alike.
  return new Proxy(tx, {
    set(t, k, v) {
      if ((k === 'oncomplete' || k === 'onerror' || k === 'onabort') && typeof v === 'function') {
        (t as any)[k] = (ev: Event) => { hold.entered(); hold.gate.then(() => v.call(t, ev)); };
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
} as typeof IDBDatabase.prototype.transaction;

// v16.0.1: hold the success of every indexedDB.open made while `openGate` is set (openDB sets onsuccess on the
// request it gets back), so a save can be kept "still opening its connection" (U6).
let openGate: Promise<void> | null = null;
let heldOpens = 0;
const realOpen = IDBFactory.prototype.open;
IDBFactory.prototype.open = function (this: IDBFactory, ...args: unknown[]) {
  if (openFail) {
    opensFailed++;
    return (realOpen as any).call(this, args[0], 1);
  }
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
const cacheErrors: { count: number; reason: string; what: string; seq: number; total?: number }[] = [];
const cacheOks: { what: string; seq: number }[] = [];
// v16.8.5: a big save's progress reports.
const cacheProgress: { saved: number; total: number; seq: number }[] = [];
window.addEventListener('aetheria:cache-error', (e) => cacheErrors.push((e as CustomEvent).detail));
window.addEventListener('aetheria:cache-ok', (e) => cacheOks.push((e as CustomEvent).detail));
window.addEventListener('aetheria:cache-progress', (e) => cacheProgress.push((e as CustomEvent).detail));

const MB = 1024 * 1024;
const KB = 1024;

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
  // Hold the save in its read of the stored tracks for 200 ms: a wait that
  // returned at once would read the store before the write.
  const g = holdSave('keys');
  try {
    saveBlobsNow([p, q], [p, q], 0);
    await g.reached();
    setTimeout(g.release, 200);
    await waitForBlobSaves();
  } finally {
    g.restore();
  }
  const stored = (await keys('blobs')).join();
  expect(stored === 'p,q', `both stored once the wait resolves (saw ${stored})`);
});

test('A delete while the save reads the stored tracks is neither written back, counted, nor reported', async () => {
  useDb('delete-in-check');
  const s1 = song('s1');
  const t1 = song('t1');
  let g = holdSave('keys');
  try {
    const run = saveBlobs([s1, t1], [s1, t1]);
    await g.reached();
    await deleteTracksFromCache(['t1']);
    g.release();
    await run;
  } finally {
    g.restore();
  }
  let stored = (await keys('blobs')).join();
  expect(stored === 's1', `the deleted track is not written back (saw ${stored})`);

  // With no room left the report counts only the track that is still wanted.
  useDb('delete-in-check-full');
  const s2 = song('s2');
  const t2 = song('t2');
  cacheErrors.length = 0;
  await withQuota(0, async () => {
    g = holdSave('keys');
    try {
      const run = saveBlobs([s2, t2], [s2, t2]);
      await g.reached();
      await deleteTracksFromCache(['t2']);
      g.release();
      await run;
    } finally {
      g.restore();
    }
  });
  expect(cacheErrors.length === 1 && cacheErrors[0].count === 1 && cacheErrors[0].reason === 'storage-full',
    `storage-full reported for 1 track (saw ${JSON.stringify(cacheErrors)})`);

  // And it isn't written: 20 MB of room fits the small track, not the 30 MB one
  // that was deleted meanwhile.
  useDb('delete-in-check-sized');
  const small = song('small');
  const big = song('big', {}, 30 * MB);
  cacheErrors.length = 0;
  await withQuota(20 * MB, async () => {
    g = holdSave('keys');
    try {
      const run = saveBlobs([small, big], [small, big]);
      await g.reached();
      await deleteTracksFromCache(['big']);
      g.release();
      await run;
    } finally {
      g.restore();
    }
  });
  stored = (await keys('blobs')).join();
  expect(stored === 'small' && cacheErrors.length === 0,
    `the small track is stored and nothing reported (saw ${stored}; ${JSON.stringify(cacheErrors)})`);
});

test('A Clear while the save reads the stored tracks writes and reports nothing', async () => {
  for (const full of [false, true]) {
    useDb(`clear-in-check-${full ? 'full' : 'roomy'}`);
    const u1 = song('u1');
    const v1 = song('v1');
    cacheErrors.length = 0;
    const g = holdSave('keys');
    quota = full ? { left: 0 } : null;
    try {
      const run = saveBlobs([u1, v1], [u1, v1]);
      await g.reached();
      await clearPlaylistCache();
      g.release();
      await run;
    } finally {
      g.restore();
      quota = null;
    }
    expect((await keys('blobs')).length === 0, `nothing written after Clear (${full ? 'full' : 'roomy'})`);
    expect(cacheErrors.length === 0, `nothing reported after Clear (saw ${JSON.stringify(cacheErrors)})`);
  }
});

test('Blob saves run one at a time, in order: a later save never re-counts an earlier one', async () => {
  // Two saves called back to back while the first is held in its read of the
  // stored tracks, with 20 MB of room. The first stores x; the second must see
  // x stored and store only the 30 MB y (too much: only y is reported). Run
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
  const g = holdSave('keys');
  quota = { left: 20 * MB };
  try {
    const first = saveBlobs([x], [x]);
    const second = saveBlobs([x, y], [x, y]);
    await g.reached();
    g.release();
    await Promise.all([first, second]);
  } finally {
    g.restore();
    quota = null;
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
  await withQuota(0, () => saveBlobs([w1], [w1]));
  expect(cacheErrors.length === 1 && cacheErrors[0].reason === 'storage-full', 'the quota error was reported');
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
  await withQuota(0, async () => {
    cacheErrors.length = 0;
    await saveBlobs([s, t], [s, t]);
    expect(cacheErrors.length === 1 && cacheErrors[0].reason === 'storage-full' && cacheErrors[0].count === 2,
      `a quota error is reported for both tracks (saw ${JSON.stringify(cacheErrors)})`);
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

// --- v16.1: saved playlists ('pl:<id>' records beside 'current'; the spec's V1-V12) --------------------------
// Their writer writes only 'pl:' keys of the playlist-state store, never before they were read back (the load gate);
// Clear keeps them unless asked. Fresh track ids (vNN): the tombstones of the tests above persist on this page.

/** A playlist record as App stores it (utils/playlists/model.ts PlaylistRecord), with `n` entries. */
function plRec(id: string, n = 2): { key: string } & Record<string, unknown> {
  return {
    key: 'pl:' + id, v: 1, id, name: 'P ' + id, createdAt: 1, updatedAt: 2,
    entries: Array.from({ length: n }, (_, i) => ({ id: `vt${i}`, name: `tone-${i}`, file: `tone-${i}.wav`, size: 100 + i })),
  };
}
/** A playlist-state record of the database in use, by key, or null. */
async function stateKey(key: string): Promise<any | null> {
  const db = await openDB();
  const r = await req(db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get(key));
  db.close();
  return r ?? null;
}
/** Three stored tracks (`prefix`0..2) with their state record, and four other playlist-state keys around 'pl:'. */
async function seedPlaylistLibrary(prefix: string): Promise<string[]> {
  const ids = [0, 1, 2].map((n) => `${prefix}${n}`);
  const db = await openDB();
  const tx = db.transaction(['blobs', 'meta', 'playlist-state'], 'readwrite');
  ids.forEach((id, n) => {
    tx.objectStore('blobs').put({ id, fileBlob: new Blob([new Uint8Array(100 + n)]), fileName: `${id}.wav`, fileType: 'audio/wav' });
    tx.objectStore('meta').put({ id, name: `Track ${id}`, duration: 10 });
  });
  tx.objectStore('playlist-state').put({ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: 0, loShuWalkMode: null, selectedSolfeggio: 528, savedAt: 1 });
  for (const k of ['queue', 'pl', 'pl;x', 'zzz']) tx.objectStore('playlist-state').put({ key: k });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return ids;
}
const plWrites = () => keyedWrites.filter((w) => w.includes('pl:') || w.startsWith('playlist-state.clear'));

test('V1. The load gate: a playlist write before the read is refused and writes nothing; the read writes nothing and opens it', async () => {
  useDb('v1-gate');
  keyedWrites.length = 0;
  const early = await writePlaylistRecords([plRec('pgate0001')]);
  expect(early === false, `the early write is refused (got ${early})`);
  expect(keyedWrites.length === 0, `nothing written before the read (saw ${keyedWrites.join(' ')})`);
  const raw = await readSavedPlaylists();
  expect(Array.isArray(raw) && raw.length === 0, `the read returns [] for an empty store (saw ${JSON.stringify(raw)})`);
  expect(keyedWrites.length === 0, `the read wrote nothing (saw ${keyedWrites.join(' ')})`);
  expect((await stateKey('pl:pgate0001')) === null, 'the refused record is not stored');
});

test('V2. A playlist write is exactly one put of its own pl: key on playlist-state', async () => {
  useDb('v2-write');
  await readSavedPlaylists();
  keyedWrites.length = 0;
  const ok = await writePlaylistRecords([plRec('paaaaaaaa')]);
  expect(ok === true, `the write lands (got ${ok})`);
  expect(keyedWrites.join(' ') === 'playlist-state.put(pl:paaaaaaaa)', `one put of pl:paaaaaaaa, nothing else (saw ${keyedWrites.join(' ')})`);
  expect((await stateKey('pl:paaaaaaaa'))?.entries?.length === 2, 'the record is stored whole');
});

test('V3. Keys other than pl:<id> are refused, a batch with one bad key too: nothing written', async () => {
  useDb('v3-keys');
  await readSavedPlaylists();
  keyedWrites.length = 0;
  const got = await Promise.all([
    writePlaylistRecords([{ key: 'current' }]),
    writePlaylistRecords([{ key: 'pl:' }]),
    writePlaylistRecords([{ key: 'pl:__proto__' }]),
    writePlaylistRecords([], ['current']),
    writePlaylistRecords([plRec('pokokokok'), { key: 'meta' }]),
  ]);
  expect(got.every((x) => x === false), `every one refused (got ${got.join()})`);
  expect(keyedWrites.length === 0, `nothing written (saw ${keyedWrites.join(' ')})`);
  expect((await stateKey('pl:pokokokok')) === null, 'not even the good record of the bad batch');
});

test('V4. Clear keeps exactly the pl: records (two range deletes, no clear() of playlist-state) and clears blobs and meta', async () => {
  useDb('v4-clear-keeps');
  await readSavedPlaylists();
  await seedPlaylistLibrary('v4');
  expect(await writePlaylistRecords([plRec('paaaaaaaa'), plRec('pbbbbbbbb')]), 'two playlists written');
  keyedWrites.length = 0;
  await clearPlaylistCache();
  const kept = await keys('playlist-state');
  expect(kept.join() === 'pl:paaaaaaaa,pl:pbbbbbbbb', `only the pl: keys stay (saw ${kept.join()})`);
  expect((await keys('blobs')).length === 0 && (await keys('meta')).length === 0, 'blobs and meta cleared');
  const ranges = keyedWrites.filter((w) => w.startsWith('playlist-state.delete(range'));
  expect(!keyedWrites.includes('playlist-state.clear(*)') && ranges.length === 2,
    `two range deletes and no clear() on playlist-state (saw ${keyedWrites.join(' ')})`);
});

test('V5. Clear with { playlists: true } empties the playlist-state store, the playlists too', async () => {
  useDb('v5-clear-all');
  await readSavedPlaylists();
  await seedPlaylistLibrary('v5');
  expect(await writePlaylistRecords([plRec('paaaaaaaa')]), 'a playlist written');
  await clearPlaylistCache({ playlists: true });
  const left = await keys('playlist-state');
  expect(left.length === 0, `nothing left (saw ${left.join()})`);
});

test('V6. A playlist written during a Clear that deletes the playlists lands after it; the one from before is gone', async () => {
  useDb('v6-during');
  await readSavedPlaylists();
  expect(await writePlaylistRecords([plRec('pold00000')]), 'the older playlist written');
  const clearing = clearPlaylistCache({ playlists: true });
  const during = writePlaylistRecords([plRec('pnew00000')]);
  await clearing;
  const landed = await during;
  const left = await keys('playlist-state');
  expect(landed === true && left.join() === 'pl:pnew00000', `only the one made after the tap (got ${landed}; saw ${left.join()})`);
});

test('V7. The restore, a metadata + state save and a delete leave a playlist byte for byte', async () => {
  useDb('v7-untouched');
  await readSavedPlaylists();
  const ids = await seedPlaylistLibrary('v7');
  expect(await writePlaylistRecords([plRec('pcccccccc', 5)]), 'a playlist written');
  const before = JSON.stringify(await stateKey('pl:pcccccccc'));
  const restored = await restorePlaylist();
  expect(restored?.originalPlaylist.length === 3 && restored.orphans.length === 0,
    `the restore is unchanged by the playlists (saw ${restored?.originalPlaylist.length} tracks, ${restored?.orphans.length} orphans)`);
  await saveMetaAndState(restored!.originalPlaylist, restored!.originalPlaylist, 1, null, 528);
  await deleteTracksFromCache([ids[1]]);
  expect(JSON.stringify(await stateKey('pl:pcccccccc')) === before, 'the playlist record is byte for byte the same');
});

test('V8. Another page deleting the database is never blocked by the kept connection; the next write reopens and lands', async () => {
  useDb('v8-reopen');
  const name = dbNames[dbNames.length - 1];
  await readSavedPlaylists();
  let blocked = false;
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(name);
    r.onblocked = () => { blocked = true; };
    r.onsuccess = r.onerror = () => resolve();
  });
  expect(!blocked, 'the delete was not blocked');
  const ok = await writePlaylistRecords([plRec('pdddddddd')]);
  expect(ok === true && !!(await stateKey('pl:pdddddddd')), `the next write reopened and landed (got ${ok})`);
});

test('V9. The read returns the pl: range only', async () => {
  useDb('v9-range');
  await seedPlaylistLibrary('v9');
  const db = await openDB();
  await new Promise<void>((resolve) => {
    const tx = db.transaction('playlist-state', 'readwrite');
    tx.objectStore('playlist-state').put(plRec('peeeeeeee'));
    tx.objectStore('playlist-state').put({ key: 'pl:', v: 1 });
    tx.oncomplete = () => resolve();
  });
  db.close();
  const raw = (await readSavedPlaylists()) as { key: string }[];
  expect(raw?.map((x) => x.key).join() === 'pl:,pl:peeeeeeee', `only pl: keys (saw ${raw?.map((x) => x.key).join()})`);
});

test('V10. A switch of database shuts the load gate again', async () => {
  useDb('v10-first');
  await readSavedPlaylists();
  expect(await writePlaylistRecords([plRec('pffffffff')]), 'the gate is open on the first database');
  useDb('v10-second');
  keyedWrites.length = 0;
  const after = await writePlaylistRecords([plRec('pffffffff')]);
  expect(after === false && plWrites().length === 0, `refused until the new database is read (got ${after}; saw ${keyedWrites.join(' ')})`);
});

test('V11. An unstorable record: false after one attempt, no retry loop; the next write works', async () => {
  useDb('v11-unstorable');
  await readSavedPlaylists();
  keyedWrites.length = 0;
  const bad = await writePlaylistRecords([{ key: 'pl:pgggggggg', f: () => 1 } as { key: string }]);
  await sleep(300);
  const tries = keyedWrites.filter((w) => w.includes('pl:pgggggggg')).length;
  expect(bad === false && tries <= 1, `false, at most one attempt (got ${bad}; ${tries} attempts)`);
  expect(playlistWriteFailure() === 'failed', `the failure is a plain one, not storage-full (got ${playlistWriteFailure()})`);
  const good = await writePlaylistRecords([plRec('phhhhhhhh')]);
  expect(good === true && playlistWriteFailure() === null, `the next write works (got ${good}, ${playlistWriteFailure()})`);
});

test('V12. A hide or pagehide with nothing pending writes nothing; a delete lands', async () => {
  useDb('v12-hide');
  await readSavedPlaylists();
  expect(await writePlaylistRecords([plRec('phhhhhhhh')]), 'a playlist written');
  cancelPendingSaves();
  keyedWrites.length = 0;
  setHidden(true);
  setHidden(false);
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  document.dispatchEvent(new Event('freeze'));
  await sleep(200);
  expect(keyedWrites.length === 0, `nothing written (saw ${keyedWrites.join(' ')})`);
  const ok = await writePlaylistRecords([], ['pl:phhhhhhhh']);
  expect(ok === true && (await stateKey('pl:phhhhhhhh')) === null, `the delete landed (got ${ok})`);
});

// --- v16.8.5: big libraries save (B1-B9) --------------------------------------------------------------------------
// No free-space gate: real write errors decide (the quota fake above), and the audio goes in batches, each its own
// transaction, in library order. Small files with the dev page's limits (__setCacheLimitsForTests), put back after each
// test. Fresh ids (bNN): the tombstones of the tests above persist on this page.

/** `n` tracks `prefix`0.. of `bytes` each. */
const tracks = (prefix: string, n: number, bytes: number): Song[] => Array.from({ length: n }, (_, i) => song(`${prefix}${i}`, {}, bytes));
/** The batches made since `from` (blobBatches' index), as ids joined per batch: 'a,b | c,d'. */
const batchesSince = (from: number) => blobBatches.slice(from).map((b) => b.join()).join(' | ');

test('B1. The estimate decides nothing: with 1 MB free reported, three 2 MB tracks are stored and the save says cache-ok', async () => {
  useDb('b1-estimate');
  const list = tracks('b1t', 3, 2 * MB);
  const storage = navigator.storage as any;
  const had = Object.prototype.hasOwnProperty.call(storage, 'estimate');
  const real = storage.estimate?.bind(storage);
  let asked = 0;
  storage.estimate = async () => {
    asked++;
    const usage = (await real?.())?.usage ?? 0;
    return { quota: usage + MB, usage };
  };
  cacheErrors.length = 0;
  cacheOks.length = 0;
  try {
    await saveBlobs(list, list);
  } finally {
    if (!had) delete storage.estimate;
  }
  const stored = (await keys('blobs')).join();
  expect(stored === 'b1t0,b1t1,b1t2', `all three stored (saw ${stored})`);
  expect(cacheErrors.length === 0 && cacheOks.some((o) => o.what === 'tracks'),
    `cache-ok, no error (errors ${JSON.stringify(cacheErrors)}, oks ${JSON.stringify(cacheOks)})`);
  expect(asked === 0, `the save never asked the estimate (${asked} times)`);
});

test('B2. The release limits: batches of up to 256 MB; progress over 50 tracks or 1 GB (50 tracks: none, 51: reported)', async () => {
  const limits = __setCacheLimitsForTests(null);
  expect(limits.batchBytes === 256 * MB && limits.progressTracks === 50 && limits.progressBytes === 1024 * MB,
    `the release values (saw ${JSON.stringify(limits)})`);
  useDb('b2-fifty');
  const fifty = tracks('b2a', 50, 8);
  cacheProgress.length = 0;
  await saveBlobs(fifty, fifty);
  expect(cacheProgress.length === 0, `no progress for 50 tracks (saw ${JSON.stringify(cacheProgress)})`);
  useDb('b2-fifty-one');
  const fiftyOne = tracks('b2b', 51, 8);
  await saveBlobs(fiftyOne, fiftyOne);
  const last = cacheProgress[cacheProgress.length - 1];
  expect(cacheProgress.length >= 2 && cacheProgress[0].saved === 0 && last?.saved === 51 && last.total === 51,
    `51 tracks report their progress, 0 then 51 of 51 (saw ${JSON.stringify(cacheProgress)})`);
  expect((await keys('blobs')).length === 51, 'all 51 stored');
});

test('B3. Batches: each its own transaction, up to the limit and at least one track, in the order the lists give', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB });
    useDb('b3-batches');
    // Ten tracks of 100 KB: two to a batch (a third would pass 256 KB).
    const ten = tracks('b3t', 10, 100 * KB);
    let from = blobBatches.length;
    await saveBlobs(ten, ten);
    expect(batchesSince(from) === 'b3t0,b3t1 | b3t2,b3t3 | b3t4,b3t5 | b3t6,b3t7 | b3t8,b3t9',
      `five transactions of two, in order (saw ${batchesSince(from)})`);
    // Exactly the limit fits in one batch; a track over it is a batch of its own.
    useDb('b3-edges');
    const edge = [song('b3e0', {}, 128 * KB), song('b3e1', {}, 128 * KB), song('b3e2', {}, 300 * KB), song('b3e3', {}, 100 * KB), song('b3e4', {}, 100 * KB)];
    from = blobBatches.length;
    await saveBlobs(edge, edge);
    expect(batchesSince(from) === 'b3e0,b3e1 | b3e2 | b3e3,b3e4',
      `256 KB in one batch, the 300 KB track alone (saw ${batchesSince(from)})`);
    // The order is the lists': the play order first, then the rest of the library (uniqueSongs).
    useDb('b3-order');
    const lib = tracks('b3o', 4, 200 * KB);
    from = blobBatches.length;
    await saveBlobs([lib[3], lib[1]], lib);
    expect(batchesSince(from) === 'b3o3 | b3o1 | b3o0 | b3o2', `the play order's tracks first (saw ${batchesSince(from)})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B4. A quota error at the 3rd batch: batches 1-2 stay stored, exactly the rest is reported (storage-full, of 10, no cache-ok); a later save stores only the rest', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB, progressTracks: 3 });
    useDb('b4-partial');
    const ten = tracks('b4t', 10, 100 * KB);
    cacheErrors.length = 0;
    cacheOks.length = 0;
    cacheProgress.length = 0;
    // Fix round 1 (T7): what the progress said before the error (once a batch has committed, never at its put()).
    let progressAtError = '';
    const atError = (ev: Event) => {
      if ((ev as CustomEvent).detail?.what !== 'tracks') return;
      const p = cacheProgress[cacheProgress.length - 1];
      progressAtError = p ? `${p.saved}/${p.total}` : 'none';
    };
    window.addEventListener('aetheria:cache-error', atError);
    try {
      await withQuota(450 * KB, () => saveBlobs(ten, ten)); // two batches of 200 KB fit, the third doesn't
    } finally {
      window.removeEventListener('aetheria:cache-error', atError);
    }
    const stored = (await keys('blobs')).join();
    expect(stored === 'b4t0,b4t1,b4t2,b4t3', `batches 1 and 2 stored (saw ${stored})`);
    const e = cacheErrors[0];
    expect(cacheErrors.length === 1 && e.what === 'tracks' && e.reason === 'storage-full' && e.count === 6 && e.total === 10,
      `6 of 10 reported as storage-full (saw ${JSON.stringify(cacheErrors)})`);
    expect(!cacheOks.some((o) => o.what === 'tracks' && o.seq === e.seq), `no cache-ok for the partial save (saw ${JSON.stringify(cacheOks)})`);
    expect(progressAtError === '4/10', `the last progress before the error says 4 saved, the two committed batches (saw ${progressAtError}; ${cacheProgress.map((p) => `${p.saved}/${p.total}`).join(' ')})`);
    // Room again: the next save writes only the six that were not stored.
    writes.length = 0;
    const from = blobBatches.length;
    await saveBlobs(ten, ten);
    expect(batchesSince(from) === 'b4t4,b4t5 | b4t6,b4t7 | b4t8,b4t9', `only the rest is written (saw ${batchesSince(from)})`);
    expect((await keys('blobs')).length === 10 && cacheOks.some((o) => o.what === 'tracks' && o.seq > e.seq),
      'all ten stored, and that save says cache-ok');
  } finally {
    __setCacheLimitsForTests(null);
  }
});

// v16.8.5 fix round 1 (T4): Chrome refuses a transaction at its commit, after every put has succeeded: no request error,
// only the abort, with the transaction's error a QuotaExceededError. That settles the save through txDone's onabort (the
// fake above, B4's, goes through onerror), so this pins that branch: worded storage-full, and the save ends (a save that
// never settles would stall every save after it, and the Reload waiting for it).
test("B4b. Chrome's own quota form (every put succeeds, the commit is refused): the same partial, reported as storage-full, and the save ends", async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB });
    useDb('b4b-commit');
    const ten = tracks('b4c', 10, 100 * KB);
    cacheErrors.length = 0;
    cacheOks.length = 0;
    blobRequestErrors = 0;
    await within(5000, 'the save never settled after the refused commit', withQuota(450 * KB, () => saveBlobs(ten, ten), 'commit'));
    expect(blobRequestErrors === 0, `no request failed: only the transaction aborted (saw ${blobRequestErrors})`);
    const stored = (await keys('blobs')).join();
    expect(stored === 'b4c0,b4c1,b4c2,b4c3', `batches 1 and 2 stored (saw ${stored})`);
    const e = cacheErrors[0];
    expect(cacheErrors.length === 1 && e.what === 'tracks' && e.reason === 'storage-full' && e.count === 6 && e.total === 10,
      `6 of 10 reported as storage-full (saw ${JSON.stringify(cacheErrors)})`);
    expect(!cacheOks.some((o) => o.what === 'tracks' && o.seq === e.seq), `no cache-ok for the partial save (saw ${JSON.stringify(cacheOks)})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B5. A Clear between batches: nothing after it is written, nothing is reported (no error, no cache-ok, no progress)', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB, progressTracks: 3 });
    useDb('b5-clear');
    const ten = tracks('b5t', 10, 100 * KB);
    cacheErrors.length = 0;
    cacheOks.length = 0;
    cacheProgress.length = 0;
    const g = holdSave('batch', 1);
    const from = blobBatches.length;
    let progressAtClear = -1;
    try {
      const run = saveBlobs(ten, ten);
      await g.reached(); // batch 1 is committed; the save waits
      progressAtClear = cacheProgress.length;
      await clearPlaylistCache();
      g.release();
      await run;
    } finally {
      g.restore();
    }
    expect(batchesSince(from) === 'b5t0,b5t1', `only the batch before the Clear was made (saw ${batchesSince(from)})`);
    expect((await keys('blobs')).length === 0, 'the Clear removed it, and nothing was written after');
    expect(cacheErrors.length === 0 && !cacheOks.some((o) => o.what === 'tracks'),
      `nothing reported (errors ${JSON.stringify(cacheErrors)}, oks ${JSON.stringify(cacheOks)})`);
    expect(cacheProgress.length === progressAtClear, `no progress after the Clear (saw ${JSON.stringify(cacheProgress)})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B6. A delete between batches: that track is not written and not counted (progress, the report)', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB, progressTracks: 3 });
    useDb('b6-delete');
    const ten = tracks('b6t', 10, 100 * KB);
    cacheProgress.length = 0;
    cacheErrors.length = 0;
    let g = holdSave('batch', 1);
    let from = blobBatches.length;
    try {
      const run = saveBlobs(ten, ten);
      await g.reached();
      await deleteTracksFromCache(['b6t5']);
      g.release();
      await run;
    } finally {
      g.restore();
    }
    expect(!blobBatches.slice(from).flat().includes('b6t5'), `b6t5 is never put (saw ${batchesSince(from)})`);
    // Fix round 1 (T8 N1): every report in between leaves it out too, from the first one after the delete.
    const seen = cacheProgress.map((p) => `${p.saved}/${p.total}`).join(' ');
    expect(seen === '0/10 2/9 4/9 6/9 8/9 9/9', `the progress: 0 of 10, then of 9 from the delete on, ending at 9 of 9 (saw ${seen})`);
    expect((await keys('blobs')).length === 9 && cacheErrors.length === 0, 'nine stored, nothing reported');

    // And a later failure doesn't count it either: room for two batches, b6u5 deleted after the first.
    useDb('b6-delete-full');
    const more = tracks('b6u', 10, 100 * KB);
    cacheErrors.length = 0;
    await withQuota(450 * KB, async () => {
      g = holdSave('batch', 1);
      from = blobBatches.length;
      try {
        const run = saveBlobs(more, more);
        await g.reached();
        await deleteTracksFromCache(['b6u5']);
        g.release();
        await run;
      } finally {
        g.restore();
      }
    });
    const e = cacheErrors[0];
    expect(cacheErrors.length === 1 && e.count === 5 && e.total === 9 && e.reason === 'storage-full',
      `5 of 9 reported (saw ${JSON.stringify(cacheErrors)})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

// v16.8.5 fix round 1 (A2): a track deleted during the save is never counted, not even one already stored (its batch
// in flight or committed: the delete's transaction removes it after). `saved` may then drop by one.
// Fix round 2 (rev2 tests N-h): the title says what it pins (one delete never shows as a drop between two reports: each
// batch adds a track); B6c deletes two stored tracks at once, so `saved` visibly drops.
test('B6b. A track deleted after its batch committed is not counted: the reports leave it out from the next on (1/9 …), the end counts 9, and a later failure says "of 9"', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB, progressTracks: 3 });
    useDb('b6b-stored');
    const ten = tracks('b6v', 10, 100 * KB);
    cacheProgress.length = 0;
    cacheErrors.length = 0;
    cacheOks.length = 0;
    // b6v1 is in batch 1: committed (its commit held from the save) when the delete lands.
    let g = holdSave('batch', 1);
    try {
      const run = saveBlobs(ten, ten);
      await g.reached();
      await deleteTracksFromCache(['b6v1']);
      g.release();
      await run;
    } finally {
      g.restore();
    }
    const seen = cacheProgress.map((p) => `${p.saved}/${p.total}`).join(' ');
    expect(seen === '0/10 1/9 3/9 5/9 7/9 9/9', `saved leaves the deleted track out once it is gone (saw ${seen})`);
    const seq = cacheProgress[0]?.seq;
    expect(cacheErrors.length === 0 && cacheOks.some((o) => o.what === 'tracks' && o.seq === seq), `the save ends with cache-ok (saw ${JSON.stringify(cacheErrors)}; ${JSON.stringify(cacheOks)})`);
    const stored = await keys('blobs');
    expect(stored.length === 9 && !stored.includes('b6v1'), `nine stored, the deleted one removed (saw ${stored.join()})`);

    // And the warning's total: room for two batches, b6w0 (stored in batch 1) deleted after it.
    useDb('b6b-stored-full');
    const more = tracks('b6w', 10, 100 * KB);
    cacheErrors.length = 0;
    await withQuota(450 * KB, async () => {
      g = holdSave('batch', 1);
      try {
        const run = saveBlobs(more, more);
        await g.reached();
        await deleteTracksFromCache(['b6w0']);
        g.release();
        await run;
      } finally {
        g.restore();
      }
    });
    const e = cacheErrors[0];
    expect(cacheErrors.length === 1 && e.count === 6 && e.total === 9 && e.reason === 'storage-full',
      `6 of 9 reported: three stored that still exist, six not (saw ${JSON.stringify(cacheErrors)})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B6c. Two stored tracks deleted at once: saved visibly drops (2/10, then 1/8), they are never counted again, and the end counts 8', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 150 * KB, progressTracks: 3 }); // one 100 KB track to a batch
    useDb('b6c-drop');
    const ten = tracks('b6x', 10, 100 * KB);
    cacheProgress.length = 0;
    cacheErrors.length = 0;
    cacheOks.length = 0;
    // Batch 3's commit held from the save: b6x0 and b6x1 (batches 1 and 2) are stored and reported (2/10) when both go.
    const g = holdSave('batch', 3);
    try {
      const run = saveBlobs(ten, ten);
      await g.reached();
      await deleteTracksFromCache(['b6x0', 'b6x1']);
      g.release();
      await run;
    } finally {
      g.restore();
    }
    const seen = cacheProgress.map((p) => `${p.saved}/${p.total}`).join(' ');
    expect(seen === '0/10 1/10 2/10 1/8 2/8 3/8 4/8 5/8 6/8 7/8 8/8', `saved drops from 2 to 1 as the two go, and they never count again (saw ${seen})`);
    const seq = cacheProgress[0]?.seq;
    expect(cacheErrors.length === 0 && cacheOks.some((o) => o.what === 'tracks' && o.seq === seq), `the save ends with cache-ok (saw ${JSON.stringify(cacheErrors)}; ${JSON.stringify(cacheOks)})`);
    const stored = await keys('blobs');
    expect(stored.length === 8 && !stored.includes('b6x0') && !stored.includes('b6x1'), `eight stored, the two deleted removed (saw ${stored.join()})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B7. Reload safety: waitForBlobSaves resolves only after the last batch', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB });
    useDb('b7-wait');
    const ten = tracks('b7t', 10, 100 * KB);
    const g = holdSave('batch', 1);
    try {
      saveBlobsNow(ten, ten, 0);
      await g.reached();
      setTimeout(g.release, 200);
      await waitForBlobSaves();
    } finally {
      g.restore();
    }
    const stored = (await keys('blobs')).length;
    expect(stored === 10, `all ten stored once the wait resolves (saw ${stored})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B8. Progress: 0 at the start and after each batch, only growing, the last saved = total, then cache-ok; none for a small save (tracks or bytes)', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB, progressTracks: 3 });
    useDb('b8-progress');
    const ten = tracks('b8t', 10, 100 * KB);
    cacheProgress.length = 0;
    cacheOks.length = 0;
    await saveBlobs(ten, ten);
    const seen = cacheProgress.map((p) => `${p.saved}/${p.total}`).join(' ');
    expect(seen === '0/10 2/10 4/10 6/10 8/10 10/10', `one report per batch (saw ${seen})`);
    const seq = cacheProgress[0]?.seq;
    expect(cacheProgress.every((p) => p.seq === seq) && cacheOks.some((o) => o.what === 'tracks' && o.seq === seq),
      `one save's seq, and its cache-ok (saw ${JSON.stringify(cacheProgress)}; ${JSON.stringify(cacheOks)})`);
    // Three tracks (not more than 3): none.
    useDb('b8-small');
    cacheProgress.length = 0;
    const three = tracks('b8s', 3, 100 * KB);
    await saveBlobs(three, three);
    expect(cacheProgress.length === 0, `no progress for a small save (saw ${JSON.stringify(cacheProgress)})`);
    // By bytes: over 1 MB reports, 800 KB doesn't.
    __setCacheLimitsForTests({ batchBytes: 256 * KB, progressBytes: MB });
    useDb('b8-bytes');
    const big = tracks('b8b', 3, 400 * KB);
    await saveBlobs(big, big);
    expect(cacheProgress.length > 0 && cacheProgress[cacheProgress.length - 1].saved === 3, `1.2 MB reports (saw ${JSON.stringify(cacheProgress)})`);
    cacheProgress.length = 0;
    const under = tracks('b8c', 2, 400 * KB);
    await saveBlobs(under, under);
    expect(cacheProgress.length === 0, `800 KB doesn't (saw ${JSON.stringify(cacheProgress)})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B9. Persistent storage is asked for after the first committed batch, even when a later batch fails', async () => {
  const storage = navigator.storage as any;
  const had = Object.prototype.hasOwnProperty.call(storage, 'persist');
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB });
    useDb('b9-persist');
    storage.persist = async () => { events.push('persist'); return true; };
    __resetPersistRequestForTests();
    const ten = tracks('b9t', 10, 100 * KB);
    events.length = 0;
    cacheErrors.length = 0;
    await withQuota(250 * KB, () => saveBlobs(ten, ten)); // batch 1 fits, batch 2 doesn't
    const n = blobBatches.length;
    // Fix round 1 (T7): after the first batch's commit (its transaction's complete), not merely after it was made.
    expect(events.join(' ') === `batch#${n - 1} commit#${n - 1} persist batch#${n}`,
      `asked once, after the first batch committed and before the second (saw ${events.join(' ')})`);
    expect(cacheErrors.length === 1 && cacheErrors[0].count === 8, `the second batch's failure reported (saw ${JSON.stringify(cacheErrors)})`);
  } finally {
    if (!had) delete storage.persist;
    __setCacheLimitsForTests(null);
  }
});

// --- v16.8.5 fix round 1: the edges and paths rev1 found unpinned (B10-B14) ---------------------------------------

test('B10. The progress thresholds are strict: exactly the byte limit shows none, one byte over shows it', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB, progressBytes: 200 * KB });
    useDb('b10-at');
    cacheProgress.length = 0;
    const at = [song('b10a0', {}, 100 * KB), song('b10a1', {}, 100 * KB)];
    await saveBlobs(at, at);
    expect(cacheProgress.length === 0, `exactly 200 KB: no progress (saw ${JSON.stringify(cacheProgress)})`);
    useDb('b10-over');
    const over = [song('b10b0', {}, 100 * KB), song('b10b1', {}, 100 * KB + 1)];
    await saveBlobs(over, over);
    const last = cacheProgress[cacheProgress.length - 1];
    expect(cacheProgress.length >= 2 && cacheProgress[0].saved === 0 && last?.saved === 2 && last.total === 2,
      `one byte over: 0 then 2 of 2 (saw ${JSON.stringify(cacheProgress)})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B11. A Clear during the last batch\'s commit: no cache-ok, no error, no progress after it', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB, progressTracks: 3 });
    useDb('b11-last');
    const ten = tracks('b11t', 10, 100 * KB); // five batches of two
    cacheErrors.length = 0;
    cacheOks.length = 0;
    cacheProgress.length = 0;
    const g = holdSave('batch', 5);
    let progressAtClear = -1;
    try {
      const run = saveBlobs(ten, ten);
      await g.reached(); // the last batch is committed; the save hasn't heard yet
      progressAtClear = cacheProgress.length;
      await clearPlaylistCache();
      g.release();
      await run;
    } finally {
      g.restore();
    }
    expect(cacheErrors.length === 0 && !cacheOks.some((o) => o.what === 'tracks'),
      `nothing reported after the Clear (errors ${JSON.stringify(cacheErrors)}, oks ${JSON.stringify(cacheOks)})`);
    expect(cacheProgress.length === progressAtClear, `no progress after the Clear (saw ${JSON.stringify(cacheProgress)})`);
    expect((await keys('blobs')).length === 0, 'the Clear emptied the store');
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B12. An audio write that fails for another reason: write-failed, with the save\'s total; the batches before stay', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB });
    useDb('b12-failed');
    const ten = tracks('b12t', 10, 100 * KB);
    cacheErrors.length = 0;
    cacheOks.length = 0;
    const g = holdSave('batch', 2);
    try {
      const run = saveBlobs(ten, ten);
      await g.reached(); // batches 1 and 2 committed; from batch 3 on, every audio put aborts its transaction
      failing.add('blobs.put');
      g.release();
      await run;
    } finally {
      failing.delete('blobs.put');
      g.restore();
    }
    const stored = (await keys('blobs')).join();
    expect(stored === 'b12t0,b12t1,b12t2,b12t3', `batches 1 and 2 stored (saw ${stored})`);
    const e = cacheErrors[0];
    expect(cacheErrors.length === 1 && e.what === 'tracks' && e.reason === 'write-failed' && e.count === 6 && e.total === 10,
      `6 of 10 reported as write-failed (saw ${JSON.stringify(cacheErrors)})`);
    expect(!cacheOks.some((o) => o.what === 'tracks' && o.seq === e.seq), `no cache-ok (saw ${JSON.stringify(cacheOks)})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B13. A put() that throws mid-batch aborts that batch: nothing of it is stored, and exactly what is not stored is reported', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB });
    useDb('b13-throw');
    const ten = tracks('b13t', 10, 100 * KB);
    cacheErrors.length = 0;
    throwOn.add('b13t3'); // batch 2 is b13t2, b13t3: the second put throws after the first was made
    try {
      await saveBlobs(ten, ten);
    } finally {
      throwOn.delete('b13t3');
    }
    const stored = await keys('blobs');
    expect(stored.join() === 'b13t0,b13t1', `only batch 1 is stored, not b13t2 of the failed batch (saw ${stored.join()})`);
    const e = cacheErrors[0];
    expect(cacheErrors.length === 1 && e.reason === 'write-failed' && e.count === 8 && e.total === 10 && e.count === 10 - stored.length,
      `8 of 10 reported, exactly the ones not stored (saw ${JSON.stringify(cacheErrors)})`);
  } finally {
    __setCacheLimitsForTests(null);
  }
});

test('B14. A batch fails and every track still to store was deleted meanwhile: the save ends cleanly (progress at saved = total, then cache-ok, no error)', async () => {
  try {
    __setCacheLimitsForTests({ batchBytes: 256 * KB, progressTracks: 3 });
    useDb('b14-gone');
    const six = tracks('b14t', 6, 100 * KB); // three batches of two
    cacheErrors.length = 0;
    cacheOks.length = 0;
    cacheProgress.length = 0;
    await withQuota(450 * KB, async () => {
      // Batch 3 fails; its failure reaches the save only once released, and meanwhile its two tracks are deleted.
      const g = holdSave('batch', 3);
      try {
        const run = saveBlobs(six, six);
        await g.reached();
        await deleteTracksFromCache(['b14t4', 'b14t5']);
        g.release();
        await run;
      } finally {
        g.restore();
      }
    });
    const seq = cacheProgress[0]?.seq;
    const seen = cacheProgress.map((p) => `${p.saved}/${p.total}`).join(' ');
    expect(cacheErrors.length === 0, `no error: nothing that exists is unsaved (saw ${JSON.stringify(cacheErrors)})`);
    expect(cacheOks.some((o) => o.what === 'tracks' && o.seq === seq), `the save's cache-ok (saw ${JSON.stringify(cacheOks)}; progress ${seen})`);
    expect(seen.endsWith(' 4/4'), `its progress ends at 4 of 4 (saw ${seen})`);
    expect((await keys('blobs')).join() === 'b14t0,b14t1,b14t2,b14t3', 'the four stored');
  } finally {
    __setCacheLimitsForTests(null);
  }
});

// --- v16.8.5 fix round 2 (rev2 tests SF-c): the A4 path's `listed` guard ----------------------------------------------
// A save that fails before it knows its tracks has nothing it could report: no cache-error, and above all no cache-ok,
// which would withdraw a true "could not be saved" warning (App's seq rules) while those tracks are still not stored.
test('B15. A save whose read of the stored tracks fails reports nothing (no cache-error, no cache-ok, no progress) and writes nothing', async () => {
  useDb('b15-keys');
  const two = tracks('b15t', 2, 8);
  await saveBlobs(two.slice(0, 1), two.slice(0, 1)); // one stored
  cacheErrors.length = 0;
  cacheOks.length = 0;
  cacheProgress.length = 0;
  const from = blobBatches.length;
  const before = keysFailed;
  keysFail = true;
  try {
    await within(5000, 'the save did not settle', saveBlobs(two, two));
  } finally {
    keysFail = false;
  }
  expect(keysFailed > before, 'its read of the stored tracks failed');
  expect(cacheErrors.length === 0 && cacheOks.length === 0 && cacheProgress.length === 0,
    `nothing reported (saw ${JSON.stringify(cacheErrors)}; ${JSON.stringify(cacheOks)}; ${JSON.stringify(cacheProgress)})`);
  expect(blobBatches.length === from, `nothing written (saw ${batchesSince(from)})`);
  expect((await keys('blobs')).join() === 'b15t0', 'only the first stored');
});

test('B16. A save whose database does not open reports nothing (no cache-error, no cache-ok, no progress) and writes nothing', async () => {
  useDb('b16-open');
  const two = tracks('b16t', 2, 8);
  await saveBlobs(two.slice(0, 1), two.slice(0, 1)); // the database exists (version 2), one stored
  cacheErrors.length = 0;
  cacheOks.length = 0;
  cacheProgress.length = 0;
  const from = blobBatches.length;
  const before = opensFailed;
  openFail = true;
  try {
    await within(5000, 'the save did not settle', saveBlobs(two, two));
  } finally {
    openFail = false;
  }
  expect(opensFailed > before, 'its database did not open');
  expect(cacheErrors.length === 0 && cacheOks.length === 0 && cacheProgress.length === 0,
    `nothing reported (saw ${JSON.stringify(cacheErrors)}; ${JSON.stringify(cacheOks)}; ${JSON.stringify(cacheProgress)})`);
  expect(blobBatches.length === from, `nothing written (saw ${batchesSince(from)})`);
  expect((await keys('blobs')).join() === 'b16t0', 'only the first stored');
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
