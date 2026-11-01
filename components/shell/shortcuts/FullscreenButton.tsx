// components/shell/shortcuts/FullscreenButton.tsx (v16.7, desktop polish; decision 4 A)
//
// The desktop transport's Full screen button, between Zen and ⋯: 44 × 44, "Full screen", aria-pressed, with Zen's
// looks (Maximize2 while off; Minimize2 on a raised circle while on). Its click does what F does (immersive.ts's
// toggleImmersive), and in full screen it is the way out. Not rendered where the Fullscreen API isn't available.

import React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import Tooltip from '../../ui/Tooltip';
import { useActions, useShell } from '../contexts';
import { countRender } from '../devRenders';
import { FULLSCREEN_LABEL, fullscreenTip, tipKeys } from './keysModel';
import { fullscreenSupported, toggleImmersive, useFullscreen } from './immersive';
import { useKeysOn } from './shortcutsStore';

const ON =
  'shrink-0 w-touch h-touch flex items-center justify-center rounded-pill bg-surface-raised text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const OFF =
  'shrink-0 w-touch h-touch flex items-center justify-center rounded-control text-ink-soft hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const FullscreenButton = () => {
  countRender('FullscreenButton');
  const full = useFullscreen();
  const { zen } = useShell();
  const actions = useActions();
  const keys = useKeysOn();
  if (!fullscreenSupported()) return null;
  return (
    <Tooltip label={fullscreenTip(full)} keys={keys ? tipKeys('fullscreen') : null} side="top-end">
      <button
        type="button"
        aria-label={FULLSCREEN_LABEL}
        aria-pressed={full}
        data-testid="fullscreen-button"
        onClick={() => toggleImmersive(actions, zen.on)}
        className={full ? ON : OFF}
      >
        {full ? <Minimize2 size={20} aria-hidden="true" /> : <Maximize2 size={20} aria-hidden="true" />}
      </button>
    </Tooltip>
  );
};

export default React.memo(FullscreenButton);
