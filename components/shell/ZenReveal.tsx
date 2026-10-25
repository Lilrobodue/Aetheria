// components/shell/ZenReveal.tsx (v15.6, Zen in the new layout)
//
// What AppShell renders while Zen hides the controls (the shell is inert and transparent then):
//   - "Show controls", first in the shell's DOM order and visually hidden until focused (classic's classes), so Tab
//     from <body> (where inert left the focus) lands on it; Enter reveals and puts the focus on the shell's first
//     control. TalkBack swipes reach it the same way.
//   - a full-screen surface over the shell and under the notices (z-scrim), aria-hidden, that reveals on `click` only:
//     a reveal on pointerdown would let the click that follows hit-test again, after the surface is gone, and press
//     the control under the finger (spec §2.5, probe C). So the first tap only reveals; a second within 3 s presses.

import React from 'react';
import { useActions, useShell } from './contexts';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ZenReveal = () => {
  const actions = useActions();
  const { rootRef } = useShell();
  const showControls = () => {
    actions.revealZen();
    // Once the shell is live again (the next frame), the keyboard continues from its first VISIBLE control (on a
    // landscape phone the top bar, and its Zen button, are display:none: Now Playing's own header holds them there).
    window.requestAnimationFrame(() => {
      const first = Array.from(rootRef.current?.querySelectorAll(FOCUSABLE) ?? []).find(
        (el) => el instanceof HTMLElement && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
      );
      if (first instanceof HTMLElement) first.focus();
    });
  };
  return (
    <>
      <button
        type="button"
        onClick={showControls}
        data-testid="zen-show-controls"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-toast focus:px-4 focus:min-h-touch focus:rounded-control focus:bg-surface-panel focus:text-ink"
      >
        Show controls
      </button>
      <div aria-hidden="true" data-testid="zen-reveal" onClick={actions.revealZen} className="fixed inset-0 z-scrim" />
    </>
  );
};

export default ZenReveal;
