// components/shell/DesktopTransport.tsx (v15.5, the new layout beta)
//
// The desktop shell's 88 px transport (mockup desktop-shell; v16.8.7: 120 px with the song row, below), in three
// columns: the crystal tile (it opens the Crystal
// panel), the title and the chips (24 px, one line, clipped: display only); shuffle, previous, Play 48, next, repeat
// over the seek bar with its φ ticks and both times; Output, Walks, the master volume and ⋯. The desktop has no Car
// screen: its layers chip says "Layers v2 · Car (tone only)". v15.6: the Zen button sits left of ⋯ (decision 1, option A).
// v16.0 (mockup queue-desktop): a compact Up next button after Walks (the list icon and the queue's count; 44 px, so
// every target stays 44 × 44 at 1280 px), which opens and closes the queue in the panel.
// v16.7 (desktop polish): it fits from 1024 px (spec §3.3, a measured defect: below about 1,100 px ⋯ went off screen
// and the title had no room). Below 1280 Output and Walks are 44 × 44 icon buttons (their names kept, their text from
// `xl`) and the volume is 64 px; below 1536 the centre is 400 px (520 from `2xl`). The Full screen button sits between
// Zen and ⋯ (decision 4 A). The kit's Tooltip names each control, with its key (decision 5 A); Up next drops its native
// title and Zen its own (kitTooltip), so no control shows two.
// v16.7 review: the centre 360 px below 1280 and the right group's gaps 6 px there, with a compact REC, keep the title
// column at 100 px or more while recording at 1024; Output's and Walks' bubbles only below 1280 (their words show from
// there: decision 9); Music only is the first chip; the seek row fits the bar (decision 8).
// v16.8.3 fix round 1 (SF5): the tuning chip ("Tuned −14 c") follows Music only, before the crystal chip, so it shows.
// v16.8.7 (the song row; the user's decisions C and C1, 2026-11-13): the bar is 120 px, a 32 px song row over the 88 px
// controls row. The song row holds the title and every chip, centred over Play; the chips never shrink, so each shows in
// full from 1024 px (in the title column they had 118 px at 1024 and 198 at 1280: the Layers chip was cut and the beat
// and Key fit chips never showed), and the title truncates first. The controls row keeps its three columns: the crystal
// tile with Output, Walks and Up next on the left; the centre as before; REC, the volume, Zen, Full screen and ⋯ on the
// right. Music only always shows its words (the icon-only form while recording saved room the title column no longer needs).

import React from 'react';
import { Ellipsis, ListVideo, Music2, Pause, Play, Repeat, Route, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, Waves } from 'lucide-react';
import Tooltip from '../ui/Tooltip';
import { useActions, useLevels, usePlayer, useQueue, useShell, useSound } from './contexts';
import { upNextButtonName } from './queue/queueViewModel';
import { countRender } from './devRenders';
import SeekBar from './SeekBar';
import { outputIcon } from './outputIcon';
import RecButton from './RecButton';
import ZenButton from './ZenButton';
import FullscreenButton from './shortcuts/FullscreenButton';
import { tipKeys } from './shortcuts/keysModel';
import { useKeysOn } from './shortcuts/shortcutsStore';
import { zenButtonTitleDesktop } from './zenModel';
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
        className="w-16 xl:w-24 h-touch accent-ink-soft cursor-pointer"
      />
    </div>
  );
});

const DesktopTransport = () => {
  countRender('DesktopTransport');
  const p = usePlayer();
  const s = useSound();
  const actions = useActions();
  const { barRef, sheet, zen } = useShell();
  const keys = useKeysOn();
  const queue = useQueue();
  const queueOpen = sheet === 'queue';
  const regime = regimeOf(s.crystalHz);
  return (
    <footer
      ref={barRef}
      aria-label="Player"
      data-testid="desktop-transport"
      className="absolute bottom-0 inset-x-0 h-transport bg-surface-deep border-t border-line flex flex-col pointer-events-auto"
    >
      {/* v16.8.7 (the song row, decision C): the title and every chip on a 32 px row of their own, centred over Play.
          The chips never shrink (flex-none), so each shows in full from a 1024 px window (about 650 px at most, with
          Music only and a tuning on); the title takes what is left and truncates first. Display only, as before. */}
      {/* Review round 1: `safe center`, so a row too wide for the window (a very large browser font) clips its far end,
          never Music only at its start; centred in its 32 px (not on its foot), so the chips keep 4 px clear of Play. Round 2:
          plain justify-center first, as the fallback where `safe` isn't understood (the arbitrary property comes later). */}
      <div data-testid="desktop-song-row" className="h-8 shrink-0 px-5 flex items-center justify-center [justify-content:safe_center] gap-3 overflow-hidden">
        <div data-testid="desktop-title" className="min-w-0 flex-[0_1_auto] text-sm font-semibold text-ink-strong truncate">
          {p.hasTrack ? p.title : 'Nothing playing'}
        </div>
        <span aria-hidden="true" className="shrink-0 w-px h-3.5 bg-line-strong" />
        <div data-testid="desktop-chips" className="flex-none flex items-center gap-1.5 text-xs text-ink-muted whitespace-nowrap">
          {/* v16.7 review: Music only first (M changes it with no control in view). v16.8.7: always with its words; the
              icon-only form while recording below 1280 px saved room in the old title column, which no longer holds chips. */}
          {s.musicOnly ? (
            <span className={CHIP} data-testid="desktop-music-only-chip">
              <VolumeX size={12} aria-hidden="true" />
              Music only
            </span>
          ) : null}
          {/* v16.8.3 (T4): the playing track's tuning while it is tuned (display only, as this row is), after Music only,
              before the crystal chip. */}
          {s.tuneChip ? (
            <span className={CHIP} data-testid="desktop-tuning-chip">
              {s.tuneChip}
            </span>
          ) : null}
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
        </div>
      </div>

      {/* The controls row: the 87 px under the song row (as the whole bar's inside was), its three columns as before. */}
      <div data-testid="desktop-controls" className="flex-1 min-h-0 grid grid-cols-[1fr_auto_1fr] items-center gap-6 px-5">
      {/* v16.8.7 (C1): the crystal tile, then Output, Walks and Up next (from the right group), so both sides fit their
          1fr tracks from 1024 px and Play sits at the bar's centre (the right group's width had pushed it left). */}
      {/* v16.8.8 (the user, 2026-11-13: "center the matter on the ends in the middle"): both end groups sit at the bar's
          vertical middle (centre 60 px down the 120 px bar), not the controls row's (76): -translate-y-4, 16 px up. A
          transform, so the columns' widths and Play's centring are untouched; the groups stay below the song row (their
          tops at about 37 px, the row ends at 33). */}
      <div className="min-w-0 flex items-center gap-3 -translate-y-4">
        <Tooltip label={`Crystal ${s.crystalHz} Hz, ${regimeName(regime)}`} side="top-start">
          <button
            type="button"
            aria-label={`Crystal ${s.crystalHz} Hz, ${regimeName(regime)}`}
            data-testid="desktop-crystal"
            onClick={() => actions.openSheet('crystal')}
            className={`shrink-0 w-12 h-12 rounded-control bg-surface-raised flex items-center justify-center hover:bg-surface-control transition-colors duration-fast ${FOCUS}`}
          >
            <span aria-hidden="true" className={`w-3 h-3 rounded-pill ${REGIME_DOT[regime]}`} />
          </button>
        </Tooltip>
        <div data-testid="desktop-left-group" className="flex items-center gap-1.5 xl:gap-2">
          <Tooltip label="Output" hideFrom="xl">
            <button
              type="button"
              aria-label="Output"
              data-testid="desktop-output"
              onClick={() => actions.openSheet('sound', 'output')}
              className={`h-touch min-w-touch justify-center xl:px-3 rounded-control border border-line-strong text-sm text-ink flex items-center gap-2 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
            >
              {outputIcon(s, 16, 'text-ink-muted')}
              <span className="hidden xl:inline">Output</span>
            </button>
          </Tooltip>
          <Tooltip label="Walks" hideFrom="xl">
            <button
              type="button"
              aria-label="Walks"
              data-testid="desktop-walks"
              onClick={() => actions.openSheet('walks')}
              className={`h-touch min-w-touch justify-center xl:px-3 rounded-control border border-line-strong text-sm text-ink flex items-center gap-2 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
            >
              <Route size={16} className="text-ink-muted" aria-hidden="true" />
              <span className="hidden xl:inline">Walks</span>
            </button>
          </Tooltip>
          <Tooltip label="Up next" keys={keys ? tipKeys('queue') : null}>
            <button
              type="button"
              data-testid="desktop-queue"
              aria-label={upNextButtonName(queue.waiting)}
              aria-expanded={queueOpen}
              onClick={actions.toggleQueue}
              className={
                queueOpen
                  ? `h-touch min-w-touch px-2.5 rounded-control border border-ink-muted bg-surface-raised text-sm text-ink-strong flex items-center justify-center gap-1.5 ${FOCUS}`
                  : `h-touch min-w-touch px-2.5 rounded-control border border-line-strong text-sm text-ink flex items-center justify-center gap-1.5 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`
              }
            >
              <ListVideo size={18} className="text-ink-soft" aria-hidden="true" />
              {queue.waiting > 0 ? <span className="text-xs text-ink-soft tabular-nums">{queue.waiting}</span> : null}
            </button>
          </Tooltip>
          {/* Review round 1 (the user's choice, 2026-11-13): REC, while recording, after Up next. First on the right it
              made that side 298 px at 1024 (a 288 px track), so Play sat 10 px left of centre while recording. */}
          <RecButton compact />
        </div>
      </div>

      {/* v16.7 review: the centre is 360 px below 1280 (room for the title while recording at 1024; v16.8.7: the title has
          its own row, and the widths stay so both sides fit their tracks from 1024 px), 400 below 1536,
          520 from there. The buttons' row (48 px, for Play) overlaps the seek bar's 44 px row by 5 px, so the whole
          seek row fits the 87 px bar (it hung 5 px past the screen's foot since v15.5): the row sits above it (z) but
          lets pointers through except on its buttons, so a press there is the button's and anywhere else the seek bar's. */}
      <div className="w-[360px] xl:w-[400px] 2xl:w-[520px] flex flex-col items-center">
        <div data-testid="desktop-buttons" className="relative z-[1] -mb-[5px] flex items-center gap-3 pointer-events-none">
          <Tooltip label="Shuffle" wrapClassName="relative inline-flex shrink-0 pointer-events-auto">
            <button
              type="button"
              aria-label="Shuffle"
              aria-pressed={p.shuffle}
              onClick={actions.toggleShuffle}
              className={`w-touch h-touch flex items-center justify-center rounded-control ${p.shuffle ? 'text-gold-400' : 'text-ink-muted hover:text-ink-strong'} ${FOCUS}`}
            >
              <Shuffle size={18} />
            </button>
          </Tooltip>
          <Tooltip label="Previous track" keys={keys ? tipKeys('prev') : null} wrapClassName="relative inline-flex shrink-0 pointer-events-auto">
            <button type="button" aria-label="Previous track" onClick={actions.prev} className={`w-touch h-touch flex items-center justify-center rounded-control text-ink-strong ${FOCUS}`}>
              <SkipBack size={22} />
            </button>
          </Tooltip>
          <Tooltip label={p.isPlaying ? 'Pause' : 'Play'} keys={keys ? tipKeys('playPause') : null} wrapClassName="relative inline-flex shrink-0 pointer-events-auto">
            <button
              type="button"
              aria-label={p.isPlaying ? 'Pause' : 'Play'}
              data-testid="desktop-play"
              onClick={actions.playPause}
              className={`w-12 h-12 rounded-pill bg-gold-500 hover:bg-gold-400 text-black flex items-center justify-center shadow-raised transition-colors duration-fast ${FOCUS}`}
            >
              {p.isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
            </button>
          </Tooltip>
          <Tooltip label="Next track" keys={keys ? tipKeys('next') : null} wrapClassName="relative inline-flex shrink-0 pointer-events-auto">
            <button type="button" aria-label="Next track" onClick={actions.next} className={`w-touch h-touch flex items-center justify-center rounded-control text-ink-strong ${FOCUS}`}>
              <SkipForward size={22} />
            </button>
          </Tooltip>
          <Tooltip label="Repeat" wrapClassName="relative inline-flex shrink-0 pointer-events-auto">
            <button
              type="button"
              aria-label="Repeat"
              aria-pressed={p.loop}
              onClick={actions.toggleRepeat}
              className={`w-touch h-touch flex items-center justify-center rounded-control ${p.loop ? 'text-gold-400' : 'text-ink-muted hover:text-ink-strong'} ${FOCUS}`}
            >
              <Repeat size={18} />
            </button>
          </Tooltip>
        </div>
        {/* v16.7 review 4: the seek bar's keyboard-focus ring, drawn above the buttons' row (which overlaps the bar's top
            5 px): a non-interactive layer (its ::after, pointer-events-none), shown only while the bar has keyboard focus,
            so Play's disc never hides the ring and a press on Play's foot is always Play's. */}
        <div className="w-full [&_[role=slider]:focus-visible]:after:absolute [&_[role=slider]:focus-visible]:after:inset-0 [&_[role=slider]:focus-visible]:after:z-[2] [&_[role=slider]:focus-visible]:after:rounded-control [&_[role=slider]:focus-visible]:after:pointer-events-none [&_[role=slider]:focus-visible]:after:outline [&_[role=slider]:focus-visible]:after:outline-2 [&_[role=slider]:focus-visible]:after:outline-gold-400">
          <SeekBar phi={s.phi} variant="desktop" />
        </div>
      </div>

      {/* v16.8.7 (C1): the volume, Zen, Full screen and ⋯; Output, Walks, Up next and REC are on the left. */}
      <div data-testid="desktop-right-group" className="flex items-center justify-end gap-1.5 xl:gap-2 -translate-y-4">
        <DesktopVolume />
        <Tooltip label={zenButtonTitleDesktop(zen.on)} side="top-end">
          <ZenButton data-testid="zen-button-desktop" kitTooltip />
        </Tooltip>
        <FullscreenButton />
        <Tooltip label="More options" side="top-end">
          <button
            type="button"
            aria-label="More options"
            aria-haspopup="dialog"
            onClick={() => actions.openSheet('menu')}
            className={`w-touch h-touch flex items-center justify-center rounded-control text-ink-soft hover:text-ink-strong ${FOCUS}`}
          >
            <Ellipsis size={20} />
          </button>
        </Tooltip>
      </div>
      </div>
    </footer>
  );
};

export default React.memo(DesktopTransport);
