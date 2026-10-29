// components/shell/contexts.ts (v15.5, the new layout beta)
//
// App stays the only owner of state. It slices what the new layout shows into these contexts, each value built with
// useMemo just before App's return (after the pinned useMediaSession call), so a context changes only when its own
// values do. The point is the 4 Hz clock: App re-renders four times a second while playing (v14.8's quarter-second
// time, which the pinned media-session call reads), and with these slices only the time readers (SeekBar, TimeText,
// MiniProgress, the Car's time and the desktop transport's seek) follow it; every other view is React.memo and reads
// contexts that did not change.
//
// v15.6 adds TuningContext (the Layers tab's slow settings), Zen's state on ShellValue and the tab's actions.
// v15.7 adds LibraryListContext (the library itself) and LibraryStatusContext (the passes' and imports' state) for the
// Library tab, where it was left (ShellValue.libraryViewRef), and the tab's actions.
// v16.0 adds QueueContext (what plays next, the queue; never the clock) and the queue's actions.
// v16.1 adds PlaylistsContext (the saved playlists, resolved against the library; never the clock), the playlists' and
// the Library tools' actions, and LibraryViewState.view (the "Tracks · Playlists" switch).
//
// Each reader throws a clear error without its provider; the ViewBoundary around the view then catches it.
// No @types/react here: React is `any` to tsc, so these interfaces document the values rather than enforce them.

import { createContext, useContext } from 'react';
import type { LayerEngine, LayerOutput, BeatRender } from '../../utils/soundV2/layerHost';
import type { ShellSheet, ShellTab, PeekPanel, LayoutPref } from './shellModel';
import type { Song } from '../../types';
import type { LayersSection } from './layers/layersModel';
import type { LastImport } from './library/libraryModel';
import type { PassProgress } from '../../utils/library/analysePass';

/** The transport's state. Changes on play/pause, a track change, shuffle/repeat, a new play order. */
export interface PlayerValue {
  isPlaying: boolean;
  /** A track is loaded (the play order has a current track). */
  hasTrack: boolean;
  trackId: string | null;
  title: string;
  index: number;
  count: number;
  shuffle: boolean;
  loop: boolean;
  /** A tone plays with no music (selectFrequency while paused). */
  toneOnly: boolean;
  isRecording: boolean;
  /** "Lo Shu walk · Vortex · step 3 of 27", "Library · 12 of 28", "Play order · 4 of 30" (shellModel.sourceLine). */
  source: string;
  /** Short form for the mini-player ("Vortex 3/27", "12/28"). */
  sourceShort: string;
}

/** What the layers play and how the chips say it. */
export interface SoundValue {
  /** The crystal the layers play (selectedSolfeggio, Perfect GUT applied): the chip's number. */
  crystalHz: number;
  /** The playing track's own crystal (Perfect GUT applied), or null. */
  trackHz: number | null;
  /** The playing track's own crystal as stored (what selectFrequency takes), or null. */
  trackRawHz: number | null;
  perfectGut: boolean;
  engine: LayerEngine;
  v2Active: boolean;
  v2Failed: boolean;
  v2CarFallback: boolean;
  /** null = not answered yet (played as headphones). */
  output: LayerOutput | null;
  outputEffective: LayerOutput;
  layersShown: boolean;
  layersText: string;
  layersTip: string;
  beatText: string;
  keyFitShown: boolean;
  keyFitText: string;
  keyFitHint: string;
  keyFitLook: 'duck' | 'plain' | 'none';
  keyFitOn: boolean;
  keyFitRowLine: string;
  musicOnly: boolean;
  /** LayerSoundPanel's props (App's one memoised object, shared with classic). */
  layerPanelProps: any;
  /** φ mode and φ timing both on (the seek bar's ticks and the phase word need a duration too). */
  phi: boolean;
}

/** The three levels: split off so a slider drag never re-renders the chips. */
export interface LevelsValue {
  volume: number;
  toneLevel: number;
  beatLevel: number;
  toneText: string;
  beatText: string;
  outputRender: BeatRender;
  v2Active: boolean;
  v2CarFallback: boolean;
}

/**
 * v15.6, the Layers tab's slow settings: the beat preset and Adaptive, φ, the experience filter, and what the layers
 * actually play for the crystal. Kept out of SoundContext so the Now Playing chips never re-render for these. It
 * changes on a band step (Adaptive: at most one per 3 s tick) or a setting; never on the 4 Hz clock.
 */
export interface TuningValue {
  /** isAdaptiveBinaural. */
  adaptive: boolean;
  /** selectedBinaural.name ('Delta' … 'Gamma'). */
  presetName: string;
  /** The band the beat delivers now ('Alpha'; v2's pulse may cap it), or null with no beat (Car, the layers off). */
  nowBand: string | null;
  /** The output's render (renderForOutput: Car is 'off'). */
  render: BeatRender;
  /** The beat is v2's (v2 plays, or v2's Car fallback). */
  v2Beat: boolean;
  /** enablePhiMode, phiTimingEnabled. */
  phiMode: boolean;
  phiTiming: boolean;
  /** userExperienceLevel (shared with classic). */
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  /** The optional experience filter on the crystals (aetheria.crystalFilter.v1). */
  crystalFilter: boolean;
  /** The track's φ peak in seconds (currDuration × 0.618), or null without a length: per track, never per tick. */
  trackPeakS: number | null;
  /** What the layers play for the crystal: v2's tone (the player's last status, else its plan), classic's
   *  solfeggioHz; null while the layers are off (Music only, v2's Car fallback). */
  heardHz: number | null;
  /** The sound log has an engine to log (Export sound log shows). */
  canExportLog: boolean;
}

/** The library at a glance (an import, a delete or a scan changes it). */
export interface LibrarySummaryValue {
  count: number;
  totalSeconds: number;
  playOrderIsLibrary: boolean;
  playOrderCount: number;
  isScanning: boolean;
}

/** The Lo Shu walk in play, if any. */
export interface WalkValue {
  mode: string | null;
  name: string | null;
  fullName: string | null;
  index: number;
  count: number;
}

/** The transport time (element time, seconds): 4×/s while playing. Read ONLY by the time readers. */
export interface TimeValue {
  t: number;
  d: number;
}

/** The shell's own state. */
export interface ShellValue {
  tab: ShellTab;
  sheet: ShellSheet | null;
  /** Where the open sheet should start (the Sound sheet opened from Output starts at its Output group; v15.7: the Import
   *  sheet opened from the health card starts at its Recover offer). */
  sheetFocus: 'output' | 'recover' | null;
  peek: PeekPanel | null;
  /** The phone shell's Car screen (Output = Car). */
  car: boolean;
  phoneShell: boolean;
  headerRef: { current: HTMLElement | null };
  barRef: { current: HTMLDivElement | null };
  /** v15.6: Zen in the new layout. `on`: the switch; `hidden`: the controls are hidden now (the shell is inert). */
  zen: { on: boolean; hidden: boolean };
  /** v15.6: the shell's root (PhoneShell or DesktopShell), for Zen's "a field being typed in keeps it shown". */
  rootRef: { current: HTMLDivElement | null };
  /** v15.6: where the Layers tab was left (its content's scrollTop), and a section to open at instead. */
  layersScrollRef: { current: { top: number; jump: LayersSection | null } };
  /** v15.7: where the Library tab was left (session only; the query is never saved). */
  libraryViewRef: { current: LibraryViewState };
}

/** v15.7: the Library tab as it was left: its query, its content's scrollTop, and the health card's fold (null: by
 *  decision 5 A, open while there is something to do). */
export interface LibraryViewState {
  query: string;
  top: number;
  healthOpen: boolean | null;
  /** Desktop: the button that opened the Import panel, to focus when the tab comes back. */
  refocus?: 'import' | 'review' | null;
  /** v16.1: the "Tracks · Playlists" switch (decision 1 A; session only). Absent: Tracks. */
  view?: 'tracks' | 'playlists';
}

/** v15.7: the library itself (App's originalPlaylist, the same array): an import or its duration batches, a delete, a
 *  scan's or analysis's patch change it; never the clock. */
export interface LibraryListValue {
  songs: Song[];
  /** v15.9: the saved library has not been read back yet (the first restore is in flight): the Mixes tab waits. */
  loading: boolean;
}

/** v15.7: the passes' and imports' state, for the health card and the Import sheet only (it ticks with their progress). */
export interface LibraryStatusValue {
  isScanning: boolean;
  /** Deep Scan's percentage. */
  scanProgress: number;
  /** Analyse tracks' progress (PASS_IDLE when idle). */
  pass: PassProgress;
  /** The Analyse tracks button's counts (countAnalysable over the library). */
  analyseCounts: { todo: number; todoSeconds: number; failed: number; failedSeconds: number; tooLong: number };
  restoring: boolean;
  /** Tracks whose length is still being read (the duration queue). */
  durationsLeft: number;
  /** Stored tracks the library doesn't list (classic's banner counts), or null. */
  orphans: { fresh: number; duplicates: number } | null;
  orphanBusy: boolean;
  discardArmed: boolean;
  lastImport: LastImport | null;
  /** Analyse tracks treats this device as a phone. */
  analyseMobile: boolean;
  /** v16.1: what Clear deletes (the library plus stored tracks on the Recover offer: classic's own count), and the
   *  saved playlists (the new layout's Clear dialog: "Also delete my 5 playlists"). */
  storedTrackCount: number;
  playlistCount: number;
}

/** v16.1: one row of the saved playlists' list (resolved against the library as it is now). */
export interface PlaylistSummaryValue {
  id: string;
  name: string;
  /** Entries, present and missing (a playlist can hold a track twice). */
  count: number;
  present: number;
  missing: number;
  /** The present tracks' known lengths. */
  seconds: number;
  updatedAt: number;
  /** The play order is this playlist (derived: its present tracks, in order). */
  playing: boolean;
  /** It holds the Add to playlist sheet's one track ("Has this track"). */
  has: boolean;
}

/** v16.1: one entry of the open playlist's view. */
export interface PlaylistEntryValue {
  /** `${id}#${occurrence}` (as the edits check it). */
  key: string;
  index: number;
  /** The entry's stored name and file (what a missing entry shows). */
  name: string;
  file: string;
  /** The library track it plays (by id, else by its file's name and size), or null: missing. */
  song: Song | null;
  /** Its place among the present tracks (a row's tap plays from it), or -1. */
  presentIndex: number;
}

/** v16.1: the open playlist (its view in the Library tab). */
export interface PlaylistOpenValue {
  id: string;
  name: string;
  count: number;
  present: number;
  missing: number;
  seconds: number;
  /** "Saved from Up next · changed Oct 27". */
  fromLine: string;
  rows: PlaylistEntryValue[];
  /** The entry playing now (this playlist plays and its cursor is on it), or -1. */
  current: number;
}

/** v16.1: the name Dialog (Save as a playlist, New playlist, Rename). */
export type PlaylistNamingValue =
  | { kind: 'save'; name: string; sentence: string }
  | { kind: 'new'; name: string }
  | { kind: 'rename'; id: string; name: string };

/**
 * v16.1, the saved playlists (PlaylistsContext): the list's rows, the open playlist's view, the name Dialog and the Add
 * sheet's tracks. Built in App only while the new layout shows, from the playlists, the library, the open id and what
 * plays (never the clock).
 */
export interface PlaylistsValue {
  status: 'loading' | 'ready' | 'error';
  /** Stored records that couldn't be read (left on disk as they were). */
  unreadable: number;
  lists: PlaylistSummaryValue[];
  totalSeconds: number;
  playingId: string | null;
  open: PlaylistOpenValue | null;
  /** The open id asked for (a playlist gone since: open is null). */
  openId: string | null;
  naming: PlaylistNamingValue | null;
  /** The Add to playlist sheet's tracks (library ids) and its subtitle, or null. */
  add: { ids: string[]; title: string } | null;
  /** The New playlist… row's default name in the Add sheet. */
  newName: string;
}

/** v16.1: a saved playlist's own edit (App's editPlaylist): an entry by its index and row key, checked when it applies. */
export type PlaylistEdit =
  | { move: { from: number; to: number; key: string } }
  | { remove: { index: number; key: string } }
  | { removeMissing: true };

/** v16.0: one row of the Up next sheet: a play-order entry (its index, for an edit that checks its id when it applies). */
export interface QueueRowValue {
  /** `${id}#${occurrence}`: the play order can hold a track twice. */
  key: string;
  index: number;
  song: Song;
}

/** v16.0: one run of the sheet's list, in the order of play (queueModel.upcomingRuns). */
export interface QueueRunValue {
  queued: boolean;
  rows: QueueRowValue[];
}

/**
 * v16.0, the queue (Up next): what plays next, in order, and how many wait. Built in App from the play order, its marks
 * and the cursor (never the clock), only while the new layout shows: the sheet, the Now Playing line, the desktop
 * button, the row menu's lines and the Library's marks read it.
 */
export interface QueueValue {
  /** The sequence ahead, as runs of queued and of the play order's own entries (≤ 100 queued, ≤ 50 own). */
  runs: QueueRunValue[];
  /** Tracks waiting in the queue. */
  waiting: number;
  /** The play order's own entries ahead not listed, and what follows the last row (queueViewModel.endLine). */
  more: number;
  end: 'stop' | 'loop' | 'reshuffle' | 'more';
  /** The track that plays next (queued or not), or null at the end. */
  nextTitle: string | null;
  /** Where the play order comes from (the sheet's words). v16.1: a saved playlist ("Next from Evening"). */
  source: { kind: 'library' } | { kind: 'walk'; name: string } | { kind: 'order' } | { kind: 'playlist'; name: string };
  /** No track is loaded: Play starts with the queue. */
  nothingCurrent: boolean;
  loop: boolean;
  shuffle: boolean;
  /** A waiting track's first place in the queue (1-based), by id: the Library rows' marks. */
  positions: ReadonlyMap<string, number>;
}

/** v16.0: an edit of the Up next sheet (App's editQueue): a queued entry, by its index and id (checked when it applies). */
export type QueueEdit =
  | { remove: { index: number; id: string } }
  | { move: { index: number; id: string; to: number } }
  | { toTop: { index: number; id: string } }
  | { clear: true };

/** One object for the app's lifetime: every member calls App's latest function (no view re-renders for a handler). */
export interface ShellActions {
  playPause: () => void;
  next: () => void;
  prev: () => void;
  /** 0..1 of the track. */
  seekTo: (fraction: number) => void;
  /** ± seconds. */
  seekBy: (seconds: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  selectCrystal: (raw: number) => void;
  backToTrackCrystal: () => void;
  setPerfectGut: (on: boolean) => void;
  startWalk: (mode: string) => void;
  /** v15.9: a mix of the Mixes tab (utils/mix/catalog.ts ids): App's existing generator, which starts it playing. */
  startMix: (id: string) => void;
  clearWalk: () => void;
  chooseOutput: (o: LayerOutput) => void;
  toggleMusicOnly: () => void;
  toggleKeyFit: () => void;
  setVolume: (v: number) => void;
  setToneLevel: (v: number) => void;
  setBeatLevel: (v: number) => void;
  /** Emergency Stop's body: the layers fall in 0.1 s, then the pinned pausePlayback (the music, the anchor, the tone). */
  stopAll: () => void;
  trackInfo: () => void;
  stopRecording: () => void;
  setTab: (t: ShellTab) => void;
  openSheet: (s: ShellSheet, focus?: 'output' | null) => void;
  closeSheet: () => void;
  setLayout: (l: LayoutPref) => void;
  peekClassic: (panel: PeekPanel) => void;
  // v15.6, the Layers tab (references to App's existing setters; the Sound section uses layerPanelProps' handlers).
  setAdaptive: (on: boolean) => void;
  /** A band picked by hand: the preset, and Adaptive off (classic's row click). */
  choosePreset: (name: string) => void;
  setPhiMode: (on: boolean) => void;
  setPhiTiming: (on: boolean) => void;
  setExperienceLevel: (l: 'beginner' | 'intermediate' | 'advanced' | 'expert') => void;
  /** The experience filter's switch (and Show all): saved, from the tap only. */
  setCrystalFilter: (on: boolean) => void;
  /** The Layers tab, opened at a section (default Sound). */
  openLayers: (section?: LayersSection) => void;
  // v15.6, Zen in the new layout.
  setZen: (on: boolean) => void;
  /** Bring the hidden controls back (the reveal surface's click, "Show controls"). */
  revealZen: () => void;
  // v15.7, the Library tab (references to App's functions).
  /** A row: the whole library (in this order of ids, or the library's own with null) from that track. */
  playFromLibrary: (id: string, orderIds: readonly string[] | null) => void;
  undoPlayOrder: () => void;
  /** v15.4's delete confirmation for this track. */
  requestDelete: (id: string) => void;
  /** Auto-Distribute. */
  assignCrystals: () => void;
  /** Analyse tracks' button (Start, or Stop while it runs). */
  analyse: () => void;
  /** Deep Scan (the tracks with no crystal; decision 6), and its cancel. */
  scan: () => void;
  /** v15.8: Deep Scan with the assigned tracks too (the health card's explicit "Also scan"). */
  scanAssigned: () => void;
  stopScan: () => void;
  /** The import handler (classic's, unchanged). */
  importFiles: (event: any) => void;
  recoverOrphans: () => void;
  discardOrphans: () => void;
  openImport: (focus?: 'recover' | null) => void;
  /** The list element, the delete Dialog's focus fallback. */
  setLibraryFocusTarget: (el: HTMLElement | null) => void;
  // v16.0, the queue (references to App's queueTracks, editQueue, undoQueue: the queue's one writer, never the library).
  /** Play next / Add to queue: library tracks by id. */
  queueTracks: (ids: readonly string[], mode: 'next' | 'queue') => void;
  editQueue: (op: QueueEdit) => void;
  undoQueue: () => void;
  /** The Up next sheet (the desktop's panel); a second call closes it. */
  toggleQueue: () => void;
  // v16.1, saved playlists (references to App's playlist functions: their one writer, commitPlaylists; never the
  // library) and the Library tools (the health card's Clear and Diagnostics).
  /** A playlist's view (Library › Playlists › it), or the list with null. */
  openPlaylist: (id: string | null) => void;
  /** The name Dialog: a new playlist (its view opens once it is made), a rename. */
  newPlaylist: () => void;
  renamePlaylist: (id: string) => void;
  /** The name Dialog's Save (the name as typed), and its Cancel. */
  namePlaylist: (name: string) => void;
  closeNaming: () => void;
  duplicatePlaylist: (id: string) => void;
  deletePlaylist: (id: string) => void;
  playPlaylist: (id: string, opts?: { shuffle?: boolean; startAt?: number }) => void;
  queuePlaylist: (id: string, mode: 'next' | 'queue') => void;
  editPlaylist: (id: string, op: PlaylistEdit) => void;
  /** The Add to playlist sheet, for these library tracks (the calling sheet closes first). */
  addToPlaylist: (ids: readonly string[]) => void;
  /** The Add sheet's row: add its tracks to that playlist; its "Create and add": a new one with them. The sheet closes. */
  addTracksTo: (playlistId: string) => void;
  createWithTracks: (name: string) => void;
  /** Save as a playlist (Up next's, Now Playing's ⋯): the sheet closes, then the name Dialog. The ids form is v16.2's
   *  seam (a filtered list: "Save as playlist", its default name and its source). */
  savePlaylist: (source: 'queue' | 'playing' | { kind: 'ids'; ids: readonly string[]; label: string; from: { kind: 'filter' | 'builder'; label?: string } }) => void;
  /** What Save as a playlist would save from what's playing (Now Playing's ⋯ line), or null with nothing playing. */
  saveSourceInfo: () => { label: string | null; count: number } | null;
  /** navigator.storage.persisted() (the list's storage note), or null when the browser can't say. */
  storagePersisted: () => Promise<boolean | null>;
  /** The health card's Library tools: Clear (the box's value: the playlists too), and classic's diagnostics readout. */
  clearLibrary: (alsoPlaylists: boolean) => void;
  showDiagnostics: () => void;
}

export const PlayerContext = createContext(null);
export const SoundContext = createContext(null);
export const LevelsContext = createContext(null);
export const LibrarySummaryContext = createContext(null);
export const WalkContext = createContext(null);
export const TimeContext = createContext(null);
export const ActionsContext = createContext(null);
export const ShellContext = createContext(null);
export const TuningContext = createContext(null);
export const LibraryListContext = createContext(null);
export const LibraryStatusContext = createContext(null);
export const QueueContext = createContext(null);
export const PlaylistsContext = createContext(null);

function read<T>(ctx: unknown, name: string): T {
  const v = useContext(ctx);
  if (v === null || v === undefined) throw new Error(`${name} is missing its provider (ShellProviders)`);
  return v as T;
}

export const usePlayer = (): PlayerValue => read<PlayerValue>(PlayerContext, 'PlayerContext');
export const useSound = (): SoundValue => read<SoundValue>(SoundContext, 'SoundContext');
export const useLevels = (): LevelsValue => read<LevelsValue>(LevelsContext, 'LevelsContext');
export const useLibrarySummary = (): LibrarySummaryValue => read<LibrarySummaryValue>(LibrarySummaryContext, 'LibrarySummaryContext');
export const useWalk = (): WalkValue => read<WalkValue>(WalkContext, 'WalkContext');
export const useTime = (): TimeValue => read<TimeValue>(TimeContext, 'TimeContext');
export const useActions = (): ShellActions => read<ShellActions>(ActionsContext, 'ActionsContext');
export const useShell = (): ShellValue => read<ShellValue>(ShellContext, 'ShellContext');
export const useTuning = (): TuningValue => read<TuningValue>(TuningContext, 'TuningContext');
export const useLibraryList = (): LibraryListValue => read<LibraryListValue>(LibraryListContext, 'LibraryListContext');
export const useLibraryStatus = (): LibraryStatusValue => read<LibraryStatusValue>(LibraryStatusContext, 'LibraryStatusContext');
export const useQueue = (): QueueValue => read<QueueValue>(QueueContext, 'QueueContext');
export const usePlaylists = (): PlaylistsValue => read<PlaylistsValue>(PlaylistsContext, 'PlaylistsContext');
