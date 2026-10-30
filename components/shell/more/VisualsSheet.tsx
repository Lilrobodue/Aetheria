// components/shell/more/VisualsSheet.tsx (v16.4, the Visuals sheet; decision 1 A)
//
// Every visual setting, with the visuals showing while they change. On the phone a modal preview sheet over Now
// Playing (kit Sheet look="preview": 55 % of the screen, a transparent scrim, nothing dimmed; the heat guard keeps the
// visuals running because the tab is Now Playing); on the desktop the 420 px panel beside the canvas (non-modal: the
// transport stays usable). Opened from More › Visualizer, ⋯ › Visuals and Layers › Advanced › Visualizer settings.
// Its body is its own region (sheet-visuals): a crash there leaves the sheet's Close, the visuals and the music.
// The subtitle is its own leaf (it reads the pause and the Car screen), so this host never re-renders for a setting.

import React from 'react';
import Sheet from '../../ui/Sheet';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, useVisuals } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from '../sheets/sheetFallback';
import VisualsBody from './VisualsBody';
import { visualsSubtitle } from './visualsModel';

const VisualsSubtitle = React.memo(({ panel }: { panel: boolean }) => {
  countRender('VisualsSubtitle');
  const v = useVisuals();
  return <span data-testid="visuals-subtitle">{visualsSubtitle({ car: v.car, userPaused: v.userPaused, pausedNow: v.pausedNow, panel })}</span>;
});

const VisualsSheet = ({ presentation }: { presentation: 'sheet' | 'panel' }) => {
  countRender('VisualsSheet');
  const actions = useActions();
  const panel = presentation === 'panel';
  return (
    <Sheet
      open
      title="Visuals"
      subtitle={<VisualsSubtitle panel={panel} />}
      onClose={actions.closeSheet}
      presentation={presentation}
      look={panel ? 'default' : 'preview'}
      data-testid="sheet-visuals"
    >
      <ViewBoundary name="sheet-visuals" fallback={sheetFallback(actions.closeSheet)} render={() => <VisualsBody inPanel={panel} />} />
    </Sheet>
  );
};

export default React.memo(VisualsSheet);
