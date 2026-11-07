// utils/mix/distribution.ts (v15.8): Assign crystals (classic: Auto-Distribute), pure and deterministic.
//
//   crystalOrigin(s)       where a track's crystal comes from, from what Deep Scan and Assign store
//   needsDeepScan(s)       not measured by Deep Scan (an assigned crystal is not a scan)
//   deepScanQueue(lib, o)  Deep Scan's queue: by default the tracks with no measurement and no assigned crystal (v15.7's
//                          scope); with { assigned: true } the assigned ones too, after them
//   scanCrystalOf(f)       Deep Scan's crystal for a measured frequency (getHarmonicSolfeggio, quietly, memoized)
//   scanCrystalChanged(s)  an older Auto-Distribute put another crystal on a scanned track (Assign puts it back)
//   planAssign(lib)        the patches Assign applies by id, and the counts its dialog and notice show
//   assign…Text(plan)      the confirmation, the notice after it, and the toast when there is nothing to do
//   v16.8 (decision 6):    planAssign(lib, 'spread' | 'restore'), assignChoice(lib) (whether Assign asks first) and
//                          assignChoiceText(choice) (the question's words), spreadFromScan / spreadAway (see below)
//   v16.7.1 (hotfix):      the spread taken from v16.8 alone: Auto-Distribute (classic) and Assign crystals (the new
//                          layout) run planAssign(lib, 'spread') on every press (App.tsx autoDistribute), so a scanned
//                          library spreads over all 27 crystals again. 'keep' (the rule below) is unchanged, byte for
//                          byte (check-mix-golden); assignChoice / assignChoiceText and 'restore' are not used by the app
//                          in v16.7.1 (spread.check keeps them checked for v16.8).
//   v16.7.3 (Source):      a spread keeps every track Deep Scan read at 2178 Hz (sourceTrack: the Source crystal) on 2178,
//                          recorded as the scan's (the user's decision 2026-11-04); one v16.7.1's spread moved away goes
//                          back. Everything else spreads as in v16.7.1: a library with no such track gets v16.7.1's plan
//                          exactly (source.check, against a frozen copy in scripts/mix-golden/spread-v1671.ts).
//   v16.8.1 (devices):     the same files give the same crystals on every device (decisions D2, D3, D3b): the spread
//                          breaks its ties by the file (fileKey: name and size, the playlists' fingerprint), not by the
//                          per-device id; 2178 gets a full share of the other tracks on top of its Source tracks (they no
//                          longer count toward its share), and a library too small to give every crystal one fills the
//                          empty crystals first (devices.check, source.check). needsRescan / rescanQueue (D4): the tracks
//                          Deep Scan read before it read at DEEP_SCAN_RATE.
//   v16.8.2 (key placement): planAssign(lib, 'spread', { bands }) compares a track's key band on each crystal (how its
//                          measured key fits the crystal's tone: utils/mix/keyBands.ts) before Deep Scan's compatibility,
//                          so a track with a clear key goes first to the crystals whose tone fits it, and the reading only
//                          breaks ties (decisions U1, K1, K2). A track without bands has NEUTRAL_BAND on every crystal, so a
//                          library with no clear-key track gets v16.8.1's plan, patch for patch (devices.check, against a
//                          frozen copy in scripts/mix-golden/spread-v1681.ts). Keep and 'restore' never read the bands.
//
// What Assign does (decisions 2026-10-26, 5 and 6 after the review): Deep Scan's crystals stay, and one an older
// Auto-Distribute replaced is put back from the track's own stored measurement. A crystal Assign placed before (recorded
// crystalSource 'assigned') is an anchor: it stays, like a scan's. Assign places only the tracks with no crystal, failed
// scans, and the placeholders an older Auto-Distribute left (no recorded origin: placed once, then recorded), empty
// crystals first, by the old name and length heuristic. No Math.random: each track's estimate draws from a generator
// seeded by a hash of its id, so the same library and recorded origins always get the same result, in any order, and a
// second press changes nothing; an import places only the new tracks, and a delete moves no one. A placed track stays
// "not scanned" (crystalSource 'assigned'), so Deep Scan can still analyse it; its harmonicFreq is set to its crystal, the
// marker playTrack reads to play it without decoding the whole file first.

import { getHarmonicSolfeggio, GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS, SOURCE_FREQ } from '../crystalData.ts';

export type CrystalSource = 'scan' | 'assigned';
/** What the origin rule reads of a track (types.ts Song, or the Library tab's LibSong). */
export interface CrystalFields {
  harmonicFreq?: number;
  closestSolfeggio?: number;
  harmonicDeviation?: number;
  fractalAnalysis?: unknown;
  isAetheriaCandidate?: boolean;
  crystalSource?: CrystalSource;
  /** v16.8.1 (D1): the rate Deep Scan decoded at (DEEP_SCAN_RATE); absent on readings made before v16.8.1. */
  scanRate?: number;
}
/** What Assign reads: the crystal fields, the id (its seed and tiebreak), the name and the length (the stand-in).
 *  v16.8.1 (D2): and the file's name and size, the spread's tie-break key (fileKey); a Song's File has both. */
export interface AssignSong extends CrystalFields { id: string; name: string; duration?: number; file?: { readonly name?: string; readonly size?: number } }
/** What Assign writes: the four crystal fields, nothing else. */
export interface CrystalPatch { closestSolfeggio?: number; harmonicFreq?: number; harmonicDeviation?: number; crystalSource?: CrystalSource }
export type CrystalOrigin = 'scan' | 'scan-replaced' | 'scan-failed' | 'assigned' | 'none';

export const ALL_CRYSTALS: readonly number[] = [...GUT_CRYSTALS, ...HEART_CRYSTALS, ...HEAD_CRYSTALS];
const CRYSTAL_INDEX = new Map<number, number>(ALL_CRYSTALS.map((f, i) => [f, i]));

/** v16.8.2: the key rank the spread compares on each crystal before the score (the one place the rule is stated).
 *  A crystal takes, in this order:
 *   - a track whose key fits it (band 0);
 *   - (fix round 2, R1) a track whose key fits no crystal at all, on the crystals where its band is its own best one
 *     (FIT_NOWHERE_BAND, 0.25): so such a track still gets the crystals it suits best before the tracks with no key,
 *     and never ahead of a track that fits there;
 *   - a track with no key, no clear key or no bands (NEUTRAL_BAND, 0.5, on every crystal; fix round 1, L-S1: while
 *     keys are still arriving, a keyed track is never placed on a crystal it only partly fits ahead of a no-key track
 *     while a fitting crystal still has room);
 *   - a keyed track that only partly fits there (its band, 1, 2 or 3), on every other crystal.
 *  Each rank depends on the track alone (its own bands), so the same files rank the same on every device. The bands
 *  are integers 0-3, so any NEUTRAL_BAND in (0, 1) and any FIT_NOWHERE_BAND in (0, NEUTRAL_BAND) give the same plans.
 *  With NEUTRAL_BAND on every track the spread is v16.8.1's exactly (every track ties). (keyBands.ts re-exports it.) */
export const NEUTRAL_BAND = 0.5;
/** v16.8.2 fix round 2 (R1): see NEUTRAL_BAND. */
export const FIT_NOWHERE_BAND = 0.25;
/** A clear-key track's 27 ranks from its 27 bands (NEUTRAL_BAND's rule): its bands as they are when some crystal fits
 *  it (band 0); otherwise FIT_NOWHERE_BAND on the crystals with its lowest band, its band on the rest. What
 *  AssignOptions.bands gives (keyBands.ts BandCache.planOptions); the spread compares the values it is given, so a rank
 *  of 0 is exactly a band of 0 (keyFits) and a provider can still give other values (the checks' emulations). */
export function keyRanks(bands: ArrayLike<number>): ArrayLike<number> {
  let low = Infinity;
  for (let i = 0; i < bands.length; i++) if (bands[i] < low) low = bands[i];
  if (low === 0) return bands;
  return Array.from(bands, (b) => (b === low ? FIT_NOWHERE_BAND : b));
}
/** v16.8.2 (fix round 1, B1): the tracks of `library` (each id once) that a spread places (spreadRole 'open': never a
 *  Source track, nor an unreadable scan that stays) and that `awaiting` says could still get a clear key. The plan's
 *  awaitingKey and the health card's Crystals sub-line both count with it, so the two numbers always agree. */
export function awaitingKeyCount(library: readonly AssignSong[], awaiting: (s: AssignSong) => boolean): number {
  const seen = new Set<string>();
  let n = 0;
  for (const s of library) {
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    if (spreadRole(s).role === 'open' && awaiting(s)) n++;
  }
  return n;
}
/** v16.8.2: what a spread may also read. Every caller in the app passes the same one, App's BandCache's
 *  (keyBands.ts BandCache.planOptions): bands for a clear-key track whose bands are cached (callers never plan while
 *  some are missing). Keep and 'restore' ignore it. */
export interface AssignOptions {
  /** A track's 27 key bands in ALL_CRYSTALS order (0 fits .. 3 clashes), or null: NEUTRAL_BAND on every crystal. */
  bands?: (s: AssignSong) => ArrayLike<number> | null;
  /** A track that could get a clear key from Analyse tracks but hasn't yet (keyBands.ts awaitingKey): the plan's
   *  awaitingKey counts them over the whole library. */
  awaiting?: (s: AssignSong) => boolean;
}
const SCAN_FAILED_DEVIATION = 999; // Deep Scan's "couldn't read" fallback: 440 Hz / 528 / 999

/**
 * v16.7.3 (F7, the user's decision 2026-11-04): the highest fit score Assign STORES in harmonicDeviation. Its scores
 * reach 2994 (a stand-in matched to 6336, placed on 174), and from SPREAD_MARK (1000) a stored score read as "a scan a
 * spread placed"; 999 exactly reads as Deep Scan's "couldn't read" (crystalOrigin). So the stored value is capped just
 * under both: 998. Only the stored value: the fill and the balance still rank by the full score, so no placement moves.
 * The mixes that rank by harmonicDeviation (lower first, a missing one as 999) still rank such a track after every
 * closer fit.
 */
export const ASSIGN_SCORE_CAP = 998;
const storedScore = (score: number) => Math.min(score, ASSIGN_SCORE_CAP);

/** Deep Scan stores harmonicDeviation = |harmonicFreq − closestSolfeggio|; the old Auto-Distribute stored its own score. */
function scanRelation(s: CrystalFields): boolean {
  const f = s.harmonicFreq, c = s.closestSolfeggio, d = s.harmonicDeviation;
  if (!Number.isFinite(f) || !Number.isFinite(c) || !Number.isFinite(d)) return false;
  return Math.abs((d as number) - Math.abs((f as number) - (c as number))) < 1e-6;
}

/**
 * Where the crystal comes from.
 *  - From v15.8 it is recorded (crystalSource), written by Deep Scan ('scan') and Assign ('assigned').
 *  - Before v15.8 (no crystalSource) it is derived: a successful Deep Scan always stored isAetheriaCandidate (a
 *    boolean, since v9.5) and fractalAnalysis (an object, or null when the fractal step failed, since v4.2); the
 *    library has been stored only since v12.7, and nothing else writes either field. Its crystal is still Deep Scan's
 *    while the deviation relation holds; the old Auto-Distribute broke it when it reassigned the crystal.
 */
export function crystalOrigin(s: CrystalFields): CrystalOrigin {
  if (s.crystalSource === 'assigned') return 'assigned';
  if (s.crystalSource === 'scan') return s.harmonicDeviation === SCAN_FAILED_DEVIATION ? 'scan-failed' : 'scan';
  // (A scan always stored its harmonicFreq; without one there is no measurement to keep or put back.)
  if ((typeof s.isAetheriaCandidate === 'boolean' || s.fractalAnalysis !== undefined) && Number.isFinite(s.harmonicFreq)) {
    return scanRelation(s) ? 'scan' : 'scan-replaced';
  }
  if (s.harmonicDeviation === SCAN_FAILED_DEVIATION) return 'scan-failed';
  return s.closestSolfeggio ? 'assigned' : 'none';
}

/** Not measured by Deep Scan: never scanned, or only assigned. A failed scan is not retried unless Assign has since
 *  placed it (it is then 'assigned'). */
export function needsDeepScan(s: CrystalFields): boolean {
  if (!s.harmonicFreq) return true;
  // v16.8: a spread scanned track is Assign's, but Deep Scan has read it (its harmonicFreq is the reading): not again.
  if (spreadFromScan(s)) return false;
  const o = crystalOrigin(s);
  return o === 'assigned' || o === 'none';
}

/**
 * Deep Scan's queue, in library order (decision 6). By default the unscanned tracks with no crystal, or no harmonicFreq
 * (v15.7's scope: a new import is scanned, an assigned crystal is left alone); the scan then stops. With
 * { assigned: true } (the health card's explicit "Also scan the N assigned tracks") the assigned ones (a crystal and its
 * playback-ready harmonicFreq, never measured) follow them in the same pass.
 */
export function deepScanQueue<T extends CrystalFields>(library: readonly T[], o: { assigned?: boolean } = {}): T[] {
  const first = library.filter(inDeepScanScope);
  if (o.assigned !== true) return first;
  return [...first, ...library.filter((s) => needsDeepScan(s) && !!s.harmonicFreq && !!s.closestSolfeggio)];
}
/** Deep Scan's default scope (its plain "Scan"): not measured, and no harmonicFreq or no crystal. */
function inDeepScanScope(s: CrystalFields): boolean {
  return needsDeepScan(s) && (!s.harmonicFreq || !s.closestSolfeggio);
}

/**
 * v16.8.1 (D1): the one rate Deep Scan decodes at, on every device. It used to decode through the playback context, at
 * the device's own rate, and the reading depends on it: the same 24 test files read at 44.1 kHz instead of 48 changed
 * the crystal of 21 (a sample more or less, or another decoder, changed none). 48 kHz rather than 44.1 because PCs'
 * outputs and Android phones already play at 48 kHz, so the readings made there stay as they are. A successful scan
 * records it on the track (scanRate).
 */
export const DEEP_SCAN_RATE = 48000;

/** v16.8.1 (D4): an older reading: Deep Scan read the track (readByDeepScan: a real measurement, never the failed scan's
 *  placeholder) before v16.8.1, at whatever rate the device played (no scanRate). Scan again reads it once more.
 *  Fix round 1 (rev-logic 4e): never one the plain Deep Scan already lists (an unreadable scan, 0 Hz: in its scope, it
 *  is counted once, on the Deep Scan row). */
export function needsRescan(s: CrystalFields): boolean {
  return readByDeepScan(s) && typeof s.scanRate !== 'number' && !inDeepScanScope(s);
}
/** v16.8.1 (D4): Scan again's queue, in library order: every track with an older reading, but those Scan again
 *  couldn't read in this session (`skip`, by id: fix round 1; offered again after a reload). */
export function rescanQueue<T extends CrystalFields & { id?: string }>(library: readonly T[], skip?: ReadonlySet<string>): T[] {
  return library.filter((s) => needsRescan(s) && !(skip && s.id !== undefined && skip.has(s.id)));
}
/**
 * v16.8.1 (D4): where a track Scan again read anew (at `hf`, already the heard frequency, as Deep Scan stores it) sits,
 * and its reading. One on its old scan crystal (Deep Scan's record: a Source track on 2178 included) moves to the new
 * reading's crystal, the scan's. One Assign moved keeps its crystal: a spread track (the reading kept, the mark) gets its
 * mark against the new reading (SPREAD_MARK + |hf − crystal|, so it is still a spread track); a legacy scan an older
 * Auto-Distribute moved keeps its record. So the next Assign spreads every track by its new reading, and a track that
 * now reads 2178 is a Source track (the health card offers to put it back).
 */
export function rescanPatch(s: CrystalFields, hf: number): CrystalPatch {
  if (spreadFromScan(s)) return { harmonicFreq: hf, harmonicDeviation: SPREAD_MARK + Math.abs(hf - (s.closestSolfeggio as number)) };
  if (crystalOrigin(s) === 'scan-replaced') return { harmonicFreq: hf };
  const c = scanCrystalOf(hf);
  return { harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: Math.abs(hf - c), crystalSource: 'scan' };
}
/** v16.8.1 fix round 2: what one Scan again read gives a track (App's scanLibrary applies it by id). Fix round 3
 *  (revR2-logic N3): generic in the three results' types (App's: FractalAnalysisResult, IntervalAnalysisResult and
 *  BandEnvelope), so the patch comes back typed and App's applyResult checks it against Song. */
export interface RescanRead<F = unknown, I = unknown, E = unknown> {
  /** The new reading (the heard frequency, as Deep Scan stores it). */
  hf: number;
  /** The fractal step's result; null when it fell back to the basic detector (as a first Deep Scan writes it). */
  fractal: F | null;
  /** The interval step's result (undefined for fewer than 2 peaks), and whether that step threw. */
  intervals: I | undefined;
  intervalsThrew: boolean;
  /** The band envelope; undefined when it couldn't be made. */
  envelope: E | undefined;
  isAetheriaCandidate: boolean;
}
/** v16.8.1 fix round 3: the fields rescanReadPatch writes (an older interval result or envelope kept: absent). */
export interface RescanReadPatch<F = unknown, I = unknown, E = unknown> extends CrystalPatch {
  fractalAnalysis: F | null;
  intervalAnalysis?: I;
  bandEnvelope?: E;
  isAetheriaCandidate: boolean;
  scanRate: number;
}
/**
 * v16.8.1 fix round 2: the patch a successful Scan again read writes, one rule (rev-logic 3 and 7 of fix round 1):
 *  - where the track sits and its reading (rescanPatch), its rate (DEEP_SCAN_RATE) and isAetheriaCandidate;
 *  - fractalAnalysis as a first Deep Scan writes it, null on the fallback, so both devices hold the same record for the
 *    same file whichever read it last;
 *  - the interval data as a first scan writes it (none for fewer than 2 peaks), but the older data kept when the step
 *    threw;
 *  - the envelope when one was made; the older one kept otherwise.
 */
export function rescanReadPatch<F, I, E>(s: CrystalFields, r: RescanRead<F, I, E>): RescanReadPatch<F, I, E> {
  return {
    ...rescanPatch(s, r.hf),
    fractalAnalysis: r.fractal,
    ...(r.intervalsThrew ? {} : { intervalAnalysis: r.intervals }),
    ...(r.envelope !== undefined ? { bandEnvelope: r.envelope } : {}),
    isAetheriaCandidate: r.isAetheriaCandidate,
    scanRate: DEEP_SCAN_RATE,
  };
}

const scanCrystalMemo = new Map<number, number>();
/** Deep Scan's crystal for a measured frequency: getHarmonicSolfeggio's answer, without its console logging (the health
 *  card asks on every library change), memoized by frequency. */
export function scanCrystalOf(f: number): number {
  let c = scanCrystalMemo.get(f);
  if (c === undefined) {
    const log = console.log;
    console.log = () => {};
    try { c = getHarmonicSolfeggio(f); } finally { console.log = log; }
    scanCrystalMemo.set(f, c);
  }
  return c;
}

/** A scanned track whose crystal an older Auto-Distribute changed: its crystal differs from Deep Scan's own for its
 *  measurement (Assign puts it back). One the old Auto-Distribute merely re-stored (its own score as the deviation, the
 *  scan's crystal kept) is not: it already shows Deep Scan's crystal. */
export function scanCrystalChanged(s: CrystalFields): boolean {
  return crystalOrigin(s) === 'scan-replaced' && scanCrystalOf(s.harmonicFreq as number) !== s.closestSolfeggio;
}

// ---- the deterministic stand-in ----------------------------------------------------------------------------------
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** v16.8.1 (D2): the track's file, as the saved playlists fingerprint it (utils/playlists/model.ts fpKey: `name|size`),
 *  the same on every device that holds the file (the id is made at import, per device). A track with no file (the
 *  checks' fixtures) falls back to its id. */
export function fileKey(s: AssignSong): string {
  const f = s.file;
  return f && typeof f.name === 'string' && typeof f.size === 'number' ? `${f.name}|${f.size}` : s.id;
}
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The old heuristic (file name and length), verbatim but for its draws: from the id's own generator. */
export function standInFreq(song: AssignSong): number {
  const rnd = seeded(fnv1a(song.id));
  let detectedFreq: number;
  const fileName = song.name.toLowerCase();
  const duration = song.duration || 180;
  if (fileName.includes('bass') || fileName.includes('low') || fileName.includes('sub')) detectedFreq = 60 + rnd() * 140;
  else if (fileName.includes('vocal') || fileName.includes('voice') || fileName.includes('sing')) detectedFreq = 220 + rnd() * 660;
  else if (fileName.includes('guitar') || fileName.includes('string')) detectedFreq = 82 + rnd() * 350;
  else if (fileName.includes('piano') || fileName.includes('key')) detectedFreq = 131 + rnd() * 400;
  else if (fileName.includes('drum') || fileName.includes('kick') || fileName.includes('snare')) detectedFreq = 50 + rnd() * 200;
  else if (fileName.includes('lead') || fileName.includes('melody')) detectedFreq = 262 + rnd() * 700;
  else if (fileName.includes('pad') || fileName.includes('atmosphere') || fileName.includes('ambient')) detectedFreq = 100 + rnd() * 600;
  else if (fileName.includes('high') || fileName.includes('treble') || fileName.includes('cymbal') || fileName.includes('hi-hat')) detectedFreq = 1000 + rnd() * 4000;
  else {
    const musicalFrequencies = [110, 146.83, 196, 220, 261.63, 293.66, 329.63, 369.99, 440, 523.25, 587.33, 659.25, 783.99];
    const baseFreq = musicalFrequencies[Math.floor(rnd() * musicalFrequencies.length)];
    detectedFreq = baseFreq * (0.9 + rnd() * 0.2);
  }
  if (duration > 300) detectedFreq *= 0.8;
  else if (duration < 120) detectedFreq *= 1.2;
  return detectedFreq;
}
/** The old compatibility score of a stand-in against one crystal (lower is better), verbatim. */
function compatibility(bestMatch: number, freq: number): number {
  let harmonicScore = Math.abs(bestMatch - freq);
  for (let octave = -3; octave <= 3; octave++) {
    if (octave !== 0) {
      const octaveScore = Math.abs(bestMatch - freq * Math.pow(2, octave));
      if (octaveScore < harmonicScore) harmonicScore = octaveScore * 0.5;
    }
  }
  const fifthUp = Math.abs(bestMatch - (freq * 1.5));
  const fifthDown = Math.abs(bestMatch - (freq / 1.5));
  if (fifthUp < harmonicScore) harmonicScore = fifthUp * 0.7;
  if (fifthDown < harmonicScore) harmonicScore = fifthDown * 0.7;
  const fourthUp = Math.abs(bestMatch - (freq * 4 / 3));
  const fourthDown = Math.abs(bestMatch - (freq * 3 / 4));
  if (fourthUp < harmonicScore) harmonicScore = fourthUp * 0.8;
  if (fourthDown < harmonicScore) harmonicScore = fourthDown * 0.8;
  return harmonicScore;
}


export interface AssignPlan {
  /** By id: only the crystal fields (closestSolfeggio, harmonicFreq, harmonicDeviation, crystalSource), only real changes. */
  patches: Map<string, CrystalPatch>;
  total: number;
  kept: number;         // Deep Scan's crystal, the same after (a put-back that lands on the same crystal included)
  restored: number;     // Deep Scan's crystal put back where an older Auto-Distribute had changed it
  anchored: number;     // a crystal Assign placed before (recorded 'assigned'): it stays
  given: number;        // had no crystal, gets one
  moved: number;        // an older Auto-Distribute's placeholder, placed now on another crystal
  movedFailed: number;  // a failed scan's placeholder (528), placed now on another crystal
  unchanged: number;    // a placeholder placed now on the crystal it had (recorded from now on)
  perCrystal: number[];          // after, in ALL_CRYSTALS order
  emptyBefore: number;           // crystals with no track before
  emptyAfter: number;
  /** v16.8: 'spread' or 'restore' (absent: Assign's own rule, 'keep'). */
  mode?: AssignMode;
  /** v16.8, a spread: scanned tracks moved off Deep Scan's crystal (Assign's from then on, their reading kept). */
  spread?: number;
  /** v16.7.3, a spread: Source tracks (sourceTrack), kept on 2178. Of them, `restored` counts the ones that go back to
   *  it (an older spread had moved them), `kept` the others (with the measured tracks the spread leaves on their own). */
  source?: number;
  /** v16.7.3 (F2), a spread: measured tracks (not Source ones) whose crystal changes: off the crystal Deep Scan gave them
   *  (`off`), from another crystal to another again (`again`: an older spread or Auto-Distribute had moved them), or
   *  back onto it (`back`). A record-only change (the same crystal) is in none; `spread` (v16.7.1's count) stays. */
  off?: number;
  again?: number;
  back?: number;
  /** v16.7.3 (fix round 2, R3), a spread: tracks with a usable Deep Scan reading (Source ones included). */
  readings?: number;
  /** v16.7.3 (fix round 3, W1, W2), a spread: the tracks it places (spreadRole 'open'): none, with Source tracks, means
   *  nothing spreads (the words say so). */
  open?: number;
  /** v16.7.3 (fix round 3, W3), a spread: Source tracks with no crystal at all (a shape Deep Scan never writes), in
   *  `given`: they get the SOURCE crystal as Deep Scan's, not an assigned one. */
  sourceGiven?: number;
  /** v16.8.2, a spread: open tracks placed by their key bands (`keyed`), of them the ones that land on a crystal whose
   *  tone fits their key (band 0: `keyFits`), and open tracks placed without bands (`noKey`: by v16.8.1's rule). */
  keyed?: number;
  keyFits?: number;
  noKey?: number;
  /** v16.8.2, a spread: the tracks it places that are still waiting for a key (awaitingKeyCount with
   *  AssignOptions.awaiting; 0 without it). Fix round 1: the open tracks only, as the health card counts them. */
  awaitingKey?: number;
  /** v16.8.2 fix round 1 (B2), a spread: the tracks that had a crystal, and of them the ones whose crystal it changes
   *  ("This time most tracks move (M of N)": a track that had none is given one, it doesn't move). */
  hadCrystal?: number;
  hadCrystalMoves?: number;
}

/**
 * The whole plan. Kept as they are: Deep Scan's crystals (one an older Auto-Distribute changed is put back) and the
 * crystals Assign placed before (anchors). Placed: the tracks with no crystal, failed scans and an older
 * Auto-Distribute's placeholders, empty crystals first, then balanced.
 */
export function planAssign(library: readonly AssignSong[], mode: AssignMode = 'keep', opts?: AssignOptions): AssignPlan {
  // v16.8 (decision 6): the spread and its way back are their own plans; Assign's own rule below is unchanged.
  // v16.8.2: only the spread reads the key bands (opts); the way back and Keep never do.
  if (mode === 'spread') return spreadOrRestore(library, mode, opts);
  if (mode === 'restore') return spreadOrRestore(library, mode);
  // v16.8.1 (D5): Keep is left as it was, its ties still broken by the id: the app never runs it (Auto-Distribute and
  // Assign crystals run planAssign(lib, 'spread') on every press, App.tsx autoDistribute), so it can't make two devices
  // differ. Only the spread's key comes from the file.
  const seen = new Set<string>();
  const lib: AssignSong[] = [];
  for (const s of library) if (!seen.has(s.id)) { seen.add(s.id); lib.push(s); }
  const counts = new Map<number, number>(ALL_CRYSTALS.map((f) => [f, 0]));
  const before = new Map<number, number>(ALL_CRYSTALS.map((f) => [f, 0]));
  for (const s of lib) if (s.closestSolfeggio && before.has(s.closestSolfeggio)) before.set(s.closestSolfeggio, before.get(s.closestSolfeggio)! + 1);
  const patches = new Map<string, CrystalPatch>();
  const plan = { kept: 0, restored: 0, anchored: 0, given: 0, moved: 0, movedFailed: 0, unchanged: 0 };
  const open: { s: AssignSong; failed: boolean; key: number; scores: Map<number, number> }[] = [];
  for (const s of lib) {
    const o = crystalOrigin(s);
    if (o === 'scan') {
      plan.kept++;
      counts.set(s.closestSolfeggio!, (counts.get(s.closestSolfeggio!) ?? 0) + 1);
    } else if (o === 'scan-replaced') {
      // Deep Scan's own crystal, from its stored measurement (harmonicFreq is the scan's; it stays).
      const f = s.harmonicFreq as number;
      const c = scanCrystalOf(f);
      patches.set(s.id, { closestSolfeggio: c, harmonicDeviation: Math.abs(f - c), crystalSource: 'scan' });
      if (c === s.closestSolfeggio) plan.kept++;
      else plan.restored++;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    } else if (s.crystalSource === 'assigned' && counts.has(s.closestSolfeggio as number)) {
      // An anchor (decision 5): placed by Assign before, it stays where it is. (Its harmonicFreq, the playback-ready
      // marker, is always written with it; one lost somehow is written back, without moving anything.)
      plan.anchored++;
      counts.set(s.closestSolfeggio!, counts.get(s.closestSolfeggio!)! + 1);
      if (!s.harmonicFreq) patches.set(s.id, { harmonicFreq: s.closestSolfeggio });
    } else {
      const est = standInFreq(s);
      const bestMatch = getHarmonicSolfeggio(est, true); // v16.3: quietly (the same answer, no per-track console lines)
      open.push({ s, failed: o === 'scan-failed', key: fnv1a('order:' + s.id), scores: new Map(ALL_CRYSTALS.map((f) => [f, compatibility(bestMatch, f)])) });
    }
  }
  // Order-free: every choice ranks by (score, id hash, id), never by library order.
  const better = (a: typeof open[number], b: typeof open[number], f: number) => {
    const d = a.scores.get(f)! - b.scores.get(f)!;
    return d !== 0 ? d < 0 : a.key !== b.key ? a.key < b.key : a.s.id < b.s.id;
  };
  const left = new Set(open);
  const place = (x: typeof open[number], f: number) => {
    left.delete(x);
    counts.set(f, counts.get(f)! + 1);
    const s = x.s;
    const score = x.scores.get(f)!;
    const had = s.closestSolfeggio;
    // v16.7.3 (F7): the stored score is capped under the spread's mark and the scan's 999 (ASSIGN_SCORE_CAP).
    patches.set(s.id, { closestSolfeggio: f, harmonicFreq: f, harmonicDeviation: storedScore(score), crystalSource: 'assigned' });
    if (!had) plan.given++;
    else if (had === f) plan.unchanged++;
    else if (x.failed) plan.movedFailed++;
    else plan.moved++;
  };
  // Fill: up to three per crystal (a CAB's distinct trio), empty crystals first.
  for (let level = 1; level <= 3; level++) {
    for (const f of ALL_CRYSTALS) {
      if (!left.size) break;
      if (counts.get(f)! >= level) continue;
      let best: typeof open[number] | null = null;
      for (const x of left) if (!best || better(x, best, f)) best = x;
      if (best) place(best, f);
    }
  }
  // Balance the rest: each to a crystal with the fewest tracks, the best fit among them.
  const rest = [...left].sort((a, b) => (a.key !== b.key ? a.key - b.key : a.s.id < b.s.id ? -1 : 1));
  for (const x of rest) {
    let min = Infinity;
    for (const f of ALL_CRYSTALS) min = Math.min(min, counts.get(f)!);
    let bestF = ALL_CRYSTALS[0], bestScore = Infinity;
    for (const f of ALL_CRYSTALS) {
      if (counts.get(f) !== min) continue;
      const sc = x.scores.get(f)!;
      if (sc < bestScore) { bestScore = sc; bestF = f; }
    }
    place(x, bestF);
  }
  const perCrystal = ALL_CRYSTALS.map((f) => counts.get(f)!);
  return {
    patches, total: lib.length, ...plan, perCrystal,
    emptyBefore: ALL_CRYSTALS.filter((f) => before.get(f) === 0).length,
    emptyAfter: perCrystal.filter((c) => c === 0).length,
  };
}


// ---- v16.8, decision 6: Auto-Distribute after scanning ("Ask me, offer both") ----------------------------------------
//
// Deep Scan's reading is not the music's pitch, so a fully scanned library can bunch into a few crystals, which today's
// Assign keeps. When it would (assignChoice), Assign asks, in both layouts, between keeping Deep Scan's crystals (the
// rule above, unchanged: planAssign(lib) or planAssign(lib, 'keep')) and spreading every track over all 27 crystals
// (planAssign(lib, 'spread')). A spread track is recorded as Assign's ('assigned'), so a later Assign keeps it where it
// is (an anchor, never "put back" as 'scan-replaced' would be), and keeps Deep Scan's measurement as data: its
// harmonicFreq stays the scan's, unlike Assign's own placements, whose harmonicFreq is their crystal (the playback-ready
// marker). So "spread from a scan" is exactly: recorded 'assigned' with a harmonicFreq that is not its crystal. The way
// back, planAssign(lib, 'restore'), gives each of those Deep Scan's crystal again (as the 'scan-replaced' path does).

export type AssignMode = 'keep' | 'spread' | 'restore';

/** A scanned track a spread placed (on any crystal): recorded as Assign's, its harmonicFreq still Deep Scan's reading.
 *  v16.7.3 (F7): the mark is exactly SPREAD_MARK + |reading − crystal| (as the spread writes it), not merely 1000 or
 *  more, so a fit score of Assign's own that reached 1000 (stored before ASSIGN_SCORE_CAP) reads as Assign's placement
 *  again: not scanned, in Deep Scan's queue, and placed as an unmeasured track by the next spread. */
export function spreadFromScan(s: CrystalFields): boolean {
  return (
    s.crystalSource === 'assigned' &&
    Number.isFinite(s.harmonicFreq) &&
    (s.harmonicFreq as number) > 0 &&
    !!s.closestSolfeggio &&
    Number.isFinite(s.harmonicDeviation) &&
    (s.harmonicDeviation as number) >= SPREAD_MARK &&
    Math.abs((s.harmonicDeviation as number) - SPREAD_MARK - Math.abs((s.harmonicFreq as number) - (s.closestSolfeggio as number))) < 1e-6
  );
}

/**
 * Review 3: the spread's own mark, in a field the library store keeps (harmonicDeviation): SPREAD_MARK plus the distance
 * from the reading to its new crystal. Assign's own placements store a fit score (well under 100), Deep Scan the
 * reading's distance (or 999 for "couldn't read"), so recognising a spread track never depends on its reading differing
 * from its crystal. The mixes that rank by it (lower first) rank a spread track last: it is far from its own reading.
 * (v16.7.3, F7: "well under 100" was not always so; Assign stores at most ASSIGN_SCORE_CAP now, and spreadFromScan reads
 * the mark's exact relation.)
 */
export const SPREAD_MARK = 1000;

/** Deep Scan has read it: its crystal kept or put back, or a spread placed it with the reading kept (review 3: counted as
 *  scanned everywhere: the filters, the health card, classic's readout and diagnostics). */
export function readByDeepScan(s: CrystalFields): boolean {
  const o = crystalOrigin(s);
  return o === 'scan' || o === 'scan-replaced' || spreadFromScan(s);
}

/** One a spread moved off the crystal Deep Scan gave it (the way back offers to put it back). */
export function spreadAway(s: CrystalFields): boolean {
  return spreadFromScan(s) && scanCrystalOf(s.harmonicFreq as number) !== s.closestSolfeggio;
}

/** Deep Scan measured it (its crystal kept, put back, or spread): a spread scores it from its own reading. */
function measured(s: CrystalFields): boolean {
  // Review 3: a reading of 0 (or none) is no reading: such a scan is never spread (see spreadOrRestore).
  return readByDeepScan(s) && Number.isFinite(s.harmonicFreq) && (s.harmonicFreq as number) > 0;
}

/**
 * v16.7.3 (the user's decision 2026-11-04): a Source track, one Deep Scan read at 2178 Hz (its reading's crystal is
 * SOURCE_FREQ). A spread keeps it there. That covers a scan on 2178, a scanned track an older Auto-Distribute moved
 * ('scan-replaced') and a track v16.7.1's spread moved (spreadFromScan: the reading is kept), each when its reading maps
 * to 2178. A crystal Assign placed on 2178 is not one: it has no reading (its harmonicFreq is its crystal, its deviation a
 * fit score, never the spread's mark), so it is placed like any other track. Neither is a scan with no usable reading
 * (the spread leaves that one where it is). The health card counts the ones away from 2178 with this same rule.
 */
export function sourceTrack(s: CrystalFields): boolean {
  return measured(s) && scanCrystalOf(s.harmonicFreq as number) === SOURCE_FREQ;
}

/**
 * v16.7.3 (F1): what a spread does with a track, the one rule spreadOrRestore and the health card both read.
 *  - 'source': a Source track, pinned on 2178 (and recorded the scan's);
 *  - 'stays': a scan with no usable reading on one of the 27: left where it is, and counted there;
 *  - 'left': a scan with no usable reading off the 27: left as it is, counted nowhere;
 *  - 'open': every other track, placed by the fill and the balance.
 * `crystal` is the crystal a pinned track holds (2178, or its own); null for 'left' and 'open'.
 */
export type SpreadRole = 'source' | 'stays' | 'left' | 'open';
export function spreadRole(s: CrystalFields): { role: SpreadRole; crystal: number | null } {
  if (sourceTrack(s)) return { role: 'source', crystal: SOURCE_FREQ };
  const o = crystalOrigin(s);
  if ((o === 'scan' || o === 'scan-replaced') && !measured(s)) {
    return ALL_CRYSTALS.includes(s.closestSolfeggio as number) ? { role: 'stays', crystal: s.closestSolfeggio as number } : { role: 'left', crystal: null };
  }
  return { role: 'open', crystal: null };
}

export type RegimeName = 'GUT' | 'HEART' | 'HEAD';
const REGIMES: ReadonlyArray<[RegimeName, readonly number[]]> = [['GUT', GUT_CRYSTALS], ['HEART', HEART_CRYSTALS], ['HEAD', HEAD_CRYSTALS]];
/** A spread fills the crystals with the ranges in turn (GUT, HEART, HEAD, GUT, ...), so 3 tracks reach every range and
 *  27 every crystal (Assign's own rule fills in ALL_CRYSTALS order, GUT first: unchanged). */
export const SPREAD_ORDER: readonly number[] = GUT_CRYSTALS.flatMap((g, i) => [g, HEART_CRYSTALS[i], HEAD_CRYSTALS[i]]);

export interface AssignChoice {
  total: number;
  /** Keeping Deep Scan's crystals (today's Assign) would leave crystals or ranges with no track. */
  bunched: boolean;
  /** Crystals with no track after today's Assign. */
  emptyCrystals: number;
  /** Ranges with no track after today's Assign. */
  emptyRegimes: RegimeName[];
  /** Tracks a spread moved off Deep Scan's crystal (the way back). */
  spreadAway: number;
  /** Assign asks first (bunched; decision 7: never just to offer the way back). */
  ask: boolean;
  /** Review 3: badly uneven under Keep (UNEVEN_MIN_TRACKS, UNEVEN_FACTOR), and its fullest and emptiest crystal. */
  uneven: boolean;
  heaviest: number;
  lightest: number;
  /** Review 3: what Keep also does (the question says so): Deep Scan's crystals put back, and tracks it places. */
  keepPutBack: number;
  keepPlaces: number;
}

/** The crystals' counts after today's Assign, without placing anyone: its rule keeps scans, put-backs and anchors; its
 *  three rounds give the crystals with fewer than 1, 2, 3 tracks one more each (in ALL_CRYSTALS order) while open tracks
 *  last; the rest go one by one to a crystal with the fewest. Which tracks go where the scores decide, but not the counts:
 *  the empty crystals are exactly Assign's, and the counts are Assign's up to which of the fewest gets the next (the same
 *  multiset; spread.check proves both against planAssign on every fixture). O(n x 27), for the health card's every
 *  library change. Also the open tracks' count (what Keep places). */
function keepCoverage(lib: readonly AssignSong[]): { per: number[]; open: number } {
  const counts = new Map<number, number>(ALL_CRYSTALS.map((f) => [f, 0]));
  let open = 0;
  // As planAssign counts: a kept crystal outside the 27 gets a key of its own (and then counts for an anchor's test).
  const bump = (f: number) => counts.set(f, (counts.get(f) ?? 0) + 1);
  for (const s of lib) {
    const o = crystalOrigin(s);
    if (o === 'scan') bump(s.closestSolfeggio!);
    else if (o === 'scan-replaced') bump(scanCrystalOf(s.harmonicFreq as number));
    else if (s.crystalSource === 'assigned' && counts.has(s.closestSolfeggio as number)) bump(s.closestSolfeggio!);
    else open++;
  }
  const placing = open;
  for (let level = 1; level <= 3; level++) {
    for (const f of ALL_CRYSTALS) {
      if (!open) break;
      if (counts.get(f)! >= level) continue;
      counts.set(f, counts.get(f)! + 1);
      open--;
    }
  }
  while (open > 0) {
    let min = Infinity;
    let at = ALL_CRYSTALS[0];
    for (const f of ALL_CRYSTALS) {
      const c = counts.get(f)!;
      if (c < min) { min = c; at = f; }
    }
    counts.set(at, min + 1);
    open--;
  }
  return { per: ALL_CRYSTALS.map((f) => counts.get(f)!), open: placing };
}

/** Review 3 (decision 6's "badly uneven"): from 54 tracks (two a crystal on average), Assign also asks when keeping Deep
 *  Scan's crystals would leave one crystal with 3 times the even share (tracks / 27) or more while another has a third
 *  of it or less. */
export const UNEVEN_MIN_TRACKS = 54;
export const UNEVEN_FACTOR = 3;

/**
 * v16.8, decision 6: whether Assign asks, and what about. It asks when keeping Deep Scan's crystals would leave a
 * crystal with no track while the library has 27 tracks or more, or a range (GUT, HEART, HEAD) with no track while it has
 * 3 or more, with Deep Scan's crystals among the kept (without any, "Keep Deep Scan's crystals" means nothing: a library
 * nothing scanned is Assign's as it always was). Decision 7: after a spread it does not ask again (nothing bunches; a
 * press keeps the spread, Assign's anchors); the way back (spreadAway) is the new layout's health line, and classic's
 * question offers it when it asks. Otherwise nothing changes: Assign runs as it always has.
 */
export function assignChoice(library: readonly AssignSong[]): AssignChoice {
  const seen = new Set<string>();
  const lib: AssignSong[] = [];
  for (const s of library) if (s && !seen.has(s.id)) { seen.add(s.id); lib.push(s); }
  const { per, open } = keepCoverage(lib);
  const emptyCrystals = per.filter((c) => c === 0).length;
  const emptyRegimes = REGIMES.filter(([, list]) => list.every((f) => per[ALL_CRYSTALS.indexOf(f)] === 0)).map(([n]) => n);
  const total = lib.length;
  const scans = lib.some((s) => {
    const o = crystalOrigin(s);
    return o === 'scan' || o === 'scan-replaced';
  });
  const share = total / 27;
  const heaviest = Math.max(...per);
  const lightest = Math.min(...per);
  const uneven = total >= UNEVEN_MIN_TRACKS && heaviest >= UNEVEN_FACTOR * share && lightest <= share / UNEVEN_FACTOR;
  const bunched = scans && ((total >= 27 && emptyCrystals > 0) || (total >= 3 && emptyRegimes.length > 0) || uneven);
  const away = lib.filter(spreadAway).length;
  const keepPutBack = lib.filter(scanCrystalChanged).length;
  return { total, bunched, emptyCrystals, emptyRegimes, spreadAway: away, ask: bunched, uneven, heaviest, lightest, keepPutBack, keepPlaces: open };
}

/** v16.8: the plan of a spread or a way back (planAssign's modes); the same shape, with the mode and its own counts. */
function spreadOrRestore(library: readonly AssignSong[], mode: 'spread' | 'restore', opts?: AssignOptions): AssignPlan {
  const seen = new Set<string>();
  const lib: AssignSong[] = [];
  for (const s of library) if (!seen.has(s.id)) { seen.add(s.id); lib.push(s); }
  const before = new Map<number, number>(ALL_CRYSTALS.map((f) => [f, 0]));
  for (const s of lib) if (s.closestSolfeggio && before.has(s.closestSolfeggio)) before.set(s.closestSolfeggio, before.get(s.closestSolfeggio)! + 1);
  const counts = new Map<number, number>(ALL_CRYSTALS.map((f) => [f, 0]));
  const patches = new Map<string, CrystalPatch>();
  const plan = { kept: 0, restored: 0, anchored: 0, given: 0, moved: 0, movedFailed: 0, unchanged: 0, spread: 0 };
  let source = 0; // v16.7.3: a spread's Source tracks (the plan carries it for a spread only; 'restore' is as it was)
  const moves = { off: 0, again: 0, back: 0 }; // v16.7.3 (F2): a spread's measured tracks whose crystal changes
  let readings = 0; // fix round 2 (R3): a spread's tracks with a Deep Scan reading (the notice says they keep it)
  let sourceGiven = 0; // fix round 3 (W3): Source tracks with no crystal, given 2178 as Deep Scan's
  const opened: AssignSong[] = []; // a spread's open tracks (fix round 3, W1, W2: the plan says how many)
  const keys = { keyed: 0, keyFits: 0, noKey: 0 }; // v16.8.2: a spread's open tracks by whether their key places them
  /** Only the fields that differ: a second press (or a spread already spread) writes nothing. */
  const want = (s: AssignSong, w: CrystalPatch) => {
    const p: CrystalPatch = {};
    let any = false;
    for (const k of Object.keys(w) as (keyof CrystalPatch)[]) {
      if (s[k] !== w[k]) {
        (p as Record<string, unknown>)[k] = w[k];
        any = true;
      }
    }
    if (any) patches.set(s.id, p);
    return any;
  };
  if (mode === 'restore') {
    for (const s of lib) {
      let c = s.closestSolfeggio;
      if (spreadFromScan(s)) {
        const f = s.harmonicFreq as number;
        c = scanCrystalOf(f);
        const changed = c !== s.closestSolfeggio;
        want(s, { closestSolfeggio: c, harmonicDeviation: Math.abs(f - c), crystalSource: 'scan' });
        if (changed) plan.restored++;
        else plan.kept++;
      }
      if (c !== undefined && counts.has(c)) counts.set(c, counts.get(c)! + 1);
    }
  } else {
    // Every track is open (decision 8: Assign's earlier placements too), but a scan with no usable reading: Assign's own
    // rule keeps it where it is, and so does a spread (review 3). A measured one is scored from its own reading's crystal;
    // any other from the old stand-in. v16.7.3 (F1): which is which is spreadRole's, the rule the health card reads too.
    // v16.7.3 (the user's decision 2026-11-04): every Source track (Deep Scan read it at 2178 Hz) stays on 2178, or goes
    // back to it, recorded as the scan's, and is never open.
    // v16.8.1 (D3, the user's decision 2026-11-05, "full share on top"): the Source tracks no longer count toward 2178's
    // share. `counts` below is the fill's own count, the 'stays' tracks and the open tracks placed, never a Source track;
    // the fill gives a crystal a track at level L while that count is under L, and the balance gives each next track to
    // a crystal with the fewest. So the open tracks spread evenly over all 27, 2178 included, and 2178 holds its Source
    // tracks besides (270 tracks with 6 Source: about 10 on each crystal, about 16 on 2178). D3b: when the open tracks
    // can't give every crystal the fill's first round has to cover one (`short`), a 2178 that holds Source tracks
    // counts as covered in that round, so the empty crystals get the tracks: 27 − emptyAfter stays
    // min(27, pinned crystals + open tracks), the health card's spreadCover (source.check, devices.check).
    for (const s of lib) {
      const { role, crystal } = spreadRole(s);
      if (role === 'open') { opened.push(s); continue; }
      if (role === 'stays') counts.set(crystal!, counts.get(crystal!)! + 1);
      if (role !== 'source') continue;
      const hf = s.harmonicFreq as number;
      const back = s.closestSolfeggio !== SOURCE_FREQ;
      want(s, { closestSolfeggio: SOURCE_FREQ, harmonicDeviation: Math.abs(hf - SOURCE_FREQ), crystalSource: 'scan' });
      source++;
      readings++;
      // (Fix round 2, R4: one with no crystal at all, a shape Deep Scan never writes, gets one: given, not restored.)
      if (!s.closestSolfeggio) { plan.given++; sourceGiven++; }
      else if (back) plan.restored++;
      else plan.kept++;
      // (v16.8.1, D3: not counted toward 2178's share; perCrystal adds them below.)
    }
    // v16.8.1 (D2): ranked by the file, the same on every device that holds it (fileKey; the id only for exact
    // duplicates, the same file imported twice, and for tracks with no file).
    // v16.8.1 (D5r): and an unmeasured track's stand-in is seeded by its file too (standInFreq itself is unchanged; it
    // reads the id it is given): seeded by the per-device id, one never-scanned or failed track moved measured tracks
    // between devices in most libraries. A track with no file gets its id, so it is as before. (Only the spread reads a
    // stand-in here; the way back, 'restore', never does. Keep, above, still seeds by the id: D5.)
    // v16.8.2 (K1, K2): and its key band on each crystal (opts.bands, in ALL_CRYSTALS order), compared before the score:
    // a track with a clear key goes first to the crystals whose tone fits its key, its reading's (or its stand-in's)
    // compatibility only breaking ties; a stand-in with a clear key (never scanned, but analysed) is placed by its key
    // too. Without bands, NEUTRAL_BAND on every crystal: v16.8.1's order exactly.
    const bandsFor = opts?.bands;
    const open = opened.map((s) => {
      const isMeasured = measured(s);
      if (isMeasured) readings++;
      const scanCrystal = isMeasured ? scanCrystalOf(s.harmonicFreq as number) : 0;
      const fk = fileKey(s);
      const bestMatch = isMeasured ? scanCrystal : getHarmonicSolfeggio(standInFreq({ ...s, id: fk }), true);
      const b = bandsFor ? bandsFor(s) : null;
      const band = b && b.length === ALL_CRYSTALS.length ? b : null;
      if (band) keys.keyed++;
      else keys.noKey++;
      return { s, isMeasured, scanCrystal, fk, key: fnv1a('order:' + fk), scores: new Map(ALL_CRYSTALS.map((f) => [f, compatibility(bestMatch, f)])), band };
    });
    type Open = (typeof open)[number];
    const bandAt = (x: Open, f: number): number => (x.band ? x.band[CRYSTAL_INDEX.get(f)!] : NEUTRAL_BAND);
    // Order-free: (band, score, the file's hash, the file key, the id), compared in that order, never summed. The file
    // key itself after its hash, so two files whose hashes collide are still told apart by what every device has.
    const tie = (a: Open, b: Open) => (a.key !== b.key ? a.key < b.key : a.fk !== b.fk ? a.fk < b.fk : a.s.id < b.s.id);
    const better = (a: Open, b: Open, f: number) => {
      const ba = bandAt(a, f), bb = bandAt(b, f);
      if (ba !== bb) return ba < bb;
      const d = a.scores.get(f)! - b.scores.get(f)!;
      return d !== 0 ? d < 0 : tie(a, b);
    };
    // D3b: too few open tracks for every crystal the first round fills (no 'stays' track on it): 2178, holding Source
    // tracks, counts as covered in that round.
    const short = source > 0 && open.length < SPREAD_ORDER.filter((f) => counts.get(f) === 0).length;
    const left = new Set(open);
    const place = (x: Open, f: number) => {
      left.delete(x);
      counts.set(f, counts.get(f)! + 1);
      if (x.band && bandAt(x, f) === 0) keys.keyFits++;
      const s = x.s;
      const had = s.closestSolfeggio;
      if (x.isMeasured) {
        const hf = s.harmonicFreq as number;
        if (f === x.scanCrystal) {
          // Its own Deep Scan crystal: recorded as the scan's.
          want(s, { closestSolfeggio: f, harmonicDeviation: Math.abs(hf - f), crystalSource: 'scan' });
          plan.kept++;
          // v16.7.3 (F2): back on it from another crystal (an older spread or Auto-Distribute had moved it).
          if (had && had !== f) moves.back++;
        } else {
          // Moved off it: Assign's (an anchor from now on), the measurement kept as the track's harmonicFreq, marked.
          const changed = want(s, { closestSolfeggio: f, harmonicDeviation: SPREAD_MARK + Math.abs(hf - f), crystalSource: 'assigned' });
          if (had === f && !changed) plan.unchanged++;
          else plan.spread++;
          // v16.7.3 (F2): off its Deep Scan crystal now, or moved again from another one (a record-only change: neither).
          if (had && had !== f) {
            if (had === x.scanCrystal) moves.off++;
            else moves.again++;
          }
        }
      } else {
        // v16.7.3 (F7): the score is stored capped (ASSIGN_SCORE_CAP); the fill above chose by the full score.
        const changed = want(s, { closestSolfeggio: f, harmonicFreq: f, harmonicDeviation: storedScore(x.scores.get(f)!), crystalSource: 'assigned' });
        if (!had) plan.given++;
        else if (had === f) plan.unchanged++;
        else if (crystalOrigin(s) === 'scan-failed') plan.movedFailed++;
        else plan.moved++;
        void changed;
      }
    };
    for (let level = 1; level <= 3; level++) {
      for (const f of SPREAD_ORDER) {
        if (!left.size) break;
        if (counts.get(f)! + (level === 1 && short && f === SOURCE_FREQ ? 1 : 0) >= level) continue;
        let best: Open | null = null;
        for (const x of left) if (!best || better(x, best, f)) best = x;
        if (best) place(best, f);
      }
    }
    const rest = [...left].sort((a, b) => (a === b ? 0 : tie(a, b) ? -1 : 1));
    for (const x of rest) {
      let min = Infinity;
      for (const f of SPREAD_ORDER) min = Math.min(min, counts.get(f)!);
      // v16.8.2: the best (band, score) of them, compared in that order (the first in SPREAD_ORDER on a tie).
      let bestF = SPREAD_ORDER[0], bestBand = Infinity, bestScore = Infinity;
      for (const f of SPREAD_ORDER) {
        if (counts.get(f) !== min) continue;
        const bd = bandAt(x, f), sc = x.scores.get(f)!;
        if (bd < bestBand || (bd === bestBand && sc < bestScore)) { bestBand = bd; bestScore = sc; bestF = f; }
      }
      place(x, bestF);
    }
  }
  // (v16.8.1, D3: the tracks on each crystal, the Source tracks on 2178 included.)
  const perCrystal = ALL_CRYSTALS.map((f) => counts.get(f)! + (f === SOURCE_FREQ ? source : 0));
  return {
    patches, total: lib.length, ...plan, perCrystal, mode,
    emptyBefore: ALL_CRYSTALS.filter((f) => before.get(f) === 0).length,
    emptyAfter: perCrystal.filter((c) => c === 0).length,
    ...(mode === 'spread' ? {
      source, ...moves, readings, open: opened.length, sourceGiven, ...keys,
      awaitingKey: opts?.awaiting ? awaitingKeyCount(lib, opts.awaiting) : 0,
      hadCrystal: lib.filter((s) => !!s.closestSolfeggio).length,
      hadCrystalMoves: lib.filter((s) => !!s.closestSolfeggio && patches.get(s.id)?.closestSolfeggio !== undefined).length,
    } : {}),
  };
}

// ---- the words ------------------------------------------------------------------------------------------------------
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Tracks this Assign places (they become assigned, not scanned). */
const placed = (p: AssignPlan) => p.given + p.moved + p.movedFailed + p.unchanged;

/** v16.8.2 fix round 3 (F1): whether two plans write the same: the same ids, and for each id the same fields (the patch's
 *  own keys, all that patchById spreads) with the same values (Object.is). The health card's confirmation applies a fresh
 *  plan of a library that changed while it was open in the same tap when this holds (what it showed is what is written),
 *  and asks again, once, when it doesn't. */
export function samePlanPatches(a: ReadonlyMap<string, CrystalPatch>, b: ReadonlyMap<string, CrystalPatch>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, pa] of a) {
    const pb = b.get(id);
    if (!pb) return false;
    const ka = Object.keys(pa);
    if (ka.length !== Object.keys(pb).length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(pb, k) || !Object.is((pa as Record<string, unknown>)[k], (pb as Record<string, unknown>)[k])) return false;
  }
  return true;
}
/** v16.8.1 (D8): the tracks whose crystal (closestSolfeggio) a plan changes: a patch carries only the fields that
 *  differ, so one with a crystal moves it (a record-only change, crystalSource or the stored score alone, is not one).
 *  A spread is idempotent: after its press, a plan of the result moves none. */
export function crystalMoves(p: AssignPlan): number {
  let n = 0;
  for (const patch of p.patches.values()) if (patch.closestSolfeggio !== undefined) n++;
  return n;
}

/** Assign asks first only when crystals that tracks already have would change. */
export function assignNeedsConfirm(p: AssignPlan): boolean {
  // v16.7.1: a spread also moves scanned tracks. v16.7.3: exactly when a crystal a track has changes (F2): an assigned
  // or placeholder crystal moves, a scanned track moves off, again or back (off, again, back), or a Source track goes back
  // on 2178 (restored); a record-only change (the same crystal) does not ask.
  if (p.mode === 'spread') return p.moved + p.movedFailed + (p.off ?? 0) + (p.again ?? 0) + (p.back ?? 0) + p.restored > 0;
  return p.moved + p.movedFailed + p.restored > 0;
}

/** The confirmation (the new layout's health card), each sentence only when its count is above 0. */
export function assignConfirmText(p: AssignPlan): { title: string; body: string } {
  if (p.mode === 'spread') return spreadConfirmText(p);
  const sentences = [
    p.kept > 0 ? 'Tracks Deep Scan placed keep their crystal.' : '',
    p.anchored > 0 ? 'Crystals Assign placed before stay where they are.' : '',
    p.restored > 0 ? `${p.restored} ${p.restored === 1 ? 'gets' : 'get'} back the crystal Deep Scan gave ${p.restored === 1 ? 'it' : 'them'}, which an older Auto-Distribute had replaced.` : '',
    p.given > 0 ? `${plural(p.given, 'track without one gets', 'tracks without one get')} a crystal.` : '',
    p.moved > 0 ? `${plural(p.moved, 'crystal an older Auto-Distribute assigned moves', 'crystals an older Auto-Distribute assigned move')} once; from then on, Assign keeps ${p.moved === 1 ? 'it' : 'them'} where ${p.moved === 1 ? 'it is' : 'they are'}.` : '',
    p.movedFailed > 0 ? `${plural(p.movedFailed, 'placeholder crystal of a failed Deep Scan moves', 'placeholder crystals of failed Deep Scans move')}.` : '',
    p.emptyBefore > 0 && p.emptyAfter === 0 ? 'Afterwards every crystal has a track.' : '',
    placed(p) > 0 ? "Assigned crystals aren't a scan: Deep Scan can still analyse those tracks." : '',
    'Keys and visual sync are kept.',
  ];
  return { title: 'Assign crystals?', body: sentences.filter(Boolean).join(' ') };
}

/** Nothing to change (a second press, or after a delete): the toast. */
export function assignNothingText(p: AssignPlan): string {
  if (p.total === 0) return 'Your library is empty.';
  // v16.7.1: "all 27" only when every crystal has a track (a library of fewer than 27 can't fill them all).
  if (p.mode === 'spread') {
    if (p.emptyAfter === 0) return 'Every track is already spread over all 27 crystals.';
    // v16.7.3 (F3): the crystals left empty are the SOURCE tracks' doing (they stay together on 2178), so say so.
    return (p.source ?? 0) > 0 ? 'Every track is already spread over the crystals; tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.' : 'Every track is already spread over the crystals.';
  }
  if (p.mode === 'restore') return "Deep Scan's crystals are already in place.";
  return `Every track already has its crystal (${p.kept} from Deep Scan, ${p.anchored + p.unchanged} assigned).`;
}

/** What Assign did: the classic notice (the new layout routes it to the status toast). */
export function assignDoneText(p: AssignPlan): string {
  if (p.mode === 'spread' || p.mode === 'restore') return assignModeDoneText(p);
  const parts = [
    p.given ? `${plural(p.given, 'track', 'tracks')} got a crystal` : '',
    p.moved + p.movedFailed ? `${plural(p.moved + p.movedFailed, 'placeholder crystal', 'placeholder crystals')} changed` : '',
    p.restored ? `${plural(p.restored, 'track', 'tracks')} got Deep Scan's crystal back` : '',
  ].filter(Boolean);
  const scans = [p.kept ? `${p.kept} kept` : '', p.restored ? `${p.restored} put back` : ''].filter(Boolean);
  const cab = p.perCrystal.filter((c) => c >= 3).length;
  const cabi = p.perCrystal.filter((c, i) => c >= (ALL_CRYSTALS[i] === SOURCE_FREQ ? 6 : 4)).length;
  return `Crystals assigned: ${parts.length ? parts.join(', ') : 'every track keeps its crystal'}. ` +
    (scans.length ? `Deep Scan's crystals: ${scans.join(', ')}. ` : '') +
    (p.anchored ? `${plural(p.anchored, 'crystal Assign placed before stays', 'crystals Assign placed before stay')}. ` : '') +
    (p.emptyAfter === 0 ? 'Every crystal has a track, so walks have no gaps. ' : `${plural(p.emptyAfter, 'crystal still has', 'crystals still have')} no track. `) +
    (cab === 27 ? 'CAB-ready: all 27 crystals have 3 or more. ' : `CAB readiness: ${cab}/27 crystals at 3 or more. `) +
    (cabi === 27 ? 'CABI-ready.' : `CABI readiness: ${cabi}/27.`) +
    (placed(p) > 0 ? ' Assigned tracks stay unscanned: Deep Scan can still analyse them.' : '');
}

// ---- v16.8, decision 6: the question and what a spread or a way back did --------------------------------------------
const rangeList = (r: readonly string[]) => (r.length === 1 ? `the ${r[0]} range` : `the ${r.slice(0, -1).join(', ')} and ${r[r.length - 1]} ranges`);

/** The question's words (it asks only when bunched): the title, the body, and each choice's label. `o.restore`: also
 *  offer the way back when tracks were spread away from Deep Scan's crystal (classic's question, decision 7; the new
 *  layout's way back is its health line), else null. */
export function assignChoiceText(c: AssignChoice, o: { restore?: boolean } = {}): { title: string; body: string; keep: string; spread: string; restore: string | null } {
  const restore = o.restore && c.spreadAway > 0 ? "Put Deep Scan's crystals back" : null;
  // Review 3: the confirmation Assign asks otherwise is skipped when it asks this, so Keep says what it also does.
  const also = [
    c.keepPutBack > 0 ? `gives ${plural(c.keepPutBack, 'track', 'tracks')} Deep Scan's crystal back` : '',
    c.keepPlaces > 0 ? `places ${plural(c.keepPlaces, 'track', 'tracks')} with no crystal or a placeholder` : '',
  ].filter(Boolean);
  const sentences = [
    c.emptyCrystals > 0 ? `Keeping Deep Scan's crystals leaves ${c.emptyCrystals} of the 27 crystals with no track.` : '',
    c.emptyRegimes.length > 0 ? `Nothing would play in ${rangeList(c.emptyRegimes)}.` : '',
    c.emptyCrystals === 0 && c.uneven ? `Keeping Deep Scan's crystals leaves them very uneven: one crystal has ${plural(c.heaviest, 'track', 'tracks')}, another ${c.lightest}.` : '',
    also.length ? `Keeping them also ${also.join(' and ')}.` : '',
    // v16.8.2: and by key (classic's question, which the app no longer shows: classic does show the done text's key part,
    // the keys toast and the copy, as the new layout does; classic goes in v16.9).
    `Spreading places every track, scanned ones too, so ${c.total >= 27 ? 'every crystal and every range' : 'every range'} has tracks. Tracks with a clear key go first to crystals whose tone fits their key. Deep Scan's own reading stays with each track, and Assign keeps them where they are from then on.`,
    restore ? `${plural(c.spreadAway, 'track is', 'tracks are')} already spread away from Deep Scan's crystal.` : '',
  ];
  return { title: 'How should Assign place your tracks?', body: sentences.filter(Boolean).join(' '), keep: "Keep Deep Scan's crystals", spread: 'Spread every track over all 27 crystals', restore };
}

/** v16.7.1: the spread's confirmation (the new layout's health card asks first when crystals tracks have would move). */
function spreadConfirmText(p: AssignPlan): { title: string; body: string } {
  // (A spread's unchanged count mixes scanned and assigned tracks, so only the ones it places now.)
  // (Fix round 3, W3: a Source track given 2178 got Deep Scan's crystal, not an assigned one.)
  const unmeasured = p.given - (p.sourceGiven ?? 0) + p.moved + p.movedFailed;
  // v16.7.3: the Source tracks first (F3); they are never among the scanned tracks that move (those are open ones only).
  const source = p.source ?? 0;
  const off = p.off ?? 0, again = p.again ?? 0, back = p.back ?? 0;
  const keyed = p.keyed ?? 0, awaiting = p.awaitingKey ?? 0, had = p.hadCrystal ?? 0, hadMoves = p.hadCrystalMoves ?? 0; // v16.8.2
  const them = (n: number) => (n === 1 ? 'it' : 'them');
  // v16.7.3 (F2): the scanned tracks whose crystal changes, by how: off the crystal Deep Scan gave them, moved again
  // (already off it: an older Auto-Distribute or spread had moved them), or back on it. The reading stays with the ones
  // that move. (Fix round 2, R1: "again" in words true for both, never "spread before".)
  const offWords = `${plural(off, 'scanned track moves', 'scanned tracks move')} off the crystal Deep Scan gave ${them(off)}`;
  const moving = off && again
    ? `${offWords}; ${plural(again, 'already off it moves', 'already off it move')} again`
    : off
      ? offWords
      : again
        ? `${plural(again, 'scanned track already off the crystal Deep Scan gave it moves', 'scanned tracks already off the crystal Deep Scan gave them move')} again`
        : '';
  const sentences = [
    source > 0
      ? p.restored > 0
        ? `${plural(p.restored, 'track Deep Scan placed on 2178 Hz goes', 'tracks Deep Scan placed on 2178 Hz go')} back to the SOURCE crystal.`
        : 'Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.'
      : '',
    // (Fix round 2, R2, and round 3, W1: no "Every other track" when no other track is spread: every track a SOURCE one,
    // or the rest unreadable scans the spread leaves where they are.)
    source === 0 || (p.open ?? 0) > 0 ? `${source > 0 ? 'Every other track' : 'Every track'} is spread over ${p.emptyAfter === 0 ? 'all 27 crystals' : 'the crystals'}, the GUT, HEART and HEAD ranges in turn.` : '',
    // v16.8.2 (K9): only when a track's key places it (none: v16.8.1's words, sentence for sentence). The first press
    // after the update moves most tracks, and says so.
    // (Fix round 1: "first", since an even spread can't give every keyed track a fitting crystal; the tracks that move
    // are counted among the ones that had a crystal, at least 2 of them, more than half; the waiting ones are open tracks.)
    keyed > 0 ? "Tracks with a clear key go first to crystals whose tone fits their key." : '',
    keyed > 0 && had >= 2 && hadMoves > had / 2 ? `This time most tracks move (${hadMoves} of ${had}).` : '',
    keyed > 0 && awaiting > 0 ? `${plural(awaiting, 'track has', 'tracks have')} no key yet: Analyse tracks to place ${awaiting === 1 ? 'it' : 'them'} by key too.` : '',
    moving ? `${moving}; Deep Scan's reading is kept.` : '',
    back ? `${plural(back, 'scanned track goes', 'scanned tracks go')} back to the crystal Deep Scan gave ${them(back)}.` : '',
    p.given > 0 ? `${plural(p.given, 'track without one gets', 'tracks without one get')} a crystal.` : '',
    p.moved + p.movedFailed > 0 ? `${plural(p.moved + p.movedFailed, 'assigned crystal moves', 'assigned crystals move')}.` : '',
    p.emptyBefore > 0 && p.emptyAfter === 0 ? 'Afterwards every crystal has a track.' : '',
    unmeasured > 0 ? "Assigned crystals aren't a scan: Deep Scan can still analyse those tracks." : '',
    'Keys and visual sync are kept.',
  ];
  return { title: 'Assign crystals?', body: sentences.filter(Boolean).join(' ') };
}

/** What a spread or a way back did (the notice, as assignDoneText for Assign's own rule). */
function assignModeDoneText(p: AssignPlan): string {
  const cab = p.perCrystal.filter((c) => c >= 3).length;
  const cover = p.emptyAfter === 0 ? 'Every crystal has a track, so walks have no gaps. ' : `${plural(p.emptyAfter, 'crystal still has', 'crystals still have')} no track. `;
  const ready = cab === 27 ? 'CAB-ready: all 27 crystals have 3 or more.' : `CAB readiness: ${cab}/27 crystals at 3 or more.`;
  if (p.mode === 'restore') return `Deep Scan's crystals are back on ${plural(p.restored, 'track', 'tracks')}. ` + cover + ready;
  // v16.7.3 (F2): the moved scanned tracks by how they move (see spreadConfirmText).
  const off = p.off ?? 0, again = p.again ?? 0, back = p.back ?? 0;
  const parts = [
    off ? `${plural(off, 'scanned track', 'scanned tracks')} moved off Deep Scan's crystal` : '',
    again ? `${plural(again, 'scanned track', 'scanned tracks')} moved again` : '', // (fix round 2, R1)
    back ? `${plural(back, 'track', 'tracks')} back on Deep Scan's crystal` : '',
    // v16.7.3: Source tracks an older spread had moved, back on 2178 (a spread's restored counts only those).
    p.restored ? `${plural(p.restored, 'track', 'tracks')} back on 2178 Hz` : '',
    p.given ? `${plural(p.given, 'track', 'tracks')} got a crystal` : '',
    p.moved + p.movedFailed ? `${plural(p.moved + p.movedFailed, 'assigned crystal', 'assigned crystals')} moved` : '',
    // v16.8.2: the tracks their key placed, and of them the ones on a crystal whose tone fits it (none: v16.8.1's words).
    p.keyed ? `${p.keyed} placed by key (${p.keyFits ?? 0} where the tone fits)` : '',
  ].filter(Boolean);
  // v16.7.1: no way back in this release, so none is promised.
  // (Fix round 3, W2: with Source tracks and nothing else to place, nothing spreads: the heading of Assign's own notice.)
  const head = (p.source ?? 0) > 0 && (p.open ?? 0) === 0 ? 'Crystals assigned' : p.emptyAfter === 0 ? 'Tracks spread over all 27 crystals' : 'Tracks spread over the crystals';
  // (Fix round 2, R3: "Deep Scan's readings are kept." only when the library holds one.)
  return `${head}: ${parts.length ? parts.join(', ') : 'every track keeps its crystal'}. ` + cover + ready + ((p.readings ?? 0) > 0 ? " Deep Scan's readings are kept." : '') +
    ((p.source ?? 0) > 0 ? ' Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.' : '');
}
