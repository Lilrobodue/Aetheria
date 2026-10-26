// components/shell/library/RowMenu.tsx (v15.7, the Library tab; mockup library-row-menu-phone)
//
// A row's ⋯: a kit Sheet, modal on both shells (centred on the desktop), named by the track's title. Its header shows
// the tile, the title and the facts line; then 64 px rows, data-driven so v14.18 and v14.19 add Play next, Add to queue
// and Add to playlist as items: Play from here (the same call as a row tap), Track info, and Delete from library… (v15.4's
// confirmation Dialog, through App's existing delete); Cancel below. Each item closes the sheet first, so a Dialog never
// sits on a Sheet (v15.5's rule); focus goes back to the ⋯ (the overlay stack). The body is the `library-menu` region.

import React from 'react';
import type { ReactNode } from 'react';
import { Info, Play, Trash2 } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import ListRow from '../../ui/ListRow';
import { ViewBoundary } from '../../ErrorBoundary';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { REGIME_DOT } from '../shellModel';
import { sheetFallback } from '../sheets/sheetFallback';
import { rowFacts, rowRegime } from './libraryModel';

export type RowMenuAction = 'play' | 'info' | 'delete';

interface MenuItem {
  id: RowMenuAction;
  title: string;
  subtitle: string;
  icon: ReactNode;
}

const ITEMS: readonly MenuItem[] = [
  { id: 'play', title: 'Play from here', subtitle: 'Your library, starting with this track', icon: <Play size={20} /> },
  { id: 'info', title: 'Track info', subtitle: 'Length, crystal, key, visual sync and the file', icon: <Info size={20} /> },
  {
    id: 'delete',
    title: 'Delete from library…',
    subtitle: 'Removes Aetheria’s copy. The original file is not touched.',
    icon: <Trash2 size={20} className="stroke-status-error" />,
  },
];

interface RowMenuProps {
  song: Song;
  onAction: (a: RowMenuAction) => void;
  onClose: () => void;
}

const RowMenuBody = ({ song, onAction, onClose }: RowMenuProps) => {
  countRender('RowMenu');
  const regime = rowRegime(song);
  return (
    <div data-testid="library-menu-body" className="pb-2">
      <div className="px-4 pt-1 pb-3 flex items-center gap-3 border-b border-line">
        <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center">
          {regime ? <span className={`w-3 h-3 rounded-pill ${REGIME_DOT[regime]}`} /> : <span className="w-3 h-3 rounded-pill border border-ink-faint" />}
        </span>
        <span className="min-w-0">
          <span aria-hidden="true" className="block text-base font-semibold text-ink-strong truncate">
            {song.name}
          </span>
          <span className="block text-xs text-ink-muted tabular-nums truncate">{rowFacts(song)}</span>
        </span>
      </div>
      {ITEMS.map((it) => (
        <React.Fragment key={it.id}>
          <ListRow title={it.title} subtitle={it.subtitle} icon={it.icon} onClick={() => onAction(it.id)} data-testid={`library-menu-${it.id}`} />
        </React.Fragment>
      ))}
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

const RowMenu = ({ song, onAction, onClose }: RowMenuProps) => (
  <Sheet open title={song.name} headerless onClose={onClose} data-testid="library-menu">
    <ViewBoundary name="library-menu" fallback={sheetFallback(onClose)} render={() => <RowMenuBody song={song} onAction={onAction} onClose={onClose} />} />
  </Sheet>
);

export default React.memo(RowMenu);
