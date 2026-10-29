// components/shell/playlists/PlaylistTrackRow.tsx (v16.1; mockups playlist-detail-phone, playlist-detail-edit-phone,
// playlist-detail-dragging-phone)
//
// One 64 px entry of a playlist's view, absolutely placed at index × 64 px in the virtualized list:
//   view mode  as a Library row: the tile (the crystal's regime dot; AudioLines / Pause on the playing entry, which says
//              "Playing · " before its facts), the title and its facts; the row's tap plays the playlist from it; ⋯.
//              A missing entry: a dashed FileQuestion tile, its stored name, "Not in your library · import
//              tone-0203.wav again" in the alert colour, and ⋯ (Remove only); it is not a button.
//   edit mode  v16.0's 44 × 60 GripVertical handle ("Reorder tone-0117, 5 of 12", a drag handle by its role
//              description), the tile, the title and its facts ("Not in your library" for a missing one), and ⋯ (Move to
//              top / up / down / to bottom, Remove).
// The row's first control carries data-row-index (the list's roving tab stop) and the ⋯ data-row-menu. React.memo: its
// props are the entry, its place and its state; it never reads the clock.

import React from 'react';
import { AudioLines, EllipsisVertical, FileQuestion, GripVertical, Pause } from 'lucide-react';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { REGIME_DOT } from '../shellModel';
import { rowFacts, rowRegime } from '../library/libraryModel';
import { MISSING_SHORT, handleName, missingLine } from './playlistsViewModel';

export const ROW_PX = 64;
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400';

interface PlaylistTrackRowProps {
  rowKey: string;
  index: number;
  size: number;
  name: string;
  file: string;
  song: Song | null;
  /** The playing entry, and whether the music plays now. */
  current: boolean;
  paused: boolean;
  /** The list's roving tab stop. */
  active: boolean;
  editing: boolean;
  lifted: boolean;
  /** The shift (px) while another row is lifted, or the keyboard-lifted row's own; null: none (a pointer lift writes its
   *  own). */
  offset: number | null;
  handle: Record<string, unknown> | null;
  describedBy: string;
  onPlay: (index: number) => void;
  onMenu: (index: number, opener: HTMLElement) => void;
  onFocusRow: (index: number) => void;
}

const Tile = ({ song, current, paused }: { song: Song | null; current: boolean; paused: boolean }) => {
  if (!song) {
    return (
      <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control border border-dashed border-line-strong flex items-center justify-center">
        <FileQuestion size={18} className="text-ink-faint" />
      </span>
    );
  }
  const regime = rowRegime(song);
  return (
    <span aria-hidden="true" className={current ? 'shrink-0 w-10 h-10 rounded-control bg-surface-control flex items-center justify-center' : 'shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center'}>
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
  );
};

const PlaylistTrackRow = (p: PlaylistTrackRowProps) => {
  countRender('PlaylistTrackRow');
  const { rowKey, index, size, name, file, song, current, paused, active, editing, lifted, offset, handle, describedBy, onPlay, onMenu, onFocusRow } = p;
  const title = song ? song.name : name;
  const style: { top: number; transform?: string } = { top: index * ROW_PX };
  if (offset) style.transform = `translateY(${offset}px)`;
  const menu = (
    <button
      type="button"
      tabIndex={-1}
      data-row-menu={index}
      aria-label={`Options for ${title}`}
      title={`Options for ${title}`}
      aria-haspopup="dialog"
      onClick={(e: { currentTarget: HTMLElement }) => onMenu(index, e.currentTarget)}
      onFocus={() => onFocusRow(index)}
      className={`shrink-0 mr-1 w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong transition-colors duration-fast ${FOCUS}`}
    >
      <EllipsisVertical size={18} />
    </button>
  );

  if (editing) {
    return (
      <div
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={size}
        data-testid="playlist-track"
        data-index={index}
        data-row-key={rowKey}
        className={lifted ? 'absolute inset-x-0 h-row z-10' : 'absolute inset-x-0 h-row border-b border-line'}
        style={style}
      >
        <div className={lifted ? 'h-row flex items-center bg-surface-raised border border-ink-faint rounded-card shadow-overlay mx-1' : 'h-row flex items-center'}>
          <button
            type="button"
            data-row-index={index}
            data-handle-key={rowKey}
            data-testid="playlist-handle"
            tabIndex={active ? 0 : -1}
            aria-label={handleName(title, index + 1, size)}
            aria-roledescription="drag handle"
            aria-describedby={describedBy}
            onFocus={() => onFocusRow(index)}
            className={`shrink-0 w-touch h-[60px] flex items-center justify-center touch-none cursor-grab rounded-control ${lifted ? 'text-ink-strong' : 'text-ink-muted'} ${FOCUS}`}
            {...(handle ?? {})}
          >
            <GripVertical size={20} aria-hidden="true" />
          </button>
          <Tile song={song} current={false} paused={false} />
          <span className="ml-3 flex-1 min-w-0">
            <span data-row-title="" className={song ? 'block text-sm text-ink-strong truncate' : 'block text-sm text-ink-muted truncate'}>
              {title}
            </span>
            <span data-row-facts="" className={song ? 'block text-xs text-ink-muted truncate tabular-nums' : 'block text-xs text-status-alert truncate'}>
              {song ? rowFacts(song) : MISSING_SHORT}
            </span>
          </span>
          {menu}
        </div>
      </div>
    );
  }

  if (!song) {
    return (
      <div role="listitem" aria-posinset={index + 1} aria-setsize={size} data-testid="playlist-track" data-index={index} data-row-key={rowKey} data-missing="" className="absolute inset-x-0 h-row flex items-center border-b border-line" style={style}>
        <div className="flex-1 min-w-0 h-full pl-4 flex items-center gap-3">
          <Tile song={null} current={false} paused={false} />
          <span className="min-w-0">
            <span data-row-title="" className="block text-sm text-ink-muted truncate">
              {name}
            </span>
            <span data-row-facts="" className="block text-xs text-status-alert truncate">
              {missingLine(file)}
            </span>
          </span>
        </div>
        <button
          type="button"
          data-row-index={index}
          data-row-menu={index}
          tabIndex={active ? 0 : -1}
          aria-label={`Options for ${name}, not in your library`}
          title={`Options for ${name}`}
          aria-haspopup="dialog"
          onClick={(e: { currentTarget: HTMLElement }) => onMenu(index, e.currentTarget)}
          onFocus={() => onFocusRow(index)}
          className={`shrink-0 mr-1 w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong transition-colors duration-fast ${FOCUS}`}
        >
          <EllipsisVertical size={18} />
        </button>
      </div>
    );
  }

  return (
    <div
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={size}
      data-testid="playlist-track"
      data-index={index}
      data-row-key={rowKey}
      className={current ? 'absolute inset-x-0 h-row flex items-center border-b border-line bg-surface-raised/60' : 'absolute inset-x-0 h-row flex items-center border-b border-line'}
      style={style}
    >
      <button
        type="button"
        data-row-index={index}
        tabIndex={active ? 0 : -1}
        aria-current={current ? 'true' : undefined}
        onClick={() => onPlay(index)}
        onFocus={() => onFocusRow(index)}
        className={`flex-1 min-w-0 h-full pl-4 flex items-center gap-3 text-left hover:bg-surface-raised/40 transition-colors duration-fast ${FOCUS}`}
      >
        <Tile song={song} current={current} paused={paused} />
        <span className="min-w-0">
          <span data-row-title="" className={current ? 'block text-sm font-semibold text-ink-strong truncate' : 'block text-sm text-ink-strong truncate'}>
            {title}
          </span>
          <span data-row-facts="" className={current ? 'block text-xs text-ink-soft truncate tabular-nums' : 'block text-xs text-ink-muted truncate tabular-nums'}>
            {rowFacts(song, current ? (paused ? 'paused' : 'playing') : null)}
          </span>
        </span>
      </button>
      {menu}
    </div>
  );
};

export default React.memo(PlaylistTrackRow);
