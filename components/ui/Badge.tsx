// components/ui/Badge.tsx (v15.5 UI kit)
//
// A small uppercase label: display only. `outline` is the new layout's Beta, `rec` a recording in progress (a red dot,
// the text stays ink), `playing` the gold tag of the playing crystal, `track` the neutral tag of the track's own crystal
// and `active` the active walk. v16.5: `experimental`, dashed and neutral (the Journal; nothing experimental is gold or
// coloured).

import React from 'react';
import type { ReactNode } from 'react';

export type BadgeLook = 'outline' | 'rec' | 'playing' | 'track' | 'active' | 'experimental';

const LOOKS: Record<BadgeLook, string> = {
  outline: 'inline-flex items-center px-1.5 rounded border border-line-strong text-caption uppercase tracking-wider text-ink-muted',
  rec: 'inline-flex items-center gap-1 px-1.5 rounded border border-line-strong text-caption font-bold uppercase tracking-wider text-ink-strong',
  playing: 'inline-flex items-center px-1.5 rounded-pill bg-gold-500 text-micro font-bold uppercase tracking-wider text-black',
  track: 'inline-flex items-center px-1.5 rounded-pill bg-surface-control text-micro font-bold uppercase tracking-wider text-ink-soft',
  active: 'inline-flex items-center px-1.5 rounded-pill border border-line-strong text-caption uppercase tracking-wider text-ink-soft',
  experimental: 'inline-flex items-center px-1.5 rounded border border-dashed border-ink-faint text-caption uppercase tracking-wider text-ink-muted',
};

interface BadgeProps {
  look?: BadgeLook;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

const Badge = ({ look = 'outline', children, className, 'data-testid': testId }: BadgeProps) => (
  <span data-testid={testId} className={`${LOOKS[look]}${className ? ` ${className}` : ''}`}>
    {look === 'rec' ? <span aria-hidden="true" className="w-1.5 h-1.5 rounded-pill bg-status-error" /> : null}
    {children}
  </span>
);

export default Badge;
