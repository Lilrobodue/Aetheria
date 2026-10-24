// components/ui/Chip.tsx (v15.5 UI kit)
//
// A 32 px status chip (the new layout's Now Playing chips). A button when `onClick` is given, else a span (display
// only). The button's tap target is 44 px tall through its ::after box (after:-inset-y-1.5), as LayersBadge does, so a
// row of chips keeps its height; rows that wrap need gap-y-3 so two hit boxes never overlap. `label` is the accessible
// name (the visible text is shorter on purpose). A dot (`dotClass`, bg-regime-* only) carries the colour: a crystal
// colour never goes on text. Every class is a complete literal (tailwind.config.js scans this file).

import React from 'react';
import type { ReactNode } from 'react';

export type ChipTone = 'plain' | 'accent' | 'dashed';

interface ChipProps {
  /** The accessible name. */
  label: string;
  children: ReactNode;
  icon?: ReactNode;
  /** A bg-regime-* class for the leading dot (the colour lives on the dot, never on the text). */
  dotClass?: string;
  tone?: ChipTone;
  onClick?: () => void;
  title?: string;
  buttonRef?: { current: HTMLButtonElement | null };
  'data-testid'?: string;
}

const BASE =
  'relative inline-flex items-center gap-1.5 h-8 px-3 rounded-pill whitespace-nowrap border text-xs bg-surface-panel/80';

const TONES: Record<ChipTone, string> = {
  plain: 'border-line-strong text-ink-soft',
  accent: 'border-gold-500/40 text-gold-200',
  dashed: 'border-dashed border-line-strong text-ink-soft',
};

const BUTTON =
  "after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400";

const Chip = ({ label, children, icon, dotClass, tone = 'plain', onClick, title, buttonRef, 'data-testid': testId }: ChipProps) => {
  const inner = (
    <>
      {dotClass ? <span aria-hidden="true" className={`w-2 h-2 rounded-pill shrink-0 ${dotClass}`} /> : icon ?? null}
      {children}
    </>
  );
  if (!onClick) {
    return (
      <span className={`${BASE} ${TONES[tone]}`} aria-label={label} title={title} data-testid={testId}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      aria-label={label}
      title={title}
      data-testid={testId}
      className={`${BASE} ${TONES[tone]} ${BUTTON}`}
    >
      {inner}
    </button>
  );
};

export default Chip;
