// components/shell/tabs/TabStub.tsx (v15.5, the new layout beta)
//
// Mixes until its own release (decision 4, mockup mini-player-library): an honest note that the new one comes in a
// later beta, and one primary button that "peeks" into the classic layout at the right place (Open the classic mixes),
// with a floating "Back to the new layout"; the saved choice stays new. It offers the Walks sheet too. Solid
// (bg-surface-deep): the heat guard pauses the visualizer behind it on the phone. (Layers was a stub too until v15.6:
// components/shell/layers/LayersTab.tsx; Library until v15.7: components/shell/library/LibraryTab.tsx, which took its
// summary.)

import React from 'react';
import { Route, Sparkles, X } from 'lucide-react';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import IconButton from '../../ui/IconButton';
import { useActions } from '../contexts';
import { countRender } from '../devRenders';
import type { PeekPanel } from '../shellModel';

export type StubTab = 'mixes';

const COPY: Record<StubTab, { title: string; soon: string; body: string; open: string; peek: PeekPanel }> = {
  mixes: {
    title: 'Mixes',
    soon: 'The new Mixes are coming in a later beta',
    body: 'Journeys, alignments and the other mixes are in the classic library panel for now. The music keeps playing when you switch.',
    open: 'Open the classic mixes',
    peek: 'mixes',
  },
};

interface TabStubProps {
  tab: StubTab;
  /** In the desktop shell's panel (a Close button), else full screen on the phone. */
  inPanel?: boolean;
}

const TabStub = ({ tab, inPanel = false }: TabStubProps) => {
  countRender(`TabStub:${tab}`);
  const actions = useActions();
  const c = COPY[tab];
  return (
    <div
      data-testid={`tab-${tab}`}
      className={inPanel ? 'h-full flex flex-col bg-surface-panel border-r border-line-strong' : 'absolute inset-0 flex flex-col bg-surface-deep pointer-events-auto'}
    >
      <header className={inPanel ? 'shrink-0 h-14 pl-4 pr-2 flex items-center justify-between gap-2 border-b border-line bg-surface-deep' : 'shrink-0 h-14 px-4 flex items-center justify-between gap-2 border-b border-line bg-surface-deep'}>
        <h1 tabIndex={-1} data-view-heading="" className="text-lg font-semibold text-ink-strong outline-none">
          {c.title}
        </h1>
        <span className="flex items-center gap-1">
          <Badge>Beta</Badge>
          {inPanel ? <IconButton label="Close panel" icon={<X size={20} />} onClick={() => actions.setTab('now')} /> : null}
        </span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-4 space-y-3">
        <div className="p-4 rounded-card border border-dashed border-line-strong">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-strong">
            <Sparkles size={16} className="shrink-0 text-gold-400" aria-hidden="true" />
            {c.soon}
          </div>
          <p className="mt-1 text-sm text-ink-muted">{c.body}</p>
          <Button variant="primary" onClick={() => actions.peekClassic(c.peek)} className="mt-3 w-full" data-testid={`peek-${c.peek}`}>
            {c.open}
          </Button>
        </div>
        {tab === 'mixes' ? (
          <Button variant="secondary" onClick={() => actions.openSheet('walks')} className="w-full flex items-center justify-center gap-2">
            <Route size={16} className="text-ink-muted" aria-hidden="true" />
            Walks
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export default React.memo(TabStub);
