// components/shell/library/SearchSortRow.tsx (v15.7, the Library tab)
//
// The row under the header that never scrolls (mockups library-phone-A-top, library-phone-search): the search field
// (type="search", 44 px, "Search 440 tracks", a 44 × 44 Clear while it has text) and the Sort control, a native select
// laid over its visible face (the icon, the current sort and a chevron), so the phone's own picker opens. The query
// and the sort are the tab's own state: App never renders for a keystroke. Escape with text clears it and stops there
// (so the desktop panel stays open); Enter hides the phone's keyboard. The sort is saved by the select's change only.
// v16.2 (decision 2 A, mockup tracks-A-phone): the Filters button between the field and Sort, when the caller gives
// `filters`: 44 × 44, named "Filters" or "Filters, 3 on"; with picks it is raised with a count badge (never gold). It
// opens the filter sheet, which gives the focus back here when it closes.

import React from 'react';
import { ArrowDownUp, ChevronDown, ListFilter, Search, X } from 'lucide-react';
import { countRender } from '../devRenders';
import { filtersButtonName } from './filterViewModel';
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
  /** v16.2: the Filters button (how many picks show as chips; its tap; its element, for the focus). */
  filters?: { on: number; onOpen: () => void; buttonRef: { current: HTMLButtonElement | null } };
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

const SearchSortRow = ({ query, onQuery, sort, onSort, total, describedBy, inputRef, filters }: SearchSortRowProps) => {
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
      {filters ? (
        <button
          type="button"
          ref={filters.buttonRef}
          data-testid="library-filters-button"
          aria-label={filtersButtonName(filters.on)}
          aria-haspopup="dialog"
          title={filtersButtonName(filters.on)}
          onClick={filters.onOpen}
          className={
            filters.on > 0
              ? `relative shrink-0 w-touch h-touch rounded-control border border-ink-faint bg-surface-control text-ink-strong flex items-center justify-center transition-colors duration-fast ${FOCUS}`
              : `relative shrink-0 w-touch h-touch rounded-control border border-line-strong bg-surface-raised text-ink-soft flex items-center justify-center hover:border-ink-faint transition-colors duration-fast ${FOCUS}`
          }
        >
          <ListFilter size={18} aria-hidden="true" />
          {filters.on > 0 ? (
            <span
              aria-hidden="true"
              data-testid="library-filters-badge"
              className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-pill bg-ink-strong text-black text-label font-bold tabular-nums flex items-center justify-center"
            >
              {filters.on}
            </span>
          ) : null}
        </button>
      ) : null}
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
