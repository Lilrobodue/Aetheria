// components/shell/layers/LayersTab.tsx (v15.6, the Layers tab; decision 4, option A)
//
// Every sound control classic keeps in Harmonic Control, on one page (mockups layers-phone-A-*, layers-desktop): the
// header (Layers, Beta; Close in the desktop panel), the sticky jump row, and five cards in the plan's order, Sound,
// Crystal, Levels (with Key fit), Beat and Advanced, each its own region (a crash in one card leaves the others and
// the music). Solid, so on a phone the heat guard pauses the visuals behind it, as for the stub it replaces.
// It reopens where it was left: the content's scrollTop goes into App's layersScrollRef as it scrolls and comes back on
// mount; opened at a section (the Sound sheet's row), it starts there instead.
// React.memo; no section reads the time, so the 4 Hz clock re-renders nothing here.

import React, { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Badge from '../../ui/Badge';
import IconButton from '../../ui/IconButton';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, useShell } from '../contexts';
import { countRender } from '../devRenders';
import JumpRow from './JumpRow';
import { SectionCrash } from './SectionCard';
import SoundSection from './SoundSection';
import CrystalSection from './CrystalSection';
import LevelsSection from './LevelsSection';
import BeatSection from './BeatSection';
import AdvancedSection from './AdvancedSection';
import { sectionId } from './layersModel';

interface LayersTabProps {
  /** In the desktop shell's 420 px panel (Close; non-modal), else the phone's full tab. */
  inPanel?: boolean;
}

const LayersTab = ({ inPanel = false }: LayersTabProps) => {
  countRender('LayersTab');
  const actions = useActions();
  const { layersScrollRef } = useShell();
  const scrollRef: { current: HTMLDivElement | null } = useRef(null);

  // Where it was left, or the section it was opened at.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = layersScrollRef.current;
    if (saved.jump) {
      const sec = el.querySelector(`#${sectionId(saved.jump)}`);
      el.scrollTop = sec ? Math.max(0, el.scrollTop + sec.getBoundingClientRect().top - el.getBoundingClientRect().top - 12) : 0;
      saved.jump = null;
      saved.top = el.scrollTop;
    } else {
      el.scrollTop = saved.top;
    }
  }, []);

  return (
    <div
      data-testid="tab-layers"
      className={inPanel ? 'h-full flex flex-col bg-surface-panel border-r border-line-strong' : 'absolute inset-0 flex flex-col bg-surface-deep pointer-events-auto'}
    >
      <header className={inPanel ? 'shrink-0 h-14 pl-4 pr-2 flex items-center justify-between gap-2 border-b border-line bg-surface-deep' : 'shrink-0 h-14 px-4 flex items-center justify-between gap-2 border-b border-line bg-surface-deep'}>
        <h1 tabIndex={-1} data-view-heading="" className="text-lg font-semibold text-ink-strong outline-none">
          Layers
        </h1>
        <span className="flex items-center gap-1">
          <Badge>Beta</Badge>
          {inPanel ? <IconButton label="Close panel" icon={<X size={20} />} onClick={() => actions.setTab('now')} /> : null}
        </span>
      </header>
      <JumpRow scrollRef={scrollRef} inPanel={inPanel} />
      <div
        ref={scrollRef}
        onScroll={() => {
          if (scrollRef.current) layersScrollRef.current.top = scrollRef.current.scrollTop;
        }}
        data-testid="layers-scroll"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-surface-deep"
      >
        <div className="px-4 py-3 space-y-3">
          <ViewBoundary name="layers-sound" fallback={(api) => <SectionCrash section="sound" title="Sound" api={api} />} render={() => <SoundSection />} />
          <ViewBoundary name="layers-crystal" fallback={(api) => <SectionCrash section="crystal" title="Crystal" api={api} />} render={() => <CrystalSection />} />
          <ViewBoundary name="layers-levels" fallback={(api) => <SectionCrash section="levels" title="Levels" api={api} />} render={() => <LevelsSection />} />
          <ViewBoundary name="layers-beat" fallback={(api) => <SectionCrash section="beat" title="Beat" api={api} />} render={() => <BeatSection />} />
          <ViewBoundary name="layers-advanced" fallback={(api) => <SectionCrash section="advanced" title="Advanced" api={api} />} render={() => <AdvancedSection />} />
        </div>
      </div>
    </div>
  );
};

export default React.memo(LayersTab);
