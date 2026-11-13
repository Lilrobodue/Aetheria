// components/shell/navModel.ts (v16.8.9, the side menu away)
//
// The pure part of navStore: the storage key and how its value reads. No React, no DOM, so the node checks
// (shortcuts/keysModel.check.ts) can load it.

export const NAV_AWAY_KEY = 'aetheria.navAway.v1';

/** The stored value, read: 'away' is away; anything else (null, garbage) is shown. */
export function parseNavAway(raw: string | null): boolean {
  return raw === 'away';
}
