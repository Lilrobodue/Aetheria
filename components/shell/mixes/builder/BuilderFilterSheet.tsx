// components/shell/mixes/builder/BuilderFilterSheet.tsx (v16.3, Create a mix; mockup builder-filters-phone)
//
// The builder's filter sheet: a kit Sheet (modal on both shells) titled "Filters" with the live count over the source
// ("25 of 440 tracks"). v16.2's filter sheet is the Library's own (its groups are fixed), so this one renders the
// builder's facets (utils/mix/builder.ts BUILDER_FACETS) with v16.2's FacetChip: Length, Scan status (Deep Scan, Visual
// sync), Key and Key confidence as in Library › Filters, but no crystal group (Follow picks the crystals), then the
// Experimental scores (decision 4 A): collapsed, off unless picked, their lead line saying they are scores and not
// measurements, four chips ANDed (each its own facet). The chips apply live (the caller keeps the picks and saves them
// from the tap). The footer: Clear all, and Done. Escape and the scrim close it; the focus goes back to the Filters
// button (the overlay stack). Nothing here reads the time.
// v16.3 review: its body is a region of its own (mix-builder-filters), as Library › Filters' is: a crash shows the
// sheet's fallback (Reload panel, Close) in the sheet, and the builder and the Mixes tab stay. The count's pass for the
// subtitle runs here, outside it, so a throw in it is handed to the region and thrown there.

import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Sheet from '../../../ui/Sheet';
import { ViewBoundary } from '../../../ErrorBoundary';
import { sheetFallback } from '../../sheets/sheetFallback';
import FacetChip from '../../library/FacetChip';
import { CLEAR_ALL, sheetCountText } from '../../library/filterViewModel';
import { CONFIDENCE_HELP, FACET_TITLES, NO_FILTERS, NO_KEYS_YET, countOf, filterPass, valueLabel } from '../../../../utils/library/filterModel';
import type { FacetIndex, FilterResult, FilterSong, Filters } from '../../../../utils/library/filterModel';
import { SCAN_SCORES, SCAN_SCORES_LEAD, scoreChipText } from '../../../../utils/library/scanScores';
import EvidenceTag from '../../../ui/EvidenceTag';
import { BUILDER_FACETS } from '../../../../utils/mix/builder';
import { EXPERIMENTAL_HIDE, EXPERIMENTAL_MORE, EXPERIMENTAL_SHOW, EXPERIMENTAL_TITLE, FILTERS_DONE, FILTERS_FOOT } from './builderViewModel';

interface BuilderFilterSheetProps {
  index: FacetIndex<FilterSong>;
  filters: Filters;
  onToggle: (facet: string, value: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const KEY_SPECIAL = ['noclear', 'unanalysed', 'failed'];
const H3 = 'text-xs font-semibold uppercase tracking-widest text-ink-soft';
const SUB = 'text-xs text-ink-muted';
const WRAP = 'flex flex-wrap gap-x-2 gap-y-3';
const SCORED = SCAN_SCORES.filter((d) => d.over !== null);

const Body = ({ index, filters, result, onToggle }: Omit<BuilderFilterSheetProps, 'onClear' | 'onClose'> & { result: FilterResult<FilterSong> }) => {
  // What the source holds with nothing picked: which values beyond the fixed ones are offered (as v16.2's sheet).
  const all = useMemo(() => filterPass(index, NO_FILTERS), [index]);
  const facets = BUILDER_FACETS;
  const has = (facet: string, value: string) => countOf(all, facets, facet, value) > 0;
  const picked = (facet: string, value: string) => (filters[facet] ?? []).includes(value);
  const shown = (facet: string, value: string) => has(facet, value) || picked(facet, value);
  const [open, setOpen] = useState(() => SCORED.some((d) => (filters[`x-${d.id}`] ?? []).length > 0));
  const chip = (facet: string, value: string, label?: string) => (
    <FacetChip key={`${facet}:${value}`} facet={facet} value={value} label={label ?? valueLabel(facet, value)} count={countOf(result, facets, facet, value)} pressed={picked(facet, value)} onToggle={onToggle} />
  );
  const keyValues = (facets.find((f) => f.id === 'key')?.values ?? []).filter((v) => !KEY_SPECIAL.includes(v));
  const analysed = keyValues.some((v) => has('key', v)) || has('key', 'noclear');
  const confidenceShown = ['strong', 'partial', 'weak'].some((v) => shown('confidence', v));
  return (
    <div data-testid="builder-filters-body" className="px-4 pb-4">
      <p className="pt-3 text-xs text-ink-faint">{FILTERS_FOOT}</p>
      <section role="group" aria-labelledby="bf-length">
        <div className="pt-4 pb-2">
          <h3 id="bf-length" className={H3}>{FACET_TITLES.length}</h3>
        </div>
        <div className={WRAP}>{['lt3', '3to5', '5to10', 'ge10', ...(shown('length', 'unknown') ? ['unknown'] : [])].map((v) => chip('length', v))}</div>
      </section>
      <section role="group" aria-labelledby="bf-scanstatus">
        <div className="pt-5 pb-2">
          <h3 id="bf-scanstatus" className={H3}>Scan status</h3>
        </div>
        <div role="group" aria-labelledby="bf-scan">
          <p id="bf-scan" className={`pb-2 ${SUB}`}>{FACET_TITLES.scan}</p>
          <div className={WRAP}>{['scanned', 'unscanned', ...(shown('scan', 'failed') ? ['failed'] : [])].map((v) => chip('scan', v))}</div>
        </div>
        <div role="group" aria-labelledby="bf-sync">
          <p id="bf-sync" className={`pt-4 pb-2 ${SUB}`}>{FACET_TITLES.sync}</p>
          <div className={WRAP}>{['yes', 'no'].map((v) => chip('sync', v))}</div>
        </div>
      </section>
      <section role="group" aria-labelledby="bf-key">
        <div className="pt-5 pb-2">
          <h3 id="bf-key" className={H3}>{FACET_TITLES.key}</h3>
        </div>
        {analysed ? (
          <div className={WRAP}>{[...keyValues, ...KEY_SPECIAL].filter((v) => shown('key', v)).map((v) => chip('key', v))}</div>
        ) : (
          <>
            <p className="text-sm text-ink-muted">{NO_KEYS_YET}</p>
            {(filters.key ?? []).length ? <div className={`pt-3 ${WRAP}`}>{(filters.key ?? []).map((v) => chip('key', v))}</div> : null}
          </>
        )}
      </section>
      {confidenceShown ? (
        <section role="group" aria-labelledby="bf-confidence">
          <div className="pt-5 pb-2">
            <h3 id="bf-confidence" className={H3}>{FACET_TITLES.confidence}</h3>
            <p className="mt-1 text-xs text-ink-muted">{CONFIDENCE_HELP}</p>
          </div>
          <div className={WRAP}>{['strong', 'partial', 'weak'].map((v) => chip('confidence', v))}</div>
        </section>
      ) : null}
      <section role="group" aria-labelledby="bf-experimental" data-testid="builder-filters-experimental">
        <div className="pt-5 pb-1 flex items-center justify-between gap-2">
          <h3 id="bf-experimental" className={H3}>{EXPERIMENTAL_TITLE}</h3>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="bf-experimental-body"
            aria-label={open ? `${EXPERIMENTAL_HIDE} experimental scores` : `${EXPERIMENTAL_SHOW} experimental scores`}
            data-testid="builder-filters-experimental-toggle"
            onClick={() => setOpen((v: boolean) => !v)}
            className="min-h-touch px-2 rounded-control text-sm text-ink-muted flex items-center gap-1 hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          >
            {open ? EXPERIMENTAL_HIDE : EXPERIMENTAL_SHOW}
            <ChevronDown size={14} className={open ? 'rotate-180' : undefined} aria-hidden="true" />
          </button>
        </div>
        {open ? (
          <div id="bf-experimental-body" data-evidence="design">
            <p data-testid="builder-filters-experimental-lead" className={`pb-2 ${SUB}`}>
              {SCAN_SCORES_LEAD} {EXPERIMENTAL_MORE}
            </p>
            <div className="pb-3 flex flex-wrap items-center gap-x-2 gap-y-3">
              <EvidenceTag tier="design" />
            </div>
            <div className={WRAP}>{SCORED.map((d) => chip(`x-${d.id}`, 'over', scoreChipText(d)))}</div>
          </div>
        ) : null}
      </section>
    </div>
  );
};

const MemoBody = React.memo(Body);

const BuilderFilterSheet = (props: BuilderFilterSheetProps) => {
  const pass = useMemo((): { result: FilterResult<FilterSong> | null; error: unknown } => {
    try {
      return { result: filterPass(props.index, props.filters), error: null };
    } catch (error) {
      return { result: null, error };
    }
  }, [props.index, props.filters]);
  const result = pass.result;
  const doneRef: { current: HTMLButtonElement | null } = useRef(null);
  const footer = (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        data-testid="builder-filters-clear"
        onClick={props.onClear}
        className="h-touch rounded-control border border-line-strong bg-surface-raised text-sm text-ink hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        {CLEAR_ALL}
      </button>
      <button
        type="button"
        ref={doneRef}
        data-testid="builder-filters-done"
        onClick={props.onClose}
        className="h-touch rounded-control border border-ink-faint bg-surface-control text-sm font-semibold text-ink-strong hover:border-ink-muted transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        {FILTERS_DONE}
      </button>
    </div>
  );
  return (
    <Sheet open title="Filters" subtitle={result ? sheetCountText(result.results.length, result.total) : undefined} subtitleLive onClose={props.onClose} footer={footer} data-testid="builder-filter-sheet">
      <ViewBoundary
        name="mix-builder-filters"
        fallback={sheetFallback(props.onClose)}
        render={() => {
          if (!result) throw pass.error;
          return <MemoBody index={props.index} filters={props.filters} result={result} onToggle={props.onToggle} />;
        }}
      />
    </Sheet>
  );
};

export default React.memo(BuilderFilterSheet);
