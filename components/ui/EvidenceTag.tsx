// components/ui/EvidenceTag.tsx (v16.6 UI kit, "How sure are we?"; the v16.6 spec §3.5, mockup tags-A.png)
//
// A 28 px chip that says how sure Aetheria is of a claim: a label (decision 1 A, plain words: "Mixed evidence"), a
// 14 px icon and a border style, so colour never carries the meaning alone: dashed for Open question and Tradition (not
// a level of scientific support), solid for the rest. Neutral ink: gold stays on Play, the active tab and the playing
// crystal (the Quiet look).
//
// A tap opens "How sure are we?" at the tier (EvidenceLink: the Guide in the new layout, classic's Guidebook modal, or a
// scroll in place inside the Guide), in one tap. It is a <button> with a 44 × 44 px hit area through its ::after box
// (as the kit's Chip), named "Evidence: <label>. Opens How sure are we?" (the visible label in the name, WCAG 2.5.3).
// With no provider (a unit render) or as a legend (the Guide's own tier headings) it is a <span> with the same look and
// no name beyond its text; a legend carries data-evidence-legend, a tag data-evidence-tag. A tag always sits inside a
// data-evidence block on its own row (gap-y-3, so two hit boxes never overlap), never inside a sentence.
// Every class is a complete literal (tailwind.config.js scans this file).

import React from 'react';
import { Sigma, CircleCheck, Contrast, Sprout, CircleHelp, PencilRuler, ScrollText } from 'lucide-react';
import { TIERS, tagLabel, tagName } from '../../utils/copy/evidence';
import type { Tier } from '../../utils/copy/evidence';
import { useEvidenceLink, useEvidenceOrigin, rememberTag } from '../guide/evidenceLink';

export interface EvidenceTagProps {
  tier: Tier;
  /** Legend use (the Guide's own tier headings): a span, not a button. */
  legend?: boolean;
  'data-testid'?: string;
}

const ICONS = { Sigma, CircleCheck, Contrast, Sprout, CircleHelp, PencilRuler, ScrollText } as const;

const SOLID =
  'relative inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-pill border border-ink-faint bg-surface-panel text-xs font-medium text-ink-soft whitespace-nowrap align-middle shrink-0';
const DASHED =
  'relative inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-pill border border-dashed border-ink-faint bg-surface-panel text-xs font-medium text-ink-soft whitespace-nowrap align-middle shrink-0';
const BUTTON =
  "min-w-[44px] cursor-pointer after:absolute after:-inset-y-2 after:-inset-x-1 after:content-[''] hover:border-ink-muted transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400";

const EvidenceTag = ({ tier, legend = false, 'data-testid': testId }: EvidenceTagProps) => {
  const open = useEvidenceLink();
  const origin = useEvidenceOrigin();
  const t = TIERS[tier] ?? TIERS.open;
  const Icon = ICONS[t.icon];
  const look = t.dashed ? DASHED : SOLID;
  const inner = (
    <>
      <Icon size={14} className="shrink-0 text-ink-muted" aria-hidden="true" />
      {tagLabel(t.id)}
    </>
  );
  if (legend || !open) {
    return (
      <span className={look} data-evidence-legend={legend ? t.id : undefined} data-evidence-text={legend ? undefined : t.id} data-testid={testId}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${look} ${BUTTON}`}
      aria-label={tagName(t.id)}
      data-evidence-tag={t.id}
      data-testid={testId}
      onClick={(e: { currentTarget: HTMLElement }) => {
        rememberTag(e.currentTarget); // review D5: focus comes back here after Back
        open(t.id, origin);
      }}
    >
      {inner}
    </button>
  );
};

export default React.memo(EvidenceTag);
