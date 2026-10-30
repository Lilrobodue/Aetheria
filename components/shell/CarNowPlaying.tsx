// components/shell/CarNowPlaying.tsx (v15.5, the new layout beta)
//
// The Car screen (decision 5, mockup np-phone-car): Now Playing on the phone while the v2 output is Car. A plain
// dark screen: what plays, one line about the layers, the time, big Previous / Play / Next (88 / 112 / 88 px: the
// same three actions as the lock screen's and the car's own), the driving line, and Stop all sound at the bottom,
// apart from the transport. No chips, no seek bar, no visuals: the screen is solid and the heat guard pauses the
// visualizer behind it. Change output opens the Sound sheet at its Output group.
// v16.5 (decision 4 A): the REC pill here keeps its one-tap stop (mode "stop"); everywhere else a tap opens Record.

import React from 'react';
import { Car, OctagonX, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useActions, usePlayer, useShell, useSound } from './contexts';
import { countRender } from './devRenders';
import RecButton from './RecButton';
import TimeText from './TimeText';
import { carLine } from './shellModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const CarNowPlaying = () => {
  countRender('CarNowPlaying');
  const p = usePlayer();
  const s = useSound();
  const actions = useActions();
  const { headerRef } = useShell();
  return (
    <div data-testid="view-car" className="absolute inset-0 flex flex-col bg-surface-base pointer-events-auto">
      <header ref={headerRef} className="shrink-0 h-16 px-4 flex items-center justify-between gap-2 border-b border-line bg-surface-deep">
        <span className="inline-flex items-center gap-2 text-lg font-semibold text-ink-strong">
          <Car size={24} className="text-gold-400" aria-hidden="true" />
          Car
        </span>
        <div className="flex items-center gap-2">
          <RecButton mode="stop" />
          <button
            type="button"
            onClick={() => actions.openSheet('sound', 'output')}
            className={`h-12 px-4 rounded-control border border-line-strong text-base text-ink-soft hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
          >
            Change output
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-8 flex flex-col">
        <p data-testid="car-source" className="text-sm uppercase tracking-widest text-ink-muted">
          {p.source}
        </p>
        <h1 tabIndex={-1} data-view-heading="" data-testid="car-title" className="mt-2 text-3xl font-semibold leading-tight text-ink-strong line-clamp-2 outline-none">
          {p.hasTrack ? p.title : 'Nothing playing'}
        </h1>
        <p data-testid="car-line" className="mt-3 text-base text-ink-soft">
          {carLine(s.engine, s.v2Failed, s.crystalHz, s.musicOnly)}
        </p>
        <TimeText phi={false} variant="car" />
        <div className="mt-8 flex items-center justify-center gap-6">
          <button
            type="button"
            aria-label="Previous track"
            onClick={actions.prev}
            className={`w-[88px] h-[88px] shrink-0 rounded-pill bg-surface-raised border border-line-strong flex items-center justify-center text-ink-strong ${FOCUS}`}
          >
            <SkipBack size={40} />
          </button>
          <button
            type="button"
            aria-label={p.isPlaying ? 'Pause' : 'Play'}
            data-testid="car-play"
            onClick={actions.playPause}
            className={`w-28 h-28 shrink-0 rounded-pill bg-gold-500 hover:bg-gold-400 flex items-center justify-center text-black transition-colors duration-fast ${FOCUS}`}
          >
            {p.isPlaying ? <Pause size={52} /> : <Play size={52} className="ml-2" />}
          </button>
          <button
            type="button"
            aria-label="Next track"
            onClick={actions.next}
            className={`w-[88px] h-[88px] shrink-0 rounded-pill bg-surface-raised border border-line-strong flex items-center justify-center text-ink-strong ${FOCUS}`}
          >
            <SkipForward size={40} />
          </button>
        </div>
        <p className="mt-8 text-center text-base text-ink-muted">While driving, use your car&#39;s own controls.</p>
        <button
          type="button"
          onClick={actions.stopAll}
          className={`mt-auto mb-5 shrink-0 h-14 rounded-card border border-status-error/60 bg-surface-panel text-base font-semibold text-ink-strong flex items-center justify-center gap-2 ${FOCUS}`}
        >
          <OctagonX size={22} className="stroke-status-error" aria-hidden="true" />
          Stop all sound
        </button>
      </div>
    </div>
  );
};

export default React.memo(CarNowPlaying);
