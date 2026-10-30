// components/shell/AppShell.tsx (v15.5, the new layout beta; v15.6 adds Zen's reveal)
//
// The new layout's root: the phone shell or the desktop shell (App measures which: 1024 × 600 and up is the desktop),
// under the `shell` region, whose fallback offers "Use the classic layout" and the basic transport, and the
// track-change announcer. React.memo with no props: App's renders (4×/s while playing) stop here; below, each view
// reads only the contexts it needs.
//
// The visualizer is NOT in here: it stays in App's tree, before the layout branch, so a layout switch never remounts
// it (layout.spec 6) and the heat guard (VisualsPause) pauses it without touching it.
//
// v15.6: while Zen hides the controls, ZenReveal comes first ("Show controls", then the surface that turns the first
// tap into a reveal). It sits outside the shell region and outside the inert shell root, as the announcer does, so the
// shell's own fallback is covered by it too (the first tap only reveals).
// v16.5: TrackInfoHost, the ⋯ menu's honest Track info for the playing track (a kit Dialog, modal on both shells).

import React from 'react';
import { ViewBoundary } from '../ErrorBoundary';
import { useShell } from './contexts';
import { countRender } from './devRenders';
import PhoneShell from './PhoneShell';
import DesktopShell from './DesktopShell';
import TrackAnnouncer from './TrackAnnouncer';
import ZenReveal from './ZenReveal';
import TrackInfoHost from './TrackInfoHost';
import { ShellCrash } from './fallbacks';

const AppShell = () => {
  countRender('AppShell');
  const { phoneShell, zen } = useShell();
  return (
    <>
      {zen.hidden ? <ZenReveal /> : null}
      <ViewBoundary
        name="shell"
        fallback={(api) => <ShellCrash api={api} />}
        render={() => (
          <>
            {phoneShell ? <PhoneShell /> : <DesktopShell />}
            <TrackAnnouncer />
            <TrackInfoHost />
          </>
        )}
      />
    </>
  );
};

export default React.memo(AppShell);
