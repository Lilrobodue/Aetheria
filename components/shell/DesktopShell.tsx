// components/shell/DesktopShell.tsx (v15.5, the new layout beta)
//
// The desktop shell (1024 px wide and 600 px tall or more; mockup desktop-shell): the 72 px side nav, a 420 px panel,
// the 88 px transport. The panel shows the open sheet (Sound, Crystal, Walks: non-modal, so the transport stays
// usable) or the active section's stub; on Now Playing with no sheet it is closed and the visualizer fills the space.
// Escape closes it. The ⋯ menu is a modal sheet. The heat guard never pauses the visualizer here.

import React, { useEffect, useRef } from 'react';
import { ViewBoundary } from '../ErrorBoundary';
import { overlayDepth } from '../ui/overlayStack';
import { useActions, useShell } from './contexts';
import { countRender } from './devRenders';
import SideNav from './SideNav';
import DesktopTransport from './DesktopTransport';
import SheetHost from './SheetHost';
import TabStub from './tabs/TabStub';
import MoreStub from './tabs/MoreStub';
import { TabCrash, TransportCrash } from './fallbacks';
import { focusViewHeading } from './PhoneShell';

const DesktopShell = () => {
  countRender('DesktopShell');
  const { tab, sheet } = useShell();
  const actions = useActions();
  const panelSheet = sheet && sheet !== 'menu' ? sheet : null;
  const stubOpen = !panelSheet && tab !== 'now';

  // Escape closes a section's panel (a sheet's panel closes itself: components/ui/Sheet.tsx).
  useEffect(() => {
    if (!stubOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (overlayDepth() > 0 || document.querySelector('[data-testid="output-sheet"]')) return;
      actions.setTab('now');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stubOpen]);

  const shownTab: { current: string } = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    if (tab !== 'now') focusViewHeading();
  }, [tab]);

  return (
    <div data-testid="new-shell" data-shell="desktop" className="fixed inset-0 z-10 pointer-events-none text-ink font-sans">
      <SideNav />
      {panelSheet || stubOpen ? (
        <div data-testid="desktop-panel" className="absolute left-[72px] top-0 bottom-transport w-[420px] pointer-events-auto">
          {panelSheet ? (
            <SheetHost presentation="panel" only="panel" />
          ) : (
            <>
              <ViewBoundary
                name="tab-library"
                fallback={(api) => (tab === 'library' ? <TabCrash api={api} inPanel /> : null)}
                render={() => tab === 'library' && <TabStub tab="library" inPanel />}
              />
              <ViewBoundary
                name="tab-mixes"
                fallback={(api) => (tab === 'mixes' ? <TabCrash api={api} inPanel /> : null)}
                render={() => tab === 'mixes' && <TabStub tab="mixes" inPanel />}
              />
              <ViewBoundary
                name="tab-layers"
                fallback={(api) => (tab === 'layers' ? <TabCrash api={api} inPanel /> : null)}
                render={() => tab === 'layers' && <TabStub tab="layers" inPanel />}
              />
              <ViewBoundary
                name="more"
                fallback={(api) => (tab === 'more' ? <TabCrash api={api} inPanel /> : null)}
                render={() => tab === 'more' && <MoreStub inPanel />}
              />
            </>
          )}
        </div>
      ) : null}
      <ViewBoundary
        name="desktop-transport"
        fallback={(api) => <TransportCrash api={api} what="The player bar" slot={false} />}
        render={() => <DesktopTransport />}
      />
      {sheet === 'menu' ? <SheetHost presentation="sheet" only="menu" /> : null}
    </div>
  );
};

export default React.memo(DesktopShell);
