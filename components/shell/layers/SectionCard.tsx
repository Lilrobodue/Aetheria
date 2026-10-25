// components/shell/layers/SectionCard.tsx (v15.6, the Layers tab)
//
// One section of the Layers tab: a card (rounded-card, panel fill, a 1 px line), labelled by its h2 (small caps, the
// jump row's focus target, tabIndex -1) with a one-line status at the right, then its controls. SectionCrash is the
// section region's fallback in the same frame (same id and heading, so the jump row still reaches it).

import React from 'react';
import type { ReactNode } from 'react';
import { PanelFallback } from '../../ErrorBoundary';
import type { FallbackApi } from '../../ErrorBoundary';
import { headingId, sectionId } from './layersModel';
import type { LayersSection } from './layersModel';

interface SectionCardProps {
  section: LayersSection;
  title: string;
  status?: string | null;
  children: ReactNode;
}

const Heading = ({ section, title, status }: { section: LayersSection; title: string; status?: string | null }) => (
  <div className="flex items-baseline justify-between gap-3">
    <h2 id={headingId(section)} tabIndex={-1} className="shrink-0 text-xs font-semibold uppercase tracking-widest text-ink-soft outline-none">
      {title}
    </h2>
    {status ? (
      <span data-testid={`layers-${section}-status`} className="min-w-0 text-xs text-ink-muted truncate">
        {status}
      </span>
    ) : null}
  </div>
);

const SectionCard = ({ section, title, status, children }: SectionCardProps) => (
  <section id={sectionId(section)} aria-labelledby={headingId(section)} data-testid={`layers-${section}`} className="rounded-card bg-surface-panel border border-line p-4">
    <Heading section={section} title={title} status={status} />
    <div data-testid={`layers-${section}-body`} className="mt-2 space-y-3">
      {children}
    </div>
  </section>
);

/** A section region's fallback: the card, its heading, and the panel fallback (Reload panel, Copy details). */
export const SectionCrash = ({ section, title, api }: { section: LayersSection; title: string; api: FallbackApi }) => (
  <section id={sectionId(section)} aria-labelledby={headingId(section)} data-testid={`layers-${section}-fallback`} className="rounded-card bg-surface-panel border border-line p-4">
    <Heading section={section} title={title} />
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
