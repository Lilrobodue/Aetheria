// Checks for utils/export/mixWav.ts (v16.5, Export with layers: the mix, the catch, the interpolator, the WAV).
// Run with: node utils/export/mixWav.check.ts   (npm run check:export; Node 22.18+ strips the types). Exits non-zero
// on any failure.

import {
  CEILING,
  FULL_SCALE,
  SLICE_FRAMES,
  catchConfig,
  decodePcm24,
  designInterp,
  encodePcm24,
  infoChunk,
  interpRange,
  makeRng,
  mixSlice,
  newCatchState,
  wavHeader,
} from './mixWav.ts';

let passed = 0;
const failures: string[] = [];
const ok = (cond: boolean, what: string) => {
  if (cond) passed++;
  else failures.push(what);
};
const eq = (a: unknown, b: unknown, what: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const RATE = 48_000;
const cfg = catchConfig(RATE, true);

/** The whole mix in slices of `S` (the engine's loop, with the lookahead read past each slice). */
function mixAll(mL: Float32Array, mR: Float32Array, lL: Float32Array, lR: Float32Array, S: number, on = true) {
  const N = mL.length;
  const c = { ...cfg, on };
  const st = newCatchState();
  const A = c.attack;
  const E = S + A;
  const bufs = { mL: new Float32Array(E), mR: new Float32Array(E), lL: new Float32Array(E), lR: new Float32Array(E), g: new Float32Array(E) };
  const oL = new Float32Array(N), oR = new Float32Array(N);
  const sL = new Float32Array(S), sR = new Float32Array(S);
  for (let o0 = 0; o0 < N; o0 += S) {
    const n = Math.min(S, N - o0), ne = Math.min(E, N - o0);
    bufs.mL.set(mL.subarray(o0, o0 + ne));
    bufs.mR.set(mR.subarray(o0, o0 + ne));
    bufs.lL.set(lL.subarray(o0, o0 + ne));
    bufs.lR.set(lR.subarray(o0, o0 + ne));
    mixSlice(bufs.mL, bufs.mR, bufs.lL, bufs.lR, n, ne, c, st, bufs.g, sL, sR);
    oL.set(sL.subarray(0, n), o0);
    oR.set(sR.subarray(0, n), o0);
  }
  return { oL, oR, st };
}

// ---- The catch never scales the music: out − m = g·l, 0 ≤ g ≤ 1; |out| ≤ C wherever |m| ≤ C.
{
  const rng = makeRng(7);
  const N = 30_000;
  const cases: Array<[string, (i: number) => number, number]> = [
    ['music at ±C', (i) => (i % 3 === 0 ? CEILING : -CEILING) * (rng() > 0.5 ? 1 : -1), 0.54],
    ['music at ±1.0', (i) => (i % 2 ? 1 : -1), 0.54],
    ['music at ±1.2 (a lossy decode past full scale)', (i) => (i % 2 ? 1.2 : -1.2), 0.54],
    ['random loud', () => (rng() * 2 - 1) * 0.999, 0.54],
    ['adversarial: layers fighting the music', (i) => Math.sin(i * 0.01) * 0.98, 0.54],
  ];
  for (const [name, mf, lamp] of cases) {
    const mL = new Float32Array(N), mR = new Float32Array(N), lL = new Float32Array(N), lR = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      mL[i] = mf(i);
      mR[i] = mf(i + 1);
      lL[i] = Math.sin(i * 0.05) * lamp;
      lR[i] = Math.sin(i * 0.051 + 1) * lamp;
    }
    const { oL, oR } = mixAll(mL, mR, lL, lR, SLICE_FRAMES);
    let musicScaled = 0, gBad = 0, over = 0;
    for (let i = 0; i < N; i++) {
      for (const [o, m, l] of [[oL[i], mL[i], lL[i]], [oR[i], mR[i], lR[i]]] as const) {
        const d = o - m;
        // d = g·l: same sign as l (or zero), |d| ≤ |l|.
        if (Math.abs(l) < 1e-9 ? Math.abs(d) > 1e-6 : d / l < -1e-6 || d / l > 1 + 1e-6) gBad++;
        if (Math.abs(m) <= CEILING && Math.abs(o) > CEILING + 1e-6) over++;
      }
      // One gain on both channels: the ratios agree where both layers are big enough to read.
      if (Math.abs(lL[i]) > 0.05 && Math.abs(lR[i]) > 0.05) {
        const gl = (oL[i] - mL[i]) / lL[i], gr = (oR[i] - mR[i]) / lR[i];
        if (Math.abs(gl - gr) > 1e-4) musicScaled++;
      }
    }
    eq(gBad, 0, `${name}: out − music is g·layers with 0 ≤ g ≤ 1 (never the music scaled)`);
    eq(over, 0, `${name}: under the ceiling wherever the music alone is`);
    eq(musicScaled, 0, `${name}: one gain on both channels (the binaural image never shifts)`);
  }
}

// ---- The attack reaches each constrained sample (lookahead); the release is monotone, at most τ 80 ms.
{
  const N = 20_000;
  const mL = new Float32Array(N), mR = new Float32Array(N), lL = new Float32Array(N).fill(0.3), lR = new Float32Array(N).fill(0.3);
  const spike = 10_000;
  mL[spike] = 0.95;
  mR[spike] = 0.95;
  const { oL } = mixAll(mL, mR, lL, lR, SLICE_FRAMES);
  const g = (i: number) => (oL[i] - mL[i]) / lL[i];
  ok(Math.abs(oL[spike]) <= CEILING + 1e-6, 'the spike itself is caught');
  ok(g(spike - cfg.attack - 1) > 0.9999, 'nothing lowered before the attack window');
  let mono = true;
  for (let i = spike - cfg.attack; i < spike; i++) if (g(i + 1) > g(i) + 1e-6) mono = false;
  ok(mono, 'the attack falls toward the spike');
  let rel = true;
  for (let i = spike; i < spike + 9600; i++) if (g(i + 1) < g(i) - 1e-6) rel = false;
  ok(rel, 'the release only rises');
  const tauFrames = 0.08 * RATE;
  const gs = g(spike);
  const at = (1 - gs) * Math.exp(-1) + gs; // a τ later the gain is within 1/e of where it started
  ok(Math.abs(g(spike + Math.round(tauFrames)) - (1 - (1 - gs) * Math.exp(-1))) < 0.01 || g(spike + Math.round(tauFrames)) >= at - 0.01, 'the release has τ 80 ms');
}

// ---- Sliced = one pass, bit for bit, at slice sizes 1, 7, 4096 and N (the catch's state carried).
{
  const N = 24_000;
  const rng = makeRng(99);
  const mL = new Float32Array(N), mR = new Float32Array(N), lL = new Float32Array(N), lR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    mL[i] = (rng() * 2 - 1) * 0.99;
    mR[i] = (rng() * 2 - 1) * 0.99;
    lL[i] = Math.sin(i * 0.02) * 0.4;
    lR[i] = Math.sin(i * 0.021) * 0.4;
  }
  const one = mixAll(mL, mR, lL, lR, N);
  for (const S of [1, 7, 4096]) {
    const s = mixAll(mL, mR, lL, lR, S);
    let diff = 0;
    for (let i = 0; i < N; i++) if (s.oL[i] !== one.oL[i] || s.oR[i] !== one.oR[i]) diff++;
    eq(diff, 0, `slices of ${S}: bit-identical to one pass`);
    eq([s.st.reduced, s.st.frames], [one.st.reduced, one.st.frames], `slices of ${S}: the same statistics`);
  }
  // A seam bug is visible: spikes just after each seam, mixed with the lookahead cut to nothing, differ from one pass
  // (and the right lookahead matches it).
  const sparse = (look: number) => {
    const NN = 4 * 4096;
    const m = new Float32Array(NN), l = new Float32Array(NN).fill(0.3);
    for (let k = 1; k < 4; k++) m[k * 4096 + 3] = 0.95;
    const c = { ...cfg };
    const st = newCatchState();
    const S = 4096, E = S + look;
    const out = new Float32Array(NN);
    const b = { m: new Float32Array(E), l: new Float32Array(E), g: new Float32Array(E) };
    const sL = new Float32Array(S), sR = new Float32Array(S);
    for (let o0 = 0; o0 < NN; o0 += S) {
      const n = Math.min(S, NN - o0), ne = Math.min(E, NN - o0);
      b.m.set(m.subarray(o0, o0 + ne)); b.l.set(l.subarray(o0, o0 + ne));
      mixSlice(b.m, b.m, b.l, b.l, n, ne, c, st, b.g, sL, sR);
      out.set(sL.subarray(0, n), o0);
    }
    return out;
  };
  const good = sparse(cfg.attack), cut = sparse(0), whole = (() => {
    const NN = 4 * 4096;
    const m = new Float32Array(NN), l = new Float32Array(NN).fill(0.3);
    for (let k = 1; k < 4; k++) m[k * 4096 + 3] = 0.95;
    return mixAll(m, m, l, l, NN).oL;
  })();
  let dGood = 0, dCut = 0;
  for (let i = 0; i < good.length; i++) {
    if (good[i] !== whole[i]) dGood++;
    if (cut[i] !== whole[i]) dCut++;
  }
  eq(dGood, 0, 'spikes at the seams: the lookahead makes slices equal one pass');
  const bad = dCut;
  ok(bad > 0, 'without the lookahead the seams differ (the check can see a seam bug)');
}

// ---- The catch off: the sum as it is (it can pass the ceiling).
{
  const N = 100;
  const mL = new Float32Array(N).fill(0.9), lL = new Float32Array(N).fill(0.3);
  const { oL } = mixAll(mL, mL, lL, lL, 32, false);
  ok(Math.abs(oL[50] - 1.2) < 1e-6, 'catch off: the plain sum');
}

// ---- The interpolator: DC gain 1 in every phase; images ≤ −80 dBc; zero delay.
{
  const ph = designInterp();
  for (let p = 0; p < 4; p++) {
    const s = ph[p].reduce((a, b) => a + b, 0);
    ok(Math.abs(s - 1) < 1e-6, `phase ${p}: unity DC gain`);
  }
  const lowRate = 12_000, f = 1000, nLow = 12_000;
  const x = new Float32Array(nLow);
  for (let j = 0; j < nLow; j++) x[j] = Math.sin((2 * Math.PI * f * j) / lowRate);
  const y = new Float32Array(nLow * 4);
  interpRange(x, ph, 4, 0, nLow * 4, y);
  // Zero delay: y[4j] ≈ x[j] away from the edges.
  let maxErr = 0;
  for (let j = 100; j < nLow - 100; j++) maxErr = Math.max(maxErr, Math.abs(y[4 * j] - x[j]));
  ok(maxErr < 0.02, `zero delay: y[4j] ≈ x[j] (max error ${maxErr.toFixed(4)})`);
  // Images: a single-bin DFT at the first image (lowRate − f) and around, against the tone, over a Hann window.
  const amp = (sig: Float32Array, rate: number, fr: number, s0: number, n: number) => {
    let re = 0, im = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const v = sig[s0 + i] * w;
      re += v * Math.cos((2 * Math.PI * fr * i) / rate);
      im -= v * Math.sin((2 * Math.PI * fr * i) / rate);
      wsum += w;
    }
    return (2 * Math.hypot(re, im)) / wsum;
  };
  const tone = amp(y, 48_000, f, 4000, 24_000);
  let worst = 0;
  for (const img of [lowRate - f, lowRate + f, 2 * lowRate - f, 2 * lowRate + f - 24_000 + 24_000]) {
    if (img >= 24_000) continue;
    worst = Math.max(worst, amp(y, 48_000, img, 4000, 24_000));
  }
  const dbc = 20 * Math.log10(worst / tone);
  ok(dbc <= -80, `the images are ≤ −80 dBc (${dbc.toFixed(1)})`);
  ok(Math.abs(tone - 1) < 0.01, 'the tone keeps its level through the ×4');
}

// ---- The header: RIFF, the sizes, fmt (1, 2, 48000, 288000, 6, 24), LIST/INFO even-padded, data at the stated offset.
{
  const info = { title: 'tone-01 · 528 Hz', software: 'Aetheria v16.5', comment: '528 Hz crystal; retuned to 432 Hz', date: '2026-10-29' };
  const frames = 1000;
  const h = wavHeader(frames, info);
  const v = new DataView(h.buffer);
  const str = (o: number) => String.fromCharCode(h[o], h[o + 1], h[o + 2], h[o + 3]);
  eq([str(0), str(8), str(12)], ['RIFF', 'WAVE', 'fmt '], 'the chunk ids');
  eq([v.getUint32(16, true), v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint32(28, true), v.getUint16(32, true), v.getUint16(34, true)], [16, 1, 2, 48_000, 288_000, 6, 24], 'fmt');
  eq(str(36), 'LIST', 'LIST after fmt');
  const listSize = v.getUint32(40, true);
  eq(str(44), 'INFO', 'INFO');
  eq(listSize % 2, 0, 'LIST is even');
  const dataAt = 36 + 8 + listSize;
  eq(str(dataAt), 'data', 'data at the stated offset');
  eq(v.getUint32(dataAt + 4, true), frames * 6, 'the data size');
  eq(v.getUint32(4, true), h.length - 8 + frames * 6, 'the RIFF size');
  eq(h.length, dataAt + 8, 'the header ends with data’s 8 bytes');
  // Each INFO field: id, size, NUL-terminated, even-padded; INAM in UTF-8.
  let o = 48;
  const ids: string[] = [];
  while (o < dataAt) {
    const id = str(o);
    const sz = v.getUint32(o + 4, true);
    ids.push(id);
    ok(h[o + 8 + sz - 1] === 0, `${id} is NUL-terminated`);
    o += 8 + sz + (sz & 1);
  }
  eq(ids, ['INAM', 'ISFT', 'ICMT', 'ICRD'], 'the INFO fields');
  eq(o, dataAt, 'the fields fill LIST exactly');
  const inam = new TextDecoder().decode(h.subarray(56, 56 + v.getUint32(52, true) - 1));
  eq(inam, 'tone-01 · 528 Hz', 'INAM is the title in UTF-8');
  eq(infoChunk(null).length, 0, 'no info: no LIST');
  eq(wavHeader(10, null).length, 44, 'no info: the classic 44-byte header');
}

// ---- The quantiser: 24-bit, the dither within ±1 LSB of the rounded value with a mean ≈ 0; clipping counted.
{
  const n = 50_000;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = Math.sin(i * 0.01) * 0.5;
    R[i] = -L[i];
  }
  const clip = { n: 0 };
  const plain = decodePcm24(encodePcm24(L, R, n, null, clip), n);
  let maxPlain = 0;
  for (let i = 0; i < n; i++) maxPlain = Math.max(maxPlain, Math.abs(plain.L[i] - L[i]) * FULL_SCALE);
  ok(maxPlain <= 0.5 + 1e-6, `no dither: within half an LSB (${maxPlain.toFixed(3)})`);
  const d = decodePcm24(encodePcm24(L, R, n, makeRng(3), clip), n);
  let maxD = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const e = (d.L[i] - L[i]) * FULL_SCALE;
    maxD = Math.max(maxD, Math.abs(e));
    sum += e;
  }
  ok(maxD <= 1.5 + 1e-6, `TPDF: within ±1 LSB of the rounded value (${maxD.toFixed(3)})`);
  ok(Math.abs(sum / n) < 0.02, `TPDF: mean ≈ 0 (${(sum / n).toFixed(4)})`);
  eq(clip.n, 0, 'nothing clipped at half scale');
  const over = new Float32Array([1.1, -1.2, 0.5, CEILING]);
  const c2 = { n: 0 };
  const back = decodePcm24(encodePcm24(over, over, 4, null, c2), 4);
  eq(c2.n, 4, 'four over full scale: counted (two each channel)');
  ok(back.L[0] === (FULL_SCALE - 1) / FULL_SCALE && back.L[1] === -1, 'clamped at full scale');
  const c3 = { n: 0 };
  encodePcm24(new Float32Array([CEILING, -CEILING]), new Float32Array([CEILING, -CEILING]), 2, makeRng(5), c3);
  eq(c3.n, 0, 'the ceiling plus the dither never clips');
}

if (failures.length) {
  console.error(`mixWav: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`mixWav: ${passed} checks passed, 0 failed`);
