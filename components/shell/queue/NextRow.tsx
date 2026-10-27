// components/shell/queue/NextRow.tsx (v16.0, the Up next sheet's "Next from …" rows; mockup queue-phone)
//
// One of the play order's own tracks ahead: read-only (no handle, no ⋯, not a button), dimmer than a queued row: the
// tile, the title and the Library's facts. React.memo; it never reads the clock.

import React from 'react';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { REGIME_DOT } from '../shellModel';
import { rowFacts, rowRegime } from '../library/libraryModel';

const NextRow = ({ song }: { song: Song }) => {
  countRender('NextRow');
  const regime = rowRegime(song);
  return (
    <li data-testid="queue-next-row" className="h-row pl-4 pr-4 flex items-center gap-3 border-b border-line">
      <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised/60 flex items-center justify-center">
        {regime ? <span className={`w-3 h-3 rounded-pill ${REGIME_DOT[regime]}`} /> : <span className="w-3 h-3 rounded-pill border border-ink-faint" />}
      </span>
      <span className="min-w-0">
        <span data-row-title="" className="block text-sm text-ink-soft truncate">{song.name}</span>
        <span className="block text-xs text-ink-faint truncate tabular-nums">{rowFacts(song)}</span>
      </span>
    </li>
  );
};

export default React.memo(NextRow);
