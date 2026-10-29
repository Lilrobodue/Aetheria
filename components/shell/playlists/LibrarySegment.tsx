// components/shell/playlists/LibrarySegment.tsx (v16.1, decision 1 A; mockup playlists-phone-A)
//
// The Library tab's "Tracks · Playlists" switch: a tablist of two 44 px tabs in a 64 px row under the header, each with
// its count; the chosen one raised. ←/→, Home and End move between them (the WAI-ARIA tabs pattern; a tab is chosen as
// it is focused). React.memo: its props are the view and two counts.

import React, { useRef } from 'react';
import { countRender } from '../devRenders';
import { PLAYLISTS_TAB, TRACKS_TAB } from './playlistsViewModel';

interface LibrarySegmentProps {
  view: 'tracks' | 'playlists';
  onView: (v: 'tracks' | 'playlists') => void;
  tracks: number;
  playlists: number;
}

const TABS: ReadonlyArray<{ id: 'tracks' | 'playlists'; label: string }> = [
  { id: 'tracks', label: TRACKS_TAB },
  { id: 'playlists', label: PLAYLISTS_TAB },
];

const LibrarySegment = ({ view, onView, tracks, playlists }: LibrarySegmentProps) => {
  countRender('LibrarySegment');
  const refs: { current: (HTMLButtonElement | null)[] } = useRef([]);
  const go = (i: number) => {
    const t = TABS[(i + TABS.length) % TABS.length];
    onView(t.id);
    refs.current[TABS.indexOf(t)]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Library view"
      data-testid="library-segment"
      className="shrink-0 h-16 px-4 flex items-center bg-surface-deep border-b border-line"
    >
      <div className="w-full grid grid-cols-2 gap-1 p-1 rounded-control bg-surface-panel border border-line">
        {TABS.map((t, i) => {
          const on = t.id === view;
          const n = t.id === 'tracks' ? tracks : playlists;
          return (
            <button
              key={t.id}
              ref={(el: HTMLButtonElement | null) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`library-view-${t.id}`}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              data-testid={`library-view-${t.id}`}
              onClick={() => onView(t.id)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'ArrowRight') go(i + 1);
                else if (e.key === 'ArrowLeft') go(i - 1);
                else if (e.key === 'Home') go(0);
                else if (e.key === 'End') go(TABS.length - 1);
                else return;
                e.preventDefault();
              }}
              className={
                on
                  ? 'h-11 rounded-[6px] flex items-center justify-center gap-1.5 text-sm bg-surface-raised border border-ink-faint text-ink-strong font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
                  : 'h-11 rounded-[6px] flex items-center justify-center gap-1.5 text-sm text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
              }
            >
              {t.label}
              <span className={on ? 'text-xs tabular-nums text-ink-soft' : 'text-xs tabular-nums text-ink-faint'}>{n.toLocaleString('en-US')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(LibrarySegment);
