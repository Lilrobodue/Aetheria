// utils/tuning/compose.ts (v16.8.3 "Track Tuning": More › Compose for a crystal, decision T9; amendment A1)
//
// The composing guide's words and lines, from the static table (composeTable.ts, generated from the survey's
// measurement; nothing is computed here or on the device). Pure: Node checks it (tuning.check.ts).

import { ALL_CRYSTALS } from '../mix/distribution.ts';
import { COMPOSE_TABLE } from './composeTable.ts';
import type { ComposeEntry, ComposeOption, ComposeSet } from './composeTable.ts';
import { loShuHz, tuneLabel } from './trackTuning.ts';
import { toneOf } from '../soundV2/aetheria_sound_v2.ts';
import { canonicalLayerHz } from '../soundV2/layerHost.ts';

export const COMPOSE_TITLE = 'Compose for a crystal';
export const COMPOSE_ROW_SUBTITLE = 'The keys and DAW tunings that fit each crystal’s tone';
export const COMPOSE_LEAD = 'For each crystal, the keys and DAW tunings whose music fits its tone: in at least 6 of 7 styles, and still fitting 5 cents either side.';
export const COMPOSE_NOTE = 'Aetheria plays it at 432/440 of its speed. Leave Tuning on Standard for a track you tuned in your DAW.';
export const COMPOSE_EVIDENCE = 'A fixed table built from a measurement on synthetic music in 7 styles, not on your tracks.';
export const COMPOSE_NONE = 'No robust option within ±45 cents';
/** The Crystal sheet's link (it opens this page on the crystal). */
export const COMPOSE_LINK = 'Composing for this crystal';
/** Fix round 1 (N7): the picker's heading when the page opens on a crystal (its options come first). */
export const COMPOSE_ANOTHER = 'Another crystal';
/** Fix round 1 (S2): under a set whose tone the phone's own speaker plays an octave up (toneOf's 200 Hz floor). */
export const COMPOSE_PHONE_NOTE = "Worked out for headphones, speakers and the car. The phone's own speaker plays this tone an octave up, where the fit can differ.";

/** Fix round 1 (S2): the phone's own speaker plays this frequency's tone an octave up from the headphones' (and the
 *  speakers' and the car's, which plan as speakers): the table's options, worked out for that tone, can fit differently
 *  there. Computed from toneOf, never a list. */
export function phoneOctaveUp(hz: number): boolean {
  return Number.isFinite(hz) && hz > 0 && toneOf(hz, 'phone') !== toneOf(hz, 'headphones');
}
/** A crystal's Solfeggio tone on the phone's speaker differs (174 → 348). */
export function crystalPhoneDiffers(crystal: number): boolean {
  return ALL_CRYSTALS.includes(crystal) && phoneOctaveUp(canonicalLayerHz(crystal, false).f);
}
/** A1: a crystal's Lo Shu tone on the phone's speaker differs (75 → 300, 186 → 372). */
export function loShuPhoneDiffers(crystal: number): boolean {
  const lo = loShuHz(crystal);
  return lo !== null && phoneOctaveUp(lo);
}

/** The picker's three groups (GUT, HEART, HEAD), nine crystals each, in ALL_CRYSTALS order. */
export const COMPOSE_GROUPS: ReadonlyArray<{ id: 'gut' | 'heart' | 'head'; label: string; crystals: readonly number[] }> = [
  { id: 'gut', label: 'GUT', crystals: ALL_CRYSTALS.slice(0, 9) },
  { id: 'heart', label: 'HEART', crystals: ALL_CRYSTALS.slice(9, 18) },
  { id: 'head', label: 'HEAD', crystals: ALL_CRYSTALS.slice(18, 27) },
];

export function composeEntry(crystal: number): ComposeEntry | null {
  return COMPOSE_TABLE.find((e) => e.crystal === crystal) ?? null;
}

/** "F♯m": a key name with a true sharp sign. */
export function keyText(key: string): string {
  return key.replace('#', '♯');
}

/** "E · Set A4 to 436.5 Hz in your DAW · −14 cents". */
export function optionLine(o: ComposeOption): string {
  return `${keyText(o.key)} · Set A4 to ${o.hz.toFixed(1)} Hz in your DAW · ${tuneLabel(o.cents)}`;
}

/** "E, G, F♯m · Leave A4 at 440 Hz in your DAW · 0 cents": the keys at a plain 440, one line. */
export function at440Line(keys: readonly string[]): string {
  return `${keys.map(keyText).join(', ')} · Leave A4 at 440 Hz in your DAW · 0 cents`;
}

/** A set's lines: the keys at a plain 440 first (where there are any), then the options (one already said at 440 left
 *  out); or the one "none" line. */
export function composeLines(set: ComposeSet): string[] {
  const lines = set.at440.length ? [at440Line(set.at440)] : [];
  for (const o of set.options) if (!(o.cents === 0 && set.at440.includes(o.key))) lines.push(optionLine(o));
  return lines.length ? lines : [COMPOSE_NONE];
}

/** "Compose for 963 Hz". */
export function composeHeading(crystal: number): string {
  return `Compose for ${crystal} Hz`;
}

/** A1: "With Lo Shu Perfect GUT (75 Hz)". */
export function loShuHeading(hz: number): string {
  return `With Lo Shu Perfect GUT (${hz} Hz)`;
}

/** The crystal the page opens on: the one asked for, else the playing track's, else the crystal the layers play (its Lo
 *  Shu tone mapped back), else the first. Always one of the 27. */
export function composeStart(asked: number | null | undefined, trackHz: number | null | undefined, playingHz: number | null | undefined, perfectBack: (hz: number) => number): number {
  for (const f of [asked, trackHz, typeof playingHz === 'number' ? perfectBack(playingHz) : null]) if (typeof f === 'number' && ALL_CRYSTALS.includes(f)) return f;
  return ALL_CRYSTALS[0];
}
