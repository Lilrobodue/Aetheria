// components/ui/overlayStack.ts (v15.4 UI kit)
//
// The one stack of the kit's modal overlays (the Dialog now; every Sheet later). Module state, no React state, and no
// listener at all while it is empty, so with no kit overlay open the app behaves byte for byte as before.
//
// While at least one overlay is open:
//   - one `window` keydown listener in the CAPTURE phase. It runs before any `document` listener, so the top overlay
//     answers Escape and stops it: v15.0.1's OutputSheet and the layers popover (bubble-phase `document` listeners)
//     never also act on an Escape that belonged to a dialog above them ("one Escape, one overlay").
//     Tab and Shift+Tab move focus among the top overlay's focusables and wrap at both ends (a focus trap).
//   - one `document` focusin listener: focus that lands outside the top overlay goes back to its first focusable.
//   - `#root` is inert (the previous value is remembered and put back): the app under the overlay can't be tapped,
//     focused or read out. The kit's overlays render in a portal on <body>, outside #root. Zen Mode's inert is on the
//     UI wrapper inside #root, a different element, so the two never conflict.
// Closing an overlay gives focus back to what had it when it opened, if that is still in the page, or to the
// overlay's returnFocusFallback. Push and remove are idempotent per id (StrictMode mounts effects twice in dev).

import { useEffect, useRef } from 'react';

export interface OverlayOptions {
  /** The overlay's panel: the focus trap's bounds. */
  panel: () => HTMLElement | null;
  /** Escape on the top overlay. */
  onEscape: () => void;
  /** Where focus goes on close when the element that had it at open is gone. */
  returnFocusFallback?: () => HTMLElement | null;
}

interface Entry extends OverlayOptions {
  id: number;
  restoreFocus: Element | null;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

const stack: Entry[] = [];
let nextId = 1;
let rootWasInert: boolean | null = null;

function rootElement(): (HTMLElement & { inert: boolean }) | null {
  return document.getElementById('root') as (HTMLElement & { inert: boolean }) | null;
}

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
  );
}

function onKey(e: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape' || e.key === 'Esc') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    top.onEscape();
    return;
  }
  if (e.key !== 'Tab') return;
  const panel = top.panel();
  if (!panel) return;
  const list = focusables(panel);
  e.preventDefault();
  if (!list.length) {
    panel.focus();
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const at = active ? list.indexOf(active) : -1;
  let next: HTMLElement;
  if (at < 0) {
    // Outside the panel, or on something in it that is not in the list (the panel itself): start at an end.
    next = !active || !panel.contains(active) || !e.shiftKey ? list[0] : list[list.length - 1];
  } else {
    next = list[(at + (e.shiftKey ? -1 : 1) + list.length) % list.length];
  }
  next.focus();
}

function onFocusIn(e: FocusEvent): void {
  const top = stack[stack.length - 1];
  const panel = top?.panel();
  if (!panel || !(e.target instanceof Node) || panel.contains(e.target)) return;
  const first = focusables(panel)[0];
  (first ?? panel).focus();
}

/** Open an overlay on top of the stack; returns its id. */
export function pushOverlay(options: OverlayOptions): number {
  // Remember the focus before #root goes inert (inert blurs whatever inside it had focus).
  const entry: Entry = { ...options, id: nextId++, restoreFocus: document.activeElement };
  if (stack.length === 0) {
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);
    const root = rootElement();
    if (root) {
      rootWasInert = root.inert;
      root.inert = true;
    }
  }
  stack.push(entry);
  return entry.id;
}

/** Close an overlay (a no-op for an id already removed). */
export function removeOverlay(id: number): void {
  const at = stack.findIndex((e) => e.id === id);
  if (at < 0) return;
  const [entry] = stack.splice(at, 1);
  if (stack.length === 0) {
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocusIn);
    const root = rootElement();
    if (root && rootWasInert !== null) root.inert = rootWasInert;
    rootWasInert = null;
  }
  // After #root is live again: an inert element can't take focus.
  const back = entry.restoreFocus;
  if (back instanceof HTMLElement && back.isConnected && back !== document.body) {
    back.focus();
    return;
  }
  const fallback = entry.returnFocusFallback?.();
  if (fallback && fallback.isConnected) fallback.focus();
}

/** How many kit overlays are open (0: no listener, #root as it was). */
export function overlayDepth(): number {
  return stack.length;
}

/**
 * An overlay for a component's life while `open`: pushed on open, removed on close or unmount. The latest onEscape
 * is always the one called.
 */
export function useOverlay(
  open: boolean,
  panelRef: { current: HTMLElement | null },
  onEscape: () => void,
  returnFocusFallback?: HTMLElement | null
): void {
  const escapeRef: { current: () => void } = useRef(onEscape);
  escapeRef.current = onEscape;
  const fallbackRef: { current: HTMLElement | null | undefined } = useRef(returnFocusFallback);
  fallbackRef.current = returnFocusFallback;
  useEffect(() => {
    if (!open) return;
    const id = pushOverlay({
      panel: () => panelRef.current,
      onEscape: () => escapeRef.current(),
      returnFocusFallback: () => fallbackRef.current ?? null,
    });
    return () => removeOverlay(id);
  }, [open]);
}
