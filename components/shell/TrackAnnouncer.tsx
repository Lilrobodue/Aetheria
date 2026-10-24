// components/shell/TrackAnnouncer.tsx (v15.5, the new layout beta)
//
// One polite live region that reads "Now playing: <title>" when the track changes (the I13 exception to "no new live
// regions"). Its text changes only with the track, never on a time tick or a play/pause, so nothing else is announced.

import React from 'react';
import { usePlayer } from './contexts';

const TrackAnnouncer = () => {
  const { hasTrack, title } = usePlayer();
  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-testid="track-announcer" className="sr-only">
      {hasTrack && title ? `Now playing: ${title}` : ''}
    </div>
  );
};

export default React.memo(TrackAnnouncer);
