// components/shell/export/ExportSheet.tsx (v16.5, Export with layers; the addendum §3.10; decisions 1 B, 2 B, 3 A, 4 B;
// mockups export-sheet-phone-B, export-progress-phone, export-done-phone-A, export-done-noshare-phone,
// export-overcap-phone, export-playlist-phone-B, export-playlist-progress-phone)
//
// The Export sheet (ShellSheet 'export'): a modal bottom sheet on the phone, the non-modal 420 px panel on the desktop
// (the app stays usable). One state machine:
//   summary (a track: what the file will hold, Made for, the file line, Export; a playlist: the tracks and what each
//   gets, Files: one per track · one long file, Made for, the totals) — or, when it can't export, Export off and the
//   one reason; running (the progress leaf, Cancel); cancelling; done (saved to your downloads, the file, Share… and
//   Done, or the too-large line; the loud-master line); failed (the reason, Try again).
// The progress lives in ExportProgress (the job's store); this body renders when the job starts and ends, never per
// slice. Made for and Files are the sheet's own choices (never saved). Its body is a region (sheet-export).
// v16.5 review: Done and the stopped screen name the files saved and each track skipped, with why (B6); once Share's
// 10 minutes have passed, Share goes and the line says where the file is (B12).

import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Download, FileAudio, Share2 } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import { ViewBoundary } from '../../ErrorBoundary';
import { useActions, useExport, useExportActions } from '../contexts';
import type { ExportEntry, ExportValue } from '../contexts';
import { countRender } from '../devRenders';
import { sheetFallback } from '../sheets/sheetFallback';
import { REGIME_DOT, formatTime, regimeName, regimeOf } from '../shellModel';
import ExportProgress from './ExportProgress';
import MadeFor from './MadeFor';
import {
  exportSpecFor,
  exportCapSeconds,
  fileKind,
  madeForDefault,
  outSeconds,
  wavBytes,
  estimateSeconds,
  longFileCapSeconds,
  exportPeakMB,
} from '../../../utils/export/exportPlan';
import type { ExportSpec, MadeFor as MadeForValue } from '../../../utils/export/exportPlan';
import * as W from '../../../utils/export/exportWords';

const PRIMARY =
  'w-full min-h-touch px-4 rounded-control bg-ink-soft hover:bg-ink-strong text-surface-base text-base font-bold flex items-center justify-center gap-2 transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const SECONDARY =
  'w-full min-h-touch px-4 rounded-control border border-line-strong bg-surface-raised hover:border-ink-faint text-base text-ink-strong flex items-center justify-center gap-2 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const CHOICE_ON =
  'flex-1 min-h-touch px-3 rounded-control border flex items-center justify-center gap-2 text-sm border-ink-muted bg-surface-raised text-ink-strong font-semibold transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';
const CHOICE_OFF =
  'flex-1 min-h-touch px-3 rounded-control border flex items-center justify-center gap-2 text-sm border-line-strong bg-surface-deep text-ink-soft hover:border-ink-faint transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400';

type EntryState = { entry: ExportEntry; spec: ExportSpec | null; skip: 'too-long' | 'missing' | null; seconds: number };

/** What each entry gets, from the snapshot as it is now (pure: exportPlan). */
function entriesOf(ex: ExportValue, madeFor: MadeForValue): EntryState[] {
  const target = ex.target;
  if (!target) return [];
  return target.entries.map((entry) => {
    const song = entry.song;
    if (!song || !song.file) return { entry, spec: null, skip: 'missing' as const, seconds: song?.duration ?? 0 };
    const spec = exportSpecFor(ex.snapshot, song, madeFor);
    const seconds = typeof song.duration === 'number' && song.duration > 0 ? song.duration : 0;
    const cap = ex.capSeconds ?? exportCapSeconds(fileKind({ name: song.file.name, type: song.file.type }), ex.mobile, ex.deviceMemory);
    return { entry, spec, skip: seconds > cap ? ('too-long' as const) : null, seconds };
  });
}

const Row = ({ label, value, note, testId }: { label: string; value: React.ReactNode; note?: string | null; testId?: string }) => (
  <div data-testid={testId} className="grid grid-cols-[96px_1fr] gap-3 py-2 border-b border-line">
    <dt className="text-sm text-ink-muted">{label}</dt>
    <dd className="min-w-0 text-sm text-ink-strong break-words">
      {value}
      {note ? <span className="block text-xs text-ink-faint">{note}</span> : null}
    </dd>
  </div>
);

/** The summary of one track. */
const TrackSummary = ({ ex, st, madeFor }: { ex: ExportValue; st: EntryState; madeFor: MadeForValue }) => {
  const spec = st.spec;
  if (!spec) return null;
  const crystal = W.crystalRow(spec);
  const regime = spec.crystalHz ? regimeName(regimeOf(spec.crystalRaw ?? spec.crystalHz)) : null;
  const hasKey = !!st.entry.song && Array.isArray(st.entry.song.chroma) && st.entry.song.chroma.length === 12;
  void madeFor;
  void ex;
  return (
    <section aria-labelledby="export-h-holds" data-testid="export-holds">
      <h3 id="export-h-holds" className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
        {W.HOLDS}
      </h3>
      <dl className="mt-1">
        <Row label="Music" value={W.MUSIC_LINE} note={W.MUSIC_LEVEL} testId="export-row-music" />
        <Row label="Crystal" value={crystal.value + (regime && spec.origin !== '111' && spec.crystalHz ? ` · ${regime}` : '')} note={crystal.note} testId="export-row-crystal" />
        <Row label="Layers" value={layersText(spec)} testId="export-row-layers" />
        {spec.layers ? <Row label="Key fit" value={W.keyFitRow(spec, ex.snapshot.keyFitOn, hasKey)} testId="export-row-keyfit" /> : null}
        {spec.layers ? <Row label="φ timing" value={spec.phi ? W.PHI_ON : W.PHI_OFF} testId="export-row-phi" /> : null}
      </dl>
      {spec.engineNote ? <p className="mt-2 text-xs text-ink-muted">{W.ENGINE_NOTE}</p> : null}
    </section>
  );
};

function layersText(spec: ExportSpec): string {
  if (!spec.layers) return spec.musicOnly ? W.MUSIC_ONLY_LINE : W.crystalRow(spec).note;
  const band = spec.startBand.charAt(0).toUpperCase() + spec.startBand.slice(1);
  const toneDb = spec.gains.tone > 0 ? Math.round(20 * Math.log10(spec.gains.tone) * 10) / 10 : null;
  const parts = [toneDb === null ? 'Tone off' : `Tone ${toneDb < 0 ? '−' : '+'}${Math.abs(toneDb)} dB`];
  const follow = spec.adaptive ? ', following the music' : '';
  if (spec.render === 'binaural') parts.push(`binaural beat, ${band}${follow}`);
  else if (spec.render === 'pulse') parts.push(`a gentle pulse, ${band}${follow}`);
  if (spec.render === 'binaural' && spec.gains.drone > 0) parts.push('drone');
  return parts.join(' · ');
}

/** Why Export can't run, or null. v16.5 final: a cancelled export that was let go may still be decoding, so no second
 *  one starts beside it; that is the reason when nothing more particular is (a track over the cap keeps its screen). */
function cantReason(ex: ExportValue, entries: EntryState[], files: 'each' | 'long'): string | null {
  return particularReason(ex, entries, files) ?? (ex.stopping ? (ex.stoppingLong ? W.STILL_STOPPING_LONG : W.STILL_STOPPING) : null);
}

function particularReason(ex: ExportValue, entries: EntryState[], files: 'each' | 'long'): string | null {
  if (ex.job && (ex.job.phase === 'running' || ex.job.phase === 'cancelling')) return W.ANOTHER;
  if (ex.engine === 'offline') return W.OFFLINE_FIRST;
  if (ex.busy === 'analyse') return W.BUSY_ANALYSE;
  if (ex.busy === 'scan') return W.BUSY_SCAN;
  if (!ex.target) return W.SOMETHING;
  if (ex.target.kind === 'track') {
    const st = entries[0];
    if (!st || st.skip === 'missing') return W.AUDIO_MISSING;
    if (st.skip === 'too-long' && st.entry.song) {
      const kind = fileKind({ name: st.entry.song.file?.name, type: st.entry.song.file?.type });
      return W.overCap(st.seconds, kind, ex.mobile, Math.floor(exportCapSeconds(kind, true, ex.deviceMemory) / 60), Math.floor(exportCapSeconds(kind, false) / 60));
    }
    return null;
  }
  const usable = entries.filter((e) => !e.skip);
  if (!usable.length) return W.AUDIO_MISSING;
  if (files === 'long') {
    const total = usable.reduce((a, e) => a + e.seconds, 0);
    if (usable.some((e) => !(e.seconds > 0))) return W.SOMETHING;
    const heaviest = Math.max(...usable.map((e) => exportPeakMB(fileKind({ name: e.entry.song?.file?.name, type: e.entry.song?.file?.type }), e.seconds, ex.mobile)));
    const cap = ex.capSeconds ?? longFileCapSeconds(ex.mobile, heaviest, ex.deviceMemory);
    if (total > cap) return W.longOverCap(total, cap, ex.mobile);
  }
  return null;
}

/** A track over the cap (export-overcap-phone.png): the limit, why, and Close; nothing to choose. */
const OverCap = ({ reason, mobile }: { reason: string; mobile: boolean }) => {
  const actions = useActions();
  return (
    <div data-testid="export-overcap" className="px-4 pt-1 pb-3 space-y-4">
      <p role="status" data-testid="export-cant" className="flex items-start gap-3 text-sm text-ink-strong leading-snug">
        <Clock size={20} className="shrink-0 mt-px text-status-alert" aria-hidden="true" />
        <span>{reason}</span>
      </p>
      <p className="text-xs text-ink-muted leading-snug">{W.overCapWhy(mobile)}</p>
      <button type="button" onClick={actions.closeSheet} data-testid="export-close" className={SECONDARY}>
        {W.CLOSE}
      </button>
    </div>
  );
};

const Summary = ({ ex }: { ex: ExportValue }) => {
  const exa = useExportActions();
  const fromOutput = madeForDefault(ex.snapshot.output);
  const [madeFor, setMadeFor] = useState<MadeForValue>(fromOutput);
  const [files, setFiles] = useState<'each' | 'long'>('each');
  const entries = useMemo(() => entriesOf(ex, madeFor), [ex, madeFor]);
  const reason = cantReason(ex, entries, files);
  const usable = entries.filter((e) => !e.skip);
  const seconds = usable.reduce((a, e) => a + e.seconds, 0);
  const eta = estimateSeconds(seconds, ex.mobile, ex.playing, ex.learnedRate);
  const playlist = ex.target?.kind === 'playlist';
  const bytes = usable.reduce((a, e) => a + wavBytes(e.seconds), 0);
  if (!playlist && reason && entries[0]?.skip === 'too-long') return <OverCap reason={reason} mobile={ex.mobile} />;
  return (
    <div data-testid="export-summary" className="px-4 pt-1 pb-3 space-y-4">
      {playlist ? (
        <>
          <p data-testid="export-totals" className="flex items-center gap-3 text-sm text-ink-strong">
            <FileAudio size={20} className="shrink-0 text-ink-muted" aria-hidden="true" />
            {files === 'long' ? W.longTotals(outSeconds(seconds), bytes, eta) : W.playlistTotals(usable.length, bytes, eta)}
          </p>
          <ul data-testid="export-tracks" className="divide-y divide-line">
            {entries.map((e, i) => {
              const hz = e.spec?.crystalHz ?? null;
              const note = e.skip === 'too-long' ? W.TOO_LONG_SKIPPED : e.skip === 'missing' ? W.MISSING_SKIPPED : !e.spec?.layers ? W.NO_CRYSTAL : null;
              return (
                <li key={`${e.entry.id}#${i}`} data-testid="export-track" data-skip={e.skip ?? ''} className="py-2 flex items-center gap-3">
                  <span aria-hidden="true" className={hz ? `shrink-0 w-3 h-3 rounded-pill ${REGIME_DOT[regimeOf(e.spec?.crystalRaw ?? hz)]}` : 'shrink-0 w-3 h-3 rounded-pill border border-ink-faint'} />
                  <span className="flex-1 min-w-0">
                    <span className={e.skip ? 'block text-sm text-ink-muted truncate' : 'block text-sm text-ink-strong truncate'}>{e.entry.song?.name ?? e.entry.title}</span>
                    <span className="block text-xs text-ink-muted tabular-nums">
                      {formatTime(e.seconds)}
                      {hz ? ` · ${hz} Hz` : ''}
                    </span>
                  </span>
                  {note ? <span className="shrink-0 text-xs text-ink-muted">{note}</span> : null}
                </li>
              );
            })}
          </ul>
          <div role="group" aria-label={W.FILES_LABEL} data-testid="export-files" className="space-y-2">
            <span className="block text-sm text-ink-strong">{W.FILES_LABEL}</span>
            <div className="flex gap-2">
              <button type="button" aria-pressed={files === 'each'} onClick={() => setFiles('each')} data-testid="export-files-each" className={files === 'each' ? CHOICE_ON : CHOICE_OFF}>
                {W.ONE_PER_TRACK}
              </button>
              <button type="button" aria-pressed={files === 'long'} onClick={() => setFiles('long')} data-testid="export-files-long" className={files === 'long' ? CHOICE_ON : CHOICE_OFF}>
                {W.ONE_LONG}
              </button>
            </div>
            <p className="text-xs text-ink-muted leading-snug">
              {W.ONE_LONG}: {W.LONG_LINE.charAt(0).toLowerCase() + W.LONG_LINE.slice(1)}
            </p>
          </div>
        </>
      ) : entries[0] ? (
        <TrackSummary ex={ex} st={entries[0]} madeFor={madeFor} />
      ) : null}
      <MadeFor value={madeFor} fromOutput={fromOutput} onChoose={setMadeFor} />
      {!playlist && entries[0]?.spec ? (
        <p data-testid="export-file-line" className="flex items-center gap-3 text-sm text-ink-strong">
          <FileAudio size={20} className="shrink-0 text-ink-muted" aria-hidden="true" />
          {W.fileLine(outSeconds(seconds), bytes)}
        </p>
      ) : null}
      {reason ? (
        <p role="status" data-testid="export-cant" className="text-sm text-ink-strong leading-snug">
          {reason}
        </p>
      ) : null}
      <button type="button" disabled={!!reason} onClick={() => exa.start({ madeFor, files: playlist ? files : 'each' })} data-testid="export-start" className={PRIMARY}>
        <Download size={18} aria-hidden="true" />
        {playlist ? (files === 'long' ? 'Export one file' : `Export ${usable.length} file${usable.length === 1 ? '' : 's'}`) : 'Export'}
      </button>
      <p className="text-xs text-ink-muted leading-snug">
        {playlist ? (files === 'long' ? `${W.savedWhen(eta)}` : `Each file is saved as it's done. ${W.SEVERAL_DOWNLOADS}`) : W.savedWhen(eta)}
      </p>
    </div>
  );
};

const Running = ({ ex }: { ex: ExportValue }) => {
  const exa = useExportActions();
  const job = ex.job!;
  const cancelling = job.phase === 'cancelling';
  return (
    <div data-testid="export-running" className="px-4 pt-1 pb-3 space-y-4">
      <ExportProgress store={job.store} look="sheet" />
      {cancelling ? (
        <p role="status" data-testid="export-cancelling" className="text-sm text-ink-strong">
          {W.CANCELLING}
        </p>
      ) : (
        <button type="button" onClick={exa.cancel} data-testid="export-cancel" className={SECONDARY}>
          Cancel
        </button>
      )}
      <p className="text-xs text-ink-muted leading-snug">{job.kind === 'playlist' ? W.PLAYLIST_CANCEL_LINE : W.CLOSE_LINE}</p>
      <p className="text-xs text-ink-muted leading-snug">{W.KEEP_OPEN}</p>
    </div>
  );
};

const Done = ({ ex }: { ex: ExportValue }) => {
  const exa = useExportActions();
  const actions = useActions();
  const job = ex.job!;
  const r = job.result!;
  const canShare = r.shareable;
  return (
    <div data-testid="export-done" className="px-4 pt-1 pb-3 space-y-4">
      <p role="status" className="flex items-center gap-2 text-base font-semibold text-ink-strong">
        <CheckCircle2 size={22} className="shrink-0 stroke-status-ok" aria-hidden="true" />
        {job.kind === 'playlist' ? W.savedOf(r.files.length, r.total) : W.SAVED}
      </p>
      <ul className="space-y-2">
        {r.files.map((f) => (
          <li key={f.name} data-testid="export-done-file" className="rounded-card bg-surface-raised p-3">
            <span className="block text-sm text-ink-strong break-words">{f.name}</span>
            <span className="block text-xs text-ink-muted tabular-nums">{W.doneLine(f.outSeconds, f.bytes)}</span>
          </li>
        ))}
      </ul>
      {r.skipped ? (
        <p data-testid="export-skipped" className="text-xs text-ink-muted leading-snug">
          {r.skipped}
        </p>
      ) : null}
      {r.loud ? <p data-testid="export-loud" className="text-xs text-ink-muted leading-snug">{W.LOUD_LINE}</p> : null}
      <div className="flex gap-2">
        {canShare ? (
          <button type="button" onClick={exa.share} data-testid="export-share" className={PRIMARY}>
            <Share2 size={18} aria-hidden="true" />
            {W.shareAll(r.files.length)}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            exa.dismiss();
            actions.closeSheet();
          }}
          data-testid="export-done-button"
          className={SECONDARY}
        >
          {W.DONE}
        </button>
      </div>
      <p data-testid="export-share-line" className="text-xs text-ink-muted leading-snug">
        {canShare ? W.SHARE_LINE : r.shareGone ? W.SHARE_GONE : r.shareSupported ? W.TOO_LARGE : ''}
      </p>
    </div>
  );
};

const Failed = ({ ex }: { ex: ExportValue }) => {
  const exa = useExportActions();
  const job = ex.job!;
  const r = job.result;
  return (
    <div data-testid="export-failed" className="px-4 pt-1 pb-3 space-y-4">
      <p role="status" data-testid="export-failed-line" className="text-sm text-ink-strong leading-snug">
        {W.stopped(r?.reason ?? W.SOMETHING)}
      </p>
      {r && r.files.length ? (
        <div data-testid="export-failed-saved" className="space-y-2">
          <p className="text-xs text-ink-muted">{W.savedOf(r.files.length, r.total)}:</p>
          <ul className="space-y-2">
            {r.files.map((f) => (
              <li key={f.name} data-testid="export-done-file" className="rounded-card bg-surface-raised p-3">
                <span className="block text-sm text-ink-strong break-words">{f.name}</span>
                <span className="block text-xs text-ink-muted tabular-nums">{W.doneLine(f.outSeconds, f.bytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {r?.skipped ? (
        <p data-testid="export-skipped" className="text-xs text-ink-muted leading-snug">
          {r.skipped}
        </p>
      ) : null}
      <button type="button" onClick={exa.retry} data-testid="export-retry" className={SECONDARY}>
        {W.TRY_AGAIN}
      </button>
    </div>
  );
};

const ExportBody = () => {
  countRender('ExportBody');
  const ex = useExport();
  const job = ex.job;
  const mine = !!job && !!ex.target && job.targetKey === ex.target.key;
  if (job && mine && (job.phase === 'running' || job.phase === 'cancelling')) return <Running ex={ex} />;
  if (job && mine && job.phase === 'done' && job.result) return <Done ex={ex} />;
  if (job && mine && job.phase === 'failed') return <Failed ex={ex} />;
  return (
    <React.Fragment key={ex.target?.key ?? 'none'}>
      <Summary ex={ex} />
    </React.Fragment>
  );
};

const ExportSheet = ({ presentation }: { presentation: 'sheet' | 'panel' }) => {
  const actions = useActions();
  const ex = useExport();
  const t = ex.target;
  const total = t ? t.entries.reduce((a, e) => a + (e.song?.duration ?? 0), 0) : 0;
  const subtitle = !t ? '' : t.kind === 'track' ? `${t.title} · ${formatTime(total)}` : `${t.title} · ${t.entries.length} track${t.entries.length === 1 ? '' : 's'} · ${formatTime(total)}`;
  return (
    <Sheet open title={W.SHEET_TITLE} subtitle={subtitle} presentation={presentation} onClose={actions.closeSheet} data-testid="sheet-export">
      <ViewBoundary name="sheet-export" fallback={sheetFallback(actions.closeSheet)} render={() => <ExportBody />} />
    </Sheet>
  );
};


export default React.memo(ExportSheet);
