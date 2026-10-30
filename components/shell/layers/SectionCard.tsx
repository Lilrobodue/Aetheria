// components/shell/layers/SectionCard.tsx (v15.6, the Layers tab)
//
// One section of the Layers tab: a card (rounded-card, panel fill, a 1 px line), labelled by its h2 (small caps, the
// jump row's focus target, tabIndex -1) with a one-line status at the right, then its controls. SectionCrash is the
// section region's fallback in the same frame (same id and heading, so the jump row still reaches it).
// v16.4: `prefix` (default 'layers') names its ids and test ids, so the Visuals sheet's five cards are the same card.

import React from 'react';
import type { ReactNode } from 'react';
import { PanelFallback } from '../../ErrorBoundary';
import type { FallbackApi } from '../../ErrorBoundary';
import type { LayersSection } from './layersModel';

/** The card's ids: #layers-sec-sound and #layers-h-sound (layersModel's sectionId / headingId); v16.4 #visuals-sec-look. */
const sectionId = (prefix: string, s: string): string => `${prefix}-sec-${s}`;
const headingId = (prefix: string, s: string): string => `${prefix}-h-${s}`;

interface SectionCardProps {
  section: LayersSection | string;
  title: string;
  status?: string | null;
  children: ReactNode;
  /** v16.4: the ids' and test ids' prefix (default 'layers'). */
  prefix?: string;
}

// The heading row, called as a function (not a component of its own): a card's render is one component, not two.
const heading = ({ section, title, status, prefix }: { section: string; title: string; status?: string | null; prefix: string }) => (
  <div className="flex items-baseline justify-between gap-3">
    <h2 id={headingId(prefix, section)} tabIndex={-1} className="shrink-0 text-xs font-semibold uppercase tracking-widest text-ink-soft outline-none">
      {title}
    </h2>
    {status ? (
      <span data-testid={`${prefix}-${section}-status`} className="min-w-0 text-xs text-ink-muted truncate">
        {status}
      </span>
    ) : null}
  </div>
);

const SectionCard = ({ section, title, status, children, prefix = 'layers' }: SectionCardProps) => (
  <section id={sectionId(prefix, section)} aria-labelledby={headingId(prefix, section)} data-testid={`${prefix}-${section}`} className="rounded-card bg-surface-panel border border-line p-4">
    {heading({ section, title, status, prefix })}
    <div data-testid={`${prefix}-${section}-body`} className="mt-2 space-y-3">
      {children}
    </div>
  </section>
);

/** A section region's fallback: the card, its heading, and the panel fallback (Reload panel, Copy details). */
export const SectionCrash = ({ section, title, api }: { section: LayersSection; title: string; api: FallbackApi }) => (
  <section id={sectionId('layers', section)} aria-labelledby={headingId('layers', section)} data-testid={`layers-${section}-fallback`} className="rounded-card bg-surface-panel border border-line p-4">
    {heading({ section, title, prefix: 'layers' })}
    <div className="mt-2">
      <PanelFallback
        text="This section hit a problem."
        switchedOff={api.switchedOff}
        copyDetails={api.copyDetails}
        buttonRef={api.buttonRef}
        onRetry={api.retry}
      />
    </div>
  </section>
);

export default SectionCard;
