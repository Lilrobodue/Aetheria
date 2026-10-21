// utils/hexSpectrum.ts
//
// The Spectrum hex mode ("Spectral Lens"), rebuilt on the pre-scanned band
// envelope (the live FFT it used to read is never filled: music plays straight
// to the OS for a reliable lock screen).
//
// The grid becomes a mirrored hex equalizer. Every lattice column is a pillar;
// the centre pillar is the bass, the screen's outermost visible pillar the
// treble, and each pillar grows up AND down from the centre row, the same on
// both sides. Only the cells at each bar's TIP light (one bright cell, its
// neighbours sharing the light as the tip moves), and a small cap rides just
// beyond every tip: kicked out with the bar, it hangs, then falls back under
// gravity. The Visualizer threads a glowing line through the caps, so the whole
// spectrum reads as one breathing lens around the sacred geometry.
//
// Why tips, not filled bars: the lit area stays about constant while the music
// moves it, so a kick moves light instead of flashing more of it, and every
// hexagon drawn is heat (CPU, GPU and OLED light).
//
// Quiet looks quiet: each band is read against its own slow floor (a 5 s mean,
// seeded with the whole track's mean) and scaled by how busy the music is
// (onset flux), so a steady pad opens the lens a little and breathes, while
// kicks and syllables pump it.
//
// State is per PILLAR (mirrored bars are identical by construction); a bar is
// just where a cap sits. Pure, no DOM, erasable TypeScript only, so Node runs
// hexSpectrum.smoke.ts directly. Every array is allocated once in
// createHexSpectrum; nothing allocates per frame.

import { HEX_SIZE, HEX_COLS, HEX_ROWS, HEX_CELLS, hexX, hexY } from './hexWander.ts';

const X_OFFSET = Math.sqrt(3) * HEX_SIZE; // 86.6: column pitch
const Y_OFFSET = HEX_SIZE * 1.5;          // 75: row pitch, one bar "step"
const HALF_COL = X_OFFSET / 2;            // 43.3: odd rows sit half a column over

// --- Drive (quiet looks quiet) ---
const FLOOR_TAU = 5.0;   // s: each band's slow floor (its recent mean level)
const BETA = 0.45;       // share of the floor taken off the band
const GAIN = 1.35;       // drive gain after the floor
const FLUX_TAU = 1.5;    // s: onset-flux smoothing (how busy the music is)
const FLUX_FULL = 2.0;   // summed band rise per second that counts as fully busy
const RISE_MAX = 0.8;    // per-frame cap on the summed rise (a seek jumps the envelope)
const ACT_MIN = 0.55;    // drive scale for motionless music, rising to 1 when busy
const FALLBACK_FLOOR = 0.35; // floor seed without an envelope (the fallback pulse's typical level)

// --- Bars ---
// s: each band swells up this fast and settles back this slowly. Kicks come at
// <= 2.5 Hz and may punch and bounce; mids (syllables, 3-5 Hz) and highs (hats,
// 4-8 Hz) sit in the photosensitive range, so they settle back more slowly:
// between hits their bars hold and shimmer instead of flicking at the hit rate.
const TAU_ATTACK = [0.07, 0.07, 0.07, 0.07];
const TAU_RELEASE = [0.30, 0.30, 0.40, 0.70];
// s: a second, symmetric smoothing pole on the mids and highs only. Syllables
// (3-5 Hz) and hats (8-12 Hz) would otherwise shake the outer bar tips at their
// own rate, and a tip cell toggling at 10 Hz is a small strobe; kicks (sub,
// bass) keep their punch. At 10 Hz this passes ~20 % of the high band's ripple,
// at 4 Hz ~60 % of the mids'.
const TAU_SMOOTH = [0, 0, 0.05, 0.08];
const TAU_ATTACK_RM = 0.30;  // reduced motion: everything slower
const TAU_RELEASE_RM = 0.80;
const TAU_PRESENCE = 0.35;   // s: the mode fades in on play and out on pause
const GAIN_TAU = 4.0;        // s: per-band auto-gain memory (recent peak) ...
const GAIN_FLOOR = 0.7;      // ... never boosting a band more than 1 / 0.7
const LEN_BASE = 0.35;       // steps: a silent bar is a stub on the centre row
const LEN_GAMMA = 1.3;       // >1 favours peaks
const LEN_REACH = 0.86;      // a full bar's tip stops short of the edge; its cap may reach it
// Behind the App's panels (its header and player bar) the lens fits the band
// between them instead, still centred on the geometry, so the panel covering
// more sets the reach of both rows. Every cap stays inside the band, outer edge
// included (the Visualizer draws a cap as a flat-topped hexagon of up to
// 27.5 px: 23.8 px half-height, plus half its 1 px stroke), and so does the line
// through them: a Catmull-Rom spline overshoots a cap by at most 1/8 of the
// drop to the lowest cap in its row, plus its 1.5 px bloom.
const FIT_CAP_EDGE = 24.5;   // px
const FIT_LINE_EDGE = 2;     // px
const FIT_MIN_RANGE = 1;     // steps a fitted bar can always grow (a landscape band leaves almost none)
const TAU_FIT = 0.35;        // s: the reach eases to a new fit (the UI shown or hidden) instead of jumping
const CAP_GAP = 0.85;        // steps between a bar's tip and its cap
const CAP_HOLD = 0.30;       // s a cap hangs before falling
const CAP_GRAVITY = 10.0;    // steps/s^2
const CAP_MAX_FALL = 6.0;    // steps/s
const WOBBLE = 0.06;         // +-6 % slow per-pillar drift, so neighbours never move in lockstep
const TIP_AT = 0.35;         // steps below the tip where a cell is brightest ...
const TIP_WIDTH = 1.15;      // ... falling to nothing this many steps either side
export const ECHO_SLOTS = 9; // frames of cap history kept for the line's echoes

// Where the four bands sit across a half-screen, from the centre pillar (0)
// to the outermost visible one (1); linear in between.
const POS_BASS = 0.2, POS_MID = 0.45, POS_HIGH = 0.85;

export interface HexSpectrum {
  /** Pillars 0 (centre) .. pillars on each side. */
  pillars: number;
  /** Per cell (build order): its pillar, and its steps from the centre row. */
  cellPillar: Uint8Array;
  cellStep: Float32Array;
  /** Caps: 2 * pillars + 1 upper bars (left to right), then as many lower ones. */
  nBars: number;
  lineSplit: number;
  barPillar: Uint8Array;
  /** Cap x (between the pillar's zig-zag cells), and cap y per step (-75 up, +75 down). */
  barX: Float32Array;
  barDY: Float32Array;
  // Per pillar.
  /** Spectrum position 0 (bass) .. 1 (treble); per viewport. */
  pos: Float32Array;
  /** Static character weight and wobble phase. */
  weight: Float32Array;
  phase: Float32Array;
  /** This frame: level 0..1, tip (steps), cap (steps), cap hang (s) and fall speed. */
  glow: Float32Array;
  len: Float32Array;
  peak: Float32Array;
  hold: Float32Array;
  fall: Float32Array;
  /** Pillars [0, live) are updated: the ones on screen plus two (the line runs on past the edge). */
  live: number;
  /** Tip length of a full bar now; it eases to fitLen when the panels change (a resize snaps it). */
  maxLen: number;
  /** Tip length that reaches the screen edge, or with panels the band between them; per viewport. */
  fitLen: number;
  /** Cap history per pillar (ECHO_SLOTS x (pillars + 1) ring); echoHead is the slot the NEXT frame writes. */
  echo: Float32Array;
  echoHead: number;
  /** Scratch for the line's points (nBars each), so drawing it allocates nothing. */
  lineX: Float32Array;
  lineY: Float32Array;
  /** Per band (sub, bass, mid, high): slow floor, last input, swelled drive, the same smoothed (what the
   *  bars and the line read) and its recent peak (auto-gain). */
  floor: Float32Array;
  prev: Float32Array;
  swell: Float32Array;
  bands: Float32Array;
  peaks: Float32Array;
  /** prev holds a real sample (false after a pause, a seed or a seek-sized gap). */
  prevValid: boolean;
  /** Smoothed onset flux (summed band rise per second). */
  flux: number;
  /** 0..1 fade: 1 while playing, 0 when paused. */
  presence: number;
  /** Viewport the per-viewport values were last computed for, and the panels' insets (px). */
  w: number;
  h: number;
  top: number;
  bottom: number;
  /** False until the Visualizer has (re)entered Spectrum mode and cleared the grid. */
  active: boolean;
}

function frac(v: number): number { return v - Math.floor(v); }

/** One spectrum state for the grid; the per-viewport values fill on the first step. */
export function createHexSpectrum(): HexSpectrum {
  const P = HEX_COLS;               // |x| reaches (2P + 1) * 43.3
  const upper = 2 * P + 1;
  const nBars = 2 * upper;
  const barX = new Float32Array(nBars);
  const barDY = new Float32Array(nBars);
  const barPillar = new Uint8Array(nBars);
  // Upper cap of signed pillar sp (-P left .. 0 centre .. P right) is P + sp,
  // so each row of caps runs left to right; the lower row is the same + upper.
  for (let half = 0; half < 2; half++) {
    for (let k = 0; k < upper; k++) {
      const b = half * upper + k;
      const sp = k - P;
      const p = sp < 0 ? -sp : sp;
      barPillar[b] = p;
      barX[b] = p === 0 ? 0 : Math.sign(sp) * (2 * p + 0.5) * HALF_COL;
      barDY[b] = half === 0 ? -Y_OFFSET : Y_OFFSET;
    }
  }
  const cellPillar = new Uint8Array(HEX_CELLS);
  const cellStep = new Float32Array(HEX_CELLS);
  let index = 0;
  for (let r = -HEX_ROWS; r < HEX_ROWS; r++) {
    for (let c = -HEX_COLS; c < HEX_COLS; c++) {
      // |x| in half columns: even rows 0, 2, 4 ..., odd rows 1, 3, 5 ...; a
      // pillar is one even and one odd column, so it zig-zags outwards.
      const u = Math.round(Math.abs(hexX(c, r, X_OFFSET)) / HALF_COL);
      cellPillar[index] = Math.min(P, u >> 1);
      cellStep[index] = Math.abs(hexY(r, Y_OFFSET)) / Y_OFFSET;
      index++;
    }
  }
  const weight = new Float32Array(P + 1);
  const phase = new Float32Array(P + 1);
  for (let p = 0; p <= P; p++) {
    weight[p] = 0.84 + 0.16 * frac(Math.sin(p * 12.9898 + 4.1) * 43758.5453);
    phase[p] = 2 * Math.PI * frac(Math.sin(p * 78.233 + 1.7) * 12543.17);
  }
  return {
    pillars: P, cellPillar, cellStep,
    nBars, lineSplit: upper, barPillar, barX, barDY,
    pos: new Float32Array(P + 1), weight, phase,
    glow: new Float32Array(P + 1),
    len: new Float32Array(P + 1).fill(LEN_BASE),
    peak: new Float32Array(P + 1).fill(LEN_BASE + CAP_GAP),
    hold: new Float32Array(P + 1),
    fall: new Float32Array(P + 1),
    live: 0, maxLen: LEN_BASE, fitLen: LEN_BASE,
    echo: new Float32Array(ECHO_SLOTS * (P + 1)).fill(LEN_BASE + CAP_GAP),
    echoHead: 0,
    lineX: new Float32Array(nBars), lineY: new Float32Array(nBars),
    floor: new Float32Array(4).fill(FALLBACK_FLOOR),
    prev: new Float32Array(4),
    swell: new Float32Array(4),
    bands: new Float32Array(4),
    peaks: new Float32Array(4).fill(GAIN_FLOOR),
    prevValid: false,
    flux: 0,
    presence: 0,
    w: 0, h: 0, top: 0, bottom: 0,
    active: false,
  };
}

/**
 * A new track (or the fallback pulse): start each band's floor at the track's
 * mean level (`means` already times Audio Reactivity; null = the fallback
 * pulse), so its first seconds read like the rest. The next frame's rise is
 * not counted (the envelope jumps between tracks).
 */
export function seedHexSpectrumFloors(s: HexSpectrum, means: ArrayLike<number> | null, sens: number): void {
  for (let k = 0; k < 4; k++) {
    const m = means ? means[k] : FALLBACK_FLOOR * sens;
    s.floor[k] = m >= 0 && m < 4 ? m : 0; // NaN -> 0
  }
  s.prevValid = false;
}

/** Mean of an envelope band (0..255 samples) as 0..1. O(n), once per track. */
export function envelopeMean(a: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return a.length ? sum / a.length / 255 : 0;
}

// Per-viewport values: each pillar's place in the spectrum (its even-row
// column over the visible half-width, so the outermost visible pillar is always
// the treble), how many pillars to update, and how long a bar may grow.
function layoutFor(s: HexSpectrum, w: number, h: number, top: number, bottom: number): void {
  s.w = w; s.h = h; s.top = top; s.bottom = bottom;
  const span = Math.max(1, w / 2 - HALF_COL * 0.5);
  for (let p = 0; p <= s.pillars; p++) s.pos[p] = Math.min(1, (2 * p * HALF_COL) / span);
  s.live = Math.min(s.pillars + 1, Math.ceil((w / 2 + 2 * X_OFFSET) / X_OFFSET) + 1);
  const full = Math.max(LEN_BASE, (h / 2 / Y_OFFSET) * LEN_REACH);
  const inset = top > bottom ? top : bottom;
  if (inset <= 0) { s.fitLen = full; return; }
  // The cap's centre at most `cap` px from the centre row, so the cap (and the line) ends inside the band.
  const visible = h / 2 - inset;
  const rest = (LEN_BASE + CAP_GAP) * Y_OFFSET; // a resting cap: the lowest any cap gets
  let cap = visible - FIT_CAP_EDGE;
  const line = (visible - FIT_LINE_EDGE + rest / 8) / (1 + 1 / 8);
  if (line < cap) cap = line;
  let len = cap / Y_OFFSET - CAP_GAP;
  if (len < LEN_BASE + FIT_MIN_RANGE) len = LEN_BASE + FIT_MIN_RANGE;
  s.fitLen = len < full ? len : full;
}

/**
 * Advance one rendered frame. `sub..high` are the band levels at the playback
 * position times Audio Reactivity (envelope samples 0..1 x sensitivity, or the
 * fallback pulse with its band gains taken out); `playing` false fades
 * everything out; `reduced` (prefers-reduced-motion) slows every response,
 * holds the wobble and lets the caps follow instead of hang-and-drop. `dt` in
 * seconds (capped here at 0.1), `time` for the wobble (scene time), `w`/`h` the
 * canvas size, `top`/`bottom` the px the App's panels cover at each edge (0 =
 * nothing: Zen Mode, or no App).
 */
export function stepHexSpectrum(
  s: HexSpectrum, sub: number, bass: number, mid: number, high: number,
  playing: boolean, reduced: boolean, dt: number, time: number, w: number, h: number,
  top = 0, bottom = 0,
): void {
  if (!(top > 0)) top = 0; // NaN, negative -> 0
  if (!(bottom > 0)) bottom = 0;
  if (w !== s.w || h !== s.h) { layoutFor(s, w, h, top, bottom); s.maxLen = s.fitLen; }
  else if (top !== s.top || bottom !== s.bottom) layoutFor(s, w, h, top, bottom);
  const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
  // The panels shown or hidden: the bars' reach eases to the new fit instead of
  // jumping (a resize, above, snaps it: everything moves then anyway).
  if (s.maxLen !== s.fitLen) {
    const m = s.maxLen + (s.fitLen - s.maxLen) * (1 - Math.exp(-d / TAU_FIT));
    s.maxLen = Math.abs(s.fitLen - m) < 1e-3 ? s.fitLen : m;
  }
  s.presence += ((playing ? 1 : 0) - s.presence) * (1 - Math.exp(-d / TAU_PRESENCE));

  // 1. Drive: rise (onset flux) over all bands, then each band against its floor.
  const floor = s.floor, prev = s.prev;
  let rise = 0;
  for (let k = 0; k < 4; k++) {
    let x = k === 0 ? sub : k === 1 ? bass : k === 2 ? mid : high;
    if (!(x > 0)) x = 0; else if (x > 4) x = 4; // NaN, negative -> 0
    if (playing && s.prevValid) { const r = x - prev[k]; if (r > 0) rise += r; }
    prev[k] = x;
  }
  if (rise > RISE_MAX) rise = RISE_MAX;
  if (d > 0) s.flux += (1 - Math.exp(-d / FLUX_TAU)) * ((playing ? rise / d : 0) - s.flux);
  s.prevValid = playing && d > 0;
  let act = s.flux / FLUX_FULL;
  act = act > 1 ? 1 : act > 0 ? act : 0;
  const actGain = ACT_MIN + (1 - ACT_MIN) * act;
  const kFloor = 1 - Math.exp(-d / FLOOR_TAU);

  // 2. Swell each band's drive (fast up, slow down), then auto-gain it against its recent peak.
  const kG = Math.exp(-d / GAIN_TAU);
  const kCap = 1 - Math.exp(-d / TAU_RELEASE_RM); // reduced motion: caps follow their tips this smoothly
  const swell = s.swell, bands = s.bands, peaks = s.peaks;
  for (let k = 0; k < 4; k++) {
    let target = 0;
    if (playing) {
      const x = prev[k];
      floor[k] += kFloor * (x - floor[k]);
      target = GAIN * (x - BETA * floor[k]);
      target = (target > 1 ? 1 : target > 0 ? target : 0) * actGain;
    }
    const kA = 1 - Math.exp(-d / (reduced ? TAU_ATTACK_RM : TAU_ATTACK[k]));
    const kR = 1 - Math.exp(-d / (reduced ? TAU_RELEASE_RM : TAU_RELEASE[k]));
    swell[k] += (target - swell[k]) * (target > swell[k] ? kA : kR);
    bands[k] += (swell[k] - bands[k]) * (TAU_SMOOTH[k] > 0 ? 1 - Math.exp(-d / TAU_SMOOTH[k]) : 1);
    // max(band, decayed peak, GAIN_FLOOR): a band falling slowly after a busy
    // passage must not drag its peak below the floor (gain 1 for good).
    const pk = peaks[k] * kG;
    const top = bands[k] > pk ? bands[k] : pk;
    peaks[k] = top > GAIN_FLOOR ? top : GAIN_FLOOR;
  }
  const g1 = bands[1] / peaks[1], g2 = bands[2] / peaks[2], g3 = bands[3] / peaks[3];
  const g0 = 0.5 * (bands[0] / peaks[0] + g1); // the centre pillar: sub and bass together
  const range = s.maxLen - LEN_BASE;
  for (let p = 0; p < s.live; p++) {
    const t = s.pos[p];
    let v: number;
    if (t <= POS_BASS) v = g0 + (g1 - g0) * (t / POS_BASS);
    else if (t <= POS_MID) v = g1 + (g2 - g1) * ((t - POS_BASS) / (POS_MID - POS_BASS));
    else if (t <= POS_HIGH) v = g2 + (g3 - g2) * ((t - POS_MID) / (POS_HIGH - POS_MID));
    else v = g3;
    const wob = reduced ? 1 : 1 - WOBBLE + WOBBLE * Math.sin(time * (0.6 + 0.6 * s.weight[p]) + s.phase[p]);
    v *= s.weight[p] * wob;
    if (v > 1) v = 1;
    s.glow[p] = v;
    const len = LEN_BASE + range * Math.pow(v, LEN_GAMMA);
    s.len[p] = len;
    // The cap: kicked out with the tip, hangs, then falls under gravity.
    const want = len + CAP_GAP;
    if (reduced) {
      s.peak[p] += (want - s.peak[p]) * kCap;
      s.fall[p] = 0;
    } else if (want >= s.peak[p]) {
      s.peak[p] = want; s.hold[p] = CAP_HOLD; s.fall[p] = 0;
    } else if (s.hold[p] > 0) {
      s.hold[p] -= d;
    } else {
      let f = s.fall[p] + CAP_GRAVITY * d;
      if (f > CAP_MAX_FALL) f = CAP_MAX_FALL;
      s.fall[p] = f;
      const q = s.peak[p] - f * d;
      s.peak[p] = q > want ? q : want;
    }
  }
  s.echo.set(s.peak, s.echoHead * (s.pillars + 1));
  s.echoHead = (s.echoHead + 1) % ECHO_SLOTS;
}

/**
 * A cell's light 0..1 for its pillar's current length: brightest TIP_AT below
 * the tip, so one cell per bar end carries the light and its neighbours share
 * it as the tip moves between them; nothing beyond the tip. A bar at rest (a
 * quiet passage) glows at half strength, full once it has grown a step.
 */
export function hexSpectrumCellLevel(s: HexSpectrum, cell: number): number {
  const len = s.len[s.cellPillar[cell]];
  const below = len - s.cellStep[cell]; // steps below the tip
  if (below <= -0.5) return 0;
  const off = below > TIP_AT ? below - TIP_AT : TIP_AT - below;
  if (off >= TIP_WIDTH) return 0;
  const grown = len - LEN_BASE;
  return (1 - off / TIP_WIDTH) * (grown >= 1 ? 1 : 0.5 + 0.5 * grown);
}

/** Offset into s.echo of the pillars' caps `framesAgo` frames ago (1 .. ECHO_SLOTS - 1). */
export function hexSpectrumEcho(s: HexSpectrum, framesAgo: number): number {
  return ((s.echoHead - 1 - framesAgo + 2 * ECHO_SLOTS) % ECHO_SLOTS) * (s.pillars + 1);
}

const RED_ALPHA = 0.7;     // a saturated red base colour (WCAG red flash)
const TRAILS_ALPHA = 0.5;  // Astral Trails stack each frame over ~6 frames

/**
 * Every Spectrum alpha is multiplied by this, once per effect run: 0.7 for a
 * saturated red base colour (linear R / (R + G + B) >= 0.8, WCAG's red test:
 * 174, 285 and 396 Hz, crimson), times 0.5 with Astral Trails on (each frame's
 * hexes stack over the last ~6, so the lens's sweeps flashed at full alpha).
 * `color` is '#rgb' or '#rrggbb'; anything else counts as not red.
 */
export function hexSpectrumAlphaScale(color: string, trails: boolean): number {
  let hex = '';
  if (/^#[0-9a-f]{6}$/i.test(color)) hex = color.slice(1);
  else if (/^#[0-9a-f]{3}$/i.test(color)) hex = color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
  let k = trails ? TRAILS_ALPHA : 1;
  if (hex) {
    const lin = (i: number) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const r = lin(0), g = lin(2), b = lin(4);
    if (r + g + b > 0 && r / (r + g + b) >= 0.8) k *= RED_ALPHA;
  }
  return k;
}

export const HEX_SPECTRUM_TUNING = {
  LEN_BASE, CAP_GAP, TIP_AT, TIP_WIDTH, TAU_ATTACK, TAU_RELEASE, TAU_SMOOTH, TAU_PRESENCE,
  FLOOR_TAU, BETA, GAIN, ACT_MIN, FLUX_FULL, FALLBACK_FLOOR, RED_ALPHA, TRAILS_ALPHA,
};
