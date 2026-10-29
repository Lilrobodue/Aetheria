// components/shell/mixes/builder/BuilderMoreSheet.tsx (v16.3, Create a mix; mockup builder-more-phone)
//
// The footer's ⋯: a kit Sheet (modal on both shells), its body the `mix-menu` region (the Mixes tab's ⋯ uses the same
// region: they never show together). The header says what it acts on ("This mix · 4 tracks · 14 min" and the mix's
// name); then Add to queue (not for a mix made of the queue: its tracks are queued already) and Save as a playlist…;
// Cancel. Each item closes the sheet first and then acts (a Dialog never sits on a Sheet). The queue's line follows
// QueueContext, never the clock.

import React from 'react';
import { BookmarkPlus, ListEnd } from 'lucide-react';
import Sheet from '../../../ui/Sheet';
import ListRow from '../../../ui/ListRow';
import { ViewBoundary } from '../../../ErrorBoundary';
import { useQueue } from '../../contexts';
import { sheetFallback } from '../../sheets/sheetFallback';
import { ADD_TO_QUEUE, SAVE_AS_PLAYLIST, addToQueueLine, moreTitle, saveLine } from './builderViewModel';

interface BuilderMoreSheetProps {
  count: number;
  positions: number | null;
  seconds: number;
  approx: boolean;
  name: string;
  /** It plays as a random walk (Save keeps this draw). */
  draw: boolean;
  fromQueue: boolean;
  onAction: (a: 'queue' | 'save') => void;
  onClose: () => void;
}

const Body = ({ count, positions, seconds, approx, name, draw, fromQueue, onAction, onClose }: BuilderMoreSheetProps) => {
  const queue = useQueue();
  return (
    <div data-testid="builder-more-body" className="pb-2">
      <div className="px-4 pt-1 pb-3 border-b border-line">
        <p aria-hidden="true" className="text-base font-semibold text-ink-strong">
          {moreTitle({ count, positions, seconds, approx })}
        </p>
        <p className="text-xs text-ink-muted truncate">{name}</p>
      </div>
      {fromQueue ? null : (
        <ListRow title={ADD_TO_QUEUE} subtitle={addToQueueLine(count, queue.waiting, queue.nothingCurrent)} icon={<ListEnd size={20} />} onClick={() => onAction('queue')} data-testid="builder-action-queue" />
      )}
      <ListRow title={SAVE_AS_PLAYLIST} subtitle={saveLine(count, draw)} icon={<BookmarkPlus size={20} />} onClick={() => onAction('save')} data-testid="builder-action-save" />
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

const BuilderMoreSheet = (props: BuilderMoreSheetProps) => (
  <Sheet open title={moreTitle(props)} headerless onClose={props.onClose} data-testid="builder-more-sheet">
    <ViewBoundary name="mix-menu" fallback={sheetFallback(props.onClose)} render={() => <Body {...props} />} />
  </Sheet>
);

export default React.memo(BuilderMoreSheet);
