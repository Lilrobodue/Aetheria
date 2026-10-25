// components/ui/ChoiceGroup.tsx (v15.6 UI kit)
//
// A named group of pressable choices in two columns (the Layers tab's "Layer sound: v2 / classic" and Output): a
// role="group" with its aria-label, a visible label and an optional badge ("Headphones (assumed)"), then the buttons,
// each aria-pressed, at least 44 px tall, with an optional icon. Three looks, in the Quiet style: pressed is raised with
// a light border and a check; dashed (the unchosen default, the assumed output, an output asked again) is outlined;
// the rest are deep and quiet. No indigo, no gold. Every class a complete literal (tailwind.config.js scans this file).

import React from 'react';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

export interface ChoiceOption<T extends string> {
  id: T;
  label: string;
  /** A lucide icon element at 16 px, without a colour class (the look gives it one). */
  icon?: (className: string) => ReactNode;
  /** aria-pressed. */
  pressed: boolean;
  /** Outlined instead of raised (also for a choice that is not pressed: the assumed output). */
  dashed: boolean;
}

interface ChoiceGroupProps<T extends string> {
  /** The group's accessible name and its visible label. */
  label: string;
  /** Beside the label, right-aligned (muted). */
  badge?: string | null;
  options: ReadonlyArray<ChoiceOption<T>>;
  onChoose: (id: T) => void;
  /** Notes under the buttons. */
  children?: ReactNode;
  'data-testid'?: string;
}

const SOLID =
  'min-h-touch px-2 rounded-control border flex items-center justify-center gap-2 text-sm border-ink-muted bg-surface-raised text-ink-strong font-semibold transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const DASHED =
  'min-h-touch px-2 rounded-control border flex items-center justify-center gap-2 text-sm border-dashed border-ink-faint bg-surface-raised text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const PLAIN =
  'min-h-touch px-2 rounded-control border flex items-center justify-center gap-2 text-sm border-line-strong bg-surface-deep text-ink-soft hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

function ChoiceGroup<T extends string>({ label, badge, options, onChoose, children, 'data-testid': testId }: ChoiceGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className="space-y-2" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-ink-strong">{label}</span>
        {badge ? <span className="text-xs text-ink-muted">{badge}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const solid = o.pressed && !o.dashed;
          const lit = solid || o.dashed;
          return (
            <button key={o.id} type="button" aria-pressed={o.pressed} onClick={() => onChoose(o.id)} className={solid ? SOLID : o.dashed ? DASHED : PLAIN}>
              {o.icon ? o.icon(lit ? 'shrink-0 text-ink-strong' : 'shrink-0 text-ink-muted') : null}
              <span className="min-w-0">{o.label}</span>
              {solid ? <Check size={14} className="shrink-0 text-ink-soft" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

export default ChoiceGroup;
