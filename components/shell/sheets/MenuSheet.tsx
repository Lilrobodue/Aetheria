// components/shell/sheets/MenuSheet.tsx (v15.5, the new layout beta)
//
// The ⋯ menu (mockup menu-phone): Stop all sound, Track info, Stop recording (while one runs), Back to classic, and
// Cancel. 64 px rows. Always a modal sheet, on the desktop shell too. Track info closes the menu first, so the readout
// Dialog never sits on a Sheet.

import React from 'react';
import { ArrowLeftRight, Circle, Info, OctagonX } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import ListRow from '../../ui/ListRow';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, usePlayer } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from './sheetFallback';

const MenuBody = () => {
  countRender('MenuBody');
  const actions = useActions();
  const { isRecording } = usePlayer();
  return (
    <div data-testid="menu-body" className="pb-2">
      <ListRow
        title="Stop all sound"
        subtitle="The music, the tone, the beat and the drone"
        icon={<OctagonX size={20} className="stroke-status-error" />}
        onClick={() => {
          actions.closeSheet();
          actions.stopAll();
        }}
        data-testid="menu-stop-all"
      />
      <ListRow title="Track info" subtitle="Crystal, key and scan details for this track" icon={<Info size={20} />} onClick={actions.trackInfo} data-testid="menu-track-info" />
      {isRecording ? (
        <ListRow
          title="Stop recording"
          subtitle="Saves the recording to your downloads"
          icon={<Circle size={20} className="stroke-status-error" />}
          onClick={() => {
            actions.closeSheet();
            actions.stopRecording();
          }}
        />
      ) : null}
      <ListRow
        title="Back to classic"
        subtitle="The classic layout; the music keeps playing"
        icon={<ArrowLeftRight size={20} />}
        onClick={() => actions.setLayout('classic')}
        data-testid="menu-back-to-classic"
      />
      <button
        type="button"
        onClick={actions.closeSheet}
        className="mt-3 mx-4 w-[calc(100%-2rem)] h-touch rounded-control text-sm text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        Cancel
      </button>
    </div>
  );
};

const MenuSheet = () => {
  const actions = useActions();
  return (
    <Sheet open title="More options" headerless onClose={actions.closeSheet} data-testid="sheet-menu">
      <ViewBoundary name="menu" fallback={sheetFallback(actions.closeSheet)} render={() => <MenuBody />} />
    </Sheet>
  );
};

export default React.memo(MenuSheet);
