// utils/tuning/trackTuning.ts (v16.8.3 "Track Tuning"): a track's tuning, a whole-cent shift from Standard.
//
//   Standard               every track plays at PITCH_SHIFT_FACTOR (432/440 of its speed, varispeed: constants.ts)
//   validTuning(s)         the cents of a tuning that holds together (an integer, 1 <= |c| <= 50, chosen for one of the
//                          27 crystals), else null: anything else is Standard
//   tuneRate(c)            PITCH_SHIFT_FACTOR × 2^(c / 1200); tuneRate(0) IS PITCH_SHIFT_FACTOR (the same float)
//   trackRate(s)           the one thing the protected rate path calls (App.tsx applyPlaybackRate's callers and the
//                          media session's rate): total, O(1), never throws, Standard for anything unexpected, clamped to
//                          tuneRate(±50). It never computes a fit and never reads a cache
//   fitShift(…)            the shift Track info offers for a crystal (the survey's rule c): the smallest |s| <= 50 whole
//                          cents whose rel (keyBands' own musicFit rel, the track heard at chromaA4Hz × tuneRate(s)) is at
//                          most 0.30, else the smallest at most 0.35, else null; the negative first on a tie; 0 means its
//                          key already fits at Standard
//   tuneLabel / tuneChip   "+23 cents" / "−14 cents" (a true minus), "Tuned +23 c"
//   withTrackTuning / tuneById   App's setTrackTuning's patch: the fields set together, or all removed
//
// A track with no tuning plays exactly as v16.8.2: trackRate gives PITCH_SHIFT_FACTOR itself, keyBands' content key and
// bands are v16.8.2's, Key fit's retune is PITCH_SHIFT_FACTOR, the export renders at it.
//
// The tone a fit is for is the crystal's canonical Solfeggio tone (solfeggioTone), the one keyBands places by, so Track
// info, keyBands and Key fit agree on what "fits" means. Amendment A1 (the user, 2026-11-07): with Lo Shu Perfect GUT on,
// the six crystals it swaps (174→75 … 639→630: canonicalLayerHz(f, true)) also offer a fit for the Lo Shu tone the
// device plays (loShuTone), stored as `tuneLoShu: true` beside the cents. It is a label only: the rate reads the cents
// alone, and placement stays at the 27 Solfeggio tones at the track's rate.
//
// Pure: no DOM, no React, no storage. Erasable TypeScript only, so Node runs tuning.check.ts on it directly.

import { PITCH_SHIFT_FACTOR } from '../../constants.ts';
import { ALL_CRYSTALS } from '../mix/distribution.ts';
import { musicFit, toneOf } from '../soundV2/aetheria_sound_v2.ts';
import { canonicalLayerHz } from '../soundV2/layerHost.ts';

/** The most a tuning may move a track from Standard, in cents (decision T2). */
export const TUNE_LIMIT_CENTS = 50;
/** The fit with its margin (rule c's first pass: the analyser's A4 error is a few cents). */
export const FIT_REL_MARGIN = 0.3;
/** A fit: Key fit's no-duck edge, keyBands' KEY_EDGES[0] (tuning.check pins that the two agree). */
export const FIT_REL_EDGE = 0.35;
/**
 * Decision T5: a change to the playing track's tuning switches its speed at once (App's setTrackTuning, through the
 * pinned applyPlaybackRate). If the Note 20's by-ear check finds a click, this turns false: the new rate then applies
 * from the track's next play, and Track info's note says "From the next play". The music is never ducked or faded.
 */
export const LIVE_TUNE_SWITCH = true;

/** What the rule reads of a track (a Song, a LibSong, a check's fixture). */
export interface TuneSong {
  tuneCents?: unknown;
  tuneFor?: unknown;
  /** A1: the tuning was chosen for the Lo Shu tone of `tuneFor` (one of the six Perfect GUT swaps). Never the rate. */
  tuneLoShu?: unknown;
}

const CRYSTALS = new Set<number>(ALL_CRYSTALS);

// ---- The tones (keyBands' Solfeggio tone; A1's Lo Shu tone) ---------------------------------------------------------

/** A crystal's canonical Solfeggio tone as keyBands places by and Key fit scores it for headphones:
 *  toneOf(canonicalLayerHz(f, false).f, 'headphones') (keyBands.ts TONES; tuning.check pins that the two agree). */
export function solfeggioTone(f: number): number {
  return CRYSTALS.has(f) ? toneOf(canonicalLayerHz(f, false).f, 'headphones') : 0;
}
/** A1: the Lo Shu Perfect GUT frequency a crystal plays as (75 for 174 …), or null for the 21 it doesn't swap. From
 *  canonicalLayerHz(f, true), never a literal (the shell's PERFECT_GUT_MAP is the same table: tuning.check). */
export function loShuHz(f: number): number | null {
  if (!CRYSTALS.has(f)) return null;
  const lo = canonicalLayerHz(f, true).f;
  return lo > 0 && lo !== canonicalLayerHz(f, false).f ? lo : null;
}
/** A1: the six crystals Lo Shu Perfect GUT swaps (ascending). */
export const LO_SHU_CRYSTALS: readonly number[] = ALL_CRYSTALS.filter((f) => loShuHz(f) !== null);
/** A1: the Lo Shu tone a swapped crystal plays, as Key fit scores it for an output (planOutputFor's: 'headphones',
 *  'speakers' — the car's too — or 'phone'; headphones when it isn't known); null for the other 21. Fix round 1 (S2):
 *  the phone's own speaker plays 75 and 186 an octave up (toneOf's floor), and Lo Shu never feeds placement, so Track
 *  info fits the tone the device plays. */
export function loShuTone(f: number, output: string = 'headphones'): number | null {
  const lo = loShuHz(f);
  return lo === null ? null : toneOf(lo, output);
}

/** The cents of a tuning that holds together, or null (Standard): `tuneCents` an integer with 1 <= |c| <=
 *  TUNE_LIMIT_CENTS, and `tuneFor` one of the 27 crystals. Each field is read once. */
export function validTuning(s: TuneSong | null | undefined): number | null {
  if (!s || typeof s !== 'object') return null;
  const c = s.tuneCents;
  const f = s.tuneFor;
  if (typeof c !== 'number' || !Number.isInteger(c) || c === 0 || c < -TUNE_LIMIT_CENTS || c > TUNE_LIMIT_CENTS) return null;
  if (typeof f !== 'number' || !CRYSTALS.has(f)) return null;
  return c;
}

/** A1: a valid tuning chosen for the Lo Shu tone: `tuneLoShu` exactly true and `tuneFor` one of the six. Never read by
 *  the rate (trackRate reads the cents only). */
export function validLoShu(s: TuneSong | null | undefined): boolean {
  if (validTuning(s) === null) return false;
  const x = s as TuneSong;
  return x.tuneLoShu === true && typeof x.tuneFor === 'number' && loShuHz(x.tuneFor) !== null;
}

/** The tuning fields a stored record restores with (playlistCache's toSong): both of a tuning that holds together, or
 *  none (garbage, a future version's, or one field without the other restores as Standard); A1: tuneLoShu: true only with
 *  them and only on one of the six (validLoShu). A record with no tuning gives no keys at all, so its Song is v16.8.2's.
 *  Fix round 1 (N5): each field is read once, into plain values that are then checked, so what is checked is what is
 *  kept (a record that throws when read restores as Standard). */
export function restoredTuning(meta: TuneSong | null | undefined): { tuneCents?: number; tuneFor?: number; tuneLoShu?: true } {
  if (!meta || typeof meta !== 'object') return {};
  let read: TuneSong;
  try {
    read = { tuneCents: meta.tuneCents, tuneFor: meta.tuneFor, tuneLoShu: meta.tuneLoShu };
  } catch {
    return {};
  }
  const c = validTuning(read);
  if (c === null) return {};
  const f = read.tuneFor as number;
  return validLoShu(read) ? { tuneCents: c, tuneFor: f, tuneLoShu: true } : { tuneCents: c, tuneFor: f };
}

/** The rate a shift of `c` cents from Standard plays at. 0 gives PITCH_SHIFT_FACTOR itself, never a recomputation. */
export function tuneRate(c: number): number {
  if (c === 0) return PITCH_SHIFT_FACTOR;
  return PITCH_SHIFT_FACTOR * Math.pow(2, c / 1200);
}

/** The slowest and fastest a tuning plays (tuneRate(∓TUNE_LIMIT_CENTS)): trackRate's clamp. */
export const TUNE_MIN_RATE = tuneRate(-TUNE_LIMIT_CENTS);
export const TUNE_MAX_RATE = tuneRate(TUNE_LIMIT_CENTS);

/**
 * The rate a track plays at: PITCH_SHIFT_FACTOR (the same float) for anything unexpected (null, undefined, no tuning, one
 * that doesn't hold together, an object that throws when read), else tuneRate of its cents, clamped to
 * [TUNE_MIN_RATE, TUNE_MAX_RATE]. Total and O(1): the protected swap calls it in its synchronous turn.
 */
export function trackRate(s: TuneSong | null | undefined): number {
  try {
    const c = validTuning(s);
    if (c === null) return PITCH_SHIFT_FACTOR;
    const r = tuneRate(c);
    if (!Number.isFinite(r)) return PITCH_SHIFT_FACTOR;
    return r < TUNE_MIN_RATE ? TUNE_MIN_RATE : r > TUNE_MAX_RATE ? TUNE_MAX_RATE : r;
  } catch {
    return PITCH_SHIFT_FACTOR;
  }
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Key data musicFit can read: 12 finite non-negative weights with a positive sum (keyFit's hasKeyData's rule). */
function usableChroma(chroma: unknown): chroma is number[] {
  if (!Array.isArray(chroma) || chroma.length !== 12) return false;
  let sum = 0;
  for (const w of chroma) {
    if (!fin(w) || w < 0) return false;
    sum += w;
  }
  return sum > 1e-9;
}

/** keyBands' rel of `toneHz` against the chroma, the track heard at chromaA4Hz × tuneRate(s) (bandsWith's own a4: the
 *  same product, so the same float). */
export function relAt(chroma: readonly number[], chromaA4Hz: number, toneHz: number, s: number): number {
  return musicFit(toneHz, chroma as number[], chromaA4Hz * tuneRate(s)).rel;
}

/**
 * The shift Track info offers for one crystal's tone (rule c): the smallest |s| <= limit, in whole cents, with rel <=
 * FIT_REL_MARGIN; else the smallest with rel <= FIT_REL_EDGE; else null. On a tie (−a and +a both qualify) the negative.
 * 0 is "its key already fits". A full scan in |s| order (0, −1, +1, −2, +2, …), stopping at the first margin fit: at most
 * 2·limit + 1 musicFit calls. Null for data it can't read (no usable chroma, A4 or tone).
 */
export function fitShift(chroma: unknown, chromaA4Hz: unknown, toneHz: unknown, limit: number = TUNE_LIMIT_CENTS): number | null {
  if (!usableChroma(chroma) || !fin(chromaA4Hz) || !(chromaA4Hz > 0) || !fin(toneHz) || !(toneHz > 0)) return null;
  const lim = fin(limit) ? Math.max(0, Math.min(TUNE_LIMIT_CENTS, Math.floor(limit))) : TUNE_LIMIT_CENTS;
  let edge: number | null = null;
  for (let a = 0; a <= lim; a++) {
    for (const s of a === 0 ? [0] : [-a, a]) {
      const rel = relAt(chroma, chromaA4Hz, toneHz, s);
      if (!fin(rel)) continue;
      if (rel <= FIT_REL_MARGIN) return s;
      if (edge === null && rel <= FIT_REL_EDGE) edge = s;
    }
  }
  return edge;
}

/**
 * Fix round 1 (S1): the shift Track info offers for a crystal's tone. A key that already fits it at Standard (rel(0) <=
 * FIT_REL_EDGE: keyBands' band 0, so the Crystal note's "Its key fits", and Key fit's no-duck edge) gets 0, "its key
 * already fits": a shift there would change nothing heard and only move placement (M1). Otherwise fitShift's rule c,
 * unchanged. Null for data it can't read, as fitShift.
 */
export function offeredShift(chroma: unknown, chromaA4Hz: unknown, toneHz: unknown, limit: number = TUNE_LIMIT_CENTS): number | null {
  const s = fitShift(chroma, chromaA4Hz, toneHz, limit);
  if (s === null || s === 0) return s;
  return relAt(chroma as number[], chromaA4Hz as number, toneHz as number, 0) <= FIT_REL_EDGE ? 0 : s;
}

const MINUS = '−';
/** A signed whole number with a true minus sign ("+23", "−14", "0"). */
export function signed(c: number): string {
  return c > 0 ? `+${c}` : c < 0 ? `${MINUS}${-c}` : '0';
}

/** "+23 cents", "−14 cents", "+1 cent". */
export function tuneLabel(c: number): string {
  return `${signed(c)} ${Math.abs(c) === 1 ? 'cent' : 'cents'}`;
}

/** Now Playing's chip: "Tuned +23 c". */
export function tuneChip(c: number): string {
  return `Tuned ${signed(c)} c`;
}

/** Fix round 1 (N2/N3): the chip's spoken name, from tuneLabel (the singular at ±1): "Tuned +1 cent", "Tuned −14 cents". */
export function tuneChipName(c: number): string {
  return `Tuned ${tuneLabel(c)}`;
}

/** Now Playing's chip for a track (decision T4): "Tuned −14 c" while its tuning is valid, else null (no chip). */
export function tuningChipText(s: TuneSong | null | undefined): string | null {
  const c = validTuning(s);
  return c === null ? null : tuneChip(c);
}

/** The words a screen reader says: "plus 23 cents", "minus 14 cents". */
export function tuneSpoken(c: number): string {
  const n = Math.abs(c);
  return `${c > 0 ? 'plus ' : c < 0 ? 'minus ' : ''}${n} ${n === 1 ? 'cent' : 'cents'}`;
}

/** How much faster (+) or slower (−) than Standard a shift plays, in percent: (2^(c/1200) − 1) × 100. */
export function speedPercent(c: number): number {
  return (Math.pow(2, c / 1200) - 1) * 100;
}

/** A track with this tuning: tuneCents and tuneFor set together (a valid tuning), plus tuneLoShu: true when `loShu` and
 *  the crystal is one of the six (A1); or every tuning field removed (null, or a tuning that doesn't hold together). A
 *  new object, never the same one. */
export function withTrackTuning<T extends object>(s: T, cents: number | null, forCrystal?: number | null, loShu = false): T {
  const { tuneCents, tuneFor, tuneLoShu, ...rest } = s as T & TuneSong;
  void tuneCents;
  void tuneFor;
  void tuneLoShu;
  const c = cents === null ? null : validTuning({ tuneCents: cents, tuneFor: forCrystal });
  if (c === null) return rest as T;
  return (loShu === true && loShuHz(forCrystal as number) !== null ? { ...rest, tuneCents: c, tuneFor: forCrystal, tuneLoShu: true } : { ...rest, tuneCents: c, tuneFor: forCrystal }) as T;
}

/** The list with the track of this id retuned (every repeat of it: a walk's included), or the same list when it holds
 *  none. Other tracks are the same objects. */
export function tuneById<T extends { id: string }>(list: T[], id: string, cents: number | null, forCrystal?: number | null, loShu = false): T[] {
  let out: T[] | null = null;
  for (let i = 0; i < list.length; i++) {
    if (!list[i] || list[i].id !== id) continue;
    if (!out) out = list.slice();
    out[i] = withTrackTuning(list[i], cents, forCrystal, loShu);
  }
  return out ?? list;
}
