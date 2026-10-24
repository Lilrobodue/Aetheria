import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openApp, acceptDisclaimer, importTones, addFiles, elapsedSeconds, expectCache, openHarmonicControl, tapTraditional } from './helpers';

// v14.8: the Spectrum Lens (utils/hexSpectrum, the Visualizer's spectrumLayer),
// read off what the 2D context actually draws and off the perf HUD (?perf=1,
// whose `spec N/f` part is the hexagons the layer drew per frame). Every test
// runs at the user's phone viewport, 411x752: the canvas is sized in CSS px,
// so this is the phone's raster and its hexagon count. The tones carry no band
// envelope (nothing scans them), so the lens runs on the fallback pulse; one
// test Deep Scans two synthetic tracks to drive it from real envelopes. On the
// Vite dev server a playing track holds draws at ~16-20/s here (React dev-build
// commits), likely fewer on a phone, so the checks that wait for a fade follow
// the frames actually drawn (framesAfterClock) or poll the HUD, not a fixed
// wall-clock delay.

const PHONE = { width: 411, height: 752 };
const VIZ_SETTINGS_KEY = 'aetheria.vizSettings.v1';

/** A hexagon as drawn: centre and radius from corners 0 and 3, stroke width (0 = only filled), globalAlpha. */
type DrawnHex = { cx: number; cy: number; r: number; lw: number; filled: boolean; alpha: number };
/** A path with a bezierCurveTo (the lens's line): its moveTo count, stroke width, first y, globalAlpha, colour,
 *  and the highest and lowest y its points and cubics reach (exact, at each cubic's extrema). */
type DrawnCurve = { contours: number; lw: number; y0: number; alpha: number; style: string; ymin: number; ymax: number };
/** One rendered frame: when it started (page clock), the music's position then
 *  (s; -1 before any track plays), the canvas size, the clear's fill, what it drew
 *  (ripples: Hydro-Acoustics' bass rings, the only arcs stroked 4 px). */
type Frame = { t: number; pos: number; w: number; h: number; clear: string; hexes: DrawnHex[]; curves: DrawnCurve[]; batched: number; ripples: number };

/**
 * Record what the canvas draws in window.__spec, one entry per frame (a frame
 * starts at the full-canvas clear; the last 900 are kept). Every path that is
 * stroked or filled counts ONCE, however often it is drawn (a hexagon is
 * stroked, then filled): exactly 6 points (moveTo + 5 lineTo) is a hexagon,
 * any path with a bezierCurveTo a curve, and any other moveTo/lineTo path of
 * more than 6 points `batched` (several hexagons in one path). Arcs, rects
 * and shorter paths (the other layers) are ignored, except that an arc stroked
 * 4 px counts as a Hydro-Acoustics ripple ring. The hex layer draws inside
 * translate(cx, cy), so positions are relative to the canvas centre. Call
 * before openApp; it survives reloads.
 */
async function recordSpectrum(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__spec = [];
    let frame: any = null;
    let pts: number[] = [];
    let moves = 0;
    let bezier = false;
    let other = false;
    let counted = false; // this path, as it stands, is recorded already
    // The music element (a blob: src; the app keeps it out of the DOM), for its position.
    let music: HTMLMediaElement | null = null;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if ((this.getAttribute('src') || '').startsWith('blob:')) music = this;
      return play.call(this);
    };
    const P = CanvasRenderingContext2D.prototype as any;
    const fillRect = P.fillRect;
    P.fillRect = function (x: number, y: number, width: number, height: number) {
      if (x === 0 && y === 0 && width === this.canvas.width && height === this.canvas.height) {
        if (frame) {
          w.__spec.push(frame);
          if (w.__spec.length > 900) w.__spec.shift();
        }
        const pos = music ? music.currentTime : -1;
        frame = { t: performance.now(), pos, w: width, h: height, clear: String(this.fillStyle), hexes: [], curves: [], batched: 0, ripples: 0 };
      }
      return fillRect.call(this, x, y, width, height);
    };
    const wrap = (name: string, before: (...args: any[]) => void) => {
      const original = P[name];
      P[name] = function (...args: any[]) {
        before.apply(this, args);
        return original.apply(this, args);
      };
    };
    let last: any = null; // the record of the current path once drawn
    // The path's y extent, and its current point's y (where the next cubic starts).
    let ymin = Infinity;
    let ymax = -Infinity;
    let py = 0;
    const reach = (y: number) => { if (y < ymin) ymin = y; if (y > ymax) ymax = y; };
    wrap('beginPath', () => { pts = []; moves = 0; bezier = false; other = false; counted = false; last = null; ymin = Infinity; ymax = -Infinity; });
    // A path that grows after it was drawn is a new shape: record it again when drawn.
    wrap('moveTo', (x: number, y: number) => { pts.push(x, y); moves++; counted = false; reach(y); py = y; });
    wrap('lineTo', (x: number, y: number) => { pts.push(x, y); counted = false; reach(y); py = y; });
    wrap('bezierCurveTo', (_x1: number, y1: number, _x2: number, y2: number, _x: number, y: number) => {
      bezier = true;
      counted = false;
      // A cubic's y is extreme at its ends or where its derivative a t^2 + b t + c is 0.
      const at = (t: number) => (1 - t) ** 3 * py + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3 * y;
      const a = -py + 3 * y1 - 3 * y2 + y;
      const b = 2 * (py - 2 * y1 + y2);
      const c = y1 - py;
      const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b]) : b * b - 4 * a * c < 0 ? [] : [1, -1].map((k) => (-b + k * Math.sqrt(b * b - 4 * a * c)) / (2 * a));
      for (const t of roots) if (t > 0 && t < 1) reach(at(t));
      reach(y);
      py = y;
    });
    for (const m of ['arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'quadraticCurveTo']) wrap(m, () => { other = true; counted = false; });
    const draw = (stroked: boolean) => function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (!frame || args.length > 0 && typeof args[0] === 'object') return; // a Path2D: not the hex layer's
      if (counted) {
        if (last && stroked) last.lw = this.lineWidth;
        if (last && !stroked) last.filled = true;
        return;
      }
      counted = true;
      last = null;
      if (other) {
        if (stroked && this.lineWidth === 4) frame.ripples++;
        return;
      }
      const lw = stroked ? this.lineWidth : 0;
      if (bezier) {
        last = { contours: moves, lw, y0: pts[1], alpha: this.globalAlpha, style: String(this.strokeStyle), ymin, ymax };
        frame.curves.push(last);
      } else if (pts.length === 12 && moves === 1) {
        last = { cx: (pts[0] + pts[6]) / 2, cy: (pts[1] + pts[7]) / 2, r: (pts[0] - pts[6]) / 2, lw, filled: !stroked, alpha: this.globalAlpha };
        frame.hexes.push(last);
      } else if (pts.length > 12) {
        frame.batched++;
      }
    };
    wrap('stroke', draw(true));
    wrap('fill', draw(false));
  });
}

/**
 * Clear the record and return the frames drawn over at least `ms` AND at least
 * `frames` frames: a device drawing few frames a second takes longer (up to
 * 30 s more). The fallback pulse advances per frame drawn (at most 0.04 of its
 * time a frame), so one beat spans 25-40 frames at any frame rate.
 */
async function recordFor(page: Page, ms: number, frames: number): Promise<Frame[]> {
  await page.evaluate(() => ((window as any).__spec = []));
  await page.waitForTimeout(ms);
  await expect
    .poll(() => page.evaluate(() => (window as any).__spec.length as number), { timeout: 30_000, message: `${frames} frames drawn` })
    .toBeGreaterThanOrEqual(frames);
  return page.evaluate(() => (window as any).__spec);
}

/**
 * The frames drawn after `seconds` of the VISUALIZER's clock had run since
 * `since` (performance.now() in the page), once they span `holdSec` of wall
 * time. The visualizer advances its fades by each frame's time capped at
 * 80 ms (a slow frame eases instead of jumping), so on a device drawing fewer
 * than 12.5 frames a second a fade takes longer in wall time than its time
 * constants say; this follows the frames actually drawn.
 */
async function framesAfterClock(page: Page, since: number, seconds: number, holdSec: number): Promise<Frame[]> {
  let tail: Frame[] = [];
  await expect
    .poll(
      async () => {
        const frames: Frame[] = await page.evaluate((t) => (window as any).__spec.filter((f: Frame) => f.t >= t), since);
        let clock = 0;
        let prev = since;
        const from = frames.findIndex((f) => {
          clock += Math.min(0.08, (f.t - prev) / 1000);
          prev = f.t;
          return clock >= seconds;
        });
        tail = from < 0 ? [] : frames.slice(from);
        return tail.length > 0 && tail[tail.length - 1].t - tail[0].t >= holdSec * 1000;
      },
      { timeout: 60_000, intervals: [500], message: `${holdSec} s of frames after ${seconds} s of the visualizer's clock` }
    )
    .toBe(true);
  return tail;
}

type Kind = 'cell' | 'token' | 'cap' | 'core' | 'unknown';
/** Every Spectrum hexagon is filled. Tokens stroke 2 px (as drawHex); cells,
 *  a fixed 47.5 (no ripple swell), and caps stroke 1 px; cap cores only fill. */
function kindOf(h: DrawnHex): Kind {
  if (!h.filled) return 'unknown';
  if (h.lw === 2) return 'token';
  if (h.lw === 1 && Math.abs(h.r - 47.5) <= 0.01) return 'cell';
  if (h.lw === 1 && h.r >= 25.2 && h.r <= 27.6) return 'cap';
  if (h.lw === 0 && h.r >= 6.0 && h.r <= 6.7) return 'core';
  return 'unknown';
}
const countKind = (f: Frame, k: Kind) => f.hexes.filter((h) => kindOf(h) === k).length;

// The grid's cell centres, built from the v14.6 formulas (as hex.spec.ts
// does), not from utils/hexWander, so they can't agree with a bug there.
const X_OFFSET = Math.sqrt(3) * 50;
const LATTICE: { x: number; y: number }[] = [];
for (let r = -15; r < 15; r++) {
  for (let c = -20; c < 20; c++) LATTICE.push({ x: (c * X_OFFSET) + ((r % 2) * X_OFFSET / 2), y: r * 75 });
}

function nearestCell(x: number, y: number): { at: number; distance: number } {
  let distance = Infinity;
  let at = -1;
  for (let i = 0; i < LATTICE.length; i++) {
    const d = Math.hypot(LATTICE[i].x - x, LATTICE[i].y - y);
    if (d < distance) { distance = d; at = i; }
  }
  return { at, distance };
}

/** Distance from (px, py) to the segment a–b. */
function segmentDistance(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(a.x + vx * t - px, a.y + vy * t - py);
}

/** On a cell, or on the edge from one to a neighbour (a token mid-glide). */
function onLatticeOrEdge(x: number, y: number): boolean {
  const near = nearestCell(x, y);
  if (near.distance < 1e-6) return true;
  const a = LATTICE[near.at];
  return LATTICE.some((b) => Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - X_OFFSET) < 1e-6 && segmentDistance(x, y, a, b) < 1e-6);
}

/** The largest change in a cap's y between consecutive frames (a cap is known by its x and its row). */
function largestCapStep(frames: Frame[]): number {
  let largest = 0;
  for (let i = 1; i < frames.length; i++) {
    const before = frames[i - 1].hexes.filter((h) => kindOf(h) === 'cap');
    for (const cap of frames[i].hexes.filter((h) => kindOf(h) === 'cap')) {
      const was = before.find((b) => Math.abs(b.cx - cap.cx) < 1e-6 && Math.sign(b.cy) === Math.sign(cap.cy));
      if (was) largest = Math.max(largest, Math.abs(was.cy - cap.cy));
    }
  }
  return largest;
}

/** The most frames in a row any cap stays exactly where it was (it hangs after a kick). */
function longestCapHang(frames: Frame[]): number {
  const run = new Map<string, number>();
  let longest = 0;
  for (let i = 1; i < frames.length; i++) {
    const before = frames[i - 1].hexes.filter((h) => kindOf(h) === 'cap');
    for (const cap of frames[i].hexes.filter((h) => kindOf(h) === 'cap')) {
      const key = `${cap.cx} ${cap.cy < 0}`;
      const was = before.find((b) => Math.abs(b.cx - cap.cx) < 1e-6 && Math.sign(b.cy) === Math.sign(cap.cy));
      const still = !!was && Math.abs(was.cy - cap.cy) < 1e-9;
      const n = still ? (run.get(key) ?? 0) + 1 : 0;
      run.set(key, n);
      longest = Math.max(longest, n);
    }
  }
  return longest;
}

// Two synthetic tracks for the scanned-envelope test. Deep Scan's envelopes
// are each band's RMS over 50 ms hops, normalised to the band's own peak.
const KICK_AT = 0.25; // s: the first kick
const BEAT = 0.5; // s: 120 BPM
/** A mono 16-bit 8 kHz WAV of `seconds` from sample(t) in -1..1, with 10 ms fades. */
function synthWav(seconds: number, sample: (t: number) => number): Buffer {
  const rate = 8000;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const fade = Math.min(1, t / 0.01, (seconds - t) / 0.01);
    buf.writeInt16LE(Math.round(sample(t) * fade * 16000), 44 + i * 2);
  }
  return buf;
}
/** Kicks: a 70 Hz thump (5 ms rise, 80 ms decay) every beat from KICK_AT. */
const kicks = (t: number) => {
  if (t < KICK_AT) return 0;
  const tau = (t - KICK_AT) % BEAT;
  const rise = tau < 0.005 ? 0.5 - 0.5 * Math.cos((Math.PI * tau) / 0.005) : 1;
  return Math.sin(2 * Math.PI * 70 * tau) * rise * Math.exp(-tau / 0.08);
};
/** A steady pad: 80 Hz is exactly four cycles a hop, so every band's envelope is flat
 *  (one whose hops beat against its cycles flickers, and each band is normalised up). */
const pad = (t: number) => 0.5 * Math.sin(2 * Math.PI * 80 * t);
/** Seconds since the last kick (the envelope leads by up to one hop, so -0.06 counts as a kick). */
const sinceKick = (pos: number) => {
  const p = (((pos - KICK_AT) % BEAT) + BEAT) % BEAT;
  return p >= BEAT - 0.06 ? p - BEAT : p;
};
/** The centre pillar's caps per frame: their height (px, both rows' mean; NaN unless both are drawn). */
const centreOf = (f: Frame) => {
  const caps = f.hexes.filter((h) => kindOf(h) === 'cap' && Math.abs(h.cx) < 1e-6);
  return { cap: caps.length === 2 ? (Math.abs(caps[0].cy) + Math.abs(caps[1].cy)) / 2 : NaN };
};
/** A resting cap's height (px): LEN_BASE 0.35 + CAP_GAP 0.85 steps of 75 px. How far the lens opens is
 *  a cap's height above it: the lens fits between the App's panels, so its reach varies with them. */
const CAP_REST = 90;
/** Frames where the centre caps are kicked up 5 px or more after a frame where they weren't. (The fitted
 *  lens moves ~0.4x as far as a full-height one: measured, every rise of 3 px or more lands on a kick.) */
function capKicks(frames: Frame[]): Frame[] {
  const out: Frame[] = [];
  for (let i = 2; i < frames.length; i++) {
    const [a, b, c] = [frames[i - 2], frames[i - 1], frames[i]].map((f) => centreOf(f).cap);
    if (c - b >= 5 && !(b - a >= 5)) out.push(frames[i]);
  }
  return out;
}

/** An orange-red line colour (#ff4400 for 396 Hz: the colour strings go through HSL). */
function isOrangeRed(style: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(style);
  return !!m && parseInt(m[1], 16) >= 200 && parseInt(m[2], 16) <= 100 && parseInt(m[3], 16) <= 40;
}

const wanderSwitch = (page: Page) => page.getByRole('switch', { name: 'Wandering hexes' });
/** The Hex Visual Mode select (it has no label of its own). */
const hexModeSelect = (page: Page) => page.locator('select', { has: page.locator('option[value="pulse"]') });
const savedViz = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), VIZ_SETTINGS_KEY);

/** Harmonic Control's Visualization Engine section, opened the way a user does (as hex.spec.ts). */
async function openVisualization(page: Page): Promise<void> {
  await openHarmonicControl(page);
  if (!(await wanderSwitch(page).isVisible())) await page.getByRole('button', { name: 'Visualization Engine' }).click();
  await expect(wanderSwitch(page)).toBeVisible();
}

/** Close Harmonic Control (its header button toggles it), so a slow device isn't also
 *  re-rendering the panel at every commit while frames are recorded. */
async function closeHarmonicControl(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Harmonic Control', exact: true })).toBeHidden();
}

/** Press Pause; returns when the page got the click (performance.now()), which
 *  pauses at once. Timed in the page: Playwright's own click waits for the
 *  button to be stable, which takes a while on a busy main thread. */
async function pauseAt(page: Page): Promise<number> {
  await page.evaluate(() =>
    document.addEventListener('click', () => ((window as any).__clickedAt = performance.now()), { capture: true, once: true })
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  return page.evaluate(() => (window as any).__clickedAt as number);
}

/** Play tone-01 (imported already) and wait until it is under way. */
async function playFirstTone(page: Page): Promise<void> {
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
}

/** The phone's viewport and the canvas recorder, then the app. */
async function openOnPhone(page: Page, opts: { query?: string } = {}): Promise<string[]> {
  await page.setViewportSize(PHONE);
  await recordSpectrum(page);
  return openApp(page, opts);
}

test('Spectrum draws a mirrored lens of single hexagons and a hairline curve, and fades out on pause @mobile', async ({ page }) => {
  const dialogs = await openOnPhone(page);
  await importTones(page, 1, 120);
  await playFirstTone(page);
  await openVisualization(page);
  await expect(hexModeSelect(page), 'Spectrum is the default').toHaveValue('spectrum');
  await closeHarmonicControl(page);
  await recordFor(page, 3000, 15); // the lens fades in
  const frames = await recordFor(page, 4000, 30);

  // The counts below are the phone's: on a desktop-sized canvas the lens draws ~130 hexagons.
  expect({ w: frames[0].w, h: frames[0].h }, 'the canvas is the phone viewport').toEqual({ w: PHONE.width, h: PHONE.height });
  let lit = 0;
  let withLine = 0;
  let tokens = 0;
  let offLattice = 0;
  let unmirrored = 0;
  let oneSided = 0;
  let unknown = 0;
  let total = 0;
  let most = 0;
  let batched = 0;
  let cores = 0;
  const badCurves: DrawnCurve[] = [];
  const lineCounts = new Set<number>();
  for (const f of frames) {
    if (countKind(f, 'cell') >= 1 && countKind(f, 'cap') >= 4) lit++;
    total += f.hexes.length;
    most = Math.max(most, f.hexes.length);
    batched += f.batched;
    unknown += countKind(f, 'unknown');
    for (const h of f.hexes) {
      const k = kindOf(h);
      if (k === 'cell' && nearestCell(h.cx, h.cy).distance >= 1e-6) offLattice++;
      if (k === 'token') {
        tokens++;
        if (!onLatticeOrEdge(h.cx, h.cy)) offLattice++;
      }
      if (k === 'core') cores++;
    }
    // Mirrored: every cap has its twin across the horizon and across the centre line.
    const caps = f.hexes.filter((h) => kindOf(h) === 'cap');
    for (const c of caps) {
      for (const [x, y] of [[c.cx, -c.cy], [-c.cx, c.cy]]) {
        const onScreen = Math.abs(x) <= f.w / 2 + 50 && Math.abs(y) <= f.h / 2 + 50;
        if (onScreen && !caps.some((d) => Math.abs(d.cx - x) < 1e-3 && Math.abs(d.cy - y) < 1e-3)) unmirrored++;
      }
    }
    for (const c of f.curves) if (c.lw !== 1 || c.contours !== 1) badCurves.push(c);
    if (f.curves.length > 0) {
      withLine++;
      lineCounts.add(f.curves.length);
      // The line runs along both rows of caps: as many curves above the horizon as below.
      if (2 * f.curves.filter((c) => c.y0 < 0).length !== f.curves.length) oneSided++;
    }
  }
  expect.soft(lit / frames.length, '≥ 90 % of frames light a cell and ≥ 4 caps').toBeGreaterThanOrEqual(0.9);
  expect.soft(tokens, 'the wandering tokens ride the lens').toBeGreaterThan(0);
  expect.soft(cores, 'the caps light their cores').toBeGreaterThan(0); // Hydro-Acoustics off
  expect.soft(offLattice, 'every cell on a lattice cell, every token on a cell or the edge to a neighbour').toBe(0);
  expect.soft(unmirrored, 'every cap mirrored across both axes').toBe(0);
  expect.soft(oneSided, 'frames whose line is not mirrored across the horizon').toBe(0);
  expect.soft(unknown, 'every hexagon is a cell, token, cap or cap core').toBe(0);
  // Heat guard: each hexagon is drawn, and costs GPU time on the phone.
  expect.soft(most, 'hexagons in any one frame').toBeLessThanOrEqual(70);
  expect.soft(total / frames.length, 'hexagons per frame, mean').toBeLessThanOrEqual(55);
  expect.soft(batched, 'paths holding several hexagons').toBe(0);
  expect.soft(badCurves, 'every curve a 1 px stroke of one contour').toEqual([]);
  expect.soft(withLine / frames.length, 'the line is drawn').toBeGreaterThanOrEqual(0.9);
  expect.soft([...lineCounts], 'curves per frame: 2 rows x (2 echoes + 2 bloom + core)').toEqual([10]);

  // Pause: the lens fades out in about a second, then draws nothing at all.
  const clickedAt = await pauseAt(page);
  const after = await framesAfterClock(page, clickedAt, 2, 2);
  const drawing = after.filter((f) => f.hexes.length > 0 || f.curves.length > 0);
  expect(drawing.map((f) => `${f.hexes.length} hexagons, ${f.curves.length} curves`), 'paused: frames that still draw').toEqual([]);
  expect(dialogs).toEqual([]);
});

test('reduced motion: no echo trails and gentler caps', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialogs = await openOnPhone(page);
  await importTones(page, 1, 120);
  await playFirstTone(page);
  await recordFor(page, 2000, 15); // the lens fades in
  // Each half spans at least one beat of the fallback pulse.
  const reduced = await recordFor(page, 5000, 45);

  await page.evaluate(() => ((window as any).__samePage = true));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // The running visualizer reads the preference every frame: the echoes come back.
  await expect
    .poll(async () => page.evaluate(() => (window as any).__spec.at(-1)?.curves.length ?? -1), { timeout: 10_000 })
    .toBe(10);
  const normal = await recordFor(page, 5000, 45);
  expect(await page.evaluate(() => (window as any).__samePage), 'no reload').toBe(true);
  await expect(page.getByRole('button', { name: 'Pause', exact: true }), 'the tone is still playing').toBeVisible();

  const lineCounts = (frames: Frame[]) => [...new Set(frames.filter((f) => f.curves.length > 0).map((f) => f.curves.length))];
  const withLine = (frames: Frame[]) => frames.filter((f) => f.curves.length > 0).length / Math.max(1, frames.length);
  expect.soft(withLine(reduced), 'reduced motion: the line is drawn').toBeGreaterThanOrEqual(0.9);
  expect.soft(lineCounts(reduced), 'reduced motion: curves per frame, 2 rows x (2 bloom + core)').toEqual([6]);
  expect.soft(withLine(normal), 'lifted: the line is drawn').toBeGreaterThanOrEqual(0.9);
  expect.soft(lineCounts(normal), 'lifted: curves per frame, the echoes back').toEqual([10]);
  // Under reduced motion the caps ease toward the bars (0.8 s) instead of
  // jumping up with them and falling under gravity: measured 5-10 px against
  // 70-165 px per frame on the fallback pulse.
  const gentle = largestCapStep(reduced);
  const lively = largestCapStep(normal);
  expect.soft(lively, 'lifted: the caps move').toBeGreaterThan(20);
  expect.soft(gentle, 'largest cap step per frame, reduced motion vs lifted').toBeLessThanOrEqual(0.5 * lively);
  // Easing, they move every frame; a kicked cap hangs still for 0.3 s (4 or
  // more frames at any frame rate) before it falls. Two frames in a row are
  // allowed: a restarted render loop draws its first two frames with no time step.
  expect.soft(longestCapHang(normal), 'lifted: frames a kicked cap hangs still').toBeGreaterThanOrEqual(3);
  expect.soft(longestCapHang(reduced), 'reduced motion: frames in a row a cap stays still').toBeLessThanOrEqual(2);
  expect(dialogs).toEqual([]);
});

interface HudWindow {
  draws: number;
  /** The Spectrum layer's part: hexagons drawn per frame and µs; null in a second it didn't run. */
  spec: { drawn: number; us: number } | null;
}

function parseHud(line: string): HudWindow {
  const draws = /draws ([\d.]+)\/s/.exec(line);
  if (!draws) throw new Error(`Not a perf HUD line: ${line}`);
  const spec = /spec ([\d.]+)\/f (\d+)µs/.exec(line);
  return { draws: Number(draws[1]), spec: spec ? { drawn: Number(spec[1]), us: Number(spec[2]) } : null };
}

/** Record every line the perf HUD shows in window.__hud (as hex.spec.ts; call before openApp). */
async function recordHud(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__hud = [];
    const attach = () => {
      const hud = document.querySelector('[data-testid="perf-hud"]');
      if (!hud) return false;
      new MutationObserver(() => w.__hud.push(hud.textContent ?? '')).observe(hud, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      return true;
    };
    const watch = new MutationObserver(() => {
      if (attach()) watch.disconnect();
    });
    watch.observe(document, { childList: true, subtree: true });
  });
}

/** HUD windows closed so far on this page. The next one to close is the one under way. */
const hudCount = (page: Page) => page.evaluate(() => (window as any).__hud.length as number);

/** `count` HUD windows from the `from`-th on, once they have all closed. */
async function hudWindows(page: Page, from: number, count: number): Promise<HudWindow[]> {
  await expect.poll(() => hudCount(page), { timeout: (count + 5) * 1000 }).toBeGreaterThanOrEqual(from + count);
  const lines: string[] = await page.evaluate(([from, count]) => (window as any).__hud.slice(from, from + count), [from, count]);
  return lines.map(parseHud);
}

/** The latest closed HUD window, or null before the first. */
async function latestHud(page: Page): Promise<HudWindow | null> {
  const line: string | undefined = await page.evaluate(() => (window as any).__hud.at(-1));
  return line === undefined ? null : parseHud(line);
}

test('the perf HUD reports the Spectrum layer @mobile', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await recordHud(page);
  const dialogs = await openApp(page, { query: '?perf=1' });
  await importTones(page, 1, 120);
  await playFirstTone(page);
  const start = await hudCount(page);

  // Playing: three windows in a row report 1-70 hexagons a frame (the phone's lens draws ~40).
  await expect
    .poll(
      async () => {
        const last: string[] = await page.evaluate(() => (window as any).__hud.slice(-3));
        const spec = last.map((l) => parseHud(l).spec);
        return spec.length === 3 && spec.every((s) => s !== null && s.drawn >= 1 && s.drawn <= 70)
          ? 'reported'
          : `spec ${spec.map((s) => (s ? s.drawn : 'absent')).join(', ')}`;
      },
      { timeout: 15_000, message: 'three windows in a row report 1-70 Spectrum hexagons a frame' }
    )
    .toBe('reported');

  // Paused: the lens fades out (about a second; longer on a device drawing
  // fewer than 12.5 frames a second), then the layer runs on and draws nothing.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect.poll(async () => (await latestHud(page))?.spec?.drawn ?? null, { timeout: 15_000 }).toBe(0);
  const faded = await hudCount(page);
  for (const w of await hudWindows(page, faded, 2)) {
    expect(w.spec, 'paused: the layer runs').not.toBeNull();
    expect(w.spec!.drawn, 'paused: hexagons a frame').toBe(0);
  }

  // Radial Pulse: past the window under way and the next, the layer doesn't run at all.
  await openVisualization(page);
  await hexModeSelect(page).selectOption('pulse');
  await expect(hexModeSelect(page)).toHaveValue('pulse');
  const switched = await hudCount(page);
  for (const w of await hudWindows(page, switched + 2, 3)) expect(w.spec, 'Radial Pulse: the spec part').toBeNull();

  // Every second since play drew frames.
  const windows = await hudWindows(page, start, (await hudCount(page)) - start);
  windows.forEach((w, i) => expect(w.draws, `HUD window ${start + i}`).toBeGreaterThan(0));
  expect(dialogs).toEqual([]);
});

test("a red base colour and Astral Trails cap Spectrum's alpha", async ({ page }) => {
  const dialogs = await openOnPhone(page);
  // Astral Trails on, as a saved setting (each frame's hexes stack over the last few).
  await expect.poll(() => savedViz(page), { message: 'the visual settings are saved' }).not.toBeNull();
  await page.evaluate((k) => {
    const saved = JSON.parse(localStorage.getItem(k)!);
    saved.enableTrails = true;
    localStorage.setItem(k, JSON.stringify(saved));
  }, VIZ_SETTINGS_KEY);
  await page.reload();
  await acceptDisclaimer(page);
  await importTones(page, 1, 120);
  await playFirstTone(page);
  // 396 Hz: #FF4500, a saturated red by WCAG's test. The line strokes in the base colour.
  await openHarmonicControl(page);
  await tapTraditional(page, 396);
  const lineStyles = async (): Promise<string[]> =>
    page.evaluate(() => (window as any).__spec.at(-1)?.curves.map((c: DrawnCurve) => c.style) ?? []);
  await expect
    .poll(async () => (await lineStyles()).some(isOrangeRed), { timeout: 10_000, message: 'the line is drawn in 396 Hz orange-red' })
    .toBe(true);
  await closeHarmonicControl(page);
  const frames = await recordFor(page, 3000, 45);

  expect([...new Set(frames.map((f) => f.clear))], 'Astral Trails: each frame only dims the last').toEqual(['rgba(0, 0, 0, 0.15)']);
  const notRed = frames.filter((f) => f.curves.length > 0 && !f.curves.some((c) => isOrangeRed(c.style)));
  expect(notRed.length, 'frames whose line is not orange-red').toBe(0);
  // 0.7 (red) x 0.5 (trails) = 0.35, drawn at the 0.31 level; the line's core at
  // 0.35 x 0.7 = 0.245. Unguarded they reach 1.0 and 0.7.
  const lit = frames.filter((f) => countKind(f, 'cell') >= 1).length;
  const capped = frames.filter((f) => countKind(f, 'cap') >= 1 && f.curves.length > 0).length;
  const hexAlpha = Math.max(0, ...frames.flatMap((f) => f.hexes.map((h) => h.alpha)));
  const curveAlpha = Math.max(0, ...frames.flatMap((f) => f.curves.map((c) => c.alpha)));
  expect.soft(lit / frames.length, '≥ 90 % of frames light a cell').toBeGreaterThanOrEqual(0.9);
  expect.soft(capped / frames.length, '≥ 90 % of frames draw caps and the line').toBeGreaterThanOrEqual(0.9);
  expect.soft(hexAlpha, 'the brightest hexagon (globalAlpha)').toBeLessThanOrEqual(0.32);
  expect.soft(curveAlpha, 'the brightest curve (globalAlpha)').toBeLessThanOrEqual(0.25);
  expect(dialogs).toEqual([]);
});

test('scanned music drives the lens: it pumps with the kicks, and a steady pad stays calmer', async ({ page }) => {
  // A scan and two tracks; a device drawing few frames a second takes longer to record them.
  test.setTimeout(240_000);
  const dialogs = await openOnPhone(page);
  await addFiles(page, [
    { name: 'pad.wav', mimeType: 'audio/wav', buffer: synthWav(40, pad) },
    { name: 'kicks.wav', mimeType: 'audio/wav', buffer: synthWav(40, kicks) },
  ]);
  // Deep Scan gives both their band envelopes (before either plays: playing
  // an unscanned track settles its frequency, and the scan then skips it).
  await page.getByRole('button', { name: /^Deep Scan/ }).click();
  await expectCache(page, { analysed: 2 }, 90_000);

  // The pad first, from a still lens, so this measures the drive alone. (A
  // steady track right after a busy one settles over a few seconds as the
  // auto-gain peaks decay to GAIN_FLOOR: check:spectrum pins that case.)
  await page.getByText('pad', { exact: true }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('pad');
  await recordFor(page, 3000, 30); // the lens opens on the pad
  const calm = await recordFor(page, 6000, 40);
  await page.getByRole('button', { name: 'Next track' }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('kicks');
  await recordFor(page, 2000, 15);
  const beat = await recordFor(page, 10_000, 80);

  // Following: the centre caps are kicked up right after a kick (every other
  // beat or so: a kicked cap hangs 0.3 s, then falls), measured on the music's
  // own clock. A lens not following the music lands only ~36 % of its kicks
  // in that window. (The bars' release runs on capped frame time, so below
  // ~10 frames a second they can't settle between kicks; the cap kicks still
  // land on the beat: all of them at ~3-5 fps here, with 2-3x CPU throttling.)
  const kicked = capKicks(beat);
  const onBeat = kicked.filter((f) => sinceKick(f.pos) <= 0.12).length;
  // Calmer: the pad never opens the lens as far as the kicks, and barely moves it.
  const caps = (frames: Frame[]) => frames.map((f) => centreOf(f).cap).filter((c) => !Number.isNaN(c));
  const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const [beatCaps, calmCaps] = [caps(beat), caps(calm)];
  expect.soft(kicked.length, 'kicks: times the centre caps are kicked up').toBeGreaterThanOrEqual(6);
  expect.soft(onBeat / Math.max(1, kicked.length), 'kicks: share of them 0.06 s before to 0.12 s after a kick').toBeGreaterThanOrEqual(0.8);
  expect.soft(beatCaps.length, 'kicks: frames with both centre caps').toBeGreaterThanOrEqual(0.9 * beat.length);
  expect.soft(calmCaps.length, 'pad: frames with both centre caps').toBeGreaterThanOrEqual(0.9 * calm.length);
  expect.soft(Math.max(...calmCaps) - CAP_REST, 'pad: how far the centre caps open (px above rest) vs the kicks').toBeLessThanOrEqual(0.8 * (Math.max(...beatCaps) - CAP_REST));
  expect.soft(range(calmCaps), 'pad: how far the centre caps move (px) vs the kicks').toBeLessThanOrEqual(0.3 * range(beatCaps));
  expect(dialogs).toEqual([]);
});

test('Radial Pulse and Energy Wave draw only their own hexagons, as before', async ({ page }) => {
  const dialogs = await openOnPhone(page);
  await importTones(page, 1, 120);
  await playFirstTone(page);
  await openVisualization(page);
  for (const mode of ['pulse', 'wave'] as const) {
    await hexModeSelect(page).selectOption(mode);
    await expect(hexModeSelect(page)).toHaveValue(mode);
    // From the first frame in the new mode: drawHex's hexagons only (colour
    // and alpha in the style, globalAlpha 1, 1 px cells and 2 px tokens at the
    // grid's size, no ripples here), on the lattice or a token's glide edge.
    const frames = await recordFor(page, 3000, 30);
    const hexes = frames.flatMap((f) => f.hexes);
    const notDrawHex = hexes.filter((h) => h.alpha !== 1 || !h.filled || (h.lw !== 1 && h.lw !== 2) || Math.abs(h.r - 47.5) > 1e-9);
    const offLattice = hexes.filter((h) => (h.lw === 1 ? nearestCell(h.cx, h.cy).distance >= 1e-6 : !onLatticeOrEdge(h.cx, h.cy)));
    expect.soft(frames.filter((f) => f.hexes.length > 0).length, `${mode}: frames that draw hexagons`).toBeGreaterThan(0);
    expect.soft(frames.reduce((n, f) => n + f.curves.length, 0), `${mode}: curves (the lens's line)`).toBe(0);
    expect.soft(frames.reduce((n, f) => n + f.batched, 0), `${mode}: paths holding several hexagons`).toBe(0);
    expect.soft(notDrawHex.slice(0, 3), `${mode}: hexagons not drawn as drawHex draws them`).toEqual([]);
    expect.soft(offLattice.length, `${mode}: hexagons off the lattice and its edges`).toBe(0);
  }
  // And back: the lens returns.
  await hexModeSelect(page).selectOption('spectrum');
  await expect
    .poll(async () => page.evaluate(() => (window as any).__spec.at(-1)?.curves.length ?? -1), { timeout: 10_000 })
    .toBe(10);
  expect(dialogs).toEqual([]);
});

test('Spectrum with the wander off and Hydro-Acoustics on: 1 px cells of one size, the full width after a rotate, and dark when the Hex Grid returns while paused', async ({ page }) => {
  test.setTimeout(180_000); // a reload, a rotate and the panel opened twice, on a slow device
  const dialogs = await openOnPhone(page);
  // The wander off and Hydro-Acoustics on, as saved settings (Hydro's switch has no name).
  await expect.poll(() => savedViz(page), { message: 'the visual settings are saved' }).not.toBeNull();
  await page.evaluate((k) => {
    const saved = JSON.parse(localStorage.getItem(k)!);
    saved.hexWander = false;
    saved.showWaterRipples = true;
    localStorage.setItem(k, JSON.stringify(saved));
  }, VIZ_SETTINGS_KEY);
  await page.reload();
  await acceptDisclaimer(page);
  await importTones(page, 1, 120);
  await playFirstTone(page);
  await recordFor(page, 2000, 15); // the lens fades in
  const portrait = await recordFor(page, 4000, 40);

  // With the wander off, the static off-colour cells stroke 1 px (2 px outlines
  // sweeping with the bars flashed at max settings), and a ripple lights a cell
  // without swelling it (a swelling outline flickered along its path): every
  // hexagon is a 1 px cell of the grid's size, a cap or a cap core.
  const hexes = portrait.flatMap((f) => f.hexes);
  expect.soft(portrait.reduce((n, f) => n + f.ripples, 0), 'Hydro-Acoustics: ripple rings drawn').toBeGreaterThan(0);
  expect.soft(portrait.filter((f) => countKind(f, 'cell') >= 1).length / portrait.length, '≥ 90 % of frames light a cell').toBeGreaterThanOrEqual(0.9);
  expect.soft(hexes.filter((h) => h.lw === 2).length, 'hexagons stroked 2 px (the wander is off: no tokens)').toBe(0);
  expect.soft(hexes.filter((h) => kindOf(h) === 'unknown').slice(0, 3), 'hexagons that are not a cell, cap or cap core').toEqual([]);
  expect.soft(hexes.filter((h) => kindOf(h) === 'core').length, 'cap cores drawn (none with Hydro-Acoustics on)').toBe(0);
  expect.soft(hexes.filter((h) => kindOf(h) === 'cell' && nearestCell(h.cx, h.cy).distance >= 1e-6).length, 'cells off the lattice').toBe(0);

  // A rotate rebuilds the list of on-screen cells: the lens spans the new width,
  // and nothing is drawn past the new edges.
  const LANDSCAPE = { width: PHONE.height, height: PHONE.width };
  await page.setViewportSize(LANDSCAPE);
  await expect
    .poll(() => page.evaluate(() => (window as any).__spec.at(-1)?.w ?? 0), { message: 'the canvas follows the rotate' })
    .toBe(LANDSCAPE.width);
  const landscape = await recordFor(page, 3000, 30);
  const cells = landscape.flatMap((f) => f.hexes.filter((h) => kindOf(h) === 'cell'));
  const widest = Math.max(0, ...cells.map((h) => Math.abs(h.cx)));
  const tallest = Math.max(0, ...cells.map((h) => Math.abs(h.cy)));
  expect.soft(widest, 'landscape: the widest lit cell (px from the centre) is past the portrait edge').toBeGreaterThan(PHONE.width / 2 + 50);
  expect.soft(widest, 'landscape: the widest lit cell is within the landscape edge').toBeLessThanOrEqual(LANDSCAPE.width / 2 + 50);
  expect.soft(tallest, 'landscape: the tallest lit cell is within the landscape edge').toBeLessThanOrEqual(LANDSCAPE.height / 2 + 50);
  await page.setViewportSize(PHONE);

  // The Hex Grid hidden while playing, the music paused meanwhile, the grid shown
  // again: the lens starts from nothing (and, paused, stays dark), never the lens
  // frozen when the grid was hidden.
  await openVisualization(page);
  await page.getByRole('button', { name: 'Hex Grid ON', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hex Grid OFF', exact: true })).toBeVisible();
  await closeHarmonicControl(page);
  await pauseAt(page);
  await openVisualization(page);
  await page.evaluate(() => ((window as any).__spec = []));
  await page.getByRole('button', { name: 'Hex Grid OFF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hex Grid ON', exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect
    .poll(() => page.evaluate(() => (window as any).__spec.length as number), { timeout: 30_000, message: '15 frames drawn' })
    .toBeGreaterThanOrEqual(15);
  const shown: Frame[] = await page.evaluate(() => (window as any).__spec);
  const drawing = shown.filter((f) => f.hexes.length > 0 || f.curves.length > 0);
  expect(drawing.map((f) => `${f.hexes.length} hexagons, ${f.curves.length} curves`), 'paused, the grid shown again: frames that draw').toEqual([]);
  expect(dialogs).toEqual([]);
});

test('Spectrum with Hydro-Acoustics on: the tokens wander undrawn and the caps have no cores @mobile', async ({ page }) => {
  const dialogs = await openOnPhone(page);
  // Hydro-Acoustics on, as a saved setting (its switch has no name); the wander stays on (the default).
  await expect.poll(() => savedViz(page), { message: 'the visual settings are saved' }).not.toBeNull();
  await page.evaluate((k) => {
    const saved = JSON.parse(localStorage.getItem(k)!);
    saved.showWaterRipples = true;
    localStorage.setItem(k, JSON.stringify(saved));
  }, VIZ_SETTINGS_KEY);
  await page.reload();
  await acceptDisclaimer(page);
  await importTones(page, 1, 120);
  await playFirstTone(page);
  await recordFor(page, 2000, 15); // the lens fades in
  const frames = await recordFor(page, 4000, 40);

  // With Hydro-Acoustics on, the tokens' 2 px outlines (swelling and brightening with every passing
  // ripple) and the caps' cores (bobbing through 16 px blocks at each kick, over cells the ripples
  // lift and drop) flickered small areas past the photosensitivity limit, so neither is drawn (the
  // S1 test draws both with it off). The lens, its caps and the ripples still are.
  const hexes = frames.flatMap((f) => f.hexes);
  expect.soft(frames.reduce((n, f) => n + f.ripples, 0), 'Hydro-Acoustics: ripple rings drawn').toBeGreaterThan(0);
  expect.soft(frames.filter((f) => countKind(f, 'cell') >= 1 && countKind(f, 'cap') >= 4).length / frames.length, '≥ 90 % of frames light a cell and ≥ 4 caps').toBeGreaterThanOrEqual(0.9);
  expect.soft(hexes.filter((h) => kindOf(h) === 'token').length, 'wandering tokens drawn').toBe(0);
  expect.soft(hexes.filter((h) => kindOf(h) === 'core').length, 'cap cores drawn').toBe(0);
  expect.soft(hexes.filter((h) => kindOf(h) === 'unknown').slice(0, 3), 'hexagons that are not a cell, cap or cap core').toEqual([]);
  expect(dialogs).toEqual([]);
});

/** Where the App's panels end, relative to the canvas centre (the hex layer's origin; the canvas fills
 *  the viewport): the header's bottom edge and the player bar's top edge, as boxes on the page. */
async function panelEdges(page: Page): Promise<{ top: number; bottom: number }> {
  const header = await page.getByRole('banner').boundingBox();
  const bar = await page.getByTestId('player-bar').boundingBox();
  const centre = (await page.evaluate(() => innerHeight)) / 2;
  return { top: header!.y + header!.height - centre, bottom: bar!.y - centre };
}

/** Caps and curves drawn past those edges: a cap by its outer edge (a flat-topped hexagon is
 *  r·√3/2 tall each way, plus half its stroke), a curve by its exact extent plus half its stroke. */
function pastPanels(frames: Frame[], edges: { top: number; bottom: number }): string[] {
  const out: string[] = [];
  for (const f of frames) {
    for (const h of f.hexes) {
      if (kindOf(h) !== 'cap') continue;
      const e = (h.r * Math.sqrt(3)) / 2 + h.lw / 2;
      if (h.cy - e < edges.top || h.cy + e > edges.bottom) out.push(`cap at y ${h.cy.toFixed(1)}, r ${h.r.toFixed(1)}`);
    }
    for (const c of f.curves) {
      if (c.ymin - c.lw / 2 < edges.top || c.ymax + c.lw / 2 > edges.bottom) out.push(`curve over y ${c.ymin.toFixed(1)}..${c.ymax.toFixed(1)}`);
    }
  }
  return out;
}

/** The highest cap of any frame, px from the centre row. */
const capReach = (frames: Frame[]) => Math.max(0, ...frames.flatMap((f) => f.hexes.filter((h) => kindOf(h) === 'cap').map((h) => Math.abs(h.cy))));
/** Share of frames drawing the lens: four caps or more, and the line (10 curves). */
const lensShare = (frames: Frame[]) => frames.filter((f) => countKind(f, 'cap') >= 4 && f.curves.length === 10).length / Math.max(1, frames.length);

test('the lens fits between the header and the player bar, and fills the screen in Zen Mode @mobile', async ({ page }) => {
  test.setTimeout(180_000); // three recordings and Zen Mode's 3 s timeout, on a slow device
  const dialogs = await openOnPhone(page);
  await importTones(page, 1, 120);
  await playFirstTone(page);
  await recordFor(page, 3000, 15); // the lens fades in
  const edges = await panelEdges(page);
  const shown = await recordFor(page, 6000, 60);
  expect({ w: shown[0].w, h: shown[0].h }, 'the canvas is the phone viewport').toEqual({ w: PHONE.width, h: PHONE.height });
  expect(await panelEdges(page), 'the panels held still while recording').toEqual(edges);

  // Zen Mode: the UI fades out 3 s after the last mouse move, and the lens eases out to the full screen. Not by role:
  // the hidden UI is inert (v15.4), so it is out of the accessibility tree.
  const ui = page.locator('header').locator('xpath=..');
  await page.getByTitle('Zen Mode (Hide UI)', { exact: true }).click();
  await expect(ui, 'Zen Mode hides the UI').toHaveClass(/opacity-0/, { timeout: 15_000 });
  await recordFor(page, 2000, 15);
  const zen = await recordFor(page, 6000, 60);

  // The UI back (and the pointer off the player bar, whose hover makes its seek strip taller): the
  // lens eases back in between the panels; its caps hang, then fall. The hidden UI is inert (v15.4): a mouse move
  // brings it back first, then Show UI can be clicked.
  await page.mouse.move(PHONE.width / 2, PHONE.height / 2);
  await expect(ui).not.toHaveAttribute('inert');
  await page.getByTitle('Show UI', { exact: true }).click();
  await expect(ui).not.toHaveClass(/opacity-0/);
  await page.mouse.move(PHONE.width / 2, PHONE.height / 2);
  await recordFor(page, 3000, 30);
  const backEdges = await panelEdges(page);
  const back = await recordFor(page, 4000, 40);

  expect.soft(lensShare(shown), 'the UI showing: frames drawing the caps and the line').toBeGreaterThanOrEqual(0.9);
  expect.soft(pastPanels(shown, edges).slice(0, 3), 'the UI showing: caps and curves drawn behind the header or the player bar').toEqual([]);
  expect.soft(lensShare(zen), 'Zen Mode: frames drawing the caps and the line').toBeGreaterThanOrEqual(0.9);
  // The fallback pulse lifts the centre caps ~190 px with the UI showing and ~340 px in Zen Mode.
  expect.soft(capReach(zen), 'Zen Mode: the highest cap (px from the centre) vs with the UI showing').toBeGreaterThanOrEqual(1.3 * capReach(shown));
  expect.soft(capReach(zen), 'Zen Mode: caps reach where the player bar was').toBeGreaterThan(edges.bottom);
  expect.soft(lensShare(back), 'the UI back: frames drawing the caps and the line').toBeGreaterThanOrEqual(0.9);
  expect.soft(pastPanels(back, backEdges).slice(0, 3), 'the UI back: caps and curves drawn behind the panels').toEqual([]);
  expect(dialogs).toEqual([]);
});
