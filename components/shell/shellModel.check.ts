// Checks for components/shell/shellModel.ts (v15.5, the new layout beta).
// Run with: node components/shell/shellModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  LAYOUT_KEY,
  parseLayoutPref,
  sourceLine,
  walkSegment,
  regimeOf,
  regimeName,
  REGIME_DOT,
  phiPhase,
  formatTime,
  formatTotal,
  crystalSections,
  perfectMap,
  carLine,
  CRYSTALS,
  TABS,
  newLayoutNotice,
} from './shellModel.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// parseLayoutPref: every input class; nothing but 'new' opens the beta, and the query beats storage.
eq(LAYOUT_KEY, 'aetheria.layout.v1', 'the storage key');
eq(parseLayoutPref(null, null), 'classic', 'missing → classic');
eq(parseLayoutPref(undefined, undefined), 'classic', 'undefined → classic');
eq(parseLayoutPref('new', null), 'new', "stored 'new'");
eq(parseLayoutPref('classic', null), 'classic', "stored 'classic'");
for (const junk of ['garbage', 'NEW', ' new', 'new ', '', 'true', '1', '{"v":"new"}', 'null', 'undefined']) {
  eq(parseLayoutPref(junk, null), 'classic', `stored junk ${JSON.stringify(junk)} → classic`);
  eq(parseLayoutPref('new', junk), 'new', `query junk ${JSON.stringify(junk)} is ignored`);
}
eq(parseLayoutPref('classic', 'new'), 'new', 'the query beats storage (new)');
eq(parseLayoutPref('new', 'classic'), 'classic', 'the query beats storage (classic)');
eq(parseLayoutPref(null, 'new'), 'new', 'the query alone');

// sourceLine: a walk, the library, another play order.
eq(sourceLine('Vortex', false, 2, 27), 'Lo Shu walk · Vortex · step 3 of 27', 'a walk');
eq(sourceLine('Vortex', true, 0, 27), 'Lo Shu walk · Vortex · step 1 of 27', 'a walk wins over the library order');
eq(sourceLine('CAB', false, 30, 81, 'Ascent 4/27'), 'Lo Shu walk · CAB · step 31 of 81 · Ascent 4/27', 'a CAB with its segment');
eq(sourceLine('Ouroboros', false, 0, 29, null, '♾️'), 'Lo Shu walk · Ouroboros · step 1 of 29 · ♾️', 'a phase token');
eq(sourceLine('Vortex', false, -1, 27), 'Lo Shu walk · Vortex', 'a walk with nothing loaded');
eq(sourceLine(null, true, 11, 28), 'Library · 12 of 28', 'the library');
eq(sourceLine(null, false, 3, 30), 'Play order · 4 of 30', 'another play order');
eq(sourceLine(null, true, -1, 28), 'Library · 28 tracks', 'the library, nothing loaded');
eq(sourceLine(null, true, -1, 1), 'Library · 1 track', 'one track');
eq(sourceLine(null, true, -1, 0), 'Library · no tracks yet', 'an empty library');
eq(sourceLine(null, true, 40, 28), 'Library · 28 tracks', 'an index past the end counts, never "29 of 28"');

// walkSegment: the CAB and CABI segments; single walks have none.
eq(walkSegment('combined', [27, 27, 27], 0), 'Vortex 1/27', 'CAB start');
eq(walkSegment('combined', [27, 27, 27], 30), 'Ascent 4/27', 'CAB in Ascent');
eq(walkSegment('combined', [27, 27, 27], 80), 'Pillar 27/27', 'CAB end');
eq(walkSegment('cabi', [27, 27, 27, 29], 81), 'Ouroboros 1/29', 'CABI into Ouroboros');
eq(walkSegment('C', null, 3), null, 'a single walk');
eq(walkSegment('combined', [27, 27], 3), null, 'segment counts that do not fit');
eq(walkSegment(null, [27, 27, 27], 3), null, 'no walk');

// regimeOf: all 27 crystals, and the 111 / 2178 specials.
for (const hz of CRYSTALS.gut) eq(regimeOf(hz), 'gut', `${hz} is GUT`);
for (const hz of CRYSTALS.heart) eq(regimeOf(hz), hz === 2178 ? 'source' : 'heart', `${hz} is ${hz === 2178 ? 'SOURCE' : 'HEART'}`);
for (const hz of CRYSTALS.head) eq(regimeOf(hz), 'head', `${hz} is HEAD`);
eq(regimeOf(111), 'perfect', '111 Hz is the Perfect family');
for (const hz of [75, 186, 297, 408, 519, 630]) eq(regimeOf(hz), 'perfect', `${hz} (a Perfect GUT twin) is Perfect`);
eq(regimeName('perfect'), 'GUT', 'Perfect is named GUT');
eq(regimeName('source'), 'SOURCE', 'SOURCE');
eq(Object.keys(REGIME_DOT).sort(), ['gut', 'head', 'heart', 'perfect', 'source'], 'a dot per regime');
check(Object.values(REGIME_DOT).every((c) => /^bg-regime-[a-z]+$/.test(c)), 'dots are bg-regime-* only');
eq(CRYSTALS.gut.length + CRYSTALS.heart.length + CRYSTALS.head.length, 27, '27 crystals');

// phiPhase at the edges (App's exact INV_PHI_SQUARED = 0.381966… and INV_PHI = 0.618034…).
eq(phiPhase(0, 100), 'Build', 'φ at 0');
eq(phiPhase(38.1, 100), 'Build', 'φ at 0.381');
eq(phiPhase(38.3, 100), 'Peak', 'φ at 0.383');
eq(phiPhase(61.8, 100), 'Peak', 'φ at 0.618');
eq(phiPhase(61.9, 100), 'Resolve', 'φ at 0.619');
eq(phiPhase(100, 100), 'Resolve', 'φ at 1');
eq(phiPhase(10, 0), null, 'no duration');

// formatTime / formatTotal.
eq(formatTime(72), '1:12', '1:12');
eq(formatTime(195.9), '3:15', '3:15');
eq(formatTime(0), '0:00', '0:00');
eq(formatTime(NaN), '0:00', 'NaN');
eq(formatTime(3723), '1:02:03', 'an hour');
eq(formatTotal(8040), '2 h 14 min', '2 h 14 min');
eq(formatTotal(840), '14 min', '14 min');
eq(formatTotal(45), '45 s', '45 s');

// crystalSections: Perfect GUT off and on (the GUT row then shows the 111 Hz family).
{
  const off = crystalSections(false);
  eq(off.map((s) => s.name), ['GUT', 'HEART', 'HEAD'], 'three sections');
  eq(off.map((s) => s.cells.length), [9, 9, 9], 'nine cells each');
  eq(off[0].cells.map((c) => c.hz), [174, 285, 396, 417, 528, 639, 741, 852, 963], 'GUT, Perfect off');
  eq(off.map((s) => s.range), ['174–963 Hz', '1206–3150 Hz', '3504–6336 Hz'], 'the ranges');
  const on = crystalSections(true);
  eq(on[0].cells.map((c) => c.hz), [75, 186, 297, 408, 519, 630, 741, 852, 963], 'GUT, Perfect on');
  eq(on[0].cells.map((c) => c.raw), [174, 285, 396, 417, 528, 639, 741, 852, 963], 'the raw crystals stay');
  eq(on[1].cells.map((c) => c.hz), off[1].cells.map((c) => c.hz), 'HEART unaffected');
  eq(on[2].cells.map((c) => c.hz), off[2].cells.map((c) => c.hz), 'HEAD unaffected');
  eq(on[0].range, '75–963 Hz', 'the GUT range, Perfect on');
  check(off.every((s) => s.cells.every((c, i) => i === 0 || c.raw > s.cells[i - 1].raw)), 'ascending');
}
eq(perfectMap(396, true), 297, 'perfectMap on');
eq(perfectMap(396, false), 396, 'perfectMap off');
eq(perfectMap(1449, true), 1449, 'perfectMap leaves HEART');

// carLine.
eq(carLine('v2', false, 396, false), 'Music and a quiet tone for the 396 Hz crystal · no beat', 'Car under v2');
eq(carLine('v2', false, 4920, false), 'Music and a quiet tone for the 4920 Hz crystal · no beat', 'a HEAD crystal: the line names the crystal, never a 4920 Hz tone');
eq(carLine('v2', true, 396, false), 'Only the music · the layers are off', "Car under v2's failure fallback");
eq(carLine('classic', false, 396, false), 'Classic layers ignore Car output', 'Car under classic');
eq(carLine('v2', false, 396, true), 'Only the music · Music only is on', 'Car under Music only');
eq(carLine('classic', false, 396, true), 'Only the music · Music only is on', 'classic under Music only: Music only first');
eq(carLine('v2', true, 396, true), 'Only the music · Music only is on', "v2's fallback under Music only");

// The five tabs.
eq(TABS.map((t) => t.id), ['now', 'library', 'mixes', 'layers', 'more'], 'the five tabs, in order');

// newLayoutNotice (v15.7): the import and Deep Scan progress lines are muted; everything else is a toast.
eq(newLayoutNotice("Added 12 tracks. Skipped 3 files that are not a playable audio format (Chrome can't decode WMA or Apple Lossless)."), 'mute', 'import skipped');
eq(newLayoutNotice("Added 1,200 tracks. Skipped 1 file that is not a playable audio format (Chrome can't decode WMA or Apple Lossless)."), 'mute', 'import skipped, one');
eq(newLayoutNotice('Analyzing: tone-0001 (3/128)'), 'mute', 'scan progress');
eq(newLayoutNotice('Analyzing: a (b) (1,203/5,000)'), 'mute', 'scan progress, thousands');
eq(newLayoutNotice('Starting deep fractal analysis of 9 unscanned songs. Estimated time: 23m.'), 'mute', 'scan start');
eq(newLayoutNotice('Lo Shu · Flying Star Vortex — 27/27 positions filled.'), 'toast', 'a walk');
eq(newLayoutNotice('Harmonic Distribution Complete: 30 songs distributed across all 27 frequencies.'), 'toast', 'Auto-Distribute');
eq(newLayoutNotice('Every track in your library is already scanned (30 tracks).'), 'toast', 'nothing to scan');
eq(newLayoutNotice(''), 'toast', 'empty');
eq(newLayoutNotice(undefined as unknown as string), 'toast', 'undefined');

console.log(`shellModel: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
