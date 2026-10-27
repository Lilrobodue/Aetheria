// components/shell/mixes/CrystalDots.tsx (v15.9, the Mixes tab)
//
// A row's decorative 40 × 40 tile: its crystals as small regime dots (mixesModel.dotsFor). Never the only carrier of
// meaning: the row's name, recipe and count say it all, and the tile is aria-hidden by its parent.

import React from 'react';
import type { Dot, Dots } from './mixesModel';

// Complete class literals (tailwind.config.js scans this file).
const CELL: Readonly<Record<Dot, string>> = {
  '.': 'w-1.5 h-1.5',
  o: 'w-1.5 h-1.5 rounded-pill border border-ink-faint',
  g: 'w-1.5 h-1.5 rounded-pill bg-regime-gut',
  h: 'w-1.5 h-1.5 rounded-pill bg-regime-heart',
  b: 'w-1.5 h-1.5 rounded-pill bg-regime-head',
};

const CrystalDots = ({ dots }: { dots: Dots }) =>
  dots.kind === 'source' ? (
    <span className={dots.hollow ? 'w-3 h-3 rounded-pill border border-ink-faint' : 'w-3 h-3 rounded-pill bg-regime-source'} />
  ) : (
    <span className="grid grid-cols-3 gap-1">
      {dots.cells.map((c: Dot, i: number) => (
        <span key={i} className={CELL[c]} />
      ))}
    </span>
  );

export default React.memo(CrystalDots);
