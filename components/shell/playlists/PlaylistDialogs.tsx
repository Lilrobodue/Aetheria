// components/shell/playlists/PlaylistDialogs.tsx (v16.1; mockup save-dialog-phone)
//
// The name Dialog (App's playlistNaming, through PlaylistsContext), mounted once in each shell: Save as a playlist ("The
// 3 tracks waiting in Up next, in their order."), New playlist, Rename playlist. The kit Dialog (a bottom sheet on a
// phone; modal); a labelled text field, prefilled and selected, at most 80 characters; Cancel and Save (off while the
// name is empty); Enter saves. Opened only after any sheet has closed: a Dialog never sits on a Sheet. React.memo; it
// renders only when the Dialog opens or closes.

import React, { useEffect, useRef, useState } from 'react';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { useActions, usePlaylists } from '../contexts';
import type { PlaylistNamingValue } from '../contexts';
import { countRender } from '../devRenders';
import { NAME_MAX, NEW_SENTENCE, NEW_TITLE, RENAME_TITLE, SAVE_TITLE, nameOk, renameSentence } from './playlistsViewModel';

const NameDialog = ({ naming }: { naming: PlaylistNamingValue; key?: string }) => {
  countRender('NamePlaylistDialog');
  const actions = useActions();
  const [name, setName] = useState(naming.name);
  const inputRef: { current: HTMLInputElement | null } = useRef(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);
  const title = naming.kind === 'save' ? SAVE_TITLE : naming.kind === 'new' ? NEW_TITLE : RENAME_TITLE;
  const sentence = naming.kind === 'save' ? naming.sentence : naming.kind === 'new' ? NEW_SENTENCE : renameSentence(naming.name);
  const ok = nameOk(name);
  const save = () => {
    if (ok) actions.namePlaylist(name);
  };
  return (
    <Dialog
      open
      title={title}
      onClose={actions.closeNaming}
      initialFocusRef={inputRef}
      data-testid="playlist-name-dialog"
      actions={
        <>
          <Button variant="secondary" onClick={actions.closeNaming}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!ok} data-testid="playlist-name-save">
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          save();
        }}
      >
        <p data-testid="playlist-name-sentence">{sentence}</p>
        <label className="mt-3 mb-1 block text-xs text-ink-muted" htmlFor="playlist-name-input">
          Name
        </label>
        <input
          id="playlist-name-input"
          ref={inputRef}
          data-testid="playlist-name-input"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          onChange={(e: { target: HTMLInputElement }) => setName(e.target.value)}
          className="w-full h-touch px-3 rounded-control bg-surface-raised border border-line-strong focus:border-gold-400 text-base text-ink-strong outline-none"
        />
      </form>
    </Dialog>
  );
};

const PlaylistDialogs = () => {
  const { naming } = usePlaylists();
  // A new Dialog (a new key) for each opening: its field starts from that opening's name.
  return naming ? <NameDialog key={`${naming.kind}:${naming.name}`} naming={naming} /> : null;
};

export default React.memo(PlaylistDialogs);
