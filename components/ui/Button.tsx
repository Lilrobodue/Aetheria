// components/ui/Button.tsx (v15.4 UI kit)
//
// A text button: its visible text is its accessible name, its target is at least 44 px tall (min-h-touch), and it is
// never a submit button. Four looks, each a complete class literal (tailwind.config.js scans this file; a class built
// from strings would have no rule since v15.3). Text colours are ink-* or the classic black/white, never a regime or
// status colour.

import React from 'react';
import type { ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps {
  children: ReactNode;
  onClick: () => void;
  variant?: ButtonVariant;
  buttonRef?: { current: HTMLButtonElement | null };
  className?: string;
  'data-testid'?: string;
  /** v16.1 (the name Dialog's Save): set only where it can be off; left out, the markup is v15.4's. */
  disabled?: boolean;
}

const BASE =
  'min-h-touch px-4 rounded-control text-sm transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-gold-500 hover:bg-gold-400 text-black font-bold',
  secondary: 'bg-surface-raised border border-line-strong text-ink hover:border-ink-faint',
  danger: 'bg-red-600 hover:bg-red-500 text-white font-bold',
  ghost: 'text-ink-muted hover:text-ink-strong',
};

const Button = ({ children, onClick, variant = 'secondary', buttonRef, className, 'data-testid': testId, disabled }: ButtonProps) => (
  <button
    type="button"
    ref={buttonRef}
    onClick={onClick}
    data-testid={testId}
    disabled={disabled}
    className={`${BASE} ${VARIANTS[variant]}${className ? ` ${className}` : ''}${disabled === undefined ? '' : ' disabled:opacity-40 disabled:cursor-not-allowed'}`}
  >
    {children}
  </button>
);

export default Button;
