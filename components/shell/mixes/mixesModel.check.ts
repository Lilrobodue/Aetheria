// Checks for components/shell/mixes/mixesModel.ts (v15.9, the Mixes tab).
// Run with: node components/shell/mixes/mixesModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  EMPTY_BODY,
  EMPTY_TITLE,
  EXPERIMENTAL_NOTE,
  MIXES_INTRO,
  NO_CRYSTALS_BODY,
  NO_CRYSTALS_TITLE,
  SECTION_TITLES,
  SEQ111_LINE,
  dotsFor,
  mixView,
  mixesIn,
  mixesStats,
  noCrystals,
  summaryText,
  tracksText,
  walkSize,
} from './mixesModel.ts';
import type { MixesStats } from './mixesModel.ts';
import { MIXES, mixCounts } from '../../../utils/mix/catalog.ts';
import type { MixId } from '../../../utils/mix/catalog.ts';

let passed = 0;
const failures: string[] = [];
const check = (ok: boolean, what: string) => { if (ok) passed++; else failures.push(what); };
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
const def = (id: MixId) => MIXES.find((m) => m.id === id)!;

const CRY = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
const song = (i: number, crystal: number | null, scanned = false): any => ({
  id: `s${i}`, name: `tone-${i}`, ...(crystal ? { closestSolfeggio: crystal, harmonicFreq: crystal } : {}),
  ...(scanned ? { fractalAnalysis: { goldenRatioAlignment: 0.2, pattern111Presence: 0.1, sacredGeometryAlignment: 0.2 } } : {}),
});
// 30 tracks, the 27 crystals in turn, none at 852 (index 7): the walks' 26 of 27.
const lib = Array.from({ length: 30 }, (_, i) => song(i, i === 7 ? null : CRY[i % 27]));
const st = mixesStats(lib);

// The words.
eq(MIXES_INTRO, 'A tap builds a play order from your library and starts it. Undo for 10 s.', 'the intro');
eq([SECTION_TITLES.walks, SECTION_TITLES.journeys, SECTION_TITLES.sets, SECTION_TITLES.experimental], ['Lo Shu walks', 'Journeys', 'Crystal sets', 'Experimental'], 'section titles');
check(EXPERIMENTAL_NOTE.startsWith('These rank tracks by Deep Scan’s experimental scores.') && EXPERIMENTAL_NOTE.endsWith('They need tracks Deep Scan has measured.'), 'the Experimental note');
eq(SEQ111_LINE.replace(/ /g, ' '), 'Plays each track’s own crystal. For a 111 Hz tone: Layers › Crystal', 'the 111 line');
eq([NO_CRYSTALS_TITLE, NO_CRYSTALS_BODY], ['Your tracks have no crystals yet', 'Every mix follows the crystals. Assign them now (instant), or let Deep Scan measure them (slow).'], 'the no-crystals card');
eq([EMPTY_TITLE, EMPTY_BODY], ['Nothing to mix yet', 'Mixes are built from your library. Import music first; your files are not changed.'], 'the empty state');

// The stats: one pass, the catalogue's counts.
eq([st.total, st.withCrystal, st.scanned, st.available.size, st.available.has(852)], [30, 29, 0, 26, false], 'stats');
eq(st.counts, mixCounts(lib), 'the counts are mixCounts');
eq(summaryText(st), '30 tracks · 29 with a crystal', 'summary');
eq(summaryText({ total: 1, withCrystal: 0 }), '1 track · 0 with a crystal', 'summary, one track');
eq([tracksText(0), tracksText(1), tracksText(59)], ['0 tracks', '1 track', '59 tracks'], 'tracksText');
eq([noCrystals({ total: 0, withCrystal: 0 }), noCrystals({ total: 5, withCrystal: 0 }), noCrystals({ total: 5, withCrystal: 1 })], [false, true, false], 'noCrystals');

// Each mix's view.
eq(mixesIn('walks').map(walkSize), [27, 27, 27, 81, 29, 110], 'walk sizes');
eq(mixView(def('walk:C'), st, { playing: true }), { enabled: true, text: '26 of 27 positions', label: 'Flying Star Vortex, 26 of 27 positions, playing' }, 'a playing walk');
eq(mixView(def('walk:combined'), st), { enabled: true, text: '78 of 81 positions', label: 'Combined Walk — Calling a CAB (C·A·B), 78 of 81 positions' }, 'the CAB');
eq(mixView(def('preset:qi'), st), { enabled: true, text: `${st.counts['preset:qi']} tracks`, label: `Grounding, ${st.counts['preset:qi']} tracks` }, 'a set');
eq(mixView(def('preset:meditation'), st).text, '2 tracks', 'Meditation (no 852)');
const one = mixesStats([song(0, 2178, true)]);
eq(mixView(def('source2178'), one), { enabled: true, text: '1 track', label: '2178 Hz · SOURCE, 1 track' }, 'one track');
eq(mixView(def('gut'), one), { enabled: false, text: 'No tracks yet', label: 'GUT Alignment, No tracks yet' }, 'a journey with no track');
eq(mixView(def('golden'), st), { enabled: false, text: 'Needs Deep Scan', label: 'Golden Φ, Needs Deep Scan' }, 'Experimental with nothing scanned');
eq(mixView(def('golden'), one).text, 'No tracks yet', 'Experimental with scans but no golden score');
const bare = mixesStats([song(0, null), song(1, null)]);
check(MIXES.every((m) => mixView(m, bare).text === 'No tracks yet' && !mixView(m, bare).enabled), 'no crystals: every mix "No tracks yet" (Experimental too)');
check(MIXES.every((m) => { const v = mixView(m, st, { loading: true }); return !v.enabled && v.text === 'Loading…'; }), 'loading: every mix waits');
check(MIXES.every((m) => !mixView(m, st).label.endsWith('playing') && !mixView(m, st).label.endsWith('paused')), 'playing / paused only when asked');
eq(mixView(def('walk:C'), st, { paused: true }).label, 'Flying Star Vortex, 26 of 27 positions, paused', 'a paused walk');
eq(mixView(def('walk:C'), st, { playing: true, paused: true }).label.endsWith(', playing'), true, 'playing wins (never both)');

// The dots.
const cells = (id: MixId, s: MixesStats = st, disabled = false) => { const d = dotsFor(id, s.available, disabled); return d.kind === 'grid' ? d.cells.join('') : `source:${d.hollow}`; };
eq(cells('gut'), 'gggggggog', 'GUT: its nine, 852 hollow');
eq(cells('heart'), 'hhhhhhhhh', 'HEART');
eq(cells('head'), 'bbbbbbbbb', 'HEAD');
eq([cells('ultimate'), cells('full')], ['bbbhhhggg', 'bbbhhhggg'], 'the cube, HEAD on top');
eq(cells('preset:qi'), 'g.g...g.g', 'four crystals: the corners');
eq([cells('preset:healing'), cells('preset:mood')], ['...ggg...', '...ggg...'], 'three: the middle row');
eq(cells('preset:meditation'), '...gog...', 'Meditation, 852 hollow');
eq(cells('preset:flow'), 'g.g.g.g.g', 'five: an X');
eq([cells('golden'), cells('seq111')], ['..b.h.g..', '..b.h.g..'], 'Experimental: a diagonal');
eq([cells('source2178'), cells('source2178', st, true)], ['source:false', 'source:true'], 'SOURCE: one dot');
eq(cells('gut', st, true), 'ooooooooo', 'disabled: every dot hollow');
eq(cells('preset:qi', st, true), 'o.o...o.o', 'disabled: empty cells stay empty');
check(MIXES.every((m) => { const d = dotsFor(m.id, st.available, false); return d.kind === 'source' || d.cells.length === 9; }), 'every grid has nine cells');

// Every catalogue entry is shown in exactly one section, in the tab's order.
eq((['walks', 'journeys', 'sets', 'experimental'] as const).flatMap((s) => mixesIn(s).map((m) => m.id)), MIXES.map((m) => m.id), 'sections cover the catalogue');

if (failures.length) {
  console.error(`mixesModel.check: ${failures.length} failed of ${passed + failures.length}:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`mixesModel.check: ${passed} checks passed.`);
