// components/shell/library/TrackInfoDialog.tsx (v15.7, the Library tab; mockup library-track-info-phone)
//
// Track info for any library track (the ⋯ menu's Track info shows only the playing one): a kit Dialog "Track info"
// with Copy and Close (ReadoutActions). The body is the track's name and a definition list from the pure
// trackInfoRows: Length, Crystal (and where it came from: an assigned crystal, not a measured pitch), Key, Visual sync,
// File and Added (from the id's import time). Copy puts the same rows on the clipboard, on a tap only. No scan date:
// none is stored, and v15.7 adds no Song field. The body is a `library-menu` region.
// v16.5 (Advanced's "Show experimental scan scores", mockup trackinfo-experimental-phone): while the switch is on, a
// section "Experimental scan scores" follows, with scanScores.ts's lead, names and notes (scanScoresModel.scanScoreRows):
// never the safety level or the recommended volume. Copy includes it. The new layout's ⋯ › Track info opens this dialog
// too, for the playing track (TrackInfoHost), in place of classic's readout.

import React from 'react';
import Dialog, { ReadoutActions } from '../../ui/Dialog';
import { PanelFallback, ViewBoundary } from '../../ErrorBoundary';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { useMore, useShell } from '../contexts';
import { EvidenceOrigin } from '../../guide/evidenceLink';
import { trackInfoRows, trackInfoText } from './libraryModel';
import { SCAN_SECTION_LEAD, SCAN_SECTION_TITLE, scanScoreRows, scanScoreText } from './scanScoresModel';
import EvidenceTag from '../../ui/EvidenceTag';

interface TrackInfoDialogProps {
  song: Song;
  onClose: () => void;
}

const TrackInfoBody = ({ song, scores }: { song: Song; scores: boolean }) => {
  countRender('TrackInfo');
  const rows = trackInfoRows(song, Date.now());
  const scoreRows = scores ? scanScoreRows(song) : [];
  return (
    <div data-testid="track-info-body">
      <p className="text-base text-ink-strong break-words">{song.name}</p>
      <dl className="mt-2">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[104px_1fr] gap-3 py-2 border-b border-line">
            <dt className="text-ink-muted">{r.label}</dt>
            <dd className="min-w-0 text-ink-strong break-words">
              {r.value}
              {r.note && r.tag ? (
                // v16.6: an assigned crystal is a design choice, not a measured pitch: the note carries its tag.
                <div data-evidence={r.tag}>
                  <span className="block text-xs text-ink-faint">{r.note}</span>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-3">
                    <EvidenceTag tier={r.tag} />
                  </div>
                </div>
              ) : r.note ? (
                <span className="block text-xs text-ink-faint">{r.note}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {scoreRows.length ? (
        <section aria-labelledby="track-info-h-scores" data-testid="track-info-scores" data-evidence="design" className="mt-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
            <h3 id="track-info-h-scores" className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
              {SCAN_SECTION_TITLE}
            </h3>
            <EvidenceTag tier="design" />
          </div>
          <p className="mt-1 text-xs text-ink-muted leading-snug">{SCAN_SECTION_LEAD}</p>
          <dl className="mt-1">
            {scoreRows.map((r) => (
              <div key={r.label} className="grid grid-cols-[104px_1fr] gap-3 py-2 border-b border-line">
                <dt className="text-ink-muted">{r.label}</dt>
                <dd className="min-w-0 text-ink-strong break-words">
                  {r.value}
                  {r.note ? <span className="block text-xs text-ink-faint">{r.note}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
};

const TrackInfoDialog = ({ song, onClose }: TrackInfoDialogProps) => {
  const { scanScores } = useMore();
  // v16.6 (review D1): its tags lead back here, whichever host opened it (⋯ › Track info, a Library row, a playlist's
  // entry): the Guide's "Back to Track info" reopens it for this track, on the tab it was on.
  const { tab } = useShell();
  const origin = React.useMemo(() => ({ tab, sheet: null, label: 'Track info', trackInfo: song.id }), [tab, song.id]);
  const extra = scanScores ? scanScoreText(song) : '';
  return (
    <Dialog
      open
      title="Track info"
      onClose={onClose}
      actions={<ReadoutActions body={extra ? `${trackInfoText(song, Date.now())}

${extra}` : trackInfoText(song, Date.now())} onClose={onClose} />}
      data-testid="track-info-dialog"
    >
      <ViewBoundary
        name="library-menu"
        fallback={(api) => (
          <PanelFallback text="Track info hit a problem." switchedOff={api.switchedOff} copyDetails={api.copyDetails} buttonRef={api.buttonRef} onRetry={api.retry} />
        )}
        render={() => (
          <EvidenceOrigin.Provider value={origin}>
            <TrackInfoBody song={song} scores={scanScores} />
          </EvidenceOrigin.Provider>
        )}
      />
    </Dialog>
  );
};

export default React.memo(TrackInfoDialog);
