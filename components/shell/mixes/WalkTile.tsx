// components/shell/mixes/WalkTile.tsx (v15.9, the Mixes tab; mockup mixes-phone-A-top)
//
// One Lo Shu walk as a tile of 96 px or more in the two-column grid: its size in positions (large, tabular), its short
// name, its recipe on one line, and how much of it the library fills ("26 of 27 positions"). One button, named in
// full ("Flying Star Vortex, 26 of 27 positions, playing"), its recipe as its description. The walk that is the play
// order (current): a stronger border, aria-current, and a badge that says Playing while the music plays and Paused while
// it is paused. With no track for it (or the library still loading) it is not a button: a dashed, dimmed tile whose
// count line says why.
// v16.3: a live tile has a ⋯ at its top right (44 × 44, "More for Flying Star Vortex"), the Playing badge left of it; a
// disabled tile has none. The tile's tap is unchanged.

import React from 'react';
import { EllipsisVertical } from 'lucide-react';
import Badge from '../../ui/Badge';
import type { MixDef, MixId } from '../../../utils/mix/catalog';
import type { MixView } from './mixesModel';
import { moreName } from './mixesModel';

interface WalkTileProps {
  def: MixDef;
  view: MixView;
  size: number;
  /** The walk is the play order now. */
  current: boolean;
  /** The music plays (else it is paused). */
  playing: boolean;
  onStart: (id: MixId) => void;
  /** v16.3: the ⋯ (its sheet opens). */
  onMore?: (id: MixId) => void;
}

const WalkTile = ({ def, view, size, current, playing, onStart, onMore }: WalkTileProps) => {
  const subId = `mix-sub-${def.id}`;
  if (!view.enabled) {
    return (
      <li data-testid={`mix-${def.id}`} className="min-w-0 min-h-[96px] p-3 rounded-card border border-dashed border-line-strong flex flex-col">
        <span className="text-2xl leading-none font-semibold tabular-nums text-ink-faint">{size}</span>
        <span className="mt-2 block text-sm font-semibold truncate text-ink-faint">{def.name}</span>
        <span className="block text-xs truncate text-ink-faint">{def.sub}</span>
        <span className="mt-1 block text-xs tabular-nums text-ink-faint">{view.text}</span>
      </li>
    );
  }
  return (
    <li className="relative min-w-0">
      <button
        type="button"
        data-testid={`mix-${def.id}`}
        aria-label={view.label}
        aria-describedby={subId}
        aria-current={current ? 'true' : undefined}
        onClick={() => onStart(def.id)}
        className={
          current
            ? 'w-full h-full min-h-[96px] p-3 rounded-card border text-left flex flex-col border-ink-muted bg-surface-raised/60 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
            : 'w-full h-full min-h-[96px] p-3 rounded-card border text-left flex flex-col border-line bg-surface-panel hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
        }
      >
        <span className={onMore ? 'pr-10 flex items-start justify-between gap-2' : 'flex items-start justify-between gap-2'}>
          <span className="text-2xl leading-none font-semibold tabular-nums text-ink-strong">{size}</span>
          {current ? <Badge look="active">{playing ? 'Playing' : 'Paused'}</Badge> : null}
        </span>
        <span className="mt-2 block text-sm font-semibold truncate text-ink-strong">{def.name}</span>
        <span id={subId} className="block text-xs truncate text-ink-muted">{def.sub}</span>
        <span className="mt-1 block text-xs tabular-nums text-ink-muted">{view.text}</span>
      </button>
      {onMore ? (
        <button
          type="button"
          data-testid={`mix-more-${def.id}`}
          aria-label={moreName(def)}
          aria-haspopup="dialog"
          title={moreName(def)}
          onClick={() => onMore(def.id)}
          className="absolute top-1 right-1 w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          <EllipsisVertical size={18} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
};

export default React.memo(WalkTile);
