// components/shell/layers/CrystalSection.tsx (v15.6, the Layers tab)
//
// The tab's Crystal card (mockup layers-phone-A-crystal): the crystal the layers play, as a tile with its regime dot,
// "528 Hz GUT · playing" ("selected" while silent), and what is actually heard, from the engine's own fold (v2: "v2
// plays it as a 615 Hz tone under the music" for 4920; classic: at pitch up to 639 Hz, else "as a 62 Hz hum"; "The
// layers are off." under Music only or v2's Car fallback): the neutral, true answer to "is this crystal too high for
// me?". Then the track's own crystal, and the picker (the Crystal sheet's grid, the 111 chip, Perfect GUT, the comfort
// line).

import React from 'react';
import { usePlayer, useSound, useTuning } from '../contexts';
import { countRender } from '../devRenders';
import { REGIME_DOT, regimeName, regimeOf } from '../shellModel';
import SectionCard from './SectionCard';
import CrystalPicker from './CrystalPicker';
import { crystalStatus, heardLine, trackCrystalLine } from './layersModel';

const CrystalSection = () => {
  countRender('LayersCrystal');
  const s = useSound();
  const p = usePlayer();
  const t = useTuning();
  const sounding = p.isPlaying || p.toneOnly;
  const regime = regimeOf(s.crystalHz);
  const mode = t.heardHz === null ? 'off' : s.v2Active ? 'v2' : 'classic';
  const trackLine = trackCrystalLine(s.trackHz, s.crystalHz);
  return (
    <SectionCard section="crystal" title="Crystal" status={crystalStatus(s.crystalHz, sounding)}>
      <div data-testid="layers-crystal-tile" className="flex items-center gap-3">
        <span aria-hidden="true" className="shrink-0 w-12 h-12 rounded-control bg-surface-raised flex items-center justify-center">
          <span className={`w-3 h-3 rounded-pill ${REGIME_DOT[regime]}`} />
        </span>
        <div className="min-w-0">
          <div data-testid="layers-crystal-hz" className="text-2xl font-semibold tabular-nums text-ink-strong">
            {s.crystalHz} Hz{' '}
            <span className="text-sm font-normal text-ink-muted">
              {regimeName(regime)} · {sounding ? 'playing' : 'selected'}
            </span>
          </div>
          <div data-testid="layers-heard" className="text-xs text-ink-muted">
            {heardLine(mode, s.crystalHz, t.heardHz)}
          </div>
        </div>
      </div>
      {trackLine ? <div className="text-xs text-ink-muted">{trackLine}</div> : null}
      <CrystalPicker host="section" />
    </SectionCard>
  );
};

export default React.memo(CrystalSection);
