// components/shell/playlists/playlistsViewModel.check.ts (v16.1): every word the saved playlists show.
//   node components/shell/playlists/playlistsViewModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)

import {
  listSummary,
  rowFacts,
  rowFactsParts,
  fromLine,
  shortDate,
  missingLine,
  queueDefaultName,
  libraryDefaultName,
  orderDefaultName,
  copyName,
  saveQueueSentence,
  savePlayingSentence,
  saveShownSentence,
  addRowLine,
  saveRowLine,
  addedToast,
  madeToast,
  savedToast,
  playToast,
  removedToast,
  removedMissingToast,
  duplicatedToast,
  deletedToast,
  renamedToast,
  writeFailedToast,
  undoChangedToast,
  allMissingToast,
  deleteSentence,
  alsoDeleteLabel,
  classicArmedText,
  classicArmedName,
  clearBody,
  clearPlaylistsLine,
  clearButton,
  clearedToast,
  unreadableNote,
  detailFactsParts,
  editFactsParts,
  removeMissingLabel,
  playlistSourceLine,
  playlistSourceShort,
  inPlaylistPlace,
  newRowLine,
  addSheetSubtitle,
  handleName,
  movingText,
  droppedText,
  cancelledText,
  goneText,
  CLEAR_TITLE,
  STORAGE_NOTE,
  LIST_EMPTY_TITLE,
} from './playlistsViewModel.ts';

let pass = 0;
let fail = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  }
};

const OCT28 = new Date(2026, 9, 28, 12).getTime();
const OCT27 = new Date(2026, 9, 27, 9).getTime();

// The list and the facts (playlists-phone-A, playlist-detail-phone).
eq(listSummary(5, 8 * 3600 + 44 * 60), '5 playlists · 8 h 44 min', 'list summary');
eq(listSummary(1, 90), '1 playlist · 1 min', 'list summary, one (formatTotal floors to the minute)');
eq(listSummary(0, 0), 'No playlists yet', 'list summary, none');
eq(rowFacts({ count: 12, seconds: 48 * 60, missing: 0, playing: true }), '12 tracks · 48 min · Playing', 'row: playing');
eq(rowFacts({ count: 34, seconds: 130 * 60, missing: 2, playing: false }), '34 tracks · 2 h 10 min · 2 missing', 'row: missing');
eq(rowFactsParts({ count: 34, seconds: 60, missing: 2, playing: true }), { base: '34 tracks · 1 min', note: '2 missing', alert: true }, 'missing outranks playing, in the alert colour');
eq(rowFacts({ count: 1, seconds: 0, missing: 0, playing: false }), '1 track', 'row: one track, no length known');
eq(rowFacts({ count: 0, seconds: 0, missing: 0, playing: false }), '0 tracks', 'row: empty');
eq(shortDate(OCT28), 'Oct 28', 'date');
eq(fromLine({ kind: 'queue' }, OCT27), 'Saved from Up next · changed Oct 27', 'from: Up next');
eq(fromLine({ kind: 'duplicate', label: 'Evening' }, OCT27), 'A copy of Evening · changed Oct 27', 'from: a copy');
eq(fromLine({ kind: 'playing', label: 'Grounding' }, OCT27), 'Saved from Grounding · changed Oct 27', 'from: a mix');
eq(fromLine({ kind: 'playing' }, OCT27), 'Saved from what was playing · changed Oct 27', 'from: a play order');
eq(fromLine({ kind: 'new' }, OCT27), 'Made here · changed Oct 27', 'from: new');
eq(fromLine(undefined, OCT27), 'changed Oct 27', 'from: none');
eq(missingLine('tone-0203.wav'), 'Not in your library · import tone-0203.wav again', 'a missing entry');
eq(detailFactsParts(12, 48 * 60, 1), { base: '12 tracks · 48 min', missing: '1 missing' }, 'detail facts');
eq(editFactsParts(12, 1), { base: '12 tracks', missing: '1 missing' }, 'edit facts');
eq(editFactsParts(3, 0), { base: '3 tracks', missing: null }, 'edit facts, none missing');
eq(removeMissingLabel(1), 'Remove missing (1)', 'Remove missing');
eq(unreadableNote(1), '1 saved playlist couldn’t be read and is left as it was.', 'unreadable, 1');
eq(unreadableNote(2), '2 saved playlists couldn’t be read and are left as they were.', 'unreadable, 2');

// Default names and the name Dialog (save-dialog-phone).
eq(queueDefaultName(OCT28), 'Up next · Oct 28', 'default: the queue');
eq(libraryDefaultName(OCT28), 'Library · Oct 28', 'default: the library');
eq(orderDefaultName(OCT28), 'Play order · Oct 28', 'default: a play order');
eq(copyName('Evening'), 'Evening copy', 'default: a playlist playing');
eq(saveQueueSentence(3), 'The 3 tracks waiting in Up next, in their order.', 'save sentence: the queue');
eq(saveQueueSentence(1), 'The track waiting in Up next.', 'save sentence: the queue, one');
eq(savePlayingSentence(59, 'Grounding', 0), 'The 59 tracks of Grounding, in their order.', 'save sentence: a mix');
eq(savePlayingSentence(30, null, 3), 'The 30 tracks playing now, in their order. The 3 tracks waiting in Up next are not included.', 'save sentence: with a queue');
eq(savePlayingSentence(30, 'Library', 1), 'The 30 tracks of Library, in their order. The track waiting in Up next is not included.', 'save sentence: one queued');
eq(saveShownSentence(12), 'The 12 tracks shown, in their order.', 'save sentence: a list');
eq(addRowLine('tone-0042'), 'tone-0042, to one of your playlists or a new one', 'Now Playing ⋯: Add to playlist…');
eq(saveRowLine('Grounding', 59), 'What’s playing: Grounding, 59 tracks', 'Now Playing ⋯: Save as a playlist…');
eq(saveRowLine(null, 1), 'What’s playing: 1 track', 'Now Playing ⋯: Save, a plain play order');

// Toasts (toasts-phone).
eq(addedToast({ name: 'tone-0117', count: 1 }, 'Evening'), 'Added tone-0117 to Evening.', 'added');
eq(addedToast({ name: 'tone-0117', count: 1 }, 'Focus', 2), 'Added tone-0117 to Focus again: it’s in it twice now.', 'added again');
eq(addedToast({ name: 'tone-0117', count: 1 }, 'Focus', 3), 'Added tone-0117 to Focus again: it’s in it 3 times now.', 'added a third time');
eq(addedToast({ name: null, count: 12 }, 'Evening'), 'Added 12 tracks to Evening.', 'added many');
eq(madeToast('Evening 2', { name: 'tone-0117', count: 1 }), 'Made Evening 2 with tone-0117.', 'made with a track');
eq(madeToast('Evening', null), 'Made Evening.', 'made empty');
eq(madeToast('Evening', { name: null, count: 3 }), 'Made Evening with 3 tracks.', 'made with tracks');
eq(savedToast('Up next · Oct 28', 3), 'Saved Up next · Oct 28: 3 tracks.', 'saved');
eq(playToast('Evening', 11, 1, false), 'Playing Evening: 11 tracks (1 missing is skipped).', 'play, one missing');
eq(playToast('Evening', 10, 2, false), 'Playing Evening: 10 tracks (2 missing are skipped).', 'play, two missing');
eq(playToast('Evening', 12, 0, true), 'Shuffling Evening: 12 tracks.', 'shuffle');
eq(removedToast('tone-0117', 'Evening'), 'Removed tone-0117 from Evening.', 'removed');
eq(removedMissingToast(1, 'Evening'), 'Removed 1 missing track from Evening.', 'removed missing, 1');
eq(removedMissingToast(3, 'Evening'), 'Removed 3 missing tracks from Evening.', 'removed missing, 3');
eq(duplicatedToast('Evening', 'Evening copy'), 'Duplicated Evening as Evening copy.', 'duplicated');
eq(deletedToast('Evening', 12), 'Deleted Evening (12 tracks). Your music is not touched.', 'deleted');
eq(deletedToast('Evening', 1), 'Deleted Evening (1 track). Your music is not touched.', 'deleted, one track');
eq(renamedToast('Evening', 'Night'), 'Renamed Evening to Night.', 'renamed');
eq(writeFailedToast('Evening', true), 'Couldn’t save the change to Evening: this device is out of space for Aetheria.', 'write failed: full');
eq(writeFailedToast('Evening', false), 'Couldn’t save the change to Evening. It may be gone after a reload; Retry saves it again.', 'write failed');
eq(undoChangedToast('Evening'), 'Evening changed since, so that can’t be undone.', 'Undo refused');
eq(allMissingToast('Focus'), 'Every track in Focus is missing. Import the files again to bring them back.', 'all missing');

// The delete Dialog's sentence (delete-track-A-phone): only with playlists; n = 1 names it; straight quotes.
eq(deleteSentence([]), '', 'in no playlist: nothing (classic byte for byte)');
eq(deleteSentence(['Evening']), ` It's in your playlist "Evening", which keeps a place for it: import the same file again and it's back there.`, 'in one');
eq(deleteSentence(['Evening', 'Focus']), ` It's in 2 of your playlists, which keep a place for it: import the same file again and it's back there.`, 'in two');

// Clear (clear-classic-*, clear-new-*): with no playlists, exactly v16.0's words.
eq(classicArmedText(440, 0, false), 'Tap again to delete all 440 tracks and their analysis', 'classic armed, no playlists: v16.0');
eq(classicArmedText(440, 0, true), 'Tap again to delete all 440 tracks and their analysis', 'classic armed, no playlists, a stale tick: v16.0');
eq(classicArmedText(440, 5, false), 'Tap again to delete all 440 tracks and their analysis (your 5 playlists stay)', 'classic armed, unticked');
eq(classicArmedText(440, 5, true), 'Tap again to delete all 440 tracks, their analysis and your 5 playlists', 'classic armed, ticked');
eq(classicArmedText(3, 1, false), 'Tap again to delete all 3 tracks and their analysis (your playlist stays)', 'classic armed, one playlist');
eq(classicArmedName(440, 0, false), 'Confirm deleting all 440 tracks from this device', 'classic name: v16.0');
eq(classicArmedName(440, 5, false), 'Confirm deleting all 440 tracks from this device', 'classic name, unticked: v16.0');
eq(classicArmedName(440, 5, true), 'Confirm deleting all 440 tracks from this device and your 5 playlists', 'classic name, ticked');
eq(alsoDeleteLabel(5), 'Also delete my 5 playlists', 'tickbox');
eq(alsoDeleteLabel(1), 'Also delete my playlist', 'tickbox, one');
eq(CLEAR_TITLE, 'Clear your library?', 'Clear title');
eq(clearBody(440), "The stored copies of all 440 tracks, and their analysis, will be deleted from this device. The original files are not touched. This can't be undone.", 'Clear body');
eq(clearPlaylistsLine(5, false), 'Your 5 playlists stay. Their tracks show as missing until you import the same files again.', 'Clear line, unticked');
eq(clearPlaylistsLine(5, true), 'Your 5 playlists will be deleted too.', 'Clear line, ticked');
eq(clearButton(440, 0, false), 'Delete 440 tracks', 'Clear button');
eq(clearButton(440, 5, false), 'Delete 440 tracks', 'Clear button, unticked');
eq(clearButton(440, 5, true), 'Delete 440 tracks and 5 playlists', 'Clear button, ticked');
eq(clearedToast(440, 5, false), 'Cleared your library: 440 tracks. Your 5 playlists stay.', 'Cleared, kept');
eq(clearedToast(440, 5, true), 'Cleared your library: 440 tracks, and your 5 playlists.', 'Cleared, with the playlists');
eq(clearedToast(440, 0, false), 'Cleared your library: 440 tracks.', 'Cleared, none');

// The source line (np-playlist-phone) and the mini-player's.
eq(playlistSourceLine('Evening', 2, 12), 'Playlist · Evening · 3 of 12', 'source line');
eq(playlistSourceLine('Evening', -1, 12), 'Playlist · Evening · 12 tracks', 'source line, nothing loaded');
eq(playlistSourceShort('Evening', 2, 12), 'Evening 3/12', 'mini-player');

// The menus and the Add sheet.
eq(inPlaylistPlace(5, 'Evening'), '5th in Evening', 'place');
eq([1, 2, 3, 11, 12, 13, 21, 22].map((n) => inPlaylistPlace(n, 'E').split(' ')[0]), ['1st', '2nd', '3rd', '11th', '12th', '13th', '21st', '22nd'], 'ordinals');
eq(newRowLine('tone-0117', 1), 'Name it; tone-0117 goes in first', 'New playlist… line');
eq(newRowLine(null, 12), 'Name it; 12 tracks go in first', 'New playlist… line, many');
eq(addSheetSubtitle('tone-0117', 1), 'tone-0117', 'Add sheet subtitle');
eq(addSheetSubtitle(null, 12), '12 tracks', 'Add sheet subtitle, many');

// Edit mode's handle and announcements.
eq(handleName('tone-0117', 5, 12), 'Reorder tone-0117, 5 of 12', 'handle');
eq(movingText('tone-0117', 2, 12), 'Moving tone-0117, position 2 of 12', 'moving');
eq(droppedText(2), 'Dropped at position 2', 'dropped');
eq(cancelledText('tone-0117', 5), 'tone-0117 back at position 5', 'cancelled');
eq(goneText('tone-0117'), 'tone-0117 is no longer in this playlist, so it was not moved', 'gone');
eq(LIST_EMPTY_TITLE, 'No playlists yet', 'empty');
eq(STORAGE_NOTE.startsWith('Your music and playlists are kept in this browser.'), true, 'storage note');

console.log(`playlistsViewModel: ${pass} checks passed, ${fail} failed`);
if (fail) process.exit(1);
