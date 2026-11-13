// components/shell/DesktopShell.tsx (v15.5, the new layout beta)
//
// The desktop shell (1024 px wide and 600 px tall or more; mockup desktop-shell): the 72 px side nav, a 420 px panel,
// the 88 px transport (v16.8.7: 120 px, with its song row). The panel shows the open sheet (Sound, Crystal, Walks:
// non-modal, so the transport stays usable) or the active section's stub; on Now Playing with no sheet it is closed and
// the visualizer fills the space.
// Escape closes it. The ⋯ menu is a modal sheet. The heat guard never pauses the visualizer here.
// v15.6: Layers shows the Layers tab in the panel (inPanel); Zen hides this root (nav and transport) with the panel
// closed, as on the phone: inert and transparent, a mouse move brings it back.
// v15.7: Library shows the Library tab in the panel; an Escape in its search field with text clears the text and stops
// there (the field handles it first); the Import sheet takes the panel until closed.
// v16.4: More shows the More tab in the panel (its pages too); the Visuals sheet takes the panel until closed.
// v16.7 (desktop polish): the panel sits beside the side nav at every width (x = 72, and 200 from 1280 px where the nav
// is labelled: CSS only). Two skip links come first (Skip to the player; Skip to the panel while one is open). The
// keyboard shortcuts' leaf (DesktopKeys) lives here, in its own region. A tab change still focuses the view's heading,
// unless the focus is already inside the panel ("/" puts it in the Library's search field). As Zen hides the shell, any
// tooltip hides with it. Leaving this shell (classic, a peek, a phone-sized window) leaves the full screen entered here.
// v16.8.9 (the side menu away; decisions A, 2026-11-13): while the menu is away (navStore), the logo floats at its place
// (nav-show: "Show the menu", C), above the panel, right after the skip links in the tab order; an open panel slides to
// the window's edge (left 0) and, through one rule in src/index.css ([data-nav-away]), its header makes room for the
// logo; the empty-library card moves left too.
// v16.8 (decision 4 A): an empty library gets the phone's "Import music" card over the visuals (DesktopEmpty, its own
// region), on Now Playing with no panel open and the shell showing; it goes with the first import.

import React, { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { ViewBoundary } from '../ErrorBoundary';
import { overlayDepth } from '../ui/overlayStack';
import Tooltip, { hideTooltips } from '../ui/Tooltip';
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
import DesktopKeys from './shortcuts/DesktopKeys';
import DesktopEmpty from './DesktopEmpty';
import { leaveIfEnteredHere } from './shortcuts/immersive';
import { Activity as PulseIcon } from 'lucide-react';
import { SIDE_NAV_ID, showNavNow, useNavAway, useNavSliding } from './navStore';
import { useKeysOn } from './shortcuts/shortcutsStore';
import { tipKeys } from './shortcuts/keysModel';

/** v16.8.9: the panel's slide, only while the menu hides or shows (never on a resize across 1280 px). */
const PANEL_SLIDE = ' transition-[left] duration-[220ms] ease-emphasized motion-reduce:transition-none';

const SKIP =
  'sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-toast focus:px-4 focus:min-h-touch focus:rounded-control focus:bg-surface-panel focus:text-ink focus:pointer-events-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

/** Skip to the panel: the open sheet's or the section's heading. */
function focusPanelHeading(): void {
  const h = document.querySelector('[data-testid="desktop-panel"] [data-view-heading], [data-testid="desktop-panel"] h2[tabindex="-1"]');
  if (h instanceof HTMLElement) h.focus();
}
function focusPlay(): void {
  const play = document.querySelector('[data-testid="new-shell"] [data-testid="desktop-play"]');
  if (play instanceof HTMLElement) play.focus();
}

const DesktopShell = () => {
  countRender('DesktopShell');
  const { tab, sheet, zen, rootRef } = useShell();
  const reduced = usePrefersReducedMotion();
  const actions = useActions();
  const navIsAway = useNavAway();
  const navSliding = useNavSliding();
  const keys = useKeysOn();
  // v16.1: the Add to playlist sheet is modal, as the menu (the panel keeps showing what it showed).
  const panelSheet = sheet && sheet !== 'menu' && sheet !== 'playlist-add' ? sheet : null;
  const stubOpen = !panelSheet && tab !== 'now';

  // Escape closes a section's panel (a sheet's panel closes itself: components/ui/Sheet.tsx).
  useEffect(() => {
    if (!stubOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (e.repeat) return; // v16.7: a held Esc closes one thing (a sheet over this panel), never this too
      if (overlayDepth() > 0 || document.querySelector('[data-testid="output-sheet"]')) return;
      // A search field with text clears first (its own handler stops the event; this is the second guard).
      const field = document.activeElement;
      if (field instanceof HTMLInputElement && field.type === 'search' && field.value) return;
      e.preventDefault(); // v16.7: this Escape is spent (the desktop keys leave it alone, whichever listener ran first)
      actions.setTab('now');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stubOpen]);

  const shownTab: { current: string } = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    if (tab === 'now') return;
    // v16.7: "/" has already put the focus in the Library's search field: it stays there.
    const panel = document.querySelector('[data-testid="desktop-panel"]');
    if (panel && panel.contains(document.activeElement)) return;
    focusViewHeading();
  }, [tab]);

  // v16.7: Zen hides the shell (inert): a tooltip showing goes with it.
  useEffect(() => {
    if (zen.hidden) hideTooltips();
  }, [zen.hidden]);
  // v16.7: classic has no way out of a full screen entered here.
  useEffect(() => () => leaveIfEnteredHere(), []);

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
      <button type="button" data-testid="skip-player" onClick={focusPlay} className={SKIP}>
        Skip to the player
      </button>
      {panelSheet || stubOpen ? (
        <button type="button" data-testid="skip-panel" onClick={focusPanelHeading} className={SKIP}>
          Skip to the panel
        </button>
      ) : null}
      {navIsAway ? (
        // v16.8.9: the logo left behind, where the menu's own logo was (its 44 px box at 8 px down; 14 px in from the rail's
        // edge below 1280, 12 from 1280), above an open panel (z), so a click or C brings the menu back.
        <div className="absolute top-2 left-[14px] xl:left-3 z-[5] pointer-events-auto">
          <Tooltip label="Show the menu" keys={keys ? tipKeys('menu') : null} side="right">
            <button
              type="button"
              aria-label="Show the menu"
              aria-expanded="false"
              aria-controls={SIDE_NAV_ID}
              data-testid="nav-show"
              data-focus-fallback=""
              onClick={showNavNow}
              className="group w-11 h-11 rounded-pill flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
            >
              <span aria-hidden="true" className="w-9 h-9 rounded-pill bg-gold-500 group-hover:bg-gold-400 flex items-center justify-center text-black shadow-raised transition-colors duration-fast">
                <PulseIcon size={20} />
              </span>
            </button>
          </Tooltip>
        </div>
      ) : null}
      <SideNav />
      {panelSheet || stubOpen ? (
        <div
          data-testid="desktop-panel"
          data-nav-away={navIsAway ? 'true' : undefined}
          data-nav-sliding={navSliding ? 'true' : undefined}
          className={
            (navIsAway
              ? 'absolute left-0 top-0 bottom-transport w-[420px] pointer-events-auto'
              : 'absolute left-[72px] xl:left-[200px] top-0 bottom-transport w-[420px] pointer-events-auto') + (navSliding ? PANEL_SLIDE : '')
          }
        >
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
        name="desktop-empty"
        fallback={() => null}
        render={() => <DesktopEmpty show={tab === 'now' && !panelSheet && !stubOpen && !zen.hidden} />}
      />
      <ViewBoundary
        name="desktop-transport"
        fallback={(api) => <TransportCrash api={api} what="The player bar" slot={false} />}
        render={() => <DesktopTransport />}
      />
      {sheet === 'menu' || sheet === 'playlist-add' ? <SheetHost presentation="sheet" only="menu" /> : null}
      <PlaylistDialogs />
      <ViewBoundary name="desktop-keys" fallback={() => null} render={() => <DesktopKeys />} />
    </div>
  );
};

export default React.memo(DesktopShell);
