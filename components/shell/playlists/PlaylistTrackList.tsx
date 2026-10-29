// components/shell/playlists/PlaylistTrackList.tsx (v16.1; spec §3.9, §3.10)
//
// A playlist's entries, ALWAYS virtualized (P4: 1,000 rows mounted cost 1.2 s on a 4× slower CPU): LibraryList's
// windowing, 64 px rows absolutely placed in a container of n × 64 px, only those in the scroller's view plus an overscan
// of 6 mounted, the range this component's own state (a scroll step re-renders the few rows that come and go, never
// App). The roving tab stop's row is always mounted, and so is a lifted row, so the focus and a drag survive scrolling.
// Keyboard (role="list"): Tab enters once (the playing entry if listed, else the first); ↑/↓ one row, PageUp/PageDown a
// screen, Home/End the ends; Enter plays from the row; → moves to its ⋯ and ← back; Shift+F10 / ContextMenu opens it.
// Edit mode: the row's first control is its drag handle; reordering reuses v16.0's useSortable (drag by the handle with
// edge auto-scroll, Space/Enter lift, ↑/↓ move, Space/Enter drop, Escape puts it back, Alt+↑/↓ at once), with its three
// v16.1 options for a virtualized list (rowAt, slotTopOf, rowHeight). Only the drop writes (one editPlaylist).
// React.memo; it reads no context (its rows come from the view), so the clock never reaches it.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlaylistEntryValue } from '../contexts';
import { countRender } from '../devRenders';
import { useSortable } from '../queue/useSortable';
import PlaylistTrackRow, { ROW_PX } from './PlaylistTrackRow';
import { cancelledText, droppedText, goneText, movingText } from './playlistsViewModel';

export const OVERSCAN = 6;
const HANDLE_HELP_ID = 'playlist-handle-help';

interface PlaylistTrackListProps {
  rows: PlaylistEntryValue[];
  /** The entry playing now (this playlist plays), or -1; and whether the music plays. */
  current: number;
  isPlaying: boolean;
  editing: boolean;
  /** The view's scroller (this list's offsetParent). */
  scrollRef: { current: HTMLDivElement | null };
  listRef: { current: HTMLDivElement | null };
  onPlay: (index: number) => void;
  onMenu: (index: number, opener: HTMLElement) => void;
  /** A drop (edit mode): the entry's index and the index it goes to; false when nothing moved. */
  onDrop: (from: number, to: number) => boolean | void;
  /** The view's live region. */
  say: (text: string) => void;
  /** Escape / Done ask it first: a lifted row is put back instead. */
  cancelRef: { current: (() => boolean) | null };
}

interface Range {
  start: number;
  end: number;
}

const PlaylistTrackList = ({ rows, current, isPlaying, editing, scrollRef, listRef, onPlay, onMenu, onDrop, say, cancelRef }: PlaylistTrackListProps) => {
  countRender('PlaylistTrackList');
  const rowsRef: { current: PlaylistEntryValue[] } = useRef(rows);
  rowsRef.current = rows;
  const [range, setRange] = useState<Range>({ start: 0, end: Math.min(rows.length, 20) });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const lastActiveRef: { current: number } = useRef(0);
  const pendingFocusRef: { current: { index: number; menu: boolean } | null } = useRef(null);

  const keys = useMemo(() => rows.map((r: PlaylistEntryValue) => r.key), [rows]);
  const indexByKey = useMemo(() => {
    const m = new Map<string, number>();
    keys.forEach((k: string, i: number) => m.set(k, i));
    return m;
  }, [keys]);

  const nameOf = (key: string) => {
    const r = rowsRef.current.find((x: PlaylistEntryValue) => x.key === key);
    return r ? (r.song ? r.song.name : r.name) : '';
  };
  const sortable = useSortable({
    keys,
    listRef,
    scrollRef,
    onDrop: (from: number, to: number) => {
      const t = Math.max(0, Math.min(rowsRef.current.length - 1, to));
      if (t === from) return false;
      const r = onDrop(from, t);
      if (r !== false) pendingFocusRef.current = { index: t, menu: false };
      return r;
    },
    announce: (kind, key, at) => {
      const n = rowsRef.current.length;
      const name = nameOf(key);
      if (kind === 'gone') say(goneText(name));
      else say(kind === 'moving' ? movingText(name, at + 1, n) : kind === 'dropped' ? droppedText(at + 1) : cancelledText(name, at + 1));
    },
    cancelRef,
    rowAt: (i: number) => listRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`) ?? null,
    slotTopOf: (i: number) => i * ROW_PX,
    rowHeight: ROW_PX,
  });
  const lifted = editing ? sortable.lifted : null;

  // The roving tab stop: the row last focused, else the playing entry, else the first.
  let activeIndex = -1;
  if (rows.length > 0) {
    const byActive = activeKey !== null ? indexByKey.get(activeKey) : undefined;
    activeIndex =
      byActive !== undefined
        ? byActive
        : activeKey !== null
          ? Math.min(rows.length - 1, Math.max(0, lastActiveRef.current))
          : current >= 0 && current < rows.length
            ? current
            : 0;
  }
  lastActiveRef.current = activeIndex;

  /** The list's top in the scroller's content (its offsetParent may be a positioned wrapper). */
  const listTop = (sc: HTMLElement, list: HTMLElement): number => list.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  const recompute = useCallback(() => {
    const sc = scrollRef.current;
    const list = listRef.current;
    if (!sc || !list) return;
    const n = rowsRef.current.length;
    const into = sc.scrollTop - listTop(sc, list);
    const first = Math.floor(Math.max(0, into) / ROW_PX);
    const start = Math.min(n, Math.max(0, first - OVERSCAN));
    const end = Math.min(n, first + Math.ceil(sc.clientHeight / ROW_PX) + 1 + OVERSCAN);
    setRange((r: Range) => (r.start === start && r.end === end ? r : { start, end }));
  }, []);
  useLayoutEffect(() => {
    recompute();
  }, [rows, recompute, editing]);
  useEffect(() => {
    const sc = scrollRef.current;
    const list = listRef.current;
    if (!sc) return;
    sc.addEventListener('scroll', recompute, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => recompute()) : null;
    ro?.observe(sc);
    if (list?.parentElement && list.parentElement !== sc) ro?.observe(list.parentElement);
    return () => {
      sc.removeEventListener('scroll', recompute);
      ro?.disconnect();
    };
  }, [recompute]);

  // A keyboard move's focus (or a drop's), once the row is mounted.
  useLayoutEffect(() => {
    const want = pendingFocusRef.current;
    if (!want) return;
    pendingFocusRef.current = null;
    listRef.current?.querySelector<HTMLElement>(want.menu ? `[data-row-menu="${want.index}"]` : `[data-row-index="${want.index}"]`)?.focus();
  });

  const onFocusRow = useCallback((index: number) => {
    const r = rowsRef.current[index];
    if (r) setActiveKey((prev: string | null) => (prev === r.key ? prev : r.key));
  }, []);

  /** Scroll row `i` fully into the scroller's view (nearest edge). */
  const reveal = (i: number) => {
    const sc = scrollRef.current;
    const list = listRef.current;
    if (!sc || !list) return;
    const top = listTop(sc, list) + i * ROW_PX;
    if (top < sc.scrollTop) sc.scrollTop = top;
    else if (top + ROW_PX > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + ROW_PX - sc.clientHeight;
  };
  const go = (i: number, menu = false) => {
    const n = rowsRef.current.length;
    if (!n) return;
    const j = Math.min(n - 1, Math.max(0, i));
    reveal(j);
    pendingFocusRef.current = { index: j, menu };
    const key = rowsRef.current[j].key;
    if (key === activeKey) {
      pendingFocusRef.current = null;
      listRef.current?.querySelector<HTMLElement>(menu ? `[data-row-menu="${j}"]` : `[data-row-index="${j}"]`)?.focus();
    } else {
      setActiveKey(key);
    }
  };

  const onKeyDown = (e: KeyboardEvent & { target: EventTarget | null; defaultPrevented: boolean }) => {
    if (e.defaultPrevented || lifted) return; // the handle's own keys (a lift, Alt+arrow)
    const t = e.target as HTMLElement | null;
    if (!t || !t.dataset) return;
    const onMenuButton = t.dataset.rowMenu !== undefined && t.dataset.rowIndex === undefined;
    const raw = t.dataset.rowIndex ?? t.dataset.rowMenu;
    if (raw === undefined) return;
    const i = Number(raw);
    const sc = scrollRef.current;
    const pageRows = Math.max(1, Math.floor((sc?.clientHeight ?? ROW_PX * 2) / ROW_PX) - 1);
    const n = rowsRef.current.length;
    if ((e.key === 'F10' && (e as any).shiftKey) || e.key === 'ContextMenu') {
      const opener = listRef.current?.querySelector<HTMLElement>(`[data-row-menu="${i}"]`) ?? t;
      onMenu(i, opener);
    } else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'PageDown') go(i + pageRows);
    else if (e.key === 'PageUp') go(i - pageRows);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(n - 1);
    else if (e.key === 'ArrowRight' && !onMenuButton && t.dataset.rowMenu === undefined) listRef.current?.querySelector<HTMLElement>(`[data-row-menu="${i}"]`)?.focus();
    else if (e.key === 'ArrowLeft' && onMenuButton) listRef.current?.querySelector<HTMLElement>(`[data-row-index="${i}"]`)?.focus();
    else return;
    e.preventDefault();
  };

  const mounted = new Set<number>();
  const end = Math.min(range.end, rows.length);
  for (let i = range.start; i < end; i++) mounted.add(i);
  if (activeIndex >= 0) mounted.add(activeIndex);
  if (lifted) mounted.add(lifted.from);
  const items = [...mounted].sort((a, b) => a - b).map((i: number) => {
    const r = rows[i];
    const off = lifted ? sortable.offsetOf(i) : 0;
    const isLifted = !!lifted && lifted.from === i;
    const offset = isLifted ? (lifted!.mode === 'keyboard' ? off : null) : off || null;
    return (
      <PlaylistTrackRow
        key={r.key}
        rowKey={r.key}
        index={i}
        size={rows.length}
        name={r.name}
        file={r.file}
        song={r.song}
        current={!editing && i === current}
        paused={!editing && i === current && !isPlaying}
        active={i === activeIndex}
        editing={editing}
        lifted={isLifted}
        offset={offset}
        handle={editing ? sortable.handleProps(r.key) : null}
        describedBy={HANDLE_HELP_ID}
        onPlay={onPlay}
        onMenu={onMenu}
        onFocusRow={onFocusRow}
      />
    );
  });

  return (
    <>
      <div
        ref={listRef}
        role="list"
        aria-label="Tracks in this playlist"
        tabIndex={-1}
        data-testid="playlist-tracks"
        onKeyDown={onKeyDown}
        className="relative outline-none border-t border-line"
        style={{ height: rows.length * ROW_PX }}
      >
        {items}
        {lifted ? (
          <div
            aria-hidden="true"
            data-testid="playlist-placeholder"
            className="absolute inset-x-0 mx-1 rounded-card border border-dashed border-line-strong pointer-events-none"
            style={{ top: sortable.slotTop(lifted.target), height: ROW_PX }}
          />
        ) : null}
      </div>
      {editing ? (
        <p id={HANDLE_HELP_ID} className="sr-only">
          Press Space to pick the track up, the arrow keys to move it, Space to drop it, Escape to put it back. Alt with an arrow key moves it at once.
        </p>
      ) : null}
    </>
  );
};

export default React.memo(PlaylistTrackList);
