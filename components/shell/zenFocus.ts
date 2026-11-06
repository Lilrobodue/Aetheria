// components/shell/zenFocus.ts (v16.8: Zen's Tab under Chrome 157)
//
// When Zen hides the controls they become inert, and a control that had the focus loses it to <body>. Up to Chrome
// 156 the next Tab then started from the top of the page and landed on "Show controls". Since Chrome 157 it starts
// from the hidden control, finds nothing focusable after it (everything there is inert), and leaves the page: only a
// second Tab reaches "Show controls". This puts back exactly the Chrome 156 behaviour, in both Zens (classic's in
// App.tsx, the new layout's in ZenReveal.tsx), and nothing else:
//   - No focus moves at the hide: nothing new shows on screen ("Show controls" shows only once it has the focus), and
//     Space keeps its play/pause.
//   - At the hide, the focus counts as LOST TO THE HIDE when it is inside the subtree being hidden, or on <body> with
//     the last pointerdown inside that subtree (a click on a part of the controls that takes no focus leaves Chrome's
//     starting point in there).
//   - A pointerdown or a focus outside the hidden subtree ends that (the starting point is somewhere still visible now,
//     a notice say, and its own Tab order holds), and so do the reveal and the end of Zen.
//   - While it holds, a Tab or Shift+Tab goes to "Show controls": one press, as before Chrome 157. Otherwise the
//     browser decides. Never while something above the page holds the focus (a kit overlay makes #root, and the
//     button, inert): an overlay keeps its own trap.
// No timer, no polling. While Zen shows the controls only the page-wide pointerdown record below runs.

import { useEffect, useLayoutEffect } from 'react';

// The last pointerdown's target (capture phase): where a click or a tap left Chrome's starting point. One listener for
// the page's life, added by the first useZenTab (App's, at launch: App calls it for classic's Zen in both layouts).
let lastDown: EventTarget | null = null;
let recording = false;
function recordPointerDowns(): void {
  if (recording) return;
  recording = true;
  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      lastDown = e.target;
    },
    true
  );
}

/** At the hide: the focus is lost to it (inside `hiddenRoot`, or on <body> after a pointerdown inside it). */
export function lostToHide(hiddenRoot: Element | null): boolean {
  if (!hiddenRoot) return false;
  const a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement) return hiddenRoot.contains(a);
  return lastDown instanceof Node && hiddenRoot.contains(lastDown);
}

/** While `hidden`: a Tab or Shift+Tab with the focus lost to the hide goes to `target` ("Show controls"). */
export function useZenTab(
  hidden: boolean,
  targetRef: { current: HTMLElement | null },
  hiddenRootRef: { current: Element | null }
): void {
  useEffect(recordPointerDowns, []);
  // In the commit that hides: the focus is read before the browser takes it off the control going inert.
  useLayoutEffect(() => {
    if (!hidden) return;
    let lost = lostToHide(hiddenRootRef.current);
    const onOutside = (e: Event) => {
      const root = hiddenRootRef.current;
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) lost = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || !lost) return;
      const target = targetRef.current;
      if (!target || !target.isConnected || target.closest('[inert]')) return;
      e.preventDefault();
      target.focus({ preventScroll: true });
    };
    window.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('focusin', onOutside, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('focusin', onOutside, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [hidden]);
}
