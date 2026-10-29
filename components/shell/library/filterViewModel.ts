// components/shell/library/filterViewModel.ts (v16.2, smart filters)
//
// Every word the smart filters show around the list (mockups tracks-filtered-phone, filter-actions-phone,
// filter-empty-phone, filter-save-dialog-phone, filter-toasts-phone): the "N of M" line, the hint that says what a
// row's tap plays (both forms of decision 1; A is the one in use), the Filters button's name, the sheet's count and
// footer, the actions row and its ⋯ sheet, the toasts a filtered set's start shows, the empty card and the Save
// Dialog's sentence. The facets' own words (titles, values, help lines) live in utils/library/filterModel.ts, shared
// with v16.3's builder. Pure; checked by filterViewModel.check.ts (npm run check:shell).

import { formatTotal } from '../shellModel.ts';

const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0).toLocaleString('en-US');
const tracks = (n: number) => (n === 1 ? 'track' : 'tracks');

/** What the queue's toasts name as the tracks' source ("Playing next: 10 tracks from your filters."). */
export const FROM_FILTERS = 'your filters';

/** v16.1's cap: a playlist holds up to this many entries (utils/playlists/model.ts MAX_ENTRIES). */
export const PLAYLIST_CAP = 10_000;

// ---------------------------------------------------------------------------------------------------------------
// The top of the list while filtered
// ---------------------------------------------------------------------------------------------------------------

/** "10 of 440" (the bold part) and " tracks · 25 min" (the rest; no length with nothing shown). */
export function filterSummaryParts(shown: number, total: number, seconds: number): { count: string; rest: string } {
  const length = shown > 0 && seconds > 0 ? ` · ${formatTotal(seconds)}` : '';
  return { count: `${count(shown)} of ${count(total)}`, rest: ` ${tracks(total)}${length}` };
}
export function filterSummaryText(shown: number, total: number, seconds: number): string {
  const p = filterSummaryParts(shown, total, seconds);
  return `${p.count}${p.rest}`;
}

/** What a row's tap plays while filtered. Decision 1 A: the filtered tracks, from that one. */
export function rowTapHint(shown: number): string {
  return shown === 1 ? 'A tap plays this one track.' : `A tap plays these ${count(shown)}, from that track.`;
}
/** Decision 1 B (not in use; kept with A so the choice stays one branch): the whole library. */
export const ROW_TAP_LIBRARY_HINT = 'A tap plays your whole library from that track.';

/** The Filters button's name: "Filters", or "Filters, 3 on" (a whole regime counts once, as its chip does). */
export function filtersButtonName(on: number): string {
  return on > 0 ? `Filters, ${count(on)} on` : 'Filters';
}

/** An active chip's name: "Remove 528 Hz". */
export function removeChipName(label: string): string {
  return `Remove ${label}`;
}

/** The actions row's ⋯. */
export function moreButtonName(shown: number): string {
  return shown === 1 ? 'More for this track' : `More for these ${count(shown)} tracks`;
}

// ---------------------------------------------------------------------------------------------------------------
// The filter sheet
// ---------------------------------------------------------------------------------------------------------------

/** The sheet's live count, under its title: "10 of 440 tracks". */
export function sheetCountText(shown: number, total: number): string {
  return `${count(shown)} of ${count(total)} ${tracks(total)}`;
}
/** A chip's name: "528 Hz, 6 tracks". */
export function chipName(label: string, n: number): string {
  return `${label}, ${count(n)} ${tracks(n)}`;
}
/** A regime chip's words: "All GUT". */
export function regimeChipLabel(name: string): string {
  return `All ${name}`;
}
/** A regime's range, after its name: "174–963 Hz". */
export function regimeRangeText(crystals: readonly number[]): string {
  if (!crystals.length) return '';
  return `${Math.min(...crystals)}–${Math.max(...crystals)} Hz`;
}
/** The footer's button that closes the sheet: "Show 10 tracks". */
export function showButtonText(shown: number): string {
  return `Show ${count(shown)} ${tracks(shown)}`;
}
export const CLEAR_ALL = 'Clear all';
/** The GUT group's line while Perfect GUT is on (the chips keep the stored crystal, as the rows do). */
export const PERFECT_GUT_NOTE = 'With Perfect GUT on, 174–639 play as 75–630 Hz.';

// ---------------------------------------------------------------------------------------------------------------
// The ⋯ sheet (the actions for the shown tracks)
// ---------------------------------------------------------------------------------------------------------------

/** "These 10 tracks · 25 min". */
export function actionsTitle(shown: number, seconds: number): string {
  const head = shown === 1 ? 'This track' : `These ${count(shown)} tracks`;
  return seconds > 0 ? `${head} · ${formatTotal(seconds)}` : head;
}
const all = (shown: number) => (shown === 1 ? 'This track' : `All ${count(shown)}`);
/** Play next's line: right after the playing track, or first when Play is pressed (nothing loaded). */
export function playNextManyLine(shown: number, nothingCurrent: boolean): string {
  return nothingCurrent ? `${all(shown)}, first when you press Play, in this order` : `${all(shown)}, right after the track that’s playing, in this order`;
}
/** Add to queue's line: after the tracks waiting, or Play next's line when none waits. */
export function addToQueueManyLine(shown: number, waiting: number, nothingCurrent: boolean): string {
  if (waiting <= 0) return playNextManyLine(shown, nothingCurrent);
  return waiting === 1 ? `${all(shown)}, after the track waiting in your queue` : `${all(shown)}, after the ${count(waiting)} tracks waiting in your queue`;
}
export const ADD_TO_PLAYLIST_LINE = 'To one of your playlists, or a new one';
/** Save as a playlist's line, or why it is off (over v16.1's cap). */
export function saveLine(shown: number): string {
  if (shown > PLAYLIST_CAP) return `A playlist holds up to ${count(PLAYLIST_CAP)} tracks`;
  return shown === 1 ? 'A new playlist of this track' : `A new playlist of these ${count(shown)}, in this order`;
}
/** The name Dialog's sentence for a filtered list: a snapshot, said so. */
export function saveSentence(shown: number): string {
  if (shown === 1) return 'The track your filters show. The playlist keeps it; it won’t change when your filters or your library do.';
  const n = count(shown);
  return `The ${n} tracks your filters show, in the list’s order. The playlist keeps these ${n}; it won’t change when your filters or your library do.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The toasts (App's playFiltered; the queue's and the playlists' own words do the rest)
// ---------------------------------------------------------------------------------------------------------------

/** A filtered set starts: Play these, Shuffle (the switch turns on), or a row's tap (from that track). The queue's
 *  carry sentence, when tracks are waiting, is startPlayOrder's own. */
export function filterStartText(n: number, o: { row: boolean; shuffle: boolean }): string {
  const what = n === 1 ? 'the track' : `the ${count(n)} tracks`;
  if (o.shuffle) return `Shuffling ${what} your filters show. Shuffle is on.`;
  if (o.row && n !== 1) return `Playing ${what} your filters show, from this one.`;
  return `Playing ${what} your filters show.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The empty result
// ---------------------------------------------------------------------------------------------------------------

/** The card's title; with a search on, it names it. */
export function emptyTitle(text: string): string {
  const q = String(text ?? '').trim();
  return q ? `No tracks match ‘${q}’ with these filters` : 'No tracks match these filters';
}
/** The way out the model found (filterModel.emptyHint): "Without “10 min or more”, 16 tracks match." */
export function emptyHintLine(label: string, n: number): string {
  return `Without “${label}”, ${count(n)} ${n === 1 ? 'track matches' : 'tracks match'}.`;
}
/** Its button: "Remove “10 min or more”" (that facet's picks go). */
export function removeFacetText(label: string): string {
  return `Remove “${label}”`;
}
