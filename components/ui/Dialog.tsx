// components/ui/Dialog.tsx (v15.4 UI kit)
//
// A modal dialog: a bottom sheet on a phone (under 640 px), centred above. It replaces the app's last native dialogs
// (alert/confirm), which froze the page's JavaScript, and with it auto-advance, until someone tapped OK; this one
// blocks nothing but the screen under it.
//
// Rendered only while `open`, in a portal on <body> (outside #root, which the overlay stack makes inert meanwhile).
// Escape, the scrim and the actions close it (overlayStack: the top overlay alone answers Escape, focus stays inside,
// and goes back to what opened it). Focus starts on `initialFocusRef`, else the first action button. The body scrolls
// (`preformatted` keeps a readout's line breaks and emoji); a scrolling body takes focus too, so a keyboard can
// scroll it. No enter animation: nothing new runs per frame, and nothing moves.

import React, { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import { useOverlay } from './overlayStack';

interface DialogProps {
  open: boolean;
  /** The heading, and the dialog's accessible name. */
  title: string;
  /** Escape, the scrim, Close / Cancel. */
  onClose: () => void;
  /** The body; it scrolls. */
  children: ReactNode;
  /** Default: one secondary "Close" button. */
  actions?: ReactNode;
  /** alertdialog for a confirmation (its body describes it). */
  role?: 'dialog' | 'alertdialog';
  /** Keep the body's line breaks (the readouts). */
  preformatted?: boolean;
  initialFocusRef?: { current: HTMLElement | null };
  returnFocusFallback?: HTMLElement | null;
  'data-testid'?: string;
}

let dialogCount = 0;

const Dialog = ({
  open,
  title,
  onClose,
  children,
  actions,
  role = 'dialog',
  preformatted = false,
  initialFocusRef,
  returnFocusFallback,
  'data-testid': testId,
}: DialogProps) => {
  const panelRef: { current: HTMLDivElement | null } = useRef(null);
  const footerRef: { current: HTMLDivElement | null } = useRef(null);
  const idRef: { current: number } = useRef(0);
  if (!idRef.current) idRef.current = ++dialogCount;
  const titleId = `ae-dialog-${idRef.current}-title`;
  const bodyId = `ae-dialog-${idRef.current}-body`;

  useOverlay(open, panelRef, onClose, returnFocusFallback);

  // The first focus, once open (after the overlay stack has saved what had it).
  useEffect(() => {
    if (!open) return;
    const target = initialFocusRef?.current ?? footerRef.current?.querySelector<HTMLElement>('button') ?? panelRef.current;
    target?.focus();
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-end sm:items-center justify-center" data-testid={testId}>
      <div className="absolute inset-0 bg-black/80" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={role === 'alertdialog' ? bodyId : undefined}
        tabIndex={-1}
        className="relative w-full sm:max-w-lg max-h-[85dvh] flex flex-col bg-surface-panel border border-line-strong rounded-t-sheet sm:rounded-sheet shadow-overlay pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none"
      >
        <h2 id={titleId} className="text-base font-bold text-ink-strong px-4 pt-4">
          {title}
        </h2>
        <div
          id={bodyId}
          data-testid="dialog-body"
          tabIndex={preformatted ? 0 : undefined}
          className={
            preformatted
              ? 'px-4 py-3 overflow-y-auto overscroll-contain text-sm text-ink-soft whitespace-pre-wrap break-words focus-visible:outline focus-visible:outline-1 focus-visible:outline-line-strong'
              : 'px-4 py-3 overflow-y-auto overscroll-contain text-sm text-ink-soft'
          }
        >
          {children}
        </div>
        <div ref={footerRef} className="px-4 flex justify-end gap-2">
          {actions ?? (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

/** A readout's actions: Copy (its text to the clipboard; "Copied" for 2 s) and Close. */
export const ReadoutActions = ({ body, onClose }: { body: string; onClose: () => void }) => {
  const [copied, setCopied] = useState(false);
  const timerRef: { current: ReturnType<typeof setTimeout> | null } = useRef(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  const copy = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    clipboard.writeText(body).then(
      () => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      },
      () => {}
    );
  };
  return (
    <>
      <Button variant="secondary" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button variant="primary" onClick={onClose}>
        Close
      </Button>
    </>
  );
};

export default Dialog;
