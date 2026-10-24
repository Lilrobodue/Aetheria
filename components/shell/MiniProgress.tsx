// components/shell/MiniProgress.tsx (v15.5, the new layout beta)
//
// The mini-player's 2 px progress line: a reader of the time context, so the mini-player itself never follows the
// 4 Hz clock.

import React from 'react';
import { useTime } from './contexts';
import { countRender } from './devRenders';

const MiniProgress = () => {
  countRender('MiniProgress');
  const { t, d } = useTime();
  const pct = d > 0 ? Math.min(100, Math.max(0, (t / d) * 100)) : 0;
  return (
    <div aria-hidden="true" className="absolute top-0 inset-x-0 h-0.5 bg-surface-control">
      <div data-testid="mini-progress" className="h-0.5 bg-gold-500" style={{ width: `${pct}%` }} />
    </div>
  );
};

export default React.memo(MiniProgress);
