// components/shell/zenModel.ts (v15.6, Zen in the new layout)
//
// Zen's pure rule for the new layout (spec §3.11): while the switch is on, the controls hide 3 s after the last
// activity only where the visuals are the point, the phone's Now Playing (never the Car screen) and the desktop with no
// panel open. A sheet or the ⋯ menu, another tab and v2's output question each make it dormant (on, but not hiding).
// Free of app imports, so Node checks it directly (zenModel.check.ts, `npm run check:shell`).

import type { ShellSheet, ShellTab } from './shellModel';

/** How long the controls stay after the last activity (classic's Zen uses the same 3 s). */
export const ZEN_HIDE_MS = 3000;

/** Input types that take no typing: focus on one of these never holds the controls up (classic's set, App.tsx). */
export const ZEN_NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

export interface ZenInputs {
  /** The switch (App's shellZen). */
  on: boolean;
  /** The new layout shows (not classic, not a peek into classic). */
  shellOn: boolean;
  tab: ShellTab;
  sheet: ShellSheet | null;
  /** The phone's Car screen (Output = Car): never Zen. */
  car: boolean;
  /** v2's output question is showing: its contract keeps Pause and Next usable. */
  outputQuestion: boolean;
}

/** Whether Zen may hide the controls now (the 3 s timer runs only while this is true). */
export function zenActive(s: ZenInputs): boolean {
  return s.on && s.shellOn && s.tab === 'now' && s.sheet === null && !s.car && !s.outputQuestion;
}

/** The ⋯ menu's Zen row: what a tap does, in the row's words. */
export function zenMenuRow(on: boolean): { title: string; subtitle: string } {
  return on
    ? { title: 'Leave Zen', subtitle: 'The controls stay' }
    : { title: 'Hide the controls (Zen)', subtitle: 'Tap anywhere to bring them back' };
}

/** The eye button's hover title. */
export function zenButtonTitle(on: boolean): string {
  return on ? 'Leave Zen: the controls stay' : 'Hide the controls until you tap';
}
