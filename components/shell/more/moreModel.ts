// components/shell/more/moreModel.ts (v16.4, the More area, part 1)
//
// The More tab's pure rules: its pages and their headers, the root's rows and their status lines (from contexts, never
// the clock), Keep screen awake's stored value, About's status lines (aboutStatus), and the statement page's version
// line. Free of app imports, so Node checks it directly (moreModel.check.ts: `npm run check:shell`).

/** The More tab's pages (v16.5 adds guide, journal and advanced). The Visuals and Record sheets are sheets, not pages. */
export type MoreView = 'root' | 'safety' | 'statement' | 'about' | 'links' | 'guide' | 'journal' | 'advanced';

export const MORE_VIEWS: ReadonlyArray<MoreView> = ['root', 'safety', 'statement', 'about', 'links', 'guide', 'journal', 'advanced'];

export function isMoreView(v: unknown): v is MoreView {
  return typeof v === 'string' && (MORE_VIEWS as ReadonlyArray<string>).includes(v);
}

/** Each page's h1. */
export const VIEW_TITLES: Readonly<Record<MoreView, string>> = {
  root: 'More',
  safety: 'Safety & comfort',
  statement: 'Safety statement',
  about: 'About',
  links: 'Links',
  guide: 'Guide',
  journal: 'Journal',
  advanced: 'Advanced',
};

/**
 * Where the More tab was left (App's moreViewRef, session only): the page, its scroll, and (v16.4 review) the page that
 * opened it when that isn't its usual parent: Links from About's row, so its Back returns to About.
 */
export interface MoreViewState {
  view: MoreView;
  top: number;
  from?: MoreView;
}

/** The opener a page remembers when `current` opens `next`: About for Links opened from About's row; v16.6: Safety &
 *  comfort for the Guide opened from its "How sure are we?" row; else none. */
export function openerOf(current: MoreView, next: MoreView): MoreView | undefined {
  if (next === 'links' && current === 'about') return 'about';
  if (next === 'guide' && current === 'safety') return 'safety';
  return undefined;
}

/**
 * Where a page's Back goes: the statement back to Safety & comfort; Links back to About when About opened it; every
 * other page to the root.
 */
export function backTarget(view: MoreView, from?: MoreView | null): MoreView {
  if (view === 'statement') return 'safety';
  if (view === 'links' && from === 'about') return 'about';
  if (view === 'guide' && from === 'safety') return 'safety';
  return 'root';
}

/** Back's accessible name. */
export function backLabel(view: MoreView, from?: MoreView | null): string {
  return `Back to ${VIEW_TITLES[backTarget(view, from)]}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The root's rows (decision 2 A: one list under headings)
// ---------------------------------------------------------------------------------------------------------------

export const GROUP_VISUALS = 'Visuals and recording';
/** v16.5. */
export const GROUP_LEARN = 'Learn';
export const GROUP_SAFETY = 'Safety';
export const GROUP_ABOUT = 'About';
/** v16.5. */
export const GROUP_ADVANCED = 'Advanced';
/** v16.4 only (v16.5 retires the group: its row is Advanced's Use the classic layout). */
export const GROUP_CLASSIC = 'In the classic layout for now';

export const SAFETY_ROW_SUBTITLE = 'Stop all sound, Music only, the safety statement';
export const LINKS_ROW_SUBTITLE = 'Apps, books, music, community and contact';
export const CLASSIC_ROW_TITLE = 'Guide, Record, Journal, scan scores';
export const CLASSIC_ROW_SUBTITLE = 'Use the classic layout; the music keeps playing';
export const TOUR_ROW_SUBTITLE = 'Four cards: your music, the 27 crystals, the layers, where things are';
export const STATEMENT_ROW_SUBTITLE = 'What this tool is and is not; photosensitivity, audio, data';

// v16.5, the part-2 rows (spec §3.2).
export const RECORD_ROW_SUBTITLE = 'Audio, visuals or both, saved to your downloads';
export const GUIDE_ROW_SUBTITLE = 'Plain language or technical, with the Lo Shu cube';
export const JOURNAL_ROW_SUBTITLE = 'Notes on how a session felt, kept on this device';
export const JOURNAL_ROW_DOCUMENTING = 'A session is being documented';
export const ADVANCED_ROW_SUBTITLE = 'Experimental scan scores, the classic layout';
export const EXPERIMENTAL_BADGE = 'Experimental';

/** The Journal row's line: while a session is documented, it says so. */
export function journalRowSubtitle(documenting: boolean): string {
  return documenting ? JOURNAL_ROW_DOCUMENTING : JOURNAL_ROW_SUBTITLE;
}

/** "3:12", "1:02:03": a recording's elapsed time from its start (ms) to now (ms); 0:00 before it or on bad input. */
export function elapsedText(sinceMs: number, nowMs: number): string {
  const s = Number.isFinite(sinceMs) && Number.isFinite(nowMs) && nowMs > sinceMs ? Math.floor((nowMs - sinceMs) / 1000) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** About's row: "Version v16.4", plus " · an update is ready" while one is. */
export function aboutRowSubtitle(version: string | null | undefined, updateReady: boolean): string {
  const v = version ? `Version ${version}` : 'Version';
  return updateReady ? `${v} · an update is ready` : v;
}

// ---------------------------------------------------------------------------------------------------------------
// Safety & comfort
// ---------------------------------------------------------------------------------------------------------------

/** Keep screen awake: a device setting in both layouts. Unset or anything but 'false' is on (the behaviour before). */
export const KEEP_AWAKE_KEY = 'aetheria.keepAwake.v1';

export function parseKeepAwake(raw: string | null | undefined): boolean {
  return raw !== 'false';
}

export const KEEP_AWAKE_LABEL = 'Keep screen awake';
export const KEEP_AWAKE_LINE = 'While music plays, the screen stays on. Off: it sleeps as your phone is set to, and the music plays on. Saved.';
/** The ⋯ row's words, under Stop all sound. */
export const STOP_ALL_LINE = 'The music, the tone, the beat and the drone';

/** The statement page's one new line (the version is the app's DISCLAIMER_VERSION). */
export function statementVersionLine(version: string | null | undefined): string {
  return `Shown when you first open Aetheria, and again whenever it changes (this version: ${version || 'unknown'}).`;
}

// ---------------------------------------------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------------------------------------------

export type UpdateCheck = 'idle' | 'checking' | 'latest' | 'downloading' | 'failed';

export interface AboutInput {
  /** navigator.serviceWorker.controller is set (this page is served by the offline cache's worker). */
  controller: boolean;
  /** caches.keys() as last read (on mount, and on each service-worker change), or null before it answers. */
  cacheKeys: ReadonlyArray<string> | null;
  /** This build's version (APP_VERSION): only its own offline cache counts as saved (v16.4 review). */
  version: string;
  online: boolean;
  /** A registration exists to ask for an update (Check for updates needs one). */
  registration: boolean;
  updateReady: boolean;
  /** The music or the tone plays (isPlaying || isSolfeggioActive): Reloading stops it. */
  audible: boolean;
  recording: boolean;
  /** v16.5: an export runs (a reload would lose it). */
  exporting?: boolean;
  check: UpdateCheck;
}

export interface AboutStatus {
  offline: { title: string; sub: string; saved: boolean };
  network: { title: string; sub: string };
  /** The update card (the shared toast's words), or null with no update ready. */
  update: { text: string; reloadDisabled: boolean; note: string | null } | null;
  checkDisabled: boolean;
  /** The line under Check for updates, or null. */
  checkLine: string | null;
}

/** This version's offline cache, as public/sw.js names it: 'aetheria-v16.4-offline' for 'v16.4'. */
export function offlineCacheName(version: string): string {
  return `aetheria-${version}-offline`;
}

/**
 * Whether a cache key is THIS version's offline cache (v16.4 review: another version's, e.g. the one a newer worker
 * just installed or an older one not yet deleted, doesn't make this version work offline).
 */
export function isAppCacheKey(k: unknown, version: string | null | undefined): boolean {
  return typeof k === 'string' && typeof version === 'string' && version !== '' && k === offlineCacheName(version);
}

export const UPDATE_READY_TEXT = 'A new version of Aetheria is ready.';
export const UPDATE_STOPS_MUSIC = ' Reloading stops the music.';
export const RELOAD_RECORDING_NOTE = 'Stop the recording first: reloading would lose it.';
/** v16.5. */
export const RELOAD_EXPORT_NOTE = 'Wait for the export to finish: reloading would lose it.';
/** v16.5 final: the label of flushAndReload's "the library couldn't be saved" toast action, which App's showStatusToast
 *  holds while a recording or an export runs. flushAndReload (pinned by check:writers) writes it as a literal; this
 *  module's check asserts that literal is this value, so a rename of either fails `npm run check:shell`. */
export const RELOAD_ANYWAY_LABEL = 'Reload anyway';

/** About's status lines, from what the page read (no App state but the update flag; event-driven, no polling). */
export function aboutStatus(input: Partial<AboutInput> | null | undefined): AboutStatus {
  const i = input ?? {};
  const keys = Array.isArray(i.cacheKeys) ? i.cacheKeys : [];
  const saved = !!i.controller && keys.some((k) => isAppCacheKey(k, i.version));
  const online = i.online !== false;
  const offline = saved
    ? { title: 'Works offline', sub: 'This version is saved on this device', saved: true }
    : { title: 'Not saved for offline use yet', sub: 'It is saved after the first full load with a connection', saved: false };
  const network = online
    ? { title: 'Online', sub: 'Updates are checked when the app opens' }
    : { title: 'Offline', sub: 'The app works offline; updates wait for a connection' };
  const recording = !!i.recording;
  const exporting = !!i.exporting;
  const update = i.updateReady
    ? {
        text: `${UPDATE_READY_TEXT}${i.audible ? UPDATE_STOPS_MUSIC : ''}`,
        reloadDisabled: recording || exporting,
        note: recording ? RELOAD_RECORDING_NOTE : exporting ? RELOAD_EXPORT_NOTE : null,
      }
    : null;
  const check = i.check ?? 'idle';
  const checkLine =
    check === 'checking'
      ? 'Checking…'
      : check === 'latest'
        ? 'This is the latest version.'
        : check === 'downloading'
          ? 'Downloading the new version…'
          : check === 'failed'
            ? "Couldn't check for updates."
            : null;
  return {
    offline,
    network,
    update,
    checkDisabled: !online || !i.registration || check === 'checking',
    checkLine,
  };
}

/** A worker's state, as Check for updates reads it right after `update()` (null: no new worker): the line to show. */
export function checkAfterUpdate(state: string | null | undefined): UpdateCheck {
  if (!state) return 'latest';
  return settleCheck('downloading', state);
}

/**
 * The check line once the downloading worker's state moves on (v16.4 review: "Downloading the new version…" never
 * stays): installed (or later) clears it, the update card says the rest; redundant (the install failed) says it
 * couldn't. Any other line is kept.
 */
export function settleCheck(current: UpdateCheck, state: string | null | undefined): UpdateCheck {
  if (current !== 'downloading') return current;
  if (state === 'installed' || state === 'activating' || state === 'activated') return 'idle';
  if (state === 'redundant') return 'failed';
  return 'downloading';
}

// ---------------------------------------------------------------------------------------------------------------
// v16.5: the Guide, the Journal and Advanced (spec §3.7, §3.9, §3.10; their words are new, for the copy pass)
// ---------------------------------------------------------------------------------------------------------------

export type GuideView = 'plain' | 'technical';
export const GUIDE_VIEW_LABEL = 'Guide view';
export const GUIDE_VIEWS: ReadonlyArray<{ value: GuideView; label: string }> = [
  { value: 'plain', label: 'Plain language' },
  { value: 'technical', label: 'Technical' },
];

export function isGuideView(v: unknown): v is GuideView {
  return v === 'plain' || v === 'technical';
}

export const JOURNAL_LINE = 'Document how a session felt: before and after, sensations and notes. Kept on this device only.';
export const JOURNAL_EXPERIMENTAL_LINE = 'Experimental: self-reports, not measurements.';

export const ADVANCED_EXPERIMENTAL = 'Experimental';
export const ADVANCED_LAYOUT = 'Layout';
export const ADVANCED_TESTING = 'For testing';
export const SCAN_SCORES_TITLE = 'Show experimental scan scores';
/** v16.6: the line carries its evidence tag (Design choice: the scores are the app's own; check:copy's T2). */
export const SCAN_SCORES_NOTE = {
  line: "Deep Scan's golden-ratio, 111 and DNA scores, on Library rows and in Track info. They are scores from an unreliable reading of the spectrum, not measurements.",
  tag: 'design',
} as const;
export const SCAN_SCORES_LINE = SCAN_SCORES_NOTE.line;
export const LAYOUT_STATUS = 'new (beta)';
export const LAYOUT_LINE = 'The classic layout has every control on one screen. The music keeps playing when you switch.';
export const USE_CLASSIC = 'Use the classic layout';
export const PERF_TITLE = 'Performance readout';
export const PERF_LINE = 'Frames, renders and long tasks in a corner of the screen. Shows from the next launch.';
export const PERF_ON_NOW = 'On now';
/** Track info with nothing loaded: classic's own toast, verbatim. */
export const NO_TRACK_FOR_INFO = 'No track currently selected for analysis.';

// ---------------------------------------------------------------------------------------------------------------
// "A tap on the active More tab goes back to the root" (the tab bar and the side nav ask; the mounted More tab answers)
// ---------------------------------------------------------------------------------------------------------------

const rootListeners = new Set<() => void>();

/** The More tab, while mounted: called when its own (already active) tab button is tapped again. */
export function onMoreRootRequest(fn: () => void): () => void {
  rootListeners.add(fn);
  return () => {
    rootListeners.delete(fn);
  };
}

/**
 * The tab bar / the side nav: their More button tapped while More is the active tab. The mounted More tab goes to its
 * root; with none mounted (the desktop panel shows the Visuals sheet in More's place, v16.4 review), the place it was
 * left becomes the root, so More opens there.
 */
export function requestMoreRoot(viewRef?: { current: MoreViewState } | null): void {
  if (rootListeners.size > 0) {
    for (const fn of Array.from(rootListeners)) fn();
    return;
  }
  if (viewRef) viewRef.current = { view: 'root', top: 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// v16.6, "How sure are we?": an evidence tag opens More › Guide at a tier (App's actions.openEvidence). A mounted More
// tab answers by going to the page (as a tap on the active More tab does for the root); a mounted Guide answers by
// scrolling to the anchor App left in guideViewRef. With none mounted, the refs are read when they mount.
// ---------------------------------------------------------------------------------------------------------------

const viewListeners = new Set<(view: MoreView) => void>();

/** The More tab, while mounted: called when something outside it asks for a page. */
export function onMoreViewRequest(fn: (view: MoreView) => void): () => void {
  viewListeners.add(fn);
  return () => {
    viewListeners.delete(fn);
  };
}

/** Show this More page: the mounted More tab goes there; with none mounted, it is where More opens (from its top). */
export function requestMoreView(viewRef: { current: MoreViewState } | null | undefined, view: MoreView): void {
  if (viewListeners.size > 0) {
    for (const fn of Array.from(viewListeners)) fn(view);
    return;
  }
  if (viewRef) viewRef.current = { view, top: 0 };
}

const anchorListeners = new Set<() => void>();

/** The Guide, while mounted: called when App has left it an anchor (guideViewRef.current.anchor). */
export function onGuideAnchorRequest(fn: () => void): () => void {
  anchorListeners.add(fn);
  return () => {
    anchorListeners.delete(fn);
  };
}

/** A mounted Guide scrolls to the anchor now (an unmounted one reads it on mount). */
export function requestGuideAnchor(): void {
  for (const fn of Array.from(anchorListeners)) fn();
}

/** The Safety & comfort row's line, and the Guide's jump button (utils/copy/evidence's words). */
export { HOW_SURE_TITLE as HOW_SURE_ROW_TITLE, HOW_SURE_ROW_LINE } from '../../../utils/copy/evidence.ts';
