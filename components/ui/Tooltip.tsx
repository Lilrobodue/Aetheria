// components/ui/Tooltip.tsx (v16.7 UI kit; decision 5 A: dark and raised, with keycaps)
//
// A tooltip for one control: its name and, where it has one, its keyboard shortcut as keycaps ("Pause  Space or K").
// It wraps the control in a `relative` span; its bubble is rendered only while shown.
//   - Shown after 500 ms of MOUSE hover (at once within 300 ms of another tooltip hiding, so scanning a row of buttons
//     reads each one), and at once when the control takes keyboard focus (:focus-visible). Never for a touch: a touch
//     pointer is ignored, and a tap's focus is not :focus-visible (tablets that get the desktop shell).
//   - Hidden on leaving (after a 100 ms grace that re-entering cancels, so the pointer can cross the 8 px gap onto the
//     bubble: WCAG 1.4.13 "hoverable"), on a press, on blur, on Escape (a capture-phase listener that exists only while
//     the bubble shows; it stops that Escape, so the next one does what it did before: "dismissible"), and when the
//     caller says so (hideTooltips(): the desktop shell as Zen hides it).
//   - The bubble is aria-hidden: the control's own aria-label is its name. The keys reach assistive tech through
//     aria-describedby (an always-present hidden "Shortcut: Space or K") and aria-keyshortcuts, both set only when the
//     caller passes `keys` (the shortcuts on).
//   - `hideFrom="xl"`: no bubble from 1280 px, where the control shows its name (and key) itself; such a bubble is never
//     shown there, so it can never take an Escape.
// v16.7 review: the bubble is drawn in a portal on <body>, above the notices stack (z 80 over its 70; under every dialog,
// 150), placed from ONE measure of the control when it shows (`side`: above, above-left, above-right or to the right).
// No rAF, no listener while idle (while shown, a resize re-measures it). Under a modal (#root inert, the bubble behind its scrim) Escape is the modal's.

import React, { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Kbd from './Kbd';

export interface TooltipKeys {
  /** The keycaps ("or" between them). */
  caps: ReadonlyArray<string>;
  /** aria-keyshortcuts ("Space K"). */
  aria: string;
  /** aria-describedby's text ("Shortcut: Space or K"). */
  description: string;
}

export type TooltipSide = 'top' | 'top-start' | 'top-end' | 'right';

interface TooltipProps {
  label: string;
  keys?: TooltipKeys | null;
  side?: TooltipSide;
  /** 'xl': no bubble from 1280 px (where the name is visible). */
  hideFrom?: 'xl';
  /** The wrapper's classes (complete literals); default 'relative inline-flex shrink-0'. */
  wrapClassName?: string;
  'data-testid'?: string;
  /** React's own (no @types/react here, so it is declared for tsc). */
  key?: string;
  /** The one control. */
  children: any;
}

const SHOW_MS = 500;
const WARM_MS = 300;
const GRACE_MS = 100;
const GAP = 8;

// Fixed, in the portal: the side picks the anchor point (set inline from the measure) and how the bubble hangs off it.
const BUBBLE: Record<TooltipSide, string> = {
  top: 'fixed -translate-x-1/2 -translate-y-full z-[80] whitespace-nowrap rounded-control bg-surface-raised border border-line-strong shadow-overlay px-2.5 py-1.5 text-xs text-ink-strong flex items-center gap-2',
  'top-start': 'fixed -translate-y-full z-[80] whitespace-nowrap rounded-control bg-surface-raised border border-line-strong shadow-overlay px-2.5 py-1.5 text-xs text-ink-strong flex items-center gap-2',
  'top-end': 'fixed -translate-x-full -translate-y-full z-[80] whitespace-nowrap rounded-control bg-surface-raised border border-line-strong shadow-overlay px-2.5 py-1.5 text-xs text-ink-strong flex items-center gap-2',
  right: 'fixed -translate-y-1/2 z-[80] whitespace-nowrap rounded-control bg-surface-raised border border-line-strong shadow-overlay px-2.5 py-1.5 text-xs text-ink-strong flex items-center gap-2',
};
const HIDE_XL = ' xl:hidden';

// When the last bubble hid (the warm rule), and every shown bubble's hide (hideTooltips).
let lastHideAt = -Infinity;
const shownHiders = new Set<() => void>();

/** Hide every tooltip now (the desktop shell, as Zen makes it inert). */
export function hideTooltips(): void {
  for (const hide of Array.from(shownHiders)) hide();
}

const wideScreen = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1280px)').matches;

/** Where the bubble hangs from, for a control's box (viewport px). */
function anchorFor(side: TooltipSide, r: { left: number; right: number; top: number; bottom: number; width: number; height: number }): { left: number; top: number } {
  if (side === 'right') return { left: r.right + GAP, top: r.top + r.height / 2 };
  if (side === 'top-start') return { left: r.left, top: r.top - GAP };
  if (side === 'top-end') return { left: r.right, top: r.top - GAP };
  return { left: r.left + r.width / 2, top: r.top - GAP };
}

const Tooltip = ({ label, keys, side = 'top', hideFrom, wrapClassName = 'relative inline-flex shrink-0', 'data-testid': testId, children }: TooltipProps) => {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const shownRef: { current: boolean } = useRef(false);
  const showTimer: { current: ReturnType<typeof setTimeout> | null } = useRef(null);
  const hideTimer: { current: ReturnType<typeof setTimeout> | null } = useRef(null);
  const descId = useId();
  const wrapRef: { current: HTMLSpanElement | null } = useRef(null);

  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  };
  const show = () => {
    clearTimers();
    // A bubble hidden at this width (hideFrom) is never shown: an invisible one would still take the next Escape.
    if (hideFrom === 'xl' && wideScreen()) return;
    const el = wrapRef.current;
    if (!el) return;
    shownRef.current = true;
    setAt(anchorFor(side, el.getBoundingClientRect()));
  };
  const hide = () => {
    clearTimers();
    if (shownRef.current) lastHideAt = performance.now();
    shownRef.current = false;
    setAt(null);
  };
  const hideRef: { current: () => void } = useRef(hide);
  hideRef.current = hide;
  const shown = at !== null;

  useEffect(() => () => clearTimers(), []);

  // While shown only: Escape hides it (and stops there), and hideTooltips() reaches it.
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      // Under a modal (its root inert, the bubble behind its scrim), or where this bubble can't show (hideFrom, after a
      // resize), the Escape belongs to what is on screen: hide, and let it pass.
      const behind = !!wrapRef.current?.closest('[inert]');
      const invisible = hideFrom === 'xl' && wideScreen();
      if (!behind && !invisible) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      hideRef.current();
    };
    const hider = () => hideRef.current();
    // The window resized (full screen, a narrower window): the bubble follows its control.
    const onResize = () => {
      const el = wrapRef.current;
      if (el && shownRef.current) setAt(anchorFor(side, el.getBoundingClientRect()));
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    shownHiders.add(hider);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      shownHiders.delete(hider);
    };
  }, [shown]);

  const enter = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (shownRef.current || showTimer.current) return;
    if (performance.now() - lastHideAt < WARM_MS) {
      show();
      return;
    }
    showTimer.current = setTimeout(show, SHOW_MS);
  };
  const leave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (shownRef.current && !hideTimer.current) hideTimer.current = setTimeout(hide, GRACE_MS);
  };
  const onFocus = (e: FocusEvent) => {
    const el = e.target as HTMLElement | null;
    let visible = false;
    try {
      visible = !!el && el.matches(':focus-visible');
    } catch {}
    if (visible) show();
  };

  const control = keys
    ? cloneElement(children, { 'aria-describedby': descId, 'aria-keyshortcuts': keys.aria })
    : children;

  return (
    <span
      ref={wrapRef}
      className={wrapClassName}
      data-testid={testId}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onPointerDown={hide}
      onFocus={onFocus}
      onBlur={hide}
    >
      {control}
      {keys ? (
        <span id={descId} hidden>
          {keys.description}
        </span>
      ) : null}
      {at
        ? createPortal(
            <span
              aria-hidden="true"
              data-tooltip=""
              className={`${BUBBLE[side]}${hideFrom === 'xl' ? HIDE_XL : ''}`}
              style={{ left: at.left, top: at.top }}
              onPointerEnter={enter}
              onPointerLeave={leave}
            >
              {label}
              {keys && keys.caps.length ? (
                <span className="flex items-center gap-1">
                  {keys.caps.map((cap, i) => (
                    <React.Fragment key={cap}>
                      {i > 0 ? <span className="text-ink-muted">or</span> : null}
                      <Kbd>{cap}</Kbd>
                    </React.Fragment>
                  ))}
                </span>
              ) : null}
            </span>,
            document.body
          )
        : null}
    </span>
  );
};

export default Tooltip;
