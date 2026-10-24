// components/ui/IconButton.tsx (v15.4 UI kit)
//
// An icon-only button. `label` is required: it is the accessible name (aria-label) and the hover title, since an icon
// alone names nothing. The target is at least 44 × 44 px (min-h-touch, min-w-touch).

import React from 'react';
import type { ReactNode } from 'react';

interface IconButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  buttonRef?: { current: HTMLButtonElement | null };
  className?: string;
}

const IconButton = ({ label, icon, onClick, buttonRef, className }: IconButtonProps) => (
  <button
    type="button"
    ref={buttonRef}
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`min-h-touch min-w-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400${className ? ` ${className}` : ''}`}
  >
    {icon}
  </button>
);

export default IconButton;
