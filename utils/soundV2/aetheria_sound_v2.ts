/**
 * Aetheria Sound v2: the portable reference for the web apps.
 *
 * The spec is AETHERIA_SOUND_V2.md beside this file. The pure functions below are the same as
 * sandbox/audio/tone_layers.gd (the game, and the city stage) and make_test_vectors.py, and all
 * three are checked against test_vectors.json (`node check_vectors.ts`, Node 22.18+ runs
 * TypeScript directly). The last part is a minimal Web Audio graph that plays a plan.
 *
 * Dependency-free. Only erasable TypeScript (no enums, namespaces or parameter properties), so
 * Node's type stripping, esbuild and tsc all take it as it is.
 */

export const VERSION = 2;

// ------------------------------------------------------------------ the canon --
export const SOLFEGGIO = [174, 285, 396, 417, 528, 639, 741, 852, 963];
export const PERFECT_GUT = [75, 186, 297, 408, 519, 630, 741, 852, 963];
export const HEART = [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150];
export const HEAD = [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
/** Every canonical frequency on both GUT scales: 33 distinct. */
export const CANONICAL_HZ: number[] = [...new Set([...SOLFEGGIO, ...PERFECT_GUT, ...HEART, ...HEAD])].sort((a, b) => a - b);

/** The canonical frequency of crystal c01 .. c27 on a GUT scale (0 for anything else). */
export function frequencyOf(id: string, gutScale: GutScale = "solfeggio"): number {
  const m = /^c(\d\d)$/.exec(id);
  const k = m ? parseInt(m[1], 10) : 0;
  if (k < 1 || k > 27) return 0;
  const n = (k - 1) % 9;
  if (k <= 9) return gutScale === "perfect" ? PERFECT_GUT[n] : SOLFEGGIO[n];
  return k <= 18 ? HEART[n] : HEAD[n];
}

// -------------------------------------------------------------- the constants --
export type GutScale = "solfeggio" | "perfect";
export type Output = "headphones" | "speakers" | "phone";
export type BeatMode = "binaural" | "monaural";
export type Arm = "on" | "off" | "sham";
export type Band = "delta" | "theta" | "alpha" | "beta" | "gamma";

/** The beat for each band, Hz (the Aetheria app's). Binaural beats are Tier 2 in the book (ch. 20). */
export const BANDS: Record<Band, number> = { delta: 2, theta: 6, alpha: 10, beta: 20, gamma: 40 };
export const BAND_ORDER: Band[] = ["delta", "theta", "alpha", "beta", "gamma"];
export const OUTPUTS: Output[] = ["headphones", "speakers", "phone"];
export const BEAT_MODES: BeatMode[] = ["binaural", "monaural"];
export const ARMS: Arm[] = ["on", "off", "sham"];
/** The lowest frequency each output plays cleanly (a design assumption). */
export const FLOORS: Record<Output, number> = { headphones: 20, speakers: 100, phone: 200 };
export const TONE_LO = 150;
export const TONE_HI = 1000;
export const CARRIER_LO = 200;
export const CARRIER_PER_BEAT = 10;
export const DRONE_LO = 25;
export const PULSE_LO = 5;
export const TORSO_LO = 50;
export const TORSO_HI = 100;
export const AUDIBLE_DRONE_LO = 100;
export const AUDIBLE_DRONE_HI = 800;
/** Peak amplitudes against the music's full scale. */
export const LEVEL_TONE = 0.0501; // -26 dB
export const LEVEL_BEAT = 0.0708; // -23 dB a tone, binaural; monaural each x 1/sqrt(2)
export const LEVEL_DRONE_SUB = 0.0631; // -24 dB
export const LEVEL_DRONE_AUDIBLE = 0.0251; // -32 dB
export const MOD_DEPTH = 0.3;
export const DUCK_DB = 6;
export const DUCK_REL_LO = 0.35;
export const DUCK_REL_HI = 0.75;
export const CLARITY_LO = 0.45;
export const CLARITY_HI = 0.75;
export const SHAM_START_CENTS = 100;
export const SHAM_MIN_CENTS = 20;
export const DRONE_ON_S = 1200;
export const DRONE_REST_S = 600;
export const GATE_OUT_S = 0.8;
export const GATE_IN_S = 2.5;
export const DRONE_OUT_S = 3;
export const DRONE_IN_S = 8;
export const PHI = 1.6180339887;
export const INV_PHI = 0.6180339887;
export const INV_PHI2 = 0.3819660113;
export const HEADPHONE_WORDS = ["headphone", "headset", "earphone", "earbud", "airpods", "buds", "hands-free", "handsfree"];

const LN2 = Math.log(2);

// ------------------------------------------------------------------ mapping --

/** x times the power of two that puts it in [lo, 2 lo): exactly an octave of x. 0 if it can't fold. */
export function fold(x: number, lo: number): number {
  if (!Number.isFinite(x) || x <= 0 || !Number.isFinite(lo) || lo <= 0) return 0;
  while (x >= 2 * lo) x *= 0.5;
  while (x < lo) x *= 2;
  return x;
}

export function floorOf(output: string): number {
  return (FLOORS as Record<string, number>)[output] ?? FLOORS.speakers;
}

/** f itself in 150-1000 Hz, else halved (or doubled) into it; then raised to the output's floor. */
export function toneOf(f: number, output: string = "headphones"): number {
  if (!Number.isFinite(f) || f <= 0) return 0;
  let x = f;
  while (x > TONE_HI) x *= 0.5;
  while (x < TONE_LO) x *= 2;
  const lo = floorOf(output);
  while (x < lo) x *= 2;
  return x;
}

export function sameHz(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
}

/** f's octave in [L, 2L), L = max(200, 10 x beat); the octave above (or below past 1000 Hz) if that is the tone. */
export function carrierOf(f: number, output: string = "headphones", beatHz: number = 10): number {
  const t = toneOf(f, output);
  let c = fold(f, Math.max(CARRIER_LO, CARRIER_PER_BEAT * Math.max(beatHz, 0)));
  if (c > 0 && sameHz(c, t)) c = c * 2 < TONE_HI ? c * 2 : c * 0.5;
  return c;
}

/** Headphones: f's octave in 25-50 Hz. Elsewhere the lowest free octave from max(floor, 100) Hz, under 800 Hz, else 0. */
export function droneOf(f: number, output: string = "headphones", beatHz: number = 10): number {
  if (output === "headphones") return fold(f, DRONE_LO);
  const t = toneOf(f, output);
  const c = carrierOf(f, output, beatHz);
  let d = fold(f, Math.max(floorOf(output), AUDIBLE_DRONE_LO));
  while (d > 0 && (sameHz(d, t) || sameHz(d, c))) d *= 2;
  return d > 0 && d < AUDIBLE_DRONE_HI ? d : 0;
}

/** The drone's pulse: f's octave in 5-10 Hz. */
export function pulseOf(f: number): number {
  return fold(f, PULSE_LO);
}

export function centsOf(x: number): number {
  return (1200 * Math.log(x)) / LN2;
}

function posmod(a: number, m: number): number {
  const r = a % m;
  return r < 0 ? r + m : r;
}

/** How far x sits from the nearest octave of any canonical frequency, in cents (0 .. 600). */
export function canonicalDistanceCents(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  const cx = posmod(centsOf(x), 1200);
  let best = 1200;
  for (const g of CANONICAL_HZ) {
    const d = Math.abs(cx - posmod(centsOf(g), 1200));
    best = Math.min(best, d, 1200 - d);
  }
  return best;
}

/** The sham's detune: the smallest whole number of cents from 100 that leaves f 20 cents from every canonical octave. */
export function shamCents(f: number): number {
  if (!Number.isFinite(f) || f <= 0) return 0;
  for (let c = SHAM_START_CENTS; c < SHAM_START_CENTS + 1200; c++) {
    if (canonicalDistanceCents(f * Math.pow(2, c / 1200)) >= SHAM_MIN_CENTS) return c;
  }
  return SHAM_START_CENTS;
}

export interface Plan {
  canonical_hz: number;
  sounding_hz: number;
  sham_cents: number;
  tone_hz: number;
  carrier_hz: number;
  partner_hz: number;
  beat_hz: number;
  drone_hz: number;
  pulse_hz: number;
  drone_k: number;
  drone_sub: boolean;
  output: Output;
  beat_mode: BeatMode;
  arm: Arm;
  level_tone: number;
  level_beat: number;
  level_drone: number;
}

/**
 * What sounds for frequency f, or null when nothing does (arm "off", no frequency). The sham keeps
 * the canonical plan's octaves and multiplies every frequency by 2^(cents/1200), except that a
 * sub-bass drone the detune would lift past 50 Hz drops an octave.
 */
export function plan(f: number, output: string, beatMode: string, beatHz: number, arm: string = "on"): Plan | null {
  if (!Number.isFinite(f) || f <= 0 || arm === "off" || !(ARMS as string[]).includes(arm)) return null;
  const out: Output = (OUTPUTS as string[]).includes(output) ? (output as Output) : "speakers";
  const mode: BeatMode = beatMode === "binaural" ? "binaural" : "monaural";
  const beat = Number.isFinite(beatHz) ? Math.min(Math.max(beatHz, 0), 100) : 10;
  let tone = toneOf(f, out);
  let carrier = carrierOf(f, out, beat);
  let drone = droneOf(f, out, beat);
  let pulse = pulseOf(f);
  const sub = out === "headphones";
  let cents = 0;
  if (arm === "sham") {
    cents = shamCents(f);
    const r = Math.pow(2, cents / 1200);
    tone *= r;
    carrier *= r;
    pulse *= r;
    if (drone > 0) {
      drone *= r;
      if (sub && drone >= TORSO_LO) drone *= 0.5;
    }
  }
  const k = drone > 0 && pulse > 0 ? Math.round(drone / pulse) : 0;
  return {
    canonical_hz: f, sounding_hz: f * Math.pow(2, cents / 1200), sham_cents: cents,
    tone_hz: tone, carrier_hz: carrier, partner_hz: carrier + beat, beat_hz: beat,
    drone_hz: drone, pulse_hz: pulse, drone_k: k, drone_sub: sub && drone > 0,
    output: out, beat_mode: mode, arm: arm as Arm, level_tone: LEVEL_TONE,
    level_beat: mode === "binaural" ? LEVEL_BEAT : LEVEL_BEAT * Math.sqrt(0.5),
    level_drone: drone <= 0 ? 0 : sub ? LEVEL_DRONE_SUB : LEVEL_DRONE_AUDIBLE,
  };
}

/** Sensory roughness of two pure tones (Plomp & Levelt 1965, Sethares' 1993 fit). */
export function roughness(f1: number, f2: number): number {
  const s = 0.24 / (0.021 * Math.min(f1, f2) + 19);
  const x = Math.abs(f2 - f1);
  return Math.exp(-3.5 * s * x) - Math.exp(-5.75 * s * x);
}

/** The tone's roughness against a chroma (12 weights, C .. B, summing to 1) on the grid A4 = a4. */
export function dissonance(toneHz: number, chroma: number[], a4: number): number {
  let total = 0;
  for (let k = 0; k < 12; k++) {
    const w = chroma[k];
    if (w <= 0) continue;
    let fk = a4 * Math.pow(2, (k - 9) / 12);
    while (fk > toneHz) fk *= 0.5;
    while (fk * 2 <= toneHz) fk *= 2;
    total += w * (roughness(toneHz, fk) + roughness(toneHz, fk * 2));
  }
  return total;
}

/** GDScript's and GLSL's smoothstep. */
export function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface Fit { rel: number; strength: number; duck_db: number }

/** How the tone sits under a track: rel 0 (smoothest pitch in its octave) .. 1 (roughest); duck 0 .. -6 dB. */
export function musicFit(toneHz: number, chroma: unknown, a4: number, keyConfidence: number = -1): Fit {
  const none: Fit = { rel: 0, strength: 0, duck_db: 0 };
  if (!Array.isArray(chroma) || chroma.length !== 12 || !Number.isFinite(toneHz) || toneHz <= 0 || !Number.isFinite(a4) || a4 <= 0) return none;
  const w = chroma.map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 1e-9) return none;
  for (let i = 0; i < 12; i++) w[i] /= sum;
  const d = dissonance(toneHz, w, a4);
  let lo = Infinity;
  let hi = -Infinity;
  for (let c = -600; c < 600; c += 10) {
    const v = dissonance(toneHz * Math.pow(2, c / 1200), w, a4);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const rel = hi > lo + 1e-12 ? Math.min(1, Math.max(0, (d - lo) / (hi - lo))) : 0;
  const strength = keyConfidence < 0 || !Number.isFinite(keyConfidence) ? 1 : smoothstep(CLARITY_LO, CLARITY_HI, keyConfidence);
  return { rel, strength, duck_db: -DUCK_DB * smoothstep(DUCK_REL_LO, DUCK_REL_HI, rel) * strength };
}

/** The band the track's intensity asks for (the Aetheria app's thresholds: a design choice). */
export function bandForIntensity(i: number): Band {
  if (i >= 0.75) return "gamma";
  if (i >= 0.55) return "beta";
  if (i >= 0.35) return "alpha";
  if (i >= 0.15) return "theta";
  return "delta";
}

/** The band a heart asks for (a design choice): theta racing, alpha coherent, theta settled; "" with no strap. */
export function bandForHeart(live: boolean, adrenaline: number, resonance: number): Band | "" {
  if (!live) return "";
  if (adrenaline > 0.5) return "theta";
  if (resonance > 0.45) return "alpha";
  if (adrenaline < 0.2) return "theta";
  return "alpha";
}

/** The phi envelope over a track (a shape, not a claim): 0 -> 0.8 at 0.382 -> 1 at 0.618 -> 0.80 at the end. */
export function phiEnvelope(position: number, duration: number): number {
  if (duration <= 0) return 1;
  const p = Math.min(1, Math.max(0, position / duration));
  if (p < INV_PHI2) return 0.8 * Math.pow(p / INV_PHI2, PHI);
  if (p < INV_PHI) return 0.8 + (0.2 * (p - INV_PHI2)) / (INV_PHI - INV_PHI2);
  return Math.pow(1 - (0.3 * (p - INV_PHI)) / INV_PHI2, INV_PHI);
}

export function isHeadphoneName(name: string): boolean {
  const n = name.toLowerCase();
  return HEADPHONE_WORDS.some((w) => n.includes(w));
}

/** Headphones when the device's name says so (or every listed device does), else speakers (a phone on mobile). */
export function guessOutput(device: string, devices: string[], mobile: boolean): Output {
  const fallback: Output = mobile ? "phone" : "speakers";
  if (device !== "" && device !== "Default") return isHeadphoneName(device) ? "headphones" : fallback;
  const real = devices.filter((d) => d !== "" && d !== "Default");
  return real.length > 0 && real.every(isHeadphoneName) ? "headphones" : fallback;
}

/** The beat mode "auto" resolves to: binaural on headphones only. */
export function resolveBeatMode(setting: string, output: Output): BeatMode {
  if (setting === "binaural" || setting === "monaural") return setting;
  return output === "headphones" ? "binaural" : "monaural";
}

/**
 * The drone's duty cycle: at most DRONE_ON_S at a stretch, then DRONE_REST_S of rest; a quiet
 * spell as long as the rest starts the stretch again. tick() every frame with whether it sounds.
 */
export class DroneDuty {
  resting = false;
  onS = 0;
  quietS = 0;
  restS = 0;

  tick(dt: number, sounding: boolean): boolean {
    if (this.resting) {
      this.restS -= dt;
      if (this.restS <= 0) {
        this.resting = false;
        this.onS = 0;
      }
      return this.resting;
    }
    if (sounding) {
      this.onS += dt;
      this.quietS = 0;
      if (this.onS >= DRONE_ON_S) {
        this.resting = true;
        this.restS = DRONE_REST_S;
      }
    } else {
      this.quietS += dt;
      if (this.quietS >= DRONE_REST_S) this.onS = 0;
    }
    return this.resting;
  }
}

// --------------------------------------------------------------- Web Audio --

/** A plan's identity: a change of any of these goes through silence. */
export function signature(p: Plan | null): string {
  return p ? [p.tone_hz.toFixed(6), p.carrier_hz.toFixed(6), p.drone_hz.toFixed(6), p.drone_k, p.beat_mode].join("|") : "";
}

/**
 * A minimal Web Audio graph for the layers: oscillators, not samples (the browser mixes them
 * natively). Two kinds of gain, so a host updating its level every frame never cuts a long fade:
 *
 *   level   setLevel(): the host's level (tones gain x phi envelope x the music's presence x the
 *           track's gain x the fit's duck, linear) times each layer's plan level, followed in 0.1 s
 *   gate    play() and setDroneResting(): a new plan closes the gates (tone and beat 0.8 s, drone
 *           3 s), retunes in the silence and opens them again (2.5 s; the drone 8 s), so two
 *           different frequencies never sound together; the drone's rest closes its gate alone
 *
 * Call play(plan) whenever the plan may have changed (an unchanged plan costs nothing),
 * setBeat() as the band's beat glides, and stop() to end.
 */
export class LayerGraph {
  readonly ctx: BaseAudioContext;
  readonly out: GainNode;
  private plan: Plan | null = null;
  private tone: OscillatorNode;
  private toneLevel: GainNode;
  private a: OscillatorNode;
  private b: OscillatorNode;
  private merger: ChannelMergerNode;
  private aGains: GainNode[];
  private bGains: GainNode[];
  private beatLevel: GainNode;
  private gate: GainNode;
  private drone: OscillatorNode;
  private droneAm: GainNode;
  private lfo: OscillatorNode;
  private lfoDepth: GainNode;
  private droneLevel: GainNode;
  private droneGate: GainNode;
  private level = 0;
  private beatHz = 10;
  private droneResting = false;
  private openAt = 0;

  constructor(ctx: BaseAudioContext, destination: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(destination);
    this.gate = this.gain(0);
    this.gate.connect(this.out);
    this.tone = this.osc(TONE_LO * 2);
    this.toneLevel = this.gain(0);
    this.tone.connect(this.toneLevel).connect(this.gate);
    // The beat: each tone reaches the merger's left and right inputs through its own gain, so
    // binaural (a left, b right) and monaural (both, both) are only gain settings.
    this.merger = ctx.createChannelMerger(2);
    this.beatLevel = this.gain(0);
    this.merger.connect(this.beatLevel).connect(this.gate);
    this.a = this.osc(CARRIER_LO);
    this.b = this.osc(CARRIER_LO + 10);
    this.aGains = [this.gain(1), this.gain(0)];
    this.bGains = [this.gain(0), this.gain(1)];
    for (let ch = 0; ch < 2; ch++) {
      this.a.connect(this.aGains[ch]).connect(this.merger, 0, ch);
      this.b.connect(this.bGains[ch]).connect(this.merger, 0, ch);
    }
    // The drone: a sine whose gain swings 1 - depth/2 +- depth/2 at the pulse (never gating).
    this.drone = this.osc(DRONE_LO);
    this.droneAm = this.gain(1 - MOD_DEPTH / 2);
    this.lfo = this.osc(PULSE_LO);
    this.lfoDepth = this.gain(MOD_DEPTH / 2);
    this.lfo.connect(this.lfoDepth).connect(this.droneAm.gain);
    this.droneLevel = this.gain(0);
    this.droneGate = this.gain(0);
    this.drone.connect(this.droneAm).connect(this.droneLevel).connect(this.droneGate).connect(this.out);
    for (const o of [this.tone, this.a, this.b, this.drone, this.lfo]) o.start();
  }

  private osc(hz: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = hz;
    return o;
  }

  private gain(v: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  /** Hold a param where it is now, dropping anything scheduled after. */
  private hold(param: AudioParam, now: number): void {
    if (typeof param.cancelAndHoldAtTime === "function") {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
  }

  /** Sound this plan (null: close the gates). A changed plan goes through silence. */
  play(next: Plan | null): void {
    if (signature(next) === signature(this.plan)) return;
    const now = this.ctx.currentTime;
    const wasSilent = this.plan === null;
    this.plan = next;
    for (const g of [this.gate.gain, this.droneGate.gain]) this.hold(g, now);
    this.gate.gain.linearRampToValueAtTime(0, now + (wasSilent ? 0.01 : GATE_OUT_S));
    this.droneGate.gain.linearRampToValueAtTime(0, now + (wasSilent ? 0.01 : DRONE_OUT_S));
    this.setLevel(this.level);
    if (!next) return;
    const at = now + (wasSilent ? 0.02 : DRONE_OUT_S + 0.02);
    this.openAt = at;
    const bin = next.beat_mode === "binaural";
    const set: [AudioParam, number][] = [
      [this.tone.frequency, next.tone_hz], [this.a.frequency, next.carrier_hz],
      [this.b.frequency, next.carrier_hz + this.beatHz],
      [this.drone.frequency, next.drone_hz > 0 ? next.drone_hz : DRONE_LO], [this.lfo.frequency, next.pulse_hz],
      [this.aGains[0].gain, 1], [this.aGains[1].gain, bin ? 0 : 1], [this.bGains[0].gain, bin ? 0 : 1], [this.bGains[1].gain, 1],
    ];
    for (const [param, value] of set) {
      this.hold(param, now);
      param.setValueAtTime(value, at);
    }
    this.gate.gain.setValueAtTime(0, at);
    this.gate.gain.linearRampToValueAtTime(1, at + GATE_IN_S);
    this.droneGate.gain.setValueAtTime(0, at);
    this.droneGate.gain.linearRampToValueAtTime(next.drone_hz > 0 && !this.droneResting ? 1 : 0, at + DRONE_IN_S);
  }

  /** The host's level, linear (see the class comment). */
  setLevel(linear: number): void {
    this.level = Number.isFinite(linear) ? Math.max(0, linear) : 0;
    const p = this.plan;
    const now = this.ctx.currentTime;
    this.toneLevel.gain.setTargetAtTime(p ? p.level_tone * this.level : 0, now, 0.1);
    this.beatLevel.gain.setTargetAtTime(p ? p.level_beat * this.level : 0, now, 0.1);
    this.droneLevel.gain.setTargetAtTime(p ? p.level_drone * this.level : 0, now, 0.1);
  }

  /** The beat as it glides between bands (the partner follows; the carrier stays). */
  setBeat(hz: number): void {
    if (!Number.isFinite(hz) || hz === this.beatHz) return;
    this.beatHz = hz;
    if (this.plan) this.b.frequency.setTargetAtTime(this.plan.carrier_hz + hz, Math.max(this.ctx.currentTime, this.openAt), 1);
  }

  /** The drone's rest (from a DroneDuty): its gate closes over 3 s and opens over 8. */
  setDroneResting(resting: boolean): void {
    if (resting === this.droneResting) return;
    this.droneResting = resting;
    const now = this.ctx.currentTime;
    if (!this.plan || this.plan.drone_hz <= 0 || now < this.openAt) return; // a retune in flight picks it up
    this.hold(this.droneGate.gain, now);
    this.droneGate.gain.linearRampToValueAtTime(resting ? 0 : 1, now + (resting ? DRONE_OUT_S : DRONE_IN_S));
  }

  stop(): void {
    const now = this.ctx.currentTime;
    for (const g of [this.gate.gain, this.droneGate.gain]) {
      this.hold(g, now);
      g.linearRampToValueAtTime(0, now + 0.5);
    }
    for (const o of [this.tone, this.a, this.b, this.drone, this.lfo]) o.stop(now + 0.6);
    this.plan = null;
  }
}
