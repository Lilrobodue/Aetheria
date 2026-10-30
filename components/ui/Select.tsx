// components/ui/Select.tsx (v15.6 UI kit)
//
// A labelled native select (the Layers tab's experience level): the visible label names it (the <label> wraps both),
// a 44 px control in the Quiet look with a ChevronDown drawn over its right end (the native arrow is hidden).
// v16.4: React.memo (it is pure; the Visuals sheet passes a stable handler).

import React from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (v: T) => void;
  'data-testid'?: string;
}

function Select<T extends string>({ label, value, options, onChange, 'data-testid': testId }: SelectProps<T>) {
  return (
    <label className="block" data-testid={testId}>
      <span className="block text-sm text-ink-soft mb-1">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(e: { target: HTMLSelectElement }) => onChange(e.target.value as T)}
          className="w-full h-touch appearance-none rounded-control border border-line-strong bg-surface-raised px-3 pr-10 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
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
