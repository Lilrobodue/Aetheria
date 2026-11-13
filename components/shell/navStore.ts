// components/shell/navStore.ts (v16.8.9, the side menu away; the user's decisions, 2026-11-13)
//
// Whether the desktop side menu is away (slid off the left edge, the logo left floating to bring it back). Remembered on
// this browser (decision: "Remember it"): 'away' under NAV_AWAY_KEY while away, the key removed while shown. Read once;
// blocked or unreadable storage, or any other value, reads as shown. After shortcutsStore.ts: one module value, every
// reader re-renders through useSyncExternalStore.

import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { hideTooltips } from '../ui/Tooltip';

import { NAV_AWAY_KEY, parseNavAway } from './navModel';
export { NAV_AWAY_KEY, parseNavAway };

let away: boolean | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of Array.from(listeners)) fn();
};

/** The slide's length (the nav, the panel and its header's room). */
export const NAV_SLIDE_MS = 220;
/** True from a hide or show until its slide is done. The panel and its header animate only then, so a window resized
 *  across 1280 px (the panel from 72 to 200) still jumps with the nav, as v16.7 made it (desktop-keys R1). */
let sliding = false;
let slideTimer: ReturnType<typeof setTimeout> | null = null;

/** Whether the menu is away now. */
export function navAway(): boolean {
  if (away === null) {
    try {
      away = parseNavAway(localStorage.getItem(NAV_AWAY_KEY));
    } catch {
      away = false;
    }
  }
  return away;
}

/** Hide (true) or show (false) the menu: saved, then every reader re-renders. A no-op when already so. */
export function setNavAway(next: boolean): void {
  if (navAway() === next) return;
  away = next;
  try {
    if (next) localStorage.setItem(NAV_AWAY_KEY, 'away');
    else localStorage.removeItem(NAV_AWAY_KEY);
  } catch {}
  // Review round 1: a bubble showing on the menu (a rail row, the logo) goes with it, as Zen's does.
  hideTooltips();
  sliding = true;
  if (slideTimer) clearTimeout(slideTimer);
  slideTimer = setTimeout(() => {
    slideTimer = null;
    sliding = false;
    notify();
  }, NAV_SLIDE_MS + 80);
  notify();
}

/** Review round 1: show the menu NOW (committed before this returns: flushSync), so whatever the same key or click does
 *  next can focus inside it and record it as the place to come back to (the shortcuts dialog, Layers by L). The focus on
 *  the floating logo, which goes, moves to the menu's own logo (it was lost to the page's body before). */
export function showNavNow(): void {
  if (!navAway()) return;
  const active = document.activeElement;
  const fromLogo = active instanceof HTMLElement && active.getAttribute('data-testid') === 'nav-show';
  flushSync(() => setNavAway(false));
  if (fromLogo) document.querySelector<HTMLElement>('[data-testid="nav-hide"]')?.focus();
}

/** Whether a hide or show is sliding now. */
export function navSliding(): boolean {
  return sliding;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useNavAway(): boolean {
  return useSyncExternalStore(subscribe, navAway, navAway);
}

export function useNavSliding(): boolean {
  return useSyncExternalStore(subscribe, navSliding, navSliding);
}

/** The nav's id, for aria-controls on both logo buttons. */
export const SIDE_NAV_ID = 'desktop-side-nav';

/** After the next render, the focus to the logo button that is now showing: 'show' (the floating logo, the menu away)
 *  or 'hide' (the menu's own logo). Used when the focus would otherwise be lost in the inert, hidden nav, and when the
 *  floating logo (which goes) brought the menu back. */
export function focusNavToggle(which: 'show' | 'hide'): void {
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-testid="nav-${which}"]`);
    if (el instanceof HTMLElement) el.focus();
  });
}
