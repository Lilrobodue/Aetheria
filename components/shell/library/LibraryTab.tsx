// components/shell/library/LibraryTab.tsx (v15.7, the Library tab; mockups library-phone-A-top, -A-mid, -search,
// -empty, library-desktop; v16.1 playlists-phone-A, playlist-detail-phone, playlists-desktop)
//
// The header (Library, Beta, Import; Close in the desktop panel), then the body. Solid, so on a phone the heat guard
// pauses the visuals behind it, as for the stub it replaces. v15.7's body (search, sort, summary, health card, list, row
// menu, Track info) is LibraryTracks since v16.1, moved there verbatim.
// v16.1 (decision 1 A, PROVISIONAL: shellModel.PLAYLISTS_HOME): a "Tracks · Playlists" switch under the header (a
// tablist of two 44 px tabs in a 64 px row, each with its count; kept in App's libraryViewRef for the session). Tracks is
// v15.7's tab, unchanged below the switch; Playlists shows the saved playlists' list, or a playlist's own view, which
// takes the whole tab (its own header: Back, the name, ⋯). With PLAYLISTS_HOME another tab, this tab is v16.0's.
// React.memo; nothing here reads the time.

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import Badge from '../../ui/Badge';
import IconButton from '../../ui/IconButton';
import { useActions, useLibraryList, usePlaylists, useShell } from '../contexts';
import { countRender } from '../devRenders';
import { PLAYLISTS_HOME } from '../shellModel';
import LibraryTracks from './LibraryTracks';
import LibrarySegment from '../playlists/LibrarySegment';
import PlaylistsView from '../playlists/PlaylistsView';
import PlaylistDetail from '../playlists/PlaylistDetail';

interface LibraryTabProps {
  /** In the desktop shell's 420 px panel (Close; non-modal), else the phone's full tab. */
  inPanel?: boolean;
}

const LibraryTab = ({ inPanel = false }: LibraryTabProps) => {
  countRender('LibraryTabFrame');
  const actions = useActions();
  const { songs } = useLibraryList();
  const pls = usePlaylists();
  const { libraryViewRef, phoneShell } = useShell();
  const withPlaylists = PLAYLISTS_HOME === 'library';
  const [view, setViewState] = useState<'tracks' | 'playlists'>(() => (withPlaylists ? (libraryViewRef.current.view ?? 'tracks') : 'tracks'));
  const setView = useCallback((v: 'tracks' | 'playlists') => {
    libraryViewRef.current.view = v;
    setViewState(v);
  }, []);
  // A playlist opened from elsewhere (a save's Open, a new playlist): the switch follows.
  useEffect(() => {
    if (withPlaylists && pls.openId !== null && view !== 'playlists') setView('playlists');
  }, [pls.openId]);

  const openImport = useCallback(() => {
    if (!phoneShell) libraryViewRef.current.refocus = 'import';
    actions.openImport();
  }, [phoneShell]);

  // An empty playlist's "Go to Tracks".
  const goToTracks = useCallback(() => {
    setView('tracks');
    actions.openPlaylist(null);
  }, []);

  const rootClass = inPanel ? 'h-full flex flex-col bg-surface-panel border-r border-line-strong' : 'absolute inset-0 flex flex-col bg-surface-deep pointer-events-auto';
  const showPlaylists = withPlaylists && view === 'playlists';

  if (showPlaylists && pls.openId !== null) {
    return (
      <div data-testid="tab-library" className={rootClass}>
        <PlaylistDetail inPanel={inPanel} onGoToTracks={goToTracks} />
      </div>
    );
  }

  return (
    <div data-testid="tab-library" className={rootClass}>
      <header className="shrink-0 h-14 pl-4 pr-2 flex items-center justify-between gap-2 border-b border-line bg-surface-deep">
        <h1 tabIndex={-1} data-view-heading="" className="text-lg font-semibold text-ink-strong outline-none">
          Library
        </h1>
        <span className="flex items-center gap-1">
          <Badge>Beta</Badge>
          <button
            type="button"
            data-testid="library-import"
            onClick={openImport}
            className="ml-1 min-h-touch px-3 rounded-control border border-line-strong bg-surface-raised text-sm text-ink flex items-center gap-1.5 hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          >
            <Plus size={16} className="text-ink-muted" aria-hidden="true" />
            Import
          </button>
          {inPanel ? <IconButton label="Close panel" icon={<X size={20} />} onClick={() => actions.setTab('now')} /> : null}
        </span>
      </header>
      {withPlaylists ? <LibrarySegment view={view} onView={setView} tracks={songs.length} playlists={pls.lists.length} /> : null}
      {showPlaylists ? <PlaylistsView inPanel={inPanel} /> : <LibraryTracks inPanel={inPanel} onImport={openImport} />}
    </div>
  );
};

export default React.memo(LibraryTab);
