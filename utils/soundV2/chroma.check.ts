// Checks for utils/soundV2/chroma.ts (build spec v15.1 §11.1): the port's numerics, its edge cases and its slicing.
// Run with: node utils/soundV2/chroma.check.ts   (Node 22.18+ strips the types), or npm run check:chroma
// Exits non-zero on any failure.
//
// Synthetic signals only (the golden parity against the reference's own stored values is tools/chroma-parity.ts).
// The expectations for them come from the reference analyser's behaviour, run on these same signals while porting
// (440 Hz with harmonics: offset +0.5, key A; 432 Hz with harmonics: offset −32.5; the A-minor triad: Am, 0.884; a
// pure 440 Hz tone: offset −0.5; the block signal: 2,151 votes; 28,159 samples: no entry). Where a result rests on a
// tiny margin, the checks hold a property rather than the exact value.

import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import {
  SR,
  N_FFT,
  HOP,
  BLOCK_FRAMES,
  BIN_WIDTH_HZ,
  TUNE_LO,
  TUNE_HI,
  RMS_GATE,
  MIN_FRAMES,
  MIN_SAMPLES,
  PITCH_CLASSES,
  KK_MAJOR,
  KK_MINOR,
  hannNumpy,
  posmod,
  roundHalfEven,
  pyRound,
  isLoudFrame,
  RealFft2048,
  tuningOf,
  foldChroma,
  keyOf,
  keyScores,
  analysePitchContent,
  analysePitchContentSync,
} from './chroma.ts';
import type { PitchAnalysis } from './chroma.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const argmax = (xs: ArrayLike<number>): number => {
  let at = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[at]) at = i;
  return at;
};
function okContent(a: PitchAnalysis, what: string) {
  if (a.status !== 'ok') {
    failures.push(`${what}: status ${a.status}, expected ok`);
    return null;
  }
  return a.content;
}
/** Σ of sines (hz, amplitude), zeros for the first startZeros samples; computed in float64, stored as float32. */
function tone(n: number, parts: [number, number][], startZeros = 0): Float32Array {
  const x = new Float32Array(n);
  for (let i = startZeros; i < n; i++) {
    const t = (i - startZeros) / SR;
    let v = 0;
    for (const [hz, a] of parts) v += a * Math.sin(2 * Math.PI * hz * t);
    x[i] = v;
  }
  return x;
}
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const S10 = 10 * SR;

async function main(): Promise<void> {
  // ------------------------------------------------------------------------------------------ constants --
  check(TUNE_LO === 9 && TUNE_HI === 185, 'constants: TUNE_LO 9, TUNE_HI 185 (exclusive)');
  check(BIN_WIDTH_HZ === 10.7666015625, 'constants: BIN_WIDTH_HZ is 22050/2048 exactly');
  check(MIN_FRAMES === 52 && MIN_SAMPLES === 28160, 'constants: MIN_FRAMES 52, MIN_SAMPLES 28,160');
  check(SR === 22050 && N_FFT === 2048 && HOP === 512 && BLOCK_FRAMES === 4096 && RMS_GATE === 0.003, 'constants: SR, N_FFT, HOP, BLOCK_FRAMES, RMS_GATE');
  check(PITCH_CLASSES.length === 12 && PITCH_CLASSES[9] === 'A' && KK_MAJOR.length === 12 && KK_MINOR.length === 12, 'constants: 12 pitch classes, A at 9, two 12-value profiles');

  // -------------------------------------------------------------------------------------- hannNumpy --
  {
    const w = hannNumpy(2048);
    const sha = createHash('sha256').update(new Uint8Array(w.buffer, w.byteOffset, w.byteLength)).digest('hex');
    check(sha === 'c3e46425de1c553640087d7860c1f10a44ad791c9e0cae8144c9bb0aaf40f5b8', `hann: sha256 of the float32 bytes is numpy's (${sha.slice(0, 12)}…)`);
    let sum = 0;
    for (let j = 0; j < w.length; j++) sum += w[j];
    check(sum === 1023.5000006630908, `hann: float64 sum 1023.5000006630908 (${sum})`);
    let sym = true;
    for (let j = 0; j < 2048; j++) if (w[j] !== w[2047 - j]) sym = false;
    check(w[0] === 0 && w[2047] === 0 && sym, 'hann: endpoints 0, symmetric');
    check(hannNumpy(1).length === 1 && hannNumpy(1)[0] === 1 && hannNumpy(0).length === 0, 'hann: n = 1 is [1], n = 0 is empty (numpy)');
  }

  // ------------------------------------------------------------------------------------ RealFft2048 --
  {
    const rnd = mulberry32(20261022);
    const x = new Float32Array(2048 * 3);
    for (let i = 0; i < x.length; i++) x[i] = rnd() * 2 - 1;
    const win = hannNumpy(2048);
    const fft = new RealFft2048();
    const out = new Float64Array(TUNE_HI + 1);
    let worst = 0;
    for (const start of [0, 777, 2048 * 2]) {
      fft.magnitudes(x, start, win, out);
      for (let k = TUNE_LO - 1; k <= TUNE_HI; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < 2048; n++) {
          const v = x[start + n] * win[n], ang = (2 * Math.PI * ((k * n) % 2048)) / 2048;
          re += v * Math.cos(ang);
          im -= v * Math.sin(ang);
        }
        const ref = Math.hypot(re, im);
        worst = Math.max(worst, Math.abs(out[k] - ref) / ref);
      }
    }
    check(worst < 1e-9, `RealFft2048 matches a naive float64 DFT on bins 8..185 (worst relative error ${worst.toExponential(2)})`);
  }

  // ------------------------------------------------------------------------- posmod, rounding, gate --
  check(posmod(-1e-15, 100) === 100, "posmod(−1e-15, 100) is 100 (numpy's mod; ((a%b)+b)%b would give 0)");
  check(posmod(-3, 12) === 9 && posmod(5, 12) === 5 && Object.is(posmod(0, 100), 0) && posmod(1199.5, 1200) === 1199.5, 'posmod: −3 mod 12 = 9, 5 mod 12 = 5, 0 mod 100 = +0');
  {
    const cases: [number, number][] = [[0.5, 0], [1.5, 2], [2.5, 2], [-1.5, -2], [-2.5, -2], [-3.5, -4], [5.5, 6], [4.4, 4], [-0.5, 0], [-4.5, -4]];
    const bad = cases.filter(([x, y]) => roundHalfEven(x) !== y);
    check(bad.length === 0, `roundHalfEven (Python's round): ${bad.map(([x]) => `${x}→${roundHalfEven(x)}`).join(', ') || 'all as Python'}`);
  }
  check(pyRound(0.12345, 4) === 0.1235, 'pyRound(0.12345, 4) is 0.1235');
  // An exact binary tie: Python's round gives 0.0312 (half to even), JS's toFixed 0.0313. Real chroma never hits one.
  check(pyRound(0.03125, 4) === 0.0313, 'pyRound(0.03125, 4) is 0.0313 (the documented, unreachable exact-tie difference)');
  {
    // energy for a target float64 rms r: sqrt(E / 2048 + 1e-12) = r
    const energyFor = (r: number): number => (r * r - 1e-12) * N_FFT;
    const rmsOf = (e: number): number => Math.sqrt(e / N_FFT + 1e-12);
    const g32 = Math.fround(0.003);
    const eA = energyFor(0.003 + 1e-12), rA = rmsOf(eA);
    check(rA > 0.003 && Math.fround(rA) === g32, 'isLoudFrame precondition: rms 0.003 + 1e-12 is above 0.003 in float64, equal to it in float32');
    check(!isLoudFrame(eA), 'isLoudFrame: rms 0.003 + 1e-12 is NOT loud (compared in float32)');
    const eB = energyFor(g32 + 1e-12), rB = rmsOf(eB);
    check(rB > g32 && Math.fround(rB) === g32, 'isLoudFrame precondition: rms fround(0.003) + 1e-12 is above fround(0.003) in float64, equal in float32');
    check(!isLoudFrame(eB), 'isLoudFrame: rms fround(0.003) + 1e-12 is NOT loud (the rms is rounded to float32 too)');
    check(isLoudFrame(energyFor(0.0031)), 'isLoudFrame: rms 0.0031 is loud');
    check(!isLoudFrame(energyFor(0.0029)), 'isLoudFrame: rms 0.0029 is not loud');
    check(!isLoudFrame(0), 'isLoudFrame: silence is not loud');
  }

  // ------------------------------------------------------------------------------- tuningOf, fold --
  {
    const spike = (at: number): Float64Array => {
      const h = new Float64Array(100);
      h[at] = 5;
      return h;
    };
    const t0 = tuningOf(new Float64Array(100));
    check(t0.offset === 0 && t0.tuningHz === 0, 'tuningOf: an empty histogram is (0, unclear)');
    // A lone spike makes a 5-bin plateau; the FIRST maximum (np.argmax) is 2 bins before it.
    const t60 = tuningOf(spike(60)), t20 = tuningOf(spike(20)), t80 = tuningOf(spike(80)), t1 = tuningOf(spike(1));
    check(t60.offset === 8.5 && t60.tuningHz === 440, `tuningOf: a spike at 60 → offset 8.5, 440 (${t60.offset}, ${t60.tuningHz})`);
    check(t20.offset === -31.5 && t20.tuningHz === 432, `tuningOf: a spike at 20 → offset −31.5, 432 (${t20.offset}, ${t20.tuningHz})`);
    check(t80.offset === 28.5 && t80.tuningHz === 0, `tuningOf: a spike at 80 → offset 28.5, unclear (${t80.offset}, ${t80.tuningHz})`);
    check(t1.offset === -49.5 && t1.tuningHz === 0, `tuningOf: the smoothing wraps around (a spike at 1 → first maximum at 0, offset −49.5) (${t1.offset})`);
  }
  {
    const at = (i: number): Float64Array => {
      const p = new Float64Array(1200);
      p[i] = 1;
      return p;
    };
    // ref L326 rounds half to even: offset 0.5 folds on 0 cents, so pitch bin 850 (A − 50 c) is class A (9).
    // Math.round would fold on 1 cent and put it in G# (8).
    const a = foldChroma(at(850), 0.5);
    check(a !== null && argmax(a) === 9 && a[9] === 1, `foldChroma: all mass at 850 with offset 0.5 is class 9 (A) (${a ? argmax(a) : 'null'})`);
    const b = foldChroma(at(848), -1.5);
    check(b !== null && argmax(b) === 9, `foldChroma: all mass at 848 with offset −1.5 (folds on −2) is class 9 (A) (${b ? argmax(b) : 'null'})`);
    const c = foldChroma(at(900), 0);
    check(c !== null && argmax(c) === 9 && foldChroma(at(949), 0)![9] === 1 && foldChroma(at(950), 0)![10] === 1,
      'foldChroma: class k takes [100k − 50, 100k + 50) on offset 0 (the np.roll direction)');
    check(foldChroma(new Float64Array(1200), 3.5) === null, 'foldChroma: an empty histogram is null');
  }

  // -------------------------------------------------------------------------------------------- keyOf --
  {
    let ok = true;
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      for (const [suffix, prof] of [['', KK_MAJOR], ['m', KK_MINOR]] as const) {
        const ch = Array.from({ length: 12 }, (_, j) => prof[(j - i + 12) % 12]);
        const k = keyOf(ch);
        if (k.key !== PITCH_CLASSES[i] + suffix) ok = false;
        worst = Math.max(worst, Math.abs(k.confidence - 1));
      }
    }
    check(ok && worst <= 1e-12, `keyOf: each profile rotated by i is PITCH_CLASSES[i] (+m) with r = 1 (worst |r − 1| ${worst.toExponential(1)})`);
    const flat = keyOf(new Array(12).fill(1 / 12));
    check(flat.key === '' && flat.confidence === 0, 'keyOf: a flat chroma is "" and 0');
    check(keyScores(new Array(12).fill(1 / 12)).length === 0, 'keyScores: a flat chroma has no scores');
    const rnd = mulberry32(7);
    const ch = Array.from({ length: 12 }, () => rnd());
    const s = keyScores(ch);
    let sorted = s.length === 24;
    for (let i = 1; i < s.length; i++) if (s[i].r > s[i - 1].r) sorted = false;
    const k = keyOf(ch);
    check(sorted && s[0].key === k.key && s[0].r === k.confidence && new Set(s.map((e) => e.key)).size === 24,
      'keyScores: 24 distinct keys, best first, the first being keyOf');
  }

  // -------------------------------------------------------------------------------------------- lengths --
  {
    const a = analysePitchContentSync(tone(28_159, [[440, 0.25]]));
    check(a.status === 'too-short' && a.samples === 28_159, `28,159 samples are too short (the reference stores no entry) (${a.status})`);
    const b = analysePitchContentSync(tone(28_160, [[440, 0.25]]));
    check(b.status === 'ok' || b.status === 'empty', `28,160 samples are analysed (${b.status})`);
    check(b.status === 'ok' && b.stats.frames === 52, '28,160 samples are 52 frames');
  }
  {
    const s = analysePitchContentSync(new Float32Array(S10));
    check(s.status === 'empty' && s.stats.votes === 0 && s.stats.loud === 0, `10 s of silence is empty with 0 votes (${s.status})`);
    const q = analysePitchContentSync(tone(S10, [[440, 0.0028]]));
    check(q.status === 'empty', `a 440 Hz sine of amplitude 0.0028 (rms ≈ 0.00198) is empty (${q.status})`);
    const l = analysePitchContentSync(tone(S10, [[440, 0.0057]]));
    check(l.status === 'ok', `a 440 Hz sine of amplitude 0.0057 (rms ≈ 0.0040) is ok (${l.status})`);
  }

  // ----------------------------------------------------------------------------- the block restart --
  {
    // Exactly 2,205,000 samples: 3,072 zeros, then a 0.25 sine at 440 Hz. 4,303 frames; frames 0-2 are quiet, so
    // block 0 has 4,093 loud frames and block 1 (frames 4096..4302) 207, both odd: the per-block counter gives
    // ceil(4093/2) + ceil(207/2) = 2,151 voters; one counter over the whole track would give ceil(4300/2) = 2,150.
    const x = tone(2_205_000, [[440, 0.25]], 3072);
    const a = analysePitchContentSync(x);
    check(a.status === 'ok' && a.stats.frames === 4303 && a.stats.loud === 4300, `block signal: 4,303 frames, 4,300 loud (${a.status === 'ok' ? `${a.stats.frames}, ${a.stats.loud}` : a.status})`);
    check(a.status === 'ok' && a.stats.votes === 2151, `block signal: 2,151 voters, the counter restarting per block (${a.status === 'ok' ? a.stats.votes : '-'})`);
    check(a.status === 'ok' && a.stats.votes !== 2150, 'block signal: not 2,150 (one counter for the whole track)');
    // The same expectation counted independently: each frame's own float64 energy, the float32 gate, per block.
    const frames = Math.floor((x.length - 2048) / 512) + 1;
    let expected = 0;
    for (let b0 = 0; b0 < frames; b0 += 4096) {
      let loud = 0;
      for (let f = b0; f < Math.min(frames, b0 + 4096); f++) {
        let e = 0;
        for (let j = f * 512; j < f * 512 + 2048; j++) e += x[j] * x[j];
        if (Math.fround(Math.sqrt(e / 2048 + 1e-12)) > Math.fround(0.003)) loud++;
      }
      expected += Math.ceil(loud / 2);
    }
    check(expected === 2151 && a.status === 'ok' && a.stats.votes === expected, `block signal: an independent per-block count agrees (${expected})`);
  }

  // ---------------------------------------------------------------------------------- the properties --
  {
    const c = okContent(analysePitchContentSync(tone(S10, [[440, 0.3], [880, 0.15], [1320, 0.1], [1760, 0.075]])), '440 Hz with harmonics');
    if (c) {
      check(c.tuningHz === 440 && Math.abs(c.tuningOffsetCents) <= 12, `440 Hz with harmonics: tuning 440, |offset| ≤ 12 (${c.tuningOffsetCents})`);
      check(argmax(c.chroma) === 9 && c.key.startsWith('A'), `440 Hz with harmonics: chroma argmax A, key A… (${PITCH_CLASSES[argmax(c.chroma)]}, ${c.key})`);
      // Output shape (stored as is: a plain Array of 12 at 4 dp, never renormalised)
      const sum = c.chroma.reduce((s, v) => s + v, 0);
      check(Array.isArray(c.chroma) && c.chroma.length === 12 && Math.abs(sum - 1) <= 6e-4, `output: chroma is an Array of 12 summing to 1 ± 6e-4 (${sum})`);
      check(c.chroma.every((v, i) => v === pyRound(c.chromaRaw[i], 4)) && c.keyConfidence === pyRound(c.keyConfidenceRaw, 3),
        'output: the stored chroma and confidence are the raw values rounded to 4 and 3 dp');
    }
  }
  {
    const c = okContent(analysePitchContentSync(tone(S10, [[432, 0.3], [864, 0.15], [1296, 0.1], [1728, 0.075]])), '432 Hz with harmonics');
    if (c) {
      check(c.tuningHz === 432 && Math.abs(c.tuningOffsetCents + 31.8) <= 12, `432 Hz with harmonics: tuning 432, |offset + 31.8| ≤ 12 (${c.tuningOffsetCents})`);
      check(c.chromaA4Hz === pyRound(440 * 2 ** (c.tuningOffsetCents / 1200), 2), `432 Hz with harmonics: chromaA4Hz from the half-integer offset (${c.chromaA4Hz})`);
    }
  }
  {
    const c = okContent(analysePitchContentSync(tone(S10, [[220, 0.2], [220 * 2 ** (3 / 12), 0.2], [220 * 2 ** (7 / 12), 0.2]])), 'the A-minor triad');
    if (c) check(c.key === 'Am' && c.keyConfidence > 0.8 && c.keyConfidence === 0.884, `the A-minor triad: Am, confidence 0.884 as the reference (${c.key} ${c.keyConfidence})`);
  }
  {
    const c = okContent(analysePitchContentSync(tone(S10, [[440, 0.25]])), 'a pure 440 Hz tone');
    if (c) check(c.tuningOffsetCents === -0.5 && c.chromaA4Hz === 439.87, `a pure 440 Hz tone: offset −0.5, A4 439.87, as the reference (${c.tuningOffsetCents})`);
  }

  // -------------------------------------------------------------------------------------- slicing --
  {
    const x = tone(S10, [[220, 0.2], [220 * 2 ** (3 / 12), 0.2], [220 * 2 ** (7 / 12), 0.2]]);
    const sync = analysePitchContentSync(x);
    let yields = 0;
    const sliced = await analysePitchContent(x, { sliceMs: 0, yieldFn: async () => { yields++; } });
    let same = true;
    try {
      deepStrictEqual(sliced, sync);
    } catch {
      same = false;
    }
    check(same && yields >= 10, `sliced (sliceMs 0) deep-equals sync, chromaRaw bit for bit (${yields} yields)`);
    let unsliced = 0;
    const plain = await analysePitchContent(x, { yieldFn: async () => { unsliced++; } });
    let same2 = true;
    try {
      deepStrictEqual(plain, sync);
    } catch {
      same2 = false;
    }
    check(same2 && unsliced === 0, 'without sliceMs it never yields, and equals sync');
    let calls = 0;
    const cancelled = await analysePitchContent(x, { sliceMs: 0, yieldFn: async () => { calls++; }, shouldCancel: () => calls >= 1 });
    check(cancelled.status === 'cancelled' && calls === 1, `cancel: shouldCancel true after the first yield gives cancelled (${cancelled.status}, ${calls} yields)`);
    const err = new Error('parked');
    let caught: unknown = null;
    try {
      await analysePitchContent(x, { sliceMs: 0, yieldFn: () => Promise.reject(err) });
    } catch (e) {
      caught = e;
    }
    check(caught === err, 'a rejecting yieldFn rejects analysePitchContent with the same error');
    const times: number[] = [];
    let clock = 0;
    await analysePitchContent(x, { sliceMs: 5, now: () => (clock += 1), yieldFn: async (ms) => { times.push(ms); } });
    check(times.length > 0 && times.every((ms) => ms >= 5), `yieldFn gets the slice's work time, ≥ sliceMs (${times.slice(0, 3).join(', ')}…)`);
    const short = await analysePitchContent(new Float32Array(100), { sliceMs: 0 });
    check(short.status === 'too-short', 'analysePitchContent: short input is too-short');
  }
}

await main();
console.log(`chroma: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures.slice(0, 30)) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
