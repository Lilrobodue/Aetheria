// components/shell/fallbacks.tsx (v15.5, the new layout beta)
//
// The new regions' fallbacks (spec §3.10). Each says the music keeps playing; the transports keep Previous /
// Play-Pause / Next under their usual names. They read the contexts with useContext directly (never the throwing
// readers): a fallback must render even when what broke was a value.

import React, { useContext } from 'react';
import { PanelFallback, SafeTransport, shellFallback } from '../ErrorBoundary';
import type { FallbackApi } from '../ErrorBoundary';
import { ActionsContext, PlayerContext } from './contexts';
import type { PlayerValue, ShellActions } from './contexts';

const noop = () => {};

function useTransport() {
  const p = useContext(PlayerContext) as PlayerValue | null;
  const a = useContext(ActionsContext) as ShellActions | null;
  return {
    isPlaying: !!p?.isPlaying,
    onPrev: a?.prev ?? noop,
    onPlayPause: a?.playPause ?? noop,
    onNext: a?.next ?? noop,
    actions: a,
  };
}

/** The whole new layout: full screen, "Use the classic layout" first, and the basic transport. */
export const ShellCrash = ({ api }: { api: FallbackApi }) => {
  const t = useTransport();
  return shellFallback(api, {
    useClassic: () => t.actions?.setLayout('classic'),
    isPlaying: t.isPlaying,
    onPrev: t.onPrev,
    onPlayPause: t.onPlayPause,
    onNext: t.onNext,
  });
};

/** Now Playing (and Car): the card with Reload panel, and the basic transport in the view's slot. */
export const NowPlayingCrash = ({ api }: { api: FallbackApi }) => {
  const t = useTransport();
  return (
    <div className="flex-1 min-h-0 flex flex-col justify-end pointer-events-auto">
      <div className="p-4 bg-surface-deep">
        <PanelFallback
          text="Now Playing hit a problem."
          switchedOff={api.switchedOff}
          copyDetails={api.copyDetails}
          buttonRef={api.buttonRef}
          onRetry={api.retry}
        />
      </div>
      <SafeTransport slot quiet isPlaying={t.isPlaying} onPrev={t.onPrev} onPlayPause={t.onPlayPause} onNext={t.onNext} onRetry={api.retry} />
    </div>
  );
};

/** The mini-player and the desktop transport: the basic transport (compact in the mini-player's slot). */
export const TransportCrash = ({ api, what, slot }: { api: FallbackApi; what: string; slot: boolean }) => {
  const t = useTransport();
  // The shell's root takes no taps (the visualizer shows through it): its controls opt back in.
  return (
    <div className="pointer-events-auto">
      <SafeTransport
        slot={slot}
        what={what}
        isPlaying={t.isPlaying}
        onPrev={t.onPrev}
        onPlayPause={t.onPlayPause}
        onNext={t.onNext}
        onRetry={api.retry}
        buttonRef={api.buttonRef}
        switchedOff={api.switchedOff}
      />
    </div>
  );
};

/** A tab's stub: the card in the tab's place (phone) or the panel (desktop). */
export const TabCrash = ({ api, inPanel }: { api: FallbackApi; inPanel: boolean }) => (
  <div className={inPanel ? 'h-full p-4 bg-surface-panel' : 'absolute inset-0 p-4 bg-surface-deep pointer-events-auto'}>
    <PanelFallback
      text="This tab hit a problem."
      switchedOff={api.switchedOff}
      copyDetails={api.copyDetails}
      buttonRef={api.buttonRef}
      onRetry={api.retry}
    />
  </div>
);
