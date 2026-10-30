// components/shell/library/LibraryTracks.tsx (v16.1: v15.7's Library tab body, moved here verbatim from LibraryTab.tsx;
// spec §3.15's seam: v16.2's filter chips and v16.5's badges land here, not in the switch)
//
// Always the whole library (classic's panel lists the play order). The search row that never scrolls, then the
// scroller: the summary line ("440 tracks · 4 h 2 min · Playing from your library", or the match count while
// searching), the health card (its own region; hidden while searching) and the virtualized list (its own region). A row
// tap plays the whole library from that track, in the list's sort (decision 2 A), through App's playFromLibrary; a search
// never narrows what plays. The ⋯ opens the row menu, and Track info, both local state here (App gains no sheet for
// them). Empty: "Your library is empty" and Import music.
// It reopens where it was left (App's libraryViewRef: the query, the scroll, the card's fold; session only); the sort
// is saved as aetheria.librarySort.v1 from the select only. The query is local state with useDeferredValue, so App never
// renders for a keystroke. React.memo; nothing here reads the time. Its render count keeps v15.7's name, 'LibraryTab'
// (the tests count the Tracks body's renders).
// v16.0: the row menu's Play next and Add to queue (App's queueTracks; the sheet closes first, the tab stays, the toast
// confirms), and the rows' queue marks (QueueContext: never the clock).
// v16.1: the row menu's "Add to playlist…" (the Add to playlist sheet, after this menu closes).
// v16.2, smart filters (decisions 1 A and 2 A; mockups tracks-A-phone, tracks-filtered-phone, filter-empty-phone): the
// picks are local state here, read once from aetheria.libraryFilters.v1 and saved from a tap only (a chip, a chip's ×,
// Clear, the empty card's Remove); App never renders for one. Each tap also leaves them in App's libraryViewRef, so a
// full or blocked storage keeps them for the session across this view's remounts (review fix). The list is one pass
// over the library's index (the filters' model: the picks AND the search, OR within a facet), memoised on the sorted
// list, the picks and the deferred query. While a chip is on, the top of the list is the filter bar ("N of M", Clear filters, the picks, what a tap
// plays, Play these / Shuffle / ⋯) and a row's tap plays the shown tracks from that one (App's playFiltered); with no
// chip on, a search and a row's tap are v15.7's. The row menu's Play from here stays "your library" (its own words). The
// health card hides while filtered, as while searching. Filters narrow only what this list shows: the library, the
// play order (until an action's tap), the switch's count and every other view see every track.

import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SearchX } from 'lucide-react';
import EmptyState from '../../ui/EmptyState';
import { PanelFallback, ViewBoundary } from '../../ErrorBoundary';
import type { FallbackApi } from '../../ErrorBoundary';
import type { Song } from '../../../types';
import { useActions, useExportActions, useLibraryList, useLibrarySummary, useMore, usePlayer, useQueue, useShell, useWalk } from '../contexts';
import type { LibraryViewState } from '../contexts';
import { addToQueueLine, playNextLine } from '../queue/queueViewModel';
import { countRender } from '../devRenders';
import SearchSortRow from './SearchSortRow';
import LibraryList from './LibraryList';
import RowMenu from './RowMenu';
import type { RowMenuAction } from './RowMenu';
import TrackInfoDialog from './TrackInfoDialog';
import HealthCard from './HealthCard';
import FilterSheet from './FilterSheet';
import ActiveChips from './ActiveChips';
import FilterActionsSheet from './FilterActionsSheet';
import type { FilterAction } from './FilterActionsSheet';
import { FROM_FILTERS, emptyHintLine, emptyTitle, removeFacetText, saveSentence } from './filterViewModel';
import {
  LIBRARY_FILTERS_KEY,
  NO_FILTERS,
  activeChips,
  buildFacetIndex,
  emptyHint,
  filterName,
  filterPass,
  filtersOn,
  parseFilters,
  serializeFilters,
  toggleRegime,
  toggleValue,
  withFacet,
} from '../../../utils/library/filterModel';
import type { FilterSong, Filters } from '../../../utils/library/filterModel';
import {
  FORMATS_LINE,
  LIBRARY_SORT_KEY,
  SEARCH_HINT,
  matchCountText,
  parseLibrarySort,
  playingFromText,
  sortLibrary,
  summaryText,
} from './libraryModel';
import type { LibrarySort } from './libraryModel';

interface LibraryTracksProps {
  /** In the desktop shell's 420 px panel, else the phone's full tab. */
  inPanel?: boolean;
  /** The Import sheet (the header's Import, and the empty state's). */
  onImport: () => void;
}

const SUMMARY_ID = 'library-summary-line';

/** v16.2: the saved picks, read once at mount; anything unreadable is no filters (never an error, never a write).
 *  Review fix: this view remounts on every tab and Tracks ⇄ Playlists switch, so the session's picks (App's
 *  libraryViewRef, set by every tap) come back instead when their save failed (full or blocked storage: the stored
 *  value is stale) or the read fails; "a full or blocked storage keeps the filters for the session". */
function readFilters(session: LibraryViewState['filters']): Filters {
  if (session?.unsaved) return session.picks;
  try {
    return parseFilters(typeof localStorage !== 'undefined' ? localStorage.getItem(LIBRARY_FILTERS_KEY) : null);
  } catch {
    return session ? session.picks : NO_FILTERS;
  }
}

function readSort(): LibrarySort {
  try {
    return parseLibrarySort(typeof localStorage !== 'undefined' ? localStorage.getItem(LIBRARY_SORT_KEY) : null);
  } catch {
    return 'library';
  }
}

const RegionCrash = ({ api, text, testId }: { api: FallbackApi; text: string; testId: string }) => (
  <div data-testid={testId} className="mx-4 mb-3">
    <PanelFallback text={text} switchedOff={api.switchedOff} copyDetails={api.copyDetails} buttonRef={api.buttonRef} onRetry={api.retry} />
  </div>
);

const LibraryTracks = ({ inPanel = false, onImport }: LibraryTracksProps) => {
  countRender('LibraryTab');
  const actions = useActions();
  const { songs } = useLibraryList();
  const { trackId, hasTrack, isPlaying } = usePlayer();
  const lib = useLibrarySummary();
  const walk = useWalk();
  const queue = useQueue();
  const { libraryViewRef } = useShell();
  const { scanScores: scanScoresOn } = useMore(); // v16.5: Advanced's experimental scan scores (the rows' badges)
  const exportActions = useExportActions(); // v16.5: the row ⋯'s Export with layers…
  const menuLines = useMemo(
    () => ({ next: playNextLine(queue.nothingCurrent), queue: addToQueueLine(queue.waiting, queue.nothingCurrent) }),
    [queue.nothingCurrent, queue.waiting]
  );

  const [query, setQueryState] = useState<string>(() => libraryViewRef.current.query);
  const deferredQuery = useDeferredValue(query);
  const [sort, setSortState] = useState<LibrarySort>(readSort);
  const sorted = useMemo(() => sortLibrary(songs, sort), [songs, sort]);
  const total = sorted.length;
  // v16.2: the picks, the index (once per library or sort change) and the pass (the list AND every chip's count).
  const [filters, setFiltersState] = useState<Filters>(() => readFilters(libraryViewRef.current.filters));
  const filtersRef: { current: Filters } = useRef(filters);
  filtersRef.current = filters;
  const index = useMemo(() => buildFacetIndex(sorted as FilterSong[]), [sorted]);
  const pass = useMemo(() => filterPass(index, filters, deferredQuery), [index, filters, deferredQuery]);
  const view = pass.results as Song[];
  // What a row's tap, Play these, Shuffle and the ⋯ items act on: the list as COMMITTED (review fix). Set after the
  // commit, never during the render: `view` follows the deferred query, whose background render can be interrupted or
  // thrown away, so a render-time write could hand a tap a list the screen doesn't show (yet, or ever). No test pins
  // this (an interrupted background render can't be made to happen on cue), so no mutation of it is caught.
  const viewRef: { current: Song[] } = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  const on = filtersOn(filters);
  const chips = useMemo(() => activeChips(filters), [filters]);
  const filtersKey = useMemo(() => serializeFilters(filters), [filters]);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const filtersButtonRef: { current: HTMLButtonElement | null } = useRef(null);
  const sortedRef: { current: Song[] } = useRef(sorted);
  sortedRef.current = sorted;
  const sortRef: { current: LibrarySort } = useRef(sort);
  sortRef.current = sort;

  const scrollRef: { current: HTMLDivElement | null } = useRef(null);
  const listRef: { current: HTMLDivElement | null } = useRef(null);
  const inputRef: { current: HTMLInputElement | null } = useRef(null);
  const initialTopRef: { current: number } = useRef(libraryViewRef.current.top);

  const [menuId, setMenuId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);

  const setQuery = useCallback((q: string) => {
    libraryViewRef.current.query = q;
    setQueryState(q);
  }, []);
  const setSort = useCallback((s: LibrarySort) => {
    setSortState(s);
    try {
      localStorage.setItem(LIBRARY_SORT_KEY, s);
    } catch {}
  }, []);
  /** v16.2: a tap's new picks, saved (removed when none is left). Only taps call this; a full or blocked storage keeps
   *  the picks for the session (review fix: in App's libraryViewRef too, which outlives this view, with whether the
   *  save failed, so a remount brings these back rather than the stale stored value). */
  const setFilters = useCallback((next: Filters) => {
    filtersRef.current = next;
    setFiltersState(next);
    let unsaved = false;
    try {
      if (filtersOn(next)) localStorage.setItem(LIBRARY_FILTERS_KEY, serializeFilters(next));
      else localStorage.removeItem(LIBRARY_FILTERS_KEY);
    } catch {
      unsaved = true;
    }
    libraryViewRef.current.filters = { picks: next, unsaved };
  }, []);
  const onToggle = useCallback((facet: string, value: string) => {
    const f = filtersRef.current;
    setFilters(facet === 'regime' ? toggleRegime(f, value as 'gut' | 'heart' | 'head') : toggleValue(f, facet, value));
  }, []);
  const clearFilters = useCallback(() => {
    if (filtersOn(filtersRef.current)) setFilters(NO_FILTERS);
  }, []);
  const openFilters = useCallback(() => {
    filtersButtonRef.current?.focus(); // the sheet gives the focus back to what had it
    setFilterSheetOpen(true);
  }, []);
  const closeFilters = useCallback(() => setFilterSheetOpen(false), []);
  const filtersProp = useMemo(() => ({ on: chips.length, onOpen: openFilters, buttonRef: filtersButtonRef }), [chips.length]);

  // A new query or sort starts at the top of the list (LibraryList scrolls before it computes its range).
  const resetKey = `${sort}|${deferredQuery}|${filtersKey}`;
  const onReset = useCallback(() => {
    libraryViewRef.current.top = 0;
  }, []);

  // Desktop: the Import sheet takes the panel, so this tab unmounts; when the sheet closes and the tab comes back, the
  // focus returns to the button that opened it (Import, or the health card's Review).
  useLayoutEffect(() => {
    const back = libraryViewRef.current.refocus;
    if (!back) return;
    libraryViewRef.current.refocus = null;
    const el = document.querySelector<HTMLElement>(back === 'review' ? '[data-testid="health-orphans-action"]' : '[data-testid="library-import"]');
    el?.focus();
  }, []);

  // On the phone the notices (the Undo toast, the update banner) sit over the bottom of the list, above the mini-player:
  // a spacer as tall as they are ends the scroller, so every row can scroll clear of them. Set on the element (no render).
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
  }, [inPanel, total > 0]);

  // The delete Dialog's focus fallback: the list (it hands the focus to the next row).
  useEffect(() => {
    actions.setLibraryFocusTarget(listRef.current);
  });
  useEffect(() => () => actions.setLibraryFocusTarget(null), []);

  // A row's tap: the whole library, in the list's sort (the library's own order: null), from that track.
  const playLibraryFrom = useCallback((id: string) => {
    actions.playFromLibrary(id, sortRef.current === 'library' ? null : sortedRef.current.map((s: Song) => s.id));
  }, []);
  // v16.2 (decision 1 A): with a chip on, the shown tracks from that one (the picks AND the search, in the list's order).
  const onPlay = useCallback((id: string) => {
    const f = filtersRef.current;
    if (filtersOn(f)) actions.playFiltered({ ids: viewRef.current.map((s: Song) => s.id), startId: id, label: filterName(f), row: true });
    else playLibraryFrom(id);
  }, []);
  // v16.2: Play these and Shuffle (the shown tracks, from the first; or shuffled, the switch on).
  const onPlayThese = useCallback(() => {
    actions.playFiltered({ ids: viewRef.current.map((s: Song) => s.id), label: filterName(filtersRef.current) });
  }, []);
  const onShuffleThese = useCallback(() => {
    actions.playFiltered({ ids: viewRef.current.map((s: Song) => s.id), label: filterName(filtersRef.current), shuffle: true });
  }, []);
  const onMore = useCallback((opener: HTMLElement) => {
    opener.focus();
    setActionsOpen(true);
  }, []);
  // The ⋯ sheet's items: it closes first (a Dialog never sits on a Sheet), then acts on the shown tracks, in order.
  const onFilterAction = useCallback((a: FilterAction) => {
    setActionsOpen(false);
    const ids = viewRef.current.map((s: Song) => s.id);
    if (!ids.length) return;
    const name = filterName(filtersRef.current);
    if (a === 'next' || a === 'queue') actions.queueTracks(ids, a, FROM_FILTERS);
    else if (a === 'playlist') actions.addToPlaylist(ids);
    else actions.savePlaylist({ kind: 'ids', ids, label: name, from: { kind: 'filter', label: name }, sentence: saveSentence(ids.length) });
  }, []);
  const closeActions = useCallback(() => setActionsOpen(false), []);
  const removeFacet = useCallback((facet: string) => setFilters(withFacet(filtersRef.current, facet, [])), []);
  const onMenu = useCallback((id: string, opener: HTMLElement) => {
    opener.focus();
    setMenuId(id);
  }, []);
  const menuSong = menuId !== null ? (songs.find((s: Song) => s.id === menuId) ?? null) : null;
  const infoSong = infoId !== null ? (songs.find((s: Song) => s.id === infoId) ?? null) : null;
  useEffect(() => {
    if (menuId !== null && !menuSong) setMenuId(null);
    if (infoId !== null && !infoSong) setInfoId(null);
  }, [menuId, menuSong, infoId, infoSong]);
  // Review fix: a sheet whose content went (the shown set emptied under the ⋯ sheet; the library under Filters) is
  // closed for good, not just hidden, so it never opens again by itself when the set or the library comes back.
  const actionsShown = on && view.length > 0;
  useEffect(() => {
    if (actionsOpen && !actionsShown) setActionsOpen(false);
    if (filterSheetOpen && total === 0) setFilterSheetOpen(false);
  }, [actionsOpen, actionsShown, filterSheetOpen, total]);
  const onMenuAction = (a: RowMenuAction) => {
    const id = menuId;
    setMenuId(null); // the sheet closes first: a Dialog never sits on a Sheet
    if (id === null) return;
    if (a === 'play') playLibraryFrom(id); // "Your library, starting with this track" (its words), filtered or not
    else if (a === 'next' || a === 'queue') actions.queueTracks([id], a);
    else if (a === 'playlist') actions.addToPlaylist([id]); // v16.1: the Add to playlist sheet
    else if (a === 'info') setInfoId(id);
    else if (a === 'export') exportActions.open({ kind: 'track', id }); // v16.5
    else actions.requestDelete(id);
  };

  const searching = deferredQuery.trim() !== '';
  const hint = on && view.length === 0 ? emptyHint(pass, filters) : null;
  const summary = searching
    ? `${matchCountText(view.length, total)} · ${SEARCH_HINT}`
    : summaryText(total, lib.totalSeconds, playingFromText({ hasTrack, walkName: walk.name, sameIds: lib.playOrderIsLibrary, orderCount: lib.playOrderCount, scanning: lib.isScanning }));

  return (
    <>
      {total > 0 ? (
        <SearchSortRow query={query} onQuery={setQuery} sort={sort} onSort={setSort} total={total} describedBy={SUMMARY_ID} inputRef={inputRef} filters={filtersProp} />
      ) : null}
      <div
        ref={scrollRef}
        data-testid="library-scroll"
        onScroll={() => {
          if (scrollRef.current) libraryViewRef.current.top = scrollRef.current.scrollTop;
        }}
        className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain bg-surface-deep"
      >
        {total > 0 ? (
          <div data-testid="library-content">
            {on ? (
              <ViewBoundary
                name="library-filter-bar"
                fallback={(api) => <RegionCrash api={api} text="The filters bar hit a problem. Your tracks and their stored audio are safe." testId="library-filter-bar-fallback" />}
                render={() => (
                  <ActiveChips
                    summaryId={SUMMARY_ID}
                    shown={view.length}
                    total={total}
                    seconds={pass.seconds}
                    chips={chips}
                    onRemove={onToggle}
                    onClear={clearFilters}
                    onPlay={onPlayThese}
                    onShuffle={onShuffleThese}
                    onMore={onMore}
                    filtersButtonRef={filtersButtonRef}
                  />
                )}
              />
            ) : (
              <p id={SUMMARY_ID} data-testid="library-summary" className="px-4 pt-3 pb-2 text-sm text-ink-muted">
                {summary}
              </p>
            )}
            {!searching && !on ? (
              <ViewBoundary
                name="library-health"
                fallback={(api) => <RegionCrash api={api} text="The library health card hit a problem." testId="library-health-fallback" />}
                render={() => <HealthCard />}
              />
            ) : null}
            <ViewBoundary
              name="library-list"
              fallback={(api) => <RegionCrash api={api} text="The track list hit a problem. Your tracks and their stored audio are safe." testId="library-list-fallback" />}
              render={() =>
                view.length > 0 ? (
                  <LibraryList
                    view={view}
                    trackId={trackId}
                    isPlaying={isPlaying}
                    resetKey={resetKey}
                    scrollRef={scrollRef}
                    onPlay={onPlay}
                    onMenu={onMenu}
                    listRef={listRef}
                    initialTopRef={initialTopRef}
                    onReset={onReset}
                    marks={queue.positions}
                    scores={scanScoresOn}
                  />
                ) : on ? (
                  <div data-testid="library-filter-empty" className="mx-4 mt-3 mb-6 p-4 rounded-card border border-dashed border-line-strong">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink-strong">
                      <SearchX size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                      {emptyTitle(deferredQuery)}
                    </p>
                    {hint ? <p className="mt-1 text-sm text-ink-muted">{emptyHintLine(hint.label, hint.count)}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {hint ? (
                        <button
                          type="button"
                          data-testid="library-filter-remove"
                          onClick={() => {
                            filtersButtonRef.current?.focus(); // review fix: the card goes with the facet (as Clear filters)
                            removeFacet(hint.facet);
                          }}
                          className="min-h-touch px-3 rounded-control border border-line-strong bg-surface-raised text-sm text-ink hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
                        >
                          {removeFacetText(hint.label)}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          filtersButtonRef.current?.focus(); // the card and the bar go with the picks
                          clearFilters();
                        }}
                        className="min-h-touch px-3 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
                      >
                        Clear filters
                      </button>
                      {!hint && searching ? (
                        <button
                          type="button"
                          onClick={() => {
                            setQuery('');
                            inputRef.current?.focus();
                          }}
                          className="min-h-touch px-3 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
                        >
                          Clear search
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div data-testid="library-no-results" className="px-4 pt-2 pb-6 text-sm text-ink-muted">
                    <p>No tracks match ‘{deferredQuery.trim()}’</p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        inputRef.current?.focus();
                      }}
                      className="mt-1 -ml-2 min-h-touch px-2 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
                    >
                      Clear search
                    </button>
                  </div>
                )
              }
            />
            <div ref={noticeSpacerRef} aria-hidden="true" data-testid="library-notice-spacer" />
          </div>
        ) : (
          <div className="px-4 pt-4 space-y-3">
            <EmptyState
              title="Your library is empty"
              body="Import music from this device. Aetheria keeps its own copy here; your files are not changed."
              actionLabel="Import music"
              onAction={onImport}
              data-testid="library-empty"
            />
            <p className="text-xs text-ink-faint">{FORMATS_LINE}</p>
          </div>
        )}
      </div>
      {menuSong ? <RowMenu song={menuSong} lines={menuLines} onAction={onMenuAction} onClose={() => setMenuId(null)} /> : null}
      {infoSong ? <TrackInfoDialog song={infoSong} onClose={() => setInfoId(null)} /> : null}
      {filterSheetOpen && total > 0 ? (
        <FilterSheet index={index} filters={filters} result={pass} onToggle={onToggle} onClear={clearFilters} onClose={closeFilters} />
      ) : null}
      {actionsOpen && actionsShown ? (
        <FilterActionsSheet shown={view.length} seconds={pass.seconds} name={filterName(filters)} onAction={onFilterAction} onClose={closeActions} />
      ) : null}
    </>
  );
};

export default React.memo(LibraryTracks);
