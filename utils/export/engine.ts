// utils/export/engine.ts (v16.5, Export with layers; the addendum §3.3, §3.7–§3.9; LAZY: App loads it with import())
//
// The job: for each track, hold → length → hold → read → hold → decode → hold → layers → mix → save; for a playlist,
// one file per track (each saved as it is done) or ONE long file (decision 2 B: one track decoded at a time, the layers
// rendered once and continuous across the joins, the music joined gaplessly, one WAV header for the total length).
//   - The music: decodeAudioData on an OfflineAudioContext at DECODE_RATE (48,000 / 0.981818), its samples read as
//     48,000: Chrome's own sinc resampler does the 432 varispeed. Written at its native level: NEVER scaled (the volume
//     slider does not apply; no normaliser, no headroom). Mono up-mixes L = R.
//   - The layers: renderLayers (the app's own LayerPlayer and KeyFitDuck at 12 kHz on a virtual clock), ×4 here.
//   - The mix: 4,096-frame slices, the layer-only peak catch, 24-bit with TPDF dither, Blob parts of 4 MB each handed
//     to the browser as they fill (the renderer never holds the file: exportPlan OUT_PART_BYTES), each slice yielding
//     with scheduler.postTask 'background' (never scheduler.yield(), which starves the app's timers; a MessageChannel
//     round trip where postTask is missing).
//   - The long main-thread moments (the read, the decode's completion, the render's completion) start only when
//     holdFor(playback(), 'native', mobile) is null: Analyse tracks' own rule (not within 20 s of the playing track's end
//     on a phone, 10 s on a desktop, nor in its first 2 s, nor while a track starts or loads).
//   - It never touches the live AudioContext, the music element, the silent anchor, the media session, the swap or
//     the recorder; it writes nothing to the library (it reads the track's Blob).
//   - Cancel: checked between steps and at every slice; an in-flight read, decode or render is dropped when it returns.
//   - A screen wake lock of its own while it runs and the page is visible, if Keep screen awake is on.
// Progress lives in a small store (at most 4 writes a second), never in React state.
//
// v16.5 review:
//   - B1: no file is read or decoded before its length is KNOWN to be within the cap: the header's own length (sniffed
//     from the file's two 64 KB ends: sourceInfo.ts), else the app's length probe (an <audio>'s metadata), never less
//     than the stored length nor than the file's size allows (lengthLowerBound); a length that can't be established is
//     refused ('length'). The step log shows the order: 'length' before 'read' and 'decode'.
//   - B2: the cap is the source's own: a sample rate over 48 kHz and a big lossless file's read buffer cost more
//     (decodeCostPerMin); a refusal names the caps for that kind of file (CapInfo).
//   - B3: the layers' 2 s end fade is applied here, in the mix, ending at the file's REAL last frame (the music's own
//     frames decide it: a long file's planned end was off by a second, every long file ending with the layers at half).
//   - B4: a file's Blob is handed to deps.save and let go; the result keeps none.
//   - B6: a playlist exported as files skips a track it can't read, decode or fit, says which, and goes on.
//   - B7: the long file decodes each track at its own rate and resamples them onto one output grid (resample.ts): the
//     joins are sample-continuous, the fraction carried; the single-track path keeps Chrome's resampler.
//   - B8: the wake lock is taken again when the page shows again (a hidden page loses it).
//
// v16.5 re-review:
//   - B1: an MP3's length from its frames (sourceInfo.scanMp3), before its decode: Chrome's own length for a VBR file
//     without a Xing header (or with a stale one) can be a quarter of it, and the decode would pass the cap many times
//     over (a 25-minute file: about 2.1 GB on a phone against 900 MB). A track is scanned from the bytes read for its
//     decode; a long file's tracks from the file in 8 MB slices while it is planned (their lengths plan the layers).
//     The decode's own length is checked after it on both paths (a FLAC whose STREAMINFO understates its length).
//   - B7: the header is read where it is (sourceInfo.sniffFile: past cover art, a WAV's chunks, an MP4's boxes), so each
//     track decodes at its own rate; between tracks of different rates the next track is placed half a sample apart by
//     each rate (resample.joinShift: the two kernels' partial sums meet at the same edge).
//   - Multichannel: a file with more than two channels is refused ('channels'), before it is read when the header
//     says so, else after its decode (the export makes stereo files; a 5.1 file's centre was dropped).
//   - B2: the cost by what the bytes say (exportPlan.fileKindOf), not the name.
//   - B6: a file that can't be read (NotReadableError, NotFoundError) is 'unreadable': a playlist skips it.
//   - B10/B5: abandon() lets a job go that doesn't answer Cancel (App calls it after its wait): the result ignored,
//     the wake lock released, its listeners dropped.
//
// v16.5 final fixes (a phone never decodes a file far past its memory cap: a renderer killed for memory stops the
// music too):
//   - B1: the frame walk for each kind that has one (sourceInfo.scanPlanFor: MP3, ADTS AAC, Ogg pages, a WAV's MP3
//     payload) on the bytes held for the decode and in the long file's plan; ADTS was measured by Chrome's estimate alone.
//   - On a phone, no decode without a length the export established: the header's, or a walk it trusts. A file neither
//     gives (Layer I/II or free-format MP3, a WebM without a Duration, a fragmented MP4, a FLAC without its sample count,
//     a WAV of another codec) is refused, 'untrusted': before it is read when no walk applies, after the read and before
//     the decode when the walk didn't find its length. A computer keeps the estimates (its 2 GB budget).
//   - The long file's plan checks the size bound before it walks a file (a 300 MB MP3 isn't read through to be
//     refused), and a read that fails at a track's decode names the track.
//
// v16.5 export memory (a phone never decodes or builds an export far past its memory budget):
//   - The output leaves the renderer as it is made: 4 MB parts, each a Blob at once, the browser's receipt of each awaited
//     before the next (exportPlan OUT_PART_BYTES); the Note 20's 45-minute long file peaked at 1,865 MB in its renderer.
//   - The caps are exportPlan's: a phone's peak the larger of the step and the Note 20's line; the long file's the
//     heaviest track's + its growth a minute + the parts in transit (longFilePeakMB).

import { renderLayers } from './renderLayers';
import type { LayerSegment, LayerPlanRecord } from './renderLayers';
import { CEILING, SLICE_FRAMES, catchConfig, designInterp, encodePcm24, interpRange, makeRng, mixSlice, newCatchState, wavHeader } from './mixWav';
import type { WavInfo } from './mixWav';
import {
  BYTES_PER_FRAME, DECODE_RATE, END_FADE_S, LAYER_FACTOR, LAYER_RATE, OUT_PART_BYTES, OUT_RATE, PROGRESS_WEIGHTS, PSF, RIFF_MAX_BYTES,
  bandSchedule, capInfoFor, decodeCostPerMin, exportCapSeconds, exportPeakMB, fileKind, fileKindOf, longFileCapSeconds,
} from './exportPlan';
import type { CapInfo, ExportSpec, FileKind, SourceCost } from './exportPlan';
import type { Phase, SkipWhy } from './exportWords';
import { lengthLowerBound, newStreamScan, scanPlanFor, scanStream, scanTrusted, sniffFile } from './sourceInfo';
import type { Mp3Scan, ScanPlan, SourceInfo } from './sourceInfo';
import { addTrack, designKernel, joinShift, trackSpan, trimTrack } from './resample';
import type { GridTrack, Kernel } from './resample';
import { holdFor } from '../library/analysePass';
import type { PlaybackSnapshot } from '../library/analysePass';
import type { EnvelopeLike } from '../soundV2/layerHost';
import type { Band } from '../soundV2/aetheria_sound_v2';

export const READ_SLICE_BYTES = 8 * 1024 * 1024;
// v16.5 export memory (fix 1): the output leaves the renderer in parts of OUT_PART_BYTES (exportPlan: its note).
export const HOLD_POLL_MS = 250;
export const PROGRESS_MIN_MS = 250;
/** B3: the long file's layers are rendered this much past the planned end (2 s and 1 %), so a track a little longer
 *  than planned still has them; past what they cover, the end fade comes where they end. */
export const LONG_LAYERS_MARGIN_S = 2;
export const LONG_LAYERS_MARGIN_FRACTION = 0.01;
/** B7: the long file's decode rate when the header doesn't say (Chrome resamples to it, as it must). */
export const FALLBACK_NATIVE_RATE = 48_000;

export type FailReason = 'decode' | 'memory' | 'cap' | 'missing' | 'riff' | 'length' | 'channels' | 'unreadable' | 'untrusted' | 'other';
/** v16.5 re-review: the most channels a file may have (the export writes stereo; mono up-mixes L = R). */
export const MAX_CHANNELS = 2;

export interface EngineItem {
  id: string;
  title: string;
  /** The stored length (seconds of source), or null: a floor for the established length (B1), never the whole truth. */
  duration: number | null;
  file: Blob | null;
  fileName: string;
  spec: ExportSpec;
  envelope: EnvelopeLike | null;
  /** The file's name in Downloads. */
  name: string;
}

export interface EngineDeps {
  playback: () => PlaybackSnapshot | null;
  mobile: boolean;
  deviceMemory: number | null;
  keepAwake: () => boolean;
  /** Hand the finished file over (the anchor click; the dev hook keeps it instead). The engine keeps no reference. */
  save: (blob: Blob, name: string) => void;
  /** The app's version for the file's INFO ("Aetheria v16.5"). */
  software: string;
  /** B1: the app's length probe (getAudioDuration: an <audio>'s metadata), seconds, or 0 when it can't tell. */
  probeDuration?: (file: Blob) => Promise<number>;
  /** Caps override (the dev hook's setCaps: seconds), or null. */
  capSeconds?: number | null;
  /** Dev tuning: a delay per slice (Cancel tests), a pretend size (Share tests). */
  sliceDelayMs?: number;
  /** TPDF dither at 24-bit (on: see the report's measurement). */
  dither?: boolean;
  /** The layers' render rate (tests: a full-rate render to compare). */
  layerRate?: number;
}

export interface FileResult {
  id: string | null;
  name: string;
  bytes: number;
  frames: number;
  outSeconds: number;
  clipped: number;
  catchFraction: number;
  catchMeanDb: number;
  loud: boolean;
  /** Always null in the result (B4): the file went to deps.save and nothing here holds it. */
  blob: null;
  plan: LayerPlanRecord | null;
  /** A long file's joins (output frames, rounded), the music's own frames. */
  joins?: number[];
}

export interface StepLog {
  step: 'length' | 'read' | 'decode' | 'layers';
  at: number;
  /** The playing track's wall seconds left when the step started (null: nothing playing). */
  leftS: number | null;
  id: string;
}

export interface JobProgress {
  phase: Phase;
  fraction: number;
  etaS: number | null;
  file: { index: number; count: number; title: string };
}

export interface Skipped {
  id: string;
  title: string;
  why: SkipWhy;
  cap?: CapInfo;
}

export interface JobResult {
  outcome: 'done' | 'cancelled' | 'failed';
  reason?: FailReason;
  error?: string;
  /** A refusal over the cap: the length and the caps for that source (B2). */
  cap?: CapInfo;
  /** The track the failure is about (a long file's undecodable track). */
  failedTitle?: string;
  files: FileResult[];
  skipped: Skipped[];
  ms: { hold: number; length: number; read: number; decode: number; layers: number; mix: number; total: number };
  steps: StepLog[];
  /** What the engine established for each track it got that far with (the tests and the dev hook read it); an MP3's
   *  frame scan (B1) and the decode's own channels once known. */
  sources: Array<{ id: string; seconds: number; capSeconds: number; costPerMin: number; info: SourceInfo; scan?: Mp3Scan | null; scanMs?: number; decodedChannels?: number }>;
}

export interface Job {
  /** `listening`: how many listeners are subscribed (v16.5 final: the tests check abandon() drops them). */
  store: { subscribe: (fn: () => void) => () => void; get: () => JobProgress; listening: () => number };
  promise: Promise<JobResult>;
  cancel: () => void;
  /** v16.5 re-review (B10/B5): give up on a job that didn't answer Cancel: nothing more of it is saved or shown. */
  abandon: () => void;
}

class Cancelled extends Error {}
class Failed extends Error {
  constructor(public reason: FailReason, message: string, public cap?: CapInfo, public title?: string) {
    super(message);
  }
}

/** Yield to the app: postTask 'background' (the app's timers run first), else a MessageChannel round trip. */
export function yieldBackground(): Promise<void> {
  const s = (globalThis as unknown as { scheduler?: { postTask?: (f: () => void, o: { priority: string }) => Promise<void> } }).scheduler;
  if (s && typeof s.postTask === 'function') return s.postTask(() => {}, { priority: 'background' });
  return new Promise((resolve) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => resolve();
    c.port2.postMessage(0);
  });
}

/**
 * v16.5 final (the Note 20, 2026-10-30): a decode or a layer render the export has finished with is let go at once,
 * not left to a collection. Chrome on Android frees an AudioBuffer's memory only when a collection runs, and under an
 * export's back-to-back slices none ran: a long file's renderers held every decode it had finished with (8 × the
 * 3-minute MP3: 2,039 in the device tests' meminfo figure at the peak against 858 with a collection forced from
 * DevTools every 3 s, and 1,465 still held after the export ended against 41). Neither ArrayBuffer transfer(0) within
 * the page nor ArrayBuffers made to prompt V8 freed a dropped render while the page stayed busy; moving its channels to
 * a worker (the transfer takes them out of the AudioBuffer) and ending the worker freed them at once (a dropped
 * 24-minute layer render, the PSS over the start: 144 MB held, 14 after). The worker is ended once it has them (its
 * reply): ended before, the decodes it was sent stayed held (4 decodes of the 3-minute MP3: 71 MB, against 13 after the
 * reply). So every buffer the export is done with goes that way. Where a channel can't be transferred (another
 * browser), no worker starts or none replies within LET_GO_WAIT_MS, the collection frees it, as before. The arrays
 * given must not be read again (they are empty once transferred).
 *
 * Chromium only (LET_GO_HERE): the problem is Chrome's, and elsewhere the hand-off could cost rather than free (an engine
 * that makes an AudioBuffer's channel arrays on the first getChannelData, or copies a buffer it can't detach). The brands
 * come from navigator.userAgentData: a secure page only (the app is HTTPS; a dev server on a LAN address over HTTP goes
 * without), and a test that overrides the user agent (Playwright's Android UA) reports none, so only a real Chromium
 * exercises the hand-off (device.spec D-E1 / D-E4 on the Note 20).
 */
export const LET_GO_WAIT_MS = 3000;
const LET_GO_HERE = ((): boolean => {
  try {
    const brands = (navigator as unknown as { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands;
    return Array.isArray(brands) && brands.some((b) => /Chromium/.test(b.brand));
  } catch {
    return false;
  }
})();
let sinkUrl: string | null = null;
export async function letGo(arrays: ReadonlyArray<Float32Array | null | undefined>): Promise<void> {
  const bufs: ArrayBuffer[] = [];
  for (const a of arrays) {
    const b = a?.buffer as ArrayBuffer | undefined;
    if (b && b.byteLength > 0 && !bufs.includes(b)) bufs.push(b);
  }
  if (!LET_GO_HERE || !bufs.length || typeof Worker === 'undefined') return;
  let w: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    sinkUrl ??= URL.createObjectURL(new Blob(['onmessage = () => postMessage(0);'], { type: 'text/javascript' }));
    const sink = new Worker(sinkUrl);
    w = sink;
    const received = new Promise<void>((resolve) => {
      sink.onmessage = () => resolve();
      sink.onerror = () => resolve();
      timer = setTimeout(resolve, LET_GO_WAIT_MS);
    });
    sink.postMessage(bufs, bufs);
    await received;
  } catch {
    // Not transferable here, or no worker: the collection frees them, as before.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    w?.terminate();
  }
}
/** An AudioBuffer's channel arrays (for letGo; none where letGo doesn't run, so none is made just for it). */
export function channelsOf(b: AudioBuffer | null | undefined): Float32Array[] {
  const out: Float32Array[] = [];
  if (b && LET_GO_HERE) for (let c = 0; c < b.numberOfChannels; c++) out.push(b.getChannelData(c));
  return out;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function classify(e: unknown): Failed {
  if (e instanceof Failed) return e;
  const name = (e as { name?: string })?.name ?? '';
  const msg = String((e as { message?: string })?.message ?? e);
  if (name === 'EncodingError' || /decode|encoding|unable to decode/i.test(msg)) return new Failed('decode', msg);
  // v16.5 re-review (B6): a stored file that can't be read (its bytes gone or changed under the Blob).
  if (name === 'NotReadableError' || name === 'NotFoundError') return new Failed('unreadable', msg);
  if (e instanceof RangeError || /memory|allocation|out of/i.test(msg)) return new Failed('memory', msg);
  return new Failed('other', msg);
}

function comment(spec: ExportSpec): string {
  if (!spec.layers) return 'Music only; retuned to 432 Hz';
  const band = spec.startBand.charAt(0).toUpperCase() + spec.startBand.slice(1);
  const beat = spec.render === 'binaural' ? `binaural beat ${band}` : spec.render === 'pulse' ? `pulse ${band}` : 'no beat';
  const parts = [`${spec.crystalHz} Hz crystal`, `${beat}${spec.adaptive ? ', adaptive' : ''}`];
  if (spec.render === 'binaural' && spec.gains.drone > 0) parts.push('drone');
  if (spec.duckDb < -0.05) parts.push(`Key fit ${spec.duckDb.toFixed(1)} dB`);
  parts.push('retuned to 432 Hz', spec.madeFor === 'tone' ? 'made for tone only' : `made for ${spec.madeFor}`);
  return parts.join('; ');
}

/** The words a failure's reason maps to when a playlist skips its track (none: the failure stops the export). */
const SKIP_FOR: Partial<Record<FailReason, SkipWhy>> = { missing: 'missing', decode: 'decode', cap: 'too-long', length: 'length', channels: 'channels', unreadable: 'unreadable', untrusted: 'untrusted' };
const REASON_FOR: Record<SkipWhy, FailReason> = { missing: 'missing', decode: 'decode', 'too-long': 'cap', length: 'length', channels: 'channels', unreadable: 'unreadable', untrusted: 'untrusted' };

/** B7: an OfflineAudioContext rate Chrome accepts for a native decode (3 kHz – 768 kHz), else the fallback. */
function nativeRate(info: SourceInfo): number {
  const r = info.sampleRate;
  return typeof r === 'number' && Number.isFinite(r) && r >= 3000 && r <= 768_000 ? r : FALLBACK_NATIVE_RATE;
}

/** Run one export. `items` is one track ('track'), each a file ('playlist'), or one long file ('long'). */
export function createJob(kind: 'track' | 'playlist' | 'long', items: EngineItem[], title: string, longName: string, deps: EngineDeps): Job {
  let cancelled = false;
  let abandoned = false;
  let progress: JobProgress = { phase: 'hold', fraction: 0, etaS: null, file: { index: 1, count: Math.max(1, kind === 'long' ? 1 : items.length), title: items[0]?.title ?? title } };
  const listeners = new Set<() => void>();
  let lastEmit = 0;
  const emit = (p: Partial<JobProgress>, force = false) => {
    progress = { ...progress, ...p, file: { ...progress.file, ...(p.file ?? {}) } };
    const now = performance.now();
    if (abandoned || (!force && now - lastEmit < PROGRESS_MIN_MS)) return;
    lastEmit = now;
    for (const fn of Array.from(listeners)) fn();
  };
  const store = {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    get: () => progress,
    listening: () => listeners.size,
  };
  const ms = { hold: 0, length: 0, read: 0, decode: 0, layers: 0, mix: 0, total: 0 };
  const steps: StepLog[] = [];
  const files: FileResult[] = [];
  const skipped: Skipped[] = [];
  const sources: JobResult['sources'] = [];
  const t0 = performance.now();
  const check = () => {
    if (cancelled) throw new Cancelled('cancelled');
  };

  // ---- The wake lock (its own sentinel; wakeLockManager and the pinned keep-alive effect are not touched). B8: a hidden
  // page loses it (the sentinel is released): taken again when the page shows again, while the job runs.
  type Sentinel = { release: () => Promise<void>; released?: boolean; addEventListener?: (t: string, f: () => void) => void };
  let lock: Sentinel | null = null;
  let asking = false;
  let finished = false;
  const wantLock = async () => {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<Sentinel> } }).wakeLock;
    if (!wl || finished || asking || document.visibilityState !== 'visible' || !deps.keepAwake()) return;
    if (lock && lock.released !== true) return;
    asking = true;
    try {
      const s = await wl.request('screen');
      if (finished) {
        s.release().catch(() => {});
        return;
      }
      lock = s;
      s.addEventListener?.('release', () => {
        if (lock === s) lock = null;
      });
    } catch {
      lock = null;
    } finally {
      asking = false;
    }
  };
  const onVis = () => {
    if (document.visibilityState === 'visible') void wantLock();
  };
  const releaseLock = () => {
    finished = true;
    document.removeEventListener('visibilitychange', onVis);
    const l = lock;
    lock = null;
    if (l && l.released !== true) l.release().catch(() => {});
  };

  // ---- The playing track's hold (Analyse tracks' rule).
  const leftNow = (): number | null => {
    const pb = deps.playback();
    if (!pb || pb.paused || !Number.isFinite(pb.duration) || pb.duration <= 0) return null;
    const rate = pb.playbackRate > 0 ? pb.playbackRate : 1;
    return (pb.duration - pb.currentTime) / rate;
  };
  const hold = async (id: string, step: StepLog['step'], fraction: number) => {
    const h0 = performance.now();
    let held = false;
    for (;;) {
      check();
      if (holdFor(deps.playback(), 'native', deps.mobile) === null) break;
      if (!held) {
        held = true;
        emit({ phase: 'hold', fraction }, true);
      }
      await wait(HOLD_POLL_MS);
    }
    ms.hold += performance.now() - h0;
    steps.push({ step, at: performance.now() - t0, leftS: leftNow(), id });
  };

  // ---- B1/B2: the length and the source, before anything is read or decoded.
  /** B2 (re-review): the kind from what the bytes say once they are read; the name and type before. */
  const kindOf = (it: EngineItem, info?: SourceInfo | null): FileKind => fileKindOf({ name: it.fileName, type: it.file?.type }, info ?? null);
  interface Established {
    seconds: number;
    info: SourceInfo;
    costPerMin: number;
    cap: number;
    kind: FileKind;
    /** v16.5 final: the length is the export's own (the header's, or a walk it trusts), not Chrome's estimate. */
    trusted: boolean;
    /** The source as the cost model reads it (its rate, lossless, bytes a second). */
    src: SourceCost;
  }
  const blobRead = (f: Blob) => async (at: number, n: number) => new Uint8Array(await f.slice(at, at + n).arrayBuffer());
  /** B1 (re-review): a file's frames (or pages) walked from it in 8 MB slices (a long file's plan: nothing held); v16.5
   *  final: by its kind's walk, over the bytes it walks (a WAV's MP3 payload). */
  const scanBlob = async (f: Blob, plan: ScanPlan): Promise<Mp3Scan | null> => {
    const last = plan.bytes !== null ? Math.min(f.size, plan.at + plan.bytes) : f.size;
    // v16.5 export memory (fix 5): the walked bytes in all (a leading tag's size past them is bogus).
    const s = newStreamScan(plan.kind, Math.max(0, last - plan.at));
    for (let guard = 0; guard < 100_000 && !s.done(); guard++) {
      const from = s.pos();
      if (plan.at + from >= last) break;
      const end = Math.min(last, plan.at + from + READ_SLICE_BYTES + s.lookahead);
      const b = new Uint8Array(await f.slice(plan.at + from, end).arrayBuffer());
      check();
      s.step(b, end >= last);
      if (s.pos() <= from && !s.done()) break; // no progress: stop (the length stays the other estimates')
      if (!s.done()) await yieldBackground();
    }
    return s.result();
  };
  const refuseChannels = (n: number | null | undefined, title?: string) => {
    if (typeof n === 'number' && n > MAX_CHANNELS) throw new Failed('channels', String(n) + ' channels', undefined, title);
  };
  /** The cost and the cap for this source at this length (B2: a lossless file's read buffer by its bytes a second). */
  const costAt = (it: EngineItem, info: SourceInfo, seconds: number) => {
    const src: SourceCost = { sampleRate: info.sampleRate, lossless: info.lossless, bytesPerSecond: (it.file?.size ?? 0) / Math.max(1e-9, seconds) };
    const kind = kindOf(it, info);
    return { src, kind, costPerMin: decodeCostPerMin(kind, src), cap: deps.capSeconds ?? exportCapSeconds(kind, deps.mobile, deps.deviceMemory, src) };
  };
  const establish = async (it: EngineItem, o: { scan?: boolean } = {}): Promise<Established> => {
    const f = it.file as Blob;
    const l0 = performance.now();
    // The first and second chunks (an MP4's moov wherever its boxes put it), and on past cover art, a WAV's chunks or
    // an MP4's boxes when the header isn't in them (B7).
    const { info } = await sniffFile(blobRead(f), f.size, it.fileName, f.type);
    check();
    // Multichannel: refused before anything is read when the header says so.
    refuseChannels(info.channels);
    // v16.5 final: the walk that measures this file (MP3, ADTS, Ogg, a WAV's MP3 payload), or none.
    const plan = scanPlanFor(info);
    // The shortest the file can be by its size; on a phone, bytes that don't say what they are count as an MP3 (if they
    // are one its frames are walked; if they aren't, nothing measures them and they aren't decoded there).
    const bound = lengthLowerBound(deps.mobile && info.container === 'unknown' ? { ...info, codec: 'mp3' } : info, f.size);
    const refuse = (reason: 'cap' | 'untrusted', seconds: number) => {
      ms.length += performance.now() - l0;
      const c = costAt(it, info, Math.max(1, seconds));
      sources.push({ id: it.id, seconds, capSeconds: c.cap, costPerMin: c.costPerMin, info });
      return reason === 'cap' ? new Failed('cap', String(seconds), capInfoFor(seconds, c.kind, deps.deviceMemory, c.src)) : new Failed('untrusted', 'no length to check');
    };
    // v16.5 final: on a phone, a file whose length neither its header states nor a walk can measure isn't decoded (only
    // Chrome's estimate would say it, and a wrong one decodes past the memory): refused before anything is read.
    const unmeasured = deps.mobile && info.seconds === null && !plan;
    // v16.5 final: before a walk reads the file through (a long file's plan), or that refusal, the size bound: a file its
    // size alone puts over the cap is refused first (a 300 MB MP3 with no stored length was read whole to be refused).
    if (((o.scan && plan) || unmeasured) && bound > costAt(it, info, bound).cap + 1) throw refuse('cap', bound);
    if (unmeasured) throw refuse('untrusted', 0);
    // B1 (re-review): a long file's files are walked now (the plan needs their lengths); a track's from its read bytes.
    let scan: Mp3Scan | null = null;
    let scanMs = 0;
    if (o.scan && plan) {
      const s0 = performance.now();
      scan = await scanBlob(f, plan);
      scanMs = performance.now() - s0;
      check();
    }
    const walked = scanTrusted(scan, plan?.bytes ?? f.size);
    // v16.5 final: on a phone, a long file's track whose walk didn't measure it is skipped before anything more is read.
    if (o.scan && deps.mobile && info.seconds === null && !walked) {
      const e = refuse('untrusted', scan?.seconds ?? 0);
      Object.assign(sources[sources.length - 1], { scan, scanMs });
      throw e;
    }
    // The header's own length is exact (PCM, FLAC, MP4); else the app's probe (the stored length may be 0 or wrong).
    let probed = 0;
    if (info.seconds === null && deps.probeDuration) {
      try {
        const p = await deps.probeDuration(f);
        probed = Number.isFinite(p) && p > 0 ? p : 0;
      } catch {
        probed = 0;
      }
      check();
    }
    const stored = it.duration !== null && Number.isFinite(it.duration) && it.duration > 0 ? it.duration : 0;
    // A file whose frames (or pages) were walked: their length is the file's (the stored length and the probe are
    // Chrome's guess, the Xing count may be stale); a scan with much junk only adds to the other estimates.
    const trusted = walked;
    const known = trusted ? scan!.seconds : Math.max(stored, info.seconds ?? 0, probed, scan?.seconds ?? 0);
    ms.length += performance.now() - l0;
    if (!(known > 0)) throw new Failed('length', 'the length is not known');
    const seconds = Math.max(known, bound);
    const src: SourceCost = { sampleRate: info.sampleRate, lossless: info.lossless, bytesPerSecond: f.size / seconds };
    const kind = kindOf(it, info);
    const costPerMin = decodeCostPerMin(kind, src);
    const cap = deps.capSeconds ?? exportCapSeconds(kind, deps.mobile, deps.deviceMemory, src);
    sources.push({ id: it.id, seconds, capSeconds: cap, costPerMin, info, ...(o.scan ? { scan, scanMs } : {}) });
    if (seconds > cap + 1) throw new Failed('cap', String(seconds), capInfoFor(seconds, kind, deps.deviceMemory, src));
    return { seconds, info, costPerMin, cap, kind, trusted: info.seconds !== null || trusted, src };
  };

  /** B1 (re-review): the frames of a file held for its decode (milliseconds), refused over the cap before the decode;
   *  v16.5 final: by its kind's walk (MP3, ADTS, Ogg, a WAV's MP3 payload), and on a phone refused, 'untrusted', when
   *  neither its header nor the walk gives the export a length of its own. */
  const scanHeld = (it: EngineItem, est: Established, bytes: ArrayBuffer, title?: string): void => {
    const plan = scanPlanFor(est.info);
    if (!plan) return;
    const s0 = performance.now();
    const held = new Uint8Array(bytes);
    const last = plan.bytes !== null ? Math.min(held.length, plan.at + plan.bytes) : held.length;
    const scan = scanStream(plan.kind, held.subarray(Math.min(plan.at, last), last));
    const scanMs = performance.now() - s0;
    const src = sources.find((s) => s.id === it.id);
    if (src) Object.assign(src, { scan, scanMs });
    if (scan && scan.seconds > est.cap + 1) {
      throw new Failed('cap', String(scan.seconds), capInfoFor(scan.seconds, est.kind, deps.deviceMemory, { sampleRate: est.info.sampleRate, lossless: est.info.lossless, bytesPerSecond: (it.file?.size ?? 0) / Math.max(1, scan.seconds) }), title);
    }
    if (deps.mobile && !est.trusted && !scanTrusted(scan, last - Math.min(plan.at, last))) throw new Failed('untrusted', 'the frames do not say', undefined, title);
  };

  /** The decode's own length and channels, against the cap and the stereo rule (B09b; a header that understated). */
  const checkDecoded = (it: EngineItem, est: Established, buf: AudioBuffer, title?: string): void => {
    const src = sources.find((s) => s.id === it.id);
    if (src) src.decodedChannels = buf.numberOfChannels;
    refuseChannels(buf.numberOfChannels, title);
    const srcS = buf.length / buf.sampleRate;
    if (srcS > est.cap + 1) {
      throw new Failed('cap', String(srcS), capInfoFor(srcS, est.kind, deps.deviceMemory, { sampleRate: est.info.sampleRate, lossless: est.info.lossless, bytesPerSecond: (it.file?.size ?? 0) / Math.max(1, srcS) }), title);
    }
  };

  // ---- Read: the Blob in 8 MB slices.
  const read = async (it: EngineItem, base: number, span: number): Promise<ArrayBuffer> => {
    if (!it.file) throw new Failed('missing', 'audio missing');
    const r0 = performance.now();
    emit({ phase: 'read', fraction: base }, true);
    const size = it.file.size;
    const out = new Uint8Array(size);
    for (let a = 0; a < size; a += READ_SLICE_BYTES) {
      check();
      const b = Math.min(size, a + READ_SLICE_BYTES);
      out.set(new Uint8Array(await it.file.slice(a, b).arrayBuffer()), a);
      emit({ fraction: base + span * PROGRESS_WEIGHTS.read * (b / Math.max(1, size)) });
      if (b < size) await yieldBackground();
    }
    ms.read += performance.now() - r0;
    return out.buffer;
  };

  // ---- Decode at `rate` (DECODE_RATE: the samples read as OUT_RATE are the varispeed; a native rate: no resampling).
  const decode = async (bytes: ArrayBuffer, base: number, span: number, rate = DECODE_RATE): Promise<AudioBuffer> => {
    const d0 = performance.now();
    emit({ phase: 'decode', fraction: base + span * PROGRESS_WEIGHTS.read }, true);
    const ctx = new OfflineAudioContext(2, 1, rate);
    const buf = await ctx.decodeAudioData(bytes);
    try {
      check();
    } catch (e) {
      await letGo(channelsOf(buf)); // v16.5 final (review): a cancel here lets the finished decode go too
      throw e;
    }
    ms.decode += performance.now() - d0;
    return buf;
  };

  // ---- The mix: music (a reader of global frames), layers (a low-rate buffer), into Blob parts.
  const phases = designInterp();
  interface MusicReader {
    frames: () => number;
    /** Every frame is known (the last track decoded): frames() is the file's length. */
    final: () => boolean;
    ensure: (o1: number) => Promise<void>;
    read: (o0: number, n: number, L: Float32Array, R: Float32Array) => void;
  }
  const FADE_FRAMES = Math.round(END_FADE_S * OUT_RATE);
  const mixInto = async (
    music: MusicReader, layers: AudioBuffer | null, base: number, span: number, weightBefore: number, expectedFrames?: number,
  ): Promise<{ parts: Blob[]; frames: number; clipped: number; catchFraction: number; catchMeanDb: number }> => {
    const m0 = performance.now();
    emit({ phase: 'mix', fraction: base + span * weightBefore }, true);
    const cfg = catchConfig(OUT_RATE, !!layers);
    const st = newCatchState();
    const S = SLICE_FRAMES;
    const E = S + cfg.attack;
    const mL = new Float32Array(E), mR = new Float32Array(E), lL = new Float32Array(E), lR = new Float32Array(E), g = new Float32Array(E);
    const oL = new Float32Array(S), oR = new Float32Array(S);
    const enc = new Uint8Array(S * BYTES_PER_FRAME);
    const rng = deps.dither === false ? null : makeRng((Date.now() ^ 0x9e3779b9) >>> 0);
    const clip = { n: 0 };
    const lowL = layers ? layers.getChannelData(0) : null;
    const lowR = layers ? (layers.numberOfChannels > 1 ? layers.getChannelData(1) : layers.getChannelData(0)) : null;
    const L = deps.layerRate && deps.layerRate !== LAYER_RATE ? Math.round(OUT_RATE / deps.layerRate) : LAYER_FACTOR;
    // B3: the layers' last output frame (interpRange reads zeros past it).
    const layersEnd = layers ? layers.length * L : 0;
    // Fix 1 (export memory): the output in parts of OUT_PART_BYTES, each a Blob as soon as it is full, the browser's
    // receipt of the last one awaited before the next (OUT_PART_BYTES' note).
    const parts: Blob[] = [];
    const part = new Uint8Array(OUT_PART_BYTES);
    let fill = 0;
    let inTransit: Promise<unknown> | null = null;
    const flush = async () => {
      if (inTransit) {
        const e = await inTransit;
        inTransit = null;
        if (e) throw e;
      }
      if (!fill) return;
      const b = new Blob([part.subarray(0, fill)]);
      fill = 0;
      parts.push(b);
      // Its last byte read back (it resolves once the browser holds the part); a failure is kept, not thrown here (an
      // export cancelled meanwhile never awaits it), and stops the export at the next part as out of memory.
      inTransit = b.slice(b.size - 1).arrayBuffer().then(
        () => null,
        (e: unknown) => new Failed('memory', `a part of the file wasn't taken: ${String((e as { name?: string })?.name ?? e)}`),
      );
    };
    let written = 0;
    const tStart = performance.now();
    const window3: Array<{ t: number; f: number }> = [];
    for (let o0 = 0; ; o0 += S) {
      // B3: far enough ahead that the file's end is known before the end fade starts (a short last track included).
      await music.ensure(o0 + E + FADE_FRAMES);
      const N = music.frames();
      if (o0 >= N) break;
      check();
      const n = Math.min(S, N - o0);
      const ne = Math.min(E, N - o0);
      music.read(o0, ne, mL, mR);
      if (lowL && lowR) {
        if (L === 1) {
          for (let i = 0; i < ne; i++) {
            lL[i] = lowL[o0 + i] ?? 0;
            lR[i] = lowR[o0 + i] ?? 0;
          }
        } else {
          interpRange(lowL, phases, L, o0, ne, lL);
          interpRange(lowR, phases, L, o0, ne, lR);
        }
        // B3: the end fade, on the layers only, ending at the file's real last frame (or where the layers end, if
        // that is sooner): a linear ramp to 0 over END_FADE_S, as the live player's host glide. While the end isn't
        // known yet it is past this slice and its lookahead (ensure above), so nothing here is faded too soon.
        const fadeEnd = music.final() ? Math.min(N, layersEnd) : layersEnd;
        const fadeFrom = fadeEnd - FADE_FRAMES;
        if (o0 + ne > fadeFrom) {
          for (let i = Math.max(0, fadeFrom - o0); i < ne; i++) {
            const m = o0 + i;
            const k = m >= fadeEnd ? 0 : (fadeEnd - m) / FADE_FRAMES;
            lL[i] *= k;
            lR[i] *= k;
          }
        }
      } else {
        lL.fill(0, 0, ne);
        lR.fill(0, 0, ne);
      }
      mixSlice(mL, mR, lL, lR, n, ne, cfg, st, g, oL, oR);
      const bytes = encodePcm24(oL, oR, n, rng, clip, enc);
      for (let k = 0; k < bytes.length; ) {
        const take = Math.min(bytes.length - k, OUT_PART_BYTES - fill);
        part.set(bytes.subarray(k, k + take), fill);
        fill += take;
        k += take;
        if (fill === OUT_PART_BYTES) await flush();
      }
      written += n;
      // Progress and time left: measured over the last 3 s.
      const now = performance.now();
      window3.push({ t: now, f: written });
      while (window3.length > 2 && now - window3[0].t > 3000) window3.shift();
      const Nx = expectedFrames && expectedFrames > 0 ? Math.max(expectedFrames, written) : N;
      const frac = written / Math.max(1, Nx);
      const w = window3[0];
      const rate = now - w.t > 500 ? (written - w.f) / ((now - w.t) / 1000) : (written / Math.max(1, (now - tStart) / 1000));
      emit({ fraction: base + span * (weightBefore + (1 - weightBefore) * frac), etaS: rate > 0 ? (Nx - written) / rate : null });
      if (deps.sliceDelayMs) await wait(deps.sliceDelayMs);
      else await yieldBackground();
    }
    await flush();
    await flush(); // the last part's receipt
    ms.mix += performance.now() - m0;
    return { parts, frames: written, clipped: clip.n, catchFraction: st.frames ? st.reduced / st.frames : 0, catchMeanDb: st.reduced ? st.reducedDbSum / st.reduced : 0 };
  };

  /** A single decoded buffer as a reader (mono up-mixes L = R). */
  const bufferReader = (buf: AudioBuffer): MusicReader => {
    const a = buf.getChannelData(0);
    const b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
    return {
      frames: () => buf.length,
      final: () => true,
      ensure: async () => {},
      read: (o0, n, L, R) => {
        const k = Math.max(0, Math.min(n, buf.length - o0));
        L.set(a.subarray(o0, o0 + k));
        R.set(b.subarray(o0, o0 + k));
        if (k < n) {
          L.fill(0, k, n);
          R.fill(0, k, n);
        }
      },
    };
  };

  /** B4: write the file, hand it to deps.save, keep no reference to it. */
  const finishFile = (it: { id: string | null; name: string }, mixed: Awaited<ReturnType<typeof mixInto>>, info: WavInfo, plan: LayerPlanRecord | null, layersOn: boolean): FileResult => {
    const header = wavHeader(mixed.frames, info);
    let blob: Blob | null = new Blob([header, ...mixed.parts], { type: 'audio/wav' });
    mixed.parts.length = 0;
    const bytes = blob.size;
    deps.save(blob, it.name);
    blob = null;
    const loud = layersOn && mixed.catchFraction > 0.25 && mixed.catchMeanDb > 1;
    return { id: it.id, name: it.name, bytes, frames: mixed.frames, outSeconds: mixed.frames / OUT_RATE, clipped: mixed.clipped, catchFraction: mixed.catchFraction, catchMeanDb: mixed.catchMeanDb, loud, blob: null, plan };
  };

  const infoFor = (titleText: string, spec: ExportSpec | null): WavInfo => ({
    title: titleText,
    software: deps.software,
    comment: spec ? comment(spec) : 'Retuned to 432 Hz',
    date: new Date().toISOString().slice(0, 10),
  });

  /** The type's cap before anything is read (the stored length alone, as the sheet checks it: by its name and type). */
  const quickCap = (it: EngineItem): number => deps.capSeconds ?? exportCapSeconds(fileKind({ name: it.fileName, type: it.file?.type }), deps.mobile, deps.deviceMemory);

  // ---- One track, one file.
  const oneTrack = async (it: EngineItem, index: number, count: number): Promise<void> => {
    const base = (index - 1) / count;
    const span = 1 / count;
    emit({ phase: 'hold', fraction: base, etaS: null, file: { index, count, title: it.title } }, true);
    if (!it.file) throw new Failed('missing', 'audio missing');
    if (it.duration !== null && it.duration > quickCap(it)) {
      throw new Failed('cap', String(it.duration), capInfoFor(it.duration, kindOf(it), deps.deviceMemory));
    }
    await hold(it.id, 'length', base);
    const est = await establish(it);
    await hold(it.id, 'read', base);
    let bytes: ArrayBuffer | null = await read(it, base, span);
    // B1 (re-review): an MP3's frames, from the bytes just read, before the decode.
    scanHeld(it, est, bytes);
    await hold(it.id, 'decode', base + span * PROGRESS_WEIGHTS.read);
    let buf: AudioBuffer | null = await decode(bytes, base, span);
    bytes = null;
    let layers: AudioBuffer | null = null;
    // v16.5 final: the decode and the layers are let go (letGo) however this file ends: made, refused, cancelled.
    try {
      const outS = buf.length / OUT_RATE;
      // The last guard: a decode longer than every length said (a file the header and the probe both misread), or with
      // more than two channels (a header that didn't say).
      checkDecoded(it, est, buf);
      let plan: LayerPlanRecord | null = null;
      if (it.spec.layers) {
        await hold(it.id, 'layers', base + span * (PROGRESS_WEIGHTS.read + PROGRESS_WEIGHTS.decode));
        const l0 = performance.now();
        emit({ phase: 'layers' }, true);
        const segs: LayerSegment[] = [{ spec: it.spec, startS: 0, durS: outS, bands: bandSchedule(it.envelope, it.spec.startBand, it.spec.render, outS, it.spec.adaptive) }];
        const r = await renderLayers(segs, outS, deps.layerRate ?? LAYER_RATE, { endFade: false });
        layers = r.buf; // before the check: a cancel there lets them go (the finally)
        plan = r.rec;
        check();
        ms.layers += performance.now() - l0;
      }
      const mixed = await mixInto(bufferReader(buf), layers, base, span, PROGRESS_WEIGHTS.read + PROGRESS_WEIGHTS.decode + PROGRESS_WEIGHTS.layers);
      check();
      emit({ phase: 'save' }, true);
      files.push(finishFile({ id: it.id, name: it.name }, mixed, infoFor(it.title, it.spec), plan, it.spec.layers));
    } finally {
      await letGo([...channelsOf(buf), ...channelsOf(layers)]);
      buf = null;
      layers = null;
    }
  };

  /** B6: a playlist's track it couldn't read, decode or fit (or a multichannel one) is skipped and named; anything else
   *  stops the export. */
  const skipOrThrow = (it: EngineItem, e: unknown): void => {
    if (e instanceof Cancelled) throw e;
    const f = classify(e);
    const why = SKIP_FOR[f.reason] ?? null;
    if (why === null) throw f;
    skipped.push({ id: it.id, title: it.title, why, cap: f.cap });
  };

  // ---- One long file: the layers once, the tracks decoded one at a time and joined.
  const longFile = async (): Promise<void> => {
    const present: EngineItem[] = [];
    for (const it of items) {
      if (!it.file) skipped.push({ id: it.id, title: it.title, why: 'missing' });
      else if (it.duration !== null && it.duration > quickCap(it)) skipped.push({ id: it.id, title: it.title, why: 'too-long', cap: capInfoFor(it.duration, kindOf(it), deps.deviceMemory) });
      else present.push(it);
    }
    // B1: every track's length (the layers are planned from them), before anything is read or decoded.
    const usable: Array<{ it: EngineItem; est: Established }> = [];
    for (const it of present) {
      await hold(it.id, 'length', 0);
      try {
        usable.push({ it, est: await establish(it, { scan: true }) });
      } catch (e) {
        skipOrThrow(it, e);
      }
    }
    if (!usable.length) {
      if (skipped.length && skipped.every((s) => s.why === 'too-long')) throw new Failed('cap', 'nothing to export', skipped[0].cap);
      const firstOther = skipped.find((s) => s.why !== 'missing' && s.why !== 'too-long');
      throw new Failed(firstOther ? REASON_FOR[firstOther.why] : 'missing', 'nothing to export');
    }
    const planned = usable.map((u) => u.est.seconds / PSF);
    const totalPlanned = planned.reduce((a, b) => a + b, 0);
    // v16.5 final: the heaviest track's export peak as the per-track caps count it (exportPeakMB: on a phone its decode's room).
    const heaviest = Math.max(...usable.map((u) => exportPeakMB(u.est.kind, u.est.seconds, deps.mobile, u.est.src)));
    const longCap = deps.capSeconds ?? longFileCapSeconds(deps.mobile, heaviest, deps.deviceMemory);
    if (totalPlanned * PSF > longCap + 1) {
      const m = Math.floor(longCap / 60);
      throw new Failed('cap', String(totalPlanned * PSF), { seconds: totalPlanned * PSF, phoneMin: m, computerMin: m, what: 'long', kHz: null });
    }
    if (totalPlanned * OUT_RATE * BYTES_PER_FRAME + 1024 > RIFF_MAX_BYTES) throw new Failed('riff', 'over 4 GB');
    // The layers: one continuous render over the planned length (the tracks' established lengths; the music's own
    // frames decide the file's length, and the end fade is the mix's, at its real end: B3), the band carried from
    // track to track as App's preset is.
    const segs: LayerSegment[] = [];
    let start = 0;
    let band: Band = usable[0].it.spec.startBand;
    for (let k = 0; k < usable.length; k++) {
      const it = usable[k].it;
      const spec = { ...it.spec, startBand: band };
      const bands = bandSchedule(it.envelope, band, spec.render, planned[k], spec.adaptive);
      segs.push({ spec, startS: start, durS: planned[k], bands });
      band = bands[bands.length - 1].band;
      start += planned[k];
    }
    let layers: AudioBuffer | null = null;
    let plan: LayerPlanRecord | null = null;
    const anyLayers = segs.some((s) => s.spec.layers);
    // v16.5 final: the decodes in use (each track's channels until it is trimmed to its tail); with the layers and the
    // grid, let go (letGo) however the long file ends.
    let originals: Float32Array[] = [];
    let grid: GridTrack[] = [];
    try {
      if (anyLayers) {
        await hold(usable[0].it.id, 'layers', 0);
        const l0 = performance.now();
        emit({ phase: 'layers', fraction: 0.02 }, true);
        const margin = Math.max(LONG_LAYERS_MARGIN_S, totalPlanned * LONG_LAYERS_MARGIN_FRACTION);
        const r = await renderLayers(segs, totalPlanned + margin, deps.layerRate ?? LAYER_RATE, { endFade: false });
        layers = r.buf; // before the check: a cancel there lets them go (the finally)
        plan = r.rec;
        check();
        ms.layers += performance.now() - l0;
      }
      // B7: the music. Each track is decoded at its own rate (no resampling by Chrome) and placed on the output grid at
      // its exact fractional start; near a join the two tracks' kernels add (resample.ts). Before decoding the next, the
      // current one is trimmed to what the next slices still need: one decode in memory at a time.
      const rOut = OUT_RATE / PSF;
      const kernels = new Map<number, Kernel>();
      const kernelFor = (rIn: number): Kernel => {
        let k = kernels.get(rIn);
        if (!k) {
          k = designKernel(rIn, rOut);
          kernels.set(rIn, k);
        }
        return k;
      };
      const maxReach = Math.max(...usable.map((u) => kernelFor(nativeRate(u.est.info)).reachOut));
      const starts: number[] = [];
      let next = 0;
      // Tnext: where the music decoded so far ends on the output grid (Σ n · rOut / rIn: the file's length, the joins);
      // r0: the first track's rate. Each track's samples sit joinShift(rIn, r0, rOut) from its join (re-review B7: 0
      // between tracks of one rate; half a sample by each rate between two), so the next track may reach back that much
      // more (at most rOut / 2r0).
      let Tnext = 0;
      let r0 = 0;
      const final = () => next >= usable.length;
      const total = () => Math.round(Tnext);
      // Frames complete now: all of them once every track is decoded; else those the next track can't reach back into.
      const ready = () => (final() ? total() : Math.max(0, Math.floor(Tnext - (r0 > 0 ? rOut / (2 * r0) : 0)) - maxReach - 1));
      // B1 (re-review): the decodes' own lengths against the long file's cap (a header that understated).
      let decodedS = 0;
      const reader: MusicReader = {
        frames: () => (final() ? total() : Math.max(ready(), 1)),
        final,
        ensure: async (o1: number) => {
          while (ready() < o1 && next < usable.length) {
            const keepFrom = Math.max(0, o1 - SLICE_FRAMES - FADE_FRAMES - 4 * catchConfig(OUT_RATE).attack - 1);
            grid = grid.filter((t) => trackSpan(t)[1] > keepFrom).map((t) => trimTrack(t, keepFrom));
            // v16.5 final: a decode now trimmed to its tail (a copy) or past is let go before the next is read.
            const live = new Set<Float32Array>();
            for (const t of grid) live.add(t.L).add(t.R);
            const done = originals.filter((a) => !live.has(a));
            if (done.length) {
              await letGo(done);
              originals = originals.filter((a) => live.has(a));
            }
            const { it, est } = usable[next];
            const idx = next + 1;
            emit({ file: { index: idx, count: usable.length, title: it.title } }, true);
            await hold(it.id, 'read', progress.fraction);
            let bytes: ArrayBuffer | null = null;
            let buf: AudioBuffer | null;
            let decoded: AudioBuffer | null = null;
            try {
              // v16.5 final: inside, so a read that fails here names the track as a decode that fails does.
              bytes = await read(it, progress.fraction, 0);
              await hold(it.id, 'decode', progress.fraction);
              // B1 (re-review): the bytes' frames once more (milliseconds): the plan scanned the same file.
              scanHeld(it, est, bytes, it.title);
              buf = await decode(bytes, progress.fraction, 0, nativeRate(est.info));
              decoded = buf;
              bytes = null;
              // The decode's own length and channels (B09b on this path too), and the long file's cap on the sum.
              checkDecoded(it, est, buf, it.title);
              decodedS += buf.length / buf.sampleRate;
              if (decodedS > longCap + 1) {
                const m = Math.floor(longCap / 60);
                throw new Failed('cap', String(decodedS), { seconds: decodedS, phoneMin: m, computerMin: m, what: 'long', kHz: null }, it.title);
              }
            } catch (e) {
              await letGo(channelsOf(decoded)); // v16.5 final: a decode refused here (its length, its channels) goes at once
              if (e instanceof Cancelled) throw e;
              const f = classify(e);
              // B6: the layers are planned for every track, so the long file stops here, naming the track.
              throw new Failed(f.reason, f.message, f.cap, it.title);
            }
            bytes = null;
            const rIn = buf.sampleRate;
            if (r0 === 0) r0 = rIn;
            const L = buf.getChannelData(0);
            const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
            originals.push(L, R);
            // B7 (re-review): its first sample half a sample of its own rate past the join, as the first track's is.
            const t: GridTrack = { T: Tnext + joinShift(rIn, r0, rOut), n: buf.length, rIn, step: rIn / rOut, off: 0, L, R, kernel: kernelFor(rIn) };
            buf = null;
            grid.push(t);
            starts.push(Tnext);
            Tnext += t.n / t.step;
            next++;
            emit({ phase: 'mix' }, true);
          }
        },
        read: (o0: number, n: number, L: Float32Array, R: Float32Array) => {
          L.fill(0, 0, n);
          R.fill(0, 0, n);
          for (const t of grid) addTrack(t, o0, n, L, R);
        },
      };
      const mixed = await mixInto(reader, layers, 0, 1, anyLayers ? 0.08 : 0.02, Math.round(totalPlanned * OUT_RATE));
      check();
      if (mixed.frames * BYTES_PER_FRAME + 1024 > RIFF_MAX_BYTES) throw new Failed('riff', 'over 4 GB');
      emit({ phase: 'save' }, true);
      const f = finishFile({ id: null, name: longName }, mixed, infoFor(title, usable[0].it.spec), plan, anyLayers);
      f.joins = starts.slice(1).map((s) => Math.round(s));
      files.push(f);
    } finally {
      await letGo([...originals, ...grid.flatMap((t) => [t.L, t.R]), ...channelsOf(layers)]);
      originals = [];
      grid = [];
      layers = null;
    }
  };

  const promise = (async (): Promise<JobResult> => {
    document.addEventListener('visibilitychange', onVis);
    void wantLock();
    try {
      if (kind === 'long') await longFile();
      else if (kind === 'track') await oneTrack(items[0], 1, 1);
      else {
        for (let i = 0; i < items.length; i++) {
          check();
          try {
            await oneTrack(items[i], i + 1, items.length);
          } catch (e) {
            skipOrThrow(items[i], e);
          }
        }
      }
      if (!files.length && skipped.length) {
        const s0 = skipped[0];
        throw new Failed(REASON_FOR[s0.why], 'nothing exported', s0.cap);
      }
      ms.total = performance.now() - t0;
      emit({ phase: 'save', fraction: 1, etaS: 0 }, true);
      return { outcome: 'done', files, skipped, ms, steps, sources };
    } catch (e) {
      ms.total = performance.now() - t0;
      if (e instanceof Cancelled) return { outcome: 'cancelled', files, skipped, ms, steps, sources };
      const f = classify(e);
      if (f.reason === 'other') console.error('Export with layers failed:', e);
      return { outcome: 'failed', reason: f.reason, error: f.message, cap: f.cap, failedTitle: f.title, files, skipped, ms, steps, sources };
    } finally {
      releaseLock();
    }
  })();

  return {
    store,
    promise,
    cancel: () => {
      cancelled = true;
    },
    abandon: () => {
      cancelled = true;
      abandoned = true;
      listeners.clear();
      releaseLock();
    },
  };
}

/** E13 (the dev hook's compare): the quarter-rate layers against a full-rate render of the same spec, as SNR (dB). */
export async function compareLayerRates(spec: ExportSpec, seconds = 20): Promise<{ snrDb: number; plan: LayerPlanRecord }> {
  const segs: LayerSegment[] = [{ spec, startS: 0, durS: seconds, bands: [{ t: 0, band: spec.startBand }] }];
  const low = await renderLayers(segs, seconds, LAYER_RATE);
  const full = await renderLayers(segs, seconds, OUT_RATE);
  const ph = designInterp();
  const n = Math.floor(seconds * OUT_RATE) - 2 * OUT_RATE;
  const up = new Float32Array(n);
  let sig = 0;
  let err = 0;
  for (let c = 0; c < 2; c++) {
    interpRange(low.buf.getChannelData(c), ph, LAYER_FACTOR, OUT_RATE, n, up);
    const ref = full.buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const r = ref[OUT_RATE + i];
      sig += r * r;
      const d = up[i] - r;
      err += d * d;
    }
  }
  return { snrDb: 10 * Math.log10(sig / Math.max(err, 1e-30)), plan: low.rec };
}

/** The ceiling the catch keeps (tests read it). */
export const EXPORT_CEILING = CEILING;
