// components/shell/library/LibraryList.tsx (v15.7, the Library tab)
//
// The virtualized list (spec §3.6): 64 px rows, absolutely placed in a container of n × 64 px (no spacer divs), only
// those in the scroller's view plus an overscan of 6 mounted. The range is this component's own state, set from a
// passive scroll listener and a ResizeObserver only when it changes: a scroll step re-renders the few rows that come and
// go, never App (classic's range is App state: 231 components per step, measured). The roving tab stop's row is always
// mounted too, so the focus is never lost to <body> by scrolling.
//
// Keyboard (role="list" "Library tracks"; each row a listitem with its position): Tab enters once, at the playing row
// if listed, else the first; ↑/↓ one row, PageUp/PageDown a screen, Home/End the ends (the row scrolls into view);
// Enter or Space plays; → moves to the row's ⋯ and ← back; Shift+F10 or the ContextMenu key opens the menu. The list
// element itself takes the focus only as the delete Dialog's fallback, and hands it to the nearest row.
// React.memo; it reads no context (its rows' props come from the tab), so the clock never reaches it.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import LibraryRow, { ROW_PX } from './LibraryRow';

export const OVERSCAN = 6;

interface LibraryListProps {
  view: Song[];
  trackId: string | null;
  /** The music plays (the current row says Playing; else Paused). */
  isPlaying: boolean;
  /** Changes with the query and the sort: a new one starts at the top. */
  resetKey: string;
  /** The tab's scroller (this list's offsetParent). */
  scrollRef: { current: HTMLDivElement | null };
  onPlay: (id: string) => void;
  onMenu: (id: string, opener: HTMLElement) => void;
  /** The list element, for the delete Dialog's focus fallback. */
  listRef: { current: HTMLDivElement | null };
  /** Where the scroller was left (the tab reopening): applied once (then zeroed), before the first range, so no frame
   *  shows the top. A list mounted again later (after "no results") starts at the top. */
  initialTopRef: { current: number };
  /** The scroll position the tab keeps (libraryViewRef.top), zeroed with a reset. */
  onReset: () => void;
}

interface Range {
  start: number;
  end: number;
}

const LibraryList = ({ view, trackId, isPlaying, resetKey, scrollRef, onPlay, onMenu, listRef, initialTopRef, onReset }: LibraryListProps) => {
  countRender('LibraryList');
  const viewRef: { current: Song[] } = useRef(view);
  viewRef.current = view;
  const [range, setRange] = useState<Range>({ start: 0, end: Math.min(view.length, 20) });
  const [activeId, setActiveId] = useState<string | null>(null);
  const lastActiveRef: { current: number } = useRef(0);
  const pendingFocusRef: { current: { index: number; menu: boolean } | null } = useRef(null);

  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    view.forEach((s: Song, i: number) => m.set(s.id, i));
    return m;
  }, [view]);

  // The roving tab stop: the row last focused, else the playing row, else the first. A row gone (deleted, filtered
  // out) hands it to the row now at its place, so the focus goes to the next row.
  let activeIndex = -1;
  if (view.length > 0) {
    const byActive = activeId !== null ? indexById.get(activeId) : undefined;
    const byTrack = trackId !== null ? indexById.get(trackId) : undefined;
    activeIndex =
      byActive !== undefined
        ? byActive
        : activeId !== null
          ? Math.min(view.length - 1, Math.max(0, lastActiveRef.current))
          : byTrack !== undefined
            ? byTrack
            : 0;
  }
  lastActiveRef.current = activeIndex;

  const recompute = useCallback(() => {
    const sc = scrollRef.current;
    const list = listRef.current;
    if (!sc || !list) return;
    const n = viewRef.current.length;
    // One anchor (the first row in view) moves both ends together: one commit per row crossed, not two.
    const into = sc.scrollTop - list.offsetTop;
    const first = Math.floor(Math.max(0, into) / ROW_PX);
    const start = Math.min(n, Math.max(0, first - OVERSCAN));
    const end = Math.min(n, first + Math.ceil(sc.clientHeight / ROW_PX) + 1 + OVERSCAN);
    setRange((r: Range) => (r.start === start && r.end === end ? r : { start, end }));
  }, []);

  const shownKey: { current: string } = useRef(resetKey);
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc && initialTopRef.current > 0) sc.scrollTop = initialTopRef.current;
    initialTopRef.current = 0;
    if (shownKey.current !== resetKey) {
      // A new query or sort: the top, before the range (this runs before the tab's own effects).
      shownKey.current = resetKey;
      if (sc) sc.scrollTop = 0;
      onReset();
    }
    recompute();
  }, [view, recompute, resetKey]);
  useEffect(() => {
    const sc = scrollRef.current;
    const list = listRef.current;
    if (!sc) return;
    sc.addEventListener('scroll', recompute, { passive: true });
    // The scroller's size, and its content (the tab's content wrapper: the health card folding moves the list).
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => recompute()) : null;
    ro?.observe(sc);
    if (list?.parentElement && list.parentElement !== sc) ro?.observe(list.parentElement);
    return () => {
      sc.removeEventListener('scroll', recompute);
      ro?.disconnect();
    };
  }, [recompute]);

  // A keyboard move's focus, once the row is mounted.
  useLayoutEffect(() => {
    const want = pendingFocusRef.current;
    if (!want) return;
    pendingFocusRef.current = null;
    const el = listRef.current?.querySelector<HTMLElement>(want.menu ? `[data-row-menu="${want.index}"]` : `[data-row-index="${want.index}"]`);
    el?.focus();
  });

  const onFocusRow = useCallback((index: number) => {
    const s = viewRef.current[index];
    if (s) setActiveId((prev: string | null) => (prev === s.id ? prev : s.id));
  }, []);

  /** Scroll row `i` fully into the scroller's view (nearest edge). */
  const reveal = (i: number) => {
    const sc = scrollRef.current;
    const list = listRef.current;
    if (!sc || !list) return;
    const top = list.offsetTop + i * ROW_PX;
    if (top < sc.scrollTop) sc.scrollTop = top;
    else if (top + ROW_PX > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + ROW_PX - sc.clientHeight;
  };

  const go = (i: number, menu = false) => {
    const n = viewRef.current.length;
    if (!n) return;
    const j = Math.min(n - 1, Math.max(0, i));
    reveal(j);
    pendingFocusRef.current = { index: j, menu };
    const id = viewRef.current[j].id;
    if (id === activeId) {
      // No re-render would come: focus now.
      pendingFocusRef.current = null;
      listRef.current?.querySelector<HTMLElement>(menu ? `[data-row-menu="${j}"]` : `[data-row-index="${j}"]`)?.focus();
    } else {
      setActiveId(id);
    }
  };

  const onKeyDown = (e: KeyboardEvent & { target: EventTarget | null }) => {
    const t = e.target as HTMLElement | null;
    if (!t || !t.dataset) return;
    const onMenuButton = t.dataset.rowMenu !== undefined;
    const raw = onMenuButton ? t.dataset.rowMenu : t.dataset.rowIndex;
    if (raw === undefined) return;
    const i = Number(raw);
    const sc = scrollRef.current;
    const pageRows = Math.max(1, Math.floor((sc?.clientHeight ?? ROW_PX * 2) / ROW_PX) - 1);
    const n = viewRef.current.length;
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      const s = viewRef.current[i];
      const opener = listRef.current?.querySelector<HTMLElement>(`[data-row-menu="${i}"]`) ?? t;
      if (s) onMenu(s.id, opener);
    } else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'PageDown') go(i + pageRows);
    else if (e.key === 'PageUp') go(i - pageRows);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(n - 1);
    else if (e.key === 'ArrowRight' && !onMenuButton) listRef.current?.querySelector<HTMLElement>(`[data-row-menu="${i}"]`)?.focus();
    else if (e.key === 'ArrowLeft' && onMenuButton) listRef.current?.querySelector<HTMLElement>(`[data-row-index="${i}"]`)?.focus();
    else return;
    e.preventDefault();
  };

  // The list itself took the focus (the delete Dialog's fallback): hand it to the row at the tab stop.
  const onFocus = (e: FocusEvent & { target: EventTarget | null; currentTarget: EventTarget | null }) => {
    if (e.target !== e.currentTarget || activeIndex < 0) return;
    go(activeIndex);
  };

  const rows = [];
  const end = Math.min(range.end, view.length);
  for (let i = range.start; i < end; i++) {
    const s = view[i];
    rows.push(
      <LibraryRow
        key={s.id}
        song={s}
        index={i}
        size={view.length}
        current={s.id === trackId}
        paused={s.id === trackId && !isPlaying}
        active={i === activeIndex}
        onPlay={onPlay}
        onMenu={onMenu}
        onFocusRow={onFocusRow}
      />
    );
  }
  if (activeIndex >= 0 && (activeIndex < range.start || activeIndex >= end)) {
    const s = view[activeIndex];
    rows.push(
      <LibraryRow
        key={s.id}
        song={s}
        index={activeIndex}
        size={view.length}
        current={s.id === trackId}
        paused={s.id === trackId && !isPlaying}
        active
        onPlay={onPlay}
        onMenu={onMenu}
        onFocusRow={onFocusRow}
      />
    );
  }

  return (
    <div
      ref={listRef}
      role="list"
      aria-label="Library tracks"
      tabIndex={-1}
      data-testid="library-list"
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className="relative outline-none"
      style={{ height: view.length * ROW_PX }}
    >
      {rows}
    </div>
  );
};

export default React.memo(LibraryList);
