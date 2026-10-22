// Checks for utils/soundV2/layerSchedule.ts, plus the vendored files' pins.
// Run with: node utils/soundV2/layerSchedule.check.ts   (Node 22.18+ strips the types), or npm run check:sound
// Exits non-zero on any failure. Seeded (mulberry32): every number is reproducible.
//
// The load-bearing checks: a ParamTrack anchor never changes what an engine
// renders before the anchor's time — on a Blink-like engine that applies every
// call on its own (so its intermediate states are audible), on a Gecko-like
// engine that rounds event times to frames, and with the engine behind or
// ahead of the player's clock — and the mirror equals the engine after it. The
// engines below are written from the Web Audio spec, not from ParamTrack. Then:
// no anchor floor, the clock (spec §7.1's clock checks), the drone duty, the
// drone gate's points and the retune key.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_BOOST,
  ANCHOR_EPS_FRAMES,
  CLOCK_MARGIN_S,
  CLOCK_STALL_S,
  CLOCK_MAX_EXTRAP_S,
  ParamTrack,
  createAudioClock,
  NEW_DUTY,
  advanceDuty,
  droneGatePoints,
  voiceKey,
} from './layerSchedule.ts';
import type { Duty, ParamLike } from './layerSchedule.ts';
import { plan, BANDS } from './aetheria_sound_v2.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const SR = 48000;
const EPS = ANCHOR_EPS_FRAMES / SR;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- pins --
// The vendored files are byte-identical copies of the D: package at 832cb7e (README.md): SHA-256 of the
// LF-normalised text, so a CRLF checkout (core.autocrlf) still matches.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const pins: [string, string][] = [
    ['aetheria_sound_v2.ts', '6e89330c6a2d908b1179cb41cb4bca279c652e6eb859f9a8904b165d9a6e8711'],
    ['check_vectors.ts', 'aa75e9e7c93c7bb6c53f2dd2c10d10943c524f7a8ac0d8c014d2f465e32a3f95'],
    ['test_vectors.json', '1a68687e4187023584930c8224d79ad0399666395f0f05cc13c61110bfc2cff4'],
  ];
  for (const [f, sha] of pins) {
    const text = readFileSync(join(here, f), 'utf8').replace(/\r\n/g, '\n');
    const got = createHash('sha256').update(text, 'utf8').digest('hex');
    check(got === sha, `pin: ${f} is the vendored copy (sha256 ${got.slice(0, 12)}… vs ${sha.slice(0, 12)}…)`);
  }
}

check(near(MAX_BOOST, 3.981071705534972, 1e-12), 'MAX_BOOST is +12 dB');
check(ANCHOR_EPS_FRAMES === 1.5 && CLOCK_MARGIN_S === 0.02 && CLOCK_STALL_S === 0.025 && CLOCK_MAX_EXTRAP_S === 0.5,
  'the clock and anchor constants are as specified');

// ------------------------------------------------------- engine models --

interface EngEvent { type: 'set' | 'lin' | 'tgt'; t: number; v: number; tau: number; at: number }

/** The value at x of an automation timeline by the Web Audio spec, written without ParamTrack. A ramp after a glide
 *  starts where the glide is when the ramp was scheduled (the spec): no mirror can know that, so it is counted. */
function evalAt(events: readonly EngEvent[], init: number, x: number): number {
  let t0 = -Infinity, v0 = init;
  let g: EngEvent | null = null;
  const state = (t: number): number => (g ? g.v + (v0 - g.v) * Math.exp(-(t - t0) / g.tau) : v0);
  for (const e of events) {
    if (e.t > x) {
      if (e.type !== 'lin') return state(x);
      let s0 = t0, sv = v0;
      if (g) {
        s0 = Math.max(g.t, e.at);
        sv = state(s0);
      } else if (s0 === -Infinity) {
        s0 = e.at;
      }
      if (x < s0) return state(x);
      return e.t > s0 ? sv + (e.v - sv) * ((x - s0) / (e.t - s0)) : e.v;
    }
    if (e.type === 'tgt') {
      v0 = state(e.t);
      g = e;
    } else {
      v0 = e.v;
      g = null;
    }
    t0 = e.t;
  }
  return state(x);
}

/**
 * One AudioParam. Blink-like by default: double times, each call applied on
 * its own (onCall sees every intermediate state), an event of the same type at
 * the same time replaces the first such, and after a task the task's new
 * events before the render position move to it (Blink's
 * ClampNewEventsToCurrentTime). Gecko-like with `round`: every time, cancels
 * included, rounded to the nearest frame; nothing moved. cancelAndHoldAtTime
 * and the .value getter throw: the player must use neither.
 */
class Engine implements ParamLike {
  ev: EngEvent[] = [];
  fresh: EngEvent[] = [];
  init: number;
  round: boolean;
  now = 0; // the render position τ when calls land
  calls = 0;
  holds = 0;
  reads = 0;
  linAfterTgt = 0;
  onCall: (() => void) | null = null;

  constructor(init: number, round: boolean) {
    this.init = init;
    this.round = round;
  }

  private time(t: number): number {
    return this.round ? Math.round(t * SR) / SR : t;
  }

  private insert(type: EngEvent['type'], v: number, t: number, tau: number): void {
    this.calls++;
    const e: EngEvent = { type, t: this.time(t), v, tau, at: this.now };
    const same = this.ev.findIndex((x) => x.t === e.t && x.type === e.type);
    if (same >= 0) this.ev[same] = e;
    else {
      let i = this.ev.length;
      while (i > 0 && this.ev[i - 1].t > e.t) i--;
      this.ev.splice(i, 0, e);
    }
    const k = this.ev.indexOf(e);
    if (e.type === 'lin' && k > 0 && this.ev[k - 1].type === 'tgt') this.linAfterTgt++;
    this.fresh.push(e);
    this.onCall?.();
  }

  setValueAtTime(v: number, t: number): void { this.insert('set', v, t, 0); }
  linearRampToValueAtTime(v: number, t: number): void { this.insert('lin', v, t, 0); }
  setTargetAtTime(v: number, t: number, tau: number): void { this.insert('tgt', v, t, tau); }
  cancelScheduledValues(t: number): void {
    this.calls++;
    const c = this.time(t);
    this.ev = this.ev.filter((e) => e.t < c);
    this.fresh = this.fresh.filter((e) => e.t < c);
    this.onCall?.();
  }
  cancelAndHoldAtTime(): void {
    this.holds++;
    throw new Error('cancelAndHoldAtTime called');
  }
  get value(): number {
    this.reads++;
    throw new Error('AudioParam.value read');
  }

  /** The end of a task: Blink moves the task's new events before τ to τ (a stable sort); Gecko leaves them. */
  endTask(): void {
    if (!this.round) {
      for (const e of this.fresh) if (e.t < this.now) e.t = this.now;
      this.ev = this.ev.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
    }
    this.fresh = [];
  }

  snapshot(): EngEvent[] {
    return this.ev.map((e) => ({ ...e }));
  }

  valueAt(x: number): number {
    return evalAt(this.ev, this.init, x);
  }
}

// ------------------------------------------- ParamTrack: unit behaviour --

/** A param that only records the calls. */
function recorder(): ParamLike & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    setValueAtTime: (v: number, t: number) => log.push(`set ${v} @${t}`),
    linearRampToValueAtTime: (v: number, t: number) => log.push(`lin ${v} @${t}`),
    setTargetAtTime: (v: number, t: number, tau: number) => log.push(`tgt ${v} @${t} tau ${tau}`),
    cancelScheduledValues: (t: number) => log.push(`cancel @${t}`),
  };
}
const warnings: string[] = [];
const warn = (m: string): void => {
  warnings.push(m);
};

{
  // valueAt: the initial value before the first event; a set holds; a ramp runs from the previous event.
  const p = recorder();
  const tr = new ParamTrack(p, 0.3, SR, warn);
  check(tr.valueAt(5) === 0.3 && tr.events.length === 0, 'an empty track reads its initial value');
  tr.path(1, [[3, 1], [4, 0.5]]);
  check(p.log.join('; ') === `set 0.3 @1; cancel @${1 + EPS}; lin 1 @3; lin 0.5 @4`,
    `path on a constant: a step anchor, the cancel 1.5 frames on, then the ramps (${p.log.join('; ')})`);
  check(tr.valueAt(0.5) === 0.3 && tr.valueAt(1) === 0.3 && near(tr.valueAt(2), 0.65) && tr.valueAt(3) === 1
    && near(tr.valueAt(3.5), 0.75) && tr.valueAt(4) === 0.5 && tr.valueAt(99) === 0.5, 'set and lin evaluate by the spec');
  // An anchor inside a ramp: on the ramp's line, value first, cancel second.
  p.log.length = 0;
  const v = tr.anchor(2.5);
  check(near(v, 0.825) && p.log.length === 2 && p.log[0] === `lin ${v} @2.5` && p.log[1] === `cancel @${2.5 + EPS}`,
    `an anchor inside a ramp is a ramp to the value on its line, then the cancel (${p.log.join('; ')})`);
  check(near(tr.valueAt(2), 0.65) && near(tr.valueAt(2.5), 0.825) && near(tr.valueAt(3.5), 0.825) && tr.events.length === 2,
    'after the anchor the ramp up to it is unchanged and the value holds');
  // An anchor past every event: a step.
  p.log.length = 0;
  tr.anchor(10);
  check(p.log[0] === `set ${tr.valueAt(10)} @10`, 'an anchor past every event is a step');
}
{
  // Glides: exponential from the value at the start.
  const p = recorder();
  const tr = new ParamTrack(p, 274, SR, warn);
  tr.glide(10, 270, 3);
  check(p.log.join('; ') === `set 274 @10; cancel @${10 + EPS}; tgt 270 @10 tau 3`, `glide = step anchor + setTarget (${p.log.join('; ')})`);
  check(near(tr.valueAt(13), 270 + 4 / Math.E, 1e-9) && tr.valueAt(9) === 274, 'a glide decays from its start value (S6: 270 + 4/e at +3 s)');
  // A second glide at the same instant replaces the first (no warning) and starts from the same value.
  const w0 = warnings.length;
  tr.glide(10, 260, 3);
  check(warnings.length === w0 && tr.events.length === 2 && near(tr.valueAt(13), 260 + 14 / Math.E, 1e-9),
    'a second glide at the same time replaces the first');
  // An anchor inside the glide holds its value (a step); then a step and a later glide.
  const at12 = tr.valueAt(12);
  p.log.length = 0;
  tr.anchor(12);
  check(p.log[0] === `set ${at12} @12` && tr.valueAt(50) === at12 && warnings.length === w0, 'an anchor inside a glide is a step that freezes it');
  tr.stepAt(300, 20);
  tr.glide(30, 310, 1);
  check(tr.valueAt(25) === 300 && near(tr.valueAt(31), 310 - 10 / Math.E, 1e-9), 'steps and later glides chain');
}
{
  // dropFrom removes a pending step and keeps a started glide running (an anchor would freeze it: review AC-03).
  const p = recorder();
  const tr = new ParamTrack(p, 274, SR, warn);
  tr.glide(530, 270, 3); // setBeat(6) while open
  tr.stepAt(280, 532.5); // a retune's step at fAt
  p.log.length = 0;
  tr.dropFrom(Math.max(531.5, 532.5 - 1 / SR)); // the revert drops the pending step
  check(p.log.join('; ') === `cancel @${532.5 - 1 / SR}` && near(tr.valueAt(540), 270 + 4 * Math.exp(-10 / 3), 1e-9),
    `dropFrom cancels the pending step alone and the glide runs on (S27: 270.142696 at 540; ${p.log.join('; ')})`);
  p.log.length = 0;
  tr.dropFrom(600);
  check(p.log.length === 0, 'dropFrom with nothing at or after it makes no call');
  // A ramp running through the drop point would jump: it warns and anchors on the ramp's line instead.
  const g = new ParamTrack(recorder(), 0, SR, warn);
  g.path(0, [[1, 0], [3.5, 1]]);
  const w0 = warnings.length;
  g.dropFrom(2);
  check(warnings.length === w0 + 1 && near(g.valueAt(2), 0.4) && near(g.valueAt(1.5), 0.2) && near(g.valueAt(9), 0.4),
    'dropFrom through a ramp warns and anchors on its line instead');
}
{
  // stepAt and hasFuture.
  const p = recorder();
  const tr = new ParamTrack(p, 1, SR, warn);
  tr.stepAt(2, 5);
  const w0 = warnings.length;
  p.log.length = 0;
  tr.stepAt(3, 4);
  check(warnings.length === w0 + 1 && p.log.length === 0, 'stepAt before the last event warns and sends nothing');
  check(tr.hasFuture(4.9) && !tr.hasFuture(5), 'hasFuture: an event after t');
  tr.glide(6, 0, 1);
  p.log.length = 0;
  tr.stepAt(9, 6); // at a glide's start it would replace the glide's start step, and the glide would run on
  check(warnings.length === w0 + 2 && p.log.length === 0, 'stepAt at the start of a glide warns and sends nothing');
  const q = recorder();
  const tq = new ParamTrack(q, 0, SR, warn);
  tq.glide(1, 5, 1);
  q.log.length = 0;
  tq.path(1, [[2, 1]]); // a ramp straight after the glide would start wherever the engine is
  check(warnings.length === w0 + 3 && q.log.length === 0, 'path at the start of a glide warns and sends nothing');
  tq.anchor(1);
  check(warnings.length === w0 + 4 && near(tq.valueAt(2), 5 - 5 / Math.E, 1e-9), 'an anchor there warns: the glide keeps running');
}
{
  // Zero-length points: one that holds the value is skipped (a retune from a gate that is already shut builds
  // (now + 0 × 0.8, 0), as in S20 at 22 s); one that would step there refuses the whole path.
  const p = recorder();
  const tr = new ParamTrack(p, 0, SR, warn);
  const w0 = warnings.length;
  tr.path(22, [[22, 0], [23.02, 0], [25.52, 1]]);
  check(warnings.length === w0 && p.log.join('; ') === `set 0 @22; cancel @${22 + EPS}; lin 0 @23.02; lin 1 @25.52`,
    `a point at t holding the value is skipped (${p.log.join('; ')})`);
  p.log.length = 0;
  tr.path(30, [[31, 0.5], [31, 0.5], [32, 0]]);
  check(warnings.length === w0 && p.log.length === 4 && near(tr.valueAt(31.5), 0.25), 'a repeated point holding its value is skipped');
  p.log.length = 0;
  tr.path(40, [[40, 0.5]]);
  tr.path(40, [[41, 1], [41, 0.2]]);
  check(warnings.length === w0 + 2 && p.log.length === 0, 'a zero-length point that changes the value (a step) refuses the path');
  p.log.length = 0;
  tr.path(45, [[45, 0]]);
  check(warnings.length === w0 + 2 && p.log.length === 2 && p.log[0] === 'set 0 @45', 'a path of only a holding point is an anchor');
}
{
  // Bad values and times: one warning each, nothing scheduled.
  const p = recorder();
  const tr = new ParamTrack(p, 0, SR, warn);
  const w0 = warnings.length;
  tr.anchor(NaN);
  tr.anchor(-1);
  tr.path(Infinity, [[1, 1]]);
  tr.path(1, [[2, NaN]]);
  tr.path(1, [[2, 1], [2, 0.5]]);
  tr.path(1, [[0.5, 1]]);
  tr.glide(1, NaN, 3);
  tr.glide(1, 5, 0);
  tr.stepAt(Infinity, 3);
  tr.dropFrom(NaN);
  check(warnings.length === w0 + 10 && p.log.length === 0 && tr.events.length === 0,
    `bad values or times warn once each and send nothing (${warnings.length - w0} warnings, ${p.log.length} calls)`);
  let threw = 0;
  try { new ParamTrack(p, NaN, SR); } catch { threw++; }
  try { new ParamTrack(p, 0, 0); } catch { threw++; }
  check(threw === 2, 'a track needs a finite initial value and a positive sample rate');
}
{
  // No floor (review AC-02): an anchor at now deletes a pre-scheduled future anchor (a deferred rise), so a stop
  // issued before the deferral's time T* silences for good (S26 at the ParamTrack level).
  const e = new Engine(0, false);
  const tr = new ParamTrack(e, 0.8, SR, warn);
  tr.path(10, [[10.1, 0.8]]); // settled at 0.8
  tr.path(20, [[20.25, 0]]); // a fall
  tr.path(23, [[24.5, 0.9]]); // the deferred rise, pre-scheduled at T* = 23
  tr.path(21, [[21.1, 0]]); // Emergency Stop at 21
  check(tr.valueAt(30) === 0 && e.valueAt(30) === 0 && !tr.events.some((x) => x.t >= 23),
    'an anchor before a pre-scheduled one deletes it: the stop holds after T*');
  const tr2 = new ParamTrack(new Engine(0, false), 0.5, SR, warn);
  tr2.path(23, [[23.25, 0.8]]);
  tr2.path(21, [[21.25, 0]]); // dispose's 0.25 s fall
  check(tr2.valueAt(23.1) === 0 && tr2.valueAt(25) === 0, 'a dispose-like fall also deletes the deferred rise');
}
{
  // prune keeps every time ≥ before exact, a glide that started before it included.
  const tr = new ParamTrack(recorder(), 0, SR, warn);
  tr.path(0, [[1, 1]]);
  tr.glide(2, 0.2, 0.5);
  tr.path(4, [[5, 0.9], [6, 0.1]]);
  const probe = [2.5, 3, 4, 4.5, 5, 5.5, 6, 9];
  const before = probe.map((x) => tr.valueAt(x));
  tr.prune(2.5);
  check(tr.events.length === 5 && tr.events[0].type === 'set' && tr.events[0].t === 2,
    `prune keeps the glide and its start step (both at its time): ${tr.events.length} events`);
  tr.prune(3);
  const after = probe.map((x) => tr.valueAt(x));
  check(after.every((v, i) => near(v, before[i], 1e-12)), 'prune leaves every value at or after the prune point unchanged');
  tr.prune(4.5);
  check(tr.events.length === 3 && near(tr.valueAt(5.5), 0.5) && near(tr.valueAt(4.5), before[3], 1e-12),
    'prune inside a ramp keeps the ramp and its start');
}

// -------------------------------------------- against the engine models --

{
  // The reviewers' gate case (AC-01): opening 0 → 1 over [0.05, 2.55]; at T = 1.0 a close at the gate's rate.
  // With the engine ahead of the clock by L, Blink moves the anchor to τ (a step of the old slope × L) and Gecko
  // evaluates the new line at τ (|Δslope| × L); behind it (L ≤ 0) nothing moves at all.
  for (const round of [false, true]) {
    for (const L of [-0.02, 0, 0.01, 0.05, 0.3]) {
      const e = new Engine(0, round);
      const tr = new ParamTrack(e, 0, SR, warn);
      tr.path(0.025, [[0.05, 0], [2.55, 1]]);
      e.endTask();
      const T = 1.0, tau = T + L;
      e.now = tau;
      const before = e.valueAt(tau);
      tr.path(T, [[T + tr.valueAt(T) * 0.8, 0]]);
      e.endTask();
      const step = Math.abs(e.valueAt(tau) - before);
      const slack = round ? 1e-4 : 1e-9;
      const bound = L <= 0 ? slack : (round ? 1.65 : 0.4) * L + slack;
      check(step <= bound, `${round ? 'gecko' : 'blink'} L=${L * 1000} ms: a close while opening steps ${step.toExponential(3)} at τ (bound ${bound.toExponential(3)})`);
    }
  }
}
{
  // N3 (negative control): a ramp 1 → 0 over [0, 1]; a step at 0.6 inserted at engine time 0.5 holds the ramp's
  // START until 0.6 — the value jumps 0.5 → 1 — while ParamTrack's on-the-line anchor moves nothing.
  const e = new Engine(1, false);
  e.setValueAtTime(1, 0);
  e.linearRampToValueAtTime(0, 1);
  e.now = 0.5;
  e.setValueAtTime(0.4, 0.6);
  check(e.valueAt(0.5) === 1, `N3: a future step inside a ramp jumps back to the ramp's start (${e.valueAt(0.5)})`);
  const e2 = new Engine(1, false);
  const tr = new ParamTrack(e2, 1, SR, warn);
  tr.path(0, [[1, 0]]);
  e2.now = 0.5;
  tr.anchor(0.6);
  check(near(e2.valueAt(0.5), 0.5, 1e-12) && near(e2.valueAt(0.6), 0.4, 1e-12) && near(e2.valueAt(0.9), 0.4, 1e-12),
    'N3: ParamTrack anchors a future point inside a ramp on its line: nothing before it moves');
}
{
  // ANCHOR_EPS_FRAMES on Gecko: an anchor 0.6 of a frame past a frame boundary rounds up; with half a frame of
  // epsilon its cancel would round onto the same frame and delete it (the ramp would then restart from 0.05).
  const e = new Engine(0, true);
  const tr = new ParamTrack(e, 0, SR, warn);
  tr.path(0.025, [[0.05, 0], [2.55, 1]]);
  const T = 48000.6 / SR;
  tr.path(T, [[T + 0.8, 0]]);
  const err = Math.abs(tr.valueAt(1.2) - e.valueAt(1.2));
  check(err < 1e-4 && e.ev.length === 4, `gecko: an anchor 0.6 frame past a boundary survives its cancel (mirror error ${err.toExponential(2)})`);
}

interface RunStats { past: number; mirror: number; partial: number; calls: number; warnings: number }
type Kind = 'gain' | 'freq';

/**
 * One random op sequence (the player's patterns) through a ParamTrack on one
 * engine, behind the clock by L ≤ 0. Gains get anchors and paths from now or
 * from a future T* (the host's deferred rise), slopes ≤ 2/s; frequencies get
 * glides, retune steps ahead (silent), drops and "set at now". Returns the
 * worst numbers seen, as fractions of the param's scale.
 */
function runSequence(seed: number, kind: Kind, round: boolean, L: number): RunStats {
  const rand = mulberry32(seed);
  const init = kind === 'gain' ? 0 : 274;
  const scale = kind === 'gain' ? 1 : 300;
  const e = new Engine(init, round);
  const w0 = warnings.length;
  const tr = new ParamTrack(e, init, SR, warn);
  const stats: RunStats = { past: 0, mirror: 0, partial: 0, calls: 0, warnings: 0 };
  let now = 0.02;
  for (let op = 0; op < 60; op++) {
    // Mostly forward, sometimes the same instant (same-time replacement), sometimes long gaps.
    const r = rand();
    now += r < 0.15 ? 0 : r < 0.85 ? 0.001 + rand() * 0.8 : 1 + rand() * 4;
    const t = now, tau = now + L;
    e.now = tau;
    // 'move': anchor, path, glide (continuous at T); 'ahead': a change at or after T > now; 'step': a step at now.
    let T = t;
    let mode: 'move' | 'ahead' | 'step' = 'move';
    let run: () => void;
    if (kind === 'gain') {
      const c = rand();
      if (c < 0.12) {
        run = () => { tr.anchor(t); };
      } else {
        if (c > 0.85) T = t + 0.05 + rand() * 2;
        const n = 1 + Math.floor(rand() * 3);
        const pts: [number, number][] = [];
        let pt = T, pv = tr.valueAt(T);
        for (let k = 0; k < n; k++) {
          const nv = rand() < 0.3 ? (rand() < 0.5 ? 0 : 1) : rand();
          pt += Math.max(Math.abs(nv - pv) / 2, 0.002) + rand() * 0.5;
          pts.push([pt, nv]);
          pv = nv;
        }
        const at = T;
        run = () => tr.path(at, pts);
      }
    } else {
      const c = rand();
      const nv = 250 + rand() * 50;
      if (c < 0.45) {
        const tc = rand() < 0.5 ? 3 : 1;
        run = () => tr.glide(t, nv, tc);
      } else if (c < 0.75) {
        const last = tr.events.length ? tr.events[tr.events.length - 1].t : 0;
        T = Math.max(t, last) + 0.01 + rand() * 0.5;
        mode = 'ahead';
        const at = T;
        run = () => tr.stepAt(nv, at);
      } else if (c < 0.9) {
        T = t + rand() * 0.3;
        mode = 'ahead';
        const at = T;
        run = () => tr.dropFrom(at);
      } else {
        mode = 'step';
        run = () => {
          tr.dropFrom(t);
          tr.stepAt(nv, t);
        };
      }
    }
    const before = e.snapshot();
    const vBefore = evalAt(before, init, T);
    // Blink applies each call on its own: no intermediate state may jump at T (gains: nor one quantum later beyond
    // the 4/s bound of A2).
    e.onCall = round || mode !== 'move' ? null : () => {
      const xs = kind === 'gain' ? [T, T + 128 / SR] : [T];
      for (const x of xs) {
        const d = (Math.abs(e.valueAt(x) - vBefore) - (kind === 'gain' ? 4 * (x - T) : 0)) / scale;
        if (d > stats.partial) stats.partial = d;
      }
    };
    run();
    e.onCall = null;
    e.endTask();
    // Nothing the engine renders before the op's time may change (its own render position τ included).
    if (mode !== 'step') {
      const xs = [tau, (tau + T) / 2, T - 2 / SR];
      if (mode === 'move') xs.push(T);
      for (const x of xs) {
        if (x < tau || (round && Math.abs(x - T) < 1 / SR)) continue;
        const d = Math.abs(e.valueAt(x) - evalAt(before, init, x)) / scale;
        if (d > stats.past) stats.past = d;
      }
    }
    // Mirror = engine from now on (away from Gecko's rounded event times).
    const lastT = Math.max(t, tr.events.length ? tr.events[tr.events.length - 1].t : t);
    const xs: number[] = [];
    for (let k = 0; k <= 40; k++) xs.push(t + ((lastT + 2 - t) * k) / 40);
    for (const ev of tr.events) xs.push(ev.t - 1e-3, ev.t - 1e-4, ev.t, ev.t + 1e-4, ev.t + 1e-3);
    for (const x of xs) {
      if (x < t || (round && tr.events.some((ev) => Math.abs(ev.t - x) < 2 / SR))) continue;
      const d = Math.abs(tr.valueAt(x) - e.valueAt(x)) / scale;
      if (d > stats.mirror) stats.mirror = d;
    }
    if (rand() < 0.2) tr.prune(t - 1);
  }
  stats.calls = e.calls;
  stats.warnings = warnings.length - w0;
  check(e.holds === 0 && e.reads === 0 && e.linAfterTgt === 0,
    `seed ${seed} ${kind}: no cancelAndHoldAtTime, no .value read, never a ramp straight after a glide`);
  return stats;
}

{
  let runs = 0;
  for (const kind of ['gain', 'freq'] as Kind[]) {
    for (const round of [false, true]) {
      for (const L of [-0.02, 0]) {
        const worst: RunStats = { past: 0, mirror: 0, partial: 0, calls: 0, warnings: 0 };
        for (let seed = 1; seed <= 40; seed++) {
          const s = runSequence(seed * 7919 + (kind === 'gain' ? 0 : 1), kind, round, L);
          runs++;
          worst.past = Math.max(worst.past, s.past);
          worst.mirror = Math.max(worst.mirror, s.mirror);
          worst.partial = Math.max(worst.partial, s.partial);
          worst.calls += s.calls;
          worst.warnings += s.warnings;
        }
        const name = `${round ? 'gecko' : 'blink'} ${kind} L=${L * 1000} ms`;
        const tol = round ? 1e-4 : 1e-9;
        console.log(`  ${name.padEnd(22)} worst: past ${worst.past.toExponential(1)}, mirror ${worst.mirror.toExponential(1)}`
          + `${round ? '' : `, partial ${worst.partial.toExponential(1)}`} (${worst.calls} engine calls)`);
        check(worst.past <= tol, `${name}: nothing before an op's time changes (worst ${worst.past.toExponential(2)})`);
        check(worst.mirror <= tol, `${name}: mirror = engine after every op (worst ${worst.mirror.toExponential(2)})`);
        if (!round) check(worst.partial <= 1e-3, `${name}: every intermediate state within A2's bound (worst ${worst.partial.toExponential(2)})`);
        check(worst.warnings === 0, `${name}: valid ops never warn (${worst.warnings})`);
        check(worst.calls > 1000, `${name}: the sequences did work (${worst.calls} engine calls)`);
      }
    }
  }
  console.log(`  ${runs} random op sequences on the engine models`);
}

// --------------------------------------------------------------- clock --
{
  // §7.1's clock checks, with a fake context and a fake perfNow.
  const ctx = { currentTime: 0, state: 'running' };
  let p = 1000;
  const clock = createAudioClock(ctx, () => p);
  let ok = true;
  for (let k = 1; k <= 50; k++) {
    ctx.currentTime = k * 0.0213;
    p += 21.3;
    if (!near(clock(), ctx.currentTime + 0.02, 1e-12)) ok = false;
  }
  check(ok, 'currentTime advancing at every read: clock = currentTime + 0.02');
  const frozen = ctx.currentTime;
  p += 20;
  check(near(clock(), frozen + 0.02, 1e-12), 'currentTime unchanged for 20 ms (< 25 ms): not a stall yet');
  p += 280;
  const c300 = clock();
  check(near(c300, frozen + 0.32, 1e-9), `frozen while running and perfNow +300 ms: frozen + 0.32 (${(c300 - frozen).toFixed(6)})`);
  p += 1700;
  check(near(clock(), frozen + 0.52, 1e-9), 'frozen for 2 s: capped at frozen + 0.52');
  ctx.currentTime = frozen + 0.1; // the stale value catches up, below the estimate
  check(near(clock(), frozen + 0.52, 1e-9), 'currentTime stepping back below the estimate never moves the clock back');
  ctx.currentTime = frozen + 0.6;
  check(near(clock(), frozen + 0.62, 1e-9), 'the clock follows currentTime again once it is ahead');
  // Suspended: frozen whatever the wall clock does; the resume re-bases, so nothing jumps.
  const t0 = ctx.currentTime;
  ctx.state = 'suspended';
  const c0 = clock();
  p += 10000;
  check(clock() === c0, 'a suspended context freezes the clock (10 s of wall time)');
  ctx.state = 'running';
  check(clock() === c0, 'its resume re-bases: no jump');
  p += 10;
  check(clock() === c0, '10 ms after the resume: unchanged');
  p += 30;
  check(near(clock(), t0 + 0.04 + 0.02, 1e-9), 'a stall after the resume extrapolates from the resume');
  const live = createAudioClock({ currentTime: 3, state: 'running' });
  check(near(live(), 3.02, 1e-9), 'the default clock reads performance.now');
}

// ---------------------------------------------------------- drone duty --
{
  check(Object.isFrozen(NEW_DUTY) && NEW_DUTY.onS === 0 && NEW_DUTY.quietS === 0 && NEW_DUTY.restUntil === null,
    'NEW_DUTY is a frozen fresh duty');
  const a = advanceDuty(NEW_DUTY, 0, 1200, true);
  check(a.restStarts.length === 1 && a.restStarts[0] === 1200 && a.duty.restUntil === 1800 && a.restEnds.length === 0,
    'with intent, a rest starts exactly at 20 min and runs to 30');
  check(NEW_DUTY.onS === 0 && NEW_DUTY.restUntil === null, 'the input duty is not changed');
  const b = advanceDuty(a.duty, 1200, 1500, true);
  check(b.duty.restUntil === 1800 && b.restEnds.length === 0 && b.restStarts.length === 0, 'resting with intent: still resting');
  const c = advanceDuty(b.duty, 1500, 2000, false);
  check(c.restEnds[0] === 1800 && c.duty.restUntil === null && c.duty.onS === 0 && near(c.duty.quietS, 200),
    'the rest runs out at 30 min whatever the intent; quiet counts after it');
  const d = advanceDuty(a.duty, 1200, 1800, false);
  check(d.restEnds.length === 1 && d.restEnds[0] === 1800 && d.duty.restUntil === null, 'a rest ending exactly at t1 ends');
  // S11 at the duty level: play at 0, pause 900-1600 (600 s of quiet starts the on-time again), resume at 1600.
  let s = advanceDuty(NEW_DUTY, 0, 900, true).duty;
  s = advanceDuty(s, 900, 1600, false).duty;
  check(s.onS === 0, 'S11: 600 s of quiet starts the on-time again');
  check(advanceDuty(s, 1600, 9999, true).restStarts[0] === 2800, 'S11: resumed at 1600, the next rest is at 2800');
  let s2 = advanceDuty(NEW_DUTY, 0, 900, true).duty;
  s2 = advanceDuty(s2, 900, 1200, false).duty;
  check(advanceDuty(s2, 1200, 9999, true).restStarts[0] === 1500, 'S11 variant: paused 900-1200, the next rest is at 1500');
  // S29 at the duty level: the time away (a dispose) counts as quiet.
  const at1000 = advanceDuty(NEW_DUTY, 0, 1000, true).duty;
  check(advanceDuty(advanceDuty(at1000, 1000, 1100, false).duty, 1100, 9999, true).restStarts[0] === 1300,
    'S29: 100 s away, the next rest is at 1300');
  check(advanceDuty(advanceDuty(at1000, 1000, 1700, false).duty, 1700, 9999, true).restStarts[0] === 2900,
    'S29: 700 s away (≥ 600 of quiet), the next rest is at 2900');
  // Exact boundaries for any step size: one call, 1 s ticks and random steps agree.
  const one = advanceDuty(NEW_DUTY, 0, 6000, true);
  check(one.restStarts.join(',') === '1200,3000,4800' && one.restEnds.join(',') === '1800,3600,5400',
    'continuous intent: rests at 20, 50 and 80 min, 10 min each');
  const rand = mulberry32(42);
  for (const stepper of ['1 s', 'random']) {
    let dd: Duty = NEW_DUTY;
    const starts: number[] = [], ends: number[] = [];
    let t = 0;
    while (t < 6000) {
      const t1 = Math.min(6000, t + (stepper === '1 s' ? 1 : rand() * 90));
      const r = advanceDuty(dd, t, t1, true);
      starts.push(...r.restStarts);
      ends.push(...r.restEnds);
      dd = r.duty;
      t = t1;
    }
    const same = starts.length === one.restStarts.length && ends.length === one.restEnds.length
      && starts.every((x, i) => near(x, one.restStarts[i], 1e-6)) && ends.every((x, i) => near(x, one.restEnds[i], 1e-6));
    check(same && near(dd.onS, one.duty.onS, 1e-6), `${stepper} steps give the same rests as one call (${starts.join(',')})`);
  }
  check(advanceDuty(NEW_DUTY, 10, 5, true).restStarts.length === 0 && advanceDuty(NEW_DUTY, 0, NaN, true).duty.onS === 0,
    'a backwards or non-finite span changes nothing');
  const junk = advanceDuty({ onS: NaN, quietS: -5, restUntil: Infinity }, 0, 100, true);
  check(junk.duty.onS === 100 && junk.duty.restUntil === null && junk.duty.quietS === 0, 'malformed duty fields read as fresh');
  check(advanceDuty({ onS: 1300, quietS: 0, restUntil: null }, 50, 60, true).restStarts[0] === 50,
    'on-time already past 20 min starts the rest at once');
  check(advanceDuty({ onS: 0, quietS: 0, restUntil: 40 }, 50, 60, false).restEnds[0] === 50,
    'a rest that ran out before the span ends at its start');
}

// ------------------------------------------------------ drone gate points --

type Pt = [number, number];
const ptsText = (p: Pt[]): string => p.map(([t, v]) => `(${+t.toFixed(4)}, ${+v.toFixed(4)})`).join(' ');
/** Increasing times, values in [0, 1], and no faster than the gate's rates (open 1/8 per s, close 1/3 per s). */
function pathOk(now: number, v0: number, p: Pt[]): boolean {
  let pt = now, pv = v0;
  for (const [t, v] of p) {
    if (!(t > pt) || v < -1e-12 || v > 1 + 1e-12) return false;
    const slope = (v - pv) / (t - pt);
    if (slope > 1 / 8 + 1e-9 || slope < -1 / 3 - 1e-9) return false;
    pt = t;
    pv = v;
  }
  return true;
}
function gateAt(now: number, v0: number, p: Pt[], x: number): number {
  let pt = now, pv = v0;
  for (const [t, v] of p) {
    if (x <= t) return pv + (v - pv) * ((x - pt) / (t - pt));
    pt = t;
    pv = v;
  }
  return pv;
}
const dutyAt = (t: number, from = 0): Duty => advanceDuty(NEW_DUTY, from, t, true).duty;
{
  // S1: a first play from silence at t = 1 (at = 1.05): opens over 8 s; the first rest closes at 1201.
  const p = droneGatePoints({ now: 1, v0: 0, closedUntil: 1.05, voiceHasDrone: true, playing: true, duty: dutyAt(1, 1), intent: true, horizon: 7201 });
  check(ptsText(p.slice(0, 6)) === '(1.05, 0) (9.05, 1) (1201, 1) (1204, 0) (1801, 0) (1809, 1)' && pathOk(1, 0, p),
    `S1: opens 1.05 → 9.05, rests 1201-1801 (${ptsText(p.slice(0, 6))})`);
  check(p[p.length - 1][0] <= 7201 + 8 && p.every(([t]) => t > 1), 'the points stop at the horizon (a ramp under way finishes)');
  // S2: a retune from settled gates at 180 (at = 183.02).
  const p2 = droneGatePoints({ now: 180, v0: 1, closedUntil: 183.02, voiceHasDrone: true, playing: true, duty: dutyAt(180, 1), intent: true, horizon: 7380 });
  check(ptsText(p2.slice(0, 3)) === '(183, 0) (183.02, 0) (191.02, 1)' && near(gateAt(180, 1, p2, 181.5), 0.5) && pathOk(180, 1, p2),
    `S2: closes over 3 s (0.5 at 181.5), silent until 183.02, open by 191.02 (${ptsText(p2.slice(0, 3))})`);
  // S3: a revert reopens from where the gate is (no closedUntil).
  const p3 = droneGatePoints({ now: 300.5, v0: 1 - 0.5 / 3, closedUntil: null, voiceHasDrone: true, playing: true, duty: dutyAt(300.5), intent: true, horizon: 7500 });
  check(near(p3[0][0], 301.8333333, 1e-6) && p3[0][1] === 1, `S3: 0.8333 → 1 by 301.8333 (${ptsText(p3.slice(0, 1))})`);
  // S10: a rest that starts inside a retune is honoured; and both sides of its end.
  const p10 = droneGatePoints({ now: 1199, v0: 1, closedUntil: 1202.02, voiceHasDrone: true, playing: true, duty: dutyAt(1199), intent: true, horizon: 8399 });
  check(ptsText(p10.slice(0, 3)) === '(1202, 0) (1800, 0) (1808, 1)' && pathOk(1199, 1, p10),
    `S10: the drone stays 0 until 1800 and is 1 at 1808 (${ptsText(p10.slice(0, 3))})`);
  const p10b = droneGatePoints({ now: 1799.5, v0: 0, closedUntil: 1800.32, voiceHasDrone: true, playing: true, duty: dutyAt(1799.5), intent: true, horizon: 9000 });
  check(ptsText(p10b.slice(0, 2)) === '(1800.32, 0) (1808.32, 1)', `S10: a retune at 1799.5 opens 1800.32 → 1808.32 (${ptsText(p10b.slice(0, 2))})`);
  const p10c = droneGatePoints({ now: 1799, v0: 0, closedUntil: 1799.82, voiceHasDrone: true, playing: true, duty: dutyAt(1799), intent: true, horizon: 9000 });
  check(ptsText(p10c.slice(0, 2)) === '(1800, 0) (1808, 1)', `S10: a retune at 1799 opens at 1800.0 (${ptsText(p10c.slice(0, 2))})`);
  // No voice (pause), and a voice without a drone: close at the gate's rate and stay shut.
  check(ptsText(droneGatePoints({ now: 50, v0: 1, closedUntil: null, voiceHasDrone: true, playing: false, duty: dutyAt(50), intent: false, horizon: 7250 })) === '(53, 0)',
    'pause: the drone closes over 3 s');
  check(ptsText(droneGatePoints({ now: 50, v0: 0.5, closedUntil: 50.82, voiceHasDrone: false, playing: true, duty: dutyAt(50), intent: false, horizon: 7250 })) === '(51.5, 0)',
    'a voice without a drone: closes from 0.5 over 1.5 s and stays shut');
  // An opening cut by a rest start turns round at the rate from where it is.
  const pi = droneGatePoints({ now: 1199.5, v0: 0, closedUntil: null, voiceHasDrone: true, playing: true, duty: dutyAt(1199.5), intent: true, horizon: 8399.5 });
  check(ptsText(pi.slice(0, 2)) === '(1200, 0.0625) (1200.1875, 0)' && pathOk(1199.5, 0, pi),
    `an opening cut by a rest closes from 0.0625 (${ptsText(pi.slice(0, 2))})`);
  // Resting now with the gate partly open: close at once; without intent the rest still ends and the gate reopens.
  const pr = droneGatePoints({ now: 1300, v0: 0.5, closedUntil: null, voiceHasDrone: true, playing: true, duty: dutyAt(1300), intent: false, horizon: 8500 });
  check(ptsText(pr) === '(1301.5, 0) (1800, 0) (1808, 1)', `resting now: close, reopen at the rest's end without intent too (${ptsText(pr)})`);
  // S29: a carried duty resting until 1800; a new player plays at 1500.
  const carried = advanceDuty(dutyAt(1300), 1300, 1500, false).duty;
  const p29 = droneGatePoints({ now: 1500, v0: 0, closedUntil: 1500.05, voiceHasDrone: true, playing: true, duty: carried, intent: true, horizon: 8700 });
  check(ptsText(p29.slice(0, 2)) === '(1800, 0) (1808, 1)', `S29: a carried rest keeps the drone shut until 1800 (${ptsText(p29.slice(0, 2))})`);
  // Random inputs: always increasing, within [0, 1] and the gate's rates.
  const rand = mulberry32(7);
  let ok = true;
  for (let k = 0; k < 500; k++) {
    const now = rand() * 5000;
    const v0 = rand() < 0.3 ? (rand() < 0.5 ? 0 : 1) : rand();
    const duty = advanceDuty(NEW_DUTY, 0, now, rand() < 0.8).duty;
    const pts = droneGatePoints({
      now, v0, closedUntil: rand() < 0.4 ? now + rand() * 4 : null, voiceHasDrone: rand() < 0.8, playing: rand() < 0.8,
      duty, intent: rand() < 0.7, horizon: now + 7200,
    });
    if (!pathOk(now, v0, pts)) ok = false;
  }
  check(ok, '500 random gate paths: increasing times, values in [0, 1], slopes within the gate rates');
}

// ------------------------------------------------------------ voice key --
{
  const key = (p: ReturnType<typeof plan>, render: 'binaural' | 'pulse' | 'off', drone = true): string => {
    if (!p) return '';
    const effectiveDrone = drone && p.drone_sub && p.drone_hz > 0;
    return voiceKey({ tone: p.tone_hz, carrier: p.carrier_hz, render, beatOn: p.beat_hz > 0, drone: effectiveDrone ? p.drone_hz : 0, pulse: p.pulse_hz });
  };
  const h528 = plan(528, 'headphones', 'binaural', 10);
  check(key(h528, 'binaural') === '528.000000|binaural|264.000000+|33.000000@8.250000', `the key's format (${key(h528, 'binaural')})`);
  check(key(h528, 'off', false) === '528.000000|off|-|-', 'tone only: no carrier, no drone');
  const spk = plan(528, 'speakers', 'monaural', 10);
  check(key(spk, 'pulse') !== key(spk, 'off'), 'S28: one plan as pulse and as off are different voices');
  check(key(h528, 'binaural') !== key(h528, 'pulse'), 'binaural and pulse are different voices');
  check(key(h528, 'binaural') === key(plan(528, 'headphones', 'binaural', 6), 'binaural'), 'the beat Hz is not in the key (it glides)');
  check(key(h528, 'binaural') !== key(plan(528, 'headphones', 'binaural', 0), 'binaural'), 'a beat turning off is in the key');
  check(key(spk, 'pulse') === key(plan(528, 'phone', 'monaural', 10), 'pulse'), 'S22: 528 on speakers and on the phone is one voice (no drone plays)');
  check(key(plan(174, 'speakers', 'monaural', 10), 'pulse') !== key(plan(174, 'phone', 'monaural', 10), 'pulse'), 'S22: 174 moves up on the phone');
  check(key(plan(174, 'headphones', 'binaural', BANDS.beta), 'binaural') !== key(plan(174, 'headphones', 'binaural', BANDS.gamma), 'binaural'),
    "gamma moves 174's carrier: a retune");
  check(key(h528, 'binaural', false) !== key(h528, 'binaural'), 'the drone switch changes the voice');
  check(voiceKey({ tone: 300, carrier: 200, render: 'pulse', beatOn: true, drone: 0, pulse: 7.5 }) === '300.000000|pulse|200.000000+|-',
    'no drone: the pulse is left out');
}

console.log(`layerSchedule: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures.slice(0, 20)) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
