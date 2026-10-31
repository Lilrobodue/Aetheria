// components/shell/mixes/builder/BuilderSections.tsx (v16.3, Create a mix; mockup builder-A-lower-phone)
//
// The builder's lower sections:
//   Tracks per crystal: for a crystal set, 1 · 3 · All (a radiogroup) and what each means; for the rest, one line (a
//     walk picks one track per position; the experimental ones their own rule).
//   Filters: the picks as removable chips (v16.2's active chips: "Remove Under 3 min"), and a Filters button that opens
//     the builder's filter sheet; with none, what the mix is built from.
//   Order: the kit RadioList with the orders this Follow offers (the pattern first) and its notes: a walk reordered
//     plays as a mix; the shuffle's least recently played is this session's (decision 3 A).
// React.memo each; plain values and stable callbacks as props.
// v16.3 review: Tracks per crystal is a keyboard radio group (one Tab stop; the arrows move and pick: parts.tsx); Order
// is the kit's RadioList, native radios.

import React, { useLayoutEffect, useRef } from 'react';
import { ListFilter, X } from 'lucide-react';
import EvidenceTag from '../../../ui/EvidenceTag';
import RadioList from '../../../ui/RadioList';
import { ChoiceTile, LINE, SectionHead, onRadioKeys, rovingTabIndex } from './parts';
import { removeChipName, filtersButtonName } from '../../library/filterViewModel';
import { FILTERS_BUTTON, ORDER_SHUFFLE_NOTE, ORDER_WALK_NOTE, PER_LINES, SECTION } from './builderViewModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

// ---------------------------------------------------------------------------------------------------------------
// Tracks per crystal
// ---------------------------------------------------------------------------------------------------------------

interface PerSectionProps {
  /** null: this Follow has its own rule (`line` says it). */
  per: 1 | 3 | 'all' | null;
  line: string;
  onPer: (p: 1 | 3 | 'all') => void;
}
export const PerSection = React.memo(({ per, line, onPer }: PerSectionProps) => (
  <section aria-labelledby="mix-builder-h-per" data-testid="builder-per">
    <SectionHead id="mix-builder-h-per">{SECTION.per}</SectionHead>
    {per === null ? (
      <p className="text-sm text-ink-muted">{line}</p>
    ) : (
      <>
        <div role="radiogroup" aria-labelledby="mix-builder-h-per" onKeyDown={onRadioKeys} className="grid grid-cols-3 gap-2">
          {([1, 3, 'all'] as const).map((p, i) => (
            <ChoiceTile key={String(p)} label={p === 'all' ? 'All' : String(p)} checked={per === p} tabIndex={rovingTabIndex(per === p, i === 0, per === 1 || per === 3 || per === 'all')} onPick={() => onPer(p)} data-testid={`builder-per-${p}`} />
          ))}
        </div>
        <p className={`mt-2 ${LINE}`}>{PER_LINES[String(per) as '1' | '3' | 'all']}</p>
      </>
    )}
  </section>
));

// ---------------------------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------------------------

interface FiltersSectionProps {
  chips: ReadonlyArray<{ facet: string; value: string; label: string }>;
  /** What the mix is built from with no filter ("None: every track in your library."). */
  noneLine: string;
  onRemove: (facet: string, value: string) => void;
  onOpen: (opener: HTMLElement) => void;
  buttonRef: { current: HTMLButtonElement | null };
}
export const FiltersSection = React.memo(({ chips, noneLine, onRemove, onOpen, buttonRef }: FiltersSectionProps) => {
  const listRef: { current: HTMLDivElement | null } = useRef(null);
  // v16.6 (decision 11): an experimental scan-score chip names the app's own score: the chips carry Design choice.
  const experimental = chips.some((c) => c.facet.startsWith('x-'));
  // A removal moves the focus to the next chip (or the previous, or the Filters button with none left).
  const focusNextRef: { current: number | null } = useRef(null);
  useLayoutEffect(() => {
    const at = focusNextRef.current;
    if (at === null) return;
    focusNextRef.current = null;
    const buttons = listRef.current ? Array.from(listRef.current.querySelectorAll<HTMLButtonElement>('button')) : [];
    if (at >= 0 && buttons.length) buttons[Math.min(at, buttons.length - 1)].focus();
    else buttonRef.current?.focus();
  }, [chips]);
  return (
    <section aria-labelledby="mix-builder-h-filters" data-testid="builder-filters">
      <SectionHead id="mix-builder-h-filters">{SECTION.filters}</SectionHead>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {chips.length ? (
            <div data-evidence={experimental ? 'design' : undefined} data-testid="builder-chips-block">
            <div ref={listRef} data-testid="builder-active-chips" className="pt-1 flex flex-wrap gap-x-2 gap-y-3">
              {chips.map((c, i) => (
                <button
                  key={`${c.facet}:${c.value}`}
                  type="button"
                  aria-label={removeChipName(c.label)}
                  onClick={() => {
                    focusNextRef.current = chips.length > 1 ? (i < chips.length - 1 ? i : i - 1) : -1;
                    onRemove(c.facet, c.value);
                  }}
                  className={`relative inline-flex items-center gap-1 h-8 pl-3 pr-2 rounded-pill whitespace-nowrap border border-line-strong bg-surface-raised text-xs text-ink-strong after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
                >
                  {c.label}
                  <X size={14} className="text-ink-muted" aria-hidden="true" />
                </button>
              ))}
            </div>
            {experimental ? (
              <div className="pt-3 flex flex-wrap items-center gap-x-2 gap-y-3">
                <EvidenceTag tier="design" />
              </div>
            ) : null}
            </div>
          ) : (
            <p className="pt-2 text-sm text-ink-muted">{noneLine}</p>
          )}
        </div>
        <button
          type="button"
          ref={buttonRef}
          aria-haspopup="dialog"
          aria-label={filtersButtonName(chips.length)}
          data-testid="builder-filters-button"
          onClick={(e: { currentTarget: HTMLButtonElement }) => onOpen(e.currentTarget)}
          className={`shrink-0 min-h-touch px-3 rounded-control border border-line-strong bg-surface-raised text-sm text-ink flex items-center gap-1.5 hover:border-ink-faint transition-colors duration-fast ${FOCUS}`}
        >
          <ListFilter size={16} className="text-ink-muted" aria-hidden="true" />
          {FILTERS_BUTTON}
        </button>
      </div>
    </section>
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------------------------------------------

interface OrderSectionProps {
  options: ReadonlyArray<{ id: string; title: string }>;
  value: string;
  /** The Follow is a walk (a reorder makes it a mix: say so). */
  walk: boolean;
  onOrder: (o: string) => void;
}
export const OrderSection = React.memo(({ options, value, walk, onOrder }: OrderSectionProps) => (
  <section aria-labelledby="mix-builder-h-order" data-testid="builder-order">
    <SectionHead id="mix-builder-h-order">{SECTION.order}</SectionHead>
    <RadioList legend={SECTION.order} name="builder-order" items={options} value={value} onChange={onOrder} data-testid="builder-order-list" />
    {walk && value !== 'pattern' ? (
      <p data-testid="builder-order-walk-note" className={`pt-2 ${LINE}`}>
        {ORDER_WALK_NOTE}
      </p>
    ) : null}
    {value === 'shuffle' ? (
      <p data-testid="builder-order-shuffle-note" className={`pt-2 ${LINE}`}>
        {ORDER_SHUFFLE_NOTE}
      </p>
    ) : null}
  </section>
));
