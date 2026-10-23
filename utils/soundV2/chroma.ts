// utils/soundV2/chroma.ts — Analyse tracks (v15.1): a track's tuning, 12-bin chroma, A4, key and key confidence.
//
// An exact port of the reference key analyser's voting path (build spec v15.1 §5.1, §6). It takes mono PCM at
// 22050 Hz scaled like ffmpeg's `-ac 1` downmix, (L+R)·√½ (keyAnalysis.ts makes that from a decoded buffer), and
// gives what the reference stores: the chroma at 4 dp, the A4 its bins sit on at 2 dp, the Krumhansl-Kessler key
// and its correlation at 3 dp, plus the unrounded values for the parity checks.
//
// The reference's own numerics are kept wherever they decide a result: numpy's Hann formula, numpy's float `mod`,
// Python's round-half-even fold, the float32 loudness gate (numpy 2 compares float32(rms) > float32(0.003)), and
// the vote counter restarting in every 4096-frame block. The windowed products, the FFT and the magnitudes run in
// float64: the reference's float32 FFT changes nothing once the results are rounded.
//
// Pure: no imports, no DOM, erasable TypeScript only (node runs it directly: chroma.check.ts). The FFT tables and
// the window are built on first use, so loading the module costs nothing. `ref Lxx` is a line of the reference
// analyser.

export const SR = 22050;                                                    // ref L64
export const N_FFT = 2048;                                                  // ref L65
export const HOP = 512;                                                     // ref L66 (43.07 frames/s)
export const BLOCK_FRAMES = 4096;                                           // ref L252: the vote counter restarts per block
export const BIN_WIDTH_HZ = SR / N_FFT;                                     // 10.7666015625, exact (ref L67's BIN_HZ is an array, not this)
export const TUNE_LO = Math.max(2, Math.trunc(100 / BIN_WIDTH_HZ));         // 9   (ref L70)
export const TUNE_HI = Math.min(N_FFT / 2 - 1, Math.trunc(2000 / BIN_WIDTH_HZ)); // 185, exclusive (ref L71)
export const RMS_GATE = 0.003;                                              // ref L256, compared in float32
export const MIN_FRAMES = 52;                                               // the reference stores nothing below this: ref L293 fails under 43 frames, ref L302 under 52 (lags 12..51)
export const MIN_SAMPLES = (MIN_FRAMES - 1) * HOP + N_FFT;                  // 28,160 (1.277 s)
export const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;   // ref L73
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88] as const; // ref L75
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] as const; // ref L76

export interface PitchContent {
  chroma: number[];          // 12 values, C..B, each pyRound(v, 4) (ref L330); sums to 1 ± 6e-4, never renormalised
  chromaA4Hz: number;        // pyRound(440 * 2 ** (tuningOffsetCents / 1200), 2) (ref L331): the half-integer offset, not the fold's
  key: string;               // '' (flat chroma) | 'C'..'B' | 'Cm'..'Bm', sharps only
  keyConfidence: number;     // pyRound(r, 3) (ref L332)
  tuningOffsetCents: number; // half-integer in [-49.5, 49.5] (ref L226)
  tuningHz: 440 | 432 | 0;   // ref L227-231
  chromaRaw: number[];       // unrounded, for checks only, never stored
  keyConfidenceRaw: number;  // unrounded, for checks only
}
/** gateMarginRel = min over frames of |rms / 0.003 − 1| (the float64 rms): how close any frame came to the
 *  loudness gate. Within about 1e-5, a decoder's last-bit difference can flip that frame's vote. */
export interface PitchStats { frames: number; loud: number; votes: number; peaks: number; gateMarginRel: number }
export type PitchAnalysis =
  | { status: 'ok'; content: PitchContent; stats: PitchStats }
  | { status: 'empty'; stats: PitchStats }   // nothing voted: the reference stores no chroma or key (ref L223, L324)
  | { status: 'too-short'; samples: number } // < MIN_SAMPLES: the reference stores no entry (ref L293/L302, L495-497)
  | { status: 'cancelled' };
export interface AnalyseOptions {
  sliceMs?: number;                            // work this long, then yield. Omitted: never yield
  yieldFn?: (workMs: number) => Promise<void>; // awaited between slices with that slice's work time. A rejection PROPAGATES (the pass parks and stops this way)
  shouldCancel?: () => boolean;                // read after every yield; true → { status: 'cancelled' }
  now?: () => number;                          // default performance.now
}

type Finished = Exclude<PitchAnalysis, { status: 'cancelled' }>;

/** With `sliceMs` set, the clock is read every this many samples of the energy pass (S2)… */
const CHECK_SAMPLES = 65_536;
/** …and every this many voters (S3-S5). A power of two. */
const CHECK_VOTERS = 16;

// ------------------------------------------------------------------------------------------ numerics --

/** numpy's np.hanning(n) (ref L251), as float32: 0.5 + 0.5·cos(π·k/(n−1)) for k = 1−n, 3−n, …, n−1. Not the
 *  textbook 0.5 − 0.5·cos(2πj/(n−1)), which differs in the last bits. */
export function hannNumpy(n: number): Float32Array {
  if (n < 1) return new Float32Array(0);
  if (n === 1) return Float32Array.of(1);
  const w = new Float32Array(n);
  for (let j = 0; j < n; j++) w[j] = Math.fround(0.5 + 0.5 * Math.cos((Math.PI * (1 - n + 2 * j)) / (n - 1)));
  return w;
}

/** numpy's float np.mod (ref L215, L218): fmod, then + b when the remainder's sign differs from b's; a zero
 *  remainder takes b's sign. posmod(−1e-15, 100) is 100 (the caller's clamp sends it to the last bin), where
 *  ((a % b) + b) % b would give 0. */
export function posmod(a: number, b: number): number {
  let r = a % b;
  if (r === 0) return b < 0 ? -0 : 0;
  if ((r < 0) !== (b < 0)) r += b;
  return r;
}

/** Python's round(x) to an integer: halves go to the even neighbour (ref L326). */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Python's round(x, digits) for the stored values (ref L330-332). Both round the exact binary value, so they agree
 *  except on an exact binary tie (0.03125 at 4 dp: JS 0.0313, Python 0.0312), which real chroma never hits. */
export function pyRound(x: number, digits: number): number {
  return Number(x.toFixed(digits));
}

/** The loudness gate (ref L254, L256) on a frame's energy Σx² over its 2048 samples: the unwindowed frame RMS,
 *  compared in float32 as numpy 2 does (NEP 50: float32(rms) > float32(0.003), and float32(0.003) is
 *  0.003000000026077032). */
export function isLoudFrame(energy: number): boolean {
  return Math.fround(Math.sqrt(energy / N_FFT + 1e-12)) > Math.fround(RMS_GATE);
}

// ------------------------------------------------------------------------------------------------ FFT --

const HALF = N_FFT / 2; // the frame is packed into a 1024-point complex FFT
interface FftTables { rev: Uint16Array; cosT: Float64Array; sinT: Float64Array; cosS: Float64Array; sinS: Float64Array }
let fftTables: FftTables | null = null;
let hann2048: Float32Array | null = null;

function tables(): FftTables {
  if (fftTables) return fftTables;
  const rev = new Uint16Array(HALF);
  const bits = Math.log2(HALF);
  for (let i = 0; i < HALF; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cosT = new Float64Array(HALF / 2), sinT = new Float64Array(HALF / 2);
  for (let i = 0; i < HALF / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / HALF);
    sinT[i] = Math.sin((2 * Math.PI * i) / HALF);
  }
  const cosS = new Float64Array(HALF + 1), sinS = new Float64Array(HALF + 1);
  for (let k = 0; k <= HALF; k++) {
    cosS[k] = Math.cos((2 * Math.PI * k) / N_FFT);
    sinS[k] = Math.sin((2 * Math.PI * k) / N_FFT);
  }
  fftTables = { rev, cosT, sinT, cosS, sinS };
  return fftTables;
}

function hannWindow(): Float32Array {
  if (!hann2048) hann2048 = hannNumpy(N_FFT);
  return hann2048;
}

/** |rfft(frame · window)| of one 2048-sample frame (ref L255), in float64, for the bins the voting reads: the
 *  even/odd samples packed into a 1024-point complex radix-2 FFT, then the real split. */
export class RealFft2048 {
  private readonly re = new Float64Array(HALF);
  private readonly im = new Float64Array(HALF);

  /** Fills out[TUNE_LO − 1 .. TUNE_HI] (8..185) from x[start .. start + 2048) · win. */
  magnitudes(x: Float32Array, start: number, win: Float32Array, out: Float64Array): void {
    const { rev, cosT, sinT, cosS, sinS } = tables();
    const re = this.re, im = this.im;
    // Pack z[n] = x[2n]·w[2n] + i·x[2n+1]·w[2n+1], bit-reversed. Each product of two float32 values is exact in float64.
    for (let n = 0; n < HALF; n++) {
      const r = rev[n], j = 2 * n;
      re[r] = x[start + j] * win[j];
      im[r] = x[start + j + 1] * win[j + 1];
    }
    for (let size = 2; size <= HALF; size <<= 1) {
      const half = size >> 1, step = HALF / size;
      for (let i = 0; i < HALF; i += size) {
        for (let j = 0, t = 0; j < half; j++, t += step) {
          const a = i + j, b = a + half;
          const wr = cosT[t], wi = -sinT[t];
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
    // X[k] = E[k] + e^(−2πik/N)·O[k], with E = (Z[k] + conj Z[M−k]) / 2 and O = (Z[k] − conj Z[M−k]) / 2i.
    for (let k = TUNE_LO - 1; k <= TUNE_HI; k++) {
      const k2 = HALF - k; // k is 8..185, so k2 is 839..1016
      const zr = re[k], zi = im[k], cr = re[k2], ci = -im[k2];
      const er = 0.5 * (zr + cr), ei = 0.5 * (zi + ci);
      const dr = zr - cr, di = zi - ci;
      const or = 0.5 * di, oi = -0.5 * dr;
      const wr = cosS[k], wi = -sinS[k];
      const xr = er + (wr * or - wi * oi), xi = ei + (wr * oi + wi * or);
      out[k] = Math.sqrt(xr * xr + xi * xi);
    }
  }
}

// ------------------------------------------------------------------------------------------- voting --

/** One voter's spectral peaks between 100 and 2000 Hz (ref L201-218): each votes its magnitude into the tuning
 *  histogram (cents off A = 440, modulo a semitone, 1-cent bins) and into the 1-cent pitch-class histogram
 *  (0 = C on the A = 440 grid), in ascending bin order as np.add.at does. Returns the number of peaks. */
function votePeaks(mag: Float64Array, hist: Float64Array, pitchHist: Float64Array): number {
  let rowMax = 0;
  for (let k = TUNE_LO; k < TUNE_HI; k++) if (mag[k] > rowMax) rowMax = mag[k];
  const th = Math.max(rowMax * 0.15, 1e-3);                                   // ref L204
  let peaks = 0;
  for (let k = TUNE_LO; k < TUNE_HI; k++) {
    const m = mag[k], l = mag[k - 1], r = mag[k + 1];
    if (!(m > th && m > l && m >= r)) continue;                               // ref L205
    peaks++;
    const den = l - 2 * m + r;                                                // ref L210-212
    const p = Math.abs(den) > 1e-9 ? (0.5 * (l - r)) / den : 0;
    const f = (k + p) * BIN_WIDTH_HZ;                                         // ref L213
    const cents = 1200 * Math.log2(f / 440);                                  // ref L214
    const dev = posmod(cents + 50, 100) - 50;                                 // ref L215
    hist[Math.min(99, Math.max(0, Math.trunc(dev + 50)))] += m;               // ref L216
    pitchHist[Math.min(1199, Math.max(0, Math.trunc(posmod(cents + 900, 1200))))] += m; // ref L218
  }
  return peaks;
}

/** The tuning (ref L221-231): the 5-cent-smoothed histogram's first maximum, as a half-integer offset in cents
 *  from A = 440; 440 within 12 cents of 0, 432 within 12 cents of −31.8, else 0 (unclear). */
export function tuningOf(hist: Float64Array): { offset: number; tuningHz: 440 | 432 | 0 } {
  let total = 0;
  for (let i = 0; i < 100; i++) total += hist[i];
  if (total <= 1e-6) return { offset: 0, tuningHz: 0 };
  let best = -Infinity, at = 0;
  for (let i = 0; i < 100; i++) {
    let s = 0;
    for (let d = -2; d <= 2; d++) s += hist[(i + d + 100) % 100];
    if (s > best) {
      best = s;
      at = i;
    }
  }
  const offset = at - 50 + 0.5;
  if (Math.abs(offset) <= 12) return { offset, tuningHz: 440 };
  if (Math.abs(offset + 31.8) <= 12) return { offset, tuningHz: 432 };
  return { offset, tuningHz: 0 };
}

/** The chroma (ref L319-328): the pitch histogram folded on the track's own grid, each class taking the 100 cents
 *  centred on its note, normalised to sum 1. ch[k] = Σ_j pitch[(100k + j − 50 + off) mod 1200], which is
 *  np.roll(pitch, 50 − off).reshape(12, 100).sum(1). null when nothing voted. */
export function foldChroma(pitchHist: Float64Array, offsetCents: number): number[] | null {
  let total = 0;
  for (let i = 0; i < 1200; i++) total += pitchHist[i];
  if (total <= 1e-9) return null;
  const off = roundHalfEven(offsetCents);   // ref L326: Python's round(), so a half-integer offset goes to the even cent
  const ch: number[] = [];
  for (let k = 0; k < 12; k++) {
    let s = 0;
    for (let j = 0; j < 100; j++) s += pitchHist[posmod(100 * k + j - 50 + off, 1200)];
    ch.push(s);
  }
  let sum = 0;
  for (let k = 0; k < 12; k++) sum += ch[k];
  for (let k = 0; k < 12; k++) ch[k] /= sum;
  return ch;
}

/** The 24 Krumhansl-Kessler correlations (ref L86-91) in the reference's loop order (C, Cm, C#, C#m, …), or null
 *  for a flat chroma (ref L83: np.allclose(c, 0)). r is clamped to [−1, 1], as np.corrcoef does. */
function correlations(chroma: ArrayLike<number>): { key: string; r: number }[] | null {
  let mean = 0;
  for (let j = 0; j < 12; j++) mean += chroma[j];
  mean /= 12;
  const c: number[] = [];
  let flat = true;
  for (let j = 0; j < 12; j++) {
    c.push(chroma[j] - mean);
    if (!(Math.abs(c[j]) <= 1e-8)) flat = false;
  }
  if (flat) return null;
  let sxx = 0;
  for (let j = 0; j < 12; j++) sxx += c[j] * c[j];
  const out: { key: string; r: number }[] = [];
  for (let i = 0; i < 12; i++) {
    for (let mode = 0; mode < 2; mode++) {
      const prof: readonly number[] = mode === 0 ? KK_MAJOR : KK_MINOR;
      // p = np.roll(prof, i): p[j] = prof[(j − i) mod 12]
      let pm = 0;
      for (let j = 0; j < 12; j++) pm += prof[(j - i + 12) % 12];
      pm /= 12;
      let sxy = 0, syy = 0;
      for (let j = 0; j < 12; j++) {
        const q = prof[(j - i + 12) % 12] - pm;
        sxy += c[j] * q;
        syy += q * q;
      }
      const r = sxy / Math.sqrt(sxx) / Math.sqrt(syy);
      out.push({ key: PITCH_CLASSES[i] + (mode === 0 ? '' : 'm'), r: Math.min(1, Math.max(-1, r)) });
    }
  }
  return out;
}

/** The key (ref L79-92), from the UNROUNDED chroma: the first strictly best of the 24 profiles. '' and 0 when the
 *  chroma is flat. */
export function keyOf(chroma: ArrayLike<number>): { key: string; confidence: number } {
  const scores = correlations(chroma);
  if (!scores) return { key: '', confidence: 0 };
  let key = '', r = -2;
  for (const s of scores) {
    if (s.r > r) {
      key = s.key;
      r = s.r;
    }
  }
  return { key, confidence: r };
}

/** All 24 keys with their correlation, best first (a stable sort, so the first is keyOf's pick); [] for a flat
 *  chroma. For the parity tools' near-tie margin (r1 − r2) and the checks. */
export function keyScores(chroma: ArrayLike<number>): { key: string; r: number }[] {
  const scores = correlations(chroma);
  return scores ? scores.sort((a, b) => b.r - a.r) : [];
}

// ------------------------------------------------------------------------------------------ analysis --

/** The whole analysis (§6 S1-S9) as a generator that yields at the slicing check points, so the sync and the
 *  sliced runs execute the very same arithmetic in the same order. Expects length ≥ MIN_SAMPLES. */
function* pitchWork(x: Float32Array): Generator<void, Finished, void> {
  // S1: frames of 2048 at hop 512, no centring, the tail dropped (ref L242).
  const frames = Math.floor((x.length - N_FFT) / HOP) + 1;
  const hops = frames + 3;
  // S2: each hop's Σx² in float64; a frame's energy is its four hops'.
  const hopSq = new Float64Array(hops);
  for (let h = 0, since = 0; h < hops; h++) {
    let s = 0;
    for (let j = h * HOP, e = j + HOP; j < e; j++) {
      const v = x[j];
      s += v * v;
    }
    hopSq[h] = s;
    since += HOP;
    if (since >= CHECK_SAMPLES) {
      since = 0;
      yield;
    }
  }
  // S3-S5: in each 4096-frame block, the 1st, 3rd, 5th … loud frames vote (ref L252-258: mag[loud_rows][::2]).
  const fft = new RealFft2048();
  const win = hannWindow();
  const mag = new Float64Array(TUNE_HI + 1);
  const hist = new Float64Array(100);
  const pitchHist = new Float64Array(1200);
  let loud = 0, votes = 0, peaks = 0, gateMarginRel = Infinity;
  let loudInBlock = 0;
  for (let b0 = 0; b0 < frames; b0 += BLOCK_FRAMES) {
    loudInBlock = 0; // the vote counter restarts in every block, whatever the time slicing does
    const b1 = Math.min(frames, b0 + BLOCK_FRAMES);
    for (let f = b0; f < b1; f++) {
      const energy = ((hopSq[f] + hopSq[f + 1]) + hopSq[f + 2]) + hopSq[f + 3];
      const rel = Math.abs(Math.sqrt(energy / N_FFT + 1e-12) / RMS_GATE - 1);
      if (rel < gateMarginRel) gateMarginRel = rel;
      if (!isLoudFrame(energy)) continue;
      loud++;
      if ((loudInBlock++ & 1) !== 0) continue;
      fft.magnitudes(x, f * HOP, win, mag);
      peaks += votePeaks(mag, hist, pitchHist);
      votes++;
      if ((votes & (CHECK_VOTERS - 1)) === 0) yield;
    }
  }
  const stats: PitchStats = { frames, loud, votes, peaks, gateMarginRel };
  // S6-S9
  const { offset, tuningHz } = tuningOf(hist);
  const raw = foldChroma(pitchHist, offset);
  if (!raw) return { status: 'empty', stats };
  const { key, confidence } = keyOf(raw);
  return {
    status: 'ok',
    stats,
    content: {
      chroma: raw.map((v) => pyRound(v, 4)),
      chromaA4Hz: pyRound(440 * 2 ** (offset / 1200), 2),
      key,
      keyConfidence: pyRound(confidence, 3),
      tuningOffsetCents: offset,
      tuningHz,
      chromaRaw: raw,
      keyConfidenceRaw: confidence,
    },
  };
}

const defaultNow = (): number => performance.now();
const defaultYield = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The analysis, in one go. */
export function analysePitchContentSync(mono22050: Float32Array): Finished {
  if (mono22050.length < MIN_SAMPLES) return { status: 'too-short', samples: mono22050.length };
  const work = pitchWork(mono22050);
  for (;;) {
    const r = work.next();
    if (r.done) return r.value;
  }
}

/** The analysis, time-sliced when opts.sliceMs is set: the clock is read every 65,536 samples of S2 and every 16
 *  voters; once sliceMs has passed, `await yieldFn(elapsed)`, then `cancelled` if shouldCancel() is true. The
 *  result is bit-identical to analysePitchContentSync's. A rejecting yieldFn rejects this promise. */
export async function analysePitchContent(mono22050: Float32Array, opts: AnalyseOptions = {}): Promise<PitchAnalysis> {
  if (mono22050.length < MIN_SAMPLES) return { status: 'too-short', samples: mono22050.length };
  const work = pitchWork(mono22050);
  const sliceMs = opts.sliceMs;
  if (sliceMs === undefined) {
    for (;;) {
      const r = work.next();
      if (r.done) return r.value;
    }
  }
  const now = opts.now ?? defaultNow;
  const yieldFn = opts.yieldFn ?? defaultYield;
  let sliceStart = now();
  for (;;) {
    const r = work.next();
    if (r.done) return r.value;
    const elapsed = now() - sliceStart;
    if (elapsed < sliceMs) continue;
    await yieldFn(elapsed);
    if (opts.shouldCancel && opts.shouldCancel()) return { status: 'cancelled' };
    sliceStart = now();
  }
}
