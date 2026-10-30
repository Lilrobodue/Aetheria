// utils/export/exportWords.ts (v16.5, Export with layers: every word the export shows; the addendum §3.14, with the
// user's decisions 1 B, 2 B, 3 A and 4 B). New words, for the copy pass (v16.6); none states an effect. Pure; checked by
// exportPlan.check.ts.

import type { ExportSpec, MadeFor, FileKind, CapInfo } from './exportPlan.ts';

// ---- The rows
export const EXPORT_ROW = 'Export with layers…';
export const ROW_LIBRARY = 'A new WAV file of this track, with its layers';
export const ROW_PLAYING = 'This track as a new WAV file, with its layers';
export const ROW_PLAYLIST = 'Its tracks as WAV files, with their layers';
export function rowExporting(percent: number): string {
  return `Exporting · ${Math.max(0, Math.min(100, Math.round(percent)))} %`;
}

// ---- The Record sheet
export const RECORD_SUBTITLE_EXPORT = 'Export a file, or record live';
export const MAKE_A_FILE = 'Make a file';
export const RECORD_LIVE = 'Record live';
export function recordExportLine(title: string | null, seconds: number | null): string {
  if (!title) return "Choose a track's ⋯ in Library, or play something first.";
  return `${title} as a new WAV file, with its layers${seconds ? `, in ${aboutTime(seconds)}` : ''}`;
}
export const FASTER_LINE = "Faster than real time: no need to listen through. To export another track or a playlist, use its ⋯.";

// ---- The summary
export const SHEET_TITLE = 'Export with layers';
export const HOLDS = 'The file will hold';
export const MUSIC_LINE = 'Retuned to 432 Hz, as you hear it';
export const MUSIC_LEVEL = 'At its own level: never turned down';
export const MUSIC_ONLY_LINE = 'Music only is on, so the file has the music alone.';
export const ENGINE_NOTE = "Uses v2 sound: Classic sound can't be exported.";
export const PHI_ON = 'The layers rise and settle over the track';
export const PHI_OFF = 'Off';
export const NO_KEY = 'No key data for this track';
export const KEY_OFF = 'Off';

const BAND_NAME: Record<string, string> = { delta: 'Delta', theta: 'Theta', alpha: 'Alpha', beta: 'Beta', gamma: 'Gamma' };

/** The crystal row: "528 Hz · GUT" and where it comes from. */
export function crystalRow(spec: ExportSpec): { value: string; note: string } {
  if (spec.origin === 'none' || spec.crystalHz === null) return { value: 'None yet', note: 'None yet: the file has the music only' };
  const hz = `${spec.crystalHz} Hz`;
  if (spec.origin === '111') return { value: hz, note: '111 Hz: not a crystal, plays as itself' };
  if (spec.origin === 'playing') return { value: hz, note: 'Playing now (picked by hand)' };
  return { value: hz, note: 'Its assigned crystal' };
}

/** The layers row: "Binaural beat Alpha, following the music · drone · tone −26 dB". */
export function layersRow(spec: ExportSpec, bands: number): string {
  if (!spec.layers) return spec.musicOnly ? MUSIC_ONLY_LINE : 'None: the file has the music only';
  const band = BAND_NAME[spec.startBand] ?? 'Alpha';
  const beat = spec.render === 'binaural' ? `Binaural beat ${band}` : spec.render === 'pulse' ? `A gentle pulse, ${band}` : 'No beat';
  const adaptive = spec.adaptive && spec.render !== 'off' ? ', following the music' : '';
  const parts = [beat + adaptive];
  if (spec.render === 'binaural' && spec.gains.drone > 0) parts.push('drone');
  const toneDb = spec.gains.tone > 0 ? 20 * Math.log10(spec.gains.tone) + -26 : null;
  parts.push(toneDb === null ? 'tone off' : `tone ${formatDbWord(toneDb)}`);
  void bands;
  return parts.join(' · ');
}

function formatDbWord(db: number): string {
  const r = Math.round(Math.abs(db) * 10) / 10;
  return `${db < 0 ? '−' : '+'}${r.toFixed(1)} dB`;
}

/** Key fit's row. */
export function keyFitRow(spec: ExportSpec, on: boolean, hasKey: boolean): string {
  if (!on) return KEY_OFF;
  if (!hasKey) return NO_KEY;
  if (spec.duckDb < -0.05) return `Lowers the layers ${(Math.round(-spec.duckDb * 10) / 10).toFixed(1)} dB on this track`;
  return 'Fits this track: the layers stay as they are';
}

// ---- Made for (decision 1 B)
export const MADE_FOR_LABEL = 'Made for';
export const MADE_FOR_WORDS: Record<MadeFor, { title: string; line: string }> = {
  headphones: { title: 'Headphones', line: 'The binaural beat and the drone need headphones.' },
  speakers: { title: 'Speakers', line: 'A gentle pulse in place of the binaural beat; no drone.' },
  tone: { title: 'Tone only', line: 'The music and a quiet tone, as Car output plays it.' },
};
export function yourOutput(madeFor: MadeFor): string {
  return `Your Output: ${MADE_FOR_WORDS[madeFor].title}`;
}

// ---- The file line (decision 4 B)
export const FORMAT_WORDS = 'WAV · 24-bit · 48 kHz';
export function fileLine(outSeconds: number, bytes: number): string {
  return `${FORMAT_WORDS} · ${clock(outSeconds)} · about ${mb(bytes)}`;
}
export function savedWhen(seconds: number | null): string {
  return `Saved to your downloads when it's done${seconds ? `, in ${aboutTime(seconds)}` : ''}. The music keeps playing.`;
}

// ---- Running
export type Phase = 'hold' | 'read' | 'decode' | 'layers' | 'mix' | 'save';
export const PHASE_WORDS: Record<Phase, string> = {
  hold: 'Waiting for the track change',
  read: 'Reading the file',
  decode: 'Decoding',
  layers: 'Adding the layers',
  mix: 'Writing the file',
  save: 'Saving',
};
export const CANCELLING = 'Cancelling…';
export const CLOSE_LINE = 'You can close this. The export carries on while Aetheria is open, and a message says when the file is saved.';
export const KEEP_OPEN = "Keep Aetheria open until it's done.";

/** "About 10 s left", "About 1 min 20 s left", "Almost done". */
export function timeLeft(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  if (seconds < 3) return 'Almost done';
  if (seconds < 60) return `About ${Math.max(5, Math.round(seconds / 5) * 5)} s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round((seconds - m * 60) / 10) * 10;
  return s >= 60 ? `About ${m + 1} min left` : s ? `About ${m} min ${s} s left` : `About ${m} min left`;
}

// ---- Done (decision 3 A: saved straight to Downloads)
export const SAVED = 'Saved to your downloads';
export const SHARE = 'Share…';
export const DONE = 'Done';
export const SHARE_LINE = 'Share sends a copy to another app. It takes files up to 50 MB.';
export const TOO_LARGE = 'Too large to share from here (over 50 MB). Open it from your downloads to send it.';
export const LOUD_LINE = 'This track is mastered loud, so the layers dip at its loudest moments.';
export const SHARE_FAILED = "Share isn't available for this file. It's in your downloads.";
/** v16.5 review (B12): Share keeps its copy for 10 minutes; after that the file is in the downloads only. */
export const SHARE_GONE = 'Share kept its copy for 10 minutes. The file is in your downloads: send it from there.';
export function savedToast(name: string): string {
  return `Saved to your downloads: ${name}`;
}
export function doneLine(outSeconds: number, bytes: number): string {
  return `${clock(outSeconds)} · ${mb(bytes)} · WAV 24-bit 48 kHz`;
}

// ---- Can't
export const AUDIO_MISSING = "This track's audio isn't stored on this device.";
export const BUSY_ANALYSE = "Analyse tracks is running. Export when it's done, or stop it in Library.";
export const BUSY_SCAN = "Deep Scan is running. Export when it's done, or stop it in Library.";
export const ANOTHER = 'Another export is running.';
export const OFFLINE_FIRST = 'Export needs one visit online first.';
export const CANT_DECODE = "This file can't be decoded in this browser.";
/** v16.5 review (B1): a track whose length can't be read can't be checked against the memory cap, so it isn't decoded. */
export const NO_LENGTH = "This track's length can't be read, so it can't be checked to fit in memory. Play it once, then try again.";
export const NO_MEMORY = 'Not enough memory for this track. Close other tabs or apps and try again.';
/** v16.5 re-review: a file with more than two channels (a 5.1 mix) is refused: the export writes stereo. */
export const MULTICHANNEL = 'This file has more than two channels. Export makes stereo files only.';
/** v16.5 re-review (B6): a stored file that can't be read back (NotReadableError). */
export const CANT_READ = "This track's audio can't be read from this device's storage. Import it again, then try again.";
/** v16.5 final: on a phone, a track whose length the export can't establish itself (its header doesn't state it and no
 *  frame walk measures it) isn't decoded: a wrong estimate would decode past the phone's memory. */
export const NO_PHONE_LENGTH = "This track's length can't be checked on a phone, so it can't be exported here. A computer can export it.";
/** v16.5 re-review (B10/B5): Cancel's wait, after which a job that hasn't stopped is let go. */
export const CANCEL_LET_GO = "Cancelled. The export didn't stop in time, so it was let go: nothing more from it will be saved.";
/** v16.5 final: a let-go job may still be decoding (a decode can't be stopped), so a new export, Analyse tracks and Deep
 *  Scan wait until it has stopped (Record and Reload don't: they don't decode). */
export const STILL_STOPPING = "The cancelled export is still stopping. Export again when it has stopped.";
export const ANALYSE_WHILE_STOPPING = "Analyse tracks can't start while the cancelled export is still stopping. Start it when it has stopped.";
export const SCAN_WHILE_STOPPING = "Deep Scan can't start while the cancelled export is still stopping. Start it when it has stopped.";
/** Under a held button (the health card, classic's Analyse tracks and Deep Scan). */
export const BUSY_STOPPING = 'Unavailable while the cancelled export stops';
/** v16.5 export memory: after a minute still stopping, the held lines add the way out that always works (a reload is
 *  free: the export saves nothing more and holds no library write). */
export const STILL_STOPPING_LONG = 'The cancelled export is still stopping. Export again when it has stopped, or reload Aetheria.';
export const ANALYSE_WHILE_STOPPING_LONG = "Analyse tracks can't start while the cancelled export is still stopping. Start it when it has stopped, or reload Aetheria.";
export const SCAN_WHILE_STOPPING_LONG = "Deep Scan can't start while the cancelled export is still stopping. Start it when it has stopped, or reload Aetheria.";
export const BUSY_STOPPING_LONG = 'Unavailable while the cancelled export stops, or reload Aetheria';
export const SOMETHING = 'Something went wrong making the file.';
export const TRY_AGAIN = 'Try again';

// ---- While an export runs (v16.5 review B10): the app's other decodes and a recording wait for it
export const RECORD_WHILE_EXPORTING = "Recording can't start while an export runs. Start it when the export is done.";
export const ANALYSE_WHILE_EXPORTING = "Analyse tracks can't start while an export runs. Start it when the export is done.";
export const SCAN_WHILE_EXPORTING = "Deep Scan can't start while an export runs. Start it when the export is done.";
/** Under a held button (the health card, classic's Analyse tracks and Deep Scan). */
export const BUSY_EXPORT = 'Unavailable while an export runs';
/** The Record sheet, while an export runs. */
export const RECORD_EXPORTING_LINE = 'An export is running: record live when it is done.';
export function stopped(reason: string): string {
  return `The export stopped: ${reason.replace(/\.$/, '')}.`;
}

/** "This track is 47 minutes long. On a phone, Export with layers takes tracks up to 10 minutes; on a computer, up to
 *  23." AAC names its kind. */
export function overCap(sourceSeconds: number, kind: FileKind | 'hires', mobile: boolean, phoneMin: number, computerMin: number, kHz?: number | null): string {
  const len = Math.max(1, Math.round(sourceSeconds / 60));
  const what = kind === 'aac' ? 'this kind of file (AAC audio)' : kind === 'hires' ? `this kind of file (${kHz ? `${kHz} kHz` : 'high sample rate'})` : 'tracks';
  // v16.5 export memory: a source whose first minute is already over this phone's budget (a 96 kHz WAV on a 2 GB phone).
  if (mobile && phoneMin < 1) return `This track is ${len} minutes long. On this phone, Export with layers can't take ${what}; on a computer, up to ${computerMin} minutes.`;
  return mobile
    ? `This track is ${len} minutes long. On a phone, Export with layers takes ${what} up to ${phoneMin} minutes; on a computer, up to ${computerMin}.`
    : `This track is ${len} minutes long. On a computer, Export with layers takes ${what} up to ${computerMin} minutes.`;
}
/** v16.5 review (B2): the engine's refusal, with the caps for the file's own source (a 96 kHz file has lower ones). */
export function overCapInfo(c: CapInfo, mobile: boolean): string {
  if (c.what === 'long') return longOverCap(c.seconds, c.phoneMin * 60, mobile);
  return overCap(c.seconds, c.what === 'hires' ? 'hires' : c.what === 'aac' ? 'aac' : 'other', mobile, c.phoneMin, c.computerMin, c.kHz);
}
/** Under the over-the-cap message (export-overcap-phone.png). */
export function overCapWhy(mobile: boolean): string {
  return mobile
    ? 'Longer tracks need more memory than a phone can safely give while the music plays.'
    : 'Longer tracks need more memory than the browser can safely give while the music plays.';
}
export const CLOSE = 'Close';

// ---- Playlists (decision 2 B: one file per track, or one long file)
export const FILES_LABEL = 'Files';
export const ONE_PER_TRACK = 'One per track';
export const ONE_LONG = 'One long file';
export const LONG_LINE = 'No gaps, the layers carry on across tracks. Downloads only.';
export const TOO_LONG_SKIPPED = 'Too long: skipped';
export const NO_CRYSTAL = 'No crystal: music only';
export const MISSING_SKIPPED = 'Audio missing: skipped';
/** v16.5 review (B6): what a playlist export did with each track it didn't save (the Done and the stopped screens). */
export type SkipWhy = 'too-long' | 'missing' | 'decode' | 'length' | 'channels' | 'unreadable' | 'untrusted';
export const SKIP_WORDS: Record<SkipWhy, string> = {
  'too-long': 'too long for this device',
  missing: "its audio isn't on this device",
  decode: "it can't be decoded in this browser",
  length: "its length can't be read",
  // v16.5 re-review
  channels: 'it has more than two channels',
  unreadable: "its audio can't be read",
  // v16.5 final
  untrusted: "its length can't be checked on a phone",
};
/** "Skipped 1: tone-0002 (it can't be decoded in this browser)." */
export function skippedLine(list: ReadonlyArray<{ title: string; why: SkipWhy }>): string | null {
  if (!list.length) return null;
  return `Skipped ${list.length}: ${list.map((s) => `${s.title} (${SKIP_WORDS[s.why]})`).join('; ')}.`;
}
/** "Saved 2 of 3." */
export function savedOf(saved: number, total: number): string {
  return saved === total ? SAVED : `Saved ${saved} of ${total} to your downloads`;
}
/** The long file stops at a track it can't decode (its layers are planned for every track). */
export function longCantDecode(title: string): string {
  return `${title} can't be decoded in this browser. Export one file per track to save the others`;
}
/** v16.5 re-review: the long file stops at a track with more than two channels, or one it can't read. */
export function longMultichannel(title: string): string {
  return `${title} has more than two channels, and Export makes stereo files only. Export one file per track to save the others`;
}
export function longCantRead(title: string): string {
  return `${title}'s audio can't be read from this device's storage. Export one file per track to save the others`;
}
export const SEVERAL_DOWNLOADS = 'Chrome may ask once to allow several downloads: choose Allow.';
export const PLAYLIST_CANCEL_LINE = 'Cancel stops before the next file is written: the files already saved stay in your downloads.';
export function playlistTotals(files: number, bytes: number, seconds: number): string {
  return `${files} file${files === 1 ? '' : 's'}, one per track · about ${mb(bytes)} · ${aboutTime(seconds)}`;
}
export function longTotals(outSeconds: number, bytes: number, seconds: number): string {
  return `One file · ${clock(outSeconds)} · about ${mb(bytes)} · ${aboutTime(seconds)}`;
}
export function longOverCap(sourceSeconds: number, capSeconds: number, mobile: boolean): string {
  // v16.5 export memory: no long file at all with these tracks on this phone (its heaviest track leaves no room).
  if (capSeconds < 60) return `This playlist is ${Math.round(sourceSeconds / 60)} minutes long. ${mobile ? 'On this phone' : 'On this computer'}, its tracks need more memory than one long file can have: export one file per track instead.`;
  return `This playlist is ${Math.round(sourceSeconds / 60)} minutes long. ${mobile ? 'On a phone' : 'On a computer'}, one long file takes up to ${Math.floor(capSeconds / 60)} minutes: export one file per track instead.`;
}
export const LONG_TOO_BIG = "This file would pass the WAV format's 4 GB limit: export one file per track instead.";
export function trackOf(i: number, n: number, title: string): string {
  return `Track ${i} of ${n} · ${title}`;
}
export function shareAll(n: number): string {
  return n === 1 ? SHARE : `Share all ${n}`;
}

// ---- The More card
export function moreCardTitle(title: string, percent: number): string {
  return `Exporting ${title} · ${Math.max(0, Math.min(100, Math.round(percent)))} %`;
}
export function moreCardLine(seconds: number | null): string {
  const left = timeLeft(seconds);
  return `${left ? `${left} · ` : ''}saved to your downloads when done`;
}
export const OPEN = 'Open';

// ---- Shared formatting
/** "3:19", "1:02:03". */
export function clock(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
/** "35 MB", "1.2 GB" (decimal megabytes, as file managers show them). */
export function mb(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(b / 1e6))} MB`;
}
/** "about 20 s", "about 2 min". */
export function aboutTime(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `about ${Math.max(5, Math.round(s / 5) * 5)} s`;
  return `about ${Math.round(s / 60)} min`;
}
