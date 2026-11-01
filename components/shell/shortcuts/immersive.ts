// components/shell/shortcuts/immersive.ts (v16.7, desktop polish; decision 4 A: full screen plus Zen)
//
// F and the transport's Full screen button: the Fullscreen API on <html> (never #root: the kit's Dialogs, Sheets,
// Tooltips and the notices render in portals on <body>, which a #root full screen would hide), plus Zen, so the
// controls hide 3 s later and a mouse move brings them back.
//   - enter: Zen on (remembered as ours only when it was off), then requestFullscreen; the key or the click is the user
//     activation. Refused (an iframe without allowfullscreen, a policy): Zen alone, and the pill and the live line say
//     so. Without the API at all (an iPhone), no button is rendered and F toggles Zen only.
//   - leave: exitFullscreen. Whatever ends it (F, the button, the browser's own Esc, F11's exit), the page reacts once,
//     on `fullscreenchange`: the Zen that F turned on ends with it; a Zen that was on before stays. Turning Zen off by
//     hand meanwhile (the eye button) makes it the user's: full screen stays, and so do the controls.
// No rAF, no timer, no polling: one `fullscreenchange` listener while in full screen (and the button's own).

import { useEffect, useState } from 'react';
import { showKeyFeedback } from './feedback';

interface ImmersiveActions {
  setZen: (on: boolean) => void;
}

/** Zen was turned on by entering full screen (so leaving turns it off). */
let zenByUs = false;
/** Full screen was entered here (the desktop shell leaves it on unmount). */
let enteredHere = false;
let watcher: (() => void) | null = null;
/** v16.7 review: a request is in flight (F and the button wait for it: a double press or a double click acts once). */
let pending = false;
/** The shell went away while a request was in flight: leave as soon as it lands. */
let leaveWhenSettled = false;

function unwatch(): void {
  if (watcher) document.removeEventListener('fullscreenchange', watcher);
  watcher = null;
}

/** The Fullscreen API is there and allowed (not an iPhone, not an iframe without allowfullscreen). */
export function fullscreenSupported(): boolean {
  try {
    return document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';
  } catch {
    return false;
  }
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement;
}

/** Full screen and Zen. */
export function enterImmersive(actions: ImmersiveActions, zenOn: boolean): void {
  if (!zenOn) {
    actions.setZen(true);
    zenByUs = true;
  }
  unwatch();
  const onChange = () => {
    if (document.fullscreenElement) {
      showKeyFeedback('fullscreenOn');
      return;
    }
    unwatch();
    enteredHere = false;
    if (zenByUs) {
      zenByUs = false;
      actions.setZen(false);
    }
    showKeyFeedback('fullscreenOff');
  };
  watcher = onChange;
  document.addEventListener('fullscreenchange', onChange);
  enteredHere = true;
  pending = true;
  leaveWhenSettled = false;
  let request: Promise<void>;
  try {
    request = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (err) {
    request = Promise.reject(err);
  }
  Promise.resolve(request).then(
    () => {
      pending = false;
      if (leaveWhenSettled) {
        leaveWhenSettled = false;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      }
    },
    () => {
      pending = false;
      leaveWhenSettled = false;
      // Refused: Zen alone (it stays; it is the user's now).
      if (watcher === onChange) unwatch();
      enteredHere = false;
      zenByUs = false;
      showKeyFeedback('fullscreenFailed');
    }
  );
}

/** Leave full screen (the page then reacts on fullscreenchange). */
export function leaveImmersive(): void {
  if (!document.fullscreenElement) return;
  document.exitFullscreen().catch(() => {});
}

/** F and the button: leave when in full screen; else enter, or toggle Zen where full screen doesn't exist. */
export function toggleImmersive(actions: ImmersiveActions, zenOn: boolean): void {
  if (pending) return; // the first press is still on its way in
  if (document.fullscreenElement) leaveImmersive();
  else if (!fullscreenSupported()) actions.setZen(!zenOn);
  else enterImmersive(actions, zenOn);
}

/** Zen turned off by hand while in full screen: it is no longer ours to turn off. */
export function zenTurnedOff(): void {
  zenByUs = false;
}

/** The desktop shell's unmount (a switch to classic, a peek, a resize into the phone shell): leave the full screen
 *  entered here (classic has no control to leave it), also when the request is still in flight (once it lands). */
export function leaveIfEnteredHere(): void {
  if (pending) {
    leaveWhenSettled = true;
    return;
  }
  if (enteredHere && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/** Whether the page is in full screen, following fullscreenchange. */
export function useFullscreen(): boolean {
  const [full, setFull] = useState(isFullscreen);
  useEffect(() => {
    const on = () => setFull(isFullscreen());
    document.addEventListener('fullscreenchange', on);
    on();
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  return full;
}
