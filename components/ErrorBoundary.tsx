// components/ErrorBoundary.tsx (v15.4 isolation)
//
// Until v15.3 a render error anywhere in the classic layout unmounted the whole React root, and App's unmount cleanup
// stopped the music, closed the AudioContext and left a black screen under a lock-screen card still saying PLAYING.
// Nothing audio-bearing lives in the React tree (the <audio> elements, the AudioContext and the v2 player are App's
// refs), so a crash below App can be contained: the music plays on while the broken region shows a fallback.
//
//   ViewBoundary       one region of the classic layout (App wraps 12). Its JSX comes as `render`, a function a child
//                      component calls during ITS render: an expression in App's own inline JSX is evaluated in App's
//                      render, above any boundary, so a throw there would still reach the root (measured).
//                      Fallback: "Reload panel" remounts the region; three crashes in a page session switch it off
//                      until the app restarts (no crash loop).
//   PanelFallback      the fallback card (role="alert"); SafeTransport, the player bar's (basic controls);
//                      VisualsStoppedPill, the visualizer's (its slot takes no taps, so the pill is portalled).
//   RootErrorBoundary  around App: App's own crash still stops the music (App unmounts); this page says so, releases
//                      the lock-screen card, and reloads only when tapped.
//   recordViewError    console.error + a 20-entry ring in localStorage['aetheria.viewErrors.v1'] (newest first, this
//                      device only); Copy details copies the newest entry, on a tap only.
//   window.__aetheriaCrash(view)  the crash drills' hook, dev builds only (stripped from production, as
//                      __aetheriaLayers is): makes that view's CrashProbe throw on its next render.

import React, { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { waitForBlobSaves } from '../utils/playlistCache';

const IS_DEV_BUILD = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

/** The version the error log records. Bump it with the header badge (App.tsx); isolation.spec checks the two agree. */
export const APP_VERSION = 'v16.5';

export type ViewName =
  | 'visualizer'
  | 'header'
  | 'library'
  | 'harmonic'
  | 'guidebook'
  | 'frequency-lab'
  | 'safety'
  | 'record'
  | 'tutorial'
  | 'links'
  | 'notices'
  | 'transport'
  // v15.5, the new layout (beta): its own regions, each with its own strikes.
  | 'shell'
  | 'now-playing'
  | 'mini-player'
  | 'desktop-transport'
  | 'tab-library'
  | 'tab-mixes'
  | 'tab-layers'
  | 'more'
  | 'sheet-sound'
  | 'sheet-crystal'
  | 'sheet-walks'
  | 'menu'
  // v15.6, the Layers tab: one region per section, so a crash in one card leaves the others (and the music).
  | 'layers-sound'
  | 'layers-crystal'
  | 'layers-levels'
  | 'layers-beat'
  | 'layers-advanced'
  // v15.7, the Library tab: the list, the health card, the row menu (and Track info), and the Import sheet.
  | 'library-list'
  | 'library-health'
  | 'library-menu'
  | 'sheet-import'
  // v15.9, the Mixes tab: the walks, the journeys and sets, and the Experimental scores.
  | 'mixes-walks'
  | 'mixes-lists'
  | 'mixes-experimental'
  // v16.0, the queue: the Up next sheet's body (the phone's sheet, the desktop's panel).
  | 'queue'
  // v16.1, saved playlists: the list, a playlist's view, the row and playlist menus, the Add to playlist sheet.
  | 'playlists'
  | 'playlist-detail'
  | 'playlist-menu'
  | 'playlist-add'
  // v16.2, smart filters: the filter sheet's body, the bar above the list (the count, the picks, the actions), and the
  // actions' ⋯ sheet.
  | 'library-filters'
  | 'library-filter-bar'
  | 'library-filter-actions'
  // v16.3, Create a mix: its sections, its footer, and the ⋯ sheets (a Mixes-tab mix's, the builder footer's).
  | 'mix-builder'
  | 'mix-builder-footer'
  | 'mix-menu'
  // v16.3 review: the whole builder (its model work: the index, the pool, the summary, the choices' counts), and the
  // bodies of its Start from and Filters sheets.
  | 'mix-builder-view'
  | 'mix-builder-source'
  | 'mix-builder-filters'
  // v16.4, the More area: its pages (Safety & comfort with its statement, About, Links) and the Visuals sheet's body.
  | 'more-safety'
  | 'more-about'
  | 'more-links'
  | 'sheet-visuals'
  // v16.5, the More area part 2: the Guide, the Journal and Advanced pages, and the Record sheet's body.
  | 'more-guide'
  | 'more-journal'
  | 'more-advanced'
  | 'sheet-record'
  // v16.5, Export with layers: the Export sheet's body.
  | 'sheet-export';

// ---------------------------------------------------------------------------------------------------------------
// The error log
// ---------------------------------------------------------------------------------------------------------------

export const VIEW_ERRORS_KEY = 'aetheria.viewErrors.v1';
const VIEW_ERRORS_MAX = 20;

export interface ViewErrorEntry {
  t: number;
  view: string;
  message: string;
  version: string;
}

function readLog(): ViewErrorEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(VIEW_ERRORS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  return (raw || 'Unknown error').slice(0, 300);
}

/** Log a caught render error: to the console, and to this device's 20-entry ring (newest first). Never throws. */
export function recordViewError(view: string, error: unknown): void {
  try {
    console.error(`[Aetheria] the ${view} view hit a problem:`, error);
  } catch {}
  try {
    const entry: ViewErrorEntry = { t: Date.now(), view, message: messageOf(error), version: APP_VERSION };
    localStorage.setItem(VIEW_ERRORS_KEY, JSON.stringify([entry, ...readLog()].slice(0, VIEW_ERRORS_MAX)));
  } catch {
    // Storage full or blocked: the console has it.
  }
}

/** Copy the newest log entry to the clipboard (from a tap). Resolves false when there is none or the copy fails. */
export async function copyLatestViewError(): Promise<boolean> {
  const latest = readLog()[0];
  if (!latest || !navigator.clipboard) return false;
  const when = new Date(latest.t).toISOString();
  try {
    await navigator.clipboard.writeText(`Aetheria ${latest.version} · ${when} · ${latest.view}: ${latest.message}`);
    return true;
  } catch {
    return false;
  }
}

function copyDetails(): void {
  void copyLatestViewError();
}

// ---------------------------------------------------------------------------------------------------------------
// The crash drills' hook (dev builds only)
// ---------------------------------------------------------------------------------------------------------------

const crashListeners = new Set<(view: string) => void>();
if (IS_DEV_BUILD && typeof window !== 'undefined') {
  (window as any).__aetheriaCrash = (view: string) => {
    crashListeners.forEach((listener) => listener(view));
  };
}

/** Throws on every render once its view is named (per-instance state, so React's retry render throws again). */
function CrashProbe({ view }: { view: string }) {
  const [boom, setBoom] = useState(false);
  useEffect(() => {
    const listener = (v: string) => {
      if (v === view) setBoom(true);
    };
    crashListeners.add(listener);
    return () => {
      crashListeners.delete(listener);
    };
  }, [view]);
  if (boom) throw new Error(`Test crash in ${view}`);
  return null;
}

/** A sibling of App under the root boundary (index.tsx): the root drill. Nothing in production. */
export const RootCrashProbe = IS_DEV_BUILD ? () => <CrashProbe view="root" /> : () => null;

/**
 * v16.3 review: a drill INSIDE a component's own work, not beside it as a region's CrashProbe is (dev builds only).
 * useCrashDrill(view) is true once __aetheriaCrash(view) names it, until the component remounts (Reload panel), and the
 * component then calls crashDrill(view) from the work under test (Create a mix's model memos), which throws there. In
 * production the hook is a constant false and crashDrill does nothing.
 */
function useCrashDrillDev(view: string): boolean {
  const [boom, setBoom] = useState(false);
  useEffect(() => {
    const listener = (v: string) => {
      if (v === view) setBoom(true);
    };
    crashListeners.add(listener);
    return () => {
      crashListeners.delete(listener);
    };
  }, [view]);
  return boom;
}
export const useCrashDrill: (view: string) => boolean = IS_DEV_BUILD ? useCrashDrillDev : () => false;
export const crashDrill: (view: string) => void = IS_DEV_BUILD
  ? (view: string) => {
      throw new Error(`Test crash in ${view}`);
    }
  : () => {};
/**
 * v16.3 re-review: a drill tied to a VALUE (dev builds only), for a crash that settings cause and so come back with
 * them after a reload: a test sets window.__aetheriaCrashWhen = { [view]: (value) => boolean } (an init script, so it
 * holds across reloads), and crashWhen(view, value), called from the work under test (Create a mix's summary, with its
 * settings), throws while that says so. In production it does nothing.
 */
export const crashWhen: (view: string, value: unknown) => void = IS_DEV_BUILD
  ? (view: string, value: unknown) => {
      const when = typeof window === 'undefined' ? undefined : (window as any).__aetheriaCrashWhen?.[view];
      if (typeof when === 'function' && when(value)) throw new Error(`Test crash in ${view}`);
    }
  : () => {};

// ---------------------------------------------------------------------------------------------------------------
// Fallbacks
// ---------------------------------------------------------------------------------------------------------------

export interface FallbackApi {
  /** Remount the region (Reload panel). */
  retry: () => void;
  /** Three crashes this page session: no Reload panel, only Close. */
  switchedOff: boolean;
  copyDetails: () => void;
  /** The fallback's main button: it takes the focus when the crash took it. */
  buttonRef: { current: HTMLButtonElement | null };
  /** Hide the fallback for the rest of the session (Close on a switched-off region that has no panel to shut). */
  dismiss: () => void;
}

interface PanelFallbackProps {
  /** The first sentence; "The music keeps playing." follows it. */
  text?: string;
  onRetry?: () => void;
  onClose?: () => void;
  switchedOff: boolean;
  copyDetails: () => void;
  buttonRef: { current: HTMLButtonElement | null };
  className?: string;
  /** 'bar': one row across its slot (the header's), instead of a card. */
  layout?: 'card' | 'bar';
}

export const PanelFallback = ({ text, onRetry, onClose, switchedOff, copyDetails, buttonRef, className, layout = 'card' }: PanelFallbackProps) => (
  <div
    role="alert"
    className={`${
      layout === 'bar'
        ? 'shrink-0 flex flex-wrap items-center justify-between gap-2 p-3 border-b border-line bg-surface-deep text-sm text-ink'
        : 'bg-surface-panel border border-line-strong rounded-card p-4 text-sm text-ink'
    }${className ? ` ${className}` : ''}`}
  >
    <p className="leading-snug">
      {switchedOff
        ? 'This panel is switched off until you restart the app. The music keeps playing.'
        : `${text ?? 'This panel hit a problem.'} The music keeps playing.`}
    </p>
    <div className={layout === 'bar' ? 'flex flex-wrap items-center gap-2' : 'mt-3 flex flex-wrap items-center gap-2'}>
      {!switchedOff && onRetry && (
        <Button variant="primary" buttonRef={buttonRef} onClick={onRetry}>
          Reload panel
        </Button>
      )}
      {onClose && (
        <Button variant="secondary" buttonRef={switchedOff || !onRetry ? buttonRef : undefined} onClick={onClose}>
          Close
        </Button>
      )}
      <Button variant="ghost" onClick={copyDetails}>
        Copy details
      </Button>
    </div>
  </div>
);

/**
 * The fallback of a region that is always on screen: in `slotClassName` (its position; the slot takes no taps, the
 * card does), or in place with none. Reload panel remounts it; switched off, Close puts the card away for the session.
 */
export function panelFallback(slotClassName: string | null, text?: string, layout?: 'card' | 'bar') {
  return (api: FallbackApi) => {
    const card = (
      <PanelFallback
        text={text}
        layout={layout}
        className={slotClassName ? 'w-full pointer-events-auto' : undefined}
        switchedOff={api.switchedOff}
        copyDetails={api.copyDetails}
        buttonRef={api.buttonRef}
        onRetry={api.retry}
        onClose={api.switchedOff ? api.dismiss : undefined}
      />
    );
    return slotClassName ? <div className={`${slotClassName} pointer-events-none`}>{card}</div> : card;
  };
}

/**
 * The fallback of a panel that opens and closes (`open`): shown only while it is open, in `slotClassName` (its
 * position; the slot takes no taps, the card does). Close shuts the panel and resets the region, so the next open
 * renders it afresh (a switched-off region shows its card again instead).
 */
export function modalFallback(open: boolean, close: () => void, slotClassName: string, text?: string) {
  return (api: FallbackApi) =>
    open ? (
      <div className={`${slotClassName} pointer-events-none`}>
        <PanelFallback
          text={text}
          className="w-full max-w-md pointer-events-auto"
          switchedOff={api.switchedOff}
          copyDetails={api.copyDetails}
          buttonRef={api.buttonRef}
          onRetry={api.retry}
          onClose={() => {
            close();
            if (!api.switchedOff) api.retry();
          }}
        />
      </div>
    ) : null;
}

interface SafeTransportProps {
  isPlaying: boolean;
  onPrev: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onRetry: () => void;
  barRef?: { current: HTMLDivElement | null };
  buttonRef?: { current: HTMLButtonElement | null };
  switchedOff?: boolean;
  /** Zen Mode is on: the real player bar held its only toggle, so the fallback offers the way out. */
  zenMode?: boolean;
  onLeaveZen?: () => void;
  /** v15.5 (the new layout): in its region's own slot, in the page's flow, instead of fixed over the page's bottom. */
  slot?: boolean;
  /** v15.5: what the hidden alert names (default "The player bar"). */
  what?: string;
  /** v15.5: inside a fallback card that already says it and offers Reload panel: no alert, no Reload controls. */
  quiet?: boolean;
}

/** The player bar's fallback: the basic controls, under the same names as the real transport's. */
export const SafeTransport = ({ isPlaying, onPrev, onPlayPause, onNext, onRetry, barRef, buttonRef, switchedOff, zenMode, onLeaveZen, slot, what, quiet }: SafeTransportProps) => (
  <div
    ref={barRef}
    data-testid="safe-transport"
    className={
      slot
        ? 'w-full bg-surface-deep border-t border-line flex flex-wrap items-center justify-center gap-3 p-2'
        : 'fixed bottom-0 inset-x-0 z-popover bg-surface-deep border-t border-line flex flex-wrap items-center justify-center gap-3 p-2'
    }
  >
    {!quiet && (
      <p role="alert" className="sr-only">
        {switchedOff
          ? `${what ?? 'The player bar'} is switched off until you restart the app. The music keeps playing.`
          : `${what ?? 'The player bar'} hit a problem. The music keeps playing.`}
      </p>
    )}
    <IconButton label="Previous track" icon={<SkipBack size={18} />} onClick={onPrev} />
    <IconButton label={isPlaying ? 'Pause' : 'Play'} icon={isPlaying ? <Pause size={20} /> : <Play size={20} />} onClick={onPlayPause} buttonRef={buttonRef} />
    <IconButton label="Next track" icon={<SkipForward size={18} />} onClick={onNext} />
    {!switchedOff && !quiet && (
      <Button variant="secondary" onClick={onRetry}>
        Reload controls
      </Button>
    )}
    {zenMode && onLeaveZen && (
      <Button variant="secondary" onClick={onLeaveZen}>
        Leave Zen mode
      </Button>
    )}
  </div>
);

interface ShellFallbackOptions {
  /** Saves 'classic' and shows it (the way out of a broken new layout). */
  useClassic: () => void;
  isPlaying: boolean;
  onPrev: () => void;
  onPlayPause: () => void;
  onNext: () => void;
}

/**
 * v15.5: the new layout's own fallback (the `shell` region, around the whole new layout): full screen, with
 * "Use the classic layout" first, Reload panel (until three strikes switch it off) and Copy details, and the basic
 * transport under it, so the music can always be controlled.
 */
export function shellFallback(api: FallbackApi, o: ShellFallbackOptions) {
  return (
    <div data-testid="shell-fallback" className="fixed inset-0 z-10 bg-surface-deep text-ink flex flex-col">
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <div role="alert" className="w-full max-w-md bg-surface-panel border border-line-strong rounded-card p-4 text-sm text-ink">
          <p className="leading-snug">
            {api.switchedOff
              ? 'The new layout is switched off until you restart the app. The music keeps playing.'
              : 'The new layout hit a problem. The music keeps playing.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" buttonRef={api.buttonRef} onClick={o.useClassic}>
              Use the classic layout
            </Button>
            {!api.switchedOff && (
              <Button variant="secondary" onClick={api.retry}>
                Reload panel
              </Button>
            )}
            <Button variant="ghost" onClick={api.copyDetails}>
              Copy details
            </Button>
          </div>
        </div>
      </div>
      <SafeTransport slot quiet isPlaying={o.isPlaying} onPrev={o.onPrev} onPlayPause={o.onPlayPause} onNext={o.onNext} onRetry={api.retry} />
    </div>
  );
}

interface VisualsStoppedPillProps {
  onRetry: () => void;
  /** Switched off: the pill says so, and a tap puts it away. */
  onClose?: () => void;
  buttonRef?: { current: HTMLButtonElement | null };
  switchedOff?: boolean;
}

/** The visualizer's fallback: its own slot takes no taps (pointer-events-none), so a pill in a portal. */
export const VisualsStoppedPill = ({ onRetry, onClose, buttonRef, switchedOff }: VisualsStoppedPillProps) =>
  createPortal(
    <div className="fixed top-20 right-4 z-[65]">
      {switchedOff ? (
        <Button variant="secondary" buttonRef={buttonRef} onClick={onClose ?? (() => {})}>
          Visuals off until you restart the app · Close
        </Button>
      ) : (
        <Button variant="secondary" buttonRef={buttonRef} onClick={onRetry}>
          Visuals stopped · Restart visuals
        </Button>
      )}
    </div>,
    document.body
  );

// ---------------------------------------------------------------------------------------------------------------
// The boundaries
// ---------------------------------------------------------------------------------------------------------------

/** Crashes per region this page session (decision 3: three switch it off until a restart). */
const strikes = new Map<string, number>();
const STRIKES_OFF = 3;

/** Move the focus to `ref` only when the crash took it (it is on <body>, or on nothing still in the page). */
function focusIfLost(ref: { current: HTMLButtonElement | null }): void {
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected) ref.current?.focus();
}

/** Calls the region's JSX during its own render, so every expression in it runs under the boundary. */
function Region({ render }: { render: () => ReactNode }) {
  const out = render();
  return out === false || out === undefined ? null : out;
}

interface ViewBoundaryProps {
  name: ViewName;
  /** The region's JSX, evaluated under the boundary. */
  render: () => ReactNode;
  /** Default: a PanelFallback with Reload panel. */
  fallback?: (api: FallbackApi) => ReactNode;
  /** After the region or its fallback mounts in the other's place (the header and the transport re-measure). */
  onReset?: () => void;
  /** v16.3 review: once per caught crash, after it is logged and counted (Create a mix forgets that it was open, so the
   *  Mixes tab comes back to its list rather than to the crash). Never throws into the boundary: guarded here. */
  onCatch?: (error: unknown) => void;
}

interface ViewBoundaryState {
  error: unknown;
  key: number;
  dismissed: boolean;
}

export class ViewBoundary extends React.Component {
  declare props: ViewBoundaryProps;
  // No @types/react here: React.Component is untyped, so its members are declared (the tsprobe rule).
  declare setState: (update: Partial<ViewBoundaryState> | ((s: ViewBoundaryState) => Partial<ViewBoundaryState>)) => void;
  state: ViewBoundaryState = { error: null, key: 0, dismissed: false };
  buttonRef: { current: HTMLButtonElement | null } = { current: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('Unknown error') };
  }

  componentDidCatch(error: unknown) {
    recordViewError(this.props.name, error);
    strikes.set(this.props.name, (strikes.get(this.props.name) ?? 0) + 1);
    try {
      this.props.onCatch?.(error);
    } catch {}
    // The fallback rendered before this count (render runs before the commit that calls this): render it again, so
    // a third crash shows "switched off" at once, not on App's next render.
    this.setState({});
  }

  /** Whether the last render showed the switched-off fallback, and whether its focus has been seen to. */
  renderedOff = false;
  offFocusChecked = false;

  componentDidUpdate(_prevProps: unknown, prevState: ViewBoundaryState) {
    if (!!prevState.error !== !!this.state.error) {
      if (this.state.error) focusIfLost(this.buttonRef);
      this.props.onReset?.();
    }
    // The third crash: its first fallback (with Reload panel, which may have just taken the focus) is re-rendered
    // switched off, so that button is gone. Once, give the focus to the switched-off fallback's Close if it was lost.
    if (this.state.error && this.renderedOff && !this.offFocusChecked) {
      this.offFocusChecked = true;
      focusIfLost(this.buttonRef);
    }
  }

  retry = () => {
    if ((strikes.get(this.props.name) ?? 0) >= STRIKES_OFF) return;
    this.setState((s: ViewBoundaryState) => ({ error: null, key: s.key + 1, dismissed: false }));
  };

  dismiss = () => {
    this.setState({ dismissed: true });
  };

  render() {
    if (this.state.error) {
      if (this.state.dismissed) return null;
      const api: FallbackApi = {
        retry: this.retry,
        switchedOff: (strikes.get(this.props.name) ?? 0) >= STRIKES_OFF,
        copyDetails,
        buttonRef: this.buttonRef,
        dismiss: this.dismiss,
      };
      this.renderedOff = api.switchedOff;
      if (this.props.fallback) return this.props.fallback(api);
      return (
        <PanelFallback
          switchedOff={api.switchedOff}
          copyDetails={copyDetails}
          buttonRef={this.buttonRef}
          onRetry={this.retry}
          onClose={api.switchedOff ? this.dismiss : undefined}
        />
      );
    }
    return (
      <React.Fragment key={this.state.key}>
        {IS_DEV_BUILD ? <CrashProbe view={this.props.name} /> : null}
        <Region render={this.props.render} />
      </React.Fragment>
    );
  }
}

/** Release the lock-screen card: the music has stopped with App, so a card saying PLAYING would lie. */
function releaseMediaSession(): void {
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    }
  } catch {}
}

const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface RootErrorBoundaryProps {
  children?: ReactNode;
}

export class RootErrorBoundary extends React.Component {
  declare props: RootErrorBoundaryProps;
  declare setState: (update: Partial<{ error: unknown; reloading: boolean }>) => void;
  state: { error: unknown; reloading: boolean } = { error: null, reloading: false };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('Unknown error') };
  }

  componentDidCatch(error: unknown) {
    recordViewError('root', error);
    releaseMediaSession();
    // Once more after App's own effect cleanups have run (they follow this in the same commit).
    setTimeout(releaseMediaSession, 0);
  }

  reload = () => {
    if (this.state.reloading) return;
    this.setState({ reloading: true });
    // Let a library save in flight finish (at most 5 s), then reload.
    Promise.race([waitForBlobSaves().catch(() => {}), timeout(5000)]).then(() => window.location.reload());
  };

  render() {
    if (!this.state.error) return this.props.children ?? null;
    return (
      <div className="min-h-screen bg-surface-deep text-ink flex items-center justify-center p-6">
        <div role="alert" className="w-full max-w-md bg-surface-panel border border-line-strong rounded-card p-6 text-sm space-y-3">
          <p className="text-base font-bold text-ink-strong">Aetheria stopped after a problem.</p>
          <p className="text-ink-soft">Your library is saved on this device.</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="primary" onClick={this.reload}>
              {this.state.reloading ? 'Reloading…' : 'Reload'}
            </Button>
            <Button variant="ghost" onClick={copyDetails}>
              Copy details
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
