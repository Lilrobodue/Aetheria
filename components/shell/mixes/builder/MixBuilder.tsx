// components/shell/mixes/builder/MixBuilder.tsx (v16.3, Create a mix; decision 1 A: one screen; mockups builder-A-*,
// builder-desktop)
//
// Create a mix, in the Mixes tab (a view swap: Back returns to the list where it was; the mini-player and the tab bar
// stay). One screen: Start from, Follow, Tracks per crystal, Filters, Order, and a footer that is always in view with
// the live count and length, the mix's name, Play, Play next and ⋯ (Add to queue, Save as a playlist…).
//   - The model is utils/mix/builder.ts (pure): the source's tracks through the builder's facets, then the recipe. The
//     footer is builderSummary over an index of the source's tracks, memoised on them: a tap re-runs the filters' pass
//     and the pick (a few ms at 1,000 tracks), never per frame. Nothing here reads TimeContext.
//   - The settings live here, not in App (a tap renders this view, never App), mirrored in the session ref (the tab as
//     it was left) and saved to aetheria.builder.v1 from taps only (decision 2 A): never from an effect or a load. Start
//     over goes back to Grounding (and saves that).
//   - Play, Play next, Add to queue and Save go through App's startBuilt (the play order, the queue's one writer, v16.1's
//     name Dialog: never the library). The view stays open after Play, as Library › Filters' Play these keeps its list.
//   - A playlist that is gone (deleted since) starts from the library and says so; the saved value is left until a tap.
//   - Regions: mix-builder (the sections) and mix-builder-footer; the header stays, so Back always works.
// v16.3 review:
//   - The whole view, its model work included, is the Mixes tab's mix-builder-view region (MixesTab), and the Start from
//     and Filters sheets' bodies are regions of their own: a throw here never takes the Mixes tab down.
//   - The walk choices' counts come from the pool's crystals (walkCounts), not a summary each: a tap runs one summary.
//   - Each tap also leaves the settings in the session (mixesViewRef.last) with whether saving them failed, so with a
//     full or blocked storage "Create a mix" opens at the session's settings, not the stale stored ones.
//   - From the queue, the footer says how many queued tracks the mix leaves out (and so leave the queue at Play).
// v16.3 re-review:
//   - A tap's settings are kept by keepBuilderSettings (the session's and the saved), which the Mixes tab's fallback for
//     this view uses too: its Start over puts Grounding back there, so settings that crash the view can't reopen it into
//     the crash (after a reload too). A dev drill tied to the settings (crashWhen, mix-builder-settings) tests it.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import IconButton from '../../../ui/IconButton';
import { PanelFallback, ViewBoundary, crashDrill, crashWhen, useCrashDrill } from '../../../ErrorBoundary';
import type { FallbackApi } from '../../../ErrorBoundary';
import { useActions, useLibraryList, usePlaylists, useQueue, useShell } from '../../contexts';
import type { MixesViewState } from '../../contexts';
import { countRender } from '../../devRenders';
import { useNoticeSpacer } from '../../playlists/useNoticeSpacer';
import type { Song } from '../../../../types';
import {
  BUILDER_FACETS,
  BUILDER_KEY,
  DEFAULT_SETTINGS,
  builderSummary,
  cleanCrystals,
  normalized,
  orderOptions,
  parseBuilderSettings,
  perOptions,
  serializeBuilderSettings,
  setCrystals,
  walkCounts,
} from '../../../../utils/mix/builder';
import type { BuilderSettings, Follow, Order, PerCrystal, SetId, SourceRef } from '../../../../utils/mix/builder';
import { NO_FILTERS, activeChips, buildFacetIndex, filterPass, filtersOn, toggleValue } from '../../../../utils/library/filterModel';
import type { FacetIndex, FilterSong, Filters } from '../../../../utils/library/filterModel';
import { SCAN_SCORES, scoreChipText } from '../../../../utils/library/scanScores';
import { GUT_CRYSTALS, HEAD_CRYSTALS, HEART_CRYSTALS, LO_SHU_WALKS, LO_SHU_WALK_INFO, PRESETS } from '../../../../utils/crystalData';
import type { LoShuWalkMode } from '../../../../utils/crystalData';
import { ALL_CRYSTALS } from '../../../../utils/mix/distribution';
import { MIXES } from '../../../../utils/mix/catalog';
import { tracksText } from '../mixesModel';
import SourceSection from './SourceSection';
import SourceSheet from './SourceSheet';
import FollowSection from './FollowSection';
import type { ExpChoice, FollowKind, RegimeGroup, SetChoice, WalkChoice } from './FollowSection';
import { FiltersSection, OrderSection, PerSection } from './BuilderSections';
import BuilderFilterSheet from './BuilderFilterSheet';
import BuilderFooter from './BuilderFooter';
import BuilderMoreSheet from './BuilderMoreSheet';
import {
  BACK_NAME,
  EMPTY_TEXT,
  QUEUE_EMPTY_TEXT,
  LIBRARY_SOURCE_NAME,
  PER_ANY_LINE,
  PER_OWN_LINE,
  PER_WALK_LINE,
  QUEUE_SOURCE_NAME,
  START_OVER,
  TITLE,
  noFiltersLine,
  orderLabel,
  playlistGoneLine,
  queueLeftLine,
} from './builderViewModel';

const LIBRARY: SourceRef = { kind: 'library' };
const WALK_MODES: readonly LoShuWalkMode[] = ['A', 'B', 'C', 'combined', 'ouroboros', 'cabi'];
const RANDOM_WALKS: readonly string[] = ['combined', 'ouroboros', 'cabi'];
const range = (c: readonly number[]) => `${Math.min(...c)}–${Math.max(...c)} Hz`;
const SET_LIST: ReadonlyArray<{ id: SetId; name: string; crystals: readonly number[] }> = [
  ...PRESETS.map((p) => ({ id: `preset:${p.id}` as SetId, name: p.name, crystals: p.crystals })),
  { id: 'gut', name: 'GUT', crystals: GUT_CRYSTALS },
  { id: 'heart', name: 'HEART', crystals: HEART_CRYSTALS },
  { id: 'head', name: 'HEAD', crystals: HEAD_CRYSTALS },
  { id: 'all', name: 'All 27', crystals: ALL_CRYSTALS },
];
const REGIME_GROUPS: readonly RegimeGroup[] = [
  { id: 'gut', name: 'GUT', range: range(GUT_CRYSTALS), crystals: GUT_CRYSTALS },
  { id: 'heart', name: 'HEART', range: range(HEART_CRYSTALS), crystals: HEART_CRYSTALS },
  { id: 'head', name: 'HEAD', range: range(HEAD_CRYSTALS), crystals: HEAD_CRYSTALS },
];
const EXP_IDS = ['golden', 'seq111', 'source2178'] as const;
const nameOfMix = (id: string) => MIXES.find((m) => m.id === id)?.name ?? id;

/** The saved settings (decision 2 A), read once when the view opens; anything unreadable is Grounding.
 *  v16.3 review: the session's settings (the latest tap's, mixesViewRef.last) come back instead when their save failed
 *  (full or blocked storage: the stored value is stale) or the read fails. */
export function readSavedBuilder(session?: MixesViewState['last']): BuilderSettings {
  if (session?.unsaved) return session.settings;
  try {
    return parseBuilderSettings(localStorage.getItem(BUILDER_KEY));
  } catch {
    return session ? session.settings : DEFAULT_SETTINGS;
  }
}
/** Saved from a tap only (every caller is a click handler). False when the storage refused it (full or off): the
 *  settings then stay for this session (the caller keeps them in mixesViewRef.last). */
function saveBuilder(s: BuilderSettings): boolean {
  try {
    localStorage.setItem(BUILDER_KEY, serializeBuilderSettings(s));
    return true;
  } catch {
    return false;
  }
}
/** A tap's settings, kept: the view's for the session (mixesViewRef: builder.settings, and last with whether saving
 *  them failed) and saved. v16.3 re-review: also the Mixes tab fallback's Start over (Grounding), from its tap. */
export function keepBuilderSettings(view: MixesViewState, s: BuilderSettings): void {
  view.builder.settings = s;
  view.last = { settings: s, unsaved: !saveBuilder(s) };
}

const sameEntries = (a: readonly Song[], b: readonly Song[]) => a.length === b.length && a.every((s, i) => s === b[i]);
const followKindOf = (f: Follow): FollowKind => (f.kind === 'walk' ? 'walk' : f.kind === 'set' ? 'set' : f.kind === 'any' ? 'any' : 'exp');

const RegionCrash = ({ api, text, testId }: { api: FallbackApi; text: string; testId: string }) => (
  <div data-testid={testId} className="m-4">
    <PanelFallback text={text} switchedOff={api.switchedOff} copyDetails={api.copyDetails} buttonRef={api.buttonRef} onRetry={api.retry} />
  </div>
);

interface MixBuilderProps {
  /** In the desktop shell's 420 px panel, else the phone's tab. */
  inPanel: boolean;
  onBack: () => void;
}

const MixBuilder = ({ inPanel, onBack }: MixBuilderProps) => {
  countRender('MixBuilder');
  const actions = useActions();
  const { mixesViewRef } = useShell();
  const { songs } = useLibraryList();
  const playlists = usePlaylists();
  const queue = useQueue();

  // ---- the settings (session ref + saved key, from taps only) --------------------------------------------------
  const [settings, setSettings] = useState<BuilderSettings>(() => {
    const s = normalized(mixesViewRef.current.builder.settings ?? readSavedBuilder(mixesViewRef.current.last));
    mixesViewRef.current.builder.settings = s;
    return s;
  });
  const settingsRef: { current: BuilderSettings } = useRef(settings);
  settingsRef.current = settings;
  // What each Follow kind had last (a kind's tap brings it back).
  const lastRef: { current: { walk: LoShuWalkMode; set: SetId; exp: 'golden' | 'seq111' | 'source2178'; custom: number[] } } = useRef({
    walk: 'A',
    set: 'preset:qi',
    exp: 'golden',
    custom: [],
  });
  {
    const f = settings.follow;
    if (f.kind === 'walk') lastRef.current.walk = f.mode;
    else if (f.kind === 'set') {
      lastRef.current.set = f.set;
      if (f.set === 'custom') lastRef.current.custom = cleanCrystals(f.crystals ?? []);
    } else if (f.kind === 'golden' || f.kind === 'seq111' || f.kind === 'source2178') lastRef.current.exp = f.kind;
  }
  /** A tap's new settings: shown, kept for the session (with whether the save failed), saved. */
  const choose = useCallback((next: BuilderSettings) => {
    const n = normalized(next);
    settingsRef.current = n;
    setSettings(n);
    keepBuilderSettings(mixesViewRef.current, n);
  }, []);
  const change = useCallback((patch: Partial<BuilderSettings>) => choose({ ...settingsRef.current, ...patch }), []);

  // ---- the source, and its tracks -------------------------------------------------------------------------------
  const src = settings.source;
  const pl = src.kind === 'playlist' ? (playlists.lists.find((p) => p.id === src.id) ?? null) : null;
  const gone = src.kind === 'playlist' && playlists.status === 'ready' && !pl;
  const effective = useMemo(() => (gone ? { ...settings, source: LIBRARY } : settings), [settings, gone]);
  const effectiveRef: { current: BuilderSettings } = useRef(effective);
  effectiveRef.current = effective;
  const esrc = effective.source;
  const sourceName = esrc.kind === 'playlist' ? (pl?.name ?? '') : esrc.kind === 'queue' ? QUEUE_SOURCE_NAME : LIBRARY_SOURCE_NAME;
  // A playlist's or the queue's tracks come from App (the library's own objects, in the source's order). App's play
  // state and library refs follow a commit in App's own effects, after this view's: read them after the commit's
  // effects (a microtask), and at a tap (nothing is pending then).
  const [srcTracks, setSrcTracks] = useState<Song[]>(() => (esrc.kind === 'library' ? [] : actions.builderTracks(esrc)));
  const srcKey = esrc.kind === 'playlist' ? `pl:${esrc.id}` : esrc.kind;
  const plDep = esrc.kind === 'playlist' ? playlists.lists : null;
  const qDep = esrc.kind === 'queue' ? queue : null;
  useEffect(() => {
    if (esrc.kind === 'library') return;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const next = actions.builderTracks(effectiveRef.current.source);
      setSrcTracks((prev: Song[]) => (sameEntries(prev, next) ? prev : next));
    });
    return () => {
      live = false;
    };
  }, [srcKey, songs, plDep, qDep]);
  const tracks: Song[] = esrc.kind === 'library' ? songs : srcTracks;

  // ---- the model ------------------------------------------------------------------------------------------------
  // (All of it under the Mixes tab's mix-builder-view region. The crash drill mix-builder-model throws from inside the
  // summary's work, and mix-builder-settings there while a test's predicate holds for the settings: dev builds only.)
  const drill = useCrashDrill('mix-builder-model');
  const index = useMemo(() => buildFacetIndex(tracks, BUILDER_FACETS as any) as FacetIndex<Song>, [tracks]);
  const filters = effective.filters;
  const pool = useMemo(() => (filtersOn(filters) ? filterPass(index, filters).results : index.songs), [index, filters]);
  const summary = useMemo(() => {
    countRender('MixBuilder:summary');
    if (drill) crashDrill('mix-builder-model');
    crashWhen('mix-builder-settings', effective);
    return builderSummary(index, effective, sourceName);
  }, [index, effective, sourceName, drill]);
  const crystalCounts = useMemo(() => {
    const m: Record<number, number> = {};
    for (const t of pool) {
      const c = t.closestSolfeggio;
      if (c) m[c] = (m[c] ?? 0) + 1;
    }
    return m;
  }, [pool]);
  const sets: SetChoice[] = useMemo(() => SET_LIST.map((s) => ({ id: s.id, name: s.name, count: s.crystals.reduce((n, c) => n + (crystalCounts[c] ?? 0), 0) })), [crystalCounts]);
  const follow = effective.follow;
  const kind = followKindOf(follow);
  // The six walks' counts from the pool's crystals (one pass, no summary each: v16.3 review, spec §3.6), only while the
  // walks show; equal to each walk's own summary count (builder.check G).
  const walks: WalkChoice[] = useMemo(() => {
    if (kind !== 'walk') return [];
    const counts = walkCounts(pool);
    return WALK_MODES.map((mode) => ({
      mode,
      name: LO_SHU_WALK_INFO[mode].shortName,
      count: counts[mode] ?? 0,
      size: LO_SHU_WALKS[mode].length,
    }));
  }, [kind, pool]);
  const exps: ExpChoice[] = useMemo(
    () =>
      kind !== 'exp'
        ? []
        : EXP_IDS.map((id) => {
            const n = builderSummary(index, { ...DEFAULT_SETTINGS, filters, follow: { kind: id } }, '').count;
            return { id, name: nameOfMix(id), sub: n > 0 ? tracksText(n) : 'No tracks yet' };
          }),
    [kind, index, filters]
  );
  const setIdNow = follow.kind === 'set' ? follow.set : null;
  const crystalsNow = useMemo(() => (follow.kind === 'set' ? setCrystals(follow) : []), [follow]);
  const customNow = follow.kind === 'set' && follow.set === 'custom' ? crystalsNow : [];
  const perNow = perOptions(follow) ? effective.per : null;
  const perLine = kind === 'walk' ? PER_WALK_LINE : kind === 'any' ? PER_ANY_LINE : PER_OWN_LINE;
  const labelKind = follow.kind === 'walk' ? 'walk' : follow.kind === 'set' ? 'set' : follow.kind;
  const orders = useMemo(() => orderOptions(follow).map((o) => ({ id: o, title: orderLabel(labelKind, o, esrc.kind) })), [follow, labelKind, esrc.kind]);
  const chips = useMemo(
    () =>
      activeChips(filters, BUILDER_FACETS).map((c) => {
        const d = c.facet.startsWith('x-') ? SCAN_SCORES.find((x) => `x-${x.id}` === c.facet) : null;
        return d ? { ...c, label: scoreChipText(d) } : c;
      }),
    [filters]
  );

  // ---- taps -------------------------------------------------------------------------------------------------------
  const [sheet, setSheet] = useState<'source' | 'filters' | 'more' | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const pickSource = useCallback((source: SourceRef) => {
    setSrcTracks(source.kind === 'library' ? [] : actions.builderTracks(source));
    change({ source });
  }, []);
  const onLibrary = useCallback(() => pickSource(LIBRARY), []);
  const onQueue = useCallback(() => pickSource({ kind: 'queue' }), []);
  const onPlaylists = useCallback(() => setSheet('source'), []);
  const onSourcePick = useCallback((value: string) => {
    setSheet(null);
    pickSource(value === 'library' ? LIBRARY : value === 'queue' ? { kind: 'queue' } : { kind: 'playlist', id: value });
  }, []);
  const onKind = useCallback((k: FollowKind) => {
    const l = lastRef.current;
    const next: Follow =
      k === 'walk' ? { kind: 'walk', mode: l.walk }
        : k === 'set' ? (l.set === 'custom' ? { kind: 'set', set: 'custom', crystals: l.custom } : { kind: 'set', set: l.set })
          : k === 'any' ? { kind: 'any' }
            : { kind: l.exp };
    change({ follow: next });
  }, []);
  const onWalk = useCallback((mode: string) => change({ follow: { kind: 'walk', mode: mode as LoShuWalkMode } }), []);
  const onSet = useCallback((id: string) => change({ follow: id === 'custom' ? { kind: 'set', set: 'custom', crystals: lastRef.current.custom } : { kind: 'set', set: id as SetId } }), []);
  const onCustom = useCallback((hz: number) => {
    const f = settingsRef.current.follow;
    const cur = f.kind === 'set' && f.set === 'custom' ? cleanCrystals(f.crystals ?? []) : [];
    change({ follow: { kind: 'set', set: 'custom', crystals: cleanCrystals(cur.includes(hz) ? cur.filter((c) => c !== hz) : [...cur, hz]) } });
  }, []);
  const onExp = useCallback((id: 'golden' | 'seq111' | 'source2178') => change({ follow: { kind: id } }), []);
  const onOpenCrystal = useCallback(() => actions.openLayers('crystal'), []);
  const onPer = useCallback((per: PerCrystal) => change({ per }), []);
  const onOrder = useCallback((order: string) => change({ order: order as Order }), []);
  const onToggleFilter = useCallback((facet: string, value: string) => change({ filters: toggleValue(settingsRef.current.filters, facet, value, BUILDER_FACETS) }), []);
  const onClearFilters = useCallback(() => change({ filters: NO_FILTERS }), []);
  const filtersButtonRef: { current: HTMLButtonElement | null } = useRef(null);
  const onOpenFilters = useCallback(() => setSheet('filters'), []);
  const onStartOver = useCallback(() => {
    setSrcTracks([]);
    choose(DEFAULT_SETTINGS);
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, []);
  const onPlay = useCallback(() => actions.startBuilt(effectiveRef.current, 'now'), []);
  const onNext = useCallback(() => actions.startBuilt(effectiveRef.current, 'next'), []);
  const onMore = useCallback(() => setSheet('more'), []);
  const onMoreAction = useCallback((a: 'queue' | 'save') => {
    setSheet(null); // the sheet closes first: a Dialog never sits on a Sheet
    actions.startBuilt(effectiveRef.current, a);
  }, []);
  const onAssign = useCallback(() => actions.setTab('library'), []);

  // ---- focus, scroll, the notices' spacer -------------------------------------------------------------------------
  const h1Ref: { current: HTMLHeadingElement | null } = useRef(null);
  const scrollRef: { current: HTMLDivElement | null } = useRef(null);
  // Opening focuses the heading (a passive effect: after a closing sheet has handed its focus back). Open for the
  // session again too (v16.3 review: a crash forgets it, and Reload panel brings the view back).
  useEffect(() => {
    mixesViewRef.current.builder.open = true;
    h1Ref.current?.focus();
    const el = scrollRef.current;
    if (el) el.scrollTop = mixesViewRef.current.builder.top;
    return () => {
      if (el) mixesViewRef.current.builder.top = el.scrollTop;
    };
  }, []);
  const spacerRef: { current: HTMLDivElement | null } = useRef(null);
  useNoticeSpacer(spacerRef, inPanel, true);

  const note = src.kind === 'playlist' && playlists.status === 'loading' ? 'Your playlists are still loading.' : gone ? playlistGoneLine(null) : null;
  const namedAs = summary.named ? nameOfMix(summary.named) : null;
  const sourceValue = src.kind === 'playlist' ? src.id : src.kind;

  return (
    <div data-testid="mix-builder" className={inPanel ? 'h-full flex flex-col bg-surface-panel' : 'absolute inset-0 flex flex-col bg-surface-deep pointer-events-auto'}>
      <header className="shrink-0 h-14 pl-1 pr-2 flex items-center gap-1 border-b border-line bg-surface-deep">
        <IconButton label={BACK_NAME} icon={<ArrowLeft size={20} />} onClick={onBack} />
        <h1 ref={h1Ref} tabIndex={-1} data-view-heading="" className="flex-1 min-w-0 text-lg font-semibold text-ink-strong truncate outline-none">
          {TITLE}
        </h1>
        <button
          type="button"
          data-testid="builder-start-over"
          onClick={onStartOver}
          className="shrink-0 min-h-touch px-2 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          {START_OVER}
        </button>
      </header>
      <div ref={scrollRef} data-testid="builder-scroll" className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain bg-surface-deep">
        <ViewBoundary
          name="mix-builder"
          fallback={(api) => <RegionCrash api={api} text="Create a mix hit a problem. The music and your mixes are fine." testId="mix-builder-fallback" />}
          render={() => (
            <div className="px-4 pb-6">
              <SourceSection
                kind={src.kind === 'playlist' && gone ? 'library' : src.kind}
                libraryCount={songs.length}
                playlist={pl ? { name: pl.name, present: pl.present } : null}
                playlistCount={playlists.lists.length}
                waiting={queue.waiting}
                note={note}
                onLibrary={onLibrary}
                onPlaylists={onPlaylists}
                onQueue={onQueue}
              />
              <FollowSection
                kind={kind}
                walkMode={follow.kind === 'walk' ? follow.mode : null}
                setId={setIdNow}
                expId={kind === 'exp' ? follow.kind : null}
                walks={walks}
                sets={sets}
                setCrystals={crystalsNow}
                custom={customNow}
                regimes={REGIME_GROUPS}
                crystalCounts={crystalCounts}
                exps={exps}
                onKind={onKind}
                onWalk={onWalk}
                onSet={onSet}
                onCustom={onCustom}
                onExp={onExp}
                onOpenCrystal={onOpenCrystal}
              />
              <PerSection per={perNow} line={perLine} onPer={onPer} />
              <FiltersSection chips={chips} noneLine={noFiltersLine(esrc.kind)} onRemove={onToggleFilter} onOpen={onOpenFilters} buttonRef={filtersButtonRef} />
              <OrderSection options={orders} value={effective.order} walk={follow.kind === 'walk'} onOrder={onOrder} />
            </div>
          )}
        />
      </div>
      <div className="shrink-0 bg-surface-panel border-t border-line-strong" data-region="mix-builder-footer">
        <ViewBoundary
          name="mix-builder-footer"
          fallback={(api) => <RegionCrash api={api} text="The mix's buttons hit a problem. The music and your mixes are fine." testId="mix-builder-footer-fallback" />}
          render={() => (
            <BuilderFooter
              count={summary.count}
              positions={summary.positions}
              seconds={summary.seconds}
              approx={summary.approx}
              missing={summary.missing}
              noCrystal={summary.noCrystal}
              namedAs={namedAs}
              name={summary.name}
              fromQueue={esrc.kind === 'queue'}
              queueLeft={esrc.kind === 'queue' ? queueLeftLine(summary.left, summary.approx) : null}
              emptyText={esrc.kind === 'queue' && tracks.length === 0 ? QUEUE_EMPTY_TEXT : EMPTY_TEXT}
              onPlay={onPlay}
              onNext={onNext}
              onMore={onMore}
              onAssign={onAssign}
            />
          )}
        />
      </div>
      {inPanel ? null : <div ref={spacerRef} aria-hidden="true" data-testid="builder-notice-spacer" className="shrink-0" />}
      {sheet === 'source' ? (
        <SourceSheet
          value={sourceValue}
          libraryCount={songs.length}
          waiting={queue.waiting}
          playlists={playlists.lists.map((p) => ({ id: p.id, name: p.name, present: p.present, missing: p.missing }))}
          onPick={onSourcePick}
          onClose={closeSheet}
        />
      ) : null}
      {sheet === 'filters' ? <BuilderFilterSheet index={index as unknown as FacetIndex<FilterSong>} filters={filters as Filters} onToggle={onToggleFilter} onClear={onClearFilters} onClose={closeSheet} /> : null}
      {sheet === 'more' ? (
        <BuilderMoreSheet
          count={summary.count}
          positions={summary.positions}
          seconds={summary.seconds}
          approx={summary.approx}
          name={summary.name}
          draw={follow.kind === 'walk' && RANDOM_WALKS.includes(follow.mode) && effective.order === 'pattern'}
          fromQueue={esrc.kind === 'queue'}
          onAction={onMoreAction}
          onClose={closeSheet}
        />
      ) : null}
    </div>
  );
};

export default React.memo(MixBuilder);
