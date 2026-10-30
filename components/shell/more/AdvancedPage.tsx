// components/shell/more/AdvancedPage.tsx (v16.5, More › Advanced; v16.4 spec §3.10; mockup advanced-phone)
//
// Three cards:
//   1. Experimental: "Show experimental scan scores" (aetheria.scanScores.v1, off by default, saved from its tap only):
//      Library rows' badges and Track info's section, labelled as scores from an unreliable reading, not measurements;
//   2. Layout: Use the classic layout (the test id more-back-to-classic: v16.4's root row moved here); the music keeps
//      playing;
//   3. For testing: "Performance readout", the perf HUD from the NEXT launch (utils/perfHud's key, the one ?perf=1 sets),
//      so the installed PWA, where no URL can be typed, can turn it on. "On now" while the HUD shows this session.
// React.memo; it reads no clock.

import React, { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { ReactNode } from 'react';
import Toggle from '../../ui/Toggle';
import { useActions, useMore } from '../contexts';
import { countRender } from '../devRenders';
import { perfHudEnabled, perfHudNextLaunch, setPerfHudNextLaunch } from '../../../utils/perfHud';
import {
  ADVANCED_EXPERIMENTAL,
  ADVANCED_LAYOUT,
  ADVANCED_TESTING,
  LAYOUT_LINE,
  LAYOUT_STATUS,
  PERF_LINE,
  PERF_ON_NOW,
  PERF_TITLE,
  SCAN_SCORES_LINE,
  SCAN_SCORES_TITLE,
  USE_CLASSIC,
} from './moreModel';

const Card = ({ id, title, status, children }: { id: string; title: string; status?: string; children: ReactNode }) => (
  <section aria-labelledby={`advanced-h-${id}`} data-testid={`advanced-${id}`} className="rounded-card bg-surface-panel border border-line p-4">
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={`advanced-h-${id}`} className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
        {title}
      </h2>
      {status ? <span className="text-xs text-ink-muted">{status}</span> : null}
    </div>
    <div className="mt-2 space-y-3">{children}</div>
  </section>
);

const AdvancedPage = () => {
  countRender('AdvancedPage');
  const actions = useActions();
  const { scanScores } = useMore();
  const [perfNext, setPerfNext] = useState<boolean>(() => perfHudNextLaunch());
  const setPerf = (on: boolean) => {
    setPerfHudNextLaunch(on);
    setPerfNext(perfHudNextLaunch());
  };
  return (
    <div data-testid="more-advanced" className="px-4 py-3 space-y-3">
      <Card id="experimental" title={ADVANCED_EXPERIMENTAL}>
        <Toggle label={SCAN_SCORES_TITLE} description={SCAN_SCORES_LINE} checked={scanScores} onChange={actions.setScanScores} data-testid="advanced-scan-scores" />
      </Card>
      <Card id="layout" title={ADVANCED_LAYOUT} status={LAYOUT_STATUS}>
        <p className="text-sm text-ink-soft leading-snug">{LAYOUT_LINE}</p>
        <button
          type="button"
          onClick={() => actions.setLayout('classic')}
          data-testid="more-back-to-classic"
          className="w-full min-h-touch px-4 rounded-control border border-line-strong bg-surface-raised hover:border-ink-faint text-base text-ink-strong flex items-center justify-center gap-2 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          <ArrowLeftRight size={18} className="text-ink-muted" aria-hidden="true" />
          {USE_CLASSIC}
        </button>
      </Card>
      <Card id="testing" title={ADVANCED_TESTING}>
        <Toggle label={PERF_TITLE} description={PERF_LINE} note={perfHudEnabled ? PERF_ON_NOW : null} checked={perfNext} onChange={setPerf} data-testid="advanced-perf" />
      </Card>
    </div>
  );
};

export default React.memo(AdvancedPage);
