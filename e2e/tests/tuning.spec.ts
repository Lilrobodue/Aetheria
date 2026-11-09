import { readFileSync } from 'node:fs';
import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import { acceptDisclaimerNew, libraryRowButton, libraryState, openLibraryTab, openSeededNewLayout, rowMenu, tab, toneWav, LAYER_ENGINE_KEY, LAYER_OUTPUT_KEY, PHONE_VIEWPORT } from './helpers';
import { ALL_CRYSTALS, crystalMoves, planAssign } from '../../utils/mix/distribution.ts';
import type { AssignPlan } from '../../utils/mix/distribution.ts';
import { BandCache, songBands } from '../../utils/mix/keyBands.ts';
import { patchById } from '../../utils/library/listOps.ts';
import { spreadOracle } from '../../scripts/mix-golden/spread-oracle.ts';
import { exportSheetNumbers, outSeconds, wavBytes } from '../../utils/export/exportPlan.ts';
import { fileLine, longTotals } from '../../utils/export/exportWords.ts';
import { FIT_REL_EDGE, LO_SHU_CRYSTALS, fitShift, loShuHz, loShuTone, offeredShift, relAt, solfeggioTone, speedPercent, trackRate, tuneLabel, tuneRate } from '../../utils/tuning/trackTuning.ts';

// v16.8.3 "Track Tuning" (decisions T1-T9, amendment A1). A track can carry a tuning, a whole-cent shift from Standard
// (432/440 of its speed) within ±50 cents, chosen in Track info; it plays at PSF × 2^(c/1200) everywhere it plays, and
// Assign places it by how it sounds (M1). Synthetic tones and synthetic key readings only ("tune-…"; the readings are
// utils/tuning/tuning.fixture.json's, renders of synthetic music through the app's analyser).
//
//   T-1   Track info: every state of the Tuning row (a shift, already fits, nothing within ±50, not analysed, no clear
//         key, no crystal, a tuning kept, moved since, garbage), the select's choice applied at once (its note, the
//         polite announcement, the stored fields, Copy), and back to Standard.
//   T-1b  A1: Lo Shu Perfect GUT on, a track on a crystal it swaps: both fits; the Lo Shu one applies; its label, Copy and
//         the Crystal note; Perfect GUT off: only the Solfeggio Fit, and the kept Lo Shu tuning still plays at its rate
//         (fix round 1: its note says the Lo Shu tone plays only with Perfect GUT on, and the Crystal note is never the
//         Lo Shu one, A01).
//   T-1c  fix round 1 (S2): on the phone's own speaker the Lo Shu Fit is made for the tone it plays there (an octave up).
//   T-1d  fix round 2 (L-S2): a Lo Shu tuning chosen on the phone, heard on headphones: "Chosen for Lo Shu …", and the
//         headphones' own Lo Shu Fit; on the phone, "fits". (T-1 gains L-S1's moved-and-fits row and L-S3's long notes.)
//   T-2   the live switch on the playing track: el.playbackRate is trackRate(song) right after; the media session's rate
//         follows; back to Standard gives PITCH_SHIFT_FACTOR exactly. Fix round 1 (A4): in both LIVE_TUNE_SWITCH modes (the
//         page's __aetheriaTuning.live), the card, Key fit and the chip agree with the element; another track's retune
//         touches none of them.
//   T-2c  fix round 1 (A1): a choice made during a start reaches only the track the element holds.
//   T-2d  fix round 1 (A2): the card hears of a switch at once, with no frame to come (a locked phone).
//   T-2e  fix round 2 (app SF-1): a switch raced against the hook's pending passive effect (a microtask right after a
//         commit at its 1 s boundary, frames stopped): the card's last rate is the element's.
//   T-2f  fix round 2 (app N-a): a choice made while playTrack decodes the incoming track holds once it plays.
//   T-2g  fix round 2 (app N-a): and another track started before it plays keeps its own rate.
//   T-3   a gapless swap into and out of a tuned track: the rate at each play() is that track's; no pause, no decode.
//   T-4   a reload keeps the fields; garbage (51 cents, 2.5, tuneFor 1000, one field alone, tuneLoShu off the six)
//         restores as Standard.
//   T-5   no tuning anywhere: PITCH_SHIFT_FACTOR on every play() and the media session; Assign gives v16.8.2's plan.
//   T-6   K-8-style: fitShift in the page equals Node's on the committed fixture (the device's JS maths), and its cost.
//   T-7   the Now Playing chip: only while tuned; a tap opens Track info for that track.
//   T-8   More › Compose for a crystal: the picker, a crystal's options (A1: the Lo Shu ones), the Crystal sheet's link
//         (fix round 1, N7: opened for a crystal, its options first, the picker under "Another crystal").
//   T-8b  fix round 1: the Crystal sheet's link on a Lo Shu tone (75 Hz with Perfect GUT on: CP02), and at 411×752 the
//         options, the Lo Shu block included, start within the first screen (N7).
//   T-7b  fix round 1 (SF5): the desktop transport's tuning chip is visible at 1280, 1440 and 1536 px (fix round 2: and
//         at 1024 and 1920).
//   T-9   Export with layers: a tuned track's own file and a long file with one tuned track: their lengths, and the long
//         file plays to its end (desktop).
//   T-10  Assign after a retune: the D8 line appears, and the plan applied equals Node's (and the oracle's) with it.
//   Fix round 1 (tests should-fix 1, the gaps, C02):
//   T-2b  the chip follows a switch that changes nothing else the Sound slice holds (Key fit off): its memo's deps.
//   T-9   (more) the long file's layer tone changes at each join the same way, the tuned track's too (its layers' length).
//   T-9b  the Export sheet's file line for a tuned track: its own length and size.
//   T-11  pause and resume, a seek, Next to a Standard track, Previous into a tuned one, a tap from tuned to Standard.
//   T-12  a tuned track restored at startup, then Play.
//   Fix round 2 (the tests lens): T-2d the card's length and position too; T-1 a 900 s unanalysed row (this device's
//         caps); T-1b a kept Solfeggio tuning, then Fit Lo Shu (the memo's cents); T-1c the Crystal note's Lo Shu line
//         on the phone; T-3 the card after every gapless advance; T-8 the options' top in the first screen, and T-8b a
//         far pick at 411×600 brings them back; T-8c the desktop panel showing Compose, then the transport's Crystal and
//         its link, and a direct ask to a page already showing; T-9b a tuned playlist's long file; T-11b the handlers
//         called directly; T-2 (flag false) two more changes while held; heardAgrees still agreed 300 ms later.

const PSF = 0.981818;
const FIX = JSON.parse(readFileSync(new URL('../../utils/tuning/tuning.fixture.json', import.meta.url), 'utf8')) as { reads: Array<{ chroma: number[]; chromaA4Hz: number; musicKey: string }> };
const READS = FIX.reads.filter((r) => r.musicKey);
const TONE = toneWav(3, 330);

/** A placed, analysed track with a clear key (one of the fixture's readings) on crystal `f`; `o` over it. */
function keyed(name: string, i: number, r: { chroma: number[]; chromaA4Hz: number; musicKey: string }, f: number, o: Record<string, unknown> = {}): any {
  return { id: `1772900000000-${name}`, name, duration: 3, file: { name: `${name}.wav`, size: TONE.length }, harmonicFreq: f, closestSolfeggio: f, harmonicDeviation: 3, crystalSource: 'assigned', chroma: [...r.chroma], chromaA4Hz: r.chromaA4Hz, musicKey: r.musicKey, keyConfidence: 0.8, chromaVersion: 1, ...o, __i: i };
}
/** Fixture cases found in Node: a (reading, crystal) with the shifts Track info offers (fix round 1, S1: offeredShift,
 *  0 for a key already within the edge at Standard; the Lo Shu one for `output`). */
function findCase(pred: (sol: number | null, lo: number | null, f: number) => boolean, from = 0, output = 'headphones'): { r: (typeof READS)[number]; f: number; sol: number | null; lo: number | null } {
  for (const r of READS.slice(from)) for (const f of ALL_CRYSTALS) {
    const sol = offeredShift(r.chroma, r.chromaA4Hz, solfeggioTone(f));
    const lo = loShuTone(f, output) === null ? null : offeredShift(r.chroma, r.chromaA4Hz, loShuTone(f, output));
    if (pred(sol, lo, f)) return { r, f, sol, lo };
  }
  throw new Error('no fixture case');
}
const notSix = (f: number) => !LO_SHU_CRYSTALS.includes(f);

/** A library seeded straight into IndexedDB (every track the same short tone; its meta as given, `file` and `__i` aside),
 *  then the app in the new layout (v2, headphones), the library restored. */
async function openWith(page: Page, lib: any[], o: { perfectGut?: boolean; tone?: Buffer; output?: string; keyFit?: boolean; current?: number; playlists?: Array<{ id: string; name: string; ids: string[] }> } = {}): Promise<void> {
  await page.addInitScript(({ keys, perfectGut, output, keyFit }) => {
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      if (sessionStorage.getItem('__e2eTune') === null) {
        sessionStorage.setItem('__e2eTune', '1');
        localStorage.setItem(keys.engine, 'v2');
        localStorage.setItem(keys.output, output);
        if (perfectGut) localStorage.setItem('aetheria.loShuPerfectGUT.v1', 'true');
        if (keyFit !== null) localStorage.setItem('aetheria.keyFit.v1', String(keyFit));
      }
    } catch {}
    const w = window as any;
    w.__pauseCount = 0;
    w.__decodes = 0;
    w.__plays = [];
    w.__positions = [];
    // (Fix round 2: the whole position state of each update, with the music element's own time and length then, and when.)
    w.__posStates = [];
    const pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) { if ((this.getAttribute('src') || '').startsWith('blob:')) w.__pauseCount++; return pause.call(this); };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.getAttribute('src') || '';
      if (src.startsWith('blob:')) { w.__music = this; w.__plays.push({ src, rate: this.playbackRate, at: performance.now() }); }
      // (rev3 tests should-fix 1: the silent anchor, the phone path's looping data: WAV, so a test can show no tuning reaches it.)
      else if (src.startsWith('data:audio')) w.__anchor = this;
      return play.call(this);
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: unknown[]) { w.__decodes++; return (decode as any).apply(this, a); } as typeof decode;
    const session = navigator.mediaSession as any;
    if (session && typeof session.setPositionState === 'function') {
      const set = session.setPositionState.bind(session);
      session.setPositionState = (state?: MediaPositionState) => {
        w.__positions.push(state?.playbackRate ?? null);
        const el = w.__music as HTMLMediaElement | undefined;
        w.__posStates.push({ rate: state?.playbackRate ?? null, position: state?.position ?? null, duration: state?.duration ?? null, elT: el ? el.currentTime : null, elDur: el ? el.duration : null, at: performance.now() });
        return set(state);
      };
    }
    // (Fix round 1: the media session's handlers, so a test can press the car's and the lock screen's buttons.)
    w.__ms = {};
    if (session && typeof session.setActionHandler === 'function') {
      const sah = session.setActionHandler.bind(session);
      session.setActionHandler = (a: string, h: unknown) => { w.__ms[a] = h; return sah(a, h); };
    }
  }, { keys: { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY }, perfectGut: !!o.perfectGut, output: o.output ?? 'headphones', keyFit: o.keyFit ?? null });
  const b64 = (o.tone ?? TONE).toString('base64');
  await page.goto('/manifest.json');
  await page.evaluate(async ({ lib, b64, current, playlists }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db', 2);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ['blobs', 'meta']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); if (!d.objectStoreNames.contains('playlist-state')) d.createObjectStore('playlist-state', { keyPath: 'key' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const put = (store: string, recs: any[]) => new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); for (const x of recs) tx.objectStore(store).put(x); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    const tone = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'audio/wav' });
    await put('blobs', lib.map((s: any) => ({ id: s.id, fileBlob: tone, fileName: `${s.name}.wav`, fileType: 'audio/wav' })));
    await put('meta', lib.map(({ file, __i, ...m }: any) => m));
    const ids = lib.map((s: any) => s.id);
    await put('playlist-state', [{ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: current, loShuWalkMode: null, selectedSolfeggio: 528, savedAt: Date.now() }]);
    // (Fix round 2: saved playlists, v16.1's 'pl:' records, by track id.)
    const byId = new Map(lib.map((s: any) => [s.id, s]));
    await put('playlist-state', playlists.map((pl: { id: string; name: string; ids: string[] }) => ({ key: `pl:${pl.id}`, v: 1, id: pl.id, name: pl.name, createdAt: 1000, updatedAt: 1000, entries: pl.ids.map((id) => ({ id, name: (byId.get(id) as any).name, file: `${(byId.get(id) as any).name}.wav`, size: 0 })) })));
    db.close();
  }, { lib, b64, current: o.current ?? -1, playlists: o.playlists ?? [] });
  await page.goto('/');
  await acceptDisclaimerNew(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library restores', timeout: 60_000 }).toBe(lib.length);
}
const tuningHook = async (page: Page) => page.waitForFunction(() => typeof (window as any).__aetheriaTuning?.set === 'function', null, { timeout: 10_000 });
const tunings = (page: Page) => page.evaluate(() => (window as any).__aetheriaTuning.tunings()) as Promise<Array<{ id: string; tuneCents: number | null; tuneFor: number | null; tuneLoShu: boolean | null }>>;
const tuningOf = async (page: Page, id: string) => (await tunings(page)).find((t) => t.id === id);
const musicRate = (page: Page) => page.evaluate(() => (window as any).__aetheriaTuning.rate()) as Promise<number | null>;
/** rev3 tests should-fix 1: the silent anchor (the looping data: WAV that keeps the lock-screen card alive across a
 *  gesture-less auto-advance) plays at rate 1 whatever the tuning: no live switch and no decode-window listener may reach
 *  it. Off the desktop project the phone path runs, so the anchor must have played (else the check would prove nothing). */
const expectAnchorUntouched = async (page: Page, when: string) => {
  const r = await page.evaluate(() => { const a = (window as any).__anchor as HTMLMediaElement | undefined; return a ? a.playbackRate : null; });
  if (test.info().project.name !== 'desktop') expect(r, `${when}: the silent anchor played (the phone path)`).not.toBeNull();
  if (r !== null) expect(r, `${when}: the silent anchor untouched (rate 1)`).toBe(1);
};
const lastPositionRate = (page: Page) => page.evaluate(() => { const p = (window as any).__positions as Array<number | null>; return p.length ? p[p.length - 1] : null; });
/** Fix round 1: the transport, in either shell and on the phone: the desktop's buttons when they show, else the media
 *  session's own handlers (the car's and the lock screen's: App's handleNext, handlePrev, resumePlayback, pausePlayback).
 *  Fix round 2 (tests nit 6): the desktop and mobile-ua projects run at 1280×720, where the desktop's buttons show, so
 *  there T-2c, T-11 and T-12 press those buttons, not the car's handlers; T-11b calls the handlers directly. */
async function transport(page: Page, what: 'next' | 'prev' | 'play' | 'pause'): Promise<void> {
  const bar = page.getByTestId('desktop-transport');
  if (await bar.isVisible().catch(() => false)) {
    if (what === 'next') await bar.getByRole('button', { name: 'Next track', exact: true }).click();
    else if (what === 'prev') await bar.getByRole('button', { name: 'Previous track', exact: true }).click();
    else await bar.getByTestId('desktop-play').click();
    return;
  }
  const action = what === 'next' ? 'nexttrack' : what === 'prev' ? 'previoustrack' : what;
  await page.evaluate((a) => (window as any).__ms[a]?.({ action: a }), action);
}
/** Fix round 1 (A4): what is heard, and everything that describes it, agree: the element plays at `rate`, the card's last
 *  rate is it, and Key fit hears the track at it (its heard A4 is the reading's A4 × that rate, the same float). Fix
 *  round 2 (tests nit 7): and they still agree about 300 ms after the first match (a stale value can't pass by being
 *  sampled once before it changes). */
async function heardAgrees(page: Page, rate: number, a4: number, what: string): Promise<void> {
  const keyFitA4 = () => page.evaluate(() => (window as any).__aetheriaTuning.keyFitA4());
  await expect.poll(() => musicRate(page), { message: `${what}: the element plays at ${rate}`, timeout: 5_000 }).toBe(rate);
  await expect.poll(() => lastPositionRate(page), { message: `${what}: the card's rate is the element's`, timeout: 5_000 }).toBe(rate);
  await expect.poll(keyFitA4, { message: `${what}: Key fit hears the track at the element's rate`, timeout: 5_000 }).toBe(a4 * rate);
  await page.waitForTimeout(300);
  expect([await musicRate(page), await lastPositionRate(page), await keyFitA4()], `${what}: still agreed 300 ms later (the element, the card, Key fit)`).toEqual([rate, rate, a4 * rate]);
}
/** Fix round 2 (tests should-fix 1): the card's last update describes the element: its length is the element's and its
 *  position within 0.3 s of the element's time when sent. */
async function cardDescribesElement(page: Page, what: string): Promise<void> {
  const last = () => page.evaluate(() => { const p = (window as any).__posStates as Array<Record<string, number | null>>; return p.length ? p[p.length - 1] : null; });
  await expect.poll(async () => {
    const s = await last();
    if (!s) return 'no update';
    if (s.duration !== s.elDur) return `length ${s.duration}, the element's ${s.elDur}`;
    if (!(Math.abs((s.position as number) - (s.elT as number)) < 0.3)) return `position ${s.position}, the element at ${s.elT}`;
    return 'ok';
  }, { message: `${what}: the card's last update has the element's length and time`, timeout: 3_000 }).toBe('ok');
}
const trackInfo = (page: Page) => page.getByRole('dialog', { name: 'Track info', exact: true });
/** Library › the row's ⋯ › Track info. */
async function openInfo(page: Page, name: string): Promise<void> {
  await page.getByTestId('library-search').fill(name);
  await rowMenu(page, name).click();
  await page.getByTestId('library-menu-info').click();
  await expect(trackInfo(page)).toBeVisible();
}
async function closeInfo(page: Page): Promise<void> {
  await trackInfo(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(trackInfo(page)).toHaveCount(0);
  await page.getByTestId('library-search').fill('');
}
/** The Tuning row as the dialog shows it: a select's options and value and its note, or a plain row's text. */
async function tuningRowOf(page: Page): Promise<{ options: string[] | null; value: string | null; note: string; plain: string | null }> {
  const row = trackInfo(page).getByTestId('track-info-tuning');
  const select = row.locator('select');
  if (await select.count()) {
    const options = await select.locator('option').allTextContents();
    const value = await select.evaluate((s) => (s as HTMLSelectElement).selectedOptions[0]?.textContent ?? null);
    return { options, value, note: (await row.getByTestId('track-info-tuning-note').textContent()) ?? '', plain: null };
  }
  return { options: null, value: null, note: (await row.locator('dd span').first().textContent().catch(() => '')) ?? '', plain: (await row.locator('dd').textContent()) ?? '' };
}
async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__copied = null;
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => { w.__copied = t; return Promise.resolve(); }, readText: () => Promise.resolve(w.__copied ?? '') } }); } catch {}
  });
}
async function copied(page: Page): Promise<string> {
  await trackInfo(page).getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__copied as string | null)).not.toBeNull();
  const t = await page.evaluate(() => (window as any).__copied as string);
  await page.evaluate(() => { (window as any).__copied = null; });
  return t;
}
/** The stored meta record's tuning fields (what a reload restores). */
async function storedTuning(page: Page, id: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(async (id) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const m: any = await new Promise((resolve) => { const r = db.transaction('meta', 'readonly').objectStore('meta').get(id); r.onsuccess = () => resolve(r.result ?? null); });
    db.close();
    return m ? { tuneCents: m.tuneCents ?? null, tuneFor: m.tuneFor ?? null, tuneLoShu: m.tuneLoShu ?? null } : null;
  }, id);
}
/** The live switch's flag in the page (LIVE_TUNE_SWITCH): its notes add "From the next play." when false. */
const liveFlag = (page: Page) => page.evaluate(() => (window as any).__aetheriaTuning.live as boolean);
const nextPlay = (live: boolean) => (live ? '' : ' From the next play.');
const speedWords = (c: number) => { const p = speedPercent(c); return `Plays ${Math.abs(p).toFixed(1)} % ${p < 0 ? 'slower' : 'faster'} than Standard`; };
/** A tuned choice's note (fix round 1: "than Standard"; a moved track names both crystals, never a fit). Fix round 2:
 *  a Lo Shu tuning that doesn't fit on this output says what it was chosen for (`chosenFor`, L-S2); a track over
 *  keyBands' caps never promises Assign (`long`, L-S3). */
const LONG_NOTE = "Assign crystals doesn't place a track this long or this large by its key."; // v16.8.4 (rev3 N3)
const tunedNote = (c: number, live: boolean, o: { movedFrom?: number; movedTo?: number; tone?: string; chosenFor?: string; long?: boolean; loShu?: boolean } = {}) =>
  (o.movedFrom !== undefined ? `${speedWords(c)}. Chosen for ${o.movedFrom} Hz, before it moved to ${o.movedTo} Hz.` : o.chosenFor !== undefined ? `${speedWords(c)}. Chosen for ${o.chosenFor}.` : `${speedWords(c)}, so ${o.tone ?? "the crystal's tone"} fits its key.`) +
  ` The file isn't changed. ${o.long ? LONG_NOTE : `Assign crystals places it by how it sounds at this tuning${o.loShu ? ', so the next Assign may move it' : ''}.`}${nextPlay(live)}`;
/** Library health, open (folded when all is done). */
async function openHealth(page: Page): Promise<void> {
  await openLibraryTab(page);
  await page.getByTestId('library-health').waitFor();
  const toggle = page.getByTestId('library-health-toggle');
  if ((await page.getByTestId('library-health').getAttribute('data-open')) !== 'true' && (await toggle.isVisible().catch(() => false))) await toggle.click();
  await expect(page.getByTestId('library-health')).toHaveAttribute('data-open', 'true');
}
/** The health card's Assign, and its confirmation when it asks. */
async function assignByCard(page: Page): Promise<void> {
  await openHealth(page);
  await page.getByTestId('health-crystals-action').click();
  const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
  await expect.poll(async () => ask.isVisible(), { timeout: 15_000 }).toBe(true);
  await ask.getByRole('button', { name: 'Assign', exact: true }).click();
}
const STANDARD_NOTE_LIVE = 'Plays at 432/440 of its speed, like every track.';
/** The offer's note (fix round 2, L-S3: a track over keyBands' caps adds that Assign doesn't place it by its key). */
const standardNote = (live: boolean, long = false) => `${STANDARD_NOTE_LIVE}${long ? ` ${LONG_NOTE}` : ''}${nextPlay(live)}`;
const spoken = (c: number) => `${c < 0 ? 'minus' : 'plus'} ${Math.abs(c)} ${Math.abs(c) === 1 ? 'cent' : 'cents'}`;

// The cases, found in Node on the fixture.
const SHIFT = findCase((sol, _lo, f) => notSix(f) && sol !== null && sol !== 0);
const ZERO = findCase((sol, _lo, f) => notSix(f) && sol === 0);
const NONE = findCase((sol, _lo, f) => notSix(f) && sol === null);
/** A1: a crystal Perfect GUT swaps, with both fits (different). Fix round 1 (A01): at its Lo Shu fit, the crystal's own
 *  Solfeggio tone is not band 0, so with Perfect GUT off its Crystal note says nothing, and a Lo Shu note there shows. */
const BOTH = (() => {
  for (const r of READS) for (const f of LO_SHU_CRYSTALS) {
    const sol = offeredShift(r.chroma, r.chromaA4Hz, solfeggioTone(f)), lo = offeredShift(r.chroma, r.chromaA4Hz, loShuTone(f));
    if (sol === null || sol === 0 || lo === null || lo === 0 || lo === sol) continue;
    if (songBands({ chroma: r.chroma, chromaA4Hz: r.chromaA4Hz, tuneCents: lo, tuneFor: f })[ALL_CRYSTALS.indexOf(f)] !== 0) return { r, f, sol, lo };
  }
  throw new Error('no fixture case');
})();
/** Fix round 2 (L-S1): a tuned track (−7 c, chosen for another crystal) whose key doesn't fit its current crystal at −7 c,
 *  so the Fit is still offered. */
const MOVED = (() => {
  for (const r of READS) for (const f of ALL_CRYSTALS) {
    if (!notSix(f) || f === SHIFT.f) continue;
    const sol = offeredShift(r.chroma, r.chromaA4Hz, solfeggioTone(f));
    if (sol !== null && sol !== 0 && sol !== -7 && relAt(r.chroma, r.chromaA4Hz, solfeggioTone(f), -7) > FIT_REL_EDGE) return { r, f, sol, lo: null };
  }
  throw new Error('no moved case');
})();
/** Fix round 2 (L-S1): a tuned track moved to a crystal its key fits at its kept tuning (though not at Standard): no Fit. */
const KEPT_FITS = (() => {
  for (const r of READS) for (const f of ALL_CRYSTALS) {
    if (!notSix(f)) continue;
    const sol = offeredShift(r.chroma, r.chromaA4Hz, solfeggioTone(f));
    if (sol === null || sol === 0) continue;
    for (const c of [-37, -23, -12, 12, 23, 37]) if (c !== sol && relAt(r.chroma, r.chromaA4Hz, solfeggioTone(f), c) <= FIT_REL_EDGE) return { r, f, sol, c };
  }
  throw new Error('no kept-fits case');
})();
/** Fix round 1 (S1): a key already within the edge at Standard, where fitShift still finds a margin shift. */
const MARGIN = (() => {
  for (const r of READS) for (const f of ALL_CRYSTALS) {
    if (!notSix(f)) continue;
    const t = solfeggioTone(f), fs = fitShift(r.chroma, r.chromaA4Hz, t);
    if (fs !== null && fs !== 0 && relAt(r.chroma, r.chromaA4Hz, t, 0) <= FIT_REL_EDGE) return { r, f, fitShift: fs };
  }
  throw new Error('no margin case');
})();
/** Fix round 1 (S2): a Lo Shu crystal whose Lo Shu shift on the phone's speaker differs from the headphones' (an octave up). */
const PHONE_LO = (() => {
  for (const r of READS) for (const f of LO_SHU_CRYSTALS) {
    const lo = offeredShift(r.chroma, r.chromaA4Hz, loShuTone(f, 'phone'));
    if (lo !== null && lo !== 0 && lo !== offeredShift(r.chroma, r.chromaA4Hz, loShuTone(f, 'headphones'))) return { r, f, sol: offeredShift(r.chroma, r.chromaA4Hz, solfeggioTone(f)), lo };
  }
  throw new Error('no phone case');
})();
/** Fix round 2 (tests nit 3, the memo's tuneCents): a swapped crystal with a kept Solfeggio tuning (its Fit) at which the
 *  Lo Shu tone doesn't fit, so Fit Lo Shu is offered; choosing it keeps tuneFor and changes only the cents. */
const SOL_KEPT = (() => {
  for (const r of READS) for (const f of LO_SHU_CRYSTALS) {
    const sol = offeredShift(r.chroma, r.chromaA4Hz, solfeggioTone(f)), lo = offeredShift(r.chroma, r.chromaA4Hz, loShuTone(f));
    if (sol === null || sol === 0 || lo === null || lo === 0 || lo === sol) continue;
    if (relAt(r.chroma, r.chromaA4Hz, loShuTone(f)!, sol) > FIT_REL_EDGE) return { r, f, sol, lo };
  }
  throw new Error('no kept-Solfeggio case');
})();
/** Fix round 2 (tests should-fix 3): an untuned track on 174 or 285 whose key fits the Lo Shu tone on one of the phone
 *  and headphones and not the other (loShuFitsNow differs by output). Fits on the phone preferred (the note shows). */
const PHONE_NOTE = (() => {
  let other: { r: (typeof READS)[number]; f: number; onPhone: boolean } | null = null;
  for (const r of READS) for (const f of [174, 285]) {
    const phone = relAt(r.chroma, r.chromaA4Hz, loShuTone(f, 'phone')!, 0) <= FIT_REL_EDGE;
    const hp = relAt(r.chroma, r.chromaA4Hz, loShuTone(f, 'headphones')!, 0) <= FIT_REL_EDGE;
    if (phone && !hp) return { r, f, onPhone: true };
    if (!phone && hp && !other) other = { r, f, onPhone: false };
  }
  if (other) return other;
  throw new Error('no output-dependent Lo Shu case');
})();
/** Fix round 2 (L-S2): a Lo Shu fit made on the phone's speaker (174 or 285, an octave up there) that doesn't fit on
 *  headphones, which have a Lo Shu Fit of their own. */
const P2H = (() => {
  for (const r of READS) for (const f of [174, 285]) {
    const ph = offeredShift(r.chroma, r.chromaA4Hz, loShuTone(f, 'phone'));
    const hp = offeredShift(r.chroma, r.chromaA4Hz, loShuTone(f, 'headphones'));
    if (ph !== null && ph !== 0 && hp !== null && hp !== 0 && hp !== ph && relAt(r.chroma, r.chromaA4Hz, loShuTone(f, 'headphones')!, ph) > FIT_REL_EDGE) return { r, f, ph, hp, sol: offeredShift(r.chroma, r.chromaA4Hz, solfeggioTone(f)) };
  }
  throw new Error('no phone-to-headphones case');
})();
/** The crystal the moved track's kept tuning was chosen for (not the one it sits on now). */
const KEPT_FOR = MOVED.f === 963 ? 852 : 963;

test.describe('v16.8.3, Track Tuning (the new layout)', () => {
  test.use({ layoutSeed: 'new' });

  test('T-1. Track info: every state of the Tuning row; a Fit applies at once, is announced, stored and copied; Standard puts it back @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await stubClipboard(page);
    const lib = [
      keyed('tune-shift', 0, SHIFT.r, SHIFT.f),
      keyed('tune-zero', 1, ZERO.r, ZERO.f),
      keyed('tune-none', 2, NONE.r, NONE.f),
      keyed('tune-unanalysed', 3, SHIFT.r, SHIFT.f, { chromaVersion: undefined, chroma: undefined, chromaA4Hz: undefined, musicKey: undefined, keyConfidence: undefined }),
      keyed('tune-unclear', 4, SHIFT.r, SHIFT.f, { keyConfidence: 0.2 }),
      keyed('tune-nocrystal', 5, SHIFT.r, SHIFT.f, { closestSolfeggio: undefined, harmonicFreq: undefined, harmonicDeviation: undefined, crystalSource: undefined }),
      keyed('tune-kept', 6, SHIFT.r, SHIFT.f, { tuneCents: SHIFT.sol, tuneFor: SHIFT.f }),
      keyed('tune-moved', 7, MOVED.r, MOVED.f, { tuneCents: -7, tuneFor: KEPT_FOR }),
      keyed('tune-garbage', 8, SHIFT.r, SHIFT.f, { tuneCents: 51, tuneFor: SHIFT.f }),
      // Fix round 1: a key already within the edge (S1); a long clear-key track (S3: its Fit, from the key data); a long
      // unanalysed one (S3: longer than Analyse tracks' cap here, on the desktop's 1800 s and the phone's 720 s alike).
      keyed('tune-margin', 9, MARGIN.r, MARGIN.f),
      keyed('tune-long', 10, SHIFT.r, SHIFT.f, { duration: 900 }),
      keyed('tune-toolong', 11, SHIFT.r, SHIFT.f, { duration: 2000, chromaVersion: undefined, chroma: undefined, chromaA4Hz: undefined, musicKey: undefined, keyConfidence: undefined }),
      // (SF4: a kept tuning on a crystal its key already fits: Standard turns the row plain.)
      keyed('tune-fitsnow', 12, ZERO.r, ZERO.f, { tuneCents: -7, tuneFor: ZERO.f === 963 ? 852 : 963 }),
      // Fix round 2: a tuned track moved to a crystal its key fits at its kept tuning (L-S1: no Fit); a long tuned track
      // (L-S3: no Assign promise).
      keyed('tune-keptfits', 13, KEPT_FITS.r, KEPT_FITS.f, { tuneCents: KEPT_FITS.c, tuneFor: KEPT_FITS.f === 963 ? 852 : 963 }),
      keyed('tune-longkept', 14, SHIFT.r, SHIFT.f, { duration: 900, tuneCents: SHIFT.sol, tuneFor: SHIFT.f }),
      // (Fix round 2, tests should-fix 2: a 900 s unanalysed track, over the phone's 720 s cap and within the desktop's
      // 1,800 s: this device's caps decide its reason.)
      keyed('tune-900', 15, SHIFT.r, SHIFT.f, { duration: 900, chromaVersion: undefined, chroma: undefined, chromaA4Hz: undefined, musicKey: undefined, keyConfidence: undefined }),
    ];
    // (mobile-ua and a device run, android, have the phone's caps; desktop the desktop's.)
    const phoneCaps = test.info().project.name !== 'desktop';
    await openWith(page, lib);
    await tuningHook(page);
    const live = await liveFlag(page);
    await openLibraryTab(page);
    const states: Array<[string, (r: Awaited<ReturnType<typeof tuningRowOf>>) => void]> = [
      ['tune-shift', (r) => { expect(r.options).toEqual(['Standard (432)', `Fit ${SHIFT.f} Hz · ${tuneLabel(SHIFT.sol!)}`]); expect(r.value).toBe('Standard (432)'); expect(r.note).toBe(standardNote(live)); }],
      ['tune-zero', (r) => { expect(r.options).toBeNull(); expect(r.plain).toBe("Standard (432)Its key already fits this crystal's tone"); }],
      ['tune-none', (r) => { expect(r.options).toBeNull(); expect(r.plain).toBe(`Standard (432)No tuning within ±50 cents fits ${NONE.f} Hz`); }],
      ['tune-unanalysed', (r) => expect(r.plain).toBe('Standard (432)Analyse tracks first')],
      ['tune-unclear', (r) => expect(r.plain).toBe('Standard (432)No clear key')],
      ['tune-nocrystal', (r) => expect(r.plain).toBe('Standard (432)No crystal yet')],
      ['tune-kept', (r) => { expect(r.options).toEqual(['Standard (432)', `Tuned ${tuneLabel(SHIFT.sol!)} · chosen for ${SHIFT.f} Hz`]); expect(r.value).toBe(`Tuned ${tuneLabel(SHIFT.sol!)} · chosen for ${SHIFT.f} Hz`); expect(r.note).toBe(tunedNote(SHIFT.sol!, live)); }],
      ['tune-moved', (r) => { expect(r.options).toEqual(['Standard (432)', `Tuned ${tuneLabel(-7)} · chosen for ${KEPT_FOR} Hz`, `Fit ${MOVED.f} Hz · ${tuneLabel(MOVED.sol!)}`]); expect(r.note).toBe(tunedNote(-7, live, { movedFrom: KEPT_FOR, movedTo: MOVED.f })); }],
      ['tune-garbage', (r) => { expect(r.options).toEqual(['Standard (432)', `Fit ${SHIFT.f} Hz · ${tuneLabel(SHIFT.sol!)}`]); expect(r.value).toBe('Standard (432)'); }],
      ['tune-margin', (r) => { expect(r.options, `S1: fitShift gives ${MARGIN.fitShift}, but the key already fits`).toBeNull(); expect(r.plain).toBe("Standard (432)Its key already fits this crystal's tone"); }],
      ['tune-long', (r) => { expect(r.options, 'S3: a long clear-key track gets its Fit').toEqual(['Standard (432)', `Fit ${SHIFT.f} Hz · ${tuneLabel(SHIFT.sol!)}`]); expect(r.note, 'fix round 2 (L-S3): the offer\'s note: no placement by key').toBe(standardNote(live, true)); }],
      ['tune-toolong', (r) => expect(r.plain).toBe('Standard (432)Too long for Analyse tracks on this device')],
      ['tune-keptfits', (r) => {
        const keptFor = KEPT_FITS.f === 963 ? 852 : 963;
        expect(r.options, `L-S1: its key fits ${KEPT_FITS.f} at its ${KEPT_FITS.c} c (Standard would offer ${KEPT_FITS.sol} c): no Fit`).toEqual(['Standard (432)', `Tuned ${tuneLabel(KEPT_FITS.c)} · chosen for ${keptFor} Hz`]);
        expect(r.note).toBe(tunedNote(KEPT_FITS.c, live, { movedFrom: keptFor, movedTo: KEPT_FITS.f }));
      }],
      ['tune-longkept', (r) => expect(r.note, 'L-S3: a 900 s tuned track: no Assign promise').toBe(tunedNote(SHIFT.sol!, live, { long: true }))],
      ['tune-900', (r) => expect(r.plain, phoneCaps ? 'the phone (720 s): too long for its Analyse tracks' : 'the desktop (1,800 s): it analyses it').toBe(phoneCaps ? 'Standard (432)Too long for Analyse tracks on this device' : 'Standard (432)Analyse tracks first')],
    ];
    for (const [name, want] of states) {
      await openInfo(page, name);
      await test.step(name, async () => want(await tuningRowOf(page)));
      // (Fix round 2, L-S1: the Crystal note of the track its key fits at its tuning says so, beside no Fit.)
      if (name === 'tune-keptfits') await expect.poll(async () => (await trackInfo(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) }).locator('dd span').first().textContent()) ?? '', { timeout: 15_000 }).toContain("Its key fits this crystal's tone at its tuning.");
      await closeInfo(page);
    }
    // The select: Fit applies at once (the stored fields, the announcement, the note), Copy has it; Standard removes it.
    const id = lib[0].id;
    await openInfo(page, 'tune-shift');
    const sel = trackInfo(page).getByTestId('track-info-tuning').locator('select');
    await expect(sel).toHaveAttribute('aria-describedby', /^track-info-tuning-note-/);
    await sel.selectOption({ label: `Fit ${SHIFT.f} Hz · ${tuneLabel(SHIFT.sol!)}` });
    await expect.poll(async () => (await tuningOf(page, id))?.tuneCents, { message: 'the tuning is the library track\'s at once' }).toBe(SHIFT.sol);
    expect((await tuningOf(page, id))?.tuneFor).toBe(SHIFT.f);
    await expect(trackInfo(page).getByTestId('track-info-tuning-live')).toHaveText(`Tuning: Fit ${SHIFT.f} hertz, ${spoken(SHIFT.sol!)}`);
    await expect(trackInfo(page).getByTestId('track-info-tuning-note')).toHaveText(tunedNote(SHIFT.sol!, live));
    const r1 = await tuningRowOf(page);
    expect(r1.value).toBe(`Tuned ${tuneLabel(SHIFT.sol!)} · chosen for ${SHIFT.f} Hz`);
    expect((await copied(page)).split('\n')).toContain(`Tuning: ${tuneLabel(SHIFT.sol!)} (chosen for ${SHIFT.f} Hz)`);
    await expect.poll(() => storedTuning(page, id), { message: 'stored for a reload', timeout: 15_000 }).toEqual({ tuneCents: SHIFT.sol, tuneFor: SHIFT.f, tuneLoShu: null });
    // The Crystal note at its tuning (its own bands, made after the retune).
    await expect.poll(async () => (await trackInfo(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) }).locator('dd span').first().textContent()) ?? '', { timeout: 15_000 }).toContain("Its key fits this crystal's tone at its tuning.");
    await sel.selectOption({ label: 'Standard (432)' });
    await expect.poll(async () => (await tuningOf(page, id))?.tuneCents ?? null).toBeNull();
    await expect(trackInfo(page).getByTestId('track-info-tuning-live')).toHaveText('Tuning: Standard');
    expect((await copied(page)).split('\n')).toContain('Tuning: Standard (432)');
    await expect.poll(() => storedTuning(page, id), { timeout: 15_000 }).toEqual({ tuneCents: null, tuneFor: null, tuneLoShu: null });
    await closeInfo(page);
    // Fix round 1 (SF4): a choice that turns the row plain (the select goes) moves focus to that row, never the page.
    await openInfo(page, 'tune-fitsnow');
    const fsel = trackInfo(page).getByTestId('track-info-tuning').locator('select');
    expect(await fsel.locator('option').allTextContents(), 'a kept tuning on a crystal its key already fits: Standard and the kept one').toHaveLength(2);
    await fsel.focus();
    await fsel.selectOption({ label: 'Standard (432)' });
    await expect(trackInfo(page).getByTestId('track-info-tuning').locator('select'), 'the row turns plain').toHaveCount(0);
    await expect(trackInfo(page).getByTestId('track-info-tuning'), 'SF4: focus on the plain row').toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName), 'never on the page\'s body').not.toBe('BODY');
    await expect(trackInfo(page).getByTestId('track-info-tuning-live')).toHaveText('Tuning: Standard');
    // (N1: the choice row is between two definition lists, never a list's child; every list child is a dt/dd pair.)
    await closeInfo(page);
    await openInfo(page, 'tune-shift');
    expect(await trackInfo(page).locator('dl > *').evaluateAll((xs) => xs.every((x) => x.tagName === 'DIV' && !!x.querySelector(':scope > dt') && !!x.querySelector(':scope > dd'))), 'N1: every child of a list is a row').toBe(true);
    expect(await trackInfo(page).locator('dl [data-testid="track-info-tuning-select"]').count(), 'N1: the select is in no list').toBe(0);
  });

  test('T-1b. A1: Perfect GUT on, a swapped crystal: Fit and Fit Lo Shu; the Lo Shu one applies (label, Copy, the Crystal note); Perfect GUT off: only the Solfeggio Fit, the Lo Shu tuning kept and played at its rate @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await stubClipboard(page);
    const lib = [keyed('tune-loshu', 0, BOTH.r, BOTH.f), keyed('tune-solkept', 1, SOL_KEPT.r, SOL_KEPT.f, { tuneCents: SOL_KEPT.sol, tuneFor: SOL_KEPT.f })];
    const lo = loShuHz(BOTH.f)!;
    await openWith(page, lib, { perfectGut: true });
    await tuningHook(page);
    await openLibraryTab(page);
    await openInfo(page, 'tune-loshu');
    const r = await tuningRowOf(page);
    expect(r.options).toEqual(['Standard (432)', `Fit ${BOTH.f} Hz · ${tuneLabel(BOTH.sol!)}`, `Fit Lo Shu ${lo} Hz · ${tuneLabel(BOTH.lo!)}`]);
    await trackInfo(page).getByTestId('track-info-tuning').locator('select').selectOption({ label: `Fit Lo Shu ${lo} Hz · ${tuneLabel(BOTH.lo!)}` });
    await expect.poll(async () => tuningOf(page, lib[0].id)).toEqual({ id: lib[0].id, tuneCents: BOTH.lo, tuneFor: BOTH.f, tuneLoShu: true });
    await expect(trackInfo(page).getByTestId('track-info-tuning-live')).toHaveText(`Tuning: Fit Lo Shu ${lo} hertz, ${spoken(BOTH.lo!)}`);
    const kept = await tuningRowOf(page);
    expect(kept.value).toBe(`Tuned ${tuneLabel(BOTH.lo!)} · chosen for Lo Shu ${lo} Hz (${BOTH.f})`);
    expect(kept.note).toContain('so the Lo Shu tone fits its key');
    expect((await copied(page)).split('\n')).toContain(`Tuning: ${tuneLabel(BOTH.lo!)} (chosen for Lo Shu ${lo} Hz)`);
    await expect.poll(async () => (await trackInfo(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) }).locator('dd span').first().textContent()) ?? '').toContain('Its key fits the Lo Shu tone at its tuning.');
    await expect.poll(() => storedTuning(page, lib[0].id), { timeout: 15_000 }).toEqual({ tuneCents: BOTH.lo, tuneFor: BOTH.f, tuneLoShu: true });
    await closeInfo(page);
    // Fix round 2 (tests nit 3): a kept Solfeggio tuning on a swapped crystal, then Fit Lo Shu: tuneFor stays, only the
    // cents change, and the Crystal note follows them (the dialog's Lo Shu test is memoised on the cents too).
    await openInfo(page, 'tune-solkept');
    const lo2 = loShuHz(SOL_KEPT.f)!;
    const crystalNote = async () => (await trackInfo(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) }).locator('dd span').first().textContent()) ?? '';
    await page.waitForTimeout(500);
    expect(await crystalNote(), `at its Solfeggio tuning (${SOL_KEPT.sol} c) the Lo Shu tone doesn't fit: no Lo Shu line`).not.toContain('Lo Shu');
    await trackInfo(page).getByTestId('track-info-tuning').locator('select').selectOption({ label: `Fit Lo Shu ${lo2} Hz · ${tuneLabel(SOL_KEPT.lo)}` });
    await expect.poll(async () => tuningOf(page, lib[1].id)).toEqual({ id: lib[1].id, tuneCents: SOL_KEPT.lo, tuneFor: SOL_KEPT.f, tuneLoShu: true });
    await expect.poll(crystalNote, { message: `at its Lo Shu fit (${SOL_KEPT.lo} c) the Crystal note says so` }).toContain('Its key fits the Lo Shu tone at its tuning.');
    await closeInfo(page);
    // Perfect GUT off (a reload with the setting off): the kept Lo Shu tuning, the Solfeggio Fit, no Lo Shu choice.
    await page.evaluate(() => localStorage.setItem('aetheria.loShuPerfectGUT.v1', 'false'));
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(lib.length);
    await tuningHook(page);
    expect(await tuningOf(page, lib[0].id), 'kept across the reload').toEqual({ id: lib[0].id, tuneCents: BOTH.lo, tuneFor: BOTH.f, tuneLoShu: true });
    await openLibraryTab(page);
    await openInfo(page, 'tune-loshu');
    const offRow = await tuningRowOf(page);
    expect(offRow.options).toEqual(['Standard (432)', `Tuned ${tuneLabel(BOTH.lo!)} · chosen for Lo Shu ${lo} Hz (${BOTH.f})`, `Fit ${BOTH.f} Hz · ${tuneLabel(BOTH.sol!)}`]);
    // Fix round 1 (N4): what is true with Perfect GUT off; (A01) and the Crystal note is never the Lo Shu one.
    expect(offRow.note.split('. ')[1], 'N4: the kept Lo Shu tuning\'s note with Perfect GUT off').toBe(`Chosen for Lo Shu ${lo} Hz, which plays only with Lo Shu Perfect GUT on`);
    expect(offRow.note).not.toContain('fits its key');
    await expect.poll(async () => (await trackInfo(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) }).locator('dd span').first().textContent()) ?? '', { message: 'A01: never the Lo Shu note with Perfect GUT off' }).not.toContain('Lo Shu');
    await closeInfo(page);
    await libraryRowButton(page, 'tune-loshu').click();
    await expect.poll(() => musicRate(page), { message: 'it plays at its Lo Shu tuning\'s rate', timeout: 20_000 }).toBe(tuneRate(BOTH.lo!));
  });

  test('T-1c. Fix round 1 (S2): the phone\'s own speaker, Perfect GUT on: the Lo Shu Fit is made for the tone it plays there, an octave up @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const lo = loShuHz(PHONE_LO.f)!;
    const hp = offeredShift(PHONE_LO.r.chroma, PHONE_LO.r.chromaA4Hz, loShuTone(PHONE_LO.f, 'headphones'));
    expect(PHONE_LO.lo, 'Node: the phone\'s Lo Shu shift differs from the headphones\'').not.toBe(hp);
    await openWith(page, [keyed('tune-phone', 0, PHONE_LO.r, PHONE_LO.f), keyed('tune-phonenote', 1, PHONE_NOTE.r, PHONE_NOTE.f)], { perfectGut: true, output: 'phone' });
    await tuningHook(page);
    await openLibraryTab(page);
    await openInfo(page, 'tune-phone');
    const want = ['Standard (432)', ...(PHONE_LO.sol !== null && PHONE_LO.sol !== 0 ? [`Fit ${PHONE_LO.f} Hz · ${tuneLabel(PHONE_LO.sol)}`] : []), `Fit Lo Shu ${lo} Hz · ${tuneLabel(PHONE_LO.lo!)}`];
    expect((await tuningRowOf(page)).options, `the Lo Shu Fit for ${loShuTone(PHONE_LO.f, 'phone')} Hz (the headphones' ${loShuTone(PHONE_LO.f)} Hz would give ${hp})`).toEqual(want);
    await closeInfo(page);
    // Fix round 2 (tests should-fix 3): the Crystal note's Lo Shu line is the phone's test too (its fit there differs
    // from the headphones').
    await openInfo(page, 'tune-phonenote');
    const crystalNote = async () => (await trackInfo(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) }).locator('dd span').first().textContent()) ?? '';
    if (PHONE_NOTE.onPhone) await expect.poll(crystalNote, { message: `the Lo Shu tone fits on the phone (${loShuTone(PHONE_NOTE.f, 'phone')} Hz), not on headphones` }).toContain('Its key fits the Lo Shu tone.');
    else {
      await page.waitForTimeout(500);
      expect(await crystalNote(), `the Lo Shu tone fits on headphones (${loShuTone(PHONE_NOTE.f)} Hz), not on the phone`).not.toContain('Lo Shu');
    }
  });

  test('T-1d. Fix round 2 (L-S2): a Lo Shu tuning chosen on the phone\'s speaker, heard on headphones: its note says what it was chosen for, never that it fits, and the headphones\' own Lo Shu Fit is offered; back on the phone it fits @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const { r, f, ph, hp, sol } = P2H;
    const lo = loShuHz(f)!;
    await openWith(page, [keyed('tune-p2h', 0, r, f, { tuneCents: ph, tuneFor: f, tuneLoShu: true })], { perfectGut: true, output: 'headphones' });
    await tuningHook(page);
    const live = await liveFlag(page);
    await openLibraryTab(page);
    await openInfo(page, 'tune-p2h');
    const kept = `Tuned ${tuneLabel(ph)} · chosen for Lo Shu ${lo} Hz (${f})`;
    const solOffer = sol !== null && sol !== 0 && sol !== ph && relAt(r.chroma, r.chromaA4Hz, solfeggioTone(f), ph) > FIT_REL_EDGE;
    const onHp = await tuningRowOf(page);
    expect(onHp.options, `headphones: the kept tuning (${ph} c, the phone's), and this output's Lo Shu Fit (${hp} c)`).toEqual(['Standard (432)', kept, ...(solOffer ? [`Fit ${f} Hz · ${tuneLabel(sol!)}`] : []), `Fit Lo Shu ${lo} Hz · ${tuneLabel(hp)}`]);
    expect(onHp.note, 'headphones: what it was chosen for, never "fits"').toBe(tunedNote(ph, live, { chosenFor: `Lo Shu ${lo} Hz`, loShu: true }));
    await expect.poll(async () => (await trackInfo(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) }).locator('dd span').first().textContent()) ?? '', { message: 'the Crystal note agrees: no Lo Shu line on headphones' }).not.toContain('Lo Shu');
    await closeInfo(page);
    // The phone's own speaker (a reload with that output): it fits there, and no Lo Shu Fit is offered.
    await page.evaluate((k) => localStorage.setItem(k, 'phone'), LAYER_OUTPUT_KEY);
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(1);
    await tuningHook(page);
    await openLibraryTab(page);
    await openInfo(page, 'tune-p2h');
    const onPhone = await tuningRowOf(page);
    expect(onPhone.note, 'the phone: so the Lo Shu tone fits its key').toBe(tunedNote(ph, live, { tone: 'the Lo Shu tone', loShu: true }));
    expect(onPhone.options!.some((o) => o.startsWith('Fit Lo Shu')), 'the phone: no Lo Shu Fit (it fits)').toBe(false);
    await expect.poll(async () => (await trackInfo(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) }).locator('dd span').first().textContent()) ?? '', { message: 'the Crystal note agrees on the phone' }).toContain('Its key fits the Lo Shu tone at its tuning.');
  });

  test('T-2 / T-7. The live switch on the playing track (in both flag modes): what is heard, the card\'s rate, Key fit and the chip agree; a retune of another track touches none of them; the chip opens Track info; Standard is PSF exactly @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const lib = [keyed('tune-live', 0, SHIFT.r, SHIFT.f, { duration: 30 }), keyed('tune-other', 1, ZERO.r, ZERO.f, { duration: 30 })];
    await openWith(page, lib, { tone: toneWav(30, 330) });
    await page.setViewportSize(PHONE_VIEWPORT); // the phone's Now Playing and its chips
    await tuningHook(page);
    // Fix round 1 (A4): LIVE_TUNE_SWITCH, read from the page. True: a choice on the playing track switches it at once.
    // False: the element keeps its rate until the track's next load, and so do the card, Key fit and the chip.
    const live = await liveFlag(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-live').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-live' && s.playing; }, { timeout: 20_000 }).toBe(true);
    expect(await musicRate(page), 'Standard: PITCH_SHIFT_FACTOR itself').toBe(PSF);
    await heardAgrees(page, PSF, SHIFT.r.chromaA4Hz, 'Standard');
    await tab(page, 'now');
    await expect(page.getByTestId('chip-tuning'), 'no chip at Standard').toHaveCount(0);
    await openLibraryTab(page);
    await openInfo(page, 'tune-live');
    const t0 = await page.evaluate(() => performance.now());
    await trackInfo(page).getByTestId('track-info-tuning').locator('select').selectOption({ label: `Fit ${SHIFT.f} Hz · ${tuneLabel(SHIFT.sol!)}` });
    const want = trackRate({ tuneCents: SHIFT.sol, tuneFor: SHIFT.f });
    // Stored and shown at once in both modes (with "From the next play." when the flag is false).
    await expect.poll(async () => (await tuningOf(page, lib[0].id))?.tuneCents, { message: 'the choice is stored' }).toBe(SHIFT.sol);
    await expect(trackInfo(page).getByTestId('track-info-tuning-note')).toHaveText(tunedNote(SHIFT.sol!, live));
    // What is heard: the new rate (live) or Standard still (the flag false); the card, Key fit and the chip agree.
    const heard = live ? want : PSF;
    await expect.poll(() => musicRate(page), { message: live ? 'the switch applies at once' : 'the flag false: the element keeps its rate', timeout: 2_000 }).toBe(heard);
    if (live) {
      const dt = (await page.evaluate(() => performance.now())) - t0;
      test.info().annotations.push({ type: 'T-2 the switch, from the choice to reading the element\'s rate (a Playwright round trip, ms)', description: dt.toFixed(0) });
    }
    await heardAgrees(page, heard, SHIFT.r.chromaA4Hz, 'after the Fit');
    expect(await page.evaluate(() => (window as any).__aetheriaTuning.held()), 'a tuning is held only with the flag false').toEqual(live ? null : { id: lib[0].id, cents: 0 });
    if (!live) {
      // Fix round 2 (tests nit 5, the flag false): "once per load": two more changes while held keep the first hold (what
      // the element still plays), and everything still says Standard.
      const other = SHIFT.sol === -50 ? -49 : -50;
      for (const c of [other, SHIFT.sol!]) {
        await page.evaluate(({ id, c, f }) => (window as any).__aetheriaTuning.set(id, c, f), { id: lib[0].id, c, f: SHIFT.f });
        await expect.poll(async () => (await tuningOf(page, lib[0].id))?.tuneCents, { message: `the change to ${c} c is stored` }).toBe(c);
        expect(await page.evaluate(() => (window as any).__aetheriaTuning.held()), `a change to ${c} c while held: the first hold stays`).toEqual({ id: lib[0].id, cents: 0 });
        await heardAgrees(page, PSF, SHIFT.r.chromaA4Hz, `a change to ${c} c while held`);
      }
    }
    expect((await libraryState(page)).playing, 'still playing: no pause, no duck').toBe(true);
    // Fix round 1 (A4, tests should-fix 2): a retune of another track while this one plays: the element, the card and
    // Key fit stay as they are.
    const p0 = await page.evaluate(() => (window as any).__positions.length);
    await page.evaluate(({ id, f }) => (window as any).__aetheriaTuning.set(id, 9, f), { id: lib[1].id, f: ZERO.f });
    await expect.poll(async () => (await tuningOf(page, lib[1].id))?.tuneCents).toBe(9);
    await page.waitForTimeout(600);
    expect(await musicRate(page), 'another track\'s retune: the element untouched').toBe(heard);
    await heardAgrees(page, heard, SHIFT.r.chromaA4Hz, 'after another track\'s retune');
    expect((await page.evaluate(() => (window as any).__positions as Array<number | null>)).slice(p0).every((r) => r === heard), 'the card never said another rate').toBe(true);
    await expectAnchorUntouched(page, 'after the live switch and another track\'s retune');
    await closeInfo(page);
    // The chip: the tuning heard (live: the new one; the flag false: none yet, the element still plays Standard).
    const chipText = `Tuned ${tuneLabel(SHIFT.sol!).replace(' cents', ' c').replace(' cent', ' c')}`;
    await tab(page, 'now');
    if (live) {
      await expect(page.getByTestId('chip-tuning')).toHaveText(chipText);
      await expect(page.getByTestId('chip-tuning'), 'fix round 1 (N2): its spoken name, from tuneLabel').toHaveAccessibleName(`Tuned ${tuneLabel(SHIFT.sol!)}, Track info`);
    } else {
      await expect(page.getByTestId('chip-tuning'), 'the flag false: no chip while the element plays Standard').toHaveCount(0);
    }
    // (The desktop's transport row shows it too, display only, as that row is.)
    await page.setViewportSize({ width: 1280, height: 720 });
    if (live) await expect(page.getByTestId('desktop-tuning-chip')).toHaveText(chipText);
    else await expect(page.getByTestId('desktop-tuning-chip')).toHaveCount(0);
    await page.setViewportSize(PHONE_VIEWPORT);
    const pauses0 = await page.evaluate(() => (window as any).__pauseCount);
    if (!live) {
      // The flag false: the track's next play applies it (another track's load ends the hold; playTrack loads it again).
      // (A tap on the row of the track that plays doesn't start it again.)
      await openLibraryTab(page);
      await libraryRowButton(page, 'tune-other').click();
      await expect.poll(async () => (await libraryState(page)).current, { timeout: 20_000 }).toBe('tune-other');
      await expect.poll(() => page.evaluate(() => (window as any).__aetheriaTuning.held()), { message: 'another load ends the hold' }).toBeNull();
      await libraryRowButton(page, 'tune-live').click();
      await expect.poll(async () => (await libraryState(page)).current, { timeout: 20_000 }).toBe('tune-live');
      await expect.poll(() => musicRate(page), { message: 'its next play: the new rate', timeout: 20_000 }).toBe(want);
      await heardAgrees(page, want, SHIFT.r.chromaA4Hz, 'its next play');
      expect(await page.evaluate(() => (window as any).__aetheriaTuning.held()), 'the hold ended with the load').toBeNull();
      await tab(page, 'now');
      await expect(page.getByTestId('chip-tuning')).toHaveText(chipText);
    }
    // The chip's tap: Track info for that track.
    await page.getByTestId('chip-tuning').click();
    await expect(trackInfo(page)).toBeVisible();
    await expect(trackInfo(page).getByTestId('track-info-body')).toContainText('tune-live');
    // Back to Standard from there: PSF exactly, the card too, and the chip goes (the flag false: from the next play).
    await trackInfo(page).getByTestId('track-info-tuning').locator('select').selectOption({ label: 'Standard (432)' });
    await expect.poll(async () => (await tuningOf(page, lib[0].id))?.tuneCents ?? null).toBeNull();
    const back = live ? PSF : want;
    await expect.poll(() => musicRate(page), { timeout: 2_000 }).toBe(back);
    await heardAgrees(page, back, SHIFT.r.chromaA4Hz, 'back to Standard');
    await trackInfo(page).getByRole('button', { name: 'Close', exact: true }).click();
    if (live) await expect(page.getByTestId('chip-tuning')).toHaveCount(0);
    else await expect(page.getByTestId('chip-tuning'), 'the flag false: the chip says what is heard until the next play').toHaveText(chipText);
    await page.setViewportSize({ width: 1280, height: 720 });
    if (live) await expect(page.getByTestId('desktop-tuning-chip')).toHaveCount(0);
    else await expect(page.getByTestId('desktop-tuning-chip')).toHaveText(chipText);
    if (live) expect(await page.evaluate(() => (window as any).__pauseCount), 'never a pause').toBe(0);
    else expect(await page.evaluate(() => (window as any).__pauseCount) - pauses0, 'two pauses: the two starts\' own').toBe(2);
  });

  test('T-2b. Fix round 1 (C02): the chip follows a switch that changes nothing else the Sound slice holds (Key fit off, a key that fits either way): "Tuned +1 c", named "Tuned +1 cent, Track info" @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const lib = [keyed('tune-c02', 0, ZERO.r, ZERO.f, { duration: 30 })];
    await openWith(page, lib, { tone: toneWav(30, 330), keyFit: false });
    await page.setViewportSize(PHONE_VIEWPORT);
    await tuningHook(page);
    const live = await liveFlag(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-c02').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-c02' && s.playing; }, { timeout: 20_000 }).toBe(true);
    await tab(page, 'now');
    await expect(page.getByTestId('key-fit-chip'), 'Key fit off: no Key fit chip').toHaveCount(0);
    await expect(page.getByTestId('chip-tuning')).toHaveCount(0);
    await page.waitForTimeout(1200);
    await page.evaluate(({ id, f }) => (window as any).__aetheriaTuning.set(id, 1, f), { id: lib[0].id, f: ZERO.f });
    if (live) {
      await expect(page.getByTestId('chip-tuning'), 'the chip at once').toHaveText('Tuned +1 c', { timeout: 2_000 });
      await expect(page.getByTestId('chip-tuning'), 'N2: the singular').toHaveAccessibleName('Tuned +1 cent, Track info');
    } else {
      await page.waitForTimeout(1_000);
      await expect(page.getByTestId('chip-tuning'), 'the flag false: the element still plays Standard').toHaveCount(0);
    }
  });

  test('T-2c. Fix round 1 (A1): a choice made while the next track starts reaches only the track the music element holds: never the outgoing one, always the incoming one @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const lib = [keyed('tune-wa', 0, SHIFT.r, SHIFT.f, { duration: 30 }), keyed('tune-wb', 1, ZERO.r, ZERO.f, { duration: 30 }), keyed('tune-wc', 2, NONE.r, NONE.f, { duration: 30 })];
    await openWith(page, lib, { tone: toneWav(30, 330) });
    await tuningHook(page);
    const live = await liveFlag(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-wa').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-wa' && s.playing; }, { timeout: 20_000 }).toBe(true);
    // Hold the next music play() for 1.5 s (as a slow blob load does on the phone): the element holds the incoming
    // track while the app's state still names the outgoing one.
    const holdNextPlay = () => page.evaluate(() => {
      const w = window as any;
      w.__heldPlay = false;
      if (w.__holdWrapped) return;
      w.__holdWrapped = true;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        const r = play.call(this);
        if (!w.__heldPlay && (this.getAttribute('src') || '').startsWith('blob:')) { w.__heldPlay = true; return new Promise((res, rej) => setTimeout(() => r.then(res, rej), 1500)); }
        return r;
      };
    });
    const playsNow = () => page.evaluate(() => (window as any).__plays.length as number);
    // 1. Next to tune-wb (transport(): the desktop's button at this size, the media session's handler in the phone shell);
    // in its start, a choice for tune-wa (the outgoing track): tune-wb is never touched.
    await holdNextPlay();
    let n0 = await playsNow();
    await transport(page, 'next');
    await expect.poll(playsNow, { message: 'tune-wb\'s play() was called' }).toBeGreaterThan(n0);
    expect((await libraryState(page)).current, 'in the window: the state still names tune-wa').toBe('tune-wa');
    await page.evaluate(({ id, f }) => (window as any).__aetheriaTuning.set(id, -50, f), { id: lib[0].id, f: SHIFT.f });
    expect(await musicRate(page), 'a choice for the outgoing track never reaches the incoming one').toBe(PSF);
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 10_000 }).toBe('tune-wb');
    await page.waitForTimeout(400);
    expect(await musicRate(page), 'tune-wb plays at its own rate').toBe(PSF);
    expect(await lastPositionRate(page), 'and the card says so').toBe(PSF);
    expect(await page.evaluate(() => (window as any).__aetheriaTuning.held()), 'nothing held: the element never held tune-wa then').toBeNull();
    expect((await tuningOf(page, lib[0].id))?.tuneCents, 'tune-wa\'s choice is stored').toBe(-50);
    // 2. Next to tune-wc; in its start, a choice for tune-wc (the incoming track): it reaches tune-wc (the flag false:
    // from its next play, the element and the card at its old rate meanwhile).
    await holdNextPlay();
    n0 = await playsNow();
    await transport(page, 'next');
    await expect.poll(playsNow, { message: 'tune-wc\'s play() was called' }).toBeGreaterThan(n0);
    expect((await libraryState(page)).current, 'in the window: the state still names tune-wb').toBe('tune-wb');
    await page.evaluate(({ id }) => (window as any).__aetheriaTuning.set(id, 37, 2178), { id: lib[2].id });
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 10_000 }).toBe('tune-wc');
    const heard = live ? tuneRate(37) : PSF;
    await expect.poll(() => musicRate(page), { message: live ? 'a choice for the incoming track reaches it' : 'the flag false: its old rate until its next play', timeout: 5_000 }).toBe(heard);
    await expect.poll(() => lastPositionRate(page), { message: 'the card says what the element plays', timeout: 5_000 }).toBe(heard);
    expect(await page.evaluate(() => (window as any).__aetheriaTuning.held())).toEqual(live ? null : { id: lib[2].id, cents: 0 });
  });

  test('T-2d. Fix round 1 (A2): a switch tells the lock-screen card at once, with no frame to come after it (a locked phone runs none) @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const lib = [keyed('tune-lk', 0, SHIFT.r, SHIFT.f, { duration: 30 })];
    await openWith(page, lib, { tone: toneWav(30, 330) });
    await tuningHook(page);
    const live = await liveFlag(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-lk').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-lk' && s.playing; }, { timeout: 20_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__positions.length as number), { message: 'the card is being updated' }).toBeGreaterThan(1);
    await page.waitForTimeout(1300);
    // rAF stopped (as a lock stops it), then the switch in the same turn: no later frame can carry the new rate.
    const n0 = await page.evaluate(({ id, c, f }) => {
      const w = window as any;
      w.requestAnimationFrame = () => 0;
      const n = w.__positions.length;
      w.__aetheriaTuning.set(id, c, f);
      return n;
    }, { id: lib[0].id, c: SHIFT.sol, f: SHIFT.f });
    await page.waitForTimeout(2500);
    const after: Array<number | null> = (await page.evaluate(() => (window as any).__positions)).slice(n0);
    // Fix round 2 (tests should-fix 1): the whole state, not only the rate: the element's length, and its time.
    const states: Array<{ rate: number | null; position: number | null; duration: number | null; elT: number | null; elDur: number | null }> = (await page.evaluate(() => (window as any).__posStates)).slice(n0);
    for (const [k, s] of states.entries()) {
      expect(s.duration, `update ${k + 1} after the switch: the card's length is the element's (${s.elDur})`).toBe(s.elDur);
      expect(Math.abs((s.position as number) - (s.elT as number)), `update ${k + 1}: the card's position (${s.position}) is the element's time (${s.elT})`).toBeLessThan(0.3);
    }
    if (live) {
      expect(after[0], 'the card\'s first update after the switch, at once: the new rate').toBe(tuneRate(SHIFT.sol!));
      expect(after.every((r) => r === tuneRate(SHIFT.sol!)), 'and only the new rate since').toBe(true);
      expect(states.length, 'the switch was sent').toBeGreaterThan(0);
      expect((states[0].elT as number) > 0.3, `(the switch is ${states[0].elT} s into the track, so a position of 0 would show)`).toBe(true);
      expect(await musicRate(page)).toBe(tuneRate(SHIFT.sol!));
    } else {
      expect(after.every((r) => r === PSF), 'the flag false: the element plays Standard, the card says so').toBe(true);
      expect(await musicRate(page)).toBe(PSF);
    }
  });

  test('T-2e. Fix round 2 (app SF-1): a switch made in a microtask right after a commit at the hook\'s 1 s boundary, frames stopped at once: the card\'s last rate is what the element plays (the new rate when live) @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    const lib = [keyed('tune-race', 0, SHIFT.r, SHIFT.f, { duration: 120 })];
    await openWith(page, lib, { tone: toneWav(120, 330) });
    await tuningHook(page);
    const live = await liveFlag(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-race').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-race' && s.playing; }, { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(1500);
    // (Frames are held, not dropped: the held callbacks run again after each try, so the app's frame loop goes on.)
    await page.evaluate(() => {
      const w = window as any;
      const raf = w.requestAnimationFrame.bind(w);
      w.__rafHeld = null;
      w.requestAnimationFrame = (cb: FrameRequestCallback) => { if (w.__rafHeld) { w.__rafHeld.push(cb); return 0; } return raf(cb); };
      w.__rafRelease = () => { const q = w.__rafHeld ?? []; w.__rafHeld = null; for (const cb of q) raf(cb); };
    });
    const other = SHIFT.sol! > 0 ? SHIFT.sol! - 20 : SHIFT.sol! + 20;
    const tries: Array<{ c: number; armed: boolean; el: number; cardAt900: number | null; seq: Array<{ rate: number | null; dt: number }> }> = [];
    for (let i = 0; i < 8; i++) {
      const c = i % 2 === 0 ? SHIFT.sol! : other;
      const t = await page.evaluate(({ id, f, c, thr }) => new Promise<any>((resolve) => {
        const w = window as any;
        const pos = w.__posStates as Array<{ rate: number | null; at: number }>;
        const lastAt = () => (pos.length ? pos[pos.length - 1].at : 0);
        const deadline = performance.now() + 8000;
        // Wait until the hook's 1 s throttle has (nearly) run out, so the next commit's passive effect will send; then
        // switch in a MutationObserver microtask right after that commit (before React flushes its passive effects),
        // with frames stopped at once (a lock), as a locked phone runs none after it.
        const arm = () => {
          if (performance.now() > deadline) { resolve({ c, armed: false, el: w.__music.playbackRate, cardAt900: null, seq: [] }); return; }
          if (performance.now() - lastAt() < thr) { setTimeout(arm, 2); return; }
          const n0 = pos.length;
          const mo = new MutationObserver(() => {
            mo.disconnect();
            w.__rafHeld = [];
            const t0 = performance.now();
            w.__aetheriaTuning.set(id, c, f);
            const el = w.__music.playbackRate as number;
            setTimeout(() => {
              const seq = pos.slice(n0).map((p) => ({ rate: p.rate, dt: Math.round(p.at - t0) }));
              // (What the card holds 900 ms after the switch: the last update by then, before the switch too.)
              const upTo900 = pos.filter((p) => p.at - t0 <= 900);
              w.__rafRelease();
              resolve({ c, armed: true, el, cardAt900: upTo900.length ? upTo900[upTo900.length - 1].rate : null, seq });
            }, 1600);
          });
          mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
        };
        arm();
      }), { id: lib[0].id, f: SHIFT.f, c, thr: 975 + (i % 4) * 6 });
      tries.push(t);
      await page.waitForTimeout(500);
    }
    test.info().annotations.push({ type: 'T-2e the card after each raced switch (rate, ms after it)', description: JSON.stringify(tries.map((t) => ({ c: t.c, el: t.el, seq: t.seq }))) });
    expect(tries.filter((t) => t.armed).length, 'every try armed (a commit at the 1 s boundary)').toBe(tries.length);
    for (const [k, t] of tries.entries()) expect(t.el, `try ${k + 1}: the element plays ${live ? 'the new rate' : 'Standard still (the flag false)'}`).toBe(live ? tuneRate(t.c) : PSF);
    const wrong = tries.filter((t) => t.cardAt900 !== t.el).map((t) => `${t.c} c: ${JSON.stringify(t.seq)}`);
    expect(wrong, `the card's last rate within 900 ms of the switch (a lock then keeps it) is the element's, every try (${wrong.length} of ${tries.length} wrong)`).toEqual([]);
  });

  test('T-2f. Fix round 2 (app N-a): a choice made while playTrack decodes the incoming track (no harmonicFreq; decodeAudioData held 3 s) holds once it plays: the element, the card, Key fit and the chip agree @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const lib = [keyed('tune-da', 0, ZERO.r, ZERO.f, { duration: 30 }), keyed('tune-db', 1, SHIFT.r, SHIFT.f, { duration: 30, harmonicFreq: undefined, harmonicDeviation: undefined })];
    await openWith(page, lib, { tone: toneWav(30, 330) });
    await page.setViewportSize(PHONE_VIEWPORT); // the phone's Now Playing and its chips
    await tuningHook(page);
    const live = await liveFlag(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-da').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-da' && s.playing; }, { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(800);
    // Hold the next decodeAudioData 3 s (a phone decodes a 4-minute file for seconds): playTrack's decode window.
    await page.evaluate(() => {
      const w = window as any;
      const dec = BaseAudioContext.prototype.decodeAudioData;
      w.__decHeld = false;
      BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: unknown[]) {
        const p = (dec as any).apply(this, a);
        if (!w.__decHeld) { w.__decHeld = true; return new Promise((res, rej) => setTimeout(() => p.then(res, rej), 3000)); }
        return p;
      } as typeof dec;
    });
    // (The 'playing' listeners added to the music element from here: at most one pending, however many choices.)
    await page.evaluate(() => {
      const w = window as any;
      w.__playingAdds = 0;
      const add = HTMLMediaElement.prototype.addEventListener;
      HTMLMediaElement.prototype.addEventListener = function (this: HTMLMediaElement, type: string, ...rest: unknown[]) {
        if (type === 'playing' && this === w.__music) w.__playingAdds++;
        return (add as any).call(this, type, ...rest);
      } as typeof add;
    });
    await libraryRowButton(page, 'tune-db').click();
    await expect.poll(() => page.evaluate(() => (window as any).__decHeld), { message: 'tune-db is being decoded', timeout: 10_000 }).toBe(true);
    const want = tuneRate(SHIFT.sol!);
    // Two choices in the window: the second is the one that holds (the listener reads the track's tuning when it plays).
    const first = SHIFT.sol! > 0 ? SHIFT.sol! - 20 : SHIFT.sol! + 20;
    await page.evaluate(({ id, c, f }) => (window as any).__aetheriaTuning.set(id, c, f), { id: lib[1].id, c: first, f: SHIFT.f });
    await page.evaluate(({ id, c, f }) => (window as any).__aetheriaTuning.set(id, c, f), { id: lib[1].id, c: SHIFT.sol, f: SHIFT.f });
    await expect.poll(async () => (await tuningOf(page, lib[1].id))?.tuneCents, { message: 'the choice is stored' }).toBe(SHIFT.sol);
    if (live) {
      expect(await page.evaluate(() => (window as any).__aetheriaTuning.retunePending()), 'one listener pending, for tune-db').toBe(lib[1].id);
      expect(await page.evaluate(() => (window as any).__playingAdds), 'two choices, one \'playing\' listener').toBe(1);
    }
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-db' && s.playing; }, { message: 'it plays after its decode', timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(1000);
    const heard = live ? want : PSF;
    await heardAgrees(page, heard, SHIFT.r.chromaA4Hz, 'after the decode window');
    await tab(page, 'now');
    if (live) await expect(page.getByTestId('chip-tuning'), 'the chip says what is heard').toHaveText(`Tuned ${tuneLabel(SHIFT.sol!).replace(' cents', ' c').replace(' cent', ' c')}`);
    else await expect(page.getByTestId('chip-tuning'), 'the flag false: the element plays Standard until the next play, and so does the chip').toHaveCount(0);
    await page.waitForTimeout(3000);
    expect(await musicRate(page), 'and still, 3 s later').toBe(heard);
    expect(await page.evaluate(() => (window as any).__aetheriaTuning.retunePending()), 'nothing left pending').toBeNull();
    await expectAnchorUntouched(page, 'after the decode-window listener');
  });

  test('T-2g. Fix round 2 (app N-a): a choice made while playTrack decodes a track, then another track before it plays: that one plays at its own rate (the pending listener touches only the track it was for) @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const lib = [keyed('tune-ga1', 0, ZERO.r, ZERO.f, { duration: 30 }), keyed('tune-gb1', 1, SHIFT.r, SHIFT.f, { duration: 30, harmonicFreq: undefined, harmonicDeviation: undefined }), keyed('tune-gc1', 2, NONE.r, NONE.f, { duration: 30, tuneCents: 37, tuneFor: 2178 })];
    await openWith(page, lib, { tone: toneWav(30, 330) });
    await tuningHook(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-ga1').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-ga1' && s.playing; }, { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const w = window as any;
      const dec = BaseAudioContext.prototype.decodeAudioData;
      w.__decHeld = false;
      BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: unknown[]) {
        const p = (dec as any).apply(this, a);
        if (!w.__decHeld) { w.__decHeld = true; return new Promise((res, rej) => setTimeout(() => p.then(res, rej), 3000)); }
        return p;
      } as typeof dec;
    });
    await libraryRowButton(page, 'tune-gb1').click();
    await expect.poll(() => page.evaluate(() => (window as any).__decHeld), { message: 'tune-gb1 is being decoded', timeout: 10_000 }).toBe(true);
    await page.evaluate(({ id, c, f }) => (window as any).__aetheriaTuning.set(id, c, f), { id: lib[1].id, c: -50, f: SHIFT.f });
    // Before it plays, a tap on another track (tuned +37 c): its own rate, the card too, whatever the pending listener does.
    await libraryRowButton(page, 'tune-gc1').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-gc1' && s.playing; }, { message: 'tune-gc1 plays', timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(1500);
    await heardAgrees(page, tuneRate(37), NONE.r.chromaA4Hz, 'the next track');
    expect(await page.evaluate(() => (window as any).__aetheriaTuning.retunePending()), 'nothing left pending').toBeNull();
    expect((await tuningOf(page, lib[1].id))?.tuneCents, 'the choice for tune-gb1 is kept for its next play').toBe(-50);
  });

  test('T-7b. Fix round 1 (SF5): the desktop transport\'s tuning chip comes before the crystal chip and is in view at 1024, 1280, 1440, 1536 and 1920 px, with Key fit shown', async ({ page }) => {
    test.setTimeout(120_000);
    await openWith(page, [keyed('tune-desk', 0, SHIFT.r, SHIFT.f, { duration: 30, tuneCents: SHIFT.sol, tuneFor: SHIFT.f })], { tone: toneWav(30, 330) });
    await tuningHook(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-desk').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tune-desk' && s.playing; }, { timeout: 20_000 }).toBe(true);
    const chip = page.getByTestId('desktop-tuning-chip');
    const row = page.getByTestId('desktop-chips');
    // (Fix round 2, tests nit 10: 1024 and 1920 too, the comment's "from 1024 px" and the widest common screen.)
    for (const width of [1024, 1280, 1440, 1536, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(chip).toHaveText(`Tuned ${tuneLabel(SHIFT.sol!).replace(' cents', ' c').replace(' cent', ' c')}`);
      await expect(row.getByText(/^Key fit/), `${width}: Key fit shown`).toHaveCount(1);
      const c = (await chip.boundingBox())!, r = (await row.boundingBox())!;
      expect(c.width, `${width}: the chip has a size`).toBeGreaterThan(20);
      expect(c.x >= r.x - 0.5 && c.x + c.width <= r.x + r.width + 0.5, `${width}: the chip (${c.x.toFixed(0)}–${(c.x + c.width).toFixed(0)}) is inside the row's visible box (${r.x.toFixed(0)}–${(r.x + r.width).toFixed(0)})`).toBe(true);
      expect(c.x + c.width <= width, `${width}: and on screen`).toBe(true);
      const crystal = (await row.getByText(new RegExp(`^${SHIFT.f} Hz$`)).boundingBox())!;
      expect(c.x < crystal.x, `${width}: before the crystal chip`).toBe(true);
    }
  });

  test('T-9b. Fix round 1 (X04): the Export sheet gives a tuned track its own length and size (a Standard one, v16.8.2\'s) @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const lib = [keyed('tune-ex1', 0, SHIFT.r, SHIFT.f, { duration: 300, tuneCents: -50, tuneFor: SHIFT.f }), keyed('tune-ex2', 1, ZERO.r, ZERO.f, { duration: 300 })];
    await openWith(page, lib, { playlists: [{ id: 'pltune2', name: 'Tuned two', ids: [lib[0].id, lib[1].id] }] });
    await page.setViewportSize(PHONE_VIEWPORT);
    await tuningHook(page);
    const sheet = page.getByRole('dialog', { name: 'Export with layers', exact: true }).or(page.getByRole('region', { name: 'Export with layers', exact: true }));
    for (const [name, rate] of [['tune-ex1', tuneRate(-50)], ['tune-ex2', PSF]] as const) {
      await openLibraryTab(page);
      await page.getByTestId('library-search').fill(name);
      await rowMenu(page, name).click();
      await page.getByTestId('library-menu-export').click();
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId('export-file-line'), `${name}: 300 s at ${rate}`).toHaveText(fileLine(outSeconds(300, rate), wavBytes(300, rate)));
      await sheet.getByRole('button', { name: 'Close', exact: true }).first().click();
      await expect(sheet).toHaveCount(0);
      await page.getByTestId('library-search').fill('');
    }
    expect(fileLine(outSeconds(300, tuneRate(-50)), wavBytes(300, tuneRate(-50))), '(the two lines differ)').not.toBe(fileLine(outSeconds(300), wavBytes(300)));
    // Fix round 2 (tests nit 4): the two as a saved playlist, One long file: the sheet's line gives the long file's length
    // with each track at its own rate (exportSheetNumbers' longOut, the Standard seconds over PSF) and its bytes.
    const nums = exportSheetNumbers([{ seconds: 300, rate: tuneRate(-50) }, { seconds: 300, rate: PSF }]);
    const want = longTotals(nums.longOut, nums.bytes, 0).split(' · ').slice(0, 3).join(' · ');
    expect(want, '(at Standard the line would differ)').not.toBe(longTotals(600 / PSF, nums.bytes, 0).split(' · ').slice(0, 3).join(' · '));
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    const plRow = page.locator('[data-testid="playlist-row"][data-playlist-id="pltune2"]');
    await expect(plRow).toBeVisible({ timeout: 20_000 });
    await plRow.getByRole('button', { name: /Options for/ }).click();
    await page.getByTestId('playlist-menu-export').click();
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('export-files-long').click();
    await expect(sheet.getByTestId('export-files-long')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => ((await sheet.getByTestId('export-totals').textContent()) ?? '').split(' · ').slice(0, 3).join(' · '), { message: `the long file: ${want}` }).toBe(want);
  });

  test('T-11. Fix round 1 (gaps): a tuned track keeps its rate through pause and resume and a seek; Next to a Standard track is PSF exactly; Previous into a tuned one is its rate; a tap from tuned to Standard is PSF @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const lib = [keyed('tune-ga', 0, SHIFT.r, SHIFT.f, { duration: 30, tuneCents: -23, tuneFor: SHIFT.f }), keyed('tune-gb', 1, ZERO.r, ZERO.f, { duration: 30 }), keyed('tune-gc', 2, NONE.r, NONE.f, { duration: 30, tuneCents: 37, tuneFor: 2178 })];
    await openWith(page, lib, { tone: toneWav(30, 330) });
    await tuningHook(page);
    const ra = tuneRate(-23), rc = tuneRate(37);
    const at = async (name: string, rate: number, what: string) => {
      await expect.poll(async () => (await libraryState(page)).current, { message: `${what}: ${name}`, timeout: 20_000 }).toBe(name);
      await expect.poll(() => musicRate(page), { message: `${what}: the element at ${rate}`, timeout: 10_000 }).toBe(rate);
      await expect.poll(() => lastPositionRate(page), { message: `${what}: the card at ${rate}`, timeout: 10_000 }).toBe(rate);
    };
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-ga').click();
    await at('tune-ga', ra, 'a tap into a tuned track');
    // Pause and resume.
    await transport(page, 'pause');
    await expect.poll(async () => (await libraryState(page)).playing, { message: 'paused' }).toBe(false);
    expect(await musicRate(page), 'paused: the element keeps its rate').toBe(ra);
    await transport(page, 'play');
    await expect.poll(async () => (await libraryState(page)).playing, { message: 'playing again' }).toBe(true);
    await at('tune-ga', ra, 'resumed');
    // A seek: the car's skip and the scrubber.
    await page.evaluate(() => (window as any).__ms.seekforward?.({ seekOffset: 5 }));
    await page.waitForTimeout(400);
    await at('tune-ga', ra, 'after the car\'s +5 s');
    await page.evaluate(() => (window as any).__ms.seekto?.({ seekTime: 2 }));
    await page.waitForTimeout(400);
    await at('tune-ga', ra, 'after the scrubber');
    // Next to a Standard track: PSF exactly; Previous back into the tuned one (within its first seconds).
    await transport(page, 'next');
    await at('tune-gb', PSF, 'Next from a tuned track to a Standard one');
    await transport(page, 'prev');
    await at('tune-ga', ra, 'Previous into a tuned track');
    // A tap from the tuned track to a Standard one, then into another tuned one.
    await libraryRowButton(page, 'tune-gb').click();
    await at('tune-gb', PSF, 'a tap from a tuned track to a Standard one');
    await libraryRowButton(page, 'tune-gc').click();
    await at('tune-gc', rc, 'a tap into another tuned track');
  });

  test('T-11b. Fix round 2 (tests nit 6): the media session\'s own handlers (the car\'s and the lock screen\'s buttons) called directly with a tuned track: after each, the element\'s rate and the card\'s rate, length and position @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const lib = [keyed('tune-ha', 0, SHIFT.r, SHIFT.f, { duration: 30, tuneCents: -23, tuneFor: SHIFT.f }), keyed('tune-hb', 1, ZERO.r, ZERO.f, { duration: 30 }), keyed('tune-hc', 2, NONE.r, NONE.f, { duration: 30, tuneCents: 37, tuneFor: 2178 })];
    await openWith(page, lib, { tone: toneWav(30, 330) });
    await tuningHook(page);
    const ra = tuneRate(-23), rc = tuneRate(37);
    // (The handlers the app gave navigator.mediaSession.setActionHandler, recorded by the init script: what the car calls.)
    const handler = (a: string, d: Record<string, unknown> = {}) => page.evaluate(({ a, d }) => {
      const h = (window as any).__ms[a];
      if (typeof h !== 'function') throw new Error(`no ${a} handler`);
      h({ action: a, ...d });
    }, { a, d });
    const at = async (name: string, rate: number, what: string) => {
      await expect.poll(async () => (await libraryState(page)).current, { message: `${what}: ${name}`, timeout: 20_000 }).toBe(name);
      await expect.poll(() => musicRate(page), { message: `${what}: the element at ${rate}`, timeout: 10_000 }).toBe(rate);
      await expect.poll(() => lastPositionRate(page), { message: `${what}: the card at ${rate}`, timeout: 10_000 }).toBe(rate);
      await cardDescribesElement(page, what);
    };
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-ha').click();
    await at('tune-ha', ra, 'a tap into a tuned track');
    await page.waitForTimeout(1500);
    await handler('pause');
    await expect.poll(async () => (await libraryState(page)).playing, { message: 'pause: paused' }).toBe(false);
    await at('tune-ha', ra, 'pause');
    await handler('play');
    await expect.poll(async () => (await libraryState(page)).playing, { message: 'play: playing' }).toBe(true);
    await at('tune-ha', ra, 'play');
    // (The hook tells the card of a seek at its next send, within 1 s, as in v16.8.2: an update after the seek, past 12 s.)
    const n0 = await page.evaluate(() => (window as any).__posStates.length as number);
    await handler('seekto', { seekTime: 12 });
    await expect.poll(() => page.evaluate(() => (window as any).__music.currentTime as number), { message: 'seekto 12 s: the element moved there' }).toBeGreaterThan(11.9);
    await expect.poll(() => page.evaluate((n0) => { const p = ((window as any).__posStates as Array<{ position: number }>).slice(n0); return p.length ? p[p.length - 1].position : null; }, n0), { message: 'seekto 12 s: the card is told the new position', timeout: 5_000 }).toBeGreaterThan(11.9);
    await at('tune-ha', ra, 'seekto 12 s');
    await handler('nexttrack');
    await at('tune-hb', PSF, 'nexttrack to a Standard track');
    await handler('nexttrack');
    await at('tune-hc', rc, 'nexttrack into a tuned track');
    await handler('previoustrack');
    await at('tune-hb', PSF, 'previoustrack to a Standard track');
    await handler('previoustrack');
    await at('tune-ha', ra, 'previoustrack into a tuned track');
  });

  test('T-12. Fix round 1 (gaps): a tuned track restored at startup, then Play: its rate, the card too @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const lib = [keyed('tune-ra', 0, ZERO.r, ZERO.f, { duration: 30 }), keyed('tune-rb', 1, SHIFT.r, SHIFT.f, { duration: 30, tuneCents: -31, tuneFor: SHIFT.f })];
    await openWith(page, lib, { tone: toneWav(30, 330), current: 1 });
    await tuningHook(page);
    await expect.poll(async () => (await libraryState(page)).current, { message: 'the cursor restored on the tuned track', timeout: 20_000 }).toBe('tune-rb');
    expect((await libraryState(page)).playing).toBe(false);
    await transport(page, 'play');
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await expect.poll(() => musicRate(page), { message: 'Play: its rate', timeout: 10_000 }).toBe(tuneRate(-31));
    await expect.poll(() => lastPositionRate(page), { message: 'the card too', timeout: 10_000 }).toBe(tuneRate(-31));
    expect((await page.evaluate(() => (window as any).__plays as Array<{ rate: number }>))[0].rate, 'its first play() at its rate').toBe(tuneRate(-31));
  });

  test('T-3. A gapless swap into and out of a tuned track: each track plays at its own rate from its play(); no pause, no decode on the path @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    // (6 s tracks, so each advance leaves the card's poll room.)
    const lib = [keyed('tune-a', 0, ZERO.r, ZERO.f, { duration: 6 }), keyed('tune-b', 1, SHIFT.r, SHIFT.f, { duration: 6, tuneCents: -50, tuneFor: SHIFT.f }), keyed('tune-c', 2, NONE.r, NONE.f, { duration: 6 }), keyed('tune-d', 3, ZERO.r, ZERO.f, { duration: 6, tuneCents: 37, tuneFor: 2178 })];
    await openWith(page, lib, { tone: toneWav(6, 330) });
    await tuningHook(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-a').click();
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 20_000 }).toBe('tune-a');
    await expect.poll(() => lastPositionRate(page), { message: 'tune-a: the card at Standard', timeout: 5_000 }).toBe(PSF);
    const d0 = await page.evaluate(() => (window as any).__decodes);
    const p0 = await page.evaluate(() => (window as any).__pauseCount);
    // Fix round 2 (tests should-fix 4): the card after every gapless advance (the car's path: auto-advance is gapless)
    // says that track's rate.
    for (const [name, rate] of [['tune-b', tuneRate(-50)], ['tune-c', PSF], ['tune-d', tuneRate(37)]] as const) {
      await expect.poll(async () => (await libraryState(page)).current, { message: `the gapless advance to ${name}`, timeout: 15_000 }).toBe(name);
      await expect.poll(() => lastPositionRate(page), { message: `${name}: the card at its rate (${rate})`, timeout: 3_000 }).toBe(rate);
    }
    const plays: Array<{ src: string; rate: number }> = await page.evaluate(() => (window as any).__plays);
    const srcs = [...new Set(plays.map((p) => p.src))];
    const rateAtFirstPlay = srcs.map((s) => plays.find((p) => p.src === s)!.rate);
    expect(rateAtFirstPlay.slice(0, 4), 'each track\'s play() at its own rate: Standard, −50 c, Standard, +37 c').toEqual([PSF, tuneRate(-50), PSF, tuneRate(37)]);
    expect(await page.evaluate(() => (window as any).__decodes) - d0, 'no decode on the swaps').toBe(0);
    expect(await page.evaluate(() => (window as any).__pauseCount) - p0, 'no pause on the swaps').toBe(0);
    await expect.poll(() => musicRate(page)).toBe(tuneRate(37));
  });

  test('T-4. A reload keeps a tuning; garbage restores as Standard @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const lib = [
      keyed('tune-ok', 0, SHIFT.r, SHIFT.f, { tuneCents: -23, tuneFor: 852 }),
      keyed('tune-lo', 1, BOTH.r, BOTH.f, { tuneCents: 12, tuneFor: 174, tuneLoShu: true }),
      keyed('tune-g51', 2, SHIFT.r, SHIFT.f, { tuneCents: 51, tuneFor: 852 }),
      keyed('tune-g25', 3, SHIFT.r, SHIFT.f, { tuneCents: 2.5, tuneFor: 852 }),
      keyed('tune-g1000', 4, SHIFT.r, SHIFT.f, { tuneCents: 10, tuneFor: 1000 }),
      keyed('tune-gcents', 5, SHIFT.r, SHIFT.f, { tuneCents: 10 }),
      keyed('tune-gfor', 6, SHIFT.r, SHIFT.f, { tuneFor: 852 }),
      keyed('tune-glo', 7, SHIFT.r, SHIFT.f, { tuneCents: 9, tuneFor: 963, tuneLoShu: true }),
      keyed('tune-plain', 8, SHIFT.r, SHIFT.f),
    ];
    await openWith(page, lib);
    await tuningHook(page);
    const got = new Map((await tunings(page)).map((t) => [t.id, [t.tuneCents, t.tuneFor, t.tuneLoShu]]));
    expect(lib.map((s) => got.get(s.id)), 'restored: the valid ones kept, garbage as Standard').toEqual([
      [-23, 852, null], [12, 174, true], [null, null, null], [null, null, null], [null, null, null], [null, null, null], [null, null, null], [9, 963, null], [null, null, null],
    ]);
    expect(await page.evaluate((ids) => ids.map((id) => (window as any).__aetheriaTuning.trackRate(id)), lib.map((s) => s.id)), 'their rates').toEqual([tuneRate(-23), tuneRate(12), PSF, PSF, PSF, PSF, PSF, tuneRate(9), PSF]);
    // A tuning set now survives a reload.
    await page.evaluate((id) => (window as any).__aetheriaTuning.set(id, 44, 6336), lib[8].id);
    await expect.poll(() => storedTuning(page, lib[8].id), { timeout: 15_000 }).toEqual({ tuneCents: 44, tuneFor: 6336, tuneLoShu: null });
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(lib.length);
    await tuningHook(page);
    expect(await tuningOf(page, lib[8].id)).toEqual({ id: lib[8].id, tuneCents: 44, tuneFor: 6336, tuneLoShu: null });
    expect(await tuningOf(page, lib[0].id)).toEqual({ id: lib[0].id, tuneCents: -23, tuneFor: 852, tuneLoShu: null });
  });

  test('T-5. No tuning anywhere: PITCH_SHIFT_FACTOR on every play() and on the card; Assign gives v16.8.2\'s plan @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    const lib = Array.from({ length: 12 }, (_, i) => keyed(`tune-std-${String(i + 1).padStart(2, '0')}`, i, READS[i % READS.length], ALL_CRYSTALS[(i * 5) % 27]));
    await openWith(page, lib);
    await tuningHook(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-std-01').click();
    await expect.poll(async () => (await libraryState(page)).current, { message: 'two gapless advances', timeout: 30_000 }).toBe('tune-std-03');
    const plays: Array<{ rate: number }> = await page.evaluate(() => (window as any).__plays);
    expect(plays.length).toBeGreaterThanOrEqual(3);
    expect(plays.every((p) => p.rate === PSF), 'every play() at PITCH_SHIFT_FACTOR exactly').toBe(true);
    const positions: Array<number | null> = await page.evaluate(() => (window as any).__positions);
    expect(positions.filter((r) => r !== null).every((r) => r === PSF), 'the card\'s rate: PITCH_SHIFT_FACTOR').toBe(true);
    // Fix round 2 (app SF-1): the effect that re-sends a changed rate never sent: no card update that v16.8.2 didn't make.
    expect(await page.evaluate(() => (window as any).__aetheriaTuning.cardSends()), 'no tuning anywhere: SF-1\'s effect never sends').toBe(0);
    // Assign: v16.8.2's plan (Node's, with the keys' bands; no tuning, so v16.8.2's keys and bands).
    const c = new BandCache();
    c.ensureSync(lib as never);
    const plan: AssignPlan = planAssign(lib as never, 'spread', c.planOptions);
    const want = new Map(patchById(lib as never[], plan.patches as never).map((s: any) => [s.id, s.closestSolfeggio ?? null]));
    await assignByCard(page);
    await expect.poll(async () => { const s = await libraryState(page); return s.libraryIds.map((id, i) => s.crystals[i] === want.get(id)).every(Boolean); }, { message: 'every track where Node\'s plan puts it', timeout: 30_000 }).toBe(true);
  });

  test('T-6. fitShift in the page equals Node\'s on the committed fixture, at the 27 tones and the six Lo Shu ones (the device\'s JS maths); its cost @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    await openWith(page, [keyed('tune-x', 0, SHIFT.r, SHIFT.f)]);
    await tuningHook(page);
    const tones: number[] = [...ALL_CRYSTALS.map(solfeggioTone), ...LO_SHU_CRYSTALS.map((f) => loShuTone(f)!)];
    const node = FIX.reads.map((r) => tones.map((t) => fitShift(r.chroma, r.chromaA4Hz, t)));
    const inPage = await page.evaluate(({ reads, tones }) => {
      const h = (window as any).__aetheriaTuning;
      const t0 = performance.now();
      const out = reads.map((r: any) => tones.map((t: number) => h.fitShift(r.chroma, r.chromaA4Hz, t)));
      return { out, ms: performance.now() - t0, pageTones: [...Array(27).keys()].map((i) => h.solfeggioTone([174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336][i])) };
    }, { reads: FIX.reads, tones });
    expect(inPage.pageTones, 'the page\'s tones are Node\'s').toEqual(tones.slice(0, 27));
    expect(inPage.out, 'every case: the page\'s fitShift is Node\'s').toEqual(node);
    const n = FIX.reads.length * tones.length;
    test.info().annotations.push({ type: `T-6 fitShift in the page (${test.info().project.name})`, description: `${n} cases in ${inPage.ms.toFixed(0)} ms: ${(inPage.ms / n).toFixed(2)} ms each (Track info makes one or two per open)` });
  });

  test('T-8. More › Compose for a crystal: the picker, a crystal\'s options, the Lo Shu ones on the six; the Crystal sheet\'s link opens it on the crystal shown @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await openWith(page, [keyed('tune-g', 0, SHIFT.r, 963, { closestSolfeggio: 963, harmonicFreq: 963 })]);
    await page.setViewportSize(PHONE_VIEWPORT); // the phone's Now Playing chips (the desktop opens the sheet from its transport)
    await tab(page, 'more');
    await page.getByTestId('more-compose-row').click();
    const pageEl = page.getByTestId('more-compose');
    await expect(pageEl).toBeVisible();
    await expect(pageEl, 'from the row in More: the picker first (fix round 1, N7)').toHaveAttribute('data-layout', 'picker');
    await expect(page.getByTestId('compose-picker').getByRole('button')).toHaveCount(27);
    await expect(page.getByTestId('compose-group-gut').locator('h2')).toHaveText('GUT');
    await page.getByTestId('compose-crystal-963').click();
    await expect(page.getByTestId('compose-crystal-963')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('compose-options')).toContainText('Compose for 963 Hz');
    await expect(page.getByTestId('compose-lines').locator('li').first()).toHaveText('E · Set A4 to 436.5 Hz in your DAW · −14 cents');
    await expect(page.getByTestId('compose-loshu')).toHaveCount(0);
    await expect(page.getByTestId('compose-phone-note'), 'fix round 1 (S2): 963 sounds the same on every output').toHaveCount(0);
    await page.getByTestId('compose-crystal-2907').click();
    await expect(page.getByTestId('compose-lines').locator('li').first()).toHaveText('E, F♯, A, B, C♯m, F♯m, Bm · Leave A4 at 440 Hz in your DAW · 0 cents');
    await page.getByTestId('compose-crystal-174').click();
    await expect(page.getByTestId('compose-loshu')).toContainText('With Lo Shu Perfect GUT (75 Hz)');
    await expect(page.getByTestId('compose-loshu-lines').locator('li').first()).toHaveText('D♯ · Set A4 to 431.9 Hz in your DAW · −32 cents');
    // Fix round 1 (S2): the phone's own speaker plays 174 (348) and Lo Shu 75 (300) an octave up: one line under each set.
    const PHONE_NOTE = "Worked out for headphones, speakers and the car. The phone's own speaker plays this tone an octave up, where the fit can differ.";
    await expect(page.getByTestId('compose-phone-note')).toHaveText(PHONE_NOTE);
    await expect(page.getByTestId('compose-loshu-phone-note')).toHaveText(PHONE_NOTE);
    await page.getByTestId('compose-crystal-285').click();
    await expect(page.getByTestId('compose-phone-note'), '285 itself sounds the same on the phone').toHaveCount(0);
    await expect(page.getByTestId('compose-loshu-phone-note'), 'its Lo Shu 186 does not (372)').toHaveText(PHONE_NOTE);
    await page.getByTestId('compose-crystal-174').click();
    await expect(page.getByTestId('compose-note')).toHaveText('Aetheria plays it at 432/440 of its speed. Leave Tuning on Standard for a track you tuned in your DAW.');
    await expect(page.getByTestId('compose-evidence')).toContainText('Design choice');
    // The Crystal sheet's link, on the crystal it shows (the playing track's, 963).
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-g').click();
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 20_000 }).toBe('tune-g');
    await tab(page, 'now');
    await page.getByTestId('chip-crystal').click();
    await page.getByTestId('crystal-compose-link').click();
    await expect(page.getByTestId('more-compose')).toBeVisible();
    await expect(page.getByTestId('compose-options')).toHaveAttribute('data-crystal', '963');
    await expect(page.getByTestId('compose-crystal-963')).toHaveAttribute('aria-pressed', 'true');
    // Fix round 1 (N7): opened for a crystal, its options first; the picker after them, under "Another crystal".
    await expect(page.getByTestId('more-compose')).toHaveAttribute('data-layout', 'crystal');
    await expect(page.getByTestId('compose-another').locator('h2')).toHaveText('Another crystal');
    expect((await page.getByTestId('compose-options').boundingBox())!.y, 'the options above the picker').toBeLessThan((await page.getByTestId('compose-picker').boundingBox())!.y);
    // A pick there shows that crystal's options (above), in view. Fix round 2 (tests nit 2): their top within the first
    // screen, as T-8b checks (any part in view would pass with the options scrolled away above).
    await page.getByTestId('compose-crystal-2907').click();
    await expect(page.getByTestId('compose-options')).toHaveAttribute('data-crystal', '2907');
    await expect.poll(async () => { const b = await page.getByTestId('compose-options').boundingBox(); return !!b && b.y >= 0 && b.y < PHONE_VIEWPORT.height; }, { message: 'the options\' top is brought into the first screen' }).toBe(true);
  });

  test('T-8c. Fix round 2 (tests nit 1, N7): the desktop panel: Compose showing (picker first), the transport\'s Crystal and its link: that crystal\'s options first; and a page already showing answers an ask at once @mobile', async ({ page }) => {
    test.skip(ON_DEVICE, 'the desktop shell (a device keeps its own viewport)');
    test.setTimeout(150_000);
    await openWith(page, [keyed('tune-gd', 0, SHIFT.r, 963, { closestSolfeggio: 963, harmonicFreq: 963 })]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-gd').click();
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 20_000 }).toBe('tune-gd');
    await tab(page, 'more');
    await page.getByTestId('more-compose-row').click();
    const compose = page.getByTestId('more-compose');
    await expect(compose, 'from More\'s row: the picker first').toHaveAttribute('data-layout', 'picker');
    // The Crystal sheet from the desktop transport, over the page that stays mounted; its link.
    await page.getByTestId('desktop-crystal').click();
    await page.getByTestId('crystal-compose-link').click();
    await expect(compose, 'the link: options first').toHaveAttribute('data-layout', 'crystal');
    await expect(page.getByTestId('compose-options')).toHaveAttribute('data-crystal', '963');
    await expect(page.getByTestId('compose-another').locator('h2')).toHaveText('Another crystal');
    // A page already showing when the ask comes answers it at once (moreModel's onComposeCrystal, ComposePage's listener:
    // options first). No screen reaches it today: on the desktop the Crystal sheet takes the panel, so Compose mounts
    // afresh after the link (and reads the ask as it mounts, above), and on the phone the sheet opens only from Now
    // Playing. So the ask is made directly, through the app's own module, with More's Compose showing picker-first.
    await tab(page, 'now');
    await tab(page, 'more');
    await expect(compose, 'More again: the picker first').toHaveAttribute('data-layout', 'picker');
    await page.evaluate(async () => { const m = await import('/components/shell/more/moreModel.ts'); m.requestComposeCrystal(2907); });
    await expect(compose, 'the mounted page answers the ask: options first').toHaveAttribute('data-layout', 'crystal');
    await expect(page.getByTestId('compose-options')).toHaveAttribute('data-crystal', '2907');
  });

  test('T-8b. Fix round 1: the Crystal sheet\'s link on a Lo Shu tone (75 Hz, Perfect GUT on: CP02) opens Compose on its crystal, whose options, the Lo Shu block included, start within the first screen at 411×752 (N7) @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await openWith(page, [keyed('tune-g174', 0, SHIFT.r, 174, { closestSolfeggio: 174, harmonicFreq: 174 })], { perfectGut: true });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tune-g174').click();
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 20_000 }).toBe('tune-g174');
    await tab(page, 'now');
    await expect(page.getByTestId('chip-crystal'), 'Perfect GUT on: the layers play 75 Hz').toContainText('75');
    await page.getByTestId('chip-crystal').click();
    await expect(page.getByTestId('crystal-compose-link'), 'CP02: the link shows on a Lo Shu tone').toBeVisible();
    await page.getByTestId('crystal-compose-link').click();
    await expect(page.getByTestId('more-compose')).toBeVisible();
    await expect(page.getByTestId('compose-options'), 'CP02: on the crystal 75 Hz stands for').toHaveAttribute('data-crystal', '174');
    await expect(page.getByTestId('more-compose')).toHaveAttribute('data-layout', 'crystal');
    const h = PHONE_VIEWPORT.height;
    for (const id of ['compose-options', 'compose-lines', 'compose-loshu', 'compose-loshu-lines']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.y >= 0 && b.y < h, `N7: ${id} starts within the first screen (top ${b.y.toFixed(0)} of ${h})`).toBe(true);
    }
    // Fix round 2 (tests nit 2): a pick far down the picker scrolls the page to it; the options (above) are brought back
    // into view. (At 411×600 the click on 6336 scrolls 174's long options above the screen: measured top −170 without
    // the scroll, 56 with it; at 752 px, or from 963's short options, no pick scrolls far enough to show it.)
    await page.setViewportSize({ width: PHONE_VIEWPORT.width, height: 600 });
    await page.getByTestId('compose-crystal-6336').click();
    await expect(page.getByTestId('compose-options')).toHaveAttribute('data-crystal', '6336');
    await expect.poll(async () => { const b = await page.getByTestId('compose-options').boundingBox(); return b ? Math.round(b.y) : null; }, { message: 'the options\' top is brought back into the first screen' }).toBeGreaterThanOrEqual(0);
    const b6336 = (await page.getByTestId('compose-options').boundingBox())!;
    expect(b6336.y < 600, `and within it (top ${b6336.y.toFixed(0)})`).toBe(true);
  });

  test('T-10. Assign after a retune: the D8 line says Assign would move tracks, and the plan applied is Node\'s (and the oracle\'s) with the tuning @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    // 36 keyed tracks, already where Node's plan puts them (Assign has nothing to move); then a Track info Fit on one
    // that moves tracks under M1.
    const base0 = Array.from({ length: 36 }, (_, i) => keyed(`tune-as-${String(i + 1).padStart(2, '0')}`, i, READS[(i * 7) % READS.length], ALL_CRYSTALS[i % 27]));
    const planOf = (l: any[]) => { const c = new BandCache(); c.ensureSync(l as never); return planAssign(l as never, 'spread', c.planOptions); };
    const base = patchById(base0 as never[], planOf(base0).patches as never) as any[];
    expect(crystalMoves(planOf(base)), 'Node: placed, nothing to move').toBe(0);
    let pick = -1, cents = 0, moves = 0;
    for (let i = 0; i < base.length && pick < 0; i++) {
      const s = offeredShift(base[i].chroma, base[i].chromaA4Hz, solfeggioTone(base[i].closestSolfeggio));
      if (!s) continue;
      const m = crystalMoves(planOf(base.map((x, k) => (k === i ? { ...x, tuneCents: s, tuneFor: x.closestSolfeggio } : x))));
      if (m > 0) { pick = i; cents = s; moves = m; }
    }
    expect(pick, 'Node: a track whose Fit moves tracks').toBeGreaterThanOrEqual(0);
    const tuned = base.map((x, k) => (k === pick ? { ...x, tuneCents: cents, tuneFor: x.closestSolfeggio } : x));
    const plan = planOf(tuned);
    const want = new Map(patchById(tuned as never[], plan.patches as never).map((s: any) => [s.id, s.closestSolfeggio ?? null]));
    const o = spreadOracle(tuned as never);
    expect(tuned.map((s) => want.get(s.id)), 'Node\'s plan is the oracle\'s').toEqual(tuned.map((s) => o.after.get(s.id)![0]));
    await openWith(page, base);
    await tuningHook(page);
    await openLibraryTab(page);
    await openInfo(page, base[pick].name);
    await trackInfo(page).getByTestId('track-info-tuning').locator('select').selectOption({ label: `Fit ${base[pick].closestSolfeggio} Hz · ${tuneLabel(cents)}` });
    await expect.poll(async () => (await tuningOf(page, base[pick].id))?.tuneCents).toBe(cents);
    await closeInfo(page);
    await openHealth(page);
    await expect(page.getByTestId('health-crystals-line'), 'the D8 line').toContainText(`Assign would move ${moves} of them`, { timeout: 30_000 });
    await assignByCard(page);
    await expect.poll(async () => { const s = await libraryState(page); return s.libraryIds.filter((id, i) => s.crystals[i] !== want.get(id)).length; }, { message: 'every track where Node\'s plan with the tuning puts it', timeout: 30_000 }).toBe(0);
    expect((await tuningOf(page, base[pick].id))?.tuneCents, 'Assign kept the tuning').toBe(cents);
  });
});

test.describe('v16.8.3, Export with layers at the tuning', () => {
  test.use({ layoutSeed: 'new' });

  test('T-9. A tuned track renders at its rate: its own file\'s length, and a long file with it between two Standard ones: the sum of each at its rate, joined; the long file plays to its end', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'the desktop renders it (the phone run has its own export tests)');
    test.setTimeout(240_000);
    await openSeededNewLayout(page, 3, { real: 3, seconds: 6, playlists: [{ id: 'pltuned1', name: 'Tuned', indexes: [0, 1, 2] }] });
    await tuningHook(page);
    // (The saved playlists are read after the library: wait for this one's row.)
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    await expect(page.locator('[data-testid="playlist-row"][data-playlist-id="pltuned1"]')).toBeVisible({ timeout: 20_000 });
    const ids = (await libraryState(page)).libraryIds;
    await page.evaluate((id) => (window as any).__aetheriaTuning.set(id, -50, 285), ids[1]);
    await expect.poll(async () => (await tuningOf(page, ids[1]))?.tuneCents).toBe(-50);
    await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.render === 'function', null, { timeout: 10_000 });
    const r = tuneRate(-50);
    // One file per track: each at its own rate.
    const each = await page.evaluate(() => (window as any).__aetheriaExport.render('', { playlistId: 'pltuned1', files: 'each', snap: { phiOn: false } }));
    expect(each.outcome).toBe('done');
    expect(each.rates, 'the items\' rates').toEqual([PSF, r, PSF]);
    const frames = each.files.map((f: any) => f.frames);
    const want = [PSF, r, PSF].map((x) => Math.round((6 * 48_000) / x));
    for (let k = 0; k < 3; k++) expect(Math.abs(frames[k] - want[k]), `track ${k + 1}'s file: ${frames[k]} frames, 6 s at its rate (${want[k]})`).toBeLessThanOrEqual(2);
    // One long file: the sum, each at its rate.
    const long = await page.evaluate(() => (window as any).__aetheriaExport.render('', { playlistId: 'pltuned1', files: 'long', keepBlob: true, snap: { phiOn: false } }));
    expect(long.outcome).toBe('done');
    const sum = want.reduce((a, b) => a + b, 0);
    expect(Math.abs(long.files[0].frames - sum), `the long file: ${long.files[0].frames} frames, the sum at each rate (${sum})`).toBeLessThanOrEqual(6);
    expect(long.files[0].joins.length).toBe(2);
    expect(Math.abs(long.files[0].joins[1] - long.files[0].joins[0] - want[1]), 'the tuned track spans its own length').toBeLessThanOrEqual(3);
    // Fix round 1 (X05): the layers follow each track's own length. The three crystals differ, so the layers' plan changes
    // its tone at each track: each change (the plan's track starts, in frames) sits on its join, the tuned track's
    // included (planned at Standard, its layers would end 2.9 % early: 0.18 s here), and the plan ends with the music.
    // (Within 10 ms: the plan reads each track's established length, the joins its decoded frames; a few ms apart at
    // Standard too, as since v16.5. An audio check of the tone's change can't resolve 0.18 s: the retune's fade-in starts
    // 1.6 to 2.6 s after a join, and 174 Hz beats at 2 Hz with its carrier.)
    const crystals = (await libraryState(page)).crystals.slice(0, 3) as number[];
    expect(new Set(crystals).size, `three distinct crystals (${crystals.join(', ')})`).toBe(3);
    const ls: number[] = long.files[0].layerStarts;
    expect(ls.length, 'the layers\' plan: three tracks').toBe(3);
    for (let k = 0; k < 2; k++) expect(Math.abs(ls[k + 1] - long.files[0].joins[k]), `the layers change tone at join ${k + 1} (plan ${ls[k + 1]}, join ${long.files[0].joins[k]})`).toBeLessThanOrEqual(480);
    expect(Math.abs(long.files[0].layerEnd - long.files[0].frames), `the layers' plan ends with the music (${long.files[0].layerEnd} of ${long.files[0].frames})`).toBeLessThanOrEqual(480);
    test.info().annotations.push({ type: 'T-9 the layer plan against the music (frames)', description: `starts ${ls.join(', ')}; joins ${long.files[0].joins.join(', ')}; end ${long.files[0].layerEnd} of ${long.files[0].frames}` });
    // It plays to its end.
    const played = await page.evaluate(async () => {
      const blob = (window as any).__exportBlobs[0] as Blob;
      const a = new Audio(URL.createObjectURL(blob));
      await new Promise((res, rej) => { a.onloadedmetadata = res; a.onerror = () => rej(new Error('no metadata')); });
      const duration = a.duration;
      a.volume = 0;
      a.currentTime = Math.max(0, duration - 0.4);
      const ended = new Promise<boolean>((res) => { a.onended = () => res(true); setTimeout(() => res(false), 8000); });
      await a.play();
      return { duration, ended: await ended };
    });
    expect(Math.abs(played.duration - sum / 48_000), `its duration (${played.duration.toFixed(3)} s)`).toBeLessThan(0.05);
    expect(played.ended, 'it plays to its end').toBe(true);
  });
});
