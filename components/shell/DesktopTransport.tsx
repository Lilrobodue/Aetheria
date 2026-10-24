// components/shell/DesktopTransport.tsx (v15.5, the new layout beta)
//
// The desktop shell's 88 px transport (mockup desktop-shell), in three columns: the crystal tile (it opens the Crystal
// panel), the title and the chips (24 px, one line, clipped: display only); shuffle, previous, Play 48, next, repeat
// over the seek bar with its φ ticks and both times; Output, Walks, the master volume and ⋯. The desktop has no Car
// screen: its layers chip says "Layers v2 · Car (tone only)".

import React from 'react';
import { Ellipsis, Music2, Pause, Play, Repeat, Route, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, Waves } from 'lucide-react';
import { useActions, useLevels, usePlayer, useShell, useSound } from './contexts';
import { countRender } from './devRenders';
import SeekBar from './SeekBar';
import { outputIcon } from './outputIcon';
import RecButton from './RecButton';
import { REGIME_DOT, regimeName, regimeOf } from './shellModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const CHIP = 'inline-flex items-center gap-1 h-6 px-2 rounded-pill border border-line-strong';

/** The master volume: its own context reader, so a drag re-renders only this. */
const DesktopVolume = React.memo(() => {
  countRender('DesktopVolume');
  const { volume } = useLevels();
  const actions = useActions();
  return (
    <div className="flex items-center gap-2 pl-2">
      <Volume2 size={18} className="text-ink-muted" aria-hidden="true" />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        aria-label="Volume"
        aria-valuetext={`${Math.round(volume * 100)} %`}
        onChange={(e: { target: HTMLInputElement }) => actions.setVolume(parseFloat(e.target.value))}
        className="w-24 h-touch accent-ink-soft cursor-pointer"
      />
    </div>
  );
});

const DesktopTransport = () => {
  countRender('DesktopTransport');
  const p = usePlayer();
  const s = useSound();
  const actions = useActions();
  const { barRef } = useShell();
  const regime = regimeOf(s.crystalHz);
  return (
    <footer
      ref={barRef}
      aria-label="Player"
      data-testid="desktop-transport"
      className="absolute bottom-0 inset-x-0 h-transport bg-surface-deep border-t border-line grid grid-cols-[1fr_auto_1fr] items-center gap-6 px-5 pointer-events-auto"
    >
      <div className="min-w-0 flex items-center gap-3">
        <button
          type="button"
          aria-label={`Crystal ${s.crystalHz} Hz, ${regimeName(regime)}`}
          data-testid="desktop-crystal"
          onClick={() => actions.openSheet('crystal')}
          className={`shrink-0 w-12 h-12 rounded-control bg-surface-raised flex items-center justify-center hover:bg-surface-control transition-colors duration-fast ${FOCUS}`}
        >
          <span aria-hidden="true" className={`w-3 h-3 rounded-pill ${REGIME_DOT[regime]}`} />
        </button>
        <div className="min-w-0">
          <div data-testid="desktop-title" className="text-sm font-semibold text-ink-strong truncate">
            {p.hasTrack ? p.title : 'Nothing playing'}
          </div>
          <div data-testid="desktop-chips" className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted whitespace-nowrap overflow-hidden">
            <span className={CHIP}>
              <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-pill ${REGIME_DOT[regime]}`} />
              {s.crystalHz} Hz
            </span>
            {s.layersShown ? (
              <span className={CHIP} title={s.layersTip} data-testid="desktop-layers-chip">
                {outputIcon(s, 12)}
                {s.layersText}
              </span>
            ) : null}
            <span className={CHIP}>
              <Waves size={12} aria-hidden="true" />
              {s.beatText}
            </span>
            {s.keyFitShown ? (
              <span
                className={s.keyFitLook === 'duck' ? 'inline-flex items-center gap-1 h-6 px-2 rounded-pill border border-gold-500/40 text-gold-200' : CHIP}
                title={s.keyFitHint}
              >
                <Music2 size={12} aria-hidden="true" />
                {s.keyFitText}
              </span>
            ) : null}
            {s.musicOnly ? (
              <span className={CHIP}>
                <VolumeX size={12} aria-hidden="true" />
                Music only
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="w-[520px] flex flex-col items-center">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Shuffle"
            aria-pressed={p.shuffle}
            onClick={actions.toggleShuffle}
            className={`w-touch h-touch flex items-center justify-center rounded-control ${p.shuffle ? 'text-gold-400' : 'text-ink-muted hover:text-ink-strong'} ${FOCUS}`}
          >
            <Shuffle size={18} />
          </button>
          <button type="button" aria-label="Previous track" onClick={actions.prev} className={`w-touch h-touch flex items-center justify-center rounded-control text-ink-strong ${FOCUS}`}>
            <SkipBack size={22} />
          </button>
          <button
            type="button"
            aria-label={p.isPlaying ? 'Pause' : 'Play'}
            data-testid="desktop-play"
            onClick={actions.playPause}
            className={`w-12 h-12 rounded-pill bg-gold-500 hover:bg-gold-400 text-black flex items-center justify-center shadow-raised transition-colors duration-fast ${FOCUS}`}
          >
            {p.isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
          </button>
          <button type="button" aria-label="Next track" onClick={actions.next} className={`w-touch h-touch flex items-center justify-center rounded-control text-ink-strong ${FOCUS}`}>
            <SkipForward size={22} />
          </button>
          <button
            type="button"
            aria-label="Repeat"
            aria-pressed={p.loop}
            onClick={actions.toggleRepeat}
            className={`w-touch h-touch flex items-center justify-center rounded-control ${p.loop ? 'text-gold-400' : 'text-ink-muted hover:text-ink-strong'} ${FOCUS}`}
          >
            <Repeat size={18} />
          </button>
        </div>
        <SeekBar phi={s.phi} variant="desktop" />
      </div>

      <div className="flex items-center justify-end gap-2">
        <RecButton />
        <button
          type="button"
          data-testid="desktop-output"
          onClick={() => actions.openSheet('sound', 'output')}
          className={`h-touch px-3 rounded-control border border-line-strong text-sm text-ink flex items-center gap-2 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
        >
          {outputIcon(s, 16, 'text-ink-muted')}
          Output
        </button>
        <button
          type="button"
          data-testid="desktop-walks"
          onClick={() => actions.openSheet('walks')}
          className={`h-touch px-3 rounded-control border border-line-strong text-sm text-ink flex items-center gap-2 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
        >
          <Route size={16} className="text-ink-muted" aria-hidden="true" />
          Walks
        </button>
        <DesktopVolume />
        <button
          type="button"
          aria-label="More options"
          aria-haspopup="dialog"
          onClick={() => actions.openSheet('menu')}
          className={`w-touch h-touch flex items-center justify-center rounded-control text-ink-soft hover:text-ink-strong ${FOCUS}`}
        >
          <Ellipsis size={20} />
        </button>
      </div>
    </footer>
  );
};

export default React.memo(DesktopTransport);
