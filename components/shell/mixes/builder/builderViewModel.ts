// components/shell/mixes/builder/builderViewModel.ts (v16.3, Create a mix; mockups builder-A-*, builder-filters-phone,
// builder-source-phone, builder-more-phone, builder-save-dialog-phone, builder-toasts-phone, builder-desktop)
//
// Every word Create a mix shows that the model (utils/mix/builder.ts: the mix's name, the scores' words) does not: the
// sources' names in a toast, the queue's notes, the section lines, the per-crystal and order notes, the footer's lines,
// the Start from sheet, the footer's ⋯ sheet. Pure, with no app imports beyond types; checked by builderViewModel.check.ts
// (npm run check:shell).

import { formatTotal } from '../../shellModel.ts';

const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0).toLocaleString('en-US');
const tracks = (n: number) => `${count(n)} ${n === 1 ? 'track' : 'tracks'}`;

// ---------------------------------------------------------------------------------------------------------------
// App's (the toasts' and the mix's name's words for a source)
// ---------------------------------------------------------------------------------------------------------------

/** A source as a mix's name and a toast say it: "Grounding · from your queue". */
export const LIBRARY_SOURCE_NAME = 'your library';
export const QUEUE_SOURCE_NAME = 'your queue';
/** A playlist deleted while it was the source (the view falls back to the library first; this is the guard's word). */
export const GONE_PLAYLIST_NAME = 'a playlist';
/** After Play from the queue: "Playing Grounding · from your queue: 3 tracks. Your queue is in it now." */
export const QUEUE_PLAY_NOTE = 'Your queue is in it now.';
/**
 * v16.3 review (an overnight decision, on the morning list): THE one switch for what Play from the queue does with the
 * queued tracks the built mix leaves out (a Follow or a filter that narrows the queue). 'leave' (now): the queue becomes
 * the mix, so they leave the queue; the footer says so before Play and the toast after, and Undo brings the whole queue
 * back. 'keep' keeps them queued, carried after the mix's first track as every other start carries the queue. App's
 * startBuilt and these words both follow it; nothing else needs to change to swap it.
 * v16.3 re-review: a true one-place switch. builderViewModel.check tests both modes' words (each function takes the mode,
 * its default this constant), and builder.spec's R1 and K1 test whichever mode is set here.
 */
export type QueueUnpicked = 'leave' | 'keep';
export const QUEUE_UNPICKED: QueueUnpicked = 'leave';
/** The footer, from the queue, before Play (only when the mix leaves some out). 'leave': "7 of your queued tracks aren’t
 *  in this mix: they leave the queue." (under "Your queue becomes this mix."); 'keep', the footer's one queue line: "7 of
 *  your queued tracks aren’t in this mix: they stay queued and play after its first track." `approx`: a random walk,
 *  whose count is one draw's. */
export function queueLeftLine(n: number, approx: boolean, mode: QueueUnpicked = QUEUE_UNPICKED): string | null {
  if (!(n > 0)) return null;
  const head = `${approx ? 'About ' : ''}${count(n)} of your queued tracks ${n === 1 ? 'isn’t' : 'aren’t'} in this mix`;
  if (mode === 'keep') return `${head}: ${n === 1 ? 'it stays queued and plays' : 'they stay queued and play'} after its first track.`;
  return `${head}: ${n === 1 ? 'it leaves' : 'they leave'} the queue.`;
}
/** The footer's "Your queue becomes this mix." (QUEUE_PLAY_LINE), from the queue: always with 'leave'; with 'keep' only
 *  when the mix holds every queued track (`leftLine` null), since the queue then doesn't become the mix. */
export function queuePlayLine(leftLine: string | null, mode: QueueUnpicked = QUEUE_UNPICKED): string | null {
  return mode === 'keep' && leftLine ? null : QUEUE_PLAY_LINE;
}
/** The toast's sentence after Play from the queue: with every queued track in the mix, QUEUE_PLAY_NOTE (as before);
 *  else 'leave': "Your queue became this mix. 7 queued tracks left the queue." (Undo brings them back); 'keep': none
 *  (''), as the carried tracks' own sentence, queueKeptText, says it: one sentence, one count. */
export function queuePlayNote(left: number, mode: QueueUnpicked = QUEUE_UNPICKED): string {
  if (!(left > 0)) return QUEUE_PLAY_NOTE;
  if (mode === 'keep') return '';
  return `Your queue became this mix. ${left === 1 ? '1 queued track' : `${count(left)} queued tracks`} left the queue.`;
}
/** 'keep': the toast's sentence for the queued tracks the mix leaves out, which stay queued right after its first track
 *  (App's startPlayOrder counts them as it carries them, in place of the queue's "Your 7 queued tracks play next."):
 *  "Playing Grounding · from your queue: 3 tracks. The 7 queued tracks not in it play next." */
export function queueKeptText(n: number): string {
  return n === 1 ? 'The queued track not in it plays next.' : `The ${count(n)} queued tracks not in it play next.`;
}
/** Play next / Add to queue of a mix built from the queue (the view never offers them: its tracks are queued already). */
export const FROM_QUEUE_QUEUED_TEXT = 'This mix is made of your queue, so its tracks are queued already. Play makes it your play order.';

// ---------------------------------------------------------------------------------------------------------------
// The view (Stage C)
// ---------------------------------------------------------------------------------------------------------------

export const TITLE = 'Create a mix';
export const BACK_NAME = 'Back to Mixes';
export const START_OVER = 'Start over';
/** The Mixes tab's button. */
export const CREATE_SUB = 'Your source, its crystals, your order';

export const SECTION = {
  source: 'Start from',
  follow: 'Follow',
  per: 'Tracks per crystal',
  filters: 'Filters',
  order: 'Order',
} as const;

/** Start from's three choices: their second lines. */
export function libraryChoiceSub(n: number): string {
  return tracks(n);
}
export const PLAYLIST_CHOICE = 'Playlist';
export const PLAYLIST_CHOOSE = 'Choose…';
export function playlistChoiceSub(present: number): string {
  return tracks(present);
}
export function queueChoiceSub(waiting: number): string {
  return waiting > 0 ? `${count(waiting)} waiting` : 'Nothing waiting';
}
export const NO_PLAYLISTS_REASON = 'No playlists yet';
/** A saved playlist that is gone: the view starts from the library and says so once. */
export function playlistGoneLine(name: string | null): string {
  return name ? `${name} is gone, so this starts from your library.` : 'That playlist is gone, so this starts from your library.';
}

/** The Start from sheet. */
export const SOURCE_SHEET_TITLE = 'Start from';
export const SOURCE_SHEET_SUB = 'The mix is built from these tracks only.';
export const SOURCE_LIBRARY = 'Your library';
export const SOURCE_QUEUE = 'Your queue';
export const SOURCE_PLAYLISTS = 'Playlists';
export function sourceQueueLine(waiting: number): string {
  if (waiting <= 0) return 'Nothing is waiting in your queue.';
  return `${waiting === 1 ? '1 track waiting' : `${count(waiting)} tracks waiting`}. Play makes the mix your play order, so they don’t play twice.`;
}
export function sourcePlaylistLine(present: number, missing: number): string {
  return missing > 0 ? `${tracks(present)} · ${count(missing)} missing` : tracks(present);
}

/** Follow's four kinds. */
export const FOLLOW_KINDS: ReadonlyArray<{ id: 'walk' | 'set' | 'any' | 'exp'; label: string }> = [
  { id: 'walk', label: 'A Lo Shu walk' },
  { id: 'set', label: 'A crystal set' },
  { id: 'any', label: 'Any crystal' },
  { id: 'exp', label: 'Experimental' },
];
/** A walk's choice: "26 of 27". */
export function walkChoiceSub(n: number, size: number): string {
  return `${count(n)} of ${count(size)}`;
}
export const CUSTOM_CHIP = 'Custom…';
/** What a crystal's assignment is (never a pitch): after a set's crystals, or after Custom's lead. */
export const CRYSTALS_NOTE = 'the crystals Deep Scan or Assign crystals gave each track, not a measured pitch.';
/** A set's line: "174 · 285 · 396 · 417 Hz · the crystals Deep Scan or Assign crystals gave each track, not a measured pitch." */
export function setLine(crystals: readonly number[]): string {
  if (!crystals.length) return `${CRYSTALS_NOTE.charAt(0).toUpperCase()}${CRYSTALS_NOTE.slice(1)}`;
  const what = crystals.length <= 5 ? `${crystals.join(' · ')} Hz` : `${Math.min(...crystals)}–${Math.max(...crystals)} Hz, ${crystals.length} crystals`;
  return `${what} · ${CRYSTALS_NOTE}`;
}
export const CUSTOM_LEAD = 'Custom: tap the crystals to follow (all 27 always show). The crystals Deep Scan or Assign crystals gave each track, not a measured pitch.';
export const CUSTOM_NONE = 'Pick at least one crystal.';
export const ANY_LINE = 'Every track that has a crystal, narrowed by your filters.';
/** A crystal's chip name: "528 Hz, 17 tracks". */
export function crystalChipName(hz: number, n: number): string {
  return `${hz} Hz, ${tracks(n)}`;
}
/** A set's chip name: "Grounding, 62 tracks". */
export function setChipName(name: string, n: number | null): string {
  return n === null ? name : `${name}, ${tracks(n)}`;
}

/** Tracks per crystal: the choices' lines; for every other Follow, one line. */
export const PER_LINES: Readonly<Record<'1' | '3' | 'all', string>> = {
  1: 'The best match on each crystal',
  3: 'Up to three per crystal, best first',
  all: 'Every track on these crystals',
};
export const PER_WALK_LINE = 'One track per position, as the walk picks them.';
export const PER_OWN_LINE = 'Its own rule picks the tracks.';
export const PER_ANY_LINE = 'Every track on one of the 27 crystals.';

/** Filters: with none picked. */
export function noFiltersLine(source: 'library' | 'playlist' | 'queue'): string {
  return source === 'playlist' ? 'None: every track in the playlist.' : source === 'queue' ? 'None: every track in your queue.' : 'None: every track in your library.';
}
export const FILTERS_BUTTON = 'Filters';
/** The builder's filter sheet. */
export const EXPERIMENTAL_TITLE = 'Experimental scores';
export const EXPERIMENTAL_SHOW = 'Show';
export const EXPERIMENTAL_HIDE = 'Hide';
export const EXPERIMENTAL_MORE = 'Each one you pick narrows the mix.';
export const FILTERS_DONE = 'Done';
export const FILTERS_FOOT = 'Crystals are picked under Follow.';

/** Order: each choice's words (the pattern's depends on what is followed). */
export type OrderWord = 'pattern' | 'low-high' | 'shuffle' | 'source';
export function orderLabel(follow: 'walk' | 'set' | 'golden' | 'seq111' | 'source2178' | 'any', o: OrderWord, source: 'library' | 'playlist' | 'queue'): string {
  const sourceOrder = source === 'playlist' ? 'Playlist order' : source === 'queue' ? 'Queue order' : 'Library order';
  if (o === 'pattern') {
    if (follow === 'walk') return 'The walk’s order';
    if (follow === 'golden' || follow === 'source2178') return 'Highest score first';
    if (follow === 'seq111') return 'The nine orders, in turn';
    if (follow === 'any') return sourceOrder;
    return 'Crystal, low to high';
  }
  if (o === 'low-high') return 'Crystal, low to high';
  if (o === 'shuffle') return 'Shuffle, least recently played first';
  return sourceOrder;
}
export const ORDER_WALK_NOTE = 'Reordered, it plays as a mix: the cube won’t follow the walk’s steps.';
export const ORDER_SHUFFLE_NOTE = 'Least recently played first. Aetheria remembers what you played until the app closes.';

// ---------------------------------------------------------------------------------------------------------------
// The footer
// ---------------------------------------------------------------------------------------------------------------

export interface FooterFacts {
  count: number;
  positions: number | null;
  seconds: number;
  approx: boolean;
  missing: readonly number[];
  noCrystal: number;
  /** The Mixes-tab mix's name it is exactly, or null. */
  namedAs: string | null;
  name: string;
}
/** Line 1, as parts (the bold count, then the length): "62 tracks" + " · 4 h 19 min"; "26 of 27 positions" + " · about 7 h". */
export function footerCountParts(f: Pick<FooterFacts, 'count' | 'positions' | 'seconds' | 'approx'>): { head: string; rest: string } {
  const head = f.positions !== null ? `${count(f.count)} of ${count(f.positions)} positions` : tracks(f.count);
  const rest = f.count > 0 && f.seconds > 0 ? ` · ${f.approx ? 'about ' : ''}${formatTotal(f.seconds)}` : '';
  return { head, rest };
}
export function footerCountText(f: Pick<FooterFacts, 'count' | 'positions' | 'seconds' | 'approx'>): string {
  const p = footerCountParts(f);
  return `${p.head}${p.rest}`;
}
/** Line 2: "Same as Grounding in Mixes", or the mix's name. */
export function footerNameLine(f: Pick<FooterFacts, 'namedAs' | 'name'>): string {
  return f.namedAs ? `Same as ${f.namedAs} in Mixes` : f.name;
}
/** Line 3 (only when needed): "5982 Hz has no track here · 11 without a crystal left out". */
export function footerWarnLine(f: Pick<FooterFacts, 'missing' | 'noCrystal'>): string {
  const missing = f.missing.length === 0 ? '' : f.missing.length === 1 ? `${f.missing[0]} Hz has no track here` : `${count(f.missing.length)} crystals have no track here`;
  const none = f.noCrystal > 0 ? `${count(f.noCrystal)} without a crystal left out` : '';
  return [missing, none].filter(Boolean).join(' · ');
}
export const ASSIGN_LINK = 'Assign crystals in Library ›';
export const EMPTY_TEXT = 'No tracks fit. Change what it follows or remove a filter.';
/** From the queue with nothing waiting (after its Play, say: Undo brings it back). */
export const QUEUE_EMPTY_TEXT = 'Nothing is waiting in your queue. Start from your library or a playlist.';
export const PLAY = 'Play';
export const PLAY_NEXT = 'Play next';
export const MORE_NAME = 'More for this mix';
/** From the queue: Play only (plus Save), and why. */
export const QUEUE_PLAY_LINE = 'Your queue becomes this mix.';

/** The footer's ⋯ sheet. */
export function moreTitle(f: Pick<FooterFacts, 'count' | 'positions' | 'seconds' | 'approx'>): string {
  return `This mix · ${footerCountText(f)}`;
}
export const ADD_TO_QUEUE = 'Add to queue';
export const SAVE_AS_PLAYLIST = 'Save as a playlist…';
const all = (n: number) => (n === 1 ? 'This track' : `All ${count(n)}`);
/** Add to queue's line: after the tracks waiting, or right after the playing track with none waiting. */
export function addToQueueLine(n: number, waiting: number, nothingCurrent: boolean): string {
  if (waiting <= 0) return nothingCurrent ? `${all(n)}, first when you press Play, in this order` : `${all(n)}, right after the track that’s playing, in this order`;
  return waiting === 1 ? `${all(n)}, after the track waiting in your queue` : `${all(n)}, after the ${count(waiting)} tracks waiting in your queue`;
}
export function saveLine(n: number, walk: boolean): string {
  if (walk) return 'A new playlist of this draw, in its order';
  return n === 1 ? 'A new playlist of this track' : `A new playlist of these ${count(n)}, in this order`;
}
