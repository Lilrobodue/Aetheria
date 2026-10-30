// components/shell/playlists/PlaylistMenu.tsx (v16.1; mockups playlists-phone-A, playlist-detail-phone)
//
// A playlist's ⋯ (its row in the list, or its view's header): a kit Sheet, modal on both shells, named by the playlist:
// Rename…, Duplicate, Delete playlist (its toast has Undo); Cancel. Each item closes the sheet first, so the name Dialog
// never sits on a Sheet; focus goes back to the ⋯ (the overlay stack). Its body is the `playlist-menu` region.

import React from 'react';
import { Copy, FileAudio, Pencil, Trash2 } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import ListRow from '../../ui/ListRow';
import { ViewBoundary } from '../../ErrorBoundary';
import { countRender } from '../devRenders';
import { sheetFallback } from '../sheets/sheetFallback';
import ExportRowLine from '../export/ExportRowLine';
import { EXPORT_ROW, ROW_PLAYLIST } from '../../../utils/export/exportWords';

export type PlaylistMenuAction = 'rename' | 'duplicate' | 'export' | 'delete';

interface PlaylistMenuProps {
  name: string;
  facts: string;
  onAction: (a: PlaylistMenuAction) => void;
  /** v16.5: some of its tracks are here (Export with layers… shows). */
  canExport?: boolean;
  onClose: () => void;
}

const PlaylistMenuBody = ({ name, facts, onAction, canExport = false, onClose }: PlaylistMenuProps) => {
  countRender('PlaylistMenu');
  return (
    <div data-testid="playlist-menu-body" className="pb-2">
      <div className="px-4 pt-1 pb-3 border-b border-line">
        <span aria-hidden="true" className="block text-base font-semibold text-ink-strong truncate">
          {name}
        </span>
        <span className="block text-xs text-ink-muted tabular-nums truncate">{facts}</span>
      </div>
      <ListRow title="Rename…" subtitle="A new name; its tracks stay as they are" icon={<Pencil size={20} />} onClick={() => onAction('rename')} data-testid="playlist-menu-rename" />
      <ListRow title="Duplicate" subtitle="A copy with the same tracks" icon={<Copy size={20} />} onClick={() => onAction('duplicate')} data-testid="playlist-menu-duplicate" />
      {canExport ? (
        <ListRow title={EXPORT_ROW} subtitle={<ExportRowLine text={ROW_PLAYLIST} />} icon={<FileAudio size={20} />} onClick={() => onAction('export')} data-testid="playlist-menu-export" />
      ) : null}
      <ListRow
        title="Delete playlist"
        subtitle="Only the playlist; your music is not touched"
        icon={<Trash2 size={20} className="stroke-status-error" />}
        onClick={() => onAction('delete')}
        data-testid="playlist-menu-delete"
      />
      <button
        type="button"
        onClick={onClose}
        className="mt-3 mx-4 w-[calc(100%-2rem)] h-touch rounded-control text-sm text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        Cancel
      </button>
    </div>
  );
};

const PlaylistMenu = (p: PlaylistMenuProps) => (
  <Sheet open title={p.name} headerless onClose={p.onClose} data-testid="playlist-menu">
    <ViewBoundary name="playlist-menu" fallback={sheetFallback(p.onClose)} render={() => <PlaylistMenuBody {...p} />} />
  </Sheet>
);

export default React.memo(PlaylistMenu);
