// components/shell/sheets/WalksSheet.tsx (v15.5, the new layout beta)
//
// The Walks sheet: the Lo Shu menu's six walks as 64 px rows (Ascent, Pillar, Vortex: 27 steps; CAB 81, Ouroboros 29,
// CABI 110), each with its name and tagline (LO_SHU_WALK_INFO), the active one marked, and Clear walk badge while a
// walk plays. A tap is the existing generateLoShuWalk, which builds the walk and starts playing it; the sheet closes.

import React from 'react';
import Sheet from '../../ui/Sheet';
import ListRow from '../../ui/ListRow';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import { ViewBoundary } from '../../ErrorBoundary';
import { LO_SHU_WALK_INFO } from '../../../constants';
import { useActions, useWalk } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from './sheetFallback';

const WALKS: ReadonlyArray<{ mode: 'A' | 'B' | 'C' | 'combined' | 'ouroboros' | 'cabi'; steps: number }> = [
  { mode: 'A', steps: 27 },
  { mode: 'B', steps: 27 },
  { mode: 'C', steps: 27 },
  { mode: 'combined', steps: 81 },
  { mode: 'ouroboros', steps: 29 },
  { mode: 'cabi', steps: 110 },
];

const WalksBody = () => {
  countRender('WalksBody');
  const walk = useWalk();
  const actions = useActions();
  return (
    <div data-testid="walks-body" className="pb-2">
      <p className="px-4 pb-2 text-sm text-ink-muted">Six paths through the Lo Shu cube. A walk builds its play order from your library and starts playing.</p>
      {WALKS.map(({ mode, steps }) => {
        const info = LO_SHU_WALK_INFO[mode];
        const active = walk.mode === mode;
        return (
          <React.Fragment key={mode}>
          <ListRow
            title={info.fullName}
            subtitle={info.tagline}
            icon={<span className="text-sm font-semibold tabular-nums text-ink-strong">{steps}</span>}
            current={active}
            trailing={active ? <Badge look="active">Playing</Badge> : undefined}
            onClick={() => {
              actions.startWalk(mode);
              actions.closeSheet();
            }}
            data-testid={`walk-${mode}`}
          />
          </React.Fragment>
        );
      })}
      {walk.mode ? (
        <div className="px-4 pt-3">
          <Button variant="secondary" onClick={actions.clearWalk} className="w-full">
            Clear walk badge
          </Button>
        </div>
      ) : null}
    </div>
  );
};

interface WalksSheetProps {
  presentation: 'sheet' | 'panel';
}

const WalksSheet = ({ presentation }: WalksSheetProps) => {
  const walk = useWalk();
  const actions = useActions();
  return (
    <Sheet
      open
      title="Walks"
      subtitle={walk.fullName ? `Playing ${walk.fullName}` : 'Lo Shu walks'}
      onClose={actions.closeSheet}
      presentation={presentation}
      data-testid="sheet-walks"
    >
      <ViewBoundary name="sheet-walks" fallback={sheetFallback(actions.closeSheet)} render={() => <WalksBody />} />
    </Sheet>
  );
};

export default React.memo(WalksSheet);
