// components/shell/shortcuts/shortcutsStore.ts (v16.7, desktop polish)
//
// Two small module stores for the keyboard shortcuts (no App state, no context value):
//   - the switch (WCAG 2.1.4: single-key shortcuts can be turned off): read once from aetheria.keys.v1, written from
//     the "?" dialog's switch only; useKeysOn() re-renders just its readers (the dialog, the rail, the transport's
//     tooltips) when it changes;
//   - the "?" dialog's opener: the rail's Shortcuts button and the ⋯ menu's row ask (requestShortcuts), and the mounted
//     DesktopKeys answers (onShortcutsRequest), as moreModel's requestMoreView does.

import { useSyncExternalStore } from 'react';
import { KEYS_KEY, parseKeysOn } from './keysModel';

let on: boolean | null = null;
const listeners = new Set<() => void>();

/** Whether the single-key shortcuts are on (read once; a blocked storage means on). */
export function keysOn(): boolean {
  if (on === null) {
    try {
      on = parseKeysOn(localStorage.getItem(KEYS_KEY));
    } catch {
      on = true;
    }
  }
  return on;
}

/** The switch's tap: saved ('off', or removed for on), then every reader re-renders. */
export function setKeysOn(next: boolean): void {
  on = next;
  try {
    if (next) localStorage.removeItem(KEYS_KEY);
    else localStorage.setItem(KEYS_KEY, 'off');
  } catch {}
  for (const fn of Array.from(listeners)) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useKeysOn(): boolean {
  return useSyncExternalStore(subscribe, keysOn, keysOn);
}

const dialogListeners = new Set<() => void>();

/** DesktopKeys, while mounted: open the "?" dialog when asked. */
export function onShortcutsRequest(fn: () => void): () => void {
  dialogListeners.add(fn);
  return () => {
    dialogListeners.delete(fn);
  };
}

/** The rail's Shortcuts button, the ⋯ menu's row: open the "?" dialog. */
export function requestShortcuts(): void {
  for (const fn of Array.from(dialogListeners)) fn();
}
