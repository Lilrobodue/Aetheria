// components/shell/mixes/builder/SourceSection.tsx (v16.3, Create a mix; mockups builder-A-top-phone, -walk-phone)
//
// Start from: three choices in a row. Library ("440 tracks"); Playlist ("Choose…", or the chosen one's name and count),
// which opens the Start from sheet; Queue ("3 waiting"). A choice with nothing behind it (no playlist yet, nothing
// queued) stays focusable and says why. A playlist deleted while it was the source: the view starts from the library
// and says so here. React.memo; numbers and strings as props.

import React from 'react';
import { ChoiceTile, SectionHead } from './parts';
import {
  NO_PLAYLISTS_REASON,
  PLAYLIST_CHOICE,
  PLAYLIST_CHOOSE,
  SECTION,
  libraryChoiceSub,
  playlistChoiceSub,
  queueChoiceSub,
} from './builderViewModel';

interface SourceSectionProps {
  kind: 'library' | 'playlist' | 'queue';
  libraryCount: number;
  /** The chosen playlist (name, present tracks), or null. */
  playlist: { name: string; present: number } | null;
  playlistCount: number;
  waiting: number;
  /** A line under the choices (a gone playlist), or null. */
  note: string | null;
  onLibrary: () => void;
  onPlaylists: () => void;
  onQueue: () => void;
}

const SourceSection = ({ kind, libraryCount, playlist, playlistCount, waiting, note, onLibrary, onPlaylists, onQueue }: SourceSectionProps) => (
  <section aria-labelledby="mix-builder-h-source" data-testid="builder-source">
    <SectionHead id="mix-builder-h-source">{SECTION.source}</SectionHead>
    <div role="group" aria-labelledby="mix-builder-h-source" className="grid grid-cols-3 gap-2">
      <ChoiceTile label="Library" sub={libraryChoiceSub(libraryCount)} checked={kind === 'library'} role="pressed" onPick={onLibrary} data-testid="builder-source-library" />
      <ChoiceTile
        label={kind === 'playlist' && playlist ? playlist.name : PLAYLIST_CHOICE}
        sub={kind === 'playlist' && playlist ? playlistChoiceSub(playlist.present) : playlistCount > 0 ? PLAYLIST_CHOOSE : NO_PLAYLISTS_REASON}
        checked={kind === 'playlist'}
        disabled={playlistCount === 0}
        role="pressed"
        opensSheet
        onPick={onPlaylists}
        data-testid="builder-source-playlist"
      />
      <ChoiceTile label="Queue" sub={queueChoiceSub(waiting)} checked={kind === 'queue'} disabled={waiting === 0 && kind !== 'queue'} role="pressed" onPick={onQueue} data-testid="builder-source-queue" />
    </div>
    {note ? (
      <p data-testid="builder-source-note" className="pt-2 text-xs text-ink-muted">
        {note}
      </p>
    ) : null}
  </section>
);

export default React.memo(SourceSection);
