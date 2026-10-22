// components/layers/LayerSoundPanel.tsx
//
// The layer-sound controls (v14.9): Music only, the "Layer sound: v2 /
// classic" A/B switch and, while v2 plays, its output, sub-bass drone and
// "Ask me again" (under classic, one line saying the output and Car are v2's:
// classic always plays its beat and drone). After a v2 failure (v15.0.1) the
// Output group stays, with one line on what it does then (Car: the layers
// off), and the drone and "Ask me again" go. Harmonic Control shows it in place
// of v14.6's Music-only row (variant "panel", which adds the sound-log
// export); the transport's quick switch shows it in a popover (variant
// "popover").
//
// Prop-driven: App owns every value and every handler (it alone saves the
// choices, and only when tapped), so the later UI overhaul moves this panel
// rather than rewriting it. The Music-only switch is v14.6's, unchanged —
// exactly one role="switch" named "Music only" per panel (e2e sound.spec
// relies on it). Memo with primitive props and App's stable handlers, so App's
// renders while playing (a few a second since v14.8's quarter-second clock)
// never reach it.

import React from 'react';
import { VolumeX } from 'lucide-react';
import type { LayerEngine, LayerOutput } from '../../utils/soundV2/layerHost';
import {
  ENGINE_GROUP_LABEL,
  ENGINE_NOTE,
  CLASSIC_OUTPUT_NOTE,
  CLASSIC_OUTPUT_NOTE_V2_FAILED,
  ENGINE_ORDER,
  ENGINE_LABELS,
  OUTPUT_GROUP_LABEL,
  OUTPUT_ORDER,
  OUTPUT_LABELS,
  OUTPUT_DESCRIPTIONS,
  OUTPUT_V2_FAILED_NOTE,
  OUTPUT_ASSUMED,
  OUTPUT_ASSUMED_NOTE,
  OUTPUT_ASKED_AGAIN_NOTE,
  HEADPHONES_HINT,
  DRONE_LABEL,
  DRONE_DESCRIPTION,
  DRONE_HEADPHONES_ONLY,
  ASK_AGAIN_LABEL,
  ASK_AGAIN_DESCRIPTION,
  EXPORT_LOG_LABEL,
  V2_UNAVAILABLE,
  V2_UNAVAILABLE_CAR,
} from './layerCopy';

export interface LayerSoundPanelProps {
  variant: 'panel' | 'popover';
  engine: LayerEngine;
  /** False until the user has chosen an engine: the pressed engine is then only the default (v2 since v15.0). */
  engineChosen: boolean;
  v2Failed: boolean;
  /** null = not answered yet (v2 plays as headphones). */
  output: LayerOutput | null;
  /** True after "Ask me again" until an answer, across restarts: `output` stays saved and in effect meanwhile. */
  askedAgain: boolean;
  droneEnabled: boolean;
  musicOnly: boolean;
  canExportLog: boolean;
  onChooseEngine: (e: LayerEngine) => void;
  onChooseOutput: (o: LayerOutput) => void;
  onAskAgain: () => void;
  onToggleDrone: () => void;
  onToggleMusicOnly: () => void;
  onExportLog: () => void;
}

const LayerSoundPanel: React.FC<LayerSoundPanelProps> = ({
  variant,
  engine,
  engineChosen,
  v2Failed,
  output,
  askedAgain,
  droneEnabled,
  musicOnly,
  canExportLog,
  onChooseEngine,
  onChooseOutput,
  onAskAgain,
  onToggleDrone,
  onToggleMusicOnly,
  onExportLog,
}) => {
  const isPanel = variant === 'panel';
  const v2Shown = engine === 'v2' && !v2Failed;
  // The Output group stays after a v2 failure (v15.0.1), so Car can still be chosen there: it turns classic's layers off.
  const outputShown = engine === 'v2';
  // v2's failure with Car in effect: App keeps classic's layers off too, so only the music plays.
  const carFallback = engine === 'v2' && v2Failed && output === 'car';
  // The drone plays on headphones only; an unanswered output plays as headphones.
  const droneUsable = output === null || output === 'headphones';
  const shownOutput: LayerOutput = output ?? 'headphones';

  return (
    <div data-testid="layer-sound-panel" className="space-y-3">
      {/* Music only (v14.6): tone, beat and drone off; the music plays on. Saved. */}
      <div className={`flex items-center justify-between gap-3 ${isPanel ? 'p-4 rounded-xl border border-slate-700 bg-slate-900/50' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <VolumeX className={`w-5 h-5 shrink-0 ${musicOnly ? 'text-orange-400' : 'text-slate-500'}`} />
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-300">Music only</div>
            <div className="text-[10px] text-slate-500">Tone, beat and drone off. The music plays on. Saved.</div>
          </div>
        </div>
        <button
          role="switch"
          aria-checked={musicOnly}
          aria-label="Music only"
          onClick={onToggleMusicOnly}
          className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${musicOnly ? 'bg-orange-500' : 'bg-slate-700'}`}
        >
          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${musicOnly ? 'left-6' : 'left-1'}`}></div>
        </button>
      </div>

      <div className={`space-y-3 ${isPanel ? 'p-4 rounded-xl border border-slate-700 bg-slate-900/50' : 'pt-3 border-t border-slate-800'}`}>
        {/* The engine A/B. A tap on the pressed default before any choice saves nothing (App decides). */}
        <div role="group" aria-label={ENGINE_GROUP_LABEL}>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-2">{ENGINE_GROUP_LABEL}</div>
          <div className="grid grid-cols-2 gap-2">
            {ENGINE_ORDER.map((e) => {
              const pressed = engine === e;
              // The unchosen default reads as pressed but outlined, like an assumed output.
              const look = pressed
                ? engineChosen
                  ? 'bg-indigo-500/20 border-indigo-400/70 text-indigo-100'
                  : 'bg-indigo-500/10 border-dashed border-indigo-400/60 text-indigo-100'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-indigo-400/40 hover:text-indigo-200';
              return (
                <button
                  key={e}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onChooseEngine(e)}
                  className={`min-h-11 rounded-lg border text-xs font-bold transition-colors ${look}`}
                >
                  {ENGINE_LABELS[e]}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-slate-500 leading-snug">{ENGINE_NOTE}</p>
        </div>

        {engine === 'classic' && (
          // Once v2 has failed this session, v2 with Car is the layers off, and the note says so.
          <p data-testid="classic-output-note" className="text-[10px] text-amber-300/80 leading-snug">{v2Failed ? CLASSIC_OUTPUT_NOTE_V2_FAILED : CLASSIC_OUTPUT_NOTE}</p>
        )}

        {v2Failed && (
          <p data-testid="v2-unavailable" className="text-[11px] text-red-400 leading-snug">{carFallback ? V2_UNAVAILABLE_CAR : V2_UNAVAILABLE}</p>
        )}

        {outputShown && (
          <div role="group" aria-label={OUTPUT_GROUP_LABEL}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-300">{OUTPUT_GROUP_LABEL}</span>
              {output === null && (
                <span className="text-[10px] text-amber-300">{OUTPUT_LABELS.headphones} {OUTPUT_ASSUMED}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {OUTPUT_ORDER.map((o) => {
                const selected = output === o;
                const assumed = output === null && o === 'headphones';
                // Asked again, the output in effect reads as pressed but outlined until the answer (its question open).
                const look = selected && !askedAgain
                  ? 'bg-indigo-500/20 border-indigo-400/70 text-indigo-100'
                  : selected || assumed
                    ? 'bg-indigo-500/10 border-dashed border-indigo-400/60 text-indigo-100'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-indigo-400/40 hover:text-indigo-200';
                return (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onChooseOutput(o)}
                    className={`min-h-11 px-2 rounded-lg border text-xs font-bold transition-colors ${look}`}
                  >
                    {OUTPUT_LABELS[o]}
                  </button>
                );
              })}
            </div>
            {v2Failed ? (
              // Classic plays now, not what v2's descriptions say: one line on what the outputs do instead.
              <p className="mt-2 text-[10px] text-amber-300/80 leading-snug">{OUTPUT_V2_FAILED_NOTE}</p>
            ) : (
              <>
                <p className="mt-2 text-[10px] text-slate-400 leading-snug">{OUTPUT_DESCRIPTIONS[shownOutput]}</p>
                {output === null && <p className="mt-1 text-[10px] text-amber-300/80 leading-snug">{OUTPUT_ASSUMED_NOTE}</p>}
                {output !== null && askedAgain && <p className="mt-1 text-[10px] text-amber-300/80 leading-snug">{OUTPUT_ASKED_AGAIN_NOTE}</p>}
              </>
            )}
          </div>
        )}

        {v2Shown && (
          <>
            <p className="text-[10px] text-slate-500 leading-snug">{HEADPHONES_HINT}</p>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={`text-xs font-bold uppercase tracking-widest ${droneUsable ? 'text-slate-300' : 'text-slate-500'}`}>{DRONE_LABEL}</div>
                <div className="text-[10px] text-slate-500 leading-snug">{droneUsable ? DRONE_DESCRIPTION : DRONE_HEADPHONES_ONLY}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={droneEnabled}
                aria-label={DRONE_LABEL}
                disabled={!droneUsable}
                onClick={onToggleDrone}
                className={`min-h-11 min-w-11 flex items-center justify-center shrink-0 ${droneUsable ? '' : 'opacity-40 cursor-not-allowed'}`}
              >
                <span className={`w-10 h-5 rounded-full relative transition-colors ${droneEnabled ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                  <span className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${droneEnabled ? 'left-6' : 'left-1'}`}></span>
                </span>
              </button>
            </div>

            {output !== null && !askedAgain && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] text-slate-500 leading-snug min-w-0">{ASK_AGAIN_DESCRIPTION}</p>
                <button
                  type="button"
                  onClick={onAskAgain}
                  className="min-h-11 px-3 shrink-0 rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-300 hover:border-indigo-400/40 hover:text-indigo-200 transition-colors"
                >
                  {ASK_AGAIN_LABEL}
                </button>
              </div>
            )}
          </>
        )}

        {isPanel && canExportLog && (
          <button
            type="button"
            onClick={onExportLog}
            className="w-full min-h-11 rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
          >
            {EXPORT_LOG_LABEL}
          </button>
        )}
      </div>
    </div>
  );
};

export default React.memo(LayerSoundPanel);
