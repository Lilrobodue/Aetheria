// Checks for components/shell/shellModel.ts (v15.5, the new layout beta; v16.8, the new layout as the default).
// Run with: node components/shell/shellModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  LAYOUT_KEY,
  LAYOUT_DEFAULT,
  LAYOUT_NOTICE_KEY,
  LAYOUT_LAUNCH_BLOCKED,
  LAYOUT_CARD_TEXT,
  LAYOUT_CARD_TOUR,
  LAYOUT_CARD_DISMISS,
  isLayoutPref,
  isLayoutNotice,
  layoutAtLaunch,
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
  queueSourceLine,
  queueThen,
  queueSourceShort,
} from './shellModel.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// parseLayoutPref: every input class; v16.8: a missing or invalid value means the new layout (the default), and the
// query beats storage.
eq(LAYOUT_KEY, 'aetheria.layout.v1', 'the storage key');
eq(LAYOUT_DEFAULT, 'new', 'v16.8: the default is the new layout');
eq(parseLayoutPref(null, null), 'new', 'missing → new');
eq(parseLayoutPref(undefined, undefined), 'new', 'undefined → new');
eq(parseLayoutPref('new', null), 'new', "stored 'new'");
eq(parseLayoutPref('classic', null), 'classic', "stored 'classic'");
for (const junk of ['garbage', 'NEW', ' new', 'new ', '', 'true', '1', '{"v":"new"}', 'null', 'undefined', 'CLASSIC', 'classic ']) {
  eq(parseLayoutPref(junk, null), 'new', `stored junk ${JSON.stringify(junk)} → new`);
  eq(parseLayoutPref('classic', junk), 'classic', `query junk ${JSON.stringify(junk)} is ignored (classic stored)`);
  eq(parseLayoutPref('new', junk), 'new', `query junk ${JSON.stringify(junk)} is ignored (new stored)`);
}
eq(parseLayoutPref('classic', 'new'), 'new', 'the query beats storage (new)');
eq(parseLayoutPref('new', 'classic'), 'classic', 'the query beats storage (classic)');
eq(parseLayoutPref(null, 'new'), 'new', 'the query alone (new)');
eq(parseLayoutPref(null, 'classic'), 'classic', 'the query alone (classic)');

// v16.8: layoutAtLaunch, decision 1 B (a saved "classic" from before v16.8 is moved once) and 2 A (the card).
eq(LAYOUT_NOTICE_KEY, 'aetheria.layoutNotice.v1', 'the notice key');
eq(LAYOUT_LAUNCH_BLOCKED, { layout: 'new', card: false, mark: null, clearStored: false }, 'storage that throws: new, no card, nothing written');
const L = (stored: string | null, query: string | null, mark: string | null, priorUse: boolean) => layoutAtLaunch({ stored, query, mark, priorUse });
const R = (layout: string, card: boolean, mark: string | null, clearStored = false) => ({ layout, card, mark, clearStored });
// §3.2's table, the first v16.8 launch (no mark).
eq(L(null, null, null, false), R('new', false, 'fresh'), 'a new install: new, no card, marked fresh');
eq(L(null, null, null, true), R('new', true, 'due'), 'an existing user who never chose: new, the card');
eq(L('classic', null, null, true), R('new', true, 'due', true), "1 B: a saved 'classic' (prior use): moved, the card, the saved value removed");
eq(L('classic', null, null, false), R('new', true, 'due', true), "1 B: a saved 'classic' is itself prior use: moved, the card");
eq(L('new', null, null, true), R('new', false, 'seen'), "a saved 'new': new, no card, marked seen");
eq(L('new', null, null, false), R('new', false, 'seen'), "a saved 'new' without other prior use: the same");
eq(L('garbage', null, null, true), R('new', true, 'due'), 'junk with prior use: as never chose (the junk left as it is)');
eq(L('garbage', null, null, false), R('new', false, 'fresh'), 'junk without prior use: as a new install');
eq(L(null, 'classic', null, false), R('classic', false, 'fresh'), '?layout=classic on a new install: classic, no card, fresh');
eq(L(null, 'new', null, false), R('new', false, 'fresh'), '?layout=new on a new install: new, no card, fresh');
eq(L(null, 'classic', null, true), R('classic', false, 'seen'), '?layout=classic with prior use: as asked, no card, seen');
eq(L('classic', 'new', null, true), R('new', false, 'seen'), "?layout=new over a saved 'classic': new, nothing removed (the effect saves 'new')");
eq(L('classic', 'classic', null, true), R('classic', false, 'seen'), "?layout=classic over a saved 'classic': the address's choice holds");
eq(L('new', 'classic', null, false), R('classic', false, 'seen'), "?layout=classic over a saved 'new' (a choice: prior use)");
eq(L('garbage', 'garbage', null, false), R('new', false, 'fresh'), 'junk in both, no prior use: a new install');
eq(L(null, 'garbage', null, true), R('new', true, 'due'), 'a junk query is no query');
// Marked: the move is done; a saved choice is a v16.8 tap's (or the address's) and holds; the card only while due.
for (const mark of ['fresh', 'due', 'seen']) {
  for (const prior of [false, true]) {
    const card = mark === 'due';
    eq(L(null, null, mark, prior), R('new', card, null), `marked ${mark}, nothing saved (prior use ${prior})`);
    eq(L('classic', null, mark, prior), R('classic', card, null), `marked ${mark}: a saved 'classic' holds (prior use ${prior})`);
    eq(L('new', null, mark, prior), R('new', card, null), `marked ${mark}: a saved 'new' (prior use ${prior})`);
    eq(L('garbage', null, mark, prior), R('new', card, null), `marked ${mark}: junk saved → new (prior use ${prior})`);
    eq(L('classic', 'new', mark, prior), R('new', false, null), `marked ${mark}: ?layout=new, no card on that launch`);
    eq(L('new', 'classic', mark, prior), R('classic', false, null), `marked ${mark}: ?layout=classic, no card on that launch`);
  }
}
// Review A2: any mark counts, one this version doesn't know (a later version's) too: a saved choice holds, never moved
// again; no card unless it is 'due'.
for (const other of ['', 'SEEN', 'Fresh', 'true', 'moved', 'null', ' seen', 'v17']) {
  eq(L('classic', null, other, true), R('classic', false, null), `mark ${JSON.stringify(other)}: a saved classic holds`);
  eq(L(null, null, other, false), R('new', false, null), `mark ${JSON.stringify(other)}, nothing saved: new, no write`);
  eq(L('new', 'classic', other, true), R('classic', false, null), `mark ${JSON.stringify(other)}: the query as asked`);
}
eq(isLayoutNotice('due') && isLayoutNotice('fresh') && isLayoutNotice('seen') && !isLayoutNotice('moved'), true, 'the three marks this version writes');
// Launch sequences: apply each launch's writes as App does (the mark, the removal), with the profile's taps between.
{
  type Store = { layout: string | null; mark: string | null; prior: boolean };
  const launch = (s: Store, query: string | null = null) => {
    const r = layoutAtLaunch({ stored: s.layout, query, mark: s.mark, priorUse: s.prior });
    if (r.mark) s.mark = r.mark;
    if (r.clearStored) s.layout = null;
    if (isLayoutPref(query)) s.layout = query; // the ?layout= effect
    return r;
  };
  // A new install: the statement accepted and the tour closed at launch 1 (prior use from then on): never a card.
  const fresh: Store = { layout: null, mark: null, prior: false };
  eq(launch(fresh), R('new', false, 'fresh'), 'new install, launch 1');
  fresh.prior = true;
  eq(launch(fresh), R('new', false, null), 'new install, launch 2: no card (marked fresh)');
  eq(launch(fresh), R('new', false, null), 'new install, launch 3');
  // A saved 'classic' from v16.7: moved once; the card until tapped; its "Use the classic layout" then holds.
  const moved: Store = { layout: 'classic', mark: null, prior: true };
  eq(launch(moved), R('new', true, 'due', true), 'v16.7 classic, launch 1: moved');
  eq(moved, { layout: null, mark: 'due', prior: true }, 'v16.7 classic: the saved value removed, marked due');
  eq(launch(moved), R('new', true, null), 'v16.7 classic, launch 2: the card again (not tapped)');
  moved.layout = 'classic'; // ⋯ › Back to classic (not the card)
  eq(launch(moved), R('classic', true, null), 'a v16.8 Back to classic holds; the card stays due (App shows it in the new layout only)');
  moved.layout = 'new'; // the pill
  moved.mark = 'seen'; // then the card's X
  eq(launch(moved), R('new', false, null), 'closed: never again');
  moved.layout = 'classic'; // Use the classic layout later
  eq(launch(moved), R('classic', false, null), 'a later classic tap holds for v16.8');
  eq(launch(moved), R('classic', false, null), '... and keeps holding (the move never repeats)');
  // ?layout=classic on a new install, then plain launches: classic holds.
  const queried: Store = { layout: null, mark: null, prior: false };
  eq(launch(queried, 'classic'), R('classic', false, 'fresh'), '?layout=classic, launch 1');
  eq(launch(queried), R('classic', false, null), 'then a plain launch: still classic, no move');
  eq(launch(queried, 'new'), R('new', false, null), '?layout=new');
  eq(launch(queried), R('new', false, null), 'then a plain launch: new, no card');
  // A beta user: never a card, and a later Back to classic holds.
  const beta: Store = { layout: 'new', mark: null, prior: true };
  eq(launch(beta), R('new', false, 'seen'), 'beta, launch 1');
  beta.layout = 'classic';
  eq(launch(beta), R('classic', false, null), 'beta, then Back to classic: holds');
}
// The card's words (decision 2 A; its second button is moreModel's USE_CLASSIC).
eq(LAYOUT_CARD_TEXT, 'Aetheria now opens in the new layout. For this version, the classic layout is still in More › Advanced.', 'the card');
eq(LAYOUT_CARD_TOUR, 'Show the tour', 'the card: the tour');
eq(LAYOUT_CARD_DISMISS, 'Dismiss the layout notice', 'the card: its X');

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

// v16.0: the source line while a queued track plays.
eq(queueSourceLine(1, 3, queueThen(null, true, 0, 0, true)), 'Your queue · 1 of 3 · then Library', 'a queued track, then the library');
eq(queueSourceLine(2, 3, queueThen(null, false, 0, 0, true)), 'Your queue · 2 of 3 · then Play order', 'then another play order');
eq(queueSourceLine(1, 1, queueThen('Vortex', false, 4, 27, true)), 'Your queue · 1 of 1 · then Vortex step 4 of 27', 'inside a walk: its next step');
eq(queueSourceLine(1, 2, queueThen(null, true, 0, 0, false)), 'Your queue · 1 of 2', 'nothing after the queue');
eq(queueThen('Vortex', false, 0, 27, true), 'Vortex', 'a walk without a next step number');
eq(queueSourceShort(1, 3), 'Queue 1/3', 'the mini-player short form');
// With a queue the walk counts walk entries only, and the library line counts the play order's own entries: the same
// sourceLine and walkSegment with those numbers (App passes them; no queue, the numbers are the old ones).
eq(sourceLine('CAB', false, 30, 81, walkSegment('combined', [27, 27, 27], 30)), 'Lo Shu walk · CAB · step 31 of 81 · Ascent 4/27', 'a CAB step counted without its queued entries');

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
