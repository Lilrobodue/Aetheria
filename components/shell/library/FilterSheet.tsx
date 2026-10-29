// components/shell/library/FilterSheet.tsx (v16.2, smart filters; mockups filter-sheet-phone, -lower, -keys, -desktop)
//
// The Filters sheet: a kit Sheet, modal on both shells (the kit centres it on the desktop), titled "Filters" with the
// live count ("10 of 440 tracks"). Its body is the `library-filters` region: the groups, each an h3 and a
// role="group": Assigned crystal (its help line; GUT, HEART and HEAD, each with its range, its regime chip and its nine
// crystals, all 27 always; then No crystal), Length, Scan status (Deep Scan; Visual sync), Key and Key confidence. The
// chips apply live: each tap is the caller's (the Tracks view keeps the picks and saves them), so the list behind and
// the count update at once. Which values are offered beyond the fixed ones comes from a second pass with nothing picked,
// made once per library while the sheet is open. The footer (the kit Sheet's): Clear all, and Show N tracks, which
// closes it. Escape and the scrim close it too, and the focus goes back to the Filters button (the overlay stack).
// Everything is the caller's data (facets, filters, the pass), so v16.3's builder can mount the same chips. Nothing here
// reads the time.

import React, { useMemo, useRef } from 'react';
import Sheet from '../../ui/Sheet';
import { ViewBoundary } from '../../ErrorBoundary';
import { sheetFallback } from '../sheets/sheetFallback';
import { useSound } from '../contexts';
import { countRender } from '../devRenders';
import { REGIME_DOT, regimeOf } from '../shellModel';
import FacetChip from './FacetChip';
import {
  CLEAR_ALL,
  PERFECT_GUT_NOTE,
  regimeChipLabel,
  regimeRangeText,
  sheetCountText,
  showButtonText,
} from './filterViewModel';
import {
  CONFIDENCE_HELP,
  CRYSTAL_HELP,
  FACET_TITLES,
  LIBRARY_FACETS,
  NO_FILTERS,
  NO_KEYS_YET,
  REGIMES,
  countOf,
  filterPass,
  regimeCount,
  regimeState,
  valueLabel,
} from '../../../utils/library/filterModel';
import type { FacetIndex, FilterResult, FilterSong, Filters } from '../../../utils/library/filterModel';

interface FilterSheetProps {
  /** The library, indexed (the Tracks view's memo). */
  index: FacetIndex<FilterSong>;
  filters: Filters;
  /** The pass with the picks and the search: the counts and the shown number. */
  result: FilterResult<FilterSong>;
  /** A chip's tap: (facet, value), or ('regime', 'gut' | 'heart' | 'head'). */
  onToggle: (facet: string, value: string) => void;
  onClear: () => void;
  onClose: () => void;
}

let sheetSeq = 0;
const KEY_SPECIAL = ['noclear', 'unanalysed', 'failed'];

const H3 = 'text-xs font-semibold uppercase tracking-widest text-ink-soft';
const SUB = 'text-xs text-ink-muted';
const WRAP = 'flex flex-wrap gap-x-2 gap-y-3';

/** Perfect GUT's line under GUT: read here, in its own small component, so the sheet itself never follows the sound. */
const PerfectGutNote = () => {
  const sound = useSound();
  return sound.perfectGut ? (
    <p data-testid="filters-perfect-gut" className="pb-2 text-xs text-ink-faint">
      {PERFECT_GUT_NOTE}
    </p>
  ) : null;
};

const FilterSheetBody = ({ index, filters, result, onToggle, ids }: FilterSheetProps & { ids: string }) => {
  countRender('FilterSheet');
  // What the library holds, with nothing picked: which values beyond the fixed ones are offered.
  const all = useMemo(() => filterPass(index, NO_FILTERS), [index]);
  const facets = LIBRARY_FACETS;
  const has = (facet: string, value: string) => countOf(all, facets, facet, value) > 0;
  const picked = (facet: string, value: string) => (filters[facet] ?? []).includes(value);
  const shown = (facet: string, value: string) => has(facet, value) || picked(facet, value);
  const chip = (facet: string, value: string, dotClass?: string) => (
    <FacetChip
      key={`${facet}:${value}`}
      facet={facet}
      value={value}
      label={valueLabel(facet, value)}
      count={countOf(result, facets, facet, value)}
      pressed={picked(facet, value)}
      dotClass={dotClass}
      onToggle={onToggle}
    />
  );
  const keyValues = (facets.find((f) => f.id === 'key')?.values ?? []).filter((v) => !KEY_SPECIAL.includes(v));
  const analysed = keyValues.some((v) => has('key', v)) || has('key', 'noclear');
  const confidenceShown = ['strong', 'partial', 'weak'].some((v) => shown('confidence', v));

  return (
    <div data-testid="library-filters-body" className="px-4 pb-4">
      <section role="group" aria-labelledby={`${ids}-crystal`}>
        <div className="pt-4 pb-1">
          <h3 id={`${ids}-crystal`} className={H3}>
            {FACET_TITLES.crystal}
          </h3>
          <p className="mt-1 text-xs text-ink-muted">{CRYSTAL_HELP}</p>
        </div>
        {REGIMES.map((r) => {
          const st = regimeState(filters, r.id);
          return (
            <div key={r.id} role="group" aria-labelledby={`${ids}-${r.id}`} className="pt-3">
              <div className="pb-2 flex items-center justify-between gap-2">
                <span id={`${ids}-${r.id}`} className="text-sm text-ink-strong">
                  {r.name} <span className="text-xs text-ink-faint">{regimeRangeText(r.crystals)}</span>
                </span>
                <FacetChip
                  facet="regime"
                  value={r.id}
                  label={regimeChipLabel(r.name)}
                  count={regimeCount(result, r.id)}
                  pressed={st === 'all' ? true : st === 'some' ? 'mixed' : false}
                  onToggle={onToggle}
                />
              </div>
              {r.id === 'gut' ? <PerfectGutNote /> : null}
              <div className={WRAP}>{r.crystals.map((c) => chip('crystal', String(c), REGIME_DOT[regimeOf(c)]))}</div>
            </div>
          );
        })}
        <div className={`pt-3 ${WRAP}`}>{chip('crystal', 'none')}</div>
      </section>

      <section role="group" aria-labelledby={`${ids}-length`}>
        <div className="pt-5 pb-2">
          <h3 id={`${ids}-length`} className={H3}>
            {FACET_TITLES.length}
          </h3>
        </div>
        <div className={WRAP}>{['lt3', '3to5', '5to10', 'ge10', ...(shown('length', 'unknown') ? ['unknown'] : [])].map((v) => chip('length', v))}</div>
      </section>

      <section role="group" aria-labelledby={`${ids}-scanstatus`}>
        <div className="pt-5 pb-2">
          <h3 id={`${ids}-scanstatus`} className={H3}>
            Scan status
          </h3>
        </div>
        <div role="group" aria-labelledby={`${ids}-scan`}>
          <p id={`${ids}-scan`} className={`pb-2 ${SUB}`}>
            {FACET_TITLES.scan}
          </p>
          <div className={WRAP}>{['scanned', 'unscanned', ...(shown('scan', 'failed') ? ['failed'] : [])].map((v) => chip('scan', v))}</div>
        </div>
        <div role="group" aria-labelledby={`${ids}-sync`}>
          <p id={`${ids}-sync`} className={`pt-4 pb-2 ${SUB}`}>
            {FACET_TITLES.sync}
          </p>
          <div className={WRAP}>{['yes', 'no'].map((v) => chip('sync', v))}</div>
        </div>
      </section>

      <section role="group" aria-labelledby={`${ids}-key`}>
        <div className="pt-5 pb-2">
          <h3 id={`${ids}-key`} className={H3}>
            {FACET_TITLES.key}
          </h3>
        </div>
        {analysed ? (
          <div className={WRAP}>{[...keyValues, ...KEY_SPECIAL].filter((v) => shown('key', v)).map((v) => chip('key', v))}</div>
        ) : (
          <>
            <p data-testid="filters-no-keys" className="text-sm text-ink-muted">
              {NO_KEYS_YET}
            </p>
            {(filters.key ?? []).length ? <div className={`pt-3 ${WRAP}`}>{(filters.key ?? []).map((v) => chip('key', v))}</div> : null}
          </>
        )}
      </section>

      {confidenceShown ? (
        <section role="group" aria-labelledby={`${ids}-confidence`}>
          <div className="pt-5 pb-2">
            <h3 id={`${ids}-confidence`} className={H3}>
              {FACET_TITLES.confidence}
            </h3>
            <p className="mt-1 text-xs text-ink-muted">{CONFIDENCE_HELP}</p>
          </div>
          <div className={WRAP}>{['strong', 'partial', 'weak'].map((v) => chip('confidence', v))}</div>
        </section>
      ) : null}
    </div>
  );
};

const MemoBody = React.memo(FilterSheetBody);

const FilterSheet = (props: FilterSheetProps) => {
  const idRef: { current: string } = useRef('');
  if (!idRef.current) idRef.current = `filters-${++sheetSeq}`;
  const n = props.result.results.length;
  const footer = (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        data-testid="filters-clear-all"
        onClick={props.onClear}
        className="h-touch rounded-control border border-line-strong bg-surface-raised text-sm text-ink hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        {CLEAR_ALL}
      </button>
      <button
        type="button"
        data-testid="filters-show"
        onClick={props.onClose}
        className="h-touch rounded-control border border-ink-faint bg-surface-control text-sm font-semibold text-ink-strong hover:border-ink-muted transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        {showButtonText(n)}
      </button>
    </div>
  );
  return (
    <Sheet open title="Filters" subtitle={sheetCountText(n, props.result.total)} subtitleLive onClose={props.onClose} footer={footer} data-testid="library-filters">
      <ViewBoundary name="library-filters" fallback={sheetFallback(props.onClose)} render={() => <MemoBody {...props} ids={idRef.current} />} />
    </Sheet>
  );
};

export default React.memo(FilterSheet);
