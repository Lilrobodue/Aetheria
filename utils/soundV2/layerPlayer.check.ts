// Checks for utils/soundV2/layerPlayer.ts (spec §7.1), plus the vendored files' pins.
// Run with: node utils/soundV2/layerPlayer.check.ts   (Node 22.18+ strips the types), or npm run check:sound
// Exits non-zero on any failure and lists the first 20 (scenario / engine / tick / lag).
//
// The player runs on three engines written from the Web Audio spec, not from
// ParamTrack: E-blink applies every call on its own (its intermediate states
// are audible) and, at the end of a task, moves the task's new events that lie
// before its render position τ to τ with a stable sort (Blink's
// ClampNewEventsToCurrentTime); E-gecko rounds every time to a frame and applies
// a task as one batch; E-ideal is exact and batched. Each scenario runs on every
// engine × tick {1 s, 60 s, never} × an injected lag L ∈ {−20, 0, 10, 50, 300}
// ms (E-ideal at 0 only), where L is how far τ is ahead of the player's clock
// when a task's calls land. Every run is held to A1–A8 and each scenario adds
// its own numbers; the negative controls N1–N4 must fail exactly as predicted.
//
// The checks read the player's private mirrors (ParamTracks) by name: they are
// this module's own test, and the mirror is what A3 compares with the engine.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LayerPlayer, PLAYER_VERSION, PULSE_AM_BASE, PULSE_AM_SWING, PULSE_PEAK, USER_GLIDE_S, HOST_GLIDE_S, DRONE_AM_BASE, DRONE_AM_SWING } from './layerPlayer.ts';
import type { LayerPlayerOptions, LayerPlayerState } from './layerPlayer.ts';
import { MAX_BOOST } from './layerSchedule.ts';
import type { ParamTrack } from './layerSchedule.ts';
import { plan, phiEnvelope, LayerGraph, LEVEL_TONE, LEVEL_BEAT, LEVEL_DRONE_SUB, GATE_OUT_S, DRONE_OUT_S } from './aetheria_sound_v2.ts';
import type { Plan } from './aetheria_sound_v2.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const SR = 48000;
const Q = 128 / SR; // one render quantum
const t0 = Date.now();
/** The worst margins seen, per engine, for the summary lines. */
const worst = {
  a3: { blink: 0, gecko: 0, ideal: 0 } as Record<string, number>, // |mirror − engine| on the grids
  a1: { blink: 0, gecko: 0, ideal: 0 } as Record<string, number>, // |Δ| of an audible gain at a call instant (L ≤ 0)
  lag: { blink: 0, gecko: 0, ideal: 0 } as Record<string, number>, // step at τ / its bound (L > 0)
  a2: 0, // an intermediate state's deviation / its bound (E-blink)
};

// ---------------------------------------------------------------- pins --
// The vendored files are byte-identical copies of the D: package at 832cb7e (README.md): SHA-256 of the
// LF-normalised text, so a CRLF checkout (core.autocrlf) still matches.
for (const [f, sha] of [
  ['aetheria_sound_v2.ts', '6e89330c6a2d908b1179cb41cb4bca279c652e6eb859f9a8904b165d9a6e8711'],
  ['check_vectors.ts', 'aa75e9e7c93c7bb6c53f2dd2c10d10943c524f7a8ac0d8c014d2f465e32a3f95'],
  ['test_vectors.json', '1a68687e4187023584930c8224d79ad0399666395f0f05cc13c61110bfc2cff4'],
]) {
  const text = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const got = createHash('sha256').update(text, 'utf8').digest('hex');
  check(got === sha, `pin: ${f} is the vendored copy (sha256 ${got.slice(0, 12)}… vs ${sha.slice(0, 12)}…)`);
}
check(PLAYER_VERSION === 1 && near(PULSE_AM_BASE, 0.825) && near(PULSE_AM_SWING, 0.175) && PULSE_PEAK === LEVEL_BEAT
  && near(DRONE_AM_BASE, 0.85) && near(DRONE_AM_SWING, 0.15), 'the player constants are as specified');

// ------------------------------------------------------------- engines --

type Kind = 'blink' | 'gecko' | 'ideal';
interface Ev { type: 'set' | 'lin' | 'tgt'; t: number; v: number; tau: number; at: number }

/**
 * One automation timeline, evaluated by the Web Audio spec: a set holds from
 * its time; a ramp runs from the previous event's time and value (no previous
 * event: from where the param was when the ramp was scheduled); a glide decays
 * from the value at its start; a ramp after a glide starts from the glide at
 * the time the ramp was scheduled (or replaces it if it had not started).
 */
class Timeline {
  ev: Ev[] = [];
  init: number;
  private ready = false;
  private times: number[] = [];
  private rs0: number[] = [];
  private rsv: number[] = [];
  private cv: number[] = [];
  private gi: number[] = [];
  private gs: number[] = [];

  constructor(init: number) {
    this.init = init;
  }

  touch(): void {
    this.ready = false;
  }

  private compile(): void {
    const ev = this.ev, n = ev.length;
    this.times.length = n;
    let cur = this.init, g = -1, gStart = 0, prevT = -Infinity;
    const st = (x: number): number => (g >= 0 ? ev[g].v + (gStart - ev[g].v) * Math.exp(-(x - ev[g].t) / ev[g].tau) : cur);
    for (let i = 0; i < n; i++) {
      const e = ev[i];
      this.times[i] = e.t;
      if (e.type === 'lin') {
        let s0: number, sv: number;
        if (g >= 0) {
          s0 = Math.max(ev[g].t, e.at);
          sv = st(s0);
        } else if (prevT === -Infinity) {
          s0 = e.at;
          sv = cur;
        } else {
          s0 = prevT;
          sv = cur;
        }
        this.rs0[i] = s0;
        this.rsv[i] = sv;
        cur = e.v;
        g = -1;
      } else if (e.type === 'set') {
        cur = e.v;
        g = -1;
      } else {
        gStart = st(e.t);
        g = i;
      }
      this.cv[i] = cur;
      this.gi[i] = g;
      this.gs[i] = gStart;
      prevT = e.t;
    }
    this.ready = true;
  }

  valueAt(x: number): number {
    if (!this.ready) this.compile();
    const ev = this.ev, n = ev.length, ts = this.times;
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    if (lo < n && ev[lo].type === 'lin') {
      const s0 = this.rs0[lo];
      if (x >= s0) {
        const e = ev[lo];
        return e.t > s0 ? this.rsv[lo] + (e.v - this.rsv[lo]) * ((x - s0) / (e.t - s0)) : e.v;
      }
    }
    if (lo === 0) return this.init;
    const i = lo - 1, g = this.gi[i];
    if (g >= 0) {
      const e = ev[g];
      return e.v + (this.gs[i] - e.v) * Math.exp(-(x - e.t) / e.tau);
    }
    return this.cv[i];
  }

  /** The first event time > x, or Infinity. */
  nextAfter(x: number): number {
    const k = this.upper(x);
    return k < this.ev.length ? this.ev[k].t : Infinity;
  }

  /** True when an event lies within d of x. */
  near(x: number, d: number): boolean {
    const k = this.upper(x - d);
    return k < this.ev.length && this.ev[k].t <= x + d;
  }

  /** Index of the first event with time > x. */
  upper(x: number): number {
    if (!this.ready) this.compile();
    const ts = this.times;
    let lo = 0, hi = this.ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** One AudioParam on a simulated engine. The .value getter throws (the player must never read it) unless the sim
 *  models Gecko's main-thread value (control N2); the setter only counts before any automation. */
class EParam {
  readonly sim: Sim;
  readonly tl: Timeline;
  fresh: Ev[] = [];
  moved = false;
  automated = false;
  lastCallSeq = -1;
  readonly born: number;

  constructor(sim: Sim, init: number) {
    this.sim = sim;
    this.tl = new Timeline(init);
    this.born = sim.taskSeq;
    sim.params.push(this);
  }

  protected time(t: number): number {
    return this.sim.cfg.engine === 'gecko' ? Math.round(t * SR) / SR : t;
  }

  private insert(type: Ev['type'], v: number, t: number, tau: number): void {
    const s = this.sim;
    if (s.explode) throw new Error('mock: the engine failed');
    s.called(this);
    if (!Number.isFinite(v) || !Number.isFinite(t) || (type === 'tgt' && !(Number.isFinite(tau) && tau > 0))) {
      s.nonFinite++;
      return;
    }
    if (t < s.clockT - 1e-9) s.badTimes++;
    const e: Ev = { type, t: this.time(t), v, tau, at: s.tau };
    const ev = this.tl.ev;
    let j = -1;
    for (let k = ev.length - 1; k >= 0 && ev[k].t >= e.t; k--) if (ev[k].t === e.t && ev[k].type === type) j = k;
    if (j >= 0) ev[j] = e; // same type, same time: replaced (Blink and Gecko)
    else {
      let k = ev.length;
      while (k > 0 && ev[k - 1].t > e.t) k--;
      ev.splice(k, 0, e);
    }
    this.fresh.push(e);
    this.automated = true;
    this.tl.touch();
    s.afterCall(this);
  }

  setValueAtTime(v: number, t: number): EParam {
    this.insert('set', v, t, 0);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): EParam {
    this.insert('lin', v, t, 0);
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number): EParam {
    this.insert('tgt', v, t, tau);
    return this;
  }
  cancelScheduledValues(t: number): EParam {
    const s = this.sim;
    s.called(this);
    if (!Number.isFinite(t)) {
      s.nonFinite++;
      return this;
    }
    if (t < s.clockT - 1e-9) s.badTimes++;
    const c = this.time(t);
    this.tl.ev = this.tl.ev.filter((e) => e.t < c);
    this.fresh = this.fresh.filter((e) => e.t < c);
    this.tl.touch();
    s.afterCall(this);
    return this;
  }
  get value(): number {
    this.sim.reads++;
    if (this.sim.mainThreadValue) return this.tl.valueAt(this.sim.tau);
    throw new Error('AudioParam.value read');
  }
  set value(v: number) {
    if (this.automated) this.sim.lateValueSets++;
    else {
      this.tl.init = v;
      this.tl.touch();
    }
  }

  /** The end of a task. Blink re-times the task's new events that lie before τ to τ (a stable sort). */
  endTask(): void {
    if (this.sim.cfg.engine === 'blink' && this.fresh.length > 0) {
      const tau = this.sim.tau;
      let any = false;
      for (const e of this.fresh) {
        if (e.t < tau) {
          e.t = tau;
          any = true;
        }
      }
      if (any) {
        this.tl.ev.sort((a, b) => a.t - b.t);
        this.moved = true;
        this.tl.touch();
      }
    }
    this.fresh = [];
  }
}

/** Blink and the ideal engine have cancelAndHoldAtTime (per spec, for control N1); the player calling it throws. */
class EParamHold extends EParam {
  cancelAndHoldAtTime(tc: number): EParam {
    const s = this.sim;
    s.holds++;
    if (!s.allowHold) throw new Error('cancelAndHoldAtTime called');
    s.called(this);
    const c = this.time(tc);
    const ev = this.tl.ev;
    const k = ev.findIndex((e) => e.t > c);
    if (k >= 0 && ev[k].type === 'lin') {
      // A ramp running through tc ends there, at its own value at tc.
      const v = this.tl.valueAt(c);
      this.tl.ev = [...ev.slice(0, k), { type: 'lin', t: c, v, tau: 0, at: s.tau }];
    } else {
      const keep = ev.filter((e) => e.t <= c);
      const last = keep[keep.length - 1];
      if (last && last.type === 'tgt') keep.push({ type: 'set', t: c, v: this.tl.valueAt(c), tau: 0, at: s.tau });
      this.tl.ev = keep;
    }
    this.tl.touch();
    s.afterCall(this);
    return this;
  }
}

// --------------------------------------------------------- mock graph --

type NodeKind = 'osc' | 'gain' | 'merger' | 'bus';
class MNode {
  readonly sim: Sim;
  readonly kind: NodeKind;
  outs: Array<{ to: MNode | EParam; input: number }> = [];
  disconnects = 0;
  constructor(sim: Sim, kind: NodeKind) {
    this.sim = sim;
    this.kind = kind;
    sim.nodes.push(this);
  }
  connect(to: MNode | EParam, _output = 0, input = 0): MNode | EParam {
    this.outs.push({ to, input });
    return to;
  }
  disconnect(): void {
    this.disconnects++;
    this.outs = [];
  }
}
class MOsc extends MNode {
  type = 'sine';
  readonly frequency: EParam;
  starts: number[] = [];
  stops: number[] = [];
  ended = false;
  onended: (() => void) | null = null;
  constructor(sim: Sim) {
    super(sim, 'osc');
    this.frequency = sim.param(440);
  }
  start(when = 0): void {
    this.starts.push(when);
  }
  stop(when = 0): void {
    if (!this.sim.inDispose) this.sim.stopsOutsideDispose++;
    this.stops.push(when);
  }
}
class MGain extends MNode {
  readonly gain: EParam;
  constructor(sim: Sim) {
    super(sim, 'gain');
    this.gain = sim.param(1);
  }
}
class MCtx {
  readonly sim: Sim;
  currentTime = 0;
  readonly sampleRate = SR;
  state = 'running';
  readonly destination: { maxChannelCount: number };
  failMerger = 0;
  constructor(sim: Sim, channels: number) {
    this.sim = sim;
    this.destination = { maxChannelCount: channels };
  }
  createOscillator(): MOsc {
    return new MOsc(this.sim);
  }
  createGain(): MGain {
    return new MGain(this.sim);
  }
  createChannelMerger(_n: number): MNode {
    if (this.failMerger > 0) {
      this.failMerger--;
      throw new Error('mock: createChannelMerger failed');
    }
    return new MNode(this.sim, 'merger');
  }
}

/** The peak amplitude [L, R] of oscillator o at the bus: the product of the gains on each path (an AM gain at its
 *  base plus its modulation depth), merger input i → channel i, a mono path up-mixed to L = R. */
function amplitude(sim: Sim, o: MOsc, x: number): [number, number] {
  const out: [number, number] = [0, 0];
  const walk = (n: MNode, ch: number, acc: number): void => {
    for (const c of n.outs) {
      const to = c.to;
      if (to instanceof EParam) continue; // a modulation input, not audio
      if (to.kind === 'bus') {
        if (ch < 0) {
          out[0] += acc;
          out[1] += acc;
        } else out[ch] += acc;
      } else if (to.kind === 'merger') walk(to, c.input, acc);
      else if (to.kind === 'gain') walk(to, ch, acc * sim.gainPeak(to as MGain, x));
    }
  };
  walk(o, -1, 1);
  return out;
}

// ---------------------------------------------------------------- runs --

interface RunCfg { engine: Kind; tickMs: number | null; lag: number }
type GateOf = 'tb' | 'drone' | 'both' | 'none';
interface Role {
  name: string;
  gain: boolean;
  gate: GateOf; // which gates silence it
  maxSlope: number; // designed |slope| bound (per s) while audible
  a4: 'both' | 'tb' | null; // a step here needs these gates exactly 0
  fall: 'gate' | 'user' | null; // A8: what can fall toward 0 under a host rise
  tr: ParamTrack;
  gTB: EParam;
  gD: EParam;
}
interface Rec {
  player: LayerPlayer;
  seq: number;
  byName: Map<string, { tr: ParamTrack; p: EParam; role: Role }>;
  list: Array<{ tr: ParamTrack; p: EParam; role: Role }>;
  oscs: MOsc[];
  hostNode: MGain;
}
const TRACK_NAMES = ['fTone', 'fCarrier', 'fPartner', 'fBeatLfo', 'fDrone', 'fDroneLfo', 'cL', 'cR', 'pL', 'pR', 'amBase', 'amDepth',
  'tonePlan', 'beatPlan', 'dronePlan', 'gateTB', 'gateDrone', 'host'];
const COMPONENTS: Array<[string, number, number]> = [['tone', 0, LEVEL_TONE], ['carrier', 1, LEVEL_BEAT], ['partner', 2, LEVEL_BEAT],
  ['drone', 4, LEVEL_DRONE_SUB]];

function roleOf(name: string, tr: ParamTrack, gTB: EParam, gD: EParam): Role {
  const r = (gain: boolean, gate: GateOf, maxSlope: number, a4: Role['a4'], fall: Role['fall']): Role => ({ name, gain, gate, maxSlope, a4, fall, tr, gTB, gD });
  switch (name) {
    case 'gateTB': return r(true, 'none', 1 / GATE_OUT_S, null, 'gate');
    case 'gateDrone': return r(true, 'none', 1 / DRONE_OUT_S, null, 'gate');
    case 'host': return r(true, 'both', 20, null, null); // glideS ≥ 0.05 s over at most 1
    case 'toneUser': case 'beatUser': return r(true, 'tb', MAX_BOOST / USER_GLIDE_S, null, 'user');
    case 'droneUser': return r(true, 'drone', MAX_BOOST / USER_GLIDE_S, null, 'user');
    case 'dronePlan': return r(true, 'drone', 0, 'both', null);
    case 'fPartner': case 'fBeatLfo': return r(false, 'tb', Infinity, 'tb', null);
    case 'fTone': case 'fCarrier': case 'fDrone': case 'fDroneLfo': return r(false, 'both', Infinity, 'both', null);
    default: return r(true, 'tb', 0, 'both', null); // routing, AM, tone and beat plan levels: silent steps only
  }
}

interface Scenario {
  name: string;
  end: number;
  mono?: boolean;
  steps: Array<[number, (s: Sim) => void]>;
  probes?: Array<[number, (s: Sim) => void]>;
  final?: (s: Sim) => void; // engine values: runs with L ≤ 0 only (their final timelines are what was rendered)
  warnings?: number;
}

class Sim {
  readonly cfg: RunCfg;
  readonly label: string;
  readonly ctx: MCtx;
  readonly bus: MNode;
  readonly params: EParam[] = [];
  readonly nodes: MNode[] = [];
  readonly recs: Rec[] = [];
  readonly roles = new Map<EParam, Role>();
  readonly fails = new Map<string, string>();
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  readonly taskLog: Array<{ t: number; calls: number; seq: number }> = [];
  readonly callTimes = new Map<EParam, number[]>();
  clockT = 0;
  tau = 0;
  inTask = false;
  inDispose = false;
  taskSeq = 0;
  taskT = 0;
  taskCalls = 0;
  holds = 0;
  reads = 0;
  badTimes = 0;
  nonFinite = 0;
  lateValueSets = 0;
  stopsOutsideDispose = 0;
  allowHold = false;
  mainThreadValue = false;
  explode = false;
  readonly tol: number;
  private partials: Array<{ p: EParam; v0: number; v1: number }> = [];
  private readonly mods = new Map<EParam, MGain[]>();
  private readonly timers = new Map<number, { fn: () => void; ms: number; next: number }>();
  private timerSeq = 0;
  readonly timer = {
    set: (fn: () => void, ms: number): unknown => {
      const id = ++this.timerSeq;
      this.timers.set(id, { fn, ms, next: this.clockT + ms / 1000 });
      return id;
    },
    clear: (id: unknown): void => {
      this.timers.delete(id as number);
    },
  };

  constructor(cfg: RunCfg, label: string, channels = 2) {
    this.cfg = cfg;
    this.label = label;
    this.tol = cfg.engine === 'gecko' ? 1e-4 : 1e-9;
    this.ctx = new MCtx(this, channels);
    this.bus = new MNode(this, 'bus');
  }

  param(init: number): EParam {
    return this.cfg.engine === 'gecko' ? new EParam(this, init) : new EParamHold(this, init);
  }

  fail(key: string, msg: string): void {
    if (!this.fails.has(key)) this.fails.set(key, msg);
  }
  expect(ok: boolean, what: string): void {
    check(ok, `${this.label}: ${what}`);
  }

  // ----------------------------------------------------- players and names --

  /** A player on this sim's context with the virtual clock and timer (LayerPlayer.for, as App does). */
  make(extra?: Partial<LayerPlayerOptions>): LayerPlayer {
    const opts: LayerPlayerOptions = {
      clock: () => this.clockT,
      timer: this.cfg.tickMs === null ? null : this.timer,
      tickMs: this.cfg.tickMs ?? 1000,
      warn: (m: string) => this.warnings.push(m),
      onError: (e: unknown, w: string) => this.errors.push(`onError(${w}): ${e instanceof Error ? e.message : String(e)}`),
      ...extra,
    };
    const p = LayerPlayer.for(this.ctx as unknown as BaseAudioContext, this.bus as unknown as AudioNode, opts);
    if (!this.recs.some((r) => r.player === p)) this.register(p);
    return p;
  }

  private register(p: LayerPlayer): void {
    const P = p as unknown as Record<string, ParamTrack> & { users: Record<string, { track: ParamTrack }>; oscs: MOsc[]; hostNode: MGain };
    const tracks = new Map<string, ParamTrack>();
    for (const n of TRACK_NAMES) tracks.set(n, P[n]);
    for (const k of ['tone', 'beat', 'drone']) tracks.set(`${k}User`, P.users[k].track);
    const eng = (tr: ParamTrack): EParam => (tr as unknown as { param: EParam }).param;
    const gTB = eng(tracks.get('gateTB')), gD = eng(tracks.get('gateDrone'));
    const rec: Rec = { player: p, seq: this.taskSeq, byName: new Map(), list: [], oscs: P.oscs, hostNode: P.hostNode };
    for (const [name, tr] of tracks) {
      const e = { tr, p: eng(tr), role: roleOf(name, tr, gTB, gD) };
      rec.byName.set(name, e);
      rec.list.push(e);
      this.roles.set(e.p, e.role);
    }
    this.recs.push(rec);
  }

  get p(): LayerPlayer {
    return this.recs[this.recs.length - 1].player;
  }
  rec(i?: number): Rec {
    return this.recs[i ?? this.recs.length - 1];
  }
  /** The engine value of a named param of player i (default the last) at x. */
  e(name: string, x: number, i?: number): number {
    return this.rec(i).byName.get(name).p.tl.valueAt(x);
  }
  /** The engine amplitude [L, R] of a component at x. */
  amp(comp: string, x: number, i?: number): [number, number] {
    const c = COMPONENTS.find((k) => k[0] === comp);
    return amplitude(this, this.rec(i).oscs[c[1]], x);
  }
  /** The value steps of a named param in [a, b]: [time, from, to]. */
  steps(name: string, a: number, b: number, i?: number): Array<[number, number, number]> {
    const tl = this.rec(i).byName.get(name).p.tl;
    const out: Array<[number, number, number]> = [];
    let last = -Infinity;
    for (const e of tl.ev) {
      if (e.type !== 'set' || e.t < a || e.t > b || e.t === last) continue;
      const from = tl.valueAt(e.t - 1e-7), to = tl.valueAt(e.t);
      if (Math.abs(to - from) > 1e-12) {
        out.push([e.t, from, to]);
        last = e.t;
      }
    }
    return out;
  }
  /** The task times in [a, b] at which a named param got at least one engine call. */
  callsIn(name: string, a: number, b: number, i?: number): number[] {
    return (this.callTimes.get(this.rec(i).byName.get(name).p) ?? []).filter((t) => t >= a - 1e-9 && t <= b + 1e-9);
  }
  /** Engine calls made by the task(s) at time t. */
  callsAt(t: number): number {
    return this.taskLog.filter((k) => Math.abs(k.t - t) < 1e-9).reduce((n, k) => n + k.calls, 0);
  }
  st(): LayerPlayerState {
    return this.p.state();
  }
  dispose(p: LayerPlayer = this.p): void {
    this.inDispose = true;
    try {
      p.dispose();
    } finally {
      this.inDispose = false;
    }
  }

  gainPeak(g: MGain, x: number): number {
    let mods = this.mods.get(g.gain);
    if (!mods) {
      mods = this.nodes.filter((n): n is MGain => n.kind === 'gain' && n.outs.some((c) => c.to === g.gain)) as MGain[];
      this.mods.set(g.gain, mods);
    }
    let v = g.gain.tl.valueAt(x);
    for (const m of mods) v += Math.abs(m.gain.tl.valueAt(x));
    return v;
  }

  // ------------------------------------------------------------ engine hooks --

  called(p: EParam): void {
    if (!this.inTask) return;
    if (this.pre === null) this.snapshot(); // the state just before a task's first call is the state before the task
    this.taskCalls++;
    p.lastCallSeq = this.taskSeq;
    let list = this.callTimes.get(p);
    if (!list) {
      list = [];
      this.callTimes.set(p, list);
    }
    if (list[list.length - 1] !== this.taskT) list.push(this.taskT);
  }

  /** E-blink: every call is applied on its own, so each intermediate state may render (A2). */
  afterCall(p: EParam): void {
    if (!this.inTask || this.cfg.engine !== 'blink') return;
    const role = this.roles.get(p);
    if (!role || !role.gain) return;
    this.partials.push({ p, v0: p.tl.valueAt(this.taskT), v1: p.tl.valueAt(this.taskT + Q) });
  }

  // ------------------------------------------------------------------ tasks --

  private silentAt(role: Role, x: number, preTB: Map<EParam, number> | null): boolean {
    const tb = (preTB ? preTB.get(role.gTB) === 0 : true) && role.gTB.tl.valueAt(x) === 0;
    const dr = (preTB ? preTB.get(role.gD) === 0 : true) && role.gD.tl.valueAt(x) === 0;
    return role.gate === 'tb' ? tb : role.gate === 'drone' ? dr : role.gate === 'both' ? tb && dr : false;
  }

  private pre: { gains: EParam[]; T: Map<EParam, number>; Tq: Map<EParam, number>; Tau: Map<EParam, number>; Mid: Map<EParam, number>; amp: number[][] } | null = null;

  /** The values A1 and A2 compare with, taken at a task's first engine call (a task without calls changes nothing). */
  private snapshot(): void {
    const t = this.taskT, tau = this.tau;
    const gains = this.params.filter((p) => p.born !== this.taskSeq && this.roles.get(p)?.gain);
    const T = new Map<EParam, number>(), Tq = new Map<EParam, number>(), Tau = new Map<EParam, number>(), Mid = new Map<EParam, number>();
    for (const p of gains) {
      T.set(p, p.tl.valueAt(t));
      Tq.set(p, p.tl.valueAt(t + Q));
      Tau.set(p, p.tl.valueAt(tau));
      Mid.set(p, p.tl.valueAt((t + tau) / 2));
    }
    const amp = this.recs.map((r) => (r.seq === this.taskSeq ? [] : COMPONENTS.flatMap(([, i]) => amplitude(this, r.oscs[i], t))));
    this.pre = { gains, T, Tq, Tau, Mid, amp };
  }

  /** One task (a script call or a tick): all its calls land with the engine at τ = t + L. A1 and A2 are checked on
   *  the way. */
  task(t: number, fn: () => void): void {
    this.clockT = t;
    this.tau = t + this.cfg.lag;
    this.ctx.currentTime = t;
    this.taskT = t;
    this.taskSeq++;
    this.taskCalls = 0;
    this.partials = [];
    this.pre = null;
    const L = this.cfg.lag, tau = this.tau;
    this.inTask = true;
    try {
      fn();
    } catch (err) {
      this.errors.push(`task at ${t} threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.inTask = false;
    for (const p of this.params) p.endTask();
    this.taskLog.push({ t, calls: this.taskCalls, seq: this.taskSeq });
    const pre = this.pre;
    this.pre = null;
    if (pre === null) return; // no engine call: nothing changed
    const { gains, T: preT, Tq: preTq, Tau: preTau, Mid: preMid, amp: preAmp } = pre;

    for (const p of gains) {
      const role = this.roles.get(p);
      // A designed silent step (both its gates 0 at the call, before and after it) is not a click. With L > 0 Gecko
      // renders it from τ, where an opening gate may already be up: that jump is the gate's, judged on the gate.
      if (this.silentAt(role, t, preT)) continue;
      if (L <= 0) {
        // At the call, and (L < 0) over [τ, t]: the engine has yet to render those, so nothing there may change.
        const d = Math.max(Math.abs(p.tl.valueAt(t) - preT.get(p)), Math.abs(p.tl.valueAt(tau) - preTau.get(p)),
          Math.abs(p.tl.valueAt((t + tau) / 2) - preMid.get(p)));
        worst.a1[this.cfg.engine] = Math.max(worst.a1[this.cfg.engine], d);
        if (d >= 1e-3) this.fail('A1', `A1: ${role.name} steps ${d.toExponential(3)} at the call at ${t} (L ${L * 1000} ms)`);
      } else {
        // The engine is ahead: Blink renders the old curve to τ and then the moved anchor (a step of the old slope ×
        // L); Gecko evaluates the new curve from τ (|Δslope| × L). A designed breakpoint inside (t, τ) arrives whole.
        const step = Math.abs(p.tl.valueAt(tau) - preTau.get(p));
        const tr = role.tr;
        const inside = tr.events.some((e) => e.t > t && e.t < tau);
        const oldD = Math.abs(preTau.get(p) - preT.get(p)), newD = Math.abs(tr.valueAt(tau) - tr.valueAt(t));
        let bound: number;
        if (inside) bound = oldD + newD + 1e-3;
        else if (this.cfg.engine === 'blink') bound = oldD + 1e-3;
        else {
          const sNew = (tr.valueAt(t + Q) - tr.valueAt(t)) / Q, sOld = (preTq.get(p) - preT.get(p)) / Q;
          bound = Math.abs(sNew - sOld) * L + 1e-3;
        }
        worst.lag[this.cfg.engine] = Math.max(worst.lag[this.cfg.engine], step / bound);
        if (step > bound) this.fail('A1-lag', `A1 (L=${L * 1000} ms): ${role.name} steps ${step.toExponential(3)} at τ ${tau} (bound ${bound.toExponential(3)})`);
      }
    }
    if (L <= 0) {
      this.recs.forEach((r, ri) => {
        if (r.seq === this.taskSeq || !preAmp[ri] || preAmp[ri].length === 0) return; // built in this task
        COMPONENTS.forEach(([name, i, level], ci) => {
          const a = amplitude(this, r.oscs[i], t);
          for (let ch = 0; ch < 2; ch++) {
            const d = Math.abs(a[ch] - preAmp[ri][ci * 2 + ch]);
            if (d >= 1e-3 * level) this.fail('A1', `A1: the ${name} amplitude (ch ${ch}) steps ${d.toExponential(3)} at the call at ${t}`);
          }
        });
      });
    }
    // A2 (E-blink): no intermediate state may jump. The bound's slope is 4/s or the steepest designed slope at t (a
    // stop's 0.1 s fall from 0.8 is 8/s). With L > 0 an earlier task's moved anchor leaves the engine off the mirror
    // until that segment ends (A3 allows it), and every anchor takes the mirror's value: that offset is allowed too.
    for (const { p, v0, v1 } of this.partials) {
      const role = this.roles.get(p);
      if (!preT.has(p) || (this.silentAt(role, t, preT) && this.silentAt(role, t + Q, preTq))) continue;
      const sPre = Math.abs(preTq.get(p) - preT.get(p)) / Q, sNew = Math.abs(role.tr.valueAt(t + Q) - role.tr.valueAt(t)) / Q;
      const S = Math.max(4, sPre, sNew);
      const off = L > 0 ? Math.abs(role.tr.valueAt(t) - preT.get(p)) : 0;
      const d0 = Math.abs(v0 - preT.get(p)), d1 = Math.abs(v1 - preT.get(p));
      worst.a2 = Math.max(worst.a2, d0 / (off + 1e-3), d1 / (S * Q + off + 1e-3));
      if (d0 > off + 1e-3 || d1 > S * Q + off + 1e-3) this.fail('A2', `A2: an intermediate state of ${role.name} jumps ${Math.max(d0, d1).toExponential(3)} at ${t}`);
    }
  }

  // ---------------------------------------------------------------- windows --

  /** A3 between two tasks: the mirror equals the engine on the grid (1 ms within ±1 s of an API call, a call on the
   *  param or one of its events; 50 ms elsewhere), and no mirror step beats its designed slope. */
  window(a: number, b: number, apiCall: boolean): void {
    if (!(b > a)) return;
    const L = this.cfg.lag, gecko = this.cfg.engine === 'gecko';
    const tol = gecko ? 1e-4 : 1e-9;
    const pts: number[] = [];
    for (const r of this.recs) {
      for (const { tr, p, role } of r.list) {
        let start = a;
        if (L > 0 && p.moved) start = p.tl.nextAfter(this.tau);
        if (!(start < b)) continue;
        const anchors: number[] = apiCall || p.lastCallSeq === this.taskSeq ? [a] : [];
        for (let k = p.tl.upper(start - 1 - 1e-9); k < p.tl.ev.length && p.tl.ev[k].t <= b + 1; k++) anchors.push(p.tl.ev[k].t);
        const mev = tr.events;
        for (let k = mev.length - 1; k >= 0 && mev[k].t >= start - 1; k--) if (mev[k].t <= b + 1) anchors.push(mev[k].t);
        const ramps: Array<[number, number]> = [];
        moving(p.tl.ev, start, b, ramps);
        moving(mev, start, b, ramps);
        grid(start, b, anchors, ramps, pts);
        let prevX = NaN, prevM = NaN;
        for (const x of pts) {
          const m = tr.valueAt(x);
          if (!(gecko && p.tl.near(x, 2 / SR))) {
            const d = Math.abs(m - p.tl.valueAt(x));
            if (d > worst.a3[this.cfg.engine]) worst.a3[this.cfg.engine] = d;
            if (d > tol) this.fail('A3', `A3: ${role.name} mirror ${m} vs engine ${p.tl.valueAt(x)} at ${x} (Δ ${d.toExponential(2)})`);
          }
          if (role.gain && x - prevX > 0 && x - prevX < 1.5e-3 && Math.abs(m - prevM) > role.maxSlope * (x - prevX) + 1e-9
            && !this.silentStep(role, prevX, x)) {
            this.fail('A3', `A3: the ${role.name} mirror steps ${Math.abs(m - prevM).toExponential(3)} between ${prevX} and ${x}`);
          }
          prevX = x;
          prevM = m;
        }
      }
    }
    if (L > 0) this.rendered(a + L, b + L);
  }

  /** True when the mirror's change over (x0, x1] is a designed silent step: a set there with the layer's gates
   *  exactly 0 (mirror) at its time. */
  private silentStep(role: Role, x0: number, x1: number): boolean {
    const gTB = this.roles.get(role.gTB).tr, gD = this.roles.get(role.gD).tr;
    let found = false;
    for (const e of role.tr.events) {
      if (e.t <= x0 || e.t > x1 || e.type !== 'set') continue;
      const tb = gTB.valueAt(e.t) === 0, dr = gD.valueAt(e.t) === 0;
      const ok = role.gate === 'tb' ? tb : role.gate === 'drone' ? dr : role.gate === 'both' ? tb && dr : false;
      if (!ok) return false;
      found = true;
    }
    return found;
  }

  /**
   * A4, A5 and A8 on what the engine renders over [lo, hi) — the final timelines at L ≤ 0 (no call ever changes
   * anything before its own time), the state after each task at L > 0.
   */
  rendered(lo: number, hi: number): void {
    const L = this.cfg.lag;
    for (const r of this.recs) {
      const P = (n: string): EParam => r.byName.get(n).p;
      const gTB = P('gateTB').tl, gD = P('gateDrone').tl;
      const zeroOver = (tl: Timeline, x0: number, x1: number): boolean => {
        if (tl.valueAt(x0) !== 0 || tl.valueAt(x1) !== 0) return false;
        for (const e of tl.ev) if (e.t > x0 && e.t < x1 && tl.valueAt(e.t) !== 0) return false;
        return true;
      };
      // A4: frequency, routing and plan-level steps only where the gates are exactly 0.
      for (const { p, role } of r.list) {
        if (!role.a4) continue;
        for (const e of p.tl.ev) {
          if (e.type !== 'set' || e.t < lo || e.t >= hi) continue;
          if (Math.abs(p.tl.valueAt(e.t) - p.tl.valueAt(e.t - 1e-7)) <= 1e-12) continue;
          const m = L <= 0 && role.a4 === 'both' ? 0.005 : 0;
          const ok = zeroOver(gTB, e.t - m, e.t + m) && (role.a4 === 'tb' || zeroOver(gD, e.t - m, e.t + m));
          if (!ok) this.fail('A4', `A4: ${role.name} steps at ${e.t} with gateTB ${gTB.valueAt(e.t)} / drone ${gD.valueAt(e.t)}`);
        }
      }
      // A5: one pitch — the partner never shares a channel with the carrier, and is routed only for a binaural beat.
      const xs = [lo];
      for (const n of ['cL', 'cR', 'pL', 'pR', 'amDepth']) for (const e of P(n).tl.ev) if (e.t >= lo && e.t < hi) xs.push(e.t);
      for (const x of xs) {
        const cl = P('cL').tl.valueAt(x), cr = P('cR').tl.valueAt(x), pl = P('pL').tl.valueAt(x), pr = P('pR').tl.valueAt(x);
        const amd = P('amDepth').tl.valueAt(x);
        if ((pl > 0 && cl > 0) || (pr > 0 && cr > 0) || ((pl > 0 || pr > 0) && amd > 0)) {
          this.fail('A5', `A5: routing cL ${cl} cR ${cr} pL ${pl} pR ${pr} amDepth ${amd} at ${x}`);
        }
      }
      // A8: no host rise lands while an audible gate or user gain falls toward 0.
      const host = P('host').tl;
      const falls: Array<[number, number, string, Timeline]> = []; // [start, end, name, the gate that makes it audible]
      for (const { p, role } of r.list) {
        if (!role.fall) continue;
        const tl = p.tl;
        const bp = [lo, ...tl.ev.map((e) => e.t).filter((t) => t > lo && t < hi), hi];
        const audibleBy = role.fall === 'gate' ? tl : role.gate === 'drone' ? gD : gTB;
        let run: Array<[number, number]> = [];
        const flush = (endV: number): void => {
          if (run.length && (role.fall === 'gate' || endV <= 1e-12)) for (const [s, e] of run) falls.push([s, e, role.name, audibleBy]);
          run = [];
        };
        for (let k = 0; k + 1 < bp.length; k++) {
          const s = bp[k], e = bp[k + 1];
          if (!(e > s)) continue;
          const vs = tl.valueAt(s), ve = tl.valueAt(e - 1e-9);
          if (ve < vs - 1e-12) run.push([s, e]);
          else flush(vs);
        }
        flush(tl.valueAt(hi - 1e-9));
      }
      const hb = [lo, ...host.ev.map((e) => e.t).filter((t) => t > lo && t < hi), hi];
      for (let k = 0; k + 1 < hb.length; k++) {
        const s = hb[k], e = hb[k + 1];
        if (!(e > s)) continue;
        if (host.valueAt(e - 1e-9) <= host.valueAt(s) + 1e-12) continue;
        for (const [fs, fe, name, aud] of falls) {
          const o0 = Math.max(s, fs), o1 = Math.min(e, fe);
          if (o1 - o0 > 1e-9 && aud.valueAt((o0 + o1) / 2) > 0) {
            this.fail('A8', `A8: the host rises over [${s}, ${e}] while ${name} falls over [${fs}, ${fe}]`);
          }
        }
      }
      for (const e of host.ev) {
        if (e.type !== 'set' || e.t < lo || e.t >= hi) continue;
        if (host.valueAt(e.t) <= host.valueAt(e.t - 1e-7) + 1e-12) continue;
        for (const [fs, fe, name, aud] of falls) {
          if (fs < e.t && e.t < fe && aud.valueAt(e.t) > 0) this.fail('A8', `A8: the host steps up at ${e.t} while ${name} falls`);
        }
      }
    }
  }

  // -------------------------------------------------------------------- run --

  activeTimers(): number {
    return this.timers.size;
  }

  /** Run a scenario's own checks; one that throws on an unexpected state (a null snapshot) is a failed check. */
  guarded(what: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.expect(false, `${what} threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private nextTimer(): number {
    let n = Infinity;
    for (const t of this.timers.values()) if (t.next < n) n = t.next;
    return n;
  }

  private nextEnded(): number {
    let n = Infinity;
    for (const o of this.nodes) {
      if (o.kind !== 'osc') continue;
      const m = o as MOsc;
      if (!m.ended && m.stops.length) n = Math.min(n, m.stops[m.stops.length - 1]);
    }
    return n;
  }

  run(sc: Scenario): void {
    const acts = [
      ...sc.steps.map(([t, fn], i) => ({ t, fn, probe: false, i })),
      ...(sc.probes ?? []).map(([t, fn], i) => ({ t, fn, probe: true, i: i + 1e6 })),
    ].sort((x, y) => x.t - y.t || x.i - y.i);
    let i = 0;
    let last: number | null = null;
    let lastApi = false;
    for (;;) {
      const tA = i < acts.length ? acts[i].t : Infinity, tT = this.nextTimer(), tE = this.nextEnded();
      const t = Math.min(tA, tT, tE);
      if (!(t <= sc.end)) break;
      if (tA === t) {
        const a = acts[i++];
        if (a.probe) {
          this.clockT = t;
          this.tau = t + this.cfg.lag;
          this.guarded(`the probe at ${t}`, () => a.fn(this));
          continue;
        }
        if (last !== null) this.window(last, t, lastApi);
        this.task(t, () => a.fn(this));
        last = t;
        lastApi = true;
      } else if (tT === t) {
        const [id, tm] = [...this.timers.entries()].find(([, x]) => x.next === t);
        tm.next += tm.ms / 1000;
        if (last !== null) this.window(last, t, lastApi);
        this.task(t, () => {
          if (this.timers.has(id)) tm.fn();
        });
        last = t;
        lastApi = false;
      } else {
        for (const o of this.nodes) {
          const m = o as MOsc;
          if (o.kind === 'osc' && !m.ended && m.stops.length && m.stops[m.stops.length - 1] === t) {
            m.ended = true;
            m.onended?.();
          }
        }
      }
    }
    if (last !== null) this.window(last, sc.end, lastApi);
    if (this.cfg.lag <= 0) this.rendered(0, sc.end);
    // A6: hygiene.
    if (this.holds) this.fail('A6', `A6: ${this.holds} cancelAndHoldAtTime calls`);
    if (this.reads) this.fail('A6', `A6: ${this.reads} AudioParam.value reads`);
    if (this.badTimes) this.fail('A6', `A6: ${this.badTimes} event times before the player's clock`);
    if (this.nonFinite) this.fail('A6', `A6: ${this.nonFinite} non-finite values or times reached a param`);
    if (this.lateValueSets) this.fail('A6', `A6: ${this.lateValueSets} .value sets after automation`);
    if (this.stopsOutsideDispose) this.fail('A6', `A6: ${this.stopsOutsideDispose} stop() calls outside dispose()`);
    for (const r of this.recs) {
      const ok = r.oscs.length === 6 && r.oscs.every((o) => o.starts.length === 1);
      if (!ok) this.fail('A6', `A6: the player built at task ${r.seq} started ${r.oscs.map((o) => o.starts.length).join('/')} oscillators`);
    }
    if (this.errors.length) this.fail('errors', `errors: ${this.errors.slice(0, 3).join('; ')}`);
    const wantWarn = sc.warnings ?? 0;
    if (this.warnings.length !== wantWarn) this.fail('warnings', `${this.warnings.length} warnings (expected ${wantWarn}): ${this.warnings.slice(0, 2).join('; ')}`);
    if (this.cfg.lag <= 0 && sc.final) this.guarded('the final checks', () => sc.final(this));
    // Leave the global registry as it was: these players' contexts are gone.
    const reg = (globalThis as unknown as Record<symbol, LayerPlayer[] | undefined>)[Symbol.for('aetheria.soundV2.layerPlayers.v1')];
    if (reg) for (const r of this.recs) { const k = reg.indexOf(r.player); if (k >= 0) reg.splice(k, 1); }
  }
}

/** Where a timeline moves within [a, b]: ramps to a different value, and glides (exponential: never done). Only the
 *  events around [a, b] are looked at. */
function moving(evs: ReadonlyArray<{ type: string; t: number; v: number }>, a: number, b: number, out: Array<[number, number]>): void {
  let lo = 0, hi = evs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (evs[mid].t <= a) lo = mid + 1;
    else hi = mid;
  }
  for (let k = Math.max(0, lo - 1); k < evs.length; k++) {
    const e = evs[k];
    if (e.type === 'tgt') {
      const end = k + 1 < evs.length ? evs[k + 1].t : Infinity;
      if (end > a && e.t < b) out.push([Math.max(a, e.t), Math.min(b, end)]);
    } else if (e.type === 'lin') {
      const s0 = k > 0 ? evs[k - 1].t : -Infinity;
      const flat = k > 0 && evs[k - 1].type !== 'tgt' && evs[k - 1].v === e.v;
      if (!flat && e.t > a && s0 < b) out.push([Math.max(a, s0), Math.min(b, e.t)]);
    }
    if (e.t > b) break;
  }
}

/** The union of intervals, sorted (the input array is sorted in place). */
function merge(iv: Array<[number, number]>): Array<[number, number]> {
  iv.sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const v of iv) {
    const m = out[out.length - 1];
    if (m && v[0] <= m[1]) m[1] = Math.max(m[1], v[1]);
    else if (v[1] > v[0]) out.push([v[0], v[1]]);
  }
  return out;
}

/** Grid points on [a, b) where either timeline moves (a constant stretch is exact at its ends): every 1 ms within ±1 s
 *  of an anchor (a call or an event), every 50 ms elsewhere; plus 1 ms points within ±2 ms of every event, and both
 *  ends. Each run of points starts from its interval's start, so nothing drifts. */
function grid(a: number, b: number, anchors: number[], ramps: Array<[number, number]>, out: number[]): void {
  out.length = 0;
  out.push(a);
  const moves = merge(ramps);
  const near1: Array<[number, number]> = [];
  for (const [x0, x1] of merge(anchors.map((s): [number, number] => [Math.max(a, s - 1), Math.min(b, s + 1)]))) {
    for (const [y0, y1] of moves) if (y1 > x0 && y0 < x1) near1.push([Math.max(x0, y0), Math.min(x1, y1)]);
  }
  for (const s of anchors) near1.push([Math.max(a, s - 0.002), Math.min(b, s + 0.002)]);
  const dense = merge(near1);
  for (const [x0, x1] of dense) {
    const n = Math.ceil((x1 - x0) / 0.001 - 1e-9);
    for (let k = 0; k < n; k++) out.push(x0 + k * 0.001);
  }
  let j = 0;
  for (const [x0, x1] of moves) {
    const n = Math.ceil((x1 - x0) / 0.05 - 1e-9);
    for (let k = 0; k < n; k++) {
      const x = x0 + k * 0.05;
      while (j < dense.length && dense[j][1] <= x) j++;
      if (!(j < dense.length && dense[j][0] <= x)) out.push(x);
    }
  }
  if (b - 1e-6 > a) out.push(b - 1e-6);
  out.sort((x, y) => x - y);
}

// ----------------------------------------------------------- scenarios --

const p528 = plan(528, 'headphones', 'binaural', 10) as Plan;
const p639 = plan(639, 'headphones', 'binaural', 10) as Plan;
const p741 = plan(741, 'headphones', 'binaural', 10) as Plan;
const p852 = plan(852, 'headphones', 'binaural', 10) as Plan;
const p174 = plan(174, 'headphones', 'binaural', 10) as Plan;
const spk528 = plan(528, 'speakers', 'monaural', 10) as Plan;
const pho528 = plan(528, 'phone', 'monaural', 10) as Plan;
const spk174 = plan(174, 'speakers', 'monaural', 10) as Plan;
const pho174 = plan(174, 'phone', 'monaural', 10) as Plan;
const p528_6 = plan(528, 'headphones', 'binaural', 6) as Plan;
const p639_6 = plan(639, 'headphones', 'binaural', 6) as Plan;
const H21 = 0.8 * phiEnvelope(24, 240); // 0.07319: host 0.8 at 10 % of a 240 s track

/** The first play of every scenario: host first (a silent step), then the voice. */
const open = (pl: Plan, host = 0.8, render?: 'binaural' | 'pulse' | 'off', drone?: boolean) => (s: Sim): void => {
  const p = s.make();
  p.setHostLevel(host);
  p.play(pl, render, drone);
};
const play = (pl: Plan | null, render?: 'binaural' | 'pulse' | 'off', drone?: boolean) => (s: Sim): void => s.p.play(pl, render, drone);
/** True when f is non-increasing over [a, b] (10 ms samples) and never above its value at a by more than slack. */
function neverRises(f: (x: number) => number, a: number, b: number, slack = 1e-12): boolean {
  let prev = f(a);
  const top = prev;
  for (let x = a; x <= b + 1e-9; x += 0.01) {
    const v = f(x);
    if (v > prev + slack || v > top + slack) return false;
    prev = v;
  }
  return true;
}
const beatAmp = (s: Sim, x: number, i?: number): number => s.amp('carrier', x, i)[0] + s.amp('carrier', x, i)[1] + s.amp('partner', x, i)[0] + s.amp('partner', x, i)[1];
const droneAmp = (s: Sim, x: number, i?: number): number => s.amp('drone', x, i)[0];

const SCENARIOS: Scenario[] = [];
const sc = (x: Scenario): void => {
  SCENARIOS.push(x);
};

sc({
  name: 'S1', end: 30,
  steps: [[1, open(p528, 0.8, 'binaural')]],
  probes: [[20, (s) => {
    const st = s.st();
    s.expect(st.phase === 'open' && st.drone.next_rest_at === 1201 && st.sounding.partner_hz === 274 && st.host_level === 0.8
      && st.sound_version === 2 && st.player_version === 1, `S1 state at 20: ${st.phase}, next rest ${st.drone.next_rest_at}, partner ${st.sounding?.partner_hz}`);
  }]],
  final: (s) => {
    const T = s.tol;
    const st = s.steps('fTone', 0, 30);
    s.expect(st.length === 1 && near(st[0][0], 1.025, 1 / SR) && st[0][2] === 528, `S1: one tone step, 528 at fAt 1.025 (${JSON.stringify(st)})`);
    s.expect(near(s.e('gateTB', 1.05), 0, T) && near(s.e('gateTB', 2.3), 0.5, T) && near(s.e('gateTB', 3.55), 1, T), 'S1: gateTB opens 1.05 → 3.55');
    s.expect(near(s.e('gateDrone', 1.05), 0, T) && near(s.e('gateDrone', 5.05), 0.5, T) && near(s.e('gateDrone', 9.05), 1, T), 'S1: the drone opens 1.05 → 9.05');
    const tone = s.amp('tone', 20), car = s.amp('carrier', 20), par = s.amp('partner', 20);
    s.expect(near(tone[0], 0.04008, 1e-9) && near(tone[1], 0.04008, 1e-9), `S1: tone L = R = 0.04008 (${tone})`);
    s.expect(near(car[0], 0.05664, 1e-9) && car[1] === 0 && near(par[1], 0.05664, 1e-9) && par[0] === 0, `S1: carrier L / partner R 0.05664 (${car} / ${par})`);
    s.expect(s.e('fPartner', 20) === 274, `S1: the partner at exactly 274 Hz (${s.e('fPartner', 20)})`);
    const lvl = s.e('dronePlan', 20) * s.e('droneUser', 20) * s.e('gateDrone', 20) * s.e('host', 20);
    const dAm = s.rec().oscs[4].outs[0].to as MGain;
    s.expect(near(lvl, 0.05048, 1e-9) && near(dAm.gain.tl.valueAt(20), 0.85, 1e-12) && near(s.gainPeak(dAm, 20), 1, 1e-12),
      `S1: drone 0.05048 × (0.85 ± 0.15) (${lvl}, base ${dAm.gain.tl.valueAt(20)})`);
  },
});

sc({
  name: 'S2', end: 192,
  steps: [[0, open(p528)], [180, play(p639)]],
  probes: [
    [180.5, (s) => s.expect(s.st().phase === 'retuning' && near(s.st().retune_at, 183.02, 1e-9), `S2: retuning, retune_at ${s.st().retune_at}`)],
    [184, (s) => s.expect(s.st().phase === 'opening' && s.st().sounding.tone_hz === 639, 'S2: opening on 639 at 184')],
    [186, (s) => s.expect(s.st().phase === 'open', 'S2: open at 186')],
  ],
  final: (s) => {
    const T = s.tol;
    s.expect(near(s.e('gateTB', 180.4), 0.5, T) && near(s.e('gateTB', 180.8), 0, T), 'S2: gateTB 0.5 at 180.4, 0 at 180.8');
    s.expect(near(s.e('gateDrone', 181.5), 0.5, T) && near(s.e('gateDrone', 183), 0, T), 'S2: the drone 0.5 at 181.5, 0 at 183.0');
    const st = s.steps('fTone', 100, 192);
    s.expect(st.length === 1 && near(st[0][0], 183.01, 1 / SR) && st[0][1] === 528 && st[0][2] === 639, `S2: 528 → 639 at fAt 183.01 (${JSON.stringify(st)})`);
    s.expect(near(s.e('gateTB', 183.02), 0, T) && near(s.e('gateTB', 185.52), 1, T) && near(s.e('gateDrone', 191.02), 1, T)
      && near(s.e('gateDrone', 183.02), 0, T), 'S2: reopen from 183.02: gateTB 1 at 185.52, drone 1 at 191.02');
  },
});

{
  // S2 off the frame grid: real calls land between frames (the clock is currentTime + 0.02, extrapolated). Gecko rounds
  // every time to a frame, so an anchor's cancel must sit a whole frame past it (ANCHOR_EPS_FRAMES).
  const d = 0.6 / SR;
  sc({
    name: 'S2 off the frame grid', end: 192,
    steps: [[d, open(p528)], [180 + d, play(p639)], [181 + d, play(p528)], [186.3 + d, play(p639)]],
    final: (s) => {
      const T = s.tol;
      s.expect(near(s.e('gateTB', 180.4 + d), 0.5, T) && near(s.e('gateTB', 181 + d), 0, T) && near(s.e('gateDrone', 181 + d), 2 / 3, T),
        'S2 off-grid: the close runs from the call');
      s.expect(near(s.e('gateTB', 182.25 + d), 0.5, T) && near(s.e('gateDrone', 182 + d), 2 / 3 + 1 / 8, T) && near(s.e('gateDrone', 181 + 8 / 3 + d), 1, T),
        'S2 off-grid: the revert reopens from 0 and 2/3 at the gate rates');
    },
  });
}

for (const [name, rv, g, gEnd, d, dEnd] of [['S3', 300.5, 0.375, 302.0625, 1 - 0.5 / 3, 301.8333333333], ['S3 revert at 300.3', 300.3, 0.625, 301.2375, 0.9, 301.1]] as Array<[string, number, number, number, number, number]>) {
  sc({
    name, end: 320,
    steps: [[0, open(p528)], [300, play(p639)], [rv, play(p528)]],
    probes: [[rv + 0.01, (s) => s.expect(s.st().retune_at === null && s.st().phase === 'opening', `${name}: no retune pending after the revert`)]],
    final: (s) => {
      const T = s.tol;
      for (const n of ['fTone', 'fCarrier', 'fPartner', 'fBeatLfo', 'fDrone', 'fDroneLfo']) {
        s.expect(s.steps(n, 299, 320).length === 0 && [rv, 301, 303.5, 310].every((x) => s.e(n, x) === s.e(n, 299)), `${name}: no ${n} value change`);
      }
      s.expect(near(s.e('gateTB', rv), g, T) && near(s.e('gateTB', gEnd), 1, T) && near(s.e('gateTB', (rv + gEnd) / 2), (g + 1) / 2, T),
        `${name}: gateTB ${g} → 1 by ${gEnd}`);
      s.expect(near(s.e('gateDrone', rv), d, T) && near(s.e('gateDrone', dEnd), 1, 1e-6), `${name}: drone ${d} → 1 by ${dEnd}`);
    },
  });
}

sc({
  name: 'S4', end: 420,
  steps: [[0, open(p528)], [400, play(p639)], [401, play(p741)], [402.9, play(p852)]],
  final: (s) => {
    const st = s.steps('fTone', 399, 420), sc2 = s.steps('fCarrier', 399, 420);
    s.expect(st.length === 1 && near(st[0][0], 403.01, 1 / SR) && st[0][2] === 852 && sc2.length === 1,
      `S4: one retune, to D (852) at 403.01 (${JSON.stringify(st)})`);
    s.expect(near(s.e('gateTB', 403.02), 0, s.tol) && s.e('gateTB', 403.03) > 0, 'S4: it reopens at 403.02');
  },
});

sc({
  name: 'S5', end: 530,
  steps: [[0, open(p528)], [500, play(null)], [500.4, play(p528)], [510, play(null)], [520, play(p528)], [521, play(null)], [522, play(p528)]],
  final: (s) => {
    const T = s.tol;
    s.expect(s.callsIn('host', 1, 530).length === 0 && [499, 500.2, 505, 515, 529].every((x) => s.e('host', x) === 0.8), 'S5: the host is left alone');
    s.expect(near(s.e('gateTB', 500.4), 0.5, T) && near(s.e('gateTB', 501.65), 1, T), 'S5: gateTB 0.5 → 1 by 501.65');
    s.expect(near(s.e('gateDrone', 500.4), 1 - 0.4 / 3, T) && near(s.e('gateDrone', 501.4666667), 1, 1e-6), 'S5: drone 0.8667 → 1 by 501.4667');
    s.expect(['fTone', 'fCarrier', 'fPartner', 'fDrone', 'fDroneLfo', 'fBeatLfo'].every((n) => s.steps(n, 1, 530).length === 0 && s.callsIn(n, 1, 530).length === 0),
      'S5: no frequency event');
    s.expect(near(s.e('gateTB', 520), 0, T) && near(s.e('gateTB', 520.5), 0.2, T) && near(s.e('gateDrone', 520), 0, T) && near(s.e('gateDrone', 520.5), 0.0625, T),
      'S5: both open from 0 at 520 (toward 1 by 522.5 and 528)');
    s.expect(near(s.e('gateTB', 521.16), 0.2, T) && near(s.e('gateTB', 521.32), 0, T) && near(s.e('gateDrone', 521.1875), 0.0625, T)
      && near(s.e('gateDrone', 521.375), 0, T), 'S5: a pause from part-open gates closes at their rates (0.4 over 0.32 s, 0.125 over 0.375 s)');
  },
});

sc({
  name: 'S6', end: 600,
  steps: [[0, open(p528)], [530, (s) => s.p.setBeat(6)], [540, play(null)], [541, (s) => s.p.setBeat(20)],
    [550, play(plan(528, 'headphones', 'binaural', 20) as Plan)], [560, (s) => s.p.setBeat(-5)], [580, (s) => s.p.setBeat(1000)],
    [590, (s) => s.p.setBeat(NaN)]],
  probes: [
    [560.1, (s) => s.expect(s.st().requested.beat_hz === 0 && s.st().phase === 'retuning', 'S6: setBeat(-5) → beat 0, a retune')],
    [580.1, (s) => s.expect(s.st().phase === 'retuning' && s.st().requested.beat_hz === 100, 'S6: setBeat(1000) → 100, a retune (beat on)')],
  ],
  final: (s) => {
    s.expect(near(s.e('fPartner', 533), 270 + 4 / Math.E, 1e-9), `S6: partner(533) = 271.4715 (${s.e('fPartner', 533)})`);
    s.expect(s.e('fPartner', 541.001) === 284 && s.e('fPartner', 552) === 284, 'S6: paused, setBeat(20) sets 284 Hz; the resume plays 284 Hz');
    s.expect(s.e('cR', 565) === 1 && s.e('pR', 565) === 0 && s.e('fPartner', 565) === 274, 'S6: beat 0 = the carrier in both ears, the partner parked');
    s.expect(s.e('pR', 585) === 1 && s.e('cR', 585) === 0 && s.e('fPartner', 585) === 364, 'S6: beat 100 = partner 364 Hz');
    s.expect(s.callsAt(590) === 0, 'S6: setBeat(NaN) is ignored');
  },
});

sc({
  // §4.7: a beat change during a retune's silence is set at once, and the pending fAt steps carry the new target.
  name: 'S6 setBeat during a retune', end: 110,
  steps: [[0, open(p528)], [100, play(p639)], [101, (s) => s.p.setBeat(6)]],
  probes: [[101.5, (s) => s.expect(s.st().requested.beat_hz === 6 && s.st().phase === 'retuning', 'S6b: the retune carries beat 6')]],
  final: (s) => {
    s.expect(s.e('fPartner', 101.001) === 270 && s.e('fBeatLfo', 101.001) === 6, 'S6b: set at once while the beat layer is silent (264 + 6)');
    s.expect(s.e('fPartner', 104) === 325.5 && s.e('fBeatLfo', 104) === 6 && s.e('fCarrier', 104) === 319.5, 'S6b: 639 plays with partner 325.5 Hz');
  },
});

sc({
  name: 'S7', end: 620,
  steps: [[0, open(p528)], [600, play(spk528, 'pulse')]],
  final: (s) => {
    const T = s.tol;
    s.expect(near(s.e('gateTB', 603.02), 0, T) && near(s.e('gateTB', 605.52), 1, T), 'S7: at = 603.02');
    s.expect(s.e('cL', 610) === 1 && s.e('cR', 610) === 1 && s.e('pL', 610) === 0 && s.e('pR', 610) === 0 && s.e('amBase', 610) === 0.825
      && s.e('amDepth', 610) === 0.175 && s.e('fBeatLfo', 610) === 10 && s.e('beatPlan', 610) === 0.0708, 'S7: pulse routing and AM');
    s.expect(s.e('dronePlan', 610) === 0 && [603, 605, 610, 619].every((x) => s.e('gateDrone', x) === 0), 'S7: the 132 Hz drone never plays');
  },
});

sc({
  name: 'S8', end: 815,
  steps: [[0, open(p174)], [700, play(pho174, 'pulse')], [800, play(p174)]],
  probes: [[800.1, (s) => s.expect(near(s.st().retune_at, 800.82, 1e-9), `S8: at 800.82, no 3 s wait (${s.st().retune_at})`)]],
  final: (s) => {
    const T = s.tol;
    s.expect(near(s.e('gateDrone', 703), 0, T) && near(s.e('gateTB', 703.02), 0, T) && s.e('gateTB', 703.12) > 0, 'S8: closeEnd 703.0, at 703.02');
    s.expect(s.e('fTone', 704) === 348 && s.e('fCarrier', 704) === 696 && s.e('gateDrone', 750) === 0, 'S8: phone 174 = tone 348, carrier 696, no drone');
    s.expect(near(s.e('gateTB', 800.82), 0, T) && near(s.e('gateTB', 803.32), 1, T) && near(s.e('gateDrone', 800.82), 0, T)
      && near(s.e('gateDrone', 808.82), 1, T) && s.e('fTone', 801) === 174, 'S8: back on headphones from 800.82; the drone opens over 8 s');
  },
});

sc({
  name: 'S9', end: 12,
  steps: [[0, open(spk174, 0.8, 'off')]],
  final: (s) => {
    s.expect(['beatPlan', 'cL', 'cR', 'pL', 'pR'].every((n) => s.e(n, 10) === 0), 'S9: car = no beat layer');
    const tone = s.amp('tone', 10);
    s.expect(near(tone[0], 0.04008, 1e-9) && near(tone[1], 0.04008, 1e-9) && beatAmp(s, 10) === 0 && droneAmp(s, 10) === 0, 'S9: tone only');
  },
});

sc({
  name: 'S10', end: 1810,
  steps: [[0, open(p528)], [1199, play(p639)]],
  final: (s) => {
    s.expect(near(s.e('gateTB', 1202.02), 0, s.tol) && near(s.e('gateTB', 1204.52), 1, s.tol), 'S10: the retune opens at 1202.02');
    s.expect([1202, 1500, 1799.9, 1800].every((x) => s.e('gateDrone', x) === 0) && near(s.e('gateDrone', 1804), 0.5, s.tol)
      && near(s.e('gateDrone', 1808), 1, s.tol), 'S10: the drone stays 0 until 1800 and is 1 at 1808');
  },
});
sc({
  name: 'S10 + p528 at 1799.5', end: 1812,
  steps: [[0, open(p528)], [1199, play(p639)], [1799.5, play(p528)]],
  probes: [[1799.6, (s) => s.expect(near(s.st().retune_at, 1800.32, 1e-9), `S10: at 1800.32 (${s.st().retune_at})`)]],
  final: (s) => {
    s.expect(s.e('gateDrone', 1800.32) === 0 && near(s.e('gateDrone', 1804.32), 0.5, s.tol) && near(s.e('gateDrone', 1808.32), 1, s.tol),
      'S10: drone 1 at 1808.32');
  },
});
sc({
  name: 'S10 + p528 at 1799.0', end: 1812,
  steps: [[0, open(p528)], [1199, play(p639)], [1799, play(p528)]],
  probes: [[1799.1, (s) => s.expect(near(s.st().retune_at, 1799.82, 1e-9), `S10: at 1799.82 (${s.st().retune_at})`)]],
  final: (s) => {
    s.expect(s.e('gateDrone', 1800) === 0 && near(s.e('gateDrone', 1804), 0.5, s.tol) && near(s.e('gateDrone', 1808), 1, s.tol),
      'S10: the drone opens at 1800.0');
  },
});

sc({
  name: 'S11', end: 2810,
  steps: [[0, open(p528)], [900, play(null)], [1600, play(p528)]],
  probes: [[1601, (s) => s.expect(s.st().drone.next_rest_at === 2800, `S11: next rest 2800 (${s.st().drone.next_rest_at})`)]],
  final: (s) => s.expect(near(s.e('gateDrone', 2800), 1, s.tol) && near(s.e('gateDrone', 2801.5), 0.5, s.tol) && near(s.e('gateDrone', 2803), 0, s.tol),
    'S11: the rest closes the drone from 2800'),
});
sc({
  name: 'S11 paused 900-1200', end: 1510,
  steps: [[0, open(p528)], [900, play(null)], [1200, play(p528)]],
  probes: [[1201, (s) => s.expect(s.st().drone.next_rest_at === 1500, `S11: next rest 1500 (${s.st().drone.next_rest_at})`)]],
  final: (s) => s.expect(near(s.e('gateDrone', 1500), 1, s.tol) && near(s.e('gateDrone', 1501.5), 0.5, s.tol), 'S11: the rest closes from 1500'),
});

sc({
  name: 'S12', end: 210,
  steps: [[0, open(p528)], [100, (s) => s.p.setLayerGains({ beat: 0, drone: 0 })], [200, (s) => s.p.setLayerGains({ beat: 1, drone: 1 })]],
  probes: [
    [150, (s) => {
      const st = s.st();
      s.expect(st.gains.beat === 0 && st.gains.drone === 0 && st.gains.tone === 1 && near(st.drone.on_s, 100) && near(st.drone.quiet_s, 50),
        `S12: the duty counts quiet (on ${st.drone.on_s}, quiet ${st.drone.quiet_s})`);
    }],
    [201, (s) => s.expect(s.st().drone.next_rest_at === 1300, `S12: next rest 1300 (${s.st().drone.next_rest_at})`)],
  ],
  final: (s) => {
    const T = s.tol;
    s.expect(near(s.e('beatUser', 100.4), 0.5, T) && near(s.e('beatUser', 100.8), 0, T) && near(s.e('droneUser', 101.5), 0.5, T)
      && near(s.e('droneUser', 103), 0, T), 'S12: beatUser 0 by 100.8, droneUser 0 by 103');
    s.expect(near(s.e('beatUser', 201.25), 0.5, T) && near(s.e('beatUser', 202.5), 1, T) && near(s.e('droneUser', 204), 0.5, T)
      && near(s.e('droneUser', 208), 1, T), 'S12: back to 1 by 202.5 and 208');
    s.expect(s.e('gateDrone', 150) === 1 && s.e('toneUser', 150) === 1, 'S12: the gates are not used for gains');
  },
});

{
  const feed4: Array<[number, (s: Sim) => void]> = [1, 2, 3, 4, 5].map((k) => [110 + 0.25 * k, (s: Sim) => s.p.setHostLevel(0.9 * 0.98 ** k)]);
  const feed60: Array<[number, (s: Sim) => void]> = [];
  for (let k = 0; k <= 600; k++) feed60.push([120 + k / 60, (s: Sim) => s.p.setHostLevel(0.5 + 0.002 * (k / 60))]);
  const glide: Array<[number, (s: Sim) => void]> = [];
  for (let k = 0; k <= 8; k++) glide.push([140 + 0.25 * k, (s: Sim) => s.p.setHostLevel(0.4, { glideS: 1.5 })]);
  sc({
    name: 'S13', end: 150,
    steps: [[0, open(p528)], [100, (s) => s.p.setHostLevel(0.03)], [110, (s) => s.p.setHostLevel(0.9)], ...feed4,
      [115, (s) => s.p.setHostLevel(0.5)], ...feed60, [131.5, (s) => s.p.setLayerGains({})], ...glide,
      [145, (s) => s.p.setHostLevel(0, { glideS: 1.5 })], [145.3, (s) => s.p.setHostLevel(0, { glideS: 0.1 })]],
    final: (s) => {
      const T = s.tol;
      const lin = (a: number, va: number, b: number, vb: number): boolean => [0, 0.25, 0.5, 0.75, 1].every((f) => near(s.e('host', a + f * (b - a)), va + f * (vb - va), T));
      s.expect(lin(100, 0.8, 101.5, 0.03), 'S13: 0.03 at 100 = 1.5 s linear');
      s.expect(near(s.e('host', 110.2), 0.03 + 0.87 * (0.2 / 1.5), T), 'S13: 0.9 at 110 = 1.5 s linear');
      const end4 = 0.9 * 0.98 ** 5;
      s.expect(near(s.e('host', 111.5), end4, T) && near(s.e('host', 112), end4, T),
        `S13: a 4 Hz feed during the jump still ends with it, at 111.5 (${s.e('host', 111.5)} vs ${end4})`);
      // Each small update ramps from where the host is to its value at the jump's end (never sooner: review m2).
      let h = 0.03 + 0.87 * (0.25 / 1.5), ok4 = near(s.e('host', 110.25), h, T);
      for (let k = 1; k <= 4; k++) {
        const u = 110 + 0.25 * k, x = 0.9 * 0.98 ** k;
        h += (x - h) * (0.25 / (111.5 - u));
        ok4 = ok4 && near(s.e('host', u + 0.25), h, T);
      }
      s.expect(ok4, 'S13: small updates during a jump end with the jump (no shortened jump, no exponential)');
      let worst = 0;
      for (let k = 120; k < 131; k++) worst = Math.max(worst, s.callsIn('host', k, k + 1 - 1e-6).length);
      s.expect(worst <= 10, `S13: ≤ 10 host anchors per second during the 60 Hz feed (${worst})`);
      const exactAt = s.cfg.tickMs === 1000 ? 131.3 : 131.8;
      s.expect(near(s.e('host', exactAt), 0.52, T), `S13: exact after one tick or the next call (${s.e('host', exactAt)} at ${exactAt})`);
      s.expect(s.callsIn('host', 140, 142).length === 1 && lin(140, 0.52, 141.5, 0.4) && near(s.e('host', 142), 0.4, T) && near(s.e('host', 144.9), 0.4, T),
        `S13: re-sent {glideS: 1.5} = one anchor, a straight 1.5 s line (${s.callsIn('host', 140, 142).length} anchors)`);
      s.expect(s.callsIn('host', 145, 146).length === 2 && near(s.e('host', 145.3), 0.32, T) && near(s.e('host', 145.4), 0, T),
        'S13: a stop overtakes a slow fall to the same 0');
    },
  });
}

sc({
  name: 'S14', end: 205, warnings: 4,
  steps: [[0, open(p528)], [200, (s) => s.dispose()],
    [201, (s) => { s.p.play(p639); s.p.setBeat(6); s.p.setHostLevel(0.5); s.p.setLayerGains({ tone: 0 }); }],
    [202, (s) => { s.p.play(p639); s.p.setBeat(6); s.p.setHostLevel(0.5); s.p.setLayerGains({ tone: 0 }); s.dispose(); }]],
  probes: [
    [200.2, (s) => s.expect(s.rec().hostNode.disconnects === 0, 'S14: the host stays connected until the oscillators end')],
    [200.5, (s) => s.expect(s.rec().hostNode.disconnects === 1, 'S14: the host disconnects on onended')],
    [203, (s) => s.expect(s.st().phase === 'disposed' && s.p.disposed, 'S14: phase disposed')],
  ],
  final: (s) => {
    s.expect(near(s.e('host', 200.125), 0.4, s.tol) && near(s.e('host', 200.25), 0, s.tol), 'S14: host 0 by 200.25');
    s.expect(s.rec().oscs.every((o) => o.stops.length === 1 && near(o.stops[0], 200.3, 1e-12)), 'S14: every oscillator stops at 200.3');
    s.expect(s.callsAt(201) === 0 && s.callsAt(202) === 0, 'S14: later calls schedule nothing');
  },
});

sc({
  name: 'S15', end: 15, mono: true,
  steps: [[0, open(p528, 0.8, 'binaural')]],
  probes: [[10, (s) => {
    const st = s.st();
    s.expect(st.mono_output && st.requested.render === 'pulse' && st.sounding.render === 'pulse', 'S15: mono output, pulse');
  }]],
  final: (s) => s.expect(s.e('cL', 10) === 1 && s.e('cR', 10) === 1 && s.e('pL', 10) === 0 && s.e('pR', 10) === 0 && s.e('amBase', 10) === 0.825
    && s.e('amDepth', 10) === 0.175, 'S15: a binaural request gets pulse routing'),
});

sc({
  name: 'S16', end: 12,
  steps: [[0, open(plan(528, 'headphones', 'binaural', 0) as Plan)]],
  probes: [[10, (s) => s.expect(s.st().sounding.partner_hz === 0 && s.st().sounding.beat_hz === 0, 'S16: no partner sounds')]],
  final: (s) => s.expect(s.e('cL', 10) === 1 && s.e('cR', 10) === 1 && s.e('pL', 10) === 0 && s.e('pR', 10) === 0 && s.e('fPartner', 10) === 274,
    'S16: beat 0 = the carrier in both ears'),
});

sc({
  name: 'S17', end: 12,
  steps: [[0, open(plan(174, 'headphones', 'binaural', 40) as Plan)]],
  probes: [[10, (s) => s.expect(s.st().sounding.partner_hz === 736, `S17: partner 736 (${s.st().sounding.partner_hz})`)]],
  final: (s) => s.expect(s.e('fPartner', 10) === 736 && s.e('fCarrier', 10) === 696, 'S17: partner 736 Hz, not 706 (LG-05)'),
});

sc({
  name: 'S18', end: 60,
  steps: [[0, open(p528)], [50, play(spk528, 'pulse')]],
  final: (s) => {
    s.expect(neverRises((x) => droneAmp(s, x), 50, 53) && droneAmp(s, 53) === 0, 'S18: the old drone never rises and is 0 by 53');
    const lv = ['tonePlan', 'beatPlan', 'dronePlan'].flatMap((n) => s.steps(n, 49, 60));
    s.expect(lv.length >= 1 && lv.every(([t]) => near(t, 53.01, 1 / SR)), `S18: plan levels change only at fAt 53.01 (${JSON.stringify(lv)})`);
  },
});

sc({
  name: 'S19', end: 10,
  steps: [[0, open(p528, 0.8, 'off', false)]],
  final: (s) => {
    const tone = s.amp('tone', 2.55);
    s.expect(near(tone[0], 0.04008, 1e-9) && near(tone[1], 0.04008, 1e-9), `S19: tone L = R = 0.04008 by 2.55 (${tone})`);
    s.expect([0.5, 1, 2.55, 5, 9.9].every((x) => beatAmp(s, x) === 0 && droneAmp(s, x) === 0), 'S19: beat and drone exactly 0');
  },
});

for (const T20 of [20.1, 20.5, 22, 25]) {
  for (const hostFirst of [false, true]) {
    sc({
      name: `S20 at ${T20}${hostFirst ? ' (host first)' : ''}`, end: 30,
      steps: [[0, open(p528, 0.5)], [20, play(null)], [T20, (s) => {
        if (hostFirst) s.p.setHostLevel(0.8);
        s.p.play(p528, 'off', false);
        if (!hostFirst) s.p.setHostLevel(0.8);
      }]],
      final: (s) => {
        s.expect(neverRises((x) => beatAmp(s, x), 20, 30) && neverRises((x) => droneAmp(s, x), 20, 30) && beatAmp(s, 23) === 0 && droneAmp(s, 23) === 0,
          `S20 at ${T20}: beat and drone never rise after 20 and reach 0`);
        if (T20 < 23) {
          s.expect(s.e('host', 23.005) === 0.5 && near(s.e('host', 23.011), 0.8, s.tol) && s.e('gateTB', 23.01) === 0 && s.e('gateDrone', 23.01) === 0,
            `S20 at ${T20}: the host rise lands at fAt 23.01 (${s.e('host', 23.005)} → ${s.e('host', 23.011)})`);
          s.expect(near(s.e('gateTB', 23.02), 0, s.tol) && near(s.e('gateTB', 25.52), 1, s.tol), `S20 at ${T20}: the tone reopens from 23.02`);
        } else {
          s.expect(near(s.e('host', 25.001), 0.8, s.tol) && near(s.e('gateTB', 25.05), 0, s.tol) && near(s.e('gateTB', 27.55), 1, s.tol),
            'S20 at 25: a silent host step, the tone opens from 25.05');
        }
      },
    });
  }
}

sc({
  // App order (§9.8.3 sends the host before play()): a pause with the tone active raises the host (no music, no
  // envelope) in the same task as the tone-only voice that closes the beat and the drone. The rise, already in flight
  // when the fall begins, must wait too (A8).
  name: 'S20 App order (the host, then the tone-only voice)', end: 30,
  steps: [[0, open(p528, 0.5)], [20, (s) => {
    s.p.setHostLevel(0.8);
    s.p.play(p528, 'off', false);
  }]],
  final: (s) => {
    s.expect(neverRises((x) => beatAmp(s, x), 20, 30) && neverRises((x) => droneAmp(s, x), 20, 30) && beatAmp(s, 23) === 0 && droneAmp(s, 23) === 0,
      'S20 App order: beat and drone never rise after 20');
    s.expect(s.e('host', 22.99) === 0.5 && near(s.e('host', 23.011), 0.8, s.tol) && s.e('gateTB', 23.01) === 0 && s.e('gateDrone', 23.01) === 0,
      `S20 App order: the rise waits for fAt 23.01 (${s.e('host', 22.99)} → ${s.e('host', 23.011)})`);
  },
});

sc({
  name: 'S21', end: 40,
  steps: [[0, open(p528, H21)], [30, (s) => { s.p.play(null); s.p.setHostLevel(0.8); }]],
  final: (s) => {
    const a0 = droneAmp(s, 30);
    s.expect(near(H21, 0.07319, 1e-5) && neverRises((x) => droneAmp(s, x), 30, 40, a0 * (10 ** (0.1 / 20) - 1)), 'S21: the drone never swells after the pause');
    const st = s.steps('host', 29, 40);
    s.expect(st.length === 1 && near(st[0][0], 33, 1 / SR) && near(st[0][2], 0.8, 1e-12) && s.e('gateTB', 33) === 0 && s.e('gateDrone', 33) === 0,
      `S21: the rise lands at closeEnd 33 as a step with both gates 0 (${JSON.stringify(st)})`);
  },
});
for (const [name, at] of [['S21 rest close', 1200.5], ['S21 rest close (call at 1199.9)', 1199.9]] as Array<[string, number]>) {
  sc({
    name, end: 1210,
    steps: [[0, open(p528, 0.5)], [at, (s) => s.p.setHostLevel(0.8)]],
    final: (s) => {
      const a0 = droneAmp(s, at);
      s.expect(neverRises((x) => droneAmp(s, x), at, 1210, a0 * (10 ** (0.1 / 20) - 1) + 1e-12), `${name}: the drone never exceeds its value at the call`);
      s.expect(s.e('host', 1200) === 0.5 && near(s.e('host', 1203), 0.5, s.tol) && near(s.e('host', 1203.125), 0.65, s.tol)
        && near(s.e('host', 1203.25), 0.8, s.tol) && s.e('gateTB', 1203) === 1, `${name}: deferred to 1203, then 0.5 → 0.8 over 0.25 s`);
    },
  });
}
{
  // A8 with a remainder pending (review A8-flush-rise). App resends the host 4×/s; after a seek's {glideS: 1.5} jump
  // the φ envelope drifts by < 0.1 dB between resends, which make no anchor and leave hostWant ahead of the jump. The
  // next call flushes that remainder first, so a pause, a retune or a gain fall made by that call must stop the jump
  // in flight right there — not only defer the remainder behind the falls while the jump rises on through them.
  const H = 0.1 + 0.7 * (0.6 / 1.5); // the jump 0.1 → 0.8 over [20, 21.5] at 20.6: 0.38
  for (const [variant, act, tStar, until] of [
    ['pause', play(null), 23.6, 30], // closeEnd 23.6 (the drone's 3 s); a silent step there
    ['retune', play(p639), 23.61, 23.62], // fAt 23.61; the gates reopen from 23.62
    ['drone off', (s: Sim) => s.p.setLayerGains({ drone: 0 }), 23.6, 23.6], // the drone's 3 s fade; the others stay open
    ['tone off', (s: Sim) => s.p.setLayerGains({ tone: 0 }), 21.4, 21.4], // the tone's 0.8 s fade ends inside the stopped jump
  ] as Array<[string, (s: Sim) => void, number, number]>) {
    const name = `S21 remainder (${variant})`;
    sc({
      name, end: 30,
      steps: [[0, open(p528, 0.1)], [20, (s) => s.p.setHostLevel(0.8, { glideS: 1.5 })],
        [20.25, (s) => s.p.setHostLevel(0.801, { glideS: 1.5 })], [20.5, (s) => s.p.setHostLevel(0.802, { glideS: 1.5 })], [20.6, act]],
      final: (s) => {
        const T = s.tol, slack = (a: number): number => a * (10 ** (0.1 / 20) - 1) + 1e-12;
        s.expect(s.callsIn('host', 20.1, 20.55).length === 0, `${name}: the resends within 0.1 dB made no anchor (a remainder)`);
        s.expect(neverRises((x) => droneAmp(s, x), 20.6, until, slack(droneAmp(s, 20.6)))
          && neverRises((x) => beatAmp(s, x), 20.6, until, slack(beatAmp(s, 20.6)))
          && neverRises((x) => s.amp('tone', x)[0], 20.6, until, slack(s.amp('tone', 20.6)[0])), `${name}: no layer swells after the call`);
        s.expect(near(s.e('host', 20.6), H, T) && near(s.e('host', tStar - 0.01), H, T), `${name}: the jump stops at ${H} until ${tStar} (${s.e('host', 21.5)} at 21.5)`);
        if (variant === 'drone off' || variant === 'tone off') {
          // The other layers stay open, so the rise is a ramp from T*: the stopped glide's 1.5 s, as without a
          // remainder (reevaluateHost's hold) — never the 0.25 s of an update inside a jump that no longer runs.
          s.expect(near(s.e('host', tStar + 0.75), (H + 0.802) / 2, T) && near(s.e('host', tStar + 1.5), 0.802, T),
            `${name}: then ${H} → 0.802 over [${tStar}, ${tStar + 1.5}] (${s.e('host', tStar + 0.25)} at ${tStar + 0.25})`);
        } else {
          const st = s.steps('host', 20.6, 30);
          s.expect(st.length === 1 && near(st[0][0], tStar, 1 / SR) && near(st[0][2], 0.802, 1e-12) && s.e('gateTB', tStar) === 0 && s.e('gateDrone', tStar) === 0,
            `${name}: the rise lands at ${tStar} as a step with both gates 0 (${JSON.stringify(st)})`);
        }
      },
    });
  }
}

sc({
  name: 'S22', end: 15,
  steps: [[0, open(spk528, 0.8, 'pulse')], [10, play(pho528, 'pulse')]],
  probes: [[10.01, (s) => s.expect(s.st().phase === 'open' && s.st().requested.output === 'phone', 'S22: 528 stays open, now as the phone voice')]],
  final: (s) => s.expect(s.callsAt(10) === 0, `S22: speakers → phone on 528 makes zero automation calls (${s.callsAt(10)})`),
});
sc({
  name: 'S22 (174)', end: 15,
  steps: [[0, open(spk174, 0.8, 'pulse')], [10, play(pho174, 'pulse')]],
  probes: [[10.1, (s) => s.expect(s.st().phase === 'retuning' && near(s.st().retune_at, 10.82, 1e-9), 'S22: 174 makes one retune')]],
  final: (s) => {
    const st = s.steps('fTone', 9, 15);
    s.expect(st.length === 1 && st[0][2] === 348 && near(st[0][0], 10.81, 1 / SR), `S22: 174 → 348 at 10.81 (${JSON.stringify(st)})`);
  },
});

sc({
  name: 'S23', end: 1810,
  steps: [[0, open(p528)], [1199, play(p639)], [1200.5, play(null)], [1300, play(p639)]],
  probes: [
    [1201, (s) => s.expect(s.st().sounding.tone_hz === 528 && s.st().requested === null && s.st().phase === 'closing', 'S23: the pause cancels the retune')],
    [1300.01, (s) => s.expect(s.st().phase === 'retuning' && near(s.st().retune_at, 1300.05, 1e-9), 'S23: a retune from silence')],
    [1809, (s) => s.expect(s.st().drone.next_rest_at === 3000, `S23: next rest 3000 (${s.st().drone.next_rest_at})`)],
  ],
  final: (s) => {
    s.expect(s.steps('fTone', 1199, 1300.02).length === 0 && s.e('fTone', 1300.03) === 639, 'S23: 528 holds until the retune at 1300');
    s.expect(near(s.e('gateTB', 1300.05), 0, s.tol) && near(s.e('gateTB', 1302.55), 1, s.tol), 'S23: the tone opens by 1302.55');
    s.expect([1300.05, 1500, 1799.9, 1800].every((x) => s.e('gateDrone', x) === 0) && near(s.e('gateDrone', 1808), 1, s.tol), 'S23: the drone stays 0 until 1800, 1 by 1808');
  },
});

sc({
  // A pause drops a pending retune, so resuming the old voice is a reopen on its own frequencies.
  name: 'S23 resume the old voice', end: 115,
  steps: [[0, open(p528)], [100, play(p639)], [100.5, play(null)], [101, play(p528)]],
  probes: [[101.1, (s) => s.expect(s.st().phase === 'opening' && s.st().retune_at === null, 'S23b: a reopen, not a retune')]],
  final: (s) => {
    s.expect(['fTone', 'fCarrier', 'fPartner', 'fDrone'].every((n) => s.steps(n, 1, 115).length === 0) && s.e('fTone', 110) === 528,
      'S23b: 528 throughout (639 never stepped in)');
    s.expect(near(s.e('gateTB', 101), 0, s.tol) && near(s.e('gateTB', 103.5), 1, s.tol) && near(s.e('gateDrone', 101), 1 - 1 / 3, s.tol),
      'S23b: reopened from the gates where they were');
  },
});

for (const hostFirst of [true, false]) {
  sc({
    name: `S24${hostFirst ? '' : ' (play first)'}`, end: 30,
    steps: [[0, open(p528)], [20, (s) => { s.p.setHostLevel(0, { glideS: 0.25 }); s.p.play(null); }],
      [20.6, (s) => {
        if (hostFirst) s.p.setHostLevel(0.8);
        s.p.play(p528);
        if (!hostFirst) s.p.setHostLevel(0.8);
      }]],
    final: (s) => {
      const T = s.tol;
      s.expect(near(s.e('host', 20.125), 0.4, T) && near(s.e('host', 20.25), 0, T), 'S24: host 0 by 20.25');
      s.expect(near(s.e('gateTB', 20.6), 0.25, T) && near(s.e('gateTB', 22.475), 1, T) && near(s.e('gateDrone', 20.6), 0.8, T) && near(s.e('gateDrone', 22.2), 1, T),
        'S24: gateTB 0.25 and drone 0.8 reopen by 22.475 and 22.2');
      s.expect(near(s.e('host', 20.6), 0, T) && near(s.e('host', 21.35), 0.4, T) && near(s.e('host', 22.1), 0.8, T) && near(s.e('host', 25), 0.8, T),
        'S24: the host rises 0 → 0.8 linearly over 1.5 s from 20.6');
    },
  });
}

sc({
  name: 'S25', end: 12,
  steps: [[1, open(p528)], [2.05, play(p639)]],
  probes: [[2.06, (s) => s.expect(near(s.st().retune_at, 2.445, 1e-9), `S25: at 2.445 (${s.st().retune_at})`)]],
  final: (s) => {
    const T = s.tol;
    s.expect(near(s.e('gateTB', 2.05), 0.4, T) && near(s.e('gateDrone', 2.05), 0.125, T), 'S25: g 0.4, d 0.125 at the call');
    s.expect(near(s.e('gateTB', 2.37), 0, T) && near(s.e('gateDrone', 2.425), 0, T) && near(s.e('gateTB', 2.445), 0, T) && s.e('gateTB', 2.545) > 0,
      'S25: closeEnd 2.425, at 2.445');
    const st = s.steps('fTone', 2, 12);
    s.expect(st.length === 1 && near(st[0][0], 2.435, 1 / SR), `S25: fAt 2.435 (${JSON.stringify(st)})`);
  },
});

for (const viaDispose of [false, true]) {
  sc({
    name: `S26${viaDispose ? ' (dispose)' : ''}`, end: 30,
    steps: [[0, open(p528)], [20, play(null)], [20.5, (s) => s.p.setHostLevel(0.9)],
      [21, (s) => {
        if (viaDispose) s.dispose();
        else {
          s.p.setHostLevel(0, { glideS: 0.1 });
          s.p.play(null);
        }
      }]],
    probes: [[20.6, (s) => s.expect(s.st().host_level === 0.8, 'S26: the rise is deferred')]],
    final: (s) => {
      const T = s.tol;
      const f = viaDispose ? 0.25 : 0.1;
      s.expect(near(s.e('host', 20.9), 0.8, T) && near(s.e('host', 21 + f / 2), 0.4, T) && near(s.e('host', 21 + f), 0, T)
        && [23, 23.5, 25, 29].every((x) => s.e('host', x) === 0), `S26${viaDispose ? ' (dispose)' : ''}: host 0 by ${21 + f} and still 0 after 23`);
      s.expect(!s.rec().byName.get('host').p.tl.ev.some((e) => e.t > 21 + f + 1e-6), 'S26: the pre-scheduled rise is gone');
      if (viaDispose) s.expect(s.rec().oscs.every((o) => near(o.stops[0], 21.3, 1e-12)) && s.e('host', 21.3) === 0, 'S26: the oscillators stop at 21.3 with the host at 0');
    },
  });
}

for (const pauseFirst of [false, true]) {
  sc({
    name: `S27${pauseFirst ? ' (pause, then the voice)' : ''}`, end: 541,
    steps: [[0, open(p528)], [530, (s) => s.p.setBeat(6)], [530.5, play(p639_6)],
      ...((pauseFirst ? [[531.5, play(null)], [532, play(p528_6)]] : [[531.5, play(p528_6)]]) as Array<[number, (s: Sim) => void]>)],
    final: (s) => s.expect(near(s.e('fPartner', 540), 270 + 4 * Math.exp(-10 / 3), 1e-6), `S27: the beat glide runs on (partner(540) ${s.e('fPartner', 540)})`),
  });
}

sc({
  name: 'S28', end: 20,
  steps: [[0, open(spk528, 0.8, 'pulse')], [10, play(spk528, 'off')]],
  probes: [[10.1, (s) => s.expect(s.st().phase === 'retuning' && near(s.st().retune_at, 10.82, 1e-9), 'S28: a render-only change retunes')]],
  final: (s) => {
    const T = s.tol;
    const st = ['beatPlan', 'cL', 'cR', 'amBase', 'amDepth'].flatMap((n) => s.steps(n, 9, 20));
    s.expect(st.length === 5 && st.every(([t]) => near(t, 10.81, 1 / SR)) && s.e('beatPlan', 11) === 0 && s.e('cL', 11) === 0,
      `S28: beatPlan and routing reach 0 only at fAt 10.81 (${st.length} steps)`);
    s.expect(near(s.e('gateTB', 10.8), 0, T) && near(s.e('gateTB', 10.82), 0, T) && s.e('gateTB', 10.92) > 0, 'S28: closeEnd 10.8, the tone reopens from 10.82');
    let pulse = 0;
    for (let x = 10.8; x <= 20; x += 0.01) pulse = Math.max(pulse, beatAmp(s, x));
    s.expect(pulse === 0, `S28: no pulse after 10.8 (${pulse})`);
  },
});

{
  const carryAt = (tD: number) => (s: Sim): void => {
    const st = s.st();
    (s as unknown as { carry: unknown }).carry = { ...st.drone, t: st.t };
    s.dispose();
  };
  const reopenAt = (s: Sim): void => {
    const p = s.make({ resumeDuty: (s as unknown as { carry: LayerPlayerOptions['resumeDuty'] }).carry });
    p.setHostLevel(0.8);
    p.play(p528);
  };
  sc({
    name: 'S29', end: 1110,
    steps: [[0, open(p528)], [1000, carryAt(1000)], [1100, reopenAt]],
    probes: [[1101, (s) => s.expect(s.recs.length === 2 && s.st().drone.next_rest_at === 1300, `S29: next rest 1300 (${s.st().drone.next_rest_at})`)]],
  });
  sc({
    name: 'S29 (back at 1700)', end: 1710,
    steps: [[0, open(p528)], [1000, carryAt(1000)], [1700, reopenAt]],
    probes: [[1701, (s) => s.expect(s.st().drone.next_rest_at === 2900, `S29: quiet ≥ 600 s, next rest 2900 (${s.st().drone.next_rest_at})`)]],
  });
  sc({
    name: 'S29 (dispose while resting)', end: 1810,
    steps: [[0, open(p528)], [1300, carryAt(1300)], [1500, reopenAt]],
    final: (s) => s.expect([1500.05, 1700, 1799.9, 1800].every((x) => s.e('gateDrone', x, 1) === 0) && near(s.e('gateDrone', 1808, 1), 1, s.tol),
      'S29: the carried rest keeps the drone 0 until 1800; 1 by 1808'),
  });
}

sc({
  name: 'S30', end: 5,
  steps: [[0, (s) => {
    s.ctx.failMerger = 1;
    const before = s.nodes.length;
    let threw = false;
    try {
      s.make();
    } catch {
      threw = true;
    }
    const made = s.nodes.slice(before);
    const oscs = made.filter((n): n is MOsc => n.kind === 'osc') as MOsc[];
    const reg = (globalThis as unknown as Record<symbol, LayerPlayer[] | undefined>)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [];
    s.expect(threw, 'S30: LayerPlayer.for throws when the graph cannot be built');
    s.expect(oscs.length > 0 && oscs.every((o) => o.starts.length === o.stops.length), `S30: no oscillator left running (${oscs.map((o) => `${o.starts.length}/${o.stops.length}`).join(' ')})`);
    s.expect(made.length > 0 && made.every((n) => n.disconnects >= 1), 'S30: every created node disconnected');
    s.expect(!reg.some((p) => p.ctx === (s.ctx as unknown as BaseAudioContext)), 'S30: the registry holds no player for the context');
    open(p528)(s);
  }]],
  final: (s) => s.expect(near(s.e('gateTB', 2.55), 1, s.tol) && s.recs.length === 1, 'S30: the next for() builds a working player'),
});

{
  // A silent step one ulp before an earlier ramp's end (review stepnow-refused-step). An anchor's cancel spares the
  // next 1.5 frames, so it keeps that end; a step before it would be refused (warned, nothing scheduled) while the
  // player records the new value, and nothing retries. On Chrome's 128-frame currentTime grid a call in the quantum
  // where a 0.8 s ramp ends finds that end, computed as now0 + 0.8, a hair after its own now ~1 time in 5.
  const ulpBefore = (x: number): number => x - 2 ** (Math.floor(Math.log2(x)) - 52);
  const fadeEnd = 10.5 + GATE_OUT_S, rampEnd = 9.6 + HOST_GLIDE_S; // as the player computes them
  sc({
    // The tone slider to 0 while a pause closes the gate, and back up as its fade ends: the tone must come back.
    name: 'S31 the tone slider back 1 ulp before its fade ends', end: 16,
    steps: [[0, open(p528)], [10, play(null)], [10.5, (s) => s.p.setLayerGains({ tone: 0 })],
      [ulpBefore(fadeEnd), (s) => s.p.setLayerGains({ tone: 1 })], [12, play(p528)]],
    final: (s) => s.expect(s.e('toneUser', 12) === 1 && near(s.amp('tone', 15)[0], 0.04008, 1e-9),
      `S31: the tone gain is back at 1 (${s.e('toneUser', 12)}; the tone ${s.amp('tone', 15)[0]} at 15)`),
  });
  sc({
    // A tone-only pause; a volume fall while the gate closes, then a silent host step as that ramp ends.
    name: 'S31 a host step 1 ulp before its ramp ends', end: 15,
    steps: [[0, open(p528, 0.8, 'off', false)], [9, play(null)], [9.6, (s) => s.p.setHostLevel(0.5)],
      [ulpBefore(rampEnd), (s) => s.p.setHostLevel(0.3)], [10.5, play(p528, 'off', false)]],
    final: (s) => s.expect(s.e('host', 10) === 0.3 && near(s.amp('tone', 14)[0], LEVEL_TONE * 0.3, 1e-9),
      `S31: the host steps to 0.3 (${s.e('host', 10)}; the tone ${s.amp('tone', 14)[0]} at 14)`),
  });
  sc({
    // A deferred rise whose T* (the drone's close) lands 1 ulp before the host's own 5 s fall ends: its step at T*.
    name: 'S31 a deferred step 1 ulp before the host\'s fall ends', end: 25,
    steps: [[0, open(p528)], [10, (s) => s.p.setHostLevel(0.05, { glideS: 5 })],
      [ulpBefore(12), (s) => { s.p.play(null); s.p.setHostLevel(0.6); }], [20, play(p528)]],
    final: (s) => s.expect(s.e('host', 16) === 0.6 && near(s.amp('tone', 24)[0], LEVEL_TONE * 0.6, 1e-9),
      `S31: the deferred step lands (host ${s.e('host', 16)} at 16; the tone ${s.amp('tone', 24)[0]} at 24)`),
  });
}

// ------------------------------------------------------------- run matrix --

const CONFIGS: RunCfg[] = [];
for (const engine of ['blink', 'gecko'] as Kind[]) {
  for (const lag of [-0.02, 0, 0.01, 0.05, 0.3]) for (const tickMs of [1000, 60000, null]) CONFIGS.push({ engine, tickMs, lag });
}
for (const tickMs of [1000, 60000, null]) CONFIGS.push({ engine: 'ideal', tickMs, lag: 0 });
const tickName = (t: number | null): string => (t === null ? 'never' : `${t / 1000} s`);

let runs = 0;
const runFails: string[] = [];
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7) : null;
const timing = process.argv.includes('--timing');
for (const s of SCENARIOS) {
  if (only && !s.name.startsWith(only)) continue;
  const ts0 = Date.now();
  const gates = new Map<string, Array<{ tick: number | null; tls: Timeline[] }>>();
  for (const cfg of CONFIGS) {
    const label = `${s.name} [${cfg.engine} tick ${tickName(cfg.tickMs)} L ${cfg.lag * 1000} ms]`;
    const sim = new Sim(cfg, label, s.mono ? 1 : 2);
    sim.run(s);
    runs++;
    for (const [k, m] of sim.fails) runFails.push(`${label}: ${k}: ${m}`);
    check(sim.fails.size === 0, `${label}: A1–A8 (${[...sim.fails.values()].slice(0, 2).join(' | ')})`);
    const key = `${cfg.engine}|${cfg.lag}`;
    if (!gates.has(key)) gates.set(key, []);
    gates.get(key).push({ tick: cfg.tickMs, tls: sim.recs.flatMap((r) => [r.byName.get('gateTB').p.tl, r.byName.get('gateDrone').p.tl]) });
  }
  // A7: the gates' engine timelines do not depend on the tick.
  for (const [key, list] of gates) {
    const ref = list[0];
    for (const other of list.slice(1)) {
      let worst = ref.tls.length === other.tls.length ? 0 : Infinity;
      for (let g = 0; g < ref.tls.length && worst < Infinity; g++) {
        const a = ref.tls[g], b = other.tls[g];
        const xs = [...a.ev, ...b.ev].flatMap((e) => [e.t - 1e-4, e.t, e.t + 1e-4]);
        for (let x = 0; x <= s.end; x += 0.5) xs.push(x);
        for (const x of xs) worst = Math.max(worst, Math.abs(a.valueAt(x) - b.valueAt(x)));
      }
      check(worst <= 1e-9, `${s.name} [${key.replace('|', ' L ')}]: A7 gate timelines identical for ticks ${tickName(ref.tick)} and ${tickName(other.tick)} (Δ ${worst})`);
    }
  }
  if (timing) console.log(`  ${String(Date.now() - ts0).padStart(5)} ms  ${s.name}`);
}

// -------------------------------------------------------------- API details --
// Engine-independent behaviour the scenarios do not reach, on one engine (E-blink, L = 0).

/** A one-off run on E-blink at L = 0 with the generic assertions, returning the sim for its own checks. */
function apiRun(name: string, tickMs: number | null, sc0: Omit<Scenario, 'name'>): Sim {
  const sim = new Sim({ engine: 'blink', tickMs, lag: 0 }, `API ${name}`);
  sim.run({ name, ...sc0 });
  check(sim.fails.size === 0, `API ${name}: A1–A8 (${[...sim.fails.values()].slice(0, 2).join(' | ')})`);
  return sim;
}
{
  // for() returns the live player and updates its callbacks; the constructor refuses a second live player.
  const states: string[] = [];
  apiRun('registry', 1000, {
    end: 12, warnings: 1,
    steps: [[0, (s) => {
      const a = s.make();
      const b = s.make({ onState: (st) => states.push(st.phase) });
      let threw = false;
      try {
        new LayerPlayer(s.ctx as unknown as BaseAudioContext, s.bus as unknown as AudioNode, { clock: () => s.clockT, timer: null });
      } catch {
        threw = true;
      }
      const other = new MNode(s, 'bus');
      const c = LayerPlayer.for(s.ctx as unknown as BaseAudioContext, other as unknown as AudioNode);
      LayerPlayer.for(s.ctx as unknown as BaseAudioContext, other as unknown as AudioNode);
      s.expect(a === b && b === c && threw, 'API: one live player per context (for() returns it; new throws)');
      a.setHostLevel(0.8);
      a.play(p528);
    }]],
    final: (s) => s.expect(states.length > 0 && states[0] === 'retuning', `API: for() applied the new onState (${states.join(',')})`),
  });
}
{
  // onState: transitions only — phases in order, never the same twice in a row, plus the drone rest.
  const seen: Array<[string, boolean]> = [];
  apiRun('onState', 60000, {
    end: 1210,
    steps: [[0, (s) => {
      s.make({ onState: (st) => seen.push([st.phase, st.drone.resting]) });
      s.p.setHostLevel(0.8);
      s.p.play(p528);
    }], [180, play(p639)], [190, play(p639)]],
    final: (s) => {
      const text = seen.map(([ph, r]) => `${ph}${r ? '+rest' : ''}`).join(',');
      s.expect(text === 'retuning,open,retuning,open,open+rest', `API: onState fires on transitions only (${text})`);
    },
  });
}
{
  // Idle stop: a v2 pause clears the tick once silent; any call re-arms it.
  apiRun('idle stop', 1000, {
    end: 30,
    steps: [[0, open(p528)], [10, play(null)], [20, (s) => s.p.setBeat(6)]],
    probes: [[9, (s) => s.expect(s.activeTimers() === 1, 'API: the tick runs while playing')],
      [15, (s) => s.expect(s.activeTimers() === 0 && s.st().phase === 'silent', `API: the tick stops when silent (${s.activeTimers()})`)],
      [20.5, (s) => s.expect(s.activeTimers() === 1, 'API: a call re-arms the tick')]],
  });
}
{
  // The duty horizon: pre-scheduled 2 h ahead and extended by the tick once less than 1 h remains (at the 60 s tick
  // at 3660), so the rest at 8400 is already on the timeline at 3700.
  const run = (tickMs: number | null): Sim => apiRun(`horizon ${tickName(tickMs)}`, tickMs, { end: 3700, steps: [[0, open(p528)]] });
  const t60 = run(60000), never = run(null);
  check(near(t60.e('gateDrone', 8403), 0, 1e-9) && near(t60.e('gateDrone', 8399), 1, 1e-9) && near(t60.e('gateDrone', 6603), 0, 1e-9),
    'API: the tick extends the drone duty past its 2 h horizon (the rest at 8400 is scheduled by 3700)');
  check(near(never.e('gateDrone', 6603), 0, 1e-9) && near(never.e('gateDrone', 8403), 1, 1e-9),
    'API: without a tick the duty stops at its 2 h horizon (the last scheduled rest is 6600-7200)');
}
{
  // Invalid plans warn once each and play as silence; the default render; clamps; bad numbers are warned and ignored.
  apiRun('inputs', 1000, {
    end: 60, warnings: 4,
    steps: [[0, open(p528)],
      [10, (s) => {
        s.p.play({ ...p528, tone_hz: NaN });
        s.p.play({ ...p528, tone_hz: NaN });
      }],
      [20, (s) => {
        s.p.play({ ...p528, carrier_hz: 30000 });
        s.p.play(p528);
      }],
      [30, (s) => {
        s.p.setLayerGains({ tone: 10, beat: -1, drone: NaN });
        s.p.setHostLevel(2);
        s.p.setHostLevel(NaN);
      }],
      [40, (s) => s.p.setHostLevel(-1, { glideS: 1000 })],
      [50, (s) => s.p.play(spk528)]],
    probes: [[11, (s) => s.expect(s.st().requested === null && s.st().phase === 'closing', 'API: an invalid plan plays as silence')],
      [20.1, (s) => s.expect(s.st().requested.render === 'binaural', 'API: the default render on headphones is binaural')],
      [30.1, (s) => {
        const g = s.st().gains;
        s.expect(g.tone === MAX_BOOST && g.beat === 0 && g.drone === 1, `API: gains clamp to [0, +12 dB]; NaN is ignored (${JSON.stringify(g)})`);
      }],
      [50.1, (s) => s.expect(s.st().requested.render === 'pulse', 'API: the default render off headphones is pulse')]],
    final: (s) => {
      s.expect(near(s.e('host', 31.6), 1, 1e-9), 'API: setHostLevel clamps to 1');
      s.expect(near(s.e('host', 45), 0.5, 1e-9) && near(s.e('host', 50), 0, 1e-9), 'API: setHostLevel clamps to 0 and glideS to 10 s');
    },
  });
}
{
  // User gains: ≤ 1 anchor per 100 ms per gain and ≥ 0.1 dB; the tick flushes the rest exactly.
  apiRun('gain throttle', 1000, {
    end: 60,
    steps: [[0, open(p528)], [50, (s) => s.p.setLayerGains({ tone: 1.5 })], [50.05, (s) => s.p.setLayerGains({ tone: 2 })],
      [52.5, (s) => s.p.setLayerGains({ tone: 2.001 })]],
    final: (s) => {
      s.expect(s.callsIn('toneUser', 50, 50.06).length === 1 && near(s.e('toneUser', 50.25), 1.5, 1e-9), 'API: a second change within 100 ms waits');
      s.expect(near(s.e('toneUser', 51.25), 2, 1e-9) && s.callsIn('toneUser', 51, 51).length === 1, 'API: the tick flushes it exactly');
      s.expect(s.callsIn('toneUser', 52.5, 52.5).length === 0 && near(s.e('toneUser', 52.9), 2, 1e-9) && near(s.e('toneUser', 53.25), 2.001, 1e-9),
        'API: < 0.1 dB waits for the tick, which applies it exactly');
    },
  });
}
{
  // No public method throws into React: an engine failure is caught, and reported through onError.
  const sim = new Sim({ engine: 'blink', tickMs: null, lag: 0 }, 'API safety');
  sim.task(0, () => open(p528)(sim));
  sim.explode = true;
  let escaped = 0;
  sim.task(5, () => {
    for (const f of [() => sim.p.play(p639), () => sim.p.setBeat(20), () => sim.p.setHostLevel(0.2), () => sim.p.setLayerGains({ tone: 0.5 }), () => sim.p.dispose()]) {
      try {
        f();
      } catch {
        escaped++;
      }
    }
  });
  sim.explode = false;
  check(escaped === 0 && ['play', 'setBeat', 'setHostLevel', 'setLayerGains'].every((w) => sim.errors.some((e) => e.includes(`(${w})`)))
    && sim.p.disposed && sim.p.state().phase === 'disposed', `API: engine failures stay inside the player (${escaped} escaped; ${sim.errors.length} reported)`);
  const reg = (globalThis as unknown as Record<symbol, LayerPlayer[] | undefined>)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [];
  check(!reg.includes(sim.p), 'API: a disposed player leaves the registry');
  // A throwing onState is reported, and the call's work (the tick re-arming included) still completes.
  const s2 = new Sim({ engine: 'blink', tickMs: 1000, lag: 0 }, 'API onState throws');
  let threw = 0;
  s2.task(0, () => {
    try {
      const p = s2.make({ onState: () => { throw new Error('a broken setter'); } });
      p.setHostLevel(0.8);
      p.play(p528);
    } catch {
      threw++;
    }
  });
  check(threw === 0 && s2.errors.some((e) => e.includes('(onState)')) && s2.activeTimers() === 1 && s2.p.state().phase === 'retuning',
    `API: a throwing onState stays inside the player (${s2.errors.join('; ')})`);
  const reg2 = (globalThis as unknown as Record<symbol, LayerPlayer[] | undefined>)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [];
  const k2 = reg2.indexOf(s2.p);
  if (k2 >= 0) reg2.splice(k2, 1);
}

// ------------------------------------------------------- negative controls --

/** The vendored LayerGraph on a sim (a negative control: it must fail as predicted). */
function graphRun(engine: Kind, retunes: Array<[number, Plan]>, probeAt: number): { sim: Sim; before: [number, number]; after: [number, number] } {
  const sim = new Sim({ engine, tickMs: null, lag: 0 }, `LayerGraph on E-${engine}`);
  sim.allowHold = engine !== 'gecko';
  sim.mainThreadValue = engine === 'gecko';
  let g: LayerGraph;
  let gate: EParam, drone: EParam;
  let before: [number, number] = [NaN, NaN], after: [number, number] = [NaN, NaN];
  sim.task(0, () => {
    g = new LayerGraph(sim.ctx as unknown as BaseAudioContext, sim.bus as unknown as AudioNode);
    g.play(p528);
    g.setLevel(1);
  });
  const G = g as unknown as { gate: { gain: EParam }; droneGate: { gain: EParam } };
  gate = G.gate.gain;
  drone = G.droneGate.gain;
  for (const [t, pl] of retunes) {
    const pre: [number, number] = [gate.tl.valueAt(t), drone.tl.valueAt(t)];
    sim.task(t, () => g.play(pl));
    if (t === probeAt) {
      before = pre;
      after = [gate.tl.valueAt(t), drone.tl.valueAt(t)];
    }
  }
  return { sim, before, after };
}
{
  // N1: E-blink with cancelAndHoldAtTime allowed (LG-01): the 0.8 s close ramps from the settled ramp's end, not from now.
  const { before, after } = graphRun('blink', [[180, p639]], 180);
  const a1 = Math.abs(after[0] - before[0]) >= 1e-3;
  console.log(`  N1 LayerGraph on E-blink: at 180 the gate ${before[0]} → ${after[0].toFixed(6)}, the drone ${before[1]} → ${after[1].toFixed(6)}`);
  check(before[0] === 1 && near(after[0], 0.8 / 178.28, 1e-9) && before[1] === 1 && near(after[1], 3 / 174.98, 1e-9) && a1,
    `N1: the vendored LayerGraph steps the gate 1 → ${after[0]} (0.8/178.28) and the drone 1 → ${after[1]} (3/174.98) at 180 — A1 fails`);
  // N2: E-gecko, the main-thread value getter (LG-02): the second retune's hold reads the gate after its own cancel.
  const n2 = graphRun('gecko', [[10, p639], [15, p528]], 15);
  console.log(`  N2 LayerGraph on E-gecko: at 15 the gate ${n2.before[0].toFixed(6)} → ${n2.after[0]} (${n2.sim.reads} main-thread .value reads)`);
  check(near(n2.before[0], 0.792, 1e-9) && n2.after[0] === 0 && n2.sim.reads > 0, `N2: the gate jumps ${n2.before[0]} → ${n2.after[0]} at 15 (LG-02)`);
}
{
  // N3: a future setValueAtTime anchor inside a ramp holds the ramp's START value until its time.
  const sim = new Sim({ engine: 'blink', tickMs: null, lag: 0 }, 'N3');
  const p = sim.param(1);
  p.setValueAtTime(1, 0);
  p.linearRampToValueAtTime(0, 1);
  sim.tau = 0.5;
  p.setValueAtTime(0.4, 0.6);
  const jumped = p.tl.valueAt(0.5);
  const q = sim.param(1);
  q.setValueAtTime(1, 0);
  q.linearRampToValueAtTime(0, 1);
  q.linearRampToValueAtTime(0.4, 0.6); // the on-the-line anchor (then the cancel)
  q.cancelScheduledValues(0.6 + 1.5 / SR);
  console.log(`  N3 a future set at 0.6 inside 1 → 0 over [0, 1]: 0.5 reads ${jumped}; the on-the-line anchor keeps ${q.tl.valueAt(0.5)}`);
  check(jumped === 1 && near(q.tl.valueAt(0.5), 0.5, 1e-12), `N3: a set at 0.6 makes 0.5 read ${jumped}; the on-the-line anchor keeps ${q.tl.valueAt(0.5)}`);
}
{
  // N4 (pure math): the S21 pause with the rise applied at once — host 0.07319 → 0.8 over 1.5 s × the drone gate 1 → 0
  // over 3 s — peaks ≥ +14 dB above the pause value.
  let peak = 0, at = 0;
  for (let t = 0; t <= 3; t += 1e-3) {
    const v = (H21 + (0.8 - H21) * Math.min(t / 1.5, 1)) * (1 - t / 3);
    if (v > peak) {
      peak = v;
      at = t;
    }
  }
  const db = 20 * Math.log10(peak / H21);
  console.log(`  N4 an undeferred rise after the S21 pause: the drone peaks +${db.toFixed(2)} dB at +${at.toFixed(3)} s`);
  check(db >= 14 && near(db, 14.8, 0.1) && near(at, 1.4, 0.06), `N4: an undeferred rise swells the drone +${db.toFixed(2)} dB at +${at.toFixed(2)} s (A8 is load-bearing)`);
}

if (runFails.length) {
  // Which assertion failed where: engines, lags and scenarios (for the mutation report).
  const by = new Map<string, { runs: number; eng: Set<string>; lag: Set<string>; sc: Set<string> }>();
  for (const f of runFails) {
    const m = /^(.*?) \[(\w+) tick [^\]]* L (-?[\d.]+) ms\]: (\S+):/.exec(f);
    if (!m) continue;
    if (!by.has(m[4])) by.set(m[4], { runs: 0, eng: new Set(), lag: new Set(), sc: new Set() });
    const g = by.get(m[4]);
    g.runs++;
    g.eng.add(m[2]);
    g.lag.add(m[3]);
    g.sc.add(m[1]);
  }
  for (const [k, g] of by) {
    const sc = [...g.sc];
    console.log(`  ${k} failed in ${g.runs} runs (${[...g.eng].join('/')}; L ${[...g.lag].join('/')} ms): ${sc.slice(0, 8).join(', ')}${sc.length > 8 ? ` (+${sc.length - 8} more)` : ''}`);
  }
}
const fmt = (r: Record<string, number>): string => Object.entries(r).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ');
console.log(`  worst mirror − engine on the grids: ${fmt(worst.a3)}`);
console.log(`  worst audible gain step at a call (L ≤ 0): ${fmt(worst.a1)}; worst lag step / bound (L > 0): `
  + `blink ${worst.lag.blink.toFixed(4)}, gecko ${worst.lag.gecko.toFixed(4)}`);
console.log(`  worst E-blink intermediate state / bound: ${worst.a2.toFixed(3)}`);
const secs = (Date.now() - t0) / 1000;
console.log(`  ${runs} runs (${SCENARIOS.length} scenarios × ${CONFIGS.length} engine/tick/lag configs) in ${secs.toFixed(1)} s`);
console.log(`layerPlayer: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures.slice(0, 20)) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
