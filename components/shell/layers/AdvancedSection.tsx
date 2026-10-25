// components/shell/layers/AdvancedSection.tsx (v15.6, the Layers tab, stage B)
//
// Advanced (mockup layers-phone-A-advanced):
//   - φ integration and Track shape (classic nests the second under the first, so it is disabled while φ is off, and
//     says so). Turning either off removes the seek bar's φ ticks and the phase word, as today. Their lines are the
//     engine's (v2: PHI_LEVELS_V2, PHI_BINAURAL_V2, PHI_ENVELOPE_V2; classic: its ratios, phase and envelope), and the
//     track's peak from its length (per track, never per tick).
//   - The crystal filter, the plan's decision 11: optional, off by default (all 27 show), saved from its tap only; the
//     level is classic's own (shared, journeys still raise it). The ceilings are the select's words: 963 / 2,000 /
//     5,000 Hz / all.
//   - Visualizer settings: in the classic layout until v14.22's Visualizer page (Open peeks into Harmonic Control).

import React from 'react';
import { ExternalLink } from 'lucide-react';
import Toggle from '../../ui/Toggle';
import Select from '../../ui/Select';
import Button from '../../ui/Button';
import { PHI_BINAURAL_V2, PHI_ENVELOPE_V2, PHI_LEVELS_V2 } from '../../layers/layerCopy';
import { useActions, useSound, useTuning } from '../contexts';
import { countRender } from '../devRenders';
import SectionCard from './SectionCard';
import { EXPERIENCE_LEVELS, NEEDS_PHI, PHI_CLASSIC_LINE, TRACK_SHAPE_CLASSIC_LINE, advancedStatus, trackPeakLine } from './layersModel';

export const FILTER_LABEL = 'Filter the crystals by experience level';
export const FILTER_DESCRIPTION = 'Off: all 27 show. On: only those up to the level below; the playing crystal always shows.';

const AdvancedSection = () => {
  countRender('LayersAdvanced');
  const t = useTuning();
  const s = useSound();
  const actions = useActions();
  const shapeNote = !t.phiMode ? NEEDS_PHI : t.phiTiming ? trackPeakLine(t.trackPeakS) : null;
  return (
    <SectionCard section="advanced" title="Advanced" status={advancedStatus(t.phiMode)}>
      <Toggle
        label="φ integration"
        description={s.v2Active ? `${PHI_LEVELS_V2}. ${PHI_BINAURAL_V2}.` : PHI_CLASSIC_LINE}
        checked={t.phiMode}
        onChange={actions.setPhiMode}
        data-testid="layers-phi"
      />
      <Toggle
        label="Track shape"
        description={s.v2Active ? `${PHI_ENVELOPE_V2}.` : TRACK_SHAPE_CLASSIC_LINE}
        checked={t.phiTiming}
        onChange={actions.setPhiTiming}
        disabled={!t.phiMode}
        note={shapeNote}
        data-testid="layers-track-shape"
      />
      <div className="border-t border-line" />
      <Toggle label={FILTER_LABEL} description={FILTER_DESCRIPTION} checked={t.crystalFilter} onChange={actions.setCrystalFilter} data-testid="layers-crystal-filter" />
      <Select label="Experience level" value={t.level} options={EXPERIENCE_LEVELS} onChange={actions.setExperienceLevel} data-testid="layers-experience" />
      <div className="border-t border-line" />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-ink-strong">Visualizer settings</div>
          <p className="text-xs text-ink-faint leading-snug">In the classic layout until the Visualizer page arrives. The music keeps playing.</p>
        </div>
        <Button variant="secondary" onClick={() => actions.peekClassic('sound')} className="shrink-0 flex items-center justify-center gap-2" data-testid="layers-open-visualizer">
          <ExternalLink size={16} className="text-ink-muted" aria-hidden="true" />
          Open
        </Button>
      </div>
    </SectionCard>
  );
};

export default React.memo(AdvancedSection);
