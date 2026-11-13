// Checks for components/shell/shortcuts/keysModel.ts (v16.7, desktop polish: the keyboard shortcuts).
// Run with: node components/shell/shortcuts/keysModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  shortcutFor,
  seekStep,
  SHORTCUTS,
  KEYS_KEY,
  parseKeysOn,
  tipKeys,
  describeKeys,
  ariaKeyshortcuts,
  feedbackText,
  feedbackLive,
  feedbackFor,
  fullscreenTip,
  FEEDBACK_MS,
  FULLSCREEN_FAILED,
} from './keysModel.ts';
import type { KeyContext, KeyLike, ShortcutId, FeedbackKind } from './keysModel.ts';
import { MENU_AWAY_LIVE, MENU_SHOWN_LIVE } from './keysModel.ts';
import { NAV_AWAY_KEY, parseNavAway } from '../navModel.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const IDLE: KeyContext = {
  off: false,
  blocked: false,
  typing: false,
  ownsSpace: false,
  ownsArrows: false,
  panelOpen: false,
  zenOn: false,
  fullscreen: false,
  outputQuestion: false,
};
const k = (key: string, more: Partial<KeyLike> = {}): KeyLike => ({ key, ...more });
const at = (more: Partial<KeyContext>): KeyContext => ({ ...IDLE, ...more });

// ---- What each key asks for, with nothing in the way -------------------------------------------------------------
const WANT: Array<[string, ShortcutId]> = [
  [' ', 'playPause'],
  ['Spacebar', 'playPause'],
  ['k', 'playPause'],
  ['n', 'next'],
  ['p', 'prev'],
  ['m', 'musicOnly'],
  ['f', 'fullscreen'],
  ['q', 'queue'],
  ['l', 'layers'],
  ['v', 'visuals'],
  ['c', 'menu'], // v16.8.9
  ['/', 'search'],
  ['?', 'help'],
  ['ArrowLeft', 'back5'],
  ['ArrowRight', 'forward5'],
];
for (const [key, id] of WANT) eq(shortcutFor(k(key), IDLE), id, `"${key}"`);
// Caps Lock: the upper-case letter, no Shift.
for (const key of ['K', 'N', 'P', 'M', 'F', 'Q', 'L', 'V', 'C']) eq(shortcutFor(k(key), IDLE), shortcutFor(k(key.toLowerCase()), IDLE), `Caps Lock "${key}"`);
// Shift with an arrow is 30 s.
eq(shortcutFor(k('ArrowLeft', { shiftKey: true }), IDLE), 'back30', 'Shift+←');
eq(shortcutFor(k('ArrowRight', { shiftKey: true }), IDLE), 'forward30', 'Shift+→');
// ? and / with Shift (US: Shift+/ is ?).
eq(shortcutFor(k('?', { shiftKey: true }), IDLE), 'help', 'Shift+? (US layout)');
eq(shortcutFor(k('/', { shiftKey: true }), IDLE), 'search', 'Shift+/ where a layout gives /');
// Escape: only with full screen or Zen to leave.
eq(shortcutFor(k('Escape'), IDLE), null, 'Esc with nothing to leave');
eq(shortcutFor(k('Escape'), at({ zenOn: true })), 'escape', 'Esc leaves Zen');
eq(shortcutFor(k('Esc'), at({ fullscreen: true })), 'escape', 'Esc (legacy name) leaves full screen');
eq(shortcutFor(k('Escape', { repeat: true }), at({ zenOn: true })), null, 'rule 7: a held Esc acts once (its repeats are ignored)');
eq(shortcutFor(k('Escape', { repeat: true }), at({ fullscreen: true })), null, 'rule 7: a held Esc never leaves full screen twice');

// ---- Rule 1: a component handled the key --------------------------------------------------------------------------
for (const [key] of WANT) eq(shortcutFor(k(key, { defaultPrevented: true }), IDLE), null, `rule 1: "${key}" defaultPrevented`);
eq(shortcutFor(k('Escape', { defaultPrevented: true }), at({ zenOn: true })), null, 'rule 1: Esc defaultPrevented');

// ---- Rule 2: IME composition ----------------------------------------------------------------------------------------
eq(shortcutFor(k('n', { isComposing: true }), IDLE), null, 'rule 2: isComposing');
eq(shortcutFor(k('Process', { keyCode: 229 }), IDLE), null, 'rule 2: keyCode 229');
eq(shortcutFor(k(' ', { keyCode: 229 }), IDLE), null, 'rule 2: Space during composition');

// ---- Rule 3: modifiers (the browser's keys; AltGr is Ctrl+Alt on Windows) ------------------------------------------
for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
  for (const [key] of WANT) eq(shortcutFor(k(key, { [mod]: true }), IDLE), null, `rule 3: ${mod} + "${key}"`);
}
eq(shortcutFor(k('?', { ctrlKey: true, altKey: true }), IDLE), null, 'rule 3: AltGr');
eq(shortcutFor(k('Escape', { ctrlKey: true }), at({ zenOn: true })), null, 'rule 3: Ctrl+Esc');

// ---- Rule 4: the switch off: every key but Esc ---------------------------------------------------------------------
for (const [key] of WANT) eq(shortcutFor(k(key), at({ off: true })), null, `rule 4: "${key}" with the shortcuts off`);
eq(shortcutFor(k('Escape'), at({ off: true, zenOn: true })), 'escape', 'rule 4: Esc still works with the shortcuts off');
eq(shortcutFor(k('Escape'), at({ off: true, fullscreen: true })), 'escape', 'rule 4: Esc leaves full screen with the shortcuts off');

// ---- Rule 5: a dialog, the tour, the safety statement --------------------------------------------------------------
for (const [key] of WANT) eq(shortcutFor(k(key), at({ blocked: true })), null, `rule 5: "${key}" behind a dialog`);
eq(shortcutFor(k('Escape'), at({ blocked: true, zenOn: true })), null, 'rule 5: Esc belongs to the dialog');

// ---- Rule 6: typing --------------------------------------------------------------------------------------------------
for (const [key] of WANT) eq(shortcutFor(k(key), at({ typing: true })), null, `rule 6: "${key}" while typing`);
eq(shortcutFor(k('Escape'), at({ typing: true, zenOn: true })), null, 'rule 6: Esc in a field is the field\'s');

// ---- Rule 7: Escape with something open ------------------------------------------------------------------------------
eq(shortcutFor(k('Escape'), at({ panelOpen: true, zenOn: true })), null, 'rule 7: a panel closes first (its own listener)');
eq(shortcutFor(k('Escape'), at({ panelOpen: true, fullscreen: true })), null, 'rule 7: a panel closes first, in full screen too');
eq(shortcutFor(k('Escape'), at({ outputQuestion: true, zenOn: true })), null, 'rule 7: the output question has its own Esc');

// ---- Rule 8: arrows ----------------------------------------------------------------------------------------------------
eq(shortcutFor(k('ArrowRight'), at({ ownsArrows: true })), null, 'rule 8: a control that uses the arrows');
eq(shortcutFor(k('ArrowLeft', { shiftKey: true }), at({ ownsArrows: true })), null, 'rule 8: Shift+arrow on such a control');
eq(shortcutFor(k('ArrowRight', { repeat: true }), IDLE), 'forward5', 'rule 8: a held arrow repeats');
eq(shortcutFor(k('ArrowLeft', { repeat: true, shiftKey: true }), IDLE), 'back30', 'rule 8: a held Shift+arrow repeats');
eq(shortcutFor(k('ArrowUp'), IDLE), null, 'rule 8: ↑ is no shortcut');
eq(shortcutFor(k('ArrowDown'), IDLE), null, 'rule 8: ↓ is no shortcut');
// ownsArrows touches only the arrows.
eq(shortcutFor(k('n'), at({ ownsArrows: true })), 'next', 'rule 8: N on a slider still works');

// ---- Rule 9: repeats (every other key acts once) ---------------------------------------------------------------------
for (const [key, id] of WANT) {
  if (id === 'back5' || id === 'forward5') continue;
  eq(shortcutFor(k(key, { repeat: true }), IDLE), null, `rule 9: a held "${key}" acts once`);
}

// ---- Rule 10: Space -----------------------------------------------------------------------------------------------------
eq(shortcutFor(k(' '), at({ ownsSpace: true })), null, 'rule 10: Space presses the focused control');
eq(shortcutFor(k(' ', { shiftKey: true }), IDLE), null, 'rule 10: Shift+Space');
eq(shortcutFor(k('k'), at({ ownsSpace: true })), 'playPause', 'rule 10: K on a focused button still plays');

// ---- Rule 12: Shift with a letter --------------------------------------------------------------------------------------
for (const key of ['K', 'N', 'P', 'M', 'F', 'Q', 'L', 'V', 'k', 'n']) eq(shortcutFor(k(key, { shiftKey: true }), IDLE), null, `rule 12: Shift+${key}`);
for (const key of ['a', 'b', 'j', 'z', '1', '.', '-', 'é']) eq(shortcutFor(k(key), IDLE), null, `rule 12: "${key}" is no shortcut`);

// ---- Rule 13: everything else: media keys, volume, F-keys, Tab, Enter ---------------------------------------------------
for (const key of [
  'MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious', 'MediaStop', 'MediaPlay', 'MediaPause',
  'AudioVolumeUp', 'AudioVolumeDown', 'AudioVolumeMute', 'F1', 'F5', 'F11', 'F12', 'Tab', 'Enter',
  'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete', 'Unidentified', 'Dead', '',
]) {
  eq(shortcutFor(k(key), IDLE), null, `rule 13: "${key}"`);
  eq(shortcutFor(k(key), at({ zenOn: true, fullscreen: true })), null, `rule 13: "${key}" in full screen`);
}
eq(shortcutFor({ key: undefined as unknown as string }, IDLE), null, 'rule 13: no key at all');

// ---- The order matters: an earlier rule wins ----------------------------------------------------------------------------
eq(shortcutFor(k('Escape'), at({ blocked: true, typing: true, panelOpen: true, zenOn: true })), null, 'blocked beats everything');
eq(shortcutFor(k(' '), at({ off: true, ownsSpace: false })), null, 'off beats Space');

// ---- Steps ----------------------------------------------------------------------------------------------------------
eq([seekStep('back5'), seekStep('forward5'), seekStep('back30'), seekStep('forward30'), seekStep('next')], [-5, 5, -30, 30, null], 'the seek bar\'s steps');

// ---- The list ---------------------------------------------------------------------------------------------------------
eq(SHORTCUTS.map((g) => g.title), ['Playback', 'Panels', 'View'], 'three groups');
const rows = SHORTCUTS.flatMap((g) => g.rows);
eq(rows.length, 14, 'fourteen rows (v16.8.9: C, the menu)');
eq(new Set(rows.map((r) => r.id)).size, rows.length, 'unique row ids');
check(rows.every((r) => r.label && r.keys.length > 0 && r.keys.every((c) => c.length > 0)), 'every row has a label and keys');
eq(rows.find((r) => r.id === 'musicOnly')?.keys, [['M']], 'M is Music only');
eq(rows.find((r) => r.id === 'musicOnly')?.label, 'Music only: the layers off or on', 'its words');
eq(rows.find((r) => r.id === 'seek5')?.label, 'Back or forward 5 s', 'the arrows step 5 s');
// v16.8.9: C, in View, before "This list".
eq(rows.find((r) => r.id === 'menu')?.keys, [['C']], 'C is the menu');
eq(rows.find((r) => r.id === 'menu')?.label, 'Show or hide the menu', 'its words');
eq(SHORTCUTS.find((g) => g.title === 'View')?.rows.map((r) => r.id), ['fullscreen', 'escape', 'menu', 'help'], 'the View group');

// ---- The switch ---------------------------------------------------------------------------------------------------
eq(KEYS_KEY, 'aetheria.keys.v1', 'the key');
eq([parseKeysOn(null), parseKeysOn(undefined), parseKeysOn(''), parseKeysOn('on'), parseKeysOn('junk'), parseKeysOn('off')], [true, true, true, true, true, false], 'only "off" turns them off');

// ---- Tooltips ------------------------------------------------------------------------------------------------------
eq(tipKeys('playPause'), { caps: ['Space', 'K'], aria: 'Space K', description: 'Shortcut: Space or K' }, 'Play\'s tooltip keys');
eq(tipKeys('help'), { caps: ['?'], aria: '?', description: 'Shortcut: ?' }, 'the Shortcuts button');
eq([tipKeys('next').aria, tipKeys('prev').aria, tipKeys('queue').aria, tipKeys('fullscreen').aria, tipKeys('layers').aria], ['N', 'P', 'Q', 'F', 'L'], 'the letters');
eq(tipKeys('menu'), { caps: ['C'], aria: 'C', description: 'Shortcut: C' }, 'v16.8.9: both logo buttons');
eq(describeKeys([]), '', 'no keys, no description');
eq(ariaKeyshortcuts(['Space', 'K']), 'Space K', 'aria-keyshortcuts');
eq([fullscreenTip(false), fullscreenTip(true)], ['Full screen', 'Exit full screen'], 'the full-screen button');

// ---- Feedback ------------------------------------------------------------------------------------------------------
const KINDS: FeedbackKind[] = ['play', 'pause', 'back5', 'forward5', 'back30', 'forward30', 'next', 'prev', 'musicOnlyOn', 'musicOnlyOff', 'fullscreenOn', 'fullscreenOff', 'fullscreenFailed'];
eq(KINDS.map(feedbackText), ['Play', 'Pause', '−5 s', '+5 s', '−30 s', '+30 s', 'Next', 'Previous', 'Music only: layers off', 'Layers on', null, null, FULLSCREEN_FAILED], 'the pill');
eq(
  KINDS.map(feedbackLive),
  [
    'Playing.', 'Paused.', null, null, null, null, null, null,
    'Music only on: the tone, beat and drone are off.', 'Music only off: the layers are back.',
    'Full screen. Move the mouse for the controls; Esc leaves.', 'Left full screen.', FULLSCREEN_FAILED,
  ],
  'the live line: M, Space and F only'
);
eq(feedbackFor('playPause', { isPlaying: true, musicOnly: false }), 'pause', 'Space while playing: Pause');
eq(feedbackFor('playPause', { isPlaying: false, musicOnly: false }), 'play', 'Space while paused: Play');
eq(feedbackFor('musicOnly', { isPlaying: true, musicOnly: false }), 'musicOnlyOn', 'M turns Music only on');
eq(feedbackFor('musicOnly', { isPlaying: true, musicOnly: true }), 'musicOnlyOff', 'M turns it off');
eq(['back5', 'forward5', 'back30', 'forward30', 'next', 'prev'].map((id) => feedbackFor(id as ShortcutId, { isPlaying: true, musicOnly: false })), ['back5', 'forward5', 'back30', 'forward30', 'next', 'prev'], 'arrows, N and P');
eq(['fullscreen', 'search', 'queue', 'layers', 'visuals', 'escape', 'help'].map((id) => feedbackFor(id as ShortcutId, { isPlaying: true, musicOnly: false })), [null, null, null, null, null, null, null], 'the panel keys show their panel instead');
eq(FEEDBACK_MS, 1200, '1.2 s');
// v16.8.9: C is read, never shown (the menu itself shows the change).
eq([feedbackText('menuAway'), feedbackText('menuShown')], [null, null], 'C: no pill');
eq([feedbackLive('menuAway'), feedbackLive('menuShown')], [MENU_AWAY_LIVE, MENU_SHOWN_LIVE], 'C: the live line');
eq(MENU_AWAY_LIVE, 'Menu hidden. Press C or the logo to bring it back.', 'its words, away');
eq(MENU_SHOWN_LIVE, 'Menu shown.', 'its words, back');
eq(feedbackFor('menu', { isPlaying: true, musicOnly: false }), null, 'feedbackFor: none (the handler announces it)');

// ---- v16.8.9: the menu away, remembered -----------------------------------------------------------------------------
eq(NAV_AWAY_KEY, 'aetheria.navAway.v1', 'the key');
eq([parseNavAway(null), parseNavAway(''), parseNavAway('shown'), parseNavAway('true'), parseNavAway('AWAY'), parseNavAway('away')], [false, false, false, false, false, true], 'only "away" is away');

if (failures.length) {
  console.error(`keysModel: ${failures.length} of ${passed + failures.length} checks FAILED`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`keysModel: ${passed} checks passed, 0 failed`);
