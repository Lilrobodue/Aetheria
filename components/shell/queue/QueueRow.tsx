// components/shell/queue/QueueRow.tsx (v16.0, the Up next sheet; mockups queue-phone, -row-actions, -dragging)
//
// One queued track: the drag handle (44 × 60, GripVertical: "Reorder tone-0117, 1 of 3", a drag handle by its role
// description), the regime tile, the title and its facts ("No crystal yet · may stop here on a locked phone" for a track
// the gapless swap can't take), and ⋯, which opens the row's actions INLINE under it (Move up, Move down, Play next,
// Remove; never a sheet on a sheet). The row itself is not a button (no jump in v16.0). React.memo: its props are the
// row, its place and its state; it never reads the clock.

import React from 'react';
import { ArrowDown, ArrowUp, EllipsisVertical, GripVertical, ListStart, ListX } from 'lucide-react';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { REGIME_DOT } from '../shellModel';
import { rowRegime } from '../library/libraryModel';
import { handleName, queuedFacts } from './queueViewModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400';
const ACTION =
  'min-h-touch rounded-control border border-line-strong bg-surface-panel text-xs text-ink flex flex-col items-center justify-center gap-0.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

export type QueueRowAction = 'up' | 'down' | 'top' | 'remove';

interface QueueRowProps {
  rowKey: string;
  song: Song;
  /** 1-based place in the queue, and the queue's length. */
  position: number;
  total: number;
  open: boolean;
  lifted: boolean;
  /** The shift while another row is lifted (px), or 0. */
  offset: number;
  /** The keyboard-lifted row's own offset (px), or null (pointer: written by the drag itself). */
  liftOffset: number | null;
  handle: Record<string, unknown>;
  describedBy: string;
  onToggle: (key: string) => void;
  onAction: (key: string, a: QueueRowAction) => void;
}

const QueueRow = ({ rowKey, song, position, total, open, lifted, offset, liftOffset, handle, describedBy, onToggle, onAction }: QueueRowProps) => {
  countRender('QueueRow');
  const regime = rowRegime(song);
  const facts = queuedFacts(song);
  const transform = lifted ? (liftOffset !== null ? `translateY(${liftOffset}px)` : undefined) : offset ? `translateY(${offset}px)` : undefined;
  return (
    <li
      data-testid="queue-row"
      data-row-key={rowKey}
      className={lifted ? 'relative z-10 border-b border-line' : 'relative border-b border-line'}
      style={transform ? { transform } : undefined}
    >
      <div
        className={
          lifted
            ? 'h-row flex items-center bg-surface-raised border border-ink-faint rounded-card shadow-overlay mx-1'
            : open
              ? 'h-row flex items-center bg-surface-raised/60'
              : 'h-row flex items-center'
        }
      >
        <button
          type="button"
          data-handle-key={rowKey}
          data-testid="queue-handle"
          aria-label={handleName(song.name, position, total)}
          aria-roledescription="drag handle"
          aria-describedby={describedBy}
          className={`shrink-0 w-touch h-[60px] flex items-center justify-center touch-none cursor-grab rounded-control ${lifted ? 'text-ink-strong' : 'text-ink-muted'} ${FOCUS}`}
          {...handle}
        >
          <GripVertical size={20} aria-hidden="true" />
        </button>
        <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center">
          {regime ? <span className={`w-3 h-3 rounded-pill ${REGIME_DOT[regime]}`} /> : <span className="w-3 h-3 rounded-pill border border-ink-faint" />}
        </span>
        <span className="ml-3 flex-1 min-w-0">
          <span data-row-title="" className="block text-sm text-ink-strong truncate">{song.name}</span>
          <span data-row-facts="" className="block text-xs text-ink-muted truncate tabular-nums">
            {facts.alert ? <span className="text-status-alert">{facts.text}</span> : facts.text}
          </span>
        </span>
        <button
          type="button"
          data-testid="queue-row-menu"
          aria-label={`Options for ${song.name}`}
          aria-expanded={open}
          onClick={() => onToggle(rowKey)}
          className={`shrink-0 mr-1 w-touch h-touch flex items-center justify-center rounded-control ${open ? 'text-ink-strong' : 'text-ink-muted hover:text-ink-strong'} ${FOCUS}`}
        >
          <EllipsisVertical size={18} aria-hidden="true" />
        </button>
      </div>
      {open && !lifted ? (
        <div role="group" aria-label={`Options for ${song.name}`} data-testid="queue-row-actions" className="px-2 pb-2 grid grid-cols-4 gap-1 bg-surface-raised/60">
          <button type="button" data-action="up" disabled={position <= 1} onClick={() => onAction(rowKey, 'up')} className={ACTION}>
            <ArrowUp size={16} className="text-ink-muted" aria-hidden="true" />
            Move up
          </button>
          <button type="button" data-action="down" disabled={position >= total} onClick={() => onAction(rowKey, 'down')} className={ACTION}>
            <ArrowDown size={16} className="text-ink-muted" aria-hidden="true" />
            Move down
          </button>
          <button type="button" data-action="top" disabled={position <= 1} onClick={() => onAction(rowKey, 'top')} className={ACTION}>
            <ListStart size={16} className="text-ink-muted" aria-hidden="true" />
            Play next
          </button>
          <button type="button" data-action="remove" onClick={() => onAction(rowKey, 'remove')} className={ACTION}>
            <ListX size={16} className="stroke-status-error" aria-hidden="true" />
            Remove
          </button>
        </div>
      ) : null}
    </li>
  );
};

export default React.memo(QueueRow);
