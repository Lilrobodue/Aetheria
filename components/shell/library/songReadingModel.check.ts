// components/shell/library/songReadingModel.check.ts (v16.9): node components/shell/library/songReadingModel.check.ts
//
// Track info's "What it says": the reading follows the crystal Deep Scan gave (never an assigned one), every one of the
// 27 has its words, and the tone codex agrees with the crystal list.

import { songReadingView, songReadingText, songReadingNone, geometryRow } from './songReadingModel.ts';
import { TONE_READINGS, toneReading, SONG_READING_FAILED, SONG_READING_UNSCANNED, SONG_READING_HOW } from '../../../utils/copy/songReading.ts';
import { SOLFEGGIO_INFO, GEOMETRY_INFO } from '../../../constants.ts';
import { scanCrystalOf, SPREAD_MARK } from '../../../utils/mix/distribution.ts';

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) passed++;
  else { failed++; console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`); }
};

// The codex covers the 27 crystals, in order, each tagged.
check('27 readings', TONE_READINGS.length === 27);
check('same crystals as SOLFEGGIO_INFO', TONE_READINGS.map((t) => t.hz).join() === SOLFEGGIO_INFO.map((s) => s.freq).join());
check('every reading tagged Tradition', TONE_READINGS.every((t) => t.tag === 'tradition'));
check('every reading complete', TONE_READINGS.every((t) => t.script && t.hexagramName && t.judgment && t.palace && t.mansion && t.deity && t.symbol && t.planet));
const cycle = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'];
check('ruling planets cycle from Ketu', TONE_READINGS.every((t, i) => t.planet === cycle[i % 9]));
const joe = toneReading(4566)!;
check('4566 is The Chorus, hexagram 45, Shravana', joe.script === 'The Chorus' && joe.hexagram === 45 && joe.mansion === '22 Shravana');
check('a non-crystal has no reading', toneReading(440) === null);
// The user (14 Nov): each mansion its own deity; Vishakha the pair, Jyeshtha Indra alone, Krittika Agni alone.
const deities = TONE_READINGS.map((t) => t.deity);
check('no two mansions share a deity', new Set(deities).size === 27, deities.filter((d, i) => deities.indexOf(d) !== i).join(' | '));
check('16 Vishakha: Indra and Agni together', toneReading(2664)!.mansion === '16 Vishakha' && toneReading(2664)!.deity === 'Indra and Agni together (Indragni), gods of thunder and fire');
check('18 Jyeshtha: Indra alone', toneReading(3150)!.mansion === '18 Jyeshtha' && toneReading(3150)!.deity === 'Indra, king of the gods');
check('3 Krittika: Agni alone', toneReading(396)!.mansion === '3 Krittika' && toneReading(396)!.deity === 'Agni, god of fire');

// A scanned track reads as its scan crystal.
const scanned = { harmonicFreq: 684.46, closestSolfeggio: scanCrystalOf(684.46), harmonicDeviation: 1, crystalSource: 'scan' as const };
const v = songReadingView(scanned);
check('scanned track has a reading', !!v && v.crystal === 174, JSON.stringify(v && v.crystal));
check('no moved note on its own crystal', !!v && v.movedNote === null);
check('rows in order', !!v && v.rows.map((r) => r.label).join() === 'Scanned as,In the cube,Hexagram,Geometry,Moon mansion');
// The user (14 Nov): no label Track info's own rows use (its Crystal row can show another crystal).
check('no second Crystal row', !!v && v.rows.every((r) => !['Length', 'Crystal', 'Key', 'Tuning', 'Visual sync', 'File', 'Added'].includes(r.label)));
// Assign moved it: the reading still follows the scan.
// (A spread marks the track as distribution.ts does: assigned, its deviation SPREAD_MARK past the distance moved.)
const moved = { harmonicFreq: 684.46, closestSolfeggio: 4566, crystalSource: 'assigned' as const, harmonicDeviation: SPREAD_MARK + Math.abs(684.46 - 4566) };
const mv = songReadingView(moved);
check('moved track still reads its scan crystal', !!mv && mv.crystal === 174, JSON.stringify(mv && mv.crystal));
check('moved track says where it plays now', !!mv && mv.movedNote === 'It now plays on 4566 Hz, where Assign placed it; the reading follows the crystal its scan gave.', String(mv && mv.movedNote));
// Review round 1: a pre-v15.8 record an older Auto-Distribute moved ('scan-replaced'): the reading still its scan's,
// and the line names the older Auto-Distribute (as the Crystal row does), never Assign.
const replaced = { harmonicFreq: 176.5, closestSolfeggio: 4566, harmonicDeviation: 2.5, fractalAnalysis: {} };
const rv = songReadingView(replaced);
check('scan-replaced reads its scan crystal', !!rv && rv.crystal === 174, JSON.stringify(rv && rv.crystal));
check('scan-replaced names the older Auto-Distribute', !!rv && rv.movedNote === 'It now plays on 4566 Hz, where an older Auto-Distribute placed it; the reading follows the crystal its scan gave.', String(rv && rv.movedNote));
// Review round 1: a scan that couldn't read the track (440 Hz, its 528 placeholder, 999): no reading and its own line.
const failedScan = { harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999, crystalSource: 'scan' as const };
check('a failed scan has no reading', songReadingView(failedScan) === null);
check('a failed scan: its own line', songReadingNone(failedScan) === SONG_READING_FAILED);
check('an assigned track: the Scan line', songReadingNone({ closestSolfeggio: 528, crystalSource: 'assigned' }) === SONG_READING_UNSCANNED);
check('no crystal: the Scan line', songReadingNone({}) === SONG_READING_UNSCANNED);
// Review round 1: the geometry lines carry no health word (the codex's two shortened lines, 1692 and 5274).
const HEALTH = /\b(DNA|heal\w*|cure\w*|treat\w*|repair\w*|therap\w*)\b/i;
for (const t of TONE_READINGS) {
  const geo = GEOMETRY_INFO.find((g) => g.freq === `${t.hz}Hz`)!;
  // (Per crystal: Deep Scan never gives 6336 itself, a measured 6336 Hz folds to 396.)
  const row = geometryRow(t.hz);
  const line = row ? row.value.slice(geo.shape.length + 2) : '';
  check(`${t.hz}: a geometry row`, !!row && row.value.startsWith(`${geo.shape}. `));
  check(`${t.hz}: no health word in its geometry line`, !!line && !HEALTH.test(line), line);
}
check('1692: the codex line, in a reading', songReadingView({ harmonicFreq: 1692, closestSolfeggio: 1692, harmonicDeviation: 0, crystalSource: 'scan' })!.rows.find((r) => r.label === 'Geometry')!.value === 'Fibonacci Spiral. The spiral of nature based on the Golden Ratio, found in galaxies and shells.');
check('5274: the codex line, in a reading', songReadingView({ harmonicFreq: 5274, closestSolfeggio: 5274, harmonicDeviation: 0, crystalSource: 'scan' })!.rows.find((r) => r.label === 'Geometry')!.value === 'Healing Mandala. Complex circular patterns representing the journey from fragmentation to wholeness.');
// Never scanned, or assigned without a scan: no reading.
check('assigned track has no reading', songReadingView({ closestSolfeggio: 528, crystalSource: 'assigned' }) === null);
check('empty track has no reading', songReadingView({}) === null);
// Copy text.
const text = songReadingText(scanned);
check('copy text names the crystal and Legge', /174 Hz · The Circle/.test(text) && /James Legge/.test(text) && /not the song’s measured pitch/.test(text));
// Review round 1: the tags in words: the heading's Tradition first, the scan note's Design choice last.
check('copy text: the heading with Tradition', text.split('\n')[0] === 'What it says (Tradition)', text.split('\n')[0]);
check('copy text: the scan note with Design choice', text.split('\n').pop() === `${SONG_READING_HOW.text} (Design choice)`);
check('no reading, no copy text', songReadingText({}) === '');

console.log(`songReadingModel: ${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
