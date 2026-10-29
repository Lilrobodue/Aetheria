import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  acceptDisclaimer,
  acceptDisclaimerNew,
  appUrl,
  cacheCounts,
  countBlobSaves,
  crash,
  libraryRowButton,
  libraryState,
  metaRecords,
  openLibraryTab,
  openSeededNewLayout,
  renders,
  resetRenders,
  rowMenu,
  savedState,
  tab,
  tapAt,
  LAYER_ENGINE_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
} from './helpers';

// v16.2, smart filters (spec §5.4). Stage A drives App's one function for them through the dev hook
// window.__aetheriaFilters (each call inside a click event: a tap's priority and task, as the UI makes it); Stage B
// adds each one's UI path. Filters only narrow what Library › Tracks SHOWS: the library, its metadata, its audio and
// the saved playlists are never written, and the play order only by an action's tap.
// The seed (FACET_SEED): 30 synthetic tones tone-01 … tone-30, written straight into IndexedDB, each with the facet
// fields below by its index k (0-based); the oracle (`expected`, `countOf`) reads the same table with a few lines of
// its own, written independently of the model. Classic layers; the new layout at phone size.

const FILTERS_KEY = 'aetheria.libraryFilters.v1';
const N = 30;
const toneName = (k: number) => `tone-${String(k + 1).padStart(2, '0')}`;

/** The crystal of tone k: GUT's nine first, 528 at k = 4, 14, 24 and 639 at 5, 15, 25, none at k % 10 = 9. */
const CRY: Array<number | null> = [
  174, 285, 396, 417, 528, 639, 741, 852, 963, null,
  1206, 1449, 1692, 1935, 528, 639, 2178, 2421, 2664, null,
  3504, 4212, 4920, 5628, 528, 639, 6336, 2907, 3150, null,
];
type KeyKind = 'Am' | 'C' | 'flat' | 'none' | 'failed';
interface SeedRow {
  crystal: number | null;
  /** The stored length (s); null: not read yet (tone-30's file is unreadable, so it stays unread). */
  duration: number | null;
  scan: 'scanned' | 'unscanned' | 'failed';
  sync: 'band' | 'visual' | null;
  key: KeyKind;
}
const FACET_SEED: SeedRow[] = Array.from({ length: N }, (_, k) => ({
  crystal: CRY[k],
  duration: k === 29 ? null : [150, 240, 420, 700][k % 4],
  scan: k === 17 ? 'failed' : k % 6 === 0 ? 'scanned' : 'unscanned',
  sync: k % 3 === 0 ? 'band' : k % 3 === 1 ? 'visual' : null,
  key: (['Am', 'C', 'flat', 'none', 'failed'] as const)[k % 5],
}));

// ---------------------------------------------------------------------------------------------------------------
// The oracle: what each tone is, per facet, and what a set of picks shows
// ---------------------------------------------------------------------------------------------------------------
type Picks = Partial<Record<'crystal' | 'length' | 'scan' | 'sync' | 'key' | 'confidence', string[]>>;
const VALUE: Record<keyof Picks, (r: SeedRow) => string> = {
  crystal: (r) => (r.crystal ? String(r.crystal) : 'none'),
  length: (r) => (r.duration === null ? 'unknown' : r.duration < 180 ? 'lt3' : r.duration < 300 ? '3to5' : r.duration < 600 ? '5to10' : 'ge10'),
  scan: (r) => r.scan,
  sync: (r) => (r.sync ? 'yes' : 'no'),
  key: (r) => ({ Am: 'Am', C: 'C', flat: 'noclear', none: 'unanalysed', failed: 'failed' })[r.key],
  confidence: (r) => ({ Am: 'strong', C: 'partial', flat: 'weak' } as Record<string, string>)[r.key] ?? 'na',
};
const nameHas = (k: number, text: string) => toneName(k).toLowerCase().includes(text.trim().toLowerCase());
/** The tones the picks AND the text show, in library order (OR within a facet, AND across). */
function expected(picks: Picks, text = ''): number[] {
  const out: number[] = [];
  for (let k = 0; k < N; k++) {
    const r = FACET_SEED[k];
    if (text && !nameHas(k, text)) continue;
    if ((Object.keys(picks) as (keyof Picks)[]).every((f) => !picks[f]?.length || picks[f]!.includes(VALUE[f](r)))) out.push(k);
  }
  return out;
}
/** A chip's count: the tones that would show with its facet cleared, holding its value. */
function countOf(picks: Picks, facet: keyof Picks, value: string, text = ''): number {
  const others = { ...picks, [facet]: [] };
  return expected(others, text).filter((k) => VALUE[facet](FACET_SEED[k]) === value).length;
}

// ---------------------------------------------------------------------------------------------------------------
// Seed, instrument, launch
// ---------------------------------------------------------------------------------------------------------------

/** The 30 tones into IndexedDB from /manifest.json, with their facet fields; returns the ids in library order. */
async function seed(page: Page, o: { seconds?: number; readable?: boolean } = {}): Promise<string[]> {
  await page.goto(appUrl('/manifest.json'));
  return page.evaluate(async ({ rows, seconds }) => {
    const wav = (secs: number, freq: number) => {
      const rate = 8000, len = Math.round(secs * rate), buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
      const w = (o: number, x: string) => { for (let i = 0; i < x.length; i++) v.setUint8(o + i, x.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
      v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      w(36, 'data'); v.setUint32(40, len * 2, true);
      for (let i = 0; i < len; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 5000 * Math.min(1, i / 400, (len - i) / 400)), true);
      return new Blob([buf], { type: 'audio/wav' });
    };
    const env = () => { const a = () => new Uint8Array(20).fill(90); return { fps: 20, sub: a(), bass: a(), mid: a(), high: a() }; };
    const chroma = () => Array.from({ length: 12 }, (_, i) => (i === 9 ? 0.34 : 0.06));
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db', 2);
      r.onupgradeneeded = () => { const d = r.result; for (const x of ['blobs', 'meta']) d.createObjectStore(x, { keyPath: 'id' }); d.createObjectStore('playlist-state', { keyPath: 'key' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const t0 = Date.now() - rows.length * 1000;
    const ids: string[] = [];
    const tx = db.transaction(['blobs', 'meta'], 'readwrite');
    rows.forEach((row: any, k: number) => {
      const id = `${t0 + k * 1000}-f${String(k + 1).padStart(2, '0')}`;
      ids.push(id);
      const name = `tone-${String(k + 1).padStart(2, '0')}`;
      // Tone 30's file is not audio: its length can never be read, so it stays "Length not read yet".
      const blob = row.duration === null ? new Blob([new Uint8Array(64).fill(7)], { type: 'audio/wav' }) : wav(seconds, 220 + k * 11);
      tx.objectStore('blobs').put({ id, fileBlob: blob, fileName: `${name}.wav`, fileType: 'audio/wav' });
      const meta: any = { id, name };
      if (row.duration !== null) meta.duration = row.duration;
      if (row.crystal) {
        meta.closestSolfeggio = row.crystal;
        if (row.scan === 'scanned') Object.assign(meta, { harmonicFreq: row.crystal + 2, harmonicDeviation: 2, crystalSource: 'scan' });
        else if (row.scan === 'failed') Object.assign(meta, { harmonicFreq: 440, harmonicDeviation: 999, crystalSource: 'scan' });
        else Object.assign(meta, { harmonicFreq: row.crystal, harmonicDeviation: 0, crystalSource: 'assigned' });
      }
      if (row.sync === 'band') meta.bandEnvelope = env();
      else if (row.sync === 'visual') meta.visualEnvelope = env();
      if (row.key === 'Am' || row.key === 'C' || row.key === 'flat') {
        Object.assign(meta, { chroma: chroma(), chromaA4Hz: 440, chromaVersion: 1 });
        meta.musicKey = row.key === 'flat' ? '' : row.key;
        meta.keyConfidence = row.key === 'Am' ? 0.82 : row.key === 'C' ? 0.6 : 0;
      } else if (row.key === 'failed') meta.analysisFailedV = 1;
      tx.objectStore('meta').put(meta);
    });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    const st = db.transaction('playlist-state', 'readwrite');
    st.objectStore('playlist-state').put({ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 396, savedAt: Date.now() });
    await new Promise((resolve) => (st.oncomplete = resolve));
    db.close();
    return ids;
  }, { rows: o.readable ? FACET_SEED.map((r) => (r.duration === null ? { ...r, duration: 330 } : r)) : FACET_SEED, seconds: o.seconds ?? 12 });
}

/** Before the app, on every load: the tutorial seen, classic layers, the new layout; a tap wrapper; what the music
 *  element plays; every store write with its key; every write of the filters' key. */
async function instrument(page: Page, o: { filters?: string | null; layout?: 'new' | 'classic' } = {}): Promise<void> {
  await page.addInitScript(({ keys, filters, layout }) => {
    const w = window as any;
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      localStorage.setItem(keys.engine, 'classic');
      localStorage.setItem(keys.layout, layout);
      // A saved value for this test, put once (before the app's first load in this tab).
      if (filters !== undefined && sessionStorage.getItem('__e2eFilters') === null) {
        sessionStorage.setItem('__e2eFilters', '1');
        if (filters === null) localStorage.removeItem(keys.filters);
        else localStorage.setItem(keys.filters, filters);
      }
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
    w.__filterWrites = [] as string[];
    // window.__fullStorage = true: the filters' key can no longer be saved (setItem throws, as a full storage's does).
    w.__fullStorage = false;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key === keys.filters) {
        if (w.__fullStorage) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        w.__filterWrites.push(`set ${value}`);
      }
      return setItem.call(this, key, value);
    };
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (this: Storage, key: string) {
      if (key === keys.filters) w.__filterWrites.push('remove');
      return removeItem.call(this, key);
    };
    // A decode held on demand (v16.0's Q14 setup): a start in flight.
    w.__holdDecode = false;
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: any[]) {
      if (!w.__holdDecode) return (decode as any).apply(this, a);
      return new Promise((res, rej) => { w.__releaseDecode = () => (decode as any).apply(this, a).then(res, rej); });
    } as any;
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
  }, { keys: { engine: LAYER_ENGINE_KEY, layout: LAYOUT_KEY, filters: FILTERS_KEY }, filters: o.filters, layout: o.layout ?? 'new' });
}

/** Load the app over the seed and wait for the library and the hooks. */
/** hook: false for the tests that also run as baselines on v16.1 (F11b, F18): they need no v16.2 hook. */
async function launch(page: Page, o: { layout?: 'new' | 'classic'; viewport?: { width: number; height: number }; hook?: boolean } = {}): Promise<void> {
  await page.setViewportSize(o.viewport ?? PHONE_VIEWPORT);
  await page.goto(appUrl('/'));
  if ((o.layout ?? 'new') === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library restores', timeout: 60_000 }).toBe(N);
  if (o.hook === false) return;
  await page.waitForFunction(() => typeof (window as any).__aetheriaFilters?.state === 'function', null, { timeout: 10_000 }).catch(() => {
    throw new Error('window.__aetheriaFilters is missing: these tests need v16.2 on the dev server');
  });
}

/** readable: tone-30 is a normal tone too (330 s), for the tests that compare stored records: an unreadable file's
 *  length probe rewrites its record after every load (v16.1's own behaviour, not the filters'). */
async function open(page: Page, o: { filters?: string | null; seconds?: number; layout?: 'new' | 'classic'; viewport?: { width: number; height: number }; readable?: boolean; hook?: boolean } = {}): Promise<string[]> {
  await instrument(page, { filters: o.filters, layout: o.layout });
  const ids = await seed(page, { seconds: o.seconds, readable: o.readable });
  await launch(page, { layout: o.layout, viewport: o.viewport, hook: o.hook });
  return ids;
}

interface FState { ids: string[]; cursor: number; shuffle: boolean; shuffled: number[]; shufflePos: number; label: string | null; libraryIds: string[] }
const fstate = (page: Page): Promise<FState> => page.evaluate(() => (window as any).__aetheriaFilters.state());
/** The hook's play, inside a click event (a tap). */
const playHook = (page: Page, o: { ids: string[]; startId?: string | null; shuffle?: boolean; label: string; row?: boolean }) =>
  page.evaluate((o) => (window as any).__tap(() => (window as any).__aetheriaFilters.play(o)), o);
const heard = (page: Page) => page.evaluate(() => (window as any).__heard() as string | null);
const toastText = (page: Page) => page.getByTestId('notices').locator('div[aria-atomic="true"]').first();
const undoButton = (page: Page) => page.getByTestId('notices').getByRole('button', { name: 'Undo', exact: true });
const qstate = (page: Page) => page.evaluate(() => (window as any).__aetheriaQueue.state());
const idsOf = (ids: string[], ks: number[]) => ks.map((k) => ids[k]);

/** Play the library from tone k (a Library row's tap, no filters on) and wait until it plays. */
async function playLibraryFrom(page: Page, k: number): Promise<void> {
  await openLibraryTab(page);
  await libraryRowButton(page, toneName(k)).click();
  await expect.poll(() => heard(page), { message: `${toneName(k)} plays` }).toBe(toneName(k));
  await expect.poll(async () => { const s = await libraryState(page); return s.cursor === k && s.playing; }, { message: `${toneName(k)} is the current track` }).toBe(true);
}

test.beforeEach(async ({ page }) => {
  if (ON_DEVICE) await page.setViewportSize(PHONE_VIEWPORT);
});

test('the seed: the oracle agrees with itself (each facet\'s values sum to 30; 528 and 639 are six tones)', async () => {
  for (const f of Object.keys(VALUE) as (keyof Picks)[]) {
    const seen = new Map<string, number>();
    for (const r of FACET_SEED) seen.set(VALUE[f](r), (seen.get(VALUE[f](r)) ?? 0) + 1);
    expect([...seen.values()].reduce((a, b) => a + b, 0), f).toBe(N);
  }
  expect(expected({ crystal: ['528', '639'] })).toEqual([4, 5, 14, 15, 24, 25]);
  expect(countOf({ crystal: ['528'] }, 'crystal', '639')).toBe(3);
});

// ---------------------------------------------------------------------------------------------------------------
// F9. Play these: the shown tracks, in the list's order, from the first; the toast; Undo; the queue carried.
// ---------------------------------------------------------------------------------------------------------------
test('F9. Play these: the play order is the shown tracks in order from the first; Undo brings the earlier one back; 2 queued are carried @mobile', async ({ page }) => {
  const ids = await open(page);
  await playLibraryFrom(page, 0);
  await expect.poll(async () => (await libraryState(page)).t ?? 0, { message: 'tone-01 plays on' }).toBeGreaterThan(1.5);
  const before = await fstate(page);
  expect(before.ids, 'the library plays').toEqual(ids);
  const shown = expected({ crystal: ['528', '639'] });
  const set = idsOf(ids, shown);
  await playHook(page, { ids: set, label: '528 Hz · 639 Hz' });
  await expect.poll(async () => (await fstate(page)).ids, { message: 'the play order is the six, in the list’s order' }).toEqual(set);
  const s = await fstate(page);
  expect(s.cursor, 'from the first').toBe(0);
  expect(s.label, 'named by the filters').toBe('528 Hz · 639 Hz');
  expect(s.libraryIds, 'the library is untouched').toEqual(ids);
  await expect.poll(() => heard(page), { message: 'tone-05 plays' }).toBe(toneName(shown[0]));
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show.');
  // Undo: the library order, tone-01, from about where it was.
  await undoButton(page).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'Undo: the library again' }).toEqual(ids);
  expect((await fstate(page)).cursor).toBe(0);
  await expect.poll(() => heard(page), { message: 'tone-01 again' }).toBe(toneName(0));
  await expect.poll(async () => (await libraryState(page)).t ?? 0, { message: 'from about where it was' }).toBeGreaterThan(1.2);
  // Two queued (Add to queue: tone-11, tone-12), then Play these: they play next, and the toast says so.
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), [ids[10], ids[11]]);
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'two queued' }).toBe(2);
  await playHook(page, { ids: set, label: '528 Hz · 639 Hz' });
  await expect.poll(async () => (await fstate(page)).ids, { message: 'the six, the queue carried right after the first' }).toEqual([set[0], ids[10], ids[11], ...set.slice(1)]);
  expect((await fstate(page)).cursor).toBe(0);
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show. Your 2 queued tracks play next.');
  expect((await qstate(page)).waitingNames, 'still queued').toEqual([toneName(10), toneName(11)]);
});

// ---------------------------------------------------------------------------------------------------------------
// F10. Shuffle: the switch on, a permutation of the set, the least recently played first; Undo turns it off again.
// ---------------------------------------------------------------------------------------------------------------
test('F10. Shuffle: the switch turns on, the order is a permutation of the set starting with the least recently played; Undo turns it off', async ({ page }) => {
  const ids = await open(page);
  const shown = expected({ crystal: ['528', '639'] });
  const set = idsOf(ids, shown);
  // Five of the six have played (row taps while filtered); tone-26 never has.
  for (const k of shown.slice(0, 5)) {
    await playHook(page, { ids: set, startId: ids[k], label: '528 Hz · 639 Hz', row: true });
    await expect.poll(() => heard(page), { message: `${toneName(k)} plays` }).toBe(toneName(k));
    await page.waitForTimeout(150);
  }
  expect((await fstate(page)).shuffle, 'the switch is off').toBe(false);
  const orderBefore = (await fstate(page)).ids;
  await playHook(page, { ids: set, label: '528 Hz · 639 Hz', shuffle: true });
  await expect.poll(async () => (await fstate(page)).shuffle, { message: 'the switch turns on' }).toBe(true);
  const s = await fstate(page);
  expect(s.ids, 'the play order is the set').toEqual(set);
  expect([...s.shuffled].sort((a, b) => a - b), 'the shuffle order is a permutation of the set').toEqual([0, 1, 2, 3, 4, 5]);
  expect(s.ids[s.cursor], 'the least recently played starts').toBe(ids[shown[5]]);
  expect(s.ids[s.shuffled[s.shufflePos]], 'and the shuffle order starts there').toBe(ids[shown[5]]);
  await expect.poll(() => heard(page)).toBe(toneName(shown[5]));
  await expect(toastText(page)).toContainText('Shuffling the 6 tracks your filters show. Shuffle is on.');
  await undoButton(page).click();
  await expect.poll(async () => (await fstate(page)).shuffle, { message: 'Undo turns the switch off again' }).toBe(false);
  expect((await fstate(page)).ids).toEqual(orderBefore);
});

// ---------------------------------------------------------------------------------------------------------------
// F11. A row's tap while filtered (decision 1 A): the shown tracks from that one; chained taps keep one Undo. A search
// alone still plays the whole library (v15.7).
// ---------------------------------------------------------------------------------------------------------------
test('F11. a row’s tap while filtered plays the shown tracks from that one; chained taps keep one Undo @mobile', async ({ page }) => {
  const ids = await open(page);
  await playLibraryFrom(page, 1);
  const shown = expected({ crystal: ['528', '639'] });
  const set = idsOf(ids, shown);
  await playHook(page, { ids: set, startId: ids[14], label: '528 Hz · 639 Hz', row: true });
  await expect.poll(async () => (await fstate(page)).ids, { message: 'the shown tracks' }).toEqual(set);
  expect((await fstate(page)).cursor, 'from the tapped row').toBe(shown.indexOf(14));
  await expect.poll(() => heard(page)).toBe(toneName(14));
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show, from this one.');
  // A second tap within the toast's time chains: its Undo goes back to before the first.
  await playHook(page, { ids: set, startId: ids[24], label: '528 Hz · 639 Hz', row: true });
  await expect.poll(async () => (await fstate(page)).cursor, { message: 'the second tap' }).toBe(shown.indexOf(24));
  await expect.poll(() => heard(page)).toBe(toneName(24));
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show, from this one.');
  await undoButton(page).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'one Undo: the library, as before the first tap' }).toEqual(ids);
  expect((await fstate(page)).cursor).toBe(1);
  await expect.poll(() => heard(page)).toBe(toneName(1));
});

// F11b. A search alone (no chip on): v15.7's row tap, unchanged. Hook-free: it passes on v16.1 too (a baseline).
test('F11b. a search alone: a row’s tap plays the whole library from that track (v15.7, unchanged) @mobile', async ({ page }) => {
  const ids = await open(page, { hook: false });
  await openLibraryTab(page);
  await page.getByTestId('library-search').fill('tone-1');
  await expect(page.getByTestId('library-summary')).toContainText('10 of 30 tracks match');
  await libraryRowButton(page, toneName(11)).click();
  await expect.poll(async () => (await libraryState(page)).cursor, { message: 'tone-12 from the whole library' }).toBe(11);
  expect((await libraryState(page)).ids, 'the whole library').toEqual(ids);
});

// ===============================================================================================================
// Stage B: the new layout's UI (Library › Tracks: the Filters button, the sheet, the bar, the ⋯ sheet, the empty card)
// ===============================================================================================================

const filtersButton = (page: Page) => page.getByTestId('library-filters-button');
const filterSheet = (page: Page) => page.getByRole('dialog', { name: 'Filters', exact: true });
const chipIn = (page: Page, facet: string, value: string) => page.getByTestId('library-filters').locator(`button[data-facet="${facet}"][data-value="${value}"]`);
const sheetCount = (page: Page) => filterSheet(page).locator('p[aria-live="polite"]');
const barCount = (page: Page) => page.getByTestId('library-filter-count');
const activeChipNames = (page: Page) => page.getByTestId('library-active-chips').locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
const fingerProject = () => ON_DEVICE || test.info().project.name === 'mobile-ua';

async function openFilterSheet(page: Page): Promise<void> {
  if (!(await filtersButton(page).isVisible().catch(() => false))) await openLibraryTab(page);
  await filtersButton(page).click();
  await filterSheet(page).getByTestId('library-filters-body').waitFor();
}
async function closeFilterSheet(page: Page): Promise<void> {
  await filterSheet(page).getByTestId('filters-show').click();
  await expect(filterSheet(page)).toHaveCount(0);
}
/** A chip's tap: by finger (tapAt) on mobile-ua and the phone, else a click. */
async function tapChip(page: Page, facet: string, value: string, finger = false): Promise<void> {
  const c = chipIn(page, facet, value);
  await c.scrollIntoViewIfNeeded();
  if (finger) {
    const b = (await c.boundingBox())!;
    await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
  } else await c.click();
}
/** Pick these values (the sheet opened and closed around them). */
async function pick(page: Page, picks: Picks, finger = false): Promise<void> {
  await openFilterSheet(page);
  for (const f of Object.keys(picks) as (keyof Picks)[]) {
    for (const v of picks[f] ?? []) {
      await tapChip(page, f, v, finger);
      await expect(chipIn(page, f, v)).toHaveAttribute('aria-pressed', 'true');
    }
  }
  await closeFilterSheet(page);
}
/** Every row the list shows, in order (it is virtualized: scrolled through and put back). */
async function listNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const sc = document.querySelector('[data-testid="library-scroll"]') as HTMLElement | null;
    if (!sc) return [];
    const seen = new Map<number, string>();
    const grab = () => {
      for (const r of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="library-row"]'))) {
        seen.set(Number(r.getAttribute('aria-posinset')), r.querySelector('[data-row-title]')?.textContent ?? '');
      }
    };
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const keep = sc.scrollTop;
    sc.scrollTop = 0;
    await frames();
    grab();
    for (let guard = 0; sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1 && guard < 200; guard++) {
      sc.scrollTop += Math.max(64, sc.clientHeight - 64);
      await frames();
      grab();
    }
    sc.scrollTop = keep;
    await frames();
    const size = Number(document.querySelector('[data-testid="library-row"]')?.getAttribute('aria-setsize') ?? 0);
    return Array.from({ length: size }, (_, i) => seen.get(i + 1) ?? '?');
  });
}
const expectList = (page: Page, ks: number[], message?: string) => expect.poll(() => listNames(page), { message: message ?? 'the rows shown' }).toEqual(ks.map(toneName));
/** Every chip in the open sheet: [facet, value, its count (from its name), aria-pressed]. */
async function chipStates(page: Page): Promise<Array<[string, string, number, string]>> {
  return page.getByTestId('library-filters').locator('button[data-facet]').evaluateAll((bs) =>
    bs.map((b) => {
      const m = /, ([\d,]+) tracks?$/.exec(b.getAttribute('aria-label') ?? '');
      return [b.getAttribute('data-facet') ?? '', b.getAttribute('data-value') ?? '', m ? Number(m[1].replace(/,/g, '')) : -1, b.getAttribute('aria-pressed') ?? ''] as [string, string, number, string];
    })
  );
}
const REGIME_NINE: Record<string, number[]> = {
  gut: [174, 285, 396, 417, 528, 639, 741, 852, 963],
  heart: [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150],
  head: [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336],
};
/** Every chip's count in the open sheet equals the oracle's (as if its facet were cleared; a regime: its nine). */
async function expectCounts(page: Page, picks: Picks, text = ''): Promise<void> {
  const want = (facet: string, value: string) =>
    facet === 'regime' ? REGIME_NINE[value].reduce((n, c) => n + countOf(picks, 'crystal', String(c), text), 0) : countOf(picks, facet as keyof Picks, value, text);
  await expect
    .poll(async () => (await chipStates(page)).filter(([f, v, n]) => n !== want(f, v)).map(([f, v, n]) => `${f}:${v} shows ${n}, want ${want(f, v)}`), { message: 'every chip’s count' })
    .toEqual([]);
}
const formatTotal = (s: number) => {
  const r = Math.round(s);
  if (r < 60) return `${r} s`;
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};
const secondsOf = (ks: number[]) => ks.reduce((t, k) => t + (FACET_SEED[k].duration ?? 0), 0);
const barText = (ks: number[]) => (ks.length ? `${ks.length} of 30 tracks · ${formatTotal(secondsOf(ks))}` : '0 of 30 tracks');
const storedFilters = (page: Page) => page.evaluate((k) => localStorage.getItem(k), FILTERS_KEY);
const filterWrites = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__filterWrites.slice());
const storeLog = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__storeLog.slice());

// ---------------------------------------------------------------------------------------------------------------
// F1. Each chip of each facet alone (by finger on mobile-ua): the rows, "N of 30", the chip's count; off again.
// ---------------------------------------------------------------------------------------------------------------
test.describe('by finger', () => {
  test.use({ hasTouch: true });
  test('F1. each chip of each facet alone shows the oracle’s rows in list order, "N of 30" and its own count; un-tapping brings all 30 back @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
    await openLibraryTab(page);
    const finger = fingerProject();
    // The first pick is made at the bottom of the list: the list starts again at its top.
    await page.getByTestId('library-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect(await page.getByTestId('library-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
    await openFilterSheet(page);
    const CASES: Array<[keyof Picks, string]> = [
      ['sync', 'yes'], ['sync', 'no'],
      ['crystal', '528'], ['crystal', '639'], ['crystal', '4212'], ['crystal', 'none'], ['crystal', '5274'],
      ['length', 'lt3'], ['length', '3to5'], ['length', '5to10'], ['length', 'ge10'], ['length', 'unknown'],
      ['scan', 'scanned'], ['scan', 'unscanned'], ['scan', 'failed'],
      ['key', 'Am'], ['key', 'C'], ['key', 'noclear'], ['key', 'unanalysed'], ['key', 'failed'],
      ['confidence', 'strong'], ['confidence', 'partial'], ['confidence', 'weak'],
    ];
    for (const [i, [facet, value]] of CASES.entries()) {
      const want = expected({ [facet]: [value] });
      await tapChip(page, facet, value, finger);
      await expect(chipIn(page, facet, value), `${facet}:${value} picked`).toHaveAttribute('aria-pressed', 'true');
      await expect(sheetCount(page)).toHaveText(`${want.length} of 30 tracks`);
      await expect(chipIn(page, facet, value)).toHaveAttribute('aria-label', new RegExp(`, ${want.length} tracks?$`));
      if (i === 0) await expect.poll(() => page.getByTestId('library-scroll').evaluate((el) => el.scrollTop), { message: 'a new pick starts at the top' }).toBe(0);
      await expectList(page, want, `${facet}:${value}'s rows`);
      await tapChip(page, facet, value, finger);
      await expect(chipIn(page, facet, value)).toHaveAttribute('aria-pressed', 'false');
      await expect(sheetCount(page)).toHaveText('30 of 30 tracks');
    }
    await closeFilterSheet(page);
    await expect(page.getByTestId('library-summary')).toContainText('30 tracks');
    await expect(page.getByTestId('library-filter-bar')).toHaveCount(0);
    expect(await listNames(page)).toEqual(Array.from({ length: N }, (_, k) => toneName(k)));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// F2. OR within a facet, AND across facets, AND the search.
// ---------------------------------------------------------------------------------------------------------------
test('F2. OR within a facet, AND across facets, and the search on top: each step’s rows and "N of 30 · length"', async ({ page }) => {
  await open(page);
  await pick(page, { crystal: ['528', '639'] });
  const union = expected({ crystal: ['528', '639'] });
  expect(union).toEqual([4, 5, 14, 15, 24, 25]);
  await expect(barCount(page)).toHaveText(barText(union));
  await expectList(page, union);
  await pick(page, { length: ['lt3'] });
  const both = expected({ crystal: ['528', '639'], length: ['lt3'] });
  expect(both).toEqual([4, 24]);
  await expect(barCount(page)).toHaveText(barText(both));
  await expectList(page, both);
  await page.getByTestId('library-search').fill('tone-2');
  const withText = expected({ crystal: ['528', '639'], length: ['lt3'] }, 'tone-2');
  expect(withText).toEqual([24]);
  await expect(barCount(page)).toHaveText(barText(withText));
  await expectList(page, withText);
});

// ---------------------------------------------------------------------------------------------------------------
// F3. The counts: what each chip would show with its facet cleared.
// ---------------------------------------------------------------------------------------------------------------
test('F3. every chip’s count is what its facet cleared would show; a facet’s picked counts, and an unpicked facet’s counts, add up to N', async ({ page }) => {
  await open(page);
  await openFilterSheet(page);
  await tapChip(page, 'crystal', '528');
  await expectCounts(page, { crystal: ['528'] });
  expect(countOf({ crystal: ['528'] }, 'crystal', '639'), '639 is not 0 though not picked').toBe(3);
  await tapChip(page, 'length', 'lt3');
  const p: Picks = { crystal: ['528'], length: ['lt3'] };
  await expectCounts(page, p);
  const n = expected(p).length;
  const states = await chipStates(page);
  const sum = (facet: string, only?: (st: string) => boolean) => states.filter(([f, , , st]) => f === facet && (!only || only(st))).reduce((t, [, , c]) => t + c, 0);
  expect(sum('crystal', (st) => st === 'true'), 'the picked crystals add up to N').toBe(n);
  expect(sum('length', (st) => st === 'true'), 'the picked lengths add up to N').toBe(n);
  expect(sum('sync'), 'an unpicked facet adds up to N').toBe(n);
  expect(sum('scan'), 'an unpicked facet adds up to N').toBe(n);
  await tapChip(page, 'crystal', '639');
  await tapChip(page, 'length', '3to5');
  await tapChip(page, 'sync', 'yes');
  await closeFilterSheet(page);
  await page.getByTestId('library-search').fill('tone-2');
  await openFilterSheet(page);
  await expectCounts(page, { crystal: ['528', '639'], length: ['lt3', '3to5'], sync: ['yes'] }, 'tone-2');
});

// ---------------------------------------------------------------------------------------------------------------
// F4. A regime chip picks its nine; one active chip names it; partly picked is "mixed".
// ---------------------------------------------------------------------------------------------------------------
test('F4. All GUT picks its nine (one active chip "GUT", its count their sum); one dropped is "mixed" and lists eight; again all nine; again none', async ({ page }) => {
  await open(page);
  await openFilterSheet(page);
  const regime = chipIn(page, 'regime', 'gut');
  const gut = REGIME_NINE.gut.map(String);
  const sumNine = gut.reduce((t, c) => t + countOf({}, 'crystal', c), 0);
  await expect(regime).toHaveAttribute('aria-label', `All GUT, ${sumNine} tracks`);
  await tapChip(page, 'regime', 'gut');
  await expect(regime).toHaveAttribute('aria-pressed', 'true');
  for (const c of gut) await expect(chipIn(page, 'crystal', c)).toHaveAttribute('aria-pressed', 'true');
  await expect(chipIn(page, 'crystal', '1206')).toHaveAttribute('aria-pressed', 'false');
  await expect(sheetCount(page)).toHaveText(`${expected({ crystal: gut }).length} of 30 tracks`);
  await expectCounts(page, { crystal: gut });
  await closeFilterSheet(page);
  expect(await activeChipNames(page)).toEqual(['Remove GUT']);
  await expect(filtersButton(page)).toHaveAttribute('aria-label', 'Filters, 1 on');
  await openFilterSheet(page);
  await tapChip(page, 'crystal', '528');
  await expect(regime).toHaveAttribute('aria-pressed', 'mixed');
  await closeFilterSheet(page);
  expect(await activeChipNames(page)).toEqual(gut.filter((c) => c !== '528').map((c) => `Remove ${c} Hz`));
  await expectList(page, expected({ crystal: gut.filter((c) => c !== '528') }));
  await openFilterSheet(page);
  await tapChip(page, 'regime', 'gut');
  await expect(regime).toHaveAttribute('aria-pressed', 'true');
  for (const c of gut) await expect(chipIn(page, 'crystal', c)).toHaveAttribute('aria-pressed', 'true');
  await tapChip(page, 'regime', 'gut');
  await expect(regime).toHaveAttribute('aria-pressed', 'false');
  for (const c of gut) await expect(chipIn(page, 'crystal', c)).toHaveAttribute('aria-pressed', 'false');
  await expect(sheetCount(page)).toHaveText('30 of 30 tracks');
});

// ---------------------------------------------------------------------------------------------------------------
// F5. The search and the filters together; each clears on its own.
// ---------------------------------------------------------------------------------------------------------------
test('F5. the search and the filters narrow together; Clear search keeps the chips, Clear filters keeps the search; a search alone is v15.7’s', async ({ page }) => {
  await open(page);
  await pick(page, { crystal: ['528'] });
  const field = page.getByTestId('library-search');
  await field.fill('tone-1');
  await expect(barCount(page)).toHaveText(barText(expected({ crystal: ['528'] }, 'tone-1')));
  await expectList(page, [14]);
  await page.getByRole('button', { name: 'Clear search', exact: true }).first().click();
  await expect(field).toHaveValue('');
  await expect(barCount(page)).toHaveText(barText(expected({ crystal: ['528'] })));
  expect(await activeChipNames(page), 'the chips stay').toEqual(['Remove 528 Hz']);
  await field.fill('tone-1');
  await page.getByTestId('library-clear-filters').click();
  await expect(field, 'the search stays').toHaveValue('tone-1');
  await expect(page.getByTestId('library-summary')).toHaveText('10 of 30 tracks match · a tap plays your whole library from that track');
  await expect(page.getByTestId('library-filter-actions-row')).toHaveCount(0);
  await expect(page.getByTestId('library-filter-bar')).toHaveCount(0);
  await expectList(page, expected({}, 'tone-1'));
});

// ---------------------------------------------------------------------------------------------------------------
// F6. "N of M" and Clear filters, one tap from the top of the list.
// ---------------------------------------------------------------------------------------------------------------
test('F6. "N of 30" with Clear filters at the top of the list: one tap shows all 30, today’s summary, the saved key gone, the button "Filters"', async ({ page }) => {
  await open(page);
  await pick(page, { sync: ['yes'], length: ['lt3', '3to5'] });
  await expect(filtersButton(page)).toHaveAttribute('aria-label', 'Filters, 3 on');
  await expect(page.getByTestId('library-filters-badge')).toHaveText('3');
  expect(JSON.parse((await storedFilters(page))!)).toEqual({ v: 1, f: { length: ['lt3', '3to5'], sync: ['yes'] } });
  const top = await page.getByTestId('library-filter-bar').boundingBox();
  const scroller = await page.getByTestId('library-scroll').boundingBox();
  expect(top!.y - scroller!.y, 'the bar opens the list').toBeLessThan(2);
  await page.getByTestId('library-clear-filters').click();
  await expect(page.getByTestId('library-summary')).toContainText('30 tracks');
  await expectList(page, Array.from({ length: N }, (_, k) => k));
  expect(await storedFilters(page), 'the key is removed').toBeNull();
  await expect(filtersButton(page)).toHaveAttribute('aria-label', 'Filters');
  await expect(page.getByTestId('library-filters-badge')).toHaveCount(0);
  await expect(page.getByTestId('library-health')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------------------------
// F7. Saved across a reload (the chips, not the search); anything unreadable is no filters, and nothing is written.
// ---------------------------------------------------------------------------------------------------------------
test('F7. the picks come back after a reload (the chips, "N of 30", the badge), the search doesn’t; a hostile saved value is no filters, no error, no write @mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await open(page);
  await openLibraryTab(page);
  await page.getByTestId('library-search').fill('tone');
  await pick(page, { crystal: ['528', '639'], length: ['lt3'] });
  expect(await storedFilters(page), 'the chips alone are saved, never the search').toBe('{"v":1,"f":{"crystal":["528","639"],"length":["lt3"]}}');
  await page.reload();
  await launch(page);
  await openLibraryTab(page);
  await expect(page.getByTestId('library-search')).toHaveValue('');
  expect(await activeChipNames(page)).toEqual(['Remove 528 Hz', 'Remove 639 Hz', 'Remove Under 3 min']);
  await expect(barCount(page)).toHaveText(barText(expected({ crystal: ['528', '639'], length: ['lt3'] })));
  await expect(page.getByTestId('library-filters-badge')).toHaveText('3');
  expect(await filterWrites(page), 'a load writes nothing').toEqual([]);
  const HOSTILE = [
    'not json',
    '{"v":2,"f":{"crystal":["528"]}}',
    '{"v":1,"f":{"crystal":["other"]}}',
    '{"v":1,"f":{"confidence":["na"]}}',
    '{"v":1,"f":["528"]}',
    '{"v":1,"f":{"crystal":"528"}}',
    `{"v":1,"f":{"crystal":[${Array.from({ length: 40 }, () => '"528"').join(',')}]}}`,
  ];
  for (const raw of HOSTILE) {
    await page.evaluate(({ k, raw }) => localStorage.setItem(k, raw), { k: FILTERS_KEY, raw });
    await page.reload();
    await launch(page);
    await openLibraryTab(page);
    await expect(filtersButton(page), raw).toHaveAttribute('aria-label', 'Filters');
    await expect(page.getByTestId('library-summary')).toContainText('30 tracks');
    expect(await filterWrites(page), `${raw}: nothing written`).toEqual([]);
    expect(await storedFilters(page), `${raw}: left as it was`).toBe(raw);
  }
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// F8. Filters never change the library: every op × 3 against 30 stored tones.
// ---------------------------------------------------------------------------------------------------------------
test('F8. every filter op × 3 (pick, remove, regime, Clear, reload, the sheet, Play these, Shuffle, a row, Undo, Play next, Add to queue, Save): the library, its records and audio untouched', async ({ page }) => {
  test.setTimeout(300_000);
  await countBlobSaves(page);
  const ids = await open(page, { readable: true });
  await openLibraryTab(page);
  // The Mixes tab's counts and the switch's, with nothing picked.
  const switchTracks = () => page.getByTestId('library-view-tracks').innerText();
  const tracksBefore = await switchTracks();
  await tab(page, 'mixes');
  const mixesBefore = await page.getByTestId('tab-mixes').innerText();
  await openLibraryTab(page);
  await page.waitForTimeout(2500); // the restore's own saves settle
  const base = await cacheCounts(page);
  const metaBefore = await metaRecords(page);
  // The store log and the blob-save counter are per page: gathered before each reload, re-based after it settles.
  const log: string[] = [];
  let blobRuns = 0;
  let blobBase = await page.evaluate(() => (window as any).__blobSaveRuns as number);
  await page.evaluate(() => { (window as any).__storeLog.length = 0; });
  const harvest = async () => {
    log.push(...(await storeLog(page)));
    blobRuns += (await page.evaluate(() => (window as any).__blobSaveRuns as number)) - blobBase;
  };
  let saves = 0;
  for (let round = 0; round < 3; round++) {
    // pick, remove (the chip's ×), regime, Clear
    await pick(page, { crystal: ['528', '639'] });
    await page.getByRole('button', { name: 'Remove 639 Hz', exact: true }).click();
    await pick(page, { length: ['lt3', '3to5', '5to10'] });
    await openFilterSheet(page);
    await tapChip(page, 'regime', 'gut');
    await closeFilterSheet(page);
    await expect(switchTracks(), 'the switch still counts the library').resolves.toBe(tracksBefore);
    await tab(page, 'mixes');
    expect(await page.getByTestId('tab-mixes').innerText(), 'the Mixes tab sees every track').toBe(mixesBefore);
    await openLibraryTab(page);
    await page.getByTestId('library-clear-filters').click();
    // reload with filters on; the sheet open and closed
    await pick(page, { confidence: ['strong', 'partial'] });
    await harvest();
    await page.reload();
    await launch(page);
    await page.waitForTimeout(2500); // the restore's own reads settle
    blobBase = await page.evaluate(() => (window as any).__blobSaveRuns as number);
    await openLibraryTab(page);
    await openFilterSheet(page);
    await page.keyboard.press('Escape');
    await expect(filterSheet(page)).toHaveCount(0);
    // Play these, Shuffle, a row, Undo
    const shown = expected({ confidence: ['strong', 'partial'] });
    await page.getByTestId('library-play-these').click();
    await expect.poll(async () => (await fstate(page)).ids).toEqual(idsOf(ids, shown));
    await page.getByTestId('library-shuffle-these').click();
    await expect.poll(async () => (await fstate(page)).shuffle).toBe(true);
    await undoButton(page).click();
    await expect.poll(async () => (await fstate(page)).shuffle).toBe(false);
    await libraryRowButton(page, toneName(shown[2])).click();
    await expect.poll(() => heard(page)).toBe(toneName(shown[2]));
    await undoButton(page).click();
    // Play next, Add to queue, Save as a playlist
    for (const a of ['next', 'queue'] as const) {
      await page.getByTestId('library-filter-more').click();
      await page.getByTestId(`filter-action-${a}`).click();
      await expect(toastText(page)).toContainText('from your filters');
    }
    await page.getByTestId('library-filter-more').click();
    await page.getByTestId('filter-action-save').click();
    const d = page.getByRole('dialog', { name: 'Save as a playlist' });
    await d.getByLabel('Name').fill(`Filtered ${round}`);
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    saves++;
    await expect(page.getByText(`Saved Filtered ${round}: 12 tracks.`)).toBeVisible();
    await page.getByTestId('library-clear-filters').click();
    // The queue cleared (Up next's Clear): the next round's Play these starts from no queue (a new order carries it).
    await page.evaluate(() => (window as any).__tap(() => (window as any).__aetheriaQueue.edit({ clear: true })));
    await expect.poll(async () => (await qstate(page)).waiting.length).toBe(0);
  }
  await page.waitForTimeout(2500); // the play order's debounced save
  await harvest();
  const after = await cacheCounts(page);
  expect([after.blobs, after.meta, after.library, after.analysed, after.keyed, after.envVisual, after.envScan, after.failedMarks], 'the stored library').toEqual([base.blobs, base.meta, base.library, base.analysed, base.keyed, base.envVisual, base.envScan, base.failedMarks]);
  expect((await savedState(page)).originalOrder, 'the library’s order').toEqual(ids);
  expect(await metaRecords(page), 'every metadata record as it was').toEqual(metaBefore);
  const kinds: Record<string, number> = {};
  for (const l of log) kinds[l.replace(/\(.*/, '')] = (kinds[l.replace(/\(.*/, '')] ?? 0) + 1;
  test.info().annotations.push({ type: 'store writes over the three rounds', description: JSON.stringify(kinds) });
  // As v16.0's Q8: no audio written or deleted, no record deleted. The play order's saves (v16.0.1's saveMetaAndState)
  // rewrite every metadata record as it is, so meta puts happen; the records are byte for byte as they were (above).
  expect(log.filter((l) => /^blobs\./.test(l)), 'no audio write').toEqual([]);
  expect(log.filter((l) => /^meta\.(delete|clear|add)/.test(l)), 'no metadata record deleted or added').toEqual([]);
  expect(log.filter((l) => /^meta\.put/.test(l)).filter((l) => !ids.includes(l.slice('meta.put('.length, -1))), 'metadata puts only of library tracks').toEqual([]);
  expect(log.filter((l) => l.startsWith('playlist-state.') && !/^playlist-state\.put\((current|pl:p[a-z0-9]+)\)$/.test(l)), 'the state store: the play order and the saves only').toEqual([]);
  expect(log.filter((l) => /^playlist-state\.put\(pl:/.test(l)).length, 'one playlist put per Save').toBe(saves);
  expect(blobRuns, 'no blob save ran').toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// F12. Play next / Add to queue, 12 tracks; a write while a start is in flight lands after it.
// ---------------------------------------------------------------------------------------------------------------
test('F12. Play next and Add to queue put the 12 shown, in list order, right after the playing track / after the 2 waiting; one Undo removes them; Up next lists them; a write during a start lands after it @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  const ids = await open(page);
  const twelve = expected({ confidence: ['strong', 'partial'] });
  expect(twelve.length).toBe(12);
  // A start in flight (tone-10 has no crystal: its tap decodes it, held), then Play next of the 12.
  await playLibraryFrom(page, 2);
  await page.evaluate(() => { (window as any).__holdDecode = true; });
  await libraryRowButton(page, toneName(9)).click();
  await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
  await pick(page, { confidence: ['strong', 'partial'] });
  await page.getByTestId('library-filter-more').click();
  await expect(page.getByTestId('filter-action-next')).toContainText('All 12, right after the track that’s playing, in this order');
  await page.getByTestId('filter-action-next').click();
  // (The write goes in at once after the tapped track's recorded entry, or waits for the start to land: v16.0's
  // anchor rule. Either way it lands after the tapped track.)
  await page.waitForTimeout(400);
  await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
  await expect.poll(() => heard(page)).toBe(toneName(9));
  await expect.poll(async () => (await fstate(page)).ids, { message: 'the 12 right after the tapped track' }).toEqual([...ids.slice(0, 10), ...idsOf(ids, twelve), ...ids.slice(10)]);
  await expect.poll(async () => (await fstate(page)).cursor, { message: 'the tapped track is current' }).toBe(9);
  await expect(toastText(page)).toContainText('Playing next: 12 tracks from your filters.');
  expect((await qstate(page)).waitingNames).toEqual(twelve.map(toneName));
  // One Undo removes all 12.
  await undoButton(page).click();
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'Undo removes all 12' }).toBe(0);
  expect((await fstate(page)).ids).toEqual(ids);
  // Two waiting, then Add to queue: after them, in list order.
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), [ids[27], ids[28]]);
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(2);
  // Newest first: the list's order is the library's reversed, and the queue takes the list's.
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('newest');
  const listed = [...twelve].reverse();
  await expectList(page, listed, 'the 12, newest first');
  await page.getByTestId('library-filter-more').click();
  await expect(page.getByTestId('filter-action-queue')).toContainText('All 12, after the 2 tracks waiting in your queue');
  await page.getByTestId('filter-action-queue').click();
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'after the 2, in the list’s order' }).toEqual([27, 28, ...listed].map(toneName));
  await expect(toastText(page)).toContainText('Added 12 tracks from your filters to your queue.');
  // Up next lists them.
  await tab(page, 'now');
  await page.getByTestId('np-upnext').click();
  await expect.poll(() => page.getByTestId('queue-row').locator('[data-row-title]').allTextContents()).toEqual([27, 28, ...listed].map(toneName));
  await page.keyboard.press('Escape');
  await undoButton(page).click();
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'Undo removes the 12, the 2 stay' }).toEqual([27, 28].map(toneName));
});

// ---------------------------------------------------------------------------------------------------------------
// F13. Save as a playlist (a snapshot) and Add to a playlist.
// ---------------------------------------------------------------------------------------------------------------
async function plRecords(page: Page): Promise<any[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all: any[] = await new Promise((resolve, reject) => {
      const q = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').getAll(IDBKeyRange.bound('pl:', 'pl;', false, true));
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    db.close();
    return all;
  });
}
test('F13. Save as a playlist: the filters’ name and the snapshot sentence; one record of the shown ids in order, from the filters; later picks leave it; Add to a playlist… opens on "12 tracks"', async ({ page }) => {
  const ids = await open(page);
  await pick(page, { confidence: ['strong', 'partial'] });
  const twelve = expected({ confidence: ['strong', 'partial'] });
  await page.getByTestId('library-filter-more').click();
  await page.getByTestId('filter-action-save').click();
  const d = page.getByRole('dialog', { name: 'Save as a playlist' });
  await expect(d.getByLabel('Name')).toHaveValue('Key clear · Key partly clear');
  await expect(d.getByTestId('playlist-name-sentence')).toHaveText('The 12 tracks your filters show, in the list’s order. The playlist keeps these 12; it won’t change when your filters or your library do.');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved Key clear · Key partly clear: 12 tracks.')).toBeVisible();
  await expect.poll(async () => (await plRecords(page)).length).toBe(1);
  const [r] = await plRecords(page);
  expect(r.entries.map((e: any) => e.id), 'the shown ids, in the list’s order').toEqual(idsOf(ids, twelve));
  expect(r.from).toEqual({ kind: 'filter', label: 'Key clear · Key partly clear' });
  // Other picks afterwards: the playlist is a snapshot.
  await page.getByTestId('library-clear-filters').click();
  await pick(page, { crystal: ['528'] });
  await page.waitForTimeout(500);
  expect((await plRecords(page))[0].entries.map((e: any) => e.id)).toEqual(idsOf(ids, twelve));
  await page.getByTestId('library-clear-filters').click();
  // Add to a playlist… for the 12.
  await pick(page, { confidence: ['strong', 'partial'] });
  await page.getByTestId('library-filter-more').click();
  await page.getByTestId('filter-action-playlist').click();
  const sheet = page.getByRole('dialog', { name: 'Add to playlist' });
  await expect(sheet).toContainText('12 tracks');
  await sheet.getByTestId('playlist-add-row').filter({ hasText: 'Key clear · Key partly clear' }).click();
  await expect.poll(async () => (await plRecords(page))[0].entries.length, { message: 'the 12 added again (repeats allowed)' }).toBe(24);
});

// ---------------------------------------------------------------------------------------------------------------
// F14. The empty result and its way out.
// ---------------------------------------------------------------------------------------------------------------
test('F14. an impossible pair shows "0 of 30", the card, and the facet whose removal helps most; Remove shows its tracks; with none helping, only Clear filters (and Clear search with a search)', async ({ page }) => {
  await open(page);
  await pick(page, { crystal: ['4212'], length: ['ge10'] });
  await expect(barCount(page)).toHaveText('0 of 30 tracks');
  const card = page.getByTestId('library-filter-empty');
  await expect(card).toContainText('No tracks match these filters');
  const withoutCrystal = expected({ length: ['ge10'] }).length;
  const withoutLength = expected({ crystal: ['4212'] }).length;
  expect(withoutCrystal).toBeGreaterThan(withoutLength);
  await expect(card).toContainText(`Without “4212 Hz”, ${withoutCrystal} tracks match.`);
  await expect(page.getByTestId('library-filter-actions-row'), 'no actions on nothing').toHaveCount(0);
  // All GUT with "Length not read yet" (tone-30, no crystal): clearing the length helps most, not the crystal.
  await page.getByTestId('library-clear-filters').click();
  await openFilterSheet(page);
  await tapChip(page, 'regime', 'gut');
  await tapChip(page, 'length', 'unknown');
  await closeFilterSheet(page);
  await expect(barCount(page)).toHaveText('0 of 30 tracks');
  const gut = expected({ crystal: REGIME_NINE.gut.map(String) }).length;
  expect(gut).toBeGreaterThan(expected({ length: ['unknown'] }).length);
  await expect(card).toContainText(`Without “Length not read yet”, ${gut} tracks match.`);
  await page.getByTestId('library-clear-filters').click();
  await pick(page, { crystal: ['4212'], length: ['ge10'] });
  await page.getByTestId('library-filter-remove').click();
  await expect(barCount(page)).toHaveText(barText(expected({ length: ['ge10'] })));
  await expectList(page, expected({ length: ['ge10'] }));
  // Three facets, none of whose removal helps: no hint.
  await page.getByTestId('library-clear-filters').click();
  await pick(page, { crystal: ['4212'], length: ['ge10'], scan: ['failed'] });
  await expect(card).toContainText('No tracks match these filters');
  await expect(page.getByTestId('library-filter-remove')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Clear filters', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Clear search', exact: true })).toHaveCount(0);
  await page.getByTestId('library-search').fill('zzz');
  await expect(card).toContainText('No tracks match ‘zzz’ with these filters');
  await expect(card.getByRole('button', { name: 'Clear search', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByTestId('library-search')).toHaveValue('zzz');
  await expect(page.getByTestId('library-no-results')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------------------------
// F15. Renders and cost.
// ---------------------------------------------------------------------------------------------------------------
test('F15. 3 s of playback with filters on, and with the sheet open, renders none of the filter views or rows; a chip tap renders App 0 times', async ({ page }) => {
  await open(page, { seconds: 20 });
  await playLibraryFrom(page, 0);
  await pick(page, { sync: ['yes'], length: ['lt3', '3to5'] });
  await page.waitForTimeout(1500);
  await resetRenders(page);
  await page.waitForTimeout(3000);
  const r = await renders(page);
  test.info().annotations.push({ type: 'renders, 3 s, filtered', description: JSON.stringify(r) });
  for (const v of ['LibraryTab', 'ActiveChips', 'LibraryRow', 'LibraryList', 'SearchSortRow']) expect.soft(r[v] ?? 0, `${v} renders, filtered`).toBe(0);
  await openFilterSheet(page);
  await page.waitForTimeout(1000);
  await resetRenders(page);
  await page.waitForTimeout(3000);
  const s = await renders(page);
  test.info().annotations.push({ type: 'renders, 3 s, the sheet open', description: JSON.stringify(s) });
  for (const v of ['LibraryTab', 'FilterSheet', 'FacetChip', 'ActiveChips', 'LibraryRow']) expect.soft(s[v] ?? 0, `${v} renders, the sheet open`).toBe(0);
  expect.soft(s.MiniProgress ?? 0, 'the clock kept going').toBeGreaterThan(0);
  // A chip tap: App does not render. Paused first: while the music plays, App commits a few times a second on its own
  // (the clock), which a tap's window can catch.
  await page.keyboard.press('Escape');
  await expect(filterSheet(page)).toHaveCount(0);
  await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
  await openFilterSheet(page);
  await page.waitForTimeout(800);
  await resetRenders(page);
  await tapChip(page, 'crystal', '528');
  await expect(chipIn(page, 'crystal', '528')).toHaveAttribute('aria-pressed', 'true');
  const t = await renders(page);
  expect(t.App ?? 0, 'App renders for a chip tap').toBe(0);
  expect(t.FilterSheet ?? 0, 'the sheet renders for it').toBeGreaterThan(0);
});

test('F15b. at 1,000 tracks: a chip tap costs at most 4 plain keystrokes of script (≤ 16 ms in production: the budget probe); typing with filters on costs ≤ 2 ms a key more than without; no long task over 50 ms', async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(ON_DEVICE, 'the phone’s budget is D-F1’s');
  await openSeededNewLayout(page, 1000, { real: 4, crystals: 'some', keys: true, envelopes: true });
  await page.setViewportSize(PHONE_VIEWPORT);
  await openLibraryTab(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const script = async () => ((await cdp.send('Performance.getMetrics')).metrics.find((m: any) => m.name === 'ScriptDuration')?.value ?? 0) * 1000;
  await page.evaluate(() => {
    const w = window as any;
    w.__longTasks = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  // Long tasks are watched in the measured windows only (typing, the chip tap): opening the sheet the first time mounts
  // its chips, which the dev server's React does slowly and the spec does not bound.
  const watched: number[] = [];
  const watch = () => page.evaluate(() => { (window as any).__longTasks.length = 0; });
  const harvest = async () => { watched.push(...(await page.evaluate(() => (window as any).__longTasks.slice() as number[]))); };
  const typeSix = async () => {
    const field = page.getByTestId('library-search');
    await field.fill('');
    await page.waitForTimeout(400);
    await watch();
    const t0 = await script();
    for (const ch of 'tone-0') {
      await field.press(ch === '-' ? 'Minus' : ch);
      await page.waitForTimeout(400);
    }
    const per = ((await script()) - t0) / 6;
    await harvest();
    await field.fill('');
    await page.waitForTimeout(400);
    return per;
  };
  const plain = await typeSix();
  await pick(page, { crystal: ['528', '639', '852'], length: ['lt3', '3to5'] });
  const filtered = await typeSix();
  await openFilterSheet(page);
  await page.waitForTimeout(400);
  await watch();
  const c0 = await script();
  await tapChip(page, 'sync', 'yes');
  await expect(chipIn(page, 'sync', 'yes')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  const chipMs = (await script()) - c0;
  await harvest();
  const tasks = watched;
  test.info().annotations.push({ type: 'cost at 1,000', description: JSON.stringify({ plainPerKey: plain.toFixed(2), filteredPerKey: filtered.toFixed(2), chipMs: chipMs.toFixed(2), tasks }) });
  // The dev server's React costs several times production's (measured: a chip tap 25-29 ms here, 2.5-4.6 ms in the production
  // build at 1× CPU, scratchpad v162/build/filter-budget.mjs), so the bound here is relative to this run's own keystroke.
  expect(chipMs, 'a chip tap’s script (ms), against 4 plain keystrokes').toBeLessThanOrEqual(Math.max(16, 4 * plain));
  expect(filtered, 'a key with filters on (ms of script)').toBeLessThanOrEqual(plain + 2);
  expect(Math.max(0, ...tasks), 'no long task over 50 ms').toBeLessThanOrEqual(50);
  await cdp.detach();
});

// ---------------------------------------------------------------------------------------------------------------
// F16. Accessibility.
// ---------------------------------------------------------------------------------------------------------------
test('F16. names with counts, aria-pressed (mixed too), 44 × 44 targets, the live count; Escape and the scrim close the sheet back to Filters; removing the last chip focuses Filters @mobile', async ({ page }) => {
  await open(page);
  await openLibraryTab(page);
  await expect(filtersButton(page)).toHaveAttribute('aria-label', 'Filters');
  const fb = (await filtersButton(page).boundingBox())!;
  expect([Math.round(fb.width), Math.round(fb.height)]).toEqual([44, 44]);
  await openFilterSheet(page);
  await expect(filterSheet(page)).toHaveAttribute('aria-modal', 'true');
  await expect(sheetCount(page)).toHaveAttribute('aria-live', 'polite');
  await expect(chipIn(page, 'crystal', '528')).toHaveAttribute('aria-label', `528 Hz, ${countOf({}, 'crystal', '528')} tracks`);
  await expect(chipIn(page, 'length', 'lt3')).toHaveAttribute('aria-pressed', 'false');
  await expect(filterSheet(page).getByRole('group', { name: 'Assigned crystal' })).toBeVisible();
  await expect(filterSheet(page).getByRole('group', { name: 'Key confidence' })).toBeVisible();
  // Every chip's target is 44 px tall (its ::after box) and at least 44 wide.
  const small = await page.getByTestId('library-filters').locator('button').evaluateAll((bs) =>
    bs
      .map((el) => {
        const r = el.getBoundingClientRect();
        const a = getComputedStyle(el, '::after');
        const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
        const h = a.content && a.content !== 'none' && a.position === 'absolute' ? Math.max(r.height, r.height - px(a.top) - px(a.bottom)) : r.height;
        return r.width < 43.5 || h < 43.5 ? `${el.getAttribute('aria-label') ?? el.textContent}: ${Math.round(r.width)}×${Math.round(h)}` : '';
      })
      .filter(Boolean)
  );
  expect(small, 'targets under 44 × 44').toEqual([]);
  await tapChip(page, 'regime', 'gut');
  await tapChip(page, 'crystal', '528');
  await expect(chipIn(page, 'regime', 'gut')).toHaveAttribute('aria-pressed', 'mixed');
  await expect(sheetCount(page)).toHaveText(`${expected({ crystal: REGIME_NINE.gut.filter((c) => c !== 528).map(String) }).length} of 30 tracks`);
  // Escape closes it, the focus back on Filters.
  await page.keyboard.press('Escape');
  await expect(filterSheet(page)).toHaveCount(0);
  await expect(filtersButton(page)).toBeFocused();
  await expect(filtersButton(page)).toHaveAttribute('aria-label', 'Filters, 8 on');
  // The scrim closes it too.
  await filtersButton(page).click();
  await filterSheet(page).waitFor();
  await page.mouse.click(200, 30);
  await expect(filterSheet(page)).toHaveCount(0);
  await expect(filtersButton(page)).toBeFocused();
  // Removing a chip focuses the next; the last one, Filters.
  await page.getByTestId('library-clear-filters').click();
  await pick(page, { crystal: ['528', '639'] });
  await page.getByRole('button', { name: 'Remove 528 Hz', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove 639 Hz', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Remove 639 Hz', exact: true }).click();
  await expect(filtersButton(page)).toBeFocused();
  await expect(filtersButton(page)).toHaveAttribute('aria-label', 'Filters');
});

// ---------------------------------------------------------------------------------------------------------------
// F17. Crash drills.
// ---------------------------------------------------------------------------------------------------------------
test('F17. crash drills: the sheet’s body, the bar, the ⋯ sheet: the music plays on, and Reload panel brings each back', async ({ page }) => {
  await open(page, { seconds: 30 });
  await playLibraryFrom(page, 0);
  const playingOn = () => expect.poll(() => page.evaluate(() => { const e = (window as any).__el; return !!e && !e.paused; }), { message: 'the music plays on' }).toBe(true);
  await pick(page, { sync: ['yes'] });
  await crash(page, 'library-filter-bar');
  await expect(page.getByTestId('library-filter-bar-fallback')).toBeVisible();
  await playingOn();
  await page.getByTestId('library-filter-bar-fallback').getByRole('button', { name: 'Reload panel', exact: true }).click();
  await expect(page.getByTestId('library-filter-bar')).toBeVisible();
  await openFilterSheet(page);
  await crash(page, 'library-filters');
  await expect(filterSheet(page).getByRole('alert')).toBeVisible();
  await playingOn();
  await filterSheet(page).getByRole('button', { name: 'Reload panel', exact: true }).click();
  await expect(filterSheet(page).getByTestId('library-filters-body')).toBeVisible();
  await closeFilterSheet(page);
  await page.getByTestId('library-filter-more').click();
  await page.getByTestId('library-filter-actions-body').waitFor();
  await crash(page, 'library-filter-actions');
  await expect(page.getByTestId('library-filter-actions').getByRole('alert')).toBeVisible();
  await playingOn();
  await page.getByTestId('library-filter-actions').getByRole('button', { name: 'Reload panel', exact: true }).click();
  await expect(page.getByTestId('library-filter-actions-body')).toBeVisible();
  expect(await heard(page)).toBe(toneName(0));
});

// ---------------------------------------------------------------------------------------------------------------
// F18. Classic: nothing new, and saved filters change nothing there.
// ---------------------------------------------------------------------------------------------------------------
test('F18. classic: no filter control; with saved filters its list and counts are as without', async ({ page }) => {
  const read = async () => {
    const rows: number[] = [];
    for (let k = 0; k < N; k++) rows.push(await page.locator('div.group').filter({ has: page.getByText(toneName(k), { exact: true }) }).count());
    return { rows, text: await page.locator('body').innerText() };
  };
  await open(page, { layout: 'classic', viewport: { width: 1280, height: 800 }, hook: false });
  const plain = await read();
  await page.evaluate((k) => localStorage.setItem(k, '{"v":1,"f":{"crystal":["528"]}}'), FILTERS_KEY);
  await page.reload();
  await launch(page, { layout: 'classic', viewport: { width: 1280, height: 800 }, hook: false });
  const saved = await read();
  expect(await page.getByTestId('library-filters-button').count(), 'no Filters button in classic').toBe(0);
  expect(await page.getByText('Clear filters', { exact: true }).count()).toBe(0);
  expect(saved.rows, 'the same rows').toEqual(plain.rows);
  expect(plain.rows.filter((n) => n >= 1).length, 'classic lists the tones').toBeGreaterThanOrEqual(20);
  for (const k of [0, 4, 5, 29]) expect(saved.text.includes(toneName(k)), `${toneName(k)} listed`).toBe(plain.text.includes(toneName(k)));
  expect(saved.text.match(/\b30\b/g)?.length ?? 0, 'the counts').toBe(plain.text.match(/\b30\b/g)?.length ?? 0);
});

// ---------------------------------------------------------------------------------------------------------------
// F19. Desktop: the panel, the centred modal sheet, the transport's source line.
// ---------------------------------------------------------------------------------------------------------------
test('F19. desktop: the Filters button, the chips and the actions in the 420 px panel; the sheet centred and modal; after Play these the transport names the track and Up next "your play order"', async ({ page }) => {
  await open(page, { viewport: { width: 1280, height: 800 } });
  await tab(page, 'library');
  const panel = page.getByTestId('desktop-panel');
  await expect(panel.getByTestId('library-filters-button')).toBeVisible();
  await panel.getByTestId('library-filters-button').click();
  const sheet = filterSheet(page);
  await sheet.getByTestId('library-filters-body').waitFor();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  const b = (await sheet.boundingBox())!;
  expect(Math.abs(b.x + b.width / 2 - 640), 'centred across').toBeLessThan(2);
  expect(b.y, 'not a bottom sheet').toBeGreaterThan(10);
  expect(b.y + b.height).toBeLessThan(800 - 10);
  await tapChip(page, 'crystal', '528');
  await tapChip(page, 'crystal', '639');
  await closeFilterSheet(page);
  await expect(panel.getByTestId('library-filter-bar')).toBeVisible();
  expect(await activeChipNames(page)).toEqual(['Remove 528 Hz', 'Remove 639 Hz']);
  await panel.getByTestId('library-play-these').click();
  await expect.poll(() => heard(page)).toBe(toneName(4));
  await expect(page.getByTestId('desktop-title')).toHaveText(toneName(4));
  await page.getByTestId('desktop-queue').click();
  await expect(page.getByRole('region', { name: 'Up next' })).toContainText('Nothing queued · your play order plays on');
});

// ---------------------------------------------------------------------------------------------------------------
// F20. The saved key is written from a tap only.
// ---------------------------------------------------------------------------------------------------------------
test('F20. the saved filters are written only by a tap: a reload with saved filters, the sheet opened and closed, typing and sorting write nothing; each chip tap writes once', async ({ page }) => {
  await open(page, { filters: '{"v":1,"f":{"crystal":["528","639"]}}' });
  await openLibraryTab(page);
  expect(await activeChipNames(page)).toEqual(['Remove 528 Hz', 'Remove 639 Hz']);
  await openFilterSheet(page);
  await page.keyboard.press('Escape');
  await page.getByTestId('library-search').fill('tone-1');
  await page.getByTestId('library-search').fill('');
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('name');
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('library');
  await page.waitForTimeout(500);
  expect(await filterWrites(page), 'nothing written without a tap').toEqual([]);
  await openFilterSheet(page);
  await tapChip(page, 'length', 'lt3');
  await expect.poll(() => filterWrites(page)).toEqual(['set {"v":1,"f":{"crystal":["528","639"],"length":["lt3"]}}']);
  await tapChip(page, 'crystal', '528');
  await expect.poll(async () => (await filterWrites(page)).length).toBe(2);
  await tapChip(page, 'regime', 'heart');
  await expect.poll(async () => (await filterWrites(page)).length).toBe(3);
  await closeFilterSheet(page);
  await page.waitForTimeout(500);
  expect((await filterWrites(page)).length, 'one write per tap').toBe(3);
  await page.getByTestId('library-clear-filters').click();
  await expect.poll(async () => (await filterWrites(page)).slice(-1)).toEqual(['remove']);
  expect((await filterWrites(page)).length).toBe(4);
});

// ---------------------------------------------------------------------------------------------------------------
// F21. A large library with no analysis: the Key group is one line; values not held are not offered.
// ---------------------------------------------------------------------------------------------------------------
test('F21. 1,000 tracks, none analysed: the Key group is one line and no key chip is offered; "Length not read yet" only appears with an unknown length', async ({ page }) => {
  test.setTimeout(240_000);
  await openSeededNewLayout(page, 1000, { real: 4, crystals: 'some' });
  await page.setViewportSize(PHONE_VIEWPORT);
  await openFilterSheet(page);
  await expect(page.getByTestId('filters-no-keys')).toHaveText('No keys yet. Analyse tracks, in the health card, finds them.');
  expect(await page.getByTestId('library-filters').locator('button[data-facet="key"]').count(), 'no key chip').toBe(0);
  expect(await page.getByTestId('library-filters').locator('button[data-facet="confidence"]').count(), 'no confidence chip').toBe(0);
  await expect(chipIn(page, 'key', 'unanalysed')).toHaveCount(0);
  await expect(chipIn(page, 'length', 'unknown'), 'every length is known').toHaveCount(0);
  await expect(chipIn(page, 'scan', 'failed'), 'no failed scan').toHaveCount(0);
  await expect(chipIn(page, 'crystal', 'none')).toBeVisible();
  for (const c of REGIME_NINE.head) await expect(chipIn(page, 'crystal', String(c))).toBeVisible();
});

test('F21b. a track whose length can’t be read: "Length not read yet" is offered, and it finds it', async ({ page }) => {
  await open(page);
  await openFilterSheet(page);
  await expect(chipIn(page, 'length', 'unknown')).toHaveAttribute('aria-label', 'Length not read yet, 1 track');
  await tapChip(page, 'length', 'unknown');
  await expectList(page, [29]);
});

// ---------------------------------------------------------------------------------------------------------------
// F9u-F11u. The same through the UI: Play these, Shuffle, a row's tap while filtered.
// ---------------------------------------------------------------------------------------------------------------
test('F9u-F11u. through the UI: Play these plays the shown rows from the first; Shuffle turns the switch on, least recently played first; a row’s tap plays the shown rows from it @mobile', async ({ page }) => {
  const ids = await open(page);
  await pick(page, { crystal: ['528', '639'] });
  const shown = expected({ crystal: ['528', '639'] });
  const set = idsOf(ids, shown);
  await expect(page.getByTestId('library-filter-hint')).toHaveText('A tap plays these 6, from that track.');
  // A row's tap (decision 1 A): the six, from that row.
  await libraryRowButton(page, toneName(15)).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'a row: the six' }).toEqual(set);
  expect((await fstate(page)).cursor).toBe(shown.indexOf(15));
  await expect.poll(() => heard(page)).toBe(toneName(15));
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show, from this one.');
  expect((await fstate(page)).label).toBe('528 Hz · 639 Hz');
  // Play these: from the first.
  await page.getByTestId('library-play-these').click();
  await expect.poll(async () => (await fstate(page)).cursor, { message: 'Play these: from the first' }).toBe(0);
  expect((await fstate(page)).ids).toEqual(set);
  await expect.poll(() => heard(page)).toBe(toneName(shown[0]));
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show.');
  await tab(page, 'now');
  await expect(page.getByTestId('np-source')).toHaveText('Play order · 1 of 6');
  await openLibraryTab(page);
  // Shuffle: five of the six have played or are playing; tone-26 never has.
  for (const k of [5, 14, 24]) {
    await libraryRowButton(page, toneName(k)).click();
    await expect.poll(() => heard(page)).toBe(toneName(k));
  }
  expect((await fstate(page)).shuffle).toBe(false);
  await page.getByTestId('library-shuffle-these').click();
  await expect.poll(async () => (await fstate(page)).shuffle, { message: 'Shuffle turns the switch on' }).toBe(true);
  const s = await fstate(page);
  expect(s.ids).toEqual(set);
  expect(s.ids[s.cursor], 'the least recently played first').toBe(ids[25]);
  await expect(toastText(page)).toContainText('Shuffling the 6 tracks your filters show. Shuffle is on.');
});

// ===============================================================================================================
// v16.2 review fixes
// ===============================================================================================================

// R1. A tap's toast says what plays NOW (review P1, P2). Only taps of one kind chain (a row's tap while filtered, a
// Library row's tap with no chip on, a mix's), and a chained tap's toast is its own: a filtered set's count, its own
// queue sentence; a Library row's chain keeps its first tap's words (what the chain stopped), with its own queue sentence.
test('R1a. review P1: a filtered row’s tap, Clear filters, then a plain row’s tap within the toast’s 10 s: the whole library plays and its toast says so; its Undo goes back to the filtered set @mobile', async ({ page }) => {
  const ids = await open(page);
  const shown = expected({ crystal: ['528', '639'] });
  const set = idsOf(ids, shown);
  await pick(page, { crystal: ['528', '639'] });
  await libraryRowButton(page, toneName(14)).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'the six' }).toEqual(set);
  await expect.poll(() => heard(page)).toBe(toneName(14));
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show, from this one.');
  await page.getByTestId('library-clear-filters').click();
  await expect(page.getByTestId('library-filter-bar')).toHaveCount(0);
  await libraryRowButton(page, toneName(2)).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'the whole library' }).toEqual(ids);
  expect((await fstate(page)).cursor).toBe(2);
  await expect.poll(() => heard(page)).toBe(toneName(2));
  await expect(toastText(page), 'the whole library, not the six').toContainText('Playing your library from this track. The earlier play order stopped.');
  await expect(toastText(page)).not.toContainText('your filters show');
  // Its own Undo (a plain row's tap doesn't chain with a filtered one): the six again, tone-15.
  await undoButton(page).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'Undo: the six' }).toEqual(set);
  expect((await fstate(page)).cursor).toBe(shown.indexOf(14));
  await expect.poll(() => heard(page)).toBe(toneName(14));
});

test('R1b. review P2: a plain row’s tap, then filters picked and a filtered row’s tap within the toast’s 10 s: its toast names the six; its Undo goes back to the library @mobile', async ({ page }) => {
  const ids = await open(page);
  const shown = expected({ crystal: ['528', '639'] });
  const set = idsOf(ids, shown);
  await playLibraryFrom(page, 0);
  await libraryRowButton(page, toneName(1)).click();
  await expect.poll(() => heard(page)).toBe(toneName(1));
  await expect(toastText(page)).toContainText('Playing your library from this track.');
  await pick(page, { crystal: ['528', '639'] });
  await libraryRowButton(page, toneName(14)).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'the six' }).toEqual(set);
  expect((await fstate(page)).cursor).toBe(shown.indexOf(14));
  await expect.poll(() => heard(page)).toBe(toneName(14));
  await expect(toastText(page), 'the six, not the library').toContainText('Playing the 6 tracks your filters show, from this one.');
  await undoButton(page).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'Undo: the library' }).toEqual(ids);
  expect((await fstate(page)).cursor).toBe(1);
  await expect.poll(() => heard(page)).toBe(toneName(1));
});

test('R1c. a pick changed between two filtered row taps: the second toast counts the set it plays; one Undo goes back to before the first', async ({ page }) => {
  const ids = await open(page);
  await playLibraryFrom(page, 0);
  await pick(page, { crystal: ['528', '639'] });
  await libraryRowButton(page, toneName(14)).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'the six' }).toEqual(idsOf(ids, expected({ crystal: ['528', '639'] })));
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show, from this one.');
  await page.getByRole('button', { name: 'Remove 639 Hz', exact: true }).click();
  const three = expected({ crystal: ['528'] });
  await expect(barCount(page)).toHaveText(barText(three));
  await libraryRowButton(page, toneName(24)).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'the three' }).toEqual(idsOf(ids, three));
  expect((await fstate(page)).cursor).toBe(three.indexOf(24));
  await expect.poll(() => heard(page)).toBe(toneName(24));
  await expect(toastText(page), 'the three it plays, not the six').toContainText('Playing the 3 tracks your filters show, from this one.');
  await undoButton(page).click();
  await expect.poll(async () => (await fstate(page)).ids, { message: 'one Undo: the library, as before the first tap' }).toEqual(ids);
  expect((await fstate(page)).cursor).toBe(0);
  await expect.poll(() => heard(page)).toBe(toneName(0));
});

test('R1d. a chained tap’s queue sentence is its own: a queued track tapped second carries one, not two (a Library row’s chain, then a filtered one)', async ({ page }) => {
  const ids = await open(page);
  await playLibraryFrom(page, 0);
  const queue = (q: string[]) => page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), q);
  // A Library row's chain: tone-05 and tone-16 queued, a tap on tone-03 carries both; a tap on tone-05 plays its copy now.
  await queue([ids[4], ids[15]]);
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'two queued' }).toBe(2);
  await libraryRowButton(page, toneName(2)).click();
  await expect.poll(() => heard(page)).toBe(toneName(2));
  await expect(toastText(page)).toContainText('Playing your library from this track. Your 2 queued tracks play next.');
  await libraryRowButton(page, toneName(4)).click();
  await expect.poll(() => heard(page)).toBe(toneName(4));
  await expect(toastText(page), 'the first tap’s words, this tap’s queue').toContainText('Playing your library from this track. Your queued track plays next.');
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'tone-16 still waits' }).toEqual([toneName(15)]);
  // A filtered chain: tone-06 queued too (its toast ends the Library chain); tone-15 carries both, tone-06 then one.
  await queue([ids[5]]);
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'two queued again' }).toBe(2);
  await pick(page, { crystal: ['528', '639'] });
  await libraryRowButton(page, toneName(14)).click();
  await expect.poll(() => heard(page)).toBe(toneName(14));
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show, from this one. Your 2 queued tracks play next.');
  await libraryRowButton(page, toneName(5)).click();
  await expect.poll(() => heard(page)).toBe(toneName(5));
  await expect(toastText(page)).toContainText('Playing the 6 tracks your filters show, from this one. Your queued track plays next.');
});

// R2. Review P3: the ⋯ sheet's open flag is reset when the set empties under it, so it never opens again by itself.
test('R2. review P3: the set empties under the open ⋯ sheet (the search changed behind it): the sheet closes, and when the set comes back it stays closed', async ({ page }) => {
  await open(page);
  await pick(page, { crystal: ['528', '639'] });
  await page.getByTestId('library-filter-more').click();
  await expect(page.getByTestId('library-filter-actions-body')).toBeVisible();
  // Behind the modal sheet (inert to a finger), the search set in code: a stand-in for anything that empties the set.
  const setSearch = (v: string) =>
    page.evaluate((v) => {
      const el = document.querySelector('[data-testid="library-search"]') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
  await setSearch('zzz');
  await expect(page.getByTestId('library-filter-empty')).toBeVisible();
  await expect(page.getByTestId('library-filter-actions-body')).toHaveCount(0);
  await setSearch('');
  await expect(barCount(page)).toHaveText(barText(expected({ crystal: ['528', '639'] })));
  await page.waitForTimeout(500);
  await expect(page.getByTestId('library-filter-actions-body'), 'no ⋯ sheet without a tap').toHaveCount(0);
  // The ⋯ still opens on a tap.
  await page.getByTestId('library-filter-more').click();
  await expect(page.getByTestId('library-filter-actions-body')).toBeVisible();
});

// R3. A full storage keeps the picks for the session (spec: "a full or blocked storage keeps the filters for the
// session"): Library › Tracks remounts on every tab and Tracks ⇄ Playlists switch, and must not go back to the stale
// stored value.
test('R3. full storage: picks that could not be saved survive a tab switch and Tracks ⇄ Playlists (not the stale saved ones); a reload brings back what was saved @mobile', async ({ page }) => {
  await open(page);
  await pick(page, { crystal: ['639'] });
  expect(await storedFilters(page), 'saved while the storage works').toBe('{"v":1,"f":{"crystal":["639"]}}');
  await page.evaluate(() => { (window as any).__fullStorage = true; });
  await openFilterSheet(page);
  await tapChip(page, 'crystal', '528');
  await expect(chipIn(page, 'crystal', '528')).toHaveAttribute('aria-pressed', 'true');
  await closeFilterSheet(page);
  expect(await storedFilters(page), 'the full storage keeps the old value').toBe('{"v":1,"f":{"crystal":["639"]}}');
  const both = barText(expected({ crystal: ['528', '639'] }));
  await expect(barCount(page)).toHaveText(both);
  // Another tab and back: this view remounts.
  await tab(page, 'now');
  await expect(page.getByTestId('tab-library')).toHaveCount(0);
  await openLibraryTab(page);
  await expect(barCount(page), 'the session’s picks, after a tab switch').toHaveText(both);
  expect(await activeChipNames(page)).toEqual(['Remove 528 Hz', 'Remove 639 Hz']);
  // Playlists and back.
  await page.getByTestId('library-view-playlists').click();
  await expect(barCount(page)).toHaveCount(0);
  await page.getByTestId('library-view-tracks').click();
  await expect(barCount(page), 'the session’s picks, after Tracks ⇄ Playlists').toHaveText(both);
  // A chip's × with the storage still full: that sticks too.
  await page.getByRole('button', { name: 'Remove 639 Hz', exact: true }).click();
  await tab(page, 'now');
  await openLibraryTab(page);
  await expect(barCount(page)).toHaveText(barText(expected({ crystal: ['528'] })));
  expect(await activeChipNames(page), 'the × stuck').toEqual(['Remove 528 Hz']);
  // A reload: the session is gone; what was saved comes back.
  await page.reload();
  await launch(page);
  await openLibraryTab(page);
  await expect(barCount(page)).toHaveText(barText(expected({ crystal: ['639'] })));
  expect(await activeChipNames(page), 'after a reload, what was saved').toEqual(['Remove 639 Hz']);
});

// R4. The empty card's "Remove …" gives the focus to Filters, as Clear filters and the chips' × do (never <body>).
test('R4. the empty card’s Remove leaves the focus on Filters @mobile', async ({ page }) => {
  await open(page);
  await pick(page, { crystal: ['4212'], length: ['ge10'] });
  await expect(page.getByTestId('library-filter-empty')).toBeVisible();
  await page.getByTestId('library-filter-remove').click();
  await expect(barCount(page)).toHaveText(barText(expected({ length: ['ge10'] })));
  await expect(page.getByTestId('library-filter-empty')).toHaveCount(0);
  await expect(filtersButton(page), 'the focus on Filters, not <body>').toBeFocused();
});
