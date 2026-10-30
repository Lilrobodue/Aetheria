// components/shell/export/ExportProgress.tsx (v16.5, Export with layers; the addendum §3.10–§3.11)
//
// The running export's progress: the phase, a progressbar with its %, the time left, and (a playlist) "Track 2 of 5 ·
// <title>". The ONLY part that follows the job: it subscribes to the job's progress store (useSyncExternalStore; the
// engine writes it at most 4 times a second), so nothing else re-renders while an export runs. `look`: the sheet's
// full readout, or the More card's thin bar and line.

import React, { useSyncExternalStore } from 'react';
import { countRender } from '../devRenders';
import { PHASE_WORDS, moreCardLine, moreCardTitle, rowExporting, timeLeft, trackOf } from '../../../utils/export/exportWords';
import type { ExportProgressStore } from '../contexts';

const IDLE = { phase: 'hold' as const, fraction: 0, etaS: null, file: { index: 1, count: 1, title: '' } };

export function useExportProgress(store: ExportProgressStore | null) {
  return useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.get : () => IDLE);
}
const noopSubscribe = () => () => {};

interface ExportProgressProps {
  store: ExportProgressStore;
  look: 'sheet' | 'card' | 'row';
  title?: string;
}

const ExportProgress = ({ store, look, title = '' }: ExportProgressProps) => {
  countRender('ExportProgress');
  const p = useExportProgress(store);
  const pct = Math.max(0, Math.min(100, Math.round(p.fraction * 100)));
  if (look === 'row') return <>{title ? moreCardTitle(title, pct) : rowExporting(pct)}</>;
  if (look === 'card') {
    return (
      <span className="block min-w-0">
        <span className="block text-base font-semibold text-ink-strong truncate tabular-nums">{moreCardTitle(title || p.file.title, pct)}</span>
        <span className="block text-xs text-ink-muted">{moreCardLine(p.etaS)}</span>
        <span
          role="progressbar"
          aria-label="Export progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-2 block h-1 rounded-pill bg-surface-control overflow-hidden"
        >
          <span className="block h-full bg-ink-soft" style={{ width: `${pct}%` }} />
        </span>
      </span>
    );
  }
  return (
    <div data-testid="export-progress" className="space-y-2">
      {p.file.count > 1 ? <p className="text-sm text-ink-strong">{trackOf(p.file.index, p.file.count, p.file.title)}</p> : null}
      <p data-testid="export-phase" className="text-sm text-ink-soft">
        {PHASE_WORDS[p.phase]}
      </p>
      <div
        role="progressbar"
        aria-label="Export progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        data-testid="export-bar"
        className="h-2 rounded-pill bg-surface-control overflow-hidden"
      >
        <div className="h-full bg-ink-soft" style={{ width: `${pct}%` }} />
      </div>
      <p className="flex items-baseline justify-between text-xs text-ink-muted tabular-nums">
        <span data-testid="export-percent">{pct} %</span>
        <span data-testid="export-eta">{timeLeft(p.etaS)}</span>
      </p>
    </div>
  );
};

export default React.memo(ExportProgress);
