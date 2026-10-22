// tools/sound-check.ts — dev-only browser checks for the v2 layer player (v14.9, build spec §8).
//
// Served by `npm run dev` at /tools/sound-check.html (never built or deployed: vite.config.ts builds only
// index.html and public/sw.js). Each render plays a scripted session through utils/soundV2/layerPlayer.ts in an
// OfflineAudioContext, and the page compares what this browser rendered with the curves the spec designs —
// gates, host, user gains, routing and frequencies, written out below from §8.4 rather than read from the
// player: C1 clicks, C2 retune silence, C3 no overlap, C4 fade shapes, C5 per-ear levels, C6 binaural
// separation, C7 the off-headphones pulse, C8 frequencies, C9 mono, C10 the drone duty, C11 hygiene, C12 the
// vendored LayerGraph as a negative control (it must fail C1), C13 no swell (C13c: a pause right after a seek).
//
// Two modes, both with the player's clock at the script's time and no tick. Virtual clock (any engine): every
// call is made before rendering. Suspend (Chrome, Edge, Safari): the render pauses at the last quantum boundary
// before each call's time and the call is made there, a little ahead of the engine, as a running context sees
// it. Renders run one at a time; each buffer is analysed and dropped. AudioParam, source and connect methods are
// wrapped while the renders run (C11) and restored afterwards. The Listen buttons replay the scenarios live.
//
// Erasable TypeScript only, like utils/soundV2 (no enums, namespaces or parameter properties).

import { LayerPlayer } from '../utils/soundV2/layerPlayer.ts';
import type { LayerGains, LayerPlayerOptions, LayerPlayerState } from '../utils/soundV2/layerPlayer.ts';
import { plan, LayerGraph, LEVEL_TONE, LEVEL_BEAT, LEVEL_DRONE_SUB } from '../utils/soundV2/aetheria_sound_v2.ts';
import type { Plan } from '../utils/soundV2/aetheria_sound_v2.ts';

// -------------------------------------------------------------- constants --

const SR = 48000;
const TAU = 2 * Math.PI;
/** The designed levels and modulation (spec §0.6, §4.2), written out here rather than read from the player. */
const TONE = LEVEL_TONE; // 0.0501, −26 dB
const BEAT = LEVEL_BEAT; // 0.0708, −23 dB per ear: the binaural pair, and the pulse's peak (Q1)
const DRONE = LEVEL_DRONE_SUB; // 0.0631, −24 dB
const PULSE_BASE = 0.825, PULSE_SWING = 0.175; // PULSE_DEPTH 0.35
const DRONE_BASE = 0.85, DRONE_SWING = 0.15; // MOD_DEPTH 0.3
/** Where the oscillators park before the first voice (§4.2). */
const PARK = { tone: 300, carrier: 200, partner: 210, beatLfo: 10, drone: 30, droneLfo: 7.5 };
/** The swell render's host: 0.8 × phiEnvelope(24, 240), a pause at 10 % of a 240 s track (S21). */
const SWELL_HOST = 0.07319;
const ALL: LayerGains = { tone: 1, beat: 1, drone: 1 };

function mustPlan(f: number, output: string, mode: string, beat: number): Plan {
  const p = plan(f, output, mode, beat);
  if (!p) throw new Error(`plan(${f}, ${output}) is null`);
  return p;
}
const P528 = mustPlan(528, 'headphones', 'binaural', 10);
const P639 = mustPlan(639, 'headphones', 'binaural', 10);
const P639_SPK = mustPlan(639, 'speakers', 'monaural', 6);
const P639_PHN = mustPlan(639, 'phone', 'monaural', 6);
const P639_HP6 = mustPlan(639, 'headphones', 'binaural', 6);

// ----------------------------------------------------------------- design --

/** A designed gain: piecewise linear from (0, v0); a step is two points at one time (the later one holds). */
class Curve {
  readonly ts: number[];
  readonly vs: number[];
  constructor(v0: number) {
    this.ts = [0];
    this.vs = [v0];
  }
  /** A linear ramp from the last point to v at t. */
  to(t: number, v: number): this {
    const last = this.ts[this.ts.length - 1];
    if (!(t >= last)) throw new Error(`Curve: ${t} is before ${last}`);
    this.ts.push(t);
    this.vs.push(v);
    return this;
  }
  /** Hold the last value until t. */
  hold(t: number): this {
    return this.to(t, this.vs[this.vs.length - 1]);
  }
  /** Hold until t, then v from t on. */
  step(t: number, v: number): this {
    return this.hold(t).to(t, v);
  }
  /** A change at t starts from where the curve is then (the player's anchor): what was scheduled after t goes. */
  cut(t: number): this {
    const v = this.at(t);
    while (this.ts.length > 1 && this.ts[this.ts.length - 1] > t) {
      this.ts.pop();
      this.vs.pop();
    }
    return this.to(t, v);
  }
  at(t: number): number {
    const ts = this.ts;
    if (t < ts[0]) return this.vs[0];
    let lo = 0, hi = ts.length - 1; // the last point at or before t
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ts[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    if (lo === ts.length - 1) return this.vs[lo];
    return this.vs[lo] + (this.vs[lo + 1] - this.vs[lo]) * ((t - ts[lo]) / (ts[lo + 1] - ts[lo]));
  }
}

/** A stretch of an oscillator's frequency from t: constant (tau 0) or a setTargetAtTime glide from f; c0 = cycles at t. */
interface Seg {
  t: number;
  f: number;
  target: number;
  tau: number;
  c0: number;
}
function cyclesIn(s: Seg, t: number): number {
  const u = t - s.t;
  return s.c0 + (s.tau > 0 ? s.target * u + (s.f - s.target) * s.tau * (1 - Math.exp(-u / s.tau)) : s.f * u);
}

/** A designed oscillator frequency, and its phase as cycles since the oscillator started at 0 (phase 0). */
class Freq {
  readonly segs: Seg[];
  /** A phase correction (radians) from offFrom on: the beat LFO's phase after a glide is measured (lfoOffset). */
  off = 0;
  offFrom = Infinity;
  constructor(f0: number) {
    this.segs = [{ t: 0, f: f0, target: f0, tau: 0, c0: 0 }];
  }
  step(t: number, f: number): this {
    this.push({ t, f, target: f, tau: 0, c0: this.cycles(t) });
    return this;
  }
  glide(t: number, target: number, tau: number): this {
    this.push({ t, f: this.at(t), target, tau, c0: this.cycles(t) });
    return this;
  }
  seg(t: number): Seg {
    let i = this.segs.length - 1;
    while (i > 0 && this.segs[i].t > t) i--;
    return this.segs[i];
  }
  at(t: number): number {
    const s = this.seg(t);
    return s.tau > 0 ? s.target + (s.f - s.target) * Math.exp(-(t - s.t) / s.tau) : s.f;
  }
  cycles(t: number): number {
    return cyclesIn(this.seg(t), t);
  }
  private push(s: Seg): void {
    const last = this.segs[this.segs.length - 1];
    if (s.t < last.t) throw new Error(`Freq: ${s.t} is before ${last.t}`);
    this.segs.push(s);
  }
}

/** Sequential readers for the synthesis loops (times only move forward). */
class Reader {
  private readonly ts: readonly number[];
  private readonly vs: readonly number[];
  private i = 0;
  constructor(c: Curve) {
    this.ts = c.ts;
    this.vs = c.vs;
  }
  at(t: number): number {
    const ts = this.ts, last = ts.length - 1;
    let i = this.i;
    while (i < last && ts[i + 1] <= t) i++;
    this.i = i;
    if (i === last) return this.vs[i];
    return this.vs[i] + (this.vs[i + 1] - this.vs[i]) * ((t - ts[i]) / (ts[i + 1] - ts[i]));
  }
}
class FreqReader {
  private readonly f: Freq;
  private i = 0;
  constructor(f: Freq) {
    this.f = f;
  }
  sin(t: number): number {
    const segs = this.f.segs;
    let i = this.i;
    while (i < segs.length - 1 && segs[i + 1].t <= t) i++;
    this.i = i;
    const c = cyclesIn(segs[i], t);
    return Math.sin(TAU * (c - Math.floor(c)) + (t >= this.f.offFrom ? this.f.off : 0));
  }
}

type Layer = 'tone' | 'beat' | 'drone';
type Comp = 'tone' | 'carrier' | 'partner' | 'drone';
/** 0 = left, 1 = right, −1 = a one-channel destination's down-mix, (L + R) / 2. */
type Ch = 0 | 1 | -1;
type Render = 'binaural' | 'pulse' | 'off';
const COMPS: readonly Comp[] = ['tone', 'carrier', 'partner', 'drone'];

/** Everything the graph of §4.4 does in one render, as designed. */
interface Design {
  sr: number;
  channels: 1 | 2;
  seconds: number;
  gateTB: Curve;
  gateDrone: Curve;
  host: Curve;
  user: Record<Layer, Curve>;
  cL: Curve;
  cR: Curve;
  pL: Curve;
  pR: Curve;
  amBase: Curve;
  amDepth: Curve;
  tonePlan: Curve;
  beatPlan: Curve;
  dronePlan: Curve;
  tone: Freq;
  carrier: Freq;
  partner: Freq;
  beatLfo: Freq;
  drone: Freq;
  droneLfo: Freq;
  /** The oscillators stop (dispose). */
  stop: number;
  /** The host's anchors during the 60 Hz feed (main render). */
  feedAnchors: number[];
}

function newDesign(sr: number, channels: 1 | 2, seconds: number, u: LayerGains): Design {
  return {
    sr, channels, seconds,
    gateTB: new Curve(0), gateDrone: new Curve(0), host: new Curve(0),
    user: { tone: new Curve(u.tone), beat: new Curve(u.beat), drone: new Curve(u.drone) },
    cL: new Curve(0), cR: new Curve(0), pL: new Curve(0), pR: new Curve(0), amBase: new Curve(1), amDepth: new Curve(0),
    tonePlan: new Curve(0), beatPlan: new Curve(0), dronePlan: new Curve(0),
    tone: new Freq(PARK.tone), carrier: new Freq(PARK.carrier), partner: new Freq(PARK.partner),
    beatLfo: new Freq(PARK.beatLfo), drone: new Freq(PARK.drone), droneLfo: new Freq(PARK.droneLfo),
    stop: Infinity, feedAnchors: [],
  };
}

/** §4.5: what a voice writes at fAt, while both gates are 0 — frequencies, routing, AM and plan levels. */
function voice(d: Design, fAt: number, p: Plan, render: Render, drone: boolean, beat: number): void {
  const on = beat > 0, bin = render === 'binaural' && on, pulse = render === 'pulse' && on, off = render === 'off';
  d.tone.step(fAt, p.tone_hz);
  d.carrier.step(fAt, p.carrier_hz);
  d.partner.step(fAt, p.carrier_hz + (on ? beat : 10)); // beat 0: parked at carrier + 10, unrouted
  d.beatLfo.step(fAt, on ? Math.min(beat, 10) : 10);
  if (drone) {
    d.drone.step(fAt, p.drone_hz);
    d.droneLfo.step(fAt, p.pulse_hz);
  }
  d.cL.step(fAt, off ? 0 : 1);
  d.cR.step(fAt, off || bin ? 0 : 1);
  d.pR.step(fAt, bin ? 1 : 0); // pL is never routed
  d.amBase.step(fAt, pulse ? PULSE_BASE : 1);
  d.amDepth.step(fAt, pulse ? PULSE_SWING : 0);
  d.beatPlan.step(fAt, off ? 0 : BEAT);
  d.tonePlan.step(fAt, TONE);
  d.dronePlan.step(fAt, drone ? DRONE : 0);
}

/** |a − b| in dB, both floored at 1e-3 (the player's HOST_FLOOR). */
function dbApart(a: number, b: number): number {
  return Math.abs(20 * Math.log10(Math.max(a, 1e-3) / Math.max(b, 1e-3)));
}

const FEED_STEPS = 300;
const feedTime = (k: number): number => 160 + k / 60;
const feedLevel = (k: number): number => 0.5 + (0.02 * k) / FEED_STEPS;

/** §4.9's throttle on the 60 Hz feed 0.5 → 0.52 over 160–165 s: an anchor only for ≥ 0.1 dB from the target in flight
 *  and ≥ 100 ms after the last one, each a 0.25 s ramp (< 6 dB). No tick and no later call flush the last remainder. */
function feedDesign(host: Curve): number[] {
  const anchors: number[] = [];
  let target = host.at(feedTime(0)), last = -Infinity;
  for (let k = 0; k <= FEED_STEPS; k++) {
    const t = feedTime(k), x = feedLevel(k);
    if (dbApart(x, target) < 0.1 || t - last < 0.1) continue;
    host.cut(t).to(t + (dbApart(x, host.at(t)) >= 6 ? 1.5 : 0.25), x);
    target = x;
    last = t;
    anchors.push(t);
  }
  return anchors;
}

/** The main render (§8.4), with these user gains (the solos mute the other layers at 0). */
function mainDesign(u: LayerGains): Design {
  const d = newDesign(SR, 2, 175, u);
  voice(d, 0.025, P528, 'binaural', true, 10); // 0: from silence, fAt 0.025, at 0.05
  voice(d, 23.01, P639, 'binaural', true, 10); // 20: closeEnd 23.0, fAt 23.01, at 23.02
  d.partner.glide(80, P639.carrier_hz + 6, 3); // 80: setBeat(6) while open: 329.5 → 325.5 Hz, τ 3 s (§4.7)
  d.beatLfo.glide(80, 6, 3);
  voice(d, 103.01, P639_SPK, 'pulse', false, 6); // 100: the speakers' pulse, no drone
  // 120: the phone plan has the same effective key: no automation at all
  voice(d, 130.81, P639_PHN, 'off', false, 6); // 130: tone only
  voice(d, 135.81, P639_PHN, 'pulse', false, 6); // 135: the pulse again
  voice(d, 140.81, P639_HP6, 'binaural', true, 6); // 140: headphones, the drone back
  // A close from g takes g × 0.8 s (tone and beat) or g × 3 s (drone); an open (1 − g) × 2.5 s or × 8 s.
  d.gateTB
    .hold(0.05).to(2.55, 1)
    .hold(20).to(20.8, 0).hold(23.02).to(25.52, 1) // 0.5 at 20.4; reopens 0.5 at 24.27
    .hold(40).to(40.8, 0).cut(40.5).to(42.0625, 1) // the revert reopens from 0.375
    .hold(50).to(50.8, 0).cut(50.4).to(51.65, 1) // the resume reopens from 0.5
    .hold(60).to(60.8, 0).hold(70).to(72.5, 1)
    .hold(100).to(100.8, 0).hold(103.02).to(105.52, 1)
    .hold(130).to(130.8, 0).hold(130.82).to(133.32, 1)
    .hold(135).to(135.8, 0).hold(135.82).to(138.32, 1)
    .hold(140).to(140.8, 0).hold(140.82).to(143.32, 1);
  d.gateDrone
    .hold(0.05).to(8.05, 1)
    .hold(20).to(23, 0).hold(23.02).to(31.02, 1) // 0.5 at 21.5; reopens 0.5 at 27.02
    .hold(40).to(43, 0).cut(40.5).to(40.5 + (0.5 / 3) * 8, 1) // 0.8333 → 1 by 41.8333
    .hold(50).to(53, 0).cut(50.4).to(50.4 + (0.4 / 3) * 8, 1) // 0.8667 → 1 by 51.4667
    .hold(60).to(63, 0).hold(70).to(78, 1)
    .hold(100).to(103, 0) // the pulse and tone-only voices have no drone
    .hold(140.82).to(148.82, 1);
  d.host
    .step(0, 0.8) // both gates 0: a step
    .hold(145).to(146.5, 0.03) // −28.5 dB (≥ 6 dB): 1.5 s
    .hold(150).to(151.5, 0.9); // +29.5 dB: 1.5 s
  d.feedAnchors = feedDesign(d.host);
  d.host.cut(170).to(170.25, 0); // dispose: 0.25 s from wherever the host is
  d.stop = 170.3;
  return d;
}

/** The swell render (§8.4's last row, C13). */
function swellDesign(): Design {
  const d = newDesign(SR, 2, 30, ALL);
  const droneClose = 24 + ((24 - 20.82) / 8) * 3; // 24: the drone, opening since 20.82, closes from 0.3975: 25.1925
  voice(d, 0.025, P528, 'binaural', true, 10);
  voice(d, 14.025, P528, 'off', false, 10); // 14: the tone-only voice from silence, at 14.05
  voice(d, 20.81, P528, 'binaural', true, 10); // 20: the full voice again, at 20.82
  // 24: p639's steps at fAt 25.2025 are dropped by the pause at 24.4
  d.gateTB.hold(0.05).to(2.55, 1).hold(10).to(10.8, 0).hold(14.05).to(16.55, 1).hold(20).to(20.8, 0)
    .hold(20.82).to(23.32, 1).hold(24).to(24.8, 0);
  d.gateDrone.hold(0.05).to(8.05, 1).hold(10).to(13, 0).hold(20.82).to(28.82, 1).cut(24).to(droneClose, 0);
  d.host
    .step(0, SWELL_HOST)
    .step(13, 0.8) // 10: the rise waits for the drone's close (A8) and lands as a silent step
    .hold(20).to(21.5, SWELL_HOST) // 20: a fall, at once: −20.8 dB, 1.5 s
    .step(droneClose, 0.8); // 24 / 24.4: waits for the closes, then a silent step
  return d;
}

/** The remainder render (C13c, review A8-flush-rise): a seek's 1.5 s jump, two resends within 0.1 dB of it (kept as a
 *  remainder: no anchor), then a pause, which flushes that remainder before its closes: the jump stops at once. */
function remainderDesign(): Design {
  const d = newDesign(SR, 2, 15, ALL);
  voice(d, 0.025, P528, 'binaural', true, 10);
  d.gateTB.hold(0.05).to(2.55, 1).hold(10.6).to(11.4, 0);
  d.gateDrone.hold(0.05).to(8.05, 1).hold(10.6).to(13.6, 0);
  d.host
    .step(0, 0.1)
    .hold(10).to(11.5, 0.8) // 10: {glideS: 1.5}; 10.25 and 10.5 resend 0.801 / 0.802 (no anchor)
    .cut(10.6) // 10.6: the pause stops the jump at 0.38 (A8)
    .step(13.6, 0.802); // the remainder waits for the drone's close, then a silent step
  return d;
}

/** The duty render (C10, C13b): 1900 s at 8 kHz, one channel, the drone alone. */
function dutyDesign(): Design {
  const d = newDesign(8000, 1, 1900, ALL);
  d.user.tone.step(1, 0); // 1.0: the drone solo (gates 0: steps)
  d.user.beat.step(1, 0);
  voice(d, 1.025, P528, 'pulse', true, 10); // one channel: binaural is coerced to the pulse
  d.gateTB.hold(1.05).to(3.55, 1);
  d.gateDrone.hold(1.05).to(9.05, 1).hold(1201).to(1204, 0).hold(1801).to(1809, 1); // the first rest: 1201 → 1801
  d.host.step(1, 0.5).hold(1204).to(1204.25, 0.8); // 1201.5's rise waits for the rest's close (A8, AC-09)
  return d;
}

/** The mono render (C9): one channel, binaural asked for. */
function monoDesign(): Design {
  const d = newDesign(SR, 1, 30, ALL);
  voice(d, 0.025, P528, 'pulse', true, 10); // coerced to the pulse, at 10 Hz
  d.gateTB.hold(0.05).to(2.55, 1);
  d.gateDrone.hold(0.05).to(8.05, 1);
  d.host.step(0, 0.8);
  return d;
}

const route = (ch: Ch, l: number, r: number): number => (ch === 0 ? l : ch === 1 ? r : (l + r) / 2);
const freqOf = (d: Design, c: Comp): Freq => (c === 'tone' ? d.tone : c === 'carrier' ? d.carrier : c === 'partner' ? d.partner : d.drone);
const gateOf = (d: Design, c: Comp): Curve => (c === 'drone' ? d.gateDrone : d.gateTB);

/** A component's steady level at t with its gate open (host, user gain, routing and plan level; the AM's mean). */
function steadyOf(d: Design, c: Comp, ch: Ch, t: number): number {
  const h = d.host.at(t);
  if (c === 'tone') return h * d.tonePlan.at(t) * d.user.tone.at(t);
  if (c === 'drone') return h * d.dronePlan.at(t) * d.user.drone.at(t);
  const r = c === 'carrier' ? route(ch, d.cL.at(t), d.cR.at(t)) : route(ch, d.pL.at(t), d.pR.at(t));
  return h * d.beatPlan.at(t) * d.user.beat.at(t) * r;
}

/** A component's designed peak at t (gate, host, user, routing, plan level, the AM's peak), for C1's bounds. */
function peakAt(d: Design, c: Comp, ch: Ch, t: number): number {
  if (t >= d.stop) return 0;
  const am = c === 'tone' ? 1 : c === 'drone' ? DRONE_BASE + DRONE_SWING : d.amBase.at(t) + d.amDepth.at(t);
  return steadyOf(d, c, ch, t) * gateOf(d, c).at(t) * am;
}

/** One designed spectral component of a channel (host included, gates open). */
interface Part {
  f: number;
  a: number;
  kind: string;
}
function componentsAt(d: Design, ch: Ch, t: number): Part[] {
  const out: Part[] = [];
  const tone = steadyOf(d, 'tone', ch, t);
  if (tone > 0) out.push({ f: d.tone.at(t), a: tone, kind: 'tone' });
  const base = d.amBase.at(t), depth = d.amDepth.at(t), rate = d.beatLfo.at(t);
  for (const c of ['carrier', 'partner'] as const) {
    const a = steadyOf(d, c, ch, t);
    if (!(a > 0)) continue;
    const f = freqOf(d, c).at(t);
    out.push({ f, a: a * base, kind: c });
    if (depth > 0) out.push({ f: f - rate, a: (a * depth) / 2, kind: `${c}−rate` }, { f: f + rate, a: (a * depth) / 2, kind: `${c}+rate` });
  }
  const drone = steadyOf(d, 'drone', ch, t);
  if (drone > 0) {
    const f = d.drone.at(t), p = d.droneLfo.at(t);
    out.push({ f, a: drone * DRONE_BASE, kind: 'drone' });
    out.push({ f: f - p, a: (drone * DRONE_SWING) / 2, kind: 'drone−pulse' }, { f: f + p, a: (drone * DRONE_SWING) / 2, kind: 'drone+pulse' });
  }
  return out;
}

/** Every time a designed curve or frequency changes slope or value. */
function kinks(d: Design): number[] {
  const set = new Set<number>();
  const curves = [d.gateTB, d.gateDrone, d.host, d.user.tone, d.user.beat, d.user.drone, d.cL, d.cR, d.pL, d.pR,
    d.amBase, d.amDepth, d.tonePlan, d.beatPlan, d.dronePlan];
  for (const c of curves) for (const t of c.ts) set.add(t);
  for (const f of [d.tone, d.carrier, d.partner, d.beatLfo, d.drone, d.droneLfo]) for (const s of f.segs) set.add(s.t);
  if (Number.isFinite(d.stop)) set.add(d.stop);
  return [...set].sort((a, b) => a - b);
}

/** The designed output of a whole render, one array per channel (one channel: the destination's (L + R) / 2). */
function synthFull(d: Design): Float32Array[] {
  const len = Math.round(d.seconds * d.sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  const host = new Reader(d.host), gt = new Reader(d.gateTB), gd = new Reader(d.gateDrone);
  const ut = new Reader(d.user.tone), ub = new Reader(d.user.beat), ud = new Reader(d.user.drone);
  const cl = new Reader(d.cL), cr = new Reader(d.cR), pl = new Reader(d.pL), pr = new Reader(d.pR);
  const base = new Reader(d.amBase), depth = new Reader(d.amDepth);
  const tp = new Reader(d.tonePlan), bp = new Reader(d.beatPlan), dp = new Reader(d.dronePlan);
  const fTone = new FreqReader(d.tone), fCar = new FreqReader(d.carrier), fPar = new FreqReader(d.partner);
  const fLfo = new FreqReader(d.beatLfo), fDr = new FreqReader(d.drone), fDl = new FreqReader(d.droneLfo);
  for (let n = 0; n < len; n++) {
    const t = n / d.sr;
    if (t >= d.stop) break;
    const h = host.at(t);
    if (h === 0) continue;
    let l = 0, r = 0;
    const g = gt.at(t);
    if (g !== 0) {
      const a = tp.at(t) * ut.at(t);
      const tone = a !== 0 ? a * fTone.sin(t) : 0;
      let bl = 0, br = 0;
      const b = bp.at(t) * ub.at(t);
      if (b !== 0) {
        const vcl = cl.at(t), vcr = cr.at(t), vpl = pl.at(t), vpr = pr.at(t), dep = depth.at(t);
        const am = b * (base.at(t) + (dep !== 0 ? dep * fLfo.sin(t) : 0));
        const sc = vcl !== 0 || vcr !== 0 ? fCar.sin(t) : 0;
        const sp = vpl !== 0 || vpr !== 0 ? fPar.sin(t) : 0;
        bl = am * (vcl * sc + vpl * sp);
        br = am * (vcr * sc + vpr * sp);
      }
      l = g * (tone + bl);
      r = g * (tone + br);
    }
    const gdr = gd.at(t);
    if (gdr !== 0) {
      const a = dp.at(t) * ud.at(t);
      if (a !== 0) {
        const s = gdr * a * (DRONE_BASE + DRONE_SWING * fDl.sin(t)) * fDr.sin(t);
        l += s;
        r += s;
      }
    }
    L[n] = h * l;
    R[n] = h * r;
  }
  if (d.channels === 2) return [L, R];
  for (let n = 0; n < len; n++) L[n] = 0.5 * (L[n] + R[n]);
  return [L];
}

/** One component alone at unit level with its AM, on [s, s + n): what an envelope is normalised by (C10, C13). */
function synthUnit(d: Design, c: Comp, s: number, n: number, out: Float64Array): void {
  const f = new FreqReader(freqOf(d, c)), lfo = new FreqReader(c === 'drone' ? d.droneLfo : d.beatLfo);
  const base = new Reader(d.amBase), depth = new Reader(d.amDepth);
  for (let k = 0; k < n; k++) {
    const t = (s + k) / d.sr;
    const am = c === 'tone' ? 1 : c === 'drone' ? DRONE_BASE + DRONE_SWING * lfo.sin(t) : base.at(t) + depth.at(t) * lfo.sin(t);
    out[k] = am * f.sin(t);
  }
}

// -------------------------------------------------------------------- dsp --

const BH4 = [0.35875, 0.48829, 0.14128, 0.01168];
const bhCache = new Map<number, { w: Float64Array; sum: number }>();
/** The 4-term Blackman-Harris window of n points, and its sum. */
function bh(n: number): { w: Float64Array; sum: number } {
  let c = bhCache.get(n);
  if (c) return c;
  const w = new Float64Array(n);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const x = (TAU * k) / (n - 1);
    w[k] = BH4[0] - BH4[1] * Math.cos(x) + BH4[2] * Math.cos(2 * x) - BH4[3] * Math.cos(3 * x);
    sum += w[k];
  }
  c = { w, sum };
  if (bhCache.size > 64) bhCache.clear();
  bhCache.set(n, c);
  return c;
}

interface Cx {
  re: number;
  im: number;
}
/**
 * The Blackman-Harris-windowed DTFT of x[s .. s + n) at f Hz, phase-referenced to the window's centre (so a
 * symmetric window adds no phase): a sine of amplitude A there reads 2|X| / Σw = A, plus what leaks in from its
 * neighbours. The rotation is re-seeded every 2048 samples, so a 4 s window stays exact to ~1e-12.
 */
function dtft(x: ArrayLike<number>, s: number, n: number, f: number, sr: number): Cx {
  const { w } = bh(n);
  const om = (TAU * f) / sr, c = (n - 1) / 2;
  const cr = Math.cos(om), ci = -Math.sin(om);
  let re = 0, im = 0, zr = 1, zi = 0;
  for (let k = 0; k < n; k++) {
    if ((k & 2047) === 0) {
      const a = -om * (k - c);
      zr = Math.cos(a);
      zi = Math.sin(a);
    }
    const v = w[k] * x[s + k];
    re += v * zr;
    im += v * zi;
    const nr = zr * cr - zi * ci;
    zi = zr * ci + zi * cr;
    zr = nr;
  }
  return { re, im };
}
const ampOf = (p: Cx, n: number): number => (2 * Math.hypot(p.re, p.im)) / bh(n).sum;
const amp = (x: ArrayLike<number>, s: number, n: number, f: number, sr: number): number => ampOf(dtft(x, s, n, f, sr), n);
/** A window [w0, w1) s as (start sample, length, centre time). */
function span(w0: number, w1: number, sr: number): { s: number; n: number; tc: number } {
  const s = Math.round(w0 * sr), n = Math.round((w1 - w0) * sr);
  return { s, n, tc: (s + (n - 1) / 2) / sr };
}
/** The window of length W centred on tc. */
function centred(tc: number, W: number, sr: number): { s: number; n: number } {
  const n = Math.round(W * sr);
  return { s: Math.round(tc * sr - (n - 1) / 2), n };
}

const FFT_N = 1 << 18;
let fftRe: Float64Array | null = null, fftIm = new Float64Array(0), fftRev = new Uint32Array(0);
let fftCos = new Float64Array(0), fftSin = new Float64Array(0);
function fftInit(): void {
  if (fftRe) return;
  const n = FFT_N, bits = Math.log2(n);
  fftRe = new Float64Array(n);
  fftIm = new Float64Array(n);
  fftRev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    fftRev[i] = r;
  }
  fftCos = new Float64Array(n / 2);
  fftSin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    fftCos[k] = Math.cos((TAU * k) / n);
    fftSin[k] = Math.sin((TAU * k) / n);
  }
}
/** The amplitude spectrum (2|X| / Σw per bin, bins 0 .. N/2) of x[s .. s + n), Blackman-Harris windowed and
 *  zero-padded to 2^18 (C8). */
function spectrum(x: ArrayLike<number>, s: number, n: number): Float64Array {
  fftInit();
  const re = fftRe as Float64Array, im = fftIm, N = FFT_N;
  const { w, sum } = bh(n);
  re.fill(0);
  im.fill(0);
  for (let k = 0; k < n; k++) re[fftRev[k]] = w[k] * x[s + k]; // bit-reversed load (the rest stays 0)
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let k = 0; k < half; k++) {
        const wr = fftCos[k * step], wi = -fftSin[k * step];
        const a = i + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  const mag = new Float64Array(N / 2 + 1);
  for (let k = 0; k <= N / 2; k++) mag[k] = (2 * Math.hypot(re[k], im[k])) / sum;
  return mag;
}
/** The peak at bin k, refined by a parabola through the three log magnitudes around it. */
function interp(mag: Float64Array, k: number, sr: number): { f: number; a: number } {
  const a = Math.log(mag[k - 1]), b = Math.log(mag[k]), c = Math.log(mag[k + 1]);
  const den = a - 2 * b + c;
  const dk = den < 0 ? (0.5 * (a - c)) / den : 0;
  return { f: ((k + dk) * sr) / FFT_N, a: Math.exp(b - 0.25 * (a - c) * dk) };
}
/** The largest peak within ±span Hz of f. */
function peakNear(mag: Float64Array, f: number, sr: number, spanHz: number): { f: number; a: number } {
  const k0 = Math.max(1, Math.floor(((f - spanHz) * FFT_N) / sr)), k1 = Math.min(mag.length - 2, Math.ceil(((f + spanHz) * FFT_N) / sr));
  let k = k0;
  for (let j = k0; j <= k1; j++) if (mag[j] > mag[k]) k = j;
  return interp(mag, k, sr);
}
/** Every local maximum above `floor`. */
function peaks(mag: Float64Array, sr: number, floor: number): Array<{ f: number; a: number }> {
  const out: Array<{ f: number; a: number }> = [];
  for (let k = 2; k < mag.length - 2; k++) {
    const v = mag[k];
    if (v > floor && v > mag[k - 1] && v >= mag[k + 1]) out.push(interp(mag, k, sr));
  }
  return out;
}

/** The instantaneous frequency near fRef at t: the phase advance between two 100 ms windows 50 ms apart. */
function instFreq(x: ArrayLike<number>, sr: number, t: number, fRef: number): number {
  const a = centred(t - 0.025, 0.1, sr), b = centred(t + 0.025, 0.1, sr);
  const pa = dtft(x, a.s, a.n, fRef, sr), pb = dtft(x, b.s, b.n, fRef, sr);
  const dt = (b.s - a.s) / sr;
  let dphi = Math.atan2(pb.im, pb.re) - Math.atan2(pa.im, pa.re) - TAU * fRef * dt;
  dphi -= TAU * Math.round(dphi / TAU);
  return fRef + dphi / (TAU * dt);
}

const wrapPi = (a: number): number => a - TAU * Math.round(a / TAU);
const db = (r: number): number => 20 * Math.log10(r);
const dbfs = (a: number): string => (a > 0 ? db(a).toFixed(1) : '−∞');
function maxAbs(x: Float32Array, n0: number, n1: number): number {
  let m = 0;
  for (let n = Math.max(0, n0); n < Math.min(x.length, n1); n++) {
    const v = Math.abs(x[n]);
    if (v > m) m = v;
  }
  return m;
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function lineFit(pts: Array<[number, number]>): { when: (y: number) => number; resid: number } {
  let mt = 0, my = 0;
  for (const [t, y] of pts) {
    mt += t;
    my += y;
  }
  mt /= pts.length;
  my /= pts.length;
  let sxx = 0, sxy = 0;
  for (const [t, y] of pts) {
    sxx += (t - mt) * (t - mt);
    sxy += (t - mt) * (y - my);
  }
  const b = sxy / sxx, a = my - b * mt;
  let resid = 0;
  for (const [t, y] of pts) resid = Math.max(resid, Math.abs(a + b * t - y));
  return { when: (y: number) => (y - a) / b, resid };
}
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------- scripts --

interface Call {
  t: number;
  run: (p: LayerPlayer, snaps: Map<string, LayerPlayerState>) => void;
  dispose?: boolean;
}
const call = (t: number, run: Call['run'], dispose = false): Call => ({ t, run, dispose });

/** §8.4's main script; a solo first mutes the other layers (both gates 0 at 0: steps). */
function mainScript(solo: LayerGains | null): Call[] {
  const s: Call[] = [];
  if (solo) s.push(call(0, (p) => p.setLayerGains(solo)));
  s.push(
    call(0, (p) => p.setHostLevel(0.8)),
    call(0, (p) => p.play(P528, 'binaural')),
    call(20, (p) => p.play(P639, 'binaural')),
    call(40, (p) => p.play(P528, 'binaural')),
    call(40.5, (p) => p.play(P639, 'binaural')),
    call(50, (p) => p.play(null)),
    call(50.4, (p) => p.play(P639, 'binaural')),
    call(60, (p) => p.play(null)),
    call(70, (p) => p.play(P639, 'binaural')),
    call(80, (p) => p.setBeat(6)),
    call(100, (p) => p.play(P639_SPK, 'pulse')),
    call(120, (p) => p.play(P639_PHN, 'pulse')),
    call(130, (p) => p.play(P639_PHN, 'off', false)),
    call(135, (p) => p.play(P639_PHN, 'pulse')),
    call(140, (p) => p.play(P639_HP6, 'binaural')),
    call(145, (p) => p.setHostLevel(0.03)),
    call(150, (p) => p.setHostLevel(0.9)),
  );
  for (let k = 0; k <= FEED_STEPS; k++) {
    const x = feedLevel(k);
    s.push(call(feedTime(k), (p) => p.setHostLevel(x)));
  }
  s.push(call(170, (p) => p.dispose(), true));
  return s;
}

const SWELL: Call[] = [
  call(0, (p) => p.setHostLevel(SWELL_HOST)),
  call(0, (p) => p.play(P528, 'binaural')),
  call(10, (p) => p.play(null)),
  call(10, (p) => p.setHostLevel(0.8)),
  call(14, (p) => p.play(P528, 'off', false)),
  call(14, (p) => p.setHostLevel(0.8)),
  call(20, (p) => p.play(P528, 'binaural')),
  call(20, (p) => p.setHostLevel(SWELL_HOST)),
  call(24, (p) => p.play(P639, 'binaural')),
  call(24, (p) => p.setHostLevel(0.8)),
  call(24.4, (p) => p.play(null)),
];

/** App's level tick after a seek (§9.8.4): {glideS: 1.5}, then resends that the φ envelope moved < 0.1 dB. */
const REMAINDER: Call[] = [
  call(0, (p) => p.setHostLevel(0.1)),
  call(0, (p) => p.play(P528, 'binaural')),
  call(10, (p) => p.setHostLevel(0.8, { glideS: 1.5 })),
  call(10.25, (p) => p.setHostLevel(0.801, { glideS: 1.5 })),
  call(10.5, (p) => p.setHostLevel(0.802, { glideS: 1.5 })),
  call(10.6, (p) => p.play(null)),
];

const DUTY: Call[] = [
  call(1, (p) => p.setLayerGains({ tone: 0, beat: 0 })),
  call(1, (p) => p.setHostLevel(0.5)),
  call(1, (p) => p.play(P528, 'binaural')),
  call(1201.5, (p) => p.setHostLevel(0.8)),
];

const MONO: Call[] = [
  call(0, (p) => p.setHostLevel(0.8)),
  call(0, (p) => p.play(P528, 'binaural')),
  call(5, (p, snaps) => snaps.set('mono', p.state())),
];

/** Each layer's closes in the swell render (C13): from each call that closes it to the end of that close. */
const SWELL_CLOSES: ReadonlyArray<{ at: number; end: number; layer: Layer }> = [
  { at: 10, end: 10.8, layer: 'tone' }, { at: 10, end: 10.8, layer: 'beat' }, { at: 10, end: 13, layer: 'drone' },
  { at: 20, end: 20.8, layer: 'tone' },
  { at: 24, end: 24.8, layer: 'tone' }, { at: 24, end: 24.8, layer: 'beat' }, { at: 24, end: 25.1925, layer: 'drone' },
  { at: 24.4, end: 24.8, layer: 'tone' }, { at: 24.4, end: 24.8, layer: 'beat' }, { at: 24.4, end: 25.1925, layer: 'drone' },
];
/** The remainder render's closes (C13c): the pause at 10.6. */
const REMAINDER_CLOSES: ReadonlyArray<{ at: number; end: number; layer: Layer }> = [
  { at: 10.6, end: 11.4, layer: 'tone' }, { at: 10.6, end: 11.4, layer: 'beat' }, { at: 10.6, end: 13.6, layer: 'drone' },
];
/** The main render's retunes (C3): the call, `at`, and a time inside the old and the new voice. */
const RETUNES: ReadonlyArray<{ T: number; at: number; oldAt: number; newAt: number }> = [
  { T: 20, at: 23.02, oldAt: 19, newAt: 32 },
  { T: 100, at: 103.02, oldAt: 99, newAt: 110 },
  { T: 130, at: 130.82, oldAt: 129, newAt: 134 },
  { T: 135, at: 135.82, oldAt: 134, newAt: 139 },
  { T: 140, at: 140.82, oldAt: 139, newAt: 150 },
];
/** [closeEnd, at] of every retune of the main render, the 60–70 s pause, and after dispose's fade (C2). */
const SILENCES: ReadonlyArray<[number, number]> = [
  [0, 0.05], [23, 23.02], [103, 103.02], [130.8, 130.82], [135.8, 135.82], [140.8, 140.82], [63, 70], [170.25, 175],
];
/** Steady 4 s windows of the main render: binaural (C5, C6, C8) and the pulse (C7, C8). */
const BIN_WINDOWS: ReadonlyArray<[number, number]> = [[10, 14], [32, 36], [152, 156], [165.5, 169.5]];
const PULSE_WINDOWS: ReadonlyArray<[number, number]> = [[110, 114], [124, 128]];

// ---------------------------------------------------------------- page ----

type Mode = 'virtual' | 'suspend';
interface Verdict {
  measured: string;
  threshold: string;
  pass: boolean;
}
interface Row extends Verdict {
  id: string;
  check: string;
  mode: Mode;
}
const rows: Row[] = [];
const timing: Array<{ render: string; mode: Mode; renderMs: number; analyseMs: number }> = [];
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const ENGINE = engineName();

function engineName(): string {
  const ua = navigator.userAgent;
  const pick = (re: RegExp, name: string): string | null => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : null;
  };
  return pick(/Edg\/(\d+)/, 'Edge') ?? pick(/Firefox\/(\d+)/, 'Firefox') ?? pick(/Chrome\/(\d+)/, 'Chrome')
    ?? pick(/Version\/(\d+).*Safari/, 'Safari') ?? 'this browser';
}

function addRow(check: string, mode: Mode, v: Verdict): void {
  const r: Row = { id: `${check}/${mode}`, check, mode, ...v };
  rows.push(r);
  const tr = document.createElement('tr');
  const cells: Array<[string, string]> = [
    [check, ''], [`${ENGINE} · ${mode}`, ''], [v.measured, 'm'], [v.threshold, 'm'], [v.pass ? 'PASS' : 'FAIL', v.pass ? 'pass' : 'fail'],
  ];
  for (const [text, cls] of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    tr.appendChild(td);
  }
  $('rows').appendChild(tr);
}
/** A row from a check; a check that throws is a failing row. */
function row(check: string, mode: Mode, fn: () => Verdict): void {
  let v: Verdict;
  try {
    v = fn();
  } catch (err) {
    v = { measured: `error: ${message(err)}`, threshold: '', pass: false };
  }
  addRow(check, mode, v);
}
function status(text: string): void {
  $('status').textContent = text;
}
function warnIfControlled(): void {
  if (!navigator.serviceWorker?.controller) return;
  const w = $('warn');
  w.style.display = 'block';
  w.textContent = 'A service worker controls this page. The app’s worker stores every navigation response as its offline shell (public/sw.js), '
    + 'so this page may now be the cached shell of this origin: run it in a private window, and open the app online once to restore the shell.';
}
/** Let the status line paint between renders. */
const yieldToPage = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// -------------------------------------------------------- instrumentation --
// C11 counts what the player asks of the engine by wrapping the prototypes while the renders run (restored in
// runAll's finally). Only a player render records: the LayerGraph control calls cancelAndHoldAtTime.

interface ParamCall {
  param: AudioParam;
  t: number;
  vt: number;
}
interface Rec {
  calls: ParamCall[];
  valueReads: number;
  cancelAndHold: number;
  starts: number;
  stopsEarly: number;
  /** When dispose() stops each oscillator. */
  disposeStops: number[];
  past: number;
  connects: Array<{ from: AudioNode; to: unknown }>;
}
let rec: Rec | null = null;
let recVt = 0; // the script time of the call being made
let recInDispose = false;
const restorers: Array<() => void> = [];
/** Which argument of each AudioParam method is its time. */
const TIME_ARG: Record<string, number> = {
  setValueAtTime: 1, linearRampToValueAtTime: 1, exponentialRampToValueAtTime: 1, setTargetAtTime: 1,
  setValueCurveAtTime: 1, cancelScheduledValues: 0, cancelAndHoldAtTime: 0,
};

function wrap(proto: object, name: string, before: (self: unknown, args: unknown[]) => void): void {
  const o = proto as Record<string, unknown>;
  const orig = o[name];
  if (typeof orig !== 'function') return;
  o[name] = function (this: unknown, ...args: unknown[]): unknown {
    if (rec) before(this, args);
    return (orig as (...a: unknown[]) => unknown).apply(this, args);
  };
  restorers.push(() => {
    o[name] = orig;
  });
}
function instrument(): void {
  for (const m of Object.keys(TIME_ARG)) {
    const k = TIME_ARG[m];
    wrap(AudioParam.prototype, m, (self, args) => {
      const r = rec as Rec, t = Number(args[k]);
      r.calls.push({ param: self as AudioParam, t, vt: recVt });
      if (m === 'cancelAndHoldAtTime') r.cancelAndHold++;
      if (!(t >= recVt - 1e-9)) r.past++;
    });
  }
  const vd = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  if (vd && vd.get && vd.set) {
    const get = vd.get, set = vd.set;
    Object.defineProperty(AudioParam.prototype, 'value', {
      configurable: true,
      enumerable: vd.enumerable,
      get(this: AudioParam): number {
        if (rec) rec.valueReads++;
        return get.call(this);
      },
      set(this: AudioParam, v: number): void {
        set.call(this, v);
      },
    });
    restorers.push(() => Object.defineProperty(AudioParam.prototype, 'value', vd));
  }
  const src = typeof AudioScheduledSourceNode === 'function' ? AudioScheduledSourceNode.prototype : OscillatorNode.prototype;
  wrap(src, 'start', () => {
    (rec as Rec).starts++;
  });
  wrap(src, 'stop', (self, args) => {
    if (recInDispose) (rec as Rec).disposeStops.push(Number(args[0]));
    else (rec as Rec).stopsEarly++;
  });
  wrap(AudioNode.prototype, 'connect', (self, args) => {
    (rec as Rec).connects.push({ from: self as AudioNode, to: args[0] });
  });
}
function restoreAll(): void {
  while (restorers.length) (restorers.pop() as () => void)();
}

// ---------------------------------------------------------------- renders --

interface Rendered {
  buf: AudioBuffer;
  rec: Rec;
  startsAtBuild: number;
  host: AudioParam | null;
  warnings: string[];
  errors: string[];
  snaps: Map<string, LayerPlayerState>;
  lags: number[];
  ms: number;
}

function byTime(script: Call[]): Array<{ t: number; calls: Call[] }> {
  const sorted = script.map((c, i) => ({ c, i })).sort((a, b) => a.c.t - b.c.t || a.i - b.i);
  const out: Array<{ t: number; calls: Call[] }> = [];
  for (const { c } of sorted) {
    const last = out[out.length - 1];
    if (last && last.t === c.t) last.calls.push(c);
    else out.push({ t: c.t, calls: [c] });
  }
  return out;
}

/** One scripted session through a fresh player on a fresh OfflineAudioContext (clock = the script's time, no tick). */
async function renderPlayer(channels: 1 | 2, sr: number, seconds: number, script: Call[], mode: Mode): Promise<Rendered> {
  const ctx = new OfflineAudioContext(channels, Math.round(seconds * sr), sr);
  const r: Rec = { calls: [], valueReads: 0, cancelAndHold: 0, starts: 0, stopsEarly: 0, disposeStops: [], past: 0, connects: [] };
  const warnings: string[] = [], errors: string[] = [], lags: number[] = [];
  const snaps = new Map<string, LayerPlayerState>();
  let vt = 0;
  rec = r;
  recVt = 0;
  recInDispose = false;
  try {
    const player = LayerPlayer.for(ctx, ctx.destination, {
      clock: () => vt,
      timer: null,
      warn: (m: string) => warnings.push(m),
      onError: (err: unknown, where: string) => errors.push(`${where}: ${message(err)}`),
    });
    const startsAtBuild = r.starts;
    const hostNode = r.connects.find((c) => c.to === ctx.destination)?.from as GainNode | undefined;
    const runAt = (t: number, calls: Call[]): void => {
      vt = t;
      recVt = t;
      for (const c of calls) {
        recInDispose = c.dispose === true;
        try {
          c.run(player, snaps);
        } catch (err) {
          errors.push(`script ${t}: ${message(err)}`);
        } finally {
          recInDispose = false;
        }
      }
    };
    const groups = byTime(script);
    const t0 = performance.now();
    let buf: AudioBuffer;
    if (mode === 'virtual') {
      for (const g of groups) runAt(g.t, g.calls);
      buf = await ctx.startRendering();
    } else {
      // Pause at the last quantum boundary before each call's time and make the call there: the engine has rendered
      // to 0–2.7 ms before the call, as a running context has (the clock runs 20 ms ahead of it). Chrome rounds a
      // suspend time up to its quantum, so ask half a quantum before the boundary.
      const Q = 128;
      const byFrame = new Map<number, Array<{ t: number; calls: Call[] }>>();
      for (const g of groups) {
        const b = Math.ceil((g.t * sr) / Q - 1e-6) * Q - Q; // (160 + 4/60) · 48000 / 128 is 60025.00000000001
        if (b <= 0) {
          runAt(g.t, g.calls); // before the first quantum: before rendering
          continue;
        }
        const list = byFrame.get(b);
        if (list) list.push(g);
        else byFrame.set(b, [g]);
      }
      for (const [b, list] of byFrame) {
        ctx.suspend((b - Q / 2) / sr).then(() => {
          const landed = Math.round(ctx.currentTime * sr);
          if (landed !== b) errors.push(`the suspend for ${list[0].t} s landed at ${ctx.currentTime} s`);
          lags.push(ctx.currentTime - list[0].t);
          for (const g of list) runAt(g.t, g.calls);
          return ctx.resume();
        }, (err: unknown) => errors.push(`suspend at ${b / sr} s: ${message(err)}`));
      }
      buf = await ctx.startRendering();
    }
    const ms = performance.now() - t0;
    rec = null;
    if (!player.disposed) player.dispose(); // a live player holds the context (outside the measurements)
    return { buf, rec: r, startsAtBuild, host: hostNode ? hostNode.gain : null, warnings, errors, snaps, lags, ms };
  } finally {
    rec = null;
  }
}

// ----------------------------------------------------------------- checks --

const fmt = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));

/** Every call and designed boundary: C1 looks ±100 ms around each. */
function clickMarks(d: Design, script: Call[]): number[] {
  const marks = new Set<number>();
  for (const t of [...script.map((c) => c.t), ...kinks(d)]) if (Number.isFinite(t) && t <= d.seconds) marks.add(t);
  return [...marks].sort((a, b) => a - b);
}

/** C1's bounds on [t0, t1] for one channel: 1.25 · Σ Â_c (2 sin(π f_c/sr) + 4/sr) + 1e-6 and
 *  1.25 · Σ Â_c ((2 sin(π f_c/sr))² + 8/sr) + 1e-6, with Â_c and f_c the component's designed maxima there. */
function clickBound(d: Design, ch: Ch, t0: number, t1: number, ks: number[]): [number, number] {
  const ts: number[] = [];
  for (let t = t0; t < t1; t += 0.001) ts.push(t);
  ts.push(t1);
  for (const k of ks) if (k > t0 && k < t1) ts.push(k, k - 1e-9);
  let b1 = 0, b2 = 0;
  for (const c of COMPS) {
    let A = 0, F = 0;
    const f = freqOf(d, c);
    for (const t of ts) {
      const a = peakAt(d, c, ch, t);
      if (a > A) A = a;
      const v = f.at(t);
      if (v > F) F = v;
    }
    if (A === 0) continue;
    const s = 2 * Math.sin((Math.PI * F) / d.sr);
    b1 += A * (s + 4 / d.sr);
    b2 += A * (s * s + 8 / d.sr);
  }
  return [1.25 * b1 + 1e-6, 1.25 * b2 + 1e-6];
}

/** C1 on one channel: the worst ratio of a first or second difference to its bound, window by window (±100 ms around
 *  each mark, the bound from the components' designed maxima in that window, §8.5). */
function clicks(x: Float32Array, d: Design, ch: Ch, marks: number[]): { ratio: number; at: number; mark: number } {
  const sr = d.sr, ks = kinks(d);
  let ratio = 0, at = 0, mark = 0;
  for (const m of marks) {
    const a = Math.max(0, m - 0.1), b = Math.min(d.seconds, m + 0.1);
    const [b1, b2] = clickBound(d, ch, a, b, ks);
    const n1 = Math.min(x.length - 1, Math.round(b * sr));
    for (let n = Math.max(1, Math.round(a * sr)); n < n1; n++) {
      const r = Math.max(Math.abs(x[n] - x[n - 1]) / b1, Math.abs(x[n + 1] - 2 * x[n] + x[n - 1]) / b2);
      if (r > ratio) {
        ratio = r;
        at = n / sr;
        mark = m;
      }
    }
  }
  return { ratio, at, mark };
}
function c1(buf: AudioBuffer, d: Design, script: Call[]): Verdict {
  const marks = clickMarks(d, script);
  const res = buf.numberOfChannels === 1
    ? [{ ch: 'mono', ...clicks(buf.getChannelData(0), d, -1, marks) }]
    : [{ ch: 'L', ...clicks(buf.getChannelData(0), d, 0, marks) }, { ch: 'R', ...clicks(buf.getChannelData(1), d, 1, marks) }];
  const worst = res.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  return {
    measured: `worst ${fmt(worst.ratio)} × bound (${worst.ch} at ${fmt(worst.at)} s, in the window of ${fmt(worst.mark)} s; `
      + `${marks.length} windows)`,
    threshold: '≤ 1 × bound (1st and 2nd difference)',
    pass: worst.ratio <= 1,
  };
}

/** C2: max |x| on [closeEnd + 1/sr, at − 1/sr] of each gap, both channels. */
function c2(buf: AudioBuffer, d: Design): Verdict {
  let worst = 0, where = '';
  for (const [a, b] of SILENCES) {
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const m = maxAbs(buf.getChannelData(ch), Math.round(a * d.sr) + 1, Math.round(b * d.sr));
      if (m > worst) {
        worst = m;
        where = ` (worst ${a}–${b} s)`;
      }
    }
  }
  return {
    measured: `max |x| ${worst === 0 ? '0' : worst.toExponential(2)} over ${SILENCES.length} gaps${where}`,
    threshold: '≤ 1e-7', pass: worst <= 1e-7,
  };
}

/** The largest windowed level within ±0.6 Hz of f: a shared component's level wherever this engine put it (Chrome
 *  holds a τ 3 s glide 0.55 Hz short of its target for 24 s; C8 judges frequencies). */
function peakLevel(x: ArrayLike<number>, s: number, n: number, f: number, sr: number): number {
  let m = 0;
  for (let k = -6; k <= 6; k++) m = Math.max(m, amp(x, s, n, f + k * 0.1, sr));
  return m;
}

/**
 * C3. A component unique to one voice is read where it must be absent on the render minus the design (the complex
 * DTFTs' difference): a gate kink inside a 3 s window spreads a ramping neighbour's spectrum far past the window's
 * sidelobes (the 39.94 Hz drone reaching full at 41.83 s reads −80.6 dBFS at 41.25 Hz on the render alone), and the
 * design carries the same spread, so only what the design lacks is left. Shared components (1 Hz) are judged by level.
 */
function c3(X: Float32Array[], D: Float32Array[], d: Design): Verdict {
  const sr = d.sr;
  let absent = 0, absentAt = 'none', shared = 0, sharedAt = 'none', nAbsent = 0, nShared = 0;
  const near = (p: Part, list: Part[]): Part | undefined => list.find((q) => Math.abs(q.f - p.f) <= 1);
  const checkAbsent = (ch: Ch, p: Part, w0: number, w1: number, what: string): void => {
    const { s, n } = span(w0, w1, sr), i = ch === 1 ? 1 : 0;
    const r = dtft(X[i], s, n, p.f, sr), q = dtft(D[i], s, n, p.f, sr);
    const a = ampOf({ re: r.re - q.re, im: r.im - q.im }, n);
    nAbsent++;
    if (a > absent || absentAt === 'none') {
      absent = Math.max(absent, a);
      absentAt = `${what}: ${p.kind} ${fmt(p.f, 2)} Hz ${ch ? 'R' : 'L'}`;
    }
  };
  const checkShared = (ch: Ch, f: number, kind: string, w0: number, w1: number, what: string): void => {
    const { s, n } = span(w0, w1, sr);
    const i = ch === 1 ? 1 : 0;
    const want = peakLevel(D[i], s, n, f, sr);
    if (want < 1e-5) return checkAbsent(ch, { f, a: 0, kind }, w0, w1, what);
    const dev = Math.abs(db(peakLevel(X[i], s, n, f, sr) / want));
    nShared++;
    if (dev > shared || sharedAt === 'none') {
      shared = Math.max(shared, dev);
      sharedAt = `${what}: ${kind} ${fmt(f, 2)} Hz ${ch ? 'R' : 'L'}`;
    }
  };
  for (const rt of RETUNES) {
    for (const ch of [0, 1] as const) {
      const old = componentsAt(d, ch, rt.oldAt), neu = componentsAt(d, ch, rt.newAt);
      const label = `${rt.T} s`;
      for (const p of old) {
        const q = near(p, neu);
        if (!q) checkAbsent(ch, p, rt.at + 0.5, rt.at + 3.5, `${label} old`);
        else {
          checkShared(ch, p.f, p.kind, rt.T - 3.5, rt.T - 0.5, `${label} before`);
          checkShared(ch, q.f, q.kind, rt.at + 0.5, rt.at + 3.5, `${label} after`);
        }
      }
      for (const p of neu) if (!near(p, old)) checkAbsent(ch, p, rt.T - 3.5, rt.T - 0.5, `${label} new`);
    }
  }
  // The revert at 40 / 40.5: p528 never sounds.
  for (const ch of [0, 1] as const) {
    const v2 = componentsAt(d, ch, 39);
    for (const p of componentsAt(d, ch, 10)) if (!near(p, v2)) checkAbsent(ch, p, 40.5, 43.5, 'revert');
  }
  return {
    measured: `unique ≤ ${dbfs(absent)} dBFS (${absentAt}; ${nAbsent} readings); shared ±${fmt(shared)} dB of design (${sharedAt}; ${nShared})`,
    threshold: 'unique ≤ −100 dBFS; shared ±0.25 dB',
    pass: absent <= 1e-5 && shared <= 0.25,
  };
}

/** C4: the render's windowed level of each component against the same reading of the designed output. */
function c4(X: Float32Array[], D: Float32Array[], d: Design, lfoOff: number, parOff: number): Verdict {
  const sr = d.sr, ks = kinks(d);
  const plans: Array<{ c: Comp; ch: 0 | 1; W: number; step: number; steady: number }> = [
    { c: 'tone', ch: 0, W: 0.02, step: 0.02, steady: TONE },
    { c: 'carrier', ch: 0, W: 0.02, step: 0.02, steady: BEAT },
    { c: 'partner', ch: 1, W: 0.02, step: 0.02, steady: BEAT },
    { c: 'drone', ch: 0, W: 0.25, step: 0.125, steady: DRONE_BASE * DRONE },
  ];
  let worst = 0, where = '', windows = 0;
  for (const p of plans) {
    const f = freqOf(d, p.c), u = p.c === 'tone' ? d.user.tone : p.c === 'drone' ? d.user.drone : d.user.beat;
    let ki = 0;
    for (let i = 1; ; i++) {
      const tc = p.W / 2 + i * p.step;
      if (tc > d.seconds - p.W) break;
      while (ki < ks.length && ks[ki] < tc - p.W) ki++;
      if (ki < ks.length && ks[ki] <= tc + p.W) continue; // within one window of a kink
      const steady = p.steady * d.host.at(tc) * u.at(tc);
      if (!(steady > 0)) continue;
      const { s, n } = centred(tc, p.W, sr);
      const fc = f.at(tc);
      const dev = Math.abs(amp(X[p.ch], s, n, fc, sr) - amp(D[p.ch], s, n, fc, sr)) / steady;
      windows++;
      if (dev > worst) {
        worst = dev;
        where = `${p.c} ${fmt(tc, 2)} s`;
      }
    }
  }
  // §8.4's values at the 20 s retune, as gate values: the render's level over the design's, × the designed gate.
  const spots: Array<[Comp, number, number]> = [['tone', 20.4, 0.02], ['drone', 21.5, 0.25], ['tone', 24.27, 0.02], ['drone', 27.02, 0.25]];
  const got = spots.map(([c, tc, W]) => {
    const { s, n } = centred(tc, W, sr);
    const fc = freqOf(d, c).at(tc);
    return (amp(X[0], s, n, fc, sr) / amp(D[0], s, n, fc, sr)) * gateOf(d, c).at(tc);
  });
  const spotOk = got.every((g) => Math.abs(g - 0.5) <= 0.02);
  return {
    measured: `worst ${fmt(worst * 100, 2)} % of steady (${where}; ${windows} windows); 20 s retune: tone ${fmt(got[0])} @20.4, `
      + `drone ${fmt(got[1])} @21.5, tone ${fmt(got[2])} @24.27, drone ${fmt(got[3])} @27.02; phases after the 80 s glide, fitted: `
      + `beat LFO ${lfoOff >= 0 ? '+' : ''}${fmt(lfoOff)} rad, partner ${parOff >= 0 ? '+' : ''}${fmt(parOff)} rad`,
    threshold: '±2 % of steady; spots 0.5 ± 0.02',
    pass: worst <= 0.02 && spotOk,
  };
}

/**
 * The beat LFO's phase as rendered minus the design's, from the pulse's lower sideband against its carrier in a
 * steady window (for sin carrier · (base + depth · sin LFO) the product C · conj(lower) has the phase of the LFO at
 * the window's centre, − π/2). Chrome holds a setTargetAtTime glide short of its target until 10 τ (a float32
 * recurrence unrolled by 4: the 80 s 10 → 6 Hz glide sits at 6.00858 Hz), so after it the LFO runs ~0.14 rad from
 * the analytic phase. Nothing designed depends on the pulse's absolute phase, so C4 takes this one.
 */
function lfoOffset(x: ArrayLike<number>, d: Design, w0: number, w1: number): number {
  const { s, n, tc } = span(w0, w1, d.sr);
  const fc = d.carrier.at(tc), r = d.beatLfo.at(tc);
  const C = dtft(x, s, n, fc, d.sr), lo = dtft(x, s, n, fc - r, d.sr);
  const psi = Math.atan2(C.im * lo.re - C.re * lo.im, C.re * lo.re + C.im * lo.im) + Math.PI / 2;
  const cyc = d.beatLfo.cycles(tc);
  return wrapPi(psi - TAU * (cyc - Math.floor(cyc)) - (tc >= d.beatLfo.offFrom ? d.beatLfo.off : 0));
}

/** A component's phase as rendered minus the design's, in a steady window where it is alone in its band: the
 *  partner's, after the same stalled glide (~9 cycles of drift), so render − design cancels its leakage in C3. */
function phaseOffset(x: ArrayLike<number>, d: Design, c: Comp, w0: number, w1: number): number {
  const { s, n, tc } = span(w0, w1, d.sr);
  const f = freqOf(d, c).at(tc), unit = new Float64Array(n);
  synthUnit(d, c, s, n, unit);
  const r = dtft(x, s, n, f, d.sr), u = dtft(unit, 0, n, f, d.sr);
  return wrapPi(Math.atan2(r.im, r.re) - Math.atan2(u.im, u.re));
}

/** Per-ear levels (C5) and binaural separation (C6) in the steady binaural windows. */
function c5c6(X: Float32Array[], d: Design): [Verdict, Verdict] {
  const sr = d.sr;
  let worst = 0, where = '', side = 0, sideAt = '', sep = Infinity, sepAt = '';
  for (const [w0, w1] of BIN_WINDOWS) {
    const { s, n, tc } = span(w0, w1, sr);
    for (const ch of [0, 1] as const) {
      for (const p of componentsAt(d, ch, tc)) {
        const dev = Math.abs(db(amp(X[ch], s, n, p.f, sr) / p.a));
        const isSide = p.kind.endsWith('pulse');
        if (isSide ? dev > side : dev > worst) {
          if (isSide) {
            side = dev;
            sideAt = `${p.kind} ${ch ? 'R' : 'L'} ${w0}–${w1} s`;
          } else {
            worst = dev;
            where = `${p.kind} ${ch ? 'R' : 'L'} ${w0}–${w1} s`;
          }
        }
      }
    }
    const fc = d.carrier.at(tc), fp = d.partner.at(tc);
    const cs = db(amp(X[0], s, n, fc, sr) / amp(X[1], s, n, fc, sr)), ps = db(amp(X[1], s, n, fp, sr) / amp(X[0], s, n, fp, sr));
    if (cs < sep) {
      sep = cs;
      sepAt = `carrier ${w0}–${w1} s`;
    }
    if (ps < sep) {
      sep = ps;
      sepAt = `partner ${w0}–${w1} s`;
    }
  }
  return [
    {
      measured: `tone/carrier/partner/drone ±${fmt(worst)} dB (${where}); drone sidebands ±${fmt(side)} dB (${sideAt})`,
      threshold: '±0.25 dB; sidebands ±0.5 dB', pass: worst <= 0.25 && side <= 0.5,
    },
    { measured: `min ${fmt(sep, 1)} dB (${sepAt})`, threshold: '≥ 60 dB', pass: sep >= 60 },
  ];
}

/** The pulse in a 4 s window: carrier level, depth from the lower sideband, rate from both sidebands' peaks, and the
 *  partner (where it would fall on the upper sideband, what is left of it once the sideband the lower one predicts —
 *  an AM's sidebands mirror each other about the carrier — is taken away). */
interface PulseReading {
  level: number;
  want: number;
  m: number;
  rate: number;
  wantRate: number;
  partner: number;
}
function pulseRead(x: ArrayLike<number>, d: Design, w0: number, w1: number): PulseReading {
  const sr = d.sr, { s, n, tc } = span(w0, w1, sr);
  const fc = d.carrier.at(tc), r = d.beatLfo.at(tc), fp = d.partner.at(tc);
  const C = dtft(x, s, n, fc, sr), lo = dtft(x, s, n, fc - r, sr), up = dtft(x, s, n, fc + r, sr);
  const ratio = Math.hypot(lo.re, lo.im) / Math.hypot(C.re, C.im);
  const mag = spectrum(x, s, n);
  const rate = (peakNear(mag, fc + r, sr, 1).f - peakNear(mag, fc - r, sr, 1).f) / 2;
  let partner: number;
  if (Math.abs(fp - (fc + r)) < 1) {
    const cc = C.re * C.re + C.im * C.im;
    const ur = (C.re * C.re - C.im * C.im) / cc, ui = (2 * C.re * C.im) / cc; // (C / |C|)²
    const pr = lo.re * ur + lo.im * ui, pi = lo.re * ui - lo.im * ur; // conj(lower) · (C / |C|)²
    partner = ampOf({ re: up.re - pr, im: up.im - pi }, n);
  } else {
    partner = amp(x, s, n, fp, sr);
  }
  return {
    level: ampOf(C, n), want: PULSE_BASE * steadyOf(d, 'carrier', 0, tc), m: (4 * ratio) / (1 + 2 * ratio),
    rate, wantRate: r, partner,
  };
}

function c7(X: Float32Array[], d: Design): Verdict {
  let lvl = 0, lr = 0, mLo = Infinity, mHi = -Infinity, rateErr = 0, partner = 0;
  for (const [w0, w1] of PULSE_WINDOWS) {
    const [l, r] = [pulseRead(X[0], d, w0, w1), pulseRead(X[1], d, w0, w1)];
    for (const p of [l, r]) {
      lvl = Math.max(lvl, Math.abs(db(p.level / p.want)));
      mLo = Math.min(mLo, p.m);
      mHi = Math.max(mHi, p.m);
      rateErr = Math.max(rateErr, Math.abs(p.rate - p.wantRate));
      partner = Math.max(partner, p.partner);
    }
    lr = Math.max(lr, Math.abs(db(l.level / r.level)));
  }
  return {
    measured: `carrier ±${fmt(lvl)} dB, |L − R| ${fmt(lr)} dB; depth ${fmt(mLo)}–${fmt(mHi)}; rate ±${fmt(rateErr)} Hz of 6; `
      + `partner ${dbfs(partner)} dBFS`,
    threshold: '±0.25 dB; ≤ 0.1 dB; 0.33–0.37; ±0.05 Hz; ≤ −100 dBFS',
    pass: lvl <= 0.25 && lr <= 0.1 && mLo >= 0.33 && mHi <= 0.37 && rateErr <= 0.05 && partner <= 1e-5,
  };
}

function c8(X: Float32Array[], d: Design): Verdict {
  const sr = d.sr;
  let err = 0, errAt = '', extra = 0, extraAt = 'none', count = 0;
  for (const [w0, w1] of [...BIN_WINDOWS, ...PULSE_WINDOWS]) {
    const { s, n, tc } = span(w0, w1, sr);
    for (const ch of [0, 1] as const) {
      const mag = spectrum(X[ch], s, n);
      const want = componentsAt(d, ch, tc).map((p) => p.f);
      for (const f of want) {
        const e = Math.abs(peakNear(mag, f, sr, 1).f - f);
        count++;
        if (e > err) {
          err = e;
          errAt = `${fmt(f, 2)} Hz ${ch ? 'R' : 'L'} ${w0}–${w1} s`;
        }
      }
      for (const pk of peaks(mag, sr, 1e-5)) {
        if (want.some((f) => Math.abs(pk.f - f) <= 3)) continue;
        if (pk.a > extra) {
          extra = pk.a;
          extraAt = `${fmt(pk.f, 2)} Hz ${ch ? 'R' : 'L'} ${w0}–${w1} s`;
        }
      }
    }
  }
  // §8.4 at 80 s: the partner glides 329.5 → 325.5 Hz with τ 3 s, read on its own ear over the first τ. Chrome
  // computes setTargetAtTime as a float32 recurrence unrolled by 4: within ±0.032 Hz of the curve for 3 s, coarser
  // (up to 0.08 Hz) as the steps near an ulp, then it holds 326.049 Hz from 86 s until 10 τ (110 s), so the note
  // below reports that stall rather than failing on it (the player schedules the glide as designed).
  const g0 = d.partner.seg(80.5), A = g0.f - g0.target;
  const taus: number[] = [];
  let glideErr = 0;
  for (const u of [0.5, 1, 1.5, 2, 2.5, 3]) {
    const t = 80 + u, want = d.partner.at(t), got = instFreq(X[1], sr, t, want);
    glideErr = Math.max(glideErr, Math.abs(got - want));
    taus.push(u / Math.log(A / (got - g0.target)));
  }
  const tau = median(taus);
  const at95 = instFreq(X[1], sr, 95, d.partner.at(95));
  return {
    measured: `max ${fmt(err, 4)} Hz off (${errAt}; ${count} components); other peaks ${extra > 0 ? `${dbfs(extra)} dBFS at ${extraAt}` : 'none'} `
      + `above −100 dBFS; glide τ ${fmt(tau, 2)} s, ±${fmt(glideErr)} Hz on 80.5–83 s (note: at 95 s this engine plays ${fmt(at95)} Hz, `
      + `design ${fmt(d.partner.at(95))}: its setTargetAtTime stalls until 10 τ)`,
    threshold: '±0.05 Hz; none above −100 dBFS beyond 3 Hz; τ 3 ± 0.3 s',
    pass: err <= 0.05 && extra === 0 && Math.abs(tau - 3) <= 0.3,
  };
}

/** C13: a closing layer's envelope never rises above its value at the call by more than +0.1 dB (or 1e-3 × steady). */
function c13(X: Float32Array[], d: Design, closes: ReadonlyArray<{ at: number; end: number; layer: Layer }>): Verdict {
  let worst = -Infinity, where = '', ok = true, readings = 0;
  const buf = new Float64Array(Math.round(0.25 * d.sr) + 1);
  for (const cl of closes) {
    const parts: Array<[Comp, 0 | 1]> = cl.layer === 'tone' ? [['tone', 0]] : cl.layer === 'beat' ? [['carrier', 0], ['partner', 1]] : [['drone', 0]];
    for (const [c, ch] of parts) {
      const W = c === 'drone' ? 0.25 : 0.02, step = c === 'drone' ? 0.025 : 0.005;
      const e0 = envelope(X[ch], d, c, cl.at, W, buf);
      const steady = steadyOf(d, c, ch, cl.at);
      if (!(e0 > 0)) continue;
      for (let k = 1; cl.at + k * step <= cl.end + 1e-9; k++) {
        const t = cl.at + k * step, e = envelope(X[ch], d, c, t, W, buf), up = db(e / e0);
        readings++;
        if (up > worst) {
          worst = up;
          where = `${c} at ${fmt(t)} s (call ${cl.at})`;
        }
        if (up > 0.1 && e - e0 > 1e-3 * steady) ok = false;
      }
    }
  }
  return {
    measured: `max ${worst >= 0 ? '+' : ''}${fmt(worst)} dB over the value at the call (${where}; ${readings} readings)`,
    threshold: '≤ +0.1 dB (or 1e-3 × steady)', pass: ok,
  };
}

/** A component's envelope at tc: the render's windowed level over the same reading of that component alone at unit
 *  level with its AM — so the drone's AM ripple (its ± pulse sidebands sit in a 250 ms window's main lobe) divides
 *  out. ≈ gate × host × user × routing × plan level. */
function envelope(x: Float32Array, d: Design, c: Comp, tc: number, W: number, buf: Float64Array): number {
  const { s, n } = centred(tc, W, d.sr);
  const f = freqOf(d, c).at(tc);
  synthUnit(d, c, s, n, buf);
  return amp(x, s, n, f, d.sr) / amp(buf, 0, n, f, d.sr);
}

/** The duty render: C10 (judged as gate values: envelope ÷ host) and C13b. */
function c10c13b(x: Float32Array, d: Design): [Verdict, Verdict] {
  const W = 0.25, buf = new Float64Array(Math.round(W * d.sr) + 1);
  const env = (t: number): number => envelope(x, d, 'drone', t, W, buf);
  const gate = (t: number): number => env(t) / (d.host.at(t) * DRONE * d.user.drone.at(t));
  const series = (a: number, b: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let k = 0; a + k * 0.05 <= b + 1e-9; k++) out.push([a + k * 0.05, gate(a + k * 0.05)]);
    return out;
  };
  const flat = (pts: Array<[number, number]>): number => pts.reduce((m, [, g]) => Math.max(m, Math.abs(g - 1)), 0);
  const before = flat(series(1195, 1200.85)), after = flat(series(1809.15, 1815));
  const close = lineFit(series(1201.15, 1203.85)), open = lineFit(series(1801.15, 1808.85));
  const tLeave = close.when(1), tZero = close.when(0), tOpen = open.when(0), tFull = open.when(1);
  const quiet = maxAbs(x, Math.round(1204.1 * d.sr), Math.round(1800.9 * d.sr));
  const c10: Verdict = {
    measured: `leaves full ${fmt(tLeave)} s, 0 by ${fmt(tZero)} s; quiet 1204.1–1800.9 s ${dbfs(quiet)} dBFS; reopens ${fmt(tOpen)} s, `
      + `full ${fmt(tFull)} s; full before/after ±${fmt(Math.max(before, after))}`,
    threshold: '1201.0 / 1204.0 / 1809.0 ± 0.05 s; ≤ −120 dBFS; ±0.02',
    pass: Math.abs(tLeave - 1201) <= 0.05 && Math.abs(tZero - 1204) <= 0.05 && Math.abs(tFull - 1809) <= 0.05
      && quiet <= 1e-6 && before <= 0.02 && after <= 0.02,
  };
  // C13b: setHostLevel(0.8) at 1201.5 lands inside the rest's close: the drone never exceeds its value then.
  const e0 = env(1201.5), steady = d.host.at(1201.5) * DRONE;
  let worst = -Infinity, at = 0, ok = true;
  for (let k = 1; 1201.5 + k * 0.025 <= 1204 + 1e-9; k++) {
    const t = 1201.5 + k * 0.025, e = env(t), up = db(e / e0);
    if (up > worst) {
      worst = up;
      at = t;
    }
    if (up > 0.1 && e - e0 > 1e-3 * steady) ok = false;
  }
  return [c10, {
    measured: `max ${worst >= 0 ? '+' : ''}${fmt(worst)} dB over the value at 1201.5 s (at ${fmt(at)} s)`,
    threshold: '≤ +0.1 dB (or 1e-3 × steady)', pass: ok,
  }];
}

/** C9: one channel. The state reports mono and the pulse, C7 holds on the channel, and the tone is the stereo one's. */
function c9(x: Float32Array, d: Design, snap: LayerPlayerState | undefined, stereoTone: number): Verdict {
  const p = pulseRead(x, d, 10, 14);
  const { s, n, tc } = span(10, 14, d.sr);
  const tone = db(amp(x, s, n, d.tone.at(tc), d.sr) / stereoTone);
  const mono = snap ? snap.mono_output : undefined, render = snap?.requested?.render;
  return {
    measured: `mono_output ${mono}, render ${render}; carrier ${fmt(db(p.level / p.want))} dB, depth ${fmt(p.m)}, rate ${fmt(p.rate)} Hz, `
      + `partner ${dbfs(p.partner)} dBFS; tone ${fmt(tone)} dB of stereo`,
    threshold: 'true, pulse; ±0.25 dB, 0.35 ± 0.02, 10 ± 0.05 Hz, ≤ −100 dBFS; ±0.25 dB',
    pass: mono === true && render === 'pulse' && Math.abs(db(p.level / p.want)) <= 0.25 && Math.abs(p.m - 0.35) <= 0.02
      && Math.abs(p.rate - 10) <= 0.05 && p.partner <= 1e-5 && Math.abs(tone) <= 0.25,
  };
}

/** What C11 adds up over a mode's player renders. */
interface Hygiene {
  players: number;
  badStarts: number[];
  cancelAndHold: number;
  valueReads: number;
  stopsEarly: number;
  past: number;
  warnings: string[];
  errors: string[];
  feed: number[];
  feedPerSecond: number;
  callsAt120: number;
  disposeStops: number[];
  lags: number[];
}
function addHygiene(h: Hygiene, r: Rendered): void {
  h.players++;
  if (r.startsAtBuild !== 6) h.badStarts.push(r.startsAtBuild);
  h.cancelAndHold += r.rec.cancelAndHold;
  h.valueReads += r.rec.valueReads;
  h.stopsEarly += r.rec.stopsEarly;
  h.past += r.rec.past;
  h.warnings.push(...r.warnings);
  h.errors.push(...r.errors);
  h.lags.push(...r.lags);
}
/** The main render's host updates during the 60 Hz feed, the 120 s call that must change nothing, and dispose. */
function mainHygiene(h: Hygiene, r: Rendered): void {
  const instants = new Set<number>();
  for (const c of r.rec.calls) if (r.host && c.param === r.host && c.vt >= 160 && c.vt <= 165 + 1e-9) instants.add(c.vt);
  h.feed = [...instants].sort((a, b) => a - b);
  const perSecond = new Map<number, number>();
  for (const t of h.feed) perSecond.set(Math.floor(t), (perSecond.get(Math.floor(t)) ?? 0) + 1);
  h.feedPerSecond = Math.max(0, ...perSecond.values());
  h.callsAt120 = r.rec.calls.filter((c) => c.vt === 120).length;
  h.disposeStops = r.rec.disposeStops;
  if (!r.host) h.errors.push('the host node was not found (no connect to the destination)');
}
function c11(h: Hygiene, anchors: number[], mode: Mode): Verdict {
  const sameAsDesign = h.feed.length === anchors.length && h.feed.every((t, i) => Math.abs(t - anchors[i]) < 1e-9);
  const stopsOk = h.disposeStops.length === 6 && h.disposeStops.every((t) => Math.abs(t - 170.3) < 1e-9); // §8.4: stop at 170.3
  const stops = stopsOk ? '6 × 170.300 s' : h.disposeStops.map((t) => fmt(t)).join(', ') || 'none';
  const lag = h.lags.length ? `; suspends ${fmt(Math.min(...h.lags) * 1000)}…${fmt(Math.max(...h.lags) * 1000)} ms from the calls` : '';
  const notes = [...h.warnings, ...h.errors];
  return {
    measured: `${h.cancelAndHold} cancelAndHold, ${h.valueReads} .value reads, ${h.stopsEarly} stops before dispose, `
      + `${h.badStarts.length ? `starts ${h.badStarts.join('/')}` : `6 starts × ${h.players}`}, ${h.past} past events; `
      + `feed: ${h.feed.length} host instants `
      + `(max ${h.feedPerSecond}/s; ${sameAsDesign ? 'as designed' : `design ${anchors.map((t) => fmt(t)).join(', ')}`}) `
      + `at ${h.feed.map((t) => fmt(t)).join(', ')}; ${h.callsAt120} calls at 120 s; dispose stops ${stops}; `
      + `${notes.length} warnings/errors${notes.length ? `: ${notes[0]}` : ''}${mode === 'suspend' ? lag : ''}`,
    threshold: '0, 0, 0, 6 each, 0; ≤ 10/s; 0; 6 × 170.3 s; 0',
    pass: h.cancelAndHold === 0 && h.valueReads === 0 && h.stopsEarly === 0 && h.badStarts.length === 0 && h.past === 0
      && h.feedPerSecond <= 10 && h.feed.length > 0 && h.callsAt120 === 0 && stopsOk && notes.length === 0,
  };
}

/** C12: the vendored LayerGraph retuning a settled voice must click — C1 fails at 20.0 s by ≥ 5× (LG-01). */
async function c12(): Promise<Verdict> {
  const sr = SR, ctx = new OfflineAudioContext(2, 26 * sr, sr);
  const graph = new LayerGraph(ctx, ctx.destination);
  graph.play(P528);
  graph.setLevel(1);
  let landed = NaN;
  ctx.suspend((20 * sr - 64) / sr).then(() => {
    landed = ctx.currentTime;
    graph.play(P639);
    return ctx.resume();
  });
  const buf = await ctx.startRendering();
  // The bound uses LayerGraph's own steady peaks (its gates fade from 1 after 20 s, so these are the window's
  // maxima): the tone, its binaural pair one tone per ear, and the drone at its AM peak.
  const bound = (beatHz: number): [number, number] => {
    let b1 = 0, b2 = 0;
    for (const [a, f] of [[TONE, P528.tone_hz], [BEAT, beatHz], [DRONE, P528.drone_hz]]) {
      const s = 2 * Math.sin((Math.PI * f) / sr);
      b1 += a * (s + 4 / sr);
      b2 += a * (s * s + 8 / sr);
    }
    return [1.25 * b1 + 1e-6, 1.25 * b2 + 1e-6];
  };
  let ratio = 0, at = 0;
  for (const [ch, f] of [[0, P528.carrier_hz], [1, P528.partner_hz]]) {
    const x = buf.getChannelData(ch), [b1, b2] = bound(f);
    for (let n = Math.round(19.9 * sr); n < Math.round(20.1 * sr); n++) {
      const r = Math.max(Math.abs(x[n] - x[n - 1]) / b1, Math.abs(x[n + 1] - 2 * x[n] + x[n - 1]) / b2);
      if (r > ratio) {
        ratio = r;
        at = n / sr;
      }
    }
  }
  const blinkLike = typeof AudioParam.prototype.cancelAndHoldAtTime === 'function';
  return {
    measured: `C1 ${fmt(ratio, 1)} × bound at ${fmt(at, 4)} s (the retune made at ${fmt(landed, 4)} s)`
      + `${blinkLike ? '' : '; no cancelAndHoldAtTime here: reported only'}`,
    threshold: '≥ 5 × bound at 20.0 ± 0.1 s (must fail)',
    pass: blinkLike ? ratio >= 5 && Math.abs(at - 20) <= 0.1 : true,
  };
}

// ---------------------------------------------------------------- the run --

/** The designs must reproduce §8.4's expected column (and §2.3's plan facts) before anything is compared with them. */
function assertDesign(): void {
  const near = (got: number, want: number, what: string, tol = 1e-9): void => {
    if (!(Math.abs(got - want) <= tol)) throw new Error(`design: ${what} is ${got}, expected ${want}`);
  };
  near(P528.tone_hz, 528, 'p528 tone');
  near(P528.carrier_hz, 264, 'p528 carrier');
  near(P528.partner_hz, 274, 'p528 partner');
  near(P528.drone_hz, 33, 'p528 drone');
  near(P528.pulse_hz, 8.25, 'p528 pulse');
  near(P639.partner_hz, 329.5, 'p639 partner');
  near(P639_HP6.partner_hz, 325.5, 'p639 partner at 6 Hz');
  for (const p of [P639_SPK, P639_PHN, P639_HP6]) {
    near(p.tone_hz, P639.tone_hz, `${p.output} tone`);
    near(p.carrier_hz, P639.carrier_hz, `${p.output} carrier`);
  }
  if (P639_SPK.drone_sub || P639_PHN.drone_sub || !P639_HP6.drone_sub || P639_PHN.drone_hz !== 0) throw new Error('design: the 639 drones');
  const m = mainDesign(ALL);
  const g = m.gateTB, dr = m.gateDrone;
  near(g.at(0.05), 0, 'gateTB 0.05');
  near(g.at(2.55), 1, 'gateTB 2.55');
  near(dr.at(8.05), 1, 'drone 8.05');
  near(g.at(20.4), 0.5, 'gateTB 20.4');
  near(dr.at(21.5), 0.5, 'drone 21.5');
  near(g.at(24.27), 0.5, 'gateTB 24.27');
  near(dr.at(27.02), 0.5, 'drone 27.02');
  near(g.at(40.5), 0.375, 'gateTB 40.5');
  near(g.at(42.0625), 1, 'gateTB 42.0625');
  near(dr.at(40.5), 0.8333, 'drone 40.5', 1e-4);
  near(dr.at(41.8333), 1, 'drone 41.8333', 1e-4);
  near(g.at(50.4), 0.5, 'gateTB 50.4');
  near(g.at(51.65), 1, 'gateTB 51.65');
  near(dr.at(50.4), 0.8667, 'drone 50.4', 1e-4);
  near(dr.at(51.4667), 1, 'drone 51.4667', 1e-4);
  near(g.at(60.8), 0, 'gateTB 60.8');
  near(dr.at(63), 0, 'drone 63');
  near(g.at(72.5), 1, 'gateTB 72.5');
  near(dr.at(78), 1, 'drone 78');
  near(m.partner.at(80), 329.5, 'partner 80');
  near(m.partner.at(83), 325.5 + 4 * Math.exp(-1), 'partner 83');
  near(g.at(133.32), 1, 'gateTB 133.32');
  near(g.at(138.32), 1, 'gateTB 138.32');
  near(dr.at(148.82), 1, 'drone 148.82');
  near(m.host.at(146.5), 0.03, 'host 146.5');
  near(m.host.at(151.5), 0.9, 'host 151.5');
  near(m.host.at(170.25), 0, 'host 170.25');
  if (m.feedAnchors.length < 2 || m.feedAnchors.some((t, i) => i > 0 && t - m.feedAnchors[i - 1] < 0.1)) throw new Error('design: the feed throttle');
  const sw = swellDesign();
  near(sw.host.at(12.99), SWELL_HOST, 'swell host 12.99');
  near(sw.host.at(13), 0.8, 'swell host 13');
  near(sw.host.at(25.19), SWELL_HOST, 'swell host 25.19', 1e-6);
  near(sw.gateDrone.at(24), 0.3975, 'swell drone 24');
  const rm = remainderDesign();
  near(rm.host.at(10.6), 0.38, 'remainder host 10.6');
  near(rm.host.at(13.59), 0.38, 'remainder host 13.59');
  near(rm.host.at(13.6), 0.802, 'remainder host 13.6');
  near(rm.gateDrone.at(13.6), 0, 'remainder drone 13.6');
  const du = dutyDesign();
  near(du.gateDrone.at(1201), 1, 'duty 1201');
  near(du.gateDrone.at(1204), 0, 'duty 1204');
  near(du.gateDrone.at(1809), 1, 'duty 1809');
  // The pulse estimators read the design's own phase, depth and no partner off a designed pulse (the mono render's).
  const mono = monoDesign(), len = Math.round(14.5 * SR), unit = new Float64Array(len);
  synthUnit(mono, 'carrier', 0, len, unit);
  near(lfoOffset(unit, mono, 10, 14), 0, 'lfoOffset on the design', 1e-6);
  const pr = pulseRead(unit, mono, 10, 14);
  if (!(pr.partner < 1e-9 && Math.abs(pr.m - 0.35) < 1e-6 && Math.abs(pr.rate - 10) < 1e-3)) {
    throw new Error(`design: pulseRead on the design (partner ${pr.partner}, depth ${pr.m}, rate ${pr.rate})`);
  }
}

async function runMode(mode: Mode): Promise<void> {
  const h: Hygiene = {
    players: 0, badStarts: [], cancelAndHold: 0, valueReads: 0, stopsEarly: 0, past: 0, warnings: [], errors: [],
    feed: [], feedPerSecond: 0, callsAt120: 0, disposeStops: [], lags: [],
  };
  const stage = async (name: string, ids: string[], fn: () => Promise<void>): Promise<void> => {
    status(`Rendering ${name} · ${mode}…`);
    await yieldToPage();
    const before = rows.length;
    try {
      await fn();
    } catch (err) {
      const done = new Set(rows.slice(before).map((r) => r.check));
      for (const id of ids) if (!done.has(id)) addRow(id, mode, { measured: `error: ${message(err)}`, threshold: '', pass: false });
    }
  };
  const time = (render: string, renderMs: number, t0: number): void => {
    timing.push({ render, mode, renderMs: Math.round(renderMs), analyseMs: Math.round(performance.now() - t0) });
  };
  let stereoTone = NaN;
  const main = mainDesign(ALL);
  await stage('main', ['C1 main', 'C2 main', 'C3 main', 'C4 main', 'C5 main', 'C6 main', 'C7 main', 'C8 main'], async () => {
    const script = mainScript(null);
    const r = await renderPlayer(2, SR, 175, script, mode);
    const t0 = performance.now();
    addHygiene(h, r);
    mainHygiene(h, r);
    const X = [r.buf.getChannelData(0), r.buf.getChannelData(1)];
    row('C1 main', mode, () => c1(r.buf, main, script));
    row('C2 main', mode, () => c2(r.buf, main));
    // The two glided oscillators' phases after 103.01 s come from the render (lfoOffset, phaseOffset); then the design.
    const lfo = lfoOffset(X[0], main, 110, 114), par = phaseOffset(X[1], main, 'partner', 152, 156);
    main.beatLfo.off = lfo;
    main.beatLfo.offFrom = main.beatLfo.seg(110).t;
    main.partner.off = par;
    main.partner.offFrom = main.partner.seg(152).t;
    const D = synthFull(main);
    row('C3 main', mode, () => c3(X, D, main));
    row('C4 main', mode, () => c4(X, D, main, lfo, par));
    const [v5, v6] = c5c6(X, main);
    row('C5 main', mode, () => v5);
    row('C6 main', mode, () => v6);
    row('C7 main', mode, () => c7(X, main));
    row('C8 main', mode, () => c8(X, main));
    const { s, n, tc } = span(10, 14, SR);
    stereoTone = amp(X[0], s, n, main.tone.at(tc), SR);
    time('main', r.ms, t0);
  });
  for (const layer of ['tone', 'beat', 'drone'] as const) {
    const u: LayerGains = { tone: 0, beat: 0, drone: 0 };
    u[layer] = 1;
    const ids = layer === 'beat' ? ['C1 beat solo', 'C7 beat solo'] : [`C1 ${layer} solo`];
    await stage(`the ${layer} solo`, ids, async () => {
      const script = mainScript(u);
      const r = await renderPlayer(2, SR, 175, script, mode);
      const t0 = performance.now();
      addHygiene(h, r);
      const d = mainDesign(u);
      row(`C1 ${layer} solo`, mode, () => c1(r.buf, d, script));
      if (layer === 'beat') {
        row('C7 beat solo', mode, () => {
          // The pulse's peak over 2 s: peak-matched to the binaural beat's 0.0708 × host (Q1).
          const want = BEAT * d.host.at(113), n0 = Math.round(112 * SR), n1 = Math.round(114 * SR);
          const got = [0, 1].map((ch) => maxAbs(r.buf.getChannelData(ch), n0, n1));
          const dev = Math.max(...got.map((g) => Math.abs(g / want - 1)));
          return {
            measured: `peak ${got.map((g) => fmt(g, 5)).join(' / ')} (L / R), ${fmt(dev * 100, 2)} % from ${fmt(want, 5)}`,
            threshold: '±1 %', pass: dev <= 0.01,
          };
        });
      }
      time(`${layer} solo`, r.ms, t0);
    });
  }
  await stage('mono', ['C9 mono'], async () => {
    const r = await renderPlayer(1, SR, 30, MONO, mode);
    const t0 = performance.now();
    addHygiene(h, r);
    row('C9 mono', mode, () => c9(r.buf.getChannelData(0), monoDesign(), r.snaps.get('mono'), stereoTone));
    time('mono', r.ms, t0);
  });
  await stage('the duty', ['C10 duty', 'C13b duty'], async () => {
    const r = await renderPlayer(1, 8000, 1900, DUTY, mode);
    const t0 = performance.now();
    addHygiene(h, r);
    const [v10, v13b] = c10c13b(r.buf.getChannelData(0), dutyDesign());
    row('C10 duty', mode, () => v10);
    row('C13b duty', mode, () => v13b);
    time('duty', r.ms, t0);
  });
  await stage('the swell', ['C13 swell'], async () => {
    const r = await renderPlayer(2, SR, 30, SWELL, mode);
    const t0 = performance.now();
    addHygiene(h, r);
    row('C13 swell', mode, () => c13([r.buf.getChannelData(0), r.buf.getChannelData(1)], swellDesign(), SWELL_CLOSES));
    time('swell', r.ms, t0);
  });
  await stage('the remainder', ['C13c remainder'], async () => {
    const r = await renderPlayer(2, SR, 15, REMAINDER, mode);
    const t0 = performance.now();
    addHygiene(h, r);
    row('C13c remainder', mode, () => c13([r.buf.getChannelData(0), r.buf.getChannelData(1)], remainderDesign(), REMAINDER_CLOSES));
    time('remainder', r.ms, t0);
  });
  row('C11 all', mode, () => c11(h, main.feedAnchors, mode));
}

async function runAll(): Promise<void> {
  const t0 = performance.now();
  warnIfControlled();
  navigator.serviceWorker?.addEventListener('controllerchange', warnIfControlled);
  const canSuspend = typeof (OfflineAudioContext.prototype as { suspend?: unknown }).suspend === 'function';
  try {
    assertDesign();
    instrument();
    try {
      await runMode('virtual');
      if (canSuspend) {
        await runMode('suspend');
        status('Rendering the LayerGraph control · suspend…');
        await yieldToPage();
        let v: Verdict;
        try {
          v = await c12();
        } catch (err) {
          v = { measured: `error: ${message(err)}`, threshold: '', pass: false };
        }
        addRow('C12 control', 'suspend', v);
      }
    } finally {
      restoreAll();
    }
  } catch (err) {
    addRow('design', 'virtual', { measured: `error: ${message(err)}`, threshold: '', pass: false });
  }
  const seconds = (performance.now() - t0) / 1000;
  const failed = rows.filter((r) => !r.pass);
  const result = $('result');
  result.textContent = failed.length === 0
    ? `ALL PASS (${rows.length})`
    : `FAIL ${failed.length}/${rows.length}: ${failed.slice(0, 5).map((r) => r.id).join(', ')}${failed.length > 5 ? ', …' : ''}`;
  result.className = failed.length ? 'fail' : 'pass';
  status(`Done in ${seconds.toFixed(1)} s${canSuspend ? '' : ' (suspend mode not supported here: virtual clock only)'}.`);
  warnIfControlled();
  (window as unknown as { __soundCheck: unknown }).__soundCheck = { engine: ENGINE, rows, seconds, timing };
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#listen button'))) b.disabled = false;
}

// ----------------------------------------------------------------- listen --
// Each scenario replays live on one AudioContext with the player's default clock and tick. They are enabled only
// after the checks, when the instrumentation is gone.

interface LivePlan {
  label: string;
  seconds: number;
  start(make: (o?: LayerPlayerOptions) => LayerPlayer, at: (t: number, fn: () => void) => void, ctx: AudioContext): void;
}
let liveCtx: AudioContext | null = null;
let livePlayer: LayerPlayer | null = null;
let liveTimers: number[] = [];
let livePoll = 0;

/** A slice of the main script: what came before `from` is applied at once, then 10 s for that voice to open fully
 *  (the drone takes 8 s) before the slice plays in real time. */
function section(label: string, from: number, to: number): LivePlan {
  const lead = from > 0 ? 10 : 0;
  return {
    label, seconds: to - from + lead,
    start(make, at) {
      const p = make();
      const script = mainScript(null), snaps = new Map<string, LayerPlayerState>();
      for (const c of script) if (c.t < from && !c.dispose) c.run(p, snaps);
      for (const c of script) {
        if (c.t >= from && c.t < to) at(c.t - from + lead, () => {
          if (livePlayer) c.run(livePlayer, snaps);
        });
      }
    },
  };
}
/** A whole script in real time: its calls at 0 at once, the rest on timers. */
function scripted(label: string, seconds: number, script: Call[]): LivePlan {
  return {
    label, seconds,
    start(make, at) {
      const p = make(), snaps = new Map<string, LayerPlayerState>();
      for (const c of script) {
        if (c.t === 0) c.run(p, snaps);
        else at(c.t, () => {
          if (livePlayer) c.run(livePlayer, snaps);
        });
      }
    },
  };
}
const LIVE: LivePlan[] = [
  section('Main 0–40 s · first play, retune 528 → 639', 0, 40),
  section('Main 40–80 s · revert, pause and resume', 40, 80),
  section('Main 80–100 s · beat glide 10 → 6 Hz', 80, 100),
  section('Pulse · main 100–130 s (speakers, then phone)', 100, 130),
  section('Tone only · main 130–145 s', 130, 145),
  section('Main 145–175 s · host jumps, 60 Hz feed, dispose', 145, 175),
  scripted('Swell · 30 s', 30, SWELL),
  scripted('Remainder · 15 s (a pause right after a seek)', 15, REMAINDER),
  {
    // The duty's 20 min on and 10 min rest are fixed in the player, so this skips them with resumeDuty: the drone
    // alone starts 12 s before a rest is due (you hear its 3 s close), then a player whose rest ends 6 s after it
    // starts takes over (you hear the 8 s reopen).
    label: 'Drone duty, shortened · 40 s', seconds: 40,
    start(make, at, ctx) {
      const solo = (p: LayerPlayer): void => {
        p.setLayerGains({ tone: 0, beat: 0 });
        p.setHostLevel(0.8);
        p.play(P528, 'binaural');
      };
      solo(make({ resumeDuty: { on_s: 1200 - 12, quiet_s: 0, rest_ends_at: null, t: ctx.currentTime } }));
      at(22, () => solo(make({ resumeDuty: { on_s: 0, quiet_s: 0, rest_ends_at: ctx.currentTime + 6, t: ctx.currentTime } })));
    },
  },
];

function stopLive(): void {
  for (const id of liveTimers) clearTimeout(id);
  liveTimers = [];
  clearInterval(livePoll);
  if (livePlayer) livePlayer.dispose();
  livePlayer = null;
  $('live').textContent = 'Stopped.';
}

async function startLive(lp: LivePlan): Promise<void> {
  stopLive();
  if (!liveCtx) liveCtx = new AudioContext();
  if (liveCtx.state !== 'running') await liveCtx.resume();
  const ctx = liveCtx, t0 = performance.now();
  const make = (o?: LayerPlayerOptions): LayerPlayer => {
    if (livePlayer) livePlayer.dispose();
    livePlayer = LayerPlayer.for(ctx, ctx.destination, {
      ...o,
      onError: (err: unknown, where: string) => console.error('sound-check listen:', where, err),
    });
    return livePlayer;
  };
  const at = (t: number, fn: () => void): void => {
    liveTimers.push(window.setTimeout(fn, t * 1000));
  };
  lp.start(make, at, ctx);
  at(lp.seconds, () => stopLive());
  livePoll = window.setInterval(() => {
    const p = livePlayer;
    if (!p) return;
    const s = p.state(), v = s.sounding;
    const voiceText = v ? ` · ${v.tone_hz} Hz ${v.render}${v.partner_hz ? `, partner ${v.partner_hz.toFixed(2)} Hz` : ''}` : '';
    $('live').textContent = `${lp.label}: ${((performance.now() - t0) / 1000).toFixed(1)} / ${lp.seconds} s · ${s.phase} · gates `
      + `${s.gates.tone_beat.toFixed(2)} / ${s.gates.drone.toFixed(2)} · host ${s.host_level.toFixed(3)}${voiceText}`
      + `${s.drone.resting ? ' · drone resting' : ''}`;
  }, 250);
}

function buildListen(): void {
  const box = $('listen');
  for (const lp of LIVE) {
    const b = document.createElement('button');
    b.textContent = lp.label;
    b.disabled = true;
    b.addEventListener('click', () => {
      startLive(lp).catch((err: unknown) => {
        $('live').textContent = `Could not start: ${message(err)}`;
      });
    });
    box.appendChild(b);
  }
  const stop = document.createElement('button');
  stop.textContent = 'Stop';
  stop.addEventListener('click', stopLive);
  box.appendChild(stop);
}

buildListen();
runAll().catch((err: unknown) => {
  $('result').textContent = `FAIL 1/1: run (${message(err)})`;
  $('result').className = 'fail';
});
