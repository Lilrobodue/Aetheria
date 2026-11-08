// utils/export/resample.check.ts (v16.5 review B7): the long file's resampler, in Node (`npm run check:export`).
//   - a continuous sine split into two tracks at an odd place gives the same output as the whole (the join is
//     sample-continuous: no step, no edge), for 44.1 kHz and 48 kHz sources, and a 96 kHz one (the kernel widens);
//   - the fraction is carried: track 2 starts at n1 · rOut / rIn exactly (no rounding: its first sample lands where the
//     whole's does);
//   - the music's level: a sine comes out at its own amplitude (a 15 kHz one in a 44.1 kHz source too, within 0.05 dB),
//     each phase's weights sum to 1 (DC passes at 1: never scaled);
//   - a trimmed track gives the same samples for the frames it still covers.
//   - v16.5 re-review (B7): between tracks of different rates, joinShift's placement (half a sample by each rate) keeps
//     the join's error, against the continuous signal and in the band under 16 kHz (the re-reviewer's measure), under
//     a bound per pair, and at least 15 dB under the bare n · rOut / rIn placement's.
//   - v16.8.3 (Track Tuning, T8): each track on its own grid (rOut = 48,000 / its rate). With no tuning anywhere the
//     long file's samples are v16.8.2's, byte for byte (placeTrack against v16.8.2's inline placement, and a hash of the
//     rendered fixture pinned from 862d960's code); a tuned track between two Standard ones: the length is Σ n · rOut_k /
//     rIn_k, and its joins stay within today's join tolerances (and well under a placement with one grid's joinShift).

import { KERNEL_PHASES, addTrack, designKernel, joinShift, newGridPlacer, newKernelCache, placeTrack, reachBack, trackSpan, trimTrack } from './resample.ts';
import type { GridTrack } from './resample.ts';
import * as RESAMPLE from './resample.ts';
import { createHash } from 'node:crypto';

let passed = 0;
const failures: string[] = [];
const ok = (c: boolean, what: string) => {
  if (c) passed++;
  else failures.push(what);
};

const PSF = 0.981818;
const R_OUT = 48_000 / PSF;

function sine(n: number, from: number, f: number, r: number, a: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = a * Math.sin((2 * Math.PI * f * (from + i)) / r);
  return x;
}

function track(T: number, x: Float32Array, rIn: number): GridTrack {
  return { T, n: x.length, rIn, step: rIn / R_OUT, off: 0, L: x, R: x, kernel: designKernel(rIn, R_OUT) };
}

function render(tracks: GridTrack[], N: number): Float32Array {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  for (let o0 = 0; o0 < N; o0 += 4096) {
    const n = Math.min(4096, N - o0);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (const t of tracks) addTrack(t, o0, n, l, r);
    L.set(l, o0);
    R.set(r, o0);
  }
  return L;
}

// Each phase sums to 1 (DC at 1).
for (const rIn of [44_100, 48_000, 96_000, 192_000]) {
  const k = designKernel(rIn, R_OUT);
  const W = 2 * k.S;
  let worst = 0;
  for (let p = 0; p <= KERNEL_PHASES; p++) {
    let s = 0;
    for (let j = 0; j < W; j++) s += k.rows[p * W + j];
    worst = Math.max(worst, Math.abs(s - 1));
  }
  ok(worst < 1e-5, `${rIn}: each phase's weights sum to 1 (worst ${worst})`);
}

// The join: whole vs two tracks, at an odd split point.
for (const [rIn, f] of [[44_100, 1000], [48_000, 997], [44_100, 15_000], [96_000, 3000]] as const) {
  const n1 = Math.round(rIn * 1.3) + 7;
  const n2 = Math.round(rIn * 1.1) + 3;
  const whole = sine(n1 + n2, 0, f, rIn, 0.5);
  const a = sine(n1, 0, f, rIn, 0.5);
  const b = sine(n2, n1, f, rIn, 0.5);
  const N = Math.round((n1 + n2) / (rIn / R_OUT));
  const w = render([track(0, whole, rIn)], N);
  const T2 = n1 / (rIn / R_OUT);
  const s = render([track(0, a, rIn), track(T2, b, rIn)], N);
  let maxDiff = 0;
  for (let i = 0; i < N; i++) maxDiff = Math.max(maxDiff, Math.abs(w[i] - s[i]));
  ok(maxDiff < 2e-6, `${rIn} Hz, ${f} Hz: two tracks = the whole (max |diff| ${maxDiff.toExponential(2)})`);
  // The 2nd difference at the join is the music's own (the whole's there).
  const J = Math.floor(T2);
  let joinD2 = 0, wholeD2 = 0;
  for (let i = J - 40; i <= J + 40; i++) {
    joinD2 = Math.max(joinD2, Math.abs(s[i + 1] - 2 * s[i] + s[i - 1]));
    wholeD2 = Math.max(wholeD2, Math.abs(w[i + 1] - 2 * w[i] + w[i - 1]));
  }
  ok(joinD2 <= wholeD2 * 1.0001 + 1e-6, `${rIn} Hz, ${f} Hz: the join's 2nd difference ${joinD2.toExponential(3)} is the whole's ${wholeD2.toExponential(3)}`);
  // The level: the sine's amplitude in the middle (a single-bin DFT over whole cycles of the output).
  const fo = f * (R_OUT / rIn) * (rIn / R_OUT); // the output's frequency in output samples: f at rate R_OUT
  const m0 = Math.floor(N / 4), m1 = Math.floor((3 * N) / 4);
  let re = 0, im = 0, wsum = 0;
  for (let i = m0; i < m1; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - m0)) / (m1 - m0 - 1));
    const ph = (2 * Math.PI * fo * i) / R_OUT;
    re += s[i] * h * Math.cos(ph);
    im -= s[i] * h * Math.sin(ph);
    wsum += h;
  }
  const amp = (2 * Math.hypot(re, im)) / wsum;
  const db = 20 * Math.log10(amp / 0.5);
  ok(Math.abs(db) < 0.05, `${rIn} Hz, ${f} Hz: the level ${db.toFixed(4)} dB (never scaled; the top end kept)`);
}

// The fraction carried: track 2 of a different split lands where the whole's samples are (the same grid).
{
  const rIn = 44_100;
  const x = sine(rIn * 3, 0, 440, rIn, 0.3);
  const N = Math.round(x.length / (rIn / R_OUT));
  const w = render([track(0, x, rIn)], N);
  const cuts = [12_345, 50_001, 99_999];
  const parts: GridTrack[] = [];
  let at = 0;
  let T = 0;
  for (const c of [...cuts, x.length]) {
    const seg = x.slice(at, c);
    parts.push(track(T, seg, rIn));
    T += seg.length / (rIn / R_OUT);
    at = c;
  }
  const s = render(parts, N);
  let maxDiff = 0;
  for (let i = 0; i < N; i++) maxDiff = Math.max(maxDiff, Math.abs(w[i] - s[i]));
  ok(maxDiff < 2e-6, `four tracks at odd places = the whole (the fraction carried; max |diff| ${maxDiff.toExponential(2)})`);
}

// A trimmed track gives the same frames from where it was trimmed.
{
  const rIn = 48_000;
  const x = sine(rIn * 2, 0, 700, rIn, 0.4);
  const t = track(0, x, rIn);
  const from = 50_000;
  const tt = trimTrack(t, from);
  ok(tt.off > 0 && tt.L.length < x.length, 'trimmed: the samples before what is still needed are let go');
  const a = new Float32Array(4096), b = new Float32Array(4096), c = new Float32Array(4096), d = new Float32Array(4096);
  addTrack(t, from, 4096, a, b);
  addTrack(tt, from, 4096, c, d);
  let maxDiff = 0;
  for (let i = 0; i < 4096; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - c[i]));
  ok(maxDiff === 0, `the trimmed track's frames are the same (max |diff| ${maxDiff})`);
  const [s0, s1] = trackSpan(t);
  ok(s0 < 0 && s1 > Math.ceil(x.length / t.step), 'its span reaches its kernel past both ends');
}

// v16.5 re-review (B7): joins between rates. A continuous sine (60 Hz and 1 kHz, four phases) runs across the join;
// track B is placed at A's end plus joinShift (its samples are the sine at their own times). The error is the output
// less the continuous sine, low-passed at 16 kHz (a 255-tap Blackman-windowed sinc), its peak over the join relative
// to the sine's amplitude. The bounds: 44.1 ↔ 48 kHz −44 dB; a pair among 44.1–192 kHz −29 dB; 32 → 48 kHz −28 dB
// (measured here −46 to −47, −31 to −36, −31.5; with a 5 kHz sine as well −45, −30, −29). The residue is the
// midpoint rule's second-order term, ∝ 1/rA² − 1/rB², and the two kernels' different cut-offs: a burst under 1 ms
// long that sits mostly above 8 kHz (under 8 kHz it is −39 to −59 dB). Without the shift the same joins measure
// −11 to −31 dB.
{
  ok(joinShift(44_100, 44_100, R_OUT) === 0 && joinShift(96_000, 96_000, R_OUT) === 0, 'joinShift: 0 between tracks of one rate');
  const N = 255;
  const fc = 16_000 / R_OUT;
  const lp = new Float64Array(N);
  let lsum = 0;
  for (let i = 0; i < N; i++) {
    const d = i - 127;
    const sinc = d === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (N - 1));
    lp[i] = sinc * w;
    lsum += lp[i];
  }
  for (let i = 0; i < N; i++) lp[i] /= lsum;
  const joinErrorDb = (rA: number, rB: number, shift: boolean): number => {
    let worst = -999;
    for (const f0 of [60, 1000]) {
      for (const ph of [0, 0.7, 1.2, 2.1]) {
        const nA = Math.round(rA * 0.37) + 3;
        const nB = Math.round(rB * 0.31);
        const f = (t: number) => 0.5 * Math.sin(2 * Math.PI * f0 * t + ph);
        const tB0 = nA / rA + (shift ? joinShift(rB, rA, R_OUT) / R_OUT : 0);
        const A = new Float32Array(nA);
        const B = new Float32Array(nB);
        for (let i = 0; i < nA; i++) A[i] = f(i / rA);
        for (let i = 0; i < nB; i++) B[i] = f(tB0 + i / rB);
        const J = Math.floor((nA / rA) * R_OUT);
        const n = 2048;
        const o0 = J - n / 2;
        const L = new Float32Array(n);
        const R = new Float32Array(n);
        addTrack(track(0, A, rA), o0, n, L, R);
        addTrack(track(tB0 * R_OUT, B, rB), o0, n, L, R);
        const err = new Float64Array(n);
        for (let i = 0; i < n; i++) err[i] = L[i] - f((o0 + i) / R_OUT);
        let peak = 0;
        for (let i = 300; i < n - 300; i++) {
          let s = 0;
          for (let k = 0; k < N; k++) s += lp[k] * err[i + k - 127];
          peak = Math.max(peak, Math.abs(s));
        }
        worst = Math.max(worst, 20 * Math.log10(peak / 0.5 + 1e-12));
      }
    }
    return worst;
  };
  const pairs: Array<[number, number, number]> = [
    [44_100, 48_000, -44], [48_000, 44_100, -44],
    [44_100, 96_000, -29], [96_000, 44_100, -29], [48_000, 96_000, -29], [96_000, 48_000, -29],
    [44_100, 192_000, -29], [192_000, 44_100, -29], [88_200, 44_100, -29], [32_000, 48_000, -28],
  ];
  const seen: string[] = [];
  for (const [rA, rB, bound] of pairs) {
    const shifted = joinErrorDb(rA, rB, true);
    const bare = joinErrorDb(rA, rB, false);
    seen.push(`${rA / 1000}→${rB / 1000} ${shifted.toFixed(1)} (bare ${bare.toFixed(1)})`);
    ok(shifted <= bound, `${rA} → ${rB} Hz: the join's error ${shifted.toFixed(1)} dB is under ${bound} dB`);
    ok(shifted <= bare - 15, `${rA} → ${rB} Hz: the shift takes at least 15 dB off the bare placement's ${bare.toFixed(1)} dB`);
  }
  console.log(`  (joins between rates, dB under 16 kHz: ${seen.join('; ')})`);
}

// ---- v16.8.3: each track on its own grid -------------------------------------------------------------------------
{
  // joinShift's fourth argument defaults to the one grid: v16.5's formula, operation for operation.
  for (const [a, b] of [[44_100, 48_000], [96_000, 44_100], [48_000, 48_000]]) ok(Object.is(joinShift(a, b, R_OUT), joinShift(a, b, R_OUT, R_OUT)) && Object.is(joinShift(a, b, R_OUT), R_OUT / (2 * a) - R_OUT / (2 * b)), `joinShift(${a}, ${b}): the one-grid formula`);
  ok(joinShift(44_100, 44_100, 50_000, 48_000) === 50_000 / 88_200 - 48_000 / 88_200, 'joinShift on two grids: each half-sample on its own grid');
  // placeTrack with every track at PSF: v16.8.2's inline placement (engine.ts at 862d960), number for number.
  {
    const p = newGridPlacer();
    let Tnext = 0, r0 = 0;
    let same = 0;
    for (const [n, rIn] of [[13_337, 44_100], [12_001, 48_000], [9_999, 44_100], [7, 96_000], [100_003, 32_000]]) {
      if (r0 === 0) r0 = rIn;
      const step = rIn / R_OUT, T = Tnext + joinShift(rIn, r0, R_OUT);
      const back = r0 > 0 ? R_OUT / (2 * r0) : 0;
      const a = placeTrack(p, n, rIn, R_OUT);
      if (Object.is(a.T, T) && Object.is(a.step, step) && Object.is(a.join, Tnext) && Object.is(reachBack(p), back)) same++;
      Tnext += n / step;
      if (!Object.is(p.Tnext, Tnext)) same = -99;
    }
    ok(same === 5, `placeTrack at PSF is v16.8.2's placement, number for number (${same} of 5)`);
  }
  // The rendered long file with no tuning anywhere: v16.8.2's samples (the hash pinned from 862d960's own code).
  const PCM_V1682_SHA = '2f860b744ed9768b4aa87750ab01d8f286cd7c8ee459b2a0b33ebcbc0ab551e2';
  /** Three tracks (44.1, 48 and 44.1 kHz; a sine and a chirp-ish sum, deterministic) placed on the long file's grid by
   *  `place(n, rIn)` (→ { T, step }) and rendered whole: the samples' hash, and the frames. */
  function pcmFixture(R: any, place: (n: number, rIn: number) => { T: number; step: number; rOut: number }, totalOf: () => number): { sha: string; frames: number } {
    const tracks: any[] = [];
    const specs = [[44_100, 13_337, 440], [48_000, 12_001, 997], [44_100, 9_999, 1500]] as const;
    for (const [rIn, n, f] of specs) {
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = 0.4 * Math.sin((2 * Math.PI * f * i) / rIn) + 0.2 * Math.sin((2 * Math.PI * (f * 2.71) * i) / rIn + 0.3);
      const at = place(n, rIn);
      tracks.push({ T: at.T, n, rIn, step: at.step, off: 0, L: x, R: x, kernel: R.designKernel(rIn, at.rOut) });
    }
    const N = totalOf();
    const L = new Float32Array(N), Rr = new Float32Array(N);
    for (let o0 = 0; o0 < N; o0 += 4096) {
      const n = Math.min(4096, N - o0);
      const l = new Float32Array(n), r = new Float32Array(n);
      for (const t of tracks) R.addTrack(t, o0, n, l, r);
      L.set(l, o0);
      Rr.set(r, o0);
    }
    return { sha: createHash('sha256').update(Buffer.from(L.buffer)).update(Buffer.from(Rr.buffer)).digest('hex'), frames: N };
  }
    const p = newGridPlacer();
  const v = pcmFixture(RESAMPLE, (n: number, rIn: number) => { const a = placeTrack(p, n, rIn, R_OUT); return { T: a.T, step: a.step, rOut: R_OUT }; }, () => Math.round(p.Tnext));
  ok(v.sha === PCM_V1682_SHA && v.frames === 38_093, `no tuning anywhere: the long file's samples are v16.8.2's (${v.frames} frames, sha ${v.sha.slice(0, 12)})`);

  // A tuned track's joins: a continuous output-time signal g(o) runs across the join, each track's samples are g at their
  // own places on their own grids; the error (the output less g, low-passed at 16 kHz) at the join, relative to g's level.
  const rateOf = (c: number) => (c === 0 ? PSF : PSF * Math.pow(2, c / 1200));
  const NL = 255, fc = 16_000 / R_OUT, lp = new Float64Array(NL);
  let lsum = 0;
  for (let i = 0; i < NL; i++) { const d = i - 127; const sinc = d === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d); lp[i] = sinc * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (NL - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (NL - 1))); lsum += lp[i]; }
  for (let i = 0; i < NL; i++) lp[i] /= lsum;
  const tunedJoinDb = (rA: number, cA: number, rB: number, cB: number, oneGrid: boolean): number => {
    const oA = 48_000 / rateOf(cA), oB = 48_000 / rateOf(cB);
    let worst = -999;
    for (const f0 of [60, 1000]) for (const ph of [0, 0.7, 1.2, 2.1]) {
      const g = (o: number) => 0.5 * Math.sin((2 * Math.PI * f0 * o) / R_OUT + ph);
      const nA = Math.round(rA * 0.37) + 3, nB = Math.round(rB * 0.31);
      const pl = newGridPlacer();
      const a = placeTrack(pl, nA, rA, oA);
      const b = oneGrid ? { T: pl.Tnext + joinShift(rB, rA, oB), step: rB / oB } : placeTrack(pl, nB, rB, oB);
      const A = new Float32Array(nA), B = new Float32Array(nB);
      for (let i = 0; i < nA; i++) A[i] = g(a.T + i / a.step);
      for (let i = 0; i < nB; i++) B[i] = g(b.T + i / b.step);
      const J = Math.floor(nA / a.step);
      const n = 2048, o0 = J - n / 2;
      const L = new Float32Array(n), R = new Float32Array(n);
      addTrack({ T: a.T, n: nA, rIn: rA, step: a.step, off: 0, L: A, R: A, kernel: designKernel(rA, oA) }, o0, n, L, R);
      addTrack({ T: b.T, n: nB, rIn: rB, step: b.step, off: 0, L: B, R: B, kernel: designKernel(rB, oB) }, o0, n, L, R);
      const e = new Float64Array(n);
      for (let i = 0; i < n; i++) e[i] = L[i] - g(o0 + i);
      let peak = 0;
      for (let i = 300; i < n - 300; i++) { let sum = 0; for (let k = 0; k < NL; k++) sum += lp[k] * e[i + k - 127]; peak = Math.max(peak, Math.abs(sum)); }
      worst = Math.max(worst, 20 * Math.log10(peak / 0.5 + 1e-12));
    }
    return worst;
  };
  const tunedSeen: string[] = [];
  // One rate, a tuned grid next to a Standard one: today's one-rate join is exact; a tuned one stays under −50 dB and at
  // least 12 dB under the one-grid placement (a joinShift that ignores the first track's grid).
  for (const [rA, cA, rB, cB] of [[44_100, 0, 44_100, -50], [44_100, -50, 44_100, 0], [44_100, 0, 44_100, 50], [44_100, 50, 44_100, 0], [44_100, 0, 44_100, -14], [48_000, 31, 48_000, 0]]) {
    const two = tunedJoinDb(rA, cA, rB, cB, false), one = tunedJoinDb(rA, cA, rB, cB, true);
    tunedSeen.push(`${rA / 1000}@${cA}→${rB / 1000}@${cB} ${two.toFixed(1)} (one grid ${one.toFixed(1)})`);
    ok(two <= -50, `${rA}@${cA} c → ${rB}@${cB} c: the join's error ${two.toFixed(1)} dB is under −50 dB`);
    ok(two <= one - 12, `${rA}@${cA} c → ${rB}@${cB} c: two grids take at least 12 dB off one grid's ${one.toFixed(1)} dB`);
  }
  // Two rates and a tuned grid: within today's tolerance for a pair of rates (−29 dB), and better than one grid.
  for (const [rA, cA, rB, cB] of [[48_000, 0, 44_100, 23], [44_100, -50, 48_000, 0], [44_100, 0, 96_000, -50], [96_000, 50, 44_100, 0]]) {
    const two = tunedJoinDb(rA, cA, rB, cB, false), one = tunedJoinDb(rA, cA, rB, cB, true);
    tunedSeen.push(`${rA / 1000}@${cA}→${rB / 1000}@${cB} ${two.toFixed(1)} (one grid ${one.toFixed(1)})`);
    ok(two <= -29 && two < one, `${rA}@${cA} c → ${rB}@${cB} c: ${two.toFixed(1)} dB, under today's −29 dB and under one grid's ${one.toFixed(1)}`);
  }
  console.log(`  (joins with a tuned grid, dB under 16 kHz: ${tunedSeen.join('; ')})`);
  // A tuned track between two Standard ones (a long file of three, one rate): its length is Σ n · rOut_k / rIn_k, each
  // track where its join puts it.
  {
    const pl = newGridPlacer();
    const parts = [[13_337, 0], [12_001, -23], [9_999, 0]] as const;
    let want = 0;
    const at = parts.map(([n, c]) => { const rOut = 48_000 / rateOf(c); const a = placeTrack(pl, n, 44_100, rOut); want += (n * rOut) / 44_100; return a; });
    ok(Math.abs(pl.Tnext - want) < 1e-6 && Math.round(pl.Tnext) === Math.round(want), `three tracks, the middle one at −23 c: ${Math.round(pl.Tnext)} frames, Σ n · rOut / rIn`);
    ok(Math.abs(at[1].join - (13_337 * R_OUT) / 44_100) < 1e-6 && Math.abs(at[2].join - at[1].join - (12_001 * 48_000) / rateOf(-23) / 44_100) < 1e-6, 'each join where the music before it ends');
    ok(Math.round(pl.Tnext) > Math.round(((13_337 + 12_001 + 9_999) * R_OUT) / 44_100), 'the slower middle track makes the file longer than at Standard');
    ok(Math.abs(at[1].T - at[1].join - joinShift(44_100, 44_100, 48_000 / rateOf(-23), R_OUT)) < 1e-12 && Math.abs(at[2].T - at[2].join) < 1e-12, 'the tuned track sits joinShift on two grids past its join; the next Standard one at its join');
  }
}

// v16.8.3 fix round 1 (X02): the long file's kernel cache is keyed by both rates: a kernel made for one grid is never
// reused for another. Where they differ: a source above its grid's rate (48 kHz tuned above +31.8 c; 96 kHz).
{
  const rOutAt = (c: number) => 48_000 / (c === 0 ? PSF : PSF * Math.pow(2, c / 1200));
  const kf = newKernelCache();
  for (const [rIn, c1, c2] of [[48_000, 40, 50], [96_000, 0, -50], [96_000, 23, 0], [44_100, 0, -23]] as const) {
    const a = kf(rIn, rOutAt(c1)), b = kf(rIn, rOutAt(c2));
    ok(a !== b, `X02: ${rIn} Hz at ${c1} c and at ${c2} c: two kernels, never one reused`);
    const da = designKernel(rIn, rOutAt(c1)), db = designKernel(rIn, rOutAt(c2));
    ok(a.S === da.S && a.reachOut === da.reachOut && a.rows.every((v, i) => v === da.rows[i]), `X02: ${rIn} Hz at ${c1} c: the cache's kernel is that grid's own`);
    ok(b.S === db.S && b.reachOut === db.reachOut && b.rows.every((v, i) => v === db.rows[i]), `X02: ${rIn} Hz at ${c2} c: the cache's kernel is that grid's own`);
    ok(kf(rIn, rOutAt(c1)) === a, `X02: ${rIn} Hz at ${c1} c again: the same kernel (made once)`);
  }
  const k40 = designKernel(48_000, rOutAt(40)), k50 = designKernel(48_000, rOutAt(50));
  ok(k40.reachOut !== k50.reachOut || k40.rows.some((v, i) => v !== k50.rows[i]), 'X02: (48 kHz above +31.8 c: the two grids\' kernels do differ, so a reuse would be wrong)');
}

console.log(`resample: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
