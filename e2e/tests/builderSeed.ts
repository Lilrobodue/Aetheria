import { type Locator, type Page } from '@playwright/test';
import { expect, ON_DEVICE } from './fixtures';
import { acceptDisclaimer, acceptDisclaimerNew, appUrl, libraryState, tab, tapAt, LAYER_ENGINE_KEY, LAYOUT_KEY, PHONE_VIEWPORT } from './helpers';

// v16.3, Create a mix and whole-mix queueing: the seed, the instruments and the oracles that builder.spec.ts and
// mix-queue.spec.ts share (spec §5.4, §5.5). Synthetic tones only (tone-01 … tone-30).
//
// The seed: 30 tones written straight into IndexedDB (as an earlier session would have saved them), each with the
// fields below by its index k (0-based). Crystals on every regime; 852, 5982 and 6336 have no track; tone-30 has no
// crystal. Deep Scan's scores on a sixth (k = 0, 6, 12, 18, 24). Stored lengths 150 / 240 / 420 / 700 s (the audio is a
// short tone). The oracles below read the same table with a few lines of their own, never the app's model.

export * from './builderOracle';
import { BUILDER_KEY, N, ROWS } from './builderOracle';
import type { Row } from './builderOracle';

// ---------------------------------------------------------------------------------------------------------------
// Seed, instrument, launch
// ---------------------------------------------------------------------------------------------------------------

/** The 30 tones into IndexedDB from /manifest.json; returns the ids in library order. */
export async function seedBuilder(page: Page, o: { seconds?: number; rows?: readonly Row[] } = {}): Promise<string[]> {
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
      const id = `${t0 + k * 1000}-b${String(k + 1).padStart(2, '0')}`;
      ids.push(id);
      const name = `tone-${String(k + 1).padStart(2, '0')}`;
      tx.objectStore('blobs').put({ id, fileBlob: wav(seconds, 220 + k * 11), fileName: `${name}.wav`, fileType: 'audio/wav' });
      const meta: any = { id, name, duration: row.duration };
      if (row.crystal) {
        meta.closestSolfeggio = row.crystal;
        meta.harmonicDeviation = row.dev;
        if (row.scores) {
          Object.assign(meta, { harmonicFreq: row.crystal + 2, crystalSource: 'scan' });
          meta.fractalAnalysis = {
            dominantFrequency: row.crystal + 2, harmonicSeries: [row.crystal + 2], fractalDimension: 1.4, goldenRatioAlignment: row.scores.golden,
            pattern111Presence: row.scores.p111, dnaResonanceScore: row.scores.dna, safetyLevel: 'SAFE', recommendedVolume: 0.8,
            infiniteOrderHarmonics: [], sacredGeometryAlignment: 0.2, schumannResonanceHarmony: 0.1,
          };
        } else Object.assign(meta, { harmonicFreq: row.crystal, crystalSource: 'assigned' });
      }
      tx.objectStore('meta').put(meta);
    });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    const st = db.transaction('playlist-state', 'readwrite');
    st.objectStore('playlist-state').put({ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 396, savedAt: Date.now() });
    await new Promise((resolve) => (st.oncomplete = resolve));
    db.close();
    return ids;
  }, { rows: o.rows ?? ROWS, seconds: o.seconds ?? 20 });
}

/** Before the app, on every load: the tutorial seen, classic layers, the layout; a tap wrapper; every store write with
 *  its key; every write of the builder's key; a decode held on demand; what the music element plays. `saved`: a value
 *  for the builder's key, put once before the tab's first app load (null: removed). */
export async function instrumentBuilder(page: Page, o: { layout?: 'new' | 'classic'; saved?: string | null } = {}): Promise<void> {
  await page.addInitScript(({ keys, layout, saved }) => {
    const w = window as any;
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      localStorage.setItem(keys.engine, 'classic');
      localStorage.setItem(keys.layout, layout);
      if (saved !== undefined && sessionStorage.getItem('__e2eBuilderSaved') === null) {
        sessionStorage.setItem('__e2eBuilderSaved', '1');
        if (saved === null) localStorage.removeItem(keys.builder);
        else localStorage.setItem(keys.builder, saved);
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
    w.__builderWrites = [] as string[];
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key === keys.builder) w.__builderWrites.push(`set ${value}`);
      return setItem.call(this, key, value);
    };
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (this: Storage, key: string) {
      if (key === keys.builder) w.__builderWrites.push('remove');
      return removeItem.call(this, key);
    };
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
  }, { keys: { engine: LAYER_ENGINE_KEY, layout: LAYOUT_KEY, builder: BUILDER_KEY }, layout: o.layout ?? 'new', saved: o.saved });
}

/** Load the app over the seed and wait for the library (and, with hook, the builder's dev hook). */
export async function launchBuilder(page: Page, o: { layout?: 'new' | 'classic'; viewport?: { width: number; height: number }; hook?: boolean; n?: number } = {}): Promise<void> {
  await page.setViewportSize(o.viewport ?? PHONE_VIEWPORT);
  await page.goto(appUrl('/'));
  if ((o.layout ?? 'new') === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library restores', timeout: 60_000 }).toBe(o.n ?? N);
  if (o.hook === false) return;
  await page.waitForFunction(() => typeof (window as any).__aetheriaBuilder?.start === 'function', null, { timeout: 10_000 }).catch(() => {
    throw new Error('window.__aetheriaBuilder is missing: these tests need v16.3 on the dev server');
  });
}

export async function openBuilderApp(page: Page, o: { layout?: 'new' | 'classic'; viewport?: { width: number; height: number }; hook?: boolean; saved?: string | null; seconds?: number; rows?: readonly Row[] } = {}): Promise<string[]> {
  await instrumentBuilder(page, { layout: o.layout, saved: o.saved });
  const ids = await seedBuilder(page, { seconds: o.seconds, rows: o.rows });
  await launchBuilder(page, { ...o, n: o.rows?.length ?? N });
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------
// The hooks and the page
// ---------------------------------------------------------------------------------------------------------------

/** Settings as the model takes them (utils/mix/builder.ts BuilderSettings), written out here. */
export interface Settings {
  source: { kind: 'library' } | { kind: 'playlist'; id: string } | { kind: 'queue' };
  follow: { kind: 'walk'; mode: string } | { kind: 'set'; set: string; crystals?: number[] } | { kind: 'golden' } | { kind: 'seq111' } | { kind: 'source2178' } | { kind: 'any' };
  per: 1 | 3 | 'all';
  filters: Record<string, string[]>;
  order: 'pattern' | 'low-high' | 'shuffle' | 'source';
}
export const S = (o: Partial<Settings>): Settings => ({ source: { kind: 'library' }, follow: { kind: 'set', set: 'preset:qi' }, per: 'all', filters: {}, order: 'pattern', ...o });

export interface BState { ids: string[]; cursor: number; walk: string | null; steps: number[] | null; marks: number[] | null; label: string | null; libraryIds: string[] }
export const bstate = (page: Page): Promise<BState> => page.evaluate(() => (window as any).__aetheriaBuilder.state());
/** Create a mix's start through the hook, inside a click event (a tap). */
export const startHook = (page: Page, s: Settings, mode: 'now' | 'next' | 'queue' | 'save' = 'now') =>
  page.evaluate(({ s, mode }) => (window as any).__tap(() => (window as any).__aetheriaBuilder.start(s, mode)), { s, mode });
export const queueMixHook = (page: Page, id: string, mode: 'next' | 'queue' | 'save') =>
  page.evaluate(({ id, mode }) => (window as any).__tap(() => (window as any).__aetheriaBuilder.queueMix(id, mode)), { id, mode });
export const summaryHook = (page: Page, s: Settings) => page.evaluate((s) => (window as any).__aetheriaBuilder.summary(s), s);
export const qstate = (page: Page) => page.evaluate(() => (window as any).__aetheriaQueue.state());
export const heard = (page: Page) => page.evaluate(() => (window as any).__heard() as string | null);
export const toastText = (page: Page) => page.getByTestId('notices').locator('div[aria-atomic="true"]').first();
export const undoButton = (page: Page) => page.getByTestId('notices').getByRole('button', { name: 'Undo', exact: true });
export const storeLog = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__storeLog.slice());
export const builderWrites = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__builderWrites.slice());
export const idsOf = (ids: string[], ks: readonly number[]) => ks.map((k) => ids[k]);

/** A playlist through v16.1's hook (the tones by index, in this order); returns its id. */
export async function makePlaylist(page: Page, name: string, ids: string[], ks: readonly number[]): Promise<string> {
  await expect.poll(() => page.evaluate(() => (window as any).__aetheriaPlaylists?.state()?.status), { message: 'the playlists are read' }).toBe('ready');
  const id = await page.evaluate(({ name, list }) => (window as any).__tap(() => (window as any).__aetheriaPlaylists.create(name, list)), { name, list: idsOf(ids, ks) });
  expect(typeof id, 'the playlist is made').toBe('string');
  return id as string;
}

/** A Mixes-tab mix's ⋯ (v16.3, Stage B): open its sheet in the Mixes tab and return it (named by the mix's full name). */
export async function openMixMenu(page: Page, id: string, fullName: string) {
  await tab(page, 'mixes');
  await press(page, page.getByTestId(`mix-more-${id}`));
  const menu = page.getByRole('dialog', { name: fullName, exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

/** A tap on a control: by finger on the phone (a CDP touch, tapAt's spacing), a click elsewhere. On the phone:
 *  - the control's centre must hit the control itself; if it doesn't (off screen, or under the builder's fixed footer,
 *    where a finger tap lands on the footer), it is scrolled to the middle of its scroller first (only then, so a
 *    visible control leaves its scroller where it is);
 *  - press returns only once the tap's own click has arrived on the control: under the tests' viewport emulation
 *    Android Chrome dispatches the click about 0.3 s after the touch, and a scroll or a layout change in between (the
 *    next press's scroll, a re-render) would send it to whatever moved under the finger.
 *  Callers still poll what the click does. */
export async function press(page: Page, target: Locator): Promise<void> {
  if (!ON_DEVICE) {
    await target.scrollIntoViewIfNeeded();
    await target.click();
    return;
  }
  /** The control's centre, and what covers it there (null: the control itself). Arms the click watch on the control. */
  const probe = async (): Promise<{ x: number; y: number; hit: string | null }> => {
    const b = await target.boundingBox();
    if (!b) return { x: 0, y: 0, hit: 'no box' };
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    const hit = await target.evaluate((el, p) => {
      const w = window as any;
      if (!w.__pressClicks) {
        w.__pressClicks = [] as { x: number; y: number; on: boolean }[];
        document.addEventListener('click', (e: MouseEvent) => {
          if (e.isTrusted) w.__pressClicks.push({ x: e.clientX, y: e.clientY, on: !!w.__pressTarget && (w.__pressTarget === e.target || w.__pressTarget.contains(e.target as Node)) });
        }, true);
      }
      w.__pressClicks.length = 0;
      w.__pressTarget = el;
      const at = document.elementFromPoint(p.x, p.y);
      return at && (el === at || el.contains(at)) ? null : (at ? `${at.tagName.toLowerCase()}${at.getAttribute('data-testid') ? `[data-testid=${at.getAttribute('data-testid')}]` : ''}` : 'nothing');
    }, { x, y });
    return { x, y, hit };
  };
  let { x, y, hit } = await probe();
  if (hit) {
    await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    ({ x, y, hit } = await probe());
  }
  if (hit) throw new Error(`press: the control's centre is covered by ${hit}`);
  await tapAt(page, x, y);
  await expect
    .poll(() => page.evaluate((p) => (window as any).__pressClicks.filter((c: { x: number; y: number }) => Math.abs(c.x - p.x) <= 4 && Math.abs(c.y - p.y) <= 4).some((c: { on: boolean }) => c.on), { x, y }), { timeout: 3_000, intervals: [50, 100], message: 'the tap’s click arrives on the control (a label may forward a second one to its input)' })
    .toBe(true);
}
