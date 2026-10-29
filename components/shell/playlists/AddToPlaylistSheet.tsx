// components/shell/playlists/AddToPlaylistSheet.tsx (v16.1; mockups add-to-playlist-phone, add-to-playlist-new-phone)
//
// Add to playlist (SheetHost's 'playlist-add'; modal on both shells): from a Library row's ⋯, Now Playing's ⋯ or a
// playlist entry's "Add to another playlist…" (each closes its own sheet first). The header: "Add to playlist", the
// track's name (or "12 tracks"), Close. "New playlist…" first (a dashed Plus tile): a tap turns it, inline, into a
// labelled name field ("New playlist", selected) with Cancel and Create and add (no Dialog over the Sheet). Then the
// playlists, newest change first; one that already holds the track says "Has this track" with a Check (a tap adds it
// anyway: duplicates are allowed, and the toast says so). A tap adds, closes the sheet and toasts with Undo. Its body is
// the `playlist-add` region.

import React, { useEffect, useRef, useState } from 'react';
import { Check, ListMusic, Plus } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, usePlaylists } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from '../sheets/sheetFallback';
import { HAS_TRACK, NAME_MAX, nameOk, newRowLine } from './playlistsViewModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400';
const count = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'track' : 'tracks'}`;

const AddBody = () => {
  countRender('AddToPlaylist');
  const actions = useActions();
  const pls = usePlaylists();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(pls.newName);
  const inputRef: { current: HTMLInputElement | null } = useRef(null);
  const newRef: { current: HTMLButtonElement | null } = useRef(null);
  useEffect(() => {
    if (!naming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [naming]);
  const ids = pls.add?.ids ?? [];
  const one = ids.length === 1 ? pls.add?.title ?? null : null;
  const create = () => {
    if (!nameOk(name)) return;
    actions.createWithTracks(name);
  };
  return (
    <div data-testid="playlist-add-body" className="pb-4">
      {naming ? (
        <form
          className="px-4 py-3 border-b border-line bg-surface-raised/40"
          onSubmit={(e: { preventDefault: () => void }) => {
            e.preventDefault();
            create();
          }}
        >
          <label className="block text-xs text-ink-muted mb-1" htmlFor="playlist-add-new-name">
            New playlist’s name
          </label>
          <input
            id="playlist-add-new-name"
            ref={inputRef}
            data-testid="playlist-add-name"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            onChange={(e: { target: HTMLInputElement }) => setName(e.target.value)}
            className="w-full h-touch px-3 rounded-control bg-surface-raised border border-gold-400 text-sm text-ink-strong outline-none"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setNaming(false);
                setTimeout(() => newRef.current?.focus(), 0);
              }}
              className={`h-touch rounded-control border border-line-strong bg-surface-raised text-sm text-ink ${FOCUS}`}
            >
              Cancel
            </button>
            <button type="submit" data-testid="playlist-add-create" disabled={!nameOk(name)} className={`h-touch rounded-control bg-gold-500 hover:bg-gold-400 text-black text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`}>
              Create and add
            </button>
          </div>
        </form>
      ) : (
        <button
          ref={newRef}
          type="button"
          data-testid="playlist-add-new"
          onClick={() => {
            setName(pls.newName);
            setNaming(true);
          }}
          className={`w-full min-h-row px-4 py-2 flex items-center gap-3 text-left border-b border-line hover:bg-surface-raised/40 transition-colors duration-fast ${FOCUS}`}
        >
          <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control border border-dashed border-ink-faint flex items-center justify-center text-ink-soft">
            <Plus size={20} />
          </span>
          <span className="min-w-0">
            <span className="block text-base text-ink-strong">New playlist…</span>
            <span className="block text-xs text-ink-muted">{newRowLine(one, ids.length)}</span>
          </span>
        </button>
      )}
      <ul role="list" aria-label="Your playlists" data-testid="playlist-add-list">
        {pls.lists.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              data-testid="playlist-add-row"
              data-playlist-id={l.id}
              onClick={() => actions.addTracksTo(l.id)}
              className={`w-full min-h-row px-4 py-2 flex items-center gap-3 text-left border-b border-line hover:bg-surface-raised/40 transition-colors duration-fast ${FOCUS}`}
            >
              <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center">
                <ListMusic size={18} className="text-ink-soft" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-base text-ink-strong truncate">{l.name}</span>
                <span className="block text-xs text-ink-muted">
                  {count(l.count)}
                  {l.has ? ' · ' : null}
                  {l.has ? <span className="text-ink-soft">{HAS_TRACK}</span> : null}
                </span>
              </span>
              {l.has ? <Check size={18} className="shrink-0 text-ink-soft" aria-hidden="true" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const AddToPlaylistSheet = () => {
  const actions = useActions();
  const pls = usePlaylists();
  return (
    <Sheet open title="Add to playlist" subtitle={pls.add?.title ?? ''} onClose={actions.closeSheet} data-testid="sheet-playlist-add">
      <ViewBoundary name="playlist-add" fallback={sheetFallback(actions.closeSheet)} render={() => <AddBody />} />
    </Sheet>
  );
};

export default React.memo(AddToPlaylistSheet);
