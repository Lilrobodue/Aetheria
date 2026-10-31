// Checks for components/shell/library/libraryModel.ts (v15.7, the Library tab; v15.8 the crystal origins and Assign).
// Run with: node components/shell/library/libraryModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  LIBRARY_SORT_KEY,
  LIBRARY_SORTS,
  parseLibrarySort,
  sortLabel,
  sortLibrary,
  filterLibrary,
  libraryView,
  normalQuery,
  keyName,
  crystalText,
  rowFacts,
  rowRegime,
  matchCountText,
  playingFromText,
  summaryText,
  searchPlaceholder,
  libraryOrderFor,
  sameIds,
  sameIdSet,
  stillTapOrder,
  rebuildOrder,
  libraryTapText,
  addedDate,
  formatBytes,
  crystalSource,
  deepScanned,
  crystalFromDeepScan,
  trackInfoRows,
  trackInfoText,
  libraryHealth,
  healthModel,
  orphanText,
  assignConfirmText,
  assignNeedsConfirm,
  lastImportLines,
  recoverWords,
} from './libraryModel.ts';
import type { LibSong, HealthInput } from './libraryModel.ts';
import { countAnalysable, capsFor, passButtonText, passEta, passEtaMinutes, PASS_IDLE } from '../../../utils/library/analysePass.ts';
import { removeIdsWithCursor } from '../../../utils/library/listOps.ts';
import { planAssign, needsDeepScan, deepScanQueue, ALL_CRYSTALS } from '../../../utils/mix/distribution.ts';
import { buildFacetIndex, filterPass, NO_FILTERS } from '../../../utils/library/filterModel.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const ids = (list: readonly { id: string }[]) => list.map((s) => s.id);
const BAD_NUMBERS = [NaN, Infinity, -Infinity, -1, -0.5, 0];

const S = (id: string, name: string, o: Partial<LibSong> = {}): LibSong => ({ id, name, ...o });

// --- The sort key ------------------------------------------------------------------------------------------------
eq(LIBRARY_SORT_KEY, 'aetheria.librarySort.v1', 'the storage key');
eq(LIBRARY_SORTS.map((s) => s.id), ['library', 'name', 'newest', 'length', 'crystal'], 'the five sorts, in the select’s order');
for (const s of LIBRARY_SORTS) eq(parseLibrarySort(s.id), s.id, `parse ${s.id}`);
for (const junk of [null, undefined, '', 'NAME', ' name', 'name ', 'random', 'true', 1, {}, []]) eq(parseLibrarySort(junk), 'library', `junk ${JSON.stringify(junk)} → library`);
eq(sortLabel('newest'), 'Newest first', 'sortLabel');
eq(sortLabel('junk' as never), 'Library order', 'sortLabel, unknown');

// --- Sorting: each order, dedupe, stable ties, unknowns last ---------------------------------------------------
const lib: LibSong[] = [
  S('1-a', 'tone-10', { duration: 30, closestSolfeggio: 528 }),
  S('2-b', 'tone-2', { duration: 0, closestSolfeggio: 174 }),
  S('3-c', 'Tone-1', { duration: 10 }),
  S('4-d', 'tone-03', { duration: 10, closestSolfeggio: 528 }),
  S('5-e', 'tone-20', { duration: NaN, closestSolfeggio: 6336 }),
];
const withDup = [...lib, lib[1], lib[0]];
eq(ids(sortLibrary(withDup, 'library')), ['1-a', '2-b', '3-c', '4-d', '5-e'], 'library order, each id once');
eq(ids(sortLibrary(withDup, 'newest')), ['5-e', '4-d', '3-c', '2-b', '1-a'], 'newest first = the library reversed');
eq(sortLibrary(lib, 'name').map((s) => s.name), ['Tone-1', 'tone-2', 'tone-03', 'tone-10', 'tone-20'], 'name: numeric-aware, case-blind (tone-2 before tone-10)');
eq(ids(sortLibrary(lib, 'length')), ['3-c', '4-d', '1-a', '2-b', '5-e'], 'length: shortest first, ties in library order, unknown (0, NaN) last in library order');
eq(ids(sortLibrary(lib, 'crystal')), ['2-b', '1-a', '4-d', '5-e', '3-c'], 'crystal: lowest first, ties in library order, no crystal last');
check(sortLibrary(lib, 'library') !== lib, 'sortLibrary never returns the caller’s array (no mutation)');
eq(ids(lib), ['1-a', '2-b', '3-c', '4-d', '5-e'], 'the input is not mutated by any sort');
eq(sortLibrary([], 'name'), [], 'empty');
// Stability across many ties.
const ties = Array.from({ length: 50 }, (_, i) => S(`t${i}`, `same`, { duration: 60, closestSolfeggio: 528 }));
for (const sort of ['name', 'length', 'crystal'] as const) eq(ids(sortLibrary(ties, sort)), ids(ties), `${sort}: 50 ties keep library order`);

// --- Search ---------------------------------------------------------------------------------------------------
eq(normalQuery('  Tone-0 '), 'tone-0', 'the query is trimmed and lower case');
eq(ids(filterLibrary(lib, '')), ids(lib), 'an empty query keeps every row');
eq(ids(filterLibrary(lib, '   ')), ids(lib), 'a blank query keeps every row');
eq(ids(filterLibrary(lib, 'TONE-1')), ['1-a', '3-c'], 'case-blind substring');
eq(ids(filterLibrary(lib, ' tone-2')), ['2-b', '5-e'], 'trimmed');
eq(ids(filterLibrary(lib, 'xyz')), [], 'no match');
eq(ids(libraryView(withDup, { query: 'tone-', sort: 'name' })), ['3-c', '2-b', '4-d', '1-a', '5-e'], 'libraryView: sorted, deduped, filtered');
eq(ids(libraryView(lib, { query: '0', sort: 'newest' })), ['5-e', '4-d', '1-a'], 'libraryView: newest, filtered');
// A patched object (a scan's by-id patch) is lowercased afresh.
const renamed = { ...lib[0], name: 'Other' };
eq(ids(filterLibrary([renamed], 'other')), ['1-a'], 'a new Song object is matched by its own name');

// --- A row's facts ----------------------------------------------------------------------------------------------
eq(keyName('Am'), 'A minor', 'keyName Am');
eq(keyName('C'), 'C major', 'keyName C');
eq(keyName('F#m'), 'F♯ minor', 'keyName F#m');
eq(keyName('Bb'), 'B♭ major', 'keyName Bb');
for (const junk of ['', 'H', 'am', 'A minor', null, undefined, 3]) eq(keyName(junk), '', `keyName junk ${JSON.stringify(junk)}`);
eq(rowFacts(S('x', 'x', { duration: 195, closestSolfeggio: 528, musicKey: 'Am' })), '3:15 · 528 Hz · A minor', 'the facts line');
eq(rowFacts(S('x', 'x', { duration: 195, closestSolfeggio: 528, musicKey: 'Am' }), true), 'Playing · 3:15 · 528 Hz · A minor', 'the playing row');
eq(rowFacts(S('x', 'x', { duration: 195, closestSolfeggio: 528, musicKey: 'Am' }), 'playing'), 'Playing · 3:15 · 528 Hz · A minor', 'the playing row (state)');
eq(rowFacts(S('x', 'x', { duration: 195, closestSolfeggio: 528, musicKey: 'Am' }), 'paused'), 'Paused · 3:15 · 528 Hz · A minor', 'the current row, paused');
eq(rowFacts(S('x', 'x', { duration: 195 }), null), '3:15 · No crystal yet', 'another row');
eq(rowFacts(S('x', 'x', { duration: 0 })), 'Reading length… · No crystal yet', 'length unread, no crystal');
eq(rowFacts(S('x', 'x', { duration: 338, musicKey: 'F' })), '5:38 · No crystal yet · F major', 'no crystal, a key');
eq(rowFacts(S('x', 'x', { duration: 60, closestSolfeggio: 2421, musicKey: '' })), '1:00 · 2421 Hz', 'no clear key: no key part');
for (const n of BAD_NUMBERS) {
  eq(rowFacts(S('x', 'x', { duration: n, closestSolfeggio: n })), 'Reading length… · No crystal yet', `rowFacts total on ${n}`);
  eq(crystalText(S('x', 'x', { closestSolfeggio: n })), null, `crystalText on ${n}`);
  eq(rowRegime(S('x', 'x', { closestSolfeggio: n })), null, `rowRegime on ${n}`);
}
eq(rowRegime(S('x', 'x', { closestSolfeggio: 528 })), 'gut', 'regime gut');
eq(rowRegime(S('x', 'x', { closestSolfeggio: 2178 })), 'source', 'regime source');
eq(rowRegime(S('x', 'x', { closestSolfeggio: 4566 })), 'head', 'regime head');

// --- The tab's lines ---------------------------------------------------------------------------------------------
eq(matchCountText(11, 440), '11 of 440 tracks match', 'match count');
eq(matchCountText(1, 440), '1 of 440 tracks matches', 'one match');
eq(matchCountText(0, 1), '0 of 1 track match', 'one track');
for (const n of BAD_NUMBERS) eq(matchCountText(n, n), '0 of 0 tracks match', `matchCountText total on ${n}`);
eq(playingFromText({ hasTrack: true, walkName: 'Vortex', sameIds: false, orderCount: 27, scanning: false }), 'Playing from Lo Shu walk · Vortex', 'from a walk');
eq(playingFromText({ hasTrack: true, walkName: null, sameIds: true, orderCount: 440, scanning: false }), 'Playing from your library', 'from the library');
eq(playingFromText({ hasTrack: true, walkName: null, sameIds: false, orderCount: 12, scanning: false }), 'Playing from a play order (12 tracks)', 'from a mix');
eq(playingFromText({ hasTrack: false, walkName: null, sameIds: true, orderCount: 0, scanning: true }), 'Scanning the library…', 'nothing playing, scanning');
eq(playingFromText({ hasTrack: false, walkName: null, sameIds: true, orderCount: 0, scanning: false }), 'Nothing playing', 'nothing playing');
eq(summaryText(440, 4 * 3600 + 120, 'Playing from your library'), '440 tracks · 4 h 2 min · Playing from your library', 'the summary line');
eq(summaryText(1, 45, 'Nothing playing'), '1 track · 45 s · Nothing playing', 'one track');
for (const n of BAD_NUMBERS) eq(summaryText(n, n, 'x'), '0 tracks · 0 s · x', `summaryText total on ${n}`);
eq(searchPlaceholder(440), 'Search 440 tracks', 'placeholder');
eq(searchPlaceholder(1), 'Search 1 track', 'placeholder, one');

// --- libraryOrderFor ---------------------------------------------------------------------------------------------
const L = [S('a', 'A'), S('b', 'B'), S('c', 'C'), S('d', 'D')];
check(libraryOrderFor(L, null) === L, 'null → the library itself (the same array)');
eq(ids(libraryOrderFor(L, ['c', 'a', 'd', 'b'])), ['c', 'a', 'd', 'b'], 'the given order');
check(libraryOrderFor(L, ['c', 'a', 'd', 'b'])[0] === L[2], 'the library’s own Song objects');
eq(ids(libraryOrderFor(L, ['c', 'x', 'a'])), ['c', 'a', 'b', 'd'], 'ids gone skipped; tracks missing from the ids appended in library order');
eq(ids(libraryOrderFor(L, ['c', 'c', 'a', 'a'])), ['c', 'a', 'b', 'd'], 'each id once');
eq(ids(libraryOrderFor(L, [])), ['a', 'b', 'c', 'd'], 'no ids → the library');
eq(ids(libraryOrderFor([...L, L[0]], ['b'])), ['b', 'a', 'c', 'd'], 'a library with a repeat: each id once');
eq(libraryOrderFor([], ['a']), [], 'an empty library → nothing');
check(sameIds(L, ['a', 'b', 'c', 'd']) && !sameIds(L, ['a', 'b', 'd', 'c']) && !sameIds(L, ['a', 'b', 'c']), 'sameIds');
// stillTapOrder: the tap's order, allowing the library's own deletes and imports since.
const tapIds = ['c', 'a', 'd', 'b'];
const byIds = (xs: string[]) => xs.map((id) => ({ id }));
check(stillTapOrder(byIds(tapIds), tapIds, L), 'stillTapOrder: unchanged');
check(stillTapOrder(byIds(['c', 'd', 'b']), tapIds, [L[1], L[2], L[3]]), 'stillTapOrder: a track deleted since');
check(stillTapOrder(byIds(['c', 'a', 'd', 'b', 'e']), tapIds, [...L, S('e', 'E')]), 'stillTapOrder: a track imported since');
check(stillTapOrder(byIds(['c', 'd', 'b', 'e']), tapIds, [L[1], L[2], L[3], S('e', 'E')]), 'stillTapOrder: deleted and imported');
check(!stillTapOrder(byIds(['a', 'b', 'c', 'b']), tapIds, L), 'stillTapOrder: a walk since → false');
check(!stillTapOrder(byIds(['a', 'b', 'c', 'd']), tapIds, L), 'stillTapOrder: another order of the same tracks → false');
check(!stillTapOrder(byIds(['c', 'd', 'b']), tapIds, L), 'stillTapOrder: a track left the play order but not the library → false');
check(!stillTapOrder(byIds(['c', 'a', 'd', 'b', 'x']), tapIds, L), 'stillTapOrder: a track the library does not hold → false');
check(!stillTapOrder(byIds([]), tapIds, L), 'stillTapOrder: emptied → false');
check(stillTapOrder(byIds([]), tapIds, []), 'stillTapOrder: everything deleted → true (nothing to restore against)');
check(sameIdSet(L, [L[3], L[1], L[0], L[2]]), 'sameIdSet: a permutation');
check(!sameIdSet(L, [L[0], L[1], L[2]]), 'sameIdSet: one missing');
check(!sameIdSet([L[0], L[0]], [L[0], L[1]]), 'sameIdSet: counts matter');
check(sameIdSet([], []), 'sameIdSet: empty');

// --- rebuildOrder ------------------------------------------------------------------------------------------------
const walk = ['a', 'b', 'c', 'b', 'd'];
const r0 = rebuildOrder(walk, 2, L);
eq([ids(r0.order), r0.cursor, r0.dropped, r0.removedCurrent], [walk, 2, false, false], 'nothing deleted: the walk, its repeats and its cursor');
check(r0.order[0] === L[0], 'the CURRENT library’s Song objects');
const libNoB = [L[0], L[2], L[3]];
const r1 = rebuildOrder(walk, 2, libNoB);
eq([ids(r1.order), r1.cursor, r1.dropped, r1.removedCurrent], [['a', 'c', 'd'], 1, true, false], 'a deleted track before the cursor (and after it, a repeat): cursor −1');
const r2 = rebuildOrder(walk, 1, libNoB);
eq([ids(r2.order), r2.cursor, r2.dropped, r2.removedCurrent], [['a', 'c', 'd'], -1, true, true], 'the cursor’s own track deleted → −1, removedCurrent');
const r3 = rebuildOrder(walk, 0, [L[0], L[1], L[2]]);
eq([ids(r3.order), r3.cursor, r3.dropped], [['a', 'b', 'c', 'b'], 0, true], 'deleted after the cursor: cursor unchanged');
const r4 = rebuildOrder(walk, 3, []);
eq([r4.order, r4.cursor, r4.dropped, r4.removedCurrent], [[], -1, true, true], 'all deleted');
const r5 = rebuildOrder(walk, -1, L);
eq([ids(r5.order), r5.cursor], [walk, -1], 'no cursor stays none');
for (const bad of [NaN, 99, 5, 2.5]) eq(rebuildOrder(walk, bad, L).cursor, -1, `a bad cursor (${bad}) → −1`);
// It agrees with removeIdsWithCursor on every cursor and every single deletion.
for (let cur = -1; cur < walk.length; cur++) {
  for (const gone of ['a', 'b', 'c', 'd']) {
    const lib1 = L.filter((s) => s.id !== gone);
    const mine = rebuildOrder(walk, cur, lib1);
    const theirs = removeIdsWithCursor(walk.map((id) => ({ id })), new Set([gone]), cur);
    eq([ids(mine.order), mine.cursor, mine.removedCurrent], [ids(theirs.list), theirs.cursor, theirs.removedCurrent], `rebuildOrder = removeIdsWithCursor (cursor ${cur}, ${gone} deleted)`);
  }
}

// --- The toast ---------------------------------------------------------------------------------------------------
eq(libraryTapText('Vortex', false), 'Playing your library from this track. The Vortex walk stopped.', 'from a walk');
eq(libraryTapText('Vortex', true), 'Playing your library from this track. The Vortex walk stopped.', 'from a walk (whatever the order)');
eq(libraryTapText(null, false), 'Playing your library from this track. The earlier play order stopped.', 'from another order');
eq(libraryTapText(null, true), 'Playing your library from this track.', 'from the library');

// --- Track info --------------------------------------------------------------------------------------------------
const NOW = Date.UTC(2026, 9, 25, 12);
eq(addedDate(`${Date.UTC(2026, 9, 25, 9)}-abc123def`, NOW), '25 Oct 2026', 'added: the id’s import time');
eq(addedDate(`${Date.UTC(2019, 11, 31)}-x`, NOW), null, 'before 2020: omitted');
eq(addedDate(`${NOW + 3 * 86_400_000}-x`, NOW), null, 'in the future: omitted');
for (const junk of ['tone-01', '', 'abc-123', '1729-', null, 42, `${NOW}`]) eq(addedDate(junk, NOW), null, `added: junk id ${JSON.stringify(junk)}`);
eq(addedDate(`${NOW}-x`, NaN), null, 'added: a bad clock');
eq(formatBytes(4.1 * 1024 * 1024), '4.1 MB', 'MB');
eq(formatBytes(512 * 1024), '512 KB', 'KB');
eq(formatBytes(900), '900 B', 'B');
for (const n of [NaN, Infinity, -Infinity, -1, '1', null]) eq(formatBytes(n), null, `formatBytes ${String(n)}`);
// v15.8: the origin is utils/mix/distribution.ts crystalOrigin's: the recorded crystalSource, else derived (Deep Scan
// always stored isAetheriaCandidate and fractalAnalysis, and deviation = |harmonicFreq − crystal|; the old
// Auto-Distribute kept a scanned harmonicFreq but stored its own score).
const scannedTrack = { fractalAnalysis: {}, harmonicFreq: 530.5, closestSolfeggio: 528, harmonicDeviation: 2.5 };
const REPLACED = "Deep Scan's crystal was replaced by an older Auto-Distribute; Assign crystals puts it back";
eq(crystalSource(S('x', 'x', scannedTrack)), 'From Deep Scan', 'source: Deep Scan');
eq(crystalSource(S('x', 'x', { harmonicFreq: 530.5, closestSolfeggio: 528, harmonicDeviation: 2.5, isAetheriaCandidate: false })), 'From Deep Scan', 'source: Deep Scan, its fractal step failed (the candidate flag marks the scan)');
eq(crystalSource(S('x', 'x', { ...scannedTrack, closestSolfeggio: 639, harmonicDeviation: 0 })), REPLACED, 'source: replaced by an older Auto-Distribute');
eq(crystalSource(S('x', 'x', { ...scannedTrack, closestSolfeggio: 528, harmonicDeviation: 0 })), 'From Deep Scan', 'source: an old Assign that kept the scan\'s crystal (its own deviation stored): still Deep Scan\'s crystal');
check(crystalFromDeepScan(S('x', 'x', { ...scannedTrack, closestSolfeggio: 528, harmonicDeviation: 0 })) && !crystalFromDeepScan(S('x', 'x', { ...scannedTrack, closestSolfeggio: 639, harmonicDeviation: 0 })), 'crystalFromDeepScan: the same crystal yes, another no');
eq(crystalSource(S('x', 'x', { fractalAnalysis: {}, closestSolfeggio: 528 })), 'Assigned, not scanned yet', 'source: a scan marker without a measurement is not a scan');
eq(crystalSource(S('x', 'x', { ...scannedTrack, closestSolfeggio: 639, harmonicDeviation: 0, crystalSource: 'scan' })), 'From Deep Scan', 'source: recorded scan (Deep Scan, v15.8)');
eq(crystalSource(S('x', 'x', { ...scannedTrack, crystalSource: 'assigned' })), 'Assigned, not scanned yet', 'source: recorded assigned wins');
check(deepScanned(S('x', 'x', scannedTrack)) && deepScanned(S('x', 'x', { harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999 })) && deepScanned(S('x', 'x', { ...scannedTrack, harmonicDeviation: 0 })) && !deepScanned(S('x', 'x', { harmonicFreq: 440, closestSolfeggio: 528 })), 'deepScanned: a scan, a failed one, a replaced one; not an assigned crystal');
check(crystalFromDeepScan(S('x', 'x', scannedTrack)) && !crystalFromDeepScan(S('x', 'x', { ...scannedTrack, fractalAnalysis: undefined })), 'crystalFromDeepScan needs a scan marker');
for (const n of BAD_NUMBERS) check(!crystalFromDeepScan(S('x', 'x', { ...scannedTrack, closestSolfeggio: 639, harmonicDeviation: n === 0 ? NaN : n })), `crystalFromDeepScan total on ${n}`);
eq(crystalSource(S('x', 'x', { harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999 })), "Deep Scan couldn't read this track; a placeholder crystal", 'source: the 999 fallback');
eq(crystalSource(S('x', 'x', { harmonicFreq: 400, closestSolfeggio: 396 })), 'Assigned, not scanned yet', 'source: assigned');
const seeded = S(`${Date.UTC(2026, 9, 25, 8)}-k1`, 'tone-0142', {
  duration: 232, closestSolfeggio: 528, harmonicFreq: 528, musicKey: 'Am', keyConfidence: 0.62, chromaVersion: 1,
  visualEnvelope: { bass: { length: 10 } }, file: { name: 'tone-0142.wav', size: 4.1 * 1024 * 1024 },
});
eq(trackInfoRows(seeded, NOW), [
  { label: 'Length', value: '3:52' },
  { label: 'Crystal', value: '528 Hz · GUT', note: 'Assigned, not scanned yet. An assigned crystal, not a measured pitch.', tag: 'design' },
  { label: 'Key', value: 'A minor · confidence 0.62', note: 'From Analyse tracks' },
  { label: 'Visual sync', value: 'From Analyse tracks' },
  { label: 'File', value: 'tone-0142.wav · 4.1 MB' },
  { label: 'Added', value: '25 Oct 2026' },
], 'Track info: a seeded track');
eq(trackInfoRows(S('tone-07', 'tone-07', { duration: 0 }), NOW), [
  { label: 'Length', value: 'Reading…' },
  { label: 'Crystal', value: 'None yet' },
  { label: 'Key', value: 'Not analysed yet' },
  { label: 'Visual sync', value: 'None yet' },
], 'Track info: an unanalysed track, a bad id date omitted, no file');
const keyRow = (o: Partial<LibSong>) => trackInfoRows(S('x', 'x', o), NOW).find((r) => r.label === 'Key');
eq(keyRow({ chromaVersion: 1 }), { label: 'Key', value: 'No clear key' }, 'key: analysed, none found');
eq(keyRow({ chromaVersion: 1, musicKey: '' }), { label: 'Key', value: 'No clear key' }, 'key: analysed, empty key');
eq(keyRow({ analysisFailedV: 1 }), { label: 'Key', value: "Couldn't be read" }, 'key: failed');
eq(keyRow({ chromaVersion: 0, musicKey: 'C' }), { label: 'Key', value: 'Not analysed yet' }, 'key: an older version');
eq(keyRow({ chromaVersion: 1, musicKey: 'C', fractalAnalysis: {} }), { label: 'Key', value: 'C major', note: 'From Deep Scan or Analyse tracks' }, 'key: no confidence; a scanned track');
const visual = (o: Partial<LibSong>) => trackInfoRows(S('x', 'x', o), NOW).find((r) => r.label === 'Visual sync')?.value;
eq(visual({ bandEnvelope: { bass: { length: 3 } }, visualEnvelope: { bass: { length: 3 } } }), 'From Deep Scan', 'visual sync: Deep Scan first');
eq(visual({ bandEnvelope: { bass: { length: 0 } }, visualEnvelope: { bass: { length: 3 } } }), 'From Analyse tracks', 'visual sync: Analyse tracks');
eq(visual({ bandEnvelope: null, visualEnvelope: { bass: { length: 0 } } }), 'None yet', 'visual sync: none');
eq(trackInfoRows(S('x', 'x', { closestSolfeggio: 2178, harmonicFreq: 2180, harmonicDeviation: 2, fractalAnalysis: {} }), NOW)[1], { label: 'Crystal', value: '2178 Hz · SOURCE', note: 'From Deep Scan. An assigned crystal, not a measured pitch.', tag: 'design' }, 'crystal: SOURCE, Deep Scan');
eq(trackInfoRows(S('x', 'x', { closestSolfeggio: 2421, harmonicFreq: 2180, harmonicDeviation: 0, fractalAnalysis: {} }), NOW)[1], { label: 'Crystal', value: '2421 Hz · HEART', note: `${REPLACED}. An assigned crystal, not a measured pitch.`, tag: 'design' }, 'crystal: replaced after a scan');
eq(trackInfoRows(S('x', 'x', { closestSolfeggio: 2178, harmonicFreq: 2180, harmonicDeviation: 0, fractalAnalysis: {} }), NOW)[1].note, 'From Deep Scan. An assigned crystal, not a measured pitch.', 'crystal: re-stored on Deep Scan\'s own crystal (fix 3)');
for (const n of BAD_NUMBERS) {
  const rows = trackInfoRows(S('x', 'x', { duration: n, closestSolfeggio: n, keyConfidence: n, chromaVersion: 1, musicKey: 'C', file: { name: 'f', size: n } }), NOW);
  check(rows.every((r) => typeof r.value === 'string' && !/NaN|Infinity|undefined/.test(r.value + (r.note ?? ''))), `trackInfoRows total on ${n}: ${JSON.stringify(rows)}`);
}
eq(trackInfoText(seeded, NOW).split('\n'), [
  'tone-0142',
  'Length: 3:52',
  'Crystal: 528 Hz · GUT (Assigned, not scanned yet. An assigned crystal, not a measured pitch.)',
  'Key: A minor · confidence 0.62 (From Analyse tracks)',
  'Visual sync: From Analyse tracks',
  'File: tone-0142.wav · 4.1 MB',
  'Added: 25 Oct 2026',
], 'Copy: the same rows as text');

// --- The health card ---------------------------------------------------------------------------------------------
const CAPS = capsFor(false);
const file = { name: 'f.wav', size: 1000 };
const mk = (n: number, f: (i: number) => Partial<LibSong>): LibSong[] => Array.from({ length: n }, (_, i) => ({ ...S(`id${i}`, `tone-${i}`, { duration: 60, file }), ...f(i) }));
const set1 = mk(40, (i) => ({
  closestSolfeggio: i % 4 === 0 ? undefined : 528,
  harmonicFreq: i % 5 === 0 ? undefined : 528,
  chromaVersion: i % 2 === 0 ? 1 : undefined,
  visualEnvelope: i % 3 === 0 ? { bass: { length: 5 } } : undefined,
}));
const h1 = libraryHealth([...set1, set1[0], set1[1]]);
eq(h1, { total: 40, noCrystal: 10, unscanned: 16, assignedToScan: 24, scanned: 0, scanReplaced: 0, emptyCrystals: 26, placeable: 30 }, 'libraryHealth: counts by each action’s own rule, each id once');
eq(libraryHealth([S('a', 'a', scannedTrack), S('b', 'b', { harmonicDeviation: 999, harmonicFreq: 440 }), S('c', 'c', { harmonicFreq: 400 }), S('d', 'd', {}), S('e', 'e', { ...scannedTrack, closestSolfeggio: 639, harmonicDeviation: 0 }), S('f', 'f', { ...scannedTrack, closestSolfeggio: 528, harmonicDeviation: 0 })]),
  { total: 6, noCrystal: 3, unscanned: 2, assignedToScan: 0, scanned: 4, scanReplaced: 1, emptyCrystals: 25, placeable: 0 }, 'libraryHealth: scanned (a scan, the 999 fallback, two the old Auto-Distribute re-stored), the queue, ONE real put-back');
eq([h1.unscanned, h1.assignedToScan], [deepScanQueue(set1).length, deepScanQueue(set1, { assigned: true }).length - deepScanQueue(set1).length], 'Scan counts = Deep Scan’s two queues');
eq(h1.unscanned + h1.assignedToScan, set1.filter((s) => needsDeepScan(s)).length, 'together, every unscanned track');
check(h1.noCrystal !== h1.unscanned, 'the crystal count is not the scan count (a mutant that swaps them fails)');
// Placeable: what Assign would still place (not scans, put-backs or anchors).
eq(libraryHealth([S('p', 'p', { closestSolfeggio: 528, harmonicFreq: 528, harmonicDeviation: 3 }), S('q', 'q', { closestSolfeggio: 528, harmonicFreq: 440, harmonicDeviation: 999 }), S('r', 'r', { closestSolfeggio: 528, harmonicFreq: 528, harmonicDeviation: 3, crystalSource: 'assigned' }), S('s', 's', scannedTrack)]).placeable, 2, 'placeable: a legacy placeholder and a failed scan; not an anchor or a scan');
const counts1 = countAnalysable(set1 as never, CAPS);
const base = (o: Partial<HealthInput> = {}): HealthInput => ({
  health: h1, pass: PASS_IDLE, analyseCounts: counts1, isScanning: false, scanProgress: 0, restoring: false, mobile: false, durationsLeft: 0, orphans: null, ...o,
});
const m1 = healthModel(base());
eq(m1.lines[0], { id: 'crystals', title: 'Crystals', line: '10 of 40 tracks have none', done: false, todo: true, action: { label: 'Assign', kind: 'assign', blocked: false } }, 'crystals to assign');
check(counts1.todo > 0, 'the set has tracks to analyse');
eq(m1.lines[1].line, `${counts1.todo} to analyse · ${passEta(passEtaMinutes(counts1.todoSeconds, false))}`, 'analyse: N to analyse · ETA (passButtonText’s)');
eq(m1.lines[1].line, passButtonText(PASS_IDLE, counts1, { deepScan: false, restoring: false, mobile: false }).sub, 'the same words as the classic button');
eq(m1.lines[1].action, { label: `Analyse ${counts1.todo}`, kind: 'analyse', blocked: false }, 'analyse button: its count = countAnalysable');
eq(m1.lines.map((l) => l.id), ['crystals', 'analyse', 'scan', 'scan-assigned'], 'with assigned tracks: the explicit line after Deep Scan’s');
eq(m1.lines[2], { id: 'scan', title: 'Deep Scan', line: 'Optional · 16 unscanned · about 40 min', done: false, todo: false, action: { label: 'Scan', kind: 'scan', blocked: false } }, 'scan: optional, ×2.5 min; its default scope only (decision 6)');
eq(m1.lines[3], { id: 'scan-assigned', title: 'Deep Scan, assigned tracks', line: 'Also scan the 24 assigned tracks (about 1 h 0 min)', done: false, todo: false, action: { label: 'Scan', kind: 'scan-assigned', blocked: false } }, 'the explicit "Also scan the N assigned tracks (about X)"');
const plainSet = mk(10, (i) => (i < 4 ? scannedTrack : {}));
const mPlain = healthModel(base({ health: libraryHealth(plainSet) }));
eq(mPlain.lines[2], { id: 'scan', title: 'Deep Scan', line: 'Optional · 6 unscanned · about 15 min', done: false, todo: false, action: { label: 'Scan', kind: 'scan', blocked: false } }, 'scan: the mockup');
check(!mPlain.lines.some((l) => l.id === 'scan-assigned'), 'no assigned track: no explicit line');
const mOnlyAssigned = healthModel(base({ health: libraryHealth(mk(10, (i) => (i < 4 ? scannedTrack : { closestSolfeggio: 639, harmonicFreq: 639, harmonicDeviation: 3, crystalSource: 'assigned' as const }))) }));
eq(mOnlyAssigned.lines.slice(2), [
  { id: 'scan', title: 'Deep Scan', line: '4 of 10 scanned', done: false, todo: false },
  { id: 'scan-assigned', title: 'Deep Scan, assigned tracks', line: 'Also scan the 6 assigned tracks (about 15 min)', done: false, todo: false, action: { label: 'Scan', kind: 'scan-assigned', blocked: false } },
], 'only assigned tracks left: Scan has nothing to do; the explicit line offers them');
eq(healthModel(base({ health: libraryHealth(mk(3, (i) => (i < 2 ? {} : { closestSolfeggio: 639 }))) })).lines[2].line, 'Optional · 3 unscanned · about 7 min', 'a crystal without a harmonicFreq is in the default scope (v15.7’s)');
eq([m1.status, m1.toDo, m1.autoOpen], ['2 to do', 2, true], 'status: 2 to do (Deep Scan does not count); open');
// v15.8: no 27-track minimum: Assign works on any library.
const small = libraryHealth(mk(12, () => ({})));
const mSmall = healthModel(base({ health: small }));
eq(mSmall.lines[0], { id: 'crystals', title: 'Crystals', line: '12 of 12 tracks have none', done: false, todo: true, action: { label: 'Assign', kind: 'assign', blocked: false } }, 'under 27 tracks: Assign');
// Every crystal covered, every track scanned: all done.
const allDone = mk(30, (i) => ({ fractalAnalysis: {}, closestSolfeggio: ALL_CRYSTALS[i % 27], harmonicFreq: ALL_CRYSTALS[i % 27] + 2.5, harmonicDeviation: 2.5, chromaVersion: 1, visualEnvelope: { bass: { length: 5 } } }));
const mDone = healthModel(base({ health: libraryHealth(allDone), analyseCounts: countAnalysable(allDone as never, CAPS) }));
eq(mDone.lines.map((l) => [l.line, l.done]), [['All 30 tracks have one', true], ['All analysed', true], ['All 30 tracks scanned', true]], 'all done');
// Every track scanned at 528 only: crystals have no track, but Assign has nothing to place there: no button (fix 4).
const oneCrystal = mk(30, () => ({ ...scannedTrack, chromaVersion: 1, visualEnvelope: { bass: { length: 5 } } }));
const mOne = healthModel(base({ health: libraryHealth(oneCrystal), analyseCounts: countAnalysable(oneCrystal as never, CAPS) }));
eq(mOne.lines[0], { id: 'crystals', title: 'Crystals', line: 'All 30 tracks have one', sub: '26 crystals have no track.', done: true, todo: false }, 'gaps Assign can’t fill: an informational line, no Assign');
eq([mOne.status, mOne.toDo], ['All set', 0], 'all set');
const anchorsGap = mk(30, () => ({ closestSolfeggio: 528, harmonicFreq: 528, harmonicDeviation: 3, crystalSource: 'assigned' as const }));
eq(healthModel(base({ health: libraryHealth(anchorsGap) })).lines[0].action, undefined, 'gaps among anchors only: no Assign (it would keep them all)');
// An older Auto-Distribute's placeholders at 528: Assign would place them, filling the gaps: offered, optional.
const legacyGap = mk(30, () => ({ closestSolfeggio: 528, harmonicFreq: 512.3, harmonicDeviation: 4, chromaVersion: 1, visualEnvelope: { bass: { length: 5 } } }));
const mLegacy = healthModel(base({ health: libraryHealth(legacyGap), analyseCounts: countAnalysable(legacyGap as never, CAPS) }));
eq(mLegacy.lines[0], { id: 'crystals', title: 'Crystals', line: 'All 30 have one · 26 crystals have no track', done: false, todo: false, action: { label: 'Assign', kind: 'assign', blocked: false } }, 'gaps Assign can fill: Assign, optional');
eq([mLegacy.status, mLegacy.toDo], ['All set', 0], 'optional Assign is not to do');
// Deep Scan crystals an older Auto-Distribute replaced: Assign is to do (it puts them back).
const replacedSet = mk(30, (i) => ({ fractalAnalysis: {}, closestSolfeggio: ALL_CRYSTALS[i % 27], harmonicFreq: 530.5, harmonicDeviation: i < 5 ? 0 : Math.abs(530.5 - ALL_CRYSTALS[i % 27]), chromaVersion: 1, visualEnvelope: { bass: { length: 5 } } }));
const mRep = healthModel(base({ health: libraryHealth(replacedSet), analyseCounts: countAnalysable(replacedSet as never, CAPS) }));
// (Of the five with a broken relation, the one at 528 still shows Deep Scan's crystal for 530.5 Hz: not counted, fix 3.)
eq(mRep.lines[0], { id: 'crystals', title: 'Crystals', line: "All 30 have one · 4 can get Deep Scan's crystal back", done: false, todo: true, action: { label: 'Assign', kind: 'assign', blocked: false } }, 'replaced crystals: Assign to do, only the real differences counted');
eq(healthModel(base({ health: libraryHealth(mk(1, () => ({ ...scannedTrack, closestSolfeggio: 639, harmonicDeviation: 0 }))) })).lines[0].line, "The track has one · 1 can get Deep Scan's crystal back", 'one track');
eq(healthModel(base({ health: libraryHealth(mk(1, () => ({ ...scannedTrack, harmonicDeviation: 0 }))) })).lines[0], { id: 'crystals', title: 'Crystals', line: 'The track has one', sub: '26 crystals have no track.', done: true, todo: false }, 'a re-stored scan on its own crystal: nothing to put back');
eq(healthModel(base({ health: libraryHealth([]) })).lines[0], { id: 'crystals', title: 'Crystals', line: 'All 0 tracks have one', done: true, todo: false }, 'an empty library: as v15.7');
// After an Assign and no Deep Scan: every track has an assigned crystal; all of them are still Deep Scan's to do.
const assignedOnly = mk(30, (i) => ({ closestSolfeggio: ALL_CRYSTALS[i % 27], harmonicFreq: ALL_CRYSTALS[i % 27], harmonicDeviation: 3, crystalSource: 'assigned' as const, chromaVersion: 1, visualEnvelope: { bass: { length: 5 } } }));
const mAssigned = healthModel(base({ health: libraryHealth(assignedOnly), analyseCounts: countAnalysable(assignedOnly as never, CAPS) }));
eq(mAssigned.lines[0].line, 'All 30 tracks have one', 'after an Assign: every crystal has a track');
eq(mAssigned.lines.slice(2), [
  { id: 'scan', title: 'Deep Scan', line: '0 of 30 scanned', done: false, todo: false },
  { id: 'scan-assigned', title: 'Deep Scan, assigned tracks', line: 'Also scan the 30 assigned tracks (about 1 h 15 min)', done: false, todo: false, action: { label: 'Scan', kind: 'scan-assigned', blocked: false } },
], 'after an Assign: Scan has nothing left by default; the explicit line can still measure them');
eq([mAssigned.status, mAssigned.autoOpen, mAssigned.folded], ['All set', false, 'All set · Deep Scan optional'], 'after an Assign: folded, Deep Scan optional');
eq([mDone.status, mDone.toDo, mDone.autoOpen, mDone.folded], ['All set', 0, false, 'All set'], 'all set: folded');
const unscannedDone = mk(30, () => ({ closestSolfeggio: 528, chromaVersion: 1, visualEnvelope: { bass: { length: 5 } } }));
const mOpt = healthModel(base({ health: libraryHealth(unscannedDone), analyseCounts: countAnalysable(unscannedDone as never, CAPS) }));
eq([mOpt.status, mOpt.autoOpen, mOpt.folded], ['All set', false, 'All set · Deep Scan optional'], 'Deep Scan alone keeps it folded');
// Analyse tracks running.
const running = { ...PASS_IDLE, phase: 'running' as const, done: 12, total: 230, etaMin: 18 };
const mRun = healthModel(base({ pass: running }));
eq(mRun.lines[1], {
  id: 'analyse', title: 'Keys and visual sync', line: 'Analysing 12 of 230 · about 18 min left', sub: 'Pauses around track changes and while the screen is off',
  done: false, todo: true, action: { label: 'Stop', kind: 'analyse', blocked: false }, progress: 12 / 230,
}, 'analyse running: passButtonText’s words, Stop, progress');
eq(mRun.lines[2].action, { label: 'Scan', kind: 'scan', blocked: true }, 'scan blocked while Analyse runs');
eq(mRun.lines[2].sub, 'Unavailable while Analyse tracks runs', 'its reason');
eq([mRun.lines[3].action, mRun.lines[3].sub], [{ label: 'Scan', kind: 'scan-assigned', blocked: true }, 'Unavailable while Analyse tracks runs'], 'the explicit scan is blocked too');
eq([mRun.status, mRun.autoOpen], ['Analysing…', true], 'status while analysing');
eq(healthModel(base({ pass: { ...running, phase: 'parked' } })).lines[1].line, 'Analysing 12 of 230 · Paused while the screen is off', 'parked');
eq(healthModel(base({ pass: { ...running, phase: 'stopping' } })).lines[1].line, 'Stopping…', 'stopping');
check(healthModel(base({ pass: { ...running, phase: 'stopping' } })).lines[1].action?.blocked === true, 'Stop blocked while stopping');
eq(healthModel(base({ pass: { ...running, total: 0 } })).lines[1].progress, 0, 'progress total 0 → 0');
// Deep Scan running.
const mScan = healthModel(base({ isScanning: true, scanProgress: 12.4 }));
eq(mScan.lines[2], { id: 'scan', title: 'Deep Scan', line: 'Scanning · 12 %', done: false, todo: false, action: { label: 'Stop', kind: 'stop-scan', blocked: false } }, 'scanning: Stop');
check(!mScan.lines.some((l) => l.id === 'scan-assigned'), 'scanning: one Stop, no second scan line');
eq(mScan.lines[1].action?.blocked, true, 'Analyse blocked while Deep Scan runs');
eq(mScan.lines[1].sub, 'Unavailable while Deep Scan runs', 'its reason (passButtonText)');
eq(mScan.lines[0].action?.blocked, true, 'Assign blocked while Deep Scan runs (its toast explains)');
eq([mScan.status, mScan.autoOpen], ['Scanning…', true], 'status while scanning');
for (const p of BAD_NUMBERS) check(/^Scanning · \d+ %$/.test(healthModel(base({ isScanning: true, scanProgress: p })).lines[2].line), `scan progress total on ${p}`);
// v16.5 review (B10): an export running holds Analyse tracks and Deep Scan (both scans), with the reason; nothing else.
{
  const mExp = healthModel(base({ exporting: true }));
  eq([mExp.lines[1].action?.blocked, mExp.lines[1].sub], [true, 'Unavailable while an export runs'], 'exporting: Analyse held, the reason');
  eq([mExp.lines[2].action?.blocked, mExp.lines[2].sub], [true, 'Unavailable while an export runs'], 'exporting: Deep Scan held');
  eq(mExp.lines[0].action?.blocked ?? false, healthModel(base()).lines[0].action?.blocked ?? false, 'exporting: Assign as it was');
  const mExpRun = healthModel(base({ exporting: true, pass: running }));
  eq([mExpRun.lines[1].action?.label, mExpRun.lines[1].action?.blocked], ['Stop', false], 'exporting: a running pass keeps its Stop');
  const mExpScan = healthModel(base({ exporting: true, isScanning: true, scanProgress: 5 }));
  eq(mExpScan.lines[2].action, { label: 'Stop', kind: 'stop-scan', blocked: false }, 'exporting: a running scan keeps its Stop');
  eq(JSON.stringify(healthModel(base({ exporting: false }))), JSON.stringify(healthModel(base())), 'not exporting: the card as it was');
  // v16.5 final: a cancelled export that was let go and is still stopping holds them too, with its own reason.
  const mStop = healthModel(base({ exportStopping: true }));
  eq([mStop.lines[1].action?.blocked, mStop.lines[1].sub], [true, 'Unavailable while the cancelled export stops'], 'stopping: Analyse held, the reason');
  eq([mStop.lines[2].action?.blocked, mStop.lines[2].sub], [true, 'Unavailable while the cancelled export stops'], 'stopping: Deep Scan held');
  eq(healthModel(base({ exportStopping: true, pass: running })).lines[1].action?.label, 'Stop', 'stopping: a running pass keeps its Stop');
  eq(JSON.stringify(healthModel(base({ exportStopping: false }))), JSON.stringify(healthModel(base())), 'not stopping: the card as it was');
  // v16.5 export memory: still stopping a minute on, the line adds the reload.
  const mLong = healthModel(base({ exportStopping: true, exportStoppingLong: true }));
  eq([mLong.lines[1].sub, mLong.lines[2].sub], ['Unavailable while the cancelled export stops, or reload Aetheria', 'Unavailable while the cancelled export stops, or reload Aetheria'], 'a minute on: the reload added');
  eq(JSON.stringify(healthModel(base({ exportStoppingLong: true }))), JSON.stringify(healthModel(base())), 'not stopping: the minute changes nothing');
}
// Restoring blocks Analyse.
eq(healthModel(base({ restoring: true })).lines[1].action?.blocked, true, 'Analyse blocked while the library loads');
// Failed and too long.
eq(healthModel(base({ analyseCounts: { todo: 0, todoSeconds: 0, failed: 3, failedSeconds: 1, tooLong: 0 } })).lines[1].line, "3 couldn't be read", 'failed');
eq(healthModel(base({ analyseCounts: { todo: 0, todoSeconds: 0, failed: 3, failedSeconds: 1, tooLong: 0 } })).lines[1].action?.label, 'Try again', 'Try again');
eq(healthModel(base({ analyseCounts: { todo: 0, todoSeconds: 0, failed: 0, failedSeconds: 0, tooLong: 2 } })).lines[1].line, 'All analysed · 2 too long for this device', 'too long');
// Mobile note on Scan.
eq([healthModel(base({ mobile: true })).lines[2].sub, healthModel(base({ mobile: true })).lines[3].sub], ['Slow on a phone, and keeps it busy.', 'Slow on a phone, and keeps it busy.'], 'the phone note, on both scans');
eq(healthModel(base({ mobile: true, health: libraryHealth(plainSet) })).lines[2].sub, 'Slow on a phone, and keeps it busy.', 'the phone note');
// Track lengths and orphans.
const mLen = healthModel(base({ health: libraryHealth(allDone), analyseCounts: countAnalysable(allDone as never, CAPS), durationsLeft: 9 }));
eq(mLen.lines.find((l) => l.id === 'lengths'), { id: 'lengths', title: 'Track lengths', line: 'Reading 9 more…', done: false, todo: false }, 'reading lengths');
eq(mLen.autoOpen, true, 'reading lengths keeps it open');
const mOrph = healthModel(base({ orphans: { fresh: 7, duplicates: 2 } }));
eq(mOrph.lines.find((l) => l.id === 'orphans'), { id: 'orphans', title: 'Stored tracks not in your library', line: '7 stored tracks are not in your library', done: false, todo: true, action: { label: 'Review', kind: 'review', blocked: false } }, 'orphans: Review');
eq(mOrph.status, '3 to do', 'orphans count as to do');
eq(orphanText(1, 0), '1 stored track is not in your library', 'one orphan');
eq(orphanText(0, 3), '3 stored copies of tracks already in your library', 'copies');
eq(orphanText(0, 1), '1 stored copy of tracks already in your library', 'one copy');
eq(healthModel(base({ orphans: { fresh: 0, duplicates: 0 } })).lines.some((l) => l.id === 'orphans'), false, 'no orphans → no line');
for (const n of BAD_NUMBERS) {
  const m = healthModel(base({ durationsLeft: n, orphans: { fresh: n, duplicates: n } }));
  check(m.lines.every((l) => !/NaN|Infinity|undefined|-\d/.test(l.line + (l.sub ?? ''))), `healthModel total on ${n}`);
}
// The Assign confirmation (v15.8): from the plan, each sentence only when its count is above 0; asked only when crystals
// tracks already have would change.
const quiet = <T,>(f: () => T): T => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const legacy = [
  ...mk(3, (i) => ({ fractalAnalysis: {}, closestSolfeggio: ALL_CRYSTALS[i], harmonicFreq: ALL_CRYSTALS[i] + 1, harmonicDeviation: 1 })),   // scans
  ...mk(2, () => ({ fractalAnalysis: {}, closestSolfeggio: 6336, harmonicFreq: 640, harmonicDeviation: 0 })),   // replaced
  ...mk(2, () => ({})),                                                                                          // none
].map((s, i) => ({ ...s, id: `L${i}` }));
const pLegacy = quiet(() => planAssign(legacy));
eq([pLegacy.kept, pLegacy.restored, pLegacy.given, pLegacy.moved], [3, 2, 2, 0], 'a small legacy plan: 3 kept, 2 put back, 2 given');
check(assignNeedsConfirm(pLegacy), 'crystals put back: ask first');
eq(assignConfirmText(pLegacy), {
  title: 'Assign crystals?',
  body: "Tracks Deep Scan placed keep their crystal. 2 get back the crystal Deep Scan gave them, which an older Auto-Distribute had replaced. 2 tracks without one get a crystal. Assigned crystals aren't a scan: Deep Scan can still analyse those tracks. Keys and visual sync are kept.",
}, 'the Assign confirmation');
const pNew = quiet(() => planAssign(mk(2, () => ({}))));
check(!assignNeedsConfirm(pNew), 'only new crystals: no question');
eq(assignConfirmText(pNew).body, "2 tracks without one get a crystal. Assigned crystals aren't a scan: Deep Scan can still analyse those tracks. Keys and visual sync are kept.", 'no Deep Scan sentence without a scan');

// --- The Import sheet --------------------------------------------------------------------------------------------
eq(lastImportLines({ added: 12, skipped: 3, joinedPlayOrder: false, at: 0 }, 9), {
  head: 'Added 12 tracks to your library',
  lines: ['Skipped 3 files that are not playable audio.', 'Reading track lengths · 9 left'],
  quiet: "The list that's playing is unchanged.",
}, 'the last import');
eq(lastImportLines({ added: 1, skipped: 1, joinedPlayOrder: true, at: 0 }, 0), { head: 'Added 1 track to your library', lines: ['Skipped 1 file that is not playable audio.'], quiet: null }, 'one, joined');
eq(lastImportLines({ added: 0, skipped: 2, joinedPlayOrder: false, at: 0 }, 0).head, 'No tracks added', 'nothing added');
for (const n of BAD_NUMBERS) check(!/NaN|Infinity|-\d/.test(JSON.stringify(lastImportLines({ added: n, skipped: n, joinedPlayOrder: false, at: n }, n))), `lastImportLines total on ${n}`);
eq(recoverWords(7, 0), { head: '7 stored tracks are not in your library', body: 'Their audio is still on this device, from an earlier version.', extra: null, recover: 'Recover 7' }, 'recover');
eq(recoverWords(7, 2).extra, '2 more are copies of tracks you have and will be removed.', 'recover + copies');
eq(recoverWords(0, 1).recover, 'Remove copies', 'copies only');

// --- v16.2: the smart filters' text IS this search -------------------------------------------------------------
// filterPass with no chips, over the sorted list, returns exactly filterLibrary's rows (the same objects, in order) for
// random libraries, every sort and awkward queries (case, spaces, accents, dotted capitals, nothing matching). A drift
// of either rule fails here.
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const NAMES = ['tone-0001', 'Tone-0002 Deep', 'tone 3', 'ÄRIA tone', '', 'tone-0010', 'TONE-0100', 'deep focus', 'İstanbul tone'];
  const SORTS = LIBRARY_SORTS.map((s) => s.id);
  const QUERIES = ['', 'tone', ' TONE ', 'deep', '1', 'ä', 'i̇', 'zzz', '-00'];
  let same = 0;
  let rounds = 0;
  for (let r = 0; r < 2000; r++) {
    const n = 1 + Math.floor(rnd() * 40);
    const songs: LibSong[] = Array.from({ length: n }, (_, i) => ({
      id: `id${Math.floor(rnd() * n)}`,
      name: NAMES[Math.floor(rnd() * NAMES.length)] + (rnd() < 0.5 ? ` ${i}` : ''),
      duration: rnd() * 600,
      closestSolfeggio: [0, 528, 639][i % 3],
    }));
    const sorted = sortLibrary(songs, SORTS[r % SORTS.length]);
    const q = QUERIES[Math.floor(rnd() * QUERIES.length)];
    const a = filterLibrary(sorted, q);
    const b = filterPass(buildFacetIndex(sorted), NO_FILTERS, q).results;
    rounds++;
    if (a.length === b.length && a.every((s, i) => s === b[i])) same++;
  }
  eq(same, rounds, 'the filters’ text equals the search on 2,000 random libraries, sorts and queries');
}

if (failures.length) {
  console.error(`libraryModel: ${failures.length} of ${passed + failures.length} checks FAILED`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`libraryModel: all ${passed} checks passed`);
