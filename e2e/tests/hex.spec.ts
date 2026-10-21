import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openApp, acceptDisclaimer, importTones, elapsedSeconds, openHarmonicControl } from './helpers';

// v14.7: the wandering hexes and the Cooler frame rate, read off the perf HUD
// (?perf=1, utils/perfHud.ts). Once a second it shows `draws N/s …` and, in a
// second in which the hex wander ran, a line `hex <moves>/s on <tokens on
// screen> glide <tokens gliding> e<pace> <µs>µs`; with the wander off that part
// is absent. While nothing plays the wander runs held (no new moves), so moves
// need music. Headless Chrome delivers rAF at ~120 Hz here, but on the Vite dev
// server a playing track holds draws at ~10–17/s (React dev-build commits, the
// same with the wander off), so the frame-rate test plays nothing. Tests that
// need the music still playing at their end use 120 s tones: a slower device
// must not run out of track before the last check. The last test reads what
// the canvas actually draws.

const VIZ_SETTINGS_KEY = 'aetheria.vizSettings.v1';

interface HudWindow {
  draws: number;
  /** The hex wander's part of the line; null in a second it didn't run. */
  hex: { moves: number; onScreen: number; gliding: number } | null;
}

function parseHud(line: string): HudWindow {
  const draws = /draws ([\d.]+)\/s/.exec(line);
  if (!draws) throw new Error(`Not a perf HUD line: ${line}`);
  const hex = /hex ([\d.]+)\/s on ([\d.]+) glide ([\d.]+) e/.exec(line);
  return {
    draws: Number(draws[1]),
    hex: hex ? { moves: Number(hex[1]), onScreen: Number(hex[2]), gliding: Number(hex[3]) } : null,
  };
}

/**
 * Record every line the perf HUD shows in window.__hud (call before openApp;
 * each page load starts a new record). Watching the element rather than
 * polling it, so no one-second window is missed or read twice.
 */
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

/** Hex moves per second in the latest window; none when the wander didn't run. */
const latestMoves = async (page: Page) => (await latestHud(page))?.hex?.moves ?? 0;

/** Within 10 s, three windows in a row draw lo–hi frames a second. */
async function expectDrawsSettle(page: Page, lo: number, hi: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const last: string[] = await page.evaluate(() => (window as any).__hud.slice(-3));
        const draws = last.map((l) => parseHud(l).draws);
        return draws.length === 3 && draws.every((d) => d >= lo && d <= hi) ? 'settled' : `draws/s ${draws.join(', ')}`;
      },
      { timeout: 10_000, message: `draws/s settle in [${lo}, ${hi}]` }
    )
    .toBe('settled');
}

const wanderSwitch = (page: Page) => page.getByRole('switch', { name: 'Wandering hexes' });
/** The Hex Visual Mode select (it has no label of its own). */
const hexModeSelect = (page: Page) => page.locator('select', { has: page.locator('option[value="pulse"]') });
const savedViz = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), VIZ_SETTINGS_KEY);

/** Harmonic Control's Visualization Engine section, opened the way a user does. */
async function openVisualization(page: Page): Promise<void> {
  await openHarmonicControl(page);
  // It starts expanded; tapping its header expands it otherwise.
  if (!(await wanderSwitch(page).isVisible())) await page.getByRole('button', { name: 'Visualization Engine' }).click();
  await expect(wanderSwitch(page)).toBeVisible();
}

/** Play tone-01 (imported already) and wait until it is under way. */
async function playFirstTone(page: Page): Promise<void> {
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
}

test('wandering hexes are on by default, come up on from an older save, and stay off once switched off', async ({ page }) => {
  await recordHud(page);
  const dialogs = await openApp(page, { query: '?perf=1' });
  await openVisualization(page);
  await expect(wanderSwitch(page)).toHaveAttribute('aria-checked', 'true');
  // The default mode is Spectrum, where (from v14.8) the tokens ride the lens: the usual line.
  await expect(wanderSwitch(page)).toHaveAccessibleDescription(
    'Off-colour hexes glide to a neighbouring cell every few seconds, faster when the music is busy.'
  );
  // The visualizer runs it too (held, as nothing plays): the HUD has its part.
  await expect.poll(async () => (await latestHud(page))?.hex ?? null).not.toBeNull();
  // Untapped, neither setting is saved, so their defaults can still change later.
  const fresh = await savedViz(page);
  expect(fresh, 'the visual settings are saved').not.toBeNull();
  expect(Object.keys(fresh)).not.toContain('hexWander');
  expect(Object.keys(fresh)).not.toContain('frameRate');

  // A v14.6 save has neither key. Radial Pulse shows the save was read.
  await page.evaluate((k) => {
    const saved = JSON.parse(localStorage.getItem(k)!);
    delete saved.hexWander;
    delete saved.frameRate;
    saved.hexVisualMode = 'pulse';
    localStorage.setItem(k, JSON.stringify(saved));
  }, VIZ_SETTINGS_KEY);
  await page.reload();
  await acceptDisclaimer(page);
  await openVisualization(page);
  await expect(hexModeSelect(page)).toHaveValue('pulse');
  await expect(wanderSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Standard · 30 fps' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await latestHud(page))?.hex ?? null).not.toBeNull();

  await wanderSwitch(page).click();
  await expect(wanderSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(wanderSwitch(page)).toHaveAccessibleDescription('Off-colour hexes stay in their original places.');
  expect(await savedViz(page)).toMatchObject({ hexWander: false });

  // Off holds across a reload, in the switch and in the visualizer from its first frame.
  await page.reload();
  await acceptDisclaimer(page);
  await openVisualization(page);
  await expect(wanderSwitch(page)).toHaveAttribute('aria-checked', 'false');
  // (The first window may close before the visualizer's first frame.)
  for (const w of await hudWindows(page, 1, 3)) {
    expect(w.draws).toBeGreaterThan(0);
    expect(w.hex).toBeNull();
  }
  expect(dialogs).toEqual([]);
});

test('the hexes wander while music plays and hold still once it is paused @mobile', async ({ page }) => {
  await recordHud(page);
  const dialogs = await openApp(page, { query: '?perf=1' });
  await importTones(page, 1, 30);
  await playFirstTone(page);
  await openVisualization(page);
  await hexModeSelect(page).selectOption('pulse');
  await expect.poll(() => latestMoves(page), { timeout: 10_000 }).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const paused = await hudCount(page);
  // The window under way still counts moves from before the pause, and the
  // next may open before the hold reaches the loop. From then on: no moves,
  // and once the glides under way have finished (≤ 1.2 s), nothing glides.
  const after = await hudWindows(page, paused + 2, 6);
  for (const w of after) {
    expect(w.hex, 'the wander runs on, held, while paused').not.toBeNull();
    expect(w.hex!.moves).toBe(0);
    expect(w.draws).toBeGreaterThan(0);
  }
  for (const w of after.slice(2)) expect(w.hex!.gliding).toBe(0);
  expect(dialogs).toEqual([]);
});

test('switched off, the hexes stay put while music plays', async ({ page }) => {
  await recordHud(page);
  const dialogs = await openApp(page, { query: '?perf=1' });
  await importTones(page, 1, 120);
  await playFirstTone(page);
  await openVisualization(page);
  await hexModeSelect(page).selectOption('pulse');
  // On, they move: the HUD can see moves here.
  await expect.poll(() => latestMoves(page), { timeout: 10_000 }).toBeGreaterThan(0);

  await wanderSwitch(page).click();
  await expect(wanderSwitch(page)).toHaveAttribute('aria-checked', 'false');
  const off = await hudCount(page);
  const playedTo = await elapsedSeconds(page);
  // Past the window under way and the next: no moves, because the wander
  // doesn't run at all (off is the v14.6 static path), while the loop draws on.
  for (const w of await hudWindows(page, off + 2, 5)) {
    expect(w.hex?.moves ?? 0, 'moves/s').toBe(0);
    expect(w.hex, 'the wander runs while off').toBeNull();
    expect(w.draws).toBeGreaterThan(0);
  }
  expect(await elapsedSeconds(page)).toBeGreaterThan(playedTo);
  expect(dialogs).toEqual([]);
});

test('reduced motion holds the hexes still while music plays, and lifting it resumes them without a reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await recordHud(page);
  const dialogs = await openApp(page, { query: '?perf=1' });
  await importTones(page, 1, 120);
  await playFirstTone(page);
  await openVisualization(page);
  await hexModeSelect(page).selectOption('pulse');
  await expect(wanderSwitch(page)).toHaveAccessibleDescription('Held still: this device asks for reduced motion.');

  const playedTo = await elapsedSeconds(page);
  const from = await hudCount(page);
  for (const w of await hudWindows(page, from, 5)) expect(w.hex, 'the wander runs, held').not.toBeNull();
  expect(await elapsedSeconds(page)).toBeGreaterThan(playedTo);
  // Held from the first frame: no window since the load counted a move, so nothing ever glided.
  for (const w of await hudWindows(page, 0, from + 5)) {
    expect(w.hex?.moves ?? 0).toBe(0);
    expect(w.hex?.gliding ?? 0).toBe(0);
  }

  await page.evaluate(() => ((window as any).__samePage = true));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(wanderSwitch(page)).toHaveAccessibleDescription(/^Off-colour hexes glide to a neighbouring cell/);
  await expect(page.getByRole('button', { name: 'Pause', exact: true }), 'the tone is still playing').toBeVisible();
  await expect.poll(() => latestMoves(page), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__samePage)).toBe(true);
  expect(dialogs).toEqual([]);
});

test('Cooler draws ~20 frames a second, Standard 30, and the choice is saved', async ({ page }) => {
  await recordHud(page);
  const dialogs = await openApp(page, { query: '?perf=1' });
  await openVisualization(page);
  const standard = page.getByRole('button', { name: 'Standard · 30 fps' });
  const cooler = page.getByRole('button', { name: 'Cooler · ~20 fps' });
  await expect(standard).toHaveAttribute('aria-pressed', 'true');
  await expect(cooler).toHaveAttribute('aria-pressed', 'false');
  await expectDrawsSettle(page, 27, 31);

  await cooler.click();
  await expect(cooler).toHaveAttribute('aria-pressed', 'true');
  await expect(standard).toHaveAttribute('aria-pressed', 'false');
  await expectDrawsSettle(page, 17, 22);
  expect(await savedViz(page)).toMatchObject({ frameRate: 'cooler' });

  // Saved: a reload draws at Cooler's rate before the panel is even opened.
  await page.reload();
  await acceptDisclaimer(page);
  await expectDrawsSettle(page, 17, 22);
  await openVisualization(page);
  await expect(cooler).toHaveAttribute('aria-pressed', 'true');

  await standard.click();
  await expect(standard).toHaveAttribute('aria-pressed', 'true');
  await expectDrawsSettle(page, 27, 31);
  expect(dialogs).toEqual([]);
});

test('no errors, and the visualizer keeps drawing, across play, track change, density, the switch, Spectrum and a resize', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // (The suite blocks service workers, so the app logs a [SW] registration error.)
    if (m.type() === 'error' && !m.text().startsWith('[SW]')) errors.push(m.text());
    // The wander's safety net caught an exception and went static.
    if (m.text().startsWith('[hexWander]')) errors.push(m.text());
    // Spectrum's safety net caught one: it draws no hexes for the rest of the session.
    if (m.text().startsWith('[spectrum]')) errors.push(m.text());
  });
  // Errors are checked as each step ends, so a failure names the error and not
  // only its symptom: an exception in the effect's first render() call
  // unmounts the whole app, and the next locator just finds nothing.
  const step = (title: string, body: () => Promise<void>) =>
    test.step(title, async () => {
      try {
        await body();
      } finally {
        expect(errors, `errors during "${title}"`).toEqual([]);
      }
    });
  await recordHud(page);
  const dialogs = await openApp(page, { query: '?perf=1' });
  await importTones(page, 2, 120);
  const start = await hudCount(page);

  await step('play in Radial Pulse', async () => {
    await playFirstTone(page);
    await openVisualization(page);
    await hexModeSelect(page).selectOption('pulse');
    await expect.poll(() => latestMoves(page), { timeout: 10_000 }).toBeGreaterThan(0);
  });
  await step('change track', async () => {
    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(page.getByTestId('now-playing-title')).toHaveText('tone-02');
    await page.waitForTimeout(1500);
  });
  await step('change particle density', async () => {
    // Each density rebuilds the grid, and the wander with it.
    const density = page.getByText('Particle Density', { exact: true }).locator('xpath=..');
    for (const d of [/^low$/i, /^high$/i, /^medium$/i]) {
      await density.getByRole('button', { name: d }).click();
      await page.waitForTimeout(1500);
    }
  });
  await step('switch the wander off and on', async () => {
    await wanderSwitch(page).click();
    await expect(wanderSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await page.waitForTimeout(2000);
    await wanderSwitch(page).click();
    await expect(wanderSwitch(page)).toHaveAttribute('aria-checked', 'true');
  });
  await step('switch to Spectrum and back', async () => {
    await hexModeSelect(page).selectOption('spectrum');
    await page.waitForTimeout(3000);
    await hexModeSelect(page).selectOption('pulse');
    await page.waitForTimeout(2000);
  });
  await step('resize to a phone and back', async () => {
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForTimeout(2000);
    await page.setViewportSize(size);
    // Still wandering after all of it.
    await expect(page.getByRole('button', { name: 'Pause', exact: true }), 'the tone is still playing').toBeVisible();
    await expect.poll(() => latestMoves(page), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  // Every second since play drew frames: the loop never died.
  const windows = await hudWindows(page, start, (await hudCount(page)) - start);
  windows.forEach((w, i) => expect(w.draws, `HUD window ${start + i}`).toBeGreaterThan(0));
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

// What the hex layer actually DRAWS, read off the 2D context: every stroked
// flat-top hexagon, per frame (a frame starts at the full-canvas clear), with
// its line width (1 = a primary cell, 2 = an off-colour hex) and its centre in
// grid coordinates (the layer draws inside translate(cx, cy)). The expected
// lattice is built here from the v14.6 grid formulas, not from utils/hexWander,
// so it can't agree with a bug there.
const PHI = (1 + Math.sqrt(5)) / 2;
const X_OFFSET = Math.sqrt(3) * 50;
const LATTICE: { x: number; y: number; home: boolean }[] = [];
{
  let index = 0;
  for (let r = -15; r < 15; r++) {
    for (let c = -20; c < 20; c++) {
      LATTICE.push({
        x: (c * X_OFFSET) + ((r % 2) * X_OFFSET / 2),
        y: r * 75,
        home: (Math.abs((c * r * PHI) + index) * PHI) % 1 > 0.69,
      });
      index++;
    }
  }
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

type DrawnHex = { lw: number; cx: number; cy: number };

/** Record the stroked hexagons of the last ~600 frames in window.__frames (call before openApp). */
async function recordHexDraws(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__frames = [];
    let frame: any[] | null = null;
    let path: number[] = [];
    const P = CanvasRenderingContext2D.prototype as any;
    const fillRect = P.fillRect;
    P.fillRect = function (x: number, y: number, width: number, height: number) {
      if (x === 0 && y === 0 && width === this.canvas.width && height === this.canvas.height) {
        if (frame) {
          w.__frames.push(frame);
          if (w.__frames.length > 600) w.__frames.shift();
        }
        frame = [];
      }
      return fillRect.call(this, x, y, width, height);
    };
    const beginPath = P.beginPath;
    P.beginPath = function () {
      path = [];
      return beginPath.call(this);
    };
    const moveTo = P.moveTo;
    P.moveTo = function (x: number, y: number) {
      path.push(x, y);
      return moveTo.call(this, x, y);
    };
    const lineTo = P.lineTo;
    P.lineTo = function (x: number, y: number) {
      path.push(x, y);
      return lineTo.call(this, x, y);
    };
    const stroke = P.stroke;
    P.stroke = function (...args: unknown[]) {
      // A grid hexagon: 6 corners, corner 0 at (x + size, y) and corner 3 at (x − size, y).
      if (frame && path.length === 12) {
        const size = (path[0] - path[6]) / 2;
        if (size > 40 && size < 120 && Math.abs(path[1] - path[7]) < 1e-6) {
          frame.push({ lw: this.lineWidth, cx: (path[0] + path[6]) / 2, cy: (path[1] + path[7]) / 2 });
        }
      }
      return stroke.apply(this, args);
    };
  });
}

test('what the hex layer draws: tokens on cells or mid-glide and never closer than 75 px, and the original layout when off', async ({ page }) => {
  await recordHexDraws(page);
  const dialogs = await openApp(page);
  await importTones(page, 1, 120);
  await playFirstTone(page);
  await openVisualization(page);
  await hexModeSelect(page).selectOption('pulse');

  // ON: the off-colour hexes are tokens.
  await page.evaluate(() => ((window as any).__frames = []));
  await page.waitForTimeout(8000);
  const on: DrawnHex[][] = await page.evaluate(() => (window as any).__frames);
  let framesWithTokens = 0;
  let midGlide = 0;
  let offLattice = 0;
  let underRestingToken = 0;
  let minDistance = Infinity;
  for (const frame of on) {
    const tokens = frame.filter((h) => h.lw === 2);
    const cells = frame.filter((h) => h.lw === 1);
    if (tokens.length) framesWithTokens++;
    for (const t of tokens) {
      const near = nearestCell(t.cx, t.cy);
      if (near.distance < 0.5) {
        // Resting (exactly on its cell): its own cell must not be drawn under it.
        // A token a hair into its glide is drawn over a near-invisible fading cell.
        if (near.distance < 1e-6 && cells.some((c) => Math.hypot(c.cx - t.cx, c.cy - t.cy) < 1e-6)) underRestingToken++;
      } else {
        // Gliding: on the edge from its nearest cell to a neighbour.
        const a = LATTICE[near.at];
        const onEdge = LATTICE.some((b) => Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - X_OFFSET) < 1e-6 &&
          segmentDistance(t.cx, t.cy, a, b) < 0.5);
        if (onEdge) midGlide++;
        else offLattice++;
      }
    }
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        minDistance = Math.min(minDistance, Math.hypot(tokens[i].cx - tokens[j].cx, tokens[i].cy - tokens[j].cy));
      }
    }
  }

  // OFF: today's static layout, every off-colour hex on its golden-ratio home cell.
  await wanderSwitch(page).click();
  await expect(wanderSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await page.waitForTimeout(500);
  await page.evaluate(() => ((window as any).__frames = []));
  await page.waitForTimeout(6000);
  const off: DrawnHex[][] = await page.evaluate(() => (window as any).__frames);
  let offColour = 0;
  let notHome = 0;
  for (const frame of off) {
    for (const h of frame.filter((x) => x.lw === 2)) {
      offColour++;
      const near = nearestCell(h.cx, h.cy);
      if (!(near.distance < 1e-6 && LATTICE[near.at].home)) notHome++;
    }
  }

  expect.soft(on.length, 'ON: frames were drawn').toBeGreaterThan(0);
  expect.soft(framesWithTokens, 'ON: tokens are drawn').toBeGreaterThan(0);
  expect.soft(midGlide, 'ON: some tokens are drawn mid-glide').toBeGreaterThan(0);
  expect.soft(offLattice, 'ON: every token is on a cell or on the edge between two').toBe(0);
  expect.soft(minDistance, 'ON: tokens drawn in one frame are at least 75 px apart').toBeGreaterThanOrEqual(75 - 1e-6);
  expect.soft(underRestingToken, 'ON: no cell is drawn under a resting token').toBe(0);
  expect.soft(offColour, 'OFF: the off-colour hexes are drawn').toBeGreaterThan(0);
  expect.soft(notHome, 'OFF: every off-colour hex is on its home cell').toBe(0);
  expect(dialogs).toEqual([]);
});
