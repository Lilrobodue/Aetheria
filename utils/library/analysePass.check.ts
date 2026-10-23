// Checks for utils/library/analysePass.ts (Analyse tracks, v15.1; build spec §8, §9, §11.1).
// Run with: node utils/library/analysePass.check.ts   (Node 22.18+ strips the types), or npm run check:analyse
// Exits non-zero on any failure.
//
// The runner is driven on a VIRTUAL clock: env.sleep and the fake native steps (probe, read, decode, envelope
// bands) are timers the driver fires in time order once every microtask has run; main-thread work (the key
// analysis's slices) advances the clock synchronously, as real work blocks the thread. A fake player cycles
// through tracks at the 432 rate (0.981818), swaps at 0.35 s left, and can show playTrack's 'starting' window.
// Costs model a 4-minute track: decode 2 s, envelope 4 × 0.5 s, key 140 slices of 5 ms.

import {
  PASS,
  PASS_IDLE,
  DEFAULT_TUNING,
  ANALYSE_INFLIGHT_KEY,
  capsFor,
  hasEnvelope,
  needOf,
  countAnalysable,
  upcomingIds,
  queueOrder,
  holdFor,
  projectedBytes,
  heapTooFull,
  idleAfter,
  markerValue,
  markerId,
  startPass,
  passEtaMinutes,
  passEta,
  passStartText,
  passEndText,
  passButtonText,
} from './analysePass.ts';
import type {
  PassEnv,
  PassSong,
  PassPatch,
  PassProgress,
  PassSummary,
  PassPlan,
  PassTuning,
  PlaybackSnapshot,
  HeapSnapshot,
  StepRecord,
  Caps,
  StopReason,
} from './analysePass.ts';
import { CHROMA_VERSION } from '../soundV2/keyAnalysis.ts';
import type { KeyFields } from '../soundV2/keyAnalysis.ts';
import { patchById } from './listOps.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) {
    passed++;
    return;
  }
  failures.push(what);
  // Printed at once too: a broken runner can spin or hang later, and the first failure must still be seen.
  console.log('  FAILED ' + what);
}

const CV = CHROMA_VERSION;
const MIB = 1024 * 1024;
const RATE = 0.981818;
const KEY: KeyFields = { chroma: [0.1, 0.05, 0.1, 0.05, 0.1, 0.1, 0.05, 0.1, 0.05, 0.15, 0.05, 0.1], chromaA4Hz: 440, musicKey: 'Am', keyConfidence: 0.8, chromaVersion: CV };
const ENV_OK = () => ({ fps: 20, sub: { length: 4 }, bass: { length: 4 }, mid: { length: 4 }, high: { length: 4 } });

interface FakeSong extends PassSong { file: { size: number }; trueS?: number }
const song = (id: string, extra: Partial<FakeSong> = {}): FakeSong => ({ id, name: `Track ${id}`, duration: 240, file: { size: 6 * MIB }, ...extra });
const isNative = (r: StepRecord) => r.kind === 'probe' || r.kind === 'read' || r.kind === 'decode' || r.kind === 'envelope';

// ---------------------------------------------------------------------------------------------------------------
// The virtual world
// ---------------------------------------------------------------------------------------------------------------

interface PlayerSpec {
  trackS: number | ((n: number) => number);   // element seconds of the n-th track played (n = 0, 1, …)
  startIndex?: number;                          // play-order index playing at t = 0
  startingAt0Ms?: number;                       // a 'starting' window at t = 0, before the first track plays
  startingMs?: (n: number) => number;           // a 'starting' window before the n-th track (n ≥ 1)
}

function makePlayer(spec: PlayerSpec, orderLen: () => number) {
  let n = 0;
  let index = spec.startIndex ?? 0;
  let shown = index;   // what the app reports as playing (the old track while 'starting')
  let phase: 'starting' | 'playing' | 'paused' = spec.startingAt0Ms ? 'starting' : 'playing';
  let phaseT = 0;
  let elem0 = 0;
  let startingUntil = spec.startingAt0Ms ?? 0;
  const swaps: { t: number; index: number }[] = [];
  const startingWindows: { from: number; to: number }[] = spec.startingAt0Ms ? [{ from: 0, to: spec.startingAt0Ms }] : [];
  const dur = (k: number) => (typeof spec.trackS === 'function' ? spec.trackS(k) : spec.trackS);
  function advance(t: number): void {
    for (;;) {
      if (phase === 'starting') {
        if (t < startingUntil) return;
        phase = 'playing';
        phaseT = startingUntil;
        elem0 = 0;
        shown = index;
        continue;
      }
      if (phase !== 'playing') return;
      const tSwap = phaseT + ((dur(n) - 0.35 - elem0) / RATE) * 1000;
      if (t < tSwap) return;
      n++;
      index = (index + 1) % Math.max(1, orderLen());
      swaps.push({ t: tSwap, index });
      const sm = spec.startingMs ? spec.startingMs(n) : 0;
      if (sm > 0) {
        phase = 'starting';
        startingUntil = tSwap + sm;
        startingWindows.push({ from: tSwap, to: tSwap + sm });
      } else {
        phase = 'playing';
        phaseT = tSwap;
        elem0 = 0;
        shown = index;
      }
    }
  }
  return {
    swaps,
    startingWindows,
    snapshot(t: number): PlaybackSnapshot {
      advance(t);
      if (phase === 'starting') return { paused: true, duration: NaN, currentTime: 0, playbackRate: RATE, starting: true };
      const cur = phase === 'paused' ? elem0 : elem0 + ((t - phaseT) / 1000) * RATE;
      return { paused: phase === 'paused', duration: dur(n), currentTime: cur, playbackRate: RATE, starting: false };
    },
    index(t: number): number { advance(t); return shown; },
    /** A user pick: the play-order index `i` starts playing now. */
    jump(t: number, i: number): void { advance(t); n++; index = i; shown = i; phase = 'playing'; phaseT = t; elem0 = 0; swaps.push({ t, index: i }); },
    /** Wall seconds left of the track playing at t (null when not playing). */
    leftAt(t: number): number | null {
      const s = this.snapshot(t);
      return s.paused || s.starting ? null : (s.duration - s.currentTime) / RATE;
    },
  };
}

interface WorldOpts {
  songs: FakeSong[];
  playOrder?: string[];
  mobile?: boolean;
  caps?: Caps;
  tuning?: Partial<PassTuning>;
  retryFailed?: boolean;
  player?: PlayerSpec | null;
  hiddenAt0?: boolean;
  marker?: string | null;
  heap?: (w: World) => HeapSnapshot | null;
  decodeMs?: (id: string, attempt: number) => number;
  bandMs?: (id: string) => number;
  slices?: (id: string) => number;
  sliceWorkMs?: number;
  probe?: (s: FakeSong) => number;
  decodeThrows?: (id: string, attempt: number) => boolean;
  envelopeThrows?: (id: string, attempt: number) => boolean;
  keyThrows?: (id: string) => boolean;
  /** Called by apply before the lists are patched; may return the patches for the PLAY ORDER (to drop one). */
  orderPatches?: (patches: ReadonlyMap<string, PassPatch>, w: World) => ReadonlyMap<string, PassPatch>;
}

type World = ReturnType<typeof makeWorld>;
interface FakeD { duration: number; id: string }

function makeWorld(o: WorldOpts) {
  const clock = { t: 0 };
  const timers: { at: number; seq: number; fn: () => void }[] = [];
  let seq = 0;
  const vsleep = (ms: number) => new Promise<void>((resolve) => { timers.push({ at: clock.t + Math.max(0, ms), seq: seq++, fn: resolve }); });
  const at = (t: number, fn: () => void) => { timers.push({ at: t, seq: seq++, fn }); };

  const w = {
    clock,
    library: o.songs.map((s) => ({ ...s })) as FakeSong[],
    order: [] as FakeSong[],
    sleeps: [] as { at: number; ms: number }[],
    records: [] as StepRecord[],
    applies: [] as { at: number; patches: Map<string, PassPatch> }[],
    progress: [] as { at: number; p: PassProgress }[],
    markerValue: (o.marker ?? null) as string | null,
    markerWrites: [] as { at: number; v: string | null }[],
    hidden: !!o.hiddenAt0,
    alive: true,
    decodes: [] as { at: number; id: string }[],
    envelopeCalls: [] as string[],
    keyCalls: [] as string[],
    visibleCbs: new Set<() => void>(),
    pageHideCbs: new Set<() => void>(),
    player: null as ReturnType<typeof makePlayer> | null,
    attempts: new Map<string, number>(),
    at,
    hide(): void { w.hidden = true; },
    show(): void { w.hidden = false; for (const cb of [...w.visibleCbs]) cb(); },
    pageHide(): void { for (const cb of [...w.pageHideCbs]) cb(); },
    timers,
    env: null as unknown as PassEnv<FakeD>,
  };
  w.order = (o.playOrder ?? w.library.map((s) => s.id)).map((id) => w.library.find((s) => s.id === id)!);
  if (o.player) w.player = makePlayer(o.player, () => w.order.length);
  const mobile = !!o.mobile;
  const sliceWork = o.sliceWorkMs ?? 5;
  const findSong = (id: string) => w.library.find((s) => s.id === id);

  w.env = {
    mobile,
    caps: o.caps ?? capsFor(mobile, 8),
    tuning: { ...DEFAULT_TUNING, ...(o.tuning ?? {}) },
    retryFailed: !!o.retryFailed,
    now: () => clock.t,
    sleep: (ms) => { w.sleeps.push({ at: clock.t, ms }); return vsleep(ms); },
    yieldNow: () => Promise.resolve(),
    isHidden: () => w.hidden,
    onVisible: (cb) => { w.visibleCbs.add(cb); return () => { w.visibleCbs.delete(cb); }; },
    onPageHide: (cb) => { w.pageHideCbs.add(cb); return () => { w.pageHideCbs.delete(cb); }; },
    playback: () => (w.player ? w.player.snapshot(clock.t) : null),
    heap: () => (o.heap ? o.heap(w) : null),
    marker: { read: () => w.markerValue, write: (v) => { w.markerValue = v; w.markerWrites.push({ at: clock.t, v }); } },
    library: () => w.library,
    playOrder: () => w.order,
    playingId: () => (w.player ? w.order[w.player.index(clock.t)]?.id ?? null : null),
    upcomingIds: () => upcomingIds({ playlist: w.order, currentSongIndex: w.player ? w.player.index(clock.t) : -1, isShuffle: false, shuffledIndices: [], shufflePos: 0 }),
    alive: () => w.alive,
    probeDuration: async (s) => { await vsleep(10); return o.probe ? o.probe(s as FakeSong) : (s as FakeSong).trueS ?? 240; },
    readFile: async (s) => {
      await vsleep(5);
      const b = new ArrayBuffer(8);
      (b as unknown as { id: string }).id = s.id;
      return b;
    },
    decode: async (bytes) => {
      const id = (bytes as unknown as { id: string }).id;
      const n = (w.attempts.get(id) ?? 0) + 1;
      w.attempts.set(id, n);
      w.decodes.push({ at: clock.t, id });
      await vsleep(o.decodeMs ? o.decodeMs(id, n) : 2000);
      if (o.decodeThrows?.(id, n)) throw new Error('EncodingError: unable to decode');
      const s = findSong(id);
      return { id, duration: s?.trueS ?? (s && (s.duration ?? 0) > 0 ? (s.duration as number) : 240) };
    },
    envelope: async (d, beforeBand) => {
      w.envelopeCalls.push(d.id);
      const n = w.envelopeCalls.filter((x) => x === d.id).length;
      for (let b = 0; b < 4; b++) {
        await beforeBand(b);
        await vsleep(o.bandMs ? o.bandMs(d.id) : 500);
        if (b === 1 && o.envelopeThrows?.(d.id, n)) throw new Error('render failed');
      }
      return ENV_OK();
    },
    key: async (d, ko) => {
      w.keyCalls.push(d.id);
      if (o.keyThrows?.(d.id)) throw new Error('analysis failed');
      const n = o.slices ? o.slices(d.id) : 140;
      for (let i = 0; i < n; i++) {
        clock.t += sliceWork;   // main-thread work: the clock moves, no timer can fire meanwhile
        if (i < n - 1) {
          await ko.yieldFn(sliceWork);
          if (ko.shouldCancel()) return null;
        }
      }
      return { ...KEY, chroma: [...(KEY.chroma as number[])] };
    },
    apply: (patches) => {
      w.applies.push({ at: clock.t, patches: new Map(patches) });
      const forOrder = o.orderPatches ? o.orderPatches(patches, w) : patches;
      w.library = patchById(w.library, patches as ReadonlyMap<string, Partial<FakeSong>>);
      w.order = patchById(w.order, forOrder as ReadonlyMap<string, Partial<FakeSong>>);
    },
    progress: (p) => { w.progress.push({ at: clock.t, p }); },
    onStep: (r) => { w.records.push(r); },
  };
  return w;
}

/** Fire timers in time order (after draining microtasks) until `until()` holds or nothing is left to fire. */
async function drive(w: World, until: () => boolean, limitMs = 10 * 3600_000): Promise<void> {
  for (let guard = 0; guard < 3_000_000; guard++) {
    await new Promise<void>((r) => setImmediate(r));
    if (until()) return;
    if (w.timers.length === 0) return;
    w.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const next = w.timers.shift()!;
    if (next.at > limitMs) { w.timers.unshift(next); return; }
    if (next.at > w.clock.t) w.clock.t = next.at;
    next.fn();
  }
  throw new Error('drive: guard exceeded');
}

async function runPass(w: World, during?: (h: ReturnType<typeof startPass>) => void) {
  const h = startPass(w.env);
  let summary: PassSummary | null = null;
  let doneAt = -1;   // the virtual time at which `done` settled
  h.done.then((s) => { summary = s; doneAt = w.clock.t; }, () => { summary = { outcome: 'error', reason: 'exception', analysed: -1, envelopes: 0, keys: 0, failed: 0, tooLong: 0, crashSkipped: 0, ms: 0 }; doneAt = w.clock.t; });
  if (during) during(h);
  await drive(w, () => summary !== null);
  return { h, plan: h.plan, summary: summary as PassSummary | null, doneAt };
}

const appliedIds = (w: World) => w.applies.flatMap((a) => [...a.patches.keys()]);
const firstApplyAt = (w: World, id: string) => w.applies.find((a) => a.patches.has(id))?.at ?? null;
const recordsOf = (w: World, id: string, kind?: StepRecord['kind']) => w.records.filter((r) => r.id === id && (!kind || r.kind === kind));
const libSong = (w: World, id: string) => w.library.find((s) => s.id === id);

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------------

{
  // queueOrder: playing first, then upcoming (wrapping), then the rest in library order; repeats collapse.
  check(queueOrder(['a', 'b', 'c', 'd', 'e'], 'c', ['d', 'e', 'a', 'b', 'c']).join() === 'c,d,e,a,b', 'queueOrder: playing, then upcoming with wrap');
  check(queueOrder(['x', 'a', 'b', 'y'], 'a', ['b', 'a', 'b']).join() === 'a,b,x,y', 'queueOrder: walk repeats collapse; the rest in library order');
  check(queueOrder(['a', 'b'], 'z', ['z', 'b']).join() === 'b,a', 'queueOrder: an ineligible playing id is left out');
  check(queueOrder(['a', 'b', 'c'], null, []).join() === 'a,b,c', 'queueOrder: nothing playing → library order');
  const pl = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  check(upcomingIds({ playlist: pl, currentSongIndex: 3, isShuffle: false, shuffledIndices: [], shufflePos: 0 }).join() === 'e,a,b,c,d', 'upcomingIds: sequential, wrapping');
  check(upcomingIds({ playlist: pl, currentSongIndex: -1, isShuffle: false, shuffledIndices: [], shufflePos: 0 }).join() === 'a,b,c,d,e', 'upcomingIds: nothing playing → from the top');
  check(upcomingIds({ playlist: pl, currentSongIndex: 1, isShuffle: true, shuffledIndices: [3, 1, 4, 0, 2], shufflePos: 1 }).join() === 'e,a,c,d,b', 'upcomingIds: shuffle from shufflePos + 1, wrapping');
  const walk = ['a', 'b', 'a', 'c'].map((id) => ({ id }));
  check(queueOrder(['a', 'b', 'c'], 'a', upcomingIds({ playlist: walk, currentSongIndex: 0, isShuffle: false, shuffledIndices: [], shufflePos: 0 })).join() === 'a,b,c', 'queueOrder over a walk: one entry per id');
}

{
  // needOf: every branch, in the §8.1 order; either envelope field counts.
  const caps: Caps = { seconds: 720, bytes: 100 * MIB };
  const env1 = { bass: { length: 3 } };
  const n = (s: Partial<FakeSong>, retry = false) => needOf({ id: 'x', name: 'x', ...s } as PassSong, caps, retry);
  check(n({ duration: 100 }) === 'no-file', 'needOf: no file → no-file');
  check(n({ duration: 2000, analysisFailedV: CV }) === 'no-file', 'needOf: no-file comes first');
  const f = { size: 1000 };
  check(n({ file: f, duration: 100, bandEnvelope: env1, chromaVersion: CV }) === 'done', 'needOf: Deep Scan envelope + key → done');
  check(n({ file: f, duration: 100, visualEnvelope: env1, chromaVersion: CV }) === 'done', 'needOf: visual envelope + key → done');
  check(n({ file: f, duration: 9999, visualEnvelope: env1, chromaVersion: CV, analysisFailedV: CV }) === 'done', 'needOf: done comes before failed and too-long');
  check(n({ file: f, duration: 100, analysisFailedV: CV }) === 'failed', 'needOf: marked → failed');
  check(n({ file: f, duration: 9999, analysisFailedV: CV }) === 'failed', 'needOf: failed comes before too-long');
  const r = n({ file: f, duration: 100, analysisFailedV: CV }, true);
  check(typeof r === 'object' && r.envelope && r.key && !r.probe, 'needOf: a retry treats a marked track as eligible');
  check(n({ file: f, duration: 9999, analysisFailedV: CV }, true) === 'too-long', 'needOf: a retry still skips a too-long track');
  check(n({ file: f, duration: 100, analysisFailedV: CV - 1 }) !== 'failed', 'needOf: a mark from another version does not count');
  check(n({ file: f, duration: 721 }) === 'too-long', 'needOf: longer than the cap → too-long');
  check(n({ file: { size: 100 * MIB + 1 }, duration: 100 }) === 'too-long', 'needOf: bigger than the cap → too-long');
  const p = n({ file: f, duration: 0 });
  check(typeof p === 'object' && p.probe && p.envelope && p.key, 'needOf: unknown duration → probe');
  const k = n({ file: f, duration: 100, bandEnvelope: env1 });
  check(typeof k === 'object' && !k.envelope && k.key, 'needOf: an enveloped track needs only the key');
  const e = n({ file: f, duration: 100, chromaVersion: CV, bandEnvelope: { bass: { length: 0 } } });
  check(typeof e === 'object' && e.envelope && !e.key, 'needOf: an empty envelope is no envelope');
  const old = n({ file: f, duration: 100, visualEnvelope: env1, chromaVersion: CV - 1 });
  check(typeof old === 'object' && old.key && !old.envelope, 'needOf: key data from another version is redone');
  check(hasEnvelope({ id: 'a', name: 'a', visualEnvelope: env1 }) && hasEnvelope({ id: 'a', name: 'a', bandEnvelope: env1 }) && !hasEnvelope({ id: 'a', name: 'a', bandEnvelope: null }), 'hasEnvelope: either field');
}

{
  // holdFor: every step × mobile/desktop × the situations.
  const pb = (currentTime: number, duration = 100, extra: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({ paused: false, duration, currentTime, playbackRate: RATE, starting: false, ...extra });
  const steps = ['slice', 'native', 'flush'] as const;
  let ok = true;
  const bad: string[] = [];
  const expect = (got: unknown, want: unknown, what: string) => { if (got !== want) { ok = false; bad.push(`${what}: ${String(got)} ≠ ${String(want)}`); } };
  for (const mobile of [true, false]) {
    for (const step of steps) {
      const tag = `${step}/${mobile ? 'mobile' : 'desktop'}`;
      expect(holdFor(null, step, mobile), null, `${tag} null`);
      expect(holdFor(pb(50, 100, { starting: true, paused: true }), step, mobile), 'starting', `${tag} starting (paused)`);
      expect(holdFor(pb(50, 100, { starting: true }), step, mobile), 'starting', `${tag} starting`);
      expect(holdFor(pb(50, 100, { paused: true }), step, mobile), null, `${tag} paused`);
      expect(holdFor(pb(0, NaN), step, mobile), 'loading', `${tag} loading NaN`);
      expect(holdFor(pb(0, 0), step, mobile), 'loading', `${tag} loading 0`);
      expect(holdFor(pb(96), step, mobile), 'end', `${tag} last 5 s`);
      expect(holdFor(pb(1), step, mobile), 'start', `${tag} first 2 s`);
      // left ≈ 15.3 s wall
      expect(holdFor(pb(85), step, mobile), step === 'native' && mobile ? 'end' : null, `${tag} 15 s left`);
      // left ≈ 8.1 s wall
      expect(holdFor(pb(92), step, mobile), step === 'slice' ? null : 'end', `${tag} 8 s left`);
      // left ≈ 25.5 s wall
      expect(holdFor(pb(75), step, mobile), null, `${tag} 25 s left`);
      expect(holdFor(pb(75), step, mobile, 30), step === 'native' ? 'end' : null, `${tag} nativeLeftS 30`);
    }
  }
  // 9.9 s left at rate 1 (10.08 s at the 432 rate): a rate of 0 counts as 1.
  expect(holdFor(pb(90.1, 100, { playbackRate: 0 }), 'native', false), 'end', 'rate 0 counts as 1');
  expect(holdFor(pb(90.1), 'native', false), null, 'wall seconds use the 432 rate');
  check(ok, `holdFor table (${bad.slice(0, 5).join('; ')})`);
}

{
  check(idleAfter(5, 0.25) === 15 && idleAfter(8, 0.5) === 8 && idleAfter(123, 1) === 0 && idleAfter(0, 0.25) === 0, 'idleAfter: 5@.25 → 15, 8@.5 → 8, duty 1 → 0');
  const c = (m: boolean, dm?: number) => capsFor(m, dm);
  const eq = (a: Caps, s: number, b: number) => a.seconds === s && a.bytes === b * MIB;
  check(eq(c(true), 720, 100) && eq(c(false), 1800, 1024), 'capsFor: deviceMemory missing → by mobile alone');
  check(eq(c(true, 0), 720, 100) && eq(c(false, -1), 1800, 1024), 'capsFor: deviceMemory ≤ 0 → by mobile alone');
  check(eq(c(true, 0.5), 300, 40) && eq(c(false, 0.5), 300, 40) && eq(c(true, 2), 300, 40) && eq(c(false, 2), 300, 40), 'capsFor: ≤ 2 GB → 5 min / 40 MiB');
  check(eq(c(true, 3), 480, 60) && eq(c(false, 4), 480, 60) && eq(c(true, 4), 480, 60), 'capsFor: ≤ 4 GB → 8 min / 60 MiB');
  check(eq(c(true, 8), 720, 100) && eq(c(false, 8), 1800, 1024), 'capsFor: 8 GB → 12 min / 100 MiB on a phone, 30 min / 1 GiB on desktop');
  check(projectedBytes(100, 1000) === 1000 + 100 * (176_400 + 32_000), 'projectedBytes: file + seconds × (PCM + one render)');
  check(heapTooFull({ used: 2e9, limit: 4e9 }, 0.5e9) && !heapTooFull({ used: 2e9, limit: 4e9 }, 0.3e9) && !heapTooFull(null, 1e12), 'heapTooFull: > 60 % of the limit; null is open');
  check(markerValue('a:b') === `${CV}:a:b` && markerId(markerValue('a:b')) === 'a:b', 'markerValue/markerId round trip (an id may hold a colon)');
  check(markerId(`${CV + 1}:abc`) === null && markerId('abc') === null && markerId(null) === null && markerId(`${CV}:`) === null, 'markerId: another version, no version, null or no id → null');
  check(ANALYSE_INFLIGHT_KEY === 'aetheria.analyse.inflight.v1', 'the crash marker key');
  check(PASS_IDLE.phase === 'idle' && PASS_IDLE.done === 0 && DEFAULT_TUNING.flushMs === 60_000 && DEFAULT_TUNING.duty === null, 'PASS_IDLE and DEFAULT_TUNING');
}

{
  // countAnalysable
  const caps: Caps = { seconds: 720, bytes: 100 * MIB };
  const f = { size: 1000 };
  const lib: PassSong[] = [
    { id: 'a', name: 'a', file: f, duration: 240 },
    { id: 'b', name: 'b', file: f, duration: 0 },
    { id: 'c', name: 'c', file: f, duration: 100, analysisFailedV: CV },
    { id: 'd', name: 'd', file: f, duration: 900 },
    { id: 'e', name: 'e', file: f, duration: 100, visualEnvelope: { bass: { length: 2 } }, chromaVersion: CV },
    { id: 'f', name: 'f', duration: 100 },
    { id: 'g', name: 'g', file: f, duration: 800, analysisFailedV: CV },
  ];
  const c = countAnalysable(lib, caps);
  check(c.todo === 2 && c.todoSeconds === 240 + 180, `countAnalysable: todo 2, unknown duration counts 180 s (saw ${c.todo}, ${c.todoSeconds})`);
  check(c.failed === 1 && c.failedSeconds === 100, `countAnalysable: failed 1, 100 s (saw ${c.failed}, ${c.failedSeconds})`);
  check(c.tooLong === 2, `countAnalysable: too long 2, a marked too-long track included (saw ${c.tooLong})`);
}

{
  // The copy helpers (§9).
  check(passEta(0.4) === 'under a minute' && passEta(1) === 'about 1 min' && passEta(2.6) === 'about 3 min' && passEta(NaN) === 'under a minute', 'passEta');
  check(Math.abs(passEtaMinutes(600, true) - 10 * 5 / 60) < 1e-12 && Math.abs(passEtaMinutes(600, false) - 0.1) < 1e-12, 'passEtaMinutes: 5 s (phone) / 0.6 s (desktop) per audio minute');
  const plan = (p: Partial<PassPlan>): PassPlan => ({ total: 3, seconds: 600, playingFirst: false, retry: false, crashSkipped: 0, ...p });
  check(passStartText(plan({}), 2, false) === 'Analysing 3 tracks: about 2 min. You can keep listening.', `start text, desktop (${passStartText(plan({}), 2, false)})`);
  check(passStartText(plan({ playingFirst: true }), 0.5, true) === 'Analysing 3 tracks, the playing one first: under a minute. You can keep listening; it pauses while the screen is off.', 'start text, playing first, phone');
  check(passStartText(plan({ total: 1 }), 0.5, false) === 'Analysing 1 track: under a minute. You can keep listening.', 'start text, one track');
  check(passStartText(plan({ retry: true, total: 2 }), 0.2, true) === "Trying 2 tracks that couldn't be read again: under a minute.", 'start text, retry (n = the failed count)');
  check(passStartText(plan({ retry: true, total: 1 }), 0.2, true) === "Trying 1 track that couldn't be read again: under a minute.", 'start text, retry of one');
  check(passStartText(plan({ total: 0 }), 0, false) === 'Nothing to analyse right now.', 'start text, empty plan');
  check(passStartText(plan({ total: 2, crashSkipped: 1 }), 0.5, false).endsWith(' Skipped 1 track: the app closed while it was being analysed.'), 'start text, the crash note');
  check(passStartText(plan({ total: 2, crashSkipped: 2 }), 0.5, false).endsWith(' Skipped 2 tracks: the app closed while they were being analysed.'), 'start text, the crash note (plural)');
  const sum = (s: Partial<PassSummary>): PassSummary => ({ outcome: 'finished', analysed: 3, envelopes: 3, keys: 3, failed: 0, tooLong: 0, crashSkipped: 0, ms: 30_000, ...s });
  check(passEndText(sum({})) === 'Analysed 3 tracks in under a minute. The visuals now follow the music on them.', `end text (${passEndText(sum({}))})`);
  check(passEndText(sum({ analysed: 1, envelopes: 1, ms: 180_000 })) === 'Analysed 1 track in 3 min. The visuals now follow the music on it.', 'end text, one track, minutes');
  check(passEndText(sum({ envelopes: 2, failed: 2, tooLong: 1 })) === "Analysed 3 tracks in under a minute. The visuals now follow the music on 2 of them. 2 couldn't be read. 1 is too long for this device.", 'end text, some of them, failed, too long');
  check(passEndText(sum({ envelopes: 0, tooLong: 2 })) === 'Analysed 3 tracks in under a minute. 2 are too long for this device.', 'end text, no envelopes, plural too long');
  check(passEndText(sum({ analysed: 0, envelopes: 0, failed: 1 })) === "No track could be analysed. 1 couldn't be read.", 'end text, k = 0');
  check(passEndText(sum({ outcome: 'stopped', reason: 'user', analysed: 2 })) === 'Stopped after 2 tracks; they are kept. Tap Analyse tracks to do the rest.', 'end text, stopped');
  check(passEndText(sum({ outcome: 'stopped', reason: 'user', analysed: 0 })) === 'Stopped. Nothing was analysed yet.', 'end text, stopped at once');
  check(passEndText(sum({ outcome: 'error', reason: 'unreadable', analysed: 0 })) === 'Analyse tracks stopped: no track could be read on this device. Nothing was marked; try again later.', 'end text, unreadable');
  check(passEndText(sum({ outcome: 'error', reason: 'exception', analysed: 1 })) === 'Analyse tracks stopped with an error after 1 track; they are kept.', 'end text, exception');
  check(passEndText(sum({ outcome: 'stopped', reason: 'clear' })) === null && passEndText(sum({ outcome: 'stopped', reason: 'unmount' })) === null && passEndText(sum({ outcome: 'stopped', reason: 'reload' })) === null, 'end text: none for clear, unmount, reload');
  const counts = (c: Partial<ReturnType<typeof countAnalysable>>) => ({ todo: 0, todoSeconds: 0, failed: 0, failedSeconds: 0, tooLong: 0, ...c });
  const o = { deepScan: false, restoring: false, mobile: false };
  const bt = (p: Partial<PassProgress>, c: Partial<ReturnType<typeof countAnalysable>>, oo = o) => passButtonText({ ...PASS_IDLE, ...p }, counts(c), oo);
  check(bt({}, { todo: 3, todoSeconds: 600 }).sub === '3 to analyse · under a minute' && !bt({}, { todo: 3 }).blocked && bt({}, { todo: 3 }).title === 'Analyse tracks', 'button: idle with work');
  check(bt({}, { todo: 3, todoSeconds: 3600 }, { ...o, mobile: true }).sub === '3 to analyse · about 5 min', 'button: idle, phone ETA');
  check(bt({}, { failed: 1 }).sub === "1 couldn't be read · tap to try again", 'button: failed');
  check(bt({}, { tooLong: 2 }).sub === 'All analysed · 2 too long for this device', 'button: too long');
  check(bt({}, {}).sub === 'All tracks analysed', 'button: all done');
  const ds = bt({}, { todo: 3 }, { ...o, deepScan: true });
  check(ds.blocked && ds.sub === 'Unavailable while Deep Scan runs', 'button: blocked by Deep Scan');
  const rs = bt({}, { todo: 3 }, { ...o, restoring: true });
  check(rs.blocked && rs.sub === 'Your library is loading', 'button: blocked by the restore');
  const run = bt({ phase: 'running', done: 2, total: 5, etaMin: 3 }, {}, { ...o, deepScan: true, restoring: true });
  check(run.title === 'Analysing 2 of 5' && run.sub === 'about 3 min left · tap to stop' && !run.blocked, 'button: running is never blocked');
  check(bt({ phase: 'holding', hold: 'end', done: 1, total: 5 }, {}).sub === 'Pausing around the track change · tap to stop', 'button: holding near a track change');
  check(bt({ phase: 'holding', hold: 'starting', done: 1, total: 5 }, {}).sub === 'Pausing around the track change · tap to stop', 'button: holding while a track starts');
  check(bt({ phase: 'holding', hold: 'memory', done: 1, total: 5 }, {}).sub === 'Waiting for memory to free up · tap to stop', 'button: holding for memory');
  check(bt({ phase: 'parked', done: 1, total: 5 }, {}).sub === 'Paused while the screen is off', 'button: parked');
  const st = bt({ phase: 'stopping', done: 1, total: 5 }, {});
  check(st.title === 'Stopping…' && st.sub === 'Finishing the current step', 'button: stopping');
}

// ---------------------------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------------------------

const twenty = () => Array.from({ length: 20 }, (_, i) => song(`t${String(i).padStart(2, '0')}`));

async function timingRun(mobile: boolean): Promise<void> {
  const tag = mobile ? 'mobile' : 'desktop';
  const w = makeWorld({ songs: twenty(), mobile, player: { trackS: 180 } });
  const { summary, plan } = await runPass(w);
  check(summary?.outcome === 'finished' && summary.analysed === 20, `timing ${tag}: the run finishes with 20 analysed (saw ${JSON.stringify(summary)})`);
  check(plan.playingFirst && plan.total === 20, `timing ${tag}: the plan puts the playing track first`);
  const margin = mobile ? 20 : 10;
  const natives = w.records.filter(isNative);
  const badStart = natives.filter((r) => (r.left !== null && r.left <= margin) || (r.into !== null && r.into < 2));
  check(natives.length > 0 && badStart.length === 0, `timing ${tag}: no native step starts with ≤ ${margin} s left or < 2 s in (${badStart.length} did, first ${JSON.stringify(badStart[0])})`);
  const badEnd = w.records.filter((r) => (isNative(r) || r.kind === 'flush') && r.leftEnd !== null && r.leftEnd <= 5);
  check(badEnd.length === 0, `timing ${tag}: every native step and flush ends with > 5 s left (${badEnd.length} did not)`);
  const badSlice = w.records.filter((r) => r.kind === 'slice' && r.left !== null && r.left <= 5);
  check(w.records.some((r) => r.kind === 'slice') && badSlice.length === 0, `timing ${tag}: no slice runs with ≤ 5 s left (${badSlice.length} did)`);
  const flushes = w.records.filter((r) => r.kind === 'flush');
  const playingAt = (t: number) => w.order[w.player!.index(t)]?.id;
  const batch = flushes.slice(0, -1).filter((r) => !(r.ids && r.ids.length === 1 && r.ids[0] === playingAt(r.at)));
  let gapsOk = true;
  for (let i = 1; i < batch.length; i++) if (batch[i].at - batch[i - 1].at < 60_000) gapsOk = false;
  check(batch.length >= 2 && gapsOk, `timing ${tag}: batch flushes are ≥ 60 s apart (${batch.length} batches: ${batch.map((r) => Math.round(r.at / 1000)).join(',')} s)`);
  check(flushes.every((r) => r.left === null || r.left > 10), `timing ${tag}: no flush starts with ≤ 10 s left`);
  check(w.applies.length > 0 && [...w.applies[0].patches.keys()].join() === 't00', `timing ${tag}: the playing track's result is applied before any other (first apply: ${[...(w.applies[0]?.patches.keys() ?? [])].join()})`);
  let fourBands = true;
  for (const s of w.library) {
    const bands = recordsOf(w, s.id, 'envelope').map((r) => r.band).join();
    if (bands !== '0,1,2,3') fourBands = false;
  }
  check(fourBands, 'timing: every enveloped track has four envelope records, bands 0-3');
  check(w.library.every((s) => s.chromaVersion === CV && hasEnvelope(s)), `timing ${tag}: every track ends with key data and a visual envelope`);
  check(w.order.every((s) => s.chromaVersion === CV && hasEnvelope(s)), `timing ${tag}: the play order holds them too`);
  check(w.markerValue === null, `timing ${tag}: the marker is clear at the end`);
}

async function main(): Promise<void> {
  await timingRun(true);
  await timingRun(false);

  // Slices hold in the last 5 s: a key step longer than the native margin crosses the playing track's end.
  {
    const w = makeWorld({ songs: [song('a'), song('b')], mobile: true, player: { trackS: 60 }, slices: (id) => (id === 'a' ? 3000 : 140) });
    const { summary } = await runPass(w);
    const slices = recordsOf(w, 'a', 'slice');
    const endT = w.player!.swaps[0]?.t ?? Infinity;
    const crossed = slices.some((r) => r.at > endT);
    const bad = slices.filter((r) => r.left !== null && r.left <= 5);
    check(summary?.analysed === 2 && crossed, `slices: the long key step runs past the track change (${slices.length} slices; crossed ${crossed})`);
    check(bad.length === 0, `slices: none runs in the last 5 s of the playing track (${bad.length} did; first left ${bad[0]?.left?.toFixed(2)})`);
    check(w.progress.some((x) => x.p.phase === 'holding' && x.p.hold === 'end'), 'slices: the end hold shows as holding/end');
  }

  // The key step's FIRST slice is gated too: here the decode (14 s, started 2 s in) and its idle (42 s) end in
  // the playing track's last 5 s, so an ungated key step would start there.
  {
    const w = makeWorld({ songs: [song('a', { visualEnvelope: { bass: { length: 3 } } }), song('b')], mobile: true, player: { trackS: 60 }, decodeMs: (id) => (id === 'a' ? 14_000 : 2000) });
    const { summary } = await runPass(w);
    const first = recordsOf(w, 'a', 'slice')[0];
    const swapT = w.player!.swaps[0]?.t ?? 0;
    check(summary?.analysed === 2 && !!first && (first.left === null || first.left > 5) && first.at > swapT, `slices: the first slice of a key step waits for the gate (left ${first?.left?.toFixed(2)}; at ${first ? (first.at / 1000).toFixed(1) : '-'} s, swap ${(swapT / 1000).toFixed(1)} s)`);
  }

  // 'starting': no native step while playTrack decodes (also while paused); the 60 s latch.
  {
    const w = makeWorld({ songs: Array.from({ length: 6 }, (_, i) => song(`s${i}`)), mobile: true, player: { trackS: 60, startingMs: (n) => (n === 1 ? 30_000 : 0) } });
    await runPass(w);
    const win = w.player!.startingWindows[0];
    const inside = w.records.filter((r) => isNative(r) && win && r.at >= win.from && r.at < win.to);
    check(!!win && inside.length === 0, `starting: no native step starts while a track is starting (${inside.length} did)`);
    const slicesInside = w.records.filter((r) => r.kind === 'slice' && win && r.at > win.from + 1 && r.at < win.to);
    check(slicesInside.length === 0, `starting: no slice either (${slicesInside.length})`);
    check(w.progress.some((x) => x.p.phase === 'holding' && x.p.hold === 'starting'), 'starting: shows as holding/starting');
  }
  {
    // Stuck 'starting' for 200 s: after 60 s the latch lets steps through; once false, a new window holds again.
    const w = makeWorld({ songs: Array.from({ length: 30 }, (_, i) => song(`l${i}`)), mobile: false, player: { trackS: 120, startingAt0Ms: 200_000, startingMs: (n) => (n === 1 ? 30_000 : 0) } });
    await runPass(w);
    const first = w.records.find(isNative);
    check(!!first && first.at >= 60_000 && first.at < 61_000, `latch: the first native step starts at 60 s (saw ${first ? (first.at / 1000).toFixed(2) : '-'} s)`);
    const during = w.records.filter((r) => isNative(r) && r.at >= 61_000 && r.at < 200_000);
    check(during.length > 0, `latch: steps go on through the stuck window (${during.length})`);
    const win2 = w.player!.startingWindows[1];
    const inside2 = w.records.filter((r) => isNative(r) && win2 && r.at >= win2.from && r.at < win2.to);
    check(!!win2 && inside2.length === 0 && w.records.some((r) => isNative(r) && r.at > (win2?.to ?? Infinity)), `latch: re-armed once starting was seen false (${inside2.length} inside the second window)`);
  }

  // Duty: idle ≈ 3 × work on a phone, 1 × on desktop; duty 1 never sleeps.
  for (const mobile of [true, false]) {
    const w = makeWorld({ songs: Array.from({ length: 5 }, (_, i) => song(`d${i}`)), mobile, player: null });
    await runPass(w);
    const work = w.records.filter((r) => r.kind === 'decode' || r.kind === 'envelope' || r.kind === 'slice').reduce((a, r) => a + r.ms, 0);
    const idle = w.sleeps.reduce((a, s) => a + s.ms, 0);
    const want = mobile ? 3 : 1;
    check(work > 0 && Math.abs(idle / work - want) <= 0.1 * want, `duty ${mobile ? 'mobile' : 'desktop'}: idle/work ≈ ${want} (saw ${(idle / work).toFixed(3)})`);
  }
  {
    const w = makeWorld({ songs: Array.from({ length: 4 }, (_, i) => song(`h${i}`)), mobile: false, player: null, hiddenAt0: true });
    const { summary } = await runPass(w);
    check(summary?.analysed === 4 && w.sleeps.length === 0, `duty 1 (a hidden desktop): pace never calls sleep (${w.sleeps.length} sleeps; analysed ${summary?.analysed})`);
    check(w.records.filter((r) => r.kind === 'slice').length > 0, 'hidden desktop: steps continue');
  }

  // The back-off: a decode 3× the median (from track 5 on) halves the duty for its idle.
  {
    const ids = Array.from({ length: 8 }, (_, i) => `b${i}`);
    const w = makeWorld({ songs: ids.map((id) => song(id)), mobile: true, player: null, decodeMs: (id) => (id === 'b5' ? 6000 : 2000) });
    await runPass(w);
    const dec = (id: string) => recordsOf(w, id, 'decode')[0];
    const idleAfterRec = (r: StepRecord | undefined) => (r ? w.sleeps.find((s) => s.at === r.at + r.ms)?.ms : undefined);
    const slow = dec('b5');
    check(slow?.slowed === true && idleAfterRec(slow) === 6000 * 7, `back-off: the slow decode is marked and its idle uses duty/2 (slowed ${slow?.slowed}, idle ${idleAfterRec(slow)})`);
    const normal = ids.filter((id) => id !== 'b5').map(dec);
    check(normal.every((r) => !r?.slowed) && idleAfterRec(dec('b6')) === 2000 * 3, 'back-off: a normal decode keeps the duty');
  }

  // Hidden on a phone: park, drop the in-flight decode, redo the track; one flush at most; marker clear.
  {
    const w = makeWorld({ songs: ['a', 'b', 'c', 'd'].map((id) => song(id)), mobile: true, player: null });
    let hideAt = -1, showAt = -1, markerWhileParked: string | null | undefined;
    const origDecode = w.env.decode;
    w.env.decode = (bytes) => {
      const id = (bytes as unknown as { id: string }).id;
      if (id === 'b' && hideAt < 0) {
        hideAt = w.clock.t + 1000;
        showAt = hideAt + 30_000;
        w.at(hideAt, () => w.hide());
        w.at(hideAt + 10_000, () => { markerWhileParked = w.markerValue; });
        w.at(showAt, () => w.show());
      }
      return origDecode(bytes);
    };
    const { summary } = await runPass(w);
    const startedHidden = w.records.filter((r) => r.at > hideAt && r.at < showAt && r.kind !== 'flush');
    check(hideAt > 0 && startedHidden.length === 0, `hidden (decode in flight): no step starts until shown (${startedHidden.length} did)`);
    check(recordsOf(w, 'b', 'decode').length === 2 && recordsOf(w, 'b', 'decode')[1].at >= showAt, 'hidden: the in-flight decode is dropped and the track redone after the show');
    const bApplied = firstApplyAt(w, 'b');
    check(bApplied === null || bApplied >= showAt, 'hidden: the dropped decode is never applied');
    check(w.records.filter((r) => r.kind === 'flush' && r.at >= hideAt && r.at < showAt).length <= 1, 'hidden: at most one flush at park');
    check(markerWhileParked === null, `hidden: the marker is clear while parked (saw ${markerWhileParked})`);
    check(w.progress.some((x) => x.p.phase === 'parked'), 'hidden: the phase shows parked');
    check(summary?.analysed === 4 && summary.failed === 0, `hidden: all four analysed, parking is not a failure (${JSON.stringify(summary)})`);
  }
  for (const where of ['envelope', 'key'] as const) {
    const w = makeWorld({ songs: ['a', 'b', 'c'].map((id) => song(id)), mobile: true, player: null });
    let hideAt = -1, showAt = -1;
    if (where === 'envelope') {
      const orig = w.env.envelope;
      w.env.envelope = (d, beforeBand) => orig(d, async (band) => {
        await beforeBand(band);
        if (d.id === 'b' && band === 1 && hideAt < 0) {
          hideAt = w.clock.t + 200;
          showAt = hideAt + 20_000;
          w.at(hideAt, () => w.hide());
          w.at(showAt, () => w.show());
        }
      });
    } else {
      const orig = w.env.key;
      w.env.key = (d, ko) => orig(d, {
        ...ko,
        yieldFn: async (ms) => {
          if (d.id === 'b' && hideAt < 0) {
            hideAt = w.clock.t;
            showAt = hideAt + 20_000;
            w.hide();
            w.at(showAt, () => w.show());
          }
          return ko.yieldFn(ms);
        },
      });
    }
    const { summary } = await runPass(w);
    const startedHidden = w.records.filter((r) => r.at > hideAt && r.at < showAt && r.kind !== 'flush');
    check(hideAt > 0 && startedHidden.length === 0, `hidden (mid-${where}): no step starts until shown (${startedHidden.length} did, first ${startedHidden[0]?.kind} at ${startedHidden[0] ? ((startedHidden[0].at - hideAt) / 1000).toFixed(1) : '-'} s)`);
    if (where === 'envelope') {
      const bBands = recordsOf(w, 'b', 'envelope');
      check(bBands.filter((r) => r.at < hideAt).map((r) => r.band).join() === '0,1' && bBands.filter((r) => r.at >= showAt).map((r) => r.band).join() === '0,1,2,3', `hidden mid-envelope: parks at the next band, then redoes the track (${bBands.map((r) => r.band).join()})`);
    }
    check(summary?.analysed === 3, `hidden mid-${where}: everything is analysed after the show`);
  }

  // Failures: three attempts, then the mark; a probe of 0 is a failure; parks are not attempts.
  {
    const w = makeWorld({ songs: ['a', 'b', 'c', 'd'].map((id) => song(id)), mobile: false, player: null, decodeThrows: (id) => id === 'c' });
    const { summary } = await runPass(w);
    check(recordsOf(w, 'c', 'decode').length === 3, `failure: three attempts (${recordsOf(w, 'c', 'decode').length})`);
    const cPatch = w.applies.map((a) => a.patches.get('c')).find(Boolean);
    check(!!cPatch && cPatch.analysisFailedV === CV && cPatch.chromaVersion === undefined && libSong(w, 'c')?.analysisFailedV === CV, 'failure: then analysisFailedV, and no key data');
    check(summary?.failed === 1 && summary.analysed === 3 && summary.outcome === 'finished', `failure: counted (${JSON.stringify(summary)})`);
  }
  {
    const w = makeWorld({ songs: [song('a'), song('z', { duration: 0 }), song('c')], mobile: false, player: null, probe: (s) => (s.id === 'z' ? 0 : 240) });
    const { summary } = await runPass(w);
    check(recordsOf(w, 'z', 'probe').length === 3 && recordsOf(w, 'z', 'decode').length === 0 && libSong(w, 'z')?.analysisFailedV === CV && summary?.failed === 1, 'failure: a probe of 0 counts, three times, then the mark');
  }
  {
    // b's decode is parked three times (a hide lands while it decodes); then it succeeds. Never marked.
    const w = makeWorld({ songs: ['a', 'b', 'c'].map((id) => song(id)), mobile: true, player: null });
    let parks = 0;
    const orig = w.env.decode;
    w.env.decode = (bytes) => {
      const id = (bytes as unknown as { id: string }).id;
      if (id === 'b' && parks < 3) {
        parks++;
        const h = w.clock.t + 500;
        w.at(h, () => w.hide());
        w.at(h + 5_000, () => w.show());
      }
      return orig(bytes);
    };
    const { summary } = await runPass(w);
    check(parks === 3 && recordsOf(w, 'b', 'decode').length === 4, `parks: b was parked three times (${parks}; ${recordsOf(w, 'b', 'decode').length} decodes)`);
    check(summary?.failed === 0 && summary.analysed === 3 && libSong(w, 'b')?.analysisFailedV === undefined && libSong(w, 'b')?.chromaVersion === CV, `parks are not attempts (${JSON.stringify(summary)})`);
  }
  {
    // A stop is not an attempt either: nothing is marked.
    const w = makeWorld({ songs: ['a', 'b', 'c'].map((id) => song(id)), mobile: false, player: null, decodeThrows: (id) => id === 'b' });
    const h = startPass(w.env);
    let s: PassSummary | null = null;
    h.done.then((x) => { s = x; });
    await drive(w, () => w.decodes.filter((d) => d.id === 'b').length === 2);
    h.stop('user');
    await drive(w, () => s !== null);
    check(s !== null && (s as PassSummary).failed === 0 && !appliedIds(w).some((id) => id === 'b'), 'a stop is not an attempt: nothing marked');
  }

  // Systematic failure (D16).
  {
    const w = makeWorld({ songs: ['a', 'b', 'c', 'd', 'e'].map((id) => song(id)), mobile: false, player: null, decodeThrows: () => true });
    const { summary } = await runPass(w);
    check(summary?.outcome === 'error' && summary.reason === 'unreadable', `systematic: all 5 failing → error/unreadable (${JSON.stringify(summary)})`);
    check(w.decodes.length === 5, `systematic: after exactly 5 attempts (${w.decodes.length})`);
    check(w.applies.every((a) => [...a.patches.values()].every((p) => p.analysisFailedV === undefined)), 'systematic: apply never carries analysisFailedV');
  }
  {
    const w = makeWorld({ songs: ['a', 'b'].map((id) => song(id)), mobile: false, player: null, decodeThrows: () => true });
    const { summary } = await runPass(w);
    check(summary?.outcome === 'finished' && summary.failed === 2 && libSong(w, 'a')?.analysisFailedV === CV && libSong(w, 'b')?.analysisFailedV === CV, `systematic: with only 2 tracks both get marked (${JSON.stringify(summary)})`);
  }
  {
    const ids = ['f1', 'f2', 'f3', 'ok', 'f4', 'f5', 'f6'];
    const w = makeWorld({ songs: ids.map((id) => song(id)), mobile: false, player: null, decodeThrows: (id) => id !== 'ok' });
    const { summary } = await runPass(w);
    check(summary?.outcome === 'finished' && summary.analysed === 1 && summary.failed === 6 && ids.filter((id) => id !== 'ok').every((id) => libSong(w, id)?.analysisFailedV === CV), `systematic: one success among 6 failing → normal marking (${JSON.stringify(summary)})`);
  }

  // Retry: a success clears the mark (an own property set to undefined).
  {
    const w = makeWorld({ songs: [song('r', { analysisFailedV: CV })], mobile: false, player: null, retryFailed: true });
    const { plan, summary } = await runPass(w);
    const p = w.applies.map((a) => a.patches.get('r')).find(Boolean);
    check(plan.retry && plan.total === 1, 'retry: the plan says so');
    check(!!p && 'analysisFailedV' in p && p.analysisFailedV === undefined && p.chromaVersion === CV, `retry: the patch carries analysisFailedV: undefined (${p ? Object.keys(p).join(',') : '-'})`);
    check(libSong(w, 'r')?.analysisFailedV === undefined && 'analysisFailedV' in (libSong(w, 'r') ?? {}) && summary?.analysed === 1, 'retry: after patchById the mark is gone');
  }

  // The crash guard.
  {
    const w = makeWorld({ songs: ['a', 'b', 'c'].map((id) => song(id)), mobile: false, player: null });
    await runPass(w);
    let ok = true;
    for (const id of ['a', 'b', 'c']) {
      const recs = w.records.filter((r) => r.id === id);
      const set = w.markerWrites.find((m) => m.v === markerValue(id));
      const cleared = w.markerWrites.find((m) => m.v === null && set && m.at >= set.at && w.markerWrites.indexOf(m) > w.markerWrites.indexOf(set));
      if (!set || !cleared || set.at > recs[0].at || cleared.at < recs[recs.length - 1].at + recs[recs.length - 1].ms) ok = false;
    }
    check(ok, 'crash guard: the marker is written before a track\'s first native step and cleared after it');
  }
  {
    const w = makeWorld({ songs: ['a', 'b', 'c'].map((id) => song(id)), mobile: false, player: null, marker: markerValue('b') });
    const h = startPass(w.env);
    const appliedBeforeLoop = w.applies.length;
    const markerAfterStart = w.markerValue;
    let s: PassSummary | null = null;
    h.done.then((x) => { s = x; });
    await drive(w, () => s !== null);
    check(appliedBeforeLoop === 1 && w.applies[0].patches.get('b')?.analysisFailedV === CV && w.applies[0].patches.size === 1, 'crash guard: a stale marker marks that track at once (one apply before the loop)');
    check(h.plan.crashSkipped === 1 && h.plan.total === 2 && !w.decodes.some((d) => d.id === 'b'), `crash guard: left out of the run (plan ${JSON.stringify(h.plan)})`);
    check(markerAfterStart === null, 'crash guard: the marker is cleared at start');
    check((s as PassSummary | null)?.crashSkipped === 1 && (s as PassSummary | null)?.failed === 1 && libSong(w, 'b')?.chromaVersion === undefined, 'crash guard: counted as failed and crash-skipped, with no key data');
  }
  {
    const done = song('d', { visualEnvelope: { bass: { length: 2 } }, chromaVersion: CV });
    const w = makeWorld({ songs: [song('a'), done], mobile: false, player: null, marker: markerValue('d') });
    const { plan } = await runPass(w);
    check(plan.crashSkipped === 0 && !w.applies.some((a) => a.patches.get('d')?.analysisFailedV !== undefined), 'crash guard: a marker for a done track is ignored');
    const w2 = makeWorld({ songs: [song('a')], mobile: false, player: null, marker: `${CV + 1}:a` });
    const r2 = await runPass(w2);
    check(r2.plan.crashSkipped === 0 && r2.summary?.analysed === 1 && w2.markerWrites[0]?.v === null, 'crash guard: a marker from another version is ignored, and cleared');
  }
  {
    const w = makeWorld({ songs: ['a', 'b'].map((id) => song(id)), mobile: false, player: null });
    const h = startPass(w.env);
    let s: PassSummary | null = null;
    h.done.then((x) => { s = x; });
    await drive(w, () => w.decodes.some((d) => d.id === 'b'));
    const before = w.markerValue;
    h.stop('user');
    check(before === markerValue('b') && w.markerValue === null, 'crash guard: stop() clears the marker at once');
    await drive(w, () => s !== null);
  }
  {
    // A reload or a closed tab (pagehide) is not a crash: the marker is cleared as the page goes.
    const w = makeWorld({ songs: ['a', 'b', 'c'].map((id) => song(id)), mobile: false, player: null });
    const h = startPass(w.env);
    let s: PassSummary | null = null;
    h.done.then((x) => { s = x; });
    await drive(w, () => w.decodes.some((d) => d.id === 'b'));
    const before = w.markerValue;
    w.pageHide();
    const after = w.markerValue;
    await drive(w, () => s !== null);
    check(before === markerValue('b') && after === null, `pagehide clears the marker (before ${before}, after ${after})`);
    check((s as PassSummary | null)?.analysed === 3 && w.pageHideCbs.size === 0, 'pagehide: the run goes on, and unsubscribes at its end');
  }

  // The heap gate (live readings) and a stale reading.
  {
    let reads = 0;
    const LIMIT = 4e9;
    const w = makeWorld({
      songs: ['a', 'b', 'c'].map((id) => song(id)), mobile: false, player: null,
      heap: (ww) => ({ used: (ww.markerValue === markerValue('b') ? 2.5e9 : 0.5e9) + (reads++ % 97) * 4096, limit: LIMIT }),
    });
    const { summary } = await runPass(w);
    const bRecs = w.records.filter((r) => r.id === 'b');
    const memHolds = w.sleeps.filter((x) => x.ms === PASS.HEAP_WAIT_MS);
    check(bRecs.length === 0 && memHolds.length === 3, `heap gate: holds 'memory' 3 × 5 s, then skips (b records ${bRecs.length}; memory waits ${memHolds.length})`);
    check(w.progress.some((x) => x.p.phase === 'holding' && x.p.hold === 'memory'), 'heap gate: shows holding/memory');
    check(summary?.tooLong === 1 && !appliedIds(w).includes('b') && summary.analysed === 2, `heap gate: counted too long, no patch, the next track proceeds (${JSON.stringify(summary)})`);
  }
  {
    // A reading that never moves across a decode (Android's bucketized, cached value) is never trusted.
    const w = makeWorld({ songs: ['a', 'b', 'c'].map((id) => song(id)), mobile: true, player: null, heap: () => ({ used: 3.9e9, limit: 4e9 }) });
    const { summary } = await runPass(w);
    check(summary?.analysed === 3 && summary.tooLong === 0 && !w.sleeps.some((x) => x.ms === PASS.HEAP_WAIT_MS), `stale heap: the gate stays open (${JSON.stringify(summary)})`);
  }

  // Durations (D15).
  {
    const w = makeWorld({ songs: [song('u', { duration: 0, trueS: 900 }), song('v', { duration: 0, trueS: 200 }), song('k')], mobile: true, player: null });
    const { summary } = await runPass(w);
    const pu = w.applies.map((a) => a.patches.get('u')).find(Boolean);
    check(!!pu && Object.keys(pu).join() === 'duration' && pu.duration === 900 && !w.decodes.some((d) => d.id === 'u'), `duration: a probe of 900 s (cap 720) gives { duration: 900 } only (${pu ? JSON.stringify(pu) : '-'})`);
    check(summary?.tooLong === 1 && libSong(w, 'u')?.duration === 900, 'duration: counted too long, and the next count sees the duration');
    const pv = w.applies.map((a) => a.patches.get('v')).find(Boolean);
    check(!!pv && pv.duration === 200 && pv.chromaVersion === CV && libSong(w, 'v')?.duration === 200, 'duration: an unknown duration is filled from the analysed track');
  }
  {
    const w = makeWorld({ songs: [song('w', { duration: 0, trueS: 200 }), song('x')], mobile: false, player: null });
    // The duration analyzer gets there first: by the flush, the live song has a duration.
    const origDecode = w.env.decode;
    w.env.decode = async (bytes) => {
      const d = await origDecode(bytes);
      if (d.id === 'w') w.library = w.library.map((s) => (s.id === 'w' ? { ...s, duration: 199 } : s));
      return d;
    };
    await runPass(w);
    const pw = w.applies.map((a) => a.patches.get('w')).find(Boolean);
    check(!!pw && !('duration' in pw) && pw.chromaVersion === CV && libSong(w, 'w')?.duration === 199, `duration: dropped at flush when the live song has one (${pw ? Object.keys(pw).join(',') : '-'})`);
  }

  // Stops.
  {
    const w = makeWorld({ songs: ['a', 'b', 'c', 'd'].map((id) => song(id)), mobile: false, player: null });
    const h = startPass(w.env);
    let s: PassSummary | null = null;
    h.done.then((x) => { s = x; });
    await drive(w, () => w.decodes.some((d) => d.id === 'c'));
    const n0 = w.applies.length;
    const ret = h.stop('user');
    const syncApplied = w.applies.length - n0;
    check(syncApplied === 1 && [...w.applies[w.applies.length - 1].patches.keys()].join() === 'a,b' && ret.size === 0, `stop('user') applies pending synchronously (${syncApplied} applies)`);
    const n1 = w.applies.length;
    await drive(w, () => s !== null);
    check(w.applies.length === n1 && (s as PassSummary | null)?.outcome === 'stopped' && (s as PassSummary | null)?.reason === 'user', 'after stop(\'user\'), apply is never called again (the in-flight decode lands into nothing)');
    check(h.stop('user').size === 0 && w.applies.length === n1, 'stop is idempotent');
  }
  {
    // The playing track's result is applied (a); the rest are pending; reload returns ALL of them.
    const w = makeWorld({ songs: ['p', 'q', 'r', 's'].map((id) => song(id)), mobile: false, player: { trackS: 400 } });
    const h = startPass(w.env);
    let s: PassSummary | null = null;
    h.done.then((x) => { s = x; });
    await drive(w, () => w.decodes.some((d) => d.id === 's'));
    const applied = appliedIds(w);
    const n0 = w.applies.length;
    const ret = h.stop('reload');
    await drive(w, () => s !== null);
    check(applied.join() === 'p', `reload: p was applied by its own flush (${applied.join()})`);
    check(['p', 'q', 'r'].every((id) => ret.has(id)) && ret.get('q')?.chromaVersion === CV && !ret.has('s'), `stop('reload') returns every result of the run, applied or not (${[...ret.keys()].join()})`);
    check(w.applies.length === n0 && (s as PassSummary | null)?.reason === 'reload', 'stop(\'reload\') applies nothing');
  }
  {
    const w = makeWorld({ songs: ['a', 'b', 'c'].map((id) => song(id)), mobile: false, player: null });
    const h = startPass(w.env);
    let s: PassSummary | null = null;
    h.done.then((x) => { s = x; });
    await drive(w, () => w.decodes.some((d) => d.id === 'c'));
    const ret = h.stop('clear');
    await drive(w, () => s !== null);
    check(ret.size === 0 && w.applies.length === 0 && (s as PassSummary | null)?.reason === 'clear', 'stop(\'clear\') drops everything');
  }
  {
    // Stale without a stop (a) during a pace sleep: no step starts afterwards; (b) while a decode is in flight
    // (a key-only track): the late decode is never applied, and nothing else starts.
    for (const when of ['pace', 'decode'] as const) {
      const songs = when === 'pace' ? ['a', 'b', 'c'].map((id) => song(id)) : ['a', 'b', 'c'].map((id) => song(id, { visualEnvelope: { bass: { length: 3 } } }));
      const w = makeWorld({ songs, mobile: false, player: null });
      let staleAt = -1;
      if (when === 'pace') {
        const orig = w.env.sleep;
        w.env.sleep = (ms) => {
          if (staleAt < 0 && w.records.some((r) => r.kind === 'decode' && r.id === 'b')) { staleAt = w.clock.t; w.alive = false; }
          return orig(ms);
        };
      } else {
        const orig = w.env.decode;
        w.env.decode = (bytes) => {
          const p = orig(bytes);
          if ((bytes as unknown as { id: string }).id === 'b') { staleAt = w.clock.t + 500; w.at(staleAt, () => { w.alive = false; }); }
          return p;
        };
      }
      const { summary, doneAt } = await runPass(w);
      const after = w.records.filter((r) => r.at > staleAt);
      check(staleAt > 0 && after.length === 0, `stale run (${when}): no step starts after alive() turns false (${after.length}: ${after.map((r) => r.kind).join(',')})`);
      check(!w.applies.some((a) => a.at >= staleAt) && summary?.outcome === 'stopped' && summary.reason === 'clear', `stale run (${when}): nothing applied afterwards; treated as clear (${JSON.stringify(summary)})`);
      if (when === 'decode') {
        // The late decode is dropped where it lands: the run ends there, without idling first (a stale run has no
        // stop to wake its sleeps).
        const dec = recordsOf(w, 'b', 'decode')[0];
        const landed = dec ? dec.at + dec.ms : -1;
        check(landed > 0 && doneAt >= landed && doneAt - landed <= 1, `stale run (decode): done settles where the late decode lands (${(doneAt - landed).toFixed(0)} ms later)`);
      }
    }
  }
  {
    // A stop during a pace sleep (and during a hold) settles done within 1 ms of virtual time.
    for (const where of ['pace', 'hold'] as const) {
      const w = makeWorld({ songs: ['a', 'b'].map((id) => song(id)), mobile: true, player: where === 'hold' ? { trackS: 30, startingAt0Ms: 50_000 } : null });
      const h = startPass(w.env);
      let s: PassSummary | null = null;
      h.done.then((x) => { s = x; });
      if (where === 'pace') await drive(w, () => w.sleeps.some((x) => x.ms > 1000));
      else await drive(w, () => w.clock.t > 5_000);
      const t = w.clock.t;
      h.stop('user');
      await drive(w, () => s !== null);
      check(s !== null && w.clock.t - t <= 1, `stop during a ${where} sleep settles at once (${(w.clock.t - t).toFixed(0)} ms of virtual time)`);
    }
  }

  // Library changes mid-run.
  {
    const w = makeWorld({ songs: ['a', 'b', 'c', 'd', 'e'].map((id) => song(id)), mobile: false, player: null });
    w.at(2_500, () => { w.library = [...w.library, song('n')]; });
    w.at(2_600, () => { w.library = w.library.filter((s) => s.id !== 'd'); w.order = w.order.filter((s) => s.id !== 'd'); });
    const { summary } = await runPass(w);
    check(libSong(w, 'n')?.chromaVersion === CV && w.decodes.some((x) => x.id === 'n'), 'library: an import mid-run is appended and done');
    check(!w.decodes.some((x) => x.id === 'd') && !w.library.some((s) => s.id === 'd'), 'library: a deleted id is never decoded (nor brought back)');
    check(summary?.analysed === 5, `library: the count follows (${JSON.stringify(summary)})`);
  }
  {
    const w = makeWorld({ songs: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => song(id)), mobile: false, player: { trackS: 400 } });
    let jumpAt = -1;
    w.at(9_000, () => { jumpAt = w.clock.t; w.player!.jump(w.clock.t, 4); });
    await runPass(w);
    const next = w.decodes.find((x) => x.at > jumpAt);
    check(jumpAt > 0 && next?.id === 'e', `library: a newly playing eligible track jumps to the front (next decode ${next?.id})`);
  }

  // Flush point (b): the playing track changes to one whose result is pending.
  {
    const w = makeWorld({ songs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => song(id)), mobile: false, player: { trackS: 40 }, tuning: { flushMs: 600_000 } });
    await runPass(w);
    const swapT = w.player!.swaps[0]?.t ?? Infinity;
    const flushes = w.records.filter((r) => r.kind === 'flush');
    // One apply of everything pending (b and whatever else is waiting), at the next yield or boundary.
    const sw = flushes.find((r) => r.at >= swapT && !!r.ids?.includes('b'));
    const last = flushes[flushes.length - 1];
    check(!!sw && sw !== last && sw.at - swapT < 10_000, `flush point (b): b's pending result is applied when b starts playing, before any later flush (${flushes.map((r) => `${(r.at / 1000).toFixed(1)}:${r.ids?.join('')}`).join(' ')}; swap ${(swapT / 1000).toFixed(1)})`);
    check(!flushes.some((r) => r.at < swapT && r.ids?.includes('b')), 'flush point (b): not applied before it plays (no batch due)');
  }

  // Reconcile at every batch flush.
  {
    let dropped = false;
    const w = makeWorld({
      songs: Array.from({ length: 16 }, (_, i) => song(`r${i}`)), mobile: true, player: null,
      orderPatches: (patches) => {
        if (dropped || patches.size < 2) return patches;
        dropped = true;
        const m = new Map(patches);
        m.delete([...patches.keys()][0]);
        return m;
      },
    });
    let victim = '';
    const orig = w.env.apply;
    w.env.apply = (patches) => { if (!dropped && patches.size >= 2) victim = [...patches.keys()][0]; orig(patches); };
    await runPass(w);
    const flushes = w.records.filter((r) => r.kind === 'flush');
    const firstBatch = flushes.findIndex((r) => r.ids?.includes(victim));
    const repair = flushes.findIndex((r, i) => i > firstBatch && r.ids?.includes(victim));
    check(dropped && victim !== '' && repair > firstBatch && repair < flushes.length - 1, `reconcile: a patch a list lost is repaired at the next batch flush, not only the final one (victim ${victim}; flush #${repair} of ${flushes.length})`);
    check(w.order.find((s) => s.id === victim)?.chromaVersion === CV, 'reconcile: the play order holds the result in the end');
  }

  // Too long: by duration, by bytes (never decoded) and by decoded duration (dropped).
  {
    const w = makeWorld({
      songs: [song('a'), song('long', { duration: 800 }), song('big', { file: { size: 200 * MIB } }), song('liar', { duration: 600, trueS: 800 })],
      mobile: true, player: null,
    });
    const { plan, summary } = await runPass(w);
    check(plan.total === 2 && !w.decodes.some((d) => d.id === 'long' || d.id === 'big'), `too long by duration or bytes: never decoded (plan ${plan.total})`);
    check(w.decodes.some((d) => d.id === 'liar') && !appliedIds(w).includes('liar') && summary?.tooLong === 1, `too long by decoded duration (> 1.1 × the cap): dropped, no patch (${JSON.stringify(summary)})`);
  }

  // Partial results: the envelope throws, the key works → the key is kept; the next attempt does only the envelope.
  {
    const w = makeWorld({ songs: [song('a'), song('p'), song('c')], mobile: false, player: null, envelopeThrows: (id, n) => id === 'p' && n === 1 });
    const { summary } = await runPass(w);
    check(w.keyCalls.filter((x) => x === 'p').length === 1 && w.envelopeCalls.filter((x) => x === 'p').length === 2, `partial: the key is computed once, the envelope twice (keys ${w.keyCalls.filter((x) => x === 'p').length}, envelopes ${w.envelopeCalls.filter((x) => x === 'p').length})`);
    check(libSong(w, 'p')?.chromaVersion === CV && hasEnvelope(libSong(w, 'p')!) && summary?.analysed === 3 && summary.failed === 0, 'partial: both parts end up applied');
  }

  // The plan.
  {
    const w1 = makeWorld({ songs: [song('a', { duration: 0 }), song('b', { duration: 100 })], mobile: false, player: null });
    const r1 = await runPass(w1);
    check(r1.plan.total === 2 && r1.plan.seconds === 180 + 100 && !r1.plan.playingFirst && !r1.plan.retry && r1.plan.crashSkipped === 0, `plan: nothing playing (${JSON.stringify(r1.plan)})`);
    const w2 = makeWorld({ songs: [song('a', { visualEnvelope: { bass: { length: 2 } }, chromaVersion: CV }), song('b')], mobile: false, player: { trackS: 300 } });
    const r2 = await runPass(w2);
    check(r2.plan.total === 1 && !r2.plan.playingFirst, `plan: the playing track already done → not first (${JSON.stringify(r2.plan)})`);
    const w3 = makeWorld({ songs: [song('a'), song('b')], mobile: false, player: { trackS: 300, startIndex: 1 } });
    const r3 = await runPass(w3);
    check(r3.plan.playingFirst && w3.decodes[0]?.id === 'b', 'plan: the playing track first');
    const w4 = makeWorld({ songs: [song('a', { analysisFailedV: CV }), song('b', { analysisFailedV: CV, duration: 0 })], mobile: false, player: null, retryFailed: true });
    const r4 = await runPass(w4);
    check(r4.plan.retry && r4.plan.total === 2 && r4.plan.seconds === 240 + 180, `plan: a retry (${JSON.stringify(r4.plan)})`);
    const w5 = makeWorld({ songs: [song('a', { visualEnvelope: { bass: { length: 2 } }, chromaVersion: CV })], mobile: false, player: null });
    const r5 = await runPass(w5);
    check(r5.plan.total === 0 && r5.summary?.outcome === 'finished' && r5.summary.analysed === 0, 'plan: an empty queue finishes at once');
  }

  // done never rejects, even when an observer or env call throws.
  {
    const w = makeWorld({ songs: [song('a'), song('b')], mobile: false, player: null });
    w.env.progress = () => { throw new Error('observer'); };
    w.env.onStep = () => { throw new Error('observer'); };
    const r = await runPass(w);
    check(r.summary?.outcome === 'finished' && r.summary.analysed === 2, 'observers that throw never break the run');
    const w2 = makeWorld({ songs: [song('a'), song('b')], mobile: false, player: null });
    const origLib = w2.env.library;
    let calls = 0;
    w2.env.library = () => { if (++calls > 6) throw new Error('boom'); return origLib(); };
    const r2 = await runPass(w2);
    check(r2.summary?.outcome === 'error' && r2.summary.reason === 'exception', `an unexpected throw ends the run as error/exception, and done resolves (${JSON.stringify(r2.summary)})`);
  }

  console.log(`analysePass: ${passed} checks passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.log('analysePass: the checks crashed:', err);
  process.exit(1);
});
