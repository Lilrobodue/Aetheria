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
}
/** What Assign reads: the crystal fields, the id (its seed and tiebreak), the name and the length (the stand-in). */
export interface AssignSong extends CrystalFields { id: string; name: string; duration?: number }
/** What Assign writes: the four crystal fields, nothing else. */
export interface CrystalPatch { closestSolfeggio?: number; harmonicFreq?: number; harmonicDeviation?: number; crystalSource?: CrystalSource }
export type CrystalOrigin = 'scan' | 'scan-replaced' | 'scan-failed' | 'assigned' | 'none';

export const ALL_CRYSTALS: readonly number[] = [...GUT_CRYSTALS, ...HEART_CRYSTALS, ...HEAD_CRYSTALS];
const SCAN_FAILED_DEVIATION = 999; // Deep Scan's "couldn't read" fallback: 440 Hz / 528 / 999

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
  const first = library.filter((s) => needsDeepScan(s) && (!s.harmonicFreq || !s.closestSolfeggio));
  if (o.assigned !== true) return first;
  return [...first, ...library.filter((s) => needsDeepScan(s) && !!s.harmonicFreq && !!s.closestSolfeggio)];
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
}

/**
 * The whole plan. Kept as they are: Deep Scan's crystals (one an older Auto-Distribute changed is put back) and the
 * crystals Assign placed before (anchors). Placed: the tracks with no crystal, failed scans and an older
 * Auto-Distribute's placeholders, empty crystals first, then balanced.
 */
export function planAssign(library: readonly AssignSong[], mode: AssignMode = 'keep'): AssignPlan {
  // v16.8 (decision 6): the spread and its way back are their own plans; Assign's own rule below is unchanged.
  if (mode === 'spread' || mode === 'restore') return spreadOrRestore(library, mode);
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
    patches.set(s.id, { closestSolfeggio: f, harmonicFreq: f, harmonicDeviation: score, crystalSource: 'assigned' });
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

/** A scanned track a spread placed (on any crystal): recorded as Assign's, its harmonicFreq still Deep Scan's reading. */
export function spreadFromScan(s: CrystalFields): boolean {
  return (
    s.crystalSource === 'assigned' &&
    Number.isFinite(s.harmonicFreq) &&
    (s.harmonicFreq as number) > 0 &&
    !!s.closestSolfeggio &&
    Number.isFinite(s.harmonicDeviation) &&
    (s.harmonicDeviation as number) >= SPREAD_MARK
  );
}

/**
 * Review 3: the spread's own mark, in a field the library store keeps (harmonicDeviation): SPREAD_MARK plus the distance
 * from the reading to its new crystal. Assign's own placements store a fit score (well under 100), Deep Scan the
 * reading's distance (or 999 for "couldn't read"), so recognising a spread track never depends on its reading differing
 * from its crystal. The mixes that rank by it (lower first) rank a spread track last: it is far from its own reading.
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
function spreadOrRestore(library: readonly AssignSong[], mode: 'spread' | 'restore'): AssignPlan {
  const seen = new Set<string>();
  const lib: AssignSong[] = [];
  for (const s of library) if (!seen.has(s.id)) { seen.add(s.id); lib.push(s); }
  const before = new Map<number, number>(ALL_CRYSTALS.map((f) => [f, 0]));
  for (const s of lib) if (s.closestSolfeggio && before.has(s.closestSolfeggio)) before.set(s.closestSolfeggio, before.get(s.closestSolfeggio)! + 1);
  const counts = new Map<number, number>(ALL_CRYSTALS.map((f) => [f, 0]));
  const patches = new Map<string, CrystalPatch>();
  const plan = { kept: 0, restored: 0, anchored: 0, given: 0, moved: 0, movedFailed: 0, unchanged: 0, spread: 0 };
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
    // any other from the old stand-in.
    const unreadable = (s: AssignSong) => {
      const o = crystalOrigin(s);
      return (o === 'scan' || o === 'scan-replaced') && !measured(s);
    };
    for (const s of lib) if (unreadable(s) && counts.has(s.closestSolfeggio as number)) counts.set(s.closestSolfeggio!, counts.get(s.closestSolfeggio!)! + 1);
    const open = lib.filter((s) => !unreadable(s)).map((s) => {
      const isMeasured = measured(s);
      const scanCrystal = isMeasured ? scanCrystalOf(s.harmonicFreq as number) : 0;
      const bestMatch = isMeasured ? scanCrystal : getHarmonicSolfeggio(standInFreq(s), true);
      return { s, isMeasured, scanCrystal, key: fnv1a('order:' + s.id), scores: new Map(ALL_CRYSTALS.map((f) => [f, compatibility(bestMatch, f)])) };
    });
    type Open = (typeof open)[number];
    const better = (a: Open, b: Open, f: number) => {
      const d = a.scores.get(f)! - b.scores.get(f)!;
      return d !== 0 ? d < 0 : a.key !== b.key ? a.key < b.key : a.s.id < b.s.id;
    };
    const left = new Set(open);
    const place = (x: Open, f: number) => {
      left.delete(x);
      counts.set(f, counts.get(f)! + 1);
      const s = x.s;
      const had = s.closestSolfeggio;
      if (x.isMeasured) {
        const hf = s.harmonicFreq as number;
        if (f === x.scanCrystal) {
          // Its own Deep Scan crystal: recorded as the scan's.
          want(s, { closestSolfeggio: f, harmonicDeviation: Math.abs(hf - f), crystalSource: 'scan' });
          plan.kept++;
        } else {
          // Moved off it: Assign's (an anchor from now on), the measurement kept as the track's harmonicFreq, marked.
          const changed = want(s, { closestSolfeggio: f, harmonicDeviation: SPREAD_MARK + Math.abs(hf - f), crystalSource: 'assigned' });
          if (had === f && !changed) plan.unchanged++;
          else plan.spread++;
        }
      } else {
        const changed = want(s, { closestSolfeggio: f, harmonicFreq: f, harmonicDeviation: x.scores.get(f)!, crystalSource: 'assigned' });
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
        if (counts.get(f)! >= level) continue;
        let best: Open | null = null;
        for (const x of left) if (!best || better(x, best, f)) best = x;
        if (best) place(best, f);
      }
    }
    const rest = [...left].sort((a, b) => (a.key !== b.key ? a.key - b.key : a.s.id < b.s.id ? -1 : 1));
    for (const x of rest) {
      let min = Infinity;
      for (const f of SPREAD_ORDER) min = Math.min(min, counts.get(f)!);
      let bestF = SPREAD_ORDER[0], bestScore = Infinity;
      for (const f of SPREAD_ORDER) {
        if (counts.get(f) !== min) continue;
        const sc = x.scores.get(f)!;
        if (sc < bestScore) { bestScore = sc; bestF = f; }
      }
      place(x, bestF);
    }
  }
  const perCrystal = ALL_CRYSTALS.map((f) => counts.get(f)!);
  return {
    patches, total: lib.length, ...plan, perCrystal, mode,
    emptyBefore: ALL_CRYSTALS.filter((f) => before.get(f) === 0).length,
    emptyAfter: perCrystal.filter((c) => c === 0).length,
  };
}

// ---- the words ------------------------------------------------------------------------------------------------------
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Tracks this Assign places (they become assigned, not scanned). */
const placed = (p: AssignPlan) => p.given + p.moved + p.movedFailed + p.unchanged;

/** Assign asks first only when crystals that tracks already have would change. */
export function assignNeedsConfirm(p: AssignPlan): boolean {
  // v16.7.1: a spread also moves scanned tracks off Deep Scan's crystal (p.spread).
  if (p.mode === 'spread') return p.moved + p.movedFailed + (p.spread ?? 0) > 0;
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
  if (p.mode === 'spread') return p.emptyAfter === 0 ? 'Every track is already spread over all 27 crystals.' : 'Every track is already spread over the crystals.';
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
    `Spreading places every track, scanned ones too, so ${c.total >= 27 ? 'every crystal and every range' : 'every range'} has tracks. Deep Scan's own reading stays with each track, and Assign keeps them where they are from then on.`,
    restore ? `${plural(c.spreadAway, 'track is', 'tracks are')} already spread away from Deep Scan's crystal.` : '',
  ];
  return { title: 'How should Assign place your tracks?', body: sentences.filter(Boolean).join(' '), keep: "Keep Deep Scan's crystals", spread: 'Spread every track over all 27 crystals', restore };
}

/** v16.7.1: the spread's confirmation (the new layout's health card asks first when crystals tracks have would move). */
function spreadConfirmText(p: AssignPlan): { title: string; body: string } {
  // (A spread's unchanged count mixes scanned and assigned tracks, so only the ones it places now.)
  const unmeasured = p.given + p.moved + p.movedFailed;
  const sentences = [
    p.emptyAfter === 0 ? 'Every track is spread over all 27 crystals, the GUT, HEART and HEAD ranges in turn.' : 'Every track is spread over the crystals, the GUT, HEART and HEAD ranges in turn.',
    p.spread ? `${plural(p.spread, 'scanned track moves', 'scanned tracks move')} off the crystal Deep Scan gave ${p.spread === 1 ? 'it' : 'them'}; Deep Scan's reading is kept.` : '',
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
  const parts = [
    p.spread ? `${plural(p.spread, 'scanned track', 'scanned tracks')} moved off Deep Scan's crystal` : '',
    p.given ? `${plural(p.given, 'track', 'tracks')} got a crystal` : '',
    p.moved + p.movedFailed ? `${plural(p.moved + p.movedFailed, 'assigned crystal', 'assigned crystals')} moved` : '',
  ].filter(Boolean);
  // v16.7.1: no way back in this release, so none is promised.
  const head = p.emptyAfter === 0 ? 'Tracks spread over all 27 crystals' : 'Tracks spread over the crystals';
  return `${head}: ${parts.length ? parts.join(', ') : 'every track keeps its crystal'}. ` + cover + ready + " Deep Scan's readings are kept.";
}
