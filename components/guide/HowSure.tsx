// components/guide/HowSure.tsx (v16.6, "How sure are we?"; the v16.6 spec §3.6, mockups howsure-plain, howsure-technical,
// howsure-arrival)
//
// The Guide's section that defines the seven evidence tags and says what research has found on each kind of claim the
// app makes. Rendered at the end of both Guide views (Plain: after "What Aetheria Is NOT"; Technical: after "The Form:
// Sacred Geometry"), so it is in both layouts and both views, with every anchor: the section (#how-sure) and each tier's
// heading (#how-sure-<tier>, tabIndex -1, so arriving from a tag focuses it and a screen reader reads "Tier 2 · Mixed
// evidence"). Technical lists each tier's sources and each topic's references as ↗ links.
//
// Links: every reference is an <a target="_blank" rel="noopener noreferrer"> inside the external-link guard, in both
// layouts: the new layout's Guide guards its whole content; in classic this section guards itself (`layout`), so an
// installed PWA never navigates away from the player, and a link is never handled twice.
// Each tier and each topic is a data-evidence block with its legend tag (the DOM gate's rule). `back`: the new layout's
// "Back to <where you were>" chip, placed just before the tier it led to (the next focusable control before the
// heading). Static text: it never reads the clock.

import React from 'react';
import { ArrowLeft, Scale } from 'lucide-react';
import EvidenceTag from '../ui/EvidenceTag';
import { ExternalLinkGuard } from '../shell/more/externalLinks';
import {
  TIER_ORDER, TIERS, TOPICS, refsForTier, tierAnchor, backToLabel, HOW_SURE_ID, HOW_SURE_TITLE, HOW_SURE_INTRO, HOW_SURE_TECH_INTRO,
  HOW_SURE_IN_AETHERIA, HOW_SURE_SOURCES, HOW_SURE_RESEARCH, HOW_SURE_WORDS_TITLE, HOW_SURE_WORDS, HOW_SURE_FOOTER,
} from '../../utils/copy/evidence';
import type { Tier, Ref } from '../../utils/copy/evidence';
import type { Layout } from '../../utils/copy/places';

export interface HowSureBack {
  tier: Tier;
  label: string;
  onBack: () => void;
}

interface HowSureProps {
  view: 'plain' | 'technical';
  layout?: Layout;
  back?: HowSureBack | null;
}

const LINK = 'text-sky-400 hover:text-sky-300 underline decoration-sky-500/40 hover:decoration-sky-300 transition-colors';

const RefList = ({ refs }: { refs: readonly Ref[] }) => (
  <ul className="mt-1 space-y-1.5 text-xs text-slate-400 leading-snug">
    {refs.map((r) => (
      <li key={r.url} className="flex gap-2">
        <span aria-hidden="true" className="text-sky-400 shrink-0">↗</span>
        <a href={r.url} target="_blank" rel="noopener noreferrer" className={LINK} data-how-sure-ref="">
          {r.cite}
        </a>
      </li>
    ))}
  </ul>
);

const HowSure = ({ view, layout = 'classic', back = null }: HowSureProps) => {
  const technical = view === 'technical';
  const body = (
    <section id={HOW_SURE_ID} tabIndex={-1} aria-labelledby="how-sure-title" data-testid="how-sure" className="space-y-4 outline-none">
      <div className="flex items-center gap-2">
        <Scale size={22} className="shrink-0 text-gold-400" aria-hidden="true" />
        <h2 id="how-sure-title" className="text-2xl font-serif text-gold-300">
          {HOW_SURE_TITLE}
        </h2>
      </div>
      <p className="text-slate-300 leading-relaxed">{HOW_SURE_INTRO}</p>
      {technical ? <p className="text-slate-400 text-sm leading-relaxed">{HOW_SURE_TECH_INTRO}</p> : null}
      {TIER_ORDER.map((t) => {
        const tier = TIERS[t];
        const refs = technical ? refsForTier(t) : [];
        return (
          <section key={t} data-evidence={t} data-how-sure-tier={t} className="pt-4 border-t border-slate-800">
            {back && back.tier === t ? (
              <button
                type="button"
                onClick={back.onBack}
                data-evidence-back=""
                data-for-tier={t}
                data-testid="evidence-back"
                className="mb-1 min-h-touch inline-flex items-center gap-1 px-3 rounded-pill border border-line-strong bg-surface-panel text-sm text-ink-soft hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
              >
                <ArrowLeft size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                {backToLabel(back.label)}
              </button>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <h3 id={tierAnchor(t)} tabIndex={-1} className="text-lg font-serif text-gold-200 rounded scroll-mt-4 focus:outline focus:outline-2 focus:outline-gold-400">
                {tier.heading}
              </h3>
              <EvidenceTag tier={t} legend />
            </div>
            <p className="mt-1 text-slate-300 text-sm leading-relaxed">{technical ? tier.technical : tier.plain}</p>
            <p className="mt-2 text-xs uppercase tracking-widest text-slate-500">{HOW_SURE_IN_AETHERIA}</p>
            <ul className="mt-1 space-y-1 list-disc ml-5 text-sm text-slate-400 leading-snug">
              {tier.examples.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {refs.length ? (
              <>
                <p className="mt-2 text-xs uppercase tracking-widest text-slate-500">{HOW_SURE_SOURCES}</p>
                <RefList refs={refs} />
              </>
            ) : null}
          </section>
        );
      })}
      <section className="pt-4 border-t border-slate-800 space-y-4" aria-labelledby="how-sure-research">
        <h3 id="how-sure-research" className="text-lg font-serif text-gold-200">
          {HOW_SURE_RESEARCH}
        </h3>
        {TOPICS.map((topic) => (
          <div key={topic.id} data-evidence={topic.tags[0]} data-how-sure-topic={topic.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <h4 className="text-base font-semibold text-slate-200">{topic.title}</h4>
              {topic.tags.map((t) => (
                <EvidenceTag key={t} tier={t} legend />
              ))}
            </div>
            <p className="text-slate-300 text-sm leading-relaxed">{technical ? topic.technical : topic.plain}</p>
            {technical ? <RefList refs={topic.refs} /> : null}
          </div>
        ))}
      </section>
      <section className="pt-4 border-t border-slate-800" aria-labelledby="how-sure-words">
        <h3 id="how-sure-words" className="text-lg font-serif text-gold-200">
          {HOW_SURE_WORDS_TITLE}
        </h3>
        <p className="mt-1 text-slate-300 text-sm leading-relaxed">{HOW_SURE_WORDS}</p>
      </section>
      <p className="text-xs text-slate-500">{HOW_SURE_FOOTER}</p>
    </section>
  );
  // Classic's Guidebook has no guard of its own: this section brings one. The new layout's Guide guards its content.
  return layout === 'classic' ? <ExternalLinkGuard>{body}</ExternalLinkGuard> : body;
};

export default React.memo(HowSure);
