// components/shell/library/LibraryRow.tsx (v15.7, the Library tab; decision 3, option A)
//
// One 64 px row of the virtualized list (mockups library-phone-A-top, -A-mid): a 40 px tile with the crystal's regime
// dot (a hollow ring without one), the title, and one line of facts ("3:15 · 528 Hz · A minor"), then a 44 × 44 ⋯.
// The current track's row: aria-current, a raised background, a still icon in the tile (AudioLines while it plays, Pause
// while paused; no animation, I13) and "Playing · " or "Paused · " before its facts; no gold. The row is absolutely placed at `index × 64` px in the list's tall container.
// The whole row is one button (a tap plays the library from it); the ⋯ opens the row menu. Only the active row's button
// is in the tab order (the list's roving tab stop); the ⋯ is reached with →. `mark` is v14.18's slot ("Next · 2"),
// empty in v15.7. React.memo: it renders when its own props change, never on the clock.

import React from 'react';
import type { ReactNode } from 'react';
import { AudioLines, EllipsisVertical, Pause } from 'lucide-react';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { REGIME_DOT } from '../shellModel';
import { rowFacts, rowRegime } from './libraryModel';

export const ROW_PX = 64;

interface LibraryRowProps {
  song: Song;
  /** 0-based position in the list as shown. */
  index: number;
  size: number;
  /** The current track's row (aria-current), and whether it plays now. */
  current: boolean;
  paused: boolean;
  /** The list's roving tab stop. */
  active: boolean;
  onPlay: (id: string) => void;
  onMenu: (id: string, opener: HTMLElement) => void;
  onFocusRow: (index: number) => void;
  mark?: ReactNode;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400';

const LibraryRow = ({ song, index, size, current, paused, active, onPlay, onMenu, onFocusRow, mark }: LibraryRowProps) => {
  countRender('LibraryRow');
  const regime = rowRegime(song);
  return (
    <div
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={size}
      data-testid="library-row"
      data-row-id={song.id}
      className={
        current
          ? 'absolute inset-x-0 h-row flex items-center border-b border-line bg-surface-raised/60'
          : 'absolute inset-x-0 h-row flex items-center border-b border-line'
      }
      style={{ top: index * ROW_PX }}
    >
      <button
        type="button"
        data-row-index={index}
        tabIndex={active ? 0 : -1}
        aria-current={current ? 'true' : undefined}
        onClick={() => onPlay(song.id)}
        onFocus={() => onFocusRow(index)}
        className={`flex-1 min-w-0 h-full pl-4 flex items-center gap-3 text-left hover:bg-surface-raised/40 transition-colors duration-fast ${FOCUS}`}
      >
        <span
          aria-hidden="true"
          className={
            current
              ? 'shrink-0 w-10 h-10 rounded-control bg-surface-control flex items-center justify-center'
              : 'shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center'
          }
        >
          {current && !paused ? (
            <AudioLines size={18} className="text-ink-strong" />
          ) : current ? (
            <Pause size={18} className="text-ink-strong" />
          ) : regime ? (
            <span className={`w-3 h-3 rounded-pill ${REGIME_DOT[regime]}`} />
          ) : (
            <span className="w-3 h-3 rounded-pill border border-ink-faint" />
          )}
        </span>
        <span className="min-w-0">
          <span data-row-title="" className={current ? 'block text-sm font-semibold text-ink-strong truncate' : 'block text-sm text-ink-strong truncate'}>{song.name}</span>
          <span data-row-facts="" className={current ? 'block text-xs text-ink-soft truncate tabular-nums' : 'block text-xs text-ink-muted truncate tabular-nums'}>
            {rowFacts(song, current ? (paused ? 'paused' : 'playing') : null)}
          </span>
        </span>
      </button>
      {mark ?? null}
      <button
        type="button"
        tabIndex={-1}
        data-row-menu={index}
        aria-label={`Options for ${song.name}`}
        title={`Options for ${song.name}`}
        aria-haspopup="dialog"
        onClick={(e: { currentTarget: HTMLElement }) => onMenu(song.id, e.currentTarget)}
        onFocus={() => onFocusRow(index)}
        className={`shrink-0 mr-1 w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong transition-colors duration-fast ${FOCUS}`}
      >
        <EllipsisVertical size={18} />
      </button>
    </div>
  );
};

export default React.memo(LibraryRow);
