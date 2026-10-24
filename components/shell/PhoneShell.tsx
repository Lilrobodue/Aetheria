// components/shell/PhoneShell.tsx (v15.5, the new layout beta)
//
// The phone shell (mockups np-phone-A, np-phone-car, mini-player-library): on Now Playing the top bar, the visualizer
// showing through, and Now Playing at the bottom (or the Car screen while Output is Car); on the other four tabs their
// solid view, the 64 px mini-player, and always the five-tab bar. Each view is its own region (spec §3.10), mounted
// only while shown (its condition is inside the region's `render`, so the region itself stays mounted and keeps its
// strikes). The Spectrum lens's bottom inset is measured from Now Playing's panel, else from this bottom stack.
// A tab change moves the focus to the new view's heading.

import React, { useEffect, useRef } from 'react';
import { ViewBoundary } from '../ErrorBoundary';
import { useShell } from './contexts';
import { countRender } from './devRenders';
import TopBar from './TopBar';
import TabBar from './TabBar';
import NowPlaying from './NowPlaying';
import CarNowPlaying from './CarNowPlaying';
import MiniPlayer from './MiniPlayer';
import TabStub from './tabs/TabStub';
import MoreStub from './tabs/MoreStub';
import SheetHost from './SheetHost';
import { NowPlayingCrash, TabCrash, TransportCrash } from './fallbacks';

export function focusViewHeading(): void {
  const h = document.querySelector('[data-testid="new-shell"] [data-view-heading]');
  if (h instanceof HTMLElement) h.focus();
}

const PhoneShell = () => {
  countRender('PhoneShell');
  const { tab, car, sheet, barRef } = useShell();
  const now = tab === 'now';
  const nowPanel = now && !car;

  const shownTab: { current: string } = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    focusViewHeading();
  }, [tab]);

  return (
    <div data-testid="new-shell" data-shell="phone" className="fixed inset-0 z-10 flex flex-col pointer-events-none text-ink font-sans">
      {nowPanel ? <TopBar /> : null}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <ViewBoundary
          name="now-playing"
          fallback={(api) => (now ? <NowPlayingCrash api={api} /> : null)}
          render={() => now && (car ? <CarNowPlaying /> : <NowPlaying />)}
        />
        <ViewBoundary
          name="tab-library"
          fallback={(api) => (tab === 'library' ? <TabCrash api={api} inPanel={false} /> : null)}
          render={() => tab === 'library' && <TabStub tab="library" />}
        />
        <ViewBoundary
          name="tab-mixes"
          fallback={(api) => (tab === 'mixes' ? <TabCrash api={api} inPanel={false} /> : null)}
          render={() => tab === 'mixes' && <TabStub tab="mixes" />}
        />
        <ViewBoundary
          name="tab-layers"
          fallback={(api) => (tab === 'layers' ? <TabCrash api={api} inPanel={false} /> : null)}
          render={() => tab === 'layers' && <TabStub tab="layers" />}
        />
        <ViewBoundary
          name="more"
          fallback={(api) => (tab === 'more' ? <TabCrash api={api} inPanel={false} /> : null)}
          render={() => tab === 'more' && <MoreStub />}
        />
      </div>
      <div ref={nowPanel ? undefined : barRef} data-testid="phone-bottom" className="shrink-0 pointer-events-auto">
        <ViewBoundary
          name="mini-player"
          fallback={(api) => (now ? null : <TransportCrash api={api} what="The mini-player" slot />)}
          render={() => !now && <MiniPlayer />}
        />
        <TabBar />
      </div>
      {sheet ? <SheetHost presentation="sheet" /> : null}
    </div>
  );
};

export default React.memo(PhoneShell);
