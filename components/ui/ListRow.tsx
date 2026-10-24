// components/ui/ListRow.tsx (v15.5 UI kit)
//
// A 64 px row (min-h-row) that is one button: an icon tile, a title and a subtitle, and an optional trailing badge.
// `current` marks the active row (aria-current="true"); the icon's colour is the caller's (a stroke-* class on the icon
// for the danger row: text colours stay ink-*).

import React from 'react';
import type { ReactNode } from 'react';

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClick: () => void;
  current?: boolean;
  /** Trailing content (a Badge). */
  trailing?: ReactNode;
  buttonRef?: { current: HTMLButtonElement | null };
  'data-testid'?: string;
}

const ListRow = ({ title, subtitle, icon, onClick, current, trailing, buttonRef, 'data-testid': testId }: ListRowProps) => (
  <button
    type="button"
    ref={buttonRef}
    onClick={onClick}
    aria-current={current ? 'true' : undefined}
    data-testid={testId}
    className="w-full min-h-row px-4 py-2 flex items-center gap-3 text-left border-b border-line hover:bg-surface-raised/40 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400"
  >
    {icon ? (
      <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center text-ink-soft">
        {icon}
      </span>
    ) : null}
    <span className="flex-1 min-w-0">
      <span className="block text-base text-ink-strong">{title}</span>
      {subtitle ? <span className="block text-xs text-ink-muted">{subtitle}</span> : null}
    </span>
    {trailing ?? null}
  </button>
);

export default ListRow;
