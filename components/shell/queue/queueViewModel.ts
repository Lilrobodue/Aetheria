// components/shell/queue/queueViewModel.ts (v16.0, the queue)
//
// Every word the queue shows: the toasts (mockup toasts-phone), the row menu's two lines (rowmenu-phone), the Up next
// sheet's subtitle, section names and end line (queue-phone, -empty, -end), a queued row's facts (the no-crystal note),
// the drag handle's name and its announcements, the Now Playing line's and the desktop button's names, the Library
// mark. Pure, no app imports but the Library's row facts; checked by queueViewModel.check.ts (npm run check:shell).

import { rowFacts } from '../library/libraryModel.ts';
import type { LibSong } from '../library/libraryModel.ts';

const count = (n: number) => n.toLocaleString('en-US');
const tracks = (n: number) => (n === 1 ? 'track' : 'tracks');

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function placeWord(n: number): string {
  const v = Math.abs(Math.trunc(n));
  const t = v % 100;
  const suffix = t >= 11 && t <= 13 ? 'th' : v % 10 === 1 ? 'st' : v % 10 === 2 ? 'nd' : v % 10 === 3 ? 'rd' : 'th';
  return `${count(v)}${suffix}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------------------------

/** A track with no crystal can't be swapped in gaplessly: on a locked phone the playTrack fallback drops the card. */
export const NO_CRYSTAL_NOTE = 'It has no crystal yet, so on a locked phone the music may stop there.';

/** The toast after Play next / Add to queue. `position`: the track's place in the queue (1-based); `nothingCurrent`:
 *  no track is loaded, so Play starts with the first queued track (only that one is told "Play starts with it"; one
 *  added after others waiting gets its place). */
export function queuedToast(o: { name: string; mode: 'next' | 'queue'; position: number; noCrystal: boolean; nothingCurrent: boolean }): string {
  const head = o.nothingCurrent && o.position <= 1
    ? `Queued: ${o.name}. Play starts with it.`
    : o.mode === 'next'
      ? `Playing next: ${o.name}.`
      : `Added to your queue: ${o.name} is ${placeWord(o.position)}.`;
  return o.noCrystal ? `${head} ${NO_CRYSTAL_NOTE}` : head;
}

export function removedToast(name: string): string {
  return `Removed ${name} from your queue.`;
}

export function clearedToast(n: number): string {
  return `Cleared ${count(n)} queued ${tracks(n)}.`;
}

export const STILL_STARTING_TEXT = 'A track is still starting. Try again in a moment.';

/** A sheet edit that found its track no longer where it was (another write moved it, or it started playing). */
export function editMissedText(kind: 'move' | 'remove'): string {
  return kind === 'move' ? "The queue changed just then, so the track wasn't moved. Try it again." : 'The queue changed just then, so nothing was removed. Try it again.';
}
export const QUEUE_CHANGED_TEXT = "The queue changed since, so that can't be undone.";

/** Play next's (or Add to queue's) Undo when its track has started meanwhile: it stays. */
export function undoStartedText(name: string): string {
  return `${name} has already started, so it stays in the play order.`;
}

/** The sentence a new play order's toast gains when it carries the queue (decision 2 A). */
export function carryText(n: number): string {
  return n === 1 ? 'Your queued track plays next.' : `Your ${count(n)} queued tracks play next.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The Library row menu's two items
// ---------------------------------------------------------------------------------------------------------------

export function playNextLine(nothingCurrent: boolean): string {
  return nothingCurrent ? 'First when you press Play' : 'Right after the track that’s playing';
}

export function addToQueueLine(waiting: number, nothingCurrent: boolean): string {
  if (waiting <= 0) return playNextLine(nothingCurrent);
  return waiting === 1 ? 'After the track waiting in your queue' : `After the ${count(waiting)} tracks waiting in your queue`;
}

// ---------------------------------------------------------------------------------------------------------------
// The Up next sheet
// ---------------------------------------------------------------------------------------------------------------

/** Where the play order comes from, as the sheet says it: the library, a walk, or another play order (a mix). */
export type QueueSource = { kind: 'library' } | { kind: 'walk'; name: string } | { kind: 'order' };

/** "Library", "the Vortex walk", "your play order" (the section "Next from …"). */
export function sourceName(s: QueueSource): string {
  return s.kind === 'library' ? 'Library' : s.kind === 'walk' ? `the ${s.name} walk` : 'your play order';
}

/** "your library", "the Vortex walk", "your play order" (inside a sentence). */
export function sourcePhrase(s: QueueSource): string {
  return s.kind === 'library' ? 'your library' : s.kind === 'walk' ? `the ${s.name} walk` : 'your play order';
}

/** The sheet's subtitle: "3 queued · then your library", "Nothing queued · your library plays on". */
export function sheetSubtitle(waiting: number, s: QueueSource): string {
  return waiting > 0 ? `${count(waiting)} queued · then ${sourcePhrase(s)}` : `Nothing queued · ${sourcePhrase(s)} plays on`;
}

export const EMPTY_TITLE = 'Nothing queued';
export const EMPTY_BODY = 'In Library, a track’s ⋯ has Play next and Add to queue.';

/** The line under the last row: what follows it (queueModel.upcoming's `end`; `more`: entries not listed). Under
 *  shuffle the music never stops at the end (a new shuffle order follows, whatever Repeat says). */
export function endLine(end: 'stop' | 'loop' | 'reshuffle' | 'more', more: number, s: QueueSource, loop: boolean, shuffle: boolean): string {
  if (end === 'more') {
    const tail = shuffle ? ', then a new shuffle.' : loop ? ', then from the top.' : ' (Repeat is off: it stops after the last).';
    return `Then ${count(more)} more ${tracks(more)} from ${sourcePhrase(s)}${tail}`;
  }
  if (end === 'loop') return 'Then the play order from the top.';
  if (end === 'reshuffle') return 'Then a new shuffle.';
  return 'That’s the end of the play order.';
}

/** A queued row's facts: the Library's line, or the no-crystal note in its place. */
export function queuedFacts(s: LibSong): { text: string; alert: boolean } {
  const hz = s.closestSolfeggio;
  if (!(Number.isFinite(hz) && (hz as number) > 0)) return { text: 'No crystal yet · may stop here on a locked phone', alert: true };
  return { text: rowFacts(s), alert: false };
}

/** The drag handle's name: "Reorder tone-0117, 1 of 3". */
export function handleName(name: string, position: number, total: number): string {
  return `Reorder ${name}, ${count(position)} of ${count(total)}`;
}

/** The live region while a row is lifted with the keyboard, and when it is dropped or put back. */
export function movingText(name: string, position: number, total: number): string {
  return `Moving ${name}, position ${count(position)} of ${count(total)}`;
}
export function droppedText(position: number): string {
  return `Dropped at position ${count(position)}`;
}
export function cancelledText(name: string, position: number): string {
  return `${name} back at position ${count(position)}`;
}
/** The lifted row left the queue under the lift (its track started playing, or it was removed or cleared). */
export function goneText(name: string): string {
  return `${name} is no longer queued, so it was not moved`;
}

// ---------------------------------------------------------------------------------------------------------------
// The ways in: Now Playing's line, the desktop button, the Library's mark
// ---------------------------------------------------------------------------------------------------------------

/** Now Playing's Up next line: the next track, else what follows the end (under shuffle a new shuffle order, never
 *  the end). */
export function upNextTitle(next: string | null, shuffle: boolean): string {
  return next ?? (shuffle ? 'A new shuffle' : 'End of the play order');
}

/** Now Playing's Up next line's name: "Up next: tone-0117, 3 queued. Open the queue". */
export function upNextName(next: string | null, waiting: number, shuffle = false): string {
  const head = next ? `Up next: ${next}` : shuffle ? 'Up next: a new shuffle' : 'Nothing up next';
  return `${head}${waiting > 0 ? `, ${count(waiting)} queued` : ''}. Open the queue`;
}

/** The line's count: "3 queued" (none without a queue). */
export function queuedCount(waiting: number): string | null {
  return waiting > 0 ? `${count(waiting)} queued` : null;
}

/** The desktop transport's button: "Up next, 3 queued" / "Up next". */
export function upNextButtonName(waiting: number): string {
  return waiting > 0 ? `Up next, ${count(waiting)} queued` : 'Up next';
}

/** A Library row's mark for a track waiting in the queue (its first place): "Queued · 1". */
export function libraryMark(position: number): string {
  return `Queued · ${count(position)}`;
}
