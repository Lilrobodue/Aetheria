// components/guide/evidenceLink.ts (v16.6, "How sure are we?")
//
// Where an evidence tag's tap goes. EvidenceLink holds `(tier, origin) => void`:
//   - App provides it at the root: the new layout's actions.openEvidence (More › Guide at the tier, with a "Back to
//     <origin>" chip), or classic's openEvidenceClassic (the Guidebook modal, scrolled to the tier);
//   - the Guide's own content (both views, both layouts) provides a nested one that scrolls in place (no navigation).
// EvidenceOrigin is where a tag sits in the new layout ("Crystal" for the Crystal sheet, "Layers" for the Layers tab),
// so the Guide can offer the way back. With no provider (a unit render, a legend) a tag is plain text.
//
// No @types/react here: React is `any` to tsc, so contexts are created without type arguments (as shell/contexts.ts).

import { createContext, useContext } from 'react';
import type { Tier } from '../../utils/copy/evidence';
import { tierAnchor, HOW_SURE_ID } from '../../utils/copy/evidence';
import type { ShellSheet, ShellTab } from '../shell/shellModel';
import type { MoreView } from '../shell/more/moreModel';

/** Where a tag was tapped (the new layout): the tab, the sheet over it, and the chip's word. `more`: the More page it
 *  was on (Advanced); `trackInfo`: the track whose Track info was open. */
export interface EvidenceOriginValue {
  tab: ShellTab;
  sheet: ShellSheet | null;
  label: string;
  more?: MoreView;
  trackInfo?: string;
}

/** A tier's heading, or 'section' for the section's top (the Guide's "How sure are we? ›" links). */
export type EvidenceOpen = (tier: Tier | 'section', origin: EvidenceOriginValue | null) => void;

export const EvidenceLink = createContext(null);
export const EvidenceOrigin = createContext(null);

export function useEvidenceLink(): EvidenceOpen | null {
  return useContext(EvidenceLink);
}
export function useEvidenceOrigin(): EvidenceOriginValue | null {
  return useContext(EvidenceOrigin);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Scroll `scroller` so the tier's heading (or the section's, with null) sits at its top, below `topInset` px of
 * sticky header, then focus the heading (its tabIndex is -1). A "Back to …" chip placed just before the heading is
 * kept in view above it. Instant under reduced motion. Returns false when the anchor isn't rendered.
 */
export function scrollToEvidence(scroller: HTMLElement | null, tier: Tier | null, topInset = 0): boolean {
  if (!scroller) return false;
  const id = tier ? tierAnchor(tier) : HOW_SURE_ID;
  const heading = scroller.querySelector(`[id="${id}"]`);
  if (!(heading instanceof HTMLElement)) return false;
  const chip = tier ? scroller.querySelector(`[data-evidence-back][data-for-tier="${tier}"]`) : null;
  const first = chip instanceof HTMLElement ? chip : heading;
  const delta = first.getBoundingClientRect().top - scroller.getBoundingClientRect().top - topInset - 4;
  const top = Math.max(0, scroller.scrollTop + delta);
  if (prefersReducedMotion()) scroller.scrollTop = top;
  else scroller.scrollTo({ top, behavior: 'smooth' });
  heading.focus({ preventScroll: true });
  return true;
}

// Review D5: focus goes back to the tag that was tapped, after the Guide's "Back to …" (the new layout) and after
// classic's Guidebook closes. EvidenceTag marks itself just before calling its link (rememberTag); only the root link
// (App's, which leaves the screen) keeps the mark (commitTag), so a tag tapped inside the Guide (in place) never does.
interface TagMark {
  el: HTMLElement;
  tier: string;
  nth: number;
}
let candidate: TagMark | null = null;
let lastTag: TagMark | null = null;

const shownTags = (tier: string): HTMLElement[] =>
  Array.from(document.querySelectorAll(`[data-evidence-tag="${tier}"]`)).filter(
    (t): t is HTMLElement => t instanceof HTMLElement && t.getClientRects().length > 0
  );

/** The tag being tapped (EvidenceTag, just before its link): its element, and its place among the tier's tags. */
export function rememberTag(el: HTMLElement): void {
  const tier = el.getAttribute('data-evidence-tag') ?? '';
  candidate = { el, tier, nth: Math.max(0, shownTags(tier).indexOf(el)) };
  queueMicrotask(() => {
    candidate = null;
  });
}

/** The Guide was left another way (the tab bar): there is no way back, so no tag to return to. */
export function forgetTag(): void {
  lastTag = null;
  candidate = null;
}

/** The root link took this tap: the tag is where focus goes back to. */
export function commitTag(): void {
  lastTag = candidate;
  candidate = null;
}

/**
 * Focus the remembered tag again (once): the same element when it is still on screen (classic: under the Guidebook),
 * else the tier's tag at the same place on the reopened screen. Tried over the next frames while that screen renders,
 * and held for three, since a sheet or dialog moves focus into itself on its first frame.
 */
export function refocusTag(): void {
  const mark = lastTag;
  lastTag = null;
  if (!mark || typeof requestAnimationFrame !== 'function') return;
  let frames = 0;
  let held = 0;
  const step = () => {
    const el = mark.el.isConnected && mark.el.getClientRects().length > 0 ? mark.el : shownTags(mark.tier)[mark.nth];
    if (el) {
      if (document.activeElement !== el) el.focus();
      if (++held >= 3) return;
    }
    if (++frames < 30) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
