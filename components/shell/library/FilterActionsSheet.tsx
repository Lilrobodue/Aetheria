// components/shell/library/FilterActionsSheet.tsx (v16.2, smart filters; mockup filter-actions-phone)
//
// The actions row's ⋯: a kit Sheet (modal on both shells), its body the `library-filter-actions` region. The header
// says what it acts on ("These 10 tracks · 25 min" and the filters' name); then Play next, Add to queue, Add to a
// playlist… and Save as a playlist… (off above a playlist's 10,000 entries, and saying why); Cancel. Each item closes
// the sheet first and then acts, so a Dialog never sits on a Sheet (the caller's onAction). The queue's lines follow the
// queue (QueueContext), never the clock.

import React from 'react';
import { BookmarkPlus, ListEnd, ListPlus, ListStart } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import ListRow from '../../ui/ListRow';
import { ViewBoundary } from '../../ErrorBoundary';
import { useQueue } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from '../sheets/sheetFallback';
import { ADD_TO_PLAYLIST_LINE, PLAYLIST_CAP, actionsTitle, addToQueueManyLine, playNextManyLine, saveLine } from './filterViewModel';

export type FilterAction = 'next' | 'queue' | 'playlist' | 'save';

interface FilterActionsSheetProps {
  shown: number;
  seconds: number;
  /** The filters' name ("528 Hz · 639 Hz · Under 3 min"). */
  name: string;
  onAction: (a: FilterAction) => void;
  onClose: () => void;
}

const FilterActionsBody = ({ shown, seconds, name, onAction, onClose }: FilterActionsSheetProps) => {
  countRender('FilterActions');
  const queue = useQueue();
  const overCap = shown > PLAYLIST_CAP;
  return (
    <div data-testid="library-filter-actions-body" className="pb-2">
      <div className="px-4 pt-1 pb-3 border-b border-line">
        <p aria-hidden="true" className="text-base font-semibold text-ink-strong">
          {actionsTitle(shown, seconds)}
        </p>
        <p className="text-xs text-ink-muted truncate">{name}</p>
      </div>
      <ListRow title="Play next" subtitle={playNextManyLine(shown, queue.nothingCurrent)} icon={<ListStart size={20} />} onClick={() => onAction('next')} data-testid="filter-action-next" />
      <ListRow title="Add to queue" subtitle={addToQueueManyLine(shown, queue.waiting, queue.nothingCurrent)} icon={<ListEnd size={20} />} onClick={() => onAction('queue')} data-testid="filter-action-queue" />
      <ListRow title="Add to a playlist…" subtitle={ADD_TO_PLAYLIST_LINE} icon={<ListPlus size={20} />} onClick={() => onAction('playlist')} data-testid="filter-action-playlist" />
      {overCap ? (
        <button
          type="button"
          disabled
          data-testid="filter-action-save"
          className="w-full min-h-row px-4 py-2 flex items-center gap-3 text-left border-b border-line disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-raised flex items-center justify-center text-ink-soft">
            <BookmarkPlus size={20} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-base text-ink-strong">Save as a playlist…</span>
            <span className="block text-xs text-ink-muted">{saveLine(shown)}</span>
          </span>
        </button>
      ) : (
        <ListRow title="Save as a playlist…" subtitle={saveLine(shown)} icon={<BookmarkPlus size={20} />} onClick={() => onAction('save')} data-testid="filter-action-save" />
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-3 mx-4 w-[calc(100%-2rem)] h-touch rounded-control text-sm text-ink-muted hover:text-ink-strong transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        Cancel
      </button>
    </div>
  );
};

const FilterActionsSheet = (props: FilterActionsSheetProps) => (
  <Sheet open title={actionsTitle(props.shown, props.seconds)} headerless onClose={props.onClose} data-testid="library-filter-actions">
    <ViewBoundary name="library-filter-actions" fallback={sheetFallback(props.onClose)} render={() => <FilterActionsBody {...props} />} />
  </Sheet>
);

export default React.memo(FilterActionsSheet);
