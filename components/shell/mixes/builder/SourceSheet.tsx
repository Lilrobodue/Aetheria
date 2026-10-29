// components/shell/mixes/builder/SourceSheet.tsx (v16.3, Create a mix; mockup builder-source-phone)
//
// The Start from sheet (a kit Sheet, modal on both shells): "The mix is built from these tracks only." Your library;
// your queue (when something waits: Play makes the mix the play order, so the queued tracks don't play twice); then
// your playlists, each with its tracks and how many are missing. A pick closes the sheet; Escape and the scrim close it
// too, and the focus goes back to the choice that opened it (the overlay stack). The lists come from PlaylistsContext
// (never the clock).
// v16.3 review: its body is a region of its own (mix-builder-source): a crash shows the sheet's fallback (Reload panel,
// Close) in the sheet, and the builder and the Mixes tab stay.

import React from 'react';
import Sheet from '../../../ui/Sheet';
import RadioList from '../../../ui/RadioList';
import { ViewBoundary } from '../../../ErrorBoundary';
import { sheetFallback } from '../../sheets/sheetFallback';
import {
  SOURCE_LIBRARY,
  SOURCE_PLAYLISTS,
  SOURCE_QUEUE,
  SOURCE_SHEET_SUB,
  SOURCE_SHEET_TITLE,
  libraryChoiceSub,
  sourcePlaylistLine,
  sourceQueueLine,
} from './builderViewModel';

interface SourceSheetProps {
  /** The source chosen now: 'library', 'queue' or a playlist's id. */
  value: string;
  libraryCount: number;
  waiting: number;
  playlists: ReadonlyArray<{ id: string; name: string; present: number; missing: number }>;
  onPick: (value: string) => void;
  onClose: () => void;
}

const SourceSheet = ({ value, libraryCount, waiting, playlists, onPick, onClose }: SourceSheetProps) => (
  <Sheet open title={SOURCE_SHEET_TITLE} subtitle={SOURCE_SHEET_SUB} onClose={onClose} data-testid="builder-source-sheet">
    <ViewBoundary
      name="mix-builder-source"
      fallback={sheetFallback(onClose)}
      render={() => (
        <div className="px-4 pb-4">
          <RadioList
            legend={SOURCE_SHEET_TITLE}
            name="builder-source"
            items={[
              { id: 'library', title: SOURCE_LIBRARY, subtitle: libraryChoiceSub(libraryCount) },
              ...(waiting > 0 || value === 'queue' ? [{ id: 'queue', title: SOURCE_QUEUE, subtitle: sourceQueueLine(waiting) }] : []),
            ]}
            value={value}
            onChange={onPick}
            data-testid="builder-source-own"
          />
          {waiting > 0 || value === 'queue' ? null : <p className="pt-2 text-xs text-ink-muted">{sourceQueueLine(0)}</p>}
          {playlists.length ? (
            <>
              <h3 className="pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-ink-soft">{SOURCE_PLAYLISTS}</h3>
              <RadioList
                legend={SOURCE_PLAYLISTS}
                name="builder-source"
                items={playlists.map((p) => ({ id: p.id, title: p.name, subtitle: sourcePlaylistLine(p.present, p.missing) }))}
                value={value}
                onChange={onPick}
                data-testid="builder-source-playlists"
              />
            </>
          ) : null}
        </div>
      )}
    />
  </Sheet>
);

export default React.memo(SourceSheet);
