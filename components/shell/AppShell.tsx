// components/shell/AppShell.tsx (v15.5, the new layout beta)
//
// The new layout's root: the phone shell or the desktop shell (App measures which: 1024 × 600 and up is the desktop),
// under the `shell` region, whose fallback offers "Use the classic layout" and the basic transport, and the
// track-change announcer. React.memo with no props: App's renders (4×/s while playing) stop here; below, each view
// reads only the contexts it needs.
//
// The visualizer is NOT in here: it stays in App's tree, before the layout branch, so a layout switch never remounts
// it (layout.spec 6) and the heat guard (VisualsPause) pauses it without touching it.

import React from 'react';
import { ViewBoundary } from '../ErrorBoundary';
import { useShell } from './contexts';
import { countRender } from './devRenders';
import PhoneShell from './PhoneShell';
import DesktopShell from './DesktopShell';
import TrackAnnouncer from './TrackAnnouncer';
import { ShellCrash } from './fallbacks';

const AppShell = () => {
  countRender('AppShell');
  const { phoneShell } = useShell();
  return (
    <ViewBoundary
      name="shell"
      fallback={(api) => <ShellCrash api={api} />}
      render={() => (
        <>
          {phoneShell ? <PhoneShell /> : <DesktopShell />}
          <TrackAnnouncer />
        </>
      )}
    />
  );
};

export default React.memo(AppShell);
