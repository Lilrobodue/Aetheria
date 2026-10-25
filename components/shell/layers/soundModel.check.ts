// Checks for components/shell/layers/soundModel.ts (v15.6, the Layers tab): the new Sound section shows exactly what
// classic's LayerSoundPanel shows, in every state.
// Run with: node components/shell/layers/soundModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.
//
// The 160 states are engine (2) × chosen (2) × output (null + 4) × v2 failed (2) × asked again (2) × drone (2). The
// reference below is LayerSoundPanel.tsx's JSX conditions written out by hand, one per element it renders, in its
// order (lines 88-250), with the class each choice gets turned into a look; then a handful of states are spelled out
// in full, row by row, as the panel shows them.

import { soundSectionView, viewStrings, MUSIC_ONLY_DESCRIPTION } from './soundModel.ts';
import type { SoundState } from './soundModel.ts';
import * as C from '../../layers/layerCopy.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

type Look = 'solid' | 'dashed' | 'plain';
const lookOf = (c: { pressed: boolean; dashed: boolean }): Look => (c.dashed ? 'dashed' : c.pressed ? 'solid' : 'plain');

/** What LayerSoundPanel renders for a state (variant 'panel' when `panel`), element by element. */
function panelReference(p: SoundState, panel: boolean) {
  const out: string[] = [];
  const looks: string[] = [];
  const pressed: string[] = [];
  // The Music-only row: always, its title and line.
  out.push('Music only', 'Tone, beat and drone off. The music plays on. Saved.');
  // The engine group: its label, the two buttons (Classic, v2), the note.
  out.push(C.ENGINE_GROUP_LABEL, 'Classic', 'v2', C.ENGINE_NOTE);
  for (const e of ['classic', 'v2'] as const) {
    const isPressed = p.engine === e;
    // pressed ? (engineChosen ? indigo-500/20 : dashed indigo-500/10) : slate-900
    looks.push(`engine ${e}: ${isPressed ? (p.engineChosen ? 'solid' : 'dashed') : 'plain'}`);
    pressed.push(`engine ${e}: ${isPressed}`);
  }
  // {engine === 'classic' && <p classic-output-note>{v2Failed ? …_V2_FAILED : …}</p>}
  if (p.engine === 'classic') out.push(p.v2Failed ? C.CLASSIC_OUTPUT_NOTE_V2_FAILED : C.CLASSIC_OUTPUT_NOTE);
  // {v2Failed && <p v2-unavailable>{carFallback ? V2_UNAVAILABLE_CAR : V2_UNAVAILABLE}</p>}
  if (p.v2Failed) out.push(p.engine === 'v2' && p.output === 'car' ? C.V2_UNAVAILABLE_CAR : C.V2_UNAVAILABLE);
  // {outputShown && <div role=group Output>…}: outputShown = engine === 'v2'
  if (p.engine === 'v2') {
    out.push('Output');
    if (p.output === null) out.push('Headphones (assumed)');
    out.push('Headphones', 'Speakers', 'Phone speaker', 'Car');
    for (const o of ['headphones', 'speakers', 'phone', 'car'] as const) {
      const selected = p.output === o;
      const assumed = p.output === null && o === 'headphones';
      // selected && !askedAgain ? solid : selected || assumed ? dashed : plain
      looks.push(`output ${o}: ${selected && !p.askedAgain ? 'solid' : selected || assumed ? 'dashed' : 'plain'}`);
      pressed.push(`output ${o}: ${selected}`);
    }
    if (p.v2Failed) out.push(C.OUTPUT_V2_FAILED_NOTE);
    else {
      out.push(C.OUTPUT_DESCRIPTIONS[p.output ?? 'headphones']);
      if (p.output === null) out.push(C.OUTPUT_ASSUMED_NOTE);
      if (p.output !== null && p.askedAgain) out.push(C.OUTPUT_ASKED_AGAIN_NOTE);
    }
  }
  // {v2Shown && <>hint, drone row, {output !== null && !askedAgain && ask-again row}</>}: v2Shown = v2 && !v2Failed
  let drone: { checked: boolean; disabled: boolean } | null = null;
  if (p.engine === 'v2' && !p.v2Failed) {
    out.push(C.HEADPHONES_HINT);
    const usable = p.output === null || p.output === 'headphones';
    out.push(C.DRONE_LABEL, usable ? C.DRONE_DESCRIPTION : C.DRONE_HEADPHONES_ONLY);
    drone = { checked: p.droneEnabled, disabled: !usable };
    if (p.output !== null && !p.askedAgain) out.push(C.ASK_AGAIN_DESCRIPTION, C.ASK_AGAIN_LABEL);
  }
  // {isPanel && canExportLog && <button>Export sound log</button>}
  if (panel && p.canExportLog) out.push(C.EXPORT_LOG_LABEL);
  return { out, looks, pressed, drone, musicOnlyChecked: p.musicOnly };
}

function viewReadout(p: SoundState, withExport: boolean) {
  const v = soundSectionView(p, withExport);
  return {
    out: viewStrings(v),
    looks: [
      ...v.engine.choices.map((c) => `engine ${c.id}: ${lookOf(c)}`),
      ...(v.output ? v.output.choices.map((c) => `output ${c.id}: ${lookOf(c)}`) : []),
    ],
    pressed: [
      ...v.engine.choices.map((c) => `engine ${c.id}: ${c.pressed}`),
      ...(v.output ? v.output.choices.map((c) => `output ${c.id}: ${c.pressed}`) : []),
    ],
    drone: v.drone ? { checked: v.drone.checked, disabled: !v.drone.usable } : null,
    musicOnlyChecked: v.musicOnly.checked,
  };
}

let states = 0;
for (const engine of ['classic', 'v2'] as const) {
  for (const engineChosen of [false, true]) {
    for (const output of [null, 'headphones', 'speakers', 'phone', 'car'] as const) {
      for (const v2Failed of [false, true]) {
        for (const askedAgain of [false, true]) {
          for (const droneEnabled of [false, true]) {
            const p: SoundState = { engine, engineChosen, output, v2Failed, askedAgain, droneEnabled, musicOnly: droneEnabled, canExportLog: engineChosen };
            const tag = JSON.stringify(p);
            for (const panel of [true, false]) {
              const want = panelReference(p, panel);
              const got = viewReadout(p, panel);
              eq(got.out, want.out, `${panel ? 'tab' : 'sheet'} words ${tag}`);
              eq(got.looks, want.looks, `looks ${tag}`);
              eq(got.pressed, want.pressed, `aria-pressed ${tag}`);
              eq(got.drone, want.drone, `drone switch ${tag}`);
              eq(got.musicOnlyChecked, want.musicOnlyChecked, `music only ${tag}`);
            }
            states++;
          }
        }
      }
    }
  }
}
eq(states, 160, 'every state checked');

// A few states in full, as the panel shows them (hand-written rows).
const base: SoundState = { engine: 'v2', engineChosen: false, output: null, v2Failed: false, askedAgain: false, droneEnabled: true, musicOnly: false, canExportLog: false };
// 1. A new profile: v2 by default (dashed), headphones assumed (dashed, not pressed), the drone usable, no Ask me again.
{
  const v = soundSectionView(base, true);
  eq(v.engine.choices.map(lookOf), ['plain', 'dashed'], 'new profile: v2 is the dashed default');
  eq(v.output!.badge, 'Headphones (assumed)', 'new profile: the assumed badge');
  eq(v.output!.choices.map(lookOf), ['dashed', 'plain', 'plain', 'plain'], 'new profile: headphones dashed');
  eq(v.output!.choices.map((c) => c.pressed), [false, false, false, false], 'new profile: nothing pressed');
  eq(v.output!.notes, [C.OUTPUT_DESCRIPTIONS.headphones, C.OUTPUT_ASSUMED_NOTE], 'new profile: the notes');
  eq(v.drone, { label: C.DRONE_LABEL, description: C.DRONE_DESCRIPTION, checked: true, usable: true }, 'new profile: the drone');
  eq(v.askAgain, null, 'new profile: no Ask me again');
  eq(v.exportLog, null, 'new profile: no export (no engine chosen)');
  eq(v.musicOnly.description, MUSIC_ONLY_DESCRIPTION, 'the Music-only line');
}
// 2. v2 chosen, Speakers: the drone off headphones is unusable, with its reason; Ask me again; Export (tab only).
{
  const p = { ...base, engineChosen: true, output: 'speakers' as const, canExportLog: true };
  const v = soundSectionView(p, true);
  eq(v.engine.choices.map(lookOf), ['plain', 'solid'], 'v2 chosen: solid');
  eq(v.output!.choices.map(lookOf), ['plain', 'solid', 'plain', 'plain'], 'Speakers pressed');
  eq(v.drone!.usable, false, 'Speakers: the drone is unusable');
  eq(v.drone!.description, C.DRONE_HEADPHONES_ONLY, 'Speakers: its reason');
  eq(v.askAgain?.label, C.ASK_AGAIN_LABEL, 'Ask me again shows');
  eq(v.exportLog, C.EXPORT_LOG_LABEL, 'the tab exports');
  eq(soundSectionView(p, false).exportLog, null, 'the sheet does not');
}
// 3. Asked again with Car saved: Car pressed but outlined, its note, no Ask me again.
{
  const v = soundSectionView({ ...base, engineChosen: true, output: 'car', askedAgain: true }, true);
  eq(v.output!.choices.map(lookOf), ['plain', 'plain', 'plain', 'dashed'], 'asked again: Car dashed');
  eq(v.output!.choices.map((c) => c.pressed), [false, false, false, true], 'asked again: Car still pressed');
  eq(v.output!.notes, [C.OUTPUT_DESCRIPTIONS.car, C.OUTPUT_ASKED_AGAIN_NOTE], 'asked again: the notes');
  eq(v.askAgain, null, 'asked again: no second Ask me again');
}
// 4. Classic chosen: no Output group, no drone, the classic note.
{
  const v = soundSectionView({ ...base, engine: 'classic', engineChosen: true }, true);
  eq(v.output, null, 'classic: no Output group');
  eq(v.drone, null, 'classic: no drone switch');
  eq(v.classicNote, C.CLASSIC_OUTPUT_NOTE, 'classic: its note');
  eq(v.headphonesHint, null, 'classic: no headphones hint');
}
// 5. v2 failed with Car: the Output group with its one line, the Car fallback's notice, no drone.
{
  const v = soundSectionView({ ...base, engineChosen: true, output: 'car', v2Failed: true }, true);
  eq(v.v2Unavailable, C.V2_UNAVAILABLE_CAR, 'v2 failed + Car: the fallback notice');
  eq(v.output!.notes, [C.OUTPUT_V2_FAILED_NOTE], 'v2 failed: one line on the outputs');
  eq(v.drone, null, 'v2 failed: no drone');
  eq(v.askAgain, null, 'v2 failed: no Ask me again');
  eq(soundSectionView({ ...base, engineChosen: true, output: 'speakers', v2Failed: true }, true).v2Unavailable, C.V2_UNAVAILABLE, 'v2 failed, not Car');
}
// 6. Classic after a v2 failure: the classic note's failed wording.
eq(soundSectionView({ ...base, engine: 'classic', engineChosen: true, v2Failed: true }, true).classicNote, C.CLASSIC_OUTPUT_NOTE_V2_FAILED, 'classic, v2 failed');

console.log(`soundModel: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
