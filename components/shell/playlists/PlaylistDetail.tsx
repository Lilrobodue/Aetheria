// components/shell/playlists/PlaylistDetail.tsx (v16.1; mockups playlist-detail-phone, playlist-detail-edit-phone,
// playlist-detail-dragging-phone, playlists-desktop)
//
// A playlist's own view, taking the Library tab (or the desktop's 420 px panel, which keeps its Close):
//   the header   Back ("Back to your playlists"), the name as the h1 (it takes the focus on open), and ⋯ (Rename…,
//                Duplicate, Delete playlist); in edit mode "Editing Evening" and Done (Escape leaves it too).
//   the top      "12 tracks · 48 min · 1 missing" and a quiet "Saved from Up next · changed Oct 27"; Play (gold, the one
//                gold control), Shuffle, Play next, Add to queue (a 2 × 2 grid of 44 px buttons), all off with the
//                reason when no track is present. Edit mode: "12 tracks · 1 missing", Remove missing (n), and the hint.
//   the tracks   "Tracks" with Edit, then the virtualized entries (PlaylistTrackList): a row's tap plays the playlist
//                from it; its ⋯ is PlaylistRowMenu. Empty: "No tracks yet" with Go to Tracks.
// Edits apply to the playlist, never to what is playing (decision 4 A): Play plays it as it is then. Its own region,
// `playlist-detail`: a crash keeps the music and the rest of the shell. React.memo; it never reads the time.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, EllipsisVertical, ListEnd, ListStart, Pencil, Play, Shuffle, X } from 'lucide-react';
import { PanelFallback, ViewBoundary } from '../../ErrorBoundary';
import { useActions, useExportActions, usePlayer, usePlaylists, useQueue, useShell } from '../contexts';
import type { PlaylistEntryValue } from '../contexts';
import { countRender } from '../devRenders';
import { addToQueueLine, playNextLine } from '../queue/queueViewModel';
import TrackInfoDialog from '../library/TrackInfoDialog';
import PlaylistTrackList from './PlaylistTrackList';
import PlaylistRowMenu from './PlaylistRowMenu';
import type { PlaylistRowAction } from './PlaylistRowMenu';
import PlaylistMenu from './PlaylistMenu';
import { useNoticeSpacer } from './useNoticeSpacer';
import type { PlaylistMenuAction } from './PlaylistMenu';
import {
  ALL_MISSING_REASON,
  DETAIL_EMPTY_BODY,
  DETAIL_EMPTY_TITLE,
  EDIT_HINT,
  detailFactsParts,
  editFactsParts,
  removeMissingLabel,
  rowFacts,
} from './playlistsViewModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const ACTION = `min-w-0 h-touch px-2 rounded-control flex items-center justify-center gap-2 text-sm border border-line-strong bg-surface-raised text-ink hover:border-ink-faint transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;
const PLAY = `min-w-0 h-touch px-2 rounded-control flex items-center justify-center gap-2 text-sm bg-gold-500 hover:bg-gold-400 text-black font-semibold transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;
const QUIET = `shrink-0 -mr-2 min-h-touch px-3 rounded-control text-sm text-ink-muted hover:text-ink-strong flex items-center gap-1.5 ${FOCUS}`;

const DetailBody = ({ inPanel, onGoToTracks }: { inPanel: boolean; onGoToTracks: () => void }) => {
  countRender('PlaylistDetail');
  const actions = useActions();
  const exportActions = useExportActions(); // v16.5
  const pls = usePlaylists();
  const { isPlaying } = usePlayer();
  const queue = useQueue();
  const { libraryViewRef } = useShell();
  const open = pls.open;
  const [editing, setEditing] = useState(false);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const [plMenu, setPlMenu] = useState(false);
  const [infoIndex, setInfoIndex] = useState<number | null>(null);
  const scrollRef: { current: HTMLDivElement | null } = useRef(null);
  const listRef: { current: HTMLDivElement | null } = useRef(null);
  const headingRef: { current: HTMLHeadingElement | null } = useRef(null);
  const liveRef: { current: HTMLDivElement | null } = useRef(null);
  const cancelLiftRef: { current: (() => boolean) | null } = useRef(null);
  const spacerRef: { current: HTMLDivElement | null } = useRef(null);
  useNoticeSpacer(spacerRef, inPanel, open?.id ?? null);
  const openRef: { current: typeof open } = useRef(open);
  openRef.current = open;
  const menuLines = useMemo(
    () => ({ next: playNextLine(queue.nothingCurrent), queue: addToQueueLine(queue.waiting, queue.nothingCurrent) }),
    [queue.nothingCurrent, queue.waiting]
  );
  const say = useCallback((text: string) => {
    if (liveRef.current) liveRef.current.textContent = text;
  }, []);

  // The name takes the focus when the view opens (and when another playlist opens in its place).
  const openId = open?.id ?? null;
  useLayoutEffect(() => {
    headingRef.current?.focus();
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setEditing(false);
  }, [openId]);
  // Escape leaves edit mode (a lifted row is put back first: the sortable's own listener answers first).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')) return;
      if (cancelLiftRef.current?.()) return;
      e.preventDefault();
      e.stopPropagation();
      setEditing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing]);

  const back = () => {
    libraryViewRef.current.view = 'playlists';
    actions.openPlaylist(null);
  };
  const onPlayRow = useCallback((index: number) => {
    const o = openRef.current;
    const r = o?.rows[index];
    if (o && r && r.presentIndex >= 0) actions.playPlaylist(o.id, { startAt: r.presentIndex });
  }, []);
  const onMenu = useCallback((index: number, opener: HTMLElement) => {
    opener.focus();
    setMenuIndex(index);
  }, []);
  const onDrop = useCallback((from: number, to: number) => {
    const o = openRef.current;
    const r = o?.rows[from];
    if (!o || !r) return false;
    actions.editPlaylist(o.id, { move: { from, to, key: r.key } });
    return true;
  }, []);

  if (!open) {
    return (
      <p data-testid="playlist-gone" className="px-4 pt-4 text-sm text-ink-muted">
        That playlist is no longer there.
      </p>
    );
  }
  const menuRow: PlaylistEntryValue | null = menuIndex !== null ? (open.rows[menuIndex] ?? null) : null;
  const infoRow: PlaylistEntryValue | null = infoIndex !== null ? (open.rows[infoIndex] ?? null) : null;
  const none = open.present === 0;
  const facts = editing ? editFactsParts(open.count, open.missing) : detailFactsParts(open.count, open.seconds, open.missing);

  const onRowAction = (a: PlaylistRowAction) => {
    const i = menuIndex;
    setMenuIndex(null); // the sheet closes first
    const r = i !== null ? open.rows[i] : null;
    if (i === null || !r) return;
    if (a === 'play') onPlayRow(i);
    else if (a === 'next' || a === 'queue') {
      if (r.song) actions.queueTracks([r.song.id], a);
    } else if (a === 'playlist') {
      if (r.song) actions.addToPlaylist([r.song.id]);
    } else if (a === 'info') setInfoIndex(i);
    else if (a === 'export') {
      if (r.song) exportActions.open({ kind: 'track', id: r.song.id }); // v16.5
    }
    else if (a === 'remove') actions.editPlaylist(open.id, { remove: { index: i, key: r.key } });
    else {
      const to = a === 'top' ? 0 : a === 'up' ? i - 1 : a === 'down' ? i + 1 : open.rows.length - 1;
      actions.editPlaylist(open.id, { move: { from: i, to, key: r.key } });
    }
  };
  const onPlaylistAction = (a: PlaylistMenuAction) => {
    setPlMenu(false);
    if (a === 'export') return exportActions.open({ kind: 'playlist', id: open.id }); // v16.5
    if (a === 'rename') actions.renamePlaylist(open.id);
    else if (a === 'duplicate') actions.duplicatePlaylist(open.id);
    else actions.deletePlaylist(open.id);
  };

  return (
    <>
      <header className="shrink-0 h-14 pl-1 pr-2 flex items-center gap-1 border-b border-line bg-surface-deep">
        <button
          type="button"
          aria-label="Back to your playlists"
          title="Back to your playlists"
          data-testid="playlist-back"
          onClick={back}
          className={`shrink-0 w-touch h-touch flex items-center justify-center rounded-control text-ink-soft hover:text-ink-strong ${FOCUS}`}
        >
          <ArrowLeft size={22} />
        </button>
        <h1 ref={headingRef} tabIndex={-1} data-view-heading="" data-testid="playlist-title" className="flex-1 min-w-0 text-lg font-semibold text-ink-strong truncate outline-none">
          {editing ? `Editing ${open.name}` : open.name}
        </h1>
        {editing ? (
          <button
            type="button"
            data-testid="playlist-done"
            onClick={() => {
              if (!cancelLiftRef.current?.()) setEditing(false);
            }}
            className={`shrink-0 min-h-touch px-4 rounded-control bg-surface-raised border border-ink-faint text-sm font-semibold text-ink-strong ${FOCUS}`}
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            data-testid="playlist-options"
            aria-label={`Options for ${open.name}`}
            title={`Options for ${open.name}`}
            aria-haspopup="dialog"
            onClick={(e: { currentTarget: HTMLElement }) => {
              e.currentTarget.focus();
              setPlMenu(true);
            }}
            className={`shrink-0 w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong ${FOCUS}`}
          >
            <EllipsisVertical size={20} />
          </button>
        )}
        {inPanel ? (
          <button
            type="button"
            aria-label="Close panel"
            title="Close panel"
            onClick={() => actions.setTab('now')}
            className={`shrink-0 w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong ${FOCUS}`}
          >
            <X size={20} />
          </button>
        ) : null}
      </header>
      <div ref={scrollRef} data-testid="playlist-scroll" className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain bg-surface-deep">
        {editing ? (
          <>
            <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
              <p data-testid="playlist-facts" className="text-sm text-ink-muted">
                {facts.base}
                {facts.missing ? ' · ' : null}
                {facts.missing ? <span className="text-status-alert">{facts.missing}</span> : null}
              </p>
              {open.missing > 0 ? (
                <button
                  type="button"
                  data-testid="playlist-remove-missing"
                  onClick={() => actions.editPlaylist(open.id, { removeMissing: true })}
                  className={`shrink-0 -mr-2 min-h-touch px-3 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong ${FOCUS}`}
                >
                  {removeMissingLabel(open.missing)}
                </button>
              ) : null}
            </div>
            <p className="px-4 pb-2 text-xs text-ink-faint">{EDIT_HINT}</p>
          </>
        ) : (
          <>
            <div className="px-4 pt-3">
              <p data-testid="playlist-facts" className="text-sm text-ink-muted">
                {facts.base}
                {facts.missing ? ' · ' : null}
                {facts.missing ? <span className="text-status-alert">{facts.missing}</span> : null}
              </p>
              <p data-testid="playlist-from" className="text-xs text-ink-faint">
                {open.fromLine}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" data-testid="playlist-play" disabled={none} aria-describedby={none ? 'playlist-none-reason' : undefined} onClick={() => actions.playPlaylist(open.id)} className={PLAY}>
                  <Play size={18} aria-hidden="true" />
                  <span className="truncate">Play</span>
                </button>
                <button type="button" data-testid="playlist-shuffle" disabled={none} aria-describedby={none ? 'playlist-none-reason' : undefined} onClick={() => actions.playPlaylist(open.id, { shuffle: true })} className={ACTION}>
                  <Shuffle size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
                  <span className="truncate">Shuffle</span>
                </button>
                <button type="button" data-testid="playlist-next" disabled={none} aria-describedby={none ? 'playlist-none-reason' : undefined} onClick={() => actions.queuePlaylist(open.id, 'next')} className={ACTION}>
                  <ListStart size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
                  <span className="truncate">Play next</span>
                </button>
                <button type="button" data-testid="playlist-queue" disabled={none} aria-describedby={none ? 'playlist-none-reason' : undefined} onClick={() => actions.queuePlaylist(open.id, 'queue')} className={ACTION}>
                  <ListEnd size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
                  <span className="truncate">Add to queue</span>
                </button>
              </div>
              {none && open.count > 0 ? (
                <p id="playlist-none-reason" data-testid="playlist-none-reason" className="mt-2 text-xs text-status-alert">
                  {ALL_MISSING_REASON}
                </p>
              ) : null}
            </div>
            <div className="px-4 pt-4 pb-1 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-soft">Tracks</h2>
              {open.count > 0 ? (
                <button type="button" data-testid="playlist-edit" onClick={() => setEditing(true)} className={QUIET}>
                  <Pencil size={16} className="text-ink-muted" aria-hidden="true" />
                  Edit
                </button>
              ) : null}
            </div>
          </>
        )}
        {open.count > 0 ? (
          <PlaylistTrackList
            rows={open.rows}
            current={open.current}
            isPlaying={isPlaying}
            editing={editing}
            scrollRef={scrollRef}
            listRef={listRef}
            onPlay={onPlayRow}
            onMenu={onMenu}
            onDrop={onDrop}
            say={say}
            cancelRef={cancelLiftRef}
          />
        ) : (
          <div data-testid="playlist-empty" id="playlist-none-reason" className="mx-4 mt-2 mb-4 p-4 rounded-card border border-dashed border-line-strong">
            <p className="text-sm font-semibold text-ink-strong">{DETAIL_EMPTY_TITLE}</p>
            <p className="mt-1 text-sm text-ink-muted">{DETAIL_EMPTY_BODY}</p>
            <button
              type="button"
              data-testid="playlist-go-tracks"
              onClick={onGoToTracks}
              className={`mt-3 min-h-touch px-4 rounded-control border border-line-strong bg-surface-raised text-sm text-ink ${FOCUS}`}
            >
              Go to Tracks
            </button>
          </div>
        )}
        <div ref={spacerRef} className="h-4" aria-hidden="true" data-testid="playlist-notice-spacer" />
        <div ref={liveRef} aria-live="polite" data-testid="playlist-live" className="sr-only" />
      </div>
      {menuRow ? (
        <PlaylistRowMenu
          song={menuRow.song}
          name={menuRow.name}
          file={menuRow.file}
          index={menuRow.index}
          size={open.rows.length}
          playlist={open.name}
          editing={editing}
          lines={menuLines}
          onAction={onRowAction}
          onClose={() => setMenuIndex(null)}
        />
      ) : null}
      {plMenu ? (
        <PlaylistMenu
          name={open.name}
          facts={rowFacts({ count: open.count, seconds: open.seconds, missing: open.missing, playing: pls.playingId === open.id })}
          onAction={onPlaylistAction}
          canExport={open.present > 0}
          onClose={() => setPlMenu(false)}
        />
      ) : null}
      {infoRow && infoRow.song ? <TrackInfoDialog song={infoRow.song} onClose={() => setInfoIndex(null)} /> : null}
    </>
  );
};

interface PlaylistDetailProps {
  inPanel?: boolean;
  /** The empty view's "Go to Tracks" (the Library tab's switch). */
  onGoToTracks: () => void;
}

const PlaylistDetail = ({ inPanel = false, onGoToTracks }: PlaylistDetailProps) => {
  const actions = useActions();
  return (
  <ViewBoundary
    name="playlist-detail"
    fallback={(api) => (
      <div data-testid="playlist-detail-fallback" className="m-4">
        <PanelFallback
          text="This playlist's view hit a problem. Your playlists and your music are safe."
          switchedOff={api.switchedOff}
          copyDetails={api.copyDetails}
          buttonRef={api.buttonRef}
          onRetry={api.retry}
          onClose={() => actions.openPlaylist(null)}
        />
      </div>
    )}
    render={() => <DetailBody inPanel={inPanel} onGoToTracks={onGoToTracks} />}
  />
  );
};

export default React.memo(PlaylistDetail);
