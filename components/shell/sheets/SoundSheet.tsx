// components/shell/sheets/SoundSheet.tsx (v15.5, the new layout beta; v15.6 restyled, decision 3 option A)
//
// The Sound sheet, the quick way to change the sound without leaving the visuals (sheets never pause them; the
// Layers tab does): a row into the Layers tab ("Every sound setting is in the Layers tab", at its Sound section), then
// the Layers tab's own Sound controls (without Export) and its Levels (the three sliders, the comfort line, Key fit),
// in the Quiet look (mockup sheet-sound-phone). Its subtitle is the layers chip's text ("Layers v2 · Car (tone only)").
// Opened from Output (or the Car screen's Change output), it starts at its Output group, so that tap count never
// depends on the screen's height. The levels read their own context, so a slider drag never re-renders the chips.

import React, { useEffect, useRef } from 'react';
import { ChevronRight, Layers } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, useShell, useSound } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from './sheetFallback';
import { SoundControls } from '../layers/SoundSection';
import { LevelsBody } from '../layers/LevelsSection';

const SoundBody = () => {
  countRender('SoundBody');
  const actions = useActions();
  return (
    <div data-testid="sound-body" className="px-4 pb-4 space-y-3">
      <button
        type="button"
        data-testid="sound-to-layers"
        onClick={() => actions.openLayers('sound')}
        className="w-full min-h-touch px-3 rounded-control border border-line bg-surface-deep flex items-center justify-between gap-2 text-sm text-ink-soft hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        <span className="flex items-center gap-2 text-left">
          <Layers size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
          Every sound setting is in the Layers tab
        </span>
        <ChevronRight size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
      </button>
      <SoundControls withExport={false} />
      <div className="border-t border-line" />
      <LevelsBody />
    </div>
  );
};

interface SoundSheetProps {
  presentation: 'sheet' | 'panel';
}

const SoundSheet = ({ presentation }: SoundSheetProps) => {
  const s = useSound();
  const { sheetFocus } = useShell();
  const actions = useActions();
  const bodyRef: { current: HTMLDivElement | null } = useRef(null);
  useEffect(() => {
    if (sheetFocus !== 'output') return;
    const group = bodyRef.current?.querySelector('[role="group"][aria-label="Output"]');
    if (group instanceof HTMLElement) group.scrollIntoView({ block: 'nearest' });
  }, [sheetFocus]);
  return (
    <Sheet open title="Sound" subtitle={s.layersText} onClose={actions.closeSheet} presentation={presentation} bodyRef={bodyRef} data-testid="sheet-sound">
      <ViewBoundary name="sheet-sound" fallback={sheetFallback(actions.closeSheet)} render={() => <SoundBody />} />
    </Sheet>
  );
};

export default React.memo(SoundSheet);
