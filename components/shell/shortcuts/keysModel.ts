// components/shell/shortcuts/keysModel.ts (v16.7, desktop polish: the keyboard shortcuts)
//
// The desktop shell's keyboard shortcuts, as pure rules and words (spec §3.4, §3.5): the one list (SHORTCUTS) that the
// "?" dialog, the tooltips and the tests all read; the guard, shortcutFor(), which turns a keydown and the page's state
// at that moment into a shortcut or nothing, in the spec's order; and the words the tooltips, the key feedback pill
// and the live region say. Free of React and of the app (Node checks it directly: keysModel.check.ts, `npm run
// check:shell`).
//
// What the guard never lets through: a key a component already handled (defaultPrevented), an IME composition, any
// key with Ctrl, Alt or ⌘ (the browser's own keys, and AltGr), a single key while the shortcuts are switched off (Esc
// still works), anything while a dialog, the tour or the safety statement is open, anything while a field is being
// typed in, Space on a focused control, arrows on a control that uses them, a held key's repeats (but the arrows'),
// Shift with a letter, and every other key: the media keys (MediaPlayPause, MediaTrackNext ...), the volume keys and
// the F-keys never reach a shortcut, and are never preventDefault-ed. Media keys reach the app through
// useMediaSession's action handlers only, as before.

export type ShortcutId =
  | 'playPause'
  | 'back5'
  | 'forward5'
  | 'back30'
  | 'forward30'
  | 'next'
  | 'prev'
  | 'musicOnly'
  | 'fullscreen'
  | 'search'
  | 'queue'
  | 'layers'
  | 'visuals'
  | 'escape'
  | 'menu' // v16.8.9: C, the side menu away or back
  | 'help';

/** What shortcutFor reads of a keydown (a KeyboardEvent has all of these). */
export interface KeyLike {
  key: string;
  keyCode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

/** The page's state at the time of the key (useDesktopKeys reads it from the DOM and the shell). */
export interface KeyContext {
  /** The switch in the "?" dialog is off (aetheria.keys.v1 = 'off'): single keys are inert, Esc still works. */
  off: boolean;
  /** A kit overlay (Dialog, modal Sheet, the tour), any aria-modal element, or the safety statement is open. */
  blocked: boolean;
  /** The focus (or the key's target) is a field being typed in. */
  typing: boolean;
  /** The key's target is a control that Space presses (a button, a link, a switch ...). */
  ownsSpace: boolean;
  /** The key's target uses the arrows itself (a slider, a list's row, a tablist, a radiogroup, any input ...). */
  ownsArrows: boolean;
  /** A panel shows (a sheet, or a section other than Now Playing): its own Escape closes it. */
  panelOpen: boolean;
  /** Zen's switch is on. */
  zenOn: boolean;
  /** The page is in element full screen. */
  fullscreen: boolean;
  /** v2's output question shows (it has its own Escape). */
  outputQuestion: boolean;
}

const LETTERS: Readonly<Record<string, ShortcutId>> = {
  k: 'playPause',
  n: 'next',
  p: 'prev',
  m: 'musicOnly',
  f: 'fullscreen',
  q: 'queue',
  l: 'layers',
  v: 'visuals',
  c: 'menu', // v16.8.9 (the user's choice of key, 2026-11-13)
};

/**
 * The shortcut a keydown asks for, or null (spec §3.5, in this order):
 *  1. a key a component handled (defaultPrevented);  2. an IME composition;  3. Ctrl, Alt or ⌘;
 *  4. the switch off (all but Esc);  5. a dialog, the tour or the safety statement;  6. typing in a field;
 *  7. Esc: only with nothing open (no panel, no output question), and only to leave full screen or Zen; never a repeat;
 *  8. the arrows (repeats allowed), unless the target uses them;  9. any other held key's repeats;
 * 10. Space, unless it presses the focused control (or with Shift);  11. ? and / (Shift allowed: layouts differ);
 * 12. the letters, without Shift (Caps Lock is fine);  13. anything else.
 */
export function shortcutFor(e: KeyLike, ctx: KeyContext): ShortcutId | null {
  if (e.defaultPrevented) return null; // 1
  if (e.isComposing || e.keyCode === 229) return null; // 2
  if (e.ctrlKey || e.metaKey || e.altKey) return null; // 3
  const key = typeof e.key === 'string' ? e.key : '';
  const escape = key === 'Escape' || key === 'Esc';
  if (ctx.off && !escape) return null; // 4
  if (ctx.blocked) return null; // 5
  if (ctx.typing) return null; // 6
  if (escape) {
    // 7 (a held Esc acts once: its repeats never reach past what the first one closed)
    if (e.repeat) return null;
    if (ctx.outputQuestion || ctx.panelOpen) return null;
    return ctx.fullscreen || ctx.zenOn ? 'escape' : null;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    // 8
    if (ctx.ownsArrows) return null;
    if (key === 'ArrowLeft') return e.shiftKey ? 'back30' : 'back5';
    return e.shiftKey ? 'forward30' : 'forward5';
  }
  if (e.repeat) return null; // 9
  if (key === ' ' || key === 'Spacebar') {
    // 10
    if (ctx.ownsSpace || e.shiftKey) return null;
    return 'playPause';
  }
  if (key === '?') return 'help'; // 11
  if (key === '/') return 'search';
  if (key.length === 1) {
    // 12
    if (e.shiftKey) return null;
    return LETTERS[key.toLowerCase()] ?? null;
  }
  return null; // 13
}

/** The seconds an arrow shortcut moves (the seek bar's own steps: ±5, and its Page keys' ±30). */
export function seekStep(id: ShortcutId): number | null {
  if (id === 'back5') return -5;
  if (id === 'forward5') return 5;
  if (id === 'back30') return -30;
  if (id === 'forward30') return 30;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The list (the "?" dialog's rows, the tooltips' keycaps and the tests: one source)
// ---------------------------------------------------------------------------------------------------------------

/** A row of the "?" dialog: what it does and its keys, each key a list of keycaps pressed together. */
export interface ShortcutRow {
  id: string;
  label: string;
  keys: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ShortcutGroup {
  title: string;
  rows: ReadonlyArray<ShortcutRow>;
}

export const SHORTCUTS: ReadonlyArray<ShortcutGroup> = [
  {
    title: 'Playback',
    rows: [
      { id: 'playPause', label: 'Play or pause', keys: [['Space'], ['K']] },
      { id: 'seek5', label: 'Back or forward 5 s', keys: [['←'], ['→']] },
      { id: 'seek30', label: 'Back or forward 30 s', keys: [['Shift', '←/→']] },
      { id: 'next', label: 'Next track', keys: [['N']] },
      { id: 'prev', label: 'Previous track', keys: [['P']] },
      { id: 'musicOnly', label: 'Music only: the layers off or on', keys: [['M']] },
    ],
  },
  {
    title: 'Panels',
    rows: [
      { id: 'search', label: 'Search the library', keys: [['/']] },
      { id: 'queue', label: 'Up next', keys: [['Q']] },
      { id: 'layers', label: 'Layers', keys: [['L']] },
      { id: 'visuals', label: 'Visuals', keys: [['V']] },
    ],
  },
  {
    title: 'View',
    rows: [
      { id: 'fullscreen', label: 'Full screen', keys: [['F']] },
      { id: 'escape', label: 'Close the panel; leave full screen or Zen', keys: [['Esc']] },
      { id: 'menu', label: 'Show or hide the menu', keys: [['C']] }, // v16.8.9
      { id: 'help', label: 'This list', keys: [['?']] },
    ],
  },
];

/** The dialog's line under its title. */
export const SHORTCUTS_INTRO = "They work whenever you are not typing in a field. Your keyboard's play, pause and track keys keep working as usual.";
export const SHORTCUTS_TITLE = 'Keyboard shortcuts';
/** The switch (WCAG 2.1.4: single-key shortcuts can be turned off). */
export const SHORTCUTS_SWITCH_LABEL = 'Keyboard shortcuts';
export const SHORTCUTS_SWITCH_LINE = 'Single-key shortcuts. Esc always works.';
/** The ⋯ menu's row (desktop only). */
export const SHORTCUTS_MENU_SUBTITLE = 'Every key, in one list';

/** The saved switch: 'off', or absent (on). Written from the switch's tap only. */
export const KEYS_KEY = 'aetheria.keys.v1';

export function parseKeysOn(raw: string | null | undefined): boolean {
  return raw !== 'off';
}

// ---------------------------------------------------------------------------------------------------------------
// The tooltips' keys (the visible keycaps, the screen reader's description and aria-keyshortcuts)
// ---------------------------------------------------------------------------------------------------------------

export type TipKeyId = 'playPause' | 'next' | 'prev' | 'queue' | 'fullscreen' | 'layers' | 'menu' | 'help';

export interface TipKeys {
  /** The keycaps the bubble shows ("or" between them). */
  caps: ReadonlyArray<string>;
  /** aria-keyshortcuts: ARIA's key names, space-separated alternatives. */
  aria: string;
  /** The control's aria-describedby text ("Shortcut: Space or K"); its name stays its own aria-label. */
  description: string;
}

const TIP_CAPS: Readonly<Record<TipKeyId, ReadonlyArray<string>>> = {
  playPause: ['Space', 'K'],
  next: ['N'],
  prev: ['P'],
  queue: ['Q'],
  fullscreen: ['F'],
  layers: ['L'],
  menu: ['C'], // v16.8.9: both logo buttons
  help: ['?'],
};

/** "Shortcut: Space or K". */
export function describeKeys(caps: ReadonlyArray<string>): string {
  return caps.length ? `Shortcut: ${caps.join(' or ')}` : '';
}

/** aria-keyshortcuts for a list of keycaps ("Space K"; "?"). */
export function ariaKeyshortcuts(caps: ReadonlyArray<string>): string {
  return caps.join(' ');
}

export function tipKeys(id: TipKeyId): TipKeys {
  const caps = TIP_CAPS[id];
  return { caps, aria: ariaKeyshortcuts(caps), description: describeKeys(caps) };
}

// ---------------------------------------------------------------------------------------------------------------
// Key feedback (decision 6 B: a 1.2 s pill over the visuals; a polite live line for M, Space and F)
// ---------------------------------------------------------------------------------------------------------------

export type FeedbackKind =
  | 'play'
  | 'pause'
  | 'back5'
  | 'forward5'
  | 'back30'
  | 'forward30'
  | 'next'
  | 'prev'
  | 'musicOnlyOn'
  | 'musicOnlyOff'
  | 'fullscreenOn'
  | 'fullscreenOff'
  | 'fullscreenFailed'
  // v16.8.9: C. Read only (no pill: the menu itself shows the change).
  | 'menuAway'
  | 'menuShown';

/** v16.8.9: what C's live line says. */
export const MENU_AWAY_LIVE = 'Menu hidden. Press C or the logo to bring it back.';
export const MENU_SHOWN_LIVE = 'Menu shown.';

/** F where the browser refuses full screen (an iframe, a policy): the pill and the live line say the same. */
export const FULLSCREEN_FAILED = "Full screen isn't available in this window: Zen hides the controls instead.";

/** How long the pill shows. */
export const FEEDBACK_MS = 1200;

/** The pill's text (null: no pill; F shows full screen itself). */
export function feedbackText(kind: FeedbackKind): string | null {
  switch (kind) {
    case 'play':
      return 'Play';
    case 'pause':
      return 'Pause';
    case 'back5':
      return '−5 s';
    case 'forward5':
      return '+5 s';
    case 'back30':
      return '−30 s';
    case 'forward30':
      return '+30 s';
    case 'next':
      return 'Next';
    case 'prev':
      return 'Previous';
    case 'musicOnlyOn':
      return 'Music only: layers off';
    case 'musicOnlyOff':
      return 'Layers on';
    case 'fullscreenFailed':
      return FULLSCREEN_FAILED;
    default:
      return null;
  }
}

/** The live region's line (null: nothing is announced; it never changes on a time tick). */
export function feedbackLive(kind: FeedbackKind): string | null {
  switch (kind) {
    case 'play':
      return 'Playing.';
    case 'pause':
      return 'Paused.';
    case 'musicOnlyOn':
      return 'Music only on: the tone, beat and drone are off.';
    case 'musicOnlyOff':
      return 'Music only off: the layers are back.';
    case 'fullscreenOn':
      return 'Full screen. Move the mouse for the controls; Esc leaves.';
    case 'fullscreenOff':
      return 'Left full screen.';
    case 'fullscreenFailed':
      return FULLSCREEN_FAILED;
    case 'menuAway':
      return MENU_AWAY_LIVE;
    case 'menuShown':
      return MENU_SHOWN_LIVE;
    default:
      return null;
  }
}

/** The pill's feedback for a shortcut, from the state read BEFORE its action (null: none). */
export function feedbackFor(id: ShortcutId, before: { isPlaying: boolean; musicOnly: boolean }): FeedbackKind | null {
  switch (id) {
    case 'playPause':
      return before.isPlaying ? 'pause' : 'play';
    case 'back5':
    case 'forward5':
    case 'back30':
    case 'forward30':
    case 'next':
    case 'prev':
      return id;
    case 'musicOnly':
      return before.musicOnly ? 'musicOnlyOff' : 'musicOnlyOn';
    default:
      return null;
  }
}

/** The full-screen button's name and its tooltip's label. */
export const FULLSCREEN_LABEL = 'Full screen';
export function fullscreenTip(full: boolean): string {
  return full ? 'Exit full screen' : 'Full screen';
}
