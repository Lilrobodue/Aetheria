// components/shell/more/VizSlider.tsx (v16.4, the Visuals sheet)
//
// A visual setting's slider (SliderWithReadout's look: the label and readout on one line, a native range in a 44 px
// row). Every write restarts the Visualizer's render loop, whose first frame skips its 30 fps limiter, so a drag that
// wrote on every input would push the visuals past their cap (36.3 draws/s measured; the user's rule: never above 30).
// So the readout and the thumb follow the finger from this slider's own state, and App's setting is written through
// visualsModel's makeThrottle: at most once every 333 ms while it moves (SLIDER_WRITE_MS), and always the final value on release
// (pointerup, keyup, the native `change`, blur) and on unmount. A keyboard step is released at once (its keyup).
// React.memo: it re-renders for its own value only, never for the clock.

import React, { useEffect, useRef, useState } from 'react';
import { useActions } from '../contexts';
import { countRender } from '../devRenders';
import { makeThrottle } from './visualsModel';
import type { Throttle } from './visualsModel';

export type VizSliderKey = 'speed' | 'sensitivity' | 'particleBaseSize' | 'hexOpacity' | 'hydroIntensity' | 'loShuCubeRotation';

interface VizSliderProps {
  label: string;
  /** The VizSettings key it writes (one per slider, for its lifetime). */
  vizKey: VizSliderKey;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  disabled?: boolean;
  'data-testid'?: string;
}

const VizSlider = ({ label, vizKey, value, min, max, step, format, disabled = false, 'data-testid': testId }: VizSliderProps) => {
  countRender('VizSlider');
  const actions = useActions();
  // The value under the finger while it moves (null: show App's).
  const [local, setLocal] = useState<number | null>(null);
  // One throttle per mount (StrictMode's dev remount cancels the first: a cancelled one never writes again).
  const throttleRef: { current: Throttle<number> | null } = useRef(null);
  const inputRef: { current: HTMLInputElement | null } = useRef(null);

  const release = () => {
    throttleRef.current?.flush();
    setLocal(null);
  };
  const releaseRef: { current: () => void } = useRef(release);
  releaseRef.current = release;

  // The native change event (React's onChange is the input event): a pointer release, a keyboard step.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onNativeChange = () => releaseRef.current();
    el.addEventListener('change', onNativeChange);
    return () => el.removeEventListener('change', onNativeChange);
  }, []);
  // Its throttle, for this mount; on unmount (the sheet closes mid-drag) the last value, then nothing more.
  useEffect(() => {
    const throttle = makeThrottle<number>((v) => actions.setViz({ [vizKey]: v }));
    throttleRef.current = throttle;
    return () => {
      throttle.flush();
      throttle.cancel();
      if (throttleRef.current === throttle) throttleRef.current = null;
    };
  }, []);

  const shown = local ?? value;
  const readout = format(shown);
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink-soft">{label}</span>
        <span className="text-xs tabular-nums text-ink-muted">{readout}</span>
      </div>
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={readout}
        onChange={(e: { target: HTMLInputElement }) => {
          const v = parseFloat(e.target.value);
          if (!Number.isFinite(v)) return;
          setLocal(v);
          throttleRef.current?.push(v);
        }}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
        className={
          disabled
            ? 'block w-full h-touch accent-ink-muted opacity-40 cursor-not-allowed touch-none'
            : 'block w-full h-touch accent-ink-soft cursor-pointer touch-none'
        }
      />
    </div>
  );
};

export default React.memo(VizSlider);
