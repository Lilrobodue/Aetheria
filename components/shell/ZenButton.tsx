// components/shell/ZenButton.tsx (v15.6, Zen in the new layout; decision 1, option A)
//
// The eye button: Now Playing's top bar (left of ⋯), the landscape header beside its ⋯, and the desktop transport's
// right end. "Zen mode", aria-pressed; the icon is EyeOff while off and Eye on a raised circle while on (classic's own
// icons). One tap turns Zen on (the controls hide 3 s later) or off.

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useActions, useShell } from './contexts';
import { zenButtonTitle } from './zenModel';

const ON =
  'shrink-0 w-touch h-touch flex items-center justify-center rounded-pill bg-surface-raised text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const OFF =
  'shrink-0 w-touch h-touch flex items-center justify-center rounded-control text-ink-soft hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const ZenButton = ({ 'data-testid': testId }: { 'data-testid'?: string }) => {
  const { zen } = useShell();
  const actions = useActions();
  return (
    <button
      type="button"
      aria-label="Zen mode"
      aria-pressed={zen.on}
      title={zenButtonTitle(zen.on)}
      data-testid={testId}
      onClick={() => actions.setZen(!zen.on)}
      className={zen.on ? ON : OFF}
    >
      {zen.on ? <Eye size={20} aria-hidden="true" /> : <EyeOff size={20} aria-hidden="true" />}
    </button>
  );
};

export default ZenButton;
