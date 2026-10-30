// components/shell/MiniPlayer.tsx (v15.5, the new layout beta)
//
// The phone's 64 px mini-player, over the tab bar on the four tabs that aren't Now Playing, while a track is loaded or
// a tone plays (mockup mini-player-library): a 2 px progress line (MiniProgress, the only part that follows the clock),
// a crystal tile with the regime dot, the title and "1449 Hz · Vortex 3/27" (together one button, 48 px tall, that
// opens Now Playing), Play/Pause 48 and Next 44.
// v16.5 (mockup rec-pill-library-phone): while a recording runs, the REC pill sits between the title and Play, so every
// tab shows it (a tap opens Record, decision 4 A).

import React from 'react';
import { Pause, Play, SkipForward } from 'lucide-react';
import { useActions, usePlayer, useSound } from './contexts';
import { countRender } from './devRenders';
import MiniProgress from './MiniProgress';
import RecButton from './RecButton';
import { REGIME_DOT, regimeOf } from './shellModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const MiniPlayer = () => {
  countRender('MiniPlayer');
  const p = usePlayer();
  const s = useSound();
  const actions = useActions();
  if (!p.hasTrack && !p.toneOnly) return null;
  const title = p.hasTrack ? p.title : 'Tone only';
  const sub = p.hasTrack ? `${s.crystalHz} Hz · ${p.sourceShort}` : `${s.crystalHz} Hz, no music playing`;
  return (
    <div data-testid="mini-player" className="relative h-mini bg-surface-panel border-t border-line flex items-center gap-3 pl-3 pr-1">
      <MiniProgress />
      <button
        type="button"
        aria-label={`Open Now Playing: ${title}`}
        onClick={() => actions.setTab('now')}
        className={`flex-1 min-w-0 h-12 flex items-center gap-3 text-left rounded-control ${FOCUS}`}
      >
        <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center">
          <span className={`w-3 h-3 rounded-pill ${REGIME_DOT[regimeOf(s.crystalHz)]}`} />
        </span>
        <span className="min-w-0">
          <span data-testid="mini-title" className="block text-sm font-semibold text-ink-strong truncate">
            {title}
          </span>
          <span className="block text-xs text-ink-muted truncate">{sub}</span>
        </span>
      </button>
      <RecButton />
      <button
        type="button"
        aria-label={p.isPlaying ? 'Pause' : 'Play'}
        onClick={actions.playPause}
        className={`shrink-0 w-12 h-12 rounded-pill bg-gold-500 hover:bg-gold-400 text-black flex items-center justify-center transition-colors duration-fast ${FOCUS}`}
      >
        {p.isPlaying ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
      </button>
      <button
        type="button"
        aria-label="Next track"
        onClick={actions.next}
        className={`shrink-0 w-touch h-touch flex items-center justify-center rounded-control text-ink-strong ${FOCUS}`}
      >
        <SkipForward size={22} />
      </button>
    </div>
  );
};

export default React.memo(MiniPlayer);
