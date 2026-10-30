// utils/export/resample.ts (v16.5 review B7, Export with layers: the long file's joins)
//
// The long file's music, joined sample-continuously. Each track is decoded at its own (native) rate, so Chrome does no
// resampling of its own, and resampled here, by one windowed-sinc kernel, onto ONE output grid: track k's first sample
// sits at its exact fractional place T_k = Σ_{j<k} n_j · rOut / rIn_j (the fraction carried from track to track, never
// rounded away), and near a join the two tracks' contributions simply add. Resampling is linear, so for two tracks of the
// same rate that sum IS the resampling of the two played back to back: no edge, no step, the music's own samples
// (B7: Chrome's per-track decode dropped each track's fractional last frame and zero-padded its filter at both edges, a
// 6.6× second-difference spike at every join). Nothing is crossfaded, nothing is scaled: each output sample is the
// kernel's weighted sum of the input, the weights summing to 1. Between tracks of DIFFERENT rates the sum is each
// track's own band-limited signal laid end to end (the best a rate change allows).
//
// The varispeed (432): rOut = 48,000 / PSF, read as 48,000 (as the single-track path's decode at DECODE_RATE).
// Pure on Float32Arrays; Node checks it (resample.check.ts, `npm run check:export`).

export const KERNEL_HALF = 24; // zero crossings each side, at the lower of the two rates
export const KERNEL_PHASES = 512;
export const KERNEL_BETA = 9;
/** The passband: this fraction of the lower Nyquist (input or output). */
export const KERNEL_CUTOFF = 0.97;

function besselI0(x: number): number {
  let s = 1;
  let t = 1;
  for (let k = 1; k < 50; k++) {
    t *= (x / (2 * k)) ** 2;
    s += t;
    if (t < 1e-12 * s) break;
  }
  return s;
}

export interface Kernel {
  /** Taps each side (input samples): the kernel spans input offsets −S+1 … S. */
  S: number;
  /** PHASES + 1 rows of 2S taps: row p weighs input sample i + j (j = −S+1 … S) for a position x = i + p / PHASES. */
  rows: Float32Array;
  phases: number;
  /** Its reach in OUTPUT frames each side (a contribution from a track reaches this far past its ends). */
  reachOut: number;
}

/** The kernel for rIn → rOut: a Kaiser-windowed sinc cut at KERNEL_CUTOFF of the lower Nyquist, each phase summing to 1. */
export function designKernel(rIn: number, rOut: number, half = KERNEL_HALF, phases = KERNEL_PHASES, beta = KERNEL_BETA, cutoff = KERNEL_CUTOFF): Kernel {
  const scale = Math.min(1, rOut / rIn); // < 1 when the output is slower (a 96 kHz file): the kernel widens
  const fc = cutoff * scale;
  const S = Math.ceil(half / scale);
  const W = 2 * S;
  const rows = new Float32Array((phases + 1) * W);
  const i0b = besselI0(beta);
  for (let p = 0; p <= phases; p++) {
    const frac = p / phases;
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const d = j - S + 1 - frac; // the tap's distance from x, in input samples
      const s = d === 0 ? 1 : Math.sin(Math.PI * fc * d) / (Math.PI * fc * d);
      const r = d / S;
      const w = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0b;
      const v = s * w;
      rows[p * W + j] = v;
      sum += v;
    }
    for (let j = 0; j < W; j++) rows[p * W + j] /= sum;
  }
  return { S, rows, phases, reachOut: Math.ceil(S * (rOut / rIn)) + 1 };
}

/** One track on the output grid: its native samples (from `off` on: a trimmed tail keeps its place), its rate and start. */
export interface GridTrack {
  /** Output frame (fractional) where its native sample 0 sits. */
  T: number;
  /** Its native length (samples), and the rate they are at. */
  n: number;
  rIn: number;
  /** step = rIn / rOut: input samples per output frame. */
  step: number;
  /** The native samples held: L/R[k] is sample off + k (mono: R === L). */
  off: number;
  L: Float32Array;
  R: Float32Array;
  kernel: Kernel;
}

/** The output frames a track reaches (its samples and its kernel's reach): [first, last). */
export function trackSpan(t: GridTrack): [number, number] {
  return [Math.floor(t.T) - t.kernel.reachOut, Math.ceil(t.T + t.n / t.step) + t.kernel.reachOut];
}

/**
 * Add track `t`'s contribution to output frames [o0, o0 + n) into outL / outR (from index 0). Samples outside the track
 * (before 0, after n, or before `off`: already let go) count as 0, so contributions of neighbouring tracks simply add.
 */
export function addTrack(t: GridTrack, o0: number, n: number, outL: Float32Array, outR: Float32Array): void {
  const [a, b] = trackSpan(t);
  const m0 = Math.max(o0, a);
  const m1 = Math.min(o0 + n, b);
  if (m1 <= m0) return;
  const { S, rows, phases } = t.kernel;
  const W = 2 * S;
  const L = t.L;
  const R = t.R;
  const lo = t.off;
  const hi = Math.min(t.n, t.off + L.length);
  const stereo = R !== L;
  for (let m = m0; m < m1; m++) {
    const x = (m - t.T) * t.step;
    const i = Math.floor(x);
    const pf = (x - i) * phases;
    const p = Math.floor(pf);
    const f = pf - p;
    const r0 = p * W;
    const r1 = r0 + W;
    const j0 = i - S + 1; // the first input sample the kernel weighs
    let accL = 0;
    let accR = 0;
    if (j0 >= lo && j0 + W <= hi) {
      const base = j0 - lo;
      for (let j = 0; j < W; j++) {
        const k0 = rows[r0 + j];
        const w = k0 + f * (rows[r1 + j] - k0);
        accL += L[base + j] * w;
        if (stereo) accR += R[base + j] * w;
      }
    } else {
      for (let j = 0; j < W; j++) {
        const s = j0 + j;
        if (s < lo || s >= hi) continue;
        const k0 = rows[r0 + j];
        const w = k0 + f * (rows[r1 + j] - k0);
        accL += L[s - lo] * w;
        if (stereo) accR += R[s - lo] * w;
      }
    }
    const q = m - o0;
    outL[q] += accL;
    outR[q] += stereo ? accR : accL;
  }
}

/**
 * v16.5 re-review (B7): where a track's first sample sits relative to its join, in output frames, when the long file's
 * first track is at rFirst: rOut / (2 · rIn) − rOut / (2 · rFirst). 0 between tracks of one rate (the sum is the
 * resampling of the two back to back, exactly). Between rates: a kernel's sum over a track's samples is, by the
 * midpoint rule, its integral over the track's span, and that span reaches half a sample (of the track's own rate)
 * before its first sample and after its last. Placed this way the first track's span ends exactly where the next
 * one's starts, so near the join their partial sums add to 1 as each kernel's whole sum does (DC carries across the
 * join); at the bare n · rOut / rIn placement the spans overlapped or parted by the half-samples' difference (−11 to
 * −31 dB of error under 16 kHz at a join; with this −31 to −47: resample.check.ts). What is left is the midpoint rule's
 * second-order term, ∝ (1/rA² − 1/rB²) times the kernels' slope at the edge. Nothing is scaled, no sample moves within
 * its track, and the file's length is still Σ n · rOut / rIn.
 */
export function joinShift(rIn: number, rFirst: number, rOut: number): number {
  return rOut / (2 * rIn) - rOut / (2 * rFirst);
}

/** Keep only what output frames ≥ `fromOut` still need of a track (its samples from the kernel's first tap on). */
export function trimTrack(t: GridTrack, fromOut: number): GridTrack {
  const need = Math.max(0, Math.floor((fromOut - t.T) * t.step) - t.kernel.S - 1);
  if (need <= t.off) return t;
  const cut = Math.min(need, t.off + t.L.length) - t.off;
  const L = t.L.slice(cut);
  return { ...t, off: t.off + cut, L, R: t.R === t.L ? L : t.R.slice(cut) };
}
