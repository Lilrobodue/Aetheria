// components/ui/Toggle.tsx (v15.5 UI kit)
//
// A switch row: the title (and a description) on the left, a role="switch" button on the right with a 44 × 44 target.
// The knob slides with a duration-fast transform, and jumps under reduced motion (the v15.3 risk note). Neutral, not
// gold (gold is Play, the active tab, the playing crystal and the φ progress): off is a dark track with a light knob,
// on a light track with a dark knob, the knob on the right.

import React from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  'data-testid'?: string;
}

const Toggle = ({ label, description, checked, onChange, 'data-testid': testId }: ToggleProps) => {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="flex items-center justify-between gap-3 py-2" data-testid={testId}>
      <div className="min-w-0">
        <div className="text-sm text-ink-strong">{label}</div>
        {description ? <div className="text-xs text-ink-muted">{description}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="shrink-0 w-touch h-touch flex items-center justify-center rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        <span className={checked ? 'relative w-10 h-6 rounded-pill bg-ink-soft' : 'relative w-10 h-6 rounded-pill bg-surface-control'}>
          <span
            className={`absolute top-1 left-1 w-4 h-4 rounded-pill ${checked ? 'translate-x-4 bg-surface-deep' : 'translate-x-0 bg-ink-strong'} ${
              reduced ? '' : 'transition-transform duration-fast'
            }`}
          />
        </span>
      </button>
    </div>
  );
};

export default Toggle;
