// components/shell/more/SafetyPage.tsx (v16.4, More › Safety & comfort; mockups safety-phone, safety-statement-phone)
//
// Safety & comfort, top to bottom:
//   1. Stop all sound (Emergency Stop's body, actions.stopAll: the layers fall in 0.1 s, then the pinned pausePlayback),
//      with the ⋯ row's words under it;
//   2. Comfort: Music only (the same action and state as Layers' switch, MUSIC_ONLY_DESCRIPTION verbatim), Pause visuals
//      (the Visuals sheet's switch, the same state), Keep screen awake (new: the wake lock's gate, both layouts), and
//      the comfort line COMFORT_LEVELS verbatim;
//   3. Safety statement › (StatementPage): the first-run disclaimer's six sections and liability line, the same JSX
//      the modal renders (components/more/SafetyStatement.tsx), plus its version line. Reading it never touches the
//      accepted version.
// React.memo; it reads no clock, so playback re-renders nothing here.

import React, { useMemo } from 'react';
import { OctagonX, Shield } from 'lucide-react';
import Toggle from '../../ui/Toggle';
import ListRow from '../../ui/ListRow';
import { StatementLiability, StatementSections } from '../../more/SafetyStatement';
import { useActions, useMore, useSound, useVisuals } from '../contexts';
import { countRender } from '../devRenders';
import { MUSIC_ONLY_DESCRIPTION } from '../layers/soundModel';
import { COMFORT_LEVELS } from '../layers/layersModel';
import { PAUSE_VISUALS_LABEL, PAUSE_VISUALS_RECORDING, pauseVisualsLine } from './visualsModel';
import { KEEP_AWAKE_LABEL, KEEP_AWAKE_LINE, STATEMENT_ROW_SUBTITLE, STOP_ALL_LINE, statementVersionLine } from './moreModel';
import type { MoreView } from './moreModel';

const SafetyPage = ({ go }: { go: (v: MoreView) => void }) => {
  countRender('SafetyPage');
  const actions = useActions();
  const { musicOnly } = useSound();
  const { userPaused, visualRecording } = useVisuals();
  const { keepAwake } = useMore();
  const h = useMemo(() => ({ musicOnly: () => actions.toggleMusicOnly() }), [actions]);
  return (
    <div data-testid="more-safety" className="px-4 py-3 space-y-3">
      <button
        type="button"
        onClick={actions.stopAll}
        data-testid="safety-stop-all"
        className="w-full min-h-touch px-4 rounded-control border border-status-error/60 bg-status-error/10 hover:bg-status-error/20 text-sm font-semibold text-ink-strong flex items-center justify-center gap-2 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        <OctagonX size={20} className="stroke-status-error" aria-hidden="true" />
        Stop all sound
      </button>
      <p className="text-xs text-center text-ink-muted leading-snug">{STOP_ALL_LINE}</p>
      <section aria-labelledby="safety-h-comfort" data-testid="safety-comfort" className="rounded-card bg-surface-panel border border-line p-4">
        <h2 id="safety-h-comfort" className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
          Comfort
        </h2>
        <div className="mt-2 space-y-3">
          <Toggle label="Music only" description={MUSIC_ONLY_DESCRIPTION} checked={musicOnly} onChange={h.musicOnly} data-testid="safety-music-only" />
          <Toggle
            label={PAUSE_VISUALS_LABEL}
            description={pauseVisualsLine(userPaused)}
            note={userPaused && visualRecording ? PAUSE_VISUALS_RECORDING : null}
            checked={userPaused}
            onChange={actions.setVisualsPaused}
            data-testid="safety-pause-visuals"
          />
          <Toggle label={KEEP_AWAKE_LABEL} description={KEEP_AWAKE_LINE} checked={keepAwake} onChange={actions.setKeepAwake} data-testid="safety-keep-awake" />
          <p className="text-xs text-ink-muted leading-snug">{COMFORT_LEVELS}</p>
        </div>
      </section>
      <div className="rounded-card bg-surface-panel border border-line overflow-hidden">
        <ListRow
          title="Safety statement"
          subtitle={STATEMENT_ROW_SUBTITLE}
          icon={<Shield size={20} />}
          chevron
          onClick={() => go('statement')}
          data-testid="safety-statement-row"
        />
      </div>
    </div>
  );
};

/** The statement page: the modal's own sections and liability line, in their classic look, and the version line. */
export const StatementPage = React.memo(() => {
  countRender('StatementPage');
  const { statementVersion } = useMore();
  return (
    <div data-testid="more-statement" className="px-4 py-4 space-y-5 text-left text-sm text-slate-400 leading-relaxed">
      <div data-testid="statement-sections" className="space-y-5">
        <StatementSections />
      </div>
      <div data-testid="statement-liability">
        <StatementLiability />
      </div>
      <p data-testid="statement-version" className="text-xs text-ink-faint">
        {statementVersionLine(statementVersion)}
      </p>
    </div>
  );
});

export default React.memo(SafetyPage);
