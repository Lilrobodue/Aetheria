// components/shell/playlists/PlaylistRowMenu.tsx (v16.1; mockup playlist-row-menu-phone)
//
// An entry's ⋯ in a playlist's view: a kit Sheet like the Library's RowMenu, named by the track, its header the tile,
// the title and "3:47 · 639 Hz · 5th in Evening". View mode: Play from here, Play next, Add to queue, Add to another
// playlist…, Remove from Evening (with Undo; the library keeps the track), Track info. A missing entry: Remove only.
// Edit mode: Move to top, Move up, Move down, Move to bottom, Remove (the accessible path for a touch screen reader).
// Each item closes the sheet first (a Dialog never sits on a Sheet). Its body is the `playlist-menu` region.

import React from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, FileQuestion, Info, ListEnd, ListMinus, ListPlus, ListStart, Play, FileAudio } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import ListRow from '../../ui/ListRow';
import { ViewBoundary } from '../../ErrorBoundary';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { REGIME_DOT } from '../shellModel';
import { rowFacts, rowRegime } from '../library/libraryModel';
import { sheetFallback } from '../sheets/sheetFallback';
import { REMOVE_FROM_LINE, inPlaylistPlace, missingLine, playFromHereLine, removeFromTitle } from './playlistsViewModel';
import ExportRowLine from '../export/ExportRowLine';
import { EXPORT_ROW, ROW_LIBRARY } from '../../../utils/export/exportWords';

export type PlaylistRowAction = 'play' | 'next' | 'queue' | 'playlist' | 'remove' | 'info' | 'export' | 'top' | 'up' | 'down' | 'bottom';

interface Item {
  id: PlaylistRowAction;
  title: string;
  subtitle?: ReactNode;
  icon: ReactNode;
}

interface PlaylistRowMenuProps {
  song: Song | null;
  name: string;
  file: string;
  index: number;
  size: number;
  playlist: string;
  editing: boolean;
  lines: { next: string; queue: string };
  onAction: (a: PlaylistRowAction) => void;
  onClose: () => void;
}

const items = (p: PlaylistRowMenuProps): Item[] => {
  const remove: Item = { id: 'remove', title: removeFromTitle(p.playlist), subtitle: REMOVE_FROM_LINE, icon: <ListMinus size={20} className="stroke-status-error" /> };
  if (p.editing) {
    const out: Item[] = [];
    if (p.index > 0) out.push({ id: 'top', title: 'Move to top', icon: <ArrowUpToLine size={20} /> }, { id: 'up', title: 'Move up', icon: <ArrowUp size={20} /> });
    if (p.index < p.size - 1) out.push({ id: 'down', title: 'Move down', icon: <ArrowDown size={20} /> }, { id: 'bottom', title: 'Move to bottom', icon: <ArrowDownToLine size={20} /> });
    out.push(remove);
    return out;
  }
  if (!p.song) return [remove];
  return [
    { id: 'play', title: 'Play from here', subtitle: playFromHereLine(p.playlist), icon: <Play size={20} /> },
    { id: 'next', title: 'Play next', subtitle: p.lines.next, icon: <ListStart size={20} /> },
    { id: 'queue', title: 'Add to queue', subtitle: p.lines.queue, icon: <ListEnd size={20} /> },
    { id: 'playlist', title: 'Add to another playlist…', icon: <ListPlus size={20} /> },
    remove,
    { id: 'info', title: 'Track info', subtitle: 'Length, crystal, key, visual sync and the file', icon: <Info size={20} /> },
    // v16.5: Export with layers.
    { id: 'export', title: EXPORT_ROW, subtitle: <ExportRowLine text={ROW_LIBRARY} />, icon: <FileAudio size={20} /> },
  ];
};

const PlaylistRowMenuBody = (p: PlaylistRowMenuProps) => {
  countRender('PlaylistRowMenu');
  const regime = p.song ? rowRegime(p.song) : null;
  const title = p.song ? p.song.name : p.name;
  const facts = p.song ? `${rowFacts(p.song)} · ${inPlaylistPlace(p.index + 1, p.playlist)}` : missingLine(p.file);
  return (
    <div data-testid="playlist-row-menu-body" className="pb-2">
      <div className="px-4 pt-1 pb-3 flex items-center gap-3 border-b border-line">
        {p.song ? (
          <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center">
            {regime ? <span className={`w-3 h-3 rounded-pill ${REGIME_DOT[regime]}`} /> : <span className="w-3 h-3 rounded-pill border border-ink-faint" />}
          </span>
        ) : (
          <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control border border-dashed border-line-strong flex items-center justify-center">
            <FileQuestion size={18} className="text-ink-faint" />
          </span>
        )}
        <span className="min-w-0">
          <span aria-hidden="true" className="block text-base font-semibold text-ink-strong truncate">
            {title}
          </span>
          <span className={p.song ? 'block text-xs text-ink-muted tabular-nums truncate' : 'block text-xs text-status-alert truncate'}>{facts}</span>
        </span>
      </div>
      {items(p).map((it) => (
        <React.Fragment key={it.id}>
          <ListRow title={it.title} subtitle={it.subtitle} icon={it.icon} onClick={() => p.onAction(it.id)} data-testid={`playlist-row-menu-${it.id}`} />
        </React.Fragment>
      ))}
      <button
        type="button"
        onClick={p.onClose}
        className="mt-3 mx-4 w-[calc(100%-2rem)] h-touch rounded-control text-sm text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        Cancel
      </button>
    </div>
  );
};

const PlaylistRowMenu = (p: PlaylistRowMenuProps) => (
  <Sheet open title={p.song ? p.song.name : p.name} headerless onClose={p.onClose} data-testid="playlist-row-menu">
    <ViewBoundary name="playlist-menu" fallback={sheetFallback(p.onClose)} render={() => <PlaylistRowMenuBody {...p} />} />
  </Sheet>
);

export default React.memo(PlaylistRowMenu);
