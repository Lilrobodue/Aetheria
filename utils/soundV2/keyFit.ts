// utils/soundV2/keyFit.ts
//
// Key fit (v15.2, sound Phase 2b): a key-aware duck of the v2 layers. Some
// tracks hold notes that rub against the layers' tone; v2's design (its spec
// §3.3, "the fit's duck … applied to every layer", smoothed over 2 s) scores
// how rough the canonical tone sits under a track's key data and lowers the
// layers by 0 to 6 dB where it rubs. The fit is v2's own `musicFit`, imported,
// never copied; this module adds what the app needs around it:
//
// - keyFitFor: the fit of the CANONICAL tone (toneOf(crystal, output), never a
//   sham's) against a track's stored chroma, heard at A = chromaA4Hz × the
//   app's retune (every track plays varispeed at PITCH_SHIFT_FACTOR, so its
//   notes are heard that much lower), cached by content. No usable key data,
//   no duck.
// - keyFitView / keyFitLogFields: what the switch, the chip, the card and the
//   sound log read.
// - KeyFitDuck: one GainNode between the v2 player's output and the master
//   bus. It lowers the tone, beat and drone together (D1), by a target in
//   [−6, 0] dB: it can never raise a layer. The music never passes through it.
//
// The duck is automated like the player's own gains (layerSchedule.ts): only
// ParamTrack anchors and glides (setValueAtTime at the mirror's value,
// cancelScheduledValues 1.5 frames later, then setTargetAtTime), never
// cancelAndHoldAtTime, never a read of AudioParam.value, never a ramp. A rise
// never starts while a gate is falling (the player's A8 rule, applied to the
// one level outside the player): it waits for a retune's silence, a resting
// drone's close or a drone rest about to start (riseHoldFrom), and for App's
// own falls (a layer faded to off, a host glide: riseHold, which re-checks the
// rest guard where the rise will start), and App holds a rise in flight where
// it is when a fall starts elsewhere (holdRise). A fall sent while the layers
// are silent lands at once (setTarget's `silent`), so they never open above
// the level they settle at.
//
// No DOM at module scope, no App or constants.ts import. Erasable TypeScript
// only (no enums, namespaces or parameter properties), so Node runs
// keyFit.check.ts on it directly; type imports use `import type`.

import { musicFit, toneOf, DUCK_DB, DRONE_OUT_S, GATE_OUT_S } from './aetheria_sound_v2.ts';
import type { Fit } from './aetheria_sound_v2.ts';
import { ParamTrack, createAudioClock } from './layerSchedule.ts';
import type { ParamEvent } from './layerSchedule.ts';
import type { LayerPlayerState } from './layerPlayer.ts';

export const KEY_FIT_STORAGE_KEY = 'aetheria.keyFit.v1';
/** Key fit before it is ever tapped (D11). */
export const DEFAULT_KEY_FIT = false;
/** The duck's glide (spec §3.3, "smoothed over 2 s"), and the switch's (P2R-12: an A/B by ear needs it at once). */
export const DUCK_TAU_S = 2, DUCK_FLIP_TAU_S = 0.05;
/** A smaller change of target sends nothing (D3, D15). */
export const DUCK_MIN_STEP_DB = 0.01;
/** A rise never waits longer than this (review A2): the longest wait is a retune's 3.02 s (the drone's close and the
 *  20 ms gap) and then a drone rest that starts within DUCK_REST_GUARD_S of it, with its own 3 s close (6.52 s). */
export const DUCK_MAX_HOLD_S = 7;
/** A drone rest that starts within this of a rise holds the rise until the rest's close is over (critique M2(b)): a
 *  τ 2 s rise needs ≥ 0.45 s of head start on a 3 s close to stay monotone, a τ 0.05 s one ≥ 0.17 s. */
export const DUCK_REST_GUARD_S = 0.5;
/** After the playing track changes, a rise waits this long for App's level tick to see the new source and start the
 *  host's glide (review A3; the tick runs every 250 ms, at most once a second in a hidden page); the tick's own hold
 *  then takes over until the glide's end. */
export const DUCK_TRACK_HOLD_S = 1;
/** |duck| under this reads as "no change" in the copy (the duck itself is applied as computed). */
export const NO_DUCK_DB = 0.05;
export const FIT_CACHE_MAX = 64;
/** holdRise leaves a rise alone once it is this close to its target (dB): nothing audible is left of it. */
const HOLD_MIN_DB = 0.001;

/** The key fields of a Song (types.ts), as plain values. */
export interface KeyData { chroma?: unknown; chromaA4Hz?: number; keyConfidence?: number; musicKey?: string }

/** The fit of the canonical tone against a track. Frozen; cached results are shared. */
export interface KeyFit {
  /** Usable key data (D10). */
  hasChroma: boolean;
  /** toneOf(canonicalHz, output): the tone the layers play; 0 when there is none. */
  toneHz: number;
  /** chromaA4Hz × retune: the A the track's notes are heard at (D8); 0 without data. */
  a4Heard: number;
  /** musicFit's, unchanged but for −0 (0, 0, 0 without data or tone). */
  rel: number;
  strength: number;
  duck_db: number;
  /** musicKey ('' when unknown or flat). */
  key: string;
  keyConfidence: number | null;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** −0 → 0 (critique M1): musicFit's duck is −6 × 0 × strength = −0 wherever it does not duck. */
const z = (x: number): number => (x === 0 ? 0 : x);

/** 'true' → true, 'false' → false, anything else (null, '', '1', 'TRUE') → null (unset). */
export function parseKeyFit(raw: string | null): boolean | null {
  return raw === 'true' ? true : raw === 'false' ? false : null;
}

/** D10's gate: a plain Array of 12 finite, non-negative weights with a positive sum (above musicFit's own 1e-9 floor),
 *  and a finite chromaA4Hz > 0. Total. */
export function hasKeyData(s: KeyData | null | undefined): boolean {
  try {
    if (!s || typeof s !== 'object') return false;
    const c = s.chroma;
    if (!Array.isArray(c) || c.length !== 12) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const w = c[i];
      if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) return false;
      sum += w;
    }
    return sum > 1e-9 && isNum(s.chromaA4Hz) && s.chromaA4Hz > 0;
  } catch {
    return false;
  }
}

/** The cache's content key, at full precision (critique m15): every input musicFit reads, so equal keys are equal
 *  fits and a re-analysis that changes anything is a new entry. */
export function fitCacheKey(toneHz: number, a4Heard: number, conf: number, key: string, chroma: readonly number[]): string {
  return `${toneHz}|${a4Heard}|${conf}|${key}|${chroma.join(',')}`;
}

// ------------------------------------------------------------------ cache --

const cache = new Map<string, KeyFit>(); // insertion order = FIFO
let hits = 0, misses = 0;

export function clearKeyFitCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}

/** For the checks: entries now, and hits/misses since the last clear. */
export function keyFitCacheStats(): { size: number; hits: number; misses: number } {
  return { size: cache.size, hits, misses };
}

function frozen(f: KeyFit): KeyFit {
  return Object.freeze(f);
}

/**
 * The fit for a track on a crystal and plan output. Total: never throws.
 * - toneHz = canonicalHz > 0 && finite ? toneOf(canonicalHz, output) : 0.
 * - No usable key data, or retune not finite > 0: hasChroma false, rel/strength/duck 0, a4Heard 0; never cached.
 * - Data but toneHz 0 (a non-crystal frequency): hasChroma true, a4Heard set, rel/strength/duck 0; not cached.
 * - Otherwise musicFit(toneHz, chroma, chromaA4Hz × retune, keyConfidence ?? -1), wrapped (−0 → 0), frozen and cached
 *   (FIFO eviction past FIT_CACHE_MAX).
 * App passes PITCH_SHIFT_FACTOR as retune (D8) and planOutputFor(output) as output (D7).
 */
export function keyFitFor(s: KeyData | null | undefined, canonicalHz: number, output: string, retune: number): KeyFit {
  let toneHz = 0;
  try {
    toneHz = isNum(canonicalHz) && canonicalHz > 0 ? toneOf(canonicalHz, output) : 0;
    if (!isNum(toneHz) || toneHz < 0) toneHz = 0;
    const retuneOk = isNum(retune) && retune > 0;
    if (!s || !hasKeyData(s) || !retuneOk) return none(toneHz);
    const chroma = s.chroma as number[];
    const key = typeof s.musicKey === 'string' ? s.musicKey : '';
    const keyConfidence = isNum(s.keyConfidence) ? s.keyConfidence : null;
    const a4Heard = (s.chromaA4Hz as number) * retune;
    if (!(toneHz > 0)) {
      return frozen({ hasChroma: true, toneHz: 0, a4Heard, rel: 0, strength: 0, duck_db: 0, key, keyConfidence });
    }
    // musicFit's own reading of a missing confidence (−1: full strength); anything not a number reads the same.
    const conf = typeof s.keyConfidence === 'number' ? s.keyConfidence : -1;
    const ck = fitCacheKey(toneHz, a4Heard, conf, key, chroma);
    const hit = cache.get(ck);
    if (hit) {
      hits++;
      return hit;
    }
    misses++;
    const f: Fit = musicFit(toneHz, chroma, a4Heard, conf);
    const out = frozen({ hasChroma: true, toneHz, a4Heard, rel: z(f.rel), strength: z(f.strength), duck_db: z(f.duck_db), key, keyConfidence });
    cache.set(ck, out);
    while (cache.size > FIT_CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return out;
  } catch {
    return none(toneHz);
  }
}

function none(toneHz: number): KeyFit {
  return frozen({ hasChroma: false, toneHz, a4Heard: 0, rel: 0, strength: 0, duck_db: 0, key: '', keyConfidence: null });
}

/** 10^(db/20). */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

// ------------------------------------------------------------------- view --

export type KeyFitStatus = 'no-track' | 'no-data' | 'layers-off' | 'no-music' | 'unclear' | 'fits' | 'ducks';
export interface KeyFitView {
  on: boolean;
  status: KeyFitStatus;
  /** The fit's duck on this track (0 without data): what Key fit does here when the music plays. */
  wouldDb: number;
  /** The target App sends the duck: wouldDb when on, the duck there, with data, the layers wanted and the music
   *  playing; else 0. */
  appliedDb: number;
  fit: KeyFit | null;
  /** False when the duck could not be made (review B6): Key fit then changes nothing, whatever the switch says. */
  available: boolean;
  /** 'no-data' only: Analyse tracks has run on this track and stored no usable key data (an empty or too-short track,
   *  never retried: review B4), so running it again gives none. */
  analysed: boolean;
}

/**
 * status, in this order: no track → 'no-track'; no usable data → 'no-data'; layers not wanted → 'layers-off';
 * music not playing (tone alone) → 'no-music'; strength ≤ 0 → 'unclear'; duck_db > −NO_DUCK_DB → 'fits'; else 'ducks'.
 * `available` (default true) false: nothing applies (appliedDb 0). `analysed` (default false) is carried for 'no-data'.
 * Total (odd inputs give a view with status 'no-track' or 'no-data' and 0 dB). Never −0 (critique M1).
 */
export function keyFitView(o: { on: boolean; fit: KeyFit | null; hasTrack: boolean; musicPlaying: boolean; layersOn: boolean; available?: boolean; analysed?: boolean }): KeyFitView {
  try {
    const on = !!o && o.on === true;
    const available = !o || o.available !== false;
    if (!o || o.hasTrack !== true) return { on, status: 'no-track', wouldDb: 0, appliedDb: 0, fit: null, available, analysed: false };
    const fit = o.fit && typeof o.fit === 'object' ? o.fit : null;
    if (!fit || fit.hasChroma !== true) return { on, status: 'no-data', wouldDb: 0, appliedDb: 0, fit, available, analysed: o.analysed === true };
    const would = isNum(fit.duck_db) ? z(Math.min(0, Math.max(-DUCK_DB, fit.duck_db))) : 0;
    let status: KeyFitStatus;
    if (o.layersOn !== true) status = 'layers-off';
    else if (o.musicPlaying !== true) status = 'no-music';
    else if (!(isNum(fit.strength) && fit.strength > 0)) status = 'unclear';
    else if (would > -NO_DUCK_DB) status = 'fits';
    else status = 'ducks';
    const applies = on && available && o.layersOn === true && o.musicPlaying === true;
    return { on, status, wouldDb: would, appliedDb: applies ? would : 0, fit, available, analysed: false };
  } catch {
    return { on: false, status: 'no-track', wouldDb: 0, appliedDb: 0, fit: null, available: true, analysed: false };
  }
}

// ------------------------------------------------------------------ holds --

/** The later of two hold times (null = none). */
export function laterHold(a: number | null | undefined, b: number | null | undefined): number | null {
  const x = isNum(a) ? a : null, y = isNum(b) ? b : null;
  if (x === null) return y;
  if (y === null) return x;
  return x > y ? x : y;
}

/**
 * When a rise may start (D4), from the player's state at the call: the latest of
 *  - st.retune_at, when st.phase === 'retuning' and it is finite (the gates are exactly 0 there);
 *  - st.t + st.gates.drone × DRONE_OUT_S, when st.drone.resting and st.gates.drone > 0 (the rest's close);
 *  - st.drone.next_rest_at + DRONE_OUT_S, when that rest starts within DUCK_REST_GUARD_S of st.t (critique M2(b):
 *    the rise would still be under way when the drone's 3 s close begins);
 * else null. Null state, odd values → null. Pure.
 */
export function riseHoldFrom(st: LayerPlayerState | null | undefined): number | null {
  try {
    if (!st || typeof st !== 'object') return null;
    let h: number | null = null;
    if (st.phase === 'retuning' && isNum(st.retune_at)) h = laterHold(h, st.retune_at);
    const t = st.t, gd = st.gates ? st.gates.drone : NaN, dr = st.drone;
    if (dr && dr.resting === true && isNum(t) && isNum(gd) && gd > 0) h = laterHold(h, t + gd * DRONE_OUT_S);
    if (dr && isNum(t) && isNum(dr.next_rest_at) && dr.next_rest_at >= t && dr.next_rest_at - t <= DUCK_REST_GUARD_S) {
      h = laterHold(h, dr.next_rest_at + DRONE_OUT_S);
    }
    return h;
  } catch {
    return null;
  }
}

/** Critique M2(b): the switch's rise waits while the host glides (App's level tick glides it for 2 s after a seek, a
 *  track change or a φ toggle): the glide window's end on the duck's clock (`now` + what is left of it), or null. */
export function hostGlideHold(now: number, glideLeftS: number): number | null {
  return isNum(now) && isNum(glideLeftS) && glideLeftS > 0 ? now + glideLeftS : null;
}

/**
 * Review A3: after the playing track changes (at `trackAt` on the duck's clock), a rise waits DUCK_TRACK_HOLD_S for the
 * level tick to see the new source, and for the host glide that tick starts (`glideLeftS` of it left now): the later of
 * the two while the window is open, else null. Pure.
 */
export function trackHold(now: number, trackAt: number | null | undefined, glideLeftS: number): number | null {
  if (!isNum(now) || !isNum(trackAt) || !(now < trackAt + DUCK_TRACK_HOLD_S)) return null;
  return laterHold(trackAt + DUCK_TRACK_HOLD_S, hostGlideHold(now, glideLeftS));
}

/**
 * Review A2: the drone-rest guard of riseHoldFrom, for a rise that starts at `at` (≥ st.t) instead of now. The end of a
 * rest's close the rise would run into: a resting drone whose gate is still closing at `at` (st.t + gates.drone ×
 * DRONE_OUT_S > at), or the next rest when it starts before `at` + DUCK_REST_GUARD_S and its close is not over by `at`;
 * else null. At `at` = st.t it is riseHoldFrom's rest part exactly. Pure; odd values → null.
 */
export function restGuardAt(st: LayerPlayerState | null | undefined, at: number): number | null {
  try {
    if (!st || typeof st !== 'object' || !isNum(at)) return null;
    const t = st.t, gd = st.gates ? st.gates.drone : NaN, dr = st.drone;
    if (!isNum(t) || !dr) return null;
    let h: number | null = null;
    if (dr.resting === true && isNum(gd) && gd > 0 && t + gd * DRONE_OUT_S > at) h = t + gd * DRONE_OUT_S;
    const r = dr.next_rest_at;
    if (isNum(r) && r >= t && r - at <= DUCK_REST_GUARD_S && r + DRONE_OUT_S > at) h = laterHold(h, r + DRONE_OUT_S);
    return h;
  } catch {
    return null;
  }
}

/**
 * When a rise may start, all told: the latest of riseHoldFrom(st) and App's own holds in `extra` (a host glide's end,
 * a layer's fade to off: review A1, a track change the level tick has not seen yet: review A3), then moved past a drone
 * rest whose close a rise starting there would run into (restGuardAt: review A2). A hold already past (≤ st.t) holds
 * nothing: null when nothing holds. Without a state, the latest of `extra`. Pure.
 */
export function riseHold(st: LayerPlayerState | null | undefined, ...extra: Array<number | null | undefined>): number | null {
  let h = riseHoldFrom(st);
  for (const x of extra) h = laterHold(h, x);
  const t = st && typeof st === 'object' && isNum(st.t) ? st.t : null;
  if (h === null || t === null) return h;
  if (!(h > t)) return null;
  // One rest at most can meet a start (rests are 20 min apart); the loop only makes sure.
  for (let k = 0; k < 3; k++) {
    const g = restGuardAt(st, h);
    if (g === null || !(g > h)) break;
    h = g;
  }
  return h;
}

/**
 * Review A1: when a layer's fade to off ends, from the player's state just before setLayerGains(next): a tone or beat
 * user gain from above 0 to 0 under an open gate fades over GATE_OUT_S, the drone's over DRONE_OUT_S (the player's
 * applyUser). The later end, or null when no sounding layer goes off. A duck rise must not run through that fade. Pure.
 */
export function userFallEnd(st: LayerPlayerState | null | undefined, next: { tone?: number; beat?: number; drone?: number } | null | undefined): number | null {
  try {
    if (!st || typeof st !== 'object' || !next || typeof next !== 'object' || !isNum(st.t) || !st.gains || !st.gates) return null;
    const off = (k: 'tone' | 'beat' | 'drone'): boolean => next[k] === 0 && isNum(st.gains[k]) && st.gains[k] > 0;
    let h: number | null = null;
    if ((off('tone') || off('beat')) && isNum(st.gates.tone_beat) && st.gates.tone_beat > 0) h = st.t + GATE_OUT_S;
    if (off('drone') && isNum(st.gates.drone) && st.gates.drone > 0) h = laterHold(h, st.t + DRONE_OUT_S);
    return h;
  } catch {
    return null;
  }
}

/** Review A4: true when both gates are at exactly 0 now (opening from silence, or a retune's silent gap), so nothing
 *  the duck does is heard until they open. Pure; odd values → false. */
export function gatesSilent(st: LayerPlayerState | null | undefined): boolean {
  try {
    return !!st && typeof st === 'object' && !!st.gates && st.gates.tone_beat === 0 && st.gates.drone === 0;
  } catch {
    return false;
  }
}

/** When the duck's glide starts: holdUntil (capped at now + DUCK_MAX_HOLD_S) for a rise that must wait, else now. */
export function riseStart(o: { now: number; rising: boolean; holdUntil: number | null | undefined }): number {
  const now = o.now;
  if (!o.rising || !isNum(o.holdUntil) || !(o.holdUntil > now)) return now;
  return Math.min(o.holdUntil, now + DUCK_MAX_HOLD_S);
}

// -------------------------------------------------------------- sound log --

/** The sound log's Key fit fields (§11): numbers rounded (dB 2 dp, rel/strength/confidence 3 dp, Hz 2 dp), never −0. */
export interface KeyFitLogFields {
  key_fit: boolean;
  duck_db: number;
  fit_db: number | null;
  fit_rel: number | null;
  fit_strength: number | null;
  fit_tone_hz: number;
  fit_a4_hz: number | null;
  track_key: string | null;
  key_confidence: number | null;
}

const round = (x: number, dp: number): number => {
  if (!isNum(x)) return 0;
  const k = 10 ** dp;
  return z(Math.round(x * k) / k);
};

export function keyFitLogFields(v: KeyFitView): KeyFitLogFields {
  try {
    const fit = v && v.fit && typeof v.fit === 'object' ? v.fit : null;
    const data = !!fit && fit.hasChroma === true;
    return {
      key_fit: !!v && v.on === true,
      duck_db: v ? round(v.appliedDb, 2) : 0,
      fit_db: data ? round(v.wouldDb, 2) : null,
      fit_rel: data && fit ? round(fit.rel, 3) : null,
      fit_strength: data && fit ? round(fit.strength, 3) : null,
      fit_tone_hz: fit ? round(fit.toneHz, 2) : 0,
      fit_a4_hz: data && fit ? round(fit.a4Heard, 2) : null,
      track_key: data && fit ? fit.key : null,
      key_confidence: data && fit && isNum(fit.keyConfidence) ? round(fit.keyConfidence, 3) : null,
    };
  } catch {
    return { key_fit: false, duck_db: 0, fit_db: null, fit_rel: null, fit_strength: null, fit_tone_hz: 0, fit_a4_hz: null, track_key: null, key_confidence: null };
  }
}

// ------------------------------------------------------------------- duck --

export interface KeyFitDuckOptions {
  /** Default: () => ctx.currentTime for an OfflineAudioContext, createAudioClock(ctx) otherwise (layerPlayer's rule). */
  clock?: () => number;
  /** Default console.warn. Each distinct warning once. */
  warn?: (msg: string) => void;
}
export interface KeyFitDuckState {
  t: number;                  // the duck's clock now
  created_at: number;         // the clock when this duck was made (tests: the same duck across player disposals)
  target_db: number;          // the last target sent (0 = unity); a held rise's value after holdRise()
  tau_s: number;              // its τ (DUCK_FLIP_TAU_S for a fall sent while the layers were silent)
  start_at: number | null;    // when that glide starts (later than the call when a rise waited)
  hold_until: number | null;  // the hold the call carried (riseHoldFrom's value), or null
  value: number;              // the mirror's gain now
  requests: number;           // setTarget calls
  sends: number;              // setTarget calls that scheduled automation
  holds: number;              // holdRise calls (never counted in requests)
  held: number;               // holdRise calls that stopped a rise
  events: ParamEvent[];       // a copy of the mirror's events
}

function defaultClock(ctx: BaseAudioContext): () => number {
  // As layerPlayer.ts: an offline context's currentTime is the whole truth; a realtime one's can stall (Gecko).
  const offline = typeof OfflineAudioContext === 'function' && ctx instanceof OfflineAudioContext;
  return offline ? () => ctx.currentTime : createAudioClock(ctx);
}

export class KeyFitDuck {
  readonly ctx: BaseAudioContext;
  /** The player plays into this; it plays into `destination`. */
  readonly input: GainNode;
  private readonly track: ParamTrack;
  private readonly clock: () => number;
  private readonly warnFn: (msg: string) => void;
  private readonly warned = new Set<string>();
  private readonly createdAt: number;
  private isDisposed = false;
  private targetDb = 0;
  private tauS = DUCK_TAU_S;
  private startAt: number | null = null;
  private holdUntil: number | null = null;
  private lastSendT = -Infinity;
  private lastT = 0;
  private nRequests = 0;
  private nSends = 0;
  private nHolds = 0;
  private nHeld = 0;

  /** Creates the GainNode, sets gain.value = 1 through the setter BEFORE any automation, connects it to destination,
   *  and wraps the param in a ParamTrack (initial 1, ctx.sampleRate). Throws only if the node can't be made (App
   *  catches it and plays the layers straight into the bus). */
  constructor(ctx: BaseAudioContext, destination: AudioNode, o?: KeyFitDuckOptions) {
    const sr = ctx.sampleRate;
    if (!isNum(sr) || sr <= 0) throw new RangeError(`KeyFitDuck: sample rate ${sr} is not usable`);
    const opts = o ?? {};
    this.warnFn = opts.warn ?? ((msg: string) => console.warn(msg));
    const node = ctx.createGain();
    try {
      node.gain.value = 1;
      this.track = new ParamTrack(node.gain, 1, sr, (m: string) => this.warnOnce(m, m));
      node.connect(destination);
    } catch (err) {
      try {
        node.disconnect();
      } catch {
        /* never connected */
      }
      throw err;
    }
    this.ctx = ctx;
    this.input = node;
    this.clock = opts.clock ?? defaultClock(ctx);
    let t0 = 0;
    try {
      const c = this.clock();
      if (isNum(c) && c > 0) t0 = c;
    } catch {
      /* 0 */
    }
    this.createdAt = t0;
    this.lastT = t0;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Glide the duck toward `db` (clamped to [−6, 0] dB) with τ `tauS` (clamped to [0.01, 10] s; not a positive number:
   * DUCK_TAU_S). A change under DUCK_MIN_STEP_DB sends nothing, unless it is back to unity from a held value (review
   * A5: Key fit off is exactly 1). A rise (above the mirror's value now) waits for holdRiseUntil (at most
   * DUCK_MAX_HOLD_S): the duck holds where it is until then. A fall with `silent` (both gates at 0 now: gatesSilent)
   * glides with τ at most DUCK_FLIP_TAU_S, so it has landed by the time the gates open (review A4). A second call in the
   * same clock reading replaces the first. Never throws: a failure warns once and returns false. True when automation
   * was sent.
   */
  setTarget(db: number, o: { tauS: number; holdRiseUntil?: number | null; silent?: boolean }): boolean {
    this.nRequests++;
    if (this.isDisposed) {
      this.warnOnce('disposed:setTarget', 'KeyFitDuck.setTarget: the duck is disposed; nothing scheduled');
      return false;
    }
    try {
      if (!isNum(db)) {
        this.warnOnce('nan', `KeyFitDuck.setTarget: ${db} is not a level in dB; nothing scheduled`);
        return false;
      }
      const x = z(db < -DUCK_DB ? -DUCK_DB : db > 0 ? 0 : db);
      const t0 = o && isNum(o.tauS) && o.tauS > 0 ? o.tauS : DUCK_TAU_S;
      let tau = t0 < 0.01 ? 0.01 : t0 > 10 ? 10 : t0;
      const now = this.clock();
      if (!isNum(now) || now < 0) return false;
      this.lastT = now;
      // A5: a held value a hair under unity (holdRise) still goes back to exactly 1 when Key fit asks for unity.
      if (Math.abs(x - this.targetDb) < DUCK_MIN_STEP_DB && !(x === 0 && this.targetDb !== 0)) return false;
      this.track.prune(now - 1);
      // Two calls in one clock reading (two commits within a render quantum): the later replaces the earlier.
      if (now <= this.lastSendT) this.track.dropFrom(now);
      const g = dbToGain(x);
      const v = this.track.valueAt(now);
      if (o && o.silent === true && g < v - 1e-9 && tau > DUCK_FLIP_TAU_S) tau = DUCK_FLIP_TAU_S; // A4
      const hold = o && isNum(o.holdRiseUntil) ? o.holdRiseUntil : null;
      const start = riseStart({ now, rising: g > v + 1e-9, holdUntil: hold });
      if (start > now) {
        this.track.anchor(now); // hold where it is: a rise in flight stops here
        this.track.glide(start, g, tau);
      } else {
        this.track.glide(now, g, tau);
      }
      this.targetDb = x;
      this.tauS = tau;
      this.startAt = start;
      this.holdUntil = hold;
      this.lastSendT = now;
      this.nSends++;
      return true;
    } catch (err) {
      this.warnOnce('setTarget:failed', `KeyFitDuck.setTarget failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Critique M2(a): a fall is starting elsewhere (a pause, a stop, leaving v2, a retune, a seek's host glide, a layer
   * faded to off), so a rise in flight (or waiting) stops where it is now: a rise must never run on through a fall. With
   * `resumeAt` (a later time on this clock, from riseHold so a drone rest there is allowed for; capped at now +
   * DUCK_MAX_HOLD_S, never before a start already waiting) the rest of that rise glides from there toward the same
   * target with the same τ; without it the target becomes the held value, so the next setTarget sends. Nothing happens
   * when no rise is under way. Counted in `holds`, never in `requests`. True when it stopped a rise. Never throws.
   */
  holdRise(resumeAt?: number | null): boolean {
    this.nHolds++;
    if (this.isDisposed) {
      this.warnOnce('disposed:holdRise', 'KeyFitDuck.holdRise: the duck is disposed; nothing scheduled');
      return false;
    }
    try {
      const now = this.clock();
      if (!isNum(now) || now < 0) return false;
      this.lastT = now;
      const g = dbToGain(this.targetDb);
      if (!(this.track.valueAt(now) < g * dbToGain(-HOLD_MIN_DB))) return false; // no rise under way
      this.track.prune(now - 1);
      if (now <= this.lastSendT) this.track.dropFrom(now); // the same clock reading as the last call: replace it
      const r = isNum(resumeAt) && resumeAt > now ? resumeAt : null;
      if (r !== null) {
        const waiting = this.startAt !== null && this.startAt > now ? this.startAt : now;
        const start = Math.min(Math.max(r, waiting), now + DUCK_MAX_HOLD_S);
        this.track.anchor(now);
        this.track.glide(start, g, this.tauS);
        this.startAt = start;
        this.holdUntil = r;
      } else {
        const v = this.track.anchor(now);
        this.targetDb = z(Math.min(0, Math.max(-DUCK_DB, 20 * Math.log10(v))));
        this.startAt = now;
        this.holdUntil = null;
      }
      this.lastSendT = now;
      this.nHeld++;
      return true;
    } catch (err) {
      this.warnOnce('holdRise:failed', `KeyFitDuck.holdRise failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** A pure read of the mirror at clock(); works after dispose. */
  state(): KeyFitDuckState {
    let t = this.lastT;
    try {
      const c = this.clock();
      if (isNum(c) && c > t) t = c;
    } catch {
      /* keep the last time */
    }
    return {
      t, created_at: this.createdAt, target_db: this.targetDb, tau_s: this.tauS, start_at: this.startAt,
      hold_until: this.holdUntil, value: this.track.valueAt(t), requests: this.nRequests, sends: this.nSends,
      holds: this.nHolds, held: this.nHeld, events: this.track.events.map((e) => ({ ...e })),
    };
  }

  /** Disconnects `input` (try/catch); schedules nothing; idempotent. Later setTarget calls warn once and send nothing. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    try {
      this.input.disconnect();
    } catch {
      /* the context is gone */
    }
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    try {
      this.warnFn(msg);
    } catch {
      /* a broken warn must not throw into App */
    }
  }
}
