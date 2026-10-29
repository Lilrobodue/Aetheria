// components/shell/library/FacetChip.tsx (v16.2, smart filters; mockups filter-sheet-phone, -lower, -keys)
//
// One chip of the filter sheet: a toggle button, 32 px tall with a 44 px tap target (its ::after box, as the kit's Chip
// does; the rows wrap with gap-y-3 so two targets never overlap). aria-pressed carries the state ("mixed" for a regime
// chip with some of its nine picked); the name says the count ("528 Hz, 6 tracks"). Picked: a check, semibold, raised,
// never colour alone; a regime chip that is partly picked shows a minus. A crystal's regime colour sits on its dot
// only. The count is faint; a chip that would show nothing is quieter but stays tappable (under OR it changes
// nothing). React.memo with string props and one stable callback, so a tap renders only the chips whose look changed.

import React from 'react';
import { Check, Minus } from 'lucide-react';
import { countRender } from '../devRenders';
import { chipName } from './filterViewModel';

interface FacetChipProps {
  /** The facet's id ('crystal', 'length' …, or 'regime' for a regime chip). */
  facet: string;
  /** The value's id ('528', 'lt3' …, or the regime's id). */
  value: string;
  label: string;
  count: number;
  pressed: boolean | 'mixed';
  /** A bg-regime-* class for the dot (the crystal chips). */
  dotClass?: string;
  onToggle: (facet: string, value: string) => void;
}

const BASE =
  "relative inline-flex items-center gap-1.5 h-8 px-3 rounded-pill whitespace-nowrap border text-xs tabular-nums after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400";
const PICKED = `${BASE} border-ink-muted bg-surface-raised text-ink-strong font-semibold`;
const EMPTY = `${BASE} border-line bg-surface-panel text-ink-faint hover:border-line-strong`;
const PLAIN = `${BASE} border-line-strong bg-surface-panel text-ink-soft hover:border-ink-faint`;

const FacetChip = ({ facet, value, label, count, pressed, dotClass, onToggle }: FacetChipProps) => {
  countRender('FacetChip');
  const on = pressed !== false;
  return (
    <button
      type="button"
      aria-pressed={pressed === 'mixed' ? 'mixed' : pressed ? 'true' : 'false'}
      aria-label={chipName(label, count)}
      data-facet={facet}
      data-value={value}
      onClick={() => onToggle(facet, value)}
      className={on ? PICKED : count === 0 ? EMPTY : PLAIN}
    >
      {pressed === 'mixed' ? (
        <Minus size={14} className="shrink-0" aria-hidden="true" />
      ) : pressed ? (
        <Check size={14} className="shrink-0" aria-hidden="true" />
      ) : dotClass ? (
        <span aria-hidden="true" className={`w-2 h-2 rounded-pill shrink-0 ${dotClass}`} />
      ) : null}
      <span aria-hidden="true">{label}</span>
      <span aria-hidden="true" className={on ? 'font-normal text-ink-soft' : 'font-normal text-ink-faint'}>
        {count.toLocaleString('en-US')}
      </span>
    </button>
  );
};

export default React.memo(FacetChip);
