// components/shell/NowPlaying.tsx (v15.5, the new layout beta)
//
// Now Playing on the phone (mockup np-phone-A, look "Quiet", decision 1): the visualizer edge to edge, and at the
// bottom, on a deep gradient scrim (never a blur), the tone-only banner, the source line, the title, the chips, the
// seek bar, the transport (Play 72 px, gold) and Output · Walks. On a landscape phone (under 500 px tall) the top bar
// hides and this becomes two columns: what plays on the left, the controls on the right.
// React.memo with no props; it reads the player, sound and library contexts, never the time: the seek bar and the
// time text under it are the time readers, so the 4 Hz clock re-renders those two and nothing here.
// v16.0 (decision 1 A, mockup np-phone-A-upnext): the Up next line under the transport, above Output · Walks: the track
// that plays next and the queue's count; a tap opens the queue. Shown with a track loaded or a queue waiting. It reads
// the queue's context (never the clock).

import React from 'react';
import { ChevronRight, Ellipsis, ListVideo, Pause, Play, Repeat, Route, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import { useActions, useLibrarySummary, usePlayer, useQueue, useShell, useSound } from './contexts';
import { queuedCount, upNextName, upNextTitle } from './queue/queueViewModel';
import { countRender } from './devRenders';
import NowPlayingChips from './NowPlayingChips';
import SeekBar from './SeekBar';
import TimeText from './TimeText';
import ToneOnlyBanner from './ToneOnlyBanner';
import { outputIcon } from './outputIcon';
import { OUTPUT_LABELS } from '../layers/layerCopy';
import ZenButton from './ZenButton';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const NowPlaying = () => {
  countRender('NowPlaying');
  const p = usePlayer();
  const s = useSound();
  const lib = useLibrarySummary();
  const queue = useQueue();
  const actions = useActions();
  const { barRef } = useShell();
  const count = queuedCount(queue.waiting);

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-end">
      <section
        ref={barRef}
        aria-label="Now playing"
        data-testid="view-now"
        className="pointer-events-auto px-4 pt-20 pb-3 bg-gradient-to-t from-surface-deep from-60% via-surface-deep/80 to-transparent [@media(max-height:500px)]:pt-3 [@media(max-height:500px)]:grid [@media(max-height:500px)]:grid-cols-2 [@media(max-height:500px)]:gap-x-6 [@media(max-height:500px)]:items-end"
      >
        <div className="min-w-0">
          {p.toneOnly ? <ToneOnlyBanner /> : null}
          <div className="flex items-start justify-between gap-2">
            <p data-testid="np-source" className="min-w-0 text-label uppercase tracking-widest text-ink-muted">
              {p.source}
            </p>
            {/* The top bar hides on a landscape phone: its ⋯ moves here (v15.6: and the Zen button, beside it). */}
            <span className="hidden [@media(max-height:500px)]:flex -mt-3 -mr-2 shrink-0">
              <ZenButton data-testid="zen-button-landscape" />
              <button
                type="button"
                aria-label="More options"
                onClick={() => actions.openSheet('menu')}
                className={`w-touch h-touch flex items-center justify-center rounded-control text-ink-soft ${FOCUS}`}
              >
                <Ellipsis size={22} />
              </button>
            </span>
          </div>
          <h1
            tabIndex={-1}
            data-view-heading=""
            data-testid="np-title"
            className="mt-1 text-2xl font-semibold leading-tight text-ink-strong line-clamp-2 outline-none"
          >
            {p.hasTrack ? p.title : 'Nothing playing'}
          </h1>
          {!p.hasTrack && !p.toneOnly ? (
            <div className="mt-3">
              {lib.count === 0 ? (
                <EmptyState
                  data-testid="np-empty"
                  title="Your library is empty"
                  body="Import music from this device. Aetheria keeps its own copy here; your files are not changed."
                  actionLabel="Import music"
                  onAction={() => actions.openImport()}
                />
              ) : (
                <EmptyState data-testid="np-empty" title="Ready when you are" body="Play starts your play order from the top; Walks starts a Lo Shu walk." />
              )}
            </div>
          ) : null}
          <NowPlayingChips />
        </div>

        <div className="min-w-0">
          <div className="mt-2">
            <SeekBar phi={s.phi} />
            <TimeText phi={s.phi} />
          </div>

          <div className="mt-1 flex items-center justify-between px-1">
            <button
              type="button"
              aria-label="Shuffle"
              aria-pressed={p.shuffle}
              onClick={actions.toggleShuffle}
              className={`w-touch h-touch flex items-center justify-center rounded-control ${p.shuffle ? 'text-gold-400' : 'text-ink-muted hover:text-ink-strong'} ${FOCUS}`}
            >
              <Shuffle size={20} />
            </button>
            <button
              type="button"
              aria-label="Previous track"
              onClick={actions.prev}
              className={`w-14 h-14 flex items-center justify-center rounded-pill text-ink-strong ${FOCUS}`}
            >
              <SkipBack size={28} />
            </button>
            <button
              type="button"
              aria-label={p.isPlaying ? 'Pause' : 'Play'}
              data-testid="np-play"
              onClick={actions.playPause}
              className={`w-[72px] h-[72px] rounded-pill flex items-center justify-center bg-gold-500 hover:bg-gold-400 text-black shadow-raised transition-colors duration-fast ${FOCUS}`}
            >
              {p.isPlaying ? <Pause size={32} /> : <Play size={32} className="ml-1" />}
            </button>
            <button
              type="button"
              aria-label="Next track"
              onClick={actions.next}
              className={`w-14 h-14 flex items-center justify-center rounded-pill text-ink-strong ${FOCUS}`}
            >
              <SkipForward size={28} />
            </button>
            <button
              type="button"
              aria-label="Repeat"
              aria-pressed={p.loop}
              onClick={actions.toggleRepeat}
              className={`w-touch h-touch flex items-center justify-center rounded-control ${p.loop ? 'text-gold-400' : 'text-ink-muted hover:text-ink-strong'} ${FOCUS}`}
            >
              <Repeat size={20} />
            </button>
          </div>

          {p.hasTrack || queue.waiting > 0 ? (
            <button
              type="button"
              data-testid="np-upnext"
              aria-label={upNextName(queue.nextTitle, queue.waiting, queue.shuffle)}
              aria-haspopup="dialog"
              onClick={() => actions.openSheet('queue')}
              className={`mt-2 w-full min-h-touch px-3 rounded-control border border-line-strong bg-surface-raised/80 flex items-center gap-2 text-left hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
            >
              <ListVideo size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="shrink-0 text-xs uppercase tracking-widest text-ink-muted">Up next</span>
              <span data-testid="np-upnext-title" className={queue.nextTitle ? 'flex-1 min-w-0 text-sm text-ink-strong truncate' : 'flex-1 min-w-0 text-sm text-ink-muted truncate'}>
                {upNextTitle(queue.nextTitle, queue.shuffle)}
              </span>
              {count ? <span className="shrink-0 text-xs text-ink-muted tabular-nums">{count}</span> : null}
              <ChevronRight size={18} className="shrink-0 text-ink-faint" aria-hidden="true" />
            </button>
          ) : null}

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="np-output"
              onClick={() => actions.openSheet('sound', 'output')}
              className={`min-w-0 h-touch px-2 rounded-control border flex items-center justify-center gap-2 text-sm bg-surface-raised/80 border-line-strong text-ink hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
            >
              {outputIcon(s, 18, 'shrink-0 text-ink-muted')}
              <span className="truncate">Output · {OUTPUT_LABELS[s.outputEffective]}</span>
            </button>
            <button
              type="button"
              data-testid="np-walks"
              onClick={() => actions.openSheet('walks')}
              className={`min-w-0 h-touch px-2 rounded-control border flex items-center justify-center gap-2 text-sm bg-surface-raised/80 border-line-strong text-ink hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
            >
              <Route size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="truncate">Walks</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default React.memo(NowPlaying);
