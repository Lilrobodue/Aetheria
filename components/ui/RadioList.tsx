// components/ui/RadioList.tsx (v15.6 UI kit)
//
// A radio group of rows (the Layers tab's beat bands): a fieldset with a screen-reader legend, each row a <label> at
// least 56 px tall (min-h-14) holding a visually hidden native radio (so the arrow keys move the choice, each move a
// pick, and Tab reaches the group once), a drawn circle, a title and a subtitle. Every activation is a pick, the
// checked row's included (onChange(id) on the radio's click). Disabled, the fieldset disables every
// radio and `disabledNote` says why, in text. Neutral: the checked circle is ink, never gold.

import React from 'react';

export interface RadioItem {
  id: string;
  title: string;
  subtitle?: string;
}

interface RadioListProps {
  /** The group's name for assistive tech (the legend, visually hidden). */
  legend: string;
  /** The radios' shared name. */
  name: string;
  items: ReadonlyArray<RadioItem>;
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  disabledNote?: string;
  'data-testid'?: string;
}

const noop = () => {};

const RadioList = ({ legend, name, items, value, onChange, disabled = false, disabledNote, 'data-testid': testId }: RadioListProps) => (
  <fieldset disabled={disabled} className="min-w-0" data-testid={testId}>
    <legend className="sr-only">{legend}</legend>
    <div className={disabled ? 'opacity-50' : undefined}>
      {items.map((it) => {
        const checked = value === it.id;
        return (
          <label
            key={it.id}
            className={
              disabled
                ? 'flex items-center gap-3 min-h-14 py-2 border-b border-line cursor-not-allowed'
                : 'flex items-center gap-3 min-h-14 py-2 border-b border-line cursor-pointer'
            }
          >
            {/* The pick is the click, not the change: a native radio that is already checked fires no change, and a tap
                on it must still pick it (the Beat card: a band tapped while Adaptive shows it turns Adaptive off, as
                classic's row does). Arrow keys and Space click the radio they select, so each is a pick too. */}
            <input type="radio" name={name} value={it.id} checked={checked} onChange={noop} onClick={() => onChange(it.id)} className="peer sr-only" />
            <span
              aria-hidden="true"
              className={
                checked
                  ? 'shrink-0 w-5 h-5 rounded-pill border-2 border-ink-strong flex items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold-400'
                  : 'shrink-0 w-5 h-5 rounded-pill border-2 border-ink-faint flex items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold-400'
              }
            >
              {checked ? <span className="w-2.5 h-2.5 rounded-pill bg-ink-strong" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-ink-strong">{it.title}</span>
              {it.subtitle ? <span className="block text-xs text-ink-muted">{it.subtitle}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
    {disabled && disabledNote ? <p className="pt-2 text-xs text-ink-soft">{disabledNote}</p> : null}
  </fieldset>
);

export default RadioList;
