import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  acceptDisclaimer,
  acceptDisclaimerNew,
  addFiles,
  appUrl,
  cacheCounts,
  closeSecondTab,
  confirmDelete,
  crash,
  controllableVisibility,
  holdRestore,
  controlStateSaves,
  countBlobSaves,
  countStatePuts,
  libraryRowButton,
  libraryState,
  metaRecords,
  openLibraryTab,
  plPuts,
  rowMenu,
  rowOf,
  savedState,
  secondTab,
  tab,
  toneWav,
  undoToast,
  LAYER_ENGINE_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
} from './helpers';

// v16.1, saved playlists (spec §5.4). Stage A drives them through the dev hook window.__aetheriaPlaylists (each call
// inside a click event: a tap's priority and task, as the UI makes it); Stage B adds each one's UI path. A playlist is
// one record 'pl:<id>' in the playlist-state store, written by App's one writer at the tap, read back once after the
// library's restore (the load gate). It names tracks by id and by their file's name and size: a deleted or cleared
// track stays as "missing", and the same file imported again comes back.
// The seed: synthetic tones tone-01 … (tone k lasts 6 + 0.25 k s, 8 kHz mono: the same bytes' size as helpers.toneWav,
// so importing toneWav(seconds of k) as tone-NN.wav is "the same file"), each with a crystal; classic layers; the new
// layout at phone size unless a test says classic. Playlist names are plain words.

const toneName = (k: number) => `tone-${String(k).padStart(2, '0')}`;
const secondsOf = (k: number) => 6 + 0.25 * k;
const sizeOf = (k: number) => 44 + Math.round(secondsOf(k) * 8000) * 2;
const CRY = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];

type Layout = 'new' | 'classic';

/** A stored playlist record, as App writes it (utils/playlists/model.ts PlaylistRecord). */
interface Rec {
  key: string;
  v: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  entries: { id: string; name: string; file: string; size: number }[];
  from?: { kind: string; label?: string };
}
/** An entry for tone k (its id, as seeded or imported). */
const entry = (id: string, k: number) => ({ id, name: toneName(k), file: `${toneName(k)}.wav`, size: sizeOf(k) });
const rec = (id: string, name: string, entries: Rec['entries'], at = 1_000): Rec => ({ key: `pl:${id}`, v: 1, id, name, createdAt: at, updatedAt: at, entries });

/** n synthetic tones straight into IndexedDB (from /manifest.json), and any raw playlist-state records. Returns the
 *  track ids in library order. */
async function seed(page: Page, o: { n: number; noCrystal?: number[]; records?: unknown[]; long?: boolean }): Promise<string[]> {
  await page.goto(appUrl('/manifest.json'));
  return page.evaluate(async ({ n, noCrystal, records, CRY, long }) => {
    const wav = (secs: number, freq: number) => {
      const rate = 8000, len = Math.round(secs * rate), buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
      const w = (o: number, x: string) => { for (let i = 0; i < x.length; i++) v.setUint8(o + i, x.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
      v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      w(36, 'data'); v.setUint32(40, len * 2, true);
      for (let i = 0; i < len; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 5000 * Math.min(1, i / 400, (len - i) / 400)), true);
      return new Blob([buf], { type: 'audio/wav' });
    };
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db', 2);
      r.onupgradeneeded = () => { const d = r.result; for (const x of ['blobs', 'meta']) d.createObjectStore(x, { keyPath: 'id' }); d.createObjectStore('playlist-state', { keyPath: 'key' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const t0 = Date.now() - n * 1000;
    const ids: string[] = [];
    const tx = db.transaction(['blobs', 'meta'], 'readwrite');
    for (let i = 0; i < n; i++) {
      const k = i + 1;
      const id = `${t0 + i * 1000}-p${String(k).padStart(2, '0')}`;
      ids.push(id);
      const name = `tone-${String(k).padStart(2, '0')}`;
      const secs = long ? 40 + 0.25 * k : 6 + 0.25 * k;
      tx.objectStore('blobs').put({ id, fileBlob: wav(secs, 220 + i * 11), fileName: `${name}.wav`, fileType: 'audio/wav' });
      const hz = CRY[i % 27];
      tx.objectStore('meta').put(noCrystal.includes(k) ? { id, name, duration: secs } : { id, name, duration: secs, harmonicFreq: hz + 2.5, closestSolfeggio: hz, harmonicDeviation: 2.5, crystalSource: 'scan' });
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    const st = db.transaction('playlist-state', 'readwrite');
    st.objectStore('playlist-state').put({ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 396, savedAt: Date.now() });
    for (const r of records) st.objectStore('playlist-state').put(r);
    await new Promise((resolve) => (st.oncomplete = resolve));
    db.close();
    return ids;
  }, { n: o.n, noCrystal: o.noCrystal ?? [], records: o.records ?? [], CRY, long: !!o.long });
}

/** Raw playlist-state records put from /manifest.json (the app is not on the page then). */
async function putRecords(page: Page, records: unknown[]): Promise<void> {
  await page.goto(appUrl('/manifest.json'));
  await page.evaluate(async (records) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction('playlist-state', 'readwrite');
    for (const r of records) tx.objectStore('playlist-state').put(r);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, records);
}

/** Before the app, on every load: the tutorial seen, classic layers, the layout; a tap wrapper (a call inside a click);
 *  what the music element plays; the state-record and playlist put counters; every store write, with its key. */
async function instrument(page: Page, layout: Layout): Promise<void> {
  await page.addInitScript(({ keys, layout }) => {
    const w = window as any;
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      localStorage.setItem(keys.engine, 'classic');
      localStorage.setItem(keys.layout, layout);
    } catch {
      // No storage here (about:blank).
    }
    w.__tap = (f: () => unknown) => {
      let out: unknown;
      const b = document.createElement('button');
      b.addEventListener('click', () => { out = f(); });
      document.body.appendChild(b);
      b.click();
      b.remove();
      return out;
    };
    w.__storeLog = [] as string[];
    for (const m of ['put', 'add', 'delete', 'clear'] as const) {
      const orig = (IDBObjectStore.prototype as any)[m];
      (IDBObjectStore.prototype as any)[m] = function (this: IDBObjectStore, ...a: any[]) {
        const k = m === 'clear' ? '*' : m === 'delete' ? (a[0] instanceof IDBKeyRange ? 'range' : String(a[0])) : String(a[0]?.key ?? a[0]?.id);
        w.__storeLog.push(`${this.name}.${m}(${k})`);
        return orig.apply(this, a);
      };
    }
    w.__urlName = new Map();
    const mint = URL.createObjectURL;
    URL.createObjectURL = function (obj: any) { const u = mint.call(URL, obj); if (obj && typeof obj.name === 'string') w.__urlName.set(u, obj.name.replace(/\.wav$/, '')); return u; } as any;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = String(this.getAttribute('src') ?? this.src);
      if (!src.startsWith('data:')) w.__el = this;
      return play.call(this);
    };
    w.__heard = () => (w.__el ? (w.__urlName.get(w.__el.getAttribute('src')) ?? null) : null);
  }, { keys: { engine: LAYER_ENGINE_KEY, layout: LAYOUT_KEY }, layout });
  await countStatePuts(page);
}

/** Load the app over the seed; wait for the library and the playlists to be read back. */
async function launch(page: Page, layout: Layout, o: { playlists?: 'ready' | 'any' } = {}): Promise<void> {
  if (layout === 'new' && !ON_DEVICE) await page.setViewportSize(PHONE_VIEWPORT);
  if (layout === 'new' && ON_DEVICE) await page.setViewportSize(PHONE_VIEWPORT);
  await page.goto(appUrl('/'));
  if (layout === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library restores', timeout: 60_000 }).toBeGreaterThan(0);
  await page.waitForFunction(() => typeof (window as any).__aetheriaPlaylists?.state === 'function', null, { timeout: 10_000 });
  if ((o.playlists ?? 'ready') === 'ready') await expect.poll(() => pl(page).then((s) => s.status), { message: 'the playlists are read back' }).toBe('ready');
}

async function open(page: Page, o: { n?: number; layout?: Layout; records?: (ids: string[]) => unknown[]; noCrystal?: number[]; long?: boolean } = {}): Promise<string[]> {
  const layout = o.layout ?? 'new';
  await instrument(page, layout);
  const ids = await seed(page, { n: o.n ?? 12, noCrystal: o.noCrystal, long: o.long });
  if (o.records) await putRecords(page, o.records(ids));
  await launch(page, layout);
  return ids;
}

interface PlState {
  status: 'loading' | 'ready' | 'error';
  unreadable: number;
  playing: string | null;
  open: string | null;
  undo: number | null;
  lists: { id: string; name: string; ids: string[]; names: string[]; tracks: (string | null)[]; present: number; missing: number; from: { kind: string; label?: string } | null; updatedAt: number }[];
}
const pl = (page: Page): Promise<PlState> => page.evaluate(() => (window as any).__aetheriaPlaylists.state());
const listOf = async (page: Page, name: string) => (await pl(page)).lists.find((l) => l.name === name)!;
/** A hook call inside a click event (a tap): its return value. */
const P = <T = unknown>(page: Page, method: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(({ method, args }) => (window as any).__tap(() => (window as any).__aetheriaPlaylists[method](...args)), { method, args }) as Promise<T>;
/** Every 'pl:' record on disk, by key order. */
async function stored(page: Page): Promise<Rec[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    if (!db.objectStoreNames.contains('playlist-state')) { db.close(); return []; } // a database deleted (PL3)
    const all: any[] = await new Promise((resolve, reject) => {
      const q = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').getAll(IDBKeyRange.bound('pl:', 'pl;', false, true));
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    db.close();
    return all;
  });
}
const storedOf = async (page: Page, id: string) => (await stored(page)).find((r) => r.id === id) ?? null;
const storeLog = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__storeLog.slice());
const clearStoreLog = (page: Page) => page.evaluate(() => { (window as any).__storeLog.length = 0; });
const toastText = (page: Page) => page.getByTestId('notices').locator('div[aria-atomic="true"]').first();
const heard = (page: Page) => page.evaluate(() => (window as any).__heard() as string | null);
const qstate = (page: Page) => page.evaluate(() => (window as any).__aetheriaQueue.state());
const idOfName = async (page: Page, name: string) => { const s = await libraryState(page); return s.libraryIds[s.libraryNames.indexOf(name)]; };

/** Play the library from tone k in the new layout (a Library row's tap), and wait until it plays. */
async function playLibrary(page: Page, k: number): Promise<void> {
  await openLibraryTab(page);
  await libraryRowButton(page, toneName(k)).click();
  await expect.poll(() => heard(page), { message: `${toneName(k)} plays` }).toBe(toneName(k));
  await tab(page, 'now');
}

test.beforeEach(async ({ page }) => {
  if (ON_DEVICE) await page.setViewportSize({ width: 1280, height: 800 });
});

// ---------------------------------------------------------------------------------------------------------------
// PL1. Persistence: every kind of edit survives a reload, record for record; the list is newest change first.
// ---------------------------------------------------------------------------------------------------------------
test('PL1. persistence: create, add 3, rename, move, remove, duplicate; a reload brings back every record as it was', async ({ page }) => {
  const ids = await open(page);
  const ev = await P<string>(page, 'create', 'Evening', []);
  expect(ev, 'a new playlist').toMatch(/^p[a-z0-9]{6,30}$/);
  for (const k of [1, 2, 3]) {
    await page.waitForTimeout(5);
    expect(await P(page, 'add', ev, [ids[k - 1]])).toBe(true);
  }
  await page.waitForTimeout(5);
  expect(await P(page, 'rename', ev, 'Night')).toBe(true);
  await page.waitForTimeout(5);
  expect(await P(page, 'edit', ev, { move: { from: 2, to: 0, key: `${ids[2]}#1` } }), 'tone-03 to the top').toBe(true);
  await page.waitForTimeout(5);
  expect(await P(page, 'edit', ev, { remove: { index: 1, key: `${ids[0]}#1` } }), 'tone-01 removed').toBe(true);
  await page.waitForTimeout(5);
  const copy = await P<string>(page, 'duplicate', ev);
  const before = await pl(page);
  expect(before.lists.map((l) => l.name), 'newest change first').toEqual(['Night copy', 'Night']);
  expect(before.lists.map((l) => l.ids)).toEqual([[ids[2], ids[1]], [ids[2], ids[1]]]);
  expect(before.lists[0].from).toEqual({ kind: 'duplicate', label: 'Night' });
  await expect.poll(async () => (await stored(page)).length, { message: 'both on disk' }).toBe(2);
  const disk = await stored(page);
  await launch(page, 'new');
  const after = await pl(page);
  expect(after.lists, 'the lists come back exactly').toEqual(before.lists);
  expect(await stored(page), 'and the records on disk are byte for byte the same').toEqual(disk);
  expect(after.lists.map((l) => l.id)).toEqual([copy, ev]);
});

// ---------------------------------------------------------------------------------------------------------------
// PL2. A write at the tap survives an immediate reload (5 runs each: an add, a create, a delete).
// ---------------------------------------------------------------------------------------------------------------
test('PL2. an immediate reload keeps the write made at the tap: add, create and delete, 5 runs each', async ({ page }) => {
  test.setTimeout(240_000);
  const ids = await open(page);
  const ev = await P<string>(page, 'create', 'Evening', [ids[0]]);
  await expect.poll(async () => (await storedOf(page, ev))?.entries.length ?? 0).toBe(1);
  const kept = { add: 0, create: 0, remove: 0 };
  for (let run = 0; run < 5; run++) {
    const want = 2 + run;
    await P(page, 'add', ev, [ids[run + 1]]);
    await page.reload();
    await launch(page, 'new');
    if ((await storedOf(page, ev))?.entries.length === want && (await listOf(page, 'Evening')).ids.length === want) kept.add++;
  }
  for (let run = 0; run < 5; run++) {
    const id = await P<string>(page, 'create', `Made ${run}`, [ids[run]]);
    await page.reload();
    await launch(page, 'new');
    if ((await storedOf(page, id)) && (await pl(page)).lists.some((l) => l.id === id)) kept.create++;
  }
  for (let run = 0; run < 5; run++) {
    // A playlist to delete (made here if an earlier phase lost it, so this phase counts its own writes).
    let id = (await pl(page)).lists.find((l) => l.name === `Made ${run}`)?.id;
    if (!id) {
      id = await P<string>(page, 'create', `Made ${run}`, [ids[run]]);
      await expect.poll(async () => !!(await storedOf(page, id!))).toBe(true);
    }
    await P(page, 'remove', id);
    await page.reload();
    await launch(page, 'new');
    if (!(await storedOf(page, id)) && !(await pl(page)).lists.some((l) => l.id === id)) kept.remove++;
  }
  expect(kept, 'every write kept through an immediate reload').toEqual({ add: 5, create: 5, remove: 5 });
});

// ---------------------------------------------------------------------------------------------------------------
// PL3. A write that finds no connection waits, and a hide's drain writes it.
// ---------------------------------------------------------------------------------------------------------------
test('PL3. a write that waits (its connection closed, the reopen failed) lands at the next hide', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__failNextOpen = false;
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, ...a: any[]) {
      if (w.__failNextOpen) {
        w.__failNextOpen = false;
        throw new DOMException('the next open fails (test)', 'UnknownError');
      }
      return (open as any).apply(this, a);
    } as any;
  });
  await controllableVisibility(page);
  const ids = await open(page);
  const ev = await P<string>(page, 'create', 'Evening', [ids[0]]);
  await expect.poll(async () => (await storedOf(page, ev))?.entries.length ?? 0).toBe(1);
  // Another page deletes the database: the app's kept connection closes for it (never blocking it).
  const other = await secondTab(page);
  try {
    await other.goto(appUrl('/manifest.json'));
    const outcome = await other.evaluate(() => new Promise<string>((resolve) => {
      const r = indexedDB.deleteDatabase('aetheria-db');
      r.onblocked = () => resolve('blocked');
      r.onsuccess = () => resolve('deleted');
      r.onerror = () => resolve('error');
    }));
    expect(outcome, 'the kept connection never blocks a delete').toBe('deleted');
  } finally {
    await closeSecondTab(other);
  }
  const puts0 = await plPuts(page);
  await page.evaluate(() => { (window as any).__failNextOpen = true; });
  expect(await P(page, 'add', ev, [ids[1]]), 'the add is taken (on screen)').toBe(true);
  await expect(page.getByText(/^Couldn’t save the change to Evening/), 'its reopen failed: the Retry toast').toBeVisible();
  expect(await plPuts(page), 'nothing written yet').toBe(puts0);
  // A hide: the v16.0.1 listeners drain the waiting write through a new connection.
  // The put itself is timed in the page: the hide's own drain writes it at once (a connection opens, then the put);
  // nothing else may stand in for it (a later save's connection would drain it too, seconds later).
  const putAfterHide = await page.evaluate(async (p0) => {
    const w = window as any;
    const t0 = performance.now();
    w.__setHidden(true);
    while (w.__plPuts === p0 && performance.now() - t0 < 3_000) await new Promise((r) => setTimeout(r, 10));
    return w.__plPuts > p0 ? performance.now() - t0 : null;
  }, puts0);
  test.info().annotations.push({ type: 'the put after the hide (ms)', description: String(putAfterHide) });
  expect(putAfterHide, "the hide's drain put it within half a second").not.toBeNull();
  expect(putAfterHide!, "the hide's drain put it within half a second").toBeLessThan(500);
  await expect.poll(async () => (await storedOf(page, ev))?.entries.map((e) => e.id) ?? null, { message: 'the hide wrote it' }).toEqual([ids[0], ids[1]]);
  expect(await plPuts(page), 'one put').toBe(puts0 + 1);
  await page.evaluate(() => (window as any).__setHidden(false));
  // Retry afterwards is harmless: it writes the same record again.
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => plPuts(page)).toBe(puts0 + 2);
  expect((await storedOf(page, ev))?.entries.map((e) => e.id)).toEqual([ids[0], ids[1]]);
});

// ---------------------------------------------------------------------------------------------------------------
// PL4. Clear keeps the playlists (every entry missing); the same files imported again relink them; Clear ticked
// deletes them.
// ---------------------------------------------------------------------------------------------------------------
const files = (ks: number[]) => ks.map((k) => ({ name: `${toneName(k)}.wav`, mimeType: 'audio/wav', buffer: toneWav(secondsOf(k), 300 + k) }));
/** The new layout's import: Library › Import, the files, then the sheet closed. */
async function importNew(page: Page, ks: number[]): Promise<void> {
  if (!(await page.getByTestId('tab-library').isVisible().catch(() => false))) await openLibraryTab(page);
  await page.getByTestId('library-import').click();
  await addFiles(page, files(ks));
  await page.keyboard.press('Escape');
}

test('PL4. Clear (classic, unticked) keeps the playlists, their tracks missing; importing the same files relinks them; ticked, they go', async ({ page }) => {
  const ids = await open(page, {
    n: 5,
    layout: 'classic',
    records: (ids) => [rec('pevening1', 'Evening', [entry(ids[0], 1), entry(ids[1], 2), entry(ids[2], 3)], 2_000), rec('pfocus001', 'Focus', [entry(ids[2], 3), entry(ids[0], 1)], 1_000)],
  });
  expect((await pl(page)).lists.map((l) => l.name)).toEqual(['Evening', 'Focus']);
  const disk0 = await stored(page);
  await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
  await expect(page.getByText('Tap again to delete all 5 tracks and their analysis (your 2 playlists stay)')).toBeVisible();
  await expect(page.getByTestId('clear-also-playlists').getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Confirm deleting all 5 tracks from this device', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library is empty' }).toBe(0);
  await expect.poll(async () => (await cacheCounts(page)).blobs).toBe(0);
  expect(await stored(page), 'both playlists on disk, byte for byte').toEqual(disk0);
  const kept = await pl(page);
  expect(kept.lists.map((l) => [l.name, l.present, l.missing])).toEqual([['Evening', 0, 3], ['Focus', 0, 2]]);
  // Play refuses, and says why.
  await P(page, 'play', 'pevening1');
  await expect(page.getByText('Every track in Evening is missing. Import the files again to bring them back.')).toBeVisible();
  expect((await libraryState(page)).ids, 'nothing started').toEqual([]);
  // The same three files again: relinked, by name and size, in the playlist's order.
  await addFiles(page, files([1, 2, 3]));
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(3);
  const fresh = await libraryState(page);
  expect(fresh.libraryIds.some((id) => ids.includes(id)), 'new ids').toBe(false);
  const relinked = await listOf(page, 'Evening');
  expect([relinked.present, relinked.missing]).toEqual([3, 0]);
  expect(relinked.tracks, 'in order, to the new tracks').toEqual([1, 2, 3].map((k) => fresh.libraryIds[fresh.libraryNames.indexOf(toneName(k))]));
  expect(relinked.ids, 'the record still holds the old ids (nothing rewritten in the background)').toEqual(ids.slice(0, 3));
  // One edit saves the relinked ids.
  expect(await P(page, 'edit', 'pevening1', { move: { from: 0, to: 1, key: `${ids[0]}#1` } })).toBe(true);
  const newId = (k: number) => fresh.libraryIds[fresh.libraryNames.indexOf(toneName(k))];
  await expect.poll(async () => (await storedOf(page, 'pevening1'))?.entries.map((e) => e.id)).toEqual([newId(2), newId(1), newId(3)]);
  // Clear, ticked: the playlists go too.
  await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
  await page.getByTestId('clear-also-playlists').click();
  await expect(page.getByText('Tap again to delete all 3 tracks, their analysis and your 2 playlists')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm deleting all 3 tracks from this device and your 2 playlists', exact: true }).click();
  await expect.poll(async () => (await stored(page)).length, { message: 'no pl: records' }).toBe(0);
  expect((await pl(page)).lists).toEqual([]);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// PL5. Deleting a track that is in two playlists: the Dialog says so; both keep its place; the file again relinks it.
// ---------------------------------------------------------------------------------------------------------------
test('PL5. a track in 2 playlists: the delete Dialog says so; both keep it as missing; the same file again relinks both', async ({ page }) => {
  const ids = await open(page, {
    n: 6,
    records: (ids) => [
      rec('pevening1', 'Evening', [entry(ids[0], 1), entry(ids[1], 2)], 2_000),
      // Focus names tone-02 by an id the library doesn't have: it holds it by its fingerprint.
      rec('pfocus001', 'Focus', [entry('1700000000000-gone00002', 2), entry(ids[2], 3)], 1_000),
      rec('pother001', 'Other', [entry(ids[3], 4)], 500),
    ],
  });
  await openLibraryTab(page);
  await rowMenu(page, toneName(2)).click();
  await page.getByTestId('library-menu-delete').click();
  const body = page.getByRole('alertdialog', { name: 'Delete this track?' }).getByTestId('dialog-body');
  await expect(body).toHaveText(`"tone-02" will be removed from your library, and the copy stored on this device deleted. The original file is not touched. It's in 2 of your playlists, which keep a place for it: import the same file again and it's back there.`);
  await confirmDelete(page);
  await expect.poll(async () => (await libraryState(page)).libraryNames.includes(toneName(2))).toBe(false);
  expect((await pl(page)).lists.map((l) => [l.name, l.present, l.missing])).toEqual([['Evening', 1, 1], ['Focus', 1, 1], ['Other', 1, 0]]);
  expect((await storedOf(page, 'pevening1'))?.entries.map((e) => e.id), 'the deletion writes no playlist').toEqual([ids[0], ids[1]]);
  await importNew(page, [2]);
  await expect.poll(async () => (await libraryState(page)).libraryNames.includes(toneName(2)), { timeout: 30_000 }).toBe(true);
  const id2 = await idOfName(page, toneName(2));
  expect((await pl(page)).lists.map((l) => [l.name, l.present, l.missing])).toEqual([['Evening', 2, 0], ['Focus', 2, 0], ['Other', 1, 0]]);
  expect((await listOf(page, 'Evening')).tracks).toEqual([ids[0], id2]);
  expect((await listOf(page, 'Focus')).tracks).toEqual([id2, ids[2]]);
});

// ---------------------------------------------------------------------------------------------------------------
// PL6. Missing tracks: Play skips them and says so; Remove missing (Undo); every track missing refuses with its reason.
// ---------------------------------------------------------------------------------------------------------------
test('PL6. missing tracks: Play skips them and says so; Remove missing with Undo; a playlist with every track missing refuses', async ({ page }) => {
  const ids = await open(page, {
    n: 6,
    records: (ids) => [
      rec('pevening1', 'Evening', [entry(ids[0], 1), { id: 'gone-1', name: 'tone-99', file: 'tone-99.wav', size: 12345 }, entry(ids[2], 3), entry(ids[3], 4)], 2_000),
      rec('pallgone1', 'Gone', [{ id: 'gone-2', name: 'tone-98', file: 'tone-98.wav', size: 1 }], 1_000),
    ],
  });
  await P(page, 'play', 'pevening1');
  await expect.poll(async () => (await libraryState(page)).names, { message: 'the present tracks, in order' }).toEqual([1, 3, 4].map(toneName));
  await expect(undoToast(page)).toContainText('Playing Evening: 3 tracks (1 missing is skipped).');
  await expect.poll(() => heard(page)).toBe(toneName(1));
  expect(await P(page, 'edit', 'pevening1', { removeMissing: true })).toBe(true);
  await expect(undoToast(page)).toContainText('Removed 1 missing track from Evening.');
  expect((await listOf(page, 'Evening')).ids).toEqual([ids[0], ids[2], ids[3]]);
  await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await listOf(page, 'Evening')).ids).toEqual([ids[0], 'gone-1', ids[2], ids[3]]);
  await expect.poll(async () => (await storedOf(page, 'pevening1'))?.entries.length).toBe(4);
  const order = (await libraryState(page)).ids;
  await P(page, 'play', 'pallgone1');
  await expect(page.getByText('Every track in Gone is missing. Import the files again to bring them back.')).toBeVisible();
  expect((await libraryState(page)).ids, 'what plays is unchanged').toEqual(order);
  await P(page, 'queue', 'pallgone1', 'queue');
  expect((await qstate(page)).waiting, 'nothing queued').toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// PL7. The delete Dialog's sentence: 0, 1, 2 playlists, in the new layout and in classic.
// ---------------------------------------------------------------------------------------------------------------
const BASE = (name: string) => `"${name}" will be removed from your library, and the copy stored on this device deleted. The original file is not touched.`;
const ONE = (pl: string) => ` It's in your playlist "${pl}", which keeps a place for it: import the same file again and it's back there.`;
const TWO = (n: number) => ` It's in ${n} of your playlists, which keep a place for it: import the same file again and it's back there.`;

for (const layout of ['new', 'classic'] as const) {
  test(`PL7. the delete Dialog's words with 0, 1 and 2 playlists (${layout})`, async ({ page }) => {
    await open(page, {
      n: 6,
      layout,
      records: (ids) => [
        // Evening holds tone-02 twice: one playlist, not two.
        rec('pevening1', 'Evening', [entry(ids[1], 2), entry(ids[2], 3), entry(ids[1], 2)], 2_000),
        rec('pfocus001', 'Focus', [entry(ids[2], 3)], 1_000),
      ],
    });
    const ask = async (k: number) => {
      if (layout === 'new') {
        if (!(await page.getByTestId('tab-library').isVisible().catch(() => false))) await openLibraryTab(page);
        await rowMenu(page, toneName(k)).click();
        await page.getByTestId('library-menu-delete').click();
      } else {
        const row = rowOf(page, toneName(k)).first();
        await row.scrollIntoViewIfNeeded();
        await row.getByTitle('Delete song').evaluate((b) => (b as HTMLElement).click());
      }
      const body = page.getByRole('alertdialog', { name: 'Delete this track?' }).getByTestId('dialog-body');
      const text = await body.textContent();
      await page.getByRole('alertdialog', { name: 'Delete this track?' }).getByRole('button', { name: 'Cancel', exact: true }).click();
      return text;
    };
    expect(await ask(5), 'in no playlist: v16.0\'s words, byte for byte').toBe(BASE(toneName(5)));
    expect(await ask(2), 'in one playlist (twice): it is named').toBe(BASE(toneName(2)) + ONE('Evening'));
    expect(await ask(3), 'in two').toBe(BASE(toneName(3)) + TWO(2));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// PL8. Play, a row's start, the queue carried, Shuffle (the switch on, and off again with Undo), Play next, Add to queue.
// ---------------------------------------------------------------------------------------------------------------
test('PL8. Play, Play from a row, the queue carried, Shuffle with its Undo, Play next and Add to queue @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  const ids = await open(page, { n: 12, records: (ids) => [rec('pevening1', 'Evening', [entry(ids[4], 5), entry(ids[1], 2), entry(ids[7], 8)], 2_000)] });
  await playLibrary(page, 1);
  // Play: the present tracks, cursor 0, the Undo toast.
  await P(page, 'play', 'pevening1');
  await expect.poll(async () => { const s = await libraryState(page); return [s.names, s.cursor]; }).toEqual([[5, 2, 8].map(toneName), 0]);
  await expect.poll(() => heard(page)).toBe(toneName(5));
  await expect(undoToast(page)).toContainText('Playing Evening: 3 tracks.');
  // A row's tap starts there.
  await P(page, 'play', 'pevening1', { startAt: 2 });
  await expect.poll(async () => (await libraryState(page)).cursor).toBe(2);
  await expect.poll(() => heard(page)).toBe(toneName(8));
  // With 2 queued, the queue is carried (v16.0's decision 2 A).
  await page.evaluate((ids) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(ids, 'queue')), [ids[9], ids[10]]);
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([10, 11].map(toneName));
  await P(page, 'play', 'pevening1');
  await expect.poll(async () => (await libraryState(page)).names).toEqual([5, 10, 11, 2, 8].map(toneName));
  await expect(undoToast(page)).toContainText('Playing Evening: 3 tracks. Your 2 queued tracks play next.');
  await page.evaluate(() => (window as any).__tap(() => (window as any).__aetheriaQueue.edit({ clear: true })));
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([]);
  // Shuffle: the switch on, a permutation that starts with the started track; Undo turns it back off.
  expect((await libraryState(page)).shuffle).toBe(false);
  await playLibrary(page, 1);
  await P(page, 'play', 'pevening1', { shuffle: true });
  await expect.poll(async () => (await libraryState(page)).shuffle, { message: 'the switch is on' }).toBe(true);
  const sh = await libraryState(page);
  expect([...sh.names].sort()).toEqual([2, 5, 8].map(toneName).sort());
  expect([...sh.shuffled].sort()).toEqual([0, 1, 2]);
  expect([sh.shuffled[0], sh.shufflePos]).toEqual([sh.cursor, 0]);
  await expect(undoToast(page)).toContainText('Shuffling Evening: 3 tracks.');
  await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => { const s = await libraryState(page); return [s.shuffle, s.names.length]; }, { message: 'Undo: the library order back, the switch off' }).toEqual([false, 12]);
  // Play next / Add to queue: the present tracks, in order, with the queue's toasts and Undo.
  await expect.poll(() => heard(page)).toBe(toneName(1));
  await P(page, 'queue', 'pevening1', 'next');
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([5, 2, 8].map(toneName));
  await expect(undoToast(page)).toContainText('Playing next: 3 tracks from Evening.');
  await P(page, 'queue', 'pevening1', 'queue');
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([5, 2, 8, 5, 2, 8].map(toneName));
  await expect(undoToast(page)).toContainText('Added 3 tracks from Evening to your queue.');
  await page.evaluate(() => (window as any).__tap(() => (window as any).__aetheriaQueue.undo()));
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: "the queue's Undo removes them" }).toEqual([5, 2, 8].map(toneName));
});

// ---------------------------------------------------------------------------------------------------------------
// PL9. Data safety: every op, three times, over 30 stored tones: the library, its audio and its metadata unchanged.
// ---------------------------------------------------------------------------------------------------------------
test('PL9. data safety: every playlist op × 3 leaves the library, its audio and its metadata as they were', async ({ page }) => {
  test.setTimeout(240_000);
  await countBlobSaves(page);
  const ids = await open(page, { n: 30 });
  await page.waitForTimeout(4_500); // the launch's own saves (the restore's settle + the 2 s debounce)
  const counts0 = await cacheCounts(page);
  const lib0 = (await libraryState(page)).libraryIds;
  const meta0 = await metaRecords(page);
  const blobRuns0 = await page.evaluate(() => (window as any).__blobSaveRuns as number);
  const editLog: string[] = [];
  for (let round = 0; round < 3; round++) {
    await clearStoreLog(page);
    const a = await P<string>(page, 'create', `Evening ${round}`, [ids[0], ids[1]]);
    await P(page, 'add', a, [ids[2]]);
    await P(page, 'add', a, [ids[2]]); // again: a duplicate
    await P(page, 'rename', a, `Night ${round}`);
    const b = await P<string>(page, 'duplicate', a);
    const s = await listOf(page, `Night ${round}`);
    await P(page, 'edit', a, { move: { from: 0, to: 2, key: `${s.ids[0]}#1` } });
    const s2 = await listOf(page, `Night ${round}`);
    await P(page, 'edit', a, { remove: { index: 0, key: `${s2.ids[0]}#1` } });
    await P(page, 'undo');
    await P(page, 'edit', a, { removeMissing: true });
    await P(page, 'remove', b);
    await P(page, 'undo');
    await P(page, 'remove', b);
    await page.waitForTimeout(2_600); // past the library's 2 s save debounce: an edit that touched it would show
    editLog.push(...(await storeLog(page)));
  }
  expect(editLog.filter((l) => !/^playlist-state\.(put|delete)\(pl:p[a-z0-9]+\)$/.test(l)), 'the edits wrote only pl: records').toEqual([]);
  // Play, shuffle, the queue and the saves: their own play-state saves only ('current' and the metadata, the
  // library's debounced save), never audio, never a delete or a clear.
  const playLog: string[] = [];
  for (let round = 0; round < 3; round++) {
    await clearStoreLog(page);
    const a = (await pl(page)).lists.find((l) => l.name === `Night ${round}`)!.id;
    await P(page, 'play', a);
    await P(page, 'play', a, { shuffle: true });
    await P(page, 'queue', a, 'next');
    await P(page, 'queue', a, 'queue');
    await P(page, 'saveQueue');
    await P(page, 'savePlaying');
    await page.waitForTimeout(2_600);
    playLog.push(...(await storeLog(page)));
  }
  expect(playLog.filter((l) => l.startsWith('blobs.') || /^meta\.(delete|clear)/.test(l) || l.startsWith('playlist-state.clear') || /^playlist-state\.\w+\((?!pl:|current\))/.test(l)), 'no audio, no deletes, only pl: and current').toEqual([]);
  // A pause, so the last play-state save has landed, then the library as it was.
  await page.evaluate(() => (window as any).__el?.pause());
  await page.waitForTimeout(2_600);
  expect(await cacheCounts(page), 'the stored library, counted').toEqual({ ...counts0, playOrder: (await cacheCounts(page)).playOrder });
  expect((await libraryState(page)).libraryIds, 'the library: the same ids, in order').toEqual(lib0);
  expect((await savedState(page))?.originalOrder, 'the saved library').toEqual(lib0);
  expect(await metaRecords(page), 'every metadata record equal').toEqual(meta0);
  expect(await page.evaluate(() => (window as any).__blobSaveRuns as number), 'no audio save ran').toBe(blobRuns0);
});

// ---------------------------------------------------------------------------------------------------------------
// PL10. The load gate: nothing is written before the read lands; a read that fails refuses everything.
// ---------------------------------------------------------------------------------------------------------------
test('PL10a. the load gate: while the read is held, actions are refused and nothing is written; then the list shows', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    const gate = new Promise<void>((resolve) => (w.__releasePlaylists = resolve));
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...a: unknown[]) {
      const request: IDBRequest = (getAll as any).apply(this, a);
      if (this.name !== 'playlist-state') return request;
      w.__playlistsHeld = (w.__playlistsHeld ?? 0) + 1;
      return new Proxy(request, {
        set(t, k, v) {
          if (k === 'onsuccess' && typeof v === 'function') { t.onsuccess = (ev) => { gate.then(() => v.call(t, ev)); }; return true; }
          (t as any)[k] = v;
          return true;
        },
        get(t, k) { const x = (t as any)[k]; return typeof x === 'function' ? x.bind(t) : x; },
      });
    } as any;
  });
  await instrument(page, 'new');
  const ids = await seed(page, { n: 6, records: [] });
  await putRecords(page, [rec('pevening1', 'Evening', [entry(ids[0], 1)], 2_000)]);
  await launch(page, 'new', { playlists: 'any' });
  await expect.poll(() => page.evaluate(() => (window as any).__playlistsHeld ?? 0), { message: 'the read is held' }).toBeGreaterThan(0);
  expect((await pl(page)).status).toBe('loading');
  expect(await P(page, 'create', 'Early', [ids[1]]), 'a write is refused').toBe(null);
  await expect(page.getByText('Your playlists are still loading. Try again in a moment.')).toBeVisible();
  expect(await P(page, 'add', 'pevening1', [ids[1]])).toBe(false);
  expect(await plPuts(page), 'nothing written').toBe(0);
  await page.evaluate(() => (window as any).__releasePlaylists());
  await expect.poll(async () => (await pl(page)).status).toBe('ready');
  expect((await pl(page)).lists.map((l) => [l.name, l.ids])).toEqual([['Evening', [ids[0]]]]);
  expect(await plPuts(page), 'the read wrote nothing').toBe(0);
});

test('PL10b. a read that fails: the error state, every action refused, the stored records unchanged', async ({ page }) => {
  await page.addInitScript(() => {
    const getAll = IDBObjectStore.prototype.getAll;
    (window as any).__failPlRead = true;
    IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...a: unknown[]) {
      if (this.name === 'playlist-state' && (window as any).__failPlRead) throw new DOMException('the read fails (test)', 'UnknownError');
      return (getAll as any).apply(this, a);
    } as any;
  });
  await instrument(page, 'new');
  const ids = await seed(page, { n: 6 });
  const r0 = rec('pevening1', 'Evening', [entry(ids[0], 1)], 2_000);
  await putRecords(page, [r0]);
  await launch(page, 'new', { playlists: 'any' });
  await expect.poll(async () => (await pl(page)).status).toBe('error');
  expect(await P(page, 'create', 'New', [ids[1]])).toBe(null);
  await expect(page.getByText(/^Your saved playlists couldn’t be read/)).toBeVisible();
  expect(await P(page, 'add', 'pevening1', [ids[1]])).toBe(false);
  expect(await P(page, 'remove', 'pevening1')).toBe(false);
  expect(await plPuts(page), 'nothing written').toBe(0);
  await page.evaluate(() => { (window as any).__failPlRead = false; }); // the test's own read
  expect(await stored(page), 'the record on disk as it was').toEqual([r0]);
});

// ---------------------------------------------------------------------------------------------------------------
// PL11. Validation on read: only whole, valid records show; the others are counted and left on disk untouched.
// ---------------------------------------------------------------------------------------------------------------
test('PL11. validation: a bad entry, another version and a bare pl: key are unreadable, counted, and left byte for byte', async ({ page }) => {
  const bad = (ids: string[]) => [
    { ...rec('pbadentry', 'Bad', [entry(ids[0], 1)], 3_000), entries: [entry(ids[0], 1), { id: '', name: 'x', file: 'x.wav', size: 1 }] },
    { ...rec('pversion2', 'Future', [entry(ids[1], 2)], 3_000), v: 2 },
    { key: 'pl:', v: 1, name: 'Bare' },
  ];
  let badRecs: unknown[] = [];
  const ids = await open(page, { n: 6, records: (ids) => { badRecs = bad(ids); return [rec('pgood0001', 'Good', [entry(ids[0], 1)], 2_000), ...badRecs]; } });
  const s = await pl(page);
  expect(s.lists.map((l) => l.name), 'only the good one shows').toEqual(['Good']);
  expect(s.unreadable, 'the other three are counted').toBe(3);
  const before = (await stored(page)).filter((r) => r.id !== 'pgood0001');
  await P(page, 'add', 'pgood0001', [ids[1]]);
  await P(page, 'rename', 'pgood0001', 'Better');
  await expect.poll(async () => (await storedOf(page, 'pgood0001'))?.name).toBe('Better');
  expect((await stored(page)).filter((r) => r.id !== 'pgood0001'), 'the unreadable ones are untouched').toEqual(before);
});

// ---------------------------------------------------------------------------------------------------------------
// PL16. The source line names the playing playlist (derived: it survives a reload); an edit makes it "Play order".
// ---------------------------------------------------------------------------------------------------------------
test('PL16. the source line: "Playlist · Evening · 1 of 3", Up next "Next from Evening", the mini-player; a reload; an edit', async ({ page }) => {
  await open(page, { n: 8, records: (ids) => [rec('pevening1', 'Evening', [entry(ids[4], 5), entry(ids[1], 2), entry(ids[6], 7)], 2_000)] });
  await P(page, 'play', 'pevening1');
  await expect(page.getByTestId('np-source')).toHaveText('Playlist · Evening · 1 of 3');
  await page.getByTestId('np-upnext').click();
  await expect(page.getByTestId('queue-next').first()).toContainText('Next from Evening');
  await page.keyboard.press('Escape');
  await tab(page, 'library');
  await expect(page.getByTestId('mini-player')).toContainText('Evening 1/3');
  // A queued track is not the playlist's: the line still names it after the queue.
  const ids = (await libraryState(page)).libraryIds;
  await page.evaluate((id) => (window as any).__tap(() => (window as any).__aetheriaQueue.add([id], 'next')), ids[7]);
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([toneName(8)]);
  expect((await pl(page)).playing, 'the queue does not hide the playlist').toBe('pevening1');
  await page.evaluate(() => (window as any).__el?.pause());
  await page.waitForTimeout(2_600);
  await launch(page, 'new');
  await expect(page.getByTestId('np-source')).toHaveText('Playlist · Evening · 1 of 3');
  // An edit of the playing playlist: what plays is unchanged (decision 4 A), and the line says "Play order".
  await P(page, 'edit', 'pevening1', { move: { from: 0, to: 2, key: `${ids[4]}#1` } });
  await expect(page.getByTestId('np-source')).toHaveText('Play order · 1 of 3');
});

// ---------------------------------------------------------------------------------------------------------------
// PL18. Undo's rules: only over the record the op left; never after a Clear that deleted the playlists.
// ---------------------------------------------------------------------------------------------------------------
test('PL18. Undo refuses after a later edit, and a delete\'s Undo does nothing after a Clear that deleted the playlists', async ({ page }) => {
  const ids = await open(page, { n: 6, layout: 'classic', records: (ids) => [rec('pevening1', 'Evening', [entry(ids[0], 1)], 2_000), rec('pfocus001', 'Focus', [entry(ids[2], 3)], 1_000)] });
  await P(page, 'add', 'pevening1', [ids[1]]);
  await P(page, 'edit', 'pevening1', { move: { from: 1, to: 0, key: `${ids[1]}#1` } }); // a move: no toast, its own undo
  await P(page, 'undo');
  await expect(page.getByText('Evening changed since, so that can’t be undone.')).toBeVisible();
  expect((await listOf(page, 'Evening')).ids, 'nothing put back').toEqual([ids[1], ids[0]]);
  // A delete, then Clear with the playlists: the delete's Undo brings nothing back.
  await P(page, 'remove', 'pevening1');
  await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
  await page.getByTestId('clear-also-playlists').click();
  await page.getByRole('button', { name: /^Confirm deleting all 6 tracks/ }).click();
  await expect.poll(async () => (await libraryState(page)).libraryIds.length).toBe(0);
  await P(page, 'undo');
  await page.waitForTimeout(300);
  expect((await pl(page)).lists, 'neither the deleted one nor the cleared one comes back').toEqual([]);
  expect(await stored(page)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// PL19. Save as a playlist: the queue, and what's playing (a mix, a walk, a playlist, the library), with their names.
// ---------------------------------------------------------------------------------------------------------------
const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

test('PL19. save as a playlist: Up next, a mix, a walk (repeats kept), a playlist ("… copy"), the library; Open goes to it', async ({ page }) => {
  test.setTimeout(150_000);
  const ids = await open(page, { n: 30, records: (ids) => [rec('pevening1', 'Evening', [entry(ids[2], 3), entry(ids[0], 1)], 2_000)] });
  // The library, playing in its own order.
  await playLibrary(page, 1);
  const lib = await P<string>(page, 'savePlaying');
  expect((await pl(page)).lists.find((l) => l.id === lib)).toMatchObject({ name: `Library · ${today()}`, ids, from: { kind: 'playing', label: 'Library' } });
  await expect(page.getByText(`Saved Library · ${today()}: 30 tracks.`)).toBeVisible();
  // Up next: the waiting tracks, in queue order; what's playing leaves them out, and its Dialog says so.
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), [ids[9], ids[4], ids[6]]);
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([10, 5, 7].map(toneName));
  const src = await P<{ sentence: string; ids: string[] }>(page, 'saveSource', 'playing');
  expect(src.ids, 'the play order\'s own entries only').toEqual(ids);
  expect(src.sentence).toBe('The 30 tracks of Library, in their order. The 3 tracks waiting in Up next are not included.');
  const up = await P<string>(page, 'saveQueue');
  expect((await pl(page)).lists.find((l) => l.id === up)).toMatchObject({ name: `Up next · ${today()}`, ids: [ids[9], ids[4], ids[6]], from: { kind: 'queue' } });
  // Open goes to it (Library › Playlists › it).
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(async () => (await pl(page)).open).toBe(up);
  await page.evaluate(() => (window as any).__tap(() => (window as any).__aetheriaQueue.edit({ clear: true })));
  // A playlist playing: "Evening copy".
  await P(page, 'play', 'pevening1');
  const copy = await P<string>(page, 'savePlaying');
  expect((await pl(page)).lists.find((l) => l.id === copy)).toMatchObject({ name: 'Evening copy', ids: [ids[2], ids[0]], from: { kind: 'duplicate', label: 'Evening' } });
  // A walk: its full name, its repeats kept, in walk order.
  await tab(page, 'now');
  await page.getByTestId('np-walks').click();
  await page.getByTestId('walk-ouroboros').click();
  await expect.poll(async () => (await libraryState(page)).walk).toBe('ouroboros');
  const walkOrder = (await libraryState(page)).ids;
  const walk = await P<string>(page, 'savePlaying');
  const w = (await pl(page)).lists.find((l) => l.id === walk)!;
  expect(w.ids, 'the walk in its order, repeats kept').toEqual(walkOrder);
  expect(new Set(w.ids).size < w.ids.length, 'the Ouroboros walk repeats a track').toBe(true);
  expect(w.from).toEqual({ kind: 'playing', label: w.name });
  expect(w.name).toMatch(/Ouroboros/);
  // A mix: its name.
  await tab(page, 'mixes');
  await page.getByTestId('mix-preset:healing').click();
  await expect.poll(async () => (await libraryState(page)).walk, { message: 'the walk ended' }).toBe(null);
  const mix = await P<string>(page, 'savePlaying');
  expect((await pl(page)).lists.find((l) => l.id === mix)?.name).toBe('Stillness');
});

// ---------------------------------------------------------------------------------------------------------------
// PL20. A write that fails: the change stays on screen, a sticky toast says so, and Retry writes it.
// ---------------------------------------------------------------------------------------------------------------
test('PL20. a failed write: the sticky toast with Retry; Retry (storage working again) writes the record as it is', async ({ page }) => {
  await controlStateSaves(page);
  const ids = await open(page, { n: 6, records: (ids) => [rec('pevening1', 'Evening', [entry(ids[0], 1)], 2_000)] });
  await page.evaluate(() => { (window as any).__failPlaylistSaves = true; });
  expect(await P(page, 'add', 'pevening1', [ids[1]])).toBe(true);
  const toast = page.getByText(/^Couldn’t save the change to Evening\./);
  await expect(toast).toBeVisible();
  expect((await listOf(page, 'Evening')).ids, 'on screen').toEqual([ids[0], ids[1]]);
  expect((await storedOf(page, 'pevening1'))?.entries.map((e) => e.id), 'not on disk').toEqual([ids[0]]);
  await page.waitForTimeout(6_500);
  await expect(toast, 'sticky').toBeVisible();
  await page.evaluate(() => { (window as any).__failPlaylistSaves = false; });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(async () => (await storedOf(page, 'pevening1'))?.entries.map((e) => e.id)).toEqual([ids[0], ids[1]]);
  await expect(toast).toBeHidden();
});

// ===============================================================================================================
// Stage B: the new layout's UI (spec §3.9, §3.14): Library › Playlists, a playlist's view, edit mode, the menus, Add to
// playlist, the name Dialog, Up next's Save, the source line, and the health card's Library tools.
// ===============================================================================================================

/** Library › Playlists (the switch). */
async function openPlaylistsTab(page: Page): Promise<void> {
  if (!(await page.getByTestId('tab-library').isVisible().catch(() => false))) await openLibraryTab(page);
  if (await page.getByTestId('playlist-back').isVisible().catch(() => false)) await page.getByTestId('playlist-back').click();
  await page.getByTestId('library-view-playlists').click();
  await expect(page.getByTestId('playlists').or(page.getByTestId('playlists-empty')).first()).toBeVisible();
}
const plRow = (page: Page, id: string) => page.locator(`[data-testid="playlist-row"][data-playlist-id="${id}"]`);
/** A playlist's view, from the list. */
async function openPlaylistView(page: Page, id: string): Promise<void> {
  await openPlaylistsTab(page);
  await plRow(page, id).getByTestId('playlist-row-open').click();
  await expect(page.getByTestId('playlist-title')).toBeVisible();
}
const trackRow = (page: Page, index: number) => page.locator(`[data-testid="playlist-track"][data-index="${index}"]`);
const trackTitles = (page: Page) => page.locator('[data-testid="playlist-track"] [data-row-title]').allTextContents();
const handle = (page: Page, index: number) => trackRow(page, index).getByTestId('playlist-handle');

test('PL8b. the view: Play, a row\'s tap, Shuffle, Play next and Add to queue, by their buttons; the list\'s ▶ @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  await open(page, { n: 12, long: true, records: (ids) => [rec('pevening1', 'Evening', [entry(ids[4], 5), entry(ids[1], 2), entry(ids[7], 8)], 2_000)] });
  await openPlaylistsTab(page);
  await plRow(page, 'pevening1').getByRole('button', { name: 'Play Evening', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).names).toEqual([5, 2, 8].map(toneName));
  await expect.poll(() => heard(page)).toBe(toneName(5));
  await expect(plRow(page, 'pevening1').getByTestId('playlist-row-open')).toHaveAttribute('aria-current', 'true');
  await plRow(page, 'pevening1').getByTestId('playlist-row-open').click();
  await expect(page.getByTestId('playlist-title')).toHaveText('Evening');
  await expect(page.getByTestId('playlist-facts')).toHaveText(/^3 tracks · \d+ min$/);
  await expect(page.getByTestId('playlist-from')).toHaveText(/^changed /);
  await expect(trackRow(page, 0).locator('button[data-row-index]')).toHaveAttribute('aria-current', 'true');
  // A row's tap plays the playlist from it.
  await trackRow(page, 2).locator('button[data-row-index]').click();
  await expect.poll(async () => (await libraryState(page)).cursor).toBe(2);
  await expect.poll(() => heard(page)).toBe(toneName(8));
  await expect(trackRow(page, 2).locator('[data-row-facts]')).toHaveText(/^Playing · /);
  // Shuffle turns the switch on; its Undo turns it off.
  await page.getByTestId('playlist-shuffle').click();
  await expect.poll(async () => (await libraryState(page)).shuffle).toBe(true);
  await expect(undoToast(page)).toContainText('Shuffling Evening: 3 tracks.');
  await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).shuffle).toBe(false);
  await page.getByTestId('playlist-play').click();
  await expect.poll(async () => (await libraryState(page)).cursor).toBe(0);
  await page.getByTestId('playlist-next').click();
  await expect(undoToast(page)).toContainText('Playing next: 3 tracks from Evening.');
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([5, 2, 8].map(toneName));
  await page.getByTestId('playlist-queue').click();
  await expect(undoToast(page)).toContainText('Added 3 tracks from Evening to your queue.');
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([5, 2, 8, 5, 2, 8].map(toneName));
});

test('PL6b. a playlist\'s view with a missing track: its row and ⋯ (Remove only), Remove missing with Undo; every track missing: the buttons off with the reason', async ({ page }) => {
  await open(page, {
    n: 6,
    records: (ids) => [
      rec('pevening1', 'Evening', [entry(ids[0], 1), { id: 'gone-1', name: 'tone-99', file: 'tone-99.wav', size: 12345 }, entry(ids[2], 3)], 2_000),
      rec('pallgone1', 'Gone', [{ id: 'gone-2', name: 'tone-98', file: 'tone-98.wav', size: 1 }], 1_000),
    ],
  });
  await openPlaylistsTab(page);
  await expect(plRow(page, 'pevening1').locator('[data-row-facts]')).toHaveText(/^3 tracks · .* · 1 missing$/);
  await openPlaylistView(page, 'pevening1');
  await expect(page.getByTestId('playlist-facts')).toHaveText(/^3 tracks · .* · 1 missing$/);
  const missing = trackRow(page, 1);
  await expect(missing.locator('[data-row-facts]')).toHaveText('Not in your library · import tone-99.wav again');
  await expect(missing.locator('button[aria-current]'), 'a missing row is not a play button').toHaveCount(0);
  await missing.getByRole('button', { name: 'Options for tone-99, not in your library' }).click();
  const menu = page.getByTestId('playlist-row-menu-body');
  await expect(menu.getByRole('button')).toHaveText(['Remove from EveningOnly from this playlist; your library keeps it', 'Cancel']);
  await page.keyboard.press('Escape');
  await page.getByTestId('playlist-edit').click();
  await expect(page.getByTestId('playlist-title')).toHaveText('Editing Evening');
  await page.getByTestId('playlist-remove-missing').click();
  await expect(undoToast(page)).toContainText('Removed 1 missing track from Evening.');
  await expect.poll(() => trackTitles(page)).toEqual([toneName(1), toneName(3)]);
  await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => trackTitles(page)).toEqual([toneName(1), 'tone-99', toneName(3)]);
  await page.getByTestId('playlist-done').click();
  await page.getByTestId('playlist-back').click();
  await openPlaylistView(page, 'pallgone1');
  for (const b of ['playlist-play', 'playlist-shuffle', 'playlist-next', 'playlist-queue']) await expect(page.getByTestId(b)).toBeDisabled();
  await expect(page.getByTestId('playlist-none-reason')).toHaveText('Every track is missing: import the files again to play it.');
});

test('PL1b. by the UI: New playlist (its view opens), Add to playlist from a row, New playlist… inline, Rename…, Duplicate, Delete with Undo', async ({ page }) => {
  const ids = await open(page, { n: 8 });
  await openPlaylistsTab(page);
  await expect(page.getByTestId('playlists-empty')).toContainText('No playlists yet');
  await page.getByTestId('playlists-new').click();
  const dialog = page.getByRole('dialog', { name: 'New playlist' });
  await expect(dialog.getByLabel('Name')).toHaveValue('New playlist');
  await expect(dialog.getByLabel('Name')).toBeFocused();
  await dialog.getByLabel('Name').fill('Evening');
  await dialog.getByLabel('Name').press('Enter');
  await expect(page.getByTestId('playlist-title'), 'the new playlist\'s view opens').toHaveText('Evening');
  await expect(page.getByTestId('playlist-empty')).toContainText('No tracks yet');
  await page.getByTestId('playlist-go-tracks').click();
  // Add to playlist from a Library row's ⋯.
  await rowMenu(page, toneName(3)).click();
  await page.getByTestId('library-menu-playlist').click();
  const sheet = page.getByRole('dialog', { name: 'Add to playlist' });
  await expect(sheet).toContainText(toneName(3));
  await sheet.getByTestId('playlist-add-row').filter({ hasText: 'Evening' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(undoToast(page)).toContainText(`Added ${toneName(3)} to Evening.`);
  await rowMenu(page, toneName(3)).click();
  await page.getByTestId('library-menu-playlist').click();
  await expect(sheet.getByTestId('playlist-add-row').filter({ hasText: 'Evening' })).toContainText('1 track · Has this track');
  // New playlist… inline: Create and add.
  await sheet.getByTestId('playlist-add-new').click();
  await expect(sheet.getByLabel('New playlist’s name')).toHaveValue('New playlist');
  await sheet.getByLabel('New playlist’s name').fill('Focus');
  await sheet.getByTestId('playlist-add-create').click();
  await expect(undoToast(page)).toContainText(`Made Focus with ${toneName(3)}.`);
  await expect.poll(async () => (await pl(page)).lists.map((l) => [l.name, l.ids])).toEqual([['Focus', [ids[2]]], ['Evening', [ids[2]]]]);
  // Rename…, Duplicate, Delete (with Undo) from a row's ⋯.
  await openPlaylistsTab(page);
  const evId = (await listOf(page, 'Evening')).id;
  await plRow(page, evId).getByTestId('playlist-row-menu').click();
  await page.getByTestId('playlist-menu-rename').click();
  const rename = page.getByRole('dialog', { name: 'Rename playlist' });
  await rename.getByLabel('Name').fill('Night');
  await rename.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(plRow(page, evId).locator('[data-row-title]')).toHaveText('Night');
  await plRow(page, evId).getByTestId('playlist-row-menu').click();
  await page.getByTestId('playlist-menu-duplicate').click();
  await expect(undoToast(page)).toContainText('Duplicated Night as Night copy.');
  await expect(page.getByTestId('playlist-row')).toHaveCount(3);
  await plRow(page, evId).getByTestId('playlist-row-menu').click();
  await page.getByTestId('playlist-menu-delete').click();
  await expect(undoToast(page)).toContainText('Deleted Night (1 track). Your music is not touched.');
  await expect(plRow(page, evId)).toHaveCount(0);
  await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(plRow(page, evId)).toHaveCount(1);
  await expect.poll(async () => (await storedOf(page, evId))?.name).toBe('Night');
});

test('PL12. renders and cost: nothing renders on the clock; a 1,000-entry playlist opens in one App commit with ≤ 30 rows; a drop is one commit', async ({ page }) => {
  test.setTimeout(240_000);
  const ids = await open(page, {
    n: 30,
    long: true,
    records: (ids) => [
      rec('pevening1', 'Evening', [1, 2, 3, 4, 5, 6].map((k) => entry(ids[k - 1], k)), 3_000),
      rec('plong0001', 'Long', Array.from({ length: 1000 }, (_, i) => entry(ids[i % 30], (i % 30) + 1)), 2_000),
    ],
  });
  await openPlaylistsTab(page);
  await plRow(page, 'pevening1').getByRole('button', { name: 'Play Evening', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
  await page.waitForTimeout(1_500);
  await page.evaluate(() => { (window as any).__aetheriaRenders = {}; });
  await page.waitForTimeout(3_000);
  let r = await page.evaluate(() => ({ ...((window as any).__aetheriaRenders ?? {}) }));
  test.info().annotations.push({ type: 'renders on the list, 3 s', description: JSON.stringify(r) });
  for (const v of ['PlaylistsView', 'PlaylistRow', 'LibrarySegment', 'LibraryTabFrame']) expect.soft(r[v] ?? 0, `${v} renders on the clock`).toBe(0);
  expect(r.MiniProgress ?? 0, 'the clock ran').toBeGreaterThanOrEqual(8);
  await plRow(page, 'pevening1').getByTestId('playlist-row-open').click();
  await page.waitForTimeout(1_000);
  await page.evaluate(() => { (window as any).__aetheriaRenders = {}; });
  await page.waitForTimeout(3_000);
  r = await page.evaluate(() => ({ ...((window as any).__aetheriaRenders ?? {}) }));
  test.info().annotations.push({ type: 'renders on a playlist\'s view, 3 s', description: JSON.stringify(r) });
  for (const v of ['PlaylistDetail', 'PlaylistTrackList', 'PlaylistTrackRow']) expect.soft(r[v] ?? 0, `${v} renders on the clock`).toBe(0);
  // The 1,000-entry playlist, paused (no clock): opened from the list.
  await page.getByTestId('playlist-back').click();
  await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
  const opening = await page.evaluate(async () => {
    for (let calm = 0; calm < 4; ) {
      (window as any).__aetheriaRenders = {};
      await new Promise((r) => setTimeout(r, 500));
      calm = ((window as any).__aetheriaRenders?.App ?? 0) === 0 ? calm + 1 : 0;
    }
    (window as any).__aetheriaRenders = {};
    const b = document.querySelector<HTMLElement>('[data-playlist-id="plong0001"] [data-testid="playlist-row-open"]')!;
    const t0 = performance.now();
    b.click();
    await new Promise<void>((r) => queueMicrotask(r));
    await Promise.resolve();
    const t1 = performance.now();
    await new Promise((r) => setTimeout(r, 300));
    return { ms: t1 - t0, renders: { ...((window as any).__aetheriaRenders ?? {}) }, mounted: document.querySelectorAll('[data-testid="playlist-track"]').length };
  });
  test.info().annotations.push({ type: 'opening the 1,000-entry playlist', description: JSON.stringify(opening) });
  expect(opening.renders.App ?? 0, 'one App commit (StrictMode renders it twice)').toBeLessThanOrEqual(2);
  expect(opening.mounted, 'virtualized: at most 30 rows mounted').toBeLessThanOrEqual(30);
  expect(opening.mounted).toBeGreaterThan(5);
  // The wall clock (v16.1 review, measured on the desktop under a shared machine's load): opening took 15.6-33.9 ms over
  // 10 runs; with the list not virtualized (1,000 rows) 345-352 ms. 150 ms is 4.4x the slowest normal run and well under
  // the unvirtualized one. An O(n^2) resolve at 1,000 entries (24-30 ms) is within the noise: no clock catches it. On a
  // phone the time is only recorded (the annotation above); the render counts and the mounted rows hold there too.
  if (!ON_DEVICE) expect(opening.ms, 'opening\'s script, its render included (≤ 150 ms)').toBeLessThanOrEqual(150);
  await expect(page.getByTestId('playlist-facts')).toHaveText(/^1,000 tracks/);
  // A drop in edit mode: the third row to the top, timed from the pointer's release.
  await page.getByTestId('playlist-edit').click();
  await expect(handle(page, 2)).toBeVisible();
  const puts0 = await plPuts(page);
  const drop = await page.evaluate(async () => {
    for (let calm = 0; calm < 4; ) {
      (window as any).__aetheriaRenders = {};
      await new Promise((r) => setTimeout(r, 500));
      calm = ((window as any).__aetheriaRenders?.App ?? 0) === 0 ? calm + 1 : 0;
    }
    const h = (i: number) => document.querySelector<HTMLElement>(`[data-testid="playlist-track"][data-index="${i}"] [data-testid="playlist-handle"]`)!;
    const third = h(2);
    const r3 = third.getBoundingClientRect();
    const r1 = h(0).getBoundingClientRect();
    const x = r3.left + r3.width / 2;
    const at = (type: string, y: number) => third.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
    const y0 = r3.top + r3.height / 2;
    at('pointerdown', y0);
    await new Promise((r) => setTimeout(r, 200));
    at('pointermove', y0 - 20);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    at('pointermove', r1.top + r1.height / 2 - 4);
    await new Promise((r) => setTimeout(r, 100));
    (window as any).__aetheriaRenders = {};
    const t0 = performance.now();
    at('pointerup', r1.top + r1.height / 2 - 4);
    await new Promise<void>((r) => queueMicrotask(r));
    await Promise.resolve();
    const t1 = performance.now();
    await new Promise((r) => setTimeout(r, 300));
    return { ms: t1 - t0, renders: { ...((window as any).__aetheriaRenders ?? {}) } };
  });
  test.info().annotations.push({ type: 'a drop at 1,000', description: JSON.stringify(drop) });
  await expect.poll(async () => (await listOf(page, 'Long')).ids.slice(0, 3)).toEqual([ids[2], ids[0], ids[1]]);
  expect(drop.renders.App ?? 0, 'one App commit for the drop').toBeLessThanOrEqual(2);
  // The drop's wall clock is recorded only (the annotation above): measured 11.3-20.3 ms over 10 normal runs, and
  // 70.5-94.4 ms with the list not virtualized, too close to 3x the slowest normal run (61 ms) for a bound that load can't
  // trip; the one App commit and the one put are the drop's hard checks.
  await expect.poll(() => plPuts(page), { message: 'one put for the drop' }).toBe(puts0 + 1);
});

/** A pointer drag of row `index`'s handle (synthetic pointer events, as the queue sheet's tests make them): pressed,
 *  moved in `steps` frames to `toY` (client px), held `pauseMs`, released. */
async function dragHandle(page: Page, index: number, toY: number, type: 'mouse' | 'touch', o: { steps?: number; pauseMs?: number } = {}): Promise<void> {
  await page.evaluate(async ({ index, toY, type, steps, pauseMs }) => {
    const h = document.querySelector<HTMLElement>(`[data-testid="playlist-track"][data-index="${index}"] [data-testid="playlist-handle"]`)!;
    const r = h.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y0 = r.top + r.height / 2;
    const at = (t: string, y: number) => h.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 11, pointerType: type, isPrimary: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
    at('pointerdown', y0);
    await new Promise((res) => setTimeout(res, 200));
    for (let i = 1; i <= steps; i++) {
      at('pointermove', y0 + ((toY - y0) * i) / steps);
      await new Promise((res) => requestAnimationFrame(() => res(null)));
    }
    await new Promise((res) => setTimeout(res, pauseMs));
    at('pointerup', toY);
  }, { index, toY, type, steps: o.steps ?? 6, pauseMs: o.pauseMs ?? 100 });
}
const handleCentre = async (page: Page, index: number) => { const b = (await handle(page, index).boundingBox())!; return b.y + b.height / 2; };

test('PL13. edit mode: a drag, the keyboard (Space ↑ ↑ Space, Alt+↓, Escape mid-lift), the announcements, one put per drop; an edge auto-scroll in 200 @mobile', async ({ page }, info) => {
  test.setTimeout(180_000);
  const touch = info.project.name === 'mobile-ua';
  const ids = await open(page, {
    n: 30,
    records: (ids) => [
      rec('pevening1', 'Evening', [1, 2, 3, 4, 5, 6, 7, 8].map((k) => entry(ids[k - 1], k)), 3_000),
      rec('plong0001', 'Long', Array.from({ length: 200 }, (_, i) => entry(ids[i % 30], (i % 30) + 1)), 2_000),
    ],
  });
  await openPlaylistView(page, 'pevening1');
  await page.getByTestId('playlist-edit').click();
  await expect(handle(page, 4)).toHaveAttribute('aria-label', `Reorder ${toneName(5)}, 5 of 8`);
  await expect(handle(page, 4)).toHaveAttribute('aria-roledescription', 'drag handle');
  // A drag: the 5th row to the 2nd place.
  let puts = await plPuts(page);
  await dragHandle(page, 4, (await handleCentre(page, 1)) - 4, touch ? 'touch' : 'mouse');
  await expect.poll(() => trackTitles(page)).toEqual([1, 5, 2, 3, 4, 6, 7, 8].map(toneName));
  await expect.poll(() => plPuts(page), { message: 'one put for the drop' }).toBe(puts + 1);
  // The keyboard: Space, ↑, ↑, Space on the 4th row's handle (tone-03): to the 2nd place; the announcements.
  puts = await plPuts(page);
  await handle(page, 3).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('playlist-live')).toHaveText(`Moving ${toneName(3)}, position 4 of 8`);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('playlist-live')).toHaveText(`Moving ${toneName(3)}, position 2 of 8`);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('playlist-live')).toHaveText('Dropped at position 2');
  await expect.poll(() => trackTitles(page)).toEqual([1, 3, 5, 2, 4, 6, 7, 8].map(toneName));
  await expect(handle(page, 1), 'the focus stays on the moved track').toBeFocused();
  await expect.poll(() => plPuts(page)).toBe(puts + 1);
  // Alt+↓ moves it at once.
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => trackTitles(page)).toEqual([1, 5, 3, 2, 4, 6, 7, 8].map(toneName));
  await expect.poll(() => plPuts(page)).toBe(puts + 2);
  // Escape mid-lift puts it back, writes nothing, and keeps edit mode.
  await expect(handle(page, 2)).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('playlist-live')).toHaveText(`${toneName(3)} back at position 3`);
  await expect(page.getByTestId('playlist-title')).toHaveText('Editing Evening');
  await page.waitForTimeout(300);
  expect(await plPuts(page), 'nothing written for a cancel').toBe(puts + 2);
  expect(await trackTitles(page)).toEqual([1, 5, 3, 2, 4, 6, 7, 8].map(toneName));
  // Escape again leaves edit mode.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('playlist-title')).toHaveText('Evening');
  // An edge auto-scroll in a 200-entry playlist: the 2nd row held at the scroller's bottom edge.
  await page.getByTestId('playlist-back').click();
  await openPlaylistView(page, 'plong0001');
  await page.getByTestId('playlist-edit').click();
  const scroller = page.getByTestId('playlist-scroll');
  const box = (await scroller.boundingBox())!;
  puts = await plPuts(page);
  await dragHandle(page, 1, box.y + box.height - 10, touch ? 'touch' : 'mouse', { steps: 10, pauseMs: 1_500 });
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop), { message: 'the list scrolled under the drag' }).toBeGreaterThan(200);
  await expect.poll(async () => (await listOf(page, 'Long')).ids.indexOf(ids[1]), { message: 'tone-02 moved far down' }).toBeGreaterThan(8);
  await expect.poll(() => plPuts(page)).toBe(puts + 1);
});

test('PL14. accessibility: the tablist, list semantics, names, ≥ 44 × 44 targets (the handle 44 × 60), focus to the name and back, the Dialog', async ({ page }) => {
  await open(page, { n: 8, records: (ids) => [rec('pevening1', 'Evening', [1, 2, 3].map((k) => entry(ids[k - 1], k)), 2_000), rec('pfocus001', 'Focus', [entry(ids[3], 4)], 1_000)] });
  await openLibraryTab(page);
  const tabs = page.getByRole('tablist', { name: 'Library view' });
  await expect(tabs.getByRole('tab')).toHaveText(['Tracks8', 'Playlists2']);
  await expect(tabs.getByRole('tab', { name: /^Tracks/ })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: /^Tracks/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /^Playlists/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: /^Playlists/ })).toBeFocused();
  const list = page.getByRole('list', { name: 'Your playlists' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  for (const name of ['Play Evening', 'Options for Evening', 'New playlist']) {
    const b = (await page.getByRole('button', { name, exact: true }).first().boundingBox())!;
    expect(b.width >= 44 && b.height >= 44, `${name} is ≥ 44 × 44 (${b.width} × ${b.height})`).toBe(true);
  }
  for (const t of await page.getByRole('tab').all()) {
    const b = (await t.boundingBox())!;
    expect(b.height, 'a tab is 44 px tall').toBeGreaterThanOrEqual(44);
  }
  await plRow(page, 'pevening1').getByTestId('playlist-row-open').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Evening' }), 'the name takes the focus').toBeFocused();
  await expect(page.getByRole('list', { name: 'Tracks in this playlist' }).getByRole('listitem')).toHaveCount(3);
  for (const name of ['Back to your playlists', 'Options for Evening', `Options for ${toneName(1)}`]) {
    const b = (await page.getByRole('button', { name, exact: true }).first().boundingBox())!;
    expect(b.width >= 44 && b.height >= 44, `${name} is ≥ 44 × 44`).toBe(true);
  }
  await page.getByTestId('playlist-edit').click();
  const hb = (await handle(page, 0).boundingBox())!;
  expect([Math.round(hb.width), Math.round(hb.height)], 'the handle is 44 × 60').toEqual([44, 60]);
  await page.getByTestId('playlist-done').click();
  await page.getByRole('button', { name: 'Back to your playlists', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Your playlists' })).toBeVisible();
  // The name Dialog: labelled, Save off while the name is empty, Enter saves.
  await page.getByTestId('playlists-new').click();
  const d = page.getByRole('dialog', { name: 'New playlist' });
  await d.getByLabel('Name').fill('   ');
  await expect(d.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await d.getByLabel('Name').fill('Morning');
  await d.getByLabel('Name').press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Morning' })).toBeFocused();
});

test('PL15. crash drills: the list, a playlist\'s view, the Add sheet: the music plays on, and Reload panel brings each back', async ({ page }) => {
  await open(page, { n: 8, long: true, records: (ids) => [rec('pevening1', 'Evening', [1, 2, 3].map((k) => entry(ids[k - 1], k)), 2_000)] });
  await openPlaylistsTab(page);
  await plRow(page, 'pevening1').getByRole('button', { name: 'Play Evening', exact: true }).click();
  await expect.poll(() => heard(page)).toBe(toneName(1));
  const playingOn = () => expect.poll(() => page.evaluate(() => { const e = (window as any).__el; return !!e && !e.paused; }), { message: 'the music plays on' }).toBe(true);
  await crash(page, 'playlists');
  await expect(page.getByTestId('playlists-fallback')).toBeVisible();
  await playingOn();
  await page.getByTestId('playlists-fallback').getByRole('button', { name: 'Reload panel', exact: true }).click();
  await expect(plRow(page, 'pevening1')).toBeVisible();
  await plRow(page, 'pevening1').getByTestId('playlist-row-open').click();
  await crash(page, 'playlist-detail');
  await expect(page.getByTestId('playlist-detail-fallback')).toBeVisible();
  await playingOn();
  await page.getByTestId('playlist-detail-fallback').getByRole('button', { name: 'Reload panel', exact: true }).click();
  await expect(page.getByTestId('playlist-title')).toHaveText('Evening');
  await trackRow(page, 1).getByRole('button', { name: `Options for ${toneName(2)}`, exact: true }).click();
  await page.getByTestId('playlist-row-menu-playlist').click();
  await expect(page.getByRole('dialog', { name: 'Add to playlist' })).toBeVisible();
  await crash(page, 'playlist-add');
  await expect(page.getByRole('dialog', { name: 'Add to playlist' }).getByRole('alert')).toBeVisible();
  await playingOn();
  expect(await heard(page)).toBe(toneName(1));
});

for (const persisted of [false, true]) {
  test(`PL17. the storage note, navigator.storage.persisted() ${persisted}`, async ({ page }) => {
    await page.addInitScript((p) => {
      (navigator.storage as any).persisted = async () => p;
    }, persisted);
    await open(page, { n: 4 });
    await openPlaylistsTab(page);
    if (persisted) {
      await page.waitForTimeout(500);
      await expect(page.getByTestId('playlists-storage-note')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('playlists-storage-note')).toHaveText(/^Your music and playlists are kept in this browser\./);
    }
  });
}

test('PL19b. by the UI: Up next\'s Save as playlist (the Dialog\'s sentence and name, Enter, Open); Now Playing\'s ⋯ during a mix: Save, and Add to playlist', async ({ page }) => {
  const ids = await open(page, { n: 30, long: true });
  await playLibrary(page, 1);
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), [ids[9], ids[4], ids[6]]);
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([10, 5, 7].map(toneName));
  await page.getByTestId('np-upnext').click();
  await page.getByTestId('queue-save').click();
  const d = page.getByRole('dialog', { name: 'Save as a playlist' });
  await expect(d.getByTestId('playlist-name-sentence')).toHaveText('The 3 tracks waiting in Up next, in their order.');
  await expect(d.getByLabel('Name')).toHaveValue(`Up next · ${today()}`);
  await d.getByLabel('Name').press('Enter');
  await expect(page.getByText(`Saved Up next · ${today()}: 3 tracks.`)).toBeVisible();
  await page.getByTestId('notices').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByTestId('playlist-title')).toHaveText(`Up next · ${today()}`);
  expect(await trackTitles(page)).toEqual([10, 5, 7].map(toneName));
  await page.evaluate(() => (window as any).__tap(() => (window as any).__aetheriaQueue.edit({ clear: true })));
  // A mix playing: Now Playing's ⋯ › Save as a playlist… (its name), and Add to playlist… (the playing track).
  await tab(page, 'mixes');
  await page.getByTestId('mix-preset:healing').click();
  await expect.poll(async () => (await libraryState(page)).ids.length).toBeLessThan(30);
  await tab(page, 'now');
  await page.getByTestId('np-menu-button').click();
  await expect(page.getByTestId('menu-save-playlist')).toContainText(/What’s playing: Stillness, \d+ tracks?/);
  await page.getByTestId('menu-save-playlist').click();
  const s = page.getByRole('dialog', { name: 'Save as a playlist' });
  await expect(s.getByLabel('Name')).toHaveValue('Stillness');
  await s.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await pl(page)).lists.map((l) => l.name)).toContain('Stillness');
  const title = (await libraryState(page)).current!;
  await page.getByTestId('np-menu-button').click();
  await page.getByTestId('menu-add-to-playlist').click();
  const sheet = page.getByRole('dialog', { name: 'Add to playlist' });
  await expect(sheet).toContainText(title);
  await sheet.getByTestId('playlist-add-row').filter({ hasText: 'Stillness' }).click();
  await expect(undoToast(page)).toContainText(`Added ${title} to Stillness again: it’s in it twice now.`);
});

// ---------------------------------------------------------------------------------------------------------------
// LT1-LT3: the health card's Library tools (spec §3.14).
// ---------------------------------------------------------------------------------------------------------------
async function openTools(page: Page): Promise<void> {
  if (!(await page.getByTestId('tab-library').isVisible().catch(() => false))) await openLibraryTab(page);
  if ((await page.getByTestId('library-view-tracks').getAttribute('aria-selected')) !== 'true') await page.getByTestId('library-view-tracks').click();
  const toggle = page.getByTestId('library-health-toggle');
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await expect(page.getByTestId('library-tools')).toBeVisible();
}

test('LT1. Diagnostics in the new layout: classic\'s readout; Close returns the focus to the button', async ({ page }) => {
  await open(page, { n: 6 });
  await openTools(page);
  await expect(page.getByTestId('library-health')).toContainText('The classic library view is one tap away.');
  await page.getByTestId('library-tools-diagnostics').click();
  const readout = page.getByRole('dialog', { name: 'Library diagnostics' });
  await expect(readout).toContainText('PLAYLIST DIAGNOSTICS');
  await expect(readout).toContainText('Total tracks: 6');
  await readout.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('library-tools-diagnostics')).toBeFocused();
});

test('LT2. the new Clear, unticked: its words, the 600 ms guard, Cancel keeps everything, Delete keeps the playlists byte for byte', async ({ page }) => {
  await open(page, { n: 30, records: (ids) => [rec('pevening1', 'Evening', [entry(ids[0], 1), entry(ids[1], 2)], 2_000), rec('pfocus001', 'Focus', [entry(ids[2], 3)], 1_000)] });
  await page.waitForTimeout(4_500);
  await playLibrary(page, 3); // a play order (its Undo) from before the Clear
  await page.waitForTimeout(2_600);
  const counts0 = await cacheCounts(page);
  const disk0 = await stored(page);
  await openTools(page);
  await page.getByTestId('library-tools-clear').click();
  const d = page.getByRole('alertdialog', { name: 'Clear your library?' });
  await expect(d).toContainText("The stored copies of all 30 tracks, and their analysis, will be deleted from this device. The original files are not touched. This can't be undone.");
  await expect(d.getByRole('checkbox', { name: 'Also delete my 2 playlists' })).not.toBeChecked();
  await expect(d.getByTestId('clear-library-line')).toHaveText('Your 2 playlists stay. Their tracks show as missing until you import the same files again.');
  await expect(d.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel takes the first focus').toBeFocused();
  // A tap within 600 ms of opening does nothing.
  await d.getByTestId('clear-library-confirm').click();
  await expect(d).toBeVisible();
  expect((await libraryState(page)).libraryIds.length).toBe(30);
  await d.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(d).toHaveCount(0);
  expect(await cacheCounts(page)).toEqual(counts0);
  expect(await stored(page)).toEqual(disk0);
  await page.getByTestId('library-tools-clear').click();
  await expect(d.getByTestId('clear-library-confirm')).toHaveText('Delete 30 tracks');
  await page.waitForTimeout(700);
  await d.getByTestId('clear-library-confirm').click();
  await expect.poll(async () => (await libraryState(page)).libraryIds.length).toBe(0);
  await expect.poll(async () => { const c = await cacheCounts(page); return [c.blobs, c.meta, c.library]; }).toEqual([0, 0, 0]);
  expect(await savedState(page), 'the play state gone').toBe(null);
  expect(await stored(page), 'both playlists byte for byte').toEqual(disk0);
  await expect(page.getByText('Cleared your library: 30 tracks. Your 2 playlists stay.')).toBeVisible();
  await expect(page.getByTestId('library-empty')).toBeVisible();
  // The play order's Undo from before the Clear does nothing.
  await page.evaluate(() => (window as any).__aetheriaLibrary.undo());
  await page.waitForTimeout(300);
  expect((await libraryState(page)).ids).toEqual([]);
});

test('LT3. the new Clear, ticked: the playlists go too, and the box is unticked when it opens again; with none, no box @mobile', async ({ page }, info) => {
  const byFinger = info.project.name === 'mobile-ua';
  const tapOn = async (l: ReturnType<Page['getByTestId']>) => {
    if (!byFinger) return l.click();
    const b = (await l.boundingBox())!;
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement;
      for (const t of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerType: 'touch', clientX: x, clientY: y }));
      el.click();
    }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  };
  await open(page, { n: 6, records: (ids) => [rec('pevening1', 'Evening', [entry(ids[0], 1)], 2_000), rec('pfocus001', 'Focus', [entry(ids[2], 3)], 1_000)] });
  await openTools(page);
  await tapOn(page.getByTestId('library-tools-clear'));
  const d = page.getByRole('alertdialog', { name: 'Clear your library?' });
  await tapOn(d.getByTestId('clear-library-also'));
  await expect(d.getByRole('checkbox', { name: 'Also delete my 2 playlists' })).toBeChecked();
  await expect(d.getByTestId('clear-library-line')).toHaveText('Your 2 playlists will be deleted too.');
  await expect(d.getByTestId('clear-library-confirm')).toHaveText('Delete 6 tracks and 2 playlists');
  // Closed and opened again: unticked.
  await tapOn(d.getByRole('button', { name: 'Cancel', exact: true }));
  await expect(d).toHaveCount(0);
  await tapOn(page.getByTestId('library-tools-clear'));
  await expect(d.getByRole('checkbox', { name: 'Also delete my 2 playlists' })).not.toBeChecked();
  await tapOn(d.getByTestId('clear-library-also'));
  await expect(d.getByRole('checkbox', { name: 'Also delete my 2 playlists' })).toBeChecked();
  await page.waitForTimeout(700);
  await tapOn(d.getByTestId('clear-library-confirm'));
  await expect.poll(async () => (await stored(page)).length, { message: 'no pl: keys' }).toBe(0);
  await expect(page.getByText('Cleared your library: 6 tracks, and your 2 playlists.')).toBeVisible();
  await page.getByTestId('library-view-playlists').click();
  await expect(page.getByTestId('playlists-empty')).toBeVisible();
  // With no playlists: no box, the button "Delete N tracks".
  await page.getByTestId('library-view-tracks').click();
  await importNew(page, [1, 2]);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(2);
  await openTools(page);
  await tapOn(page.getByTestId('library-tools-clear'));
  await expect(d.getByRole('checkbox')).toHaveCount(0);
  await expect(d.getByTestId('clear-library-confirm')).toHaveText('Delete 2 tracks');
  await tapOn(d.getByRole('button', { name: 'Cancel', exact: true }));
});

test('PL13b. the Up next sheet keeps v16.0\'s drag geometry (useSortable\'s defaults): the lifted row moves by the rows\' measured height, the placeholder holds the target row\'s slot', async ({ page }) => {
  const ids = await open(page, { n: 12, long: true });
  await playLibrary(page, 1);
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), [ids[4], ids[5], ids[6]]);
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([5, 6, 7].map(toneName));
  await page.getByTestId('np-upnext').click();
  const qh = (i: number) => page.getByTestId('queue-handle').nth(i);
  await expect(qh(2)).toBeVisible();
  const rows = page.getByTestId('queue-row');
  const h = await rows.nth(0).evaluate((el) => el.getBoundingClientRect().height);
  const slot1 = await rows.nth(1).evaluate((el) => (el as HTMLElement).offsetTop);
  await qh(2).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('queue-placeholder')).toHaveCount(1);
  const placeholderTop = await page.getByTestId('queue-placeholder').evaluate((el) => parseFloat((el as HTMLElement).style.top));
  const lifted = await rows.nth(2).evaluate((el) => (el as HTMLElement).style.transform);
  expect(placeholderTop, 'the placeholder at the target row\'s slot (its offsetTop)').toBe(slot1);
  // Compared as numbers: the serialised transform's digits differ by browser (Android Chrome: "translateY(-64.7619px)"
  // for a row of 64.76190948486328 px).
  const dy = /^translateY\((-?\d+(?:\.\d+)?(?:e-?\d+)?)px\)$/.exec(lifted);
  expect(dy, `the lifted row is moved by a translateY (${lifted})`).not.toBeNull();
  expect(Math.abs(Number(dy![1]) + h), `the lifted row moved up by one measured row (${lifted}; a row is ${h} px)`).toBeLessThan(0.01);
  await page.keyboard.press('Escape');
  expect(await qstate(page).then((q) => q.waitingNames)).toEqual([5, 6, 7].map(toneName));
});

// ---------------------------------------------------------------------------------------------------------------
// The review's fixes (v16.1): an abandoned classic Clear unticks its box; a ticked Clear deletes only the playlists it
// counted; the playlists wait for the library's restore; "Go to Tracks" sticks.
// ---------------------------------------------------------------------------------------------------------------
test('PL21. classic Clear: an abandoned Clear (the 3 s disarm) unticks the box, so a later two-tap Clear keeps the playlists on disk', async ({ page }) => {
  await open(page, {
    n: 4,
    layout: 'classic',
    records: (ids) => [rec('pevening1', 'Evening', [entry(ids[0], 1), entry(ids[1], 2)], 2_000), rec('pfocus001', 'Focus', [entry(ids[2], 3)], 1_000)],
  });
  const disk0 = await stored(page);
  expect(disk0.map((r) => r.id)).toEqual(['pevening1', 'pfocus001']);
  const box = page.getByTestId('clear-also-playlists').getByRole('checkbox');
  await page.getByTestId('clear-also-playlists').click();
  await expect(box).toBeChecked();
  await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
  await expect(page.getByText('Tap again to delete all 4 tracks, their analysis and your 2 playlists')).toBeVisible();
  // Abandoned: no second tap, and the button disarms after 3 s.
  await expect(page.getByRole('button', { name: 'Clear library and cache', exact: true }), 'disarmed').toBeVisible({ timeout: 6_000 });
  await expect(box, 'the disarm unticks the box').not.toBeChecked();
  // Later, a two-tap Clear with the box left alone: the playlists stay.
  await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
  await expect(page.getByText('Tap again to delete all 4 tracks and their analysis (your 2 playlists stay)')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm deleting all 4 tracks from this device', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library is cleared' }).toBe(0);
  await expect.poll(async () => (await cacheCounts(page)).blobs, { message: 'its audio is cleared' }).toBe(0);
  expect(await stored(page), 'both playlists on disk, byte for byte').toEqual(disk0);
  expect((await pl(page)).lists.map((l) => [l.name, l.missing])).toEqual([['Evening', 2], ['Focus', 1]]);
});

for (const layout of ['new', 'classic'] as const) {
  test(`PL22. a ticked Clear deletes exactly the playlists it counted: the ones that couldn't be read stay byte for byte, and their note still shows (${layout})`, async ({ page }) => {
    const ids = await open(page, {
      n: 4,
      layout,
      records: (ids) => [
        rec('pgood0001', 'Good', [entry(ids[0], 1), entry(ids[1], 2)], 2_000),
        { ...rec('pbadentry', 'Bad', [entry(ids[0], 1)], 3_000), entries: [entry(ids[0], 1), { id: '', name: 'x', file: 'x.wav', size: 1 }] },
        { ...rec('pversion2', 'Future', [entry(ids[1], 2)], 3_000), v: 2 },
      ],
    });
    const s0 = await pl(page);
    expect([s0.lists.map((l) => l.name), s0.unreadable], 'one readable, two that are not').toEqual([['Good'], 2]);
    // One more, made in this session (written since the read): the box deletes it too.
    const made = await P<string | null>(page, 'create', 'Made', [ids[2]]);
    expect(made).toBeTruthy();
    await expect.poll(async () => (await stored(page)).length).toBe(4);
    const unreadable0 = (await stored(page)).filter((r) => r.id === 'pbadentry' || r.id === 'pversion2');
    expect(unreadable0.map((r) => r.id)).toEqual(['pbadentry', 'pversion2']);
    if (layout === 'classic') {
      await page.getByTestId('clear-also-playlists').click();
      await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
      await expect(page.getByText('Tap again to delete all 4 tracks, their analysis and your 2 playlists')).toBeVisible();
      await page.getByRole('button', { name: 'Confirm deleting all 4 tracks from this device and your 2 playlists', exact: true }).click();
    } else {
      await openTools(page);
      await page.getByTestId('library-tools-clear').click();
      const d = page.getByRole('alertdialog', { name: 'Clear your library?' });
      await d.getByTestId('clear-library-also').click();
      await expect(d.getByTestId('clear-library-confirm')).toHaveText('Delete 4 tracks and 2 playlists');
      await page.waitForTimeout(700);
      await d.getByTestId('clear-library-confirm').click();
    }
    await expect.poll(async () => { const c = await cacheCounts(page); return [c.blobs, c.meta]; }, { message: 'the library is cleared' }).toEqual([0, 0]);
    await expect.poll(async () => (await stored(page)).map((r) => r.id), { message: 'the two it counted are gone, the two it could not read stay' }).toEqual(['pbadentry', 'pversion2']);
    expect(await stored(page), "the records App couldn't read, byte for byte").toEqual(unreadable0);
    expect(await savedState(page), 'the play state gone').toBe(null);
    const s1 = await pl(page);
    expect([s1.lists, s1.unreadable], 'none shown; the two still counted').toEqual([[], 2]);
    if (layout === 'new') {
      await openPlaylistsTab(page);
      await expect(page.getByTestId('playlists-empty')).toBeVisible();
      await expect(page.getByTestId('playlists-unreadable'), 'the note still shows, and is still true').toHaveText('2 saved playlists couldn’t be read and are left as they were.');
    }
  });
}

test('PL23. the playlists wait for the library\'s restore: with it held and a track imported meanwhile, the view shows loading and Remove missing is refused; released, every entry resolves', async ({ page }) => {
  await holdRestore(page);
  await instrument(page, 'new');
  const ids = await seed(page, { n: 6 });
  const r0 = rec('pevening1', 'Evening', [entry(ids[0], 1), entry(ids[2], 3), entry(ids[4], 5)], 2_000);
  await putRecords(page, [r0]);
  await page.setViewportSize(PHONE_VIEWPORT);
  await page.goto(appUrl('/'));
  await acceptDisclaimerNew(page);
  await page.waitForFunction(() => typeof (window as any).__releaseRestore === 'function' && (window as any).__restoreHeld > 0 && typeof (window as any).__aetheriaPlaylists?.state === 'function', null, { timeout: 30_000 });
  expect((await libraryState(page)).libraryIds.length, 'the restore is held').toBe(0);
  // An import while it is held: the library is no longer "loading" (the Mixes tab's wait ends), the restore still is.
  await importNew(page, [8]);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the import alone, in memory' }).toBe(1);
  await page.waitForTimeout(1_000);
  // Remove missing (through the hook) is refused, nothing written: every entry would count as missing now.
  expect(await P(page, 'edit', 'pevening1', { removeMissing: true }), 'Remove missing refused').toBe(false);
  await expect(page.getByText('Your playlists are still loading. Try again in a moment.')).toBeVisible();
  expect(await plPuts(page), 'nothing written').toBe(0);
  expect(await stored(page), 'the record as it was').toEqual([r0]);
  // And the view waits: loading, no playlist shown (so none with its tracks "Not in your library").
  expect((await pl(page)).status, 'the playlists wait for the restore').toBe('loading');
  await page.getByTestId('library-view-playlists').click();
  await expect(page.getByTestId('playlists-loading')).toBeVisible();
  await expect(page.getByTestId('playlist-row'), 'no playlist shown, so none with its tracks missing').toHaveCount(0);
  // Released: the restore lands (merged after the import), then the playlists, every entry resolved.
  await page.evaluate(() => (window as any).__releaseRestore());
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the restore lands, merged', timeout: 30_000 }).toBe(7);
  await expect.poll(async () => (await pl(page)).status, { message: 'then the playlists are read back' }).toBe('ready');
  const ev = await listOf(page, 'Evening');
  expect([ev.present, ev.missing, ev.tracks], 'every entry resolves to its restored track').toEqual([3, 0, [ids[0], ids[2], ids[4]]]);
  await expect(plRow(page, 'pevening1').locator('[data-row-facts]')).not.toContainText('missing');
  expect(await stored(page), 'the record as it was').toEqual([r0]);
});

test('PL25. the store: a write made during a Clear that deletes the playlists waits and lands after it, even one for a playlist that Clear deletes (a throwaway database)', async ({ page }) => {
  // Since a ticked Clear deletes only the playlists known at the tap, V6's case (a new playlist made meanwhile) no
  // longer needs the wait; this is the case that does: the app's own module (the dev server's), on its own database.
  await page.goto(appUrl('/manifest.json'));
  const out = await page.evaluate(async () => {
    const m: any = await import(/* @vite-ignore */ '/utils/playlistCache.ts');
    const name = `aetheria-e2e-pl25-${Date.now()}`;
    m.__setCacheDbNameForTests(name);
    const rec = (title: string) => ({ key: 'pl:pkept00001', v: 1, id: 'pkept00001', name: title, createdAt: 1, updatedAt: 2, entries: [] });
    const all = async (): Promise<{ key: string; name?: string }[]> => {
      const db: IDBDatabase = await m.openDB();
      const r = await new Promise<any[]>((resolve, reject) => {
        const q = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      db.close();
      return r;
    };
    await m.readSavedPlaylists();
    const before = await m.writePlaylistRecords([rec('Kept')]);
    const clearing = m.clearPlaylistCache({ playlists: true });
    const during = m.writePlaylistRecords([rec('Written after the tap')]);
    await clearing;
    const landed = await during;
    const left = (await all()).map((r) => `${r.key}=${r.name}`);
    m.__setCacheDbNameForTests('aetheria-db');
    await new Promise((resolve) => { const d = indexedDB.deleteDatabase(name); d.onsuccess = d.onerror = d.onblocked = () => resolve(null); });
    return { before, landed, left };
  });
  expect(out, 'the write after the tap waited for the Clear, then landed').toEqual({ before: true, landed: true, left: ['pl:pkept00001=Written after the tap'] });
});

test('PL24. "Go to Tracks" sticks: from an empty playlist\'s view to Tracks, then another tab and back, the Library opens on Tracks; Back still returns to Playlists', async ({ page }) => {
  await open(page, { n: 4, records: () => [rec('pempty001', 'Empty', [], 2_000)] });
  await openPlaylistView(page, 'pempty001');
  await page.getByTestId('playlist-go-tracks').click();
  await expect(page.getByTestId('library-list')).toBeVisible();
  await expect(page.getByTestId('library-view-tracks')).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'now');
  await expect(page.getByTestId('tab-library')).toHaveCount(0);
  await openLibraryTab(page);
  await expect(page.getByTestId('library-view-tracks'), 'the Library opens on Tracks again').toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('library-list')).toBeVisible();
  // Back from a playlist's view: the Playlists side, and it stays.
  await openPlaylistView(page, 'pempty001');
  await page.getByTestId('playlist-back').click();
  await expect(page.getByTestId('library-view-playlists')).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'now');
  await openLibraryTab(page);
  await expect(page.getByTestId('library-view-playlists'), 'the Library opens on Playlists').toHaveAttribute('aria-selected', 'true');
});

// ---------------------------------------------------------------------------------------------------------------
// The re-review's fix (v16.1): a ticked Clear deletes a playlist whose delete failed (PL26) or was still waiting (PL27):
// a delete leaves its key among those the Clear deletes.
// ---------------------------------------------------------------------------------------------------------------
test('PL26. a delete that failed (its sticky Retry toast), then a ticked Clear: the playlist is gone from disk, and stays gone after a reload', async ({ page }) => {
  // Only a playlist record's delete fails, and only while window.__failPlaylistDeletes is on: its transaction is
  // aborted, as a full device's would be.
  await page.addInitScript(() => {
    const w = window as any;
    w.__failPlaylistDeletes = false;
    const del = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (this: IDBObjectStore, ...a: any[]) {
      const request = (del as any).apply(this, a);
      if (w.__failPlaylistDeletes && this.name === 'playlist-state' && typeof a[0] === 'string' && a[0].startsWith('pl:')) this.transaction.abort();
      return request;
    } as typeof del;
  });
  await open(page, {
    n: 4,
    layout: 'classic',
    records: (ids) => [rec('pevening1', 'Evening', [entry(ids[0], 1), entry(ids[1], 2)], 2_000), rec('pfocus001', 'Focus', [entry(ids[2], 3)], 1_000)],
  });
  await page.evaluate(() => { (window as any).__failPlaylistDeletes = true; });
  expect(await P(page, 'remove', 'pevening1'), 'the delete is taken (on screen)').toBe(true);
  await expect(page.getByText(/^Couldn’t save the change to Evening\./), 'the delete failed: the sticky toast with Retry').toBeVisible();
  expect((await pl(page)).lists.map((l) => l.name), 'Evening gone from the screen').toEqual(['Focus']);
  expect((await stored(page)).map((r) => r.id), 'and still on disk').toEqual(['pevening1', 'pfocus001']);
  // Storage works again, and Retry is not tapped: Clear, with "Also delete my playlists" ticked.
  await page.evaluate(() => { (window as any).__failPlaylistDeletes = false; });
  await page.getByTestId('clear-also-playlists').click();
  await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
  await page.getByRole('button', { name: /^Confirm deleting all 4 tracks/ }).click();
  await expect.poll(async () => (await cacheCounts(page)).blobs, { message: 'the library is cleared' }).toBe(0);
  await expect.poll(async () => (await stored(page)).map((r) => r.id), { message: 'the Clear deleted Evening too (its delete had failed), and Focus' }).toEqual([]);
  // A reload: no playlist comes back.
  await page.goto(appUrl('/'));
  await acceptDisclaimer(page);
  await page.waitForFunction(() => typeof (window as any).__aetheriaPlaylists?.state === 'function', null, { timeout: 10_000 });
  await expect.poll(() => pl(page).then((s) => s.status), { message: 'the playlists are read back' }).toBe('ready');
  const after = await pl(page);
  expect([after.lists, after.unreadable], 'none comes back').toEqual([[], 0]);
  expect(await stored(page), 'none on disk').toEqual([]);
});

test('PL27. the store: a delete still waiting (its connection closing) when a ticked Clear runs is deleted by that Clear (a throwaway database)', async ({ page }) => {
  // The app's own module (the dev server's), on its own database, as PL25.
  await page.goto(appUrl('/manifest.json'));
  const out = await page.evaluate(async () => {
    const m: any = await import(/* @vite-ignore */ '/utils/playlistCache.ts');
    const name = `aetheria-e2e-pl27-${Date.now()}`;
    m.__setCacheDbNameForTests(name);
    const keys = async (): Promise<string[]> => {
      const db: IDBDatabase = await m.openDB();
      const r = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const q = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').getAllKeys();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      db.close();
      return r.map(String);
    };
    try {
      await m.readSavedPlaylists();
      const put = await m.writePlaylistRecords([{ key: 'pl:pgone00001', v: 1, id: 'pgone00001', name: 'Gone', createdAt: 1, updatedAt: 1, entries: [] }]);
      const before = await keys();
      // The kept connection is closing (transaction() throws InvalidStateError, once): the delete waits for a new one.
      const transaction = IDBDatabase.prototype.transaction;
      let closing = true;
      IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...a: any[]) {
        if (closing) {
          closing = false;
          throw new DOMException('the connection is closing (test)', 'InvalidStateError');
        }
        return (transaction as any).apply(this, a);
      } as typeof transaction;
      let waiting: Promise<boolean> = Promise.resolve(false);
      try {
        waiting = m.writePlaylistRecords([], ['pl:pgone00001']);
      } finally {
        IDBDatabase.prototype.transaction = transaction;
      }
      const waited = !closing; // the delete met the closing connection
      // In the same task, while that delete waits: a Clear with the playlists box ticked.
      await m.clearPlaylistCache({ playlists: true });
      await waiting;
      return { put, before, waited, after: await keys() };
    } finally {
      m.__setCacheDbNameForTests('aetheria-db');
      await new Promise((resolve) => { const d = indexedDB.deleteDatabase(name); d.onsuccess = d.onerror = d.onblocked = () => resolve(null); });
    }
  });
  expect(out, 'the delete waited (its connection closing); the Clear deleted the record anyway').toEqual({ put: true, before: ['pl:pgone00001'], waited: true, after: [] });
});
