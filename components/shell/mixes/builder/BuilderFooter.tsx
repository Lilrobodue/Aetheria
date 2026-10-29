// components/shell/mixes/builder/BuilderFooter.tsx (v16.3, Create a mix; mockups builder-A-*, builder-desktop)
//
// The builder's footer, always in view (above the mini-player on the phone; the panel's foot on the desktop): line 1 the
// live count and length ("62 tracks · 4 h 19 min", "26 of 27 positions · about 7 h 17 min"; polite live), line 2 "Same as
// Grounding in Mixes" or the mix's name, line 3 (only when needed, faint) the crystals with no track and the tracks left
// out for want of a crystal, with "Assign crystals in Library ›". Then Play (the one gold control), Play next and ⋯ (Add
// to queue, Save as a playlist…). At 0 tracks Play and Play next are off and say why. From the queue: Play only ("Your
// queue becomes this mix"), and ⋯ for Save. React.memo; numbers, strings and stable callbacks as props. Never the time.
// v16.3 review: from the queue, a line under it when the mix leaves queued tracks out (they leave the queue at Play).
// v16.3 re-review: both lines follow builderViewModel's QUEUE_UNPICKED: with 'keep' and tracks left out, the left-out
// line is the only one ("Your queue becomes this mix." would not be true).

import React from 'react';
import { Ellipsis, ListStart, Play } from 'lucide-react';
import { countRender } from '../../devRenders';
import { ASSIGN_LINK, MORE_NAME, PLAY, PLAY_NEXT, footerCountParts, footerNameLine, footerWarnLine, queuePlayLine } from './builderViewModel';

interface BuilderFooterProps {
  count: number;
  positions: number | null;
  seconds: number;
  approx: boolean;
  missing: readonly number[];
  noCrystal: number;
  namedAs: string | null;
  name: string;
  /** Built from the queue: Play only. */
  fromQueue: boolean;
  /** v16.3 review: from the queue, the queued tracks the mix leaves out ("7 of your queued tracks aren't in this mix:
   *  they leave the queue."; builderViewModel queueLeftLine), or null when it holds them all. */
  queueLeft?: string | null;
  /** What the footer says at 0 tracks (EMPTY_TEXT; an empty queue says so). */
  emptyText: string;
  onPlay: () => void;
  onNext: () => void;
  onMore: (opener: HTMLElement) => void;
  onAssign: () => void;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const BuilderFooter = (p: BuilderFooterProps) => {
  countRender('BuilderFooter');
  const parts = footerCountParts(p);
  const warn = footerWarnLine(p);
  const empty = p.count === 0;
  const queueLine = p.fromQueue && !empty ? queuePlayLine(p.queueLeft ?? null) : null;
  return (
    <div data-testid="builder-footer" className="px-4 pt-3 pb-3">
      <p data-testid="builder-count" aria-live="polite" className="text-sm tabular-nums text-ink-strong">
        <span className="font-semibold">{parts.head}</span>
        {parts.rest}
      </p>
      <p data-testid="builder-name" className="text-xs text-ink-muted truncate">
        {empty ? p.emptyText : footerNameLine(p)}
      </p>
      {warn || p.noCrystal > 0 ? (
        <div className="flex items-center gap-2">
          <p data-testid="builder-warn" className="flex-1 min-w-0 text-xs text-ink-faint truncate">
            {warn}
          </p>
          {p.noCrystal > 0 ? (
            <button
              type="button"
              data-testid="builder-assign"
              onClick={p.onAssign}
              className={`shrink-0 min-h-touch text-xs text-ink-muted underline underline-offset-2 hover:text-ink-strong transition-colors duration-fast ${FOCUS}`}
            >
              {ASSIGN_LINK}
            </button>
          ) : null}
        </div>
      ) : null}
      {queueLine ? (
        <p data-testid="builder-queue-line" className="text-xs text-ink-faint">
          {queueLine}
        </p>
      ) : null}
      {p.fromQueue && !empty && p.queueLeft ? (
        <p data-testid="builder-queue-left" className="text-xs text-ink-muted">
          {p.queueLeft}
        </p>
      ) : null}
      <div className={p.fromQueue ? 'mt-2 grid grid-cols-[1fr_auto] gap-2' : 'mt-2 grid grid-cols-[1fr_1fr_auto] gap-2'}>
        <button
          type="button"
          data-testid="builder-play"
          aria-disabled={empty ? 'true' : undefined}
          aria-describedby={empty ? 'builder-empty-reason' : undefined}
          onClick={empty ? undefined : p.onPlay}
          className={
            empty
              ? `min-w-0 h-touch px-3 rounded-control bg-surface-control text-ink-faint text-sm font-semibold flex items-center justify-center gap-2 cursor-not-allowed ${FOCUS}`
              : `min-w-0 h-touch px-3 rounded-control bg-gold-500 text-black text-sm font-semibold flex items-center justify-center gap-2 hover:bg-gold-400 transition-colors duration-fast ${FOCUS}`
          }
        >
          <Play size={18} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{PLAY}</span>
        </button>
        {p.fromQueue ? null : (
          <button
            type="button"
            data-testid="builder-play-next"
            aria-disabled={empty ? 'true' : undefined}
            aria-describedby={empty ? 'builder-empty-reason' : undefined}
            onClick={empty ? undefined : p.onNext}
            className={
              empty
                ? `min-w-0 h-touch px-3 rounded-control border border-line bg-surface-panel text-sm text-ink-faint flex items-center justify-center gap-2 cursor-not-allowed ${FOCUS}`
                : `min-w-0 h-touch px-3 rounded-control border border-line-strong bg-surface-raised text-sm text-ink flex items-center justify-center gap-2 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`
            }
          >
            <ListStart size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="truncate">{PLAY_NEXT}</span>
          </button>
        )}
        <button
          type="button"
          data-testid="builder-more"
          aria-label={MORE_NAME}
          title={MORE_NAME}
          aria-haspopup="dialog"
          aria-disabled={empty ? 'true' : undefined}
          aria-describedby={empty ? 'builder-empty-reason' : undefined}
          onClick={empty ? undefined : (e: { currentTarget: HTMLButtonElement }) => p.onMore(e.currentTarget)}
          className={
            empty
              ? `w-touch h-touch rounded-control border border-line bg-surface-panel text-ink-faint flex items-center justify-center cursor-not-allowed ${FOCUS}`
              : `w-touch h-touch rounded-control border border-line-strong bg-surface-raised text-ink-soft flex items-center justify-center hover:border-ink-faint transition-colors duration-fast ${FOCUS}`
          }
        >
          <Ellipsis size={18} aria-hidden="true" />
        </button>
      </div>
      {empty ? (
        <span id="builder-empty-reason" className="sr-only">
          {p.emptyText}
        </span>
      ) : null}
    </div>
  );
};

export default React.memo(BuilderFooter);
