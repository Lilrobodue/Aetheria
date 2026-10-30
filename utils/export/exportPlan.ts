// utils/export/exportPlan.ts (v16.5, Export with layers; the addendum §3.2, §3.5, §3.6, §3.7; the user's decisions
// 1 B (Made for in the sheet), 2 B (a playlist as one long file too), 3 A (saved straight to Downloads), 4 B (24-bit,
// 48 kHz, like Record))
//
// What a file holds, as pure rules: the layers' spec for a track (exportSpecFor: the crystal, the output's render, the
// beat's band and its adaptive steps, the sliders' gains, Key fit's duck, φ), the file's name, size and time estimates,
// the memory caps per file type, the long file's cap, and the share rule. Everything the summary needs at once (this
// module is in the main chunk; the engine is lazy). Free of React and of the app's state; Node checks it
// (exportPlan.check.ts: `npm run check:export`).

import { canonicalLayerHz, renderForOutput, planOutputFor, bandOfPresetName, capBand, sliderGain, readIntensity, BandHysteresis, TONE_SLIDER_DEFAULT, BEAT_SLIDER_DEFAULT } from '../soundV2/layerHost.ts';
import type { LayerEngine, LayerOutput, BeatRender, EnvelopeLike } from '../soundV2/layerHost.ts';
import { bandForIntensity } from '../soundV2/aetheria_sound_v2.ts';
import type { Band } from '../soundV2/aetheria_sound_v2.ts';
import { keyFitFor } from '../soundV2/keyFit.ts';
import { PITCH_SHIFT_FACTOR } from '../../constants.ts';

// ---------------------------------------------------------------------------------------------------------------
// The file (decision 4 B: 24-bit, 48 kHz, like Record)
// ---------------------------------------------------------------------------------------------------------------

export const PSF = PITCH_SHIFT_FACTOR;
export const OUT_RATE = 48_000;
export const OUT_BITS = 24;
export const OUT_CHANNELS = 2;
export const BYTES_PER_FRAME = (OUT_BITS / 8) * OUT_CHANNELS;
/** The layers render at a quarter of the output rate (every layer is under ~1 kHz) and are interpolated ×4. */
export const LAYER_FACTOR = 4;
export const LAYER_RATE = OUT_RATE / LAYER_FACTOR;
/** The music's decode context runs at this rate; its samples read as OUT_RATE are the 432 varispeed (pitch and tempo). */
export const DECODE_RATE = OUT_RATE / PSF;
/** App's level tick, the adaptive band's tick, the layers' end fade, a track change's host glide (seconds). */
export const HOST_STEP_S = 0.25;
export const ADAPT_STEP_S = 3;
export const END_FADE_S = 2;
export const TRACK_GLIDE_S = 1.5;
/** WAV header bytes before the data (RIFF, fmt, LIST/INFO and data's own 8): an estimate's allowance. */
export const HEADER_ALLOWANCE = 512;
/** RIFF sizes are 32-bit: a file's data must stay under this (a long file above it is refused). */
export const RIFF_MAX_BYTES = 0xffff_ffff;

/** Output seconds for source seconds (the varispeed plays slower: 0.981818). */
export function outSeconds(sourceSeconds: number): number {
  return Number.isFinite(sourceSeconds) && sourceSeconds > 0 ? sourceSeconds / PSF : 0;
}

/** The WAV's bytes for this many source seconds. */
export function wavBytes(sourceSeconds: number): number {
  return HEADER_ALLOWANCE + Math.round(outSeconds(sourceSeconds) * OUT_RATE) * BYTES_PER_FRAME;
}

// ---------------------------------------------------------------------------------------------------------------
// Made for (decision 1 B): a choice in the sheet, starting from the user's Output; per sheet, never saved
// ---------------------------------------------------------------------------------------------------------------

export type MadeFor = 'headphones' | 'speakers' | 'tone';
export const MADE_FOR: ReadonlyArray<MadeFor> = ['headphones', 'speakers', 'tone'];

/** The sheet's starting choice: the user's Output (unanswered plays as Headphones). */
export function madeForDefault(output: LayerOutput | null | undefined): MadeFor {
  return output === 'car' ? 'tone' : output === 'speakers' || output === 'phone' ? 'speakers' : 'headphones';
}

/** The v2 output a choice renders for: Speakers is the phone speaker when that is the saved Output (its tone floor is
 *  200 Hz: toneOf(174, 'phone') = 348), else speakers; Tone only is Car's render. */
export function outputFor(madeFor: MadeFor, saved: LayerOutput | null | undefined): LayerOutput {
  if (madeFor === 'tone') return 'car';
  if (madeFor === 'speakers') return saved === 'phone' ? 'phone' : 'speakers';
  return 'headphones';
}

// ---------------------------------------------------------------------------------------------------------------
// The snapshot (read from App when the sheet opens and again on Export) and a track's spec (the addendum §3.2)
// ---------------------------------------------------------------------------------------------------------------

export interface ExportSnapshot {
  engine: LayerEngine;
  musicOnly: boolean;
  /** The saved Output (null: not answered yet). */
  output: LayerOutput | null;
  droneEnabled: boolean;
  keyFitOn: boolean;
  /** The v2 tone slider's level in effect now. */
  toneLevel: number;
  /** v15.6's tone lowering in effect (its track and the levels), or null. */
  lowering: { trackId: string | null; before: number; after: number } | null;
  /** binauralVolume. */
  beatLevel: number;
  /** selectedBinaural.name: the band in effect now. */
  presetName: string;
  adaptive: boolean;
  /** enablePhiMode && phiTimingEnabled. */
  phiOn: boolean;
  perfectGut: boolean;
  /** The playing (or loaded) track, and the crystal playing now (selectedSolfeggio: a hand pick or 111 included). */
  playingId: string | null;
  selectedHz: number;
}

/** What a track brings (types.ts Song). */
export interface ExportSong {
  id: string;
  name: string;
  duration?: number;
  closestSolfeggio?: number;
  bandEnvelope?: EnvelopeLike | null;
  chroma?: unknown;
  chromaA4Hz?: number;
  keyConfidence?: number;
  musicKey?: string;
}

export type CrystalOrigin = 'assigned' | 'playing' | '111' | 'none';

export interface ExportSpec {
  /** The crystal as stored or picked, or null (no layers). */
  crystalRaw: number | null;
  /** The crystal heard (Perfect GUT applied): the file's name and the summary. */
  crystalHz: number | null;
  origin: CrystalOrigin;
  /** canonicalLayerHz's f (0: no layers). */
  f: number;
  layers: boolean;
  output: LayerOutput;
  render: BeatRender;
  planOutput: 'headphones' | 'speakers' | 'phone';
  /** The band in effect at the tap. */
  startBand: Band;
  adaptive: boolean;
  gains: { tone: number; beat: number; drone: number };
  toneLevel: number;
  duckDb: number;
  phi: boolean;
  madeFor: MadeFor;
  /** Classic sound was chosen: the export plays v2 anyway (the note). */
  engineNote: boolean;
  musicOnly: boolean;
}

const hasEnvelope = (s: ExportSong): boolean => (s.bandEnvelope?.bass?.length ?? 0) > 0;

/** A track's spec: the addendum §3.2's table, row for row. */
export function exportSpecFor(snap: ExportSnapshot, song: ExportSong, madeFor: MadeFor): ExportSpec {
  const playing = !!snap.playingId && song.id === snap.playingId;
  const stored = typeof song.closestSolfeggio === 'number' && Number.isFinite(song.closestSolfeggio) && song.closestSolfeggio > 0 ? song.closestSolfeggio : null;
  const picked = Number.isFinite(snap.selectedHz) && snap.selectedHz > 0 ? snap.selectedHz : null;
  const crystalRaw = playing ? (picked ?? stored) : stored;
  const layer = crystalRaw !== null ? canonicalLayerHz(crystalRaw, snap.perfectGut) : { f: 0, id: null, canonical: false };
  const origin: CrystalOrigin = crystalRaw === null || !(layer.f > 0) ? 'none' : crystalRaw === 111 ? '111' : playing && picked !== null && picked !== stored ? 'playing' : 'assigned';
  const layers = !snap.musicOnly && layer.f > 0;
  const output = outputFor(madeFor, snap.output);
  const render = renderForOutput(output);
  const planOutput = planOutputFor(output);
  const startBand = bandOfPresetName(snap.presetName);
  // The tone level: for the playing track, the level in effect (a lowering for it included); for any other track, the
  // user's own level (a lowering's `before`, while the level is still the lowered one).
  const low = snap.lowering;
  const toneLevel = !playing && low && low.trackId !== song.id && snap.toneLevel === low.after ? low.before : snap.toneLevel;
  const gains = { tone: sliderGain(toneLevel, TONE_SLIDER_DEFAULT), beat: sliderGain(snap.beatLevel, BEAT_SLIDER_DEFAULT), drone: snap.droneEnabled ? 1 : 0 };
  const duckDb = snap.keyFitOn && layers ? keyFitFor(song, layer.f, planOutput, PSF).duck_db : 0;
  return {
    crystalRaw,
    crystalHz: layer.f > 0 ? layer.f : null,
    origin,
    f: layer.f,
    layers,
    output,
    render,
    planOutput,
    startBand,
    adaptive: snap.adaptive && render !== 'off' && hasEnvelope(song),
    gains,
    toneLevel,
    duckDb: Number.isFinite(duckDb) ? duckDb : 0,
    phi: snap.phiOn,
    madeFor,
    engineNote: snap.engine === 'classic',
    musicOnly: snap.musicOnly,
  };
}

/** The adaptive band, run ahead: App's own 3 s loop (BandHysteresis, readIntensity at the media time t × PSF, capBand to
 *  beta, or alpha for the pulse), ticking every 3 s of output time from the band in effect at the tap. The first entry
 *  is { t: 0, band: startBand }. */
export function bandSchedule(env: EnvelopeLike | null | undefined, startBand: Band, render: BeatRender, outSecondsTotal: number, adaptive = true): Array<{ t: number; band: Band }> {
  const out: Array<{ t: number; band: Band }> = [{ t: 0, band: startBand }];
  if (!adaptive || !env || render === 'off' || !((env.bass?.length ?? 0) > 0)) return out;
  const hyst = new BandHysteresis();
  const cap: Band = render === 'pulse' ? 'alpha' : 'beta';
  let current = startBand;
  for (let t = ADAPT_STEP_S; t < outSecondsTotal; t += ADAPT_STEP_S) {
    const target = capBand(bandForIntensity(readIntensity(env, t * PSF)), cap);
    const next = hyst.tick(target, current);
    if (next) {
      current = next;
      out.push({ t, band: next });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The name (the addendum §3.5)
// ---------------------------------------------------------------------------------------------------------------

const AUDIO_EXT = /\.(mp3|wav|flac|m4a|mp4|aac|ogg|oga|opus|webm|aif|aiff)$/i;

/** A title made safe for a file name: NFC; reserved characters and controls to a space; whitespace collapsed; spaces
 *  and dots trimmed; an audio extension dropped; at most 80 code points (never half a surrogate pair); "Track" if empty. */
export function safeTitle(title: string | null | undefined): string {
  let s = typeof title === 'string' ? title.normalize('NFC') : '';
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(AUDIO_EXT, '');
  s = s.replace(/^[\s.]+|[\s.]+$/g, '');
  const cps = Array.from(s);
  if (cps.length > 80) s = cps.slice(0, 80).join('').replace(/[\s.]+$/g, '');
  return s || 'Track';
}

/** "<title> · 528 Hz · Aetheria.wav"; Speakers / Tone only add "· speakers" / "· tone only"; no layers: "<title> ·
 *  Aetheria.wav". A long file is "<playlist> · Aetheria.wav". */
export function fileNameFor(title: string | null | undefined, hz: number | null, madeFor: MadeFor, withLayers: boolean): string {
  const parts = [safeTitle(title)];
  if (withLayers && hz !== null && hz > 0) {
    parts.push(`${Number.isInteger(hz) ? hz : Math.round(hz * 10) / 10} Hz`);
    if (madeFor === 'speakers') parts.push('speakers');
    if (madeFor === 'tone') parts.push('tone only');
  }
  parts.push('Aetheria');
  return `${parts.join(' · ')}.wav`;
}

export function longFileName(playlist: string | null | undefined): string {
  return `${safeTitle(playlist)} · Aetheria.wav`;
}

// ---------------------------------------------------------------------------------------------------------------
// Memory: the caps per file type (the addendum §3.6, re-derived at 48 kHz: see DECODE_MB_PER_MIN)
// ---------------------------------------------------------------------------------------------------------------

export type FileKind = 'aac' | 'other';

/** AAC (.m4a, .mp4, .aac; audio/mp4, audio/aac, audio/x-m4a) decodes at about twice the others' memory in Chrome. */
export function fileKind(file: { name?: string; type?: string } | null | undefined): FileKind {
  const name = (file?.name ?? '').toLowerCase();
  const type = (file?.type ?? '').toLowerCase();
  if (/\.(m4a|mp4|aac|m4b)$/.test(name)) return 'aac';
  if (type === 'audio/mp4' || type === 'audio/aac' || type === 'audio/x-m4a' || type === 'audio/m4a') return 'aac';
  return 'other';
}

/**
 * v16.5 re-review (B2): the kind from what the file's bytes say (sourceInfo's sniff) when they say it, else from its
 * name and type: AAC in an MP4 or as ADTS is 'aac' whatever it is called (an AAC named .mp3 costs AAC's 105 MB a
 * minute, not 86); an MP4 whose codec isn't known counts as AAC (the dearer); any other known container is 'other'.
 */
export function fileKindOf(file: { name?: string; type?: string } | null | undefined, sniffed?: { container: string; codec: string | null } | null): FileKind {
  if (sniffed && sniffed.container !== 'unknown') {
    if (sniffed.codec === 'aac') return 'aac';
    if (sniffed.container === 'mp4' && sniffed.codec === null) return 'aac';
    return 'other';
  }
  return fileKind(file);
}

/**
 * Chrome's decode peak, MB of renderer memory per source minute, decoding at DECODE_RATE (48,888.9 Hz) for a 48 kHz
 * file. Measured (v16.5 build, desktop Chrome, the scratch probe decode-48k.mjs: renderer private bytes over a settled
 * baseline, a fresh renderer per file, 3, 6 and 12-minute cuts; linear in length): MP3 44.1 kHz 62–66, OGG 61, WAV 65,
 * FLAC 65, WebM/Opus 81–84, MP3 48 kHz 85–86 (the worst of the "other" group), AAC .m4a 102–105. Each group's worst,
 * rounded up. Caps (whole minutes) were phone 10 / AAC 8; phone ≤ 4 GB 6 / 5; ≤ 2 GB 4 / 3; computer 23 / 19. v16.5 final:
 * with the export's own peak (exportPeakMB) phone 5 / AAC 3; ≤ 4 GB 5 / 2; ≤ 2 GB 2 / 1; computer 23 / 16. v16.5 export
 * memory (the phone's peak the larger of the step and the Note 20's line): phone 5 / 3; ≤ 4 GB 3 / 2; ≤ 2 GB 1 / 1;
 * computer 23 / 16. The user's 1,200 (2026-10-30): phone 10 / 5. v16.5 final (the phone gate's line, 200 + 120 a minute,
 * and the user's 1,500): phone 10 / 6; ≤ 4 GB 3 / 2; ≤ 2 GB 1 / 1; computer 23 / 16.
 */
export const DECODE_MB_PER_MIN: Readonly<Record<FileKind, number>> = { other: 86, aac: 105 };
/** The decode budgets, one named constant each: 1,500 on a phone over 4 GB (navigator.deviceMemory 8: 8 GB or more), 600
 *  on a phone with 4 GB or less, 375 with 2 GB or less, about 2 GB on a computer.
 *
 *  The phone figures (these three budgets and every phone constant below: PHONE_MB_PER_ROOM_MIB, PHONE_FIXED_MB,
 *  PHONE_MB_PER_MIN, AAC_EXPORT_MB_PER_MIN.phone, PHONE_LONG_MB_PER_MIN) are in the device tests' meminfo figure, not
 *  in megabytes of memory: the sum of the renderers' lines in all four of dumpsys meminfo's listings (RSS and PSS, each
 *  by process and by OOM adjustment), which reads 4.0 × their PSS (the Note 20, 2026-10-30: 128 MB held in a tab read
 *  549, 384 MB 1,574, 896 MB 3,624). Every phone point was measured in it, the Note 20's tab death (near 2,500: about
 *  625 MB) included, so the caps stand as measured; a quarter of each is the memory. A computer's figures are MB.
 *
 *  1,500 (about 375 MB, 60 % of the Note 20's tab death) is the user's choice (2026-10-30): 10-minute tracks, and the
 *  long file where its measured growth puts it (PHONE_LONG_MB_PER_MIN). Was 1,200 (for 10-minute tracks and 44-minute
 *  long files, before the phone gate measured the long file's real peak), and 900 before that. */
export const PHONE_BUDGET_MB = 1500;
export const PHONE_4GB_BUDGET_MB = 600;
export const PHONE_2GB_BUDGET_MB = 375;
export const COMPUTER_BUDGET_MB = 2000;
export const BUDGET_MB = { phone: PHONE_BUDGET_MB, phone4: PHONE_4GB_BUDGET_MB, phone2: PHONE_2GB_BUDGET_MB, computer: COMPUTER_BUDGET_MB } as const;

/**
 * v16.5 review (B2): the source counts. Measured (desktop Chrome, the scratch probe mem/decode-mem.mjs, a fresh renderer
 * per file, the decode peak over the bytes already held, MB per source minute, then the read buffer): PCM and FLAC at
 * 44.1 / 48 kHz 65 (+ 10 / 16.5 read); WAV 88.2/24 86–89 (+ 30); 96/16 137–143 (+ 22); 96/24 129–138 (+ 33); FLAC
 * 96/24 129 (+ 23.5); WAV 176.4/24 225 (+ 61); 192/24 233 (+ 66); MP3 44.1 and 48 kHz 62–63; AAC 44.1 kHz 90–107,
 * 96 kHz 263–265. So a lossless file costs PCM_BASE_MB plus PCM_MB_PER_KHZ for each kHz over 48, plus its own bytes
 * (the read buffer); a lossy file its type's cost plus LOSSY_MB_PER_KHZ for each kHz over 48 (a 96 kHz AAC); never
 * less than the type's cost above, so the caps of an ordinary 44.1 / 48 kHz file stand (decision 7).
 */
export const PCM_BASE_MB = 65;
export const PCM_MB_PER_KHZ = 1.8;
export const LOSSY_MB_PER_KHZ = 3.65;

/** What the export knows of a source before reading it (utils/export/sourceInfo's sniff and the established length). */
export interface SourceCost {
  /** The rate the decoder puts out (Hz), or null. */
  sampleRate?: number | null;
  lossless?: boolean;
  /** The file's bytes per second of source (its size over its length), or null. */
  bytesPerSecond?: number | null;
}

/** The decode's memory per source minute (MB) for this source: the type's cost for an ordinary file; more for a
 *  sample rate over 48 kHz, and a big lossless file's read buffer on top (B2). v16.5 re-review: the channels don't
 *  enter it: every figure was measured on stereo files, a mono decode holds one channel (less), and a file with more
 *  than two is refused (engine MAX_CHANNELS); a lossless file's own channels are in its bytes per second. */
export function decodeCostPerMin(kind: FileKind, src?: SourceCost | null): number {
  const base = DECODE_MB_PER_MIN[kind];
  const r = src && typeof src.sampleRate === 'number' && Number.isFinite(src.sampleRate) && src.sampleRate > 0 ? src.sampleRate : 0;
  const overKHz = Math.max(0, r - 48_000) / 1000;
  if (src && src.lossless) {
    const bps = typeof src.bytesPerSecond === 'number' && Number.isFinite(src.bytesPerSecond) && src.bytesPerSecond > 0 ? src.bytesPerSecond : 0;
    const read = (bps * 60) / (1024 * 1024);
    return Math.max(DECODE_MB_PER_MIN.other, PCM_BASE_MB + PCM_MB_PER_KHZ * overKHz + read);
  }
  return base + LOSSY_MB_PER_KHZ * overKHz;
}

/** The decode budget (MB) on this device: lower tiers for phones with ≤ 4 GB and ≤ 2 GB (navigator.deviceMemory; missing,
 *  0 or NaN: by mobile alone). */
export function decodeBudgetMB(mobile: boolean, deviceMemoryGB?: number | null): number {
  const dm = typeof deviceMemoryGB === 'number' && Number.isFinite(deviceMemoryGB) && deviceMemoryGB > 0 ? deviceMemoryGB : null;
  return mobile ? (dm !== null && dm <= 2 ? PHONE_2GB_BUDGET_MB : dm !== null && dm <= 4 ? PHONE_4GB_BUDGET_MB : PHONE_BUDGET_MB) : COMPUTER_BUDGET_MB;
}

/**
 * v16.5 final fixes (the Note 20's D-E1: 1,136 MB at the 10-minute phone cap, against its 900). Whole-export peaks over
 * a settled baseline (the dev hook, layers on, nothing saved):
 *   - the Note 20 (the device tests' meminfo figure: PHONE_BUDGET_MB's note): MP3 3 min 44.1 kHz 520, 10 min 48 kHz 1,136
 *     (v16.5 final: over five runs, 344 to 520 and 1,089 to 1,303; PHONE_MB_PER_MIN's note);
 *   - desktop Chrome with the Android UA (the renderers' private bytes), 48 kHz MP3: 3, 4, 5 min 275, 281, 286 MB; 6, 7,
 *     10 min 548, 551, 567; 20, 22 min 1,130, 1,190; 23 min 1,659. 44.1 kHz: 3 min 207, 5 min 276, 10 min 548. AAC: 3
 *     min 245, 8 min 952, 12 min 1,296, 19 min 2,153.
 * The MP3 peak is a step, not a line: it follows the room Chrome's decode has made for its output, which grows in
 * powers of two (its minutes at DECODE_RATE, stereo float, 22.4 MiB a minute: the steps at 5.7, 11.4 and 22.9
 * minutes, where 128, 256 and 512 MiB are passed). So a fixed part plus a minute (a two-point fit: 256 MB + 88 a
 * minute) put a phone's cap at 7 minutes, inside the 6–10 minute step the Note 20 measured at 1,136 MB. On a phone the
 * peak is PHONE_MB_PER_ROOM_MIB for each MiB of that room (the Note 20: 520 / 128 = 4.06 and 1,136 / 256 = 4.44), times
 * the source's weight (its decodeCostPerMin over the type's: a 96 kHz or a big lossless file costs more); its cap
 * stays under the step that would pass the budget. AAC grows with its length (not in steps): AAC_EXPORT_MB_PER_MIN, the
 * computer's 120 covering every desktop point (19 minutes was over the 2 GB budget: now 16), the phone's twice that
 * (the phone measured about twice desktop's peaks for MP3) until the Note 20 measures it (D-E1's M4A at its new cap).
 * The computer's MP3 minute stays the decode's 86 (every desktop point under it: 23 minutes 1,659 MB, cap unchanged).
 * One constant for longer phone exports: PHONE_MB_PER_ROOM_MIB (or BUDGET_MB.phone). (v16.5 final: from 8 minutes the line
 * below is the larger, so it sets the 10-minute cap; at 6 and 7 minutes the step still is.)
 *
 * v16.5 export memory: the step's cause isn't in Chrome's decode path (the review read media/filters/
 * audio_file_reader.cc and content/renderer/media/audio_decoder.cc: per-packet buffers, then one exact-size copy), so
 * a phone's peak isn't left to the step alone: it is the larger of the step (above) and a line over the Note 20's
 * points, PHONE_FIXED_MB + PHONE_MB_PER_MIN a source minute (first through 520 at 3 minutes and 1,136 at 10; v16.5 final:
 * over every D-E1 run, PHONE_MB_PER_MIN's note), its minute
 * scaled by the source's cost against the "other" group's (decodeCostPerMin: AAC's 105 against 86, a 96 kHz or a big
 * lossless file more). The fixed part is the export's own (the same for every file: desktop's AAC line starts lower
 * than its MP3's). The caps are then the longest whole minutes under the larger of the two (exportCapSeconds).
 */
export const PHONE_MB_PER_ROOM_MIB = 4.5;
export const AAC_EXPORT_MB_PER_MIN = { phone: 240, computer: 120 } as const;
/** v16.5 export memory: the Note 20's line (was 256 + 88 a minute, through 3 min 520 and 10 min 1,136). v16.5 final
 *  (2026-10-30, each decode let go once used: engine letGo): five D-E1 runs put the 10-minute 48 kHz MP3 at 1,089 to
 *  1,303, the 5-minute one at 528 to 714 and the 3-minute 44.1 kHz at 344 to 520, steeper than the line and not flat
 *  within a step: 200 + 120 a minute covers every point (3 min 560, 5 min 800, 10 min 1,400: 7 % over the highest). */
export const PHONE_FIXED_MB = 200;
export const PHONE_MB_PER_MIN = 120;
/** The decode's output, MiB a minute of source (DECODE_RATE, stereo float). */
export const DECODE_MIB_PER_MIN = (DECODE_RATE * 60 * 2 * 4) / (1024 * 1024);

/** The room (MiB) a decode of this many source minutes has made: its output rounded up to a power of two. */
export function decodeRoomMiB(sourceMinutes: number): number {
  if (!(sourceMinutes > 0)) return 0;
  return 2 ** Math.ceil(Math.log2(Math.max(1, sourceMinutes * DECODE_MIB_PER_MIN)));
}

/** The phone's step model alone (MB): the decode's room (PHONE_MB_PER_ROOM_MIB × the source's weight); AAC its minutes
 *  (AAC_EXPORT_MB_PER_MIN.phone × its weight). */
export function phoneStepMB(kind: FileKind, sourceSeconds: number, src?: SourceCost | null): number {
  const minutes = Math.max(0, sourceSeconds || 0) / 60;
  if (kind === 'aac') return AAC_EXPORT_MB_PER_MIN.phone * (decodeCostPerMin('aac', src) / DECODE_MB_PER_MIN.aac) * minutes;
  return PHONE_MB_PER_ROOM_MIB * (decodeCostPerMin(kind, src) / DECODE_MB_PER_MIN.other) * decodeRoomMiB(minutes);
}

/** The phone's line alone (MB): PHONE_FIXED_MB + PHONE_MB_PER_MIN × the source's cost against the "other" group's,
 *  a source minute. Nothing for no length. */
export function phoneLineMB(kind: FileKind, sourceSeconds: number, src?: SourceCost | null): number {
  const minutes = Math.max(0, sourceSeconds || 0) / 60;
  if (!(minutes > 0)) return 0;
  return PHONE_FIXED_MB + PHONE_MB_PER_MIN * (decodeCostPerMin(kind, src) / DECODE_MB_PER_MIN.other) * minutes;
}

/** A track's export peak (MB) on this device class: on a phone the larger of the step and the line (the conservative
 *  envelope: phoneStepMB, phoneLineMB); on a computer the decode's cost a minute (AAC: AAC_EXPORT_MB_PER_MIN.computer). */
export function exportPeakMB(kind: FileKind, sourceSeconds: number, mobile: boolean, src?: SourceCost | null): number {
  const minutes = Math.max(0, sourceSeconds || 0) / 60;
  if (mobile) return Math.max(phoneStepMB(kind, sourceSeconds, src), phoneLineMB(kind, sourceSeconds, src));
  if (kind === 'aac') return AAC_EXPORT_MB_PER_MIN.computer * (decodeCostPerMin('aac', src) / DECODE_MB_PER_MIN.aac) * minutes;
  return decodeCostPerMin(kind, src) * minutes;
}

/** The cap in seconds of source for one track: the longest whole minutes whose export peak (exportPeakMB) fits the
 *  budget. Without `src` (the sheet, before the file is read) the type's cost; with it (the engine, after the sniff)
 *  the source's. v16.5 export memory: 0 when not even a minute fits (it was at least 1: a 96 kHz WAV's first minute on a
 *  ≤ 2 GB phone is 445 MB against its 375; every file type's own first minute fits every tier). */
export function exportCapSeconds(kind: FileKind, mobile: boolean, deviceMemoryGB?: number | null, src?: SourceCost | null): number {
  const budget = decodeBudgetMB(mobile, deviceMemoryGB);
  let minutes = 0;
  while (minutes < 24 * 60 && exportPeakMB(kind, (minutes + 1) * 60, mobile, src) <= budget) minutes++;
  return minutes * 60;
}

/** What a refusal over the cap names: the track's length, the phone's and the computer's caps for its source, and
 *  which kind of file it is ('hires': a sample rate over 48 kHz). */
export interface CapInfo {
  seconds: number;
  phoneMin: number;
  computerMin: number;
  /** 'long': one long file over its own cap (phoneMin and computerMin are then that cap, on this device). */
  what: 'tracks' | 'aac' | 'hires' | 'long';
  /** The source's rate (kHz, rounded) for 'hires'. */
  kHz: number | null;
}

export function capInfoFor(seconds: number, kind: FileKind, deviceMemoryGB: number | null | undefined, src?: SourceCost | null): CapInfo {
  const r = src && typeof src.sampleRate === 'number' && src.sampleRate > 48_000 ? src.sampleRate : null;
  return {
    seconds,
    phoneMin: Math.floor(exportCapSeconds(kind, true, deviceMemoryGB, src) / 60),
    computerMin: Math.floor(exportCapSeconds(kind, false, null, src) / 60),
    what: r !== null ? 'hires' : kind === 'aac' ? 'aac' : 'tracks',
    kHz: r !== null ? Math.round(r / 100) / 10 : null,
  };
}

/** The long file's layers at LAYER_RATE, stereo float: MB per output minute. */
export const LAYERS_MB_PER_MIN = (LAYER_RATE * 2 * 4 * 60) / (1024 * 1024);

/**
 * One long file (decision 2 B): the layers for the whole length stay in memory (LAYERS_MB_PER_MIN), beside one track's
 * decode at a time. The cap in seconds of SOURCE for the whole playlist, given the heaviest track's decode (MB), from
 * the same budget; also never over the RIFF limit. Measured on the desktop (scratch measure-export.mjs, 10 × 3-min MP3
 * as one 30-minute file): the renderer peaked 403 MB over its baseline (one decode, the layers, the slices) and the
 * browser process 516 MB (Chrome's blob store holds the WAV there; on Android it pages to disk past a small in-memory
 * limit). An hour fits the phone's renderer budget, but the phone's blob store for a file over ~1 GB is not measured:
 * the phone kept 45 minutes (about 780 MB) until the Note 20 gate (device.spec D-E4) measured it (below); the over-the-cap line
 * names the limit.
 *
 * v16.5 export memory: the Note 20's D-E4 (15 × the 3-minute 44.1 kHz MP3, 45 source minutes) peaked 1,865 MB in its
 * renderers against the 900, its browser 130: the missing gigabyte fits the file's 755 MB of output held in the
 * renderer. The engine now hands each 4 MB part to the browser and waits for its receipt before the next
 * (OUT_PART_BYTES, below): at most two parts, OUT_TRANSIT_MB, are in the renderer whatever the length. The peak is then the
 * heaviest track's export peak (exportPeakMB: on a phone the envelope) + what grows with the length + OUT_TRANSIT_MB:
 *   - a phone: PHONE_LONG_MB_PER_MIN a source minute, then D-E4's growth with its output taken out: (1,865 − 755 − the
 *     track's own 520) / 45 = 13.1, rounded up (superseded by the phone gate's measurement: v16.5 final, below);
 *   - a computer: the layers (LAYERS_MB_PER_MIN an output minute). Desktop Chrome, Android UA (fix 4's probe: private
 *     bytes over a settled base, the output already in the browser before and after the fix), 5-minute 48 kHz MP3s:
 *     10 / 20 / 45 / 90 minutes 274 / 501 / 667 / 918 MB, against the model's 486 / 542 / 682 / 934; 15 × 3 min 44.1 kHz
 *     476 against 510.
 * The budgets are the tracks' (decodeBudgetMB); the rule (LONG_CAP_MIN) stays an upper bound.
 *
 * v16.5 final (the Note 20, 2026-10-30): the 13.1 above held only what a collection was left to free. With each decode let
 * go once its track is trimmed (engine letGo), the long file's own peak is still mostly its layers, one buffer for the
 * whole length (about 24 a minute in the meminfo figure), and it creeps by about 30 a track through the mix: 8 × the
 * 3-minute 44.1 kHz MP3 (24 minutes) 1,043, 14 of them (42 minutes) 1,818, and D-E4's 42 minutes with the library
 * playing 1,930 (it was 1,747 to 2,616 before the decodes were let go). So PHONE_LONG_MB_PER_MIN is 34: the heaviest
 * track's peak (576) + 34 a minute + the parts covers D-E4's 1,930 at 42 minutes (2,012) and puts the cap for 3-minute
 * songs at 26 minutes within the 1,500.
 */
export const LONG_CAP_MIN = { phone: 45, computer: 180 } as const;
export const PHONE_LONG_MB_PER_MIN = 34;
/**
 * v16.5 export memory (fix 1): the file leaves the renderer as it is made. Each slice is written into one reused part
 * buffer (no copy per slice left for the garbage collector); a full part becomes a Blob at once (Chrome copies its
 * bytes and hands them to the browser process, which keeps them in its blob store, or on disk past its in-memory
 * limit: 1 % of the RAM on Android); and before the next part is made, a one-byte read of the last one confirms the
 * browser holds it (a read of a Blob waits until its bytes are transported). So the renderer holds the part being
 * written and at most one in transit, whatever the length (D-E4's missing gigabyte fits the output held there while the
 * browser's blob store had not taken it). A part the browser can't take (its blob store full) fails the export as out
 * of memory, never a broken file.
 */
export const OUT_PART_BYTES = 4 * 1024 * 1024;
/** Two of the engine's output parts: the one being written and one in transit to the browser (MB). */
export const OUT_TRANSIT_MB = (2 * OUT_PART_BYTES) / (1024 * 1024);

/** The long file's peak (MB) for this many source seconds in all, given the heaviest track's export peak. */
export function longFilePeakMB(mobile: boolean, heaviestPeakMB: number, sourceSeconds: number): number {
  const minutes = Math.max(0, sourceSeconds || 0) / 60;
  const perMin = mobile ? PHONE_LONG_MB_PER_MIN : LAYERS_MB_PER_MIN / PSF; // a source minute
  return Math.max(0, heaviestPeakMB || 0) + perMin * minutes + OUT_TRANSIT_MB;
}

export function longFileCapSeconds(mobile: boolean, heaviestDecodeMB: number, deviceMemoryGB?: number | null): number {
  const dm = typeof deviceMemoryGB === 'number' && Number.isFinite(deviceMemoryGB) && deviceMemoryGB > 0 ? deviceMemoryGB : null;
  const tier = mobile ? (dm !== null && dm <= 2 ? 5 / 12 : dm !== null && dm <= 4 ? 8 / 12 : 1) : 1;
  // v16.5 export memory: the tier's own budget (decodeBudgetMB) and the long file's own peak (longFilePeakMB).
  const budget = decodeBudgetMB(mobile, deviceMemoryGB);
  // v16.5 final: `heaviestDecodeMB` is the heaviest track's export peak (exportPeakMB: on a phone, the envelope).
  let byMemory = 0;
  while (byMemory < 24 * 60 && longFilePeakMB(mobile, heaviestDecodeMB, (byMemory + 1) * 60) <= budget) byMemory++;
  const byRule = (mobile ? LONG_CAP_MIN.phone : LONG_CAP_MIN.computer) * tier;
  const byRiff = Math.floor((RIFF_MAX_BYTES - HEADER_ALLOWANCE) / (OUT_RATE * BYTES_PER_FRAME) / 60) * PSF;
  return Math.max(0, Math.floor(Math.min(byMemory, byRule, byRiff))) * 60;
}

/** A track's decode peak in MB (its type's cost, or its source's (B2), × its minutes). */
export function decodeMB(kind: FileKind, sourceSeconds: number, src?: SourceCost | null): number {
  return (decodeCostPerMin(kind, src) * Math.max(0, sourceSeconds || 0)) / 60;
}

// ---------------------------------------------------------------------------------------------------------------
// Time and sharing
// ---------------------------------------------------------------------------------------------------------------

/** Seconds per SOURCE minute an export takes (learned per session from the last one; these are the starting values):
 *  the desktop, a phone with nothing playing, a phone while playing. */
export const SECONDS_PER_MIN = { desktop: 1.2, phoneIdle: 6, phonePlaying: 10 } as const;

export function estimateSeconds(sourceSeconds: number, mobile: boolean, playing: boolean, learned?: number | null): number {
  const rate = typeof learned === 'number' && Number.isFinite(learned) && learned > 0 ? learned : mobile ? (playing ? SECONDS_PER_MIN.phonePlaying : SECONDS_PER_MIN.phoneIdle) : SECONDS_PER_MIN.desktop;
  return Math.max(1, Math.round((Math.max(0, sourceSeconds) / 60) * rate));
}

/** Web Share's limits, in Blink's share(): at most 10 files and 50 MiB in total (canShare checks neither). */
export const SHARE_MAX_BYTES = 50 * 1024 * 1024;
export const SHARE_MAX_FILES = 10;
/** v16.5 review (B12): how long the finished files are kept for Share (then the Done screen says where they are). */
export const SHARE_WINDOW_MS = 10 * 60 * 1000;
/** v16.5 re-review (B10/B5): how long Cancel waits for a job to stop before it lets the job go (and frees the app). */
export const CANCEL_WAIT_MS = 10_000;
/** v16.5 export memory: a let-go job still stopping this long after it was let go: the held lines add "or reload Aetheria". */
export const STOPPING_LONG_MS = 60_000;

export function shareable(bytes: ReadonlyArray<number>, count = bytes.length): boolean {
  if (count < 1 || count > SHARE_MAX_FILES) return false;
  let total = 0;
  for (const b of bytes) total += Number.isFinite(b) && b > 0 ? b : 0;
  return total <= SHARE_MAX_BYTES;
}

/** How long an export's file can be and still be shared: about 3 minutes of output at 24-bit 48 kHz. */
export const SHARE_MAX_OUT_SECONDS = Math.floor((SHARE_MAX_BYTES - HEADER_ALLOWANCE) / (OUT_RATE * BYTES_PER_FRAME));

/** The progress weights of a track's steps (§3.3). */
export const PROGRESS_WEIGHTS = { read: 0.02, decode: 0.15, layers: 0.08, mix: 0.75 } as const;
