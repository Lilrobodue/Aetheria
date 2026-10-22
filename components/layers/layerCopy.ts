// components/layers/layerCopy.ts
//
// The words of the "Layer sound: v2 / classic" A/B (v14.9, build spec §11; v2
// the default since v15.0) and the small helpers that build them from App's
// state. Classic strings are not here: App keeps its v14.7 markup for every
// classic branch.
//
// Every helper is total. They run during App's render, and App has no error
// boundary yet (index.tsx), so a throw would unmount the root and the pinned
// unmount cleanup would stop the music (I10): null, undefined, NaN, ±Infinity,
// 0, negatives and unknown bands, renders or outputs all give a string.
//
// Node loads this file for layerHost.check.ts: erasable TypeScript, no React,
// type-only imports apart from layerHost's dB helpers and reference levels.

import type { Band } from '../../utils/soundV2/aetheria_sound_v2.ts';
import type { BeatRender, LayerEngine, LayerOutput } from '../../utils/soundV2/layerHost.ts';
import type { LayerPhase, LayerPlayerState } from '../../utils/soundV2/layerPlayer.ts';
import { formatDb, gainToDb, MAX_BOOST, TONE_REF_DB, BEAT_REF_DB } from '../../utils/soundV2/layerHost.ts';

/** What a helper shows when it has nothing to show (formatDb's fallback too). */
export const DASH = '—';

export const ENGINE_GROUP_LABEL = 'Layer sound: v2 / classic';
export const ENGINE_NOTE = 'v2 is the default. Classic stays available: compare the two by ear.';
/** Under classic (chosen): it has no output, so the panel says where Car is. */
export const CLASSIC_OUTPUT_NOTE =
  'Output and Car apply to v2. Classic plays its beat and drone whatever the output: for driving, use v2 with Car output, or Music only.';
export const ENGINE_ORDER: readonly LayerEngine[] = ['classic', 'v2'];
export const ENGINE_LABELS: Readonly<Record<LayerEngine, string>> = { classic: 'Classic', v2: 'v2' };

export const OUTPUT_GROUP_LABEL = 'Output';
export const OUTPUT_ORDER: readonly LayerOutput[] = ['headphones', 'speakers', 'phone', 'car'];
export const OUTPUT_LABELS: Readonly<Record<LayerOutput, string>> = {
  headphones: 'Headphones',
  speakers: 'Speakers',
  phone: 'Phone speaker',
  car: 'Car',
};
export const OUTPUT_DESCRIPTIONS: Readonly<Record<LayerOutput, string>> = {
  headphones: 'Binaural beat + sub-bass drone. Both earbuds in; mono audio and spatial audio off.',
  speakers: 'A gentle pulse instead of the beat; no drone.',
  phone: "A gentle pulse; the tone moves up into the phone's range; no drone.",
  car: 'Tone only.',
};
export const OUTPUT_ASSUMED = '(assumed)';
export const OUTPUT_ASSUMED_NOTE = 'Not answered yet: playing as headphones.';
/** After "Ask me again", until an answer: the output in effect stays (it is not "assumed"), still saved, so a restart
 *  keeps it and the question (App's outputAskedAgain). */
export const OUTPUT_ASKED_AGAIN_NOTE = 'Asked again: the current output stays until you answer.';
export const HEADPHONES_HINT =
  'Binaural beats need headphones with both earbuds in, and mono audio and spatial audio turned off.';

export const DRONE_LABEL = 'Sub-bass drone';
export const DRONE_DESCRIPTION = '−24 dB. Fades in over 8 s and out over 3 s; rests 10 min after 20 min.';
export const DRONE_HEADPHONES_ONLY = 'Headphones only.';
export const ASK_AGAIN_LABEL = 'Ask me again';
/** The question comes when the layers are wanted (App's v2Wanted), not at a play: under Music only it waits for them.
 *  The output in effect stays saved until the answer, across restarts (OUTPUT_ASKED_AGAIN_NOTE). */
export const ASK_AGAIN_DESCRIPTION =
  "Asks again which output you're using, now or when the layers next play. " +
  'Your current output stays until you answer.';
export const EXPORT_LOG_LABEL = 'Export sound log';
export const V2_UNAVAILABLE = 'v2 unavailable on this device: classic is playing.';
/** v2's failure with Car in effect: classic has no Car render, so its layers stay off (App's classicLayerGain). */
export const V2_UNAVAILABLE_CAR = 'v2 unavailable on this device. For Car output the layers are off; only the music plays.';

export const SHEET_HEADING = 'What are you listening on?';
export const SHEET_BODY =
  'The layers are shaped for your output. Change it any time with the layers button in the player.';
export const SHEET_LATER = 'Ask me later';
export const QUICK_SWITCH_LABEL = 'Layer sound and output';

export const TONE_LEVEL_LABEL = 'Tone level';
export const BEAT_LEVEL_LABEL = 'Beat level';
export const PRESETS_NOTE_V2 =
  'Adaptive stops at Beta; Gamma is a manual choice. Off headphones the beat is a gentle pulse, capped at Alpha.';
/** The presets note under Car, whose render is off: no beat, no pulse, no adaptive band. */
export const PRESETS_NOTE_CAR_V2 = 'Car: tone only, so there is no beat or pulse.';
export const GAMMA_DESCRIPTION_V2 =
  'Gamma (40 Hz) is a design choice: the MIT 40 Hz work used light flicker and click trains, not binaural beats, ' +
  'and above about 30 Hz a binaural beat is heard as two tones rather than a beat.';
export const PHI_LEVELS_V2 = 'Layer levels: tone −26, beat −23, drone −24 dB under the music (fixed; φ ratios are classic only)';
export const PHI_BINAURAL_V2 = 'Binaural: carrier left, partner right (no phase offset)';
export const PHI_ENVELOPE_V2 = 'One continuous envelope on every layer: 0 → 0.8 at 38.2% → 1 at 61.8% → 0.8 at the end';
export const KEEP_COMFORTABLE_V2 = '• Keep the layers comfortable (v2 plays an audible octave)';
export const SOUND_LOG_SAVE_FAILED =
  'The sound log could not be saved (storage may be full). Export it from Harmonic Control.';
export const CLASSIC_TOOLTIP = 'Classic layers (v2 is the default). Tap to compare with v2.';

const BAND_NAMES: Readonly<Record<Band, string>> = { delta: 'Delta', theta: 'Theta', alpha: 'Alpha', beta: 'Beta', gamma: 'Gamma' };
const BADGE_V2: Readonly<Record<LayerOutput, string>> = {
  headphones: 'Layers v2 · Headphones',
  speakers: 'Layers v2 · Speakers (pulse)',
  phone: 'Layers v2 · Phone (pulse)',
  car: 'Layers v2 · Car (tone only)',
};

const isOutput = (o: unknown): o is LayerOutput => o === 'headphones' || o === 'speakers' || o === 'phone' || o === 'car';
const isBand = (b: unknown): b is Band => typeof b === 'string' && Object.prototype.hasOwnProperty.call(BAND_NAMES, b);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Hz for display: at most two decimals, no trailing zeros (274, 26.63, 240.75). */
const hz = (x: number): string => String(Math.round(x * 100) / 100);

/** The status-row badge. `layerHz` is the canonical frequency v2 plans from (111 is played but no crystal). After a v2
 *  failure classic plays, except for Car, where the layers are off. */
export function layersBadgeText(engine: LayerEngine, v2Failed: boolean, output: LayerOutput | null, layerHz: number): string {
  if (engine !== 'v2') return 'Layers classic';
  if (v2Failed) return output === 'car' ? 'Layers off · Car · v2 unavailable' : 'Layers classic · v2 unavailable';
  const base = isOutput(output) ? BADGE_V2[output] : 'Layers v2 · Headphones (assumed)';
  return layerHz === 111 ? `${base} · 111 Hz non-canonical` : base;
}

/** The band chip in v2: the beat actually delivered. Classic (and anything unreadable) shows the preset's name, as
 *  v14.7 did. */
export function bandChipText(v2: boolean, presetName: string, render: BeatRender, presetBand: Band, planBand: Band): string {
  const classic = typeof presetName === 'string' ? presetName : DASH;
  if (!v2) return classic;
  if (render === 'off') return 'Beat off';
  if (!isBand(planBand)) return classic;
  if (render === 'pulse') return `Pulse · ${BAND_NAMES[planBand]}${presetBand !== planBand ? ' (capped)' : ''}`;
  return render === 'binaural' ? BAND_NAMES[planBand] : classic;
}

/** "+3.0 dB · −23.0 dB re music": the offset from the validated level, then the level under the music;
 *  "(max)" at the +12 dB cap. */
function levelReadout(g: number, refDb: number): string {
  const capped = g >= MAX_BOOST * (1 - 1e-9);
  const offset = gainToDb(capped ? MAX_BOOST : g);
  if (offset === null) return DASH;
  return `${formatDb(offset)}${capped ? ' (max)' : ''} · ${formatDb(refDb + offset)} re music`;
}

/** The v2 tone slider's readout, from its gain on the validated level (1 = 0 dB): "+0.0 dB · −26.0 dB re music";
 *  "off" at 0. */
export function toneReadout(g: number): string {
  if (!isNum(g)) return DASH;
  return g > 0 ? levelReadout(g, TONE_REF_DB) : 'off';
}

/** The v2 beat slider's title and aria-valuetext, for the output's render: "Beat …" (binaural), "Pulse …" (pulse),
 *  "Car: tone only" (off). */
export function beatReadout(g: number, render: BeatRender): string {
  if (render === 'off') return 'Car: tone only';
  const name = render === 'pulse' ? 'Pulse' : render === 'binaural' ? 'Beat' : null;
  if (name === null || !isNum(g)) return DASH;
  return g > 0 ? `${name} ${levelReadout(g, BEAT_REF_DB)}` : `${name} off`;
}

/** The v2 line for a high-order crystal: the octave v2 actually plays. Anything unreadable falls back to the classic
 *  line (App renders the classic markup itself whenever v2 has no tone to name). */
export function feltLineV2(selectedHz: number, toneHz: number): string {
  const sel = isNum(selectedHz) ? String(selectedHz) : DASH;
  if (!isNum(toneHz) || toneHz <= 0) return `High frequency detected (${sel}Hz). Focus on feeling rather than hearing.`;
  return `High-order frequency (${sel} Hz). v2 plays its octave ${hz(toneHz)} Hz: an audible tone under the music.`;
}

/**
 * What the badge's tooltip and the sound log read from the player: its state at the last phase or drone-rest
 * transition (onState), never state() during a render (heat). Hz are the sounding voice's, else the requested one's.
 */
export interface LayerStatus {
  phase: LayerPhase;
  key: string;
  render: BeatRender | null;
  tone: number;
  carrier: number;
  partner: number;
  beat: number;
  drone: number;
  /** The drone's own pulse (its AM rate). */
  pulse: number;
  resting: boolean;
  mono: boolean;
}

const STATUS_KEYS: readonly (keyof LayerStatus)[] = [
  'phase', 'key', 'render', 'tone', 'carrier', 'partner', 'beat', 'drone', 'pulse', 'resting', 'mono',
];
const hzOf = (x: unknown): number => (isNum(x) && x > 0 ? x : 0);

/** The status for a player state; `prev` itself when nothing changed, so an unchanged transition re-renders
 *  nothing. Safe in a state updater (pure). */
export function mergeLayerStatus(prev: LayerStatus | null, s: LayerPlayerState | null | undefined): LayerStatus | null {
  if (!s || typeof s !== 'object') return prev;
  const v = s.sounding ?? s.requested ?? null;
  const next: LayerStatus = {
    phase: s.phase,
    key: v && typeof v.key === 'string' ? v.key : '',
    render: v ? v.render : null,
    tone: hzOf(v?.tone_hz),
    carrier: hzOf(v?.carrier_hz),
    partner: hzOf(v?.partner_hz),
    beat: hzOf(v?.beat_hz),
    drone: hzOf(v?.drone_hz),
    pulse: hzOf(v?.pulse_hz),
    resting: !!s.drone?.resting,
    mono: !!s.mono_output,
  };
  if (prev && STATUS_KEYS.every((k) => prev[k] === next[k])) return prev;
  return next;
}

/** The badge's tooltip: classic's invitation, or what v2 is sounding ("Sounding: tone 528 Hz, beat 264/274 Hz,
 *  drone 33 Hz · drone resting · mono output: pulse"; absent parts omitted); after a v2 failure, the panel's notice
 *  for `output`. */
export function layersTooltip(engine: LayerEngine, v2Failed: boolean, status: LayerStatus | null, output?: LayerOutput | null): string {
  if (engine !== 'v2') return CLASSIC_TOOLTIP;
  if (v2Failed) return output === 'car' ? V2_UNAVAILABLE_CAR : V2_UNAVAILABLE;
  if (!status || typeof status !== 'object') return 'Sounding: nothing yet';
  const parts: string[] = [];
  if (status.phase !== 'silent' && status.phase !== 'disposed') {
    if (status.tone > 0) parts.push(`tone ${hz(status.tone)} Hz`);
    if (status.render !== 'off' && status.carrier > 0) {
      parts.push(status.partner > 0 ? `beat ${hz(status.carrier)}/${hz(status.partner)} Hz` : `beat ${hz(status.carrier)} Hz`);
    }
    if (status.drone > 0) parts.push(`drone ${hz(status.drone)} Hz`);
  }
  let text = parts.length > 0 ? `Sounding: ${parts.join(', ')}` : 'Sounding: nothing';
  if (status.resting) text += ' · drone resting';
  if (status.mono) text += ' · mono output: pulse';
  return text;
}
