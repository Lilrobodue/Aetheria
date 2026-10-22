// utils/soundV2/layerPlayer.ts
//
// The v2 layer player: one Web Audio graph per AudioContext, built once in the
// constructor and then driven only through ParamTracks (layerSchedule.ts), so
// every change starts from what the player itself scheduled: never from
// AudioParam.value, never with cancelAndHoldAtTime (the vendored LayerGraph's
// fades stepped in Chrome and Edge that way: LG-01, README.md). App calls
// play() whenever the plan may have changed (an unchanged plan costs nothing),
// setBeat() as the band moves, setHostLevel() with the music's level and
// setLayerGains() with the sliders. Every public method catches its own
// errors: the player never throws into React.
//
// A voice change goes through silence, GDScript-style: the gates close at
// their rates, frequencies, routing and plan levels step at fAt, the middle of
// a gap of at least 20 ms where both gates are exactly 0, and the gates
// reopen. A revert before fAt costs nothing. The host never touches the gates
// or the plan levels, and a host rise never lands while anything falls toward
// 0 (A8): it waits as player state and is pre-scheduled on the param, so
// nothing audible depends on the tick. The drone's duty cycle runs in
// continuous time and its rests are pre-scheduled two hours ahead.
//
// Erasable TypeScript only, like the rest of utils/soundV2 (Node runs
// layerPlayer.check.ts on it directly); type imports use `import type`.

import type { Plan } from './aetheria_sound_v2.ts';
import { VERSION, LEVEL_BEAT, MOD_DEPTH, GATE_OUT_S, GATE_IN_S, DRONE_OUT_S, DRONE_IN_S, DRONE_ON_S } from './aetheria_sound_v2.ts';
import type { BeatRender, Duty } from './layerSchedule.ts';
import { ParamTrack, createAudioClock, advanceDuty, droneGatePoints, voiceKey, MAX_BOOST, NEW_DUTY } from './layerSchedule.ts';

export type { BeatRender };
export type LayerPhase = 'silent' | 'retuning' | 'opening' | 'open' | 'closing' | 'disposed';
/** User gains: linear multipliers of the validated levels; 1 = 0 dB. */
export interface LayerGains {
  tone: number;
  beat: number;
  drone: number;
}
export interface LayerPlayerCallbacks {
  /** Phase and drone-rest transitions only; may arrive late in hidden tabs; may only call stable setters or refs. */
  onState?: (s: LayerPlayerState) => void;
  /** After any caught error (App falls back to classic). */
  onError?: (err: unknown, where: string) => void;
  /** Default console.warn. */
  warn?: (msg: string) => void;
}
export interface LayerPlayerOptions extends LayerPlayerCallbacks {
  /** Default: createAudioClock(ctx) for an AudioContext, () => ctx.currentTime otherwise; tests inject virtual time. */
  clock?: () => number;
  /** Default setInterval/clearInterval; null = no tick. */
  timer?: { set(fn: () => void, ms: number): unknown; clear(id: unknown): void } | null;
  /** Default 1000. */
  tickMs?: number;
  /** A disposed predecessor's duty on the SAME context (`{ ...state().drone, t: state().t }`): the time since t counts
   *  as quiet, a rest in progress continues. Ignored by for() when a live player is returned, and when t is not finite
   *  or > now. */
  resumeDuty?: { on_s: number; quiet_s: number; rest_ends_at: number | null; t: number } | null;
}
export interface VoiceSnapshot {
  key: string;
  canonical_hz: number;
  sounding_hz: number;
  sham_cents: number;
  arm: string;
  output: string;
  /** Effective (after mono coercion). */
  render: BeatRender;
  tone_hz: number;
  carrier_hz: number;
  /** Now (the mirror, gliding); 0 when no partner sounds (pulse, off, beat 0). */
  partner_hz: number;
  beat_hz: number;
  /** min(beat, 10) in pulse, else 0. */
  pulse_rate_hz: number;
  /** drone_hz and pulse_hz are 0 when no effective sub-bass drone plays. */
  drone_hz: number;
  pulse_hz: number;
}
export interface LayerPlayerState {
  /** VERSION (always 2: the sound log carries its own engine label). */
  sound_version: number;
  player_version: number;
  t: number;
  phase: LayerPhase;
  sounding: VoiceSnapshot | null;
  requested: VoiceSnapshot | null;
  retune_at: number | null;
  /** Mirror values now. */
  gates: { tone_beat: number; drone: number };
  /** The host mirror now; gains = the user targets. */
  host_level: number;
  gains: LayerGains;
  mono_output: boolean;
  drone: { resting: boolean; on_s: number; quiet_s: number; rest_ends_at: number | null; next_rest_at: number | null };
}

// --------------------------------------------------------------- constants --

export const PLAYER_VERSION = 1;
/** The off-headphones pulse (decision 6): the beat layer's AM gain swings PULSE_AM_BASE ± PULSE_AM_SWING. */
export const PULSE_DEPTH = 0.35;
export const PULSE_AM_BASE = 1 - PULSE_DEPTH / 2; // 0.825
export const PULSE_AM_SWING = PULSE_DEPTH / 2; // 0.175
/** Peak-matched to the validated −23 dB per-ear peak of the binaural beat (Q1). */
export const PULSE_PEAK = LEVEL_BEAT;
/** The pulse never runs above alpha. */
export const PULSE_MAX_HZ = 10;
/** The beat glide's time constant (spec §3.4, tone_layers.gd:509; the vendored graph used 1 s: DIV-04). */
export const BEAT_TAU_S = 3;
/** The silence before a retune reopens, and how far ahead a retune from silence opens. */
export const RETUNE_GAP_S = 0.02, RETUNE_MIN_LEAD_S = 0.05;
/** Host ramps: small changes over 0.25 s, ≥ 6 dB over 1.5 s; levels below 1e-3 compare as 1e-3. */
export const HOST_GLIDE_S = 0.25, HOST_JUMP_DB = 6, HOST_JUMP_S = 1.5, HOST_FLOOR = 1e-3;
/** At most one host or gain anchor per 100 ms, and only for a change of at least 0.1 dB. */
export const THROTTLE_MIN_INTERVAL_S = 0.1, THROTTLE_MIN_STEP_DB = 0.1;
/** Non-zero user-gain changes. */
export const USER_GLIDE_S = 0.25;
export const DISPOSE_FADE_S = 0.25, DISPOSE_STOP_S = 0.3;
/** The drone duty is pre-scheduled 2 h ahead and extended when less than 1 h remains. */
export const DUTY_HORIZON_S = 7200, DUTY_EXTEND_BELOW_S = 3600;
/** The drone's AM gain: 0.85 ± 0.15 (MOD_DEPTH 0.3). */
export const DRONE_AM_BASE = 1 - MOD_DEPTH / 2, DRONE_AM_SWING = MOD_DEPTH / 2;
/** A plan frequency at or above this fraction of the sample rate is invalid. */
export const MAX_PLAN_FRACTION = 0.45;
/** The beat target's range, and where the partner and the beat LFO park at beat 0. */
const MAX_BEAT_HZ = 100, PARKED_BEAT_HZ = 10;
/** Before the first voice. */
const PARKED = { tone: 300, carrier: 200, partner: 210, beatLfo: 10, drone: 30, droneLfo: 7.5 };
/** glideS is clamped to this range. */
const GLIDE_MIN_S = 0.05, GLIDE_MAX_S = 10;

type LayerKey = 'tone' | 'beat' | 'drone';
const LAYER_KEYS: readonly LayerKey[] = ['tone', 'beat', 'drone'];

// ---------------------------------------------------------------- registry --

// One live player per context, kept on globalThis rather than in a module-level map, so a Vite hot update (a fresh
// copy of this module) can never build a second graph on the same context.
const REG = Symbol.for('aetheria.soundV2.layerPlayers.v1');
function live(): LayerPlayer[] {
  const g = globalThis as unknown as Record<symbol, LayerPlayer[] | undefined>;
  let list = g[REG];
  if (!Array.isArray(list)) {
    list = [];
    g[REG] = list;
  }
  return list;
}
// Dev only (Vite strips it from builds): a hot update disposes the old module's players.
(import.meta as unknown as { hot?: { dispose(cb: () => void): void } }).hot?.dispose(() => {
  for (const p of [...live()]) p.dispose();
});

// ----------------------------------------------------------------- helpers --

interface Voice {
  plan: Plan;
  render: BeatRender; // effective: after mono coercion
  drone: boolean; // the sub-bass drone really plays (§4.5)
  beatOn: boolean;
  key: string;
}
interface Pending {
  voice: Voice;
  fAt: number;
  at: number;
}
interface UserGain {
  track: ParamTrack;
  target: number; // what is scheduled
  end: number;
  lastAnchor: number;
}
interface Deferred {
  x: number;
  tStar: number;
  glideS: number | undefined;
  step: boolean; // a silent step at T* (both gates 0 there), else a ramp from T*
  dur: number;
  jump: boolean;
}
type Own = Readonly<Record<'host' | LayerKey, boolean>>;
const OWN_NONE: Own = { host: false, tone: false, beat: false, drone: false };
const OWN_HOST: Own = { host: true, tone: false, beat: false, drone: false };

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
/** |a − b| in dB, both floored at HOST_FLOOR. */
const dbApart = (a: number, b: number): number => Math.abs(20 * Math.log10(Math.max(a, HOST_FLOOR) / Math.max(b, HOST_FLOOR)));

/** The end of a fall toward 0 on a track (a run of falling ramps that reaches 0) under way at t or starting before
 *  `before`, or null. Gates, host and user gains only hold steps and ramps. */
function fallEnd(tr: ParamTrack, t: number, before: number): number | null {
  const ev = tr.events;
  let k = 0;
  while (k < ev.length && ev[k].t <= t) k++;
  let start = t;
  let v = tr.valueAt(t);
  while (k < ev.length && start < before) {
    const e = ev[k];
    if (e.type === 'lin' && e.v < v) {
      let end = e.t, w = e.v;
      k++;
      while (w > 0 && k < ev.length && ev[k].type === 'lin' && ev[k].v < w) {
        end = ev[k].t;
        w = ev[k].v;
        k++;
      }
      if (w <= 0) return end;
      start = end;
      v = w;
      continue;
    }
    start = e.t;
    v = e.v;
    k++;
  }
  return null;
}

const DEFAULT_TIMER = {
  set: (fn: () => void, ms: number): unknown => setInterval(fn, ms),
  clear: (id: unknown): void => clearInterval(id as ReturnType<typeof setInterval>),
};

function defaultClock(ctx: BaseAudioContext): () => number {
  // A realtime context's currentTime can stall (Gecko after long tasks): createAudioClock extrapolates. An offline
  // context only moves while it renders, and its currentTime is the whole truth. (Anything not offline counts as
  // realtime, so an old prefixed webkitAudioContext still gets the margin.)
  const offline = typeof OfflineAudioContext === 'function' && ctx instanceof OfflineAudioContext;
  return offline ? () => ctx.currentTime : createAudioClock(ctx);
}

// ------------------------------------------------------------------ player --

export class LayerPlayer {
  /** The live player for ctx (its callbacks updated from `options`), or a new one. */
  static for(ctx: BaseAudioContext, destination: AudioNode, options?: LayerPlayerOptions): LayerPlayer {
    const p = live().find((x) => x.ctx === ctx);
    if (!p) return new LayerPlayer(ctx, destination, options);
    if (p.destination !== destination) {
      p.warnOnce('for:destination', 'LayerPlayer.for: the live player for this context plays into another node; keeping it');
    }
    if (options) p.setCallbacks(options);
    return p;
  }

  readonly ctx: BaseAudioContext;
  private readonly destination: AudioNode;
  private readonly sampleRate: number;
  private readonly clock: () => number;
  private readonly timer: { set(fn: () => void, ms: number): unknown; clear(id: unknown): void } | null;
  private readonly tickMs: number;
  private onState: ((s: LayerPlayerState) => void) | undefined;
  private onError: ((err: unknown, where: string) => void) | undefined;
  private warnFn: (msg: string) => void;
  private readonly warned = new Set<string>();

  // The graph (§4.4).
  private readonly oscs: OscillatorNode[];
  private readonly toneOsc: OscillatorNode;
  private readonly hostNode: GainNode;
  // Mirrors of every automated param.
  private readonly fTone: ParamTrack;
  private readonly fCarrier: ParamTrack;
  private readonly fPartner: ParamTrack;
  private readonly fBeatLfo: ParamTrack;
  private readonly fDrone: ParamTrack;
  private readonly fDroneLfo: ParamTrack;
  private readonly cL: ParamTrack;
  private readonly cR: ParamTrack;
  private readonly pL: ParamTrack;
  private readonly pR: ParamTrack;
  private readonly amBase: ParamTrack;
  private readonly amDepth: ParamTrack;
  private readonly tonePlan: ParamTrack;
  private readonly beatPlan: ParamTrack;
  private readonly dronePlan: ParamTrack;
  private readonly gateTB: ParamTrack;
  private readonly gateDrone: ParamTrack;
  private readonly host: ParamTrack;
  private readonly users: Record<LayerKey, UserGain>;
  /** Frequencies, routing, AM and plan levels: they change only at a retune's fAt (and the beat's glides). */
  private readonly retuneTracks: ParamTrack[];
  /** Everything that can fall toward 0 under a host rise (A8). */
  private readonly fallTracks: ParamTrack[];
  private readonly tracks: ParamTrack[];

  // Voices (§4.6).
  private requested: Voice | null = null;
  private sounding: Voice | null = null;
  private pending: Pending | null = null;
  private beat = PARKED_BEAT_HZ;
  private mono = false;
  // Time and the drone duty (§4.10).
  private nowT = 0;
  private duty: Duty = NEW_DUTY;
  private dutyT = 0;
  private intentNow = false;
  private droneHorizon = -Infinity;
  // Levels (§4.8, §4.9).
  private readonly gains: LayerGains = { tone: 1, beat: 1, drone: 1 };
  private hostWant = 0;
  private hostTarget = 0;
  private hostEnd = -Infinity;
  private hostGlideS: number | undefined = undefined;
  private hostLastAnchor = -Infinity;
  private jumpTarget = 0;
  private jumpEnd = -Infinity;
  private deferred: Deferred | null = null;
  // Life cycle.
  private isDisposed = false;
  private timerId: unknown = null;
  private armed = false;
  private lastPhase: LayerPhase = 'silent';
  private lastResting = false;

  /** Throws if a live player exists for ctx (use for()), and rethrows any failure to build the graph after
   *  stopping and disconnecting whatever it made. */
  constructor(ctx: BaseAudioContext, destination: AudioNode, options?: LayerPlayerOptions) {
    const o = options ?? {};
    if (live().some((x) => x.ctx === ctx)) throw new Error('LayerPlayer: a live player exists for this context; use LayerPlayer.for()');
    const sr = ctx.sampleRate;
    if (!Number.isFinite(sr) || sr <= 0) throw new RangeError(`LayerPlayer: sample rate ${sr} is not usable`);
    this.ctx = ctx;
    this.destination = destination;
    this.sampleRate = sr;
    this.onState = o.onState;
    this.onError = o.onError;
    this.warnFn = o.warn ?? ((msg: string) => console.warn(msg));
    this.clock = o.clock ?? defaultClock(ctx);
    this.timer = o.timer === undefined ? DEFAULT_TIMER : o.timer;
    this.tickMs = typeof o.tickMs === 'number' && o.tickMs > 0 ? o.tickMs : 1000;

    // Build order (§4.4), so that a failure leaves nothing running: (1) create every node, (2) initial values through
    // the .value setter, before any automation, (3) connect, (4) start; only then (5) register and arm the tick. On a
    // throw, stop whatever started and disconnect everything made (the one stop() outside dispose(): this player never
    // existed), then rethrow so App falls back to classic.
    const made: AudioNode[] = [];
    const started: OscillatorNode[] = [];
    try {
      const osc = (): OscillatorNode => {
        const n = ctx.createOscillator();
        made.push(n);
        return n;
      };
      const gain = (): GainNode => {
        const n = ctx.createGain();
        made.push(n);
        return n;
      };
      // (1)
      const tone = osc(), carrier = osc(), partner = osc(), beatLfo = osc(), drone = osc(), droneLfo = osc();
      const tonePlan = gain(), toneUser = gain();
      const cL = gain(), cR = gain(), pL = gain(), pR = gain();
      const pulseAm = gain(), beatLfoDepth = gain(), beatPlan = gain(), beatUser = gain();
      const droneAm = gain(), droneLfoDepth = gain(), dronePlan = gain(), droneUser = gain();
      const gateTB = gain(), gateDrone = gain(), host = gain();
      const merger = ctx.createChannelMerger(2);
      made.push(merger);
      // (2)
      const init = (p: AudioParam, v: number): AudioParam => {
        p.value = v;
        return p;
      };
      for (const n of [tone, carrier, partner, beatLfo, drone, droneLfo]) n.type = 'sine';
      const track = (p: AudioParam, v: number): ParamTrack => new ParamTrack(init(p, v), v, sr, (m: string) => this.warnFn(m));
      this.fTone = track(tone.frequency, PARKED.tone);
      this.fCarrier = track(carrier.frequency, PARKED.carrier);
      this.fPartner = track(partner.frequency, PARKED.partner);
      this.fBeatLfo = track(beatLfo.frequency, PARKED.beatLfo);
      this.fDrone = track(drone.frequency, PARKED.drone);
      this.fDroneLfo = track(droneLfo.frequency, PARKED.droneLfo);
      this.tonePlan = track(tonePlan.gain, 0);
      this.cL = track(cL.gain, 0);
      this.cR = track(cR.gain, 0);
      this.pL = track(pL.gain, 0);
      this.pR = track(pR.gain, 0);
      this.amBase = track(pulseAm.gain, 1);
      this.amDepth = track(beatLfoDepth.gain, 0);
      this.beatPlan = track(beatPlan.gain, 0);
      this.dronePlan = track(dronePlan.gain, 0);
      this.gateTB = track(gateTB.gain, 0);
      this.gateDrone = track(gateDrone.gain, 0);
      this.host = track(host.gain, 0);
      const user = (p: AudioParam): UserGain => ({ track: track(p, 1), target: 1, end: -Infinity, lastAnchor: -Infinity });
      this.users = { tone: user(toneUser.gain), beat: user(beatUser.gain), drone: user(droneUser.gain) };
      init(droneAm.gain, DRONE_AM_BASE); // never automated
      init(droneLfoDepth.gain, DRONE_AM_SWING);
      // (3) Mono sources up-mix to L = R where they meet the stereo beat (no panner, no −3 dB).
      tone.connect(tonePlan);
      tonePlan.connect(toneUser);
      toneUser.connect(gateTB);
      carrier.connect(cL);
      carrier.connect(cR);
      partner.connect(pL);
      partner.connect(pR);
      cL.connect(merger, 0, 0);
      pL.connect(merger, 0, 0);
      cR.connect(merger, 0, 1);
      pR.connect(merger, 0, 1);
      merger.connect(pulseAm);
      beatLfo.connect(beatLfoDepth);
      beatLfoDepth.connect(pulseAm.gain); // pulseAm = amBase + beatLfo × amDepth
      pulseAm.connect(beatPlan);
      beatPlan.connect(beatUser);
      beatUser.connect(gateTB);
      drone.connect(droneAm);
      droneLfo.connect(droneLfoDepth);
      droneLfoDepth.connect(droneAm.gain); // droneAm = 0.85 + 0.15 × droneLfo
      droneAm.connect(dronePlan);
      dronePlan.connect(droneUser);
      droneUser.connect(gateDrone);
      gateTB.connect(host);
      gateDrone.connect(host);
      host.connect(destination);
      // (4)
      this.oscs = [tone, carrier, partner, beatLfo, drone, droneLfo];
      for (const n of this.oscs) {
        n.start();
        started.push(n);
      }
      this.toneOsc = tone;
      this.hostNode = host;
    } catch (err) {
      for (const n of started) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
      for (const n of made) {
        try {
          n.disconnect();
        } catch {
          /* never connected */
        }
      }
      throw err;
    }
    this.retuneTracks = [
      this.fTone, this.fCarrier, this.fPartner, this.fBeatLfo, this.fDrone, this.fDroneLfo,
      this.cL, this.cR, this.pL, this.pR, this.amBase, this.amDepth, this.tonePlan, this.beatPlan, this.dronePlan,
    ];
    this.fallTracks = [this.gateTB, this.gateDrone, this.users.tone.track, this.users.beat.track, this.users.drone.track];
    this.tracks = [...this.retuneTracks, ...this.fallTracks, this.host];

    // (5)
    let now = 0;
    try {
      const c = this.clock();
      if (Number.isFinite(c) && c > 0) now = c;
    } catch {
      /* the first call's advance() reads it again */
    }
    this.nowT = now;
    this.dutyT = now;
    const r = o.resumeDuty;
    if (r && typeof r.t === 'number' && Number.isFinite(r.t) && r.t <= now) {
      const carried: Duty = { onS: r.on_s, quietS: r.quiet_s, restUntil: r.rest_ends_at };
      this.duty = advanceDuty(carried, r.t, now, false).duty; // the time since the predecessor's state counts as quiet
    }
    this.lastResting = this.duty.restUntil !== null;
    live().push(this);
    this.arm();
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  // ------------------------------------------------------------ public API --

  /** Sound this plan (null = silence: a pause closes the gates). render defaults to binaural on headphones with a
   *  binaural plan, else pulse; drone false = a voice with no drone (tone only). */
  play(plan: Plan | null, render?: BeatRender, drone?: boolean): void {
    if (this.gone('play')) return;
    try {
      const now = this.advance();
      let next: Voice | null = null;
      let beat = this.beat;
      if (plan) {
        const v = this.voiceOf(plan, render, drone);
        if (v) {
          next = v.voice;
          beat = v.beat;
        }
      }
      this.request(now, next, beat);
      this.finish(now, OWN_NONE);
    } catch (err) {
      this.report(err, 'play');
    }
  }

  /** The beat target, clamped to [0, 100] Hz (NaN is ignored). Within a voice it glides; 0 ↔ > 0 is a voice change. */
  setBeat(hz: number): void {
    if (this.gone('setBeat')) return;
    try {
      const now = this.advance();
      if (typeof hz === 'number' && !Number.isNaN(hz)) {
        const b = clamp(hz, 0, MAX_BEAT_HZ);
        if (b !== this.beat) {
          const r = this.requested;
          this.request(now, r ? this.withBeat(r, b > 0) : null, b);
        }
      }
      this.finish(now, OWN_NONE);
    } catch (err) {
      this.report(err, 'setBeat');
    }
  }

  /** The host level, linear 0..1 (the music's level × the envelope). glideS (clamped to [0.05, 10] s) sets the ramp's
   *  duration; a rise waits while anything falls toward 0 (A8). */
  setHostLevel(linear: number, opts?: { glideS?: number }): void {
    if (this.gone('setHostLevel')) return;
    try {
      const now = this.advance();
      if (typeof linear === 'number' && !Number.isNaN(linear)) {
        const g = opts && typeof opts.glideS === 'number' && !Number.isNaN(opts.glideS) ? clamp(opts.glideS, GLIDE_MIN_S, GLIDE_MAX_S) : undefined;
        const x = clamp(linear, 0, 1);
        this.hostWant = x;
        this.applyHost(now, x, g, false);
      } else {
        this.warnOnce('setHostLevel:nan', `LayerPlayer.setHostLevel: ${linear} is not a level; ignored`);
      }
      this.finish(now, OWN_HOST);
    } catch (err) {
      this.report(err, 'setHostLevel');
    }
  }

  /** User gains per layer, each clamped to [0, MAX_BOOST] (+12 dB). */
  setLayerGains(g: Partial<LayerGains>): void {
    if (this.gone('setLayerGains')) return;
    try {
      const now = this.advance();
      const own = { host: false, tone: false, beat: false, drone: false };
      const intentBefore = this.intent();
      if (g) {
        for (const k of LAYER_KEYS) {
          const x = g[k];
          if (x === undefined) continue;
          if (typeof x !== 'number' || Number.isNaN(x)) {
            this.warnOnce(`setLayerGains:${k}`, `LayerPlayer.setLayerGains: ${k} ${x} is not a gain; ignored`);
            continue;
          }
          own[k] = true;
          this.gains[k] = clamp(x, 0, MAX_BOOST);
          this.applyUser(now, k, this.gains[k], false);
        }
      }
      if (this.intent() !== intentBefore) this.deriveDrone(now); // the duty intent follows the drone gain
      this.finish(now, own);
    } catch (err) {
      this.report(err, 'setLayerGains');
    }
  }

  setCallbacks(cb: LayerPlayerCallbacks): void {
    if (!cb) return;
    if (cb.onState !== undefined) this.onState = cb.onState;
    if (cb.onError !== undefined) this.onError = cb.onError;
    if (cb.warn !== undefined) this.warnFn = cb.warn;
  }

  /** A pure read of the mirrors at clock(): never touches the engine; works after dispose. */
  state(): LayerPlayerState {
    let now = this.nowT;
    try {
      const c = this.clock();
      if (c > now) now = c;
    } catch {
      /* keep the last time */
    }
    return this.snapshot(now);
  }

  /** The host fades to 0 over 0.25 s from wherever it is, the oscillators stop 0.3 s from now, and the host
   *  disconnects when they have. Idempotent; later calls warn once each and schedule nothing. */
  dispose(): void {
    if (this.isDisposed) return;
    let now = this.nowT;
    try {
      now = this.advance();
    } catch (err) {
      this.report(err, 'dispose');
    }
    // Always a fresh anchor at now: it deletes whatever is in flight or pre-scheduled (a deferred rise included), so
    // the host is 0 before the stop.
    try {
      this.host.path(now, [[now + DISPOSE_FADE_S, 0]]);
    } catch (err) {
      this.report(err, 'dispose');
    }
    try {
      const host = this.hostNode;
      if (this.ctx.state === 'closed') host.disconnect();
      else this.toneOsc.onended = () => {
        try {
          host.disconnect();
        } catch {
          /* the context is gone */
        }
      };
    } catch (err) {
      this.report(err, 'dispose');
    }
    for (const n of this.oscs) {
      try {
        n.stop(now + DISPOSE_STOP_S);
      } catch (err) {
        this.report(err, 'dispose');
      }
    }
    this.deferred = null;
    this.stopTimer();
    const list = live();
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
    this.isDisposed = true;
  }

  // --------------------------------------------------------------- voices --

  /** A plan as a voice, with its beat target; null (warned once) when it is not playable. */
  private voiceOf(plan: Plan, render: BeatRender | undefined, droneArg: boolean | undefined): { voice: Voice; beat: number } | null {
    const lim = MAX_PLAN_FRACTION * this.sampleRate;
    const hz = (f: unknown): boolean => typeof f === 'number' && Number.isFinite(f) && f > 0 && f < lim;
    const level = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    const beat = typeof plan.beat_hz === 'number' && Number.isFinite(plan.beat_hz) ? clamp(plan.beat_hz, 0, MAX_BEAT_HZ) : NaN;
    const drone = droneArg !== false && plan.drone_sub === true && plan.drone_hz > 0;
    const ok = hz(plan.tone_hz) && hz(plan.carrier_hz) && !Number.isNaN(beat) && hz(plan.carrier_hz + (beat > 0 ? beat : PARKED_BEAT_HZ))
      && level(plan.level_tone) && (!drone || (hz(plan.drone_hz) && hz(plan.pulse_hz) && level(plan.level_drone)));
    if (!ok) {
      this.warnOnce(`plan:${plan.tone_hz}|${plan.carrier_hz}|${plan.beat_hz}|${plan.drone_hz}|${plan.pulse_hz}`,
        `LayerPlayer.play: the plan for ${plan.canonical_hz} Hz is not playable (tone ${plan.tone_hz}, carrier ${plan.carrier_hz}, `
        + `beat ${plan.beat_hz}, drone ${plan.drone_hz}); treated as silence`);
      return null;
    }
    let r: BeatRender = render === 'binaural' || render === 'pulse' || render === 'off'
      ? render
      : plan.output === 'headphones' && plan.beat_mode === 'binaural' ? 'binaural' : 'pulse';
    const ch = (this.ctx.destination as { maxChannelCount?: number } | null | undefined)?.maxChannelCount;
    this.mono = typeof ch === 'number' && ch < 2;
    if (this.mono && r === 'binaural') r = 'pulse'; // one channel: a binaural pair would just beat as one tone
    return { voice: this.makeVoice(plan, r, drone, beat > 0), beat };
  }

  private makeVoice(plan: Plan, render: BeatRender, drone: boolean, beatOn: boolean): Voice {
    const key = voiceKey({
      tone: plan.tone_hz, carrier: plan.carrier_hz, render, beatOn, drone: drone ? plan.drone_hz : 0, pulse: plan.pulse_hz,
    });
    return { plan, render, drone, beatOn, key };
  }

  private withBeat(v: Voice, beatOn: boolean): Voice {
    return v.beatOn === beatOn ? v : this.makeVoice(v.plan, v.render, v.drone, beatOn);
  }

  /** The retune state machine (§4.6). Runs after advance(), so a pending retune here has not reached `at`. */
  private request(now: number, next: Voice | null, beat: number): void {
    const beatChanged = beat !== this.beat;
    this.beat = beat;
    const prev = this.requested;
    this.requested = next;
    if (next === null) {
      if (prev !== null) {
        // Pause: drop the pending steps (sounding stays what the oscillators hold) and close at the gates' rates.
        // The host and the plan levels are untouched, and the oscillators keep running.
        this.dropPending(now);
        this.pending = null;
        this.closeGates(now);
      } else if (beatChanged) {
        this.updateBeat(now);
      }
      return;
    }
    const pend = this.pending;
    if (pend) {
      if (next.key === pend.voice.key) {
        // The retune already under way: only the beat target can change.
        pend.voice = next;
        if (beatChanged) this.updateBeat(now);
        return;
      }
      if (this.sounding !== null && next.key === this.sounding.key) {
        // A → B → A before fAt: drop B's steps (no frequency changes; a beat glide in flight runs on) and reopen.
        this.dropPending(now);
        this.pending = null;
        this.sounding = next;
        this.reopen(now);
        if (beatChanged) this.updateBeat(now);
        return;
      }
      // A third voice: the gates keep closing at their rates; new steps at the new fAt.
      this.dropPending(now);
      this.retune(now, next);
      return;
    }
    if (this.sounding !== null && next.key === this.sounding.key) {
      this.sounding = next;
      if (prev === null) this.reopen(now); // resume is a reopen, not a retune
      if (beatChanged) this.updateBeat(now);
      return;
    }
    this.retune(now, next);
  }

  /** Close both gates from where they are, at their rates; step everything at fAt; reopen from `at`. */
  private retune(now: number, v: Voice): void {
    const g = this.gateTB.valueAt(now), d = this.gateDrone.valueAt(now);
    const closeTB = now + g * GATE_OUT_S;
    const closeEnd = Math.max(closeTB, now + d * DRONE_OUT_S);
    const at = Math.max(closeEnd + RETUNE_GAP_S, now + RETUNE_MIN_LEAD_S);
    const fAt = (Math.max(closeEnd, now) + at) / 2;
    this.stepVoice(v, fAt);
    this.gateTB.path(now, [[closeTB, 0], [at, 0], [at + GATE_IN_S, 1]]);
    this.pending = { voice: v, fAt, at };
    this.deriveDrone(now);
  }

  /** Every retune param's value for voice v at the current beat target, as steps at fAt (§4.5); a param that
   *  already holds its value there gets no event. */
  private stepVoice(v: Voice, fAt: number): void {
    const p = v.plan, b = this.beat, on = b > 0;
    const off = v.render === 'off', pulse = v.render === 'pulse';
    const binBeat = v.render === 'binaural' && on;
    const step = (tr: ParamTrack, x: number): void => {
      if (tr.valueAt(fAt) !== x) tr.stepAt(x, fAt);
    };
    step(this.fTone, p.tone_hz);
    step(this.fCarrier, p.carrier_hz);
    step(this.fPartner, p.carrier_hz + (on ? b : PARKED_BEAT_HZ));
    step(this.fBeatLfo, on ? Math.min(b, PULSE_MAX_HZ) : PARKED_BEAT_HZ);
    if (v.drone) {
      step(this.fDrone, p.drone_hz);
      step(this.fDroneLfo, p.pulse_hz);
    }
    // Routing: binaural with a beat = carrier left, partner right; everything else = the carrier in both ears (the
    // partner never sounds at beat 0, in pulse or off: one pitch); off = no beat layer at all.
    step(this.cL, off ? 0 : 1);
    step(this.cR, off || binBeat ? 0 : 1);
    step(this.pL, 0);
    step(this.pR, binBeat ? 1 : 0);
    step(this.amBase, pulse && on ? PULSE_AM_BASE : 1);
    step(this.amDepth, pulse && on ? PULSE_AM_SWING : 0);
    // The beat level comes from the render, never from plan.level_beat / plan.beat_mode.
    step(this.beatPlan, off ? 0 : pulse ? PULSE_PEAK : LEVEL_BEAT);
    step(this.tonePlan, p.level_tone);
    // A moved-up speaker or phone drone is never played (decision 7).
    step(this.dronePlan, v.drone ? p.level_drone : 0);
  }

  /** Drop a pending retune's steps: a cancel just before fAt removes them and leaves a started beat glide running
   *  (an anchor there would freeze it: review AC-03). Those params only ever hold constants and glides. */
  private dropPending(now: number): void {
    const pend = this.pending;
    if (!pend || now >= pend.fAt) return; // past fAt they have happened
    const t = Math.max(now, pend.fAt - 1 / this.sampleRate);
    for (const tr of this.retuneTracks) tr.dropFrom(t);
  }

  private reopen(now: number): void {
    const g = this.gateTB.valueAt(now);
    this.gateTB.path(now, [[now + (1 - g) * GATE_IN_S, 1]]);
    this.deriveDrone(now);
  }

  private closeGates(now: number): void {
    const g = this.gateTB.valueAt(now);
    this.gateTB.path(now, [[now + g * GATE_OUT_S, 0]]);
    this.deriveDrone(now); // nothing requested: the drone closes at its rate
  }

  /** The drone gate from now: a retune's silence, then the duty's rests and reopenings to the horizon (§4.10). */
  private deriveDrone(now: number): void {
    const pend = this.pending, req = this.requested;
    const voice = pend ? pend.voice : req;
    const pts = droneGatePoints({
      now, v0: this.gateDrone.valueAt(now), closedUntil: pend ? pend.at : null,
      voiceHasDrone: voice !== null && voice.drone, playing: req !== null,
      duty: this.duty, intent: this.intent(), horizon: now + DUTY_HORIZON_S,
    });
    this.gateDrone.path(now, pts);
    this.droneHorizon = now + DUTY_HORIZON_S;
  }

  /** The drone counts as intended while a voice with a drone is requested and its user gain is above 0. */
  private intent(): boolean {
    const r = this.requested;
    return r !== null && r.drone && this.gains.drone > 0;
  }

  /** A beat-target change within a voice (§4.7): set at now while the beat layer is silent, else a τ 3 s glide; a
   *  pending retune's fAt steps are rewritten to the new target. */
  private updateBeat(now: number): void {
    const b = this.beat, on = b > 0;
    const lfo = on ? Math.min(b, PULSE_MAX_HZ) : PARKED_BEAT_HZ;
    const offset = on ? b : PARKED_BEAT_HZ;
    const pend = this.pending && now < this.pending.fAt ? this.pending : null;
    if (pend) {
      const t = Math.max(now, pend.fAt - 1 / this.sampleRate);
      this.fPartner.dropFrom(t);
      this.fBeatLfo.dropFrom(t);
    }
    const s = this.sounding;
    if (s) {
      const partner = s.plan.carrier_hz + offset;
      if (this.gateTB.valueAt(now) === 0) {
        this.stepNow(this.fPartner, partner, now);
        this.stepNow(this.fBeatLfo, lfo, now);
      } else {
        this.fPartner.glide(now, partner, BEAT_TAU_S);
        this.fBeatLfo.glide(now, lfo, BEAT_TAU_S);
      }
    }
    if (pend) {
      this.fPartner.stepAt(pend.voice.plan.carrier_hz + offset, pend.fAt);
      this.fBeatLfo.stepAt(lfo, pend.fAt);
    }
  }

  /** A step at now (the param's layer is silent): anchor, then the value. */
  private stepNow(tr: ParamTrack, v: number, now: number): void {
    tr.anchor(now);
    const t = this.afterKept(tr, now);
    if (tr.valueAt(t) !== v) tr.stepAt(v, t);
  }

  /** Where a silent step after an anchor at t goes: t, or the last event the anchor kept. Its cancel spares the next
   *  1.5 frames, where a ramp's end computed as now0 + 0.8 can land a hair after a later now, and stepAt refuses a step
   *  before an event while the player would record it as done (review stepnow-refused-step). The layer is silent, so
   *  31 µs later is just as silent. */
  private afterKept(tr: ParamTrack, t: number): number {
    const ev = tr.events;
    return ev.length > 0 && ev[ev.length - 1].t > t ? ev[ev.length - 1].t : t;
  }

  // ---------------------------------------------------------- user gains --

  /** One layer's user gain toward v (§4.8): a step while its gate is 0; fades in and out at the gate's rates; other
   *  changes over 0.25 s, at most one anchor per 100 ms and only for 0.1 dB or more (`exact` flushes the rest). */
  private applyUser(now: number, k: LayerKey, v: number, exact: boolean): void {
    const u = this.users[k];
    if (v === u.target) return;
    const gate = k === 'drone' ? this.gateDrone : this.gateTB;
    if (gate.valueAt(now) === 0) {
      this.stepNow(u.track, v, now);
      u.end = now;
    } else if (v === 0) {
      u.end = now + (k === 'drone' ? DRONE_OUT_S : GATE_OUT_S);
      u.track.path(now, [[u.end, 0]]);
    } else if (u.target === 0) {
      u.end = now + (k === 'drone' ? DRONE_IN_S : GATE_IN_S);
      u.track.path(now, [[u.end, v]]);
    } else {
      if (!exact && dbApart(v, u.target) < THROTTLE_MIN_STEP_DB) return; // the tick or the next call flushes it
      if (now - u.lastAnchor < THROTTLE_MIN_INTERVAL_S) return; // likewise
      u.end = now + USER_GLIDE_S;
      u.track.path(now, [[u.end, v]]);
    }
    u.target = v;
    u.lastAnchor = now;
  }

  // ---------------------------------------------------------------- host --

  /** The host toward x (§4.9). */
  private applyHost(now: number, x: number, glideS: number | undefined, exact: boolean): void {
    const d = this.deferred;
    const heading = d ? d.x : this.hostTarget;
    const ends = d ? d.tStar + d.dur : this.hostEnd;
    if (exact ? x === heading : dbApart(x, heading) < THROTTLE_MIN_STEP_DB) {
      // Within 0.1 dB of where the host is going: no anchor, glideS or not (the App re-sends {glideS: 1.5} every
      // 250 ms after a seek: AC-11) — unless an explicit glide gets there sooner (a stop overtaking a slow fall to 0).
      if (glideS === undefined || now + glideS >= ends) return;
    }
    if (this.gateTB.valueAt(now) === 0 && this.gateDrone.valueAt(now) === 0) {
      this.hostStep(now, x); // silent, so instant (a pending retune's gap included)
      return;
    }
    if (x > this.host.valueAt(now)) {
      const tStar = this.riseAt(now, x, glideS);
      if (tStar > now) {
        // A rise still in flight stops here too, or it would run on through the falls (A8): a flushed remainder lands
        // here before reevaluateHost, from the very call that made the falls (review A8-flush-rise). The rest then
        // takes the stopped ramp's glideS, as in reevaluateHost, so a pending remainder changes nothing audible.
        const rising = this.hostEnd > now && this.hostTarget > this.host.valueAt(now);
        const g = glideS === undefined && rising ? this.hostGlideS : glideS;
        if (rising) this.holdHost(now);
        this.deferHost(now, x, g, tStar, d !== null || rising);
        return;
      }
    }
    // Falls (and rises with nothing falling) apply at once, throttled unless the duration was asked for; a deferred
    // change is replaced at once (a throttled fall must not leave an older rise scheduled).
    if (glideS === undefined && !exact && d === null && now - this.hostLastAnchor < THROTTLE_MIN_INTERVAL_S) return;
    this.hostRamp(now, x, glideS);
  }

  /** The host ramp in flight stops where it is now; the rest of a rise waits for its deferral (A8). */
  private holdHost(now: number): void {
    this.hostTarget = this.host.valueAt(now);
    this.hostEnd = now;
    this.hostGlideS = undefined;
  }

  private hostStep(now: number, x: number): void {
    this.stepNow(this.host, x, now);
    this.hostTarget = x;
    this.hostEnd = now;
    this.hostGlideS = undefined;
    this.jumpEnd = -Infinity;
    this.deferred = null;
    this.hostLastAnchor = now;
  }

  /** A linear host ramp from now: ≥ 6 dB from the jump in flight (else from the mirror) takes 1.5 s, smaller changes
   *  0.25 s but never end before a jump in flight does (review m2); glideS sets the duration and counts as a jump. */
  private hostRamp(now: number, x: number, glideS: number | undefined): void {
    const inJump = now < this.jumpEnd;
    let dur: number, jump: boolean;
    if (glideS !== undefined) {
      dur = glideS;
      jump = true;
    } else if (dbApart(x, inJump ? this.jumpTarget : this.host.valueAt(now)) >= HOST_JUMP_DB) {
      dur = HOST_JUMP_S;
      jump = true;
    } else {
      dur = inJump ? Math.max(HOST_GLIDE_S, this.jumpEnd - now) : HOST_GLIDE_S;
      jump = false;
    }
    this.host.path(now, [[now + dur, x]]);
    this.hostTarget = x;
    this.hostEnd = now + dur;
    this.hostGlideS = glideS;
    if (jump) this.jumpEnd = now + dur;
    if (jump || inJump) this.jumpTarget = x; // a small update during a jump is the jump, heading for x
    this.deferred = null;
    this.hostLastAnchor = now;
  }

  /** When a rise to x may land (A8): after every fall toward 0 that is under way at now or starts before the rise
   *  would end — the gates (a duty-rest close included, review AC-09) and the user gains — and not before a pending
   *  retune's fAt. now = no wait. */
  private riseAt(now: number, x: number, glideS: number | undefined): number {
    const ref = now < this.jumpEnd ? this.jumpTarget : this.host.valueAt(now);
    const dur = glideS ?? (dbApart(x, ref) >= HOST_JUMP_DB ? HOST_JUMP_S : HOST_GLIDE_S);
    let t = now;
    for (let pass = 0; pass < 8; pass++) {
      let next = t;
      for (const tr of this.fallTracks) {
        const e = fallEnd(tr, t, t + dur);
        if (e !== null && e > next) next = e;
      }
      if (next === t) break;
      t = next;
    }
    const pend = this.pending;
    if (t > now && pend && now < pend.at) t = Math.max(t, pend.fAt);
    return t;
  }

  /**
   * Defer a rise to T*: player state, and pre-scheduled on the param (a future anchor at T*) so nothing audible
   * depends on the tick. At T* the host steps to x if both gates are 0 there, else it ramps by hostRamp's rules from
   * its value there. `rebuild` re-anchors at now first, replaying the host's own ramp in flight up to T*: it removes
   * an earlier deferral, or the rest of a rise that a fall has just overtaken.
   */
  private deferHost(now: number, x: number, glideS: number | undefined, tStar: number, rebuild: boolean): void {
    const step = this.gateTB.valueAt(tStar) === 0 && this.gateDrone.valueAt(tStar) === 0;
    const v0 = this.host.valueAt(now);
    let vStar = v0;
    const pts: Array<[number, number]> = [];
    if (this.hostEnd > now) {
      if (this.hostEnd <= tStar) {
        pts.push([this.hostEnd, this.hostTarget]);
        vStar = this.hostTarget;
      } else {
        vStar = v0 + (this.hostTarget - v0) * ((tStar - now) / (this.hostEnd - now));
      }
    }
    const inJump = tStar < this.jumpEnd;
    let dur = 0, jump = false;
    if (!step) {
      if (glideS !== undefined) {
        dur = glideS;
        jump = true;
      } else if (dbApart(x, inJump ? this.jumpTarget : vStar) >= HOST_JUMP_DB) {
        dur = HOST_JUMP_S;
        jump = true;
      } else {
        dur = inJump ? Math.max(HOST_GLIDE_S, this.jumpEnd - tStar) : HOST_GLIDE_S;
      }
    }
    if (rebuild) {
      pts.push([tStar, vStar]);
      if (!step) pts.push([tStar + dur, x]);
      this.host.path(now, pts);
    } else if (step) {
      this.host.anchor(tStar);
    } else {
      this.host.path(tStar, [[tStar + dur, x]]);
    }
    if (step) this.host.stepAt(x, this.afterKept(this.host, tStar));
    this.deferred = { x, tStar, glideS, step, dur, jump: jump || (!step && inJump) };
    this.hostLastAnchor = now;
  }

  /** The end of every call: a deferred rise may now land at once, wait longer, or wait less; a rise still in flight
   *  that a fall has just overtaken (App sends the host before play()) stops here and waits too. */
  private reevaluateHost(now: number): void {
    const d = this.deferred;
    let x: number, glideS: number | undefined;
    if (d) {
      x = d.x;
      glideS = d.glideS;
    } else if (this.hostEnd > now && this.hostTarget > this.host.valueAt(now)) {
      x = this.hostTarget;
      glideS = this.hostGlideS;
    } else {
      return;
    }
    const tStar = this.riseAt(now, x, glideS);
    if (tStar <= now) {
      if (!d) return; // a rise in flight with nothing falling: carry on
      this.deferred = null;
      if (this.gateTB.valueAt(now) === 0 && this.gateDrone.valueAt(now) === 0) this.hostStep(now, x);
      else this.hostRamp(now, x, glideS); // its anchor at now deletes the pre-scheduled change (S24)
      return;
    }
    if (d) {
      const step = this.gateTB.valueAt(tStar) === 0 && this.gateDrone.valueAt(tStar) === 0;
      if (Math.abs(tStar - d.tStar) <= 1e-9 && step === d.step) return;
    } else {
      this.holdHost(now); // hold here; the rest of the rise waits
    }
    this.deferHost(now, x, glideS, tStar, true);
  }

  // ------------------------------------------------------------ time, tick --

  /** The start of every call and tick: a monotonic now; promote the retune; run the duty up to now; land a deferral
   *  whose time has come. */
  private advance(): number {
    const c = this.clock();
    const now = Number.isFinite(c) && c > this.nowT ? c : this.nowT;
    this.nowT = now;
    const pend = this.pending;
    if (pend) {
      if (now >= pend.fAt) this.sounding = pend.voice;
      if (now >= pend.at) this.pending = null;
    }
    if (now > this.dutyT) {
      this.duty = advanceDuty(this.duty, this.dutyT, now, this.intentNow).duty;
      this.dutyT = now;
    }
    const d = this.deferred;
    if (d && now >= d.tStar) {
      this.deferred = null;
      this.hostTarget = d.x;
      this.hostEnd = d.tStar + d.dur;
      this.hostGlideS = d.glideS;
      if (d.jump) {
        this.jumpTarget = d.x;
        this.jumpEnd = d.tStar + d.dur;
      } else if (d.step) {
        this.jumpEnd = -Infinity;
      }
    }
    return now;
  }

  /** The end of every public call: flush what earlier calls left throttled (exactly; not the values this call set
   *  itself), re-evaluate the host's rise, note the duty intent, report a transition, re-arm the tick. */
  private finish(now: number, own: Own): void {
    this.flush(now, own);
    this.reevaluateHost(now);
    this.intentNow = this.intent();
    this.notify(now);
    this.arm();
  }

  private flush(now: number, own: Own): void {
    if (!own.host && this.hostWant !== (this.deferred ? this.deferred.x : this.hostTarget)
      && now - this.hostLastAnchor >= THROTTLE_MIN_INTERVAL_S) {
      this.applyHost(now, this.hostWant, undefined, true);
    }
    for (const k of LAYER_KEYS) {
      const u = this.users[k];
      if (!own[k] && this.gains[k] !== u.target && now - u.lastAnchor >= THROTTLE_MIN_INTERVAL_S) this.applyUser(now, k, this.gains[k], true);
    }
  }

  private remainder(): boolean {
    if (this.hostWant !== (this.deferred ? this.deferred.x : this.hostTarget)) return true;
    return LAYER_KEYS.some((k) => this.gains[k] !== this.users[k].target);
  }

  private tick(): void {
    if (this.isDisposed) {
      this.stopTimer();
      return;
    }
    try {
      const now = this.advance();
      this.flush(now, OWN_NONE);
      const pend = this.pending, req = this.requested;
      const voice = pend ? pend.voice : req;
      if (req !== null && voice !== null && voice.drone && this.droneHorizon - now < DUTY_EXTEND_BELOW_S) this.deriveDrone(now);
      this.intentNow = this.intent();
      this.notify(now);
      for (const tr of this.tracks) tr.prune(now - 1);
      // Idle stop (a v2 pause): nothing can change until a call, which re-arms it; the duty is continuous-time.
      if (req === null && this.deferred === null && !this.remainder() && this.phaseAt(now) === 'silent') this.stopTimer();
    } catch (err) {
      this.report(err, 'tick');
    }
  }

  private arm(): void {
    if (this.armed || this.timer === null || this.isDisposed) return;
    this.timerId = this.timer.set(() => this.tick(), this.tickMs);
    this.armed = true;
  }

  private stopTimer(): void {
    if (!this.armed || this.timer === null) return;
    this.armed = false;
    try {
      this.timer.clear(this.timerId);
    } catch {
      /* nothing to clear */
    }
    this.timerId = null;
  }

  // -------------------------------------------------------------- state --

  private phaseAt(now: number): LayerPhase {
    if (this.isDisposed) return 'disposed';
    const pend = this.pending;
    if (pend && now < pend.at) return 'retuning';
    if (this.requested === null) return this.gateTB.valueAt(now) > 0 || this.gateDrone.valueAt(now) > 0 ? 'closing' : 'silent';
    return this.gateTB.valueAt(now) < 1 ? 'opening' : 'open';
  }

  private notify(now: number): void {
    const phase = this.phaseAt(now);
    const resting = this.duty.restUntil !== null;
    if (phase === this.lastPhase && resting === this.lastResting) return;
    this.lastPhase = phase;
    this.lastResting = resting;
    if (!this.onState) return;
    try {
      this.onState(this.snapshot(now));
    } catch (err) {
      this.report(err, 'onState'); // the call's own work is done; a broken callback must not stop the tick re-arming
    }
  }

  private snapshot(now: number): LayerPlayerState {
    const p = this.pending;
    const sounding = p && now >= p.fAt ? p.voice : this.sounding;
    const duty = now > this.dutyT ? advanceDuty(this.duty, this.dutyT, now, this.intentNow).duty : this.duty;
    const resting = duty.restUntil !== null;
    const intent = this.intentNow && !this.isDisposed;
    const req = this.requested;
    return {
      sound_version: VERSION,
      player_version: PLAYER_VERSION,
      t: now,
      phase: this.phaseAt(now),
      sounding: sounding ? this.voiceSnap(sounding, now, true) : null,
      requested: req ? this.voiceSnap(req, now, sounding !== null && req.key === sounding.key) : null,
      retune_at: p && now < p.at ? p.at : null,
      gates: { tone_beat: this.gateTB.valueAt(now), drone: this.gateDrone.valueAt(now) },
      host_level: this.host.valueAt(now),
      gains: { tone: this.gains.tone, beat: this.gains.beat, drone: this.gains.drone },
      mono_output: this.mono,
      drone: {
        resting, on_s: duty.onS, quiet_s: duty.quietS, rest_ends_at: duty.restUntil,
        next_rest_at: !intent ? null : resting ? (duty.restUntil as number) + DRONE_ON_S : now + Math.max(0, DRONE_ON_S - duty.onS),
      },
    };
  }

  /** `liveVoice`: the voice the oscillators hold, so the partner reads the mirror (gliding); else its designed value. */
  private voiceSnap(v: Voice, now: number, liveVoice: boolean): VoiceSnapshot {
    const p = v.plan, b = this.beat;
    const binBeat = v.render === 'binaural' && v.beatOn;
    return {
      key: v.key, canonical_hz: p.canonical_hz, sounding_hz: p.sounding_hz, sham_cents: p.sham_cents, arm: p.arm,
      output: p.output, render: v.render, tone_hz: p.tone_hz, carrier_hz: p.carrier_hz,
      partner_hz: binBeat ? (liveVoice ? this.fPartner.valueAt(now) : p.carrier_hz + b) : 0,
      beat_hz: v.render === 'off' || !v.beatOn ? 0 : b,
      pulse_rate_hz: v.render === 'pulse' && v.beatOn ? Math.min(b, PULSE_MAX_HZ) : 0,
      drone_hz: v.drone ? p.drone_hz : 0,
      pulse_hz: v.drone ? p.pulse_hz : 0,
    };
  }

  // ------------------------------------------------------------- safety --

  /** True (after one warning per method) once disposed: nothing is scheduled. */
  private gone(method: string): boolean {
    if (!this.isDisposed) return false;
    this.warnOnce(`disposed:${method}`, `LayerPlayer.${method}: the player is disposed; nothing scheduled`);
    return true;
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnFn(msg);
  }

  private report(err: unknown, where: string): void {
    try {
      this.warnFn(`LayerPlayer.${where} failed: ${err instanceof Error ? err.message : String(err)}`);
    } catch {
      /* a broken warn must not hide the error */
    }
    try {
      this.onError?.(err, where);
    } catch {
      /* never throw into React */
    }
  }
}
