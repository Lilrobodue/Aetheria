// components/shell/mixes/MixMenu.tsx (v16.3, whole-mix queueing; mockups mix-menu-phone, mix-menu-walk-phone,
// mixes-menu-desktop)
//
// A Mixes-tab mix's ⋯: a kit Sheet (modal on both shells; the kit centres it on the desktop), its body the `mix-menu`
// region. The header: the mix's dots (or a walk's size), its full name, its recipe and its count. Then Play next ("All 62,
// right after the track that's playing, in the mix's order."; a walk adds "They play as tracks, not as a walk."; CAB,
// Ouroboros and CABI "A new draw."), Add to queue (after the tracks waiting), Customize… (Create a mix at this mix's
// own settings) and Save as a playlist… (v16.1's name Dialog); Cancel. Each item closes the sheet first, then acts (a
// Dialog never sits on a Sheet). The queue's lines follow QueueContext, never the clock.

import React from 'react';
import { BookmarkPlus, ListEnd, ListStart, SlidersHorizontal } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import ListRow from '../../ui/ListRow';
import { ViewBoundary } from '../../ErrorBoundary';
import { useQueue } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from '../sheets/sheetFallback';
import CrystalDots from './CrystalDots';
import type { MixDef } from '../../../utils/mix/catalog';
import type { Dots, MixView } from './mixesModel';
import { MENU_CUSTOMIZE_LINE, isRandomWalk, menuNextLine, menuQueueLine, menuSaveLine, menuSub, playsAsWalk, walkSize } from './mixesModel';

export type MixAction = 'next' | 'queue' | 'customize' | 'save';

interface MixMenuProps {
  def: MixDef;
  view: MixView;
  dots: Dots;
  /** Its entries now (utils/mix/catalog.ts mixCounts: what its tap plays). */
  count: number;
  /** Customize… (Create a mix at this mix's settings) is offered. */
  customize: boolean;
  onAction: (a: MixAction) => void;
  onClose: () => void;
}

const Body = ({ def, view, dots, count: n, customize, onAction, onClose }: MixMenuProps) => {
  countRender('MixMenu');
  const queue = useQueue();
  const o = { walk: playsAsWalk(def.id), random: isRandomWalk(def.id), nothingCurrent: queue.nothingCurrent };
  return (
    <div data-testid="mix-menu-body" className="pb-2">
      <div className="px-4 pt-1 pb-3 flex items-center gap-3 border-b border-line">
        <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center">
          {def.walk ? <span className="text-sm font-semibold tabular-nums text-ink-strong">{walkSize(def)}</span> : <CrystalDots dots={dots} />}
        </span>
        <span className="min-w-0">
          <span aria-hidden="true" className="block text-base font-semibold text-ink-strong truncate">
            {def.fullName}
          </span>
          <span data-testid="mix-menu-sub" className="block text-xs text-ink-muted truncate">
            {menuSub(def, view)}
          </span>
        </span>
      </div>
      <ListRow title="Play next" subtitle={menuNextLine(n, o)} icon={<ListStart size={20} />} onClick={() => onAction('next')} data-testid="mix-action-next" />
      <ListRow title="Add to queue" subtitle={menuQueueLine(n, queue.waiting, o)} icon={<ListEnd size={20} />} onClick={() => onAction('queue')} data-testid="mix-action-queue" />
      {customize ? <ListRow title="Customize…" subtitle={MENU_CUSTOMIZE_LINE} icon={<SlidersHorizontal size={20} />} onClick={() => onAction('customize')} data-testid="mix-action-customize" /> : null}
      <ListRow title="Save as a playlist…" subtitle={menuSaveLine(n, o.random)} icon={<BookmarkPlus size={20} />} onClick={() => onAction('save')} data-testid="mix-action-save" />
      <button
        type="button"
        onClick={onClose}
        className="mt-3 mx-4 w-[calc(100%-2rem)] h-touch rounded-control text-sm text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        Cancel
      </button>
    </div>
  );
};

const MixMenu = (props: MixMenuProps) => (
  <Sheet open title={props.def.fullName} headerless onClose={props.onClose} data-testid="mix-menu">
    <ViewBoundary name="mix-menu" fallback={sheetFallback(props.onClose)} render={() => <Body {...props} />} />
  </Sheet>
);

export default React.memo(MixMenu);
