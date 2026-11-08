// components/ui/Select.tsx (v15.6 UI kit)
//
// A labelled native select (the Layers tab's experience level): the visible label names it (the <label> wraps both),
// a 44 px control in the Quiet look with a ChevronDown drawn over its right end (the native arrow is hidden).
// v16.4: React.memo (it is pure; the Visuals sheet passes a stable handler).
// v16.8.3 (additive; absent, the markup is v15.6's): `describedBy`, the id of a line read with the control
// (aria-describedby: Track info's Tuning note).

import React from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (v: T) => void;
  /** v16.8.3: the id of the element that describes the control (aria-describedby). */
  describedBy?: string;
  'data-testid'?: string;
}

function Select<T extends string>({ label, value, options, onChange, describedBy, 'data-testid': testId }: SelectProps<T>) {
  return (
    <label className="block" data-testid={testId}>
      <span className="block text-sm text-ink-soft mb-1">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(e: { target: HTMLSelectElement }) => onChange(e.target.value as T)}
          aria-describedby={describedBy}
          className="w-full h-touch appearance-none rounded-control border border-line-strong bg-surface-raised px-3 pr-10 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 [color-scheme:dark]"
        >
          {/* v16.8.1: its open list is the browser's own: the dark scheme, and the options in the kit's colours. */}
          {options.map((o) => (
            <option key={o.id} value={o.id} className="bg-surface-raised text-ink">
              {o.label}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">
          <ChevronDown size={16} />
        </span>
      </span>
    </label>
  );
}

export default React.memo(Select) as typeof Select;
