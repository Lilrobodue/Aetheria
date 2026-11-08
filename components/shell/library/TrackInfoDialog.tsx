// components/shell/library/TrackInfoDialog.tsx (v15.7, the Library tab; mockup library-track-info-phone)
//
// Track info for any library track (the ⋯ menu's Track info shows only the playing one): a kit Dialog "Track info"
// with Copy and Close (ReadoutActions). The body is the track's name and a definition list from the pure
// trackInfoRows: Length, Crystal (and where it came from: an assigned crystal, not a measured pitch), Key, Visual sync,
// File and Added (from the id's import time). Copy puts the same rows on the clipboard, on a tap only. No scan date:
// none is stored, and v15.7 adds no Song field. The body is a `library-menu` region.
// v16.5 (Advanced's "Show experimental scan scores", mockup trackinfo-experimental-phone): while the switch is on, a
// section "Experimental scan scores" follows, with scanScores.ts's lead, names and notes (scanScoresModel.scanScoreRows):
// never the safety level or the recommended volume. Copy includes it. The new layout's ⋯ › Track info opens this dialog
// too, for the playing track (TrackInfoHost), in place of classic's readout.
// v16.8.3 (Track Tuning): the Tuning row after Key (libraryModel tuningRow). With a choice it is the kit's native Select
// labelled "Tuning" (the row's dt dropped, so the label is said once), its note under it and read with it (describedBy);
// a change applies at once (actions.setTrackTuning) and is announced politely in this dialog's own live region (the
// shell's announcer sits in #root, which is inert while a dialog is open). The shifts (fitShift, up to two full scans)
// are made once per open, for the track's key data and crystal (never per render, never per tick); A1's Lo Shu test
// (one musicFit) follows the tuning.
// v16.8.3 fix round 1: the Lo Shu fit and its test are for the tone the device plays (SoundValue's planOutput: S2); the
// Lo Shu test is memoised on what it reads (N7: never once per render, and never twice for Copy); Analyse tracks' caps
// give a long track's reason (S3).
// Fix round 1, screens: the choice row is no definition-list row, so it sits between two lists, never inside one (N1);
// a choice that turns the row plain moves focus to that row (tabIndex -1: SF4), so it never falls to the page.

import React from 'react';
import Dialog, { ReadoutActions } from '../../ui/Dialog';
import { PanelFallback, ViewBoundary } from '../../ErrorBoundary';
import type { Song } from '../../../types';
import { countRender } from '../devRenders';
import { useActions, useLibraryStatus, useMore, useShell, useSound } from '../contexts';
import { EvidenceOrigin } from '../../guide/evidenceLink';
import { loShuFitsNow, trackInfoRows, trackInfoText, tuneShiftsFor } from './libraryModel';
import type { InfoRow, TrackInfoCtx, TuneOptionId, TuneShifts } from './libraryModel';
import { PERFECT_GUT_MAP } from '../shellModel';
import Select from '../../ui/Select';
import { SCAN_SECTION_LEAD, SCAN_SECTION_TITLE, scanScoreRows, scanScoreText } from './scanScoresModel';
import EvidenceTag from '../../ui/EvidenceTag';

interface TrackInfoDialogProps {
  song: Song;
  onClose: () => void;
}

/** v16.8.3: the Tuning row as a choice: the kit Select labelled "Tuning", its note read with it, a change at once. */
const TuningChoiceRow = React.memo(({ song, row, onChose }: { song: Song; row: InfoRow; onChose: (spoken: string) => void }) => {
  const actions = useActions();
  const choice = row.choice!;
  const noteId = `track-info-tuning-note-${song.id}`;
  const onChange = (id: TuneOptionId) => {
    const o = choice.options.find((x) => x.id === id);
    if (!o || id === choice.value || id === 'kept') return;
    actions.setTrackTuning(song.id, o.cents, o.forCrystal, o.loShu);
    onChose(o.spoken);
  };
  return (
    <div data-testid="track-info-tuning" data-tuning={choice.value} className="py-2 border-b border-line">
      <Select label={row.label} value={choice.value} options={choice.options.map((o) => ({ id: o.id, label: o.label }))} onChange={onChange} describedBy={noteId} data-testid="track-info-tuning-select" />
      <span id={noteId} data-testid="track-info-tuning-note" className="mt-1 block text-xs text-ink-faint">
        {choice.note}
      </span>
    </div>
  );
});

/** One definition-list row (dt + dd). The plain Tuning row takes focus when a choice turns it plain (tabIndex -1). */
const InfoRowItem = React.memo(({ r, rowRef }: { r: InfoRow; rowRef?: React.Ref<HTMLDivElement> }) => {
  const tuning = r.label === 'Tuning';
  return (
    <div
      ref={tuning ? rowRef : undefined}
      tabIndex={tuning ? -1 : undefined}
      data-testid={tuning ? 'track-info-tuning' : undefined}
      className={`grid grid-cols-[104px_1fr] gap-3 py-2 border-b border-line${tuning ? ' focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400' : ''}`}
    >
      <dt className="text-ink-muted">{r.label}</dt>
      <dd className="min-w-0 text-ink-strong break-words">
        {r.value}
        {r.note && r.tag ? (
          // v16.6: an assigned crystal is a design choice, not a measured pitch: the note carries its tag.
          <div data-evidence={r.tag}>
            <span className="block text-xs text-ink-faint">{r.note}</span>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-3">
              <EvidenceTag tier={r.tag} />
            </div>
          </div>
        ) : r.note ? (
          <span className="block text-xs text-ink-faint">{r.note}</span>
        ) : null}
      </dd>
    </div>
  );
});

const TrackInfoBody = ({ song, scores, bands, perfectGut, shifts, ctx }: { song: Song; scores: boolean; bands: ArrayLike<number> | null; perfectGut: boolean; shifts: TuneShifts; ctx: TrackInfoCtx }) => {
  countRender('TrackInfo');
  const rows = trackInfoRows(song, Date.now(), bands, perfectGut, shifts, ctx);
  const scoreRows = scores ? scanScoreRows(song) : [];
  // v16.8.3: the Tuning choice's polite announcement (always mounted, so a choice that turns the row plain is read too).
  const [said, setSaid] = React.useState('');
  // Fix round 1 (SF4): a choice was made in the select; if it turned the row plain, the select is gone and focus with it:
  // it goes to the plain row (never left on the page's body).
  const refocus = React.useRef(false);
  const plainTuningRef = React.useRef<HTMLDivElement | null>(null);
  const onChose = React.useCallback((spoken: string) => {
    refocus.current = true;
    setSaid(spoken);
  }, []);
  React.useLayoutEffect(() => {
    if (!refocus.current) return;
    const row = plainTuningRef.current;
    if (!row) return; // still a choice: the select keeps its focus
    refocus.current = false;
    const a = document.activeElement;
    if (!a || a === document.body) row.focus();
  });
  // Fix round 1 (N1): the rows in definition lists, the Tuning choice (a labelled select, not a dt/dd pair) between them.
  const parts: Array<{ key: string; choice: InfoRow | null; rows: InfoRow[] }> = [];
  for (const r of rows) {
    if (r.choice) parts.push({ key: `choice-${r.label}`, choice: r, rows: [] });
    else if (parts.length && !parts[parts.length - 1].choice) parts[parts.length - 1].rows.push(r);
    else parts.push({ key: `dl-${r.label}`, choice: null, rows: [r] });
  }
  return (
    <div data-testid="track-info-body">
      <p className="text-base text-ink-strong break-words">{song.name}</p>
      <span role="status" aria-live="polite" aria-atomic="true" data-testid="track-info-tuning-live" className="sr-only">
        {said}
      </span>
      {parts.map((part, i) => part.choice ? (
        <TuningChoiceRow key={part.key} song={song} row={part.choice} onChose={onChose} />
      ) : (
        <dl key={part.key} className={i === 0 ? 'mt-2' : undefined}>
          {part.rows.map((r) => <InfoRowItem key={r.label} r={r} rowRef={plainTuningRef} />)}
        </dl>
      ))}
      {scoreRows.length ? (
        <section aria-labelledby="track-info-h-scores" data-testid="track-info-scores" data-evidence="design" className="mt-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
            <h3 id="track-info-h-scores" className="text-xs font-semibold uppercase tracking-widest text-ink-soft">
              {SCAN_SECTION_TITLE}
            </h3>
            <EvidenceTag tier="design" />
          </div>
          <p className="mt-1 text-xs text-ink-muted leading-snug">{SCAN_SECTION_LEAD}</p>
          <dl className="mt-1">
            {scoreRows.map((r) => (
              <div key={r.label} className="grid grid-cols-[104px_1fr] gap-3 py-2 border-b border-line">
                <dt className="text-ink-muted">{r.label}</dt>
                <dd className="min-w-0 text-ink-strong break-words">
                  {r.value}
                  {r.note ? <span className="block text-xs text-ink-faint">{r.note}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
};

const TrackInfoDialog = ({ song, onClose }: TrackInfoDialogProps) => {
  const { scanScores } = useMore();
  // v16.6 (review D1): its tags lead back here, whichever host opened it (⋯ › Track info, a Library row, a playlist's
  // entry): the Guide's "Back to Track info" reopens it for this track, on the tab it was on.
  const { tab } = useShell();
  const origin = React.useMemo(() => ({ tab, sheet: null, label: 'Track info', trackInfo: song.id }), [tab, song.id]);
  const extra = scanScores ? scanScoreText(song) : '';
  // v16.8.2 (K7): the track's key bands from App's cache (null without a clear key or before they are made).
  const bands = useLibraryStatus().keyBands.get(song);
  // (Fix round 1, L-N3: with Lo Shu Perfect GUT on, no key note on the six crystals it swaps.)
  const { perfectGut, planOutput } = useSound();
  // v16.8.3: the Tuning row's shifts, once per open: for this track's key data and crystal (a change of tuning, the
  // bands arriving or a re-render make none again). Fix round 1 (S2): the Lo Shu one for the tone this output plays.
  const shifts: TuneShifts = React.useMemo(
    () => tuneShiftsFor(song, perfectGut, planOutput),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [song.id, song.chroma, song.chromaA4Hz, song.musicKey, song.keyConfidence, song.chromaVersion, song.duration, song.file, song.closestSolfeggio, perfectGut, planOutput]
  );
  // Fix round 1 (N7): the Crystal note's Lo Shu test (one musicFit, only on the six with Perfect GUT on), made again only
  // when what it reads changes: the key data, the crystal, the tuning's cents, the setting, the output.
  const swapped = perfectGut && typeof song.closestSolfeggio === 'number' && PERFECT_GUT_MAP[song.closestSolfeggio] !== undefined;
  const loShuFits: boolean = React.useMemo(
    () => (swapped ? loShuFitsNow(song, planOutput) : false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [swapped, song.id, song.chroma, song.chromaA4Hz, song.musicKey, song.keyConfidence, song.chromaVersion, song.closestSolfeggio, song.tuneCents, song.tuneFor, planOutput]
  );
  const { analyseCaps } = useLibraryStatus();
  const ctx: TrackInfoCtx = React.useMemo(() => ({ output: planOutput, caps: analyseCaps, loShuFits }), [planOutput, analyseCaps, loShuFits]);
  return (
    <Dialog
      open
      title="Track info"
      onClose={onClose}
      actions={<ReadoutActions body={extra ? `${trackInfoText(song, Date.now(), bands, perfectGut, shifts, ctx)}

${extra}` : trackInfoText(song, Date.now(), bands, perfectGut, shifts, ctx)} onClose={onClose} />}
      data-testid="track-info-dialog"
    >
      <ViewBoundary
        name="library-menu"
        fallback={(api) => (
          <PanelFallback text="Track info hit a problem." switchedOff={api.switchedOff} copyDetails={api.copyDetails} buttonRef={api.buttonRef} onRetry={api.retry} />
        )}
        render={() => (
          <EvidenceOrigin.Provider value={origin}>
            <TrackInfoBody song={song} scores={scanScores} bands={bands} perfectGut={perfectGut} shifts={shifts} ctx={ctx} />
          </EvidenceOrigin.Provider>
        )}
      />
    </Dialog>
  );
};

export default React.memo(TrackInfoDialog);
