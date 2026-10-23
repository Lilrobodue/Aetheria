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
// Node loads this file for layerHost.check.ts and keyFit.check.ts: erasable
// TypeScript, no React, type-only imports apart from layerHost's dB helpers and
// reference levels and keyFit's NO_DUCK_DB.

import type { Band } from '../../utils/soundV2/aetheria_sound_v2.ts';
import type { BeatRender, LayerEngine, LayerOutput } from '../../utils/soundV2/layerHost.ts';
import type { LayerPhase, LayerPlayerState } from '../../utils/soundV2/layerPlayer.ts';
import type { KeyFitView } from '../../utils/soundV2/keyFit.ts';
import { formatDb, gainToDb, MAX_BOOST, TONE_REF_DB, BEAT_REF_DB } from '../../utils/soundV2/layerHost.ts';
import { NO_DUCK_DB } from '../../utils/soundV2/keyFit.ts';

/** What a helper shows when it has nothing to show (formatDb's fallback too). */
export const DASH = '—';

export const ENGINE_GROUP_LABEL = 'Layer sound: v2 / classic';
export const ENGINE_NOTE = 'v2 is the default. Classic stays available: compare the two by ear.';
/** Under classic (chosen): it has no output, so the panel says where Car is. */
export const CLASSIC_OUTPUT_NOTE =
  'Output and Car apply to v2. Classic plays its beat and drone whatever the output: for driving, use v2 with Car output, or Music only.';
/** The same, in a session where v2 has failed (v15.0.1): v2 with Car then plays no layers at all (App's v2CarFallback). */
export const CLASSIC_OUTPUT_NOTE_V2_FAILED =
  'Output and Car apply to v2, which is unavailable on this device. Classic plays its beat and drone whatever the output: ' +
  'for driving, choose v2 with Car output (the layers turn off), or Music only.';
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
/** The Output group's one line after a v2 failure (v15.0.1), in place of v2's descriptions: classic plays then, and
 *  has no Car render, so Car is the layers off (App's v2CarFallback). */
export const OUTPUT_V2_FAILED_NOTE =
  "v2 is unavailable on this device: Car turns the layers off; any other output plays classic's beat and drone.";
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
/** That Car fallback's cues (v15.0.1), as Music only's: the beat slider's title, a frequency tap's toast, and the warning
 *  for a recording that can't tap the music. */
export const BEAT_OFF_CAR_FALLBACK = 'Car: layers off (v2 unavailable)';
export const V2_UNAVAILABLE_CAR_TONE = 'v2 unavailable on this device. For Car output the layers are off, so the tone is silent.';
export const V2_UNAVAILABLE_CAR_RECORDING =
  "v2 unavailable on this device. For Car output the layers are off and the music can't be recorded here, so this recording will be silent.";

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

// ---------------------------------------------------------------- Key fit --
// Key fit (v15.2): the Harmonic Control card under the layer-sound card and the status-row chip beside the layers
// badge. App builds every string from keyFit.ts's view (keyFitView); each helper is total, like the rest of this file.
// "The layers", never "the tone, beat and drone": Car plays the tone alone, Speakers and Phone no drone, and the
// drone can be off (review B1).

export const KEY_FIT_LABEL = 'Key fit';
export const KEY_FIT_DESCRIPTION =
  'Lowers the layers by up to 6 dB on tracks whose notes would rub against the tone. ' +
  'The music is never changed. Uses the key data from Analyse tracks.';
export const KEY_FIT_EVIDENCE =
  "How much two tones rub is well-studied hearing science; using it to set the layers' level is a design choice.";

const KEY_FIT_STATUSES: readonly unknown[] = ['no-track', 'no-data', 'layers-off', 'no-music', 'unclear', 'fits', 'ducks'];
const isKeyFitView = (v: unknown): v is KeyFitView =>
  typeof v === 'object' && v !== null && KEY_FIT_STATUSES.includes((v as KeyFitView).status);
/** −3.1 → '3.1' (the copy puts its own U+2212 in front). */
const dbAbs = (x: number): string => (isNum(x) ? Math.abs(x).toFixed(1) : DASH);
/** 'C#m' → 'C# minor', 'C' → 'C major', '' → 'No clear key'. */
function keyName(k: unknown): string {
  if (typeof k !== 'string' || k === '') return 'No clear key';
  return k.endsWith('m') ? `${k.slice(0, -1)} minor` : `${k} major`;
}
/** On, but the duck could not be made (review B6): nothing applies. */
const unavailable = (v: KeyFitView): boolean => v.on === true && v.available === false;
/** Review B5: no duck here although the tone rubs, because the key is barely clear. musicFit's duck is −6 dB × the
 *  roughness term × strength (build spec §7), so the duck a clear key would get is wouldDb / strength. */
function faintKey(v: KeyFitView): boolean {
  const f = v.fit;
  if (!f || !isNum(f.strength) || !(f.strength > 0) || !isNum(v.wouldDb)) return false;
  return v.wouldDb > -NO_DUCK_DB && v.wouldDb / f.strength <= -NO_DUCK_DB;
}
/** The tooltip's first sentence for a track with key data: "C# major, confidence 0.90, heard at A = 432.0 Hz." */
function heardLine(v: KeyFitView): string {
  const f = v.fit;
  const conf = f && isNum(f.keyConfidence) ? f.keyConfidence.toFixed(2) : DASH;
  const a4 = f && isNum(f.a4Heard) ? f.a4Heard.toFixed(1) : DASH;
  return `${keyName(f ? f.key : '')}, confidence ${conf}, heard at A = ${a4} Hz.`;
}
/** Where the tone's roughness against the track sits between the smoothest (0 %) and the roughest (100 %) pitch in the
 *  octave around it (musicFit's rel, review B5): "The 528 Hz tone is 89 % of the way from the smoothest to the roughest
 *  pitch around it" */
function relLine(v: KeyFitView): string {
  const f = v.fit;
  const tone = f && isNum(f.toneHz) ? hz(f.toneHz) : DASH;
  const pct = f && isNum(f.rel) ? String(Math.round(f.rel * 100)) : DASH;
  return `The ${tone} Hz tone is ${pct} % of the way from the smoothest to the roughest pitch in the octave around it`;
}

/** The status-row chip (shown only while Key fit is on and the layers play): the duck that applies. */
export function keyFitChipText(v: KeyFitView): string {
  if (!isKeyFitView(v) || v.on !== true || v.status === 'layers-off') return 'Key fit off';
  if (unavailable(v)) return 'Key fit · unavailable';
  if (v.status === 'no-data') return 'Key fit · no key data';
  if (v.status === 'no-music' || v.status === 'no-track') return 'Key fit · tone alone';
  if (isNum(v.appliedDb) && v.appliedDb <= -NO_DUCK_DB) return `Key fit −${dbAbs(v.appliedDb)} dB`;
  return 'Key fit 0 dB';
}

/** The chip's tooltip: why it applies what it applies. */
export function keyFitChipTitle(v: KeyFitView): string {
  if (!isKeyFitView(v)) return KEY_FIT_LABEL;
  if (v.on !== true) return 'Key fit is off: the layers play at their set level.';
  if (unavailable(v)) return 'Key fit could not start on this device, so the layers play at their set level.';
  switch (v.status) {
    case 'no-data':
      return v.analysed === true
        ? 'Analyse tracks found no clear key in this track, so the layers stay at their set level.'
        : 'This track has no key data yet. Analyse tracks gives it some.';
    case 'no-music':
    case 'no-track':
      return 'No music is playing, so there is nothing to fit: the tone plays at its set level.';
    case 'unclear': {
      const f = v.fit;
      const conf = f && isNum(f.keyConfidence) ? f.keyConfidence.toFixed(2) : DASH;
      return `This track's key is unclear (confidence ${conf}), so the layers stay at their set level.`;
    }
    case 'fits':
      return faintKey(v)
        ? `${heardLine(v)} ${relLine(v)}, but the key is barely clear, so the layers stay at their set level.`
        : `${heardLine(v)} ${relLine(v)}: no change.`;
    case 'ducks':
      return `${heardLine(v)} ${relLine(v)}, so the layers are ${dbAbs(v.appliedDb)} dB softer.`;
    default:
      return 'The layers are off.';
  }
}

/** The chip's look: amber while it ducks, plain at 0, dashed without key data or without the duck. */
export function keyFitChipTone(v: KeyFitView): 'duck' | 'plain' | 'none' {
  if (!isKeyFitView(v)) return 'none';
  if (v.status === 'no-data' || unavailable(v)) return 'none';
  return v.on === true && isNum(v.appliedDb) && v.appliedDb <= -NO_DUCK_DB ? 'duck' : 'plain';
}

/** The Harmonic Control card's status line: what Key fit does on the playing track, or would do while off. */
export function keyFitRowText(v: KeyFitView): string {
  if (!isKeyFitView(v)) return 'Off.';
  const on = v.on === true;
  if (unavailable(v)) return 'On. Key fit could not start on this device, so the layers play at their set level.';
  switch (v.status) {
    case 'no-track':
      return on ? 'On. Play a track to see how it fits.' : 'Off.';
    case 'no-data':
      if (v.analysed === true) {
        return on ? 'On. Analyse tracks found no clear key in this track: no change.' : 'Off. Analyse tracks found no clear key in this track.';
      }
      return on ? 'On. This track has no key data yet: run Analyse tracks.' : 'Off. This track has no key data yet.';
    case 'no-music':
      return on ? 'On. No music is playing, so the tone plays at its set level.' : 'Off.';
    default: {
      // 'layers-off' (Music only, paused, Safety Mute, a frequency with no crystal tone), 'unclear', 'fits', 'ducks'.
      const f = v.fit;
      const layersOff = v.status === 'layers-off';
      if (!f || !(isNum(f.toneHz) && f.toneHz > 0)) return on ? 'On. The layers are off now, so it changes nothing.' : 'Off.';
      if (!(isNum(f.strength) && f.strength > 0)) {
        return on ? "On. This track's key is unclear, so it changes nothing." : "Off. This track's key is unclear, so it would change nothing.";
      }
      if (!(isNum(v.wouldDb) && v.wouldDb <= -NO_DUCK_DB)) {
        if (faintKey(v)) {
          return on ? "On. This track's key is barely clear, so it changes nothing." : "Off. This track's key is barely clear, so it would change nothing.";
        }
        return on ? 'On. The tone sits well with this track: no change.' : 'Off. The tone sits well with this track: it would change nothing.';
      }
      if (!on) return `Off. On this track it would make the layers ${dbAbs(v.wouldDb)} dB softer.`;
      return layersOff
        ? `On. The layers are off now; on this track they would be ${dbAbs(v.wouldDb)} dB softer.`
        : `On. On this track the layers are ${dbAbs(v.wouldDb)} dB softer.`;
    }
  }
}
