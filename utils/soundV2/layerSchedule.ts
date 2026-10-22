// utils/soundV2/layerSchedule.ts
//
// The scheduling core of the v2 layer player (layerPlayer.ts), kept pure so
// Node can check it: ParamTrack (a JS mirror of one AudioParam's automation),
// the player's clock, the drone's duty cycle in continuous time, the drone
// gate's points, and the key that decides whether a new voice needs a retune.
//
// The player never reads AudioParam.value (on the main thread it is stale, or
// a guess) and never calls cancelAndHoldAtTime (the vendored LayerGraph's
// fades relied on it and stepped in Chrome and Edge: LG-01, see README.md). It
// sends only setValueAtTime, linearRampToValueAtTime, setTargetAtTime and
// cancelScheduledValues, all through a ParamTrack, which records exactly what
// it sent and evaluates that by the Web Audio spec. The mirror is the player's
// only answer to "where is this gain now".
//
// No DOM globals (performance.now is only the clock's default), no React, no
// App imports. Erasable TypeScript only (no enums, namespaces, parameter
// properties or decorators), so Node runs layerSchedule.check.ts directly;
// type imports of this module must use `import type`, or Node's type
// stripping fails at run time.

import { DRONE_ON_S, DRONE_REST_S, DRONE_OUT_S, DRONE_IN_S } from './aetheria_sound_v2.ts';

/** The single +12 dB cap on a user gain (the player and the host both clamp to it). */
export const MAX_BOOST = 10 ** (12 / 20); // 3.98107
/** An anchor cancels from 1.5 frames past itself, so at least one frame separates the two even after Gecko rounds
 *  both times to frames (half a frame would delete the anchor about half the time). */
export const ANCHOR_EPS_FRAMES = 1.5;
/** createAudioClock runs this far ahead of the context's currentTime, so the player never schedules in the past. */
export const CLOCK_MARGIN_S = 0.02;
/** createAudioClock: a running context whose currentTime has not moved for CLOCK_STALL_S is stale (Gecko after a long
 *  task); the clock then follows the wall clock, at most CLOCK_MAX_EXTRAP_S past the stale value. */
export const CLOCK_STALL_S = 0.025, CLOCK_MAX_EXTRAP_S = 0.5;

// ------------------------------------------------------------- ParamTrack --

/** The four AudioParam methods the player uses: a real AudioParam, or a test engine. */
export interface ParamLike {
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  setTargetAtTime(target: number, t: number, tau: number): unknown;
  cancelScheduledValues(t: number): unknown;
}

export type ParamEvent =
  | { type: 'set'; t: number; v: number }
  | { type: 'lin'; t: number; v: number }
  | { type: 'tgt'; t: number; v: number; tau: number }; // v = target

/**
 * A JS mirror of ONE AudioParam's timeline. Every call goes to the param and
 * into `events` identically, and valueAt evaluates the events by the Web Audio
 * spec: a set holds from its time; a ramp (lin) runs from the previous event's
 * (time, value) to its own; a glide (tgt) decays from the value at its start;
 * before the first event the initial value holds. Like Blink and Gecko, an
 * event of the same type at the same time replaces the earlier one.
 *
 * Every ramp and glide starts with an anchor (see anchor()); steps are only
 * for params whose layer is silent. The player never puts a ramp directly
 * after a glide (the spec starts such a ramp from the engine's current time,
 * which no mirror can know), so path() refuses where its anchor could not end
 * a glide.
 */
export class ParamTrack {
  private readonly param: ParamLike;
  private readonly eps: number;
  private readonly warn: (msg: string) => void;
  private readonly ev: ParamEvent[] = [];
  /** The value before the first event: the initial value, or what the events prune() dropped left behind. */
  private base: number;

  /** `initial` must be what the param holds now (the player sets it through the .value setter first).
   *  `warn` defaults to console.warn. */
  constructor(param: ParamLike, initial: number, sampleRate: number, warn?: (msg: string) => void) {
    if (!Number.isFinite(initial)) throw new RangeError(`ParamTrack: initial value ${initial} is not finite`);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError(`ParamTrack: sample rate ${sampleRate} is not a positive number`);
    }
    this.param = param;
    this.base = initial;
    this.eps = ANCHOR_EPS_FRAMES / sampleRate;
    this.warn = warn ?? ((msg: string) => console.warn(msg));
  }

  /** Exactly what was sent and is still scheduled, in time order (after prune(), from the last event that matters). */
  get events(): readonly ParamEvent[] {
    return this.ev;
  }

  /** The param's value at t, from the mirror. Exact for every t at or after the last prune point. */
  valueAt(t: number): number {
    if (Number.isNaN(t)) return NaN;
    const next = this.after(t);
    if (next < this.ev.length && this.ev[next].type === 'lin') return this.onRamp(next, t);
    return next === 0 ? this.base : this.settle(next - 1, t);
  }

  /**
   * Hold the value at t before a change (the anchor rule), and return it:
   * v = valueAt(t); strictly inside a ramp, linearRampToValueAtTime(v, t) —
   * on the ramp's own line, so an engine still rendering before t keeps the
   * ramp (a future setValueAtTime there would hold the ramp's START value until
   * t: the value jumps back) — otherwise setValueAtTime(v, t); then
   * cancelScheduledValues(t + 1.5 frames). Value first, cancel second: Blink
   * and WebKit may render between the two calls, and cancel-first would render
   * a quantum at the previous event's value. Events inside (t, t + eps) stay.
   * There is no floor: an anchor deletes every later event, a pre-scheduled
   * future anchor included (a stop must be able to cancel a deferred rise).
   */
  anchor(t: number): number {
    if (!this.validTime(t, 'anchor')) return this.valueAt(t);
    const v = this.valueAt(t);
    const onLine = this.inRamp(t);
    const glide = this.runningGlide(onLine ? 'lin' : 'set', t);
    if (glide) this.warn(`ParamTrack.anchor(${t}): the glide that starts at ${glide.t} keeps running past it`);
    this.place(t, v, onLine);
    return v;
  }

  /**
   * anchor(t), then a linear ramp through each point: times after t and
   * increasing, values finite. A point at the time of the one before it (or at
   * t) that holds its value is a zero-length segment and is skipped — e.g. a
   * close from a gate already at 0, (now + 0 × 0.8, 0) — while one that would
   * change the value there (a step) refuses the path. Any bad point and
   * nothing is scheduled.
   */
  path(t: number, points: ReadonlyArray<readonly [number, number]>): void {
    if (!this.validTime(t, 'path')) return;
    let keep: Array<readonly [number, number]> | null = null; // copied only when a point is skipped
    let prevT = t, prevV = points.length > 0 ? this.valueAt(t) : 0;
    for (let k = 0; k < points.length; k++) {
      const pt = points[k][0], pv = points[k][1];
      const hold = pt === prevT && Math.abs(pv - prevV) <= 1e-9;
      if (!Number.isFinite(pt) || !Number.isFinite(pv) || !(pt > prevT || hold)) {
        this.warn(`ParamTrack.path(${t}): point ${k} (${pt}, ${pv}) is not finite or not after ${prevT}; nothing scheduled`);
        return;
      }
      if (hold) {
        if (!keep) keep = points.slice(0, k);
        continue;
      }
      if (keep) keep.push(points[k]);
      prevT = pt;
      prevV = pv;
    }
    const pts = keep ?? points;
    if (pts.length === 0) {
      this.anchor(t);
      return;
    }
    const onLine = this.inRamp(t);
    const glide = this.runningGlide(onLine ? 'lin' : 'set', t);
    if (glide) {
      this.warn(`ParamTrack.path(${t}): a ramp here would follow the glide that starts at ${glide.t}; nothing scheduled`);
      return;
    }
    this.place(t, this.valueAt(t), onLine);
    for (let k = 0; k < pts.length; k++) this.send({ type: 'lin', t: pts[k][0], v: pts[k][1] });
  }

  /** anchor(t), then setTargetAtTime(target, t, tau): a glide from the value at t. A glide already starting at t is
   *  replaced (same type, same time). Used on frequencies, which only ever hold steps and glides. */
  glide(t: number, target: number, tau: number): void {
    if (!this.validTime(t, 'glide')) return;
    if (!Number.isFinite(target) || !Number.isFinite(tau) || tau <= 0) {
      this.warn(`ParamTrack.glide(${t}): target ${target} or time constant ${tau} is not usable; nothing scheduled`);
      return;
    }
    const onLine = this.inRamp(t);
    const glide = this.runningGlide(onLine ? 'lin' : 'set', t);
    if (glide && glide.t !== t) this.warn(`ParamTrack.glide(${t}): the glide that starts at ${glide.t} takes over then`);
    this.place(t, this.valueAt(t), onLine);
    this.send({ type: 'tgt', t, v: target, tau });
  }

  /** setValueAtTime(v, t) at or after the last event: a step, for a param whose layer is silent at t. */
  stepAt(v: number, t: number): void {
    if (!this.validTime(t, 'stepAt')) return;
    if (!Number.isFinite(v)) {
      this.warn(`ParamTrack.stepAt(${v}, ${t}): the value is not finite; nothing scheduled`);
      return;
    }
    const n = this.ev.length;
    if (n > 0 && t < this.ev[n - 1].t) {
      this.warn(`ParamTrack.stepAt(${v}, ${t}): before the last event (${this.ev[n - 1].t}); nothing scheduled`);
      return;
    }
    // At the start time of a glide the step would replace the glide's own start step and the glide would run on.
    if (this.runningGlide('set', t)) {
      this.warn(`ParamTrack.stepAt(${v}, ${t}): a glide starts there and would keep running; nothing scheduled`);
      return;
    }
    this.send({ type: 'set', t, v });
  }

  /**
   * cancelScheduledValues(t) alone, mirrored: it drops a pending step and
   * keeps a glide that has started (it runs on from where it is; an anchor
   * here would freeze it). A ramp running through t would lose its end and
   * jump, so that case warns and anchors at t instead. Nothing scheduled at or
   * after t: no call at all.
   */
  dropFrom(t: number): void {
    if (!this.validTime(t, 'dropFrom')) return;
    const k = this.atOrAfter(t);
    if (k >= this.ev.length) return;
    if (this.ev[k].type === 'lin' && (k === 0 || this.ev[k - 1].t < t)) {
      this.warn(`ParamTrack.dropFrom(${t}): a ramp runs through it; anchoring there instead`);
      this.anchor(t);
      return;
    }
    this.param.cancelScheduledValues(t);
    this.ev.length = k;
  }

  /** True when an event is scheduled after t (a glide already running is not counted). */
  hasFuture(t: number): boolean {
    const n = this.ev.length;
    return n > 0 && this.ev[n - 1].t > t;
  }

  /** Drop the events not needed to evaluate times ≥ before. Nothing may be scheduled before `before` afterwards
   *  (the player prunes at now − 1 s and never schedules below now). */
  prune(before: number): void {
    if (!Number.isFinite(before)) return;
    const i = this.after(before) - 1;
    if (i <= 0) return;
    // Keep every event at ev[i]'s time, so a same-time replacement later is still mirrored exactly.
    let f = i;
    while (f > 0 && this.ev[f - 1].t === this.ev[i].t) f--;
    if (f === 0) return;
    this.base = this.settle(f - 1, this.ev[f].t);
    this.ev.splice(0, f);
  }

  // ------------------------------------------------------------- internals --

  private validTime(t: number, what: string): boolean {
    if (Number.isFinite(t) && t >= 0) return true; // a real AudioParam throws a RangeError below 0
    this.warn(`ParamTrack.${what}: time ${t} is not a finite time >= 0; nothing scheduled`);
    return false;
  }

  /** Index of the first event after t. */
  private after(t: number): number {
    const ev = this.ev;
    let lo = 0, hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Index of the first event at or after t. */
  private atOrAfter(t: number): number {
    const ev = this.ev;
    let lo = 0, hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** True when t lies strictly inside a ramp: the next event after t is a lin. */
  private inRamp(t: number): boolean {
    const k = this.after(t);
    return k < this.ev.length && this.ev[k].type === 'lin';
  }

  /** Where send() puts an event of this type at t: the same-type same-time event it replaces, else before the first
   *  event after t. */
  private slot(type: ParamEvent['type'], t: number): number {
    const k = this.after(t);
    for (let j = k - 1; j >= 0 && this.ev[j].t === t; j--) if (this.ev[j].type === type) return j;
    return k;
  }

  /** A glide that an anchor of this type at t would leave running: one after the anchor's slot that starts before
   *  t + eps (the cancel spares it). Only a glide at t itself, or a time running backwards, can do that. */
  private runningGlide(type: ParamEvent['type'], t: number): ParamEvent | null {
    const ev = this.ev;
    const s = this.slot(type, t);
    const from = s < ev.length && ev[s].t === t && ev[s].type === type ? s + 1 : s;
    for (let k = from; k < ev.length && ev[k].t < t + this.eps; k++) if (ev[k].type === 'tgt') return ev[k];
    return null;
  }

  /** One event to the param, then into the mirror (a param that throws leaves the mirror as it was). */
  private send(e: ParamEvent): void {
    if (e.type === 'set') this.param.setValueAtTime(e.v, e.t);
    else if (e.type === 'lin') this.param.linearRampToValueAtTime(e.v, e.t);
    else this.param.setTargetAtTime(e.v, e.t, e.tau);
    const s = this.slot(e.type, e.t);
    if (s < this.ev.length && this.ev[s].t === e.t && this.ev[s].type === e.type) this.ev[s] = e;
    else this.ev.splice(s, 0, e);
  }

  /** The anchor's two calls, in this order: the value at t (on the ramp's line, or a step), then the cancel. */
  private place(t: number, v: number, onLine: boolean): void {
    this.send(onLine ? { type: 'lin', t, v } : { type: 'set', t, v });
    const c = t + this.eps;
    this.param.cancelScheduledValues(c);
    this.ev.length = this.atOrAfter(c);
  }

  /** The value at t (before ev[j].t) on the ramp that ends at ev[j]. */
  private onRamp(j: number, t: number): number {
    const e = this.ev[j];
    if (j === 0) return this.base; // its start was pruned: only times at or after the prune point are exact
    const p = this.ev[j - 1];
    const v0 = this.startOf(j - 1);
    return e.t > p.t ? v0 + (e.v - v0) * ((t - p.t) / (e.t - p.t)) : e.v;
  }

  /** The value at ev[i].t once ev[i] has applied (a glide's is its start value). */
  private startOf(i: number): number {
    const e = this.ev[i];
    if (e.type !== 'tgt') return e.v;
    return i === 0 ? this.base : this.settle(i - 1, e.t);
  }

  /** ev[i]'s value at t ≥ ev[i].t as if nothing followed it: a step or a finished ramp holds, a glide decays. */
  private settle(i: number, t: number): number {
    const ev = this.ev;
    if (ev[i].type !== 'tgt') return ev[i].v;
    // A glide starts wherever the events before it left the value. Walk back over glides that directly follow
    // glides (never made by the player, but the mirror stays exact), then forward.
    let k = i;
    while (k > 0 && ev[k - 1].type === 'tgt') k--;
    let v = k === 0 ? this.base : ev[k - 1].v;
    for (let m = k; m <= i; m++) {
      const e = ev[m];
      if (e.type !== 'tgt') continue;
      const end = m < i ? ev[m + 1].t : t;
      v = e.v + (v - e.v) * Math.exp(-(end - e.t) / e.tau);
    }
    return v;
  }
}

// ------------------------------------------------------------------ clock --

/**
 * The player's clock: monotonic, CLOCK_MARGIN_S ahead of the context. While
 * a running context's currentTime stays unchanged for more than
 * CLOCK_STALL_S, it is extrapolated at wall-clock rate (at most
 * CLOCK_MAX_EXTRAP_S): Gecko's main-thread currentTime can be stale after long
 * tasks (Deep Scan, the duration analyser), and its getOutputTimestamp is
 * derived from that same stale value, so it cannot correct it (and is not
 * used). A suspended context freezes the clock, and the drone duty with it; a
 * resume re-bases, so it never jumps. An over-estimate (Blink's bursty
 * currentTime on Android) only schedules a little later. Not claimed
 * Firefox-safe: it has never run in Firefox.
 */
export function createAudioClock(
  ctx: { currentTime: number; state?: string },
  perfNow: () => number = () => performance.now(),
): () => number {
  let baseT = NaN; // the currentTime last seen to change ...
  let baseP = 0; // ... and perfNow() at that read
  let lastState: string | undefined;
  let out = -Infinity;
  return () => {
    const t = ctx.currentTime;
    const p = perfNow();
    const state = ctx.state;
    if (t !== baseT || state !== lastState) {
      baseT = t;
      baseP = p;
      lastState = state;
    }
    let est = t;
    if (state === 'running') {
      const stalled = (p - baseP) / 1000;
      if (stalled > CLOCK_STALL_S) est = Math.min(t + CLOCK_MAX_EXTRAP_S, baseT + stalled);
    }
    if (est + CLOCK_MARGIN_S > out) out = est + CLOCK_MARGIN_S;
    return out;
  };
}

// ------------------------------------------------------------- drone duty --

/** The drone's duty: on-time toward the next rest, quiet time toward a fresh start, and the end of a rest in progress. */
export interface Duty {
  onS: number;
  quietS: number;
  restUntil: number | null;
}

export const NEW_DUTY: Readonly<Duty> = Object.freeze({ onS: 0, quietS: 0, restUntil: null });

/**
 * The vendored DroneDuty (aetheria_sound_v2.ts:325-353) in continuous time,
 * from t0 to t1 with one intent throughout: a rest in progress runs out at
 * restUntil whatever the intent (onS then starts again from 0); with intent,
 * onS grows and quietS is 0, and at DRONE_ON_S (20 min) a DRONE_REST_S (10
 * min) rest starts; without it, quietS grows and DRONE_REST_S of quiet starts
 * onS again. Boundaries are exact for any step size; the input is not changed.
 */
export function advanceDuty(
  d: Readonly<Duty>,
  t0: number,
  t1: number,
  intent: boolean,
): { duty: Duty; restStarts: number[]; restEnds: number[] } {
  const duty: Duty = {
    onS: Number.isFinite(d.onS) && d.onS > 0 ? d.onS : 0,
    quietS: Number.isFinite(d.quietS) && d.quietS > 0 ? d.quietS : 0,
    restUntil: typeof d.restUntil === 'number' && Number.isFinite(d.restUntil) ? d.restUntil : null,
  };
  const restStarts: number[] = [];
  const restEnds: number[] = [];
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return { duty, restStarts, restEnds };
  let t = t0;
  // Each pass finishes or crosses one rest boundary (two per 30 min of intent); the cap only bounds absurd spans
  // (~3 years of continuous intent).
  for (let pass = 0; pass < 100000; pass++) {
    if (duty.restUntil !== null) {
      if (t1 < duty.restUntil) break;
      t = Math.max(t, duty.restUntil);
      restEnds.push(t);
      duty.restUntil = null;
      duty.onS = 0;
      continue;
    }
    if (intent) {
      duty.quietS = 0;
      const startAt = t + Math.max(0, DRONE_ON_S - duty.onS);
      if (startAt > t1) {
        duty.onS += t1 - t;
        break;
      }
      duty.onS = DRONE_ON_S;
      restStarts.push(startAt);
      duty.restUntil = startAt + DRONE_REST_S;
      t = startAt;
      continue;
    }
    duty.quietS += t1 - t;
    if (duty.quietS >= DRONE_REST_S) duty.onS = 0;
    break;
  }
  return { duty, restStarts, restEnds };
}

/**
 * The drone gate's path from (now, v0): the points after now, ready for
 * ParamTrack.path(now, points). Rate-based and linear: a close from v takes
 * v × DRONE_OUT_S (3 s), an open from v takes (1 − v) × DRONE_IN_S (8 s). A
 * retune (closedUntil) first closes to 0 and holds 0 until closedUntil; with
 * no voice, or a voice without a drone, the gate then closes and stays shut;
 * otherwise it opens, closes at each rest start and reopens at each rest end
 * of the duty run forward from now with `intent` to `horizon` (an absolute
 * time). Rests and retunes come from this one computation, so a rest that
 * starts or ends inside a retune is honoured (the vendored graph dropped it:
 * LG-03).
 */
export function droneGatePoints(o: {
  now: number;
  v0: number;
  closedUntil: number | null;
  voiceHasDrone: boolean;
  playing: boolean;
  duty: Readonly<Duty>;
  intent: boolean;
  horizon: number;
}): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const now = o.now;
  if (!Number.isFinite(now)) return pts;
  let t = now;
  let v = o.v0 > 0 ? Math.min(o.v0, 1) : 0;
  const push = (pt: number, pv: number): void => {
    if (pt > (pts.length > 0 ? pts[pts.length - 1][0] : now)) pts.push([pt, pv]);
  };
  // Move from (t, v) toward target at the gate's rates until `until` (the next change of target, or Infinity).
  const follow = (target: number, until: number): void => {
    if (v !== target) {
      push(t, v); // a hold since the last point ends here
      const end = t + (target < v ? (v - target) * DRONE_OUT_S : (target - v) * DRONE_IN_S);
      if (end <= until) v = target;
      else v += target < v ? -(until - t) / DRONE_OUT_S : (until - t) / DRONE_IN_S;
      push(Math.min(end, until), v);
    }
    t = until;
  };
  const closedUntil = typeof o.closedUntil === 'number' && Number.isFinite(o.closedUntil) ? o.closedUntil : null;
  if (closedUntil !== null) {
    if (v > 0) {
      t += v * DRONE_OUT_S;
      v = 0;
      push(t, 0);
    }
    if (closedUntil > t) t = closedUntil;
  }
  if (!o.playing || !o.voiceHasDrone) {
    follow(0, Infinity);
    return pts;
  }
  const { restStarts, restEnds } = advanceDuty(o.duty, now, o.horizon, o.intent);
  // The duty's boundaries alternate (a rest end first when resting now); apply those up to t, then walk the rest.
  let resting = typeof o.duty.restUntil === 'number' && Number.isFinite(o.duty.restUntil);
  let a = 0, b = 0;
  const nextChange = (): number =>
    resting ? (b < restEnds.length ? restEnds[b] : Infinity) : (a < restStarts.length ? restStarts[a] : Infinity);
  while (nextChange() <= t) {
    if (resting) b++;
    else a++;
    resting = !resting;
  }
  for (;;) {
    const until = nextChange();
    follow(resting ? 0 : 1, until);
    if (until === Infinity) break;
    if (resting) b++;
    else a++;
    resting = !resting;
  }
  return pts;
}

// -------------------------------------------------------------- voice key --

/** How the beat layer sounds: a binaural pair, a monaural pulse, or nothing (tone only). */
export type BeatRender = 'binaural' | 'pulse' | 'off';

/**
 * The retune key, from the EFFECTIVE sounding values (drone 0 unless the drone
 * really plays): equal keys share every frequency and routing, so a change
 * between them is a glide or nothing; a different key goes through silence.
 * The beat's Hz is not in it (beat changes glide); whether a beat sounds is.
 * Every retune decision uses this, never the vendored signature(), which keys
 * on the raw plan (its drone and beat mode change with the output even where
 * v2 plays neither).
 */
export function voiceKey(v: {
  tone: number;
  carrier: number;
  render: BeatRender;
  beatOn: boolean;
  drone: number;
  pulse: number;
}): string {
  const beat = v.render === 'off' ? '-' : v.carrier.toFixed(6) + (v.beatOn ? '+' : '=');
  const drone = v.drone > 0 ? v.drone.toFixed(6) + '@' + v.pulse.toFixed(6) : '-';
  return `${v.tone.toFixed(6)}|${v.render}|${beat}|${drone}`;
}
