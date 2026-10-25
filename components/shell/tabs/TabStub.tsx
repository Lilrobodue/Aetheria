// components/shell/tabs/TabStub.tsx (v15.5, the new layout beta)
//
// Library and Mixes until their own releases (decision 4, mockup mini-player-library): an honest note that the new
// one comes in a later beta, and one primary button that "peeks" into the classic layout at the right place (Open the
// classic library / mixes), with a floating "Back to the new layout"; the saved choice stays new. Library also shows
// its summary (tracks, total length, where the play order comes from); Mixes offers the Walks sheet. Solid
// (bg-surface-deep): the heat guard pauses the visualizer behind it on the phone. (Layers was a stub too until v15.6:
// components/shell/layers/LayersTab.tsx.)

import React from 'react';
import { Route, Sparkles, X } from 'lucide-react';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import IconButton from '../../ui/IconButton';
import { useActions, useLibrarySummary, usePlayer, useWalk } from '../contexts';
import { countRender } from '../devRenders';
import { formatTotal } from '../shellModel';
import type { PeekPanel } from '../shellModel';

export type StubTab = 'library' | 'mixes';

const COPY: Record<StubTab, { title: string; soon: string; body: string; open: string; peek: PeekPanel }> = {
  library: {
    title: 'Library',
    soon: 'The new Library is coming in a later beta',
    body: 'Import, scan, search and delete in the classic layout for now. The music keeps playing when you switch.',
    open: 'Open the classic library',
    peek: 'library',
  },
  mixes: {
    title: 'Mixes',
    soon: 'The new Mixes are coming in a later beta',
    body: 'Journeys, alignments and the other mixes are in the classic library panel for now. The music keeps playing when you switch.',
    open: 'Open the classic mixes',
    peek: 'mixes',
  },
};

/** "Lo Shu walk · Vortex (27 tracks)", "your library", "a play order (12 tracks)". */
function playingFrom(walkName: string | null, sameOrder: boolean, count: number): { strong: string; rest: string } {
  const tracks = `(${count} track${count === 1 ? '' : 's'})`;
  if (walkName) return { strong: `Lo Shu walk · ${walkName}`, rest: ` ${tracks}` };
  if (sameOrder) return { strong: 'your library', rest: '' };
  return { strong: 'a play order', rest: ` ${tracks}` };
}

const LibrarySummary = () => {
  const lib = useLibrarySummary();
  const walk = useWalk();
  const p = usePlayer();
  const from = playingFrom(walk.name, lib.playOrderIsLibrary, lib.playOrderCount);
  return (
    <div data-testid="library-summary" className="p-4 rounded-card bg-surface-panel border border-line">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold text-ink-strong tabular-nums">
          {lib.count} <span className="text-sm font-normal text-ink-muted">{lib.count === 1 ? 'track' : 'tracks'}</span>
        </span>
        <span className="text-sm text-ink-muted tabular-nums">{formatTotal(lib.totalSeconds)}</span>
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        {p.hasTrack ? (
          <>
            Playing from <span className="text-ink-strong">{from.strong}</span>
            {from.rest}
          </>
        ) : lib.isScanning ? (
          'Scanning the library…'
        ) : (
          'Nothing playing'
        )}
      </p>
    </div>
  );
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
        {tab === 'library' ? <LibrarySummary /> : null}
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
