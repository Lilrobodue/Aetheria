// components/shell/RecButton.tsx (v15.5, the new layout beta)
//
// While a recording runs, the new layout shows it: a REC pill in Now Playing's top bar, on the Car screen and on the
// desktop transport. Nothing while no recording runs.
// v16.5 (decision 4 A): `mode`. 'open' (the default: the top bar, the phone's mini-player on every other tab, the
// desktop transport) opens the Record sheet, with the time so far and Stop and save, so a near-miss of Play can't end a
// recording; 'stop' (the Car screen: a driver needs one tap) stops it at once through classic's own stopRecording, as
// v15.5 did. The name says what a tap does.

import React from 'react';
import { useActions, usePlayer } from './contexts';
import { recPillLabel } from './more/recordModel';
import type { RecPillMode } from './more/recordModel';

const RecButton = ({ mode = 'open' }: { mode?: RecPillMode }) => {
  const { isRecording } = usePlayer();
  const actions = useActions();
  if (!isRecording) return null;
  const stop = mode === 'stop';
  return (
    <button
      type="button"
      aria-label={recPillLabel(mode)}
      title={stop ? 'Stop recording' : 'Recording: open Record'}
      data-testid={stop ? 'rec-stop' : 'rec-open'}
      onClick={stop ? actions.stopRecording : actions.openRecord}
      className="shrink-0 h-touch px-3 inline-flex items-center gap-1.5 rounded-pill border border-line-strong bg-surface-panel/80 text-caption font-bold uppercase tracking-wider text-ink-strong hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
    >
      <span aria-hidden="true" className="w-2 h-2 rounded-pill bg-status-error" />
      Rec
    </button>
  );
};

export default React.memo(RecButton);
