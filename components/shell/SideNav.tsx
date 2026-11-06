// components/shell/SideNav.tsx (v15.5, the new layout beta)
//
// The desktop shell's 72 px side nav (mockup desktop-shell): the same five sections as the phone's tabs, as 64 × 56
// tiles with short labels, the active one gold (v16.8: no Beta at the foot).
// v16.4: a click on the active More section takes More back to its root, also when the
// desktop panel shows the Visuals sheet in More's place (v16.4 review: requestMoreRoot is given where More was left).
// v16.7 (desktop polish; decisions 1 A and 2 A): below 1280 px, today's 72 px rail plus a Shortcuts button above Beta;
// from 1280 px (`xl:`) a labelled 200 px nav: the logo and "Aetheria", five 48 px rows with the full names, an L keycap
// on Layers, and "Shortcuts ?" at the foot. CSS breakpoints only: no JavaScript, and nothing renders on a resize. The
// open section keeps its tint, semibold and aria-current, plus a 3 px gold bar at the nav's edge (a shape, so colour
// isn't the only cue). Tooltips (the kit's) give the full name and the key below 1280; from 1280 there are none (decision
// 9: every row shows its name and key there). aria-label is the full name at every width.

import React from 'react';
import { Activity as PulseIcon, Disc3, Keyboard, Layers, Library, ListMusic, Menu } from 'lucide-react';
import Kbd from '../ui/Kbd';
import Tooltip from '../ui/Tooltip';
import { useActions, useShell } from './contexts';
import { countRender } from './devRenders';
import { TABS } from './shellModel';
import { requestMoreRoot } from './more/moreModel';
import { requestShortcuts, useKeysOn } from './shortcuts/shortcutsStore';
import { tipKeys } from './shortcuts/keysModel';
import type { ShellTab } from './shellModel';

const ICONS: Record<ShellTab, any> = { now: Disc3, library: Library, mixes: ListMusic, layers: Layers, more: Menu };

const TILE_ON =
  'relative w-16 h-14 rounded-card flex flex-col items-center justify-center gap-0.5 text-caption bg-gold-500/10 text-gold-400 font-semibold xl:w-full xl:h-12 xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const TILE_OFF =
  'relative w-16 h-14 rounded-card flex flex-col items-center justify-center gap-0.5 text-caption text-ink-muted hover:text-ink-strong transition-colors duration-fast xl:w-full xl:h-12 xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:text-sm xl:text-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const SideNav = () => {
  countRender('SideNav');
  const { tab, moreViewRef } = useShell();
  const actions = useActions();
  const keys = useKeysOn();
  return (
    // Decision 11 (v16.7): the visuals still centre on the whole window, so beside the 200 px nav their centre sits 100 px
    // left of the open area's; left for a later release with the visualizer (its canvas sizing touches heat and full
    // screen; Visualizer.tsx is untouched here).
    <nav
      aria-label="Main"
      data-testid="side-nav"
      className="absolute left-0 top-0 bottom-transport w-[72px] xl:w-[200px] bg-surface-deep border-r border-line flex flex-col items-center xl:items-stretch xl:px-3 pt-3 gap-1 pointer-events-auto"
    >
      <div aria-hidden="true" className="mb-3 flex items-center gap-3 xl:px-1">
        <span className="shrink-0 w-9 h-9 rounded-pill bg-gold-500 flex items-center justify-center text-black shadow-glow-gold">
          <PulseIcon size={20} />
        </span>
        <span className="hidden xl:inline text-base font-semibold text-ink-strong">Aetheria</span>
      </div>
      {TABS.map(({ id, label, short }) => {
        const Icon = ICONS[id];
        const on = id === tab;
        const layers = id === 'layers';
        return (
          <Tooltip key={id} label={label} keys={layers && keys ? tipKeys('layers') : null} side="right" hideFrom="xl">
            <button
              type="button"
              aria-label={label}
              aria-current={on ? 'page' : undefined}
              data-testid={`nav-${id}`}
              onClick={() => {
                if (on && id === 'more') requestMoreRoot(moreViewRef);
                actions.setTab(id);
              }}
              className={on ? TILE_ON : TILE_OFF}
            >
              {on ? (
                <span
                  aria-hidden="true"
                  data-testid="nav-active-bar"
                  className="absolute -left-1 xl:-left-3 top-1/2 -translate-y-1/2 h-8 w-[3px] rounded-r-pill bg-gold-400"
                />
              ) : null}
              <Icon size={20} aria-hidden="true" className="shrink-0" />
              <span className="xl:hidden">{short}</span>
              <span className="hidden xl:inline">{label}</span>
              {layers && keys ? (
                <span aria-hidden="true" className="hidden xl:inline-flex ml-auto">
                  <Kbd>L</Kbd>
                </span>
              ) : null}
            </button>
          </Tooltip>
        );
      })}
      <Tooltip label="Keyboard shortcuts" keys={keys ? tipKeys('help') : null} side="right" hideFrom="xl" wrapClassName="relative inline-flex shrink-0 mt-auto mb-3">
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          aria-haspopup="dialog"
          data-testid="nav-shortcuts"
          onClick={requestShortcuts}
          className="w-16 h-touch rounded-card flex items-center justify-center text-ink-muted hover:text-ink-strong transition-colors duration-fast xl:w-full xl:justify-start xl:gap-3 xl:px-3 xl:text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          <Keyboard size={20} aria-hidden="true" className="shrink-0" />
          <span className="hidden xl:inline">Shortcuts</span>
          {keys ? (
            <span aria-hidden="true" className="hidden xl:inline-flex ml-auto">
              <Kbd>?</Kbd>
            </span>
          ) : null}
        </button>
      </Tooltip>
    </nav>
  );
};

export default React.memo(SideNav);
