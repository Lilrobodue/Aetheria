// components/layers/KeyFitRow.tsx
//
// Key fit (v15.2): Harmonic Control's card under the layer-sound card, v2 only.
// One switch (saved only when tapped: App's toggleKeyFit) and a status line
// that says what Key fit does on the playing track, or would do while off
// (layerCopy's keyFitRowText). Prop-driven and memo'd with primitive props and
// App's stable handler, so App's renders while playing never reach it.

import React from 'react';
import { KEY_FIT_LABEL, KEY_FIT_DESCRIPTION, KEY_FIT_EVIDENCE } from './layerCopy';
import EvidenceTag from '../ui/EvidenceTag';

interface Props {
  on: boolean;
  status: string;
  onToggle: () => void;
}

const KeyFitRow: React.FC<Props> = ({ on, status, onToggle }) => (
  <div data-testid="key-fit-row" className="p-4 rounded-xl border border-slate-700 bg-slate-900/50 space-y-2">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-widest text-slate-300">{KEY_FIT_LABEL}</div>
        <div className="text-[10px] text-slate-500 leading-snug">{KEY_FIT_DESCRIPTION}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={KEY_FIT_LABEL}
        onClick={onToggle}
        className="min-h-11 min-w-11 flex items-center justify-center shrink-0"
      >
        <span className={`w-10 h-5 rounded-full relative transition-colors ${on ? 'bg-indigo-500' : 'bg-slate-700'}`}>
          <span className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${on ? 'left-6' : 'left-1'}`}></span>
        </span>
      </button>
    </div>
    <p data-testid="key-fit-status" className="text-[11px] text-slate-300">{status}</p>
    {/* v16.6: the evidence line carries its two tags (roughness is well studied; using it for levels is a design choice). */}
    <div data-evidence="tier1" className="space-y-2">
      <p className="text-[10px] text-slate-500 leading-snug">{KEY_FIT_EVIDENCE}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <EvidenceTag tier="tier1" />
        <EvidenceTag tier="design" />
      </div>
    </div>
  </div>
);

export default React.memo(KeyFitRow);
