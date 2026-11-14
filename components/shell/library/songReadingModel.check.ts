// components/shell/library/songReadingModel.check.ts (v16.9): node components/shell/library/songReadingModel.check.ts
//
// Track info's "What it says": the reading follows the crystal Deep Scan gave (never an assigned one), every one of the
// 27 has its words, and the tone codex agrees with the crystal list.

import { songReadingView, songReadingText, songReadingNone, geometryRow } from './songReadingModel.ts';
import { TONE_READINGS, toneReading, SONG_READING_FAILED, SONG_READING_UNSCANNED, SONG_READING_HOW } from '../../../utils/copy/songReading.ts';
import { SOLFEGGIO_INFO, GEOMETRY_INFO } from '../../../constants.ts';
import { scanCrystalOf, SPREAD_MARK } from '../../../utils/mix/distribution.ts';
import { createHash } from 'node:crypto';

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
// v16.12: every tone has its prose, opening with its own script name and naming its hexagram and mansion.
check('every tone has its prose', TONE_READINGS.every((t) => typeof t.prose === 'string' && t.prose.length > 400), TONE_READINGS.filter((t) => !(t.prose?.length > 400)).map((t) => t.hz).join());
check('each prose opens with its script name', TONE_READINGS.every((t) => t.prose.startsWith(`${t.script} `)), TONE_READINGS.filter((t) => !t.prose.startsWith(`${t.script} `)).map((t) => t.hz).join());
check('each prose names its hexagram', TONE_READINGS.every((t) => t.prose.includes(`${t.hexagram} ${t.hexagramName}`)), TONE_READINGS.filter((t) => !t.prose.includes(`${t.hexagram} ${t.hexagramName}`)).map((t) => t.hz).join());
check('each prose names its mansion', TONE_READINGS.every((t) => t.prose.includes(t.mansion.replace(/^\d+ /, ''))), TONE_READINGS.filter((t) => !t.prose.includes(t.mansion.replace(/^\d+ /, ''))).map((t) => t.hz).join());
check('no prose says DNA', TONE_READINGS.every((t) => !/\bDNA\b/i.test(t.prose)));
// v16.12, Joe's answers on "The 27 Paragraphs" (the codex edited to match, Divination 02b0351):
// v16.12 (the user, 14 Nov): "Scanned as" is the tone and its names only, no Guide line under it, for all 27.
{
  const withNote = TONE_READINGS.filter((t) => songReadingView({ harmonicFreq: t.hz + 1, closestSolfeggio: t.hz, harmonicDeviation: 1, crystalSource: 'scan' } as never)?.rows.find((r) => r.label === 'Scanned as')?.note !== undefined).map((t) => t.hz);
  check('v16.12: no Guide line under "Scanned as"', withNote.length === 0, withNote.join());
}
// Word for word: the 27 paragraphs, hashed, equal the codex's (Divination data/tones.json `prose` at 02b0351, the
// hash of "hz<TAB>prose" lines joined, taken from that file): a changed word anywhere fails here (review round 1).
const PROSE_SHA = 'd8055f0cd4d23f4b';
check('the 27 paragraphs are the codex\'s at 02b0351, word for word', createHash('sha256').update(TONE_READINGS.map((t) => `${t.hz}\t${t.prose}`).join('\n'), 'utf8').digest('hex').slice(0, 16) === PROSE_SHA);
// 1 A: "the player" is always the Aetheria EEG player, and says what that player does, not what a brain does.
const bare = TONE_READINGS.filter((t) => t.prose.replace(/the Aetheria EEG player/g, '').includes('player')).map((t) => t.hz);
check('1 A: no bare "player": every one is the Aetheria EEG player', bare.length === 0, bare.join());
check('1 A: eight tones name it', TONE_READINGS.filter((t) => t.prose.includes('the Aetheria EEG player')).map((t) => t.hz).join() === '741,852,1449,1692,2421,2907,5628,5982');
check('1 A: 741 says what the player does', toneReading(741)!.prose.includes('the Aetheria EEG player plays it when its reading shows alpha rising.') && !toneReading(741)!.prose.includes('awareness opens'));
check('1 A: 5982 too', toneReading(5982)!.prose.includes('plays it when its reading shows theta rising.') && !toneReading(5982)!.prose.includes('being taken in'));
// 3 A: The Summit is not a corner.
check('3 A: The Summit is the top of the climb, not a corner (and the last of the 27 once, for Revati)', toneReading(6336)!.prose.startsWith('The Summit is the top of the climb. ') && !/corner/.test(toneReading(6336)!.prose) && toneReading(6336)!.prose.split('the last of the 27').length === 2);
// 4 A: each paragraph's palace names the element its "In the cube" row names.
const element = (t: (typeof TONE_READINGS)[number]) => t.palace.split(', ')[3];
// The paragraphs say it as "the north palace, Water (☵ Kan)", "the center palace, Earth", "the south-west palace, the
// receptive Earth (☷ Kun)" or "the east palace, Wood, where Thunder (☳) wakes things"; 4920 and 6336 name no palace.
const said = (t: (typeof TONE_READINGS)[number]) => (t.prose.match(/palace, (?:the \w+ )?([A-Z]\w+)/) ?? [])[1];
check('4 A: only 4920 and 6336 name no palace', TONE_READINGS.filter((t) => !said(t)).map((t) => t.hz).join() === '4920,6336');
const off = TONE_READINGS.filter((t) => said(t) && said(t) !== element(t)).map((t) => `${t.hz}: ${said(t)} vs ${element(t)}`);
check('4 A: every paragraph\'s palace element is its row\'s', off.length === 0, off.join('; '));
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
check('v16.12: the view carries the prose of its crystal', !!v && v.prose === toneReading(174)!.prose);
check('v16.12: and a 4566 track The Chorus’s, not another’s', songReadingView({ harmonicFreq: 4568.5, closestSolfeggio: 4566, harmonicDeviation: 2.5, crystalSource: 'scan' })?.prose === toneReading(4566)!.prose);
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
// Review round 1: the geometry lines carry no health word (the codex's shortened 5274 line; v16.10: 1692's GEOMETRY_INFO desc).
const HEALTH = /\b(DNA|heal\w*|cure\w*|treat\w*|repair\w*|therap\w*)\b/i;
for (const t of TONE_READINGS) {
  const geo = GEOMETRY_INFO.find((g) => g.freq === `${t.hz}Hz`)!;
  // (Per crystal, all 27 directly.)
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
check('v16.12: copy text: the prose next, whole', text.split('\n')[1] === toneReading(174)!.prose);
check('copy text: the scan note with Design choice', text.split('\n').pop() === `${SONG_READING_HOW.text} (Design choice)`);
check('no reading, no copy text', songReadingText({}) === '');

console.log(`songReadingModel: ${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
