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
}

/**
 * The whole plan. Kept as they are: Deep Scan's crystals (one an older Auto-Distribute changed is put back) and the
 * crystals Assign placed before (anchors). Placed: the tracks with no crystal, failed scans and an older
 * Auto-Distribute's placeholders, empty crystals first, then balanced.
 */
export function planAssign(library: readonly AssignSong[]): AssignPlan {
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
      const bestMatch = getHarmonicSolfeggio(est);
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

// ---- the words ------------------------------------------------------------------------------------------------------
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Tracks this Assign places (they become assigned, not scanned). */
const placed = (p: AssignPlan) => p.given + p.moved + p.movedFailed + p.unchanged;

/** Assign asks first only when crystals that tracks already have would change. */
export function assignNeedsConfirm(p: AssignPlan): boolean {
  return p.moved + p.movedFailed + p.restored > 0;
}

/** The confirmation (the new layout's health card), each sentence only when its count is above 0. */
export function assignConfirmText(p: AssignPlan): { title: string; body: string } {
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
  return `Every track already has its crystal (${p.kept} from Deep Scan, ${p.anchored + p.unchanged} assigned).`;
}

/** What Assign did: the classic notice (the new layout routes it to the status toast). */
export function assignDoneText(p: AssignPlan): string {
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
