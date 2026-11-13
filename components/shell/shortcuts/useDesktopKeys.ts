// components/shell/shortcuts/useDesktopKeys.ts (v16.7, desktop polish: the keyboard shortcuts)
//
// The desktop shell's one keydown listener: on `document`, in the bubble phase, added once (useEffect([])). It runs
// after React's root listener, so a component that handled a key (the seek bar's arrows, a list's rows, a sortable
// handle, a radiogroup, the search field's Escape: they all preventDefault) is seen as such and left alone, and after
// Zen's capture-phase "a key keeps the controls shown" listener (this one never stops propagation).
// At the time of the key it reads the page (overlayDepth, any aria-modal, the safety statement, the focused element,
// full screen, v2's output question) and the shell (through refs: no render for a key), asks keysModel.shortcutFor,
// and calls the SAME action the visible control calls:
//   Space/K  actions.playPause (handlePlayPause, the Play button)     ←/→  actions.seekBy(∓5), Shift ∓30 (the seek bar)
//   N / P    actions.next / actions.prev (the transport's buttons)    M    actions.toggleMusicOnly (Music only: the
//   F        toggleImmersive (the Full screen button)                       layers; the music is never touched)
//   /        Library › Tracks, the search field focused              Q    actions.toggleQueue (Up next)
//   L        Layers, or back to Now Playing                           V    actions.openVisuals / closeSheet (Visuals)
//   Esc      leave full screen, else Zen (nothing open)               ?    the shortcuts dialog
// A handled key is preventDefault-ed (Space doesn't scroll, Firefox's "/" Quick Find doesn't open); every other key,
// the media keys among them, is left exactly as it was. Dev builds keep a count in window.__aetheriaKeys.
// v16.7 review (decision 10): a control keeps Space and the arrows only when the keyboard put the focus there
// (review round 2: a focus counts as the mouse's only when a pointerdown landed on that element, or inside it, at most
// 1 s before; capture-phase pointerdown and focusin listeners record it). Library rows and their ⋯ keep both arrows.
// Space with nothing to play (no track, the player's play order empty) does nothing and presses nothing (prevented); with
// a play order and nothing loaded it is the Play button's, pill included (round 3: the player's own count, as Play's). After a mouse click on a button or a slider, Space plays or pauses and ←/→ seek, preventDefault-ed,
// so no Space-click and no slider step happen (after dragging the volume, the arrows seek; they never change the
// volume). A component that handles a key in its own handler (the seek bar, a list's rows, a radiogroup, a tablist, a
// sortable handle) runs first and keeps it (rule 1). Decision 7: "/" always focuses the Library's search; it never
// closes the panel. A held → at a track's end does what the seek bar's own → does there (seekBy clamps to the end).
// v16.8.9 (the side menu away; the user's decisions, 2026-11-13): C hides or shows the menu (navStore), announced on the
// live line only; the focus inside the hiding menu moves to the floating logo. While the menu is away, L, / and ? (the
// keys whose place is in the menu: Layers, Library, Shortcuts) slide it back out first, then do as before; Q and V open
// their panels with the menu still away.

import { useEffect } from 'react';
import { overlayDepth } from '../../ui/overlayStack';
import { ZEN_NON_TEXT_INPUTS } from '../zenModel';
import { requestLibrarySearch } from '../library/libraryModel';
import { SIDE_NAV_ID, focusNavToggle, navAway, setNavAway, showNavNow } from '../navStore';
import type { ShellActions, LibraryViewState } from '../contexts';
import type { ShellSheet, ShellTab } from '../shellModel';
import { feedbackFor, seekStep, shortcutFor } from './keysModel';
import type { KeyContext, ShortcutId } from './keysModel';
import { showKeyFeedback } from './feedback';
import { leaveImmersive, toggleImmersive } from './immersive';
import { keysOn } from './shortcutsStore';

const IS_DEV_BUILD = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

/** Space presses these when the KEYBOARD gave them the focus (never Play behind them). */
const SPACE_OWNERS =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="slider"]';
/** These use the arrows themselves when the keyboard gave them the focus (backing up rule 1 for native controls). */
const ARROW_OWNERS =
  '[role="slider"], [role="radiogroup"], [role="radio"], [role="tablist"], [role="tab"], [role="listbox"], [role="menu"], [role="grid"], [role="tree"], [role="treegrid"], [data-row-index], [data-row-menu]';

/** What the listener reads of the shell at the time of a key (DesktopKeys keeps it current). */
export interface KeysState {
  tab: ShellTab;
  sheet: ShellSheet | null;
  zenOn: boolean;
  isPlaying: boolean;
  hasTrack: boolean;
  musicOnly: boolean;
  /** The player's own play order length (usePlayer().count = App's playlist.length, what Play starts from). */
  playerCount: number;
}

function typingIn(el: unknown): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !ZEN_NON_TEXT_INPUTS.has(el.type);
}

/** Modal surfaces that are not kit overlays: the safety statement (App's fixed gate, mounted over the new layout on
 *  first launch) and the Journal's start and end forms (classic's ExperienceTracker, moved verbatim into More › Journal:
 *  full-screen fixed panels with no aria-modal). Keys never act behind them. */
const NON_KIT_MODALS = '[data-testid="disclaimer"], [data-testid="more-journal"] .fixed.inset-0';

/** How the focus arrived at an element (decision 10, review rounds 2 and 3): by the pointer, or any other way (Tab, a
 *  script's focus with no click, a screen reader moving the real focus). The pointer's when
 *   - a pointerdown landed on the element, inside it, or on one of its labels (a RadioList row is a <label> around a
 *     hidden radio) at most 1 s before; or
 *   - the focus moved while a pointer interaction was still under way (from its pointerdown until just after its
 *     click): the app restoring the focus as a close button is clicked (a panel gives it back to its opener).
 *  A Tab clears both (Tab away and Shift+Tab back is the keyboard's). Only a pointer's arrival gives Space and the
 *  arrows to the shortcuts. */
export interface FocusArrival {
  el: Element | null;
  byPointer: boolean;
}

/** A pointerdown counts for the focus that lands on (or around) its target within this long; a pointer interaction
 *  never lasts longer than this either (a native <select>'s popup may swallow its pointerup). */
export const POINTER_FOCUS_MS = 1000;
/** After a pointerup with no click yet (a touch's click is built a task or more after touchend), the interaction still
 *  waits this long for its click. */
export const CLICK_WAIT_MS = 400;

/** Library rows and their ⋯ always keep both arrows (row ↔ ⋯, review round 2), however the focus got there. */
const ROW_ARROWS = '[data-row-index], [data-row-menu]';

/** The page's state for shortcutFor (spec §3.5). */
export function keyContext(e: KeyboardEvent, s: KeysState, arrival?: FocusArrival | null): KeyContext {
  const target = e.target instanceof Element ? e.target : null;
  // Decision 10: only a control the pointer did NOT just press keeps Space and the arrows (after a click the shortcuts
  // win); a focus that arrived any other way is the keyboard's (or assistive tech's).
  const keyboardFocus = !(arrival && arrival.el === target && arrival.byPointer);
  return {
    off: !keysOn(),
    blocked: overlayDepth() > 0 || !!document.querySelector('[aria-modal="true"]') || !!document.querySelector(NON_KIT_MODALS),
    typing: typingIn(document.activeElement) || typingIn(target),
    ownsSpace: keyboardFocus && !!target && target.matches(SPACE_OWNERS),
    ownsArrows:
      !!target &&
      (!!target.closest(ROW_ARROWS) ||
        (keyboardFocus &&
          (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || !!target.closest(ARROW_OWNERS)))),
    panelOpen: s.sheet !== null || s.tab !== 'now',
    zenOn: s.zenOn,
    fullscreen: !!document.fullscreenElement,
    outputQuestion: !!document.querySelector('[data-testid="output-sheet"]'),
  };
}

/** Where L was pressed to open Layers (DesktopKeys clears it once Layers is left another way). */
export type OpenedFrom = { id: 'layers'; el: Element | null } | null;

interface Options {
  actions: ShellActions;
  openedFromRef: { current: OpenedFrom };
  stateRef: { current: KeysState };
  libraryViewRef: { current: LibraryViewState };
  openHelp: () => void;
}

export function useDesktopKeys({ actions, openedFromRef, stateRef, libraryViewRef, openHelp }: Options): void {
  useEffect(() => {
    const dev = IS_DEV_BUILD ? { handled: 0, last: null as ShortcutId | null } : null;
    const w = window as unknown as { __aetheriaKeys?: unknown };
    if (dev) w.__aetheriaKeys = dev;
    // L opens Layers in the panel; L again closes it and gives the focus back to where it was.
    const closeSection = (id: 'layers') => {
      const from = openedFromRef.current;
      const back = from && from.id === id ? from.el : null;
      openedFromRef.current = null;
      if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus();
      actions.setTab('now');
    };

    // How the focus arrived (decision 10): a pointer press on (or inside) the element just before it, or not.
    let lastDown: { target: Node | null; at: number } | null = null;
    let arrival: FocusArrival | null = null;
    // A pointer interaction under way: from its pointerdown until a task after its click has run (review round 5: a
    // capture-phase click ends it, so a touch's late click still belongs to it), with a fallback CLICK_WAIT_MS after a
    // pointerup that no click follows, and never longer than POINTER_FOCUS_MS from its pointerdown.
    let interacting = false;
    let interactionEnd: ReturnType<typeof setTimeout> | null = null;
    const endInteraction = (afterMs: number) => {
      if (interactionEnd) clearTimeout(interactionEnd);
      interactionEnd = setTimeout(() => {
        interacting = false;
        interactionEnd = null;
      }, afterMs);
    };
    const interactingNow = (): boolean => interacting && !!lastDown && performance.now() - lastDown.at <= POINTER_FOCUS_MS;
    const onPointerDown = (e: PointerEvent) => {
      lastDown = { target: e.target instanceof Node ? e.target : null, at: performance.now() };
      interacting = true;
      if (interactionEnd) clearTimeout(interactionEnd);
      interactionEnd = null;
    };
    const onPointerUp = () => endInteraction(CLICK_WAIT_MS);
    const onPointerCancel = () => endInteraction(0);
    const onClick = () => endInteraction(0);
    /** The pointerdown's target is the element, inside it, or inside one of its labels. */
    const pressedOn = (el: Element, target: Node): boolean => {
      if (target === el || el.contains(target)) return true;
      const labels = (el as HTMLInputElement).labels;
      if (labels) for (const l of Array.from(labels)) if (l.contains(target)) return true;
      return false;
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const d = lastDown;
      const byPointer = !!el && (interactingNow() || (!!d && !!d.target && performance.now() - d.at <= POINTER_FOCUS_MS && pressedOn(el, d.target)));
      arrival = { el, byPointer };
    };
    // A Tab moves the focus by the keyboard: whatever a pointer did before no longer counts. (Window, capture: before the
    // overlay stack's own Tab handling moves the focus.)
    const onTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      lastDown = null;
      interacting = false;
      arrival = null;
    };
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const id = shortcutFor(e, keyContext(e, s, arrival));
      if (!id) return;
      e.preventDefault();
      // Nothing to play (no track loaded, an empty play order): Space does nothing at all, and, prevented, it presses no
      // focused button either (Play would only start the silent anchor). Not counted, no pill.
      if (id === 'playPause' && !s.hasTrack && s.playerCount === 0) return;
      if (dev) {
        dev.handled++;
        dev.last = id;
      }
      const step = seekStep(id);
      if (step !== null) {
        actions.seekBy(step);
        if (s.hasTrack) showKeyFeedback(feedbackFor(id, s)!);
        return;
      }
      switch (id) {
        case 'playPause':
          // Review round 2: what the Play button does, and its pill, whenever there is something to play (a track
          // loaded, or a play order to start); with nothing at all it returned above, after preventDefault.
          actions.playPause();
          showKeyFeedback(feedbackFor(id, s)!);
          return;
        case 'next':
          actions.next();
          if (s.hasTrack) showKeyFeedback('next');
          return;
        case 'prev':
          actions.prev();
          if (s.hasTrack) showKeyFeedback('prev');
          return;
        case 'musicOnly':
          actions.toggleMusicOnly();
          showKeyFeedback(feedbackFor(id, s)!);
          return;
        case 'fullscreen':
          toggleImmersive(actions, s.zenOn);
          return;
        case 'queue':
          actions.toggleQueue();
          return;
        case 'visuals':
          if (s.sheet === 'visuals') actions.closeSheet();
          else actions.openVisuals();
          return;
        case 'menu': {
          if (navAway()) {
            // Review round 1: shown at once; the focus on the floating logo moves to the menu's logo.
            showNavNow();
            showKeyFeedback('menuShown');
            return;
          }
          const nav = document.getElementById(SIDE_NAV_ID);
          const focusInNav = !!nav && !!document.activeElement && nav.contains(document.activeElement);
          setNavAway(true);
          if (focusInNav) focusNavToggle('show');
          showKeyFeedback('menuAway');
          return;
        }
        case 'layers':
          if (navAway()) {
            // v16.8.9: the menu slides out to Layers (shown at once, so Layers records a live opener). Review round 1:
            // Layers already open stays open: L brings the menu out to it, it doesn't close it.
            showNavNow();
            if (s.tab === 'layers' && s.sheet === null) return;
          }
          if (s.tab === 'layers' && s.sheet === null) closeSection('layers');
          else {
            if (s.tab !== 'layers') openedFromRef.current = { id: 'layers', el: document.activeElement };
            actions.setTab('layers');
          }
          return;
        case 'search': {
          if (navAway()) showNavNow(); // v16.8.9: the menu slides out to Library
          // Decision 7: always to the search field (Library › Tracks, opened if needed); never a close.
          requestLibrarySearch(libraryViewRef);
          actions.openPlaylist(null); // a playlist's view gives way to Tracks (a no-op with none open)
          actions.setTab('library');
          return;
        }
        case 'escape':
          if (document.fullscreenElement) leaveImmersive();
          else actions.setZen(false);
          return;
        case 'help':
          if (navAway()) showNavNow(); // v16.8.9: the menu slides out to Shortcuts (the dialog returns the focus there)
          openHelp();
          return;
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onTabKey, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onTabKey, true);
      if (interactionEnd) clearTimeout(interactionEnd);
      if (dev && w.__aetheriaKeys === dev) delete w.__aetheriaKeys;
    };
  }, []);
}
