// components/shell/useShellZen.ts (v15.6, Zen in the new layout)
//
// Classic's Zen effect (App.tsx, "Handle Zen Mode Mouse tracking"), re-written for the new layout's shell, which App
// calls with zenModel's zenActive(): while `active`, the controls hide 3 s after the last activity. While they show, a
// pointerdown, a key or a focus move (capture phase) keeps them for 3 s more, and they never hide while a pointer
// pressed then is still down (a long seek-bar drag). A MOUSE moving brings them back (a touch never does: the hidden
// shell is inert, and the reveal surface waits for the click, spec §2.5 probes B and C). TalkBack's swipe navigation
// is left as classic's Zen has it: "Show controls" is its way back. It
// never hides while a text-like field inside the shell has the focus (classic's editingInUi, scoped to the shell's
// root) or while a kit Dialog is open (overlayDepth). No listener at all while inactive.
// Returns whether the controls are hidden now, and the reveal (the surface's click, "Show controls").

import { useCallback, useEffect, useRef, useState } from 'react';
import { overlayDepth } from '../ui/overlayStack';
import { ZEN_HIDE_MS, ZEN_NON_TEXT_INPUTS } from './zenModel';

export function useShellZen({ active, rootRef }: { active: boolean; rootRef: { current: HTMLElement | null } }): { hidden: boolean; reveal: () => void } {
  const [shown, setShown] = useState(true);
  const shownRef: { current: boolean } = useRef(true);
  const revealRef: { current: () => void } = useRef(() => {});

  useEffect(() => {
    if (!active) {
      shownRef.current = true;
      setShown(true);
      return;
    }
    let timer: number | null = null;

    // Never hide (and so make inert) the shell under a field someone is typing in: it would lose its focus, and a
    // phone its keyboard.
    const editingInShell = (): boolean => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !rootRef.current?.contains(el)) return false;
      if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
      return el instanceof HTMLInputElement && !ZEN_NON_TEXT_INPUTS.has(el.type);
    };

    // Pointers pressed while the controls show (a finger dragging the seek bar past 3 s, say): never hide under one.
    // Its release re-arms the 3 s. An entry older than 30 s is dropped (a release the page never saw).
    const pressed = new Map<number, number>();
    const pressedNow = (): boolean => {
      const now = performance.now();
      for (const [id, at] of pressed) if (now - at > 30000) pressed.delete(id);
      return pressed.size > 0;
    };

    const show = (): void => {
      shownRef.current = true;
      setShown(true);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (editingInShell() || overlayDepth() > 0 || pressedNow()) {
          show();
          return;
        }
        shownRef.current = false;
        setShown(false);
      }, ZEN_HIDE_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') show();
    };
    const onShownActivity = () => {
      if (shownRef.current) show();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!shownRef.current) return;
      pressed.set(e.pointerId, performance.now());
      show();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressed.delete(e.pointerId) && shownRef.current) show();
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('keydown', onShownActivity, true);
    document.addEventListener('focusin', onShownActivity);
    revealRef.current = show;
    // Shown when it starts (or resumes after a sheet, a tab or the output question), hidden 3 s later.
    show();

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('keydown', onShownActivity, true);
      document.removeEventListener('focusin', onShownActivity);
      revealRef.current = () => {};
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active]);

  const reveal = useCallback(() => revealRef.current(), []);
  return { hidden: active && !shown, reveal };
}
