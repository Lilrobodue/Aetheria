// components/shell/library/ActiveChips.tsx (v16.2, smart filters; mockups tracks-filtered-phone, filter-empty-phone,
// filters-desktop)
//
// The top of the Tracks list while filters are on (the `library-filter-bar` region), scrolling with the list:
//   1. "10 of 440 tracks · 25 min" (M is the library's size, always) and Clear filters, on one line. The count is the
//      search field's description, as the plain summary is.
//   2. The picks as removable chips (a whole regime is one chip, "GUT"), wrapping; each is named "Remove 528 Hz".
//      Removing one moves the focus to the next chip, or to the previous one, or to the Filters button when none is
//      left (the bar goes with the last one, so the focus moves first; Clear filters does the same).
//   3. What a row's tap plays (decision 1 A), quiet.
//   4. Play these (the tab's one gold control), Shuffle and ⋯ (the actions sheet), each 44 px.
// With nothing shown, 3 and 4 give way to the empty card (the Tracks view's). React.memo; strings, numbers and stable
// callbacks as props; nothing here reads the time.

import React, { useLayoutEffect, useRef } from 'react';
import { Ellipsis, Play, Shuffle, X } from 'lucide-react';
import { countRender } from '../devRenders';
import { filterSummaryParts, moreButtonName, removeChipName, rowTapHint } from './filterViewModel';
import type { ActiveChip } from '../../../utils/library/filterModel';

interface ActiveChipsProps {
  /** The count's id: the search field's aria-describedby. */
  summaryId: string;
  shown: number;
  total: number;
  seconds: number;
  chips: readonly ActiveChip[];
  onRemove: (facet: string, value: string) => void;
  onClear: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onMore: (opener: HTMLElement) => void;
  /** Where the focus goes when the last chip is removed. */
  filtersButtonRef: { current: HTMLButtonElement | null };
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const ActiveChips = ({ summaryId, shown, total, seconds, chips, onRemove, onClear, onPlay, onShuffle, onMore, filtersButtonRef }: ActiveChipsProps) => {
  countRender('ActiveChips');
  const listRef: { current: HTMLDivElement | null } = useRef(null);
  // The chip to focus after a removal (its index among the chips as they are next), or -1 for the Filters button.
  const focusNextRef: { current: number | null } = useRef(null);
  useLayoutEffect(() => {
    const at = focusNextRef.current;
    if (at === null) return;
    focusNextRef.current = null;
    const buttons = listRef.current ? Array.from(listRef.current.querySelectorAll<HTMLButtonElement>('button')) : [];
    if (at >= 0 && buttons.length) buttons[Math.min(at, buttons.length - 1)].focus();
    else filtersButtonRef.current?.focus();
  }, [chips]);
  const parts = filterSummaryParts(shown, total, seconds);
  return (
    <div data-testid="library-filter-bar">
      <div className="px-4 pt-3 flex items-center justify-between gap-2">
        <p id={summaryId} data-testid="library-filter-count" aria-live="polite" className="text-sm text-ink-soft tabular-nums">
          <span className="font-semibold text-ink-strong">{parts.count}</span>
          {parts.rest}
        </p>
        <button
          type="button"
          data-testid="library-clear-filters"
          onClick={() => {
            filtersButtonRef.current?.focus(); // this bar goes with the picks
            onClear();
          }}
          className={`-mr-2 shrink-0 min-h-touch px-2 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong ${FOCUS}`}
        >
          Clear filters
        </button>
      </div>
      <div ref={listRef} data-testid="library-active-chips" className="px-4 pt-1 pb-1 flex flex-wrap gap-x-2 gap-y-3">
        {chips.map((c, i) => (
          <button
            key={`${c.facet}:${c.value}`}
            type="button"
            aria-label={removeChipName(c.label)}
            onClick={() => {
              if (chips.length > 1) focusNextRef.current = i < chips.length - 1 ? i : i - 1;
              else filtersButtonRef.current?.focus(); // the last one: this bar goes with it
              onRemove(c.facet, c.value);
            }}
            className={`relative inline-flex items-center gap-1 h-8 pl-3 pr-2 rounded-pill whitespace-nowrap border border-line-strong bg-surface-raised text-xs text-ink-strong after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
          >
            {c.label}
            <X size={14} className="text-ink-muted" aria-hidden="true" />
          </button>
        ))}
      </div>
      {shown > 0 ? (
        <>
          <p data-testid="library-filter-hint" className="px-4 pt-2 text-xs text-ink-faint">
            {rowTapHint(shown)}
          </p>
          <div data-testid="library-filter-actions-row" className="px-4 pt-3 pb-3 grid grid-cols-[1fr_1fr_auto] gap-2">
            <button
              type="button"
              data-testid="library-play-these"
              onClick={onPlay}
              className={`min-w-0 h-touch px-3 rounded-control bg-gold-500 text-black text-sm font-semibold flex items-center justify-center gap-2 hover:bg-gold-400 transition-colors duration-fast ${FOCUS}`}
            >
              <Play size={18} className="shrink-0" aria-hidden="true" />
              <span className="truncate">Play these</span>
            </button>
            <button
              type="button"
              data-testid="library-shuffle-these"
              onClick={onShuffle}
              className={`min-w-0 h-touch px-3 rounded-control border border-line-strong bg-surface-raised text-sm text-ink flex items-center justify-center gap-2 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
            >
              <Shuffle size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="truncate">Shuffle</span>
            </button>
            <button
              type="button"
              aria-label={moreButtonName(shown)}
              aria-haspopup="dialog"
              title={moreButtonName(shown)}
              data-testid="library-filter-more"
              onClick={(e: { currentTarget: HTMLButtonElement }) => onMore(e.currentTarget)}
              className={`w-touch h-touch rounded-control border border-line-strong bg-surface-raised text-ink-soft flex items-center justify-center hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
            >
              <Ellipsis size={18} aria-hidden="true" />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default React.memo(ActiveChips);
