// components/shell/more/MoreTab.tsx (v16.4, the More area, part 1; decision 2 A; mockups more-phone-A, more-desktop)
//
// More replaces v15.5's stub: one scrolling list of 64 px rows under eyebrow headings (each group a labelled section),
// and the pages it opens in its own place (Safety & comfort and its Safety statement, About, Links). v16.4's rows:
//   Visuals and recording · Visualizer (the Visuals sheet: on the phone over Now Playing, on the desktop in the panel);
//                           Stop recording while one runs (the stub's row, the same test id);
//   Safety · Safety & comfort;
//   About · About (the version, and "an update is ready" with a dot), Links;
//   In the classic layout for now · "Guide, Record, Journal, scan scores" (Use the classic layout: v16.5 brings them).
// A page's header has Back ("Back to More"; the statement's "Back to Safety & comfort") first, its h1, Beta (and Close
// on the desktop panel). Its h1 takes the focus on entry; Back returns to the row that opened it. Where the tab was
// left (the page and its scrollTop) is App's moreViewRef (session only), so Library and back reopens the same page at
// the same place; a tap on the active More tab goes back to the root (moreModel's request). Links opened from About's
// row remembers it (v16.4 review): its Back returns to About, to that row.
// Each page is its own region (more-safety, the statement too; more-about; more-links): a crash in one leaves the
// header with Back, the other pages and the music. Everything here is React.memo and reads no clock.
// v16.5 (part 2; mockups more-phone-A, more-phone-recording): the full set under five headings:
//   Visuals and recording · Visualizer, Record (the Record sheet; "Recording · 3:12" while one runs);
//   Learn · Guide, Journal (a dashed Experimental badge; "A session is being documented" while one is);
//   Safety · Safety & comfort;  About · About, Links;  Advanced · Advanced (the scan scores, the layout switch, the perf
//   readout; Use the classic layout moved there with its test id).
// While recording, a card tops the list: a red dot, "Recording · m:ss" (RecordElapsed, the only part that ticks), the
// kind, and Stop and save (test id more-stop-recording: it stops at once, an explicit labelled button). New regions:
// more-guide, more-journal, more-advanced.
// v16.5, Export with layers (mockup more-exporting-phone): while an export runs, a card tops the root ("Exporting <title> ·
// 62 %", the time left, a thin bar: the progress leaf) with Open (the running sheet); the Record row's line follows it.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, Circle, ExternalLink, FlaskConical, Info, NotebookPen, Shield, SlidersHorizontal, Square, X } from 'lucide-react';
import type { ReactNode } from 'react';
import Badge from '../../ui/Badge';
import IconButton from '../../ui/IconButton';
import ListRow from '../../ui/ListRow';
import { APP_VERSION, PanelFallback, ViewBoundary } from '../../ErrorBoundary';
import type { FallbackApi } from '../../ErrorBoundary';
import { useActions, useExport, useExportActions, useMore, useShell, useVisuals } from '../contexts';
import ExportProgress from '../export/ExportProgress';
import { countRender } from '../devRenders';
import SafetyPage, { StatementPage } from './SafetyPage';
import AboutPage from './AboutPage';
import LinksPage from './LinksPage';
import GuidePage from './GuidePage';
import JournalPage from './JournalPage';
import AdvancedPage from './AdvancedPage';
import RecordElapsed from './RecordElapsed';
import { RECORDING_WORD, STOP_AND_SAVE, recordCardLine } from './recordModel';
import { visualsSummary } from './visualsModel';
import {
  ADVANCED_ROW_SUBTITLE,
  EXPERIMENTAL_BADGE,
  GROUP_ABOUT,
  GROUP_ADVANCED,
  GROUP_LEARN,
  GROUP_SAFETY,
  GROUP_VISUALS,
  GUIDE_ROW_SUBTITLE,
  RECORD_ROW_SUBTITLE,
  journalRowSubtitle,
  LINKS_ROW_SUBTITLE,
  SAFETY_ROW_SUBTITLE,
  VIEW_TITLES,
  aboutRowSubtitle,
  backLabel,
  backTarget,
  isMoreView,
  onMoreRootRequest,
  openerOf,
} from './moreModel';
import type { MoreView } from './moreModel';

/** The row (by test id) a page's Back returns the focus to. */
const OPENED_FROM: Readonly<Record<MoreView, string | null>> = {
  root: null,
  safety: 'more-safety-row',
  statement: 'safety-statement-row',
  about: 'more-about-row',
  links: 'more-links-row',
  guide: 'more-guide-row',
  journal: 'more-journal-row',
  advanced: 'more-advanced-row',
};

/** That row, for a page with an opener: Links opened from About returns to About's Links row. */
const openedFromRow = (view: MoreView, from: MoreView | undefined): string | null =>
  view === 'links' && from === 'about' ? 'about-links-row' : OPENED_FROM[view];

const Group = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section aria-labelledby={`more-g-${id}`} data-testid={`more-group-${id}`}>
    <h2 id={`more-g-${id}`} className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-ink-soft">
      {title}
    </h2>
    {children}
  </section>
);

/** v16.5: the recording card (mockup more-phone-recording): it renders when a recording starts and stops; its time ticks
 *  in RecordElapsed alone. */
const RecordingCard = React.memo(({ kind, since }: { kind: 'audio' | 'video' | 'both'; since: number }) => {
  countRender('RecordingCard');
  const actions = useActions();
  return (
    <div data-testid="more-recording-card" className="mx-4 mt-3 p-3 rounded-card bg-surface-panel border border-line-strong flex items-center gap-3">
      <span aria-hidden="true" className="shrink-0 w-2.5 h-2.5 rounded-pill bg-status-error" />
      <span className="flex-1 min-w-0">
        <span className="block text-base font-semibold text-ink-strong tabular-nums">
          {RECORDING_WORD} · <RecordElapsed since={since} data-testid="more-recording-elapsed" />
        </span>
        <span className="block text-xs text-ink-muted">{recordCardLine(kind)}</span>
      </span>
      <button
        type="button"
        onClick={actions.stopAndSave}
        data-testid="more-stop-recording"
        className="shrink-0 min-h-touch px-3 rounded-control border border-status-error/60 bg-status-error/10 hover:bg-status-error/20 text-sm font-semibold text-ink-strong flex items-center gap-2 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        <Square size={16} className="stroke-status-error" aria-hidden="true" />
        {STOP_AND_SAVE}
      </button>
    </div>
  );
});

/** v16.5: the exporting card: it renders when an export starts and ends; its percentage is the progress leaf's. */
const ExportingCard = React.memo(({ title }: { title: string }) => {
  countRender('ExportingCard');
  const { job } = useExport();
  const exportActions = useExportActions();
  if (!job) return null;
  return (
    <div data-testid="more-exporting-card" className="mx-4 mt-3 p-3 rounded-card bg-surface-panel border border-line-strong flex items-center gap-3">
      <span className="flex-1 min-w-0">
        <ExportProgress store={job.store} look="card" title={title} />
      </span>
      <button
        type="button"
        onClick={() => exportActions.open({ kind: 'playing' })}
        data-testid="more-exporting-open"
        className="shrink-0 min-h-touch px-4 rounded-control border border-line-strong bg-surface-raised hover:border-ink-faint text-sm font-semibold text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        Open
      </button>
    </div>
  );
});

const MoreRoot = React.memo(({ go }: { go: (v: MoreView) => void }) => {
  countRender('MoreRoot');
  const actions = useActions();
  const { settings, userPaused, reducedMotion } = useVisuals();
  const { updateReady, recording, documenting } = useMore();
  const { job } = useExport();
  const exporting = !!job && (job.phase === 'running' || job.phase === 'cancelling') ? job : null;
  return (
    <div data-testid="more-root" className="pb-2">
      {recording ? <RecordingCard kind={recording.kind} since={recording.since} /> : null}
      {exporting ? <ExportingCard title={exporting.title} /> : null}
      <Group id="visuals" title={GROUP_VISUALS}>
        <ListRow
          title="Visualizer"
          subtitle={visualsSummary(settings, userPaused, reducedMotion)}
          icon={<SlidersHorizontal size={20} />}
          chevron
          onClick={actions.openVisuals}
          data-testid="more-visualizer"
        />
        <ListRow
          title="Record"
          subtitle={
            recording ? (
              <>
                {RECORDING_WORD} · <RecordElapsed since={recording.since} />
              </>
            ) : exporting ? (
              <ExportProgress store={exporting.store} look="row" title={exporting.title} />
            ) : (
              RECORD_ROW_SUBTITLE
            )
          }
          icon={<Circle size={20} className={recording ? 'stroke-status-error' : undefined} />}
          chevron
          onClick={actions.openRecord}
          data-testid="more-record-row"
        />
      </Group>
      <Group id="learn" title={GROUP_LEARN}>
        <ListRow title="Guide" subtitle={GUIDE_ROW_SUBTITLE} icon={<BookOpen size={20} />} chevron onClick={() => go('guide')} data-testid="more-guide-row" />
        <ListRow
          title="Journal"
          badge={<Badge look="experimental">{EXPERIMENTAL_BADGE}</Badge>}
          subtitle={journalRowSubtitle(documenting)}
          icon={<NotebookPen size={20} />}
          chevron
          onClick={() => go('journal')}
          data-testid="more-journal-row"
        />
      </Group>
      <Group id="safety" title={GROUP_SAFETY}>
        <ListRow title="Safety & comfort" subtitle={SAFETY_ROW_SUBTITLE} icon={<Shield size={20} />} chevron onClick={() => go('safety')} data-testid="more-safety-row" />
      </Group>
      <Group id="about" title={GROUP_ABOUT}>
        <ListRow
          title="About"
          subtitle={aboutRowSubtitle(APP_VERSION, updateReady)}
          icon={<Info size={20} />}
          trailing={updateReady ? <span aria-hidden="true" data-testid="more-update-dot" className="shrink-0 w-2 h-2 rounded-pill bg-ink-soft" /> : null}
          chevron
          onClick={() => go('about')}
          data-testid="more-about-row"
        />
        <ListRow title="Links" subtitle={LINKS_ROW_SUBTITLE} icon={<ExternalLink size={20} />} chevron onClick={() => go('links')} data-testid="more-links-row" />
      </Group>
      <Group id="advanced" title={GROUP_ADVANCED}>
        <ListRow title="Advanced" subtitle={ADVANCED_ROW_SUBTITLE} icon={<FlaskConical size={20} />} chevron onClick={() => go('advanced')} data-testid="more-advanced-row" />
      </Group>
    </div>
  );
});

/** A page region's fallback: the card in the page's place (the header and its Back stay). */
const PageCrash = ({ api }: { api: FallbackApi }) => (
  <div className="p-4" data-testid="more-page-fallback">
    <PanelFallback text="This page hit a problem." switchedOff={api.switchedOff} copyDetails={api.copyDetails} buttonRef={api.buttonRef} onRetry={api.retry} />
  </div>
);

interface MoreTabProps {
  /** In the desktop shell's 420 px panel (Close; non-modal), else the phone's full tab. */
  inPanel?: boolean;
}

const MoreTab = ({ inPanel = false }: MoreTabProps) => {
  countRender('MoreTab');
  const actions = useActions();
  const { moreViewRef } = useShell();
  // The page showing, and its opener when it has one (Links from About).
  const [nav, setNav] = useState<{ view: MoreView; from?: MoreView }>(() => {
    const left = moreViewRef.current;
    if (!isMoreView(left.view)) return { view: 'root' };
    return isMoreView(left.from) ? { view: left.view, from: left.from } : { view: left.view };
  });
  const view = nav.view;
  const scrollRef: { current: HTMLDivElement | null } = useRef(null);
  const headingRef: { current: HTMLHeadingElement | null } = useRef(null);
  // The root's scroll, kept while a page shows; the row a Back returns to; the first layout (restore, no focus move).
  const rootTopRef: { current: number } = useRef(moreViewRef.current.view === 'root' ? moreViewRef.current.top : 0);
  const returnToRef: { current: string | null } = useRef(null);
  const mountedRef: { current: boolean } = useRef(false);
  const viewRef: { current: MoreView } = useRef(view);
  viewRef.current = view;

  const go = useCallback((next: MoreView) => {
    const el = scrollRef.current;
    const current = viewRef.current;
    if (current === 'root' && el) rootTopRef.current = el.scrollTop;
    const from = openerOf(current, next);
    const top = next === 'root' ? rootTopRef.current : 0;
    moreViewRef.current = from ? { view: next, top, from } : { view: next, top };
    setNav(from ? { view: next, from } : { view: next });
  }, []);
  const back = () => {
    returnToRef.current = openedFromRow(view, nav.from);
    go(backTarget(view, nav.from));
  };

  // A tap on the active More tab: the root.
  useEffect(() => onMoreRootRequest(() => go('root')), []);

  // The page's scroll: where it was left on mount; a page from its top; the root where it was.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = moreViewRef.current.top;
  }, [view]);

  // The focus: the shells focus the heading on a tab change; here a page's h1 on entry, the opening row on Back.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const row = returnToRef.current;
    returnToRef.current = null;
    if (row) {
      const target = scrollRef.current?.querySelector(`[data-testid="${row}"]`);
      if (target instanceof HTMLElement) {
        target.focus();
        return;
      }
    }
    headingRef.current?.focus();
  }, [view]);

  const sub = view !== 'root';
  return (
    <div
      data-testid="more"
      data-more-view={view}
      className={inPanel ? 'h-full flex flex-col bg-surface-panel border-r border-line-strong' : 'absolute inset-0 flex flex-col bg-surface-deep pointer-events-auto'}
    >
      <header
        className={
          sub
            ? 'shrink-0 h-14 pl-1 pr-2 flex items-center justify-between gap-2 border-b border-line bg-surface-deep'
            : inPanel
              ? 'shrink-0 h-14 pl-4 pr-2 flex items-center justify-between gap-2 border-b border-line bg-surface-deep'
              : 'shrink-0 h-14 px-4 flex items-center justify-between gap-2 border-b border-line bg-surface-deep'
        }
      >
        <span className="flex items-center gap-1 min-w-0">
          {sub ? <IconButton label={backLabel(view, nav.from)} icon={<ChevronLeft size={22} />} onClick={back} className="shrink-0" /> : null}
          <h1 ref={headingRef} tabIndex={-1} data-view-heading="" className="text-lg font-semibold text-ink-strong outline-none truncate">
            {VIEW_TITLES[view]}
          </h1>
          {view === 'journal' ? (
            <Badge look="experimental" className="shrink-0 ml-1">
              {EXPERIMENTAL_BADGE}
            </Badge>
          ) : null}
        </span>
        <span className="flex items-center gap-1">
          <Badge>Beta</Badge>
          {inPanel ? <IconButton label="Close panel" icon={<X size={20} />} onClick={() => actions.setTab('now')} /> : null}
        </span>
      </header>
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          moreViewRef.current.top = el.scrollTop;
          if (viewRef.current === 'root') rootTopRef.current = el.scrollTop;
        }}
        data-testid="more-scroll"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-surface-deep"
      >
        {view === 'root' ? <MoreRoot go={go} /> : null}
        <ViewBoundary
          name="more-safety"
          fallback={(api) => (view === 'safety' || view === 'statement' ? <PageCrash api={api} /> : null)}
          render={() => (view === 'safety' ? <SafetyPage go={go} /> : view === 'statement' ? <StatementPage /> : null)}
        />
        <ViewBoundary name="more-about" fallback={(api) => (view === 'about' ? <PageCrash api={api} /> : null)} render={() => view === 'about' && <AboutPage go={go} />} />
        <ViewBoundary name="more-links" fallback={(api) => (view === 'links' ? <PageCrash api={api} /> : null)} render={() => view === 'links' && <LinksPage />} />
        <ViewBoundary name="more-guide" fallback={(api) => (view === 'guide' ? <PageCrash api={api} /> : null)} render={() => view === 'guide' && <GuidePage />} />
        <ViewBoundary name="more-journal" fallback={(api) => (view === 'journal' ? <PageCrash api={api} /> : null)} render={() => view === 'journal' && <JournalPage />} />
        <ViewBoundary name="more-advanced" fallback={(api) => (view === 'advanced' ? <PageCrash api={api} /> : null)} render={() => view === 'advanced' && <AdvancedPage />} />
      </div>
    </div>
  );
};

export default React.memo(MoreTab);
