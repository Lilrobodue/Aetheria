import { type Page } from '@playwright/test';
import { test, expect, watchNativeDialogs } from './fixtures';
import { acceptDisclaimer, acceptDisclaimerNew, addFiles, confirmDelete, controllableVisibility, libraryState, openLibraryTab, rowMenu, tab, toneWav, undoToast, LAYER_ENGINE_KEY, LAYER_OUTPUT_KEY } from './helpers';
import { ALL_CRYSTALS, assignConfirmText, assignDoneText, assignNothingText, crystalMoves, planAssign, scanCrystalOf } from '../../utils/mix/distribution.ts';
// (Fix round 3, F1: libraryModel's ASSIGN_CHANGED_LINE, word for word: a literal, so the negative control runs on code without it.)
const ASSIGN_CHANGED_LINE = 'Your library changed while this was open, so these counts are new.';
import type { AssignPlan } from '../../utils/mix/distribution.ts';
import { BandCache, bandsOf, clearKey, contentKey } from '../../utils/mix/keyBands.ts';
import { patchById } from '../../utils/library/listOps.ts';
import { spreadOracle } from '../../scripts/mix-golden/spread-oracle.ts';
import { spreadV1671 } from '../../scripts/mix-golden/spread-v1671.ts';
import { spreadV1681, wordsV1681 } from '../../scripts/mix-golden/spread-v1681.ts';

// v16.8.2 "Key placement" (decisions U1-U4, K1-K9). Assign crystals places a track with a clear key by how its key fits
// each crystal's tone (utils/mix/keyBands.ts), Deep Scan's reading only breaking ties. Synthetic tones and synthetic
// chroma arrays only ("key-…"), never music. Every expected crystal is Node's own planAssign with the bands
// (keyBands.ts BandCache, as App plans), checked first against the independent oracle (spread-oracle.ts).
//
//   K-1  key data seeded, then Assign (the new layout and classic): every track where Node's plan puts it, the
//        confirmation's key sentences ("… go first to crystals whose tone fits their key.", "This time most tracks move (M of N).",
//        "N tracks have no key yet …"), the done text's "K placed by key (F where the tone fits)".
//   K-2  the Crystals row's sub-line: its count, the singular, gone after Analyse tracks.
//   K-3  the D8 line's reason "· to place tracks by key" (fix round 2; "· to fit its key" for one) when the key data alone cause the moves; none when moves are keyless.
//   K-4  the press with a cold cache (the warm held from the start): "Getting the keys ready… N left", no write, and the
//        plan only after the warm; its Cancel ends the press without writing.
//   K-5  Track info's note "Its key fits this crystal's tone." for a band-0 track, not for band 1 or no clear key.
//   K-6  the persisted record: after a reload no band is made again (bandsLeft 0 at once); a corrupted one is rebuilt.
//   K-7  no key data anywhere: v16.8.1's lines, words and crystals (the frozen copy), no new sentence.
//   K-8  bandsOf in the page equals Node's on fixed inputs (the phone's JS math, on the phone).
//   K-9  the cost probe: 300 tracks warmed, ms per track reported (< 50); fix round 1: on a phone the background warm
//        keeps to the analyser's mobile duty (its work under 0.4 of its wall time).
//   Fix round 1: K-4c the card on a library with crystals, under the hold, and its confirmation on every band; K-1d
//   classic under the hold; K-4d / K-4e a Clear during a warm (nothing written, no record); K-SF1 keys landing during
//   the wait (the confirmation still shows); K-SF2 leaving the card during the wait (the press waits, then asks); K-1e
//   a second press, K-1f a user's press over Scan again's quiet one (both through the dev hook's press); K-3c the held
//   line's reason; K-5 Copy; K-6 the prune, the pagehide write and the fingerprint.
//   Fix round 2: K-R2a the confirmation is the plan applied (a library changed under the dialog asks again); K-SF3 App's
//   press waits for every band, keys landing included (R30); K-SF4 a card mounted later takes the press in one task (the
//   monotonic token, R2b) and re-warms (R05); K-SF5 a card that didn't press still asks after its re-warm (R2c); K-SF2b
//   a card mounted later asks with nothing to change (R01), reached through the toast's Open (R07); K-R2d a prune
//   during the press's warm: it tries once more; K-R2e a pending press with nothing to do is a direct one; K-R2f / PB the
//   keys toast never over another; K-5b Lo Shu on: Track info and Copy without the note (R24); phone only: PC the hidden
//   park, PD the press's duty, K-R3 the phone warm's hold and its loading cap.
//   Fix round 3: KF1a / KF1b the press waits for track lengths, then one Assign applies (keyless: no re-ask; keyed: at
//   most one, with its "changed" line); KF1c a flush that changes nothing the plan reads, then one tap applies; KF1d the
//   length wait's toast, its Cancel and a Clear; KF2 the dialog stays when the card folds; K-R2a-held a re-ask whose
//   bands are missing; K-SF2b the press taken once; K-4c the keys toast gone when the press asks; K-SF5 the re-warm's toast.
//   Fix round 4: KG1a / KG1b a second tap joins the press in flight (one Cancel); KG2a / KG2b a confirmation counts only
//   for its own press; KG3 a resumed band pass's toast shows once the other toast leaves; KF2 focus to the folded toggle.
//   Fix round 5: KH1a a card mounted after a confirmed press asks; KH1b the card that confirmed applies an equal plan
//   with no second dialog; KH2 focus to the open card's heading when its Assign is gone.

function quietly<R>(f: () => R): R { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } }
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Key data as Analyse tracks stores it: a key's idealised weights with seeded noise (4 dp), an A4 (2 dp), a key name, a
 *  confidence (3 dp). */
function keyData(r: () => number): Record<string, unknown> {
  const tonic = Math.floor(r() * 12), minor = r() < 0.35;
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const w = new Array(12).fill(0.15);
  scale.forEach((d, j) => { w[(tonic + d) % 12] = j === 0 ? 3 : j === 4 ? 2.5 : j === 2 ? 2 : 1; });
  const noisy = w.map((v) => v * (0.6 + 0.8 * r()));
  const sum = noisy.reduce((a, b) => a + b, 0);
  const chromaA4Hz = r() < 0.75 ? Math.round((438.5 + r() * 3) * 100) / 100 : [432, 436.5, 445][Math.floor(r() * 3)];
  return { chroma: noisy.map((v) => Math.round((v / sum) * 1e4) / 1e4), chromaA4Hz, musicKey: NOTES[tonic] + (minor ? 'm' : ''), keyConfidence: Math.round((0.5 + r() * 0.45) * 1e3) / 1e3, chromaVersion: 1 };
}
const KEY_FIELDS = ['chroma', 'chromaA4Hz', 'musicKey', 'keyConfidence', 'chromaVersion'];
const TONE = toneWav(1, 330);
const TONE_BYTES = TONE.length; // every seeded track's file: its blob, as the restored File's size

/** A scanned track bunched on a GUT crystal (assign.spec's BUNCHED readings): Deep Scan's record, read at 48 kHz. */
function scanned(i: number, prefix: string): any {
  const hf = [174, 396, 528][i % 3] + 1.5 + (i % 4) * 0.25;
  const c = quietly(() => scanCrystalOf(hf));
  const name = `${prefix}-${String(i + 1).padStart(2, '0')}`;
  return { id: `1772300000000-${prefix}${String(i).padStart(3, '0')}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE_BYTES }, harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: Math.abs(hf - c), crystalSource: 'scan', isAetheriaCandidate: false, scanRate: 48000, chromaVersion: 1 };
}
const applyPlan = (lib: any[], p: AssignPlan) => patchById(lib as never[], p.patches as never) as any[];
/** Key data on each track: `waiting` never analysed (no chromaVersion), `unclear` with a confidence under 0.45, the rest a
 *  clear key. */
function withKeys(lib: any[], seed: number, o: { waiting?: number; unclear?: number } = {}): any[] {
  const r = mulberry32(seed);
  return lib.map((s, i) => {
    const k = keyData(r);
    const { chromaVersion, ...rest } = s;
    void chromaVersion;
    if (i < (o.waiting ?? 0)) return rest;
    if (i < (o.waiting ?? 0) + (o.unclear ?? 0)) return { ...rest, ...k, keyConfidence: 0.31 };
    return { ...rest, ...k };
  });
}
/** Node's plan, as App makes it: planAssign(lib, 'spread') with a key-band cache's planOptions, its bands made first. */
function keyPlan(lib: any[]): AssignPlan {
  const c = new BandCache();
  c.ensureSync(lib);
  return quietly(() => planAssign(lib as never, 'spread', c.planOptions));
}
/** The oracle's crystal for every track (the independent side). */
function oracleCrystals(lib: any[]): Map<string, number | null> {
  const o = quietly(() => spreadOracle(lib as never));
  return new Map(lib.map((s) => [s.id, o.after.get(s.id)![0]]));
}
const crystalsAfter = (lib: any[], p: AssignPlan) => new Map(applyPlan(lib, p).map((s) => [s.id, s.closestSolfeggio ?? null]));

/** A library seeded straight into IndexedDB: every track the same 1 s tone, its meta as given (the file aside). With
 *  `keyBands`, the key bands' record too (raw, as a test writes it). */
async function seedLibrary(page: Page, lib: any[], keyBands?: unknown, tone: Buffer = TONE): Promise<void> {
  const b64 = tone.toString('base64');
  await page.goto('/manifest.json');
  await page.evaluate(async ({ lib, b64, keyBands }) => {
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
    await put('meta', lib.map(({ file, __noEnv, ...m }: any) => (__noEnv ? m : { bandEnvelope: env(), ...m })));
    const ids = lib.map((s: any) => s.id);
    const state: any[] = [{ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 528, savedAt: Date.now() }];
    if (keyBands !== undefined) state.push(keyBands);
    await put('playlist-state', state);
    db.close();
  }, { lib, b64, keyBands });
}
async function seedPrefs(page: Page, o: { hold?: boolean } = {}): Promise<void> {
  await page.addInitScript(({ keys, hold }) => {
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      if (sessionStorage.getItem('__e2eKeys') === null) {
        sessionStorage.setItem('__e2eKeys', '1');
        localStorage.setItem(keys.engine, 'v2');
        localStorage.setItem(keys.output, 'headphones');
      }
    } catch {}
    if (hold) (window as any).__aetheriaKeyBandsHold = true;
  }, { keys: { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY }, hold: !!o.hold });
}
/** The key bands' state from the dev hook (bandsLeft 0 on a build without key bands: the assertions after it decide). */
async function keysState(page: Page): Promise<{ bandsLeft: number; bandsCached: number; bandsMade: number; bandsLoaded: boolean; msPerTrack: number | null }> {
  const s: any = await libraryState(page);
  return { bandsLeft: s.bandsLeft ?? 0, bandsCached: s.bandsCached ?? 0, bandsMade: s.bandsMade ?? 0, bandsLoaded: s.bandsLoaded ?? true, msPerTrack: s.bandsMsPerTrack ?? null };
}
async function openApp(page: Page, lib: any[], n: number, layout: 'new' | 'classic' = 'new', tone?: Buffer): Promise<void> {
  await seedLibrary(page, lib, undefined, tone);
  await page.goto('/');
  if (layout === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library restores', timeout: 60_000 }).toBe(n);
}
async function bandsReady(page: Page): Promise<void> {
  await expect.poll(async () => { const k = await keysState(page); return k.bandsLoaded && k.bandsLeft === 0; }, { message: 'every key band made', timeout: 60_000 }).toBe(true);
}
async function openHealth(page: Page): Promise<void> {
  await openLibraryTab(page);
  const toggle = page.getByTestId('library-health-toggle');
  await page.getByTestId('library-health').waitFor();
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await expect(page.getByTestId('library-health')).toHaveAttribute('data-open', 'true');
}
const healthLine = (page: Page, id: string) => page.getByTestId(`health-${id}-line`);
const healthRow = (page: Page, id: string) => page.getByTestId(`health-${id}`);
const healthAction = (page: Page, id: string) => page.getByTestId(`health-${id}-action`);
const notices = (page: Page) => page.getByTestId('notices');
async function crystalsById(page: Page): Promise<Map<string, number | null>> {
  const s = await libraryState(page);
  return new Map(s.libraryIds.map((id, i) => [id, s.crystals[i]]));
}
const differing = (a: Map<string, number | null>, b: Map<string, number | null>) => [...b.keys()].filter((id) => a.get(id) !== b.get(id));
/** Fix round 1: the stored 'keyBands:v1' record (its version, fingerprint and keys), or null. */
async function bandsRecord(page: Page): Promise<{ v: number; fp: string[] | null; keys: string[] } | null> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const rec: any = await new Promise((resolve) => { const r = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('keyBands:v1'); r.onsuccess = () => resolve(r.result ?? null); });
    db.close();
    return rec ? { v: rec.v, fp: rec.fp ?? null, keys: (rec.entries ?? []).map((e: any) => e[0]).sort() } : null;
  });
}
/** Once window.__holdDecodes is set, every decodeAudioData waits until window.__releaseDecodes() (devices.spec's). */
async function holdDecodes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    const waiting: Array<() => void> = [];
    w.__holdDecodes = false;
    w.__releaseDecodes = () => { w.__holdDecodes = false; waiting.splice(0).forEach((f) => f()); };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: any[]) {
      if (!w.__holdDecodes) return (decode as any).apply(this, a);
      return new Promise((res, rej) => { waiting.push(() => (decode as any).apply(this, a).then(res, rej)); });
    } as any;
  });
}
/** From the next load on, navigator.clipboard.writeText records into window.__copied (library-tab.spec's). */
async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__copied = null;
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => { w.__copied = t; return Promise.resolve(); }, readText: () => Promise.resolve(w.__copied ?? '') } }); } catch {}
  });
}
/** The health card's Library tools › Clear library… (the playlists kept). */
async function clearLibrary(page: Page): Promise<void> {
  await page.getByTestId('library-tools-clear').click();
  const d = page.getByRole('alertdialog', { name: 'Clear your library?' });
  await d.waitFor();
  await page.waitForTimeout(700); // past the 600 ms guard
  await d.getByTestId('clear-library-confirm').click();
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 20_000, message: 'the library is cleared' }).toBe(0);
}
const release = (page: Page) => page.evaluate(() => (window as any).__aetheriaKeyBands.hold(false));
/** Fix round 2: release the hold, and park the warm again between slices once `n` bands are made (in the page). */
async function parkAfter(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as any, h = w.__aetheriaKeyBands;
    w.__parked = false;
    const t = setInterval(() => { if (h.cached() >= n) { h.hold(true); clearInterval(t); w.__parked = true; } }, 1);
    h.hold(false);
  }, n);
  await expect.poll(() => page.evaluate(() => (window as any).__parked), { message: `parked after ${n} bands`, timeout: 60_000 }).toBe(true);
}
/** Fix round 2: the library as the page stored it (each track's key and crystal fields from IndexedDB over `base`). */
async function storedLibrary(page: Page, base: any[]): Promise<any[]> {
  const rows: Array<[string, Record<string, unknown>]> = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all: any[] = await new Promise((resolve) => { const r = db.transaction('meta', 'readonly').objectStore('meta').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close();
    const F = ['chroma', 'chromaA4Hz', 'musicKey', 'keyConfidence', 'chromaVersion', 'analysisFailedV', 'closestSolfeggio', 'harmonicFreq', 'harmonicDeviation', 'crystalSource'];
    return all.map((m) => [m.id, Object.fromEntries(F.filter((f) => m[f] !== undefined).map((f) => [f, m[f]]))]);
  });
  const m = new Map(rows);
  return base.map((x) => ({ ...x, ...(m.get(x.id) ?? {}) }));
}
/** Fix round 2: an Analyse pass to its end, and its results saved (each of `ids` stored with this CHROMA_VERSION). */
async function analyseToEnd(page: Page, ids: string[]): Promise<void> {
  await expect.poll(async () => page.evaluate(() => { const a = (window as any).__aetheriaAnalyse; return a.state().phase === 'idle' && a.last()?.outcome === 'finished'; }), { message: 'the pass ends', timeout: 180_000 }).toBe(true);
  await expect.poll(async () => { const lib = await storedLibrary(page, ids.map((id) => ({ id }))); return lib.every((x) => x.chromaVersion === 1); }, { message: "the pass's results saved", timeout: 30_000 }).toBe(true);
}
const askDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
/** Fix round 3: from the next load on, App's length probes (getAudioDuration's <audio>) wait while window.__holdDurations
 *  is true; window.__releaseDurations() lets them go (library-tab.spec's). With `held`, held from the start. */
async function holdDurationProbes(page: Page, held = false): Promise<void> {
  await page.addInitScript((held) => {
    const w = window as any;
    w.__holdDurations = held;
    w.__held = [] as Array<() => void>;
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!;
    const create = Document.prototype.createElement;
    (Document.prototype as any).createElement = function (this: Document, tag: string, ...rest: unknown[]) {
      const el = (create as any).call(this, tag, ...rest);
      if (String(tag).toLowerCase() === 'audio') {
        Object.defineProperty(el, 'src', { configurable: true, get() { return d.get!.call(el); }, set(v: string) { const go = () => d.set!.call(el, v); if (w.__holdDurations) w.__held.push(go); else go(); } });
      }
      return el;
    };
    w.__releaseDurations = () => { w.__holdDurations = false; w.__held.splice(0).forEach((f: () => void) => f()); };
  }, held);
}
const lengthsToast = (page: Page) => notices(page).getByText('Reading track lengths · then Assign', { exact: true });
/** The library as the page holds it now, its lengths included (Node plans that one). */
async function inPageLibrary(page: Page, base: any[]): Promise<any[]> {
  const s: any = await libraryState(page);
  const d = new Map(s.libraryIds.map((id: string, i: number) => [id, s.libraryDurations[i]]));
  return base.map((x) => ({ ...x, duration: d.get(x.id) ?? undefined }));
}
/** Fix round 3 (F1): 600 scanned tracks spread by v16.8.1, their lengths not read yet (keyed or keyless), and 20 new ones
 *  with no crystal (their lengths known), so the Crystals line offers Assign (revS probe S1's shape). */
function lengthsLibrary(keyed: boolean): any[] {
  const base = Array.from({ length: 600 }, (_, i) => scanned(i, keyed ? 'durk' : 'durn'));
  const spread = applyPlan(base, quietly(() => spreadV1681(base as never)));
  const old = (keyed ? withKeys(spread, 16841) : spread).map(({ duration, ...x }: any) => x);
  return [...old, ...Array.from({ length: 20 }, (_, i) => { const name = `durnew-${String(i + 1).padStart(2, '0')}`; return { id: `1772350000000-dn${String(i).padStart(2, '0')}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE_BYTES } }; })];
}
/** Fix round 3 (F1, F2): 54 keyed scanned tracks spread by v16.8.1, 12 without a visual-sync envelope (an Analyse pass
 *  then changes the array, not the plan); `open`, plus 2 keyed with no crystal, so the card stays open (revS probe S3). */
function visualLibrary(open: boolean): any[] {
  const base = Array.from({ length: 54 }, (_, i) => scanned(i, 'vis'));
  const spread = withKeys(applyPlan(base, quietly(() => spreadV1681(base as never))), 16843).map((x, i) => ({ ...x, file: { name: x.file.name, size: TONE6.length }, ...(i < 12 ? { __noEnv: true } : {}) }));
  const extra = open ? withKeys([0, 1].map((i) => { const name = `visnew-${i + 1}`; return { id: `1772350000000-vn${i}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE6.length } }; }), 16844) : [];
  return [...spread, ...extra];
}
const keysToast = (page: Page) => notices(page).getByText(/^Getting the keys ready… \d+ left$/);
const readyToast = (page: Page) => notices(page).getByText('Keys ready · open Library to Assign', { exact: true });
const hook = (page: Page, on: boolean) => page.evaluate((on) => (window as any).__aetheriaKeyBands.hold(on), on);

// ---------------------------------------------------------------------------------------------------------------
// The libraries
// ---------------------------------------------------------------------------------------------------------------
// K-1 / K-3a: 54 scanned tracks, spread by v16.8.1's rule (keyless: its plan would move none), then key data arrives:
// 48 clear keys, 3 unclear, 3 never analysed. Only the keys move tracks, and most of them.
const BUNCH54 = Array.from({ length: 54 }, (_, i) => scanned(i, 'key'));
const SPREAD54 = applyPlan(BUNCH54, quietly(() => spreadV1681(BUNCH54 as never)));
const LIB1 = withKeys(SPREAD54, 16821, { waiting: 3, unclear: 3 });
const PLAN1 = keyPlan(LIB1);
const M1 = crystalMoves(PLAN1);
// K-4: 30 analysed tracks with a clear key and no crystal yet; the warm held from the start (dev builds).
const FRESH30 = withKeys(Array.from({ length: 30 }, (_, i) => { const name = `keyfresh-${String(i + 1).padStart(2, '0')}`; return { id: `1772310000000-kf${String(i).padStart(2, '0')}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE_BYTES } }; }), 16825);
const PLAN30 = keyPlan(FRESH30);
// Fix round 1: LIB1 with two new tracks with no crystal, so the card offers Assign while the bands are held.
const LIB2 = [...LIB1, ...[0, 1].map((i) => { const name = `keynew-${i + 1}`; return { id: `1772340000000-kn${i}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE_BYTES } }; })];
const PLAN2 = keyPlan(LIB2);
// Fix round 2: LIB2 with 6 s tones (Analyse reads a clear key from them, devices.spec P5) and five tracks never analysed.
const TONE6 = toneWav(6, 330);
const LIB2A = LIB2.map((x, i) => (i < 5 ? (({ chroma, chromaA4Hz, musicKey, keyConfidence, chromaVersion, ...rest }: any) => rest)(x) : x)).map((x) => ({ ...x, file: { name: x.file.name, size: TONE6.length } }));
const LIB2A_IDS = LIB2A.slice(0, 5).map((x) => x.id);
// FRESH30's 300-track sibling (each its own key): a warm long enough to park in the middle of.
const FRESH300 = withKeys(Array.from({ length: 300 }, (_, i) => { const name = `keyfresh3-${String(i + 1).padStart(3, '0')}`; return { id: `1772360000000-kt${String(i).padStart(3, '0')}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE_BYTES } }; }), 16831);
// K-3b: 40 scanned tracks spread by v16.7.1's rule (9541b9d's ties by the id), with key data: moves without the keys too.
const BUNCH40 = Array.from({ length: 40 }, (_, i) => scanned(i, 'kold'));
const OLD40 = withKeys(applyPlan(BUNCH40, quietly(() => spreadV1671(BUNCH40 as never))), 16822);
const PLAN40 = keyPlan(OLD40);

test.describe('v16.8.2, Assign places by key (the new layout)', () => {
  test.use({ layoutSeed: 'new' });

  test('K-1. key data, then Assign: every track where Node\'s plan with the bands puts it; the confirmation\'s key sentences and "most tracks move"; the done text\'s K and F @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    // Node, first: the plan is the oracle's, the keys alone move most tracks, and none would move without them.
    expect(differing(crystalsAfter(LIB1, PLAN1), oracleCrystals(LIB1)), 'Node: planAssign with the bands = the oracle').toEqual([]);
    expect(crystalMoves(quietly(() => planAssign(LIB1 as never, 'spread'))), 'Node: without the bands, nothing moves').toBe(0);
    expect(M1, 'Node: most tracks move').toBeGreaterThan(27);
    expect([PLAN1.keyed, PLAN1.noKey, PLAN1.awaitingKey], 'Node: 48 placed by key, 6 not, 3 waiting').toEqual([48, 6, 3]);
    const body = assignConfirmText(PLAN1).body;
    for (const t of ["Tracks with a clear key go first to crystals whose tone fits their key.", `This time most tracks move (${M1} of 54).`, "3 tracks have no key yet: Analyse tracks to place them by key too."]) expect(body, 'Node: the confirmation says it').toContain(t);
    const dialogs = watchNativeDialogs(page);
    await seedPrefs(page);
    await openApp(page, LIB1, 54);
    await bandsReady(page);
    await openHealth(page);
    await healthAction(page, 'crystals').click();
    const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
    await expect(ask.getByTestId('dialog-body')).toHaveText(body);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    const want = crystalsAfter(LIB1, PLAN1);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'every crystal as Node plans it', timeout: 20_000 }).toBe(0);
    await expect(notices(page), 'the done text').toContainText(`${PLAN1.keyed} placed by key (${PLAN1.keyFits} where the tone fits)`);
    await expect(notices(page)).toContainText(assignDoneText(PLAN1).slice(0, 60));
    expect(dialogs).toEqual([]);
  });

  test('K-3a. only the keys move tracks: "All 54 have one · Assign would move M of them · to place tracks by key" @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await seedPrefs(page);
    await openApp(page, LIB1, 54);
    await bandsReady(page);
    await openHealth(page);
    await expect(healthLine(page, 'crystals')).toHaveText(`All 54 have one · Assign would move ${M1} of them · to place tracks by key`);
  });

  test('K-3b. moves without the keys too (an older spread): the line has no reason @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const m0 = crystalMoves(quietly(() => planAssign(OLD40 as never, 'spread')));
    expect(m0, 'Node: the keyless plan moves tracks too').toBeGreaterThan(0);
    await seedPrefs(page);
    await openApp(page, OLD40, 40);
    await bandsReady(page);
    await openHealth(page);
    await expect(healthLine(page, 'crystals')).toHaveText(`All 40 have one · Assign would move ${crystalMoves(PLAN40)} of them`);
  });

  test('K-2a. the Crystals row\'s sub-line: "2 tracks have no key yet · Analyse tracks first so Assign can place them by key", gone after Analyse tracks @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    const lib = withKeys(SPREAD54.slice(0, 30), 16823, { waiting: 2 });
    await seedPrefs(page);
    await openApp(page, lib, 30);
    await bandsReady(page);
    await openHealth(page);
    await expect(healthRow(page, 'crystals')).toContainText('2 tracks have no key yet · Analyse tracks first so Assign can place them by key');
    await expect(healthAction(page, 'analyse')).toHaveText('Analyse 2');
    await healthAction(page, 'analyse').click();
    // (The pass's own hook: it ends in milliseconds on 1 s tones, and the card then folds: nothing is left to do.)
    await expect.poll(async () => page.evaluate(() => { const a = (window as any).__aetheriaAnalyse; return a.state().phase === 'idle' && a.last()?.outcome === 'finished' && a.last()?.keys === 2; }), { message: 'the pass ends, both read', timeout: 60_000 }).toBe(true);
    await openHealth(page);
    await expect(healthLine(page, 'analyse')).toHaveText(/^All analysed/);
    await expect(healthRow(page, 'crystals'), 'gone after Analyse').not.toContainText('no key yet');
  });

  test('K-2b. one track: the singular, "1 track has no key yet · Analyse tracks first so Assign can place it by key" @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const lib = withKeys(SPREAD54.slice(0, 30), 16824, { waiting: 1 });
    await seedPrefs(page);
    await openApp(page, lib, 30);
    await bandsReady(page);
    await openHealth(page);
    await expect(healthRow(page, 'crystals')).toContainText('1 track has no key yet · Analyse tracks first so Assign can place it by key');
  });

  test('K-4a. a cold cache: the press shows "Getting the keys ready… N left", writes nothing while the warm is held, and plans only after it @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    expect(PLAN30.keyed, 'Node: all 30 placed by key').toBe(30);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH30, 30);
    await openHealth(page);
    await expect(healthLine(page, 'crystals')).toHaveText('30 of 30 tracks have none');
    const left = (await keysState(page)).bandsLeft;
    expect(left, 'the warm is held: bands left').toBeGreaterThan(0);
    await healthAction(page, 'crystals').click();
    await expect(notices(page).getByText(/^Getting the keys ready… \d+ left$/), 'the press waits, and says so').toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect((await libraryState(page)).crystals.every((c) => c === null), 'nothing written while the bands are made').toBe(true);
    await page.evaluate(() => (window as any).__aetheriaKeyBands.hold(false));
    const want = crystalsAfter(FRESH30, PLAN30);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'then the plan with every band', timeout: 30_000 }).toBe(0);
    await expect(notices(page)).toContainText(`30 placed by key (${PLAN30.keyFits} where the tone fits)`);
  });

  test('K-4b. its Cancel ends the press: nothing is written, the bands are made anyway @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH30, 30);
    await openHealth(page);
    await healthAction(page, 'crystals').click();
    const toast = notices(page);
    await expect(toast.getByText(/^Getting the keys ready… \d+ left$/)).toBeVisible({ timeout: 10_000 });
    await toast.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => (window as any).__aetheriaKeyBands.hold(false));
    await bandsReady(page);
    await page.waitForTimeout(1500);
    expect((await libraryState(page)).crystals.every((c) => c === null), 'stopped: nothing written').toBe(true);
    await expect(healthLine(page, 'crystals')).toHaveText('30 of 30 tracks have none');
  });

  test('K-5. Track info: "Its key fits this crystal\'s tone." for a track on a band-0 crystal, not on a band-1 one, not without a clear key @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    // One chroma; a crystal where its band is 0 and one where it is 1. Three placed tracks (Assign's own records).
    const k = keyData(mulberry32(16826));
    const b = Array.from(bandsOf(k.chroma as number[], k.chromaA4Hz as number));
    const f0 = ALL_CRYSTALS[b.indexOf(0)], f1 = ALL_CRYSTALS[b.indexOf(1)];
    expect([b.includes(0), b.includes(1)], 'Node: the chroma fits one crystal and nearly fits another').toEqual([true, true]);
    const placed = (name: string, f: number, extra: Record<string, unknown>) => ({ id: `1772320000000-${name}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE_BYTES }, harmonicFreq: f, closestSolfeggio: f, harmonicDeviation: 3, crystalSource: 'assigned', ...k, ...extra });
    const lib = [placed('keyfit-a', f0, {}), placed('keyfit-b', f1, {}), placed('keyfit-c', f0, { keyConfidence: 0.3 })];
    await stubClipboard(page);
    expect(lib.map((s) => clearKey(s as never)), 'Node: two clear keys, one unclear').toEqual([true, true, false]);
    await seedPrefs(page);
    await openApp(page, lib, 3);
    await bandsReady(page);
    await openLibraryTab(page);
    const note = async (name: string) => {
      await page.getByTestId('library-search').fill(name);
      await page.getByRole('button', { name: `Options for ${name}`, exact: true }).click();
      await page.getByTestId('library-menu-info').click();
      const info = page.getByRole('dialog', { name: 'Track info', exact: true });
      const row = info.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) });
      const text = (await row.locator('dd span').first().textContent()) ?? '';
      await info.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(info).toHaveCount(0);
      await page.getByTestId('library-search').fill('');
      return text;
    };
    expect(await note('keyfit-a'), 'band 0').toBe("Assigned, not scanned yet. An assigned crystal, not a measured pitch. Its key fits this crystal's tone.");
    expect(await note('keyfit-b'), 'band 1').toBe('Assigned, not scanned yet. An assigned crystal, not a measured pitch.');
    expect(await note('keyfit-c'), 'no clear key').toBe('Assigned, not scanned yet. An assigned crystal, not a measured pitch.');
    // (Fix round 1, X29: Copy has the note too.)
    await page.getByTestId('library-search').fill('keyfit-a');
    await page.getByRole('button', { name: 'Options for keyfit-a', exact: true }).click();
    await page.getByTestId('library-menu-info').click();
    const info = page.getByRole('dialog', { name: 'Track info', exact: true });
    await info.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__copied as string | null), { message: 'Copy\'s text' }).toContain("An assigned crystal, not a measured pitch. Its key fits this crystal's tone.");
  });

  test('K-6. the key bands\' record: a reload makes none again (bandsLeft 0 at once); a corrupted record is ignored and rebuilt @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    const lib = withKeys(SPREAD54.slice(0, 20), 16827);
    const keys = new Set(lib.map((s) => contentKey(s)));
    await seedPrefs(page);
    await openApp(page, lib, 20);
    await bandsReady(page);
    expect((await keysState(page)).bandsMade, 'the first start makes them').toBe(keys.size);
    // (Fix round 1, X25: a reload within the 10 s debounce: only the pagehide write keeps them.)
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(20);
    await bandsReady(page);
    expect((await keysState(page)).bandsMade, 'the pagehide write kept them: none made again').toBe(0);
    await page.evaluate(() => (window as any).__aetheriaKeyBands.flush());
    const record = async () => page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const rec: any = await new Promise((resolve) => { const r = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('keyBands:v1'); r.onsuccess = () => resolve(r.result ?? null); });
      db.close();
      return rec ? { v: rec.v, keys: (rec.entries ?? []).map((e: any) => e[0]).sort() } : null;
    });
    await expect.poll(record, { message: 'the record, written', timeout: 10_000 }).toEqual({ v: 1, keys: [...keys].sort() });
    expect((await bandsRecord(page))?.fp?.length, 'with its fingerprint (fix round 3: the version, the edges, heard, the tones and four inputs)').toBe(8);
    // A reload: the record is read back, nothing is made again.
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(20);
    await bandsReady(page);
    expect((await keysState(page)).bandsMade, 'after the reload: none made again').toBe(0);
    // A corrupted record: ignored, the bands made again, and written whole.
    await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise<void>((resolve) => { const tx = db.transaction('playlist-state', 'readwrite'); tx.objectStore('playlist-state').put({ key: 'keyBands:v1', v: 1, entries: [['not a key', '0000']] }); tx.oncomplete = () => resolve(); });
      db.close();
    });
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(20);
    await bandsReady(page);
    expect((await keysState(page)).bandsMade, 'a corrupted record: every band made again').toBe(keys.size);
    await page.evaluate(() => (window as any).__aetheriaKeyBands.flush());
    await expect.poll(record, { message: 'and written whole again', timeout: 10_000 }).toEqual({ v: 1, keys: [...keys].sort() });
    // (Fix round 1, A-N11: a record of good entries with another fingerprint, another definition of the bands: refused,
    // made again.)
    await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const rec: any = await new Promise((resolve) => { const r = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('keyBands:v1'); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>((resolve) => { const tx = db.transaction('playlist-state', 'readwrite'); tx.objectStore('playlist-state').put({ ...rec, fp: ['0'.repeat(27), '0'.repeat(27)] }); tx.oncomplete = () => resolve(); });
      db.close();
    });
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(20);
    await bandsReady(page);
    expect((await keysState(page)).bandsMade, 'another fingerprint: every band made again').toBe(keys.size);
    // (X16: a deleted track's content key goes from the record at the next write. The record written whole; a track
    // deleted; another's entry taken out of the record, so the next start makes one band and writes again, pruned.)
    await page.evaluate(() => (window as any).__aetheriaKeyBands.flush());
    await expect.poll(async () => (await bandsRecord(page))?.keys, { message: 'written whole', timeout: 10_000 }).toEqual([...keys].sort());
    const gone = lib[0], other = contentKey(lib[1]);
    await openLibraryTab(page);
    await page.getByTestId('library-search').fill(gone.name);
    await rowMenu(page, gone.name).click();
    await page.getByTestId('library-menu-delete').click();
    await confirmDelete(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 10_000 }).toBe(19);
    await page.evaluate(async (other) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const rec: any = await new Promise((resolve) => { const r = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('keyBands:v1'); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>((resolve) => { const tx = db.transaction('playlist-state', 'readwrite'); tx.objectStore('playlist-state').put({ ...rec, entries: rec.entries.filter((e: any) => e[0] !== other) }); tx.oncomplete = () => resolve(); });
      db.close();
    }, other);
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(19);
    await bandsReady(page);
    expect((await keysState(page)).bandsMade, 'the one taken out: made again').toBe(1);
    await page.evaluate(() => (window as any).__aetheriaKeyBands.flush());
    await expect.poll(async () => (await bandsRecord(page))?.keys, { message: 'written pruned: the deleted track\'s key gone', timeout: 10_000 }).toEqual([...keys].filter((k) => k !== contentKey(gone)).sort());
  });

  test('K-7. no key data anywhere: v16.8.1\'s line, confirmation, crystals and notice; no new sentence @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    // The older spread of K-3b without any key field; 4 never analysed (no chromaVersion: "waiting" for a key).
    const lib = applyPlan(BUNCH40, quietly(() => spreadV1671(BUNCH40 as never))).map((s, i) => { const c = { ...s }; for (const f of KEY_FIELDS) if (i < 4) delete (c as any)[f]; return c; });
    const old = quietly(() => spreadV1681(lib as never));
    const words = wordsV1681(old);
    const plan = keyPlan(lib);
    expect([plan.keyed, plan.awaitingKey], 'Node: nothing placed by key, 4 waiting').toEqual([0, 4]);
    expect([...plan.patches.entries()].sort(), "Node: v16.8.1's patches").toEqual([...old.patches.entries()].sort());
    await seedPrefs(page);
    await openApp(page, lib, 40);
    await bandsReady(page);
    await openHealth(page);
    await expect(healthLine(page, 'crystals')).toHaveText(`All 40 have one · Assign would move ${crystalMoves(old)} of them`);
    await expect(healthRow(page, 'crystals'), 'no sub-line').not.toContainText('no key yet');
    await healthAction(page, 'crystals').click();
    const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
    await expect(ask.getByTestId('dialog-body')).toHaveText(words.confirm);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    const want = crystalsAfter(lib, old);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: "v16.8.1's crystals", timeout: 20_000 }).toBe(0);
    await expect(notices(page).getByText(words.done, { exact: true }), "v16.8.1's notice").toBeVisible();
  });
});

test.describe('v16.8.2 fix round 1, the press while its bands are made', () => {
  test.use({ layoutSeed: 'new' });

  test('K-4c. the card on a library with crystals, its bands held: the toast, nothing written; released: its confirmation is the plan on every band @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, LIB2, 56);
    await openHealth(page);
    await expect(healthLine(page, 'crystals')).toHaveText('2 of 56 tracks have none');
    expect((await keysState(page)).bandsLeft, 'held: bands left').toBeGreaterThan(0);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    await expect(notices(page).getByText(/^Getting the keys ready… \d+ left$/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true }), 'no confirmation on partial bands').toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(differing(await crystalsById(page), before), 'nothing written while held').toEqual([]);
    await release(page);
    const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
    await expect(ask.getByTestId('dialog-body'), 'the confirmation of the plan on every band').toHaveText(assignConfirmText(PLAN2).body, { timeout: 30_000 });
    await expect(keysToast(page), 'fix round 3 (F6 / N-F3): the keys toast is gone once the press asks').toHaveCount(0);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    const want = crystalsAfter(LIB2, PLAN2);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'the plan on every band', timeout: 20_000 }).toBe(0);
  });

  test('K-SF1. keys land during the wait (an Analyse pass): the warm goes again, and the confirmation still shows; nothing written before it @mobile', async ({ page }) => {
    test.setTimeout(300_000);
    // 6 s tones: Analyse reads a clear key from them (devices.spec P5). Five of LIB2's tracks never analysed.
    const tone6 = toneWav(6, 330);
    const lib = LIB2.map((x, i) => (i < 5 ? (({ chroma, chromaA4Hz, musicKey, keyConfidence, chromaVersion, ...rest }: any) => rest)(x) : x)).map((x) => ({ ...x, file: { name: x.file.name, size: tone6.length } }));
    await seedPrefs(page, { hold: true });
    await openApp(page, lib, 56, 'new', tone6);
    await openHealth(page);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    await expect(notices(page).getByText(/^Getting the keys ready… \d+ left$/)).toBeVisible({ timeout: 10_000 });
    const left0 = (await keysState(page)).bandsLeft;
    await healthAction(page, 'analyse').click();
    await expect.poll(async () => page.evaluate(() => { const a = (window as any).__aetheriaAnalyse; return a.state().phase === 'idle' && a.last()?.outcome === 'finished'; }), { message: 'the pass ends', timeout: 180_000 }).toBe(true);
    await expect.poll(async () => (await keysState(page)).bandsLeft, { message: 'its new clear keys: more bands missing than at the press', timeout: 30_000 }).toBeGreaterThan(left0);
    await release(page);
    const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
    await expect(ask, 'the confirmation shows').toBeVisible({ timeout: 60_000 });
    expect((await keysState(page)).bandsLeft, 'planned on every band').toBe(0);
    expect(differing(await crystalsById(page), before), 'nothing written before it').toEqual([]);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect.poll(async () => differing(await crystalsById(page), before).length, { message: 'written after Assign', timeout: 20_000 }).toBeGreaterThan(0);
  });

  test('K-SF2. leaving the card during the wait: the press waits in App, a toast says how to finish, and the card asks when it is back @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, LIB2, 56);
    await openHealth(page);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    await expect(notices(page).getByText(/^Getting the keys ready… \d+ left$/)).toBeVisible({ timeout: 10_000 });
    await tab(page, 'now');
    await release(page);
    await expect(notices(page).getByText('Keys ready · open Library to Assign', { exact: true }), 'never silent').toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    expect(differing(await crystalsById(page), before), 'nothing written away from the card').toEqual([]);
    // (Fix round 2, R07: the toast's Open goes to Library.)
    await notices(page).getByRole('button', { name: 'Open', exact: true }).click();
    const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
    await expect(ask.getByTestId('dialog-body'), 'the card asks when it is back').toHaveText(assignConfirmText(PLAN2).body, { timeout: 15_000 });
    expect(differing(await crystalsById(page), before), 'still nothing written').toEqual([]);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    const want = crystalsAfter(LIB2, PLAN2);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'then the plan', timeout: 20_000 }).toBe(0);
  });

  test('K-4d. a Clear while the press waits: nothing written on the library imported after it, the toast gone, no band made for the cleared one, no record @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH300, 300);
    await openHealth(page);
    await healthAction(page, 'crystals').click();
    await expect(notices(page).getByText(/^Getting the keys ready… \d+ left$/)).toBeVisible({ timeout: 10_000 });
    // (Fix round 2, R5.3: the press's warm makes some bands, then parks between slices; the Clear lands while it waits.
    // R08, the debounced write taking the generation after the warm, would then write a record.)
    await parkAfter(page, 10);
    const k0 = await keysState(page);
    expect([k0.bandsCached >= 10, k0.bandsLeft > 0], 'before the Clear: bands made, the warm not done').toEqual([true, true]);
    expect(await bandsRecord(page), 'and no record yet').toBeNull();
    await clearLibrary(page);
    // (The parked warm sees the Clear at its next check, within 250 ms, and ends: what it made is counted then.)
    await expect.poll(async () => ((await libraryState(page)) as any).bandsWarming, { message: 'the Clear ends the press\'s warm', timeout: 5_000 }).toBe(false);
    await page.getByTestId('library-import').click();
    await addFiles(page,[0, 1, 2].map((i) => ({ name: `keyclear-${i + 1}.wav`, mimeType: 'audio/wav', buffer: toneWav(1, 330 + 20 * i) })));
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(3);
    const made = (await keysState(page)).bandsMade;
    await release(page);
    await page.waitForTimeout(3000);
    expect((await libraryState(page)).crystals, 'the press did not resume: no crystal on the new tracks').toEqual([null, null, null]);
    await expect(notices(page).getByText(/^Getting the keys ready/), 'the toast gone').toHaveCount(0);
    expect((await keysState(page)).bandsMade, 'no band made for the cleared library').toBe(made);
    await page.waitForTimeout(8_000); // (with the 3 s above, past the 10 s debounce a write would have used)
    expect(await bandsRecord(page), 'no record after the debounce').toBeNull();
    await page.evaluate(() => (window as any).__aetheriaKeyBands.flush());
    expect(await bandsRecord(page), 'nor after a flush').toBeNull();
  });

  test('K-4e. a Clear while a write waits (the bands made, the 10 s debounce running): no record after it @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await seedPrefs(page);
    await openApp(page, FRESH30, 30);
    await bandsReady(page);
    expect((await keysState(page)).bandsMade, 'made').toBeGreaterThan(0);
    await openHealth(page);
    // (Fix round 2, R5.3: the write is still waiting on its debounce when the Clear lands.)
    expect([await page.evaluate(() => (window as any).__aetheriaKeyBands.pending()), await bandsRecord(page)], 'a write waits, none written yet').toEqual([true, null]);
    await clearLibrary(page);
    await page.waitForTimeout(11_000); // the debounce's time passes
    expect(await bandsRecord(page), 'no record after the debounce').toBeNull();
    await page.evaluate(() => (window as any).__aetheriaKeyBands.flush());
    expect(await bandsRecord(page), 'nor after a flush').toBeNull();
  });

  test('K-1e. two presses while the bands are held: the second is dropped (false), the first goes on (true) @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH30, 30);
    expect((await keysState(page)).bandsLeft, 'held: bands left').toBeGreaterThan(0);
    // Two presses (X23: the second resolves false, never as the first).
    await page.evaluate(() => { const w = window as any; w.__r = []; w.__aetheriaKeyBands.press(false).then((v: boolean) => (w.__r[0] = v)); w.__aetheriaKeyBands.press(false).then((v: boolean) => (w.__r[1] = v)); });
    await expect(notices(page).getByText(/^Getting the keys ready… \d+ left$/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__r.slice()), 'both wait').toEqual([]);
    await release(page);
    await expect.poll(() => page.evaluate(() => (window as any).__r.slice()), { message: 'the first true, the second dropped', timeout: 30_000 }).toEqual([true, false]);
  });

  test('K-1f. Scan again\'s quiet press, then a user\'s: the quiet one ends (false), the user\'s goes on with its toast (true) @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH30, 30);
    await page.evaluate(() => { const w = window as any; w.__r = []; w.__aetheriaKeyBands.press(true).then((v: boolean) => (w.__r[0] = v)); });
    await page.waitForTimeout(500);
    await expect(notices(page).getByText(/^Getting the keys ready/), 'quiet: no toast').toHaveCount(0);
    await page.evaluate(() => { const w = window as any; w.__aetheriaKeyBands.press(false).then((v: boolean) => (w.__r[1] = v)); });
    await expect.poll(() => page.evaluate(() => (window as any).__r[0] ?? null), { message: 'the quiet press ends', timeout: 10_000 }).toBe(false);
    await expect(notices(page).getByText(/^Getting the keys ready… \d+ left$/), 'the user\'s press: its toast').toBeVisible({ timeout: 10_000 });
    await release(page);
    await expect.poll(() => page.evaluate(() => (window as any).__r.slice()), { message: 'the user\'s press done', timeout: 30_000 }).toEqual([false, true]);
    expect((await keysState(page)).bandsLeft, 'every band made').toBe(0);
  });

  test('K-3c. while something is busy (an Analyse pass, its decodes held) the D8 line keeps its count and its reason @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await holdDecodes(page);
    await seedPrefs(page);
    await openApp(page, LIB1, 54);
    await bandsReady(page);
    await openHealth(page);
    const line = `All 54 have one · Assign would move ${M1} of them · to place tracks by key`;
    await expect(healthLine(page, 'crystals')).toHaveText(line);
    await page.evaluate(() => ((window as any).__holdDecodes = true));
    await healthAction(page, 'analyse').click();
    await expect(page.getByTestId('library-health-status')).toHaveText('Analysing…', { timeout: 15_000 });
    await expect(healthLine(page, 'crystals'), 'held: the count and the reason').toHaveText(line);
    await page.evaluate(() => (window as any).__releaseDecodes());
  });
});

test.describe('v16.8.2 fix round 2, the press and the phone warm', () => {
  test.use({ layoutSeed: 'new' });

  test('K-R2a. the confirmation is the plan applied: a library changed under the dialog (an Analyse pass lands keys) asks again with the new counts; then exactly that plan @mobile', async ({ page }) => {
    test.setTimeout(300_000);
    await holdDecodes(page);
    await seedPrefs(page);
    await openApp(page, LIB2A, 56, 'new', TONE6);
    await bandsReady(page);
    await openHealth(page);
    const before = await crystalsById(page);
    await page.evaluate(() => ((window as any).__holdDecodes = true));
    await healthAction(page, 'analyse').click();
    await expect(page.getByTestId('library-health-status')).toHaveText('Analysing…', { timeout: 15_000 });
    await healthAction(page, 'crystals').click();
    const ask = askDialog(page);
    const P0 = keyPlan(await storedLibrary(page, LIB2A));
    await expect(ask.getByTestId('dialog-body'), 'the dialog: the plan of the library as it is').toHaveText(assignConfirmText(P0).body, { timeout: 15_000 });
    await page.evaluate(() => (window as any).__releaseDecodes());
    await analyseToEnd(page, LIB2A_IDS);
    await bandsReady(page);
    const latest = await storedLibrary(page, LIB2A);
    const P1 = keyPlan(latest);
    expect(assignConfirmText(P1).body, 'Node: the keys change the counts').not.toBe(assignConfirmText(P0).body);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(ask.getByTestId('assign-counts'), 'a fresh dialog, the new counts').toHaveText(assignConfirmText(P1).body, { timeout: 15_000 });
    await expect(ask.getByTestId('assign-changed'), 'fix round 3 (F1): it says why').toHaveText(ASSIGN_CHANGED_LINE);
    await expect(page.locator(':focus'), 'focus on Cancel').toHaveText('Cancel');
    await page.waitForTimeout(800);
    expect(differing(await crystalsById(page), before), 'nothing written on the first Assign').toEqual([]);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    const want = crystalsAfter(latest, P1);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'exactly the plan it showed', timeout: 20_000 }).toBe(0);
  });

  test('K-SF3. App\'s press waits for every band, the keys that land while it waits included: "Keys ready" only once none is missing @mobile', async ({ page }) => {
    test.setTimeout(300_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, LIB2A, 56, 'new', TONE6);
    await openHealth(page);
    await page.evaluate(() => { const w = window as any; w.__done = null; w.__aetheriaKeyBands.assign().then(() => { w.__done = w.__aetheriaKeyBands.left(); }); });
    const left0 = (await keysState(page)).bandsLeft;
    await healthAction(page, 'analyse').click();
    await analyseToEnd(page, LIB2A_IDS);
    await expect.poll(async () => (await keysState(page)).bandsLeft, { message: 'its new clear keys: more bands missing', timeout: 30_000 }).toBeGreaterThan(left0);
    await tab(page, 'now');
    await release(page);
    await expect(readyToast(page)).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__done), { message: 'the press done', timeout: 10_000 }).not.toBeNull();
    expect(await page.evaluate(() => (window as any).__done), 'no band missing when it said Keys ready (R30)').toBe(0);
  });

  test('K-SF4. a card mounted later takes the press with new bands missing, its re-warm ending in the same task: the confirmation of the plan on every band, nothing written @mobile', async ({ page }) => {
    test.setTimeout(300_000);
    await holdDecodes(page);
    await seedPrefs(page, { hold: true });
    await openApp(page, LIB2A, 56, 'new', TONE6);
    await openHealth(page);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => ((window as any).__holdDecodes = true));
    await healthAction(page, 'analyse').click();
    await expect.poll(() => page.evaluate(() => (window as any).__aetheriaAnalyse.state().phase), { message: 'the pass runs', timeout: 15_000 }).not.toBe('idle');
    await tab(page, 'now');
    await release(page);
    await expect(readyToast(page), 'App finished the press with no card').toBeVisible({ timeout: 30_000 });
    await hook(page, true);
    const left0 = (await keysState(page)).bandsLeft;
    await page.evaluate(() => (window as any).__releaseDecodes());
    await analyseToEnd(page, LIB2A_IDS);
    await expect.poll(async () => (await keysState(page)).bandsLeft, { message: 'its new keys, their bands held', timeout: 30_000 }).toBeGreaterThan(left0);
    const latest = await storedLibrary(page, LIB2A);
    const P = keyPlan(latest);
    // The hold released and the Library tab tapped in one task: the card mounts, takes the press, finds bands missing,
    // and App's re-warm makes them in its first slice (one content key: the analysed tracks are one tone).
    await page.evaluate(() => {
      const b = (document.querySelector('[data-testid="tab-library-button"]') ?? document.querySelector('[data-testid="nav-library"]')) as HTMLElement;
      (window as any).__aetheriaKeyBands.hold(false);
      b.click();
    });
    await expect(askDialog(page).getByTestId('dialog-body'), 'the confirmation, the plan on every band').toHaveText(assignConfirmText(P).body, { timeout: 15_000 });
    expect(differing(await crystalsById(page), before), 'nothing written').toEqual([]);
  });

  test('K-SF5. a card mounted later on a library with no crystals: after its re-warm it still asks; nothing written before Assign @mobile', async ({ page }) => {
    test.setTimeout(300_000);
    const fresh = withKeys(Array.from({ length: 30 }, (_, i) => { const name = `keyfresh5-${String(i + 1).padStart(2, '0')}`; return { id: `1772370000000-kg${String(i).padStart(2, '0')}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE6.length } }; }), 16832, { waiting: 5 });
    const ids = fresh.slice(0, 5).map((x) => x.id);
    await holdDecodes(page);
    await seedPrefs(page, { hold: true });
    await openApp(page, fresh, 30, 'new', TONE6);
    await openHealth(page);
    await healthAction(page, 'crystals').click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => ((window as any).__holdDecodes = true));
    await healthAction(page, 'analyse').click();
    await expect.poll(() => page.evaluate(() => (window as any).__aetheriaAnalyse.state().phase), { message: 'the pass runs', timeout: 15_000 }).not.toBe('idle');
    await tab(page, 'now');
    await release(page);
    await expect(readyToast(page)).toBeVisible({ timeout: 30_000 });
    await hook(page, true);
    await page.evaluate(() => (window as any).__releaseDecodes());
    await analyseToEnd(page, ids);
    // (Fix round 3, F3: the pass's own end toast up for 10 s stands; once it is gone, the card's re-warm shows the keys
    // toast with its Cancel.)
    await page.waitForTimeout(10_500);
    await openLibraryTab(page);
    await page.getByTestId('library-health').waitFor();
    await expect(keysToast(page), 'F3: the re-warm says so').toBeVisible({ timeout: 10_000 });
    await expect(notices(page).getByRole('button', { name: 'Cancel', exact: true }), 'with its Cancel').toBeVisible();
    await page.waitForTimeout(1000);
    await release(page);
    await expect(askDialog(page), 'the card that didn\'t press asks (R2c)').toBeVisible({ timeout: 30_000 });
    expect((await libraryState(page)).crystals.every((c) => c === null), 'nothing written before Assign').toBe(true);
  });

  test('K-SF2b. a card mounted later asks even with no crystal to change (FRESH30), reached through the toast\'s Open; nothing written @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH30, 30);
    await openHealth(page);
    await healthAction(page, 'crystals').click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    await tab(page, 'now');
    await release(page);
    await expect(readyToast(page)).toBeVisible({ timeout: 30_000 });
    await notices(page).getByRole('button', { name: 'Open', exact: true }).click();
    await expect(askDialog(page), 'the later card asks (R01)').toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
    expect((await libraryState(page)).crystals.every((c) => c === null), 'nothing written before Assign').toBe(true);
    // (Fix round 3, F6 / N-T1: the press is taken once: Cancel, leave, come back: the re-mounted card doesn't ask again.)
    await askDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(askDialog(page)).toHaveCount(0);
    await tab(page, 'now');
    await openLibraryTab(page);
    await page.getByTestId('library-health').waitFor();
    await page.waitForTimeout(1500);
    await expect(askDialog(page), 'taken once: no second ask on a re-mount').toHaveCount(0);
  });

  test('K-R2d. a prune takes a band while the press warms: the press tries once more, and still ends in "Keys ready" @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH300, 300);
    await tab(page, 'now');
    await page.evaluate(() => { const w = window as any; w.__done = null; w.__aetheriaKeyBands.assign().then(() => { w.__done = true; }); });
    await parkAfter(page, 20);
    expect((await keysState(page)).bandsLeft, 'the warm not done').toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).__aetheriaKeyBands.dropBand(0)), 'a prune takes track 0\'s band (made in the first slice)').toBe(true);
    await release(page);
    await expect(readyToast(page), 'never silent: the press tried once more').toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => (window as any).__done)).toBe(true);
  });

  test('K-R2e. a pending press with nothing to do is a direct press with nothing to do: the toast, no dialog @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const spread = applyPlan(LIB1, PLAN1);
    const P = keyPlan(spread);
    expect(P.patches.size, 'Node: already spread by key, nothing to do').toBe(0);
    await seedPrefs(page, { hold: true });
    await openApp(page, spread, 54);
    await tab(page, 'now');
    await page.evaluate(() => { void (window as any).__aetheriaKeyBands.assign(); });
    await release(page);
    await expect(readyToast(page)).toBeVisible({ timeout: 30_000 });
    await notices(page).getByRole('button', { name: 'Open', exact: true }).click();
    await expect(notices(page).getByText(assignNothingText(P), { exact: true }), 'the direct press\'s toast').toBeVisible({ timeout: 15_000 });
    await expect(askDialog(page), 'no dialog for nothing').toHaveCount(0);
  });

  test('K-R2f. the keys toast of a later pass (keys landing while the press waits) never comes back over another toast @desktop-only', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'music plays here: a phone holds its warm around a short track');
    test.setTimeout(300_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, LIB2A, 56, 'new', TONE6);
    await openHealth(page);
    await healthAction(page, 'crystals').click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    const left0 = (await keysState(page)).bandsLeft;
    await healthAction(page, 'analyse').click();
    await analyseToEnd(page, LIB2A_IDS);
    await expect.poll(async () => (await keysState(page)).bandsLeft, { message: 'its new keys, held', timeout: 30_000 }).toBeGreaterThan(left0);
    const rows = page.getByTestId('library-list').locator('button[data-row-index]');
    await rows.nth(0).scrollIntoViewIfNeeded();
    await rows.nth(0).click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 15_000 }).toBe(true);
    await rows.nth(1).click();
    await expect(undoToast(page), 'the tap\'s Undo toast').toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    await release(page);
    await expect(askDialog(page), 'the press goes on to its confirmation').toBeVisible({ timeout: 30_000 });
    await expect(undoToast(page), 'the Undo toast still stands').toBeVisible();
    await expect(keysToast(page), 'the keys toast never came back over it').toHaveCount(0);
  });

  test('PB. another toast that replaces the keys toast stands: neither refreshed over nor dismissed at the press end @desktop-only', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'music plays here: a phone holds its warm around a short track');
    test.setTimeout(150_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, LIB2, 56);
    await openHealth(page);
    await healthAction(page, 'crystals').click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    const rows = page.getByTestId('library-list').locator('button[data-row-index]');
    await rows.nth(0).scrollIntoViewIfNeeded();
    await rows.nth(0).click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 15_000 }).toBe(true);
    await rows.nth(1).click();
    await expect(undoToast(page), 'the tap\'s Undo toast').toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500); // past the keys toast's 1 s refresh
    await release(page);
    await expect(askDialog(page), 'the press goes on to its confirmation').toBeVisible({ timeout: 30_000 });
    await expect(undoToast(page), 'the Undo toast still stands').toBeVisible();
    await expect(keysToast(page), 'the keys toast never came back over it').toHaveCount(0);
  });

  test('K-5b. Lo Shu Perfect GUT on: Track info has no "Its key fits" note on a crystal Lo Shu swaps, and neither has Copy @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    // A chroma with a band-0 crystal among the six Lo Shu swaps (174, 285, 396, 417, 528, 639).
    let k: Record<string, unknown> = {}, f = 0;
    for (let seed = 17000; seed < 17400 && !f; seed++) {
      k = keyData(mulberry32(seed));
      const b = Array.from(bandsOf(k.chroma as number[], k.chromaA4Hz as number));
      f = [174, 285, 396, 417, 528, 639].find((c) => b[ALL_CRYSTALS.indexOf(c)] === 0) ?? 0;
    }
    expect(f, 'Node: a swapped crystal that fits').toBeGreaterThan(0);
    const lib = [{ id: '1772380000000-loshu', name: 'keyloshu-a', duration: 200, file: { name: 'keyloshu-a.wav', size: TONE_BYTES }, harmonicFreq: f, closestSolfeggio: f, harmonicDeviation: 3, crystalSource: 'assigned', ...k }];
    await stubClipboard(page);
    await page.addInitScript(() => { try { localStorage.setItem('aetheria.loShuPerfectGUT.v1', 'true'); } catch {} });
    await seedPrefs(page);
    await openApp(page, lib, 1);
    await bandsReady(page);
    await openLibraryTab(page);
    await page.getByRole('button', { name: 'Options for keyloshu-a', exact: true }).click();
    await page.getByTestId('library-menu-info').click();
    const info = page.getByRole('dialog', { name: 'Track info', exact: true });
    const row = info.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) });
    await expect(row.locator('dd span').first()).toHaveText('Assigned, not scanned yet. An assigned crystal, not a measured pitch.');
    await info.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__copied as string | null), { message: 'Copy\'s text' }).toContain('An assigned crystal, not a measured pitch.');
    expect(await page.evaluate(() => (window as any).__copied as string), 'Copy without the note').not.toContain('Its key fits');
  });

  test('PC. a hidden phone page parks the warm until it shows; then it goes on @mobile', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile-ua', 'a phone (mobile-ua) only: a desktop never parks');
    test.setTimeout(150_000);
    await controllableVisibility(page);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH300, 300);
    const k0 = await keysState(page);
    expect(k0.bandsLeft, 'held: every band left').toBeGreaterThan(0);
    await page.evaluate(() => (window as any).__setHidden(true));
    await release(page);
    await page.waitForTimeout(3000);
    expect((await keysState(page)).bandsCached, 'hidden: no band made').toBe(k0.bandsCached);
    await page.evaluate(() => (window as any).__setHidden(false));
    await expect.poll(async () => (await keysState(page)).bandsLeft, { message: 'shown: the warm goes on', timeout: 60_000 }).toBe(0);
  });

  test('PD. the press on a phone keeps to duty 0.5 (its work under 0.65 of its wall time) @mobile', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile-ua', 'a phone (mobile-ua) only');
    test.setTimeout(150_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH300, 300);
    await page.evaluate(() => { const w = window as any; w.__pr = null; w.__aetheriaKeyBands.hold(false); w.__aetheriaKeyBands.press(false).then((v: boolean) => (w.__pr = v)); });
    await expect.poll(() => page.evaluate(() => (window as any).__pr), { timeout: 60_000 }).toBe(true);
    const d: any = await libraryState(page);
    const duty = d.bandsWallMs > 0 ? d.bandsWorkMs / d.bandsWallMs : 1;
    console.log(`PD: the press's warm: work ${Math.round(d.bandsWorkMs)} ms of ${Math.round(d.bandsWallMs)} ms (${duty.toFixed(2)})`);
    expect(duty, 'the press duty').toBeLessThan(0.65);
  });

  test('K-R3. a phone\'s warm holds while a track ends, and a track that never loads holds it at most LOADING_HOLD_MAX_MS @mobile', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile-ua', 'a phone (mobile-ua) only: a desktop never holds');
    test.setTimeout(150_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, FRESH300, 300);
    const k0 = await keysState(page);
    // (a track in its last 5 s: the 'end' hold, holdFor)
    await page.evaluate(() => (window as any).__aetheriaKeyBands.playback({ paused: false, duration: 100, currentTime: 98, playbackRate: 1, starting: false }));
    await release(page);
    await page.waitForTimeout(2500);
    expect((await keysState(page)).bandsCached, 'held while the track ends: no band made').toBe(k0.bandsCached);
    // (a track that never loads: 'loading', capped)
    await page.evaluate(() => (window as any).__aetheriaKeyBands.playback({ paused: false, duration: NaN, currentTime: 0, playbackRate: 1, starting: false }));
    const t0 = Date.now();
    await page.waitForTimeout(3000);
    expect((await keysState(page)).bandsCached, 'loading: held at first').toBe(k0.bandsCached);
    // (Each wait's 'loading' lasts at most LOADING_HOLD_MAX_MS, as the Analyse gate's each step: the warm goes on.)
    await expect.poll(async () => (await keysState(page)).bandsCached, { message: 'the loading cap lets a slice go (10 s)', timeout: 30_000 }).toBeGreaterThan(k0.bandsCached);
    const secs = (Date.now() - t0) / 1000;
    expect(secs, 'not before the cap').toBeGreaterThan(8);
    await page.evaluate(() => (window as any).__aetheriaKeyBands.playback(undefined));
    await expect.poll(async () => (await keysState(page)).bandsLeft, { message: 'the real element again (nothing playing): the warm ends', timeout: 60_000 }).toBe(0);
  });
});

test.describe('v16.8.2 fix round 3, the confirmation and the lengths', () => {
  test.use({ layoutSeed: 'new' });

  for (const keyed of [false, true]) {
    test(`KF1${keyed ? 'b' : 'a'}. lengths still being read (600 tracks after an import, ${keyed ? 'keyed' : 'keyless'}): the press waits for them, then ${keyed ? 'at most one re-ask, with its line' : 'one Assign applies'}; exactly the plan @mobile`, async ({ page }) => {
      test.setTimeout(300_000);
      const lib = lengthsLibrary(keyed);
      await holdDurationProbes(page, true);
      await seedPrefs(page);
      await openApp(page, lib, 620);
      await openHealth(page);
      const before = await crystalsById(page);
      await healthAction(page, 'crystals').click();
      await expect(lengthsToast(page), 'the press waits for the lengths, and says so').toBeVisible({ timeout: 10_000 });
      await expect(notices(page).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
      await page.waitForTimeout(1000);
      await expect(askDialog(page), 'no plan while lengths are read').toHaveCount(0);
      expect(differing(await crystalsById(page), before), 'nothing written').toEqual([]);
      await page.evaluate(() => (window as any).__releaseDurations());
      const ask = askDialog(page);
      let reasks = 0, taps = 0, changedLines = 0;
      // (Tap Assign as soon as it shows, again whenever it asks again; the lengths may still be landing for a dialog that
      // shows without needing them.)
      for (; taps < 20; ) {
        const shown = await ask.waitFor({ state: 'visible', timeout: taps ? 3000 : 60_000 }).then(() => true, () => false);
        if (!shown) break;
        if (taps) { reasks++; if (await ask.getByTestId('assign-changed').count()) changedLines++; }
        await ask.getByRole('button', { name: 'Assign', exact: true }).click();
        taps++;
        await page.waitForTimeout(400);
      }
      await expect.poll(async () => ((await libraryState(page)).libraryDurations as any[]).filter((d) => !d).length, { message: 'every length read', timeout: 120_000 }).toBe(0);
      const latest = await inPageLibrary(page, lib);
      const want = crystalsAfter(latest, keyPlan(latest));
      await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'exactly the plan of the library as read', timeout: 20_000 }).toBe(0);
      test.info().annotations.push({ type: 'KF1', description: `taps ${taps}, re-asks ${reasks} (with the line ${changedLines})` });
      if (keyed) {
        expect(reasks, 'at most one fresh dialog after the read').toBeLessThanOrEqual(1);
        expect(changedLines, 'and it says why').toBe(reasks);
      } else expect([taps, reasks], 'one tap applies, no re-ask').toEqual([1, 0]);
    });
  }

  test('KF1d. the length wait: its Cancel ends the press (nothing written); a Clear ends it too @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    const lib = lengthsLibrary(false);
    await holdDurationProbes(page, true);
    await seedPrefs(page);
    await openApp(page, lib, 620);
    await openHealth(page);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    await expect(lengthsToast(page)).toBeVisible({ timeout: 10_000 });
    await notices(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => (window as any).__releaseDurations());
    await expect.poll(async () => ((await libraryState(page)).libraryDurations as any[]).filter((d) => !d).length, { message: 'every length read', timeout: 120_000 }).toBe(0);
    await page.waitForTimeout(1500);
    await expect(askDialog(page), 'Cancelled: no dialog').toHaveCount(0);
    expect(differing(await crystalsById(page), before), 'nothing written').toEqual([]);
    // (A second press, then a Clear while it waits: nothing comes back on the library imported after it.)
    await page.evaluate(() => ((window as any).__holdDurations = true));
    await page.getByTestId('library-import').click();
    await addFiles(page, [0, 1].map((i) => ({ name: `durclear-${i + 1}.wav`, mimeType: 'audio/wav', buffer: toneWav(1, 300 + 20 * i) })));
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(622);
    await page.keyboard.press('Escape');
    await healthAction(page, 'crystals').click();
    await expect(lengthsToast(page)).toBeVisible({ timeout: 10_000 });
    await clearLibrary(page);
    await page.evaluate(() => (window as any).__releaseDurations());
    await page.waitForTimeout(3000);
    await expect(askDialog(page), 'Cleared: no dialog').toHaveCount(0);
    await expect(lengthsToast(page), 'and its toast gone').toHaveCount(0);
  });

  for (const open of [true, false]) {
    test(`KF${open ? '1c' : '2'}. an Analyse pass that changes nothing the plan reads (visual sync only) lands while the dialog is open${open ? '' : ', and the card folds'}: the dialog stays, one Assign applies @mobile`, async ({ page }) => {
      test.setTimeout(300_000);
      const lib = visualLibrary(open);
      const n = lib.length;
      const P = keyPlan(lib);
      await holdDecodes(page);
      await seedPrefs(page);
      await openApp(page, lib, n, 'new', TONE6);
      await bandsReady(page);
      await openHealth(page);
      const before = await crystalsById(page);
      await page.evaluate(() => ((window as any).__holdDecodes = true));
      await healthAction(page, 'analyse').click();
      await expect(page.getByTestId('library-health-status')).toHaveText('Analysing…', { timeout: 15_000 });
      await healthAction(page, 'crystals').click();
      const ask = askDialog(page);
      await expect(ask.getByTestId('dialog-body'), 'the plan, Node\'s').toHaveText(assignConfirmText(P).body, { timeout: 15_000 });
      await page.evaluate(() => (window as any).__releaseDecodes());
      await expect.poll(async () => page.evaluate(() => { const a = (window as any).__aetheriaAnalyse; return a.state().phase === 'idle' && a.last()?.outcome === 'finished'; }), { message: 'the pass ends', timeout: 180_000 }).toBe(true);
      await page.waitForTimeout(800);
      await expect(ask, open ? 'the dialog still up' : 'F2: the dialog still up though the card would fold').toBeVisible();
      await expect(page.getByTestId('library-health')).toHaveAttribute('data-open', 'true');
      expect(differing(await crystalsById(page), before), 'nothing written yet').toEqual([]);
      await ask.getByRole('button', { name: 'Assign', exact: true }).click();
      await page.waitForTimeout(600);
      await expect(ask, 'F1: the plan is the same, so this tap applies it: no re-ask').toHaveCount(0);
      const want = crystalsAfter(lib, P);
      await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'exactly the plan shown', timeout: 20_000 }).toBe(0);
      // (Fix round 4, G4: the card folds once the dialog closes: focus goes to its toggle, not <body>.)
      if (!open) await expect(page.getByTestId('library-health-toggle'), 'G4: focus on the folded card\'s toggle').toBeFocused({ timeout: 5000 });
    });
  }

  test('K-R2a-held. the library changed under the dialog and its new bands not made yet: the first Assign waits for them, then asks the plan on every band, saying why @mobile', async ({ page }) => {
    test.setTimeout(300_000);
    await holdDecodes(page);
    await seedPrefs(page);
    await openApp(page, LIB2A, 56, 'new', TONE6);
    await bandsReady(page);
    await openHealth(page);
    const before = await crystalsById(page);
    await page.evaluate(() => ((window as any).__holdDecodes = true));
    await healthAction(page, 'analyse').click();
    await expect(page.getByTestId('library-health-status')).toHaveText('Analysing…', { timeout: 15_000 });
    await healthAction(page, 'crystals').click();
    const ask = askDialog(page);
    await expect(ask, 'the first dialog').toBeVisible({ timeout: 15_000 });
    const P0 = keyPlan(await storedLibrary(page, LIB2A));
    await hook(page, true);
    await page.evaluate(() => (window as any).__releaseDecodes());
    await analyseToEnd(page, LIB2A_IDS);
    await expect.poll(async () => (await keysState(page)).bandsLeft, { message: 'the new keys, their bands held', timeout: 30_000 }).toBeGreaterThan(0);
    const latest = await storedLibrary(page, LIB2A);
    const P1 = keyPlan(latest);
    expect(assignConfirmText(P1).body, 'Node: the new keys change the plan').not.toBe(assignConfirmText(P0).body);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(keysToast(page), 'the bands first, and it says so').toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    await expect(ask, 'no dialog on partial bands').toHaveCount(0);
    expect(differing(await crystalsById(page), before), 'nothing written').toEqual([]);
    await release(page);
    await expect(ask.getByTestId('assign-counts'), 'then the plan on every band').toHaveText(assignConfirmText(P1).body, { timeout: 30_000 });
    await expect(ask.getByTestId('assign-changed'), 'saying why').toHaveText(ASSIGN_CHANGED_LINE);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    const want = crystalsAfter(latest, P1);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'exactly that plan', timeout: 20_000 }).toBe(0);
  });
});

test.describe('v16.8.2 fix round 4, one press at a time', () => {
  test.use({ layoutSeed: 'new' });

  test('KG1a. two taps on Assign during the length wait, then the toast\'s Cancel: the press ends, whichever tap started it; no dialog, nothing written @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    const lib = lengthsLibrary(false);
    await holdDurationProbes(page, true);
    await seedPrefs(page);
    await openApp(page, lib, 620);
    await openHealth(page);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    await expect(lengthsToast(page)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await healthAction(page, 'crystals').click();
    await expect(lengthsToast(page), 'the second tap joins: the press\'s toast again').toBeVisible({ timeout: 5000 });
    await notices(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(lengthsToast(page)).toHaveCount(0, { timeout: 5000 });
    await page.evaluate(() => (window as any).__releaseDurations());
    await expect.poll(async () => ((await libraryState(page)).libraryDurations as any[]).filter((d) => !d).length, { message: 'every length read', timeout: 120_000 }).toBe(0);
    await page.waitForTimeout(3000);
    await expect(askDialog(page), 'one Cancel ends the press: no dialog').toHaveCount(0);
    expect(differing(await crystalsById(page), before), 'nothing written').toEqual([]);
  });

  test('KG1b. two taps on Assign during the band wait, then the toast\'s Cancel: no dialog, nothing written @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, LIB2, 56);
    await openHealth(page);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await healthAction(page, 'crystals').click();
    await expect(keysToast(page), 'the second tap joins: the press\'s toast again').toBeVisible({ timeout: 5000 });
    await notices(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await release(page);
    await bandsReady(page);
    await page.waitForTimeout(2000);
    await expect(askDialog(page), 'no dialog').toHaveCount(0);
    expect(differing(await crystalsById(page), before), 'nothing written').toEqual([]);
  });

  test('KG2a. a confirmed press cancelled at its keys toast; then a fresh row press: its dialog has no "changed" line, Node\'s counts @mobile', async ({ page }) => {
    test.setTimeout(300_000);
    await holdDecodes(page);
    await seedPrefs(page);
    await openApp(page, LIB2A, 56, 'new', TONE6);
    await bandsReady(page);
    await openHealth(page);
    const before = await crystalsById(page);
    await page.evaluate(() => ((window as any).__holdDecodes = true));
    await healthAction(page, 'analyse').click();
    await expect(page.getByTestId('library-health-status')).toHaveText('Analysing…', { timeout: 15_000 });
    await healthAction(page, 'crystals').click();
    const ask = askDialog(page);
    await expect(ask).toBeVisible({ timeout: 15_000 });
    await hook(page, true);
    await page.evaluate(() => (window as any).__releaseDecodes());
    await analyseToEnd(page, LIB2A_IDS);
    await expect.poll(async () => (await keysState(page)).bandsLeft, { message: 'new keys, their bands held', timeout: 30_000 }).toBeGreaterThan(0);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    await notices(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(1500);
    await expect(ask, 'cancelled: no dialog').toHaveCount(0);
    const latest = await storedLibrary(page, LIB2A);
    const P1 = keyPlan(latest);
    // (A fresh press from the row, its bands still held: it goes through App's press and the card's take.)
    await healthAction(page, 'crystals').click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    await release(page);
    await expect(ask.getByTestId('assign-counts'), 'the fresh press asks, Node\'s counts').toHaveText(assignConfirmText(P1).body, { timeout: 30_000 });
    await expect(ask.getByTestId('assign-changed'), 'G2: no "changed" line: no dialog was open for this press').toHaveCount(0);
    expect(differing(await crystalsById(page), before), 'nothing written before Assign').toEqual([]);
  });

  test('KG2b. a confirmed press cancelled while its plan is unchanged; then a fresh row press with the same plan: it asks, never applies silently @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    expect(assignConfirmText(PLAN2).body.length > 0 && PLAN2.patches.size > 0, 'Node: LIB2\'s plan moves tracks: it asks').toBe(true);
    await seedPrefs(page);
    await openApp(page, LIB2, 56);
    await bandsReady(page);
    await openHealth(page);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    const ask = askDialog(page);
    await expect(ask.getByTestId('dialog-body')).toHaveText(assignConfirmText(PLAN2).body, { timeout: 15_000 });
    // (A prune takes a keyed track's band while the dialog is open, and the warm is held: the dialog's Assign must wait for
    // it, so its confirmation goes with that press. The plan is unchanged once the band is made again.)
    await hook(page, true);
    expect(await page.evaluate(() => (window as any).__aetheriaKeyBands.dropBand(10)), 'a keyed track\'s band dropped').toBe(true);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    await notices(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(1000);
    await expect(ask, 'cancelled: no dialog').toHaveCount(0);
    // (A fresh press from the row, the band still missing: through App's press and the card's take.)
    await healthAction(page, 'crystals').click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    await release(page);
    await expect(ask.getByTestId('dialog-body'), 'G2: the fresh press asks (the same plan, which needs confirming)').toHaveText(assignConfirmText(PLAN2).body, { timeout: 30_000 });
    await expect(ask.getByTestId('assign-changed')).toHaveCount(0);
    expect(differing(await crystalsById(page), before), 'nothing written before Assign').toEqual([]);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    const want = crystalsAfter(LIB2, PLAN2);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'then the plan', timeout: 20_000 }).toBe(0);
  });

  test('KG3. the length wait ends behind a row tap\'s Undo toast: once the Undo leaves, the press\'s keys toast shows with its Cancel @desktop-only', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'music plays here: a phone holds its warm around a short track');
    test.setTimeout(300_000);
    const lib = lengthsLibrary(true);
    await holdDurationProbes(page, true);
    await seedPrefs(page, { hold: true });
    await openApp(page, lib, 620);
    await openHealth(page);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    await expect(lengthsToast(page)).toBeVisible({ timeout: 10_000 });
    // (T4b's order: the lengths nearly read, then two row taps, so the length wait ends while the second tap's Undo is
    // up: the press goes on to its band pass behind it, and must not cover it.)
    const missing = async () => ((await libraryState(page)).libraryDurations as any[]).filter((d) => !d).length;
    await page.evaluate(() => (window as any).__releaseDurations());
    await expect.poll(missing, { message: 'the lengths nearly read', timeout: 120_000 }).toBeLessThan(60);
    const rows = page.getByTestId('library-list').locator('button[data-row-index]');
    await rows.nth(0).click();
    await page.waitForTimeout(300);
    await rows.nth(1).click();
    await expect(undoToast(page), 'the tap\'s Undo toast').toBeVisible({ timeout: 5000 });
    await expect.poll(missing, { message: 'every length read', timeout: 8000 }).toBe(0);
    await page.waitForTimeout(1500);
    await expect(undoToast(page), 'the length wait ended behind the Undo').toBeVisible();
    await expect(keysToast(page), 'C8: never over the Undo').toHaveCount(0);
    await expect(undoToast(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(keysToast(page), 'G3: once the Undo leaves, the press says so').toBeVisible({ timeout: 5000 });
    await expect(notices(page).getByRole('button', { name: 'Cancel', exact: true }), 'with its Cancel').toBeVisible();
    expect(differing(await crystalsById(page), before), 'nothing written').toEqual([]);
    await release(page);
    await expect(askDialog(page), 'then its confirmation').toBeVisible({ timeout: 30_000 });
  });
});

test.describe('v16.8.2 fix round 5, the card that confirmed', () => {
  test.use({ layoutSeed: 'new' });

  /** LIB2's dialog (its plan moves tracks: it asks); a prune takes a keyed band and the warm is held, then Assign: the
   *  confirmed press waits in App for that band, its keys toast up. */
  const confirmedWaits = async (page: Page) => {
    await seedPrefs(page);
    await openApp(page, LIB2, 56);
    await bandsReady(page);
    await openHealth(page);
    const before = await crystalsById(page);
    await healthAction(page, 'crystals').click();
    const ask = askDialog(page);
    await expect(ask.getByTestId('dialog-body')).toHaveText(assignConfirmText(PLAN2).body, { timeout: 15_000 });
    await hook(page, true);
    expect(await page.evaluate(() => (window as any).__aetheriaKeyBands.dropBand(10)), 'a keyed track\'s band dropped').toBe(true);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(keysToast(page)).toBeVisible({ timeout: 10_000 });
    return { before, ask };
  };

  test('KH1a. a confirmed press that ends with no card ("Keys ready"), then Open: the later card asks, the plan as it is now, no "changed" line; nothing written before its Assign @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const { before, ask } = await confirmedWaits(page);
    await tab(page, 'now');
    await release(page);
    await expect(readyToast(page)).toBeVisible({ timeout: 30_000 });
    expect(differing(await crystalsById(page), before), 'nothing written with no card').toEqual([]);
    await notices(page).getByRole('button', { name: 'Open', exact: true }).click();
    await expect(ask.getByTestId('dialog-body'), 'H1: the card mounted later asks').toHaveText(assignConfirmText(PLAN2).body, { timeout: 15_000 });
    await expect(ask.getByTestId('assign-changed'), 'the plan as confirmed: no line').toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(differing(await crystalsById(page), before), 'nothing written before its Assign').toEqual([]);
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    const want = crystalsAfter(LIB2, PLAN2);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'then the plan', timeout: 20_000 }).toBe(0);
  });

  test('KH1b. the card that confirmed, still open: once the band is made, the plan, unchanged, is applied with no second dialog @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const { before, ask } = await confirmedWaits(page);
    await page.waitForTimeout(1000);
    expect(differing(await crystalsById(page), before), 'nothing written while it waits').toEqual([]);
    await release(page);
    const want = crystalsAfter(LIB2, PLAN2);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'F1: the plan confirmed, applied in that flow', timeout: 30_000 }).toBe(0);
    await expect(ask, 'no second dialog').toHaveCount(0);
  });

  test('KH2. the card stays open after the dialog: Cancel gives focus back to Assign; after Assign, the Crystals line done and its button gone, focus goes to the card\'s heading, not <body> @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await seedPrefs(page);
    await openApp(page, LIB2, 56);
    await bandsReady(page);
    await openHealth(page);
    const ask = askDialog(page);
    await healthAction(page, 'crystals').click();
    await expect(ask).toBeVisible({ timeout: 15_000 });
    await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(healthAction(page, 'crystals'), 'Cancel: focus back on Assign').toBeFocused({ timeout: 5000 });
    await healthAction(page, 'crystals').click();
    await expect(ask).toBeVisible({ timeout: 15_000 });
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(ask).toHaveCount(0, { timeout: 5000 });
    await expect(healthAction(page, 'crystals'), 'the Crystals line done: its Assign gone').toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('library-health'), 'the card stays open (Analyse to do)').toHaveAttribute('data-open', 'true');
    await expect(page.locator('#library-health-h'), 'H2: focus on the card\'s heading').toBeFocused({ timeout: 5000 });
    await page.waitForTimeout(3500);
    await expect(page.locator('#library-health-h'), 'and it stays there').toBeFocused();
  });
});

test.describe('v16.8.2, Assign places by key (classic)', () => {
  test('K-1d. classic\'s Auto-Distribute while the bands are held: the toast, nothing written; released: the plan on every band @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    await seedPrefs(page, { hold: true });
    await openApp(page, LIB1, 54, 'classic');
    const before = await crystalsById(page);
    await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
    await expect(page.getByText(/^Getting the keys ready… \d+ left$/).first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect(differing(await crystalsById(page), before), 'nothing written while held').toEqual([]);
    await release(page);
    const want = crystalsAfter(LIB1, PLAN1);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'the plan on every band', timeout: 30_000 }).toBe(0);
  });

  test('K-1c. classic\'s Auto-Distribute: the same crystals as Node\'s plan, its notice with K and F @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    await seedPrefs(page);
    await openApp(page, LIB1, 54, 'classic');
    await bandsReady(page);
    await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
    const want = crystalsAfter(LIB1, PLAN1);
    await expect.poll(async () => differing(await crystalsById(page), want).length, { message: 'every crystal as Node plans it', timeout: 20_000 }).toBe(0);
    await expect(page.getByText(`${PLAN1.keyed} placed by key (${PLAN1.keyFits} where the tone fits)`, { exact: false }).first()).toBeVisible();
  });
});

test.describe('v16.8.2, the key bands on this device', () => {
  test.use({ layoutSeed: 'new' });

  test('K-8. bandsOf in the page equals Node\'s, on fixed inputs (this device\'s JS math) @mobile', async ({ page }) => {
    const r = mulberry32(16828);
    const inputs: Array<[number[], number]> = [
      [[0.1211, 0.0123, 0.0954, 0.0187, 0.1032, 0.0811, 0.0245, 0.1702, 0.0161, 0.0988, 0.0204, 0.2382], 440],
      [[0.0712, 0.0098, 0.0856, 0.0143, 0.1655, 0.0731, 0.0126, 0.0814, 0.0109, 0.3021, 0.0152, 0.1583], 432.61],
      [[0.0843, 0.0811, 0.0862, 0.0799, 0.0858, 0.0822, 0.0831, 0.0846, 0.0807, 0.0855, 0.0819, 0.0847], 446.2],
      ...Array.from({ length: 24 }, (): [number[], number] => { const k = keyData(r); return [k.chroma as number[], k.chromaA4Hz as number]; }),
    ];
    const node = inputs.map(([c, a]) => Array.from(bandsOf(c, a)).join(''));
    expect(node.slice(0, 3), 'Node: the pinned bands (keyBands.check)').toEqual(['211230111112021112213110112', '213210101110111112311011113', '111112122222212111021211111']);
    await seedPrefs(page);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await page.waitForFunction(() => typeof (window as any).__aetheriaKeyBands?.bandsOf === 'function', null, { timeout: 20_000 });
    const inPage: string[] = await page.evaluate((ins) => ins.map(([c, a]) => (window as any).__aetheriaKeyBands.bandsOf(c, a).join('')), inputs);
    expect(inPage, "this device's bands").toEqual(node);
  });

  test('K-9. the cost probe: 300 tracks warmed in slices, ms per track (reported) @mobile', async ({ page }) => {
    test.setTimeout(300_000);
    const lib = withKeys(Array.from({ length: 300 }, (_, i) => { const name = `keycost-${String(i + 1).padStart(3, '0')}`; return { id: `1772330000000-kc${String(i).padStart(3, '0')}`, name, duration: 200, file: { name: `${name}.wav`, size: TONE_BYTES } }; }), 16829);
    const keys = new Set(lib.map((s) => contentKey(s))).size;
    await seedPrefs(page);
    const t0 = Date.now();
    await openApp(page, lib, 300);
    await bandsReady(page);
    const k = await keysState(page);
    const msg = `K-9: ${k.bandsMade} key bands made (${keys} content keys) at ${k.msPerTrack?.toFixed(2)} ms per track of work; ready ${((Date.now() - t0) / 1000).toFixed(1)} s after the start`;
    console.log(msg);
    test.info().annotations.push({ type: 'K-9', description: msg });
    expect(k.bandsMade).toBe(keys);
    expect(k.msPerTrack, 'ms per track').toBeLessThan(50);
    // (Fix round 1, A-N1: on a phone the background warm keeps to the analyser's mobile duty, 0.25: its work is under 0.4
    // of its wall time. A desktop runs it as before.)
    const d: any = await libraryState(page);
    const mobile = await page.evaluate(() => (window as any).__aetheriaAnalyse?.mobile === true);
    const duty = d.bandsWallMs > 0 ? d.bandsWorkMs / d.bandsWallMs : 1;
    const dmsg = `K-9 duty, ${mobile ? 'phone' : 'desktop'}: work ${Math.round(d.bandsWorkMs)} ms of ${Math.round(d.bandsWallMs)} ms (${duty.toFixed(2)})`;
    console.log(dmsg);
    test.info().annotations.push({ type: 'K-9 duty', description: dmsg });
    if (mobile) expect(duty, 'the mobile duty').toBeLessThan(0.4);
  });
});
