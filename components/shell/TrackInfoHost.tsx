// components/shell/TrackInfoHost.tsx (v16.5, Advanced; v16.4 spec §3.10)
//
// The new layout's ⋯ › Track info: the honest TrackInfoDialog (the Library row's, v15.7: "an assigned crystal, not a
// measured pitch"; v16.5: the experimental section behind Advanced's switch) for the playing track, in place of
// classic's readout, which showed Deep Scan's scores unlabelled. App's trackInfo action sets ShellValue.trackInfoId
// (with nothing loaded it shows classic's own toast instead). AppShell-level, so the dialog never sits on a sheet:
// the menu closes first. Classic's Current Track Analysis button and readout are unchanged.

import React from 'react';
import { useActions, useLibraryList, useShell } from './contexts';
import TrackInfoDialog from './library/TrackInfoDialog';

const TrackInfoHost = () => {
  const { trackInfoId } = useShell();
  const { songs } = useLibraryList();
  const actions = useActions();
  if (!trackInfoId) return null;
  const song = songs.find((s) => s.id === trackInfoId);
  return song ? <TrackInfoDialog song={song} onClose={actions.closeTrackInfo} /> : null;
};

export default React.memo(TrackInfoHost);
