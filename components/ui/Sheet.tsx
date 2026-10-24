// components/ui/Sheet.tsx (v15.5 UI kit)
//
// The new layout's sheets (Sound, Crystal, Walks and the ⋯ menu), in two presentations:
//   sheet  modal, for the phone shell: a bottom sheet (centred from 640 px wide) in a portal on <body>, over a
//          bg-black/60 scrim that closes it. v15.4's overlay stack (useOverlay) gives it the focus trap, Escape, focus
//          return to what opened it, and #root inert meanwhile. Rendered only while open.
//   panel  non-modal, for the desktop shell: rendered in place (the shell's 420 px panel slot), no portal, scrim, trap
//          or inert, so the transport stays usable. Escape closes it through a bubble-phase `document` listener, added
//          only while open; the overlay stack's capture-phase listener answers first whenever a kit modal is open
//          ("one Escape, one overlay"), and v15.0's output question keeps its own Escape while it shows.
// No animation (no enter slide, nothing infinite: I13). The header is an h2, a one-line subtitle and Close; `headerless`
// keeps the h2 for the name but shows only the handle (the menu).

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import IconButton from './IconButton';
import { overlayDepth, useOverlay } from './overlayStack';

interface SheetProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  presentation?: 'sheet' | 'panel';
  /** Where focus goes on open (default: the panel itself for a sheet, the heading for a panel). */
  initialFocusRef?: { current: HTMLElement | null };
  /** No visible header (the h2 stays, for screen readers): the menu. */
  headerless?: boolean;
  /** The scrolling body, for a caller that scrolls a group into view. */
  bodyRef?: { current: HTMLDivElement | null };
  'data-testid'?: string;
}

let sheetCount = 0;

const Sheet = ({
  open,
  title,
  subtitle,
  onClose,
  children,
  presentation = 'sheet',
  initialFocusRef,
  headerless = false,
  bodyRef,
  'data-testid': testId,
}: SheetProps) => {
  const modal = presentation === 'sheet';
  const panelRef: { current: HTMLDivElement | null } = useRef(null);
  const headingRef: { current: HTMLHeadingElement | null } = useRef(null);
  const idRef: { current: number } = useRef(0);
  if (!idRef.current) idRef.current = ++sheetCount;
  const titleId = `ae-sheet-${idRef.current}-title`;
  const closeRef: { current: () => void } = useRef(onClose);
  closeRef.current = onClose;

  // Modal: the overlay stack (trap, Escape, focus return, #root inert).
  useOverlay(open && modal, panelRef, onClose);

  // Panel: Escape from the page, unless a kit modal or the output question holds it.
  useEffect(() => {
    if (!open || modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (overlayDepth() > 0 || document.querySelector('[data-testid="output-sheet"]')) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, modal]);

  // Panel: focus moves in on open and back to what opened it on close (the stack does this for a modal), but only
  // when the focus was still the panel's: when another control took it (a panel opened in this one's place, say),
  // that control keeps it, and the next panel returns there.
  useLayoutEffect(() => {
    if (!open || modal) return;
    const opener = document.activeElement;
    const panel = panelRef.current;
    (initialFocusRef?.current ?? headingRef.current)?.focus();
    return () => {
      const active = document.activeElement;
      const focusWasHere = !active || active === document.body || !active.isConnected || (!!panel && panel.contains(active));
      if (focusWasHere && opener instanceof HTMLElement && opener.isConnected && opener !== document.body) opener.focus();
    };
  }, [open, modal]);

  // Modal: the first focus, after the stack has saved what had it.
  useEffect(() => {
    if (!open || !modal) return;
    (initialFocusRef?.current ?? panelRef.current)?.focus();
  }, [open, modal]);

  if (!open) return null;

  const header = headerless ? (
    <h2 id={titleId} ref={headingRef} tabIndex={-1} className="sr-only">
      {title}
    </h2>
  ) : (
    <div className={modal ? 'shrink-0 px-4 pt-2 pb-2 flex items-start justify-between gap-3' : 'shrink-0 px-5 pt-4 pb-3 flex items-start justify-between gap-3 border-b border-line'}>
      <div className="min-w-0">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-ink-strong outline-none">
          {title}
        </h2>
        {subtitle ? <p className="text-xs text-ink-muted">{subtitle}</p> : null}
      </div>
      <IconButton label={modal ? 'Close' : 'Close panel'} icon={<X size={22} />} onClick={onClose} className="-mr-2 shrink-0" />
    </div>
  );

  if (!modal) {
    return (
      <aside
        ref={panelRef}
        role="region"
        aria-labelledby={titleId}
        data-testid={testId}
        className="h-full flex flex-col bg-surface-panel border-r border-line-strong"
      >
        {header}
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </aside>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-end sm:items-center justify-center" data-testid={testId}>
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full sm:max-w-md max-h-[85dvh] flex flex-col bg-surface-panel border-t sm:border border-line-strong rounded-t-sheet sm:rounded-sheet shadow-overlay pb-[max(0.5rem,env(safe-area-inset-bottom))] outline-none"
      >
        <div aria-hidden="true" className="shrink-0 mx-auto mt-2 mb-1 w-10 h-1 rounded-pill bg-surface-control" />
        {header}
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Sheet;
