// components/shell/library/TrackInfoDialog.tsx (v15.7, the Library tab; mockup library-track-info-phone)
//
// Track info for any library track (the ⋯ menu's Track info shows only the playing one): a kit Dialog "Track info"
// with Copy and Close (ReadoutActions). The body is the track's name and a definition list from the pure
// trackInfoRows: Length, Crystal (and where it came from: an assigned crystal, not a measured pitch), Key, Visual sync,
// File and Added (from the id's import time). Copy puts the same rows on the clipboard, on a tap only. No scan date:
// none is stored, and v15.7 adds no Song field. The body is a `library-menu` region.

import React from 'react';
import Dialog, { ReadoutActions } from '../../ui/Dialog';
import { PanelFallback, ViewBoundary } from '../../ErrorBoundary';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { trackInfoRows, trackInfoText } from './libraryModel';

interface TrackInfoDialogProps {
  song: Song;
  onClose: () => void;
}

const TrackInfoBody = ({ song }: { song: Song }) => {
  countRender('TrackInfo');
  const rows = trackInfoRows(song, Date.now());
  return (
    <div data-testid="track-info-body">
      <p className="text-base text-ink-strong break-words">{song.name}</p>
      <dl className="mt-2">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[104px_1fr] gap-3 py-2 border-b border-line">
            <dt className="text-ink-muted">{r.label}</dt>
            <dd className="min-w-0 text-ink-strong break-words">
              {r.value}
              {r.note ? <span className="block text-xs text-ink-faint">{r.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

const TrackInfoDialog = ({ song, onClose }: TrackInfoDialogProps) => (
  <Dialog
    open
    title="Track info"
    onClose={onClose}
    actions={<ReadoutActions body={trackInfoText(song, Date.now())} onClose={onClose} />}
    data-testid="track-info-dialog"
  >
    <ViewBoundary
      name="library-menu"
      fallback={(api) => (
        <PanelFallback text="Track info hit a problem." switchedOff={api.switchedOff} copyDetails={api.copyDetails} buttonRef={api.buttonRef} onRetry={api.retry} />
      )}
      render={() => <TrackInfoBody song={song} />}
    />
  </Dialog>
);

export default React.memo(TrackInfoDialog);
