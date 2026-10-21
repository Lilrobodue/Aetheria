// Smoke test for utils/hexSpectrum.ts (npm run check:spectrum)
// Run with: node utils/hexSpectrum.smoke.ts   (Node 22.18+ strips the types)
// Exits non-zero on any assertion failure. Deterministic (no Math.random);
// every number it prints is reproducible except the µs timing at the end.

import { HEX_COLS, HEX_ROWS, HEX_CELLS, hexX, hexY } from './hexWander.ts';
import {
  createHexSpectrum, stepHexSpectrum, hexSpectrumCellLevel, hexSpectrumEcho, seedHexSpectrumFloors, envelopeMean,
  hexSpectrumAlphaScale, ECHO_SLOTS, HEX_SPECTRUM_TUNING,
} from './hexSpectrum.ts';
import type { HexSpectrum } from './hexSpectrum.ts';

let failures = 0;
let passes = 0;
function assert(cond: boolean, label: string, detail?: string) {
  if (cond) { passes++; console.log(`  PASS  ${label}${detail ? '  (' + detail + ')' : ''}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`); }
}

const XO = Math.sqrt(3) * 50, YO = 75;
const DT = 1 / 30;
const PHONE = { w: 411, h: 752 }, DESK = { w: 1280, h: 800 };
const { LEN_BASE, CAP_GAP } = HEX_SPECTRUM_TUNING;
type Bands = [number, number, number, number];
function run(s: HexSpectrum, seconds: number, f: (t: number) => Bands, playing = true, reduced = false, vp = PHONE, t0 = 0): number {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * DT;
    const [a, b, c, d] = f(t);
    stepHexSpectrum(s, a, b, c, d, playing, reduced, DT, t * 0.75, vp.w, vp.h);
  }
  return t0 + n * DT;
}
// Record the pillars' lengths while running: stats per pillar.
function stats(s: HexSpectrum, seconds: number, f: (t: number) => Bands, t0: number, pillar: number) {
  const n = Math.round(seconds / DT);
  let lo = 1e9, hi = -1e9, sum = 0, travel = 0, prev = s.len[pillar];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * DT;
    const [a, b, c, d] = f(t);
    stepHexSpectrum(s, a, b, c, d, true, false, DT, t * 0.75, PHONE.w, PHONE.h);
    const L = s.len[pillar];
    lo = Math.min(lo, L); hi = Math.max(hi, L); sum += L; travel += Math.abs(L - prev); prev = L;
  }
  // speed: steps travelled per second (how busy the bar looks)
  return { lo, hi, mean: sum / n, speed: travel / seconds, t: t0 + n * DT };
}
// The harness's envelopes, sampled at 20 fps and interpolated like the Visualizer.
function env20(fn: (t: number) => Bands): (t: number) => Bands {
  return (t: number) => {
    const p = t * 20, i0 = Math.floor(p), fr = p - i0;
    const a = fn(i0 / 20), b = fn((i0 + 1) / 20);
    return [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr, a[2] + (b[2] - a[2]) * fr, a[3] + (b[3] - a[3]) * fr];
  };
}
const q8 = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v))) / 255; // the envelope's Uint8 steps
const dance = env20((t) => {
  const beat = t % (60 / 128), kick = Math.exp(-beat / 0.09);
  const i = Math.round(t * 20);
  return [q8(0.1 + 0.8 * Math.exp(-beat / 0.15)), q8(0.15 + 0.85 * kick), q8(0.35 + 0.3 * Math.sin(t * 0.7) ** 2 + 0.15 * kick), q8(0.2 + 0.25 * (i % 4 === 0 ? 1 : 0))];
});
const pad = env20((t) => {
  const T = 2 * Math.PI;
  return [q8(0.62 + 0.22 * Math.sin(T * t / 11.3)), q8(0.66 + 0.24 * Math.sin(T * t / 7.7 + 1.1)),
    q8(0.70 + 0.22 * Math.sin(T * t / 5.3 + 2) * (0.7 + 0.3 * Math.sin(T * t / 17))), q8(0.5 + 0.25 * Math.sin(T * t / 3.9 + 0.5) * Math.sin(T * t / 13 + 0.2))];
});
// Speech: 4 Hz syllables in the mid band, a little bass, phrase pauses.
const speech = env20((t) => {
  const inPhrase = (t % 3) < 2.2;
  const syl = inPhrase ? Math.exp(-((t * 4) % 1) / 0.12) : 0;
  return [0.03, q8(0.05 + 0.16 * syl), q8(0.06 + 0.9 * syl), q8(0.04 + 0.3 * syl * ((Math.floor(t * 4) % 3) === 0 ? 1 : 0))];
});
const cellIndex = (c: number, r: number) => (r + HEX_ROWS) * (2 * HEX_COLS) + (c + HEX_COLS);
const cellX = (i: number) => hexX((i % (2 * HEX_COLS)) - HEX_COLS, Math.floor(i / (2 * HEX_COLS)) - HEX_ROWS, XO);
const cellY = (i: number) => hexY(Math.floor(i / (2 * HEX_COLS)) - HEX_ROWS, YO);
function finite(a: Float32Array) { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; }
const seeded = (means: number[] | null, sens = 1) => { const s = createHexSpectrum(); seedHexSpectrumFloors(s, means, sens); return s; };

console.log('geometry');
{
  const s = createHexSpectrum();
  let inRange = true;
  for (let i = 0; i < HEX_CELLS; i++) if (s.cellPillar[i] > s.pillars) inRange = false;
  assert(inRange, 'every cell belongs to a pillar');
  const at = new Map<string, number>();
  for (let i = 0; i < HEX_CELLS; i++) at.set(`${Math.round(cellX(i))},${Math.round(cellY(i))}`, i);
  let mirrored = 0, broken = 0;
  for (const [key, i] of at) {
    const [x, y] = key.split(',').map(Number);
    if (Math.abs(x) > 600 || Math.abs(y) > 450) continue;
    for (const [mx, my] of [[-x, y], [x, -y], [-x, -y]]) {
      const j = at.get(`${mx},${my}`);
      if (j === undefined) continue;
      mirrored++;
      if (s.cellPillar[i] !== s.cellPillar[j] || s.cellStep[i] !== s.cellStep[j]) broken++;
    }
  }
  assert(mirrored > 500 && broken === 0, 'left/right and up/down mirror cells share pillar and step', `${mirrored} pairs, ${broken} broken`);
  let ordered = true;
  for (let b = 1; b < s.nBars; b++) if (b !== s.lineSplit && !(s.barX[b] > s.barX[b - 1])) ordered = false;
  assert(ordered, 'each row of caps (upper, lower) runs left to right');
  let capsMirror = true;
  for (let b = 0; b < s.lineSplit; b++) {
    const m = s.lineSplit - 1 - b, lo = b + s.lineSplit;
    if (s.barPillar[b] !== s.barPillar[m] || s.barX[b] !== -s.barX[m] || s.barPillar[lo] !== s.barPillar[b] || s.barDY[b] !== -s.barDY[lo]) capsMirror = false;
  }
  assert(capsMirror, 'caps mirror left/right and up/down');
  const centre = cellIndex(0, 0);
  assert(s.cellStep[centre] === 0 && s.cellPillar[centre] === 0, 'the centre cell is step 0 of the centre pillar');
}

console.log('silence, levels and the tip');
{
  const s = seeded(null);
  run(s, 3, () => [0, 0, 0, 0]);
  let atBase = true;
  for (let p = 0; p < s.live; p++) if (Math.abs(s.len[p] - LEN_BASE) > 1e-6 || Math.abs(s.peak[p] - (LEN_BASE + CAP_GAP)) > 1e-3) atBase = false;
  assert(atBase && s.presence > 0.99, 'silence while playing: stubs on the centre row, caps just beyond, fully present');
  let t = run(s, 2, (t) => [0.9 * (t % 0.5 < 0.1 ? 1 : 0.2), 0.9 * (t % 0.5 < 0.1 ? 1 : 0.2), 0.1, 0.1]);
  let maxC = 0, maxT = 0;
  for (let i = 0; i < 30; i++) { t = run(s, DT, (t) => [0.9 * (t % 0.5 < 0.1 ? 1 : 0.2), 0.9 * (t % 0.5 < 0.1 ? 1 : 0.2), 0.1, 0.1], true, false, PHONE, t); maxC = Math.max(maxC, s.len[0]); maxT = Math.max(maxT, s.len[2]); }
  assert(maxC > maxT + 1, 'bass kicks: the centre bar is the longest', `${maxC.toFixed(2)} vs ${maxT.toFixed(2)}`);
  let maxLen = 0;
  for (let p = 0; p < s.live; p++) maxLen = Math.max(maxLen, s.len[p]);
  assert(maxLen <= s.maxLen + 1e-6 && maxLen * YO < PHONE.h / 2, 'no tip leaves the screen', `${(maxLen * YO).toFixed(0)} px of ${PHONE.h / 2}`);
  let maxL = 0, beyond = 0;
  const lit = new Map<number, number>();
  for (let i = 0; i < HEX_CELLS; i++) {
    const L = hexSpectrumCellLevel(s, i);
    maxL = Math.max(maxL, L);
    const p = s.cellPillar[i];
    if (L > 0 && s.cellStep[i] > s.len[p] + 0.5) beyond++;
    const key = p * 4 + (cellX(i) < 0 ? 0 : 2) + (cellY(i) > 0 ? 1 : 0);
    if (L > 0.5) lit.set(key, (lit.get(key) || 0) + 1);
  }
  let most = 0;
  for (const v of lit.values()) most = Math.max(most, v);
  assert(maxL <= 1 && beyond === 0, 'cell light within 0..1 and never beyond the tip');
  assert(most <= 3, 'at most a few bright cells per bar end', `max ${most}`);
}

console.log('quiet looks quiet, busy looks busy');
{
  const range = (s: HexSpectrum) => s.maxLen - LEN_BASE;
  // Floors seeded with each envelope's own mean, as the Visualizer does on a new track.
  const mean = (f: (t: number) => Bands) => { const m = [0, 0, 0, 0]; for (let i = 0; i < 2000; i++) { const b = f(i / 20); for (let k = 0; k < 4; k++) m[k] += b[k] / 2000; } return m; };
  const sd = seeded(mean(dance)), sp = seeded(mean(pad)), ss = seeded(mean(speech));
  let td = run(sd, 10, dance), tp = run(sp, 10, pad), ts = run(ss, 10, speech);
  const D = stats(sd, 10, dance, td, 0), P = stats(sp, 10, pad, tp, 0);
  const Pm = stats(sp, 10, pad, P.t, 1), Sm = stats(ss, 10, speech, ts, 1); // pillar 1 = the mids on a phone
  console.log(`        centre bar (steps above the stub): dance ${(D.lo - LEN_BASE).toFixed(2)}..${(D.hi - LEN_BASE).toFixed(2)} mean ${(D.mean - LEN_BASE).toFixed(2)}; pad ${(P.lo - LEN_BASE).toFixed(2)}..${(P.hi - LEN_BASE).toFixed(2)} mean ${(P.mean - LEN_BASE).toFixed(2)}; range ${range(sd).toFixed(2)}`);
  console.log(`        centre bar speed (steps/s): dance ${D.speed.toFixed(2)}, pad ${P.speed.toFixed(2)}`);
  console.log(`        mid bar: pad mean ${(Pm.mean - LEN_BASE).toFixed(2)} swing ${(Pm.hi - Pm.lo).toFixed(2)}; speech mean ${(Sm.mean - LEN_BASE).toFixed(2)} swing ${(Sm.hi - Sm.lo).toFixed(2)}`);
  assert(D.hi - D.lo > 0.6 * range(sd), '128-BPM kicks pump the centre bar over most of its range', `${(D.hi - D.lo).toFixed(2)} of ${range(sd).toFixed(2)} steps`);
  assert(P.mean - LEN_BASE < 0.45 * range(sp), 'a steady pad opens the lens less than half way', `${(P.mean - LEN_BASE).toFixed(2)} of ${range(sp).toFixed(2)}`);
  assert(P.speed < 0.2 * D.speed, 'a steady pad moves the centre bar under a fifth as fast as dance (it breathes)', `${P.speed.toFixed(2)} vs ${D.speed.toFixed(2)} steps/s`);
  assert(Sm.hi - Sm.lo > Pm.hi - Pm.lo, 'speech moves the mid bars more than a pad does', `${(Sm.hi - Sm.lo).toFixed(2)} vs ${(Pm.hi - Pm.lo).toFixed(2)}`);
  assert(P.mean > LEN_BASE + 0.15, 'but a pad still opens the lens (never dead)', `${(P.mean - LEN_BASE).toFixed(2)} steps`);
}

console.log('a steady track right after a busy one');
{
  // A track change re-seeds the floors, but each band's auto-gain peak carries
  // over and decays. GAIN_FLOOR must still cap the boost once it has decayed,
  // so a flat full-scale pad opens the lens as little after 20 s of dance as
  // from cold (a peak that followed the band below GAIN_FLOOR held it at gain 1).
  const flat = (): Bands => [1, 1, 1, 1];
  const open = (s: HexSpectrum, t0: number) => {
    const P = stats(s, 10, flat, run(s, 5, flat, true, false, PHONE, t0), 0);
    return (P.mean - LEN_BASE) / (s.maxLen - LEN_BASE);
  };
  const m = [0, 0, 0, 0];
  for (let i = 0; i < 2000; i++) { const b = dance(i / 20); for (let k = 0; k < 4; k++) m[k] += b[k] / 2000; }
  const cold = open(seeded([1, 1, 1, 1]), 0);
  const s = seeded(m);
  const t = run(s, 20, dance);
  seedHexSpectrumFloors(s, [1, 1, 1, 1], 1);
  const warm = open(s, t);
  assert(warm < 0.5 && Math.abs(warm - cold) < 0.05, 'a steady pad right after 20 s of dance opens the lens no wider than from cold',
    `${(100 * warm).toFixed(1)} % vs ${(100 * cold).toFixed(1)} % of the range`);
}

console.log('seed, seek and sensitivity');
{
  const s = createHexSpectrum();
  seedHexSpectrumFloors(s, [0.5, 0.6, NaN, 0.4], 1);
  assert(Math.abs(s.floor[0] - 0.5) < 1e-6 && Math.abs(s.floor[1] - 0.6) < 1e-6 && s.floor[2] === 0 && Math.abs(s.floor[3] - 0.4) < 1e-6, 'floors seed from the track means (NaN -> 0)');
  seedHexSpectrumFloors(s, null, 2);
  assert(Math.abs(s.floor[1] - 0.35 * 2) < 1e-6, 'no envelope: floors seed at the fallback level x sensitivity');
  const m = envelopeMean(new Uint8Array([0, 255, 255, 0]));
  assert(Math.abs(m - 0.5) < 1e-9 && envelopeMean(new Uint8Array(0)) === 0, 'envelopeMean: 0..255 -> 0..1, empty -> 0');
  // A seek: every band jumps 0 -> 1 in one frame. The flux may not jump past what RISE_MAX allows.
  const k = createHexSpectrum();
  run(k, 2, () => [0, 0, 0, 0]);
  const f0 = k.flux;
  run(k, DT, () => [1, 1, 1, 1], true, false, PHONE, 2);
  const cap = (1 - Math.exp(-DT / 1.5)) * (0.8 / DT);
  assert(k.flux - f0 <= cap + 1e-6, 'a seek-sized jump moves the onset flux no more than RISE_MAX allows', `${(k.flux - f0).toFixed(2)} <= ${cap.toFixed(2)}`);
  // Audio Reactivity: the same quiet music at sensitivity 2 opens the lens wider.
  const quiet = (sens: number) => (t: number): Bands => { const p = Math.exp(-((t * 1.5) % 1) / 0.25); return [0.05 * sens, (0.15 + 0.12 * p) * sens, (0.25 + 0.2 * p) * sens, (0.08 + 0.08 * p) * sens]; };
  const a = seeded([0.05, 0.19, 0.31, 0.1], 1), b = seeded([0.1, 0.38, 0.62, 0.2], 2);
  const A = stats(a, 6, quiet(1), run(a, 6, quiet(1)), 1), B = stats(b, 6, quiet(2), run(b, 6, quiet(2)), 1);
  assert(B.mean > A.mean + 0.2, 'sensitivity 2 opens the lens wider than 1 for the same quiet track', `${(A.mean - LEN_BASE).toFixed(2)} -> ${(B.mean - LEN_BASE).toFixed(2)} steps`);
}

console.log('inputs');
{
  const s = createHexSpectrum();
  run(s, 2, (t) => [NaN, Infinity, -1, t % 0.2 < 0.1 ? 1e9 : NaN]);
  assert(finite(s.len) && finite(s.peak) && finite(s.bands) && finite(s.floor) && Number.isFinite(s.flux) && Number.isFinite(s.presence), 'NaN, Infinity and negative inputs never poison the state (floors included)');
  stepHexSpectrum(s, 0.5, 0.5, 0.5, 0.5, true, false, 0, 0, PHONE.w, PHONE.h);
  stepHexSpectrum(s, 0.5, 0.5, 0.5, 0.5, true, false, NaN, 0, PHONE.w, PHONE.h);
  assert(finite(s.len) && finite(s.peak) && finite(s.floor), 'dt 0 or NaN leaves everything finite');
}

console.log('pause');
{
  const s = seeded([0.4, 0.5, 0.5, 0.3]);
  let t = run(s, 4, dance);
  const floors = Array.from(s.floor);
  const playingFlux = s.flux;
  t = run(s, 1.2, dance, false, false, PHONE, t);
  assert(s.presence < 0.05, 'paused 1.2 s: faded below 5 %', s.presence.toFixed(3));
  assert(floors.every((v, k) => Math.abs(v - s.floor[k]) < 1e-9), 'paused: the floors hold (a resume reads like before)');
  run(s, 3, dance, false, false, PHONE, t);
  let base = true;
  for (let p = 0; p < s.live; p++) if (Math.abs(s.len[p] - LEN_BASE) > 0.01) base = false;
  assert(base && s.presence < 1e-4 && s.flux < 0.1 * playingFlux, 'paused: bars at their stubs, the mode invisible, the flux decayed', `flux ${playingFlux.toFixed(2)} -> ${s.flux.toFixed(3)}`);
  const f0 = s.flux;
  stepHexSpectrum(s, 1, 1, 1, 1, true, false, DT, 0, PHONE.w, PHONE.h);
  assert(s.flux <= f0 + 1e-9, 'resume: the first frame back is not counted as an onset', `${f0.toFixed(3)} -> ${s.flux.toFixed(3)}`);
}

console.log('caps');
{
  const s = seeded([0.1, 0.1, 0.1, 0.1]);
  let t = run(s, 2, () => [0.1, 0.1, 0.1, 0.1]);
  t = run(s, 0.25, () => [1, 1, 0.1, 0.1], true, false, PHONE, t);
  const p = 0;
  const kicked = s.peak[p];
  t = run(s, 0.2, () => [0.1, 0.1, 0.1, 0.1], true, false, PHONE, t);
  assert(Math.abs(s.peak[p] - kicked) < 1e-6, 'the cap hangs after the kick', `${kicked.toFixed(3)} -> ${s.peak[p].toFixed(3)}`);
  t = run(s, 1.0, () => [0.1, 0.1, 0.1, 0.1], true, false, PHONE, t);
  assert(s.peak[p] < kicked - 1, 'then falls', `${kicked.toFixed(2)} -> ${s.peak[p].toFixed(2)}`);
  let above = true;
  for (let q = 0; q < s.live; q++) if (s.peak[q] < s.len[q] + CAP_GAP - 1e-4) above = false;
  assert(above, 'a cap never drops below its tip plus the gap');
  const hist: number[] = [];
  for (let i = 0; i < ECHO_SLOTS + 3; i++) {
    t = run(s, DT, () => [i % 3 === 0 ? 1 : 0.2, 0.5, 0.3, 0.2], true, false, PHONE, t);
    hist.push(s.peak[p]);
  }
  let echoOk = true;
  for (let k = 1; k < ECHO_SLOTS; k++) if (s.echo[hexSpectrumEcho(s, k) + p] !== Math.fround(hist[hist.length - 1 - k])) echoOk = false;
  assert(echoOk, 'echo slots hold the caps of 1 .. 8 frames ago');
}

console.log('photosensitivity');
{
  for (const reduced of [false, true]) {
    const s = seeded([0.6, 0.6, 0.6, 0.6]);
    const sq = (t: number): Bands => { const on = (t * 5) % 1 < 0.5 ? 1 : 0.2; return [on, on, on, on]; };
    const t = run(s, 5, sq, true, reduced);
    let lo = 1e9, hi = -1e9, maxStep = 0, prev = s.len[0], tlo = 1e9, thi = -1e9;
    for (let i = 0; i < 60; i++) {
      const [a, b, c, d] = sq(t + i * DT);
      stepHexSpectrum(s, a, b, c, d, true, reduced, DT, t + i * DT, PHONE.w, PHONE.h);
      const L = s.len[0];
      lo = Math.min(lo, L); hi = Math.max(hi, L); maxStep = Math.max(maxStep, Math.abs(L - prev)); prev = L;
      tlo = Math.min(tlo, s.len[2]); thi = Math.max(thi, s.len[2]);
    }
    console.log(`        5 Hz square wave, ${reduced ? 'reduced motion' : 'normal'}: centre tip swings ${(hi - lo).toFixed(2)} steps (${((hi - lo) * YO).toFixed(0)} px), max ${(maxStep * YO).toFixed(0)} px/frame; treble tip ${(thi - tlo).toFixed(2)} steps`);
    assert(thi - tlo < (reduced ? 0.3 : 0.7), `5 Hz input, ${reduced ? 'reduced motion' : 'normal'}: the treble tip (hats) moves less than ${reduced ? '0.3' : '0.7'} of a row`, `${(thi - tlo).toFixed(2)} steps`);
    if (reduced) assert(hi - lo < 1.0, 'reduced motion: a 5 Hz input moves the tip less than one row', `${(hi - lo).toFixed(2)} steps`);
    else assert(hi - lo < 3.0, '5 Hz input: the tip swings, but well under the screen half-height', `${(hi - lo).toFixed(2)} steps`);
  }
}

console.log('hats at 10 Hz (16ths at ~150 BPM alias like this in the 20 fps envelope)');
{
  for (const sens of [1, 2]) {
    const s = seeded([0.3 * sens, 0.4 * sens, 0.5 * sens, 0.55 * sens], sens);
    const hats = env20((t) => { const i = Math.round(t * 20); return [0.3 * sens, 0.4 * sens, 0.5 * sens, (i % 2 === 0 ? 0.8 : 0.3) * sens]; });
    let t = run(s, 6, hats);
    // The shake: the treble tip's largest move against the mean of its neighbours
    // one frame either side (slow wobble and swells cancel out of it).
    const L: number[] = [];
    for (let i = 0; i < 61; i++) { t = run(s, DT, hats, true, false, PHONE, t); L.push(s.len[2]); }
    let shake = 0;
    for (let i = 1; i < 60; i++) shake = Math.max(shake, Math.abs(L[i] - 0.5 * (L[i - 1] + L[i + 1])));
    assert(shake < 0.05, `sensitivity ${sens}: 10 Hz hats shake the treble tip by under 0.05 row (no tip-cell strobe)`, `${(shake * YO).toFixed(1)} px`);
  }
}

console.log('viewports');
{
  const s = createHexSpectrum();
  run(s, 1, () => [0.5, 0.5, 0.5, 0.5]);
  const phoneMax = s.maxLen, phoneLive = s.live, p2 = s.pos[2];
  run(s, 0.1, () => [0.5, 0.5, 0.5, 0.5], true, false, DESK);
  assert(s.maxLen !== phoneMax && s.pos[2] < p2 && s.live > phoneLive, 'a resize rebuilds the layout', `live ${phoneLive} -> ${s.live}`);
  let outer = 0;
  for (let p = 0; p <= s.pillars; p++) if (p * XO < DESK.w / 2) outer = p;
  assert(s.pos[outer] > 0.9, 'the outermost visible pillar is the treble', s.pos[outer].toFixed(2));
}

console.log("the App's panels (header, player bar)");
{
  // The phone's header covers y 0-85 and its player bar y 607-752 (411x752; measured in the App).
  const UI = { top: 85, bottom: 145 };
  const half = PHONE.h / 2, band = half - UI.bottom; // 231 px below the centre row, 291 above
  // A cap as the Visualizer draws it: a flat-topped hexagon of up to 27.5 px, stroked 1 px.
  const CAP_EDGE = (27.5 * Math.sqrt(3)) / 2 + 0.5;
  const full = (half / YO) * 0.86; // the reach with nothing covering the canvas (v14.8 as judged)
  const step = (s: HexSpectrum, b: number, top: number, bottom: number, vp = PHONE, t = 0) =>
    stepHexSpectrum(s, b, b, b, b, true, false, DT, t, vp.w, vp.h, top, bottom);
  // Furthest |y| the line strokes for one row of caps (`peaks` at offset `o`): the Visualizer's
  // Catmull-Rom spline through them (cubic Beziers), measured exactly at each cubic's extrema.
  const lineReach = (s: HexSpectrum, peaks: Float32Array, o: number, vpw: number) => {
    const reach = vpw / 2 + 2 * XO;
    let far = 0;
    for (let row = 0; row < 2; row++) {
      const X: number[] = [], Y: number[] = [];
      for (let b = row ? s.lineSplit : 0; b < (row ? s.nBars : s.lineSplit); b++) {
        if (Math.abs(s.barX[b]) > reach) continue;
        X.push(s.barX[b]); Y.push(s.barDY[b] * peaks[o + s.barPillar[b]]);
      }
      for (let k = 0; k < Y.length - 1; k++) {
        const k0 = k > 0 ? k - 1 : 0, k3 = k + 2 < Y.length ? k + 2 : Y.length - 1;
        const p0 = Y[k], p1 = Y[k] + (Y[k + 1] - Y[k0]) / 6, p2 = Y[k + 1] - (Y[k3] - Y[k]) / 6, p3 = Y[k + 1];
        const at = (t: number) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3;
        const a = -p0 + 3 * p1 - 3 * p2 + p3, bq = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
        const ts = [0, 1];
        if (Math.abs(a) < 1e-12) { if (Math.abs(bq) > 1e-12) ts.push(-c / bq); }
        else { const disc = bq * bq - 4 * a * c; if (disc >= 0) ts.push((-bq + Math.sqrt(disc)) / (2 * a), (-bq - Math.sqrt(disc)) / (2 * a)); }
        for (const t of ts) if (t >= 0 && t <= 1) far = Math.max(far, Math.abs(at(t)));
      }
    }
    return far;
  };

  const z = createHexSpectrum();
  step(z, 0.5, 0, 0);
  const plain = createHexSpectrum();
  stepHexSpectrum(plain, 0.5, 0.5, 0.5, 0.5, true, false, DT, 0, PHONE.w, PHONE.h);
  const odd = createHexSpectrum();
  step(odd, 0.5, NaN, -40);
  assert(Math.abs(z.maxLen - full) < 1e-12 && plain.maxLen === z.maxLen && odd.maxLen === z.maxLen && odd.top === 0 && odd.bottom === 0,
    'no panels (Zen Mode; or none passed, NaN, negative): the full-screen reach, as before', `${z.maxLen.toFixed(3)} steps`);

  // Full-scale square kicks (2.5 Hz, every band) push the heaviest bars to their full length.
  const s = seeded([0.3, 0.3, 0.3, 0.3]);
  const kick = (t: number) => ((t * 2.5) % 1 < 0.2 ? 1.5 : 0.05);
  let t = 0, capFar = 0, lineFar = 0, tipFar = 0;
  for (let i = 0; i < 30 * 12; i++, t += DT) {
    step(s, kick(t), UI.top, UI.bottom, PHONE, t);
    for (let p = 0; p < s.live; p++) { capFar = Math.max(capFar, s.peak[p] * YO); tipFar = Math.max(tipFar, s.len[p]); }
    lineFar = Math.max(lineFar, lineReach(s, s.peak, 0, PHONE.w), lineReach(s, s.echo, hexSpectrumEcho(s, 4), PHONE.w), lineReach(s, s.echo, hexSpectrumEcho(s, 8), PHONE.w));
  }
  assert(capFar + CAP_EDGE <= band && lineFar + 2 <= band, "the phone's panels: every cap and the line (core, bloom, echoes) stay above the player bar",
    `cap edge ${(capFar + CAP_EDGE).toFixed(1)}, line ${(lineFar + 2).toFixed(1)} of ${band} px`);
  assert(capFar + CAP_EDGE >= 0.95 * band, '... and the kicked caps still reach the band edge (the lens fits it, not shrunk well inside it)',
    `${(100 * (capFar + CAP_EDGE) / band).toFixed(1)} %; tips to ${tipFar.toFixed(2)} of ${s.maxLen.toFixed(2)} steps`);
  // The line's worst case, set directly: any two neighbouring caps at full height, every other cap at
  // rest (the spline overshoots most between them). On a desktop the line, not the caps, sets the reach.
  for (const [name, vp, top, bottom] of [['phone', PHONE, UI.top, UI.bottom], ['desktop', DESK, 71, 90]] as const) {
    const w = createHexSpectrum();
    step(w, 0.5, top, bottom, vp);
    const rest = LEN_BASE + CAP_GAP, full2 = w.maxLen + CAP_GAP, lim = vp.h / 2 - Math.max(top, bottom);
    let worst = 0;
    for (let p = 0; p < w.live - 1; p++) {
      w.peak.fill(rest);
      w.peak[p] = w.peak[p + 1] = full2;
      worst = Math.max(worst, lineReach(w, w.peak, 0, vp.w) + 2);
    }
    // (Exactly at the edge on a desktop, where the line's bound sets the reach, give or take the caps'
    // float32 rounding; inside it on the phone.)
    assert(worst <= lim + 1e-3 && (name === 'phone' || worst > lim - 0.5), `${name}: two neighbouring caps at full height, the rest at rest: the line ends inside the band`, `${worst.toFixed(2)} of ${lim} px`);
  }
  const flip = createHexSpectrum();
  step(flip, 0.5, UI.bottom, UI.top);
  assert(flip.maxLen === s.maxLen, 'the panel covering more sets both rows (the lens stays centred)', `${flip.maxLen.toFixed(3)} steps`);

  // Zen Mode hides the panels: the reach eases out to the full screen (no jump), and back.
  const fit = s.maxLen;
  step(s, 0.5, 0, 0, PHONE, t);
  const first = (s.maxLen - fit) / (full - fit);
  for (let i = 0; i < 120; i++) step(s, 0.5, 0, 0, PHONE, t);
  const grown = s.maxLen;
  step(s, 0.5, UI.top, UI.bottom, PHONE, t);
  const back = (grown - s.maxLen) / (grown - fit);
  for (let i = 0; i < 120; i++) step(s, 0.5, UI.top, UI.bottom, PHONE, t);
  assert(first > 0 && first < 0.15 && grown === z.maxLen && back > 0 && back < 0.15 && s.maxLen === fit,
    'the panels hidden or shown: the reach eases over a few frames, then settles exactly', `first frame ${(100 * first).toFixed(1)} % / ${(100 * back).toFixed(1)} % of the way`);
  // A resize lays everything out again: the reach snaps with it.
  step(s, 0.5, 71, 90, DESK, t);
  const deskFit = s.maxLen;
  const d2 = createHexSpectrum();
  step(d2, 0.5, 71, 90, DESK);
  assert(deskFit === d2.maxLen && deskFit < (DESK.h / 2 / YO) * 0.86, 'a resize snaps the reach to the new fit (desktop: header 71, player bar 90)', `${deskFit.toFixed(2)} steps`);
  // The fit is never longer than the full-screen reach (its margins keep it shorter on any real
  // screen; only past ~3,800 px tall does the cap itself hold it): a 1 px panel on a 6000 px screen.
  const tall = createHexSpectrum();
  step(tall, 0.5, 1, 1, { w: 1000, h: 6000 });
  assert(Math.abs(tall.maxLen - (3000 / YO) * 0.86) < 1e-12, 'a 1 px panel on a 6000 px screen: no longer than the full-screen reach', `${tall.maxLen.toFixed(2)} steps`);
  // Landscape: the band (63-321 of 411) can't hold a moving lens; the bars keep one step to grow.
  const land = createHexSpectrum();
  step(land, 0.5, 63, 90, { w: 752, h: 411 });
  assert(land.maxLen - LEN_BASE >= 1 - 1e-9 && land.maxLen < (411 / 2 / YO) * 0.86, 'landscape (header 63, player bar 90): the bars still grow a full step', `${(land.maxLen - LEN_BASE).toFixed(2)} steps`);
}

console.log('alpha scale (red guard, trails)');
{
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const reds = ['#FF4500', '#FF0000', '#8B0000', '#DC143C', '#f00', '#ff4500'];
  const others = ['#FF8C00', '#FFD700', '#3B82F6', '#FF1493', '#fbbf24', '#FFFFFF', '#000000'];
  assert(reds.every((c) => near(hexSpectrumAlphaScale(c, false), 0.7)), 'saturated reds (174/285/396 Hz, crimson; #rgb too) draw at 0.7');
  assert(others.every((c) => near(hexSpectrumAlphaScale(c, false), 1)), 'orange, gold, blue, deep pink, amber, white, black draw at 1');
  assert(near(hexSpectrumAlphaScale('#3B82F6', true), 0.5) && near(hexSpectrumAlphaScale('#FF4500', true), 0.35), 'Astral Trails halve it (0.35 for a red)');
  assert(['', 'red', 'rgb(255,0,0)', '#12', '#zzzzzz'].every((c) => near(hexSpectrumAlphaScale(c, false), 1)), 'anything but #rgb/#rrggbb counts as not red (never NaN)');
}

console.log('reduced motion and frame rate');
{
  // A sudden full-scale step: under reduced motion no tip may jump (normal motion: ~0.95 row per frame).
  for (const reduced of [false, true]) {
    const s = seeded([0.2, 0.2, 0.2, 0.2]);
    let t = run(s, 3, () => [0.2, 0.2, 0.2, 0.2], true, reduced);
    let jump = 0;
    const prev = Array.from(s.len);
    for (let i = 0; i < 30; i++) {
      t = run(s, DT, () => [1, 1, 1, 1], true, reduced, PHONE, t);
      for (let p = 0; p < s.live; p++) { jump = Math.max(jump, Math.abs(s.len[p] - prev[p])); prev[p] = s.len[p]; }
    }
    if (reduced) assert(jump < 0.35, 'reduced motion: a sudden full-scale step moves no tip more than 0.35 row per frame', `${jump.toFixed(2)} rows`);
    else console.log(`        normal motion: the same step moves a tip ${jump.toFixed(2)} rows in one frame`);
  }
  // Standard (30 fps) and Cooler (20 fps): the same 128-BPM run reads the same. Each rate is
  // averaged over three start phases, because a 20 fps frame clock aliases with the 20 fps envelope.
  const at = (dt: number) => {
    let mean = 0, max = 0;
    for (const ph of [0, 0.011, 0.023]) {
      const s = seeded([0.3, 0.33, 0.47, 0.26]);
      let t = ph, m = 0, n = 0, mx = 0;
      while (t < 20) {
        const [a, b, c, d] = dance(t);
        stepHexSpectrum(s, a, b, c, d, true, false, dt, t * 0.75, PHONE.w, PHONE.h);
        if (t > 10) { m += s.len[0]; n++; if (s.len[0] > mx) mx = s.len[0]; }
        t += dt;
      }
      mean += m / n / 3; max += mx / 3;
    }
    return { mean, max };
  };
  const std = at(1 / 30), cool = at(1 / 20);
  const rel = (a: number, b: number) => Math.abs(a - b) / b;
  assert(rel(cool.mean, std.mean) < 0.03 && rel(cool.max, std.max) < 0.03, 'Cooler (20 fps) and Standard (30 fps) give the centre bar the same mean and peak (within 3 %)',
    `mean ${cool.mean.toFixed(3)} vs ${std.mean.toFixed(3)}, peak ${cool.max.toFixed(3)} vs ${std.max.toFixed(3)}`);
}

console.log('timing');
{
  const s = createHexSpectrum();
  run(s, 2, (t) => [0.5 + 0.5 * Math.sin(t * 13), 0.5, 0.5, 0.5]);
  const N = 3000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) stepHexSpectrum(s, 0.5 + 0.5 * Math.sin(i), 0.5, 0.4, 0.3, true, false, DT, i * DT, PHONE.w, PHONE.h);
  const t1 = performance.now();
  let acc = 0;
  for (let i = 0; i < N; i++) for (let c = 0; c < HEX_CELLS; c++) acc += hexSpectrumCellLevel(s, c);
  const t2 = performance.now();
  console.log(`        phone: step ${((t1 - t0) / N * 1000).toFixed(1)} µs, levels of all 1200 cells ${((t2 - t1) / N * 1000).toFixed(1)} µs (checksum ${acc.toFixed(0)})`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
