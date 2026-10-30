// components/shell/playlists/PlaylistsView.tsx (v16.1; mockups playlists-phone-A, playlists-phone-empty)
//
// The saved playlists' list (Library › Playlists): the summary row ("5 playlists · 8 h 44 min") with New playlist (the
// name Dialog; the new playlist's view opens), then a 64 px row per playlist, newest change first (PlaylistRow: the row
// opens it, ▶ plays it, ⋯ has Rename…, Duplicate, Delete playlist). States: "Loading your playlists…" while the library
// or the playlists load; the error card when they couldn't be read (nothing is written then); the unreadable count; the
// storage note, only when navigator.storage.persisted() says false (read once, on mount). Its own region, `playlists`:
// a crash here keeps the music and the rest of the shell. React.memo; nothing here reads the time.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HardDrive, ListMusic, Plus } from 'lucide-react';
import Button from '../../ui/Button';
import { PanelFallback, ViewBoundary } from '../../ErrorBoundary';
import { useActions, useExportActions, useLibraryList, usePlaylists } from '../contexts';
import { countRender } from '../devRenders';
import PlaylistRow from './PlaylistRow';
import PlaylistMenu from './PlaylistMenu';
import { useNoticeSpacer } from './useNoticeSpacer';
import type { PlaylistMenuAction } from './PlaylistMenu';
import {
  ERROR_BODY,
  ERROR_TITLE,
  LIST_EMPTY_BODY,
  LIST_EMPTY_TITLE,
  LOADING_TEXT,
  STORAGE_NOTE,
  listSummary,
  rowFacts,
  unreadableNote,
} from './playlistsViewModel';

const PlaylistsBody = () => {
  countRender('PlaylistsView');
  const actions = useActions();
  const exportActions = useExportActions(); // v16.5
  const pls = usePlaylists();
  const { loading } = useLibraryList();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    actions.storagePersisted().then((p: boolean | null) => {
      if (live) setPersisted(p);
    });
    return () => {
      live = false;
    };
  }, []);

  const onOpen = useCallback((id: string) => actions.openPlaylist(id), []);
  const onPlay = useCallback((id: string) => actions.playPlaylist(id), []);
  const onMenu = useCallback((id: string, opener: HTMLElement) => {
    opener.focus();
    setMenuId(id);
  }, []);
  const menuList = menuId !== null ? (pls.lists.find((l) => l.id === menuId) ?? null) : null;
  useEffect(() => {
    if (menuId !== null && !menuList) setMenuId(null);
  }, [menuId, menuList]);
  const onMenuAction = (a: PlaylistMenuAction) => {
    const id = menuId;
    setMenuId(null); // the sheet closes first: a Dialog never sits on a Sheet
    if (id === null) return;
    if (a === 'export') return exportActions.open({ kind: 'playlist', id }); // v16.5
    if (a === 'rename') actions.renamePlaylist(id);
    else if (a === 'duplicate') actions.duplicatePlaylist(id);
    else actions.deletePlaylist(id);
  };

  const note = persisted === false ? (
    <p data-testid="playlists-storage-note" className="mx-4 mt-4 mb-3 p-3 rounded-card border border-dashed border-line-strong text-xs text-ink-muted flex gap-2">
      <HardDrive size={16} className="shrink-0 text-ink-faint" aria-hidden="true" />
      <span>{STORAGE_NOTE}</span>
    </p>
  ) : null;

  if (pls.status === 'loading' || loading) {
    return (
      <p data-testid="playlists-loading" className="px-4 pt-4 text-sm text-ink-muted">
        {LOADING_TEXT}
      </p>
    );
  }
  if (pls.status === 'error') {
    return (
      <div data-testid="playlists-error" role="alert" className="mx-4 mt-4 p-4 rounded-card border border-line-strong bg-surface-panel">
        <p className="text-sm font-semibold text-ink-strong">{ERROR_TITLE}</p>
        <p className="mt-1 text-sm text-ink-muted">{ERROR_BODY}</p>
      </div>
    );
  }

  const unreadable = pls.unreadable > 0 ? (
    <p data-testid="playlists-unreadable" className="mx-4 mt-3 text-xs text-ink-muted">
      {unreadableNote(pls.unreadable)}
    </p>
  ) : null;

  if (pls.lists.length === 0) {
    return (
      <div data-testid="playlists" className="pt-4">
        <div data-testid="playlists-empty" className="mx-4 p-4 rounded-card border border-dashed border-line-strong">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-strong">
            <ListMusic size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
            {LIST_EMPTY_TITLE}
          </div>
          <p className="mt-1 text-sm text-ink-muted">{LIST_EMPTY_BODY}</p>
          <Button variant="primary" onClick={actions.newPlaylist} className="mt-3" data-testid="playlists-new">
            New playlist
          </Button>
        </div>
        {unreadable}
        {note}
      </div>
    );
  }

  return (
    <div data-testid="playlists">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <p data-testid="playlists-summary" className="text-sm text-ink-muted">
          {listSummary(pls.lists.length, pls.totalSeconds)}
        </p>
        <button
          type="button"
          data-testid="playlists-new"
          onClick={actions.newPlaylist}
          className="shrink-0 min-h-touch px-3 rounded-control border border-line-strong bg-surface-raised text-sm text-ink flex items-center gap-1.5 hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
        >
          <Plus size={16} className="text-ink-muted" aria-hidden="true" />
          New playlist
        </button>
      </div>
      <ul role="list" aria-label="Your playlists" data-testid="playlists-list" className="border-t border-line">
        {pls.lists.map((l) => (
          <PlaylistRow
            key={l.id}
            id={l.id}
            name={l.name}
            count={l.count}
            seconds={l.seconds}
            missing={l.missing}
            playing={l.playing}
            onOpen={onOpen}
            onPlay={onPlay}
            onMenu={onMenu}
          />
        ))}
      </ul>
      {unreadable}
      {note}
      {menuList ? (
        <PlaylistMenu
          name={menuList.name}
          facts={rowFacts({ count: menuList.count, seconds: menuList.seconds, missing: menuList.missing, playing: menuList.playing })}
          onAction={onMenuAction}
          canExport={menuList.present > 0}
          onClose={() => setMenuId(null)}
        />
      ) : null}
    </div>
  );
};

interface PlaylistsViewProps {
  inPanel?: boolean;
}

const PlaylistsView = ({ inPanel = false }: PlaylistsViewProps) => {
  const spacerRef: { current: HTMLDivElement | null } = useRef(null);
  useNoticeSpacer(spacerRef, inPanel, null);
  return (
  <div data-testid="playlists-scroll" className={inPanel ? 'relative flex-1 min-h-0 overflow-y-auto overscroll-contain bg-surface-deep' : 'relative flex-1 min-h-0 overflow-y-auto overscroll-contain bg-surface-deep pb-4'}>
    <ViewBoundary
      name="playlists"
      fallback={(api) => (
        <div data-testid="playlists-fallback" className="mx-4 mt-4">
          <PanelFallback
            text="Your playlists hit a problem. They and your music are safe."
            switchedOff={api.switchedOff}
            copyDetails={api.copyDetails}
            buttonRef={api.buttonRef}
            onRetry={api.retry}
          />
        </div>
      )}
      render={() => <PlaylistsBody />}
    />
    <div ref={spacerRef} aria-hidden="true" data-testid="playlists-notice-spacer" />
  </div>
  );
};

export default React.memo(PlaylistsView);
