// utils/soundV2/layerHost.ts
//
// What App needs to drive the v2 layers, as pure functions Node can check
// (layerHost.check.ts): the persisted A/B choices, which crystal a selected
// frequency is, how an output shapes the layers, the slider and dB helpers,
// the adaptive band's hysteresis, and the music level the layers sit under.
//
// No DOM, no React, no App imports (two small App formulas are ported here,
// each cited). Erasable TypeScript only; type imports use `import type`.

import type { Band } from './aetheria_sound_v2.ts';
import { SOLFEGGIO, PERFECT_GUT, HEART, HEAD, frequencyOf, BAND_ORDER } from './aetheria_sound_v2.ts';
import type { BeatRender } from './layerSchedule.ts';
import { MAX_BOOST } from './layerSchedule.ts';

export type { BeatRender };
export { MAX_BOOST };

export type LayerEngine = 'classic' | 'v2';
export type LayerOutput = 'headphones' | 'speakers' | 'phone' | 'car';

/** What an unset profile plays: v2 since v15.0, after the user's by-ear A/B on headphones (2026-10-21). Classic stays
 *  selectable, and a saved choice of either engine holds whatever the default. */
export const DEFAULT_LAYER_ENGINE: LayerEngine = 'v2';
/** The v2 sub-bass drone switch before it is ever tapped. */
export const DEFAULT_DRONE_ENABLED = true;
// Written only from tap handlers, never from an effect: unset = the release default, so a default can still flip.
export const KEY_LAYER_ENGINE = 'aetheria.layerEngine.v1';
export const KEY_LAYER_OUTPUT = 'aetheria.layerOutput.v1';
export const KEY_DRONE_ENABLED = 'aetheria.droneEnabled.v1';
/** "Ask me again" pending: '1' from its tap until an answer (the sheet or the panel) clears it. The saved output stays
 *  beside it, in effect, so a restart before the answer keeps both; only meaningful while an output is saved. */
export const KEY_LAYER_OUTPUT_ASK_AGAIN = 'aetheria.layerOutputAskAgain.v1';
/** The tone and beat slider values that are 0 dB on the v2 layers (App's classic defaults, 1 % and 3 %). */
export const TONE_SLIDER_DEFAULT = 0.01;
export const BEAT_SLIDER_DEFAULT = 0.03;
/** The v2 sliders reach the +12 dB cap at 4 × their 0 dB value. */
export const V2_TONE_SLIDER_MAX = 0.04, V2_TONE_SLIDER_STEP = 0.0005, V2_BEAT_SLIDER_MAX = 0.12;
/** Classic's tone slider ("Layer Intensity") runs 0-1 (0-100 %). */
export const CLASSIC_TONE_SLIDER_MAX = 1;
// The tone level (the slider's value) is kept per engine (v15.0) and saved only from that engine's slider, by a user's
// move, never from an effect: unset = the engine's release default, so an untouched device follows the defaults.
export const KEY_TONE_LEVEL_V2 = 'aetheria.toneLevelV2.v1';
export const KEY_TONE_LEVEL_CLASSIC = 'aetheria.toneLevelClassic.v1';
/** v2's release default (v15.0): the lowest step before off, −26.0 dB on the validated level (−52.0 dB re music). */
export const V2_TONE_LEVEL_DEFAULT = V2_TONE_SLIDER_STEP;
/** Classic's release default, unchanged: its 1 %. */
export const CLASSIC_TONE_LEVEL_DEFAULT = 0.01;
/** The validated v2 levels under the music, for display only (the player uses the vendored LEVEL_* constants). */
export const TONE_REF_DB = -26, BEAT_REF_DB = -23, DRONE_REF_DB = -24;
/** Selected frequencies that are no crystal but still play, as themselves. */
export const NON_CANONICAL_EXCEPTIONS: readonly number[] = [111];

/** A stored engine choice: exactly 'classic' or 'v2', else null (unset). */
export function parseLayerEngine(raw: string | null): LayerEngine | null {
  return raw === 'classic' || raw === 'v2' ? raw : null;
}

/** A stored output answer: one of the four, else null (not answered yet). */
export function parseLayerOutput(raw: string | null): LayerOutput | null {
  return raw === 'headphones' || raw === 'speakers' || raw === 'phone' || raw === 'car' ? raw : null;
}

/** A stored "Ask me again": exactly '1' is a pending question, anything else none. */
export function parseOutputAskAgain(raw: string | null): boolean {
  return raw === '1';
}

/** A stored drone switch: 'true' or 'false', else null (never tapped). */
export function parseDroneEnabled(raw: string | null): boolean | null {
  return raw === 'true' ? true : raw === 'false' ? false : null;
}

/** The storage key of an engine's tone level. */
export function toneLevelKey(engine: LayerEngine): string {
  return engine === 'v2' ? KEY_TONE_LEVEL_V2 : KEY_TONE_LEVEL_CLASSIC;
}

/** An engine's tone level before its slider is ever moved. */
export function defaultToneLevel(engine: LayerEngine): number {
  return engine === 'v2' ? V2_TONE_LEVEL_DEFAULT : CLASSIC_TONE_LEVEL_DEFAULT;
}

/** A stored tone level: a number on that engine's slider (0 = off … its max), else null (unset). */
export function parseToneLevel(raw: string | null, engine: LayerEngine): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const v = Number(raw);
  const max = engine === 'v2' ? V2_TONE_SLIDER_MAX : CLASSIC_TONE_SLIDER_MAX;
  return Number.isFinite(v) && v >= 0 && v <= max ? v : null;
}

export interface CanonicalLayer {
  f: number;
  id: string | null;
  canonical: boolean;
}

/** c01..c27 in the vendored order: SOLFEGGIO c01-c09, HEART c10-c18, HEAD c19-c27. */
const CRYSTALS: readonly number[] = [...SOLFEGGIO, ...HEART, ...HEAD];

function indexOfHz(list: readonly number[], hz: number): number {
  for (let i = 0; i < list.length; i++) if (Math.abs(list[i] - hz) < 1e-6) return i;
  return -1;
}

/** The crystal a frequency is ('c01'..'c27'): a Solfeggio, HEART or HEAD value, else a Lo Shu Perfect value of
 *  c01-c06 (75, 186, 297, 408, 519, 630; 741, 852 and 963 are found as Solfeggio first), else null. */
export function crystalIdOf(hz: number): string | null {
  if (typeof hz !== 'number' || !Number.isFinite(hz)) return null;
  let i = indexOfHz(CRYSTALS, hz);
  if (i < 0) i = indexOfHz(PERFECT_GUT, hz);
  return i < 0 ? null : 'c' + String(i + 1).padStart(2, '0');
}

const warnedNonCanonical = new Set<number>();

/**
 * The frequency the v2 layers plan from. `selectedSolfeggio` holds raw Hz
 * (track starts, restore, presets) or Lo-Shu-mapped Hz (selectFrequency), so
 * the crystal is resolved first and then read on the scale in force: a Lo Shu
 * toggle re-plans all three layers. 111 Hz plays as itself (not a crystal);
 * anything else plays nothing (f 0), with one console.warn per value. Never
 * use harmonicFreq / closestSolfeggio as a pitch.
 */
export function canonicalLayerHz(selectedHz: number, perfectGut: boolean): CanonicalLayer {
  const id = crystalIdOf(selectedHz);
  if (id !== null) return { f: frequencyOf(id, perfectGut ? 'perfect' : 'solfeggio'), id, canonical: true };
  if (NON_CANONICAL_EXCEPTIONS.includes(selectedHz)) return { f: selectedHz, id: null, canonical: false };
  if (!warnedNonCanonical.has(selectedHz)) {
    warnedNonCanonical.add(selectedHz);
    console.warn(`Layers v2: ${selectedHz} Hz is not a crystal frequency; the v2 layers stay silent for it.`);
  }
  return { f: 0, id: null, canonical: false };
}

/** Headphones get the binaural pair; speakers and the phone speaker a gentle pulse; the car the tone only. */
export function renderForOutput(o: LayerOutput): BeatRender {
  return o === 'speakers' || o === 'phone' ? 'pulse' : o === 'car' ? 'off' : 'binaural';
}

/** The output the vendored plan() is asked for: the car plans as speakers (its tones equal headphones' for all 33). */
export function planOutputFor(o: LayerOutput): 'headphones' | 'speakers' | 'phone' {
  return o === 'car' ? 'speakers' : o === 'speakers' || o === 'phone' ? o : 'headphones';
}

/** The band of a binaural preset name ('Delta' → 'delta' …, constants.ts:263-269); anything else → 'alpha'. */
export function bandOfPresetName(name: string): Band {
  const b = typeof name === 'string' ? name.toLowerCase() : '';
  return (BAND_ORDER as readonly string[]).includes(b) ? (b as Band) : 'alpha';
}

/** b, or cap if b lies above it (by BAND_ORDER). */
export function capBand(b: Band, cap: Band): Band {
  const i = BAND_ORDER.indexOf(b), c = BAND_ORDER.indexOf(cap);
  if (c < 0) return b;
  return i < 0 || i > c ? cap : b;
}

/** A v2 slider's gain on the validated level: the slider over its default (1 = 0 dB), capped at +12 dB; 0 = off. */
export function sliderGain(v: number, d: number): number {
  if (!(v > 0) || !(d > 0)) return 0;
  return Math.min(v / d, MAX_BOOST);
}

/** A linear gain in dB; null for off (0, negative or not finite). */
export function gainToDb(g: number): number | null {
  return Number.isFinite(g) && g > 0 ? 20 * Math.log10(g) : null;
}

/** '+0.0 dB', '−26.0 dB' (U+2212), one decimal. Total, because it runs during App's render (no error boundary): any
 *  non-number or non-finite input gives '—'. */
export function formatDb(db: number): string {
  if (typeof db !== 'number' || !Number.isFinite(db)) return '\u2014';
  const r = Math.round(Math.abs(db) * 10) / 10;
  if (r === 0) return '+0.0 dB';
  return `${db < 0 ? '\u2212' : '+'}${r.toFixed(1)} dB`;
}

export interface EnvelopeLike {
  fps?: number;
  sub: ArrayLike<number>;
  bass: ArrayLike<number>;
  mid: ArrayLike<number>;
  high: ArrayLike<number>;
}

/**
 * The track's intensity (0..1) at t from its pre-scanned band envelope:
 * classic adaptive's own formula, ported verbatim (App.tsx:2856-2868) — the
 * mean of the four bands over the 1.5 s up to t, /255; samples outside the
 * envelope read 0, and no samples give 0. The one addition: a frame past the
 * envelope's end returns 0 at once (what the loop would sum), so a far-out or
 * non-finite t cannot spin.
 */
export function readIntensity(env: EnvelopeLike, t: number): number {
  const fps = env.fps || 20;
  const frame = Math.floor((t || 0) * fps);
  const win = Math.max(1, Math.round(fps * 1.5));
  if (!Number.isFinite(frame) || !Number.isFinite(win)) return 0;
  const n = Math.max(env.sub.length, env.bass.length, env.mid.length, env.high.length);
  if (frame - win >= n) return 0;
  let sum = 0, count = 0;
  for (let f = Math.max(0, frame - win); f <= frame; f++) {
    const s = env.sub[f] ?? 0, b = env.bass[f] ?? 0, m = env.mid[f] ?? 0, h = env.high[f] ?? 0;
    sum += (s + b + m + h) / 4;
    count++;
  }
  return count ? (sum / count) / 255 : 0;
}

/**
 * The v2 adaptive band's hysteresis, by direction: a step needs two ticks in
 * a row pointing the same way from the current band, and moves one band.
 * Different targets on the same side agree (alpha with targets delta, theta
 * steps to theta on the 2nd tick); a flip of direction restarts the count; a
 * target equal to the current band resets it.
 */
export class BandHysteresis {
  private dir = 0;

  tick(target: Band, current: Band): Band | null {
    const ti = BAND_ORDER.indexOf(target), ci = BAND_ORDER.indexOf(current);
    const s = ti < 0 || ci < 0 ? 0 : Math.sign(ti - ci);
    if (s === 0) {
      this.dir = 0;
      return null;
    }
    if (s !== this.dir) {
      this.dir = s;
      return null;
    }
    this.dir = 0;
    return BAND_ORDER[ci + s];
  }

  reset(): void {
    this.dir = 0;
  }
}

/**
 * How loud the music plays for a volume, which the v2 layers follow (host =
 * this × MUSIC_OUTPUT_LEVEL × the φ envelope). It mirrors
 * applyMusicElementVolume (App.tsx:2790-2804) without touching it: on a phone
 * the element runs at min(1, 1.6 v) and Chrome ducks it under the silent
 * anchor by an assumed 1/1.6, so the music is heard at min(v, 1/1.6); where
 * el.volume does not take (iOS reads 1 whatever is set) the element is at 1
 * and ducked: 1/1.6. With no music playing nothing is ducked (no anchor runs
 * while paused), so tone-only follows the volume on every device. The duck's
 * size and the iOS branch are unmeasured assumptions.
 */
export function musicGainFactor(
  volume: number,
  o: { musicPlaying: boolean; mobile: boolean; elementVolumeTakes: boolean; duckCompensation: number },
): number {
  const v = volume > 0 ? Math.min(volume, 1) : 0;
  const duck = Number.isFinite(o.duckCompensation) && o.duckCompensation > 0 ? 1 / o.duckCompensation : 1;
  if (!o.musicPlaying) return v;
  if (!o.elementVolumeTakes) return duck;
  return o.mobile ? Math.min(v, duck) : v;
}
