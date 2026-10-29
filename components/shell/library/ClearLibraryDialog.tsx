// components/shell/library/ClearLibraryDialog.tsx (v16.1, spec §3.14; mockups clear-new-phone, clear-new-ticked-phone)
//
// The new layout's own Clear (the health card's Library tools): the kit Dialog, an alertdialog. "Clear your library?",
// what goes (the stored copies of all 440 tracks and their analysis; the originals are not touched; it can't be undone).
// With saved playlists, a checkbox row "Also delete my 5 playlists", unticked every time it opens, and one line under it
// saying what happens to them. Cancel takes the first focus (a stray Enter keeps everything); the danger button names
// what goes ("Delete 440 tracks and 5 playlists") and counts only 600 ms or more after the dialog opened, so a double tap
// on "Clear library…" can't land on it (v15.7's Discard rule). Local to HealthCard, like AssignCrystalsDialog. The words
// are classic's (playlistsViewModel), so both Clears say the same.

import React, { useRef, useState } from 'react';
import { Check } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { countRender } from '../devRenders';
import { CLEAR_TITLE, alsoDeleteLabel, clearBody, clearButton, clearPlaylistsLine } from '../playlists/playlistsViewModel';

/** The danger button counts only this long after the dialog opened. */
export const CLEAR_ARM_MS = 600;

interface ClearLibraryDialogProps {
  tracks: number;
  playlists: number;
  onCancel: () => void;
  /** The box's value: the playlists go too. */
  onClear: (alsoPlaylists: boolean) => void;
}

const ClearLibraryDialog = ({ tracks, playlists, onCancel, onClear }: ClearLibraryDialogProps) => {
  countRender('ClearLibraryDialog');
  const [ticked, setTicked] = useState(false);
  const openedAt: { current: number } = useRef(Date.now());
  const cancelRef: { current: HTMLButtonElement | null } = useRef(null);
  const withPlaylists = playlists > 0;
  return (
    <Dialog
      open
      role="alertdialog"
      title={CLEAR_TITLE}
      onClose={onCancel}
      initialFocusRef={cancelRef}
      data-testid="clear-library-dialog"
      actions={
        <>
          <Button variant="secondary" buttonRef={cancelRef} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            data-testid="clear-library-confirm"
            onClick={() => {
              if (Date.now() - openedAt.current < CLEAR_ARM_MS) return;
              onClear(withPlaylists && ticked);
            }}
          >
            {clearButton(tracks, playlists, ticked)}
          </Button>
        </>
      }
    >
      <p className="text-ink">{clearBody(tracks)}</p>
      {withPlaylists ? (
        <>
          <label
            data-testid="clear-library-also"
            className={
              ticked
                ? 'mt-3 min-h-touch px-3 rounded-control border border-red-500/60 bg-red-900/20 flex items-center gap-3 text-sm text-ink cursor-pointer'
                : 'mt-3 min-h-touch px-3 rounded-control border border-line-strong bg-surface-raised flex items-center gap-3 text-sm text-ink cursor-pointer'
            }
          >
            <input type="checkbox" checked={ticked} onChange={(e: { target: HTMLInputElement }) => setTicked(e.target.checked)} className="peer sr-only" />
            <span
              aria-hidden="true"
              className={
                ticked
                  ? 'shrink-0 w-5 h-5 rounded border bg-red-600 border-red-500 text-white flex items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gold-400'
                  : 'shrink-0 w-5 h-5 rounded border border-ink-faint flex items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gold-400'
              }
            >
              {ticked ? <Check size={14} /> : null}
            </span>
            {alsoDeleteLabel(playlists)}
          </label>
          <p data-testid="clear-library-line" className="mt-2 text-xs text-ink-muted">
            {clearPlaylistsLine(playlists, ticked)}
          </p>
        </>
      ) : null}
    </Dialog>
  );
};

export default ClearLibraryDialog;
