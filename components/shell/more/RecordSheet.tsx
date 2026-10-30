// components/shell/more/RecordSheet.tsx (v16.5, Record; v16.4 spec §3.8; mockups record-sheet-phone,
// record-sheet-phone-recording)
//
// The Record sheet (ShellSheet 'record'): a modal bottom sheet on the phone, the 420 px panel on the desktop. Its state
// is MoreContext's (audioReady, videoCapable, recording) and the Visuals sheet's pause:
//   - not ready (no AudioContext yet: nothing has played): classic's line, the three options disabled, and why;
//   - ready: classic's line, Audio Only · Visuals Only · AV Mix (classic's labels) with their lines, the footer;
//     Visuals Only and AV Mix off where the browser can't record video; under them, while Pause visuals is on, that a
//     visual recording runs the visuals;
//   - recording: "Recording", the elapsed time (RecordElapsed, the only part that ticks), the kind, Stop and save.
// Start is App's startRecording (classic's, unchanged in logic); the sheet then follows isRecording. Stop and save is
// App's stopRecording, then the toast. The body is its own region (sheet-record).
// v16.5, Export with layers (mockup record-sheet-export-phone): "Make a file" on top (Export with layers… for the
// playing track: the Export sheet; while an export runs its line follows it), then "Record live" (the content above);
// the subtitle "Export a file, or record live". While a live recording runs, its state replaces the whole sheet.
// v16.5 review: the options are off while a start is in flight (A1: a double tap started two captures) and while an
// export runs (B10), with the line; the recording state keeps the body's height, so Stop and save never lands where
// an option was (A5: the second tap of a double tap on AV Mix stopped the recording it had just started).

import React, { useLayoutEffect, useRef } from 'react';
import { ChevronRight, FileAudio, Mic, Monitor, Square, Video } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, useExport, useExportActions, useLibraryList, useMore, usePlayer, useVisuals } from '../contexts';
import ExportRowLine from '../export/ExportRowLine';
import { EXPORT_ROW, FASTER_LINE, MAKE_A_FILE, RECORD_EXPORTING_LINE, RECORD_LIVE, RECORD_SUBTITLE_EXPORT, recordExportLine } from '../../../utils/export/exportWords';
import { estimateSeconds } from '../../../utils/export/exportPlan';
import { countRender } from '../devRenders';
import { sheetFallback } from '../sheets/sheetFallback';
import RecordElapsed from './RecordElapsed';
import {
  RECORD_CLASSIC_LINE,
  RECORD_FOOTER,
  RECORD_FOOTER_RECORDING,
  RECORD_NOT_READY,
  RECORD_NO_VIDEO,
  RECORD_OPTIONS,
  RECORD_SUBTITLE_RECORDING,
  RECORD_TITLE,
  RECORD_VISUALS_NOTE,
  RECORDING_WORD,
  STOP_AND_SAVE,
  recordKindLine,
  recordOptionState,
} from './recordModel';
import type { RecordKind } from './recordModel';

const ICONS: Record<RecordKind, (cls: string) => React.ReactNode> = {
  audio: (cls) => <Mic size={20} className={cls} />,
  video: (cls) => <Monitor size={20} className={cls} />,
  both: (cls) => <Video size={20} className={cls} />,
};

const OPTION =
  'w-full min-h-row px-3 py-2 flex items-center gap-3 text-left rounded-card border border-line-strong bg-surface-raised hover:border-ink-faint transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

/** The recording state: the time so far, the kind, Stop and save. */
const Recording = ({ kind, since }: { kind: RecordKind; since: number }) => {
  const actions = useActions();
  return (
    <div data-testid="record-recording" className="space-y-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-ink-soft">
        <span aria-hidden="true" className="w-2 h-2 rounded-pill bg-status-error" />
        {RECORDING_WORD}
      </p>
      <RecordElapsed since={since} data-testid="record-elapsed" className="block text-[44px] leading-none font-bold text-ink-strong tabular-nums" />
      <p data-testid="record-kind" className="text-sm text-ink">
        {recordKindLine(kind)}
      </p>
      <button
        type="button"
        onClick={actions.stopAndSave}
        data-testid="record-stop-save"
        className="w-full min-h-touch px-4 rounded-control border border-status-error/60 bg-status-error/10 hover:bg-status-error/20 text-base font-semibold text-ink-strong flex items-center justify-center gap-2 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
      >
        <Square size={18} className="stroke-status-error" aria-hidden="true" />
        {STOP_AND_SAVE}
      </button>
      <p className="text-xs text-ink-muted leading-snug">{RECORD_FOOTER_RECORDING}</p>
    </div>
  );
};

const RecordBody = () => {
  countRender('RecordBody');
  const actions = useActions();
  const { audioReady, videoCapable, recording, recordStarting, exporting } = useMore();
  const { userPaused } = useVisuals();
  // v16.5 review (A5): the options' body height, kept by the recording state that replaces it: the sheet keeps its
  // size (a bottom sheet would shrink and bring Stop and save down over the options), and Stop and save sits in the
  // body's upper part, where Make a file was.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const optionsHeight = useRef(0);
  useLayoutEffect(() => {
    if (!recording && bodyRef.current) optionsHeight.current = bodyRef.current.offsetHeight;
  });
  if (recording) {
    return (
      <div ref={bodyRef} data-testid="record-recording-body" className="px-4 pt-1 pb-3" style={optionsHeight.current > 0 ? { minHeight: optionsHeight.current } : undefined}>
        <Recording kind={recording.kind} since={recording.since} />
      </div>
    );
  }
  const states = RECORD_OPTIONS.map((o) => ({ o, s: recordOptionState(o.kind, audioReady, videoCapable) }));
  const videoOff = audioReady && !videoCapable;
  const held = recordStarting || exporting;
  return (
    <div ref={bodyRef} className="px-4 pt-1 pb-3 space-y-4">
      <MakeAFile />
      <section aria-labelledby="record-h-live" data-testid="record-options" className="space-y-3">
      <h3 id="record-h-live" className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
        {RECORD_LIVE}
      </h3>
      <p className="text-sm text-ink-soft leading-snug">{RECORD_CLASSIC_LINE}</p>
      {!audioReady ? (
        <p data-testid="record-not-ready" className="text-sm text-ink-strong leading-snug">
          {RECORD_NOT_READY}
        </p>
      ) : null}
      <div className="space-y-2">
        {states.map(({ o, s }) => (
          <button
            key={o.kind}
            type="button"
            disabled={s.disabled || held}
            onClick={() => actions.startRecording(o.kind)}
            data-testid={`record-option-${o.kind}`}
            className={OPTION}
          >
            <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-deep flex items-center justify-center">
              {ICONS[o.kind]('text-ink-soft')}
            </span>
            <span className="min-w-0">
              <span className="block text-base text-ink-strong">{o.title}</span>
              <span className="block text-xs text-ink-muted">{o.line}</span>
            </span>
          </button>
        ))}
      </div>
      {exporting ? (
        <p data-testid="record-exporting" className="text-xs text-ink-muted leading-snug">
          {RECORD_EXPORTING_LINE}
        </p>
      ) : null}
      {videoOff ? (
        <p data-testid="record-no-video" className="text-xs text-ink-muted leading-snug">
          {RECORD_NO_VIDEO}
        </p>
      ) : null}
      {userPaused && audioReady && videoCapable ? (
        <p data-testid="record-visuals-note" className="text-xs text-ink-muted leading-snug">
          {RECORD_VISUALS_NOTE}
        </p>
      ) : null}
      <p className="text-xs text-ink-muted leading-snug">{RECORD_FOOTER}</p>
      </section>
    </div>
  );
};

/** v16.5: "Make a file": Export with layers… for the playing track (a ⋯ exports any other track or a playlist). */
const MakeAFile = () => {
  const exportActions = useExportActions();
  const ex = useExport();
  const { hasTrack, trackId, title } = usePlayer();
  const { songs } = useLibraryList();
  const song = hasTrack && trackId ? songs.find((x) => x.id === trackId) : undefined;
  const eta = song && typeof song.duration === 'number' ? estimateSeconds(song.duration, ex.mobile, ex.playing, ex.learnedRate) : null;
  const running = !!ex.job && (ex.job.phase === 'running' || ex.job.phase === 'cancelling');
  const can = running || hasTrack;
  return (
    <section aria-labelledby="record-h-file" data-testid="record-make-file" className="space-y-2">
      <h3 id="record-h-file" className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
        {MAKE_A_FILE}
      </h3>
      <button type="button" disabled={!can} onClick={() => exportActions.open({ kind: 'playing' })} data-testid="record-export" className={OPTION}>
        <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-control bg-surface-deep flex items-center justify-center">
          <FileAudio size={20} className="text-ink-soft" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-base text-ink-strong">{EXPORT_ROW}</span>
          <span className="block text-xs text-ink-muted">
            <ExportRowLine text={recordExportLine(hasTrack ? title : null, eta)} />
          </span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-faint" />
      </button>
      <p className="text-xs text-ink-muted leading-snug">{FASTER_LINE}</p>
    </section>
  );
};

const RecordSheet = ({ presentation }: { presentation: 'sheet' | 'panel' }) => {
  const actions = useActions();
  const { recording } = useMore();
  return (
    <Sheet
      open
      title={RECORD_TITLE}
      subtitle={recording ? RECORD_SUBTITLE_RECORDING : RECORD_SUBTITLE_EXPORT}
      presentation={presentation}
      onClose={actions.closeSheet}
      data-testid="sheet-record"
    >
      <ViewBoundary name="sheet-record" fallback={sheetFallback(actions.closeSheet)} render={() => <RecordBody />} />
    </Sheet>
  );
};

export default React.memo(RecordSheet);
