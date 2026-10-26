// components/shell/library/SearchSortRow.tsx (v15.7, the Library tab)
//
// The row under the header that never scrolls (mockups library-phone-A-top, library-phone-search): the search field
// (type="search", 44 px, "Search 440 tracks", a 44 × 44 Clear while it has text) and the Sort control, a native select
// laid over its visible face (the icon, the current sort and a chevron), so the phone's own picker opens. The query
// and the sort are the tab's own state: App never renders for a keystroke. Escape with text clears it and stops there
// (so the desktop panel stays open); Enter hides the phone's keyboard. The sort is saved by the select's change only.

import React from 'react';
import { ArrowDownUp, ChevronDown, Search, X } from 'lucide-react';
import { countRender } from '../devRenders';
import { LIBRARY_SORTS, parseLibrarySort, searchPlaceholder, sortLabel } from './libraryModel';
import type { LibrarySort } from './libraryModel';

interface SearchSortRowProps {
  query: string;
  onQuery: (q: string) => void;
  sort: LibrarySort;
  onSort: (s: LibrarySort) => void;
  total: number;
  /** The summary line's id (the match count describes the field). */
  describedBy: string;
  inputRef: { current: HTMLInputElement | null };
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const SearchSortRow = ({ query, onQuery, sort, onSort, total, describedBy, inputRef }: SearchSortRowProps) => {
  countRender('SearchSortRow');
  return (
    <div data-testid="library-search-row" className="shrink-0 h-[60px] px-4 flex items-center gap-2 bg-surface-deep border-b border-line">
      <label className="relative flex-1 min-w-0">
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
          <Search size={16} />
        </span>
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search the library"
          aria-describedby={describedBy}
          data-testid="library-search"
          value={query}
          placeholder={searchPlaceholder(total)}
          onChange={(e: { target: HTMLInputElement }) => onQuery(e.target.value)}
          onKeyDown={(e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
            if ((e.key === 'Escape' || e.key === 'Esc') && e.currentTarget.value) {
              e.preventDefault();
              e.stopPropagation();
              onQuery('');
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className={
            query
              ? `w-full h-touch pl-9 pr-10 rounded-control bg-surface-raised border border-line-strong text-sm text-ink placeholder:text-ink-faint [&::-webkit-search-cancel-button]:appearance-none ${FOCUS}`
              : `w-full h-touch pl-9 pr-3 rounded-control bg-surface-raised border border-line-strong text-sm text-ink placeholder:text-ink-faint [&::-webkit-search-cancel-button]:appearance-none ${FOCUS}`
          }
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => {
              onQuery('');
              inputRef.current?.focus();
            }}
            className={`absolute right-0 top-0 w-touch h-touch flex items-center justify-center rounded-control text-ink-muted hover:text-ink-strong ${FOCUS}`}
          >
            <X size={16} />
          </button>
        ) : null}
      </label>
      <span
        data-testid="library-sort"
        className="relative shrink-0 h-touch pl-2.5 pr-2 rounded-control bg-surface-raised border border-line-strong text-sm text-ink flex items-center gap-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-gold-400"
      >
        <ArrowDownUp size={16} className="text-ink-muted" aria-hidden="true" />
        <span aria-hidden="true" className="max-w-[92px] truncate">
          {sortLabel(sort)}
        </span>
        <ChevronDown size={14} className="text-ink-muted" aria-hidden="true" />
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e: { target: HTMLSelectElement }) => onSort(parseLibrarySort(e.target.value))}
          className="absolute -left-px -top-px w-[calc(100%+2px)] h-[calc(100%+2px)] opacity-0 cursor-pointer"
        >
          {LIBRARY_SORTS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
};

export default React.memo(SearchSortRow);
