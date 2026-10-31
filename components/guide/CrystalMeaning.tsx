// components/guide/CrystalMeaning.tsx (v16.6, "How sure are we?"; the v16.6 spec §3.4.1 A12, mockup crystal-sheet.png)
//
// The new layout's crystal meaning, which it never showed before: one bordered block, tagged, in the Crystal sheet
// (between the subtitle and "Back to the track's crystal") and in Layers › Crystal (under the tile's heard line).
//   line 1: the regime dot, "528 Hz · Transformation" (111: "111 Hz");
//   line 2: the association (crystalCopy: "Traditionally associated with …" for GUT, "In the Aetheria framework, …" for
//           HEART and HEAD), and for a Lo Shu Perfect counterpart "Lo Shu Perfect counterpart of 528 Hz." [Arithmetic];
//   line 3: "Shape: Metatron's Cube · Light", from GEOMETRY_INFO's shape and element (read here, the table untouched);
//   the tag: Tradition (111: Design choice), one tap to "How sure are we?".
// It reads SoundContext.crystalHz (a crystal change), never the clock: a thin reader hands the number to a memoised
// block, so other SoundContext changes (the layers' state after a pick) never re-render the block (spec §6.4: once per
// crystal change). Nothing is added to Now Playing, the mini-player, the Car screen or the lock-screen card.

import React from 'react';
import EvidenceTag from '../ui/EvidenceTag';
import { useSound } from '../shell/contexts';
import { countRender } from '../shell/devRenders';
import { REGIME_DOT, regimeOf } from '../shell/shellModel';
import { GEOMETRY_INFO } from '../../constants';
import { crystalCopy, perfectAssociation, perfectLine, shapeLine } from '../../utils/copy/crystalCopy';

/** GEOMETRY_INFO's shape · element for a crystal (its `freq` is "528Hz"). */
function shapeOf(hz: number): string | null {
  const g = GEOMETRY_INFO.find((x) => x.freq === `${hz}Hz`);
  return g ? shapeLine(g.shape, g.element) : null;
}

const MeaningBlock = React.memo(({ hz, host }: { hz: number; host: 'sheet' | 'section' }) => {
  countRender('CrystalMeaning');
  const c = crystalCopy(hz);
  if (!c) return null;
  const base = c.perfectOf ?? c.hz;
  const shape = c.hz === 111 ? null : shapeOf(base);
  return (
    <div data-evidence={c.tag} data-testid={`crystal-meaning-${host}`} className="rounded-card border border-line bg-surface-raised/60 p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`shrink-0 w-2.5 h-2.5 rounded-pill ${REGIME_DOT[regimeOf(hz)]}`} />
        <span data-testid="crystal-meaning-title" className="text-base font-semibold text-ink-strong">
          {c.hz === 111 ? c.name : `${hz} Hz · ${c.name}`}
        </span>
      </div>
      {c.perfectOf ? (
        <p data-testid="crystal-meaning-perfect" className="text-xs text-ink-muted">
          {perfectLine(c.perfectOf)}
        </p>
      ) : null}
      <p data-testid="crystal-meaning-association" className="text-sm text-ink-soft leading-snug">
        {c.perfectOf ? perfectAssociation(c.perfectOf) : c.association}
      </p>
      {shape ? (
        <p data-testid="crystal-meaning-shape" className="text-xs text-ink-muted">
          {shape}
        </p>
      ) : null}
      <div className="pt-1 flex flex-wrap items-center gap-x-2 gap-y-3">
        <EvidenceTag tier={c.tag} />
        {c.perfectOf ? <EvidenceTag tier="arithmetic" /> : null}
      </div>
    </div>
  );
});

const CrystalMeaning = ({ host }: { host: 'sheet' | 'section' }) => {
  const { crystalHz } = useSound();
  return <MeaningBlock hz={crystalHz} host={host} />;
};

export default React.memo(CrystalMeaning);
