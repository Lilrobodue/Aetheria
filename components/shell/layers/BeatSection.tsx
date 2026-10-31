// components/shell/layers/BeatSection.tsx (v15.6, the Layers tab)
//
// The beat (mockup layers-phone-A-beat): Adaptive, then the five bands as a native radio group, each "Alpha · 10 Hz"
// over its range in neutral words (no benefit claims: v15.5's rule for SOLFEGGIO_INFO's, until v14.23's evidence
// tags), " · now" on the band delivered; v2's Gamma keeps its existing design-choice note. Picking a band is classic's
// row click: the preset, and Adaptive off. Under Car (v2 renders no beat) the radios are disabled and
// PRESETS_NOTE_CAR_V2 says why. The status line is the beat actually delivered (the Beat chip's words).
// v16.6 ("How sure are we?"): the card's lead is BEAT_EVIDENCE with its Mixed-evidence tag (whether a beat moves your
// brainwaves), and each band's subtitle names what the EEG band is usually seen with (BAND_LINES).

import React from 'react';
import Toggle from '../../ui/Toggle';
import RadioList from '../../ui/RadioList';
import { HEADPHONES_HINT, PRESETS_NOTE_CAR_V2, PRESETS_NOTE_V2 } from '../../layers/layerCopy';
import { useActions, useSound, useTuning } from '../contexts';
import { countRender } from '../devRenders';
import SectionCard from './SectionCard';
import { BEAT_BANDS, bandSubtitle, beatStatus } from './layersModel';
import EvidenceTag from '../../ui/EvidenceTag';
import { BEAT_EVIDENCE } from '../../../utils/copy/crystalCopy';

export const ADAPTIVE_DESCRIPTION = 'Follows the music’s energy, one band at a time. Picking a band below turns it off.';

const BeatSection = () => {
  countRender('LayersBeat');
  const t = useTuning();
  const s = useSound();
  const actions = useActions();
  // v2 (or its Car fallback) under Car renders no beat at all; classic always plays its beat.
  const noBeat = t.v2Beat && t.render === 'off';
  const items = BEAT_BANDS.map((b) => ({
    id: b.name,
    title: `${b.name} · ${b.delta} Hz`,
    subtitle: bandSubtitle(b.name, s.v2Active, b.name === t.nowBand),
  }));
  return (
    <SectionCard section="beat" title="Beat" status={beatStatus(t.adaptive, s.beatText)}>
      <div data-evidence={BEAT_EVIDENCE.tag} data-testid="layers-beat-evidence" className="space-y-2">
        <p className="text-xs text-ink-muted leading-snug">{BEAT_EVIDENCE.line}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          <EvidenceTag tier={BEAT_EVIDENCE.tag} />
        </div>
      </div>
      <Toggle label="Adaptive" description={ADAPTIVE_DESCRIPTION} checked={t.adaptive} onChange={actions.setAdaptive} data-testid="layers-adaptive" />
      <RadioList
        legend="Beat band"
        name="layers-beat-band"
        items={items}
        value={t.presetName}
        onChange={actions.choosePreset}
        disabled={noBeat}
        disabledNote={PRESETS_NOTE_CAR_V2}
        data-testid="layers-bands"
      />
      {t.v2Beat && !noBeat ? <p className="text-xs text-ink-muted leading-snug">{PRESETS_NOTE_V2}</p> : null}
      {s.v2Active && s.outputEffective === 'headphones' ? <p className="text-xs text-ink-faint leading-snug">{HEADPHONES_HINT}</p> : null}
    </SectionCard>
  );
};

export default React.memo(BeatSection);
