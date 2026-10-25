// components/shell/layers/soundModel.ts (v15.6, the Layers tab)
//
// What the new layout's Sound section shows, as one pure view of LayerSoundPanel's props (App's one memoised
// layerPanelProps object, shared with classic). Its rules are LayerSoundPanel.tsx's, copied, not imported: classic's
// panel keeps its text byte for byte, and the new section renders this view with the kit in the Quiet look. Which
// groups show, each choice's look (pressed: raised with a check; dashed: the unchosen default, the assumed output and
// an output asked again; plain), and which notes show, with layerCopy's words unchanged. soundModel.check.ts runs the
// 160 states of engine × chosen × output × v2 failed × asked again × drone against the panel's rules written out.

import type { LayerEngine, LayerOutput } from '../../../utils/soundV2/layerHost.ts';
import {
  ENGINE_GROUP_LABEL,
  ENGINE_NOTE,
  CLASSIC_OUTPUT_NOTE,
  CLASSIC_OUTPUT_NOTE_V2_FAILED,
  ENGINE_ORDER,
  ENGINE_LABELS,
  OUTPUT_GROUP_LABEL,
  OUTPUT_ORDER,
  OUTPUT_LABELS,
  OUTPUT_DESCRIPTIONS,
  OUTPUT_V2_FAILED_NOTE,
  OUTPUT_ASSUMED,
  OUTPUT_ASSUMED_NOTE,
  OUTPUT_ASKED_AGAIN_NOTE,
  HEADPHONES_HINT,
  DRONE_LABEL,
  DRONE_DESCRIPTION,
  DRONE_HEADPHONES_ONLY,
  ASK_AGAIN_LABEL,
  ASK_AGAIN_DESCRIPTION,
  EXPORT_LOG_LABEL,
  V2_UNAVAILABLE,
  V2_UNAVAILABLE_CAR,
} from '../../layers/layerCopy.ts';

/** LayerSoundPanel's state props (its handlers are passed through untouched). */
export interface SoundState {
  engine: LayerEngine;
  engineChosen: boolean;
  v2Failed: boolean;
  output: LayerOutput | null;
  askedAgain: boolean;
  droneEnabled: boolean;
  musicOnly: boolean;
  canExportLog: boolean;
}

export interface SoundChoice<T extends string> {
  id: T;
  label: string;
  /** aria-pressed (the panel's own value). */
  pressed: boolean;
  /** Outlined, not raised: the unchosen default, the assumed output, an output asked again. */
  dashed: boolean;
}

export interface SoundSectionView {
  musicOnly: { label: 'Music only'; description: string; checked: boolean };
  engine: { label: string; note: string; choices: SoundChoice<LayerEngine>[] };
  /** Under classic: where Output and Car are (v2's). */
  classicNote: string | null;
  /** After a v2 failure this session. */
  v2Unavailable: string | null;
  /** The Output group (v2, and after a v2 failure with its one line). */
  output: { label: string; badge: string | null; choices: SoundChoice<LayerOutput>[]; notes: string[] } | null;
  /** v2 plays: the hint, the drone switch, Ask me again. */
  headphonesHint: string | null;
  drone: { label: string; description: string; checked: boolean; usable: boolean } | null;
  askAgain: { label: string; description: string } | null;
  /** Export sound log (the tab, as Harmonic Control's panel variant; never in the sheet). */
  exportLog: string | null;
}

export const MUSIC_ONLY_DESCRIPTION = 'Tone, beat and drone off. The music plays on. Saved.';

/** The Sound section's view. `withExport`: the tab (as the panel variant); the sheet has none (as the popover). */
export function soundSectionView(p: SoundState, withExport: boolean): SoundSectionView {
  // LayerSoundPanel.tsx: v2Shown, outputShown, carFallback, droneUsable, shownOutput.
  const v2Shown = p.engine === 'v2' && !p.v2Failed;
  const outputShown = p.engine === 'v2';
  const carFallback = p.engine === 'v2' && p.v2Failed && p.output === 'car';
  const droneUsable = p.output === null || p.output === 'headphones';
  const shownOutput: LayerOutput = p.output ?? 'headphones';

  const engineChoices = ENGINE_ORDER.map((e) => {
    const pressed = p.engine === e;
    return { id: e, label: ENGINE_LABELS[e], pressed, dashed: pressed && !p.engineChosen };
  });

  let output: SoundSectionView['output'] = null;
  if (outputShown) {
    const choices = OUTPUT_ORDER.map((o) => {
      const selected = p.output === o;
      const assumed = p.output === null && o === 'headphones';
      // The panel: selected && !askedAgain → solid; selected || assumed → dashed; else plain.
      return { id: o, label: OUTPUT_LABELS[o], pressed: selected, dashed: (selected && p.askedAgain) || (!selected && assumed) };
    });
    const notes: string[] = [];
    if (p.v2Failed) notes.push(OUTPUT_V2_FAILED_NOTE);
    else {
      notes.push(OUTPUT_DESCRIPTIONS[shownOutput]);
      if (p.output === null) notes.push(OUTPUT_ASSUMED_NOTE);
      if (p.output !== null && p.askedAgain) notes.push(OUTPUT_ASKED_AGAIN_NOTE);
    }
    output = {
      label: OUTPUT_GROUP_LABEL,
      badge: p.output === null ? `${OUTPUT_LABELS.headphones} ${OUTPUT_ASSUMED}` : null,
      choices,
      notes,
    };
  }

  return {
    musicOnly: { label: 'Music only', description: MUSIC_ONLY_DESCRIPTION, checked: p.musicOnly },
    engine: { label: ENGINE_GROUP_LABEL, note: ENGINE_NOTE, choices: engineChoices },
    classicNote: p.engine === 'classic' ? (p.v2Failed ? CLASSIC_OUTPUT_NOTE_V2_FAILED : CLASSIC_OUTPUT_NOTE) : null,
    v2Unavailable: p.v2Failed ? (carFallback ? V2_UNAVAILABLE_CAR : V2_UNAVAILABLE) : null,
    output,
    headphonesHint: v2Shown ? HEADPHONES_HINT : null,
    drone: v2Shown
      ? { label: DRONE_LABEL, description: droneUsable ? DRONE_DESCRIPTION : DRONE_HEADPHONES_ONLY, checked: p.droneEnabled, usable: droneUsable }
      : null,
    askAgain: v2Shown && p.output !== null && !p.askedAgain ? { label: ASK_AGAIN_LABEL, description: ASK_AGAIN_DESCRIPTION } : null,
    exportLog: withExport && p.canExportLog ? EXPORT_LOG_LABEL : null,
  };
}

/** Every visible string of a view, in reading order (the same-words check against classic's panel). */
export function viewStrings(v: SoundSectionView): string[] {
  const out: string[] = [v.musicOnly.label, v.musicOnly.description, v.engine.label, ...v.engine.choices.map((c) => c.label), v.engine.note];
  if (v.classicNote) out.push(v.classicNote);
  if (v.v2Unavailable) out.push(v.v2Unavailable);
  if (v.output) {
    out.push(v.output.label);
    if (v.output.badge) out.push(v.output.badge);
    out.push(...v.output.choices.map((c) => c.label), ...v.output.notes);
  }
  if (v.headphonesHint) out.push(v.headphonesHint);
  if (v.drone) out.push(v.drone.label, v.drone.description);
  if (v.askAgain) out.push(v.askAgain.description, v.askAgain.label);
  if (v.exportLog) out.push(v.exportLog);
  return out;
}
