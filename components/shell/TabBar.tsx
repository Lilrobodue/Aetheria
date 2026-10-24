// components/shell/TabBar.tsx (v15.5, the new layout beta)
//
// The phone shell's five tabs: a `nav` of buttons with aria-current="page" on the active one (each view is a page,
// not an ARIA tab panel). 56 px tall plus the safe-area inset; the active tab is gold (one of gold's four places).

import React from 'react';
import { Disc3, Layers, Library, ListMusic, Menu } from 'lucide-react';
import { useActions, useShell } from './contexts';
import { countRender } from './devRenders';
import { TABS } from './shellModel';
import type { ShellTab } from './shellModel';

const ICONS: Record<ShellTab, any> = { now: Disc3, library: Library, mixes: ListMusic, layers: Layers, more: Menu };

const TabBar = () => {
  countRender('TabBar');
  const { tab } = useShell();
  const actions = useActions();
  return (
    <nav aria-label="Main" data-testid="tab-bar" className="flex bg-surface-deep border-t border-line pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ id, label }) => {
        const Icon = ICONS[id];
        const on = id === tab;
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? 'page' : undefined}
            data-testid={`tab-${id}-button`}
            onClick={() => actions.setTab(id)}
            className={
              on
                ? 'flex-1 h-tabbar flex flex-col items-center justify-center gap-0.5 text-caption text-gold-400 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400'
                : 'flex-1 h-tabbar flex flex-col items-center justify-center gap-0.5 text-caption text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400'
            }
          >
            <span aria-hidden="true" className="flex items-center justify-center w-12 h-7 rounded-pill">
              <Icon size={20} />
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
};

export default React.memo(TabBar);
