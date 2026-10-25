// Checks for components/shell/zenModel.ts (v15.6, Zen in the new layout).
// Run with: node components/shell/zenModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import { zenActive, zenMenuRow, zenButtonTitle, ZEN_HIDE_MS, ZEN_NON_TEXT_INPUTS } from './zenModel.ts';
import type { ZenInputs } from './zenModel.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// Every input of zenActive: 2 × 2 × 5 tabs × 5 sheets × 2 × 2 = 400 states, against the rule written out by hand.
const TABS = ['now', 'library', 'mixes', 'layers', 'more'] as const;
const SHEETS = [null, 'sound', 'crystal', 'walks', 'menu'] as const;
let states = 0;
let activeStates = 0;
for (const on of [false, true]) {
  for (const shellOn of [false, true]) {
    for (const tab of TABS) {
      for (const sheet of SHEETS) {
        for (const car of [false, true]) {
          for (const outputQuestion of [false, true]) {
            const s: ZenInputs = { on, shellOn, tab, sheet, car, outputQuestion };
            let want = true;
            if (!on) want = false; // the switch is off
            if (!shellOn) want = false; // classic or a peek: classic's own Zen, never this one
            if (tab !== 'now') want = false; // a solid tab: dormant
            if (sheet !== null) want = false; // a sheet or the menu: dormant
            if (car) want = false; // the Car screen is never Zen
            if (outputQuestion) want = false; // v2's output question keeps the transport usable
            const got = zenActive(s);
            eq(got, want, `zenActive(${JSON.stringify(s)})`);
            states++;
            if (got) activeStates++;
          }
        }
      }
    }
  }
}
eq(states, 400, 'every combination checked');
eq(activeStates, 1, 'exactly one state hides: on, the new layout, Now Playing, nothing open, no Car, no question');
eq(zenActive({ on: true, shellOn: true, tab: 'now', sheet: null, car: false, outputQuestion: false }), true, 'the one active state');

// The words.
eq(zenMenuRow(false), { title: 'Hide the controls (Zen)', subtitle: 'Tap anywhere to bring them back' }, 'menu row, off');
eq(zenMenuRow(true), { title: 'Leave Zen', subtitle: 'The controls stay' }, 'menu row, on');
eq(zenButtonTitle(false), 'Hide the controls until you tap', 'button title, off');
eq(zenButtonTitle(true), 'Leave Zen: the controls stay', 'button title, on');

// Classic's timing and its non-text inputs (App.tsx ZEN_NON_TEXT_INPUTS), unchanged.
eq(ZEN_HIDE_MS, 3000, '3 s, as classic');
eq([...ZEN_NON_TEXT_INPUTS].sort(), ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'], 'the non-text inputs');
check(!ZEN_NON_TEXT_INPUTS.has('text') && !ZEN_NON_TEXT_INPUTS.has('search'), 'text and search are text-like');

console.log(`zenModel: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
