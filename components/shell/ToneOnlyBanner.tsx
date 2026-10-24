// components/shell/ToneOnlyBanner.tsx (v15.5, the new layout beta)
//
// Shown on Now Playing while a tone plays with no music (a crystal picked while paused): says so, and Stop ends it
// (Emergency Stop's body: the layers fall, then the pinned pausePlayback, which clears the tone).

import React from 'react';
import { useActions, useSound } from './contexts';
import { countRender } from './devRenders';

const ToneOnlyBanner = () => {
  countRender('ToneOnlyBanner');
  const { crystalHz } = useSound();
  const actions = useActions();
  return (
    <div
      role="status"
      data-testid="tone-only-banner"
      className="mb-3 flex items-center justify-between gap-3 p-3 rounded-card border border-status-alert/40 bg-surface-panel"
    >
      <div className="text-sm text-ink">
        <span className="font-semibold text-ink-strong">Tone only</span> · {crystalHz} Hz, no music playing
      </div>
      <button
        type="button"
        onClick={actions.stopAll}
        className="shrink-0 h-touch px-4 rounded-control bg-surface-raised border border-line-strong text-sm font-semibold text-ink-strong hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        Stop
      </button>
    </div>
  );
};

export default React.memo(ToneOnlyBanner);
