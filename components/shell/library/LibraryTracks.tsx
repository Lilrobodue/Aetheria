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

import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import EmptyState from '../../ui/EmptyState';
import { PanelFallback, ViewBoundary } from '../../ErrorBoundary';
import type { FallbackApi } from '../../ErrorBoundary';
import type { Song } from '../../../types';
import { useActions, useLibraryList, useLibrarySummary, usePlayer, useQueue, useShell, useWalk } from '../contexts';
import { addToQueueLine, playNextLine } from '../queue/queueViewModel';
import { countRender } from '../devRenders';
import SearchSortRow from './SearchSortRow';
import LibraryList from './LibraryList';
import RowMenu from './RowMenu';
import type { RowMenuAction } from './RowMenu';
import TrackInfoDialog from './TrackInfoDialog';
import HealthCard from './HealthCard';
import {
  FORMATS_LINE,
  LIBRARY_SORT_KEY,
  SEARCH_HINT,
  filterLibrary,
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
  const menuLines = useMemo(
    () => ({ next: playNextLine(queue.nothingCurrent), queue: addToQueueLine(queue.waiting, queue.nothingCurrent) }),
    [queue.nothingCurrent, queue.waiting]
  );

  const [query, setQueryState] = useState<string>(() => libraryViewRef.current.query);
  const deferredQuery = useDeferredValue(query);
  const [sort, setSortState] = useState<LibrarySort>(readSort);
  const sorted = useMemo(() => sortLibrary(songs, sort), [songs, sort]);
  const total = sorted.length;
  const view = useMemo(() => filterLibrary(sorted, deferredQuery), [sorted, deferredQuery]);
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

  // A new query or sort starts at the top of the list (LibraryList scrolls before it computes its range).
  const resetKey = `${sort}|${deferredQuery}`;
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
  const onPlay = useCallback((id: string) => {
    actions.playFromLibrary(id, sortRef.current === 'library' ? null : sortedRef.current.map((s: Song) => s.id));
  }, []);
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
  const onMenuAction = (a: RowMenuAction) => {
    const id = menuId;
    setMenuId(null); // the sheet closes first: a Dialog never sits on a Sheet
    if (id === null) return;
    if (a === 'play') onPlay(id);
    else if (a === 'next' || a === 'queue') actions.queueTracks([id], a);
    else if (a === 'playlist') actions.addToPlaylist([id]); // v16.1: the Add to playlist sheet
    else if (a === 'info') setInfoId(id);
    else actions.requestDelete(id);
  };

  const searching = deferredQuery.trim() !== '';
  const summary = searching
    ? `${matchCountText(view.length, total)} · ${SEARCH_HINT}`
    : summaryText(total, lib.totalSeconds, playingFromText({ hasTrack, walkName: walk.name, sameIds: lib.playOrderIsLibrary, orderCount: lib.playOrderCount, scanning: lib.isScanning }));

  return (
    <>
      {total > 0 ? (
        <SearchSortRow query={query} onQuery={setQuery} sort={sort} onSort={setSort} total={total} describedBy={SUMMARY_ID} inputRef={inputRef} />
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
            <p id={SUMMARY_ID} data-testid="library-summary" className="px-4 pt-3 pb-2 text-sm text-ink-muted">
              {summary}
            </p>
            {!searching ? (
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
                  />
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
    </>
  );
};

export default React.memo(LibraryTracks);
