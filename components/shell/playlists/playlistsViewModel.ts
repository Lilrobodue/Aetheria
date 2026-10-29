// components/shell/playlists/playlistsViewModel.ts (v16.1, saved playlists; spec §3.9, mockups toasts-phone,
// playlists-phone-A, playlist-detail-phone, save-dialog-phone, delete-track-A-phone, clear-classic-*, clear-new-*)
//
// Every word the saved playlists show: the toasts, the list's and a playlist's facts lines, the name Dialog's titles and
// sentences, the default names, the delete Dialog's sentence (both layouts), the Clear texts (classic's button and the
// new layout's dialog say the same), the empty states, the source line, and the edit mode's handle names. Pure, with no
// app imports (the model's records never reach the shell: App passes values). Checked by playlistsViewModel.check.ts
// (npm run check:shell).

import { formatTotal } from '../shellModel.ts';

const count = (n: number) => n.toLocaleString('en-US');
const tracks = (n: number) => `${count(n)} ${n === 1 ? 'track' : 'tracks'}`;
const playlistsWord = (n: number) => `${count(n)} ${n === 1 ? 'playlist' : 'playlists'}`;

// ---------------------------------------------------------------------------------------------------------------
// The list and a playlist's facts
// ---------------------------------------------------------------------------------------------------------------

/** The list's summary line: "5 playlists · 8 h 44 min" (the present tracks' known lengths). */
export function listSummary(n: number, seconds: number): string {
  return n > 0 ? `${playlistsWord(n)} · ${formatTotal(seconds)}` : 'No playlists yet';
}

/** A playlist row's facts, as parts so the missing count can take the alert colour: "12 tracks · 48 min" and
 *  "2 missing" or "Playing". */
export function rowFactsParts(o: { count: number; seconds: number; missing: number; playing: boolean }): { base: string; note: string | null; alert: boolean } {
  const base = o.count > 0 && o.seconds > 0 ? `${tracks(o.count)} · ${formatTotal(o.seconds)}` : tracks(o.count);
  if (o.missing > 0) return { base, note: `${count(o.missing)} missing`, alert: true };
  if (o.playing) return { base, note: 'Playing', alert: false };
  return { base, note: null, alert: false };
}

/** The same, as one line (a screen reader's, a test's). */
export function rowFacts(o: { count: number; seconds: number; missing: number; playing: boolean }): string {
  const p = rowFactsParts(o);
  return p.note ? `${p.base} · ${p.note}` : p.base;
}

/** "Saved from Up next · changed Oct 27" (the quiet line under a playlist's facts). */
export function fromLine(from: { kind: string; label?: string } | null | undefined, updatedAt: number): string {
  const when = `changed ${shortDate(updatedAt)}`;
  if (!from) return when;
  const what =
    from.kind === 'queue' ? 'Saved from Up next'
    : from.kind === 'playing' ? (from.label ? `Saved from ${from.label}` : 'Saved from what was playing')
    : from.kind === 'duplicate' ? (from.label ? `A copy of ${from.label}` : 'A copy')
    : from.kind === 'filter' ? (from.label ? `Saved from ${from.label}` : 'Saved from a filter')
    : from.kind === 'builder' ? (from.label ? `Saved from a mix: ${from.label}` : 'Saved from a mix') // v16.3's words (v16.1's read "Made in <label>")
    : 'Made here';
  return `${what} · ${when}`;
}

/** "Oct 28" (en-US, as the app's numbers). */
export function shortDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** A missing entry's line: "Not in your library · import tone-0203.wav again". */
export function missingLine(file: string): string {
  return `Not in your library · import ${file} again`;
}
export const MISSING_SHORT = 'Not in your library';

// ---------------------------------------------------------------------------------------------------------------
// Default names (the name Dialog prefills them; freeName then avoids a taken one)
// ---------------------------------------------------------------------------------------------------------------

export const NEW_PLAYLIST_NAME = 'New playlist';
export const queueDefaultName = (now: number) => `Up next · ${shortDate(now)}`;
export const libraryDefaultName = (now: number) => `Library · ${shortDate(now)}`;
export const orderDefaultName = (now: number) => `Play order · ${shortDate(now)}`;
export const copyName = (name: string) => `${name} copy`;

// ---------------------------------------------------------------------------------------------------------------
// The name Dialog (Save, New, Rename)
// ---------------------------------------------------------------------------------------------------------------

/** A name as typed is usable: something left once control characters and spaces go (the model's cleanName decides the
 *  stored form; this only enables Save). */
export function nameOk(raw: string): boolean {
  // eslint-disable-next-line no-control-regex
  return typeof raw === 'string' && raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().length > 0;
}
export const NAME_MAX = 80;

export const SAVE_TITLE = 'Save as a playlist';
export const NEW_TITLE = 'New playlist';
export const RENAME_TITLE = 'Rename playlist';

/** What goes in: "The 3 tracks waiting in Up next, in their order." */
export function saveQueueSentence(n: number): string {
  return n === 1 ? 'The track waiting in Up next.' : `The ${count(n)} tracks waiting in Up next, in their order.`;
}

/** What's playing: "The 59 tracks of Grounding, in its order." (+ the queued tracks are left out). */
export function savePlayingSentence(n: number, label: string | null, queued: number): string {
  const what = label ? `of ${label}` : 'playing now';
  const head = n === 1 ? `The track ${what}.` : `The ${count(n)} tracks ${what}, in their order.`;
  if (queued <= 0) return head;
  return `${head} ${queued === 1 ? 'The track waiting in Up next is not included.' : `The ${count(queued)} tracks waiting in Up next are not included.`}`;
}

/** A list's tracks (v16.2's filters: "Save as playlist"): "The 12 tracks shown, in their order." */
export function saveShownSentence(n: number): string {
  return n === 1 ? 'The track shown.' : `The ${count(n)} tracks shown, in their order.`;
}

/** v16.3, a built mix (Create a mix's Save, a Mixes-tab mix's ⋯ › Save as a playlist…): "The 4 tracks of this mix, in its
 *  order. The playlist keeps them; building the mix again may pick others." (+ a walk's: it plays without the cube). */
export function saveMixSentence(n: number, walk: boolean): string {
  const head = n === 1
    ? 'The track of this mix. The playlist keeps it; building the mix again may pick another.'
    : `The ${count(n)} tracks of this mix, in its order. The playlist keeps them; building the mix again may pick others.`;
  return walk ? `${head} It plays as a playlist, without the cube’s steps.` : head;
}

export const NEW_SENTENCE ='An empty playlist. In Tracks, a track’s ⋯ has Add to playlist.';
export function renameSentence(name: string): string {
  return `A new name for ${name}. Its tracks stay as they are.`;
}

/** Now Playing's ⋯: the two rows' second lines. */
export function addRowLine(title: string): string {
  return `${title}, to one of your playlists or a new one`;
}
export function saveRowLine(label: string | null, n: number): string {
  return `What’s playing: ${label ? `${label}, ` : ''}${tracks(n)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Toasts (mockup toasts-phone)
// ---------------------------------------------------------------------------------------------------------------

/** Add to playlist: "Added tone-0117 to Evening." / "… again: it’s in it twice now." / "Added 3 tracks to Evening." */
export function addedToast(what: { name: string | null; count: number }, playlist: string, timesNow = 1): string {
  if (what.count === 1 && what.name) {
    if (timesNow >= 2) return `Added ${what.name} to ${playlist} again: it’s in it ${timesNow === 2 ? 'twice' : `${count(timesNow)} times`} now.`;
    return `Added ${what.name} to ${playlist}.`;
  }
  return `Added ${tracks(what.count)} to ${playlist}.`;
}

/** New playlist… in the Add sheet: "Made Evening 2 with tone-0117."; the list's New playlist: "Made Evening." */
export function madeToast(playlist: string, what: { name: string | null; count: number } | null): string {
  if (!what || what.count === 0) return `Made ${playlist}.`;
  return `Made ${playlist} with ${what.count === 1 && what.name ? what.name : tracks(what.count)}.`;
}

/** Save as a playlist: "Saved Up next · Oct 28: 3 tracks." (its action is Open). */
export function savedToast(playlist: string, n: number): string {
  return `Saved ${playlist}: ${tracks(n)}.`;
}

/** Play / Shuffle (startPlayOrder's Undo chain): "Playing Evening: 11 tracks (1 missing is skipped)." */
export function playToast(playlist: string, n: number, missing: number, shuffle: boolean): string {
  const skipped = missing > 0 ? ` (${count(missing)} missing ${missing === 1 ? 'is' : 'are'} skipped)` : '';
  return `${shuffle ? 'Shuffling' : 'Playing'} ${playlist}: ${tracks(n)}${skipped}.`;
}

export function removedToast(name: string, playlist: string): string {
  return `Removed ${name} from ${playlist}.`;
}
export function removedMissingToast(n: number, playlist: string): string {
  return `Removed ${count(n)} missing ${n === 1 ? 'track' : 'tracks'} from ${playlist}.`;
}
export function duplicatedToast(playlist: string, copy: string): string {
  return `Duplicated ${playlist} as ${copy}.`;
}
export function deletedToast(playlist: string, n: number): string {
  return `Deleted ${playlist} (${tracks(n)}). Your music is not touched.`;
}
export function renamedToast(from: string, to: string): string {
  return `Renamed ${from} to ${to}.`;
}

/** A write that failed (sticky, with Retry). */
export function writeFailedToast(playlist: string, full: boolean): string {
  return full
    ? `Couldn’t save the change to ${playlist}: this device is out of space for Aetheria.`
    : `Couldn’t save the change to ${playlist}. It may be gone after a reload; Retry saves it again.`;
}

export function undoChangedToast(playlist: string): string {
  return `${playlist} changed since, so that can’t be undone.`;
}
export function allMissingToast(playlist: string): string {
  return `Every track in ${playlist} is missing. Import the files again to bring them back.`;
}
export const EMPTY_PLAYLIST_TOAST = 'That playlist has no tracks yet. In Tracks, a track’s ⋯ has Add to playlist.';
export const PLAYLIST_GONE_TOAST = 'That playlist is no longer there.';
export const EDIT_MISSED_TOAST = 'The playlist changed just then, so nothing was changed. Try it again.';
export const NOT_READY_TOAST = 'Your playlists are still loading. Try again in a moment.';
export const UNREADABLE_TOAST = 'Your saved playlists couldn’t be read, so they can’t be changed now. Reload Aetheria to try again.';
export const FULL_TOAST = 'That playlist is full (10,000 tracks).';
export const TOO_MANY_TOAST = 'You have 500 playlists, the most Aetheria keeps. Delete one to make another.';
export const NOTHING_QUEUED_TOAST = 'Nothing is waiting in Up next to save.';
export const NOTHING_PLAYING_TOAST = 'Nothing is playing to save.';

// ---------------------------------------------------------------------------------------------------------------
// The delete Dialog's sentence (both layouts; only when the track is in a playlist: classic's text is unchanged else)
// ---------------------------------------------------------------------------------------------------------------

/** Decision 2 A: the playlists keep a place for it. `names`: the playlists that hold it, in list order. */
export function deleteSentence(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return ` It's in your playlist "${names[0]}", which keeps a place for it: import the same file again and it's back there.`;
  return ` It's in ${count(names.length)} of your playlists, which keep a place for it: import the same file again and it's back there.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Clear (classic's two-tap button and the new layout's dialog say the same)
// ---------------------------------------------------------------------------------------------------------------

/** The tickbox: "Also delete my 5 playlists". */
export function alsoDeleteLabel(playlists: number): string {
  return playlists === 1 ? 'Also delete my playlist' : `Also delete my ${count(playlists)} playlists`;
}

/** Classic's armed button. With no playlists, exactly v16.0's words. */
export function classicArmedText(tracksN: number, playlists: number, ticked: boolean): string {
  const base = `Tap again to delete all ${tracksN} tracks`;
  if (playlists <= 0) return `${base} and their analysis`;
  const yours = playlists === 1 ? 'your playlist' : `your ${count(playlists)} playlists`;
  return ticked ? `${base}, their analysis and ${yours}` : `${base} and their analysis (${yours} ${playlists === 1 ? 'stays' : 'stay'})`;
}

/** Classic's armed accessible name. With no playlists (or unticked), exactly v16.0's. */
export function classicArmedName(tracksN: number, playlists: number, ticked: boolean): string {
  const base = `Confirm deleting all ${tracksN} tracks from this device`;
  if (playlists <= 0 || !ticked) return base;
  return `${base} and your ${playlists === 1 ? 'playlist' : `${count(playlists)} playlists`}`;
}

export const CLEAR_TITLE = 'Clear your library?';
export function clearBody(tracksN: number): string {
  return `The stored copies of all ${count(tracksN)} tracks, and their analysis, will be deleted from this device. The original files are not touched. This can't be undone.`;
}
/** The line under the tickbox. */
export function clearPlaylistsLine(playlists: number, ticked: boolean): string {
  if (ticked) return playlists === 1 ? 'Your playlist will be deleted too.' : `Your ${count(playlists)} playlists will be deleted too.`;
  return playlists === 1
    ? 'Your playlist stays. Its tracks show as missing until you import the same files again.'
    : `Your ${count(playlists)} playlists stay. Their tracks show as missing until you import the same files again.`;
}
/** The danger button: "Delete 440 tracks" / "Delete 440 tracks and 5 playlists". */
export function clearButton(tracksN: number, playlists: number, ticked: boolean): string {
  const base = `Delete ${tracks(tracksN)}`;
  return ticked && playlists > 0 ? `${base} and ${playlistsWord(playlists)}` : base;
}
/** The toast after the new layout's Clear (no Undo: Clear can't be undone). */
export function clearedToast(tracksN: number, playlists: number, alsoPlaylists: boolean): string {
  const base = `Cleared your library: ${tracks(tracksN)}.`;
  if (playlists <= 0) return base;
  const yours = playlists === 1 ? 'your playlist' : `your ${count(playlists)} playlists`;
  return alsoPlaylists
    ? `Cleared your library: ${tracks(tracksN)}, and ${yours}.`
    : `${base} ${playlists === 1 ? 'Your playlist stays.' : `Your ${count(playlists)} playlists stay.`}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Empty states, the list's states and notes
// ---------------------------------------------------------------------------------------------------------------

export const LIST_EMPTY_TITLE = 'No playlists yet';
export const LIST_EMPTY_BODY = 'Make one here, or use Add to playlist in a track’s ⋯. Up next and Now Playing’s ⋯ can save what’s queued or playing.';
export const LOADING_TEXT = 'Loading your playlists…';
export const ERROR_TITLE = 'Your playlists couldn’t be read';
export const ERROR_BODY = 'They are left as they were, and nothing is written to them. Reload Aetheria to try again; your music is not affected.';
export function unreadableNote(n: number): string {
  return n === 1
    ? '1 saved playlist couldn’t be read and is left as it was.'
    : `${count(n)} saved playlists couldn’t be read and are left as they were.`;
}
export const STORAGE_NOTE = 'Your music and playlists are kept in this browser. If the phone runs low on space it may clear them; adding Aetheria to your home screen helps keep them.';
export const DETAIL_EMPTY_TITLE = 'No tracks yet';
export const DETAIL_EMPTY_BODY = 'In Tracks, a track’s ⋯ has Add to playlist.';
export const ALL_MISSING_REASON = 'Every track is missing: import the files again to play it.';
export const EDIT_HINT = 'Drag a handle to reorder, or use a track’s ⋯. Changes save as you go.';

/** The detail's facts: "12 tracks · 48 min · 1 missing" (parts, for the alert colour). */
export function detailFactsParts(n: number, seconds: number, missing: number): { base: string; missing: string | null } {
  const base = n > 0 && seconds > 0 ? `${tracks(n)} · ${formatTotal(seconds)}` : tracks(n);
  return { base, missing: missing > 0 ? `${count(missing)} missing` : null };
}
/** Edit mode's top line: "12 tracks · 1 missing". */
export function editFactsParts(n: number, missing: number): { base: string; missing: string | null } {
  return { base: tracks(n), missing: missing > 0 ? `${count(missing)} missing` : null };
}
export function removeMissingLabel(n: number): string {
  return `Remove missing (${count(n)})`;
}

/** The switch's tab names (with their counts shown apart). */
export const TRACKS_TAB = 'Tracks';
export const PLAYLISTS_TAB = 'Playlists';

// ---------------------------------------------------------------------------------------------------------------
// The source line while a playlist plays, Up next's "Next from …"
// ---------------------------------------------------------------------------------------------------------------

/** "Playlist · Evening · 3 of 12" (index: 0-based; -1 nothing loaded). */
export function playlistSourceLine(name: string, index: number, n: number): string {
  const at = index >= 0 && index < n ? index + 1 : 0;
  return at ? `Playlist · ${name} · ${at} of ${count(n)}` : `Playlist · ${name} · ${tracks(n)}`;
}
/** The mini-player's: "Evening 3/12". */
export function playlistSourceShort(name: string, index: number, n: number): string {
  return index >= 0 ? `${name} ${index + 1}/${n}` : tracks(n);
}

// ---------------------------------------------------------------------------------------------------------------
// The menus
// ---------------------------------------------------------------------------------------------------------------

/** A playlist row's ⋯ title line: "tone-0117 · 5th in Evening" is the facts plus this. */
export function inPlaylistPlace(position: number, playlist: string): string {
  const v = Math.abs(Math.trunc(position));
  const t = v % 100;
  const suffix = t >= 11 && t <= 13 ? 'th' : v % 10 === 1 ? 'st' : v % 10 === 2 ? 'nd' : v % 10 === 3 ? 'rd' : 'th';
  return `${count(v)}${suffix} in ${playlist}`;
}
export function removeFromTitle(playlist: string): string {
  return `Remove from ${playlist}`;
}
export const REMOVE_FROM_LINE = 'Only from this playlist; your library keeps it';
export function playFromHereLine(playlist: string): string {
  return `${playlist}, starting with this track`;
}
export function newRowLine(trackName: string | null, n: number): string {
  if (n <= 0) return 'Name it, then add tracks';
  return `Name it; ${n === 1 && trackName ? trackName : tracks(n)} ${n === 1 ? 'goes' : 'go'} in first`;
}
export const HAS_TRACK = 'Has this track';
export function addSheetSubtitle(trackName: string | null, n: number): string {
  return n === 1 && trackName ? trackName : tracks(n);
}

// ---------------------------------------------------------------------------------------------------------------
// Edit mode: the handle's name and the announcements (the queue's words, with the playlist's places)
// ---------------------------------------------------------------------------------------------------------------

export function handleName(name: string, position: number, total: number): string {
  return `Reorder ${name}, ${count(position)} of ${count(total)}`;
}
export function movingText(name: string, position: number, total: number): string {
  return `Moving ${name}, position ${count(position)} of ${count(total)}`;
}
export function droppedText(position: number): string {
  return `Dropped at position ${count(position)}`;
}
export function cancelledText(name: string, position: number): string {
  return `${name} back at position ${count(position)}`;
}
export function goneText(name: string): string {
  return `${name} is no longer in this playlist, so it was not moved`;
}
