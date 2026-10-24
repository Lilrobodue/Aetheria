// components/shell/PeekPill.tsx (v15.5, the new layout beta)
//
// While a stub "peeks" into the classic layout (decision 4: Open the classic library / mixes / sound controls), one
// floating pill brings the new layout back. App renders it at root level only during a peek, so classic proper never
// has it (parity). The saved choice stays 'new' throughout: a reload opens the new layout.
// It sits just above classic's player bar (`bottom`: App's measured inset, the bar's height), centred: clear of the
// header's buttons and of the transport at every size (layout.spec 12b hit-tests them all).

import React from 'react';
import { ArrowLeft } from 'lucide-react';

const PeekPill = ({ onBack, bottom }: { onBack: () => void; bottom: number }) => (
  <div className="fixed left-1/2 -translate-x-1/2 z-toast" style={{ bottom: Math.max(0, bottom) + 12 }}>
    <button
      type="button"
      onClick={onBack}
      data-testid="peek-pill"
      className="h-touch px-4 rounded-pill bg-gold-500 hover:bg-gold-400 text-black text-sm font-bold shadow-overlay flex items-center gap-2 whitespace-nowrap transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      Back to the new layout
    </button>
  </div>
);

export default PeekPill;
