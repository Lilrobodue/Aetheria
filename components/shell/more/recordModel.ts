// components/shell/more/recordModel.ts (v16.5, Record and the REC pill; v16.4 spec §3.8, decisions 3 and 4)
//
// The Record sheet's words and states, the REC pill's names, and the More root's recording card and Record row. The
// classic Record dialog's line and its three labels are moved verbatim (classic still shows them); every other line
// is new (v16.4 spec §3.14, for the copy pass). Pure; Node checks it (moreModel.check.ts: `npm run check:shell`).

export type RecordKind = 'audio' | 'video' | 'both';

export const RECORD_TITLE = 'Record';
export const RECORD_SUBTITLE = 'Audio, visuals or both';
export const RECORD_SUBTITLE_RECORDING = 'Stop it here or from REC on any screen';
/** Classic's Record dialog's line. v16.6 (R12): its advice is gone (Audio Only is the mode that holds the whole recording
 *  in memory, so it was backwards). */
export const RECORD_CLASSIC_LINE = 'Choose a recording mode.';
/** No AudioContext yet (nothing has played): classic's Record silently does nothing then (v16.4 spec §2.5). */
export const RECORD_NOT_READY = 'Play something first: a recording starts from what is playing.';
export const RECORD_NO_VIDEO = "This browser can't record video.";
/** Under the video options while Pause visuals is on: a visual recording overrides it. */
export const RECORD_VISUALS_NOTE = 'The visuals run while a visual recording runs.';
export const RECORD_FOOTER = 'Saved to your downloads when you stop. Recording starts from what is playing now.';
export const RECORD_FOOTER_RECORDING = 'Saved to your downloads when you stop. The music keeps playing.';
export const RECORDING_WORD = 'Recording';
export const STOP_AND_SAVE = 'Stop and save';
/** The new layout's Stop and save, after classic's stopRecording has started the download. */
export const RECORD_SAVED_TOAST = 'Saved to your downloads.';

export interface RecordOption {
  kind: RecordKind;
  /** Classic's labels, verbatim. */
  title: string;
  line: string;
  /** The recording state's kind line. */
  what: string;
}

export const RECORD_OPTIONS: ReadonlyArray<RecordOption> = [
  { kind: 'audio', title: 'Audio Only', line: 'The music and the layers, as a 24-bit WAV file', what: 'a 24-bit WAV file' },
  { kind: 'video', title: 'Visuals Only', line: 'The visualizer as a video, without sound', what: 'a video, without sound' },
  { kind: 'both', title: 'AV Mix', line: 'The visualizer as a video, with the sound', what: 'a video, with the sound' },
];

const option = (kind: RecordKind): RecordOption => RECORD_OPTIONS.find((o) => o.kind === kind) ?? RECORD_OPTIONS[0];

/** "Audio Only · a 24-bit WAV file". */
export function recordKindLine(kind: RecordKind): string {
  const o = option(kind);
  return `${o.title} · ${o.what}`;
}

/** The More card's line: "Audio Only · saved to your downloads when you stop". */
export function recordCardLine(kind: RecordKind): string {
  return `${option(kind).title} · saved to your downloads when you stop`;
}

/** An option is offered only with an AudioContext (something has played) and, for video, MediaRecorder and
 *  canvas.captureStream. `reason` is the line it shows when not. */
export function recordOptionState(kind: RecordKind, audioReady: boolean, videoCapable: boolean): { disabled: boolean; reason: string | null } {
  if (!audioReady) return { disabled: true, reason: RECORD_NOT_READY };
  if (kind !== 'audio' && !videoCapable) return { disabled: true, reason: RECORD_NO_VIDEO };
  return { disabled: false, reason: null };
}

// The REC pill (decision 4 A): a tap opens the Record sheet everywhere but the Car screen, which keeps v15.5's one-tap
// stop (a driver needs one tap).
export type RecPillMode = 'open' | 'stop';
export const REC_OPEN_LABEL = 'Rec, recording. Open Record';
export const REC_STOP_LABEL = 'Rec, stop recording';

export function recPillLabel(mode: RecPillMode): string {
  return mode === 'stop' ? REC_STOP_LABEL : REC_OPEN_LABEL;
}

/** The More root's Record row while recording: "Recording · 3:12". */
export function recordingRowText(elapsed: string): string {
  return `${RECORDING_WORD} · ${elapsed}`;
}
