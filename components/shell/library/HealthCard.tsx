// components/shell/library/HealthCard.tsx (v15.7, the Library tab, stage B; mockups library-phone-A-top,
// library-health-phone; decision 5, option A)
//
// The library at a glance, with the existing passes one tap away: Crystals (Assign = Auto-Distribute), Keys and visual
// sync (Analyse tracks), Deep Scan (optional), the track lengths still being read, and stored tracks the library doesn't
// list (Review: the Import sheet's Recover offer). Each count uses its button's own rule (libraryModel.healthModel), so a
// number never promises what the button won't do; a blocked button stays tappable (aria-disabled) and the existing
// function says why in a toast. Nothing new runs: the card reads existing state and calls existing functions.
// Open while there is something to do or a pass runs; one line ("All set · Deep Scan optional") otherwise, which a tap
// opens for the session (App's libraryViewRef). The footer peeks into classic for Clear and the diagnostics.
// v16.1 (spec §3.14): the footer's Library tools, inside the fold: Diagnostics (classic's readout) and Clear library…
// (ClearLibraryDialog: the saved playlists stay unless its box is ticked); the peek stays, reworded.
// Assign asks first only when crystals tracks already have would change (v15.8: the plan, computed on the tap).
// React.memo with no props; it reads the library and the passes' state, never the time.

import React, { useMemo, useState } from 'react';
import { Activity, Check, ChevronDown, Trash2 } from 'lucide-react';
import { useActions, useLibraryList, useLibraryStatus, useShell } from '../contexts';
import { countRender } from '../devRenders';
import AssignCrystalsDialog from './AssignCrystalsDialog';
import ClearLibraryDialog from './ClearLibraryDialog';
import { HEALTH_FOOTER, assignNeedsConfirm, healthModel, libraryHealth } from './libraryModel';
import { planAssign } from '../../../utils/mix/distribution';
import type { AssignPlan } from '../../../utils/mix/distribution';
import type { HealthLine } from './libraryModel';

const BUTTON = 'shrink-0 min-h-touch px-3 rounded-control bg-surface-raised border border-line-strong text-sm text-ink hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const BUTTON_BLOCKED = 'shrink-0 min-h-touch px-3 rounded-control bg-surface-raised border border-line-strong text-sm text-ink opacity-40 cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const HealthCard = () => {
  countRender('HealthCard');
  const { songs } = useLibraryList();
  const st = useLibraryStatus();
  const actions = useActions();
  const { libraryViewRef, phoneShell } = useShell();
  const health = useMemo(() => libraryHealth(songs), [songs]);
  const model = healthModel({
    health,
    pass: st.pass,
    analyseCounts: st.analyseCounts,
    isScanning: st.isScanning,
    scanProgress: st.scanProgress,
    restoring: st.restoring,
    mobile: st.analyseMobile,
    durationsLeft: st.durationsLeft,
    orphans: st.orphans,
  });
  const [openPref, setOpenPref] = useState<boolean | null>(libraryViewRef.current.healthOpen);
  const open = openPref ?? model.autoOpen;
  const [confirming, setConfirming] = useState<AssignPlan | null>(null);
  const [clearing, setClearing] = useState(false);

  const run = (line: HealthLine) => {
    const a = line.action;
    if (!a) return;
    if (a.kind === 'assign') {
      // Blocked (Deep Scan runs): Auto-Distribute's own toast says why. When crystals tracks have would change: ask
      // first, with the plan's counts. Otherwise it runs at once (its notice, or its toast when there is nothing to do).
      const plan = a.blocked ? null : planAssign(songs);
      if (plan && assignNeedsConfirm(plan)) setConfirming(plan);
      else actions.assignCrystals();
    } else if (a.kind === 'analyse') actions.analyse();
    else if (a.kind === 'scan') actions.scan();
    else if (a.kind === 'scan-assigned') actions.scanAssigned();
    else if (a.kind === 'stop-scan') actions.stopScan();
    else {
      if (!phoneShell) libraryViewRef.current.refocus = 'review';
      actions.openImport('recover');
    }
  };

  if (!open) {
    return (
      <section aria-label="Library health" data-testid="library-health" data-open="false" className="mx-4 mb-3 rounded-card bg-surface-panel border border-line">
        <button
          type="button"
          aria-expanded="false"
          data-testid="library-health-toggle"
          onClick={() => {
            libraryViewRef.current.healthOpen = true;
            setOpenPref(true);
          }}
          className="w-full min-h-row px-4 flex items-center gap-3 text-left rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-widest text-ink-soft">Library health</span>
            <span className="block text-sm text-ink truncate">{model.folded}</span>
          </span>
          <ChevronDown size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="library-health-h" data-testid="library-health" data-open="true" className="mx-4 mb-3 rounded-card bg-surface-panel border border-line px-4 pt-3 pb-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="library-health-h" className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
          Library health
        </h2>
        <span data-testid="library-health-status" className="text-xs text-ink-muted">
          {model.status}
        </span>
      </div>
      <div className="mt-1">
        {model.lines.map((l) => (
          <React.Fragment key={l.id}>
            <div data-testid={`health-${l.id}`} className="flex items-center gap-3 min-h-14 py-1.5 border-t border-line first:border-t-0">
              <span aria-hidden="true" className="shrink-0 w-5 flex justify-center">
                {l.done ? <Check size={16} className="text-ink-muted" /> : <span className={l.todo ? 'w-2 h-2 rounded-pill bg-ink-soft' : 'w-2 h-2 rounded-pill bg-ink-faint'} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink-strong">{l.title}</span>
                <span data-testid={`health-${l.id}-line`} className="block text-xs text-ink-muted">
                  {l.line}
                </span>
                {l.sub ? <span className="block text-xs text-ink-faint">{l.sub}</span> : null}
              </span>
              {l.action ? (
                <button
                  type="button"
                  data-testid={`health-${l.id}-action`}
                  aria-disabled={l.action.blocked || undefined}
                  onClick={() => run(l)}
                  className={l.action.blocked ? BUTTON_BLOCKED : BUTTON}
                >
                  {l.action.label}
                </button>
              ) : null}
            </div>
            {l.progress !== undefined ? (
              <div aria-hidden="true" className="ml-8 -mt-1 mb-2 h-1 rounded-pill bg-surface-control">
                <div className="h-1 rounded-pill bg-ink-soft" style={{ width: `${Math.round(l.progress * 1000) / 10}%` }} />
              </div>
            ) : null}
          </React.Fragment>
        ))}
      </div>
      {/* v16.1 (spec §3.14): the Library tools, inside the card's fold: classic's diagnostics readout, and the new
          layout's own Clear (its dialog asks about the saved playlists). Then the classic peek, reworded. */}
      <div data-testid="library-tools" className="border-t border-line pt-3">
        <h3 className="text-caption font-semibold uppercase tracking-widest text-ink-faint">Library tools</h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="library-tools-diagnostics"
            onClick={actions.showDiagnostics}
            className="min-h-touch px-3 rounded-control bg-surface-raised border border-line-strong text-sm text-ink flex items-center justify-center gap-2 hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          >
            <Activity size={16} className="text-ink-muted" aria-hidden="true" />
            Diagnostics
          </button>
          <button
            type="button"
            data-testid="library-tools-clear"
            aria-haspopup="dialog"
            onClick={() => setClearing(true)}
            className="min-h-touch px-3 rounded-control bg-surface-raised border border-line-strong text-sm text-ink flex items-center justify-center gap-2 hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          >
            <Trash2 size={16} className="stroke-status-error" aria-hidden="true" />
            Clear library…
          </button>
        </div>
      </div>
      <div className="py-2 flex items-center justify-between gap-2 text-xs text-ink-faint">
        <span>{HEALTH_FOOTER}</span>
        <button
          type="button"
          aria-label="Open the classic library"
          data-testid="peek-library"
          onClick={() => actions.peekClassic('library')}
          className="shrink-0 min-h-touch px-2 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          Open
        </button>
      </div>
      {clearing ? (
        <ClearLibraryDialog
          tracks={st.storedTrackCount}
          playlists={st.playlistCount}
          onCancel={() => setClearing(false)}
          onClear={(also: boolean) => {
            setClearing(false); // the dialog closes first
            actions.clearLibrary(also);
          }}
        />
      ) : null}
      {confirming ? (
        <AssignCrystalsDialog
          plan={confirming}
          onCancel={() => setConfirming(null)}
          onAssign={() => {
            setConfirming(null);
            actions.assignCrystals();
          }}
        />
      ) : null}
    </section>
  );
};

export default React.memo(HealthCard);
