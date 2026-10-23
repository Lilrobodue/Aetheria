// components/layers/KeyFitChip.tsx
//
// Key fit (v15.2): the status-row chip beside the layers badge, shown only
// while Key fit is on and the layers are wanted. It says the duck that applies
// ("Key fit −3.1 dB"), never what would apply, and its tooltip says why
// (layerCopy's keyFitChipText / keyFitChipTitle). Display only: no handler.
// It never breaks mid-label (review B2): on a narrow phone App lets the
// chips around it wrap whole instead.

import React from 'react';
import { Music2 } from 'lucide-react';

interface Props {
  text: string;
  title: string;
  tone: 'duck' | 'plain' | 'none';
}

const LOOK: Record<Props['tone'], string> = {
  duck: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  plain: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
  none: 'bg-slate-500/10 text-slate-300 border-slate-500/30 border-dashed',
};

const KeyFitChip: React.FC<Props> = ({ text, title, tone }) => (
  <span
    data-testid="key-fit-chip"
    title={title}
    aria-label={text}
    className={`flex items-center gap-1 px-1.5 py-0.5 rounded border whitespace-nowrap ${LOOK[tone] ?? LOOK.plain}`}
  >
    <Music2 size={8} /> {text}
  </span>
);

export default React.memo(KeyFitChip);
