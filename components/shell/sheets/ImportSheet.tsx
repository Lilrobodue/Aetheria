// components/shell/sheets/ImportSheet.tsx (v15.7, the Library tab, stage B; mockup library-import-phone)
//
// Import music, over the existing import: Choose a folder and Choose files are two labels, each wrapping a file input
// whose change is App's handleFileUpload, unchanged (the format filter, the append rules, the duration queue and its
// toasts). The inputs keep classic's names, "Import folder" and "Add files", so the tests' helpers work on both layouts.
// Then the formats line, the last import ("Added 12 tracks to your library", what was skipped, the lengths still being
// read, "The list that's playing is unchanged."), and the Recover offer for stored tracks the library doesn't list,
// shown even after the banner's "Not now": Recover / Remove copies and Discard (two taps) are the banner's own
// functions, so the same rules apply. No storage progress: none exists to measure.
// Modal on the phone; in the desktop panel it takes the Library's place until closed. Opened from the header's
// Import, the empty state, and the health card's Review (starting at the Recover offer).

import React, { useEffect, useRef } from 'react';
import { Check, FilePlus2, FolderOpen } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, useLibraryStatus, useShell } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from './sheetFallback';
import { FORMATS_LINE, FORMATS_SKIPPED, lastImportLines, recoverWords } from '../library/libraryModel';

const CHOICE =
  'relative min-h-[56px] px-3 rounded-control border border-line-strong bg-surface-raised flex items-center justify-center gap-2 text-sm text-ink cursor-pointer hover:border-ink-faint transition-colors duration-fast focus-within:outline focus-within:outline-2 focus-within:outline-gold-400';

const ImportBody = ({ recoverRef }: { recoverRef: { current: HTMLButtonElement | null } }) => {
  countRender('ImportBody');
  const actions = useActions();
  const st = useLibraryStatus();
  const last = st.lastImport ? lastImportLines(st.lastImport, st.durationsLeft) : null;
  const o = st.orphans;
  const words = o && o.fresh + o.duplicates > 0 ? recoverWords(o.fresh, o.duplicates) : null;
  return (
    <div data-testid="import-body" className="px-4 pb-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className={CHOICE}>
          <FolderOpen size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
          Choose a folder
          <input
            type="file"
            aria-label="Import folder"
            {...({ webkitdirectory: '', directory: '' } as any)}
            multiple
            className="sr-only"
            onChange={(e: unknown) => actions.importFiles(e)}
          />
        </label>
        <label className={CHOICE}>
          <FilePlus2 size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
          Choose files
          <input type="file" aria-label="Add files" multiple className="sr-only" onChange={(e: unknown) => actions.importFiles(e)} />
        </label>
      </div>
      <p className="text-xs text-ink-faint">
        {FORMATS_LINE} {FORMATS_SKIPPED}
      </p>
      {last ? (
        <div data-testid="import-last" className="rounded-card bg-surface-deep border border-line p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm text-ink-strong">
            <Check size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
            {last.head}
          </div>
          {last.lines.map((l) => (
            <p key={l} className="text-xs text-ink-muted">
              {l}
            </p>
          ))}
          {last.quiet ? <p className="text-xs text-ink-faint">{last.quiet}</p> : null}
        </div>
      ) : null}
      {words ? (
        <div data-testid="import-recover" className="rounded-card border border-line-strong p-3">
          <div className="text-sm text-ink-strong">{words.head}</div>
          <p className="mt-0.5 text-xs text-ink-muted">{words.body}</p>
          {words.extra ? <p className="text-xs text-ink-muted">{words.extra}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              ref={recoverRef}
              aria-disabled={st.orphanBusy || undefined}
              data-testid="import-recover-button"
              onClick={actions.recoverOrphans}
              className="min-h-touch px-3 rounded-control bg-surface-raised border border-ink-muted text-sm text-ink-strong font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
            >
              {st.orphanBusy ? 'One moment…' : words.recover}
            </button>
            {o && o.fresh > 0 ? (
              <button
                type="button"
                aria-disabled={st.orphanBusy || undefined}
                data-testid="import-discard-button"
                onClick={actions.discardOrphans}
                className={
                  st.discardArmed
                    ? 'min-h-touch px-3 rounded-control border border-status-error text-sm text-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
                    : 'min-h-touch px-3 rounded-control border border-line-strong text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400'
                }
              >
                {st.discardArmed ? 'Tap again to delete them' : 'Discard'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

interface ImportSheetProps {
  presentation: 'sheet' | 'panel';
}

const ImportSheet = ({ presentation }: ImportSheetProps) => {
  const actions = useActions();
  const { sheetFocus } = useShell();
  const recoverRef: { current: HTMLButtonElement | null } = useRef(null);
  const bodyRef: { current: HTMLDivElement | null } = useRef(null);
  useEffect(() => {
    if (sheetFocus !== 'recover') return;
    recoverRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sheetFocus]);
  return (
    <Sheet
      open
      title="Import music"
      subtitle="Aetheria keeps its own copy on this device. Your files are not changed."
      onClose={actions.closeSheet}
      presentation={presentation}
      initialFocusRef={sheetFocus === 'recover' ? recoverRef : undefined}
      bodyRef={bodyRef}
      data-testid="sheet-import"
    >
      <ViewBoundary name="sheet-import" fallback={sheetFallback(actions.closeSheet)} render={() => <ImportBody recoverRef={recoverRef} />} />
    </Sheet>
  );
};

export default React.memo(ImportSheet);
