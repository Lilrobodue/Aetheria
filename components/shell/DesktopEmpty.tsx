// components/shell/DesktopEmpty.tsx (v16.8, decision 4 A)
//
// The desktop's first run with an empty library: the phone's empty state ("Your library is empty" · Import music, the
// same component and words as NowPlaying's) on a card over the visuals: right of the side nav, above the transport.
// DesktopShell shows it on Now Playing with no panel open and the shell not hidden by Zen; it goes with the first import
// (the library's count), or as soon as a panel opens. Its own region (fallback: nothing).
// React.memo; it reads the library summary and the list's loading flag, never the clock.
// Review fixes: it waits for the saved library to be read back (no "Your library is empty" for the moment a restore
// takes, B2); and it keeps clear of the notices stack (fixed at the right, 28rem wide, 1rem from the edge: 29rem), so
// its Import music button is never under a notice, at 1024 x 600 with the moved-over card and Ready Offline too (B1).

import React from 'react';
import EmptyState from '../ui/EmptyState';
import { useActions, useLibraryList, useLibrarySummary } from './contexts';
import { countRender } from './devRenders';
import { useNavAway, useNavSliding } from './navStore';

const DesktopEmpty = ({ show }: { show: boolean }) => {
  countRender('DesktopEmpty');
  const lib = useLibrarySummary();
  const { loading } = useLibraryList();
  const actions = useActions();
  const navAway = useNavAway();
  const sliding = useNavSliding();
  if (!show || loading || lib.count !== 0) return null;
  return (
    // v16.8.9: beside the menu, or from the window's edge while it is away.
    // Review round 1: it glides with the menu (only while it slides), not a jump.
    <div className={(navAway ? 'absolute left-0 right-[29rem] top-0 bottom-transport flex items-center justify-center p-6 pointer-events-none' : 'absolute left-[72px] xl:left-[200px] right-[29rem] top-0 bottom-transport flex items-center justify-center p-6 pointer-events-none') + (sliding ? ' transition-[left] duration-[220ms] ease-emphasized motion-reduce:transition-none' : '')}>
      <div data-testid="desktop-empty" className="w-full max-w-sm rounded-card bg-surface-panel border border-line shadow-overlay pointer-events-auto">
        <EmptyState
          title="Your library is empty"
          body="Import music from this device. Aetheria keeps its own copy here; your files are not changed."
          actionLabel="Import music"
          onAction={() => actions.openImport()}
        />
      </div>
    </div>
  );
};

export default React.memo(DesktopEmpty);
