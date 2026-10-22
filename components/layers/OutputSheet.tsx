// components/layers/OutputSheet.tsx
//
// "What are you listening on?" (v14.9): asked once per device, only while v2
// is the engine, when its layers are first wanted (a play or a tone with
// Music only off) with no saved answer (App opens it from an effect, never
// from playTrack). Non-blocking on purpose: no backdrop, aria-modal false,
// the music keeps playing and the layers act as headphones until it is
// answered (asked again by "Ask me again", they keep the saved output in
// effect, across restarts too). It sits between the header and the player
// bar (`insets`, App's measured uiInsets, as the Spectrum lens uses), so
// Pause, Next and the layers button stay usable while it is open (v15.0: it
// is every new profile's first play); short of room, the card scrolls. "Ask
// me later" (or Escape) waits for the next session; it is never named "Not
// now", which is the orphan banner's button. z-[140]: above the toasts
// (z-[70]) and the record dialog (z-[120]), below the disclaimer and the
// Frequency Lab (z-[150]).

import React, { useEffect } from 'react';
import type { LayerOutput } from '../../utils/soundV2/layerHost';
import {
  OUTPUT_ORDER,
  OUTPUT_LABELS,
  OUTPUT_DESCRIPTIONS,
  HEADPHONES_HINT,
  SHEET_HEADING,
  SHEET_BODY,
  SHEET_LATER,
} from './layerCopy';

interface Props {
  open: boolean;
  /** What the header and the player bar cover, px from the top and the bottom edge (0 when hidden, as in Zen Mode). */
  insets: { top: number; bottom: number };
  onChoose: (o: LayerOutput) => void;
  onLater: () => void;
}

const OutputSheet: React.FC<Props> = ({ open, insets, onChoose, onLater }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onLater();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onLater]);

  if (!open) return null;
  const top = Math.max(0, insets.top), bottom = Math.max(0, insets.bottom);
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="output-sheet-heading"
      data-testid="output-sheet"
      className="fixed inset-x-0 bottom-0 z-[140] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none"
      style={{ bottom }}
    >
      <div
        className="pointer-events-auto w-full max-w-md space-y-3 p-4 rounded-2xl bg-slate-950/95 backdrop-blur-md border border-indigo-500/40 shadow-2xl shadow-indigo-900/40 overflow-y-auto overscroll-contain"
        // The room left between the two, less the wrapper's bottom padding and a 1rem gap under the header.
        style={{ maxHeight: `max(10rem, calc(100dvh - ${top + bottom}px - 1rem - max(1rem, env(safe-area-inset-bottom))))` }}
      >
        <h2 id="output-sheet-heading" className="text-sm font-bold text-slate-100">{SHEET_HEADING}</h2>
        <p className="text-xs text-slate-400 leading-snug">{SHEET_BODY}</p>
        <div className="grid gap-2">
          {OUTPUT_ORDER.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onChoose(o)}
              aria-labelledby={`output-sheet-${o}`}
              aria-describedby={`output-sheet-${o}-desc`}
              className="w-full min-h-11 px-3 py-2 text-left rounded-xl border border-slate-700 bg-slate-900 hover:border-indigo-400/50 transition-colors"
            >
              <span id={`output-sheet-${o}`} className="block text-sm font-bold text-slate-100">{OUTPUT_LABELS[o]}</span>
              <span id={`output-sheet-${o}-desc`} className="block text-[11px] text-slate-400 leading-snug">{OUTPUT_DESCRIPTIONS[o]}</span>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 leading-snug">{HEADPHONES_HINT}</p>
        <button
          type="button"
          onClick={onLater}
          className="w-full min-h-11 rounded-xl text-xs text-slate-400 hover:text-white transition-colors"
        >
          {SHEET_LATER}
        </button>
      </div>
    </div>
  );
};

export default React.memo(OutputSheet);
