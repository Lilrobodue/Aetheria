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
}

/** v15.7: the library itself (App's originalPlaylist, the same array): an import or its duration batches, a delete, a
 *  scan's or analysis's patch change it; never the clock. */
export interface LibraryListValue {
  songs: Song[];
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
}

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
