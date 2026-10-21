// Smoke test for utils/hexWander.ts
// Run with: node utils/hexWander.smoke.ts   (Node 22.18+ strips the types), or npm run check:hex
// Exits non-zero on any assertion failure. Seeded (mulberry32): every number it
// prints is reproducible except the µs timing at the end.
//
// The load-bearing checks: the moved grid formulas and the corner tables are
// bit-identical to the Visualizer's v14.6 inline code (the wander-OFF path must
// draw exactly what v14.6 draws), the neighbour table matches the geometry for
// both row signs, and no two tokens ever share, or head into, the same cell.

import {
  HEX_SIZE,
  HEX_COLS,
  HEX_ROWS,
  HEX_CELLS,
  PHI,
  hexX,
  hexY,
  goldenShade,
  hexIndex,
  buildNeighbourTable,
  hexCornerX,
  hexCornerY,
  createHexWander,
  resetHexWander,
  stepHexWander,
  easeGlide,
  hexWanderCover,
  smoothWanderEnergy,
} from './hexWander.ts';
import type { HexWander } from './hexWander.ts';
import { readFileSync } from 'node:fs';

let failures = 0;
let passes = 0;

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    passes++;
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string) {
  console.log(`\n== ${name} ==`);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 30; // one rendered frame at the 30 fps Standard cap
const F32_06 = Math.fround(0.6);
const F32_12 = Math.fround(1.2);
const fmt = (v: number, d = 2) => v.toFixed(d);

// ---------- The grid exactly as the Visualizer's particleDensity effect builds it (v14.6) ----------
const V_PHI = (1 + Math.sqrt(5)) / 2;
const size = 50;
const hexWidth = Math.sqrt(3) * size;
const hexHeight = 2 * size;
const xOffset = hexWidth;
const yOffset = hexHeight * 0.75;

const colOf = new Int16Array(HEX_CELLS);
const rowOf = new Int16Array(HEX_CELLS);
const posX = new Float64Array(HEX_CELLS);
const posY = new Float64Array(HEX_CELLS);
const cellShade = new Uint8Array(HEX_CELLS);

section('1. Grid pins');
{
  let index = 0;
  let orderOk = true;
  let xyOk = true;
  let shadeOk = true;
  for (let r = -15; r < 15; r++) {
    for (let c = -20; c < 20; c++) {
      const x = (c * xOffset) + ((r % 2) * xOffset / 2);
      const y = r * yOffset;
      const mathType = (Math.abs((c * r * V_PHI) + index) * V_PHI) % 1;
      let colorType: 'primary' | 'shade1' | 'shade2' = 'primary';
      if (mathType > 0.69) { colorType = mathType > 0.85 ? 'shade2' : 'shade1'; }
      const want = colorType === 'shade2' ? 2 : colorType === 'shade1' ? 1 : 0;
      if (hexIndex(c, r) !== index) orderOk = false;
      if (!Object.is(hexX(c, r, xOffset), x) || !Object.is(hexY(r, yOffset), y)) xyOk = false;
      if (goldenShade(c, r, index) !== want) shadeOk = false;
      colOf[index] = c;
      rowOf[index] = r;
      posX[index] = x;
      posY[index] = y;
      cellShade[index] = want;
      index++;
    }
  }
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < HEX_CELLS; i++) {
    if (cellShade[i] === 1) s1++;
    else if (cellShade[i] === 2) s2++;
  }
  console.log(`  cells ${index}, shade1 ${s1}, shade2 ${s2} (${s1 + s2} tokens, ${fmt((100 * (s1 + s2)) / index, 1)}%)`);
  console.log(`  hexX(0,-1) = ${hexX(0, -1, xOffset)}, hexX(0,1) = ${hexX(0, 1, xOffset)}, hexX(0,0) = ${hexX(0, 0, xOffset)}`);
  assert(HEX_SIZE === 50 && HEX_COLS === 20 && HEX_ROWS === 15, 'HEX_SIZE 50, HEX_COLS 20, HEX_ROWS 15');
  assert(index === 1200 && HEX_CELLS === 1200, '1,200 cells');
  assert(PHI === V_PHI, "PHI is the Visualizer's (1 + Math.sqrt(5)) / 2, bit for bit");
  assert(orderOk, 'hexIndex equals the build order for every cell');
  assert(hexIndex(20, 0) === -1 && hexIndex(-21, 0) === -1 && hexIndex(0, 15) === -1 && hexIndex(0, -16) === -1,
    'hexIndex is -1 off the grid');
  assert(xyOk, 'hexX/hexY are bit-identical to the inline formulas for every cell');
  assert(shadeOk, 'goldenShade matches the inline golden-ratio colour type for every cell');
  assert(s1 === 183 && s2 === 159, '183 shade1 + 159 shade2 = 342', `got ${s1} + ${s2}`);
  assert(Math.abs(hexX(0, -1, xOffset) + 43.30127018922193) < 1e-12, 'hexX(0,-1) = -43.30127… (odd negative rows shift left)');
  assert(Math.abs(hexX(0, 1, xOffset) - 43.30127018922193) < 1e-12, 'hexX(0,1) = +43.30127…');
  assert(hexX(0, 0, xOffset) === 0, 'hexX(0,0) = 0');
}

// ---------- Neighbours ----------
const { nb, offGrid } = buildNeighbourTable();
const at = (c: number, r: number) => hexIndex(c, r);
const nbList = (i: number) => {
  const out: number[] = [];
  for (let s = 0; s < 6; s++) out.push(nb[i * 6 + s]);
  return out;
};
const isNeighbour = (a: number, b: number) => {
  for (let s = 0; s < 6; s++) if (nb[a * 6 + s] === b) return true;
  return false;
};

section('2. Neighbours vs geometry, every cell');
{
  const spacing = Math.sqrt(3) * 50;
  let geomBad = 0;
  let asym = 0;
  let offBad = 0;
  let dupes = 0;
  let six = 0;
  let nearestOther = Infinity;
  for (let i = 0; i < HEX_CELLS; i++) {
    const listed = nbList(i).filter((j) => j >= 0);
    if (new Set(listed).size !== listed.length) dupes++;
    const geo: number[] = [];
    for (let j = 0; j < HEX_CELLS; j++) {
      if (j === i) continue;
      const d = Math.hypot(posX[j] - posX[i], posY[j] - posY[i]);
      if (Math.abs(d - spacing) <= 1e-6) geo.push(j);
      else if (d < nearestOther) nearestOther = d;
    }
    if (geo.length !== listed.length || !geo.every((j) => listed.includes(j))) geomBad++;
    for (const j of listed) if (!isNeighbour(j, i)) asym++;
    if (offGrid[i] !== 6 - listed.length) offBad++;
    if (listed.length === 6) six++;
  }
  console.log(`  cells with 6 neighbours: ${six}; nearest non-neighbour: ${fmt(nearestOther, 1)} px`);
  assert(geomBad === 0, 'in-grid neighbours = the cells at distance √3·50 ± 1e-6', `${geomBad} cells differ`);
  assert(dupes === 0, 'no cell lists a neighbour twice');
  assert(asym === 0, 'neighbour links are symmetric', `${asym} one-way links`);
  assert(offBad === 0, 'offGrid = 6 − in-grid count');
  assert(six === 1064, '1,064 cells have 6 neighbours', `got ${six}`);

  const same = (i: number, want: number[]) => nbList(i).join(',') === want.join(',');
  assert(same(at(0, 0), [at(-1, 0), at(1, 0), at(0, -1), at(1, -1), at(-1, 1), at(0, 1)]),
    '(0,0) → (-1,0) (1,0) (0,-1) (1,-1) (-1,1) (0,1)');
  assert(same(at(0, -1), [at(-1, -1), at(1, -1), at(-1, -2), at(0, -2), at(-1, 0), at(0, 0)]),
    '(0,-1) → (-1,-1) (1,-1) (-1,-2) (0,-2) (-1,0) (0,0)');
  assert(same(at(0, 1), [at(-1, 1), at(1, 1), at(0, 0), at(1, 0), at(0, 2), at(1, 2)]),
    '(0,1) → (-1,1) (1,1) (0,0) (1,0) (0,2) (1,2)');
  const corner = nbList(at(-20, -15)).filter((j) => j >= 0).sort((a, b) => a - b);
  const cornerWant = [at(-19, -15), at(-20, -14)].sort((a, b) => a - b);
  assert(corner.join(',') === cornerWant.join(',') && offGrid[at(-20, -15)] === 4,
    'corner (-20,-15) has only (-19,-15) and (-20,-14)');
}

// ---------- Scheduler helpers ----------
// First violated invariant, or null: each token owns its cell (and its target
// while gliding, a neighbour), no cell is claimed twice, no owner without a claim,
// glideSec within [0.6, 1.2] (Float32), shades fixed.
function invariantError(w: HexWander, shade1: number, shade2: number): string | null {
  const claims = new Uint8Array(w.cells);
  let s1 = 0;
  let s2 = 0;
  for (let k = 0; k < w.n; k++) {
    const a = w.cell[k];
    const b = w.target[k];
    if (a < 0 || a >= w.cells) return `token ${k} is on cell ${a}`;
    if (w.owner[a] !== k + 1) return `token ${k} does not own its cell ${a} (owner ${w.owner[a]})`;
    if (++claims[a] > 1) return `cell ${a} claimed twice`;
    if (b >= 0) {
      if (!isNeighbour(a, b)) return `token ${k} glides ${a} → ${b}, not a neighbour`;
      if (w.owner[b] !== k + 1) return `token ${k} does not own its target ${b} (owner ${w.owner[b]})`;
      if (++claims[b] > 1) return `cell ${b} claimed twice`;
    }
    if (!(w.glideSec[k] >= F32_06 && w.glideSec[k] <= F32_12)) return `token ${k} glideSec ${w.glideSec[k]}`;
    if (w.shade[k] === 1) s1++;
    else if (w.shade[k] === 2) s2++;
    else return `token ${k} has shade ${w.shade[k]}`;
  }
  for (let i = 0; i < w.cells; i++) {
    if (w.owner[i] !== 0 && claims[i] === 0) return `orphan owner ${w.owner[i]} on cell ${i}`;
  }
  if (s1 !== shade1 || s2 !== shade2) return `shade split ${s1}/${s2}`;
  return null;
}

const tokX = new Float64Array(HEX_CELLS);
const tokY = new Float64Array(HEX_CELLS);
// Eased token centre, as the Visualizer draws it.
function placeTokens(w: HexWander): void {
  for (let k = 0; k < w.n; k++) {
    const a = w.cell[k];
    const b = w.target[k];
    if (b < 0) {
      tokX[k] = posX[a];
      tokY[k] = posY[a];
    } else {
      const e = easeGlide(w.progress[k]);
      tokX[k] = posX[a] + (posX[b] - posX[a]) * e;
      tokY[k] = posY[a] + (posY[b] - posY[a]) * e;
    }
  }
}

// Minimum distance between eased token centres (sort by x, sweep).
function minTokenDistance(w: HexWander): number {
  placeTokens(w);
  const order = Array.from({ length: w.n }, (_, k) => k).sort((p, q) => tokX[p] - tokX[q]);
  let min = Infinity;
  for (let a = 0; a < order.length; a++) {
    const p = order[a];
    for (let b = a + 1; b < order.length; b++) {
      const q = order[b];
      const dx = tokX[q] - tokX[p];
      if (dx >= min) break;
      const d = Math.hypot(dx, tokY[q] - tokY[p]);
      if (d < min) min = d;
    }
  }
  return min;
}

interface RunStats {
  frames: number;
  moves: number;
  newGlides: number;
  badGlides: number;
  checks: number;
  firstError: string | null;
  minDist: number;
}

// Step `w` for `seconds` at energy(t), checking new glides every frame and the
// invariants plus token spacing every 15 frames.
function runChecked(w: HexWander, seconds: number, energy: (t: number) => number, rand: () => number,
  shade1: number, shade2: number): RunStats {
  const prevTarget = new Int16Array(w.n);
  const stats: RunStats = { frames: 0, moves: 0, newGlides: 0, badGlides: 0, checks: 0, firstError: null, minDist: Infinity };
  const frames = Math.round(seconds / DT);
  const moves0 = w.moves;
  for (let f = 0; f < frames; f++) {
    prevTarget.set(w.target);
    stepHexWander(w, DT, energy(f * DT), false, rand);
    for (let k = 0; k < w.n; k++) {
      if (prevTarget[k] < 0 && w.target[k] >= 0) {
        stats.newGlides++;
        if (!isNeighbour(w.cell[k], w.target[k])) stats.badGlides++;
      }
    }
    if (f % 15 === 0) {
      stats.checks++;
      const err = invariantError(w, shade1, shade2);
      if (err && !stats.firstError) stats.firstError = `frame ${f}: ${err}`;
      const d = minTokenDistance(w);
      if (d < stats.minDist) stats.minDist = d;
    }
  }
  stats.frames = frames;
  stats.moves = w.moves - moves0;
  return stats;
}

const realGrid = () => createHexWander(cellShade, nb, offGrid);

section('3. Scheduler invariants: 342 tokens, 30 fps, 20 min, calm/busy minutes alternating');
{
  const rand = mulberry32(3);
  const w = realGrid();
  resetHexWander(w, rand);
  const err0 = invariantError(w, 183, 159);
  const s = runChecked(w, 20 * 60, (t) => (Math.floor(t / 60) % 2 ? 1 : 0), rand, 183, 159);
  console.log(`  ${s.moves} moves (${fmt(s.moves / (20 * 60), 1)}/s), ${s.checks} invariant checks, min token distance ${fmt(s.minDist, 4)} px`);
  assert(err0 === null, 'reset layout is valid', err0 ?? '');
  assert(s.newGlides === s.moves && s.moves > 0, 'every accepted move starts exactly one glide', `${s.newGlides} glides, ${s.moves} moves`);
  assert(s.badGlides === 0, 'every new glide targets a neighbour', `${s.badGlides} did not`);
  assert(s.firstError === null, 'every 15 frames: tokens own their cells and targets, no double claims, no orphan owners, glideSec in [0.6, 1.2], 183/159 split',
    s.firstError ?? '');
  assert(s.minDist >= 75 - 1e-6, 'min distance between eased token centres ≥ 75 px', `got ${s.minDist}`);
  assert(w.n === 342, 'token count unchanged (342)');
}

// ---------- Single token on an empty grid ----------
function singleToken(): HexWander {
  const shades = new Uint8Array(HEX_CELLS);
  shades[at(0, 0)] = 1;
  return createHexWander(shades, nb, offGrid);
}

section('4. Single-token timing on an empty grid');
{
  const rand = mulberry32(4);
  let restOk = true;
  const restNotes: string[] = [];
  for (const e of [0, 0.5, 1]) {
    for (const D of [1, 3, 4.5]) {
      const w = singleToken();
      resetHexWander(w, rand);
      w.dwell[0] = D;
      let frames = 0;
      while (w.target[0] < 0 && frames < 100000) {
        stepHexWander(w, DT, e, false, rand);
        frames++;
      }
      const t = frames * DT;
      const want = D / (1 + 2 * e);
      if (Math.abs(t - want) > DT + 1e-9) restOk = false;
      restNotes.push(`e=${e} D=${D}: ${fmt(t, 3)} s (want ${fmt(want, 3)})`);
    }
  }
  console.log(`  rests: ${restNotes.join('; ')}`);
  assert(restOk, 'a rest D expires after D/(1+2e) s ± 1 frame for e = 0, 0.5, 1');

  for (const e of [0, 0.5, 1]) {
    const w = singleToken();
    resetHexWander(w, rand);
    const nominal = 1.2 - 0.6 * e;
    let glides = 0;
    let started = -1;
    let sched = 0;
    let sum = 0;
    let schedOk = true;
    let measuredOk = true;
    for (let f = 0; glides < 40 && f < 200000; f++) {
      const wasGliding = w.target[0] >= 0;
      stepHexWander(w, DT, e, false, rand);
      if (!wasGliding && w.target[0] >= 0) {
        started = f;
        sched = w.glideSec[0];
        if (Math.abs(sched - nominal) > 0.1 * nominal + 1e-6) schedOk = false;
      } else if (wasGliding && w.target[0] < 0) {
        const t = (f - started) * DT;
        if (t < sched - 1e-6 || t > sched + DT + 1e-6) measuredOk = false;
        sum += t;
        glides++;
      }
    }
    const mean = sum / Math.max(1, glides);
    console.log(`  e=${e}: ${glides} glides, mean ${fmt(mean, 3)} s (nominal ${fmt(nominal, 2)})`);
    assert(schedOk, `e=${e}: every glideSec within ±10% of ${fmt(nominal, 2)} s`);
    assert(measuredOk, `e=${e}: every glide lands within one frame of its glideSec`);
    assert(Math.abs(mean - nominal) <= 0.1 * nominal, `e=${e}: mean glide ≈ 1.2 − 0.6e ± 10%`, `got ${fmt(mean, 3)}`);
  }

  // Energy 2 must behave exactly like energy 1 (same seed, same decisions).
  const ra = mulberry32(44);
  const rb = mulberry32(44);
  const wa = singleToken();
  const wb = singleToken();
  resetHexWander(wa, ra);
  resetHexWander(wb, rb);
  let same = true;
  for (let f = 0; f < 3600 && same; f++) {
    stepHexWander(wa, DT, 1, false, ra);
    stepHexWander(wb, DT, 2, false, rb);
    same = wa.cell[0] === wb.cell[0] && wa.target[0] === wb.target[0] && wa.progress[0] === wb.progress[0] &&
      wa.dwell[0] === wb.dwell[0] && wa.glideSec[0] === wb.glideSec[0];
  }
  console.log(`  energy 2 vs 1 over 2 min: ${wa.moves} vs ${wb.moves} moves`);
  assert(same && wa.moves > 0, 'energy 2 clamps to 1');

  // Bad inputs can't wedge the scheduler: NaN energy is calm, a NaN dt is no time at all.
  const rc = mulberry32(45);
  const rn = mulberry32(45);
  const wc = singleToken();
  const wn = singleToken();
  resetHexWander(wc, rc);
  resetHexWander(wn, rn);
  let nanSame = true;
  for (let f = 0; f < 3600 && nanSame; f++) {
    stepHexWander(wc, DT, 0, false, rc);
    stepHexWander(wn, DT, NaN, false, rn);
    if (f % 7 === 0) stepHexWander(wn, NaN, NaN, false, rn);
    nanSame = wc.cell[0] === wn.cell[0] && wc.target[0] === wn.target[0] && wc.progress[0] === wn.progress[0] &&
      wc.dwell[0] === wn.dwell[0] && wc.glideSec[0] === wn.glideSec[0];
  }
  assert(nanSame && wc.moves > 0 && wc.moves === wn.moves, 'NaN energy counts as calm and a NaN dt step changes nothing');
}

section('4b. Proposal and Metropolis rule (scripted random numbers)');
{
  // rand() values in the order one due token draws them: neighbour slot, then the
  // Metropolis u (only when ΔE > 0), then the glide jitter or the retry rest.
  const scripted = (values: number[]) => {
    let i = 0;
    return () => (i < values.length ? values[i++] : 0.5);
  };
  const slot = (s: number) => (s + 0.5) / 6;
  // Tokens on `occupied`; only the one on `from` is due. Returns its target after one step.
  const tryMove = (occupied: number[], from: number, s: number, u: number) => {
    const shades = new Uint8Array(HEX_CELLS);
    for (const i of occupied) shades[i] = 1;
    const w = createHexWander(shades, nb, offGrid);
    w.dwell.fill(1e6);
    const k = w.owner[from] - 1;
    w.dwell[k] = 0;
    stepHexWander(w, DT, 0, false, scripted([slot(s), u, 0.5]));
    return w.target[k];
  };
  // (2,0) and (2,-1) touch (1,0) but not (0,0): moving right costs ΔE = 2.
  const pair = [at(0, 0), at(2, 0), at(2, -1)];
  const p2 = Math.exp(-0.5 * 2);
  assert(tryMove(pair, at(0, 0), 1, p2 - 1e-4) === at(1, 0) && tryMove(pair, at(0, 0), 1, p2 + 1e-4) === -1,
    'ΔE = 2 (two other tokens round the target, the mover not counted) is taken iff u < exp(-0.5·2)');
  assert(tryMove(pair, at(0, 0), 0, 0.999) === at(-1, 0), 'ΔE ≤ 0 is always taken');
  assert(tryMove([at(0, 0), at(1, 0)], at(0, 0), 1, 0) === -1, 'an occupied target is rejected');
  assert(tryMove([at(-20, -15)], at(-20, -15), 0, 0) === -1, 'an off-grid target is rejected');
  // Real density (342 tokens) with the mover alone in the top row: stepping from
  // (-19,-15) (2 off-grid neighbours) into the corner (4) costs rho·2.
  const edge = [at(-19, -15)];
  for (let i = 600; edge.length < 342; i++) edge.push(i);
  const pEdge = Math.exp(-0.5 * 2 * (342 / 1200));
  assert(tryMove(edge, at(-19, -15), 0, pEdge - 1e-4) === at(-20, -15) && tryMove(edge, at(-19, -15), 0, pEdge + 1e-4) === -1,
    `an off-grid neighbour counts as rho = 0.285 of a token (corner taken iff u < ${fmt(pEdge, 4)})`);
}

section('5. Dense stress: 90% occupancy, 10 min');
{
  const rand = mulberry32(5);
  const order = Array.from({ length: HEX_CELLS }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  const dense = new Uint8Array(HEX_CELLS);
  let d1 = 0;
  let d2 = 0;
  for (let i = 0; i < 1080; i++) {
    const sh = rand() < 0.5 ? 1 : 2;
    dense[order[i]] = sh;
    if (sh === 1) d1++;
    else d2++;
  }
  const w = createHexWander(dense, nb, offGrid);
  resetHexWander(w, rand);
  const s = runChecked(w, 9 * 60, (t) => (Math.floor(t / 60) % 2 ? 1 : 0), rand, d1, d2);
  const last = runChecked(w, 60, () => 1, rand, d1, d2);
  console.log(`  ${w.n} tokens: ${s.moves + last.moves} moves in 10 min (${fmt((s.moves + last.moves) / 600, 1)}/s), last minute ${last.moves}; min distance ${fmt(Math.min(s.minDist, last.minDist), 4)} px`);
  assert(w.n === 1080, '1,080 tokens (90%)');
  assert(s.firstError === null && last.firstError === null, 'invariants hold', s.firstError ?? last.firstError ?? '');
  assert(s.badGlides === 0 && last.badGlides === 0, 'every new glide targets a neighbour');
  assert(Math.min(s.minDist, last.minDist) >= 75 - 1e-6, 'min token distance ≥ 75 px');
  assert(s.moves > 0 && last.moves > 0, 'moves still happen (including in the last minute)');
}

section('6. Hold: glides finish, nothing moves, release does not burst');
{
  const rand = mulberry32(6);
  const w = realGrid();
  resetHexWander(w, rand);
  for (let f = 0; f < 60 * 30; f++) stepHexWander(w, DT, 0.5, false, rand);
  const m0 = w.moves;
  for (let f = 0; f < 120 * 30; f++) stepHexWander(w, DT, 0.5, false, rand);
  const steady = (w.moves - m0) / 120;

  let gliding = 0;
  for (let k = 0; k < w.n; k++) if (w.target[k] >= 0) gliding++;
  const mHold = w.moves;
  let settleFrames = 0;
  for (;;) {
    let any = false;
    for (let k = 0; k < w.n; k++) if (w.target[k] >= 0) any = true;
    if (!any || settleFrames > 300) break;
    stepHexWander(w, DT, 0.5, true, rand);
    settleFrames++;
  }
  const cells0 = w.cell.slice();
  const owner0 = w.owner.slice();
  let still = true;
  for (let f = 0; f < 100 * 30 && still; f++) {
    stepHexWander(w, DT, 0.5, true, rand);
    for (let k = 0; k < w.n; k++) if (w.cell[k] !== cells0[k] || w.target[k] !== -1) still = false;
    for (let i = 0; i < w.cells; i++) if (w.owner[i] !== owner0[i]) still = false;
  }
  const heldMoves = w.moves - mHold;
  const mRel = w.moves;
  for (let f = 0; f < 30; f++) stepHexWander(w, DT, 0.5, false, rand);
  const firstSecond = w.moves - mRel;
  console.log(`  steady ${fmt(steady, 1)} moves/s at e=0.5; ${gliding} gliding at hold, all landed after ${fmt(settleFrames * DT, 3)} s; ` +
    `moves while held ${heldMoves}; first second after release ${firstSecond}`);
  assert(gliding > 0, 'some glides were in flight when the hold began');
  assert(settleFrames * DT <= 1.2 + DT + 1e-9, 'every in-flight glide finishes within 1.2 s (+1 frame)', `took ${fmt(settleFrames * DT, 3)} s`);
  assert(still && heldMoves === 0, 'assignments identical for 100 s while held, no moves');
  assert(firstSecond <= 2 * steady, 'moves in the first second after release ≤ 2× steady rate (no burst)',
    `${firstSecond} vs steady ${fmt(steady, 1)}/s`);

  // Turning the wander back on (or a grid rebuild) restarts from the original
  // layout, with the first rests staggered so the start doesn't burst either.
  resetHexWander(w, rand);
  const fresh = realGrid();
  let layoutOk = true;
  let levelsOk = true;
  let dMin = Infinity;
  let dMax = -Infinity;
  for (let i = 0; i < w.cells; i++) if (w.owner[i] !== fresh.owner[i]) layoutOk = false;
  for (let k = 0; k < w.n; k++) {
    if (w.cell[k] !== w.home[k] || w.target[k] !== -1 || w.progress[k] !== 0) layoutOk = false;
    if (w.active[k] !== 0 || w.lift[k] !== 0) levelsOk = false;
    dMin = Math.min(dMin, w.dwell[k]);
    dMax = Math.max(dMax, w.dwell[k]);
  }
  const mReset = w.moves;
  for (let f = 0; f < 30; f++) stepHexWander(w, DT, 0.5, false, rand);
  const afterReset = w.moves - mReset;
  console.log(`  reset: first rests ${fmt(dMin, 3)}..${fmt(dMax, 3)} s; first second after reset ${afterReset} moves`);
  assert(layoutOk, 'reset puts every token back on its home cell, resting (original layout, owners rebuilt)');
  assert(levelsOk, 'reset zeroes the draw levels (the Visualizer copies the home cells\' levels in)');
  assert(dMin >= 0 && dMax < 4.5 && dMin < 0.25 && dMax > 4.25, 'reset staggers the first rests over U[0, 4.5)');
  assert(afterReset <= 2 * steady, 'moves in the first second after a reset ≤ 2× steady rate (no start-up burst)',
    `${afterReset} vs steady ${fmt(steady, 1)}/s`);
}

section('7. Distribution over 30 min, typical energy');
{
  const windows: [number, number][] = [[411, 752], [412, 915], [1920, 1080]];
  const visible = (x: number, y: number, ww: number, wh: number) => {
    // The Visualizer's cull: screen = canvas centre + cell offset, one cell size of slack.
    const sx = ww / 2 + x;
    const sy = wh / 2 + y;
    return !(sx < -HEX_SIZE || sx > ww + HEX_SIZE || sy < -HEX_SIZE || sy > wh + HEX_SIZE);
  };
  const visCells = windows.map(([ww, wh]) => {
    let n = 0;
    for (let i = 0; i < HEX_CELLS; i++) if (visible(posX[i], posY[i], ww, wh)) n++;
    return n;
  });
  const staticCounts = windows.map(([ww, wh]) => {
    let n = 0;
    for (let i = 0; i < HEX_CELLS; i++) if (cellShade[i] !== 0 && visible(posX[i], posY[i], ww, wh)) n++;
    return n;
  });

  // Occupied neighbours per resting token: share with ≥ 3, and the mean.
  const clumping = (w: HexWander) => {
    let three = 0;
    let sum = 0;
    for (let k = 0; k < w.n; k++) {
      let occ = 0;
      for (let s = 0; s < 6; s++) {
        const j = nb[w.cell[k] * 6 + s];
        if (j >= 0 && w.owner[j] !== 0 && w.owner[j] !== k + 1) occ++;
      }
      sum += occ;
      if (occ >= 3) three++;
    }
    return { share: three / w.n, mean: sum / w.n };
  };

  const rand = mulberry32(7);
  const w = realGrid();
  resetHexWander(w, rand);
  const today = clumping(w);
  const typical = (t: number) => 0.5 + 0.4 * Math.sin((2 * Math.PI * t) / 150);
  const samples: number[][] = windows.map(() => []);
  const frames = 30 * 60 * 30;
  let eSum = 0;
  for (let f = 0; f < frames; f++) {
    const e = typical(f * DT);
    eSum += e;
    stepHexWander(w, DT, e, false, rand);
    if (f % 3 === 0) {
      placeTokens(w);
      windows.forEach(([ww, wh], wi) => {
        let n = 0;
        for (let k = 0; k < w.n; k++) if (visible(tokX[k], tokY[k], ww, wh)) n++;
        samples[wi].push(n);
      });
    }
  }
  console.log(`  mean energy ${fmt(eSum / frames)}; ${w.moves} moves (${fmt(w.moves / 1800, 1)}/s)`);
  windows.forEach(([ww, wh], wi) => {
    const s = samples[wi].slice().sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const want = 0.285 * visCells[wi];
    const p5 = s[Math.round(0.05 * (s.length - 1))];
    const p95 = s[Math.round(0.95 * (s.length - 1))];
    console.log(`  ${ww}×${wh}: ${visCells[wi]} visible cells, today ${staticCounts[wi]} static; mean ${fmt(mean, 1)} ` +
      `(want ${fmt(want, 1)} ± 10%), p5 ${p5}, p95 ${p95}, min ${s[0]}, max ${s[s.length - 1]}`);
    assert(Math.abs(mean - want) <= 0.1 * want, `${ww}×${wh}: mean tokens on screen within ±10% of 0.285 × visible cells`);
    if (wi < 2) assert(p5 >= 13 && p95 <= 27, `${ww}×${wh}: p5 ≥ 13 and p95 ≤ 27`, `p5 ${p5}, p95 ${p95}`);
  });

  // Let in-flight glides land (hold), then measure the layout.
  for (let f = 0; f < 40; f++) stepHexWander(w, DT, 0.5, true, rand);
  const end = clumping(w);
  console.log(`  ≥3 occupied neighbours: today ${fmt(today.share, 3)} (mean ${fmt(today.mean, 2)}), after 30 min ${fmt(end.share, 3)} (mean ${fmt(end.mean, 2)})`);
  assert(end.share <= 0.26, 'share of tokens with ≥ 3 occupied neighbours ≤ 0.26 at the end', `got ${fmt(end.share, 3)}`);
  assert(end.mean <= 1.6, 'mean occupied neighbours ≤ 1.60 at the end', `got ${fmt(end.mean, 2)}`);

  // Real pace: seconds between moves per token, including rejections and the glide itself.
  const pace = (e: number, seed: number) => {
    const r = mulberry32(seed);
    const pw = realGrid();
    resetHexWander(pw, r);
    for (let f = 0; f < 60 * 30; f++) stepHexWander(pw, DT, e, false, r);
    const m = pw.moves;
    for (let f = 0; f < 600 * 30; f++) stepHexWander(pw, DT, e, false, r);
    return (pw.n * 600) / (pw.moves - m);
  };
  const calm = pace(0, 71);
  const busy = pace(1, 72);
  console.log(`  real pace per token: calm ${fmt(calm)} s, busy (e = 1) ${fmt(busy)} s`);
  assert(calm >= 5 && calm <= 6, 'calm interval per token ≈ 5–6 s', `got ${fmt(calm)}`);
  assert(busy >= 2 && busy <= 3, 'busy interval per token ≈ 2–3 s', `got ${fmt(busy)}`);
}

section('8. Cover and easing');
{
  let mono = true;
  let prev = easeGlide(0);
  for (let i = 1; i <= 1000; i++) {
    const v = easeGlide(i / 1000);
    if (v < prev) mono = false;
    prev = v;
  }
  assert(easeGlide(0) === 0 && easeGlide(1) === 1, 'easeGlide(0) = 0, easeGlide(1) = 1');
  assert(mono, 'easeGlide is monotonic on [0, 1]');

  const rand = mulberry32(8);
  const w = singleToken();
  resetHexWander(w, rand);
  const home = w.cell[0];
  assert(hexWanderCover(w, 0, home) === 1, 'cover is 1 on its cell while resting');
  w.dwell[0] = 0;
  stepHexWander(w, DT, 0, false, rand);
  const from = w.cell[0];
  const to = w.target[0];
  assert(to >= 0 && from === home, 'a due token on an empty grid starts gliding');
  assert(hexWanderCover(w, 0, from) === 1 && hexWanderCover(w, 0, to) === 0, 'at p = 0: left cell 1, entered cell 0');
  let sumOk = true;
  let otherOk = true;
  for (let i = 0; i < 1000; i++) {
    w.progress[0] = i / 1000;
    if (Math.abs(hexWanderCover(w, 0, from) + hexWanderCover(w, 0, to) - 1) > 1e-12) sumOk = false;
    if (hexWanderCover(w, 0, at(5, 5)) !== 0) otherOk = false;
  }
  w.progress[0] = Math.fround(0.9999);
  const leftEnd = hexWanderCover(w, 0, from);
  const enteredEnd = hexWanderCover(w, 0, to);
  console.log(`  at p = 0.9999: left ${leftEnd.toExponential(2)}, entered ${fmt(enteredEnd, 8)}`);
  assert(leftEnd < 1e-6 && enteredEnd > 1 - 1e-6, 'as p → 1: left cell → 0, entered cell → 1');
  assert(sumOk, 'the two covers sum to 1 throughout a glide');
  assert(otherOk, 'cover is 0 on any other cell');
  w.progress[0] = 0.5;
  for (let f = 0; f < 60 && w.target[0] >= 0; f++) stepHexWander(w, DT, 0, false, rand);
  assert(w.cell[0] === to && hexWanderCover(w, 0, to) === 1, 'after landing the token rests on the entered cell with cover 1');
}

section('9. Pace energy from onset flux');
{
  const ENV_FPS = 20;
  // A band envelope as the library scan stores it (App.tsx analyzeBandEnvelopes):
  // the RMS of the band's amplitude over each 50 ms hop, normalised to the
  // loudest hop, as Uint8 at 20 fps. `shimmer` wobbles each hop's RMS by ±1%.
  const envelope = (seconds: number, amp: (t: number) => number, shimmer?: () => number) => {
    const n = Math.ceil(seconds * ENV_FPS) + 1;
    const rms = new Float64Array(n);
    const SUB = 50; // amplitude points per hop (1 kHz)
    let max = 0;
    for (let k = 0; k < n; k++) {
      let sum = 0;
      for (let j = 0; j < SUB; j++) {
        const a = amp((k + j / SUB) / ENV_FPS);
        sum += a * a;
      }
      rms[k] = Math.sqrt(sum / SUB) * (shimmer ? 1 + 0.01 * (shimmer() * 2 - 1) : 1);
      if (rms[k] > max) max = rms[k];
    }
    const u = new Uint8Array(n);
    for (let k = 0; k < n; k++) u[k] = Math.min(255, Math.round((rms[k] / max) * 255));
    return u;
  };
  // The Visualizer's sampler: linear interpolation at the playback position.
  const sample = (a: Uint8Array, t: number) => {
    const pos = t * ENV_FPS;
    const i0 = Math.max(0, Math.min(a.length - 1, Math.floor(pos)));
    const i1 = Math.min(a.length - 1, i0 + 1);
    const frac = pos - Math.floor(pos);
    return (a[i0] + (a[i1] - a[i0]) * frac) / 255;
  };
  // Play `seconds` at `dt` per rendered frame. The Visualizer's own band energies
  // get Audio Reactivity and the clamp; the wander is handed the raw samples.
  const play = (w: HexWander, bass: Uint8Array, mid: Uint8Array, seconds: number, dt = DT, sens = 1) => {
    const frames = Math.round(seconds / dt);
    const trace: number[] = [];
    let visualBass = 0;
    for (let f = 0; f < frames; f++) {
      const t = f * dt;
      const rb = sample(bass, t);
      const rm = sample(mid, t);
      visualBass = Math.min(1, rb * sens * 1.2);
      trace.push(smoothWanderEnergy(w, rb, rm, true, dt));
    }
    return { trace, visualBass };
  };
  const tail = (trace: number[], seconds: number, dt = DT) => trace.slice(trace.length - Math.round(seconds / dt));
  const minOf = (a: number[]) => a.reduce((m, v) => Math.min(m, v), Infinity);
  const maxOf = (a: number[]) => a.reduce((m, v) => Math.max(m, v), -Infinity);
  const meanOf = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

  const flat255 = new Uint8Array(241).fill(255);
  const flat77 = new Uint8Array(241).fill(77);
  const c255 = play(realGrid(), flat255, flat255, 10).trace;
  const c77 = play(realGrid(), flat77, flat255, 10).trace;
  console.log(`  constant envelope: e = ${fmt(c255[c255.length - 1], 4)} (255), ${fmt(c77[c77.length - 1], 4)} (77) after 10 s`);
  assert(c255[c255.length - 1] < 0.1 && c77[c77.length - 1] < 0.1, 'constant envelope (any level) → e < 0.1 after 10 s');

  // 128 BPM: each kick takes the bass hop to (about) its peak and decays over
  // ~200 ms (hops 1.0, 0.43, 0.19, 0.08 when aligned); the mid is a steady bed
  // with light kick bleed.
  const beat = 60 / 128;
  const kickShape = (t: number) => Math.exp(-(t % beat) / 0.06);
  const kickBass = envelope(32, (t) => 0.04 + 0.96 * kickShape(t));
  const kickMid = envelope(32, (t) => 0.3 + 0.1 * kickShape(t));
  const kick = play(realGrid(), kickBass, kickMid, 30);
  const kickTail = tail(kick.trace, 10);
  console.log(`  128-BPM kick: e min ${fmt(minOf(kickTail), 3)}, mean ${fmt(meanOf(kickTail), 3)} over the last 10 s ` +
    `(bass hops after one kick: ${Array.from(kickBass.slice(0, 6)).join(', ')})`);
  assert(minOf(kickTail) > 0.7, '128-BPM kick envelope → e > 0.7 (minimum over the last 10 s)');

  const bySens = [0.5, 1, 2, 3].map((sens) => play(realGrid(), kickBass, kickMid, 30, DT, sens));
  const identical = bySens.every((r) => r.trace.length === kick.trace.length && r.trace.every((v, i) => v === kick.trace[i]));
  // Informational: the module never sees sensitivity, so these always match.
  // What keeps the pace independent of Audio Reactivity is the Visualizer
  // handing over the RAW samples, which the assertion below pins.
  console.log(`  sensitivity 0.5/1/2/3: the visual bass ends at ${bySens.map((r) => fmt(r.visualBass)).join('/')}, e identical: ${identical}`);
  const viz = readFileSync(new URL('../components/Visualizer.tsx', import.meta.url), 'utf8');
  assert(/rawBass = sample\(env\.bass\);/.test(viz) && /rawMid\s*= sample\(env\.mid\);/.test(viz) &&
    viz.includes('smoothWanderEnergy(hw, rawBass, rawMid, envDriven, dt)'),
    'Visualizer hands the wander the raw envelope samples (before Audio Reactivity and the clamp)');
  // The pace targets above assume real seconds. The frame limiter's stepScale
  // re-counts its carried remainder (~1.25× wall clock at 60 Hz), so the
  // Visualizer must time the wander from the last rendered frame instead.
  assert(viz.includes('frameDtSec = lastRenderTs ? (timestamp - lastRenderTs) / 1000 : 0;'),
    'Visualizer times the wander in real seconds between rendered frames');

  // A steady pad: slow swells, plus a ±1% shimmer in each hop's RMS.
  const prand = mulberry32(9);
  const padBass = envelope(62, (t) => 0.6 + 0.25 * Math.sin((2 * Math.PI * t) / 7), prand);
  const padMid = envelope(62, (t) => 0.7 + 0.2 * Math.sin((2 * Math.PI * t) / 5 + 1), prand);
  const pad = play(realGrid(), padBass, padMid, 60);
  const padTail = tail(pad.trace, 50);
  console.log(`  steady pad: e max ${fmt(maxOf(padTail), 3)}, mean ${fmt(meanOf(padTail), 3)} over the last 50 s`);
  assert(maxOf(padTail) < 0.3, 'steady pad with slow swells → e < 0.3');

  // !envDriven (paused, unscanned): decays toward 0 and forgets the previous sample.
  const w = realGrid();
  play(w, kickBass, kickMid, 10);
  const before = w.energy;
  let decays = true;
  let last = before;
  for (let f = 0; f < 300; f++) {
    const e = smoothWanderEnergy(w, 0, 0, false, DT);
    if (e > last) decays = false;
    last = e;
  }
  console.log(`  !envDriven: e ${fmt(before, 3)} → ${last.toExponential(2)} after 10 s`);
  assert(decays && last < 0.05, '!envDriven decays toward 0');
  const eResume = smoothWanderEnergy(w, 1, 1, true, DT);
  assert(eResume <= last, 'the first real sample after !envDriven is not a rise from 0', `${eResume} > ${last}`);

  // A NaN sample (e.g. a NaN playback position) adds nothing and does not stick.
  const nw = realGrid();
  play(nw, kickBass, kickMid, 5);
  smoothWanderEnergy(nw, NaN, NaN, true, DT);
  smoothWanderEnergy(nw, NaN, 0.5, true, DT);
  const afterNaN = play(nw, kickBass, kickMid, 10).trace;
  assert(Number.isFinite(nw.flux) && minOf(tail(afterNaN, 5)) > 0.7, 'a NaN envelope sample adds nothing and does not stick');

  // Turning the wander back on restarts the pace from calm (nothing was sampled while it was off).
  const rw = realGrid();
  play(rw, kickBass, kickMid, 10);
  const eOn = rw.energy;
  resetHexWander(rw, mulberry32(90));
  const eReset = smoothWanderEnergy(rw, 1, 1, true, DT);
  assert(eOn > 0.7 && eReset === 0, 'reset restarts the pace from calm, and its first sample is not a rise', `e ${eOn} → ${eReset}`);

  const fluxBefore = w.flux;
  const eBefore = w.energy;
  const prevB = w.fluxPrevBass;
  const e0 = smoothWanderEnergy(w, 0, 0, true, 0);
  const e1 = smoothWanderEnergy(w, 0, 0, false, 0);
  assert(e0 === eBefore && e1 === eBefore && w.flux === fluxBefore && w.fluxPrevBass === prevB, 'dt = 0 leaves it unchanged');

  // A seek: the envelope jumps 0 → 1 in one frame and stays there.
  const sw = realGrid();
  for (let f = 0; f < 90; f++) smoothWanderEnergy(sw, 0, 0, true, DT);
  let seekMax = 0;
  for (let f = 0; f < 150; f++) seekMax = Math.max(seekMax, smoothWanderEnergy(sw, 1, 1, true, DT));
  const sw24 = realGrid();
  for (let f = 0; f < 72; f++) smoothWanderEnergy(sw24, 0, 0, true, 1 / 24);
  let seekMax24 = 0;
  for (let f = 0; f < 120; f++) seekMax24 = Math.max(seekMax24, smoothWanderEnergy(sw24, 1, 1, true, 1 / 24));
  console.log(`  seek 0 → 1: e peaks at ${fmt(seekMax, 3)} (30 fps), ${fmt(seekMax24, 3)} (24 fps)`);
  assert(seekMax <= 0.6 && seekMax24 <= 0.6, 'a seek-like jump alone cannot push e above 0.6');

  // Frame-rate independence of the smoothing: the same decay at 24, 30 and 60 fps
  // (1.5 s is a whole number of frames at each).
  const decayAt = (fps: number) => {
    const dw = realGrid();
    dw.flux = 2;
    let e = 1;
    for (let f = 0; f < Math.round(1.5 * fps); f++) e = smoothWanderEnergy(dw, 0, 0, false, 1 / fps);
    return e;
  };
  const d24 = decayAt(24);
  const d30 = decayAt(30);
  const d60 = decayAt(60);
  console.log(`  decay from e = 1 over 1.5 s: ${fmt(d24, 6)} (24 fps), ${fmt(d30, 6)} (30), ${fmt(d60, 6)} (60); exp(-1) = ${fmt(Math.exp(-1), 6)}`);
  assert(Math.abs(d24 - Math.exp(-1)) < 1e-9 && Math.abs(d30 - d24) < 1e-9 && Math.abs(d60 - d24) < 1e-9,
    'smoothing is frame-rate independent (τ = 1.5 s at 24/30/60 fps)');
  // rise/dt is a rate: a steady 0.1/s climb must read the same flux at 24, 30 and 60 fps.
  const rampFlux = (fps: number) => {
    const rw = realGrid();
    for (let f = 0; f <= 9 * fps; f++) smoothWanderEnergy(rw, f / fps / 10, 0, true, 1 / fps);
    return rw.flux;
  };
  const r24 = rampFlux(24);
  const r30 = rampFlux(30);
  const r60 = rampFlux(60);
  console.log(`  0.1/s ramp: flux ${fmt(r24, 5)} (24 fps), ${fmt(r30, 5)} (30), ${fmt(r60, 5)} (60)`);
  assert(Math.abs(r24 - r30) < 1e-3 && Math.abs(r60 - r30) < 1e-3 && Math.abs(r30 - 0.1) < 2e-3,
    'rises become a per-second rate (same flux at 24/30/60 fps)');
  const kick20 = play(realGrid(), kickBass, kickMid, 30, 1 / 20);
  console.log(`  128-BPM kick at 20 fps (Cooler): e min ${fmt(minOf(tail(kick20.trace, 10, 1 / 20)), 3)} over the last 10 s`);
}

section('10. Corner tables are bit-identical to the inline Math.cos/Math.sin');
{
  const rand = mulberry32(10);
  let same = true;
  let checked = 0;
  for (let n = 0; n < 1000; n++) {
    const x = (rand() - 0.5) * 4000;
    const y = (rand() - 0.5) * 4000;
    const liftLevel = rand() * 3;
    const liftScale = 1 + (liftLevel * 0.28);
    const drawSize = 50 * 0.95 * liftScale;
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      if (hexCornerX(x, drawSize, i) !== x + drawSize * Math.cos(angle)) same = false;
      if (hexCornerY(y, drawSize, i) !== y + drawSize * Math.sin(angle)) same = false;
      if (hexCornerX(x, drawSize, i) !== x + drawSize * Math.cos((Math.PI / 3) * i)) same = false;
      checked++;
    }
  }
  console.log(`  ${checked} corners compared`);
  assert(same, 'hexCornerX/Y === x + drawSize * Math.cos/sin((Math.PI / 3) * i)');
}

section('11. Cost (informational)');
{
  const rand = mulberry32(11);
  const w = realGrid();
  resetHexWander(w, rand);
  for (let f = 0; f < 600; f++) stepHexWander(w, DT, 0.5, false, rand);
  const steps = 30000;
  const t0 = performance.now();
  for (let f = 0; f < steps; f++) stepHexWander(w, DT, 0.5, false, rand);
  const us = ((performance.now() - t0) * 1000) / steps;
  let bytes = nb.byteLength + offGrid.byteLength;
  for (const v of Object.values(w)) if (ArrayBuffer.isView(v) && v !== nb && v !== offGrid) bytes += v.byteLength;
  console.log(`  ${fmt(us, 2)} µs per step for ${w.n} tokens (e = 0.5); state ${fmt(bytes / 1000, 1)} KB with the neighbour table`);
}

// ---------- Summary ----------
console.log(`\n=========================`);
console.log(`Passed: ${passes}`);
console.log(`Failed: ${failures}`);
console.log(`=========================`);
process.exit(failures > 0 ? 1 : 0);
