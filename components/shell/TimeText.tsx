// components/shell/TimeText.tsx (v15.5, the new layout beta)
//
// The time under the seek bar: elapsed, the φ phase word ("φ · Build / Peak / Resolve" while φ timing is on), total.
// The Car variant is the big "1:12 / 3:15" line. A reader of the time context: it follows the 4 Hz clock, so the
// views around it don't have to.

import React from 'react';
import { useTime } from './contexts';
import { countRender } from './devRenders';
import { formatTime, phiPhase } from './shellModel';

interface TimeTextProps {
  phi: boolean;
  variant?: 'phone' | 'car';
}

const TimeText = ({ phi, variant = 'phone' }: TimeTextProps) => {
  countRender('TimeText');
  const { t, d } = useTime();
  if (variant === 'car') {
    return (
      <p data-testid="car-time" className="mt-5 text-2xl tabular-nums text-ink-strong">
        {formatTime(t)} <span className="text-ink-faint">/ {formatTime(d)}</span>
      </p>
    );
  }
  const phase = phi ? phiPhase(t, d) : null;
  return (
    <div data-testid="np-time" className="-mt-2 flex justify-between text-xs tabular-nums text-ink-muted">
      <span>{formatTime(t)}</span>
      <span className="text-ink-faint">{phase ? `φ · ${phase}` : ''}</span>
      <span>{formatTime(d)}</span>
    </div>
  );
};

export default React.memo(TimeText);
