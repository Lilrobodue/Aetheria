// components/shell/mixes/builder/builderViewModel.check.ts (v16.3): every word Create a mix shows (npm run check:shell;
// Node 22.18+ strips the types). Expectations are written out here, never computed by the module's helpers.

import * as W from './builderViewModel.ts';

let passed = 0;
const failures: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else failures.push(`${what}: ${JSON.stringify(got)} !== ${JSON.stringify(want)}`);
};

// App's words (the toasts).
eq([W.LIBRARY_SOURCE_NAME, W.QUEUE_SOURCE_NAME], ['your library', 'your queue'], 'the sources in a name');
eq(W.QUEUE_PLAY_NOTE, 'Your queue is in it now.', 'Play from the queue');
// v16.3 review: the queued tracks a narrowing mix leaves out, before Play (the footer) and after (the toast).
// v16.3 re-review: QUEUE_UNPICKED is a one-place switch: both modes' words are checked here whichever is set (each
// function takes the mode), then the functions' defaults against the mode that is set.
const LEAVE = {
  footer7: '7 of your queued tracks aren’t in this mix: they leave the queue.',
  footer1: '1 of your queued tracks isn’t in this mix: it leaves the queue.',
  footerAbout: 'About 1,200 of your queued tracks aren’t in this mix: they leave the queue.',
  line7: 'Your queue becomes this mix.',
  note7: 'Your queue became this mix. 7 queued tracks left the queue.',
  note1: 'Your queue became this mix. 1 queued track left the queue.',
};
const KEEP = {
  footer7: '7 of your queued tracks aren’t in this mix: they stay queued and play after its first track.',
  footer1: '1 of your queued tracks isn’t in this mix: it stays queued and plays after its first track.',
  footerAbout: 'About 1,200 of your queued tracks aren’t in this mix: they stay queued and play after its first track.',
  line7: null,
  note7: '',
  note1: '',
};
for (const [mode, w] of [['leave', LEAVE], ['keep', KEEP]] as const) {
  eq([W.queueLeftLine(0, false, mode), W.queueLeftLine(-1, true, mode), W.queueLeftLine(NaN, false, mode)], [null, null, null], `${mode}: the footer: nothing left out, no line`);
  eq(W.queueLeftLine(7, false, mode), w.footer7, `${mode}: the footer: 7 left out`);
  eq(W.queueLeftLine(1, false, mode), w.footer1, `${mode}: the footer: 1 left out`);
  eq(W.queueLeftLine(1200, true, mode), w.footerAbout, `${mode}: the footer: a random walk`);
  eq(W.queuePlayLine(W.queueLeftLine(7, false, mode), mode), w.line7, `${mode}: "Your queue becomes this mix." with 7 left out`);
  eq(W.queuePlayLine(W.queueLeftLine(0, false, mode), mode), 'Your queue becomes this mix.', `${mode}: "Your queue becomes this mix." with every queued track picked`);
  eq([W.queuePlayNote(0, mode), W.queuePlayNote(NaN, mode)], ['Your queue is in it now.', 'Your queue is in it now.'], `${mode}: the toast: every queued track picked (as before)`);
  eq(W.queuePlayNote(7, mode), w.note7, `${mode}: the toast: 7 left out`);
  eq(W.queuePlayNote(1, mode), w.note1, `${mode}: the toast: 1 left out`);
}
// 'keep': the toast's one sentence for the kept tracks (App's startPlayOrder adds it as it carries them).
eq(W.queueKeptText(7), 'The 7 queued tracks not in it play next.', 'keep: the toast, 7 kept');
eq(W.queueKeptText(1), 'The queued track not in it plays next.', 'keep: the toast, 1 kept');
eq(W.queueKeptText(1200), 'The 1,200 queued tracks not in it play next.', 'keep: the toast, 1,200 kept');
// The switch: one of the two, and every default follows it.
eq(['leave', 'keep'].includes(W.QUEUE_UNPICKED), true, `the switch is 'leave' or 'keep' (it is '${W.QUEUE_UNPICKED}')`);
{
  const w = W.QUEUE_UNPICKED === 'keep' ? KEEP : LEAVE;
  eq([W.queueLeftLine(7, false), W.queueLeftLine(1, false), W.queueLeftLine(1200, true)], [w.footer7, w.footer1, w.footerAbout], `the footer follows the switch (${W.QUEUE_UNPICKED})`);
  eq(W.queuePlayLine(W.queueLeftLine(7, false)), w.line7, `"Your queue becomes this mix." follows the switch (${W.QUEUE_UNPICKED})`);
  eq([W.queuePlayNote(7), W.queuePlayNote(1)], [w.note7, w.note1], `the toast follows the switch (${W.QUEUE_UNPICKED})`);
}
eq(W.FROM_QUEUE_QUEUED_TEXT.includes('queued already'), true, 'queueing a mix of the queue');

// Start from.
eq([W.libraryChoiceSub(440), W.libraryChoiceSub(1)], ['440 tracks', '1 track'], 'the library choice');
eq([W.queueChoiceSub(3), W.queueChoiceSub(0), W.queueChoiceSub(1200)], ['3 waiting', 'Nothing waiting', '1,200 waiting'], 'the queue choice');
eq(W.playlistChoiceSub(34), '34 tracks', 'the playlist choice');
eq(W.playlistGoneLine('Evening'), 'Evening is gone, so this starts from your library.', 'a gone playlist');
eq(W.playlistGoneLine(null), 'That playlist is gone, so this starts from your library.', 'a gone playlist, unnamed');
eq(W.sourceQueueLine(3), '3 tracks waiting. Play makes the mix your play order, so they don’t play twice.', 'the sheet: the queue');
eq(W.sourceQueueLine(1), '1 track waiting. Play makes the mix your play order, so they don’t play twice.', 'the sheet: one queued');
eq(W.sourceQueueLine(0), 'Nothing is waiting in your queue.', 'the sheet: nothing queued');
eq([W.sourcePlaylistLine(18, 2), W.sourcePlaylistLine(61, 0)], ['18 tracks · 2 missing', '61 tracks'], 'the sheet: playlists');
eq([W.SOURCE_SHEET_TITLE, W.SOURCE_SHEET_SUB], ['Start from', 'The mix is built from these tracks only.'], 'the sheet');

// Follow.
eq(W.FOLLOW_KINDS.map((k) => k.label), ['A Lo Shu walk', 'A crystal set', 'Any crystal', 'Experimental'], 'the four kinds');
eq(W.walkChoiceSub(26, 27), '26 of 27', 'a walk');
eq(W.setLine([174, 285, 396, 417]), '174 · 285 · 396 · 417 Hz · the crystals Deep Scan or Assign crystals gave each track, not a measured pitch.', 'a set');
eq(W.setLine([]), 'The crystals Deep Scan or Assign crystals gave each track, not a measured pitch.', 'a set with none');
eq(W.setLine([174, 285, 396, 417, 528, 639, 741, 852, 963]), '174–963 Hz, 9 crystals · the crystals Deep Scan or Assign crystals gave each track, not a measured pitch.', 'a regime: its range');
eq(W.setLine([174, 285, 396, 417, 528]), '174 · 285 · 396 · 417 · 528 Hz · the crystals Deep Scan or Assign crystals gave each track, not a measured pitch.', 'five crystals listed');
eq(W.CUSTOM_LEAD.startsWith('Custom: tap the crystals to follow (all 27 always show).'), true, 'custom');
eq([W.crystalChipName(528, 17), W.crystalChipName(963, 1)], ['528 Hz, 17 tracks', '963 Hz, 1 track'], 'crystal chips');
eq([W.setChipName('Grounding', 62), W.setChipName('Custom…', null)], ['Grounding, 62 tracks', 'Custom…'], 'set chips');

// Tracks per crystal.
eq([W.PER_LINES[1], W.PER_LINES[3], W.PER_LINES.all], ['The best match on each crystal', 'Up to three per crystal, best first', 'Every track on these crystals'], 'per lines');
eq(W.PER_WALK_LINE, 'One track per position, as the walk picks them.', 'a walk\'s per');

// Filters.
eq([W.noFiltersLine('library'), W.noFiltersLine('playlist'), W.noFiltersLine('queue')], ['None: every track in your library.', 'None: every track in the playlist.', 'None: every track in your queue.'], 'no filters');

// Order.
eq(W.orderLabel('walk', 'pattern', 'library'), 'The walk’s order', 'a walk\'s pattern');
eq(W.orderLabel('set', 'pattern', 'library'), 'Crystal, low to high', 'a set\'s pattern');
eq(W.orderLabel('golden', 'pattern', 'library'), 'Highest score first', 'Golden Φ\'s pattern');
eq(W.orderLabel('any', 'pattern', 'playlist'), 'Playlist order', 'any crystal\'s pattern is the source\'s order');
eq([W.orderLabel('set', 'shuffle', 'library'), W.orderLabel('set', 'low-high', 'library')], ['Shuffle, least recently played first', 'Crystal, low to high'], 'shuffle, low to high');
eq([W.orderLabel('walk', 'source', 'library'), W.orderLabel('walk', 'source', 'queue'), W.orderLabel('walk', 'source', 'playlist')], ['Library order', 'Queue order', 'Playlist order'], 'the source\'s order');
eq(W.ORDER_SHUFFLE_NOTE, 'Least recently played first. Aetheria remembers what you played until the app closes.', 'the shuffle note (decision 3 A)');
eq(W.ORDER_WALK_NOTE, 'Reordered, it plays as a mix: the cube won’t follow the walk’s steps.', 'a walk reordered');

// The footer.
eq(W.footerCountText({ count: 62, positions: null, seconds: 4 * 3600 + 19 * 60, approx: false }), '62 tracks · 4 h 19 min', 'tracks');
eq(W.footerCountText({ count: 26, positions: 27, seconds: 103 * 60, approx: false }), '26 of 27 positions · 1 h 43 min', 'positions');
eq(W.footerCountText({ count: 75, positions: 81, seconds: 7 * 3600 + 17 * 60, approx: true }), '75 of 81 positions · about 7 h 17 min', 'a random walk: about');
eq(W.footerCountText({ count: 0, positions: null, seconds: 0, approx: false }), '0 tracks', 'nothing');
eq(W.footerCountText({ count: 1, positions: null, seconds: 0, approx: false }), '1 track', 'one, its length unknown');
eq(W.footerCountParts({ count: 4, positions: null, seconds: 14 * 60, approx: false }), { head: '4 tracks', rest: ' · 14 min' }, 'parts');
eq(W.footerNameLine({ namedAs: 'Grounding', name: 'Grounding' }), 'Same as Grounding in Mixes', 'named');
eq(W.footerNameLine({ namedAs: null, name: 'Grounding · 1 per crystal · shuffled' }), 'Grounding · 1 per crystal · shuffled', 'not named');
eq(W.footerWarnLine({ missing: [5982], noCrystal: 1 }), '5982 Hz has no track here · 1 without a crystal left out', 'missing and no crystal');
eq(W.footerWarnLine({ missing: [174, 285], noCrystal: 0 }), '2 crystals have no track here', 'two missing');
eq(W.footerWarnLine({ missing: [], noCrystal: 11 }), '11 without a crystal left out', 'no crystal');
eq(W.footerWarnLine({ missing: [], noCrystal: 0 }), '', 'nothing to say');
eq(W.EMPTY_TEXT, 'No tracks fit. Change what it follows or remove a filter.', 'the empty footer');
eq(W.QUEUE_EMPTY_TEXT, 'Nothing is waiting in your queue. Start from your library or a playlist.', 'the empty queue');
eq(W.QUEUE_PLAY_LINE, 'Your queue becomes this mix.', 'from the queue');

// The footer's ⋯.
eq(W.moreTitle({ count: 4, positions: null, seconds: 14 * 60, approx: false }), 'This mix · 4 tracks · 14 min', 'its title');
eq(W.addToQueueLine(4, 2, false), 'All 4, after the 2 tracks waiting in your queue', 'Add to queue, 2 waiting');
eq(W.addToQueueLine(4, 1, false), 'All 4, after the track waiting in your queue', 'Add to queue, 1 waiting');
eq(W.addToQueueLine(4, 0, false), 'All 4, right after the track that’s playing, in this order', 'Add to queue, none waiting');
eq(W.addToQueueLine(4, 0, true), 'All 4, first when you press Play, in this order', 'Add to queue, nothing loaded');
eq(W.addToQueueLine(1, 2, false), 'This track, after the 2 tracks waiting in your queue', 'one track');
eq([W.saveLine(4, false), W.saveLine(1, false), W.saveLine(26, true)], ['A new playlist of these 4, in this order', 'A new playlist of this track', 'A new playlist of this draw, in its order'], 'Save\'s line');

console.log(`builderViewModel: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
