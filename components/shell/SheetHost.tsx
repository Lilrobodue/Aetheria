// components/shell/SheetHost.tsx (v15.5, the new layout beta)
//
// The one open sheet (App's shellSheet: only one at a time). Closed sheets are unmounted. The phone shell shows them
// as modal bottom sheets; the desktop shell shows Sound, Crystal and Walks in its panel, and the ⋯ menu as a modal.

import React from 'react';
import { useShell } from './contexts';
import MenuSheet from './sheets/MenuSheet';
import SoundSheet from './sheets/SoundSheet';
import CrystalSheet from './sheets/CrystalSheet';
import WalksSheet from './sheets/WalksSheet';

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
    </>
  );
};

export default React.memo(SheetHost);
