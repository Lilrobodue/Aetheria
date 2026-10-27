// components/shell/mixes/MixesTab.tsx (v15.9, the Mixes tab; mockups mixes-phone-A-top, -A-scrolled, -A-experimental,
// -undo-toast, -no-crystals, -disabled, -empty, mixes-desktop)
//
// Every mix one tap away, in place of v15.5's stub: the six Lo Shu walks as tiles; the journeys (the five alignments),
// the crystal sets (the five presets, by their neutral names and recipes) and the Experimental scores as rows, each
// with how many tracks it would play right now (utils/mix/catalog.ts mixCounts: exactly what the tap plays). A tap is
// App's startMix: the generator classic's drawer and the Guidebook run, so the mix starts playing through
// startPlayOrder with its Undo toast, and the tab stays on Mixes. Nothing here changes the visual settings, the tone or
// the experience level (decision 2).
// States: the library still loading (every mix waits), empty (Import music), no crystals (Assign crystals / Open
// Library), a mix with no track (dimmed, its reason as its count). Three regions (mixes-walks, mixes-lists,
// mixes-experimental): a crash in one leaves the others, the tab and the music. Solid, so on a phone the heat guard
// pauses the visuals behind it. React.memo; it reads the library (and whether it is still loading), the walk and whether
// the music plays, never the time or the scans' progress, and counts the mixes once per library change.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ListMusic, X } from 'lucide-react';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import EmptyState from '../../ui/EmptyState';
import IconButton from '../../ui/IconButton';
import { PanelFallback, ViewBoundary } from '../../ErrorBoundary';
import type { FallbackApi } from '../../ErrorBoundary';
import { useActions, useLibraryList, usePlayer, useWalk } from '../contexts';
import { countRender } from '../devRenders';
import type { MixId, MixSection } from '../../../utils/mix/catalog';
import WalkTile from './WalkTile';
import MixRow from './MixRow';
import {
  EMPTY_BODY,
  EMPTY_TITLE,
  EXPERIMENTAL_NOTE,
  MIXES_INTRO,
  MIXES_LOADING,
  NO_CRYSTALS_BODY,
  NO_CRYSTALS_TITLE,
  SECTION_TITLES,
  SEQ111_LINE,
  dotsFor,
  mixView,
  mixesIn,
  mixesStats,
  noCrystals,
  summaryText,
  walkSize,
} from './mixesModel';
import type { MixesStats } from './mixesModel';

interface MixesTabProps {
  /** In the desktop shell's 420 px panel (Close; non-modal), else the phone's full tab. */
  inPanel?: boolean;
}

const headId = (s: MixSection | 'none') => `mixes-h-${s}`;

const SectionHead = ({ section }: { section: MixSection }) => (
  <div className="px-4 pt-5 pb-2 flex items-center gap-2">
    <h2 id={headId(section)} className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
      {SECTION_TITLES[section]}
    </h2>
  </div>
);

const RegionCrash = ({ api, text, testId }: { api: FallbackApi; text: string; testId: string }) => (
  <div data-testid={testId} className="mx-4 mt-3">
    <PanelFallback text={text} switchedOff={api.switchedOff} copyDetails={api.copyDetails} buttonRef={api.buttonRef} onRetry={api.retry} />
  </div>
);

interface SectionProps {
  st: MixesStats;
  loading: boolean;
  onStart: (id: MixId) => void;
}

const WalksSection = React.memo(({ st, loading, onStart, walkMode, musicPlaying }: SectionProps & { walkMode: string | null; musicPlaying: boolean }) => {
  countRender('MixesWalks');
  return (
    <section aria-labelledby={headId('walks')} data-testid="mixes-walks">
      <SectionHead section="walks" />
      <ul role="list" aria-labelledby={headId('walks')} className="px-4 grid grid-cols-2 gap-2">
        {mixesIn('walks').map((def) => {
          const current = !loading && !!def.walk && walkMode === def.walk;
          const view = mixView(def, st, { playing: current && musicPlaying, paused: current && !musicPlaying, loading });
          return <WalkTile key={def.id} def={def} view={view} size={walkSize(def)} current={current && view.enabled} playing={musicPlaying} onStart={onStart} />;
        })}
      </ul>
    </section>
  );
});

const RowsSection = ({ section, st, loading, onStart, children }: SectionProps & { section: MixSection; children?: React.ReactNode }) => (
  <section aria-labelledby={headId(section)} data-testid={`mixes-${section}`}>
    <SectionHead section={section} />
    {children}
    <ul role="list" aria-labelledby={headId(section)}>
      {mixesIn(section).map((def) => {
        const view = mixView(def, st, { loading });
        return <MixRow key={def.id} def={def} view={view} dots={dotsFor(def.id, st.available, !view.enabled)} onStart={onStart} />;
      })}
    </ul>
  </section>
);

const ListsSection = React.memo(({ st, loading, onStart }: SectionProps) => {
  countRender('MixesLists');
  return (
    <>
      <RowsSection section="journeys" st={st} loading={loading} onStart={onStart} />
      <RowsSection section="sets" st={st} loading={loading} onStart={onStart} />
    </>
  );
});

const ExperimentalSection = React.memo(({ st, loading, onStart, onOpenCrystal }: SectionProps & { onOpenCrystal: () => void }) => {
  countRender('MixesExperimental');
  return (
    <section aria-labelledby={headId('experimental')} data-testid="mixes-experimental">
      <SectionHead section="experimental" />
      <p className="px-4 pb-3 text-xs text-ink-muted">{EXPERIMENTAL_NOTE}</p>
      <ul role="list" aria-labelledby={headId('experimental')}>
        {mixesIn('experimental').map((def) => {
          const view = mixView(def, st, { loading });
          const extra =
            def.id === 'seq111' ? (
              <div className="-mt-2 pl-[68px] pr-2 pb-1 flex items-center gap-2">
                <p className="flex-1 min-w-0 text-xs text-ink-muted">{SEQ111_LINE}</p>
                <button
                  type="button"
                  aria-label="Open Layers › Crystal"
                  data-testid="mixes-111-open"
                  onClick={onOpenCrystal}
                  className="shrink-0 min-h-touch px-3 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
                >
                  Open
                </button>
              </div>
            ) : undefined;
          return <MixRow key={def.id} def={def} view={view} dots={dotsFor(def.id, st.available, !view.enabled)} onStart={onStart} extra={extra} />;
        })}
      </ul>
    </section>
  );
});

const MixesTab = ({ inPanel = false }: MixesTabProps) => {
  countRender('MixesTab');
  const actions = useActions();
  const { songs, loading } = useLibraryList();
  const walk = useWalk();
  const { isPlaying } = usePlayer(); // play / pause and a track change, never the clock
  // Counted once per library change (dev builds count the passes: M12).
  const st = useMemo(() => {
    countRender('MixesTab:counts');
    return mixesStats(songs);
  }, [songs]);
  const onStart = useCallback((id: MixId) => actions.startMix(id), []);
  const onOpenCrystal = useCallback(() => actions.openLayers('crystal'), []);
  const empty = !loading && st.total === 0;
  const none = !loading && noCrystals(st);

  // On the phone the notices (the Undo toast) sit over the bottom of the list, above the mini-player: a spacer as tall
  // as they are ends the scroller, so every row can scroll clear of them (as the Library tab does). No render.
  const noticeSpacerRef: { current: HTMLDivElement | null } = useRef(null);
  useEffect(() => {
    const notices = document.querySelector('[data-testid="notices"]');
    const spacer = noticeSpacerRef.current;
    if (inPanel || !notices || !spacer || typeof ResizeObserver !== 'function') return;
    const fit = () => {
      const h = notices.getBoundingClientRect().height;
      spacer.style.height = h > 0 ? `${Math.ceil(h) + 8}px` : '0px';
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(notices);
    return () => ro.disconnect();
  }, [inPanel, empty]);

  return (
    <div
      data-testid="tab-mixes"
      className={inPanel ? 'h-full flex flex-col bg-surface-panel border-r border-line-strong' : 'absolute inset-0 flex flex-col bg-surface-deep pointer-events-auto'}
    >
      <header className={inPanel ? 'shrink-0 h-14 pl-4 pr-2 flex items-center justify-between gap-2 border-b border-line bg-surface-deep' : 'shrink-0 h-14 px-4 flex items-center justify-between gap-2 border-b border-line bg-surface-deep'}>
        <h1 tabIndex={-1} data-view-heading="" className="text-lg font-semibold text-ink-strong outline-none">
          Mixes
        </h1>
        <span className="flex items-center gap-1">
          <Badge>Beta</Badge>
          {inPanel ? <IconButton label="Close panel" icon={<X size={20} />} onClick={() => actions.setTab('now')} /> : null}
        </span>
      </header>
      <div data-testid="mixes-scroll" className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain bg-surface-deep">
        {empty ? (
          <div className="px-4 pt-4">
            <EmptyState
              icon={<ListMusic size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />}
              title={EMPTY_TITLE}
              body={EMPTY_BODY}
              actionLabel="Import music"
              onAction={() => actions.openImport()}
              data-testid="mixes-empty"
            />
          </div>
        ) : (
          <div data-testid="mixes-content">
            {none ? (
              <section aria-labelledby={headId('none')} data-testid="mixes-no-crystals" className="mx-4 mt-4 p-4 rounded-card border border-dashed border-line-strong">
                <h2 id={headId('none')} className="text-sm font-semibold text-ink-strong">
                  {NO_CRYSTALS_TITLE}
                </h2>
                <p className="mt-1 text-sm text-ink-muted">{NO_CRYSTALS_BODY}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="primary" onClick={() => actions.assignCrystals()} data-testid="mixes-assign">
                    Assign crystals
                  </Button>
                  <Button variant="secondary" onClick={() => actions.setTab('library')} data-testid="mixes-open-library">
                    Open Library
                  </Button>
                </div>
              </section>
            ) : (
              <div className="px-4 pt-3">
                <p data-testid="mixes-summary" className="text-xs text-ink-muted">
                  {loading ? MIXES_LOADING : summaryText(st)}
                </p>
                <p className="mt-1 text-xs text-ink-muted">{MIXES_INTRO}</p>
              </div>
            )}
            <ViewBoundary
              name="mixes-walks"
              fallback={(api) => <RegionCrash api={api} text="The walks hit a problem. The music and the other mixes are fine." testId="mixes-walks-fallback" />}
              render={() => <WalksSection st={st} loading={loading} onStart={onStart} walkMode={walk.mode} musicPlaying={isPlaying} />}
            />
            <ViewBoundary
              name="mixes-lists"
              fallback={(api) => <RegionCrash api={api} text="The journeys and crystal sets hit a problem. The music and the other mixes are fine." testId="mixes-lists-fallback" />}
              render={() => <ListsSection st={st} loading={loading} onStart={onStart} />}
            />
            <ViewBoundary
              name="mixes-experimental"
              fallback={(api) => <RegionCrash api={api} text="The experimental mixes hit a problem. The music and the other mixes are fine." testId="mixes-experimental-fallback" />}
              render={() => <ExperimentalSection st={st} loading={loading} onStart={onStart} onOpenCrystal={onOpenCrystal} />}
            />
            <div className="h-6" />
            <div ref={noticeSpacerRef} aria-hidden="true" data-testid="mixes-notice-spacer" />
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(MixesTab);
