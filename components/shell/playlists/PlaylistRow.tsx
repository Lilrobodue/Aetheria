// components/shell/playlists/PlaylistRow.tsx (v16.1; mockup playlists-phone-A)
//
// One 64 px row of the saved playlists' list: a ListMusic tile (AudioLines while it plays), the name, and its facts
// ("12 tracks · 48 min", then " · 2 missing" in the alert colour, or " · Playing"). The row itself opens the playlist's
// view; ▶ (44 × 44) plays it at once; ⋯ (44 × 44) opens its menu (Rename…, Duplicate, Delete playlist). React.memo:
// its props are strings, numbers and stable callbacks; it never reads the clock.

import React from 'react';
import { AudioLines, EllipsisVertical, ListMusic, Play } from 'lucide-react';
import { countRender } from '../devRenders';
import { rowFactsParts } from './playlistsViewModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400';

interface PlaylistRowProps {
  id: string;
  name: string;
  count: number;
  seconds: number;
  missing: number;
  playing: boolean;
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
  onMenu: (id: string, opener: HTMLElement) => void;
}

const PlaylistRow = ({ id, name, count, seconds, missing, playing, onOpen, onPlay, onMenu }: PlaylistRowProps) => {
  countRender('PlaylistRow');
  const facts = rowFactsParts({ count, seconds, missing, playing });
  return (
    <li data-testid="playlist-row" data-playlist-id={id} className={playing ? 'h-row flex items-center border-b border-line bg-surface-raised/60' : 'h-row flex items-center border-b border-line'}>
      <button
        type="button"
        data-testid="playlist-row-open"
        aria-current={playing ? 'true' : undefined}
        onClick={() => onOpen(id)}
        className={`flex-1 min-w-0 h-full pl-4 flex items-center gap-3 text-left hover:bg-surface-raised/40 transition-colors duration-fast ${FOCUS}`}
      >
        <span aria-hidden="true" className={playing ? 'shrink-0 w-10 h-10 rounded-control bg-surface-control flex items-center justify-center' : 'shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center'}>
          {playing ? <AudioLines size={18} className="text-ink-strong" /> : <ListMusic size={18} className="text-ink-soft" />}
        </span>
        <span className="min-w-0">
          <span data-row-title="" className={playing ? 'block text-sm font-semibold text-ink-strong truncate' : 'block text-sm text-ink-strong truncate'}>
            {name}
          </span>
          <span data-row-facts="" className={playing ? 'block text-xs text-ink-soft truncate tabular-nums' : 'block text-xs text-ink-muted truncate tabular-nums'}>
            {facts.base}
            {facts.note ? ' · ' : null}
            {facts.note ? facts.alert ? <span className="text-status-alert">{facts.note}</span> : facts.note : null}
          </span>
        </span>
      </button>
      <button
        type="button"
        data-testid="playlist-row-play"
        aria-label={`Play ${name}`}
        title={`Play ${name}`}
        onClick={() => onPlay(id)}
        className={`shrink-0 w-touch h-touch flex items-center justify-center rounded-control text-ink-soft hover:text-ink-strong transition-colors duration-fast ${FOCUS}`}
      >
        <Play size={18} />
      </button>
      <button
        type="button"
        data-testid="playlist-row-menu"
        aria-label={`Options for ${name}`}
        title={`Options for ${name}`}
        aria-haspopup="dialog"
        onClick={(e: { currentTarget: HTMLElement }) => onMenu(id, e.currentTarget)}
        className={`shrink-0 mr-1 w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong transition-colors duration-fast ${FOCUS}`}
      >
        <EllipsisVertical size={18} />
      </button>
    </li>
  );
};

export default React.memo(PlaylistRow);
