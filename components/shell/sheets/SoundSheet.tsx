// components/shell/sheets/SoundSheet.tsx (v15.5, the new layout beta)
//
// The Sound sheet: the layer-sound panel exactly as classic's transport popover shows it (LayerSoundPanel: Music only,
// the v2 / classic A/B, Output, the drone, Ask me again), Key fit (v2), and the three levels. Its subtitle is the
// layers chip's text ("Layers v2 · Car (tone only)"). Opened from Output (or the Car screen's Change output), it
// starts at its Output group, so that tap count never depends on the screen's height. The levels read their own
// context, so a slider drag never re-renders the chips.

import React, { useEffect, useRef } from 'react';
import Sheet from '../../ui/Sheet';
import SliderWithReadout from '../../ui/SliderWithReadout';
import LayerSoundPanel from '../../layers/LayerSoundPanel';
import KeyFitRow from '../../layers/KeyFitRow';
import { TONE_LEVEL_LABEL, BEAT_LEVEL_LABEL } from '../../layers/layerCopy';
import { V2_TONE_SLIDER_MAX, V2_TONE_SLIDER_STEP, V2_BEAT_SLIDER_MAX } from '../../../utils/soundV2/layerHost';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, useLevels, useShell, useSound } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from './sheetFallback';

const pct = (x: number) => `${Math.round(x * 100)} %`;

const Levels = () => {
  countRender('SoundLevels');
  const l = useLevels();
  const actions = useActions();
  const v2Beat = l.v2Active || l.v2CarFallback;
  return (
    <section aria-label="Levels" className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">Levels</h3>
      <SliderWithReadout label="Volume" min={0} max={1} step={0.01} value={l.volume} readout={pct(l.volume)} onChange={actions.setVolume} data-testid="level-volume" />
      {l.v2Active ? (
        <SliderWithReadout
          label={TONE_LEVEL_LABEL}
          min={0}
          max={V2_TONE_SLIDER_MAX}
          step={V2_TONE_SLIDER_STEP}
          value={Math.min(l.toneLevel, V2_TONE_SLIDER_MAX)}
          readout={l.toneText}
          onChange={actions.setToneLevel}
          data-testid="level-tone"
        />
      ) : (
        <SliderWithReadout label={TONE_LEVEL_LABEL} min={0} max={1} step={0.01} value={l.toneLevel} readout={pct(l.toneLevel)} onChange={actions.setToneLevel} data-testid="level-tone" />
      )}
      {v2Beat ? (
        <SliderWithReadout
          label={BEAT_LEVEL_LABEL}
          min={0}
          max={V2_BEAT_SLIDER_MAX}
          step={0.001}
          value={Math.min(l.beatLevel, V2_BEAT_SLIDER_MAX)}
          readout={l.beatText}
          onChange={actions.setBeatLevel}
          disabled={l.outputRender === 'off' || l.v2CarFallback}
          disabledNote="Car output plays no beat."
          data-testid="level-beat"
        />
      ) : (
        <SliderWithReadout label={BEAT_LEVEL_LABEL} min={0} max={0.2} step={0.001} value={l.beatLevel} readout={pct(l.beatLevel / 0.2)} onChange={actions.setBeatLevel} data-testid="level-beat" />
      )}
    </section>
  );
};

const SoundBody = () => {
  countRender('SoundBody');
  const s = useSound();
  const actions = useActions();
  return (
    <div data-testid="sound-body" className="px-4 pb-4 space-y-4">
      <LayerSoundPanel variant="popover" {...s.layerPanelProps} />
      {s.v2Active ? <KeyFitRow on={s.keyFitOn} status={s.keyFitRowLine} onToggle={actions.toggleKeyFit} /> : null}
      <Levels />
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
