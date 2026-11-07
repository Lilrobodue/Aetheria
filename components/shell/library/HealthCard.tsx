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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check, ChevronDown, Trash2 } from 'lucide-react';
import { useActions, useExport, useLibraryList, useLibraryStatus, useShell } from '../contexts';
import { countRender } from '../devRenders';
import AssignCrystalsDialog from './AssignCrystalsDialog';
import ClearLibraryDialog from './ClearLibraryDialog';
import { HEALTH_FOOTER, assignNeedsConfirm, healthModel, libraryHealth, spreadLineReachable, spreadPlanBusy, spreadPlanWanted } from './libraryModel';
import { crystalMoves, planAssign, samePlanPatches } from '../../../utils/mix/distribution';
import type { AssignOptions, AssignPlan } from '../../../utils/mix/distribution';
import type { HealthLine, LibSong } from './libraryModel';

const BUTTON = 'shrink-0 min-h-touch px-3 rounded-control bg-surface-raised border border-line-strong text-sm text-ink hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const BUTTON_BLOCKED = 'shrink-0 min-h-touch px-3 rounded-control bg-surface-raised border border-line-strong text-sm text-ink opacity-40 cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

// v16.8.1 (D8, fix round 2): the spread plans the card made, by library array (a new array on every change), so a
// remount (a search clears, a tab comes back) doesn't plan again; and the last count planned while nothing was busy,
// shown held while something is. Dev builds count the plans in window.__aetheriaSpreadPlans (the dev hook reports it).
// v16.8.2: planned with App's key-band cache (st.keyBands.planOptions, the same provider as the Assign press), only once
// none of the library's bands is missing (spreadPlanBusy holds while bandsLeft > 0).
const IS_DEV_BUILD = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
// v16.8.2 (K9): with the moves, whether the key data alone cause them: one plan more, without the bands, made only for
// the card's D8 line, when it moves tracks and some are placed by key, and kept with the plan in the same entry (fix
// round 1, A-N10 / L-N8: a tap reuses the cached plan and never asks for the reason, so it never plans twice).
const spreadPlans: WeakMap<readonly LibSong[], { plan: AssignPlan; moves: number; keyReason?: boolean }> = new WeakMap();
let lastIdle: { moves: number; keyReason: boolean } | null = null;
function spreadPlanOf(songs: readonly LibSong[], keys: AssignOptions, reason = false): { plan: AssignPlan; moves: number; keyReason: boolean } {
  let p = spreadPlans.get(songs);
  if (!p) {
    const plan = planAssign(songs as never, 'spread', keys);
    p = { plan, moves: crystalMoves(plan) };
    spreadPlans.set(songs, p);
    if (IS_DEV_BUILD) {
      const w = window as unknown as { __aetheriaSpreadPlans?: number };
      w.__aetheriaSpreadPlans = (w.__aetheriaSpreadPlans ?? 0) + 1;
    }
  }
  if (reason && p.keyReason === undefined) p.keyReason = p.moves > 0 && (p.plan.keyed ?? 0) > 0 && crystalMoves(planAssign(songs as never, 'spread')) === 0;
  return { plan: p.plan, moves: p.moves, keyReason: p.keyReason ?? false };
}

const HealthCard = () => {
  countRender('HealthCard');
  const { songs } = useLibraryList();
  const st = useLibraryStatus();
  const actions = useActions();
  const { libraryViewRef, phoneShell } = useShell();
  const { job, stopping, stoppingLong } = useExport();
  const exporting = !!job && (job.phase === 'running' || job.phase === 'cancelling');
  const health = useMemo(() => libraryHealth(songs, st.rescanSkip), [songs, st.rescanSkip]);
  // v16.8.1 (D8): what a spread would move, planned once per library array (never per render), and only when its line
  // can show and nothing is busy (fix round 2: no plan while a track has no crystal, while lengths are still read, or
  // while a pass runs or the library restores). While busy the last idle count shows, held; with none yet, the row is
  // done. (Fix round 3, revR2-logic S1: never more than the tracks there are: tracks deleted while busy keep the count
  // planned before them.)
  const planStatus = { isScanning: st.isScanning, passPhase: st.pass.phase, restoring: st.restoring, durationsLeft: st.durationsLeft, bandsLeft: st.bandsLeft };
  const wanted = spreadPlanWanted(health, planStatus);
  const spread = useMemo(() => (wanted ? { songs, ...spreadPlanOf(songs, st.keyBands.planOptions, true) } : null), [songs, wanted]);
  if (spread) lastIdle = { moves: spread.moves, keyReason: spread.keyReason };
  const held = !spread && spreadPlanBusy(planStatus) && spreadLineReachable(health);
  // (Fix round 3: the held count is clamped to the tracks there are; v16.8.2: its reason is held with it.)
  const spreadMoves = spread ? spread.moves : held ? Math.min(lastIdle?.moves ?? 0, health.total) : 0;
  const spreadKeyReason = spread ? spread.keyReason : held ? (lastIdle?.keyReason ?? false) : false;
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
    exporting, // v16.5 review (B10)
    exportStopping: !!stopping, // v16.5 final
    exportStoppingLong: !!stoppingLong, // v16.5 export memory
    scanRun: st.scanRun, // v16.8.1 (D4): Scan again's progress
    deviceRate: st.deviceRate, // v16.8.1 (D4): the rate note
    spreadMoves, // v16.8.1 (D8)
    spreadKeyReason, // v16.8.2 (K9)
  });
  const [openPref, setOpenPref] = useState<boolean | null>(libraryViewRef.current.healthOpen);
  // (Fix round 2, R2a: the plan the dialog shows, with the library array it was made from; fix round 3, F1: and whether
  // it asks again because that library changed.)
  const [confirming, setConfirming] = useState<{ plan: AssignPlan; lib: readonly LibSong[]; seq: number; changed: boolean } | null>(null);
  // (Fix round 3, F2: open while a confirmation is set, so it never vanishes when the card would fold itself.)
  const open = !!confirming || (openPref ?? model.autoOpen);
  const confirmSeq: { current: number } = useRef(0); // (a fresh dialog for every plan shown: Cancel takes the focus again)
  const [clearing, setClearing] = useState(false);
  // (Fix round 4, G4: when the dialog closes and the card folds, focus goes to the folded card's toggle, not <body>; while
  // the card stays open, the dialog returns it to the Assign button as before. closedAt: when the dialog closed.)
  const toggleRef: { current: HTMLButtonElement | null } = useRef(null);
  const closedAt: { current: number } = useRef(0);
  useEffect(() => {
    if (confirming || !closedAt.current || open) return;
    if (Date.now() - closedAt.current < 3000) toggleRef.current?.focus();
    closedAt.current = 0;
  }, [confirming, open]);
  // (Fix round 5, H2: the card stays open, but what the dialog gave focus back to is gone (after Assign the Crystals line
  // is done, and its button with it), so focus fell to <body>: the card's heading takes it. Once per close, within the
  // same 3 s, on whichever render the button goes; a fold after it is still G4's.)
  const headingRef: { current: HTMLHeadingElement | null } = useRef(null);
  const headingFor: { current: number } = useRef(0);
  useEffect(() => {
    const at = closedAt.current;
    if (confirming || !open || !at || headingFor.current === at || Date.now() - at >= 3000) return;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    headingFor.current = at;
    headingRef.current?.focus();
  });

  // v16.8.2 (K6): the library as the latest render has it (the Assign after the press's warm plans that one).
  const songsRef: { current: readonly LibSong[] } = useRef(songs);
  songsRef.current = songs;
  /** The Assign of these tracks, their bands all made and their lengths read: ask first when crystals tracks have would
   *  change (`ask`: always, for a press that finishes on a card mounted after it). Fix round 2: a plan with nothing to do
   *  is a direct press with nothing to do (R2e: App's toast, never a dialog); otherwise exactly this plan is applied
   *  (R2a: App refuses it if the library changed since, and then the press goes again on the latest one).
   *  Fix round 3 (F1): `confirmed`, the plan a dialog showed and the user confirmed: the plan of the library as it is
   *  now is applied when it writes the same (samePlanPatches: the same patches, in this tap); when it doesn't, the dialog
   *  asks again, once, saying the library changed. Fix round 5 (H1): only on the card that confirmed it (`ask` false):
   *  a card mounted after the press always asks, with the line only when the plan differs from the confirmation. */
  const assignWith = (list: readonly LibSong[], ask = false, confirmed: AssignPlan | null = null) => {
    const plan = spreadPlanOf(list, st.keyBands.planOptions).plan;
    const same = !!confirmed && samePlanPatches(plan.patches, confirmed.patches);
    if (same && !ask && actions.assignPlan(plan, list as never)) return;
    if (plan.patches.size === 0) {
      actions.assignCrystals();
      return;
    }
    // (The line: the plan differs from the confirmation, or, on the card that confirmed it, App refused it as the library
    // changed since.)
    if (confirmed || ask || assignNeedsConfirm(plan)) setConfirming({ plan, lib: list, seq: ++confirmSeq.current, changed: !!confirmed && (!same || !ask) });
    else if (!actions.assignPlan(plan, list as never)) pressAgain(null);
  };
  /** Fix round 2 (R2a): plan the latest library and apply or ask (its bands first when some are missing: the press waits
   *  in App, and the card takes it then; fix round 3, F1: and its track lengths first while they are read, as the D8 row
   *  holds for them). `confirmed`, the plan a dialog showed (F1): fix round 4, G2: it goes with the press in App and
   *  comes back with the take, so it counts only for this press (a Cancel, a Clear or a row tap ends it). */
  const pressAgain = (confirmed: AssignPlan | null) => {
    const now = songsRef.current;
    pressedHere.current = false;
    if (st.durationsLeft > 0 || st.keyBands.missing(now as never) > 0) {
      // (Fix round 5, H1: a press this card confirmed is its own: when it ends here, an equal plan is applied with no
      // second dialog; a card mounted after it asks. pressAgain(null), a plan App refused, asks again.)
      pressedHere.current = !!confirmed;
      void actions.assignWhenKeysReady(now as never, { confirmed });
      return;
    }
    assignWith(now, !confirmed, confirmed);
  };
  // v16.8.2 fix round 1 (A-SF1, A-SF2): a press whose bands App made waits there (st.assignPending), so leaving the
  // card never drops it. The card mounted now takes it: with more bands missing by then, App warms again; then the
  // plan, and its confirmation when one is needed (always, when this card wasn't the one pressed: it mounted later).
  const pressedHere: { current: boolean } = useRef(false);
  useEffect(() => {
    actions.noteHealthCard(true);
    return () => actions.noteHealthCard(false);
  }, []);
  useEffect(() => {
    if (!st.assignPending) return;
    const taken = actions.takeAssignPending();
    if (!taken) return;
    const now = songsRef.current;
    if (st.durationsLeft > 0 || st.keyBands.missing(now as never) > 0) {
      // (Fix round 2, R2c: the re-warm doesn't make the press this card's own: a card that didn't press still asks.)
      void actions.assignWhenKeysReady(now as never, { again: true, confirmed: taken.confirmed });
      return;
    }
    const ask = !pressedHere.current;
    pressedHere.current = false;
    const confirmed = taken.confirmed;
    if (ask) {
      libraryViewRef.current.healthOpen = true;
      setOpenPref(true);
    }
    assignWith(now, ask, confirmed);
  }, [st.assignPending]);
  const run = (line: HealthLine) => {
    const a = line.action;
    if (!a) return;
    if (a.kind === 'assign') {
      // Blocked (Deep Scan runs): Auto-Distribute's own toast says why. When crystals tracks have would change: ask
      // first, with the plan's counts. Otherwise it runs at once (its notice, or its toast when there is nothing to do).
      // v16.7.1: Assign spreads (autoDistribute's plan). v16.8.1 (D8): the card's own plan when it is of this library.
      if (a.blocked) {
        actions.assignCrystals();
        return;
      }
      // v16.8.2 (K6): never planned on partial bands: with any missing, the press's warm first (its toast, its Cancel),
      // in App (fix round 1: again while more go missing; the press waits there, the effect above takes it), then the
      // plan and its confirmation. Never applied without it. (Fix round 3, F1: nor while track lengths are read.)
      if (st.durationsLeft > 0 || st.keyBands.missing(songs as never) > 0) {
        pressedHere.current = true;
        void actions.assignWhenKeysReady(songs as never);
        return;
      }
      assignWith(songs);
    } else if (a.kind === 'analyse') actions.analyse();
    else if (a.kind === 'scan') actions.scan();
    else if (a.kind === 'scan-assigned') actions.scanAssigned();
    else if (a.kind === 'rescan') actions.rescan(); // v16.8.1 (D4): Scan again
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
          ref={toggleRef}
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
        <h2 id="library-health-h" ref={headingRef} tabIndex={-1} className="text-xs font-semibold uppercase tracking-widest text-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400">
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
                  aria-label={`${l.action.label}: ${l.title}`}
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
        <React.Fragment key={confirming.seq}>
        <AssignCrystalsDialog
          plan={confirming.plan}
          changed={confirming.changed}
          onCancel={() => {
            closedAt.current = Date.now();
            setConfirming(null);
          }}
          onAssign={() => {
            closedAt.current = Date.now();
            // (Fix round 2, R2a: what is written is the plan this dialog showed. Fix round 3, F1: the plan of the library
            // as it is now, applied in this tap when it writes the same; asked again, once, when it doesn't.)
            const c = confirming;
            setConfirming(null);
            pressAgain(c.plan);
          }}
        />
        </React.Fragment>
      ) : null}
    </section>
  );
};

export default React.memo(HealthCard);
