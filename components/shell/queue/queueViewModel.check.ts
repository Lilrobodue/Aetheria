// Checks for components/shell/queue/queueViewModel.ts (v16.0, the queue: every word it shows).
// Run with: node components/shell/queue/queueViewModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  placeWord,
  NO_CRYSTAL_NOTE,
  queuedToast,
  removedToast,
  clearedToast,
  STILL_STARTING_TEXT,
  QUEUE_CHANGED_TEXT,
  undoStartedText,
  carryText,
  playNextLine,
  addToQueueLine,
  sourceName,
  sourcePhrase,
  sheetSubtitle,
  EMPTY_TITLE,
  EMPTY_BODY,
  endLine,
  queuedFacts,
  handleName,
  movingText,
  droppedText,
  cancelledText,
  upNextName,
  upNextTitle,
  goneText,
  editMissedText,
  queuedCount,
  upNextButtonName,
  libraryMark,
} from './queueViewModel.ts';

let passed = 0;
const failures: string[] = [];
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) passed++;
  else failures.push(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// Ordinals.
for (const [n, s] of [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [101, '101st'], [111, '111th'], [1002, '1,002nd']] as const) eq(placeWord(n), s, `placeWord ${n}`);

// The toasts (mockup toasts-phone).
eq(queuedToast({ name: 'tone-0117', mode: 'next', position: 1, noCrystal: false, nothingCurrent: false }), 'Playing next: tone-0117.', 'Play next');
eq(queuedToast({ name: 'tone-0088', mode: 'queue', position: 3, noCrystal: false, nothingCurrent: false }), 'Added to your queue: tone-0088 is 3rd.', 'Add to queue, two already waiting');
eq(queuedToast({ name: 'tone-0203', mode: 'next', position: 1, noCrystal: true, nothingCurrent: false }), 'Playing next: tone-0203. It has no crystal yet, so on a locked phone the music may stop there.', 'Play next, no crystal');
eq(queuedToast({ name: 'tone-0203', mode: 'queue', position: 2, noCrystal: true, nothingCurrent: false }), `Added to your queue: tone-0203 is 2nd. ${NO_CRYSTAL_NOTE}`, 'Add to queue, no crystal');
eq(queuedToast({ name: 'tone-0117', mode: 'next', position: 1, noCrystal: false, nothingCurrent: true }), 'Queued: tone-0117. Play starts with it.', 'nothing loaded (Play next)');
eq(queuedToast({ name: 'tone-0117', mode: 'queue', position: 1, noCrystal: false, nothingCurrent: true }), 'Queued: tone-0117. Play starts with it.', 'nothing loaded (Add to queue)');
eq(queuedToast({ name: 'tone-0118', mode: 'queue', position: 2, noCrystal: false, nothingCurrent: true }), 'Added to your queue: tone-0118 is 2nd.', 'nothing loaded, one already waiting: its place, not "Play starts with it"');
eq(queuedToast({ name: 'tone-0118', mode: 'queue', position: 3, noCrystal: true, nothingCurrent: true }), `Added to your queue: tone-0118 is 3rd. ${NO_CRYSTAL_NOTE}`, 'nothing loaded, two waiting, no crystal');
eq(removedToast('tone-0203'), 'Removed tone-0203 from your queue.', 'Remove');
eq(clearedToast(3), 'Cleared 3 queued tracks.', 'Clear, 3');
eq(clearedToast(1), 'Cleared 1 queued track.', 'Clear, 1');
eq(STILL_STARTING_TEXT, 'A track is still starting. Try again in a moment.', 'still starting');
eq([editMissedText('move'), editMissedText('remove')], ["The queue changed just then, so the track wasn't moved. Try it again.", 'The queue changed just then, so nothing was removed. Try it again.'], 'an edit that missed its track');
eq(QUEUE_CHANGED_TEXT, "The queue changed since, so that can't be undone.", 'the queue changed');
eq(undoStartedText('tone-0117'), 'tone-0117 has already started, so it stays in the play order.', 'Undo after it started');
eq(carryText(1), 'Your queued track plays next.', 'carry, 1');
eq(carryText(2), 'Your 2 queued tracks play next.', 'carry, 2');

// The row menu's lines (rowmenu-phone).
eq(playNextLine(false), 'Right after the track that’s playing', 'Play next line');
eq(addToQueueLine(2, false), 'After the 2 tracks waiting in your queue', 'Add to queue line, 2 waiting');
eq(addToQueueLine(1, false), 'After the track waiting in your queue', 'Add to queue line, 1 waiting');
eq(addToQueueLine(0, false), 'Right after the track that’s playing', 'Add to queue line, none waiting');
eq(playNextLine(true), 'First when you press Play', 'nothing loaded');
eq(addToQueueLine(0, true), 'First when you press Play', 'nothing loaded, none waiting');

// The sheet.
const lib = { kind: 'library' } as const;
const walk = { kind: 'walk', name: 'Vortex' } as const;
const order = { kind: 'order' } as const;
eq([sourceName(lib), sourceName(walk), sourceName(order)], ['Library', 'the Vortex walk', 'your play order'], 'Next from …');
eq([sourcePhrase(lib), sourcePhrase(walk), sourcePhrase(order)], ['your library', 'the Vortex walk', 'your play order'], 'in a sentence');
eq(sheetSubtitle(3, lib), '3 queued · then your library', 'subtitle, 3 queued');
eq(sheetSubtitle(0, lib), 'Nothing queued · your library plays on', 'subtitle, none');
eq(sheetSubtitle(1, walk), '1 queued · then the Vortex walk', 'subtitle, a walk');
eq([EMPTY_TITLE, EMPTY_BODY], ['Nothing queued', 'In Library, a track’s ⋯ has Play next and Add to queue.'], 'the empty card');
eq(endLine('more', 388, lib, false, false), 'Then 388 more tracks from your library (Repeat is off: it stops after the last).', 'end: more, Repeat off');
eq(endLine('more', 1, order, true, false), 'Then 1 more track from your play order, then from the top.', 'end: more, Repeat on');
eq(endLine('more', 12, lib, true, true), 'Then 12 more tracks from your library, then a new shuffle.', 'end: more, shuffle and Repeat');
eq(endLine('more', 12, lib, false, true), 'Then 12 more tracks from your library, then a new shuffle.', 'end: more, shuffle, Repeat off (shuffle never stops)');
eq(endLine('reshuffle', 0, lib, false, true), 'Then a new shuffle.', 'end: a new shuffle, Repeat off');
eq(endLine('loop', 0, lib, true, false), 'Then the play order from the top.', 'end: Repeat');
eq(endLine('reshuffle', 0, lib, true, true), 'Then a new shuffle.', 'end: a new shuffle');
eq(endLine('stop', 0, lib, false, false), 'That’s the end of the play order.', 'end: the end');
eq(queuedFacts({ id: 'a', name: 'a', duration: 159, closestSolfeggio: 639 } as any), { text: '2:39 · 639 Hz', alert: false }, 'a queued row with a crystal');
eq(queuedFacts({ id: 'a', name: 'a', duration: 159 } as any), { text: 'No crystal yet · may stop here on a locked phone', alert: true }, 'a queued row with no crystal');
eq(handleName('tone-0117', 1, 3), 'Reorder tone-0117, 1 of 3', 'the handle');
eq(movingText('tone-0117', 2, 3), 'Moving tone-0117, position 2 of 3', 'moving');
eq(droppedText(2), 'Dropped at position 2', 'dropped');
eq(cancelledText('tone-0117', 1), 'tone-0117 back at position 1', 'cancelled');
eq(goneText('tone-0117'), 'tone-0117 is no longer queued, so it was not moved', 'the lifted row left the queue');

// The ways in.
eq(upNextName('tone-0117', 3), 'Up next: tone-0117, 3 queued. Open the queue', 'the line, queued');
eq(upNextName('tone-0043', 0), 'Up next: tone-0043. Open the queue', 'the line, nothing queued');
eq(upNextName(null, 0), 'Nothing up next. Open the queue', 'the line, the end');
eq(upNextName(null, 0, true), 'Up next: a new shuffle. Open the queue', 'the line, the end under shuffle');
eq([upNextTitle('tone-0043', false), upNextTitle(null, false), upNextTitle(null, true)], ['tone-0043', 'End of the play order', 'A new shuffle'], 'the line\'s text');
eq([queuedCount(3), queuedCount(0)], ['3 queued', null], 'the count');
eq([upNextButtonName(3), upNextButtonName(0)], ['Up next, 3 queued', 'Up next'], 'the desktop button');
eq(libraryMark(1), 'Queued · 1', 'the Library mark');

console.log(`queueViewModel: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
