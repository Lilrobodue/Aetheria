// components/shell/more/GuidePage.tsx (v16.5, More › Guide; v16.4 spec §3.7; mockups guide-phone-plain,
// guide-phone-technical)
//
// The Guide: a sticky 60 px row with ONE control, "Guide view": Plain language · Technical (classic has two copies of
// "Accessible / Technical"), then the content:
//   - Plain language: classic's AccessibleGuidebook, unchanged, in its own look (the copy pass rewrites its words);
//   - Technical: components/guide/TechnicalGuide.tsx, the technical view moved verbatim out of App (classic renders the
//     same component), with GuideContext's values and the shell's actions: a cube cell plays its tone (selectFrequency),
//     Perfect GUT is Layers' switch, a walk tile starts the walk (with v15.9's Undo toast), the palette is Visuals ›
//     Crystal colours'. So the cube is interactive in both layouts.
// Every external link is under ExternalLinkGuard (an installed PWA must not navigate away from the player: the new
// layout's fix for the Guidebook's gap, v16.4 spec §2.13 item 7). Where it was left (the view and its scroll) is
// ShellValue.guideViewRef (session only; MoreTab restores the scroll); the default is Plain language, as classic's.
// It reads GuideContext (per crystal or walk), never the clock.
// v16.6 ("How sure are we?"): both views end with the HowSure section and pass layout="new" (the places they name are
// the new layout's: utils/copy/places). A "How sure are we? ›" button under the control jumps to it. Arriving from an
// evidence tag (App's actions.openEvidence left guideViewRef.anchor), the page scrolls the tier's heading to the top,
// below the sticky control (instant under reduced motion), focuses it, and shows "Back to <where you were>" just above
// it (evidenceOriginRef; the header's Back still goes to More). A tag inside the Guide scrolls in place (a nested
// EvidenceLink): no navigation.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import AccessibleGuidebook from '../../AccessibleGuidebook';
import TechnicalGuide from '../../guide/TechnicalGuide';
import { useActions, useGuide, useShell } from '../contexts';
import { countRender } from '../devRenders';
import { ExternalLinkGuard } from './externalLinks';
import { GUIDE_VIEWS, GUIDE_VIEW_LABEL, isGuideView, onGuideAnchorRequest } from './moreModel';
import type { GuideView } from './moreModel';
import { EvidenceLink, scrollToEvidence } from '../../guide/evidenceLink';
import { HOW_SURE_JUMP, isTier } from '../../../utils/copy/evidence';
import type { Tier } from '../../../utils/copy/evidence';

/** The sticky "Guide view" row's height (h-[60px]): an anchor scrolls to just below it. */
const STICKY = 60;

/** An arrival from a tag: the tier, the chip's word (null: no way back) and a sequence (a repeat arrival scrolls again). */
interface Arrival {
  tier: Tier | null;
  label: string | null;
  seq: number;
}
let arrivalSeq = 0;

const PRESSED =
  'flex-1 min-h-touch px-3 rounded-control border flex items-center justify-center gap-2 text-sm border-ink-muted bg-surface-raised text-ink-strong font-semibold transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const PLAIN =
  'flex-1 min-h-touch px-3 rounded-control border flex items-center justify-center gap-2 text-sm border-line-strong bg-surface-deep text-ink-soft hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const GuidePage = () => {
  countRender('GuidePage');
  const actions = useActions();
  const g = useGuide();
  const { guideViewRef, evidenceOriginRef } = useShell();
  const [view, setView] = useState<GuideView>(() => (isGuideView(guideViewRef.current.view) ? guideViewRef.current.view : 'plain'));
  // An anchor App left before this page mounted (read here; cleared in the effect below).
  const takeArrival = (): Arrival | null => {
    const a = guideViewRef.current.anchor;
    if (!a) return null;
    const origin = evidenceOriginRef.current;
    return { tier: isTier(a) ? a : null, label: origin ? origin.label : null, seq: ++arrivalSeq };
  };
  const [arrival, setArrival] = useState<Arrival | null>(takeArrival);
  const rootRef: { current: HTMLDivElement | null } = useRef(null);
  const scrollerRef: { current: HTMLElement | null } = useRef(null);

  // The More tab's scroller: its position is kept in guideViewRef as it moves (MoreTab keeps the page's own too).
  useLayoutEffect(() => {
    scrollerRef.current = (rootRef.current?.closest('[data-testid="more-scroll"]') as HTMLElement | null) ?? null;
  }, []);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      guideViewRef.current.top = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // The anchor: on mount (an arrival read above), or later while mounted (onGuideAnchorRequest). The scroll and the focus
  // wait a frame, after the shells' own focus on a tab change and after the chip has rendered.
  useEffect(() => {
    guideViewRef.current.anchor = null;
    return onGuideAnchorRequest(() => {
      const next = takeArrival();
      guideViewRef.current.anchor = null;
      if (next) setArrival(next);
    });
  }, []);
  useEffect(() => {
    if (!arrival) return;
    const id = requestAnimationFrame(() => scrollToEvidence(scrollerRef.current, arrival.tier, STICKY));
    return () => cancelAnimationFrame(id);
  }, [arrival ? arrival.seq : 0]);

  // A tag inside the Guide: scroll in place.
  const inPlace = useCallback((tier: Tier | 'section') => {
    scrollToEvidence(scrollerRef.current, isTier(tier) ? tier : null, STICKY);
  }, []);
  const back = arrival && arrival.tier && arrival.label ? { tier: arrival.tier, label: arrival.label, onBack: actions.backFromEvidence } : null;

  const choose = (next: GuideView) => {
    if (next === view) return;
    guideViewRef.current = { view: next, top: 0 };
    setView(next);
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  };

  return (
    <div ref={rootRef} data-testid="more-guide" data-guide-view={view}>
      <div
        role="group"
        aria-label={GUIDE_VIEW_LABEL}
        data-testid="guide-view"
        className="sticky top-0 z-10 h-[60px] px-4 flex items-center gap-2 bg-surface-deep border-b border-line"
      >
        {GUIDE_VIEWS.map((v) => {
          const on = v.value === view;
          return (
            <button key={v.value} type="button" aria-pressed={on} onClick={() => choose(v.value)} data-testid={`guide-view-${v.value}`} className={on ? PRESSED : PLAIN}>
              <span className="min-w-0">{v.label}</span>
              {on ? <Check size={14} className="shrink-0 text-ink-soft" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => scrollToEvidence(scrollerRef.current, null, STICKY)}
          data-testid="guide-how-sure"
          className="min-h-touch inline-flex items-center gap-1 text-sm text-sky-300 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          {HOW_SURE_JUMP}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <ExternalLinkGuard data-testid="guide-content">
        <EvidenceLink.Provider value={inPlace}>
        {view === 'plain' ? (
          <AccessibleGuidebook layout="new" back={back} />
        ) : (
          <TechnicalGuide
            currentFrequency={g.crystalRaw}
            onSelectFrequency={actions.selectCrystal}
            loShuPerfectGUT={g.perfectGut}
            onLoShuPerfectChange={actions.setPerfectGut}
            onStartWalk={actions.startWalk}
            activeWalkMode={g.walkMode}
            colorMode={g.palette}
            onColorModeChange={actions.setPalette}
            containCells // v16.5 final: the cells hold their labels on a phone
            layout="new"
            back={back}
          />
        )}
        </EvidenceLink.Provider>
      </ExternalLinkGuard>
    </div>
  );
};

export default React.memo(GuidePage);
