// components/shell/sheets/FreeMusicBody.tsx (v16.13, "Aetheria's 222"; review page aeb068c3, decisions of 15 Nov 2026)
//
// The Import music sheet's second view, Aetheria's music: the credit and the licence (decision 8 C), the three groups
// with their Add (3 A: All, Instrumentals, Songs; a group's button adds only what the library is missing), the add's
// line with Stop adding, and Choose tracks (the list, one Add each). It reads the sheet's own context
// (ImportSaveContext's `free`: the list, which ids the library has, the counts, the status, whether the library is
// read yet), so an add's progress re-renders this body alone. The add is App's (actions.addFreeMusic).
// Review round 1 (UI):
// - U1: on the phone it draws the save's line too (SaveLine): App sends the save's words to the sheet while it is open.
// - U2: until the library's restore is done it says so, and no Add acts.
// - U3: an add's start is read once ("Adding 85 tracks."), its progress is not read as it changes, its end once; and
//   every button's name holds its visible text (Add…, Adding…, Added: …).
// - U4: Stop adding is outside the live region; when the add ends while it has the focus, the focus goes to the end
//   line (it would otherwise fall to the page as Stop goes).
// - U6: in the desktop panel (not modal) the toast beside it reads the end line, so the panel shows it without a voice.
// - U10: one onAdd for every row (a memo that holds); U11: the mock's colours; U12: long titles wrap to two lines.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Check } from 'lucide-react';
import { useActions, useImportSave } from '../contexts';
import { countRender } from '../devRenders';
import SaveLine from './SaveLine';
import { GROUPS, words, statusLine } from '../../../utils/freeMusic/model';
import type { FreeTrack } from '../../../utils/freeMusic/model';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const ADD = `shrink-0 min-h-touch min-w-[84px] px-3 rounded-control border text-sm font-semibold ${FOCUS}`;
const ADD_ON = 'border-ink-muted bg-surface-raised text-ink-strong hover:border-ink';
const ADD_OFF = 'border-line-strong text-ink-faint cursor-default';
const ADD_DONE = 'border-status-ok/40 text-status-ok cursor-default';

interface RowProps {
  t: FreeTrack;
  inLibrary: boolean;
  off: boolean;
  adding: boolean;
  onAdd: (id: string) => void;
}

/** One track of Choose tracks. Memoised (onAdd is one function): an add's progress changes `adding` on one row and
 *  `off` on all, at its start and end only. */
const TrackRow = React.memo(({ t, inLibrary, off, adding, onAdd }: RowProps) => {
  const blocked = off || inLibrary;
  return (
    <li data-testid="free-track" className="flex items-center gap-3 rounded-control border border-line px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-strong line-clamp-2 break-words" title={t.title}>
          {t.title}
        </div>
        <div className="text-xs text-ink-faint">{words.rowLine(t)}</div>
      </div>
      <button
        type="button"
        aria-disabled={blocked || undefined}
        aria-label={adding ? words.rowBusyLabel(t) : inLibrary ? words.rowAddedLabel(t) : words.rowAddLabel(t)}
        onClick={() => { if (!blocked) onAdd(t.id); }}
        className={`${ADD} ${inLibrary ? ADD_DONE : blocked ? ADD_OFF : ADD_ON}`}
      >
        {adding ? words.adding : inLibrary ? words.added : words.add}
      </button>
    </li>
  );
});

interface FreeMusicBodyProps {
  onBack: () => void;
  backRef: { current: HTMLButtonElement | null };
  /** The phone's modal sheet (else the desktop panel). */
  modal: boolean;
}

const FreeMusicBody = ({ onBack, backRef, modal }: FreeMusicBodyProps) => {
  countRender('FreeMusicBody');
  const actions = useActions();
  const free = useImportSave().free;
  const [open, setOpen] = useState(false);
  const onAdd = useCallback((id: string) => actions.addFreeMusic('one', id), [actions]);
  // U4: whether the last focus inside this view was Stop adding (the view's focusin: a removed button fires no focusin
  // elsewhere, so the mark survives its removal), and the end line the focus goes to then.
  const stopRef: { current: HTMLButtonElement | null } = useRef(null);
  const stopFocused = useRef(false);
  const endRef: { current: HTMLDivElement | null } = useRef(null);
  const phase = free?.status.phase ?? 'idle';
  const wasAdding = useRef(false);
  useEffect(() => {
    if (phase === 'adding') {
      wasAdding.current = true;
      return;
    }
    const lost = !document.activeElement || document.activeElement === document.body;
    if (wasAdding.current && stopFocused.current && lost) endRef.current?.focus();
    wasAdding.current = false;
    stopFocused.current = false;
  }, [phase]);
  if (!free) return null; // (the choice that opens this view shows only once the list is read)
  const { list, has, groups, status, ready } = free;
  const busy = status.phase === 'adding';
  const line = statusLine(status);
  const share = status.bytesTotal > 0 ? Math.min(100, (100 * status.bytesDone) / status.bytesTotal) : 0;
  return (
    <div data-testid="free-music" className="px-4 pb-4 space-y-3" onFocus={(e: React.FocusEvent) => { stopFocused.current = e.target === stopRef.current; }}>
      <button
        type="button"
        ref={backRef}
        onClick={onBack}
        className={`min-h-touch -ml-1 px-1 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink rounded-control ${FOCUS}`}
      >
        <ChevronLeft size={18} aria-hidden="true" />
        {words.back}
      </button>
      <div data-testid="free-credit" className="border-l-2 border-line-strong pl-2 space-y-0.5 text-xs text-ink-muted">
        <p>{words.credit}</p>
        <p data-testid="free-mastering">{words.mastering}</p>
        <p>
          {words.licence}{' '}
          <a href={words.licenceUrl} target="_blank" rel="noopener noreferrer" className={`underline text-ink hover:text-ink-strong rounded-sm ${FOCUS}`}>
            {words.licenceLink}
          </a>
        </p>
        <p className="text-ink-faint">{words.from}</p>
      </div>
      {!ready ? (
        <p data-testid="free-not-ready" className="rounded-card border border-line-strong bg-surface-deep p-3 text-sm text-ink">
          {words.notReady}
        </p>
      ) : null}
      {GROUPS.map((g) => {
        const v = groups[g];
        const allIn = ready && v.missing === 0;
        const off = !ready || busy || allIn;
        const mine = busy && status.what === g;
        return (
          <div key={g} data-testid={`free-group-${g}`} className="rounded-card border border-line-strong bg-surface-deep p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink-strong flex items-center gap-1.5">
                {allIn ? <Check size={14} className="shrink-0 text-status-ok" aria-hidden="true" /> : null}
                {words.groupName(g, v.count)}
              </div>
              <div className="text-xs text-ink-muted">{ready ? words.groupLine(v) : `${v.count.toLocaleString('en-US')} tracks`}</div>
            </div>
            <button
              type="button"
              aria-disabled={off || undefined}
              aria-label={mine ? words.groupBusyLabel(g, v.count) : allIn ? words.groupDoneLabel(g, v.count) : words.groupAddLabel(g, v)}
              data-testid={`free-add-${g}`}
              onClick={() => { if (!off) actions.addFreeMusic(g); }}
              className={`${ADD} ${allIn ? ADD_DONE : off ? ADD_OFF : ADD_ON}`}
            >
              {mine ? words.adding : allIn ? words.added : words.add}
            </button>
          </div>
        );
      })}
      {/* The add's line (U3): the start, read once (a new element per add); the progress, not read as it changes; the
          end, a new element read once (on the phone; U6: the desktop panel's toast reads it there). */}
      <div role="status" aria-live="polite" aria-atomic="false" data-testid="free-status">
        {busy ? (
          <span key={`start-${status.id}`} className="sr-only">
            {words.started(status.total)}
          </span>
        ) : null}
        {line ? (
          // Review round 2 (N3): the "not read out" sits on the inserted element itself (as SaveLine's does), so neither
          // the first progress line nor the desktop panel's end line is read as it appears.
          <div
            key={busy ? 'adding' : `end-${status.id}`}
            data-testid={busy ? 'free-status-progress' : 'free-status-end'}
            ref={busy ? undefined : endRef}
            tabIndex={busy ? undefined : -1}
            aria-live={busy || !modal ? 'off' : undefined}
            aria-atomic="true"
            className="rounded-card border border-line-strong bg-surface-deep p-3 space-y-2 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          >
            <p data-testid="free-status-line" className="text-sm text-ink-strong leading-snug">
              {line}
            </p>
            {busy ? (
              <div className="h-1.5 rounded-full bg-line-strong overflow-hidden" aria-hidden="true">
                <div className="h-full bg-gold-500" style={{ width: `${share}%` }} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {busy ? (
        <button
          type="button"
          data-testid="free-stop"
          ref={stopRef}
          onClick={actions.stopFreeMusic}
          className={`min-h-touch px-3 rounded-control border border-ink-muted bg-surface-raised text-sm text-ink-strong ${FOCUS}`}
        >
          {words.stop}
        </button>
      ) : null}
      {modal ? <SaveLine /> : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="free-tracks"
        data-testid="free-choose"
        onClick={() => setOpen(!open)}
        className={`w-full min-h-touch px-3 rounded-control border border-dashed border-line-strong text-left text-sm text-ink ${FOCUS}`}
      >
        {open ? words.chooseHide : words.choose}
      </button>
      {open ? (
        <ul id="free-tracks" data-testid="free-tracks" className="space-y-1.5">
          {list.map((t) => (
            <TrackRow key={t.id} t={t} inLibrary={ready && has.has(t.id)} off={!ready || busy} adding={busy && status.what === 'one' && status.one === t.id} onAdd={onAdd} />
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export default FreeMusicBody;
