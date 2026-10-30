// components/shell/SideNav.tsx (v15.5, the new layout beta)
//
// The desktop shell's 72 px side nav (mockup desktop-shell): the same five sections as the phone's tabs, as 64 × 56
// tiles with short labels, the active one gold, and Beta at the foot. v14.24 widens it and adds shortcuts.
// v16.4: a click on the active More section takes More back to its root, also when the
// desktop panel shows the Visuals sheet in More's place (v16.4 review: requestMoreRoot is given where More was left).

import React from 'react';
import { Activity as PulseIcon, Disc3, Layers, Library, ListMusic, Menu } from 'lucide-react';
import Badge from '../ui/Badge';
import { useActions, useShell } from './contexts';
import { countRender } from './devRenders';
import { TABS } from './shellModel';
import { requestMoreRoot } from './more/moreModel';
import type { ShellTab } from './shellModel';

const ICONS: Record<ShellTab, any> = { now: Disc3, library: Library, mixes: ListMusic, layers: Layers, more: Menu };

const SideNav = () => {
  countRender('SideNav');
  const { tab, moreViewRef } = useShell();
  const actions = useActions();
  return (
    <nav
      aria-label="Main"
      data-testid="side-nav"
      className="absolute left-0 top-0 bottom-transport w-[72px] bg-surface-deep border-r border-line flex flex-col items-center pt-3 gap-1 pointer-events-auto"
    >
      <div aria-hidden="true" className="mb-3 w-9 h-9 rounded-pill bg-gold-500 flex items-center justify-center text-black shadow-glow-gold">
        <PulseIcon size={20} />
      </div>
      {TABS.map(({ id, label, short }) => {
        const Icon = ICONS[id];
        const on = id === tab;
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={on ? 'page' : undefined}
            data-testid={`nav-${id}`}
            onClick={() => {
              if (on && id === 'more') requestMoreRoot(moreViewRef);
              actions.setTab(id);
            }}
            className={
              on
                ? 'w-16 h-14 rounded-card flex flex-col items-center justify-center gap-0.5 text-caption bg-gold-500/10 text-gold-400 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
                : 'w-16 h-14 rounded-card flex flex-col items-center justify-center gap-0.5 text-caption text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
            }
          >
            <Icon size={20} aria-hidden="true" />
            {short}
          </button>
        );
      })}
      <Badge className="mt-auto mb-3">Beta</Badge>
    </nav>
  );
};

export default React.memo(SideNav);
