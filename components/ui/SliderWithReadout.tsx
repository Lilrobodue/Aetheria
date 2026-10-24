// components/ui/SliderWithReadout.tsx (v15.5 UI kit)
//
// A level slider: its label and readout on one line, a native range input under them in a 44 px row. The readout is
// also the input's aria-valuetext, so a screen reader hears what the eye reads ("+0.0 dB · −26.0 dB re music", "80 %").
// Disabled, it says why under it (`disabledNote`).

import React from 'react';

interface SliderWithReadoutProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  readout: string;
  onChange: (v: number) => void;
  disabled?: boolean;
  disabledNote?: string;
  'data-testid'?: string;
}

const SliderWithReadout = ({ label, min, max, step, value, readout, onChange, disabled = false, disabledNote, 'data-testid': testId }: SliderWithReadoutProps) => (
  <div data-testid={testId}>
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="text-xs tabular-nums text-ink-muted">{readout}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={readout}
      onChange={(e: { target: HTMLInputElement }) => onChange(parseFloat(e.target.value))}
      className={
        disabled
          ? 'block w-full h-touch accent-ink-muted opacity-40 cursor-not-allowed touch-none'
          : 'block w-full h-touch accent-ink-soft cursor-pointer touch-none'
      }
    />
    {disabled && disabledNote ? <p className="text-xs text-ink-faint">{disabledNote}</p> : null}
  </div>
);

export default SliderWithReadout;
