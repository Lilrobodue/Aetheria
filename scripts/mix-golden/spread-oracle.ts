// scripts/mix-golden/spread-oracle.ts (v16.8.1; v16.8.2: the key band): the spread's rule, restated from the decisions,
// never shipped.
//
// The independent side of the v16.8.1 pins (utils/mix/source.check.ts, scorecap.check.ts, devices.check.ts, step 10 of
// scripts/check-mix-golden.mjs and e2e/tests/assign.spec.ts S2). It is written fresh from the rule, not from
// utils/mix/distribution.ts, and takes nothing from it but the stand-in (standInFreq: an unscanned track's estimate,
// out of scope by D5, pinned by distribution.check's checksum); the score is the old compatibility formula, copied from
// the frozen v16.7.1 copy (source.check compares the two byte for byte). The rule (decisions D2, D3, D3b):
//   - a track Deep Scan read at 2178 Hz (its reading's crystal is 2178) is a Source track: it goes on 2178, the scan's;
//   - a scan with no usable reading stays where it is ('stays' on one of the 27, counted there; 'left' off them);
//   - every other track is open: scored against each crystal from its reading's crystal, or its stand-in's (D5r: the
//     stand-in seeded by the file key, not the per-device id);
//   - the open tracks fill the crystals in turn (GUT, HEART, HEAD, ...), three rounds: in round L a crystal whose fill
//     (its 'stays' and open tracks, never a Source track) is under L takes the best open track left; then each track
//     left, in key order, goes to the best of the crystals with the smallest fill;
//   - "best": the lowest key band (v16.8.2, below), then the lowest score, then the file's hash, then the file key, then
//     the id (D2), compared in that order; in the balance, the lowest (band, score) of the crystals with the smallest fill;
//   - D3b: when the open tracks are fewer than the crystals with no 'stays' track, a 2178 holding Source tracks counts as
//     filled in round 1.
// v16.8.2 (decisions K1, K3, K5), the key band: a track with a clear key (key data of CHROMA_VERSION 1 that Key fit can
// read, a key name, a confidence of at least 0.45, a stored length of at most 720 s and a file of at most 100 MiB) has,
// on each crystal, Key fit's rel of the crystal's tone (the canonical one, folded for headphones: v2's toneOf) against
// its chroma heard at chromaA4Hz × 432/440 (v2's musicFit), cut at 0.35 / 0.55 / 0.75 into 0..3; any other track has
// 0.5 on every crystal (fix round 1: after a fitting track, before a partly fitting one). Fix round 2 (R1, the user's
// decision 2026-11-06): a clear-key track that is band 0 on no crystal at all compares as 0.25 on each crystal where its
// band is its lowest (after a fitting track, before a track with no key), and as its band elsewhere; only a real band 0
// counts as fitting. It takes musicFit and toneOf from the vendored v2 (as Key fit does) and restates the rest here.
// v16.8.3 (Track Tuning, M1: the user's decision T1): a track with a tuning (tuneCents an integer, 1 to 50 cents either way,
// and tuneFor one of the 27 crystals: both, or it is no tuning) is heard at chromaA4Hz × 432/440 × 2^(cents/1200), so its
// bands are cut there; a tuning never makes or unmakes a Source track (the reading is the file's) and tuneLoShu (A1) is
// never read. Restated here from the decision, never from utils/tuning.
// What it gives: each track's record after (closestSolfeggio, harmonicFreq, harmonicDeviation, crystalSource), each
// crystal's tracks (Source tracks included) and its fill (without them), the empty crystals, and each track's role.

import { GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS, getHarmonicSolfeggio } from '../../utils/crystalData.ts';
import { standInFreq } from '../../utils/mix/distribution.ts';
import { musicFit, toneOf } from '../../utils/soundV2/aetheria_sound_v2.ts';

export interface OracleSong {
  id: string;
  name: string;
  duration?: number;
  file?: { readonly name?: string; readonly size?: number };
  harmonicFreq?: number;
  closestSolfeggio?: number;
  harmonicDeviation?: number;
  crystalSource?: 'scan' | 'assigned';
  isAetheriaCandidate?: boolean;
  fractalAnalysis?: unknown;
  // v16.8.2: the key data, as Analyse tracks stores it.
  chroma?: unknown;
  chromaA4Hz?: number;
  musicKey?: string;
  keyConfidence?: number;
  chromaVersion?: number;
  // v16.8.3: the tuning, as Track info stores it.
  tuneCents?: unknown;
  tuneFor?: unknown;
}
export type OracleRecord = [closestSolfeggio: number | null, harmonicFreq: number | null, harmonicDeviation: number | null, crystalSource: string | null];
export type OracleRole = 'source' | 'stays' | 'left' | 'open';
export interface OracleResult {
  /** By id: the record after the spread. */
  after: Map<string, OracleRecord>;
  role: Map<string, OracleRole>;
  /** In the 27 crystals' ascending order: every track on the crystal, and the fill (no Source track). */
  perCrystal: number[];
  fill: number[];
  emptyAfter: number;
  /** The crystals pinned tracks hold (Source on 2178, 'stays' on their own) and the open tracks' count. */
  pinnedCrystals: number;
  open: number;
  /** v16.8.2: the open tracks with a clear key, and of them the ones that end on a crystal whose band is 0. */
  keyed: number;
  keyFits: number;
}

const SOURCE = 2178;
const CRYSTALS = [...GUT_CRYSTALS, ...HEART_CRYSTALS, ...HEAD_CRYSTALS];
const ORDER = GUT_CRYSTALS.flatMap((g, i) => [g, HEART_CRYSTALS[i], HEAD_CRYSTALS[i]]);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

// The rules the release leaves as they were, re-stated (as step 9 restates them).
const SCAN_FAILED = 999;
const MARK = 1000;
const CAP = 998;
function origin(s: OracleSong): string {
  if (s.crystalSource === 'assigned') return 'assigned';
  if (s.crystalSource === 'scan') return s.harmonicDeviation === SCAN_FAILED ? 'scan-failed' : 'scan';
  if ((typeof s.isAetheriaCandidate === 'boolean' || s.fractalAnalysis !== undefined) && fin(s.harmonicFreq)) {
    const rel = fin(s.closestSolfeggio) && fin(s.harmonicDeviation) && Math.abs(s.harmonicDeviation - Math.abs(s.harmonicFreq - s.closestSolfeggio)) < 1e-6;
    return rel ? 'scan' : 'scan-replaced';
  }
  if (s.harmonicDeviation === SCAN_FAILED) return 'scan-failed';
  return s.closestSolfeggio ? 'assigned' : 'none';
}
const marked = (s: OracleSong) =>
  s.crystalSource === 'assigned' && fin(s.harmonicFreq) && s.harmonicFreq > 0 && !!s.closestSolfeggio && fin(s.harmonicDeviation) &&
  s.harmonicDeviation >= MARK && Math.abs(s.harmonicDeviation - MARK - Math.abs(s.harmonicFreq - (s.closestSolfeggio as number))) < 1e-6;
const scanned = (s: OracleSong) => origin(s) === 'scan' || origin(s) === 'scan-replaced';
/** A usable Deep Scan reading: a scan's (kept, put back, or spread with the mark), above 0 Hz. */
const reading = (s: OracleSong) => (scanned(s) || marked(s)) && fin(s.harmonicFreq) && s.harmonicFreq > 0;
export const oracleReading = reading;
const memo = new Map<number, number>();
/** Deep Scan's crystal for a reading (getHarmonicSolfeggio, quietly). */
export const oracleScanCrystal = (hf: number): number => {
  let c = memo.get(hf);
  if (c === undefined) { c = getHarmonicSolfeggio(hf, true); memo.set(hf, c); }
  return c;
};
export function oracleRole(s: OracleSong): OracleRole {
  if (reading(s) && oracleScanCrystal(s.harmonicFreq as number) === SOURCE) return 'source';
  if (scanned(s) && !reading(s)) return CRYSTALS.includes(s.closestSolfeggio as number) ? 'stays' : 'left';
  return 'open';
}

// ---- 666132c:utils/mix/distribution.ts lines 158-176 (the old score, as the frozen copy holds it) ----
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
// ---- end of the copied lines ----

/** FNV-1a, 32 bits (the spread's hash of 'order:' + the file key). */
function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) for (let k = 0; k < ch.length; k++) { h ^= ch.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** The file's name and size, as the saved playlists fingerprint a track; the id without them. */
export const oracleFileKey = (s: OracleSong): string => (s.file && typeof s.file.name === 'string' && typeof s.file.size === 'number' ? `${s.file.name}|${s.file.size}` : s.id);

// ---- v16.8.2: the key band, restated ----
const EDGES = [0.35, 0.55, 0.75];
const NO_KEY = 0.5; // between "fits" (0) and "partly fits" (1): any value in (0, 1) gives the same plans
const BEST_OF_NONE = 0.25; // fix round 2 (R1): a track that fits nowhere, on its best crystals: between 0 and NO_KEY
const KEY_VERSION = 1; // CHROMA_VERSION
const MIN_CONFIDENCE = 0.45;
const MAX_SECONDS = 720; // the 8 GB phone's Analyse tracks caps, on every device
const MAX_BYTES = 100 * 1024 * 1024;
const HEARD = 0.981818; // the app's PITCH_SHIFT_FACTOR (constants.ts), its own literal: 432/440 differs by 1.9e-7 (fix round 1, L-N1)
const TUNE_LIMIT = 50; // v16.8.3 (T2): ±50 cents from Standard
/** v16.8.3: the cents of a tuning that holds together (an integer, 1..50 either way, chosen for one of the 27), or 0. */
export function oracleCents(s: OracleSong): number {
  const c = s.tuneCents, f = s.tuneFor;
  if (typeof c !== 'number' || !Number.isInteger(c) || c === 0 || Math.abs(c) > TUNE_LIMIT) return 0;
  return typeof f === 'number' && CRYSTALS.includes(f) ? c : 0;
}
/** v16.8.3: the rate a track is heard at: 432/440's literal, times 2^(cents/1200) for a tuned one (the same product the
 *  app forms, so the same float). */
export function oracleRate(s: OracleSong): number {
  const c = oracleCents(s);
  return c === 0 ? HEARD : HEARD * Math.pow(2, c / 1200);
}
/** A clear key: every condition of the rule. */
export function oracleClearKey(s: OracleSong): boolean {
  const c = s.chroma;
  if (s.chromaVersion !== KEY_VERSION || !Array.isArray(c) || c.length !== 12) return false;
  if (!c.every((w) => fin(w) && w >= 0) || !((c as number[]).reduce((a, b) => a + b, 0) > 1e-9)) return false;
  if (!fin(s.chromaA4Hz) || !(s.chromaA4Hz > 0)) return false;
  if (typeof s.musicKey !== 'string' || !s.musicKey.length) return false;
  if (!fin(s.keyConfidence) || s.keyConfidence < MIN_CONFIDENCE) return false;
  if (!fin(s.duration) || !(s.duration > 0) || s.duration > MAX_SECONDS) return false;
  const size = s.file?.size;
  return fin(size) && size >= 0 && size <= MAX_BYTES;
}
const bandMemo = new Map<string, number[]>();
/** The 27 bands (the crystals ascending) of a clear-key track, or null. Remembered by the A4 and the chroma. */
export function oracleBands(s: OracleSong): number[] | null {
  if (!oracleClearKey(s)) return null;
  const chroma = s.chroma as number[];
  const k = `${s.chromaA4Hz}|${chroma.join(',')}|${oracleCents(s)}`;
  let b = bandMemo.get(k);
  if (!b) {
    const heard = (s.chromaA4Hz as number) * oracleRate(s);
    b = CRYSTALS.map((c) => { const rel = musicFit(toneOf(c, 'headphones'), chroma, heard).rel; return rel <= EDGES[0] ? 0 : rel <= EDGES[1] ? 1 : rel <= EDGES[2] ? 2 : 3; });
    bandMemo.set(k, b);
  }
  return b;
}

export function spreadOracle(library: readonly OracleSong[]): OracleResult {
  const seen = new Set<string>();
  const lib = library.filter((s) => s && typeof s === 'object' && !seen.has(s.id) && !!seen.add(s.id));
  const after = new Map<string, OracleRecord>();
  const role = new Map<string, OracleRole>();
  const fill = new Map<number, number>(CRYSTALS.map((c) => [c, 0]));
  let sources = 0;
  type Cand = { s: OracleSong; measured: boolean; own: number; key: number; fk: string; score: Map<number, number>; band: Map<number, number>; keyed: boolean };
  const cands: Cand[] = [];
  const pinned = new Set<number>();
  for (const s of lib) {
    const r = oracleRole(s);
    role.set(s.id, r);
    const rec: OracleRecord = [s.closestSolfeggio ?? null, s.harmonicFreq ?? null, s.harmonicDeviation ?? null, s.crystalSource ?? null];
    if (r === 'source') {
      sources++;
      pinned.add(SOURCE);
      after.set(s.id, [SOURCE, s.harmonicFreq as number, Math.abs((s.harmonicFreq as number) - SOURCE), 'scan']);
    } else if (r === 'stays') {
      pinned.add(s.closestSolfeggio as number);
      fill.set(s.closestSolfeggio as number, fill.get(s.closestSolfeggio as number)! + 1);
      after.set(s.id, rec);
    } else if (r === 'left') {
      after.set(s.id, rec);
    } else {
      const m = reading(s);
      const own = m ? oracleScanCrystal(s.harmonicFreq as number) : 0;
      const fk = oracleFileKey(s);
      // D5r: an unmeasured track's stand-in, seeded by its file (the id without one).
      const match = m ? own : getHarmonicSolfeggio(standInFreq({ ...s, id: fk } as never), true);
      const bands = oracleBands(s);
      // (R1: no crystal fits it: its lowest band's crystals compare as BEST_OF_NONE. keyFits below reads this rank, not
      // the band; it is the same count, since only a band of 0 has a rank of 0: BEST_OF_NONE and NO_KEY are above 0.)
      const fitsSomewhere = !!bands && bands.some((v) => v === 0);
      const lowest = bands ? Math.min(...bands) : 0;
      const rankOf = (i: number) => (!bands ? NO_KEY : !fitsSomewhere && bands[i] === lowest ? BEST_OF_NONE : bands[i]);
      cands.push({ s, measured: m, own, fk, key: hash('order:' + fk), score: new Map(CRYSTALS.map((c) => [c, compatibility(match, c)])), band: new Map(CRYSTALS.map((c, i) => [c, rankOf(i)])), keyed: !!bands });
    }
  }
  // (hash, file key, id): a < b. (The band and the score come first, below.)
  const before = (a: Cand, b: Cand) => (a.key !== b.key ? a.key < b.key : a.fk !== b.fk ? a.fk < b.fk : a.s.id < b.s.id);
  let keyFits = 0;
  const put = (x: Cand, c: number) => {
    fill.set(c, fill.get(c)! + 1);
    if (x.keyed && x.band.get(c) === 0) keyFits++;
    const s = x.s, sc = x.score.get(c)!;
    if (!x.measured) after.set(s.id, [c, c, Math.min(sc, CAP), 'assigned']);
    else if (c === x.own) after.set(s.id, [c, s.harmonicFreq as number, Math.abs((s.harmonicFreq as number) - c), 'scan']);
    else after.set(s.id, [c, s.harmonicFreq as number, MARK + Math.abs((s.harmonicFreq as number) - c), 'assigned']);
  };
  let pool = cands.slice();
  const emptyFill = ORDER.filter((c) => fill.get(c) === 0).length;
  const d3b = sources > 0 && cands.length < emptyFill;
  for (let round = 1; round <= 3; round++) {
    for (const c of ORDER) {
      if (!pool.length) break;
      const have = fill.get(c)! + (round === 1 && d3b && c === SOURCE ? 1 : 0);
      if (have >= round) continue;
      let best = pool[0];
      for (const x of pool) {
        const db = x.band.get(c)! - best.band.get(c)!;
        if (db !== 0) { if (db < 0) best = x; continue; }
        const d = x.score.get(c)! - best.score.get(c)!;
        if (d < 0 || (d === 0 && before(x, best))) best = x;
      }
      pool = pool.filter((x) => x !== best);
      put(best, c);
    }
  }
  pool.sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  for (const x of pool) {
    const least = Math.min(...ORDER.map((c) => fill.get(c)!));
    let at = -1;
    const lower = (c: number, a: number) => x.band.get(c)! < x.band.get(a)! || (x.band.get(c) === x.band.get(a) && x.score.get(c)! < x.score.get(a)!);
    for (const c of ORDER) if (fill.get(c) === least && (at < 0 || lower(c, at))) at = c;
    put(x, at);
  }
  const fills = CRYSTALS.map((c) => fill.get(c)!);
  const perCrystal = CRYSTALS.map((c, i) => fills[i] + (c === SOURCE ? sources : 0));
  return { after, role, perCrystal, fill: fills, emptyAfter: perCrystal.filter((n) => n === 0).length, pinnedCrystals: pinned.size, open: cands.length, keyed: cands.filter((x) => x.keyed).length, keyFits };
}
