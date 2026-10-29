// components/shell/mixes/MixRow.tsx (v15.9, the Mixes tab; variant A, mockups mixes-phone-A-scrolled, -experimental)
//
// A journey, a crystal set or an Experimental mix as a 64 px row, one button: a decorative 40 × 40 tile of its crystals'
// dots, its name, its recipe, and a trailing count ("59 tracks"). Named in full ("Grounding, 59 tracks"), its recipe as
// its description. With no track for it (or the library still loading) it is not a button: a dimmed row whose count
// says why ("No tracks yet", "Needs Deep Scan"). `extra`: a line under the row that stays live either way (the 111
// Sequence's pointer to the 111 Hz chip).
// v16.3: a live row has a ⋯ after its count (44 × 44, "More for Grounding": Play next, Add to queue, Customize…, Save as
// a playlist…); a disabled row has none. The row's tap is unchanged.

import React from 'react';
import { EllipsisVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MixDef, MixId } from '../../../utils/mix/catalog';
import CrystalDots from './CrystalDots';
import type { Dots, MixView } from './mixesModel';
import { moreName } from './mixesModel';

interface MixRowProps {
  def: MixDef;
  view: MixView;
  dots: Dots;
  onStart: (id: MixId) => void;
  /** v16.3: the ⋯ (its sheet opens). */
  onMore?: (id: MixId) => void;
  extra?: ReactNode;
}

const MixRow = ({ def, view, dots, onStart, onMore, extra }: MixRowProps) => {
  const subId = `mix-sub-${def.id}`;
  const on = view.enabled;
  const inner = (
    <>
      <span aria-hidden="true" className={on ? 'shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center' : 'shrink-0 w-10 h-10 rounded-control border border-line flex items-center justify-center'}>
        <CrystalDots dots={dots} />
      </span>
      <span className="flex-1 min-w-0">
        <span className={on ? 'block text-sm truncate text-ink-strong' : 'block text-sm truncate text-ink-faint'}>{def.name}</span>
        <span id={on ? subId : undefined} className={on ? 'block text-xs truncate text-ink-muted' : 'block text-xs truncate text-ink-faint'}>{def.sub}</span>
      </span>
      <span className={on ? 'shrink-0 text-xs tabular-nums text-ink-muted' : 'shrink-0 text-xs tabular-nums text-ink-faint'}>{view.text}</span>
    </>
  );
  return (
    <li className="border-b border-line">
      {on && onMore ? (
        <div className="flex items-center">
          <button
            type="button"
            data-testid={`mix-${def.id}`}
            aria-label={view.label}
            aria-describedby={subId}
            onClick={() => onStart(def.id)}
            className="flex-1 min-w-0 h-row pl-4 pr-1 flex items-center gap-3 text-left hover:bg-surface-raised/40 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400"
          >
            {inner}
          </button>
          <button
            type="button"
            data-testid={`mix-more-${def.id}`}
            aria-label={moreName(def)}
            aria-haspopup="dialog"
            title={moreName(def)}
            onClick={() => onMore(def.id)}
            className="shrink-0 w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400"
          >
            <EllipsisVertical size={18} aria-hidden="true" />
          </button>
        </div>
      ) : on ? (
        <button
          type="button"
          data-testid={`mix-${def.id}`}
          aria-label={view.label}
          aria-describedby={subId}
          onClick={() => onStart(def.id)}
          className="w-full h-row px-4 flex items-center gap-3 text-left hover:bg-surface-raised/40 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400"
        >
          {inner}
        </button>
      ) : (
        <div data-testid={`mix-${def.id}`} className="h-row px-4 flex items-center gap-3">
          {inner}
        </div>
      )}
      {extra}
    </li>
  );
};

export default React.memo(MixRow);
