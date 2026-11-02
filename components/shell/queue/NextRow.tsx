// components/shell/queue/NextRow.tsx (v16.0, the Up next sheet's "Next from …" rows; mockup queue-phone)
//
// One of the play order's own tracks ahead: no handle, no ⋯, dimmer than a queued row: the tile, the title and the
// Library's facts. v16.7.2: the title and its facts are a button, "Play tone-0117 now" (44 px tall at least): onPlay,
// which plays it at once. React.memo; it never reads the clock.

import React from 'react';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { REGIME_DOT } from '../shellModel';
import { rowFacts, rowRegime } from '../library/libraryModel';
import { playNowName } from './queueViewModel';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400';

const NextRow = ({ rowKey, song, onPlay }: { rowKey: string; song: Song; onPlay: (key: string) => void }) => {
  countRender('NextRow');
  const regime = rowRegime(song);
  return (
    <li data-testid="queue-next-row" className="h-row pl-4 pr-4 flex items-center gap-3 border-b border-line">
      <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised/60 flex items-center justify-center">
        {regime ? <span className={`w-3 h-3 rounded-pill ${REGIME_DOT[regime]}`} /> : <span className="w-3 h-3 rounded-pill border border-ink-faint" />}
      </span>
      <button
        type="button"
        data-testid="queue-next-play"
        aria-label={playNowName(song.name)}
        onClick={() => onPlay(rowKey)}
        className={`flex-1 min-w-0 min-h-touch self-stretch flex flex-col justify-center text-left rounded-control ${FOCUS}`}
      >
        <span data-row-title="" className="block w-full text-sm text-ink-soft truncate">{song.name}</span>
        <span className="block w-full text-xs text-ink-faint truncate tabular-nums">{rowFacts(song)}</span>
      </button>
    </li>
  );
};

export default React.memo(NextRow);
