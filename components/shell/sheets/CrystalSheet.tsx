// components/shell/sheets/CrystalSheet.tsx (v15.5, the new layout beta; v15.6 on the shared picker)
//
// The Crystal sheet (mockup sheet-crystal-phone): all 27 crystals (the experience filter applies only when the user
// turns it on, in the Layers tab's Advanced), by regime, the playing cell and the track's own marked, the way back to
// the track's crystal while they differ, the 111 Hz chip, the Lo Shu Perfect GUT switch and the comfort line. The body
// is the Layers tab's CrystalPicker (one component, two hosts); a tap is the existing selectFrequency, then the sheet
// closes (2 taps from Now Playing). The subtitle says both ("Playing 528 Hz · this track's crystal is 396 Hz").
// v16.6 ("How sure are we?"): the crystal's meaning block (CrystalMeaning) opens the body, above the picker; its tag
// leads to the Guide, and the Guide's "Back to Crystal" reopens this sheet over the tab it was on.

import React from 'react';
import Sheet from '../../ui/Sheet';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, usePlayer, useShell, useSound } from '../contexts';
import CrystalMeaning from '../../guide/CrystalMeaning';
import { EvidenceOrigin } from '../../guide/evidenceLink';
import { countRender } from '../devRenders';
import CrystalPicker from '../layers/CrystalPicker';
import { sheetFallback } from './sheetFallback';

const CrystalBody = () => {
  countRender('CrystalBody');
  return (
    <div data-testid="crystal-body" className="px-4 pb-4">
      <div className="mb-3">
        <CrystalMeaning host="sheet" />
      </div>
      <CrystalPicker host="sheet" />
    </div>
  );
};

interface CrystalSheetProps {
  presentation: 'sheet' | 'panel';
}

const CrystalSheet = ({ presentation }: CrystalSheetProps) => {
  const s = useSound();
  const p = usePlayer();
  const actions = useActions();
  const { tab } = useShell();
  const origin = React.useMemo(() => ({ tab, sheet: 'crystal', label: 'Crystal' }), [tab]);
  const verb = p.isPlaying || p.toneOnly ? 'Playing' : 'Selected';
  const subtitle =
    s.trackHz === null
      ? `${verb} ${s.crystalHz} Hz`
      : s.trackHz === s.crystalHz
        ? `${verb} ${s.crystalHz} Hz · this track's crystal`
        : `${verb} ${s.crystalHz} Hz · this track's crystal is ${s.trackHz} Hz`;
  return (
    <Sheet open title="Crystal" subtitle={subtitle} onClose={actions.closeSheet} presentation={presentation} data-testid="sheet-crystal">
      <EvidenceOrigin.Provider value={origin}>
        <ViewBoundary name="sheet-crystal" fallback={sheetFallback(actions.closeSheet)} render={() => <CrystalBody />} />
      </EvidenceOrigin.Provider>
    </Sheet>
  );
};

export default React.memo(CrystalSheet);
