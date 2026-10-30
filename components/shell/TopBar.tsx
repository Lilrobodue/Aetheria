// components/shell/TopBar.tsx (v15.5, the new layout beta)
//
// Now Playing's top bar on the phone: AETHERIA, Beta, REC while a recording runs (v16.5: a tap opens Record), and ⋯ (the menu). A gradient scrim
// over the visualizer, never a blur (I13: no backdrop-filter over the canvas). The Spectrum lens's top inset is
// measured from it (headerRef). Hidden on a landscape phone, where Now Playing carries its own ⋯.
// v15.6: the Zen button (the eye) sits left of ⋯ (decision 1, option A).

import React from 'react';
import { Ellipsis } from 'lucide-react';
import Badge from '../ui/Badge';
import { useActions, useShell } from './contexts';
import { countRender } from './devRenders';
import RecButton from './RecButton';
import ZenButton from './ZenButton';

const TopBar = () => {
  countRender('TopBar');
  const { headerRef } = useShell();
  const actions = useActions();
  return (
    <header
      ref={headerRef}
      data-testid="new-top-bar"
      className="shrink-0 h-14 pl-4 pr-1 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent pointer-events-auto [@media(max-height:500px)]:hidden"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-serif tracking-[0.25em] text-gold-400">AETHERIA</span>
        <Badge>Beta</Badge>
        <RecButton />
      </div>
      <div className="flex items-center">
        <ZenButton data-testid="zen-button" />
        <button
          type="button"
          aria-label="More options"
          aria-haspopup="dialog"
          data-testid="np-menu-button"
          onClick={() => actions.openSheet('menu')}
          className="w-touch h-touch flex items-center justify-center rounded-control text-ink-soft hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          <Ellipsis size={22} />
        </button>
      </div>
    </header>
  );
};

export default React.memo(TopBar);
