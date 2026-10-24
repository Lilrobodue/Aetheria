// components/shell/contexts.ts (v15.5, the new layout beta)
//
// App stays the only owner of state. It slices what the new layout shows into these contexts, each value built with
// useMemo just before App's return (after the pinned useMediaSession call), so a context changes only when its own
// values do. The point is the 4 Hz clock: App re-renders four times a second while playing (v14.8's quarter-second
// time, which the pinned media-session call reads), and with these slices only the time readers (SeekBar, TimeText,
// MiniProgress, the Car's time and the desktop transport's seek) follow it; every other view is React.memo and reads
// contexts that did not change.
//
// Each reader throws a clear error without its provider; the ViewBoundary around the view then catches it.
// No @types/react here: React is `any` to tsc, so these interfaces document the values rather than enforce them.

import { createContext, useContext } from 'react';
import type { LayerEngine, LayerOutput, BeatRender } from '../../utils/soundV2/layerHost';
import type { ShellSheet, ShellTab, PeekPanel, LayoutPref } from './shellModel';

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
  /** Where the open sheet should start (the Sound sheet opened from Output starts at its Output group). */
  sheetFocus: 'output' | null;
  peek: PeekPanel | null;
  /** The phone shell's Car screen (Output = Car). */
  car: boolean;
  phoneShell: boolean;
  headerRef: { current: HTMLElement | null };
  barRef: { current: HTMLDivElement | null };
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
}

export const PlayerContext = createContext(null);
export const SoundContext = createContext(null);
export const LevelsContext = createContext(null);
export const LibrarySummaryContext = createContext(null);
export const WalkContext = createContext(null);
export const TimeContext = createContext(null);
export const ActionsContext = createContext(null);
export const ShellContext = createContext(null);

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
