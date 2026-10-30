// components/shell/SheetHost.tsx (v15.5, the new layout beta)
//
// The one open sheet (App's shellSheet: only one at a time). Closed sheets are unmounted. The phone shell shows them
// as modal bottom sheets; the desktop shell shows Sound, Crystal and Walks in its panel, and the ⋯ menu as a modal.
// v15.7: the Import sheet (the Library tab), in the panel on the desktop too. v16.0: the Up next sheet (the queue), in the
// panel on the desktop too.
// v16.1: the Add to playlist sheet, modal on both shells (with the menu on the desktop).
// v16.4: the Visuals sheet (decision 1 A): the phone's preview sheet over Now Playing, the desktop's panel.

import React from 'react';
import { useShell } from './contexts';
import MenuSheet from './sheets/MenuSheet';
import SoundSheet from './sheets/SoundSheet';
import CrystalSheet from './sheets/CrystalSheet';
import WalksSheet from './sheets/WalksSheet';
import ImportSheet from './sheets/ImportSheet';
import QueueSheet from './queue/QueueSheet';
import AddToPlaylistSheet from './playlists/AddToPlaylistSheet';
import VisualsSheet from './more/VisualsSheet';

interface SheetHostProps {
  presentation: 'sheet' | 'panel';
  /** 'panel': only the sheets the desktop panel shows (not the menu). */
  only?: 'all' | 'panel' | 'menu';
}

const SheetHost = ({ presentation, only = 'all' }: SheetHostProps) => {
  const { sheet } = useShell();
  return (
    <>
      {sheet === 'menu' && only !== 'panel' ? <MenuSheet /> : null}
      {sheet === 'sound' && only !== 'menu' ? <SoundSheet presentation={presentation} /> : null}
      {sheet === 'crystal' && only !== 'menu' ? <CrystalSheet presentation={presentation} /> : null}
      {sheet === 'walks' && only !== 'menu' ? <WalksSheet presentation={presentation} /> : null}
      {sheet === 'import' && only !== 'menu' ? <ImportSheet presentation={presentation} /> : null}
      {sheet === 'queue' && only !== 'menu' ? <QueueSheet presentation={presentation} /> : null}
      {sheet === 'playlist-add' && only !== 'panel' ? <AddToPlaylistSheet /> : null}
      {sheet === 'visuals' && only !== 'menu' ? <VisualsSheet presentation={presentation} /> : null}
    </>
  );
};

export default React.memo(SheetHost);
