// utils/export/mixWav.ts (v16.5, Export with layers; the addendum §3.3–§3.5, decision 4 B: 24-bit, 48 kHz)
//
// The mix, pure on Float32Arrays (Node checks it: mixWav.check.ts, `npm run check:export`):
//   - the ×4 interpolator (16 taps a phase, Kaiser β 8, cutoff 0.9 of the low Nyquist, unity DC per phase, zero delay)
//     that brings the quarter-rate layers to the output rate;
//   - the layer-only peak catch (decision: the music is NEVER scaled): one gain on the layers (both channels together,
//     so the binaural image never shifts), lowered just enough that |music + layers| stays under the ceiling wherever
//     the music alone does; linear attack over 1.5 ms of lookahead, exponential release τ 80 ms; its lookahead reaches
//     into the next slice, so a sliced mix is bit-identical to one pass;
//   - the WAV: RIFF, PCM 24-bit stereo at 48 kHz, a LIST/INFO chunk (the title, the app, the layers' words, the date),
//     with optional TPDF dither (±1 LSB, two uniform draws) and the samples clipped at full scale counted.
// The probe's src/dsp.ts and src/engines.ts are the reference (SCRATCH/v165-export/probe), minus the analysis.

export const OUT_RATE = 48_000;
export const BYTES_PER_SAMPLE = 3;
export const CHANNELS = 2;
export const BYTES_PER_FRAME = BYTES_PER_SAMPLE * CHANNELS;
export const FULL_SCALE = 8_388_608; // 2^23
/** The catch's ceiling: two LSB under full scale (room for the dither's ±1 and the rounding). */
export const CEILING = (FULL_SCALE - 2) / FULL_SCALE;
export const ATTACK_S = 0.0015;
export const RELEASE_S = 0.08;
export const SLICE_FRAMES = 4096;
/** The interpolator: L phases of TAPS taps. */
export const INTERP_L = 4;
export const INTERP_TAPS = 16;
export const INTERP_BETA = 8;
export const INTERP_CUTOFF = 0.9;

// ---------------------------------------------------------------------------------------------------------------
// The ×L interpolator
// ---------------------------------------------------------------------------------------------------------------

function besselI0(x: number): number {
  let s = 1;
  let t = 1;
  for (let k = 1; k < 40; k++) {
    t *= (x / (2 * k)) ** 2;
    s += t;
  }
  return s;
}

/** A Kaiser-windowed sinc interpolator from rate r to L·r: L phases of T taps (T even). Phase p, tap t weighs the low
 *  sample floor(o/L) − T/2 + 1 + t for output o with o mod L = p. cutoff: a fraction of the low rate's Nyquist. */
export function designInterp(L = INTERP_L, T = INTERP_TAPS, beta = INTERP_BETA, cutoff = INTERP_CUTOFF): Float32Array[] {
  const half = T / 2;
  const phases: Float32Array[] = [];
  const i0b = besselI0(beta);
  for (let p = 0; p < L; p++) {
    const ph = new Float32Array(T);
    let sum = 0;
    for (let t = 0; t < T; t++) {
      const x = p / L - (t - half + 1);
      const s = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
      const r = x / half;
      const w = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0b;
      ph[t] = s * w;
      sum += ph[t];
    }
    for (let t = 0; t < T; t++) ph[t] /= sum;
    phases.push(ph);
  }
  return phases;
}

/** Output frames [o0, o0 + n) of the ×L interpolation of x (zero outside it), into out[0..n). */
export function interpRange(x: Float32Array, phases: Float32Array[], L: number, o0: number, n: number, out: Float32Array): void {
  const T = phases[0].length;
  const half = T / 2;
  for (let i = 0; i < n; i++) {
    const o = o0 + i;
    const q = Math.floor(o / L);
    const ph = phases[o - q * L];
    const j0 = q - half + 1;
    let acc = 0;
    if (j0 >= 0 && j0 + T <= x.length) {
      for (let t = 0; t < T; t++) acc += x[j0 + t] * ph[t];
    } else {
      for (let t = 0; t < T; t++) {
        const j = j0 + t;
        if (j >= 0 && j < x.length) acc += x[j] * ph[t];
      }
    }
    out[i] = acc;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The layer-only peak catch, slice by slice
// ---------------------------------------------------------------------------------------------------------------

export interface CatchState {
  /** The gain at the last frame written (the release runs from it). */
  prev: number;
  /** Frames written with the layers lowered (gain < 0.9999), and the sum of their reductions in dB. */
  reduced: number;
  reducedDbSum: number;
  minGain: number;
  frames: number;
}

export function newCatchState(): CatchState {
  return { prev: 1, reduced: 0, reducedDbSum: 0, minGain: 1, frames: 0 };
}

export interface CatchConfig {
  ceiling: number;
  /** Attack in frames (the lookahead). */
  attack: number;
  /** The release's per-frame coefficient: 1 − e^(−1 / (τ · rate)). */
  releaseA: number;
  on: boolean;
}

export function catchConfig(rate = OUT_RATE, on = true): CatchConfig {
  return { ceiling: CEILING, attack: Math.max(1, Math.round(ATTACK_S * rate)), releaseA: 1 - Math.exp(-1 / (RELEASE_S * rate)), on };
}

/**
 * Mix one slice: out = m + g·l per channel, for the slice's n frames. mL/mR and lL/lR hold the slice's frames from
 * index 0 and ALSO the lookahead after them (ne ≥ n frames in all: ne = min(n + attack, frames left)). g is a scratch of
 * ≥ ne. The catch's release state carries in `st`. The music is written as it is: never scaled.
 */
export function mixSlice(
  mL: Float32Array, mR: Float32Array, lL: Float32Array, lR: Float32Array,
  n: number, ne: number, cfg: CatchConfig, st: CatchState, g: Float32Array, outL: Float32Array, outR: Float32Array,
): void {
  g.fill(1, 0, ne);
  const C = cfg.ceiling;
  const A = cfg.attack;
  if (cfg.on) {
    for (let j = 0; j < ne; j++) {
      const m1 = mL[j], m2 = mR[j], l1 = lL[j], l2 = lR[j];
      let gm = 1;
      if (Math.abs(m1 + l1) > C && m1 * l1 > 0) gm = Math.min(gm, Math.max(0, (C - Math.abs(m1)) / Math.abs(l1)));
      if (Math.abs(m2 + l2) > C && m2 * l2 > 0) gm = Math.min(gm, Math.max(0, (C - Math.abs(m2)) / Math.abs(l2)));
      if (gm < 1) {
        for (let k = 0; k <= A && j - k >= 0; k++) {
          const v = gm + ((1 - gm) * k) / A;
          if (v < g[j - k]) g[j - k] = v;
        }
      }
    }
  }
  let prev = st.prev;
  for (let i = 0; i < n; i++) {
    let v = g[i];
    if (cfg.on) {
      const rel = prev + (1 - prev) * cfg.releaseA;
      if (rel < v) v = rel;
      prev = v;
      if (v < 0.9999) {
        st.reduced++;
        st.reducedDbSum += -20 * Math.log10(Math.max(v, 1e-6));
      }
      if (v < st.minGain) st.minGain = v;
    }
    outL[i] = mL[i] + lL[i] * v;
    outR[i] = mR[i] + lR[i] * v;
  }
  st.prev = prev;
  st.frames += n;
}

// ---------------------------------------------------------------------------------------------------------------
// The WAV
// ---------------------------------------------------------------------------------------------------------------

export interface WavInfo {
  /** INAM: the title (UTF-8). */
  title: string;
  /** ISFT: "Aetheria v16.5". */
  software: string;
  /** ICMT (ASCII): "528 Hz crystal; binaural beat Alpha, adaptive; drone; Key fit -1.5 dB; retuned to 432 Hz; made for headphones". */
  comment: string;
  /** ICRD: "2026-10-29". */
  date: string;
}

const enc = new TextEncoder();
const ascii = (s: string): Uint8Array => Uint8Array.from(Array.from(s.replace(/[^\x20-\x7e]/g, '?')).map((c) => c.charCodeAt(0)));

/** A LIST/INFO chunk: each field NUL-terminated and padded to an even size. */
export function infoChunk(info: WavInfo | null | undefined): Uint8Array {
  if (!info) return new Uint8Array(0);
  const fields: Array<[string, Uint8Array]> = [
    ['INAM', enc.encode(info.title)],
    ['ISFT', ascii(info.software)],
    ['ICMT', ascii(info.comment)],
    ['ICRD', ascii(info.date)],
  ];
  const sub = fields.map(([id, bytes]) => {
    const size = bytes.length + 1;
    const padded = size + (size & 1);
    const b = new Uint8Array(8 + padded);
    for (let i = 0; i < 4; i++) b[i] = id.charCodeAt(i);
    new DataView(b.buffer).setUint32(4, size, true);
    b.set(bytes, 8);
    return b;
  });
  const body = 4 + sub.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(8 + body);
  const v = new DataView(out.buffer);
  out.set([0x4c, 0x49, 0x53, 0x54], 0); // LIST
  v.setUint32(4, body, true);
  out.set([0x49, 0x4e, 0x46, 0x4f], 8); // INFO
  let o = 12;
  for (const b of sub) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** The header for `frames` frames of 24-bit stereo at `rate`: RIFF, fmt (PCM 1), LIST/INFO, then data's own 8 bytes. */
export function wavHeader(frames: number, info?: WavInfo | null, rate = OUT_RATE): Uint8Array {
  const list = infoChunk(info);
  const dataSize = frames * BYTES_PER_FRAME;
  const size = 12 + 24 + list.length + 8;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  w(0, 'RIFF');
  v.setUint32(4, size - 8 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, CHANNELS, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * BYTES_PER_FRAME, true);
  v.setUint16(32, BYTES_PER_FRAME, true);
  v.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  out.set(list, 36);
  w(36 + list.length, 'data');
  v.setUint32(40 + list.length, dataSize, true);
  return out;
}

/** A small seeded xorshift (deterministic in the checks; any seed in the app). */
export function makeRng(seed = 0x12345678): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Interleave and quantise one slice to 24-bit little-endian: TPDF dither (±1 LSB) when `rng` is given, then round and
 *  clamp; clipped samples are counted. */
export function encodePcm24(L: Float32Array, R: Float32Array, n: number, rng: (() => number) | null, clip: { n: number }, out?: Uint8Array): Uint8Array {
  const bytes = out && out.length >= n * BYTES_PER_FRAME ? out.subarray(0, n * BYTES_PER_FRAME) : new Uint8Array(n * BYTES_PER_FRAME);
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const x = (c === 0 ? L[i] : R[i]) * FULL_SCALE;
      let s = Math.round(rng ? x + (rng() - rng()) : x);
      if (s > FULL_SCALE - 1) {
        s = FULL_SCALE - 1;
        clip.n++;
      } else if (s < -FULL_SCALE) {
        s = -FULL_SCALE;
        clip.n++;
      }
      bytes[o++] = s & 0xff;
      bytes[o++] = (s >> 8) & 0xff;
      bytes[o++] = (s >> 16) & 0xff;
    }
  }
  return bytes;
}

/** The decoded samples of a 24-bit stereo slice (tests and the dev hook: the music's level read back). */
export function decodePcm24(bytes: Uint8Array, frames: number): { L: Float32Array; R: Float32Array } {
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  let o = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < 2; c++) {
      let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      o += 3;
      (c === 0 ? L : R)[i] = v / FULL_SCALE;
    }
  }
  return { L, R };
}
