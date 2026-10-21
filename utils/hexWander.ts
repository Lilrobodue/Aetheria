// utils/hexWander.ts
//
// Wandering hexagons. The grid never moves; its off-colour cells (183 shade1 +
// 159 shade2 today) become "tokens" that glide to a neighbouring cell every few
// seconds, faster when the music is busy. No two tokens are ever on, or heading
// to, the same cell.
//
// The lattice constants and formulas are MOVED here verbatim from the
// Visualizer's grid build, so positions and the golden-ratio layout stay
// bit-identical. The corner tables give the same doubles as the inline
// Math.cos/Math.sin calls they replace (12 trig calls per drawn hexagon).
//
// All state is typed arrays allocated once per grid build (~42 KB); nothing
// here allocates per frame, because per-frame garbage is what made the 30 fps
// loop stutter before (see the Visualizer's dataArray and hex-cull comments).
//
// Pure, no imports, erasable TypeScript only (no enums, namespaces or parameter
// properties), so Node runs hexWander.smoke.ts directly with type stripping.
// Type imports of this module must use `import type`, or strip mode fails at
// run time.

export const HEX_SIZE = 50; // Larger cells = fewer to render
export const HEX_COLS = 20; // c runs over [-20, 20)
export const HEX_ROWS = 15; // r runs over [-15, 15)
export const HEX_CELLS = (2 * HEX_COLS) * (2 * HEX_ROWS); // 1,200

// The Visualizer's PHI, bit for bit, so goldenShade picks the same cells.
export const PHI = (1 + Math.sqrt(5)) / 2;

/** Cell centre x. JS `%` keeps the sign: odd NEGATIVE rows shift left, odd
 *  positive rows shift right. */
export function hexX(c: number, r: number, xOffset: number): number {
  return (c * xOffset) + ((r % 2) * xOffset / 2);
}

export function hexY(r: number, yOffset: number): number {
  return r * yOffset;
}

/** Golden-ratio colour type: 0 primary, 1 shade1, 2 shade2. `index` is the
 *  cell's build-order index (hexIndex). */
export function goldenShade(c: number, r: number, index: number): 0 | 1 | 2 {
  const mathType = (Math.abs((c * r * PHI) + index) * PHI) % 1;
  if (mathType > 0.69) return mathType > 0.85 ? 2 : 1;
  return 0;
}

/** Build-order index of (c, r) (rows outer, columns inner), or -1 off the grid. */
export function hexIndex(c: number, r: number): number {
  if (c < -HEX_COLS || c >= HEX_COLS || r < -HEX_ROWS || r >= HEX_ROWS) return -1;
  return (r + HEX_ROWS) * (2 * HEX_COLS) + (c + HEX_COLS);
}

export interface HexNeighbours {
  /** 6 slots per cell: (c-1, r), (c+1, r), then the left and right neighbour in
   *  row r-1, then in row r+1. -1 = off the grid. */
  nb: Int16Array;
  /** Off-grid neighbours per cell (0 inside, up to 4 in a corner). */
  offGrid: Uint8Array;
}

export function buildNeighbourTable(): HexNeighbours {
  const nb = new Int16Array(HEX_CELLS * 6);
  const offGrid = new Uint8Array(HEX_CELLS);
  for (let r = -HEX_ROWS; r < HEX_ROWS; r++) {
    for (let c = -HEX_COLS; c < HEX_COLS; c++) {
      const i = hexIndex(c, r);
      const base = i * 6;
      nb[base] = hexIndex(c - 1, r);
      nb[base + 1] = hexIndex(c + 1, r);
      for (let side = 0; side < 2; side++) {
        const rr = side === 0 ? r - 1 : r + 1;
        // Exactly one of r and rr is odd, so d is ±1 for either sign of row. A
        // plain "odd rows shift right" rule is wrong for every row r <= 0.
        const d = (r % 2) - (rr % 2);
        nb[base + 2 + 2 * side] = hexIndex(c + (d - 1) / 2, rr);
        nb[base + 3 + 2 * side] = hexIndex(c + (d + 1) / 2, rr);
      }
      let missing = 0;
      for (let s = 0; s < 6; s++) if (nb[base + s] < 0) missing++;
      offGrid[i] = missing;
    }
  }
  return { nb, offGrid };
}

// Unit corners at (Math.PI / 3) * i. Float64, not Float32: these are the exact
// doubles the old inline calls returned, so a corner drawn from the table is
// === the old one.
export const HEX_UNIT_COS = new Float64Array(6);
export const HEX_UNIT_SIN = new Float64Array(6);
for (let i = 0; i < 6; i++) {
  HEX_UNIT_COS[i] = Math.cos((Math.PI / 3) * i);
  HEX_UNIT_SIN[i] = Math.sin((Math.PI / 3) * i);
}

export function hexCornerX(x: number, drawSize: number, i: number): number {
  return x + drawSize * HEX_UNIT_COS[i];
}

export function hexCornerY(y: number, drawSize: number, i: number): number {
  return y + drawSize * HEX_UNIT_SIN[i];
}

// --- Scheduler tuning (the smoke check's expectations are derived from these) ---
// Rests are in "calm-seconds": they drain at (1 + PACE_GAIN * energy) per second.
const FIRST_REST_MAX = 4.5; // reset staggers the first rests over U[0, 4.5)
const REST_MIN = 3;         // rest after each glide, U[3, 4.5]: a move every ~5.8 s when calm,
const REST_MAX = 4.5;       // counting rejected proposals and the glide itself
const RETRY_MIN = 0.5;      // after a rejected proposal, U[0.5, 1.5]
const RETRY_MAX = 1.5;
const PACE_GAIN = 2;        // full energy drains rests 3× faster: a move every ~2.2 s
const GLIDE_CALM = 1.2;     // glide seconds at energy 0 ...
const GLIDE_BUSY = 0.6;     // ... and at energy 1, then ±10% and clamped to this range
const GLIDE_JITTER = 0.1;
const CROWDING = 0.5;       // Metropolis strength against clumps

// --- Pace energy: onset flux of the band envelope, not its level ---
// Each band is normalised to its own peak and steady material sits near it, so
// level would make a drone the "busiest" track. Positive change per second
// (rises only) orders drone < piano < dance.
const RISE_MAX = 0.6;  // per-frame cap: a seek jumps the envelope and must not read as a burst
const FLUX_TAU = 1.5;  // seconds
const FLUX_FULL = 2.0; // flux (rise per second) that counts as full energy

export interface HexWander {
  /** Tokens (shade cells at build time): 342 today. */
  n: number;
  cells: number;
  nb: Int16Array;
  offGrid: Uint8Array;
  /** Token density n / cells: the crowd an off-grid neighbour stands for. */
  rho: number;
  // Per token k.
  /** Cell the token sits on, or is leaving while it glides. */
  cell: Int16Array;
  /** Cell it is gliding to, -1 while resting. */
  target: Int16Array;
  /** 0..1 along the glide (linear; draw with easeGlide). */
  progress: Float32Array;
  glideSec: Float32Array;
  /** Calm-seconds left before the next proposal. */
  dwell: Float32Array;
  /** 1 or 2, fixed for life, so the shade1/shade2 split never changes. */
  shade: Uint8Array;
  home: Int16Array;
  /** The token's own smoothed draw levels (the Visualizer's activeLevel/liftLevel). */
  active: Float32Array;
  lift: Float32Array;
  // Per cell.
  /** 0 = free, else k + 1. A gliding token owns BOTH its cells. */
  owner: Int16Array;
  /** This frame's mode level (before jitter) and wave lift, valid where cellStamp === frame. */
  cellRawActive: Float32Array;
  cellRawLift: Float32Array;
  cellStamp: Int32Array;
  /** False until the Visualizer has reset the tokens and copied their levels in. */
  live: boolean;
  /** Rendered-frame counter, advanced by the Visualizer; never reset, so old stamps can't match. */
  frame: number;
  /** Accepted moves so far (the perf HUD shows the per-second delta). */
  moves: number;
  /** Smoothed pace energy 0..1, as last returned by smoothWanderEnergy. */
  energy: number;
  /** Previous raw envelope samples; -1 = none (the next sample is not a rise). */
  fluxPrevBass: number;
  fluxPrevMid: number;
  flux: number;
}

/**
 * One wander state for a grid. `cellShade` holds goldenShade per cell in build
 * order; each non-zero cell becomes a token whose home is that cell. Tokens
 * start at home, resting, with no rest scheduled: call resetHexWander before the
 * first step. `live` starts false.
 */
export function createHexWander(cellShade: Uint8Array, nb: Int16Array, offGrid: Uint8Array): HexWander {
  const cells = cellShade.length;
  let n = 0;
  for (let i = 0; i < cells; i++) if (cellShade[i] !== 0) n++;
  const w: HexWander = {
    n,
    cells,
    nb,
    offGrid,
    rho: n / cells,
    cell: new Int16Array(n),
    target: new Int16Array(n),
    progress: new Float32Array(n),
    glideSec: new Float32Array(n),
    dwell: new Float32Array(n),
    shade: new Uint8Array(n),
    home: new Int16Array(n),
    active: new Float32Array(n),
    lift: new Float32Array(n),
    owner: new Int16Array(cells),
    cellRawActive: new Float32Array(cells),
    cellRawLift: new Float32Array(cells),
    cellStamp: new Int32Array(cells).fill(-1),
    live: false,
    frame: 0,
    moves: 0,
    energy: 0,
    fluxPrevBass: -1,
    fluxPrevMid: -1,
    flux: 0,
  };
  let k = 0;
  for (let i = 0; i < cells; i++) {
    if (cellShade[i] === 0) continue;
    w.home[k] = i;
    w.shade[k] = cellShade[i];
    w.cell[k] = i;
    w.owner[i] = k + 1;
    k++;
  }
  w.target.fill(-1);
  w.glideSec.fill(GLIDE_CALM);
  return w;
}

/**
 * Every token back to its home cell, resting, with its first rest staggered over
 * U[0, 4.5) and its draw levels at 0 (the Visualizer copies the home cells'
 * levels in for a seamless OFF→ON). The pace restarts from calm, because the
 * envelope wasn't sampled while the wander was off.
 */
export function resetHexWander(w: HexWander, rand: () => number): void {
  w.owner.fill(0);
  for (let k = 0; k < w.n; k++) {
    const home = w.home[k];
    w.cell[k] = home;
    w.target[k] = -1;
    w.progress[k] = 0;
    w.dwell[k] = rand() * FIRST_REST_MAX;
    w.active[k] = 0;
    w.lift[k] = 0;
    w.owner[home] = k + 1;
  }
  w.fluxPrevBass = -1;
  w.fluxPrevMid = -1;
  w.flux = 0;
  w.energy = 0;
}

// Other tokens' cells around `cell`, plus rho per off-grid neighbour so the
// grid edge reads as averagely crowded instead of attracting tokens.
function crowd(w: HexWander, cell: number, self: number): number {
  const nb = w.nb;
  const owner = w.owner;
  const base = cell * 6;
  let count = 0;
  for (let s = 0; s < 6; s++) {
    const j = nb[base + s];
    if (j >= 0) {
      const o = owner[j];
      if (o !== 0 && o !== self) count++;
    }
  }
  return count + w.rho * w.offGrid[cell];
}

/**
 * Advance every token by one rendered frame. `dtSec` is the frame's time step
 * (the caller caps it; nothing is capped here), `energy01` the pace (clamped to
 * 0..1). `hold` (reduced motion, or the music paused) freezes the rests and
 * starts no moves; glides already under way still finish.
 */
export function stepHexWander(w: HexWander, dtSec: number, energy01: number, hold: boolean, rand: () => number): void {
  const dt = dtSec > 0 ? dtSec : 0;
  const e = energy01 > 0 ? (energy01 < 1 ? energy01 : 1) : 0; // NaN → calm
  const drain = dt * (1 + PACE_GAIN * e);
  const glideBase = GLIDE_CALM - (GLIDE_CALM - GLIDE_BUSY) * e;
  const nb = w.nb;
  const owner = w.owner;
  const cell = w.cell;
  const target = w.target;
  const progress = w.progress;
  const glideSec = w.glideSec;
  const dwell = w.dwell;
  for (let k = 0; k < w.n; k++) {
    const heading = target[k];
    if (heading >= 0) {
      // Glides always finish, even while held, so a hold never strands a token between cells.
      const p = progress[k] + dt / glideSec[k];
      if (p < 1) {
        progress[k] = p;
        continue;
      }
      owner[cell[k]] = 0;
      cell[k] = heading;
      target[k] = -1;
      progress[k] = 0;
      dwell[k] = REST_MIN + (REST_MAX - REST_MIN) * rand();
      continue;
    }
    // Held rests don't count down either, so a release can't fire every overdue token at once.
    if (hold) continue;
    const left = dwell[k] - drain;
    if (left > 0) {
      dwell[k] = left;
      continue;
    }
    // Each of the 6 directions equally likely: a symmetric proposal keeps the density uniform.
    const from = cell[k];
    let dir = (rand() * 6) | 0;
    if (dir > 5) dir = 5;
    const to = nb[from * 6 + dir];
    // Off the grid, or another token is on it or heading there.
    if (to < 0 || owner[to] !== 0) {
      dwell[k] = RETRY_MIN + (RETRY_MAX - RETRY_MIN) * rand();
      continue;
    }
    // Metropolis: moves into a crowd are taken only sometimes, so clumps dissolve.
    const self = k + 1;
    const dE = crowd(w, to, self) - crowd(w, from, self);
    if (dE > 0 && rand() >= Math.exp(-CROWDING * dE)) {
      dwell[k] = RETRY_MIN + (RETRY_MAX - RETRY_MIN) * rand();
      continue;
    }
    owner[to] = self;
    target[k] = to;
    progress[k] = 0;
    const g = glideBase * (1 - GLIDE_JITTER + 2 * GLIDE_JITTER * rand());
    glideSec[k] = g < GLIDE_BUSY ? GLIDE_BUSY : g > GLIDE_CALM ? GLIDE_CALM : g;
    w.moves++;
  }
}

/** Smoothstep: eases a glide in and out. */
export function easeGlide(p: number): number {
  return p * p * (3 - 2 * p);
}

/**
 * How much of `cell` token k covers, 0..1: 1 on its cell while resting; while
 * gliding, 1 − e on the cell it is leaving and e on the cell it is entering
 * (e = eased progress), so the two always sum to 1. 0 for any other cell.
 */
export function hexWanderCover(w: HexWander, k: number, cell: number): number {
  const heading = w.target[k];
  if (heading < 0) return cell === w.cell[k] ? 1 : 0;
  const e = easeGlide(w.progress[k]);
  if (cell === heading) return e;
  return cell === w.cell[k] ? 1 - e : 0;
}

/**
 * Pace energy from the band envelope's onset flux. `rawBass`/`rawMid` are the
 * interpolated envelope samples in 0..1 BEFORE Audio Reactivity and the min(1)
 * clamp, so the pace never depends on sensitivity. `envDriven` false (paused,
 * unscanned track) decays toward 0 and forgets the previous samples. Frame-rate
 * independent; dt = 0 (the first direct render) leaves everything unchanged.
 * Returns e in 0..1, also stored in w.energy.
 */
export function smoothWanderEnergy(w: HexWander, rawBass: number, rawMid: number, envDriven: boolean, dtSec: number): number {
  if (!(dtSec > 0)) return w.energy;
  let risePerSec = 0;
  if (envDriven) {
    if (w.fluxPrevBass >= 0) {
      // Comparisons, not Math.max, so a NaN sample adds nothing instead of poisoning the average.
      let rise = 0;
      const db = rawBass - w.fluxPrevBass;
      if (db > 0) rise += db;
      const dm = rawMid - w.fluxPrevMid;
      if (dm > 0) rise += dm;
      if (rise > RISE_MAX) rise = RISE_MAX;
      risePerSec = rise / dtSec;
    }
    w.fluxPrevBass = rawBass;
    w.fluxPrevMid = rawMid;
  } else {
    w.fluxPrevBass = -1;
    w.fluxPrevMid = -1;
  }
  w.flux += (1 - Math.exp(-dtSec / FLUX_TAU)) * (risePerSec - w.flux);
  const e = w.flux / FLUX_FULL;
  w.energy = e > 1 ? 1 : e > 0 ? e : 0;
  return w.energy;
}
