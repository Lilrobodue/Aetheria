// components/shell/layers/LevelsSection.tsx (v15.6, the Layers tab and the Sound sheet)
//
// The three levels (mockup layers-phone-A-levels): Volume, Tone level and Beat level, v15.5's Sound-sheet sliders moved
// here unchanged (same ranges, steps and readouts; the beat slider off under Car with its reason), then the comfort
// line, then Key fit (v2 only, as classic) under its own divider: its switch, KEY_FIT_DESCRIPTION, the status line
// classic's card shows (keyFitRowText) and KEY_FIT_EVIDENCE. The sliders read only the levels context, so a drag
// re-renders them alone (LayersLevels); Key fit reads the sound context.

import React from 'react';
import Toggle from '../../ui/Toggle';
import SliderWithReadout from '../../ui/SliderWithReadout';
import { TONE_LEVEL_LABEL, BEAT_LEVEL_LABEL, KEY_FIT_LABEL, KEY_FIT_DESCRIPTION, KEY_FIT_EVIDENCE } from '../../layers/layerCopy';
import { V2_TONE_SLIDER_MAX, V2_TONE_SLIDER_STEP, V2_BEAT_SLIDER_MAX } from '../../../utils/soundV2/layerHost';
import { useActions, useLevels, useSound } from '../contexts';
import { countRender } from '../devRenders';
import SectionCard from './SectionCard';
import EvidenceTag from '../../ui/EvidenceTag';
import { COMFORT_LEVELS } from './layersModel';

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** The sliders (v15.5's SoundSheet Levels, moved). */
export const LevelsControls = React.memo(() => {
  countRender('LayersLevels');
  const l = useLevels();
  const actions = useActions();
  const v2Beat = l.v2Active || l.v2CarFallback;
  return (
    <div className="space-y-2">
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
    </div>
  );
});

/** Key fit (v2 only): classic's card (KeyFitRow) in the kit; KeyFitRow itself stays for classic. */
const KeyFitBlock = React.memo(() => {
  countRender('LayersKeyFit');
  const s = useSound();
  const actions = useActions();
  return (
    <div data-testid="layers-keyfit" className="space-y-2">
      <Toggle label={KEY_FIT_LABEL} description={KEY_FIT_DESCRIPTION} checked={s.keyFitOn} onChange={() => actions.toggleKeyFit()} />
      <p data-testid="layers-keyfit-status" className="text-sm text-ink-soft">
        {s.keyFitRowLine}
      </p>
      <div data-evidence="tier1" className="space-y-2">
        <p className="text-xs text-ink-faint leading-snug">{KEY_FIT_EVIDENCE}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          <EvidenceTag tier="tier1" />
          <EvidenceTag tier="design" />
        </div>
      </div>
    </div>
  );
});

/** The levels, the comfort line and Key fit: the tab's Levels card holds them; so does the Sound sheet. */
export const LevelsBody = React.memo(() => {
  const { v2Active } = useSound();
  return (
    <>
      <LevelsControls />
      <p className="text-xs text-ink-faint leading-snug">{COMFORT_LEVELS}</p>
      {v2Active ? (
        <>
          <div className="border-t border-line" />
          <KeyFitBlock />
        </>
      ) : null}
    </>
  );
});

/** The tab's Levels card: its status is the Key fit chip's text while that shows. */
const LevelsSection = () => {
  countRender('LayersLevelsCard');
  const s = useSound();
  return (
    <SectionCard section="levels" title="Levels" status={s.keyFitShown ? s.keyFitText : null}>
      <LevelsBody />
    </SectionCard>
  );
};

export default React.memo(LevelsSection);
