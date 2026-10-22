// components/layers/OutputQuickSwitch.tsx
//
// The transport's layer button (v14.9), between Repeat and the Lo Shu button:
// its icon says what the layers are doing (VolumeX under Music only and under
// v2's failure with Car, which plays no layers either; Layers in classic, else
// the v2 output) and it opens the layer panel in a popover, in the Lo Shu
// popover's pattern (a fixed click-away catcher plus the panel, portalled to
// the body). App owns `open`, so the status-row badge opens the same popover.
// Escape closes it, except while the output question is open: that sheet sits
// above it and its Escape is the sheet's "Ask me later" (v15.0.1: one Escape,
// one overlay). Shown only once an engine has been chosen (or v2 is the
// engine).

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Car, Headphones, Layers, Smartphone, Speaker, VolumeX } from 'lucide-react';
import type { LayerEngine, LayerOutput } from '../../utils/soundV2/layerHost';
import LayerSoundPanel from './LayerSoundPanel';
import type { LayerSoundPanelProps } from './LayerSoundPanel';
import { QUICK_SWITCH_LABEL } from './layerCopy';

interface Props {
  engine: LayerEngine;
  v2Failed: boolean;
  output: LayerOutput | null;
  musicOnly: boolean;
  /** The output question (OutputSheet) is open: it sits above the popover, so Escape answers it until it closes. */
  sheetOpen: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One memoised object from App, shared with Harmonic Control's panel. */
  panelProps: Omit<LayerSoundPanelProps, 'variant'>;
}

const OutputQuickSwitch: React.FC<Props> = ({ engine, v2Failed, output, musicOnly, sheetOpen, open, onOpenChange, panelProps }) => {
  useEffect(() => {
    if (!open || sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, sheetOpen, onOpenChange]);

  const v2 = engine === 'v2' && !v2Failed;
  // v2's failure with Car in effect plays no layers at all (App's v2CarFallback): the icon says so, as under Music only.
  const layersOff = musicOnly || (engine === 'v2' && v2Failed && output === 'car');
  const Icon = layersOff
    ? VolumeX
    : !v2
      ? Layers
      : output === 'speakers'
        ? Speaker
        : output === 'phone'
          ? Smartphone
          : output === 'car'
            ? Car
            : Headphones;
  const tint = layersOff ? 'text-orange-400' : v2 ? 'text-indigo-300' : 'text-slate-600';

  return (
    <>
      {/* 44 px target; the negative margins keep the transport row's height and spacing. */}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label={QUICK_SWITCH_LABEL}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="layers-quick-switch"
        className={`min-h-11 min-w-11 -my-1.5 -mx-3 flex items-center justify-center ${tint} hover:text-white transition-colors`}
      >
        <Icon size={14} />
      </button>
      {open && createPortal(
        <>
          {/* Click-away catcher */}
          <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label={QUICK_SWITCH_LABEL}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-80 max-w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto z-50 p-3 rounded-xl bg-slate-950/95 backdrop-blur-md border border-indigo-500/40 shadow-2xl shadow-indigo-900/40"
          >
            <LayerSoundPanel variant="popover" {...panelProps} />
          </div>
        </>,
        document.body
      )}
    </>
  );
};

export default React.memo(OutputQuickSwitch);
