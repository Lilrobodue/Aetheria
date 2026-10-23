// utils/library/analysePass.ts — Analyse tracks (v15.1): one user-started pass that gives each track a visual
// envelope (when it has none of either kind) and key data, from ONE 22050 Hz decode per track.
//
// Pure: App injects every browser dependency through PassEnv (the decode, the envelope renders, the key analysis,
// the player, the clock, storage), so node runs the scheduling checks on a virtual clock (analysePass.check.ts).
// Erasable TypeScript only (no enum, namespace or parameter properties).
//
// The rules, in short (build spec v15.1 §8):
//   - One track at a time, the playing one first, then the upcoming play order, then the rest of the library.
//   - Native steps (probe, read, decode, each envelope band) start only with > 20 s (phone) / 10 s (desktop) left
//     of the playing track and ≥ 2 s into it; main-thread slices only with > 5 s left. Nothing runs while
//     playTrack decodes an un-crystalled track ('starting'): two full decodes at once would double the spike.
//   - After each piece of work it idles work × (1/duty − 1); a step running 1.5× slower per audio second than
//     the run's median halves the duty (a hot, throttling phone). A stop wakes every sleep at once.
//   - On a phone a hidden page parks the pass; the track in flight is redone when the page shows again.
//   - Results reach the lists through env.apply (by id, both lists): the playing track's at once, the rest in
//     batches at least a minute apart, and a final flush. Every flush first re-applies any result a list lost.
//   - A localStorage marker names the track in flight: found at the next start, the app died on that track,
//     which is then marked and skipped. A reload or a closed tab clears it first (pagehide), so only a real
//     death (a renderer killed for memory) leaves it.
//   - Three failed reads mark a track (analysisFailedV); when NOTHING can be read (≥ 3 tracks, no success), the
//     run ends without marking anything.

import { CHROMA_VERSION, needsKey } from '../soundV2/keyAnalysis.ts';
import type { KeyFields } from '../soundV2/keyAnalysis.ts';
import { dedupeById } from './listOps.ts';

export interface PassSong {
  id: string; name: string; duration?: number;
  file?: { size: number };
  bandEnvelope?: { bass?: { length: number } } | null;     // Deep Scan's
  visualEnvelope?: { bass?: { length: number } } | null;   // this pass's
  chromaVersion?: number; analysisFailedV?: number;
}
export interface PassPatch extends Partial<KeyFields> { visualEnvelope?: unknown; analysisFailedV?: number; duration?: number }
export interface Caps { seconds: number; bytes: number }
/** starting = playTrack is decoding a track without a crystal (App's isAnalyzing). */
export interface PlaybackSnapshot { paused: boolean; duration: number; currentTime: number; playbackRate: number; starting: boolean }
/** performance.memory: usedJSHeapSize, jsHeapSizeLimit. */
export interface HeapSnapshot { used: number; limit: number }
export type Hold = 'start' | 'end' | 'loading' | 'starting' | 'memory';
export type StepKind = 'probe' | 'read' | 'decode' | 'envelope' | 'slice' | 'flush';
export type StopReason = 'user' | 'clear' | 'reload' | 'unmount';
export type PassPhase = 'idle' | 'running' | 'holding' | 'parked' | 'stopping';
export interface PassProgress { phase: PassPhase; hold: Hold | null; done: number; total: number; failed: number; tooLong: number; etaMin: number | null }
export const PASS_IDLE: PassProgress = { phase: 'idle', hold: null, done: 0, total: 0, failed: 0, tooLong: 0, etaMin: null };
export interface PassPlan { total: number; seconds: number; playingFirst: boolean; retry: boolean; crashSkipped: number }
export interface PassSummary {
  outcome: 'finished' | 'stopped' | 'error';
  reason?: StopReason | 'unreadable' | 'exception';
  analysed: number; envelopes: number; keys: number; failed: number; tooLong: number; crashSkipped: number; ms: number;
}
export interface StepRecord {
  kind: StepKind; at: number; ms: number;      // at = env.now() when the step started; ms = its work time (holds excluded)
  left: number | null; into: number | null;    // wall seconds of the playing track when the step STARTED (null = nothing playing)
  leftEnd: number | null;                      // wall seconds left when it ENDED (null = nothing playing then)
  id?: string;                                 // the track (not on 'flush')
  band?: 0 | 1 | 2 | 3;                        // 'envelope' only: one record per band render
  ids?: string[];                              // 'flush' only: the ids applied (first 200)
  slowed?: boolean;                            // its idle used the back-off duty (§8.4)
}
/** null = the device default; changed only by the dev hook. */
export interface PassTuning { flushMs: number; duty: number | null; nativeLeftS: number | null; sliceMs: number | null }

/** localStorage: `${CHROMA_VERSION}:${id}` of the track in flight (the crash guard). */
export const ANALYSE_INFLIGHT_KEY = 'aetheria.analyse.inflight.v1';
export const PASS = {
  FLUSH_MS: 60_000, MAX_ATTEMPTS: 3, SYSTEMATIC_MIN: 3,
  END_HOLD_S: 5, START_HOLD_S: 2, NATIVE_LEFT_S_MOBILE: 20, NATIVE_LEFT_S_DESKTOP: 10, FLUSH_LEFT_S: 10, END_LEFT_AT_END_S: 5,
  LOADING_HOLD_MAX_MS: 10_000, STARTING_HOLD_MAX_MS: 60_000, POLL_MS: 250, HOLDING_UI_AFTER_MS: 1_000,
  HEAP_RATIO: 0.6, HEAP_WAIT_MS: 5_000, HEAP_TRIES: 3, PCM_BYTES_PER_S: 176_400, RENDER_BYTES_PER_S: 32_000,
  DUTY_MOBILE: 0.25, DUTY_DESKTOP: 0.5, DUTY_DESKTOP_HIDDEN: 1, THROTTLE_FACTOR: 1.5, THROTTLE_MIN_SAMPLES: 3,
  SLICE_MS_MOBILE: 5, SLICE_MS_DESKTOP: 8, SLICE_MS_DESKTOP_HIDDEN: 50, DOWNMIX_SLICE: 262_144,
  S_PER_AUDIO_MIN_MOBILE: 5, S_PER_AUDIO_MIN_DESKTOP: 0.6, UNKNOWN_DURATION_S: 180, DECODED_OVER_CAP: 1.1,
} as const;
export const DEFAULT_TUNING: PassTuning = { flushMs: PASS.FLUSH_MS, duty: null, nativeLeftS: null, sliceMs: null };

const MIB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------------

/** Length and size caps, tiered by device memory (GB): decoding peaks at about the file's bytes plus twice its
 *  full-rate PCM, so a phone with less RAM gets shorter tracks. A missing or non-positive value: by mobile alone. */
export function capsFor(mobile: boolean, deviceMemoryGB?: number): Caps {
  const dm = typeof deviceMemoryGB === 'number' && Number.isFinite(deviceMemoryGB) && deviceMemoryGB > 0 ? deviceMemoryGB : undefined;
  if (dm !== undefined && dm <= 2) return { seconds: 300, bytes: 40 * MIB };
  if (dm !== undefined && dm <= 4) return { seconds: 480, bytes: 60 * MIB };
  return mobile ? { seconds: 720, bytes: 100 * MIB } : { seconds: 1800, bytes: 1024 * MIB };
}

/** Either envelope with bass frames: the Visualizer's own test (env.bass.length > 0). */
export function hasEnvelope(s: PassSong): boolean {
  return (s.bandEnvelope?.bass?.length ?? 0) > 0 || (s.visualEnvelope?.bass?.length ?? 0) > 0;
}

export type Need = { envelope: boolean; key: boolean; probe: boolean };
export type Skip = 'no-file' | 'done' | 'failed' | 'too-long';
const isNeed = (n: Need | Skip): n is Need => typeof n === 'object';

/** What a track still needs from the pass, or why it is skipped. The order matters (§8.1). */
export function needOf(s: PassSong, caps: Caps, retryFailed = false): Need | Skip {
  if (!s.file) return 'no-file';
  const envelope = !hasEnvelope(s);
  const key = needsKey(s);
  if (!envelope && !key) return 'done';
  if (s.analysisFailedV === CHROMA_VERSION && !retryFailed) return 'failed';
  if ((s.duration ?? 0) > caps.seconds || s.file.size > caps.bytes) return 'too-long';
  return { envelope, key, probe: !((s.duration ?? 0) > 0) };
}

const secondsOrUnknown = (s: PassSong) => ((s.duration ?? 0) > 0 ? (s.duration as number) : PASS.UNKNOWN_DURATION_S);

/** The button's counts. A marked track that a retry would skip as too long counts as too long. */
export function countAnalysable(library: readonly PassSong[], caps: Caps): { todo: number; todoSeconds: number; failed: number; failedSeconds: number; tooLong: number } {
  let todo = 0, todoSeconds = 0, failed = 0, failedSeconds = 0, tooLong = 0;
  for (const s of library) {
    const n = needOf(s, caps, false);
    if (isNeed(n)) { todo++; todoSeconds += secondsOrUnknown(s); continue; }
    if (n === 'too-long') { tooLong++; continue; }
    if (n === 'failed') {
      if (needOf(s, caps, true) === 'too-long') { tooLong++; continue; }
      failed++; failedSeconds += secondsOrUnknown(s);
    }
  }
  return { todo, todoSeconds, failed, failedSeconds, tooLong };
}

/** The play order after the playing track, wrapping (under shuffle: shuffledIndices from shufflePos + 1). */
export function upcomingIds(st: { playlist: readonly { id: string }[]; currentSongIndex: number; isShuffle: boolean; shuffledIndices: readonly number[]; shufflePos: number }): string[] {
  const n = st.playlist.length;
  const out: string[] = [];
  if (n === 0) return out;
  if (st.isShuffle && st.shuffledIndices.length > 0) {
    const m = st.shuffledIndices.length;
    const from = Number.isInteger(st.shufflePos) ? st.shufflePos : 0;
    for (let k = 1; k <= m; k++) {
      const s = st.playlist[st.shuffledIndices[(((from + k) % m) + m) % m]];
      if (s) out.push(s.id);
    }
    return out;
  }
  const from = st.currentSongIndex >= 0 && st.currentSongIndex < n ? st.currentSongIndex : -1;
  for (let k = 1; k <= n; k++) out.push(st.playlist[(from + k) % n].id);
  return out;
}

/** The queue: the playing track, then the upcoming play order, then the rest in library order. Only ids in
 *  `libraryIds` (the eligible ones) are queued; walk repeats collapse into one id. */
export function queueOrder(libraryIds: readonly string[], playingId: string | null, upcoming: readonly string[]): string[] {
  const eligible = new Set(libraryIds);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string | null) => {
    if (id === null || !eligible.has(id) || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  push(playingId);
  for (const id of upcoming) push(id);
  for (const id of libraryIds) push(id);
  return out;
}

/** The hold a step must wait out now, if any (never 'memory': that is the heap gate's). Wall seconds: the
 *  element runs at the 432 rate (0.981818). */
export function holdFor(pb: PlaybackSnapshot | null, step: 'slice' | 'native' | 'flush', mobile: boolean, nativeLeftS?: number | null): Hold | null {
  if (!pb) return null;
  if (pb.starting) return 'starting';
  if (pb.paused) return null;
  if (!Number.isFinite(pb.duration) || pb.duration <= 0) return 'loading';
  const rate = pb.playbackRate > 0 ? pb.playbackRate : 1;
  const left = (pb.duration - pb.currentTime) / rate;
  const into = pb.currentTime / rate;
  if (left <= PASS.END_HOLD_S) return 'end';
  if (into < PASS.START_HOLD_S) return 'start';
  if (step === 'native' && left <= (nativeLeftS ?? (mobile ? PASS.NATIVE_LEFT_S_MOBILE : PASS.NATIVE_LEFT_S_DESKTOP))) return 'end';
  if (step === 'flush' && left <= PASS.FLUSH_LEFT_S) return 'end';
  return null;
}

/** What reading and decoding a track adds to the JS heap: the file, its 22050 Hz stereo PCM (counted once
 *  getChannelData runs) and one 8 kHz envelope render. */
export function projectedBytes(seconds: number, fileBytes: number): number {
  return fileBytes + seconds * (PASS.PCM_BYTES_PER_S + PASS.RENDER_BYTES_PER_S);
}

export function heapTooFull(heap: HeapSnapshot | null, projected: number): boolean {
  return heap !== null && (heap.used + projected) / heap.limit > PASS.HEAP_RATIO;
}

/** The idle after `workMs` of work at this duty; 0 when duty ≥ 1. */
export function idleAfter(workMs: number, duty: number): number {
  if (!(workMs > 0) || duty >= 1) return 0;
  return workMs * (1 / Math.max(0.01, duty) - 1);
}

export function markerValue(id: string): string {
  return `${CHROMA_VERSION}:${id}`;
}

/** The id a marker names, when it was written by this CHROMA_VERSION; else null. */
export function markerId(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const i = value.indexOf(':');
  if (i <= 0 || value.slice(0, i) !== String(CHROMA_VERSION)) return null;
  const id = value.slice(i + 1);
  return id.length ? id : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------------------------

export interface PassEnv<D extends { duration: number }> {
  mobile: boolean; caps: Caps; tuning: PassTuning; retryFailed: boolean;
  now(): number; sleep(ms: number): Promise<void>; yieldNow(): Promise<void>;
  isHidden(): boolean; onVisible(cb: () => void): () => void;           // returns an unsubscribe
  /** The page is going away (reload, navigation, closed tab): returns an unsubscribe. A renderer killed for
   *  memory fires nothing, which is what the crash marker is for. */
  onPageHide(cb: () => void): () => void;
  playback(): PlaybackSnapshot | null;
  heap(): HeapSnapshot | null;                                          // null where performance.memory is missing
  marker: { read(): string | null; write(value: string | null): void }; // the crash guard's storage; must never throw
  library(): readonly PassSong[]; playOrder(): readonly PassSong[];
  playingId(): string | null; upcomingIds(): readonly string[];
  alive(): boolean;                                                     // app level: still mounted and the same cacheGeneration
  probeDuration(s: PassSong): Promise<number>;                          // > 0, or 0 when unreadable
  readFile(s: PassSong): Promise<ArrayBuffer>;
  decode(bytes: ArrayBuffer): Promise<D>;
  envelope(d: D, beforeBand: (band: number) => Promise<void>): Promise<unknown | undefined>;  // awaits beforeBand(0..3) before each band render
  key(d: D, o: { sliceMs: number; yieldFn: (workMs: number) => Promise<void>; shouldCancel: () => boolean }): Promise<KeyFields | null>;
  apply(patches: ReadonlyMap<string, PassPatch>): void;                 // functional patchById on BOTH lists
  progress(p: PassProgress): void;
  onStep?(r: StepRecord): void;
}
export interface PassHandle {
  plan: PassPlan;                                              // computed synchronously by startPass
  done: Promise<PassSummary>;                                  // never rejects
  stop(reason: StopReason): ReadonlyMap<string, PassPatch>;    // synchronous, idempotent
}

// Internal control signals, thrown through the pipeline (plain objects: erasable TS has no parameter properties).
type SignalKind = 'stop' | 'park' | 'failure' | 'too-long' | 'too-long-device';
interface Signal { signal: SignalKind; patch?: PassPatch; cause?: unknown }
const STOP: Signal = { signal: 'stop' };
const PARK: Signal = { signal: 'park' };
const TOO_LONG_DEVICE: Signal = { signal: 'too-long-device' };
const isSig = (e: unknown, k: SignalKind): e is Signal => typeof e === 'object' && e !== null && (e as Signal).signal === k;
const fail = (cause: unknown): Signal => ({ signal: 'failure', cause });
const tooLongWith = (patch?: PassPatch): Signal => ({ signal: 'too-long', patch });

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function startPass<D extends { duration: number }>(env: PassEnv<D>): PassHandle {
  const t0 = env.now();
  const caps = env.caps;
  const tuning = env.tuning;
  const retry = env.retryFailed;

  // --- the run's state -----------------------------------------------------------------------------------------
  let stopped = false;
  let stopReason: StopReason | null = null;
  let wakeUp: () => void = () => {};
  const wake = new Promise<void>((resolve) => { wakeUp = resolve; });
  let releaseParked: (() => void) | null = null;
  const pending = new Map<string, PassPatch>();   // results not applied yet
  const all = new Map<string, PassPatch>();       // every result of this run, applied or not
  const attempts = new Map<string, number>();
  const failedOnce = new Set<string>();
  const markedIds = new Set<string>();            // marked by three failed attempts this run
  const finished = new Set<string>();             // analysed, marked, too long or crash-skipped this run
  const queue: string[] = [];
  const queued = new Set<string>();
  const secondsOf = new Map<string, number>();
  let total = 0, analysed = 0, envelopes = 0, keys = 0, failedInRun = 0, tooLong = 0, crashSkipped = 0;
  let phase: PassPhase = 'running';
  let hold: Hold | null = null;
  let inflight: string | null = null;
  let lastFlushAt = t0;
  let lastLibrary: readonly PassSong[] | null = null;
  let lastSeenPlayingId: string | null = null;
  // The 'starting' latch (§8.3): a flag stuck true (playTrack's early return) can't stall the pass.
  let startingSince: number | null = null;
  let startingLatched = false;
  // The heap gate trusts performance.memory only once it has been seen to move across a decode. Android
  // Chrome's reading is bucketized and refreshed at most every 20 minutes unless the renderer is locked to a
  // site, so a stale value must never latch the gate: unproven or stale, the gate stays open (the caps and the
  // crash guard still apply).
  let heapTrust: 'unknown' | 'live' | 'stale' = 'unknown';
  let heapAtGate: HeapSnapshot | null = null;
  // The back-off: this run's work ms per audio second, per kind.
  const rates: { decode: number[]; envelope: number[] } = { decode: [], envelope: [] };
  // The ETA: measured wall time per audio second of finished tracks, holds and parks excluded.
  let activeMs = 0, activeAudioS = 0, measured = 0, heldInTrackMs = 0;
  // The slice in progress (for its StepRecord).
  let sliceStart: { at: number; left: number | null; into: number | null } | null = null;
  let sliceId: string | null = null;

  const aliveNow = (): boolean => !stopped && env.alive();
  /** A phone with its page hidden parks the pass (desktop keeps going). */
  const parkNow = (): boolean => env.mobile && env.isHidden();
  const safe = (fn: () => void) => { try { fn(); } catch { /* an observer must never break the run */ } };
  const writeMarker = (v: string | null) => safe(() => env.marker.write(v));

  function wall(pb: PlaybackSnapshot | null): { left: number | null; into: number | null } {
    if (!pb || pb.paused || !Number.isFinite(pb.duration) || pb.duration <= 0) return { left: null, into: null };
    const rate = pb.playbackRate > 0 ? pb.playbackRate : 1;
    return { left: (pb.duration - pb.currentTime) / rate, into: pb.currentTime / rate };
  }
  function startStep(): { at: number; left: number | null; into: number | null } {
    return { at: env.now(), ...wall(env.playback()) };
  }
  function endStep(kind: StepKind, s: { at: number; left: number | null; into: number | null }, extra: Partial<StepRecord> = {}, emitNow = true): StepRecord {
    const r: StepRecord = { kind, at: s.at, ms: env.now() - s.at, left: s.left, into: s.into, leftEnd: wall(env.playback()).left, ...extra };
    if (emitNow) safe(() => env.onStep?.(r));
    return r;
  }

  function etaNow(): number {
    let remaining = 0;
    for (const id of queue) remaining += secondsOf.get(id) ?? PASS.UNKNOWN_DURATION_S;
    if (inflight !== null) remaining += secondsOf.get(inflight) ?? PASS.UNKNOWN_DURATION_S;
    const perAudioS = measured >= 2 && activeAudioS > 0
      ? activeMs / 1000 / activeAudioS
      : (env.mobile ? PASS.S_PER_AUDIO_MIN_MOBILE : PASS.S_PER_AUDIO_MIN_DESKTOP) / 60;
    return (remaining * perAudioS) / 60;
  }
  function emit(): void {
    if (stopped && phase !== 'stopping') return;
    const p: PassProgress = { phase, hold, done: analysed + failedInRun + tooLong, total, failed: failedInRun + crashSkipped, tooLong, etaMin: etaNow() };
    safe(() => env.progress(p));
  }
  function setPhase(p: PassPhase, h: Hold | null): void {
    if (phase === p && hold === h) return;
    phase = p;
    hold = h;
    emit();
  }

  function addResult(id: string, patch: PassPatch): void {
    pending.set(id, { ...pending.get(id), ...patch });
    all.set(id, { ...all.get(id), ...patch });
  }
  /** A copy of `m` without each `duration` the live song already has (D15), and without empty patches. */
  function withoutKnownDurations(m: ReadonlyMap<string, PassPatch>): Map<string, PassPatch> {
    const out = new Map<string, PassPatch>();
    let byId: Map<string, PassSong> | null = null;
    for (const [id, p0] of m) {
      let p = p0;
      if ('duration' in p) {
        if (!byId) { byId = new Map(); for (const s of env.library()) if (!byId.has(s.id)) byId.set(s.id, s); }
        const live = byId.get(id);
        if (live && (live.duration ?? 0) > 0) { const { duration: _drop, ...rest } = p; p = rest; }
      }
      if (Object.keys(p).length) out.set(id, p);
    }
    return out;
  }
  /** Put back into `pending` every result a list has lost (a generator's same-tick setPlaylist can drop a patch
   *  from the play order). O(n): one walk over each list. Runs at every flush (`kind` names it). */
  function reconcile(kind: 'playing' | 'switch' | 'batch' | 'final' | 'park' | 'stop'): void {
    if (all.size === 0) return;
    const lacks = (s: PassSong, r: PassPatch): boolean =>
      ('chromaVersion' in r && s.chromaVersion !== r.chromaVersion) ||
      ('visualEnvelope' in r && s.visualEnvelope !== r.visualEnvelope) ||
      ('analysisFailedV' in r && s.analysisFailedV !== r.analysisFailedV);
    for (const list of [env.library(), env.playOrder()]) {
      for (const s of list) {
        const r = all.get(s.id);
        if (r && lacks(s, r)) pending.set(s.id, { ...r });
      }
    }
  }
  /** One env.apply of everything pending, and its 'flush' record. */
  function applyPending(): void {
    if (pending.size === 0) return;
    const patches = withoutKnownDurations(pending);
    pending.clear();
    if (patches.size === 0) return;
    const s = startStep();
    env.apply(patches);
    lastFlushAt = env.now();
    endStep('flush', s, { ids: [...patches.keys()].slice(0, 200) });
  }

  function sleepOrWake(ms: number): Promise<void> {
    let p: Promise<void>;
    try { p = env.sleep(ms); } catch { p = Promise.resolve(); }
    return Promise.race([p.catch(() => {}), wake]);
  }
  function dutyNow(): number {
    return tuning.duty ?? (env.mobile ? PASS.DUTY_MOBILE : env.isHidden() ? PASS.DUTY_DESKTOP_HIDDEN : PASS.DUTY_DESKTOP);
  }
  /** The idle after a piece of work. Returns undefined, synchronously, when there is none: no sleep(0) and no
   *  await of a resolved promise, so a hidden desktop page at duty 1 is never throttled by timers (D17). */
  function pace(workMs: number, slowed = false): Promise<void> | undefined {
    const idle = idleAfter(workMs, dutyNow() * (slowed ? 0.5 : 1));
    if (!(idle > 0)) return undefined;
    return sleepOrWake(idle);
  }
  /** Whether this piece ran 1.5× slower per audio second than the run's median so far (decided before the
   *  sample joins the history). */
  function slowedBy(kind: 'decode' | 'envelope', ms: number, audioS: number): boolean {
    if (!(audioS > 0)) return false;
    const xs = rates[kind];
    return xs.length >= PASS.THROTTLE_MIN_SAMPLES && ms / audioS > PASS.THROTTLE_FACTOR * median(xs);
  }
  const addRate = (kind: 'decode' | 'envelope', ms: number, audioS: number) => { if (audioS > 0) rates[kind].push(ms / audioS); };

  function heapReading(): HeapSnapshot | null {
    let h: HeapSnapshot | null = null;
    try { h = env.heap(); } catch { h = null; }
    heapAtGate = h;
    return heapTrust === 'live' ? h : null;
  }
  /** After a decode: a reading that moved is live; one that didn't is stale (and stays stale this run). */
  function judgeHeap(): void {
    const before = heapAtGate;
    heapAtGate = null;
    if (!before || heapTrust === 'stale') return;
    let after: HeapSnapshot | null = null;
    try { after = env.heap(); } catch { after = null; }
    if (!after) return;
    if (after.used === before.used && after.limit === before.limit) heapTrust = 'stale';
    else if (heapTrust === 'unknown') heapTrust = 'live';
  }

  /** Wait until a step of this kind may start (§8.3). Throws STOP or PARK, or TOO_LONG_DEVICE from the heap gate. */
  async function gate(kind: 'native' | 'slice' | 'flush', heapFor?: { seconds: number; bytes: number }): Promise<void> {
    let heldSince: number | null = null;
    let loadingSince: number | null = null;
    let memoryWaits = 0;
    for (;;) {
      if (!aliveNow()) throw STOP;
      if (parkNow()) throw PARK;
      const pb = env.playback();
      let h = holdFor(pb, kind, env.mobile, tuning.nativeLeftS);
      if (!pb || !pb.starting) {
        startingSince = null;
        startingLatched = false;
      } else if (h === 'starting') {
        const t = env.now();
        if (startingSince === null) startingSince = t;
        if (startingLatched || t - startingSince >= PASS.STARTING_HOLD_MAX_MS) {
          startingLatched = true;
          h = holdFor({ ...pb, starting: false }, kind, env.mobile, tuning.nativeLeftS);
        }
      }
      if (h === 'loading') {
        const t = env.now();
        if (loadingSince === null) loadingSince = t;
        else if (t - loadingSince > PASS.LOADING_HOLD_MAX_MS) h = null;
      }
      if (h === null && heapFor) {
        if (heapTooFull(heapReading(), projectedBytes(heapFor.seconds, heapFor.bytes))) {
          if (memoryWaits >= PASS.HEAP_TRIES) throw TOO_LONG_DEVICE;
          h = 'memory';
        }
      }
      if (h === null) {
        if (phase === 'holding') setPhase('running', null);
        return;
      }
      const t = env.now();
      if (heldSince === null) heldSince = t;
      if (t - heldSince >= PASS.HOLDING_UI_AFTER_MS) setPhase('holding', h);
      const s0 = env.now();
      await sleepOrWake(h === 'memory' ? PASS.HEAP_WAIT_MS : PASS.POLL_MS);
      heldInTrackMs += env.now() - s0;
      if (h === 'memory') memoryWaits++;
    }
  }

  /** Reconcile, then apply what is pending: after gate('flush') (never inside gate itself), except at park,
   *  where it applies only if a flush is allowed right now and never waits. */
  async function flush(kind: 'playing' | 'switch' | 'batch' | 'final' | 'park'): Promise<void> {
    reconcile(kind);
    if (pending.size === 0) return;
    if (kind === 'park') {
      if (holdFor(env.playback(), 'flush', env.mobile, null) !== null) return;
    } else {
      await gate('flush');
    }
    if (!aliveNow()) return;
    applyPending();
  }
  /** Flush point (b): the playing track has CHANGED to one whose result is pending. */
  async function switchFlush(): Promise<void> {
    const pid = env.playingId();
    if (pid === lastSeenPlayingId) return;
    lastSeenPlayingId = pid;
    if (pid !== null && pending.has(pid)) await flush('switch');
  }

  /** One main-thread slice ended (the downmix's or the chroma's): record it, yield, idle, wait for the gate,
   *  check flush point (b). A thrown PARK or STOP propagates through the analysis. */
  async function slicePace(workMs: number): Promise<void> {
    if (sliceStart) {
      const r: StepRecord = { kind: 'slice', at: sliceStart.at, ms: workMs, left: sliceStart.left, into: sliceStart.into, leftEnd: wall(env.playback()).left, id: sliceId ?? undefined };
      safe(() => env.onStep?.(r));
    }
    sliceStart = null;
    try { await env.yieldNow(); } catch { /* a yield never matters for correctness */ }
    const p = pace(workMs);
    if (p) await p;
    await gate('slice');
    await switchFlush();
    sliceStart = startStep();
  }

  async function park(): Promise<void> {
    setPhase('parked', null);
    await flush('park');
    if (!aliveNow()) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      let unsub: () => void = () => {};
      const finish = () => {
        if (settled) return;
        settled = true;
        if (releaseParked === finish) releaseParked = null;
        safe(unsub);
        resolve();
      };
      releaseParked = finish;
      try { unsub = env.onVisible(finish); } catch { finish(); return; }
      if (stopped || !env.isHidden()) finish();
    });
    if (aliveNow()) setPhase('running', null);
  }

  /** One track, start to end (§8.2). Returns its patch; throws a Signal otherwise. Every exit clears the marker. */
  async function pipeline(song: PassSong, need: Need): Promise<{ patch: PassPatch; audioS: number }> {
    const id = song.id;
    inflight = id;
    writeMarker(markerValue(id));
    let d: D | null = null;
    try {
      const hadDuration = (song.duration ?? 0) > 0;
      let seconds = hadDuration ? (song.duration as number) : 0;
      if (need.probe) {
        await gate('native');
        const s = startStep();
        try {
          seconds = await env.probeDuration(song);
        } catch (err) {
          endStep('probe', s, { id });
          throw fail(err);
        }
        endStep('probe', s, { id });
        if (!(seconds > 0)) throw fail(new Error('no duration'));
        if (seconds > caps.seconds) throw tooLongWith({ duration: seconds });
      }
      // The heap gate (§8.6), before anything is read.
      await gate('native', { seconds: seconds > 0 ? seconds : PASS.UNKNOWN_DURATION_S, bytes: song.file?.size ?? 0 });
      const sr = startStep();
      let bytes: ArrayBuffer | null;
      try {
        bytes = await env.readFile(song);
      } catch (err) {
        endStep('read', sr, { id });
        throw fail(err);
      }
      endStep('read', sr, { id });
      await gate('native');
      const sd = startStep();
      try {
        d = await env.decode(bytes);
      } catch (err) {
        bytes = null;
        endStep('decode', sd, { id });
        throw fail(err);
      }
      bytes = null;
      const audioS = d.duration;
      const decodeMs = env.now() - sd.at;
      const slowedDecode = slowedBy('decode', decodeMs, audioS);
      endStep('decode', sd, { id, ...(slowedDecode ? { slowed: true } : {}) });
      // The decode has landed: a stopped run drops it, a phone that hid meanwhile redoes the track later.
      if (!aliveNow()) throw STOP;
      if (parkNow()) throw PARK;
      judgeHeap();
      if (audioS > caps.seconds * PASS.DECODED_OVER_CAP) throw tooLongWith(hadDuration ? undefined : { duration: audioS });
      addRate('decode', decodeMs, audioS);
      const pd = pace(decodeMs, slowedDecode);
      if (pd) await pd;

      const patch: PassPatch = {};
      if (!hadDuration) patch.duration = seconds > 0 ? seconds : audioS;
      let partFailed = false;

      if (need.envelope) {
        const bands: StepRecord[] = [];
        let open: { band: 0 | 1 | 2 | 3; s: { at: number; left: number | null; into: number | null } } | null = null;
        const close = () => {
          if (open) bands.push(endStep('envelope', open.s, { id, band: open.band }, false));
          open = null;
        };
        let ok = false;
        try {
          const e = await env.envelope(d, async (band: number) => {
            close();
            await gate('native');
            open = { band: Math.max(0, Math.min(3, Math.trunc(band))) as 0 | 1 | 2 | 3, s: startStep() };
          });
          close();
          if (e !== undefined && e !== null) { patch.visualEnvelope = e; ok = true; } else partFailed = true;
        } catch (err) {
          close();
          for (const r of bands) safe(() => env.onStep?.(r));
          if (isSig(err, 'stop') || isSig(err, 'park')) throw err;
          partFailed = true;
          bands.length = 0;
        }
        const envMs = bands.reduce((a, r) => a + r.ms, 0);
        const slowedEnv = ok && slowedBy('envelope', envMs, audioS);
        if (bands.length && slowedEnv) bands[bands.length - 1].slowed = true;
        for (const r of bands) safe(() => env.onStep?.(r));
        if (ok) addRate('envelope', envMs, audioS);
        const pe = pace(envMs, slowedEnv);
        if (pe) await pe;
      }

      if (need.key) {
        // The first slice waits for the gate too: a long idle after the envelope can end in a track's last 5 s.
        await gate('slice');
        const sliceMs = tuning.sliceMs ?? (env.mobile ? PASS.SLICE_MS_MOBILE : env.isHidden() ? PASS.SLICE_MS_DESKTOP_HIDDEN : PASS.SLICE_MS_DESKTOP);
        sliceId = id;
        sliceStart = startStep();
        try {
          const k = await env.key(d, { sliceMs, yieldFn: slicePace, shouldCancel: () => !aliveNow() });
          if (k === null) throw STOP;
          Object.assign(patch, k);
        } catch (err) {
          if (isSig(err, 'stop') || isSig(err, 'park')) throw err;
          partFailed = true;
        } finally {
          // The work after the last yield (or the whole step when it never yielded).
          if (sliceStart) endStep('slice', sliceStart, { id });
          sliceStart = null;
          sliceId = null;
        }
      }
      d = null;
      // A retry that succeeds clears the mark: an OWN property, so patchById's spread removes it.
      if (retry && song.analysisFailedV !== undefined && !partFailed) patch.analysisFailedV = undefined;
      if (partFailed) {
        if (Object.keys(patch).length) addResult(id, patch);   // the parts that worked are kept
        throw fail(new Error('a part failed'));
      }
      return { patch, audioS };
    } finally {
      d = null;
      inflight = null;
      writeMarker(null);
    }
  }

  // --- the plan (synchronous) ----------------------------------------------------------------------------------
  const library0 = dedupeById(env.library());
  lastLibrary = env.library();
  const crashId = markerId((() => { try { return env.marker.read(); } catch { return null; } })());
  if (crashId !== null) {
    const s = library0.find((x) => x.id === crashId);
    if (s && isNeed(needOf(s, caps, retry))) {
      const mark: PassPatch = { analysisFailedV: CHROMA_VERSION };
      all.set(s.id, { ...mark });
      finished.add(s.id);
      crashSkipped++;
      safe(() => env.apply(new Map([[s.id, mark]])));
    }
  }
  writeMarker(null);
  const eligible: string[] = [];
  for (const s of library0) {
    if (finished.has(s.id) || !isNeed(needOf(s, caps, retry))) continue;
    eligible.push(s.id);
    secondsOf.set(s.id, secondsOrUnknown(s));
  }
  const playing0 = env.playingId();
  lastSeenPlayingId = playing0;
  for (const id of queueOrder(eligible, playing0, env.upcomingIds())) { queue.push(id); queued.add(id); }
  total = queue.length;
  let planSeconds = 0;
  for (const id of queue) planSeconds += secondsOf.get(id) ?? PASS.UNKNOWN_DURATION_S;
  const plan: PassPlan = { total, seconds: planSeconds, playingFirst: queue.length > 0 && queue[0] === playing0, retry, crashSkipped };

  function summary(outcome: PassSummary['outcome'], reason?: PassSummary['reason']): PassSummary {
    return { outcome, ...(reason ? { reason } : {}), analysed, envelopes, keys, failed: failedInRun + crashSkipped, tooLong, crashSkipped, ms: env.now() - t0 };
  }
  /** The run ended because it is no longer alive: a stop, or a stale run (treated as 'clear': nothing applied). */
  function stoppedSummary(): PassSummary {
    if (!stopped) {
      stopped = true;
      stopReason = 'clear';
      pending.clear();
      writeMarker(null);
    }
    return summary('stopped', stopReason ?? 'clear');
  }

  /** At every track boundary: arrivals, the playing track first, flush points (b) and (c). */
  async function boundary(): Promise<void> {
    const lib = env.library();
    if (lib !== lastLibrary) {
      lastLibrary = lib;
      for (const s of dedupeById(lib)) {
        if (finished.has(s.id) || queued.has(s.id)) continue;
        if (!isNeed(needOf({ ...s, ...(all.get(s.id) as Partial<PassSong> | undefined) }, caps, retry))) continue;
        queue.push(s.id);
        queued.add(s.id);
        secondsOf.set(s.id, secondsOrUnknown(s));
        total++;
      }
    }
    const pid = env.playingId();
    if (pid !== null && queued.has(pid) && queue[0] !== pid && !((attempts.get(pid) ?? 0) >= 1)) {
      queue.splice(queue.indexOf(pid), 1);
      queue.unshift(pid);
    }
    await switchFlush();
    // Flush point (c), after the current track. It runs on schedule even with nothing new pending: its reconcile
    // may find a result a list has lost (and then it applies it).
    if (env.now() - lastFlushAt >= tuning.flushMs) await flush('batch');
  }

  async function loop(): Promise<PassSummary> {
    for (;;) {
      if (!aliveNow()) return stoppedSummary();
      try {
        await boundary();
      } catch (e) {
        if (isSig(e, 'park')) { await park(); continue; }
        if (isSig(e, 'stop')) return stoppedSummary();
        throw e;
      }
      const id = queue.shift();
      if (id === undefined) break;
      queued.delete(id);

      // Re-read the track by id, merged with this run's results: deleted or no longer eligible → skipped.
      const live = dedupeById(env.library()).find((s) => s.id === id) ?? null;
      const song: PassSong | null = live ? { ...live, ...(all.get(id) as Partial<PassSong> | undefined) } : null;
      const need = song ? needOf(song, caps, retry) : 'no-file';
      if (!song || !isNeed(need)) {
        if (need === 'too-long') { tooLong++; finished.add(id); } else total = Math.max(0, total - 1);
        emit();
        continue;
      }

      // Systematic failure (D16): nothing has worked and every track has failed at least once → stop, mark nothing.
      if ((attempts.get(id) ?? 0) >= 1 && analysed === 0 && failedOnce.size >= PASS.SYSTEMATIC_MIN &&
          queue.every((q) => (attempts.get(q) ?? 0) >= 1)) {
        for (const m of markedIds) {
          for (const map of [pending, all]) {
            const p = map.get(m);
            if (!p) continue;
            const { analysisFailedV: _drop, ...rest } = p;
            if (Object.keys(rest).length) map.set(m, rest); else map.delete(m);
          }
        }
        attempts.clear();
        const end = await finalFlush();
        return end ?? summary('error', 'unreadable');
      }

      const trackStart = env.now();
      heldInTrackMs = 0;
      let result: { patch: PassPatch; audioS: number };
      try {
        result = await pipeline(song, need);
      } catch (e) {
        if (isSig(e, 'park')) {
          queue.unshift(id);
          queued.add(id);
          await park();
          continue;
        }
        if (isSig(e, 'stop')) return stoppedSummary();
        if (isSig(e, 'too-long') || isSig(e, 'too-long-device')) {
          if (e.patch) addResult(id, e.patch);
          tooLong++;
          finished.add(id);
          emit();
          continue;
        }
        if (isSig(e, 'failure')) {
          const n = (attempts.get(id) ?? 0) + 1;
          attempts.set(id, n);
          failedOnce.add(id);
          if (n >= PASS.MAX_ATTEMPTS) {
            addResult(id, { analysisFailedV: CHROMA_VERSION });
            markedIds.add(id);
            failedInRun++;
            finished.add(id);
          } else {
            queue.push(id);   // to the back
            queued.add(id);
          }
          emit();
          continue;
        }
        throw e;
      }

      addResult(id, result.patch);
      finished.add(id);
      analysed++;
      if (result.patch.visualEnvelope !== undefined) envelopes++;
      if (result.patch.chromaVersion !== undefined) keys++;
      activeMs += Math.max(0, env.now() - trackStart - heldInTrackMs);
      activeAudioS += result.audioS > 0 ? result.audioS : 0;
      measured++;
      emit();
      // Flush point (a): the analysed track is the playing one.
      if (id === env.playingId()) {
        try {
          await flush('playing');
        } catch (e) {
          if (isSig(e, 'park')) { await park(); continue; }
          if (isSig(e, 'stop')) return stoppedSummary();
          throw e;
        }
      }
    }
    const end = await finalFlush();
    return end ?? summary('finished');
  }

  /** Flush point (d). Returns a summary only when the run was stopped meanwhile. */
  async function finalFlush(): Promise<PassSummary | null> {
    for (;;) {
      if (!aliveNow()) return stoppedSummary();
      try {
        await flush('final');
        return aliveNow() ? null : stoppedSummary();
      } catch (e) {
        if (isSig(e, 'park')) { await park(); continue; }
        if (isSig(e, 'stop')) return stoppedSummary();
        throw e;
      }
    }
  }

  async function run(): Promise<PassSummary> {
    let unsubHide: () => void = () => {};
    try {
      // A reload, a navigation or a closed tab is not a crash: clear the marker as the page goes.
      unsubHide = env.onPageHide(() => { if (inflight !== null) writeMarker(null); });
    } catch { /* no page lifecycle here: the marker then only clears at each track's end */ }
    try {
      emit();
      if (queue.length === 0) return summary('finished');
      return await loop();
    } catch {
      // Unexpected: keep what is done, as a user stop would.
      if (!stopped && env.alive()) {
        safe(() => { reconcile('stop'); applyPending(); });
      }
      stopped = true;
      pending.clear();
      return summary('error', 'exception');
    } finally {
      safe(unsubHide);
      inflight = null;
      writeMarker(null);
    }
  }

  const done: Promise<PassSummary> = run().catch(() => summary('error', 'exception'));

  function stop(reason: StopReason): ReadonlyMap<string, PassPatch> {
    if (stopped) return new Map();
    stopped = true;
    stopReason = reason;
    wakeUp();
    const release = releaseParked;
    releaseParked = null;
    if (release) release();
    writeMarker(null);
    phase = 'stopping';
    hold = null;
    emit();
    if (reason === 'user') {
      // Now: the loop may be stuck inside a decode it can't abort.
      if (env.alive()) safe(() => { reconcile('stop'); applyPending(); });
      pending.clear();
      return new Map();
    }
    if (reason === 'reload') {
      // Every result of the run, applied or not (a flush may not have reached the refs yet); applies nothing.
      let out: Map<string, PassPatch> = new Map();
      safe(() => { out = withoutKnownDurations(all); });
      pending.clear();
      return out;
    }
    pending.clear();
    return new Map();
  }

  return { plan, done, stop };
}

// ---------------------------------------------------------------------------------------------------------------
// Copy (§9), pure so node can check it
// ---------------------------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const tracks = (n: number) => `${n} ${plural(n, 'track', 'tracks')}`;

/** Minutes for `seconds` of audio: 5 s per audio minute on a phone, 0.6 s on desktop. */
export function passEtaMinutes(seconds: number, mobile: boolean): number {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return ((s / 60) * (mobile ? PASS.S_PER_AUDIO_MIN_MOBILE : PASS.S_PER_AUDIO_MIN_DESKTOP)) / 60;
}

export function passEta(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return 'under a minute';
  return `about ${Math.round(minutes)} min`;
}

export function passStartText(plan: PassPlan, etaMin: number, mobile: boolean): string {
  const crash = plan.crashSkipped === 1
    ? ' Skipped 1 track: the app closed while it was being analysed.'
    : plan.crashSkipped > 1 ? ` Skipped ${plan.crashSkipped} tracks: the app closed while they were being analysed.` : '';
  if (plan.total <= 0) return `Nothing to analyse right now.${crash}`;
  if (plan.retry) return `Trying ${tracks(plan.total)} that couldn't be read again: ${passEta(etaMin)}.${crash}`;
  return `Analysing ${tracks(plan.total)}${plan.playingFirst ? ', the playing one first' : ''}: ${passEta(etaMin)}. ` +
    `You can keep listening${mobile ? '; it pauses while the screen is off' : ''}.${crash}`;
}

/** The end toast, or null when there should be none (clear, unmount, reload). */
export function passEndText(s: PassSummary): string | null {
  if (s.reason === 'clear' || s.reason === 'unmount' || s.reason === 'reload') return null;
  const k = s.analysed;
  if (s.outcome === 'error') {
    if (s.reason === 'unreadable') return 'Analyse tracks stopped: no track could be read on this device. Nothing was marked; try again later.';
    return `Analyse tracks stopped with an error after ${tracks(k)}; they are kept.`;
  }
  if (s.outcome === 'stopped') {
    return k > 0 ? `Stopped after ${tracks(k)}; they are kept. Tap Analyse tracks to do the rest.` : 'Stopped. Nothing was analysed yet.';
  }
  const minutes = s.ms / 60_000;
  let text = k > 0 ? `Analysed ${tracks(k)} in ${minutes >= 1 ? `${Math.round(minutes)} min` : 'under a minute'}.` : 'No track could be analysed.';
  if (s.envelopes > 0) {
    const whom = s.envelopes >= k ? (k === 1 ? 'it' : 'them') : `${s.envelopes} of them`;
    text += ` The visuals now follow the music on ${whom}.`;
  }
  if (s.failed > 0) text += ` ${s.failed} couldn't be read.`;
  if (s.tooLong > 0) text += ` ${s.tooLong} ${plural(s.tooLong, 'is', 'are')} too long for this device.`;
  return text;
}

/** The Analyse tracks button. `blocked` only while idle (Deep Scan's loop, or the restore): a running pass is
 *  never blocked, so a tap always reaches Stop. */
export function passButtonText(
  p: PassProgress,
  c: ReturnType<typeof countAnalysable>,
  o: { deepScan: boolean; restoring: boolean; mobile: boolean },
): { title: string; sub: string; blocked: boolean } {
  const title = 'Analyse tracks';
  if (p.phase === 'idle') {
    if (o.deepScan) return { title, sub: 'Unavailable while Deep Scan runs', blocked: true };
    if (o.restoring) return { title, sub: 'Your library is loading', blocked: true };
    if (c.todo > 0) return { title, sub: `${c.todo} to analyse · ${passEta(passEtaMinutes(c.todoSeconds, o.mobile))}`, blocked: false };
    if (c.failed > 0) return { title, sub: `${c.failed} couldn't be read · tap to try again`, blocked: false };
    if (c.tooLong > 0) return { title, sub: `All analysed · ${c.tooLong} too long for this device`, blocked: false };
    return { title, sub: 'All tracks analysed', blocked: false };
  }
  if (p.phase === 'stopping') return { title: 'Stopping…', sub: 'Finishing the current step', blocked: false };
  const running = `Analysing ${p.done} of ${p.total}`;
  if (p.phase === 'parked') return { title: running, sub: 'Paused while the screen is off', blocked: false };
  if (p.phase === 'holding') {
    return { title: running, sub: p.hold === 'memory' ? 'Waiting for memory to free up · tap to stop' : 'Pausing around the track change · tap to stop', blocked: false };
  }
  return { title: running, sub: `${passEta(p.etaMin ?? 0)} left · tap to stop`, blocked: false };
}
