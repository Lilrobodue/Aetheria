// components/shell/RecButton.tsx (v15.5, the new layout beta)
//
// While a recording runs (started in classic's Record dialog), the new layout shows it: a REC pill that stops it on a
// tap, through classic's own stopRecording (App's, via the actions). In Now Playing's top bar, on the Car screen, in
// More and on the desktop transport. Nothing while no recording runs.

import React from 'react';
import { useActions, usePlayer } from './contexts';

const RecButton = () => {
  const { isRecording } = usePlayer();
  const actions = useActions();
  if (!isRecording) return null;
  return (
    <button
      type="button"
      aria-label="Rec, stop recording"
      title="Stop recording"
      data-testid="rec-stop"
      onClick={actions.stopRecording}
      className="shrink-0 h-touch px-3 inline-flex items-center gap-1.5 rounded-pill border border-line-strong bg-surface-panel/80 text-caption font-bold uppercase tracking-wider text-ink-strong hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
    >
      <span aria-hidden="true" className="w-2 h-2 rounded-pill bg-status-error" />
      Rec
    </button>
  );
};

export default React.memo(RecButton);
