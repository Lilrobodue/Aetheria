// components/shell/queue/QueueSheet.tsx (v16.0, the Up next sheet; mockups queue-phone, -empty, -end, -row-actions,
// -dragging, queue-desktop)
//
// The queue: "Up next", with its subtitle ("3 queued · then your library"), then the sequence ahead IN THE ORDER OF
// PLAY (QueueContext.runs): "Queued · 3" with Clear (Undo in its toast) and the queued rows, which reorder by their
// handle (drag or keyboard: useSortable) or their ⋯ (Move up, Move down, Play next, Remove), then "Next from Library"
// (or "the Vortex walk", "your play order"): up to 50 of the play order's own tracks, read-only; then the end line
// ("Then 388 more tracks from your library …"). Nothing queued: a dashed card says how to queue. EVERY run is shown
// where it plays: after a Previous the track stepped back from comes first, under its own "Next from …", and a Play
// next then puts a queued track before it, so the queue can come in more than one run ("Queued · 2", then "Next from
// Library", then "Queued"). Every waiting track is listed and editable: the places, the handle's names and the moves
// count the whole queue across its runs (a row drags within its run; Move up / Move down and Alt+arrow cross into the
// next run). The phone shows it as the kit's modal Sheet (≤ 85 % of the height); the desktop in its 420 px panel
// (non-modal: the transport stays live; Escape closes it). The body is the `queue` region: a crash there keeps the
// music and the rest of the shell. Every edit is one editQueue (one App commit); a drag writes only on its drop.
// v16.1 (mockup save-upnext-phone): "Save as playlist" before Clear in the first "Queued · n" heading: the waiting
// tracks in queue order (the sheet closes, then the name Dialog).
// Nothing here reads the clock.

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../../ui/Sheet';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, useQueue } from '../contexts';
import type { QueueRowValue } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from '../sheets/sheetFallback';
import QueueRow from './QueueRow';
import type { QueueRowAction } from './QueueRow';
import NextRow from './NextRow';
import { useSortable } from './useSortable';
import { EMPTY_BODY, EMPTY_TITLE, cancelledText, droppedText, endLine, goneText, movingText, sheetSubtitle, sourceName } from './queueViewModel';

const HEAD = 'px-4 pt-4 pb-1 flex items-center justify-between gap-2';
const H3 = 'text-xs font-semibold uppercase tracking-widest text-ink-soft';
const HANDLE_HELP_ID = 'queue-handle-help';
const FIRST_HEADING_ID = 'queue-queued-heading';

type LiftCancel = { current: (() => boolean) | null };

interface QueueListProps {
  rows: QueueRowValue[];
  /** The queue's places before this run, and the queue's length (all its runs): places and moves are the queue's. */
  offset: number;
  total: number;
  labelledBy: string;
  scrollRef: { current: HTMLDivElement | null };
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
  onToggle: (key: string) => void;
  /** The focus after an edit (a selector the body finds once the lists come back in their new order). */
  focusRef: { current: string | null };
  say: (text: string) => void;
  /** Each list's lift, for the sheet's close. */
  cancels: { current: Set<LiftCancel> };
  names: { current: Map<string, string> };
  /** Every queued row's place in the queue, this render (all runs). */
  places: { current: Map<string, number> };
}

/** One run of queued rows: reorder by the handle (useSortable), the row's inline actions, focus kept on what moved. */
const QueueList = ({ rows, offset, total, labelledBy, scrollRef, openKey, setOpenKey, onToggle, focusRef, say, cancels, names, places }: QueueListProps) => {
  countRender('QueueList');
  const actions = useActions();
  const listRef: { current: HTMLUListElement | null } = useRef(null);
  const rowsRef: { current: QueueRowValue[] } = useRef(rows);
  rowsRef.current = rows;
  const placeRef: { current: { offset: number; total: number } } = useRef({ offset, total });
  placeRef.current = { offset, total };
  const myCancel: LiftCancel = useRef(null);
  useLayoutEffect(() => {
    const set = cancels.current;
    set.add(myCancel);
    return () => {
      set.delete(myCancel);
    };
  }, []);
  // This run leaves the sheet (the runs changed shape: its rows go on in another run, or played): the focus on one of
  // its controls (a keyboard-lifted row's handle among them) goes to the same row where it is now, else to the
  // queue's heading. QueueBody finds it once the commit has laid the runs out (its layout effect runs after this).
  useLayoutEffect(() => () => {
    const a = document.activeElement;
    const list = listRef.current;
    if (!a || !list || !list.contains(a)) return;
    const handleKey = a.getAttribute('data-handle-key');
    const rowKey = a.closest('[data-row-key]')?.getAttribute('data-row-key');
    focusRef.current = handleKey ? `[data-handle-key="${handleKey}"]` : rowKey ? `[data-row-key="${rowKey}"] [data-testid="queue-row-menu"]` : `#${FIRST_HEADING_ID}`;
  }, []);
  const keys = useMemo(() => rows.map((r: QueueRowValue) => r.key), [rows]);
  const nameOf = (key: string) => rowsRef.current.find((r: QueueRowValue) => r.key === key)?.song.name ?? names.current.get(key) ?? '';

  /** A move from this run's place `from` to `to` (this run's places; past its ends into the next run): one editQueue
   *  with the queue's place. False when nothing moves. */
  const move = (from: number, to: number): boolean => {
    const r = rowsRef.current[from];
    const p = placeRef.current;
    const g = Math.max(0, Math.min(p.total - 1, p.offset + to));
    if (!r || g === p.offset + from) return false;
    focusRef.current = `[data-handle-key="${r.key}"]`;
    actions.editQueue({ move: { index: r.index, id: r.song.id, to: g } });
    return true;
  };
  const sortable = useSortable({
    keys,
    listRef,
    scrollRef,
    onDrop: move,
    onLift: () => setOpenKey(null),
    cancelRef: myCancel,
    announce: (kind, key, at) => {
      const p = placeRef.current;
      const name = nameOf(key);
      if (kind === 'gone') {
        // The lifted row left this run. Still queued (another write put it in another run): put back where it is now,
        // the focus on its handle there. Else its track started playing or left the queue: nothing moved.
        const still = places.current.get(key);
        const a = document.activeElement;
        const lost = !a || a === document.body || !a.isConnected;
        if (still !== undefined) {
          say(cancelledText(name, still + 1));
          if (lost) document.querySelector<HTMLElement>(`[data-handle-key="${key}"]`)?.focus();
          return;
        }
        say(goneText(name));
        if (lost) document.getElementById(FIRST_HEADING_ID)?.focus();
        return;
      }
      const g = Math.max(0, Math.min(p.total - 1, p.offset + at)) + 1;
      say(kind === 'moving' ? movingText(name, g, p.total) : kind === 'dropped' ? droppedText(g) : cancelledText(name, g));
    },
  });

  // Stable (rows are React.memo): they read the rows through rowsRef.
  const onAction = useCallback((key: string, a: QueueRowAction) => {
    const i = rowsRef.current.findIndex((r: QueueRowValue) => r.key === key);
    const r = rowsRef.current[i];
    if (!r) return;
    const p = placeRef.current;
    if (a === 'remove') {
      setOpenKey(null);
      const next = rowsRef.current[i + 1] ?? rowsRef.current[i - 1];
      focusRef.current = next ? `[data-row-key="${next.key}"] [data-testid="queue-row-menu"]` : `#${FIRST_HEADING_ID}`;
      actions.editQueue({ remove: { index: r.index, id: r.song.id } });
    } else if (a === 'top') {
      setOpenKey(null);
      focusRef.current = `[data-row-key="${key}"] [data-testid="queue-row-menu"]`;
      actions.editQueue({ toTop: { index: r.index, id: r.song.id } });
    } else {
      // Move up / Move down: the actions stay open on the moved row, and the focus on the same action.
      focusRef.current = `[data-row-key="${key}"] [data-action="${a}"]`;
      actions.editQueue({ move: { index: r.index, id: r.song.id, to: p.offset + i + (a === 'up' ? -1 : 1) } });
    }
  }, []);

  const l = sortable.lifted;
  return (
    <div className="relative">
      <ul ref={listRef} role="list" aria-labelledby={labelledBy} data-testid="queue-list">
        {rows.map((r: QueueRowValue, i: number) => {
          const off = sortable.offsetOf(i);
          return (
            <QueueRow
              key={r.key}
              rowKey={r.key}
              song={r.song}
              position={offset + i + 1}
              total={total}
              open={openKey === r.key}
              lifted={!!l && l.from === i}
              offset={l && l.from !== i ? off : 0}
              liftOffset={l && l.from === i && l.mode === 'keyboard' ? off : null}
              handle={sortable.handleProps(r.key)}
              describedBy={HANDLE_HELP_ID}
              onToggle={onToggle}
              onAction={onAction}
            />
          );
        })}
      </ul>
      {l ? (
        <div
          aria-hidden="true"
          data-testid="queue-placeholder"
          className="absolute inset-x-0 mx-1 rounded-card border border-dashed border-line-strong pointer-events-none"
          style={{ top: sortable.slotTop(l.target), height: sortable.rowH }}
        />
      ) : null}
    </div>
  );
};

const QueueBody = ({ scrollRef, cancelRef }: { scrollRef: { current: HTMLDivElement | null }; cancelRef: LiftCancel }) => {
  countRender('QueueBody');
  const q = useQueue();
  const actions = useActions();
  const bodyRef: { current: HTMLDivElement | null } = useRef(null);
  const liveRef: { current: HTMLDivElement | null } = useRef(null);
  const focusRef: { current: string | null } = useRef(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const cancels: { current: Set<LiftCancel> } = useRef(new Set());
  const names: { current: Map<string, string> } = useRef(new Map());
  const say = useCallback((text: string) => {
    if (liveRef.current) liveRef.current.textContent = text;
  }, []);
  const onToggle = useCallback((key: string) => setOpenKey((k: string | null) => (k === key ? null : key)), []);
  // The sheet's close asks every list's lift first.
  useLayoutEffect(() => {
    cancelRef.current = () => {
      for (const c of cancels.current) if (c.current?.()) return true;
      return false;
    };
    return () => {
      cancelRef.current = null;
    };
  }, []);

  const queuedRuns = q.runs.filter((r) => r.queued);
  const total = queuedRuns.reduce((n: number, r) => n + r.rows.length, 0);
  const places: { current: Map<string, number> } = useRef(new Map());
  places.current = new Map();
  for (const r of queuedRuns) for (const x of r.rows) {
    names.current.set(x.key, x.song.name);
    places.current.set(x.key, places.current.size);
  }
  const from = sourceName(q.source);

  // The last queued track removed (its list gone with it): the focus goes to the section's heading, not to <body>.
  const hadQueuedRef: { current: boolean } = useRef(total > 0);
  useLayoutEffect(() => {
    const had = hadQueuedRef.current;
    hadQueuedRef.current = total > 0;
    const a = document.activeElement;
    if (had && total === 0 && (!a || a === document.body || !a.isConnected)) document.getElementById(FIRST_HEADING_ID)?.focus();
  }, [total > 0]);
  // After an edit the lists come back from App in their new order: the focus goes back to what moved (in any run).
  useLayoutEffect(() => {
    const want = focusRef.current;
    if (!want) return;
    focusRef.current = null;
    const root = bodyRef.current;
    const el = root?.querySelector<HTMLElement>(want);
    if (el && !(el as HTMLButtonElement).disabled) el.focus();
    else {
      // The action is not there any more (moved to an end, or the row removed): its ⋯, else the section's heading.
      const key = want.match(/data-row-key="([^"]+)"/)?.[1];
      (key ? root?.querySelector<HTMLElement>(`[data-row-key="${key}"] [data-testid="queue-row-menu"]`) : null)?.focus() ??
        document.getElementById(FIRST_HEADING_ID)?.focus();
    }
  }, [q.runs]);

  const emptySection = (
    <section key="queued-empty" data-testid="queue-queued" aria-labelledby={FIRST_HEADING_ID}>
      <div className={HEAD}>
        <h3 id={FIRST_HEADING_ID} tabIndex={-1} className={`${H3} outline-none`}>
          Queued
        </h3>
      </div>
      <div data-testid="queue-empty" className="mx-4 mt-1 mb-2 p-4 rounded-card border border-dashed border-line-strong">
        <p className="text-sm font-semibold text-ink-strong">{EMPTY_TITLE}</p>
        <p className="mt-1 text-sm text-ink-muted">{EMPTY_BODY}</p>
      </div>
    </section>
  );
  // The order of play: every run where it plays (a run of the play order's own entries can come before the queue, or
  // between two of its runs, after a Previous).
  const parts: React.ReactNode[] = [];
  let qn = 0;
  let offset = 0;
  q.runs.forEach((r, j) => {
    if (r.queued) {
      const first = qn === 0;
      const last = qn === queuedRuns.length - 1;
      const hid = first ? FIRST_HEADING_ID : `queue-queued-heading-${qn}`;
      parts.push(
        <section key={`queued-${qn}`} data-testid="queue-queued" aria-labelledby={hid}>
          <div className={HEAD}>
            <h3 id={hid} tabIndex={-1} className={`${H3} outline-none`}>
              {first ? `Queued · ${q.waiting}` : 'Queued'}
            </h3>
            {first ? (
              <span className="shrink-0 -mr-2 flex items-center">
                <button
                  type="button"
                  data-testid="queue-save"
                  onClick={() => actions.savePlaylist('queue')}
                  className="shrink-0 min-h-touch px-3 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
                >
                  Save as playlist
                </button>
                <button
                  type="button"
                  data-testid="queue-clear"
                  onClick={() => actions.editQueue({ clear: true })}
                  className="shrink-0 min-h-touch px-3 rounded-control text-sm text-ink-muted underline underline-offset-2 hover:text-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
                >
                  Clear
                </button>
              </span>
            ) : null}
          </div>
          <QueueList
            rows={r.rows}
            offset={offset}
            total={total}
            labelledBy={hid}
            scrollRef={scrollRef}
            openKey={openKey}
            setOpenKey={setOpenKey}
            onToggle={onToggle}
            focusRef={focusRef}
            say={say}
            cancels={cancels}
            names={names}
            places={places}
          />
          {last && q.waiting > total ? <p className="px-4 py-2 text-xs text-ink-muted">and {q.waiting - total} more queued</p> : null}
        </section>
      );
      qn++;
      offset += r.rows.length;
      return;
    }
    const id = `queue-next-heading-${j}`;
    parts.push(
      <section key={`next-${j}`} data-testid="queue-next" aria-labelledby={id}>
        <div className={HEAD}>
          <h3 id={id} className={H3}>
            Next from {from}
          </h3>
        </div>
        <ul role="list" aria-labelledby={id}>
          {r.rows.map((x) => (
            <NextRow key={x.key} song={x.song} />
          ))}
        </ul>
      </section>
    );
  });
  if (qn === 0) parts.unshift(emptySection);
  return (
    <div ref={bodyRef} data-testid="queue-body" className="pb-2">
      {parts}
      <p data-testid="queue-end" className="px-4 py-3 text-xs text-ink-muted">
        {endLine(q.end, q.more, q.source, q.loop, q.shuffle)}
      </p>
      <p id={HANDLE_HELP_ID} className="sr-only">
        Press Space to pick the track up, the arrow keys to move it, Space to drop it, Escape to put it back. Alt with an arrow key moves it at once.
      </p>
      <div ref={liveRef} aria-live="polite" data-testid="queue-live" className="sr-only" />
    </div>
  );
};

interface QueueSheetProps {
  presentation: 'sheet' | 'panel';
}

const QueueSheet = ({ presentation }: QueueSheetProps) => {
  countRender('QueueSheet');
  const actions = useActions();
  const q = useQueue();
  const bodyRef: { current: HTMLDivElement | null } = useRef(null);
  // A row lifted (drag or keyboard): the sheet's Escape, Close or scrim puts it back rather than closing the sheet.
  const cancelLiftRef: LiftCancel = useRef(null);
  const onClose = useCallback(() => {
    if (cancelLiftRef.current?.()) return;
    actions.closeSheet();
  }, []);
  return (
    <Sheet
      open
      title="Up next"
      subtitle={sheetSubtitle(q.waiting, q.source)}
      onClose={onClose}
      presentation={presentation}
      bodyRef={bodyRef}
      data-testid="sheet-queue"
    >
      <ViewBoundary name="queue" fallback={sheetFallback(actions.closeSheet)} render={() => <QueueBody scrollRef={bodyRef} cancelRef={cancelLiftRef} />} />
    </Sheet>
  );
};

export default React.memo(QueueSheet);
