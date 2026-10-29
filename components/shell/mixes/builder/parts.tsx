// components/shell/mixes/builder/parts.tsx (v16.3, Create a mix; mockups builder-A-*)
//
// The builder's small pieces: a section's heading; a choice tile (Start from, Follow, a walk, Tracks per crystal: a
// label and an optional second line, a check when chosen, at least 44 px tall); a chip (a crystal set, a custom crystal:
// 32 px tall with a 44 px tap target, as v16.2's FacetChip). Chosen is raised with a light border, a check and semibold,
// never colour alone and never gold. A single choice is a radio (role="radio", aria-checked) in a named radiogroup; a
// custom crystal is a toggle (aria-pressed). A choice that can't be taken stays focusable (aria-disabled) and says why
// in its name. Every class a complete literal (tailwind.config.js scans this file).
// v16.3 review: each radiogroup is a keyboard radio group (the ARIA pattern): one Tab stop (the chosen radio's, or the
// first's), and the arrow keys move to the next or previous radio and pick it (Home and End: the first and the last).

import React from 'react';
import { Check } from 'lucide-react';

export const H2 = 'text-xs font-semibold uppercase tracking-widest text-ink-soft';
export const LINE = 'text-xs text-ink-muted';

const RADIO_KEYS = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
/** On a radiogroup (onKeyDown): the arrows move the focus to the next or previous radio in it, wrapping, and pick it, as
 *  a tap does (Home and End: the first and the last); a radio that can't be taken is passed over. */
export function onRadioKeys(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; currentTarget: HTMLElement; target: EventTarget | null; preventDefault: () => void }): void {
  if (!RADIO_KEYS.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  const radios: HTMLElement[] = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')).filter((r: HTMLElement) => r.getAttribute('aria-disabled') !== 'true');
  const at = radios.indexOf(e.target as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const n = radios.length;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (at + 1) % n : (at - 1 + n) % n;
  const r = radios[next];
  r.focus();
  if (r.getAttribute('aria-checked') !== 'true') r.click();
}
/** A radio's tabIndex in its group: one Tab stop, the chosen radio (or the first, with none chosen). */
export const rovingTabIndex = (checked: boolean, first: boolean, anyChecked: boolean): number => (checked || (first && !anyChecked) ? 0 : -1);

export const SectionHead = ({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) => (
  <div className="pt-5 pb-2 flex items-baseline justify-between gap-2">
    <h2 id={id} className={H2}>
      {children}
    </h2>
    {aside ?? null}
  </div>
);

const TILE_ON =
  'min-w-0 min-h-touch px-3 py-2 rounded-control border flex items-center gap-2 text-left text-sm border-ink-muted bg-surface-raised text-ink-strong font-semibold transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const TILE_OFF =
  'min-w-0 min-h-touch px-3 py-2 rounded-control border flex items-center gap-2 text-left text-sm border-line-strong bg-surface-panel text-ink-soft hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const TILE_DISABLED =
  'min-w-0 min-h-touch px-3 py-2 rounded-control border flex items-center gap-2 text-left text-sm border-line bg-surface-panel text-ink-faint cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

interface ChoiceTileProps {
  label: string;
  sub?: string | null;
  checked: boolean;
  /** Not available: stays focusable, its name says why (`sub` is the reason). */
  disabled?: boolean;
  onPick: () => void;
  /** 'radio' (default): one of a radiogroup (aria-checked); 'pressed': one of a named group (aria-pressed: Start from,
   *  whose Playlist choice opens a sheet). */
  role?: 'radio' | 'pressed';
  /** It opens a sheet (aria-haspopup). */
  opensSheet?: boolean;
  /** A radio's place in its group's one Tab stop (rovingTabIndex); a pressed choice leaves it out. */
  tabIndex?: number;
  'data-testid'?: string;
}

/** A two-line choice: "Library / 440 tracks", "Vortex / 26 of 27", "A crystal set". */
export const ChoiceTile = React.memo(({ label, sub, checked, disabled = false, onPick, role = 'radio', opensSheet = false, tabIndex, 'data-testid': testId }: ChoiceTileProps) => (
  <button
    type="button"
    tabIndex={tabIndex}
    role={role === 'radio' ? 'radio' : undefined}
    aria-checked={role === 'radio' ? checked : undefined}
    aria-pressed={role === 'pressed' ? checked : undefined}
    aria-haspopup={opensSheet ? 'dialog' : undefined}
    aria-disabled={disabled ? 'true' : undefined}
    aria-label={sub ? `${label}, ${sub}` : label}
    data-testid={testId}
    onClick={disabled ? undefined : onPick}
    className={checked ? TILE_ON : disabled ? TILE_DISABLED : TILE_OFF}
  >
    {checked ? <Check size={16} className="shrink-0" aria-hidden="true" /> : null}
    <span aria-hidden="true" className="min-w-0 flex-1">
      <span className="block truncate">{label}</span>
      {sub ? <span className={checked ? 'block text-xs font-normal truncate text-ink-soft' : 'block text-xs font-normal truncate text-ink-faint'}>{sub}</span> : null}
    </span>
  </button>
));

const CHIP_BASE =
  "relative inline-flex items-center gap-1.5 h-8 px-3 rounded-pill whitespace-nowrap border text-xs tabular-nums after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400";
const CHIP_ON = `${CHIP_BASE} border-ink-muted bg-surface-raised text-ink-strong font-semibold`;
const CHIP_EMPTY = `${CHIP_BASE} border-line bg-surface-panel text-ink-faint hover:border-line-strong`;
const CHIP_PLAIN = `${CHIP_BASE} border-line-strong bg-surface-panel text-ink-soft hover:border-ink-faint`;

interface PickChipProps {
  label: string;
  /** Its count from the pool (null: none shown, Custom…). */
  count: number | null;
  picked: boolean;
  /** 'radio': one of a radiogroup (a crystal set); 'toggle': aria-pressed (a custom crystal). */
  kind: 'radio' | 'toggle';
  /** The accessible name ("Grounding, 62 tracks"). */
  name: string;
  /** A bg-regime-* class for a crystal's dot. */
  dotClass?: string;
  onPick: () => void;
  /** A radio's place in its group's one Tab stop (rovingTabIndex); a toggle leaves it out. */
  tabIndex?: number;
  'data-testid'?: string;
}

export const PickChip = React.memo(({ label, count, picked, kind, name, dotClass, onPick, tabIndex, 'data-testid': testId }: PickChipProps) => (
  <button
    type="button"
    tabIndex={tabIndex}
    role={kind === 'radio' ? 'radio' : undefined}
    aria-checked={kind === 'radio' ? picked : undefined}
    aria-pressed={kind === 'toggle' ? picked : undefined}
    aria-label={name}
    data-testid={testId}
    onClick={onPick}
    className={picked ? CHIP_ON : count === 0 ? CHIP_EMPTY : CHIP_PLAIN}
  >
    {picked ? <Check size={14} className="shrink-0" aria-hidden="true" /> : dotClass ? <span aria-hidden="true" className={`w-2 h-2 rounded-pill shrink-0 ${dotClass}`} /> : null}
    <span aria-hidden="true">{label}</span>
    {count !== null ? (
      <span aria-hidden="true" className={picked ? 'font-normal text-ink-soft' : 'font-normal text-ink-faint'}>
        {count.toLocaleString('en-US')}
      </span>
    ) : null}
  </button>
));

export const CHIP_WRAP = 'flex flex-wrap gap-x-2 gap-y-3';
