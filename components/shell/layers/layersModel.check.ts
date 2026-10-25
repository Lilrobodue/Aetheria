// Checks for components/shell/layers/layersModel.ts (v15.6, the Layers tab).
// Run with: node components/shell/layers/layersModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  LAYERS_SECTIONS,
  CRYSTAL_FILTER_KEY,
  parseCrystalFilter,
  EXPERIENCE_LEVELS,
  crystalCeiling,
  levelName,
  filterCrystals,
  filterNote,
  heardLine,
  crystalStatus,
  trackCrystalLine,
  crystalComfortLine,
  COMFORT_LEVELS,
  COMFORT_CRYSTAL_V2,
  COMFORT_CRYSTAL_CLASSIC,
  toneLoweredText,
  BEAT_BANDS,
  bandSubtitle,
  beatStatus,
  trackPeakLine,
  advancedStatus,
  sectionId,
  headingId,
  currentSectionIndex,
  TRACK_SHAPE_CLASSIC_LINE,
  TRACK_SHAPE_CLASSIC_POINTS,
} from './layersModel.ts';
import { getPhiIntensityMultiplier } from '../../../utils/phiIntegration.ts';
import { crystalSections } from '../shellModel.ts';
import { GAMMA_DESCRIPTION_V2 } from '../../layers/layerCopy.ts';
import { toneOf } from '../../../utils/soundV2/aetheria_sound_v2.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const isText = (s: unknown) => typeof s === 'string' && s.length > 0 && !/undefined|NaN|null|Infinity/.test(s);
const JUNK: unknown[] = [NaN, Infinity, -Infinity, -1, 0, undefined, null, 'x', {}];

// The sections, in the plan's order.
eq(LAYERS_SECTIONS.map((s) => s.title), ['Sound', 'Crystal', 'Levels', 'Beat', 'Advanced'], 'the five sections');
eq(sectionId('beat'), 'layers-sec-beat', 'section id');
eq(headingId('beat'), 'layers-h-beat', 'heading id');
// The jump row's current section (a 524 px scroller: the band is its top 209.6 px).
eq(currentSectionIndex([12, 1040, 2100, 2600, 3100], 524), 0, 'at the top: Sound');
eq(currentSectionIndex([-1016, 12, 1072, 1572, 2072], 524), 1, 'Crystal at the top');
eq(currentSectionIndex([-1500, -300, 200, 700, 1200], 524), 2, 'Levels entering the upper band counts');
eq(currentSectionIndex([-3000, -2000, -900, -400, 60], 524), 4, 'the last card, short, at the end of the page');
eq(currentSectionIndex([300, 900], 524), 0, 'none in the band: the first');
eq(currentSectionIndex([], 524), 0, 'no cards');
eq(currentSectionIndex([12, NaN, 100], NaN), 0, 'total on NaN');

// The filter's key and its parse: only 'true' is on.
eq(CRYSTAL_FILTER_KEY, 'aetheria.crystalFilter.v1', 'the storage key');
eq(parseCrystalFilter('true'), true, "'true' → on");
for (const raw of [null, undefined, 'false', '', 'TRUE', '1', 'on', ' true']) eq(parseCrystalFilter(raw as any), false, `${JSON.stringify(raw)} → off`);

// The ceilings follow the select's own words: 963 / 2,000 / 5,000 / all.
eq(crystalCeiling('beginner'), 963, 'beginner');
eq(crystalCeiling('intermediate'), 2000, 'intermediate');
eq(crystalCeiling('advanced'), 5000, 'advanced');
eq(crystalCeiling('expert'), Infinity, 'expert');
for (const j of JUNK) eq(crystalCeiling(j), 963, `unknown level ${String(j)} → the careful ceiling`);
eq(EXPERIENCE_LEVELS.map((l) => l.label), ['Beginner · up to 963 Hz', 'Intermediate · up to 2,000 Hz', 'Advanced · up to 5,000 Hz', 'Expert · all 27'], 'the option labels');
eq(levelName('advanced'), 'Advanced', 'level name');
eq(levelName('nope'), 'Beginner', 'unknown level name');

// The counts at each level: 9 / 13 / 23 / 27, with Perfect GUT on or off.
for (const pg of [false, true]) {
  const secs = crystalSections(pg);
  const count = (level: string) => filterCrystals(secs, true, level, []).shown;
  eq([count('beginner'), count('intermediate'), count('advanced'), count('expert')], [9, 13, 23, 27], `counts (Perfect GUT ${pg})`);
  for (const level of ['beginner', 'intermediate', 'advanced', 'expert']) {
    const off = filterCrystals(secs, false, level, []);
    eq([off.shown, off.total], [27, 27], `off at ${level}: all 27`);
    eq(off.sections.map((s) => s.cells.length), [9, 9, 9], `off at ${level}: three full sections`);
  }
  // Beginner hides HEART and HEAD entirely.
  eq(filterCrystals(secs, true, 'beginner', []).sections.map((s) => s.regime), ['gut'], `beginner: GUT only (Perfect GUT ${pg})`);
}
// The playing and the track's crystals always show.
{
  const secs = crystalSections(false);
  const f = filterCrystals(secs, true, 'beginner', [4920, 1449]);
  eq(f.shown, 11, 'beginner + a playing HEAD crystal and a HEART track crystal: 9 + 2');
  eq(f.sections.map((s) => s.regime), ['gut', 'heart', 'head'], 'their regimes come back, one cell each');
  eq(f.sections[2].cells.map((c) => c.hz), [4920], 'the playing HEAD crystal, alone in its regime');
  eq(f.sections[1].cells.map((c) => c.hz), [1449], "the track's HEART crystal, alone in its regime");
  eq(filterCrystals(secs, true, 'intermediate', [1449]).shown, 13, 'a kept crystal already under the ceiling counts once');
  eq(filterCrystals(secs, true, 'beginner', [null, NaN, 111]).shown, 9, 'null, NaN and a non-crystal keep nothing extra');
  const pgSecs = crystalSections(true);
  eq(filterCrystals(pgSecs, true, 'beginner', [519]).shown, 9, 'Perfect GUT: the kept number is the cell as shown (519)');
}
eq(filterNote(13, 27, 'intermediate'), 'Showing 13 of 27 · experience filter: Intermediate', 'the filter note');
for (const j of JUNK) check(isText(filterNote(j as any, j as any, j)), `filterNote total on ${String(j)}`);

// What is heard: v2's tone (toneOf, the player's own fold), classic at pitch to 639 Hz, else a hum.
eq(heardLine('v2', 528, toneOf(528, 'headphones')), 'v2 plays it as a 528 Hz tone under the music.', 'v2 528');
eq(heardLine('v2', 4920, toneOf(4920, 'headphones')), 'v2 plays it as a 615 Hz tone under the music.', 'v2 4920 → 615');
eq(heardLine('v2', 1449, toneOf(1449, 'headphones')), 'v2 plays it as a 724.5 Hz tone under the music.', 'v2 1449 → 724.5');
eq(heardLine('v2', 111, toneOf(111, 'headphones')), 'v2 plays it as a 222 Hz tone under the music.', 'v2 111 → 222');
eq(heardLine('classic', 528, 528), 'Classic plays it at 528 Hz.', 'classic 528 at pitch');
eq(heardLine('classic', 4920, 62.2), 'Classic plays it as a 62 Hz hum.', 'classic 4920 as a hum');
eq(heardLine('off', 528, 528), 'The layers are off.', 'layers off');
for (const j of JUNK) {
  check(isText(heardLine('v2', j as any, j as any)), `heardLine v2 total on ${String(j)}`);
  check(isText(heardLine('classic', j as any, j as any)), `heardLine classic total on ${String(j)}`);
}
eq(crystalStatus(528, true), '528 Hz playing', 'status playing');
eq(crystalStatus(528, false), '528 Hz selected', 'status selected');
check(isText(crystalStatus(NaN, true)), 'status total');
eq(trackCrystalLine(396, 528), "This track's crystal is 396 Hz.", 'track line, differs');
eq(trackCrystalLine(528, 528), "This is the track's own crystal.", 'track line, same');
eq(trackCrystalLine(null, 528), null, 'no track');

// Comfort lines: neutral, true of what plays, and never the v15.5 HEAD line.
eq(crystalComfortLine(true), COMFORT_CRYSTAL_V2, 'v2 line');
eq(crystalComfortLine(false), COMFORT_CRYSTAL_CLASSIC, 'classic line');
for (const line of [COMFORT_LEVELS, COMFORT_CRYSTAL_V2, COMFORT_CRYSTAL_CLASSIC]) {
  check(!/top of hearing/.test(line), `no "top of hearing" in "${line.slice(0, 30)}…"`);
  check(/comfortable/.test(line), `"${line.slice(0, 30)}…" says comfortable`);
  check(/Music only/.test(line), `"${line.slice(0, 30)}…" names Music only`);
}
// v2's band claim holds for every crystal: its tones lie in 150–1,000 Hz.
for (const sec of crystalSections(false)) {
  for (const c of sec.cells) {
    const t = toneOf(c.hz, 'headphones');
    check(t >= 150 && t <= 1000, `v2's tone for ${c.hz} Hz (${t}) lies in 150–1,000 Hz`);
  }
}

// The Undo toast's words: classic in %, v2 in dB on its validated level; no frequency named.
eq(toneLoweredText(false, 0.5, 0.28629100566007654), 'Tone level lowered from 50 % to 29 % for this track.', 'classic 50 → 29 %');
eq(toneLoweredText(true, 0.04, 0.03), 'Tone level lowered from +12.0 dB to +9.5 dB for this track.', 'v2 +12 → +9.5 dB');
eq(toneLoweredText(true, 0.01, 0.0005), 'Tone level lowered from +0.0 dB to −26.0 dB for this track.', 'v2 0 → −26 dB');
eq(toneLoweredText(true, 0.01, 0), 'Tone level lowered from +0.0 dB to off for this track.', 'v2 to 0: off');
for (const j of JUNK) {
  check(isText(toneLoweredText(false, j as any, j as any)) || /—/.test(toneLoweredText(false, j as any, j as any)), `toneLoweredText classic total on ${String(j)}`);
  check(typeof toneLoweredText(true, j as any, j as any) === 'string', `toneLoweredText v2 total on ${String(j)}`);
}
check(!/Hz/.test(toneLoweredText(false, 0.5, 0.29)) && !/Hz/.test(toneLoweredText(true, 0.04, 0.03)), 'the toast names no frequency');

// Beat bands: the presets' names and beats, neutral subtitles; v2's Gamma keeps its existing note.
eq(BEAT_BANDS.map((b) => `${b.name} · ${b.delta} Hz`), ['Delta · 2 Hz', 'Theta · 6 Hz', 'Alpha · 10 Hz', 'Beta · 20 Hz', 'Gamma · 40 Hz'], 'band titles');
eq(bandSubtitle('Alpha', true, true), 'The 8–13 Hz band · now', 'Alpha, now');
eq(bandSubtitle('Delta', false, false), 'The 0.5–4 Hz band', 'Delta');
eq(bandSubtitle('Gamma', true, false), GAMMA_DESCRIPTION_V2, "v2's Gamma");
eq(bandSubtitle('Gamma', false, false), 'The band above 30 Hz', "classic's Gamma");
for (const b of BEAT_BANDS) check(!/Sleep|Healing|Meditation|Focus|Processing|Best for/.test(bandSubtitle(b.name, false, false)), `${b.name}: no benefit claim`);
eq(bandSubtitle('Nope', false, false), '', 'unknown band: empty');
eq(beatStatus(true, 'Alpha'), 'Adaptive · Alpha', 'adaptive status');
eq(beatStatus(false, 'Theta'), 'Theta', 'manual status');
eq(beatStatus(false, undefined as any), '—', 'status total');

// Advanced.
eq(trackPeakLine(194.2 * 0.6180339887498949), 'This track peaks at 2:00 (61.8 %).', 'the track peak');
for (const j of JUNK) eq(trackPeakLine(j as any), null, `no peak line for ${String(j)}`);
// Classic's track shape: its line's points are the envelope's own (utils/phiIntegration.ts).
{
  const d = 1000;
  const at = (p: number) => getPhiIntensityMultiplier(p * d, d);
  const P = TRACK_SHAPE_CLASSIC_POINTS;
  check(Math.abs(at(0.38196) - 1) < 0.001, `full at ${P.firstFullAt * 100}%: ${at(0.38196)}`);
  check(Math.abs(at(0.3821) - P.stepTo) < 0.001, `a step down to ${P.stepTo} just after: ${at(0.3821)}`);
  check(Math.abs(at(P.fullAgainAt) - 1) < 0.001, `full again at ${P.fullAgainAt * 100}%: ${at(P.fullAgainAt)}`);
  check(Math.abs(at(1) - P.endsAt) < 0.01, `about ${P.endsAt} at the end: ${at(1)}`);
  for (const p of [0.1, 0.2, 0.3, 0.45, 0.55, 0.7, 0.85, 0.95]) check(at(p) >= 0 && at(p) <= 1.0001, `within 0..1 at ${p}`);
  for (const words of ['full at 38.2%', `step down to ${P.stepTo}`, 'full at 61.8%', `about ${P.endsAt} at the end`]) {
    check(TRACK_SHAPE_CLASSIC_LINE.includes(words), `the classic track-shape line says "${words}"`);
  }
}
check(/for this track.$/.test(toneLoweredText(false, 0.5, 0.29)) && /for this track.$/.test(toneLoweredText(true, 0.04, 0.03)), 'the toast says the lowering is for this track (it is restored at the next)');
eq(advancedStatus(true), 'φ on', 'φ on');
eq(advancedStatus(false), 'φ off', 'φ off');

console.log(`layersModel: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
