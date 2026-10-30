// components/shell/more/moreModel.ts (v16.4, the More area, part 1)
//
// The More tab's pure rules: its pages and their headers, the root's rows and their status lines (from contexts, never
// the clock), Keep screen awake's stored value, About's status lines (aboutStatus), and the statement page's version
// line. Free of app imports, so Node checks it directly (moreModel.check.ts: `npm run check:shell`).

/** The More tab's pages (v16.5 adds guide, journal and advanced). The Visuals sheet is a sheet, not a page. */
export type MoreView = 'root' | 'safety' | 'statement' | 'about' | 'links';

export const MORE_VIEWS: ReadonlyArray<MoreView> = ['root', 'safety', 'statement', 'about', 'links'];

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

/** The opener a page remembers when `current` opens `next`: About for Links opened from About's row; else none. */
export function openerOf(current: MoreView, next: MoreView): MoreView | undefined {
  return next === 'links' && current === 'about' ? 'about' : undefined;
}

/**
 * Where a page's Back goes: the statement back to Safety & comfort; Links back to About when About opened it; every
 * other page to the root.
 */
export function backTarget(view: MoreView, from?: MoreView | null): MoreView {
  if (view === 'statement') return 'safety';
  if (view === 'links' && from === 'about') return 'about';
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
export const GROUP_SAFETY = 'Safety';
export const GROUP_ABOUT = 'About';
/** v16.4 only: what part 2 (v16.5) brings is still in the classic layout. */
export const GROUP_CLASSIC = 'In the classic layout for now';

export const SAFETY_ROW_SUBTITLE = 'Stop all sound, Music only, the safety statement';
export const LINKS_ROW_SUBTITLE = 'Apps, books, music, community and contact';
export const CLASSIC_ROW_TITLE = 'Guide, Record, Journal, scan scores';
export const CLASSIC_ROW_SUBTITLE = 'Use the classic layout; the music keeps playing';
export const TOUR_ROW_SUBTITLE = 'Four cards: your music, the 27 crystals, the layers, where things are';
export const STATEMENT_ROW_SUBTITLE = 'What this tool is and is not; photosensitivity, audio, data';

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
  const update = i.updateReady
    ? {
        text: `${UPDATE_READY_TEXT}${i.audible ? UPDATE_STOPS_MUSIC : ''}`,
        reloadDisabled: recording,
        note: recording ? RELOAD_RECORDING_NOTE : null,
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
