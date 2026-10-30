// components/shell/DesktopShell.tsx (v15.5, the new layout beta)
//
// The desktop shell (1024 px wide and 600 px tall or more; mockup desktop-shell): the 72 px side nav, a 420 px panel,
// the 88 px transport. The panel shows the open sheet (Sound, Crystal, Walks: non-modal, so the transport stays
// usable) or the active section's stub; on Now Playing with no sheet it is closed and the visualizer fills the space.
// Escape closes it. The ⋯ menu is a modal sheet. The heat guard never pauses the visualizer here.
// v15.6: Layers shows the Layers tab in the panel (inPanel); Zen hides this root (nav and transport) with the panel
// closed, as on the phone: inert and transparent, a mouse move brings it back.
// v15.7: Library shows the Library tab in the panel; an Escape in its search field with text clears the text and stops
// there (the field handles it first); the Import sheet takes the panel until closed.
// v16.4: More shows the More tab in the panel (its pages too); the Visuals sheet takes the panel until closed.

import React, { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { ViewBoundary } from '../ErrorBoundary';
import { overlayDepth } from '../ui/overlayStack';
import { useActions, useShell } from './contexts';
import { countRender } from './devRenders';
import SideNav from './SideNav';
import DesktopTransport from './DesktopTransport';
import SheetHost from './SheetHost';
import PlaylistDialogs from './playlists/PlaylistDialogs';
import MixesTab from './mixes/MixesTab';
import MoreTab from './more/MoreTab';
import LayersTab from './layers/LayersTab';
import LibraryTab from './library/LibraryTab';
import { TabCrash, TransportCrash } from './fallbacks';
import { focusViewHeading } from './PhoneShell';

const DesktopShell = () => {
  countRender('DesktopShell');
  const { tab, sheet, zen, rootRef } = useShell();
  const reduced = usePrefersReducedMotion();
  const actions = useActions();
  // v16.1: the Add to playlist sheet is modal, as the menu (the panel keeps showing what it showed).
  const panelSheet = sheet && sheet !== 'menu' && sheet !== 'playlist-add' ? sheet : null;
  const stubOpen = !panelSheet && tab !== 'now';

  // Escape closes a section's panel (a sheet's panel closes itself: components/ui/Sheet.tsx).
  useEffect(() => {
    if (!stubOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (overlayDepth() > 0 || document.querySelector('[data-testid="output-sheet"]')) return;
      // A search field with text clears first (its own handler stops the event; this is the second guard).
      const field = document.activeElement;
      if (field instanceof HTMLInputElement && field.type === 'search' && field.value) return;
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
    <div
      ref={rootRef}
      inert={zen.hidden}
      data-testid="new-shell"
      data-shell="desktop"
      className={
        !zen.hidden
          ? 'fixed inset-0 z-10 pointer-events-none text-ink font-sans'
          : reduced
            ? 'fixed inset-0 z-10 pointer-events-none text-ink font-sans opacity-0'
            : 'fixed inset-0 z-10 pointer-events-none text-ink font-sans opacity-0 transition-opacity duration-slow'
      }
    >
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
                render={() => tab === 'library' && <LibraryTab inPanel />}
              />
              <ViewBoundary
                name="tab-mixes"
                fallback={(api) => (tab === 'mixes' ? <TabCrash api={api} inPanel /> : null)}
                render={() => tab === 'mixes' && <MixesTab inPanel />}
              />
              <ViewBoundary
                name="tab-layers"
                fallback={(api) => (tab === 'layers' ? <TabCrash api={api} inPanel /> : null)}
                render={() => tab === 'layers' && <LayersTab inPanel />}
              />
              <ViewBoundary
                name="more"
                fallback={(api) => (tab === 'more' ? <TabCrash api={api} inPanel /> : null)}
                render={() => tab === 'more' && <MoreTab inPanel />}
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
      {sheet === 'menu' || sheet === 'playlist-add' ? <SheetHost presentation="sheet" only="menu" /> : null}
      <PlaylistDialogs />
    </div>
  );
};

export default React.memo(DesktopShell);
