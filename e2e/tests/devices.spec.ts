import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE, watchNativeDialogs } from './fixtures';
import {
  acceptDisclaimerNew,
  addFiles,
  analyseMobile,
  confirmDelete,
  libraryRowButton,
  libraryState,
  rowMenu,
  metaRecords,
  openLibraryTab,
  toneWav,
  LAYER_ENGINE_KEY,
  LAYER_OUTPUT_KEY,
} from './helpers';
import { crystalMoves, planAssign, scanCrystalOf } from '../../utils/mix/distribution.ts';
import type { AssignPlan } from '../../utils/mix/distribution.ts';
// v16.8.2: a library with key data is planned with the key bands, as App plans it (P5's tones are analysed in the page).
import { BandCache, clearKey } from '../../utils/mix/keyBands.ts';
import { patchById } from '../../utils/library/listOps.ts';
// The frozen v16.7.1 spread (666132c's own code): 9541b9d's plan of a library with no Source track.
import { spreadV1671 } from '../../scripts/mix-golden/spread-v1671.ts';

// v16.8.1 "Same Crystals Everywhere" (decisions D1 and D4). Synthetic tones only (rate-01 …), never music.
//
// D1: Deep Scan decoded through the playback AudioContext, at the device's own sound rate, and the reading depends on
// it: these four tones, read at 44.1 kHz instead of 48, land on another crystal each (two of them in or out of 2178,
// the SOURCE crystal). How the constants were found (fix round 1, rev-tests 6): the measurement harness's own audio is
// longer music-free signals; these are e2e's own 8 kHz toneWav tones, read in a probe page of the v16.8.1 branch at
// both rates through the scan's own steps (analyzeFractalFrequencies, the heard Hz, getHarmonicSolfeggio:
// scratchpad v1681 build rate-probe.out, 102 tones, 89 changing crystal). That probe used the new decode, but 9541b9d's
// decode with its playback context forced to 48 kHz stores exactly these readings (rev-tests P1), and at 44.1 kHz the
// 44.1 kHz ones (the negative control). Now Deep Scan decodes at a fixed 48 kHz, so a device that plays at 44.1 kHz
// stores the 48 kHz readings. On the desktop the playback context is forced to 44.1 kHz (an init script around the constructor) and a
// track plays first, so the context exists at 44.1 kHz when the scan starts (9541b9d decoded there: the negative
// control). On the phone the context is the phone's own, unforced, and the same readings must come out.
//
// D4: Scan again, the Library health row for the tracks Deep Scan read before v16.8.1 (no scanRate): the review page's
// option A, its words and states.

/** The fixture tones: their file, and Deep Scan's reading (the heard Hz, 3 dp) and crystal at 48 kHz and at 44.1 kHz. */
const TONES = [
  { name: 'rate-01', seconds: 12, freq: 150, at48: [541.756, 2178], at441: [348.838, 174] },
  { name: 'rate-02', seconds: 12, freq: 275, at48: [1263.216, 417], at441: [1091.44, 2178] },
  { name: 'rate-03', seconds: 8, freq: 200, at48: [901.164, 174], at441: [742.602, 741] },
  { name: 'rate-04', seconds: 8, freq: 600, at48: [2706.136, 2664], at441: [478.331, 639] },
] as const;
const FILES = () => TONES.map((t) => ({ name: `${t.name}.wav`, mimeType: 'audio/wav', buffer: toneWav(t.seconds, t.freq) }));
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

/**
 * From the next load: every AudioContext's rate in window.__ctxRates; on the desktop each one forced to `force` Hz (the
 * phone keeps its own). Deep Scan's 48 kHz decodes are counted (window.__scanDecodes), and the one numbered
 * window.__holdAt waits for window.__release() (to see a pass while it runs).
 */
async function instrument(page: Page, force: number | null): Promise<void> {
  await page.addInitScript((force) => {
    const w = window as any;
    w.__ctxRates = [];
    const Orig = window.AudioContext;
    if (Orig) {
      class Rated extends Orig {
        constructor(o?: AudioContextOptions) {
          super(force ? { ...(o ?? {}), sampleRate: force } : o);
          w.__ctxRates.push(this.sampleRate);
        }
      }
      (window as any).AudioContext = Rated;
      (window as any).webkitAudioContext = Rated;
    }
    w.__scanDecodes = 0;
    w.__holdAt = 0;
    // (Fix round 1: window.__failRenders makes the scan's own offline renders fail: the interval peaks' 44.1 kHz and the
    // band envelope's 8 kHz ones. The 48 kHz decode and the fractal step render nothing.)
    const render = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function (this: OfflineAudioContext) {
      if (w.__failRenders && (this.sampleRate === 44100 || this.sampleRate === 8000)) return Promise.reject(new Error('a failed render (test)'));
      return render.call(this);
    } as any;
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: any[]) {
      if (this instanceof OfflineAudioContext && this.sampleRate === 48000) {
        w.__scanDecodes++;
        if (w.__scanDecodes === w.__holdAt) {
          return new Promise((res, rej) => { w.__release = () => (decode as any).apply(this, a).then(res, rej); });
        }
      }
      return (decode as any).apply(this, a);
    } as any;
  }, force);
}

/** The new layout, the v2 engine with Headphones answered, the first-run tutorial seen. */
async function seedPrefs(page: Page): Promise<void> {
  await page.addInitScript(({ keys }) => {
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      if (sessionStorage.getItem('__e2eDevices') === null) {
        sessionStorage.setItem('__e2eDevices', '1');
        localStorage.setItem(keys.engine, 'v2');
        localStorage.setItem(keys.output, 'headphones');
      }
    } catch {}
  }, { keys: { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY } });
}

/** Each library track's stored meta, by its name. */
async function storedByName(page: Page): Promise<Map<string, any>> {
  return new Map((await metaRecords(page)).map((m: any) => [m.name, m]));
}
/** The stored meta, read straight from IndexedDB (every field). */
async function rawMeta(page: Page): Promise<Map<string, any>> {
  const all: any[] = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const out: any[] = await new Promise((resolve) => { const r = db.transaction('meta', 'readonly').objectStore('meta').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close();
    return out.map((m) => ({ ...m, fractalAnalysis: m.fractalAnalysis ? true : m.fractalAnalysis ?? null, intervalAnalysis: undefined, bandEnvelope: undefined, visualEnvelope: undefined, chroma: undefined }));
  });
  return new Map(all.map((m) => [m.name, m]));
}
const healthLine = (page: Page, id: string) => page.getByTestId(`health-${id}-line`);
const healthAction = (page: Page, id: string) => page.getByTestId(`health-${id}-action`);
const healthRow = (page: Page, id: string) => page.getByTestId(`health-${id}`);

test.describe('v16.8.1, Deep Scan reads the same on every device', () => {
  test.use({ layoutSeed: 'new' });

  test('D1. four tones, the playback at 44.1 kHz (the desktop; the phone its own): Deep Scan stores the 48 kHz readings and crystals, and their rate; a reload keeps them @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = watchNativeDialogs(page);
    await instrument(page, ON_DEVICE ? null : 44100);
    await seedPrefs(page);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await openLibraryTab(page);
    await page.getByTestId('library-import').click();
    await addFiles(page, FILES());
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the four tones are in', timeout: 30_000 }).toBe(4);
    await page.keyboard.press('Escape');
    // A track plays first: the playback context exists, at the rate a 44.1 kHz device plays (9541b9d decoded there).
    await libraryRowButton(page, 'rate-03').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 0.2; }, { message: 'a tone plays', timeout: 20_000 }).toBe(true);
    const rates: number[] = await page.evaluate(() => (window as any).__ctxRates);
    expect(rates.length, 'a playback context exists').toBeGreaterThan(0);
    if (!ON_DEVICE) expect(rates[0], 'the desktop plays at 44.1 kHz here').toBe(44100);
    test.info().annotations.push({ type: 'playback context rates', description: rates.join(', ') });
    // Deep Scan (the health card's Scan): the four have no crystal.
    await expect(healthAction(page, 'scan')).toHaveText('Scan');
    await healthAction(page, 'scan').click();
    await expect
      .poll(async () => { const m = await storedByName(page); return TONES.filter((t) => m.get(t.name)?.harmonicFreq && m.get(t.name)?.closestSolfeggio).length; }, { message: 'the four scanned and saved', timeout: 150_000, intervals: [1000] })
      .toBe(4);
    const m = await storedByName(page);
    // The readings first (9541b9d stored the 44.1 kHz ones), then the rate.
    expect(TONES.map((t) => [t.name, r3(m.get(t.name).harmonicFreq), m.get(t.name).closestSolfeggio]), 'the 48 kHz readings and crystals').toEqual(TONES.map((t) => [t.name, ...t.at48]));
    const raw = await rawMeta(page);
    expect(TONES.map((t) => raw.get(t.name)?.scanRate ?? null), 'stored: read at 48 kHz').toEqual(TONES.map(() => 48000));
    expect(TONES.map((t) => raw.get(t.name)?.crystalSource), "stored: Deep Scan's").toEqual(TONES.map(() => 'scan'));
    // A reload: the library comes back with the readings and their rate (nothing to scan again).
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(4);
    const s = await libraryState(page);
    const byName = (k: 'readings' | 'scanRates' | 'crystals') => TONES.map((t) => (k === 'readings' ? r3(s[k][s.libraryNames.indexOf(t.name)]) : s[k][s.libraryNames.indexOf(t.name)]));
    expect([byName('readings'), byName('crystals'), byName('scanRates')], 'after the reload').toEqual([TONES.map((t) => t.at48[0]), TONES.map((t) => t.at48[1]), TONES.map(() => 48000)]);
    await openLibraryTab(page);
    await openHealth(page);
    await expect(healthLine(page, 'scan'), 'the card is open').toHaveText('All 4 tracks scanned');
    await expect(healthRow(page, 'rescan'), 'no older readings: no Scan again').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D4, Scan again. A library from before v16.8.1, read on a 44.1 kHz device (the four tones' 44.1 kHz readings, no
// scanRate): rate-01 an older spread moved to 963 (Assign's, the reading kept, the mark), rate-02 a Source track on 2178,
// rate-03 and rate-04 on Deep Scan's own crystal; rate-05 a failed scan's placeholder (not a reading); rate-06 an older
// reading whose stored audio no longer decodes. Seeded straight into IndexedDB with the tones' own audio.
// ---------------------------------------------------------------------------------------------------------------
const MARK = 1000;
const fa = (hf: number) => ({ dominantFrequency: hf / 0.981818, goldenRatioAlignment: 0.3, pattern111Presence: 0.1, dnaResonanceScore: 0.2, sacredGeometryAlignment: 0 });
const OLD_EVERY: Array<{ name: string; seconds?: number; freq?: number; junk?: boolean; rec: Record<string, unknown> }> = [
  { name: 'rate-01', seconds: 12, freq: 150, rec: { harmonicFreq: 348.838, closestSolfeggio: 963, harmonicDeviation: MARK + Math.abs(348.838 - 963), crystalSource: 'assigned', isAetheriaCandidate: false, fractalAnalysis: fa(348.838) } },
  { name: 'rate-02', seconds: 12, freq: 275, rec: { harmonicFreq: 1091.44, closestSolfeggio: 2178, harmonicDeviation: Math.abs(1091.44 - 2178), crystalSource: 'scan', isAetheriaCandidate: false, fractalAnalysis: fa(1091.44) } },
  { name: 'rate-03', seconds: 8, freq: 200, rec: { harmonicFreq: 742.602, closestSolfeggio: 741, harmonicDeviation: Math.abs(742.602 - 741), crystalSource: 'scan', isAetheriaCandidate: false, fractalAnalysis: fa(742.602) } },
  { name: 'rate-04', seconds: 8, freq: 600, rec: { harmonicFreq: 478.331, closestSolfeggio: 639, harmonicDeviation: Math.abs(478.331 - 639), crystalSource: 'scan', isAetheriaCandidate: false, fractalAnalysis: fa(478.331) } },
  { name: 'rate-05', seconds: 6, freq: 330, rec: { harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999, crystalSource: 'scan' } },
  { name: 'rate-06', junk: true, rec: { harmonicFreq: 530.5, closestSolfeggio: 528, harmonicDeviation: 2.5, crystalSource: 'scan', isAetheriaCandidate: false, fractalAnalysis: fa(530.5) } },
  // (Fix round 1, rev-tests 5: an 8 s 300 Hz tone reads 240.487 Hz at 44.1 kHz and 901.164 at 48: 174 both times, so it
  // is read again but not "read differently".)
  { name: 'rate-07', seconds: 8, freq: 300, rec: { harmonicFreq: 240.487, closestSolfeggio: 174, harmonicDeviation: Math.abs(240.487 - 174), crystalSource: 'scan', isAetheriaCandidate: false, fractalAnalysis: fa(240.487) } },
  // (Fix round 2, W7 alone: the same tone, an earlier spread having moved it to 852; it reads 174 at both rates.)
  { name: 'rate-07s', seconds: 8, freq: 300, rec: { harmonicFreq: 240.487, closestSolfeggio: 852, harmonicDeviation: MARK + Math.abs(240.487 - 852), crystalSource: 'assigned', isAetheriaCandidate: false, fractalAnalysis: fa(240.487) } },
  // (Fix round 3, revR-tests nit 3: W1b's second file that no longer decodes, for the plural sentence.)
  { name: 'rate-06b', junk: true, rec: { harmonicFreq: 640.5, closestSolfeggio: 639, harmonicDeviation: 1.5, crystalSource: 'scan', isAetheriaCandidate: false, fractalAnalysis: fa(640.5) } },
  // (v16.8.2 fix round 2, W9: rate-07s with a clear key, so the hint's plan places it by key.)
  { name: 'rate-07k', seconds: 8, freq: 300, rec: { harmonicFreq: 240.487, closestSolfeggio: 852, harmonicDeviation: MARK + Math.abs(240.487 - 852), crystalSource: 'assigned', isAetheriaCandidate: false, fractalAnalysis: fa(240.487), chroma: [0.1211, 0.0123, 0.0954, 0.0187, 0.1032, 0.0811, 0.0245, 0.1702, 0.0161, 0.0988, 0.0204, 0.2382], chromaA4Hz: 440, musicKey: 'G', keyConfidence: 0.8 } },
];
/** The older library D2 and D3 seed (W7's spread copy of rate-07 and W1b's second unreadable file aside). */
const OLD_ALL = OLD_EVERY.filter((x) => x.name !== 'rate-07s' && x.name !== 'rate-06b' && x.name !== 'rate-07k');
/** After Scan again: closestSolfeggio, harmonicFreq (3 dp), what harmonicDeviation is (the spread's 'mark', Deep Scan's
 *  'distance' to the crystal, or its value), crystalSource, scanRate. */
const AFTER: Record<string, unknown[]> = {
  'rate-01': [963, 541.756, 'mark', 'assigned', 48000], // a spread track keeps its crystal, its mark against the new reading
  'rate-02': [417, 1263.216, 'distance', 'scan', 48000], // on its scan crystal (2178): to the new reading's
  'rate-03': [174, 901.164, 'distance', 'scan', 48000],
  'rate-04': [2664, 2706.136, 'distance', 'scan', 48000],
  'rate-05': [528, 440, 999, 'scan', null], // a failed scan's placeholder: never in the queue
  'rate-06': [528, 530.5, 'distance', 'scan', null], // couldn't be read: exactly as it was
  'rate-07': [174, 901.164, 'distance', 'scan', 48000], // read anew, the same crystal
};
const recOf = (m: any) => {
  const hf = m?.harmonicFreq, c = m?.closestSolfeggio, d = m?.harmonicDeviation;
  const dev = Number.isFinite(d) && Number.isFinite(hf) && Number.isFinite(c)
    ? Math.abs(d - MARK - Math.abs(hf - c)) < 1e-6 ? 'mark' : Math.abs(d - Math.abs(hf - c)) < 1e-6 ? 'distance' : d
    : d ?? null;
  return [c ?? null, r3(hf ?? null), dev, m?.crystalSource ?? null, m?.scanRate ?? null];
};

async function seedOld(page: Page, only?: readonly string[]): Promise<void> {
  const OLD = only ? OLD_EVERY.filter((t) => only.includes(t.name)) : OLD_ALL;
  const blobs = OLD.map((t) => ({ name: t.name, b64: t.junk ? Buffer.from('RIFF\u0000junk, not audio at all, '.repeat(64)).toString('base64') : toneWav(t.seconds!, t.freq!).toString('base64') }));
  await page.goto('/manifest.json');
  await page.evaluate(async ({ old, blobs }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['blobs', 'meta']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('playlist-state')) d.createObjectStore('playlist-state', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const ids = old.map((t: any, i: number) => `${1772100000000 + i * 1000}-dv${i}`);
    const put = (store: string, recs: any[]) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      for (const r of recs) tx.objectStore(store).put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await put('blobs', old.map((t: any, i: number) => ({ id: ids[i], fileBlob: new Blob([bytes(blobs[i].b64)], { type: 'audio/wav' }), fileName: `${t.name}.wav`, fileType: 'audio/wav' })));
    // Keys and visual sync done too (no pitch found, an envelope), so nothing is "to do" and the card folds.
    const env = () => ({ fps: 20, sub: new Uint8Array(8), bass: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]), mid: new Uint8Array(8), high: new Uint8Array(8) });
    await put('meta', old.map((t: any, i: number) => ({ id: ids[i], name: t.name, duration: t.seconds ?? 5, chromaVersion: 1, bandEnvelope: env(), ...t.rec })));
    await put('playlist-state', [{ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 528, savedAt: Date.now() }]);
    db.close();
  }, { old: OLD.map(({ name, seconds, rec }) => ({ name, seconds, rec })), blobs });
}

async function openOld(page: Page, only?: readonly string[], o: { noOffline?: boolean } = {}): Promise<string[]> {
  const dialogs = watchNativeDialogs(page);
  await instrument(page, ON_DEVICE ? null : 44100);
  // (Fix round 2: a browser with no OfflineAudioContext, as an old iOS with only the prefixed one.)
  if (o.noOffline) await page.addInitScript(() => { (window as any).OfflineAudioContext = undefined; (window as any).webkitOfflineAudioContext = undefined; });
  await seedPrefs(page);
  await seedOld(page, only);
  await page.goto('/');
  await acceptDisclaimerNew(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the older library restores', timeout: 60_000 }).toBe(only ? only.length : OLD_ALL.length);
  await openLibraryTab(page);
  return dialogs;
}

/** Open the health card if it is folded (it folds while there is nothing to do); returns the folded line, or null. */
async function openHealth(page: Page): Promise<string | null> {
  const toggle = page.getByTestId('library-health-toggle');
  await page.getByTestId('library-health').waitFor();
  if (!(await toggle.isVisible().catch(() => false))) return null;
  const folded = (await toggle.textContent()) ?? '';
  await toggle.click();
  await expect(page.getByTestId('library-health')).toHaveAttribute('data-open', 'true');
  return folded;
}

/** Delete a track through its row's menu, and wait until the library no longer has it. A row below the list's window
 *  (P2 and P5's 44 tracks) is found with the search, cleared again after. */
const del = async (page: Page, name: string) => {
  const menu = rowMenu(page, name);
  const search = !(await menu.isVisible());
  if (search) await page.getByTestId('library-search').fill(name);
  await menu.click();
  await page.getByTestId('library-menu-delete').click();
  await confirmDelete(page);
  await expect.poll(async () => (await libraryState(page)).libraryNames.includes(name), { timeout: 10_000 }).toBe(false);
  if (search) await page.getByTestId('library-search').fill('');
};

test.describe('v16.8.1, Scan again (the new layout)', () => {
  test.use({ layoutSeed: 'new' });
  const LINE = 'Scan again the 6 tracks read before v16.8.1, so they match on every device';

  test('D2. the older readings: the row offered (optional, folded "All set · Deep Scan optional"), its rate note once the device plays; Scan again: "Scanning again · P % · i of N" with Stop and the bar; then the 48 kHz readings, each track where the rule puts it, the one that failed exactly as it was, the toast; "can go back" for the spread track that now reads 2178 @mobile', async ({ page }) => {
    test.setTimeout(300_000);
    const dialogs = await openOld(page);
    const mobile = await analyseMobile(page);
    const device = mobile ? 'this phone' : 'this computer';
    expect(await openHealth(page), 'optional: the card folds, "Deep Scan optional"').toBe('Library healthAll set · Deep Scan optional');
    // Offered, before anything plays: no rate note yet (the rate is not known).
    await expect(healthLine(page, 'rescan')).toHaveText(LINE);
    await expect(healthRow(page, 'rescan')).toContainText('About 15 min');
    await expect(healthRow(page, 'rescan')).not.toContainText('plays at');
    await expect(healthAction(page, 'rescan')).toHaveText('Scan');
    await expect(healthAction(page, 'rescan'), 'named with its row (fix round 1)').toHaveAccessibleName('Scan: Deep Scan, older readings');
    await expect(page.getByTestId('library-health-status'), 'optional: nothing "to do"').toHaveText('All set');
    await expect(healthLine(page, 'scan'), "the plain Deep Scan row: every track scanned (the failed one counts, as before)").toHaveText('All 7 tracks scanned');
    // A track plays: the device's rate is known, and the note names it.
    await libraryRowButton(page, 'rate-05').click();
    await expect.poll(async () => (await libraryState(page)).playing, { message: 'a tone plays', timeout: 20_000 }).toBe(true);
    const rate: number = (await page.evaluate(() => (window as any).__ctxRates))[0];
    if (!ON_DEVICE) expect(rate, 'the desktop plays at 44.1 kHz here').toBe(44100);
    const note = rate === 48000 ? ` · ${device} plays at 48 kHz, so most stay the same` : ` · ${device} plays at ${Math.round(rate / 10) / 100} kHz, so many may change`;
    await expect(healthRow(page, 'rescan'), 'the rate note').toContainText(`About 15 min${note}`);
    test.info().annotations.push({ type: 'the rate note', description: note });
    // Scan again, its second track held: the pass as it runs.
    await page.evaluate(() => ((window as any).__holdAt = 2));
    await healthAction(page, 'rescan').click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).__release === 'function'), { message: 'the second track decoding (held)', timeout: 60_000 }).toBe(true);
    await expect(healthLine(page, 'rescan')).toHaveText('Scanning again · 17 % · 1 of 6');
    await expect(healthAction(page, 'rescan')).toHaveText('Stop');
    await expect(healthRow(page, 'rescan').locator('xpath=following-sibling::div[1]').locator('div'), 'the progress bar').toHaveAttribute('style', /width: 16\.7%/);
    await expect(page.getByTestId('library-health-status')).toHaveText('Scanning…');
    await expect(healthLine(page, 'scan'), 'the plain Deep Scan row shows its own state').toHaveText('All 7 tracks scanned');
    await page.evaluate(() => (window as any).__release());
    // Done: the stored records.
    await expect
      .poll(async () => { const m = await rawMeta(page); return OLD_ALL.map((t) => [t.name, ...recOf(m.get(t.name))]); }, { message: 'Scan again, saved', timeout: 150_000, intervals: [1000] })
      .toEqual(OLD_ALL.map((t) => [t.name, ...AFTER[t.name]]));
    // The closing toast, exactly: 5 read anew, 4 of them on another crystal (rate-07 on the same), and Assign's offer.
    // (Fix round 2: the words exactly; the hint because a spread would now move tracks: rate-01 reads 2178, off it.)
    await expect(page.getByTestId('notices').getByText("Scanned again: 5 tracks · 4 read differently · 1 couldn't be read · Tap Assign to spread your library by the new readings", { exact: true }), 'the closing toast').toBeVisible({ timeout: 20_000 });
    // The one that couldn't be read keeps its older reading, but is not offered again this session (fix round 1): the
    // row goes. The spread track that now reads 2178 can go back.
    await expect(healthRow(page, 'rescan'), 'the one that failed: not offered again this session').toHaveCount(0);
    await expect(healthLine(page, 'crystals')).toHaveText('All 7 have one · 1 can go back to 2178 Hz, the crystal Deep Scan gave it');
    // After a reload it is offered again (it still has its older reading).
    await page.waitForTimeout(3000); // the debounced save
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(OLD_ALL.length);
    await openLibraryTab(page);
    await openHealth(page);
    await expect(healthLine(page, 'rescan'), 'after a reload, offered again').toHaveText('Scan again the 1 track read before v16.8.1, so it matches on every device');
    expect(dialogs).toEqual([]);
  });

  test('D3. Stop keeps what is done: the first track read anew, the rest as they were; the row then offers the rest @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = await openOld(page);
    await openHealth(page);
    const before = await rawMeta(page);
    await page.evaluate(() => ((window as any).__holdAt = 2));
    await healthAction(page, 'rescan').click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).__release === 'function'), { message: 'the second track decoding (held)', timeout: 60_000 }).toBe(true);
    await expect(healthAction(page, 'rescan')).toHaveText('Stop');
    await healthAction(page, 'rescan').click();
    await page.evaluate(() => (window as any).__release());
    await expect(healthLine(page, 'rescan'), 'the rest').toHaveText('Scan again the 5 tracks read before v16.8.1, so they match on every device', { timeout: 30_000 });
    await page.waitForTimeout(3000); // the debounced save
    const m = await rawMeta(page);
    expect(recOf(m.get('rate-01')), 'the first: read anew').toEqual(AFTER['rate-01']);
    for (const t of OLD_ALL.slice(1)) expect(recOf(m.get(t.name)), `${t.name}: as it was`).toEqual(recOf(before.get(t.name)));
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D8 (fix round 1): a library an earlier release spread (by its id tie-break) is spread again by v16.8.1's rule only on
// a press; the Crystals row offers it, optional, with the number of crystals the press would change, and after the
// press offers nothing. 40 scanned tones bunched on three GUT crystals (assign.spec's BUNCHED readings), spread by the
// frozen v16.7.1 copy: 9541b9d's plan of a library with no Source track. Each track's file as the page has it.
// ---------------------------------------------------------------------------------------------------------------
const TONE6 = 44 + 8000 * 6 * 2; // a 6 s 8 kHz mono tone's bytes
const BUNCHED40: any[] = Array.from({ length: 40 }, (_, i) => {
  const hf = [174, 396, 528][i % 3] + 1.5 + (i % 4) * 0.25;
  const c = quietly(() => scanCrystalOf(hf));
  const name = `spread-${String(i + 1).padStart(2, '0')}`;
  return { id: `1772200000000-sp${String(i).padStart(2, '0')}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE6 }, harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: Math.abs(hf - c), crystalSource: 'scan', isAetheriaCandidate: false, scanRate: 48000 };
});
const OLD_SPREAD: any[] = patchById(BUNCHED40 as never[], quietly(() => spreadV1671(BUNCHED40)).patches as never) as any[];
const NEW_PLAN: AssignPlan = quietly(() => planAssign(OLD_SPREAD, 'spread'));
const M = crystalMoves(NEW_PLAN);
// (Fix round 2, revR-tests: an expected value that is not the code under test: the frozen v16.7.1 spread of the same
// library with each id renamed to its file key, v16.8.1's rule for a library with no Source track.)
const BY_FILE: Map<string, number> = (() => {
  const renamed = OLD_SPREAD.map(({ file, ...s }) => ({ ...s, id: `${file.name}|${file.size}` }));
  const after = patchById(renamed as never[], quietly(() => spreadV1671(renamed as never)).patches as never) as any[];
  return new Map(after.map((s) => [s.id, s.closestSolfeggio]));
})();
const fileOf = (s: any) => `${s.file.name}|${s.file.size}`;
const M_BY_FILE = OLD_SPREAD.filter((s) => BY_FILE.get(fileOf(s)) !== s.closestSolfeggio).length;
function quietly<R>(f: () => R): R { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } }

/** A library seeded straight into IndexedDB: every track the same 6 s tone, its meta as given (the file aside). */
async function seedLibrary(page: Page, lib: any[]): Promise<void> {
  const b64 = toneWav(6, 330).toString('base64');
  await page.goto('/manifest.json');
  await page.evaluate(async ({ lib, b64 }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['blobs', 'meta']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('playlist-state')) d.createObjectStore('playlist-state', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const put = (store: string, recs: any[]) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      for (const r of recs) tx.objectStore(store).put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const tone = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'audio/wav' });
    const env = () => ({ fps: 20, sub: new Uint8Array(8), bass: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]), mid: new Uint8Array(8), high: new Uint8Array(8) });
    await put('blobs', lib.map((s: any) => ({ id: s.id, fileBlob: tone, fileName: `${s.name}.wav`, fileType: 'audio/wav' })));
    await put('meta', lib.map(({ file, ...m }: any) => ({ chromaVersion: 1, bandEnvelope: env(), ...m })));
    const ids = lib.map((s: any) => s.id);
    await put('playlist-state', [{ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 528, savedAt: Date.now() }]);
    db.close();
  }, { lib, b64 });
}

test.describe('v16.8.1 (D8), the Crystals row offers the new spread', () => {
  test.use({ layoutSeed: 'new' });

  test('D4. a library spread by 9541b9d\'s rule: "All 40 have one · Assign would move M of them", optional; the press asks, moves those M as planAssign says, and then the row is done with no button @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    expect(M, 'Node: v16.8.1 would move tracks of the old spread').toBeGreaterThan(1);
    expect(M, 'Node: as many as v16.7.1 keyed by the file moves (independent)').toBe(M_BY_FILE);
    expect(OLD_SPREAD.every((s) => s.closestSolfeggio) && new Set(OLD_SPREAD.map((s) => s.closestSolfeggio)).size, 'Node: the old spread covers every crystal').toBe(27);
    const dialogs = watchNativeDialogs(page);
    await seedPrefs(page);
    await seedLibrary(page, OLD_SPREAD);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the old spread restores', timeout: 60_000 }).toBe(40);
    await openLibraryTab(page);
    expect(await openHealth(page), 'optional: the card folds, "All set"').toBe('Library healthAll set');
    await expect(healthLine(page, 'crystals')).toHaveText(`All 40 have one · Assign would move ${M} of them`);
    await expect(healthAction(page, 'crystals')).toHaveText('Assign');
    await expect(healthAction(page, 'crystals'), 'named with its row').toHaveAccessibleName('Assign: Crystals');
    await expect(page.getByTestId('library-health-status'), 'not "to do"').toHaveText('All set');
    await healthAction(page, 'crystals').click();
    const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect.poll(async () => { const s = await libraryState(page); return s.libraryIds.filter((id, i) => s.crystals[i] !== (NEW_PLAN.patches.get(id)?.closestSolfeggio ?? OLD_SPREAD.find((x) => x.id === id)!.closestSolfeggio)).length; }, { message: 'the crystals planAssign gives', timeout: 15_000 }).toBe(0);
    const s1 = await libraryState(page);
    expect(s1.libraryIds.filter((id, i) => s1.crystals[i] !== BY_FILE.get(fileOf(OLD_SPREAD.find((x) => x.id === id)!))), 'and v16.7.1 keyed by the file gives (independent)').toEqual([]);
    await expect(healthLine(page, 'crystals'), 'after one press: done').toHaveText('All 40 tracks have one');
    await expect(healthAction(page, 'crystals'), 'no button').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fix round 1 (rev-tests 9): restore keeps a scanRate only when it is a number. A record whose scanRate is a string
// (not something the app writes) comes back without one: an older reading, offered by Scan again, and saved without it.
// ---------------------------------------------------------------------------------------------------------------
test.describe('v16.8.1, a stored scanRate that is not a number', () => {
  test.use({ layoutSeed: 'new' });

  test('D5. restore drops a string scanRate: the track is an older reading (Scan again offers it), the next save stores none; a numeric one is kept @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = watchNativeDialogs(page);
    const two = BUNCHED40.slice(0, 2).map((s, i) => ({ ...s, id: `1772300000000-sr${i}`, name: `rate-str-${i + 1}`, file: { name: `rate-str-${i + 1}.wav`, size: TONE6 }, scanRate: i === 0 ? 48000 : '48000' }));
    await seedPrefs(page);
    await seedLibrary(page, two);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(2);
    expect((await libraryState(page)).scanRates, 'restored: the number kept, the string dropped').toEqual([48000, null]);
    await openLibraryTab(page);
    await openHealth(page);
    await expect(healthLine(page, 'rescan')).toHaveText('Scan again the 1 track read before v16.8.1, so it matches on every device');
    // A play rewrites the meta: the string is gone from the store.
    await libraryRowButton(page, 'rate-str-1').click();
    await expect.poll(async () => (await rawMeta(page)).get('rate-str-2')?.scanRate ?? null, { message: 'saved without it', timeout: 20_000 }).toBe(null);
    expect((await rawMeta(page)).get('rate-str-1')?.scanRate, 'the numeric one kept').toBe(48000);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fix round 1 (rev-logic 3, rev-ui 2): an older reading Scan again reads anew while the envelope step fails keeps its
// older envelope (fix round 2: its peaks render fails too, which finds no peaks, so no interval data, as a first scan
// writes it; the reading, its crystal and its rate are new); and the plain Deep
// Scan's Scan, held while Scan again runs, says Deep Scan is already running.
// ---------------------------------------------------------------------------------------------------------------
test.describe('v16.8.1, Scan again keeps what it could not read anew', () => {
  test.use({ layoutSeed: 'new' });

  test('D6. a re-read whose envelope step fails keeps the older envelope (and, finding no peaks, writes no interval data); the held Scan of the plain row says "Deep Scan is already running" @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = watchNativeDialogs(page);
    await instrument(page, ON_DEVICE ? null : 44100);
    await seedPrefs(page);
    const env = { fps: 20, sub: [0, 0, 0, 0], bass: [7, 7, 7, 7], mid: [0, 0, 0, 0], high: [0, 0, 0, 0] };
    const intervals = { coherenceScore: 0.42, classification: 'older', fingerprint: { totalIntervals: 3, aetheriaMatches: 1, harmonicMatches: 2 }, intervals: [] };
    const lib = [
      { ...BUNCHED40[0], id: '1772400000000-kp0', name: 'keep-01', file: { name: 'keep-01.wav', size: TONE6 }, scanRate: undefined, intervalAnalysis: intervals, bandEnvelopeMarker: true },
      { id: '1772400000000-kp1', name: 'keep-02', duration: 6, file: { name: 'keep-02.wav', size: TONE6 } },
    ];
    await seedLibrary(page, lib);
    // seedLibrary gives every track an 8-value envelope; this one's own (4 values) marks it as the older one.
    await page.evaluate(async (env) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const tx = db.transaction('meta', 'readwrite');
      const st = tx.objectStore('meta');
      const rec: any = await new Promise((resolve) => { const g = st.get('1772400000000-kp0'); g.onsuccess = () => resolve(g.result); });
      const u8 = (a: number[]) => new Uint8Array(a);
      delete rec.bandEnvelopeMarker;
      st.put({ ...rec, bandEnvelope: { fps: env.fps, sub: u8(env.sub), bass: u8(env.bass), mid: u8(env.mid), high: u8(env.high) } });
      await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
      db.close();
    }, env);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(2);
    await openLibraryTab(page);
    await openHealth(page);
    await expect(healthLine(page, 'rescan')).toHaveText('Scan again the 1 track read before v16.8.1, so it matches on every device');
    await page.evaluate(() => { (window as any).__failRenders = true; (window as any).__holdAt = 1; });
    await healthAction(page, 'rescan').click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).__release === 'function'), { message: 'the re-read held', timeout: 60_000 }).toBe(true);
    // The plain row's Scan is held meanwhile; a tap says why (it used to say the previous scan was "still finishing").
    await expect(healthAction(page, 'scan')).toHaveAttribute('aria-disabled', 'true');
    await healthAction(page, 'scan').evaluate((b) => (b as HTMLButtonElement).click());
    await expect(page.getByTestId('notices'), 'the held tap').toContainText('Deep Scan is already running. Stop it first, or wait for it to finish.');
    await page.evaluate(() => (window as any).__release());
    const read = () => page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const m: any = await new Promise((resolve) => { const g = db.transaction('meta', 'readonly').objectStore('meta').get('1772400000000-kp0'); g.onsuccess = () => resolve(g.result); });
      db.close();
      return { scanRate: m?.scanRate ?? null, hf: m?.harmonicFreq ?? null, bass: m?.bandEnvelope ? Array.from(m.bandEnvelope.bass as Uint8Array) : null, intervals: m?.intervalAnalysis?.classification ?? null, fractal: !!m?.fractalAnalysis };
    });
    await expect.poll(async () => (await read()).scanRate, { message: 'read anew and saved', timeout: 90_000, intervals: [1000] }).toBe(48000);
    const r = await read();
    expect(r.hf, 'a new reading').not.toBe(BUNCHED40[0].harmonicFreq);
    // (Fix round 2, revR-logic 7: the peaks' failed render gives no peaks, a result rather than a throw: no interval data,
    // as a first scan writes it. Older interval data stays only when the step threw: devices.check pins rescanReadPatch.)
    expect([r.bass, r.intervals, r.fractal], 'the older envelope kept (none made); no interval data, as a first scan writes it; the fractal reading new').toEqual([[7, 7, 7, 7], null, true]);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fix round 2 (revR-tests 3, revR-logic 2, 5, 6): Scan again's closing words, case by case, exactly.
// ---------------------------------------------------------------------------------------------------------------
test.describe('v16.8.1, Scan again: the closing words', () => {
  test.use({ layoutSeed: 'new' });
  const toast = (page: Page, text: string) => page.getByTestId('notices').getByText(text, { exact: true });
  const run = async (page: Page) => { await openHealth(page); await healthAction(page, 'rescan').click(); };
  const held = (page: Page) => expect.poll(() => page.evaluate(() => typeof (window as any).__release === 'function'), { message: 'the first read held', timeout: 60_000 }).toBe(true);

  test('W1. nothing could be read: "Scan again couldn\'t read 1 track. It keeps its older reading." @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openOld(page, ['rate-06']);
    await run(page);
    await expect(toast(page, "Scan again couldn't read 1 track. It keeps its older reading.")).toBeVisible({ timeout: 60_000 });
    expect(dialogs).toEqual([]);
  });

  test('W1b. two could not be read: "Scan again couldn\'t read 2 tracks. They keep their older readings." @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openOld(page, ['rate-06', 'rate-06b']);
    await run(page);
    await expect(toast(page, "Scan again couldn't read 2 tracks. They keep their older readings.")).toBeVisible({ timeout: 60_000 });
    expect(dialogs).toEqual([]);
  });

  test('W2. one read the same and no spread would move a track: "Scanned again: 1 track · 0 read differently", no hint @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openOld(page, ['rate-07']);
    await run(page);
    await expect(toast(page, 'Scanned again: 1 track · 0 read differently')).toBeVisible({ timeout: 60_000 });
    expect(dialogs).toEqual([]);
  });

  test('W3. a track deleted while it is read is not counted: "Scanned again: 1 track · 0 read differently" @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openOld(page, ['rate-03', 'rate-07']);
    await page.evaluate(() => ((window as any).__holdAt = 1));
    await run(page);
    await held(page);
    await del(page, 'rate-03');
    await page.evaluate(() => (window as any).__release());
    await expect(toast(page, 'Scanned again: 1 track · 0 read differently')).toBeVisible({ timeout: 60_000 });
    expect(dialogs).toEqual([]);
  });

  test('W4. every queued track deleted: "Nothing left to scan again." @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openOld(page, ['rate-03', 'rate-07']);
    await page.evaluate(() => ((window as any).__holdAt = 1));
    await run(page);
    await held(page);
    await del(page, 'rate-07'); // before its turn
    await del(page, 'rate-03'); // while it is read
    await page.evaluate(() => (window as any).__release());
    await expect(toast(page, 'Nothing left to scan again.')).toBeVisible({ timeout: 60_000 });
    expect(dialogs).toEqual([]);
  });

  test('W5. a Stop with nothing read (the first track deleted while it was read, the Stop during the second): no closing words at all @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openOld(page, ['rate-03', 'rate-07', 'rate-04']);
    await page.evaluate(() => ((window as any).__holdAt = 1));
    await run(page);
    await held(page);
    await del(page, 'rate-03'); // gone through, not read: the run reaches its closing words
    await page.evaluate(() => { const w = window as any; w.__holdAt = 2; const r = w.__release; w.__release = undefined; r(); });
    await expect.poll(() => page.evaluate(() => typeof (window as any).__release === 'function'), { message: 'the second read held', timeout: 60_000 }).toBe(true);
    // Every notice from here on, as it shows (a toast lasts 6 s: a late look could miss one).
    await page.evaluate(() => {
      const w = window as any;
      w.__seenNotices = [];
      const grab = () => { const el = document.querySelector('[data-testid="notices"]'); const s = el?.textContent ?? ''; if (s && w.__seenNotices[w.__seenNotices.length - 1] !== s) w.__seenNotices.push(s); };
      new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await healthAction(page, 'rescan').click(); // Stop
    await page.evaluate(() => (window as any).__release());
    await expect(healthLine(page, 'rescan'), 'stopped: the two left still to read').toHaveText('Scan again the 2 tracks read before v16.8.1, so they match on every device', { timeout: 30_000 });
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('notices')).not.toContainText(/Nothing left to scan again|Scanned again|Scan again couldn't read/);
    const seen: string[] = await page.evaluate(() => (window as any).__seenNotices);
    expect(seen.join(' | '), 'no closing words shown at any point after the Stop').not.toMatch(/Nothing left to scan again|Scanned again|Scan again couldn't read/);
    expect(dialogs).toEqual([]);
  });

  test('W6. no OfflineAudioContext: "This browser can\'t run Deep Scan." @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openOld(page, ['rate-03'], { noOffline: true });
    await run(page);
    await expect(toast(page, "This browser can't run Deep Scan.")).toBeVisible({ timeout: 20_000 });
    expect((await libraryState(page)).scanRates, 'nothing read').toEqual([null]);
    expect(dialogs).toEqual([]);
  });

  test('W7. none read differently, but a spread would move a track (as on a 48 kHz device): the hint "Tap Assign to spread your library by the new readings" @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openOld(page, ['rate-07s']);
    await run(page);
    await expect(toast(page, 'Scanned again: 1 track · 0 read differently · Tap Assign to spread your library by the new readings')).toBeVisible({ timeout: 60_000 });
    await expect(healthLine(page, 'crystals'), 'and the Crystals row offers it').toHaveText('The track has one · Assign would move it', { timeout: 15_000 });
    expect(dialogs).toEqual([]);
  });

  test('W9. (v16.8.2 fix round 2) a track with a clear key: the hint waits for its key bands, then says "Tap Assign to place your library by key" @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    // The key bands held from the start (keys.spec's dev hold): the hint's plan must wait for them (X32), and then it
    // places the track by key (R28).
    await page.addInitScript(() => { (window as any).__aetheriaKeyBandsHold = true; });
    const dialogs = await openOld(page, ['rate-07k']);
    await run(page);
    const saved = () => page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const all: any[] = await new Promise((resolve) => { const g = db.transaction('meta', 'readonly').objectStore('meta').getAll(); g.onsuccess = () => resolve(g.result); });
      db.close();
      return all[0]?.scanRate ?? null;
    });
    await expect.poll(saved, { message: 'read anew and saved', timeout: 90_000, intervals: [500] }).toBe(48000);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('notices').getByText(/^Scanned again/), 'the closing words wait for the key bands').toHaveCount(0);
    await page.evaluate(() => (window as any).__aetheriaKeyBands.hold(false));
    await expect(toast(page, 'Scanned again: 1 track · 0 read differently · Tap Assign to place your library by key')).toBeVisible({ timeout: 30_000 });
    expect(dialogs).toEqual([]);
  });

  test('W8. a track deleted while its read fails is neither counted nor skipped: "Nothing left to scan again." @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openOld(page, ['rate-06']);
    await page.evaluate(() => ((window as any).__holdAt = 1));
    await run(page);
    await held(page);
    await del(page, 'rate-06');
    await page.evaluate(() => (window as any).__release());
    await expect(toast(page, 'Nothing left to scan again.')).toBeVisible({ timeout: 60_000 });
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fix round 2 (revR-logic 1 and 4, revR-tests 1): the card plans a spread only when its line can show and nothing is
// busy, and shows the last count held while a Deep Scan runs (it used to flip to done).
// ---------------------------------------------------------------------------------------------------------------
// Four assigned tracks (never measured): "Also scan the 4 assigned tracks" reads them one by one, a library change each.
const ASSIGNED4 = [852, 963, 1206, 1449].map((c, k) => ({ id: `1772200000000-sp${40 + k}`, name: `spread-${41 + k}`, duration: 200, file: { name: `spread-${41 + k}.wav`, size: TONE6 }, harmonicFreq: c, closestSolfeggio: c, harmonicDeviation: 3, crystalSource: 'assigned' }));
const LIB44: any[] = [...OLD_SPREAD, ...ASSIGNED4];
const M44 = crystalMoves(quietly(() => planAssign(LIB44, 'spread')));
// (Fix round 3.) P2 deletes spread-42 while idle; P3 restores 15 tracks without their length (the tones are 6 s); P5
// deletes the four assigned tracks while Analyse runs; P4 adds a track with no crystal, its length known.
const M43 = crystalMoves(quietly(() => planAssign(LIB44.filter((s) => s.name !== 'spread-42'), 'spread')));
const M44L = crystalMoves(quietly(() => planAssign(LIB44.map((s, i) => (i < 15 ? { ...s, duration: 6 } : s)), 'spread')));
const LIB40 = LIB44.filter((s) => !/^spread-4[1-4]$/.test(s.name));
const M40 = crystalMoves(quietly(() => planAssign(LIB40, 'spread')));
const NO_CRYSTAL = { id: '1772200000000-sp44', name: 'spread-45', duration: 200, file: { name: 'spread-45.wav', size: TONE6 } };

/** Fix round 3: hold the length reads (App's getAudioDuration: an audio element's onloadedmetadata) until
 *  window.__releaseLengths(); window.__heldLengths() counts the reads waiting. (getAudioDuration gives up after 15 s:
 *  hold them a few seconds only.) */
async function holdLengths(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    const waiting: Array<() => void> = [];
    let holding = true;
    w.__heldLengths = () => waiting.length;
    w.__releaseLengths = () => { holding = false; waiting.splice(0).forEach((f) => f()); };
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (this: Document, tag: string, opts?: ElementCreationOptions) {
      const el = create.call(this, tag, opts);
      if (String(tag).toLowerCase() !== 'audio') return el;
      let handler: ((e: Event) => unknown) | null = null;
      Object.defineProperty(el, 'onloadedmetadata', { configurable: true, get: () => handler, set: (f) => { handler = f; } });
      el.addEventListener('loadedmetadata', (e) => {
        const f = handler;
        if (!f) return;
        const call = () => { if (handler === f) f.call(el, e); };
        if (holding) waiting.push(call); else call();
      });
      return el;
    } as typeof Document.prototype.createElement;
  });
}
/** Fix round 3: once window.__holdDecodes is set, hold every decodeAudioData (Analyse tracks' own) until
 *  window.__releaseDecodes(); window.__heldDecodes() counts them. */
async function holdDecodes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    const waiting: Array<() => void> = [];
    w.__holdDecodes = false;
    w.__heldDecodes = () => waiting.length;
    w.__releaseDecodes = () => { w.__holdDecodes = false; waiting.splice(0).forEach((f) => f()); };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: any[]) {
      if (!w.__holdDecodes) return (decode as any).apply(this, a);
      return new Promise((res, rej) => { waiting.push(() => (decode as any).apply(this, a).then(res, rej)); });
    } as any;
  });
}

test.describe('v16.8.1 (D8), when the card plans', () => {
  test.use({ layoutSeed: 'new' });

  test('P1. a held Deep Scan (the assigned tracks\'): the D8 line keeps its last count, Assign held; no plan while it reads them, at most one after; an import of 20 tones plans at most once @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    expect(M44, 'Node: a spread would move tracks').toBeGreaterThan(1);
    const dialogs = watchNativeDialogs(page);
    await instrument(page, ON_DEVICE ? null : 44100);
    await seedPrefs(page);
    await seedLibrary(page, LIB44);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(44);
    await openLibraryTab(page);
    await openHealth(page);
    const line = `All 44 have one · Assign would move ${M44} of them`;
    await expect(healthLine(page, 'crystals')).toHaveText(line);
    // (Dev builds render under StrictMode, which runs each memo twice: the card's plan cache, by library array, absorbs
    // the second run, so one library change is one plan. The "at most one" checks here and in P2, P3 and P4 rely on it.)
    const plans0 = (await libraryState(page)).spreadPlans;
    expect(plans0, 'the card planned').toBeGreaterThan(0);
    // "Also scan the 4 assigned tracks", the first read held: the line stays, its Assign held, no plan.
    await page.evaluate(() => ((window as any).__holdAt = 1));
    await healthAction(page, 'scan-assigned').click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).__release === 'function'), { message: 'the read held', timeout: 60_000 }).toBe(true);
    await expect(healthLine(page, 'crystals'), 'held: the last count').toHaveText(line);
    await expect(healthRow(page, 'crystals')).toContainText('Unavailable while Deep Scan runs');
    await expect(healthAction(page, 'crystals')).toHaveAttribute('aria-disabled', 'true');
    // (Nothing is written while the first read is held, so a plan made while busy shows only once the four are written:
    // the check after the scan.)
    await page.evaluate(() => (window as any).__release());
    await expect(healthLine(page, 'scan'), 'the scan done').toHaveText('All 44 tracks scanned', { timeout: 90_000 });
    await page.waitForTimeout(2500);
    expect((await libraryState(page)).spreadPlans - plans0, 'four tracks written while it ran: no plan then, at most one after').toBeLessThanOrEqual(1);
    // An import: the new tracks have no crystal (their line comes first) and their lengths are read in batches: at
    // most one plan, once the lengths are in.
    await page.waitForTimeout(2500);
    const plans1 = (await libraryState(page)).spreadPlans;
    await page.getByTestId('library-import').click();
    await addFiles(page, Array.from({ length: 20 }, (_, i) => ({ name: `late-${String(i + 1).padStart(2, '0')}.wav`, mimeType: 'audio/wav', buffer: toneWav(2, 300 + i * 17) })));
    await page.keyboard.press('Escape');
    await expect.poll(async () => { const s = await libraryState(page); return s.libraryIds.length === 64 && s.libraryDurations.every((d) => typeof d === 'number' && d > 0); }, { message: 'the lengths are in', timeout: 60_000 }).toBe(true);
    await page.waitForTimeout(2000);
    expect((await libraryState(page)).spreadPlans - plans1, 'an import of 20: at most one plan').toBeLessThanOrEqual(1);
    expect(dialogs).toEqual([]);
  });

  test('P2. an Analyse pass over 5 tracks, after a delete that changes the count: the held line has the new count while it runs; at most one plan once it is done @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = watchNativeDialogs(page);
    await seedPrefs(page);
    // Five tracks with no key data and no envelope: Analyse tracks has work, and the D8 line shows meanwhile.
    await seedLibrary(page, LIB44.map((s, i) => (i < 5 ? { ...s, chromaVersion: undefined, bandEnvelope: undefined } : s)));
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(44);
    await openLibraryTab(page);
    await openHealth(page);
    await expect(healthLine(page, 'crystals')).toHaveText(`All 44 have one · Assign would move ${M44} of them`);
    // (Fix round 3, revR-tests should-fix 2: a change while idle plans again, and the count held while busy is the new one.)
    expect(M43, 'Node: deleting spread-42 changes the count').not.toBe(M44);
    await del(page, 'spread-42');
    await expect(healthLine(page, 'crystals'), 'idle again: the new count').toHaveText(`All 43 have one · Assign would move ${M43} of them`);
    await page.waitForTimeout(1000);
    const plans0 = (await libraryState(page)).spreadPlans;
    await page.evaluate(() => (window as any).__aetheriaAnalyse?.tune?.({ duty: 0.5 }));
    await healthAction(page, 'analyse').click();
    await expect(page.getByTestId('library-health-status')).toHaveText('Analysing…', { timeout: 15_000 });
    await expect(healthLine(page, 'crystals'), 'while it runs: the last count, the one after the delete').toHaveText(`All 43 have one · Assign would move ${M43} of them`);
    // (Done, nothing is left to do: the card folds by itself.)
    await expect(page.getByTestId('library-health-toggle'), 'the pass done: the card folds').toBeVisible({ timeout: 180_000 });
    await openHealth(page);
    await expect(healthLine(page, 'analyse')).toHaveText('All analysed');
    await page.waitForTimeout(2000);
    expect((await libraryState(page)).spreadPlans - plans0, 'one plan once it is done, none while it ran').toBeLessThanOrEqual(1);
    expect(dialogs).toEqual([]);
  });

  // Fix round 3 (revR-tests should-fix 1): each of the plan's gates on its own. P1's import has both shut at once (its
  // tones have no crystal while their lengths are read).
  test('P3. lengths still being read (15 of the tracks restored without one, the reads held): no plan until they are in, then at most one @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = watchNativeDialogs(page);
    await holdLengths(page);
    await seedPrefs(page);
    await seedLibrary(page, LIB44.map((s, i) => (i < 15 ? { ...s, duration: undefined } : s)));
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(44);
    await expect.poll(() => page.evaluate(() => (window as any).__heldLengths()), { message: 'the length reads held', timeout: 10_000 }).toBeGreaterThan(0);
    // The restore holds the plan too, for 2 s after it (App's isRestoring): past that, the lengths are the only gate shut.
    // (Their reads give up 15 s after they start: well within that.)
    await page.waitForTimeout(3000);
    await openLibraryTab(page);
    await openHealth(page);
    await page.waitForTimeout(1000);
    const s0 = await libraryState(page);
    expect(s0.libraryDurations.filter((d) => !(typeof d === 'number' && d > 0)).length, 'still 15 lengths to read').toBe(15);
    expect(s0.spreadPlans, 'the card open, the lengths still being read: no plan').toBe(0);
    // Three batches of five lengths, a library change each: one plan, once the last is in.
    await page.evaluate(() => (window as any).__releaseLengths());
    await expect.poll(async () => (await libraryState(page)).libraryDurations.every((d) => typeof d === 'number' && d > 0), { message: 'the lengths are in', timeout: 60_000 }).toBe(true);
    await expect(page.getByTestId('library-health-toggle'), 'nothing left to do: the card folds').toBeVisible({ timeout: 15_000 });
    await openHealth(page);
    await expect(healthLine(page, 'crystals'), 'planned once they are in').toHaveText(`All 44 have one · Assign would move ${M44L} of them`);
    await page.waitForTimeout(2000);
    expect((await libraryState(page)).spreadPlans, 'at most one plan, after the lengths').toBeLessThanOrEqual(1);
    expect(dialogs).toEqual([]);
  });

  test('P4. a track with no crystal, its length known: its own line, "1 of 45 tracks have none", and no plan @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = watchNativeDialogs(page);
    await seedPrefs(page);
    await seedLibrary(page, [...LIB44, NO_CRYSTAL]);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => { const s = await libraryState(page); return s.libraryIds.length === 45 && s.libraryDurations.every((d) => typeof d === 'number' && d > 0); }, { message: 'restored, every length known', timeout: 60_000 }).toBe(true);
    await openLibraryTab(page);
    await openHealth(page);
    await expect(healthLine(page, 'crystals')).toHaveText('1 of 45 tracks have none');
    await page.waitForTimeout(2000);
    expect((await libraryState(page)).spreadPlans, 'nothing busy, but the spread count has no line to show: no plan').toBe(0);
    expect(dialogs).toEqual([]);
  });

  // Fix round 3 (revR2-logic S1): four tracks deleted while Analyse runs (its first decode held), the 44's count (more
  // than 40) held: never more than the tracks there are.
  test('P5. tracks deleted while Analyse runs: the held count is never more than the tracks there are; no plan meanwhile @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    expect(M44, 'Node: the 44\'s count is more than 40').toBeGreaterThan(40);
    const dialogs = watchNativeDialogs(page);
    await holdDecodes(page);
    await seedPrefs(page);
    await seedLibrary(page, LIB44.map((s, i) => (i < 5 ? { ...s, chromaVersion: undefined, bandEnvelope: undefined } : s)));
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(44);
    await openLibraryTab(page);
    await openHealth(page);
    await expect(healthLine(page, 'crystals')).toHaveText(`All 44 have one · Assign would move ${M44} of them`);
    await page.waitForTimeout(1000);
    const plans0 = (await libraryState(page)).spreadPlans;
    await page.evaluate(() => ((window as any).__holdDecodes = true));
    await healthAction(page, 'analyse').click();
    await expect(page.getByTestId('library-health-status')).toHaveText('Analysing…', { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__heldDecodes()), { message: 'its first decode held', timeout: 30_000 }).toBeGreaterThan(0);
    for (const name of ['spread-41', 'spread-42', 'spread-43', 'spread-44']) await del(page, name);
    await expect(healthLine(page, 'crystals'), 'held: at most the 40 there are').toHaveText('All 40 have one · Assign would move 40 of them');
    expect((await libraryState(page)).spreadPlans - plans0, 'four deletes while it runs: no plan').toBe(0);
    await page.evaluate(() => (window as any).__releaseDecodes());
    await expect(page.getByTestId('library-health-toggle'), 'the pass done: the card folds').toBeVisible({ timeout: 180_000 });
    await openHealth(page);
    // v16.8.2: the pass gave its five tones key data, and App plans with their key bands: so does Node, from the key
    // fields the page stored (M40 is the count without them).)
    const readKeyFields = (): Promise<Array<[string, Record<string, unknown>]>> => page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const all: any[] = await new Promise((resolve) => { const r = db.transaction('meta', 'readonly').objectStore('meta').getAll(); r.onsuccess = () => resolve(r.result); });
      db.close();
      return all.map((m) => [m.id, { chroma: m.chroma, chromaA4Hz: m.chromaA4Hz, musicKey: m.musicKey, keyConfidence: m.keyConfidence, chromaVersion: m.chromaVersion }]);
    });
    // (Once the pass's results are saved: every stored record of this CHROMA_VERSION, the five analysed included.)
    let keyFields: Array<[string, Record<string, unknown>]> = [];
    await expect.poll(async () => { keyFields = await readKeyFields(); return keyFields.length === 40 && keyFields.every(([, k]) => k.chromaVersion === 1); }, { message: "the pass's results saved", timeout: 30_000 }).toBe(true);
    const stored = new Map(keyFields);
    const lib40 = LIB40.map((x) => ({ ...x, ...(stored.get(x.id) ?? {}) }));
    const cache = new BandCache();
    cache.ensureSync(lib40);
    const m40 = crystalMoves(quietly(() => planAssign(lib40, 'spread', cache.planOptions)));
    test.info().annotations.push({ type: 'P5 idle count', description: `${lib40.filter((x) => clearKey(x)).length} analysed tones with a clear key: ${m40} with the bands (${M40} without)` });
    if (!lib40.some((x) => clearKey(x))) expect(m40, 'no clear key: v16.8.1\'s count').toBe(M40);
    await expect(healthLine(page, 'crystals'), 'idle: the 40\'s own count').toHaveText(`All 40 have one · Assign would move ${m40} of them`);
    expect(dialogs).toEqual([]);
  });
});
