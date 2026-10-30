import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  PHONE_VIEWPORT,
  crash,
  drawsPerSecond,
  layerState,
  instrumentAudio,
  libraryRowButton,
  libraryState,
  openHarmonicControl,
  openLibraryTab,
  pauseCount,
  recordHudDraws,
  renders,
  resetRenders,
  sheet,
  tab,
  tapCount,
  acceptDisclaimerNew,
} from './helpers';
import {
  DRAWING,
  PALETTE_KEY,
  PAUSED_KEY,
  canvasHidden,
  moreRow,
  openVisuals,
  playingSeeded,
  savedViz,
  smallTargets,
  stored,
  unnamedControls,
  visualsSheet,
  vizChoice,
  vizJump,
  vizSlider,
  vizSwitch,
} from './moreKit';
import { SLIDER_WRITE_MS } from '../../components/shell/more/visualsModel.ts';

// v16.4, the Visuals sheet (spec §3.3, §5.3 visuals.spec; decision 1 A): every classic visual setting and the crystal
// palette, writing the same state classic's controls write; hexWander and frameRate only from their own tap; the live
// preview (a transparent scrim, 55 % of the screen, the visuals drawing); the slider throttle that keeps a drag inside
// the 30 fps cap; Pause visuals; the ways in; the Car screen; the desktop panel; the rows that depend on others.
// Every test fails on v16.1, which has no Visuals sheet (§5.4).

/** Classic's Visualization Engine (Harmonic Control), from the new layout: ⋯ › Back to classic, then the gear. */
async function toClassicEngine(page: Page): Promise<void> {
  if (await page.getByTestId('sheet-visuals').isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await expect(page.getByTestId('sheet-visuals')).toHaveCount(0);
  await tab(page, 'now');
  await page.getByTestId('np-menu-button').click();
  await page.getByTestId('menu-back-to-classic').click();
  await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
  const close = page.getByRole('button', { name: 'Close Safety Panel' });
  if (await close.isVisible().catch(() => false)) await close.evaluate((b) => (b as HTMLButtonElement).click());
  await openHarmonicControl(page);
  await page.getByRole('switch', { name: 'Wandering hexes' }).waitFor({ state: 'attached' });
}

/** Back into the new layout from Harmonic Control (its opt-in pill). */
async function toNewLayout(page: Page): Promise<void> {
  await page.getByTestId('try-new-layout').evaluate((b) => (b as HTMLButtonElement).click());
  await page.getByTestId('new-shell').waitFor();
}

/** Classic's controls, read from the DOM (they need not be on screen). */
const classic = {
  select: (page: Page) => page.locator('select[aria-label="Hex visual mode"]'),
  colour: (page: Page, title: string) => page.locator(`button[title="${title}"]`),
  hexGrid: (page: Page) => page.locator('button').filter({ hasText: /^Hex Grid (ON|OFF)$/ }),
  opacity: (page: Page) => page.locator('input[title="Hex Opacity"]'),
  sw: (page: Page, name: string) => page.getByRole('switch', { name, exact: true }),
  range: (page: Page, label: string) => page.locator(`input[type="range"][aria-label="${label}"]`),
  trails: (page: Page) => page.locator('span', { hasText: 'Astral Trails' }).locator('xpath=following-sibling::button[1]'),
  text: (page: Page, re: RegExp) => page.locator('button').filter({ hasText: re }),
  cubeLine: (page: Page) => page.locator('p').filter({ hasText: /^27 sub-cubes|^Render the 3×3×3/ }),
  frameRate: (page: Page, label: string) => page.locator('[aria-labelledby="frame-rate-label"]').getByRole('button', { name: label, exact: true }),
};

const domClick = (l: Locator) => l.evaluate((el) => (el as HTMLElement).click());

/**
 * v16.4 review: a spy on the saved visual settings, from the first script on: every write of the key with its time and
 * the value of `field`, and the time of the last pointerup and keyup (window, capture), all on performance.now().
 * v16.4 re-review: and every range input's input event (window, capture: before the slider's own handler pushes the
 * value to its throttle), with its value and label.
 */
async function spyVizWrites(page: Page, field: string): Promise<void> {
  await page.addInitScript(
    ({ key, field }) => {
      const w = window as any;
      w.__vizWrites = 0;
      w.__vizLog = [] as Array<{ t: number; v: unknown }>;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
        if (k === key) {
          w.__vizWrites++;
          let value: unknown = null;
          try {
            value = JSON.parse(v)?.[field] ?? null;
          } catch {}
          w.__vizLog.push({ t: performance.now(), v: value });
        }
        return set.call(this, k, v);
      };
      window.addEventListener('pointerup', () => (w.__upAt = performance.now()), true);
      window.addEventListener('keyup', () => (w.__keyUpAt = performance.now()), true);
      w.__inputLog = [] as Array<{ t: number; v: number; label: string | null }>;
      window.addEventListener(
        'input',
        (e) => {
          const el = e.target as HTMLInputElement | null;
          if (el && el.type === 'range') w.__inputLog.push({ t: performance.now(), v: Number(el.value), label: el.getAttribute('aria-label') });
        },
        true
      );
    },
    { key: 'aetheria.vizSettings.v1', field }
  );
}

type VizWrite = { t: number; v: number };
type RangeInput = { t: number; v: number; label: string | null };

/** The spy's log so far. */
const vizLog = (page: Page) => page.evaluate(() => [...(window as any).__vizLog]) as Promise<VizWrite[]>;
/** The range inputs' input events so far. */
const inputLog = (page: Page) => page.evaluate(() => [...(window as any).__inputLog]) as Promise<RangeInput[]>;

/** The tries a release check gets before it fails as untimeable (each a fresh short drag or two presses). */
const RELEASE_TRIES = 5;

/**
 * Wait until the slider's throttle is idle: nothing input, released or written for SLIDER_WRITE_MS + 150 ms. Its next
 * step then writes at once (the throttle's leading write).
 */
async function throttleIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    (quiet) => {
      const w = window as any;
      const lastOf = (a: Array<{ t: number }>) => (a.length ? a[a.length - 1].t : 0);
      const last = Math.max(lastOf(w.__vizLog), lastOf(w.__inputLog), w.__upAt ?? 0, w.__keyUpAt ?? 0);
      return performance.now() - last >= quiet;
    },
    SLIDER_WRITE_MS + 150,
    { timeout: 10_000, polling: 20 }
  );
}

/**
 * The release check (v16.4 re-review: decided on the page's own clock, so a slow machine's round trips can't fail a
 * right app). Always: the value `final` is saved, within 120 ms of the release (`releasedAt`). And it must be the
 * release's own flush (pointerup, change, keyup) that saved it, not the throttle's trailing timer. That timer is set
 * only after the write before the final one and fires at least SLIDER_WRITE_MS after it, and that write came after the
 * input event that pushed its value (`pushed`, this try's input log, each value once in a try). So a final write before
 * pushed + SLIDER_WRITE_MS can only be the release's flush: decided. Later than that the round trips let the timer in,
 * and nothing is decided: the caller tries again. Returns whether this try decided it. First, the value under the finger
 * at the release (this try's last input event) must be the one saved: a release that drops it or saves it late shows
 * the slider back at the value saved before.
 */
function releaseLandsAtOnce(log: VizWrite[], inputs: RangeInput[], label: string, from: number, since: number, final: number, releasedAt: number, what: string): boolean {
  const released = inputs.filter((e) => e.label === label && e.t >= since).pop();
  expect(released, `${what}: the try's steps were input`).toBeTruthy();
  expect(final, `${what}: the value under the finger at the release (${released!.v}) is the one saved`).toBeCloseTo(released!.v, 9);
  const landed = log.findIndex((e, i) => i >= from && e.v === final);
  expect(landed, `${what}: the final value ${final} is saved`).toBeGreaterThanOrEqual(from);
  const at = log[landed].t;
  const prev = log[landed - 1];
  const pushed = prev ? inputs.filter((e) => e.label === label && e.t >= since && e.t <= prev.t && Math.abs(e.v - prev.v) < 1e-9).pop() : undefined;
  // (3 ms for the clocks' granularity.)
  const decided = !!pushed && at < pushed.t + SLIDER_WRITE_MS - 3;
  test.info().annotations.push({
    type: `${what}: the final write`,
    description:
      `${Math.round(at - releasedAt)} ms after the release; ` +
      (pushed ? `${Math.round(at - pushed.t)} ms after the step before it was input (the trailing timer: at least ${SLIDER_WRITE_MS} ms)` : 'the write before it is not this try\'s') +
      (decided ? '' : ': not decided, tried again'),
  });
  expect(at - releasedAt, `${what}: the final value lands at once on release`).toBeLessThanOrEqual(120);
  return decided;
}

/** Press a key on a slider `n` times (each step is a keyboard release: written at once). */
async function stepSlider(slider: Locator, key: 'ArrowRight' | 'ArrowLeft', n: number): Promise<void> {
  await slider.focus();
  for (let i = 0; i < n; i++) await slider.press(key);
}

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('V1. every control writes the state classic writes, classic shows it, and a change in classic shows in the sheet; two changes in one task both land', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await playingSeeded(page);
    await openVisuals(page, 'more');
    const S = visualsSheet(page);
    // Look.
    await S.getByTestId('visuals-hex-mode').locator('select').selectOption('pulse');
    await vizChoice(page, 'Visualizer colours', 'Hypnotic').click();
    await expect(S.getByTestId('visuals-colour-line')).toHaveText('RGB cycle synced to audio energy');
    await vizChoice(page, 'Crystal colours', 'Spectrum').click();
    // Hexes.
    await vizJump(page, 'hexes');
    await vizSwitch(page, 'Hex grid').click();
    await stepSlider(vizSlider(page, 'Hex opacity'), 'ArrowLeft', 2);
    await vizSwitch(page, 'Wandering hexes').click();
    // Overlays.
    await vizJump(page, 'overlays');
    await vizSwitch(page, 'Tree of Life').click();
    await vizSwitch(page, 'Show Sacred Geometry').click();
    await vizSwitch(page, 'Astral Trails').click();
    await vizSwitch(page, 'Hydro-Acoustics').click();
    await stepSlider(vizSlider(page, 'Ripple intensity'), 'ArrowRight', 1);
    await vizSwitch(page, 'Lo Shu Cube').click();
    await vizSwitch(page, 'Auto-Rotate').click();
    await stepSlider(vizSlider(page, 'Position'), 'ArrowRight', 5);
    await vizSwitch(page, 'Vortex').click();
    // Motion.
    await vizJump(page, 'motion');
    await stepSlider(vizSlider(page, 'Simulation speed'), 'ArrowRight', 1);
    await stepSlider(vizSlider(page, 'Audio reactivity'), 'ArrowLeft', 1);
    await vizChoice(page, 'Rotation', 'Rotate').click();
    await vizChoice(page, 'Rotation', 'Ascension').click();
    await vizChoice(page, 'Particle physics (mixable)', 'Float').click();
    await vizChoice(page, 'Particle density', 'High').click();
    await stepSlider(vizSlider(page, 'Particle size'), 'ArrowRight', 1);
    // Comfort.
    await vizJump(page, 'comfort');
    await vizChoice(page, 'Frame rate', 'Cooler · ~20 fps').click();

    const want = {
      hexVisualMode: 'pulse',
      colorMode: 'cycle',
      showHexagons: false,
      hexOpacity: 0.4,
      hexWander: false,
      showTreeOfLife: true,
      morphEnabled: false,
      enableTrails: true,
      showWaterRipples: true,
      hydroIntensity: 51,
      showLoShuCube: true,
      loShuCubeAutoRotate: false,
      loShuCubeRotation: 5,
      loShuShowVortex: true,
      speed: 1.1,
      sensitivity: 0.9,
      autoRotate: false,
      invertPerspective: true,
      enableFloat: true,
      enableFlow: true,
      particleDensity: 'high',
      particleBaseSize: 4,
      frameRate: 'cooler',
    };
    await expect.poll(() => savedViz(page), { message: 'the saved settings hold every change' }).toMatchObject(want);
    expect(await stored(page, PALETTE_KEY), 'Crystal colours writes the palette key').toBe('spectrum');
    const saved = (await savedViz(page))!;
    expect(saved.hexOpacity as number).toBeCloseTo(0.4, 5);

    // Classic shows each of them.
    await toClassicEngine(page);
    await expect(classic.select(page)).toHaveValue('pulse');
    await expect(classic.colour(page, 'RGB cycle synced to audio energy')).toHaveClass(/bg-purple-500 /);
    await expect(classic.hexGrid(page)).toHaveText('Hex Grid OFF');
    expect(Number(await classic.opacity(page).inputValue())).toBeCloseTo(0.4, 5);
    await expect(classic.sw(page, 'Wandering hexes')).toHaveAttribute('aria-checked', 'false');
    await expect(classic.sw(page, 'Tree of Life')).toHaveAttribute('aria-checked', 'true');
    await expect(classic.sw(page, 'Show Sacred Geometry')).toHaveAttribute('aria-checked', 'false');
    await expect(classic.trails(page)).toHaveClass(/bg-gold-500/);
    await expect(classic.sw(page, 'Hydro-Acoustics')).toHaveAttribute('aria-checked', 'true');
    await expect(classic.range(page, 'Ripple intensity')).toHaveValue('51');
    await expect(classic.sw(page, 'Lo Shu Cube')).toHaveAttribute('aria-checked', 'true');
    await expect(classic.cubeLine(page), 'the cube is tinted by the palette the sheet chose').toContainText('visible-light wavelength');
    await expect(classic.sw(page, 'Auto-Rotate')).toHaveAttribute('aria-checked', 'false');
    await expect(classic.range(page, 'Lo Shu cube position')).toHaveValue('5');
    await expect(classic.sw(page, 'Vortex')).toHaveAttribute('aria-checked', 'true');
    await expect(classic.range(page, 'Simulation speed')).toHaveValue('1.1');
    await expect(classic.range(page, 'Audio reactivity')).toHaveValue('0.9');
    await expect(classic.text(page, /Rotate (ON|OFF)$/)).toHaveText(/Rotate OFF$/);
    await expect(classic.text(page, /Ascension (ON|OFF)$/)).toHaveText(/Ascension ON$/);
    await expect(classic.text(page, /Float$/)).toHaveClass(/bg-purple-500\/20/);
    await expect(classic.text(page, /^high$/)).toHaveClass(/bg-gold-500 text-black/);
    await expect(classic.range(page, 'Particle size')).toHaveValue('4');
    await expect(classic.frameRate(page, 'Cooler · ~20 fps')).toHaveAttribute('aria-pressed', 'true');

    // Changed back in classic: the sheet shows it.
    await classic.select(page).selectOption('wave');
    await domClick(classic.colour(page, 'Chakra palette tied to the current Solfeggio frequency'));
    await domClick(classic.sw(page, 'Tree of Life'));
    await domClick(classic.text(page, /^medium$/));
    await domClick(classic.frameRate(page, 'Standard · 30 fps'));
    await domClick(classic.text(page, /Rotate OFF$/));
    await expect.poll(() => savedViz(page)).toMatchObject({ hexVisualMode: 'wave', colorMode: 'chakra', showTreeOfLife: false, particleDensity: 'medium', frameRate: 'standard', autoRotate: true });
    await toNewLayout(page);
    await openVisuals(page, 'more');
    await expect(S.getByTestId('visuals-hex-mode').locator('select')).toHaveValue('wave');
    await expect(vizChoice(page, 'Visualizer colours', 'Chakra')).toHaveAttribute('aria-pressed', 'true');
    await expect(vizChoice(page, 'Visualizer colours', 'Hypnotic')).toHaveAttribute('aria-pressed', 'false');
    await expect(vizSwitch(page, 'Tree of Life')).toHaveAttribute('aria-checked', 'false');
    await expect(vizChoice(page, 'Particle density', 'Medium')).toHaveAttribute('aria-pressed', 'true');
    await expect(vizChoice(page, 'Frame rate', 'Standard · 30 fps')).toHaveAttribute('aria-pressed', 'true');
    await expect(vizChoice(page, 'Rotation', 'Rotate')).toHaveAttribute('aria-pressed', 'true');
    await expect(vizChoice(page, 'Crystal colours', 'Spectrum')).toHaveAttribute('aria-pressed', 'true');

    // Two changes in one task (a switch, then a choice): both land.
    await vizJump(page, 'overlays');
    await page.evaluate(() => {
      const root = document.querySelector('[data-testid="sheet-visuals"]')!;
      (root.querySelector('[data-testid="visuals-trails"] [role="switch"]') as HTMLElement).click();
      const high = Array.from(root.querySelectorAll('[data-testid="visuals-density"] button')).find((b) => b.textContent?.trim() === 'Low') as HTMLElement;
      high.click();
    });
    await expect.poll(() => savedViz(page), { message: 'a switch and a choice in one task both saved' }).toMatchObject({ enableTrails: false, particleDensity: 'low' });
    expect(dialogs).toEqual([]);
  });

  test('V2. hexWander and frameRate stay unset until their own tap; unset reads as On and Standard', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page);
    await openVisuals(page, 'more');
    await vizJump(page, 'hexes');
    await expect(vizSwitch(page, 'Wandering hexes'), 'unset is On').toHaveAttribute('aria-checked', 'true');
    await vizJump(page, 'comfort');
    await expect(vizChoice(page, 'Frame rate', 'Standard · 30 fps'), 'unset is Standard').toHaveAttribute('aria-pressed', 'true');
    // Other settings change; the two keys stay out of the saved object.
    await vizJump(page, 'overlays');
    await vizSwitch(page, 'Tree of Life').click();
    await vizJump(page, 'motion');
    await stepSlider(vizSlider(page, 'Simulation speed'), 'ArrowRight', 2);
    await expect.poll(() => savedViz(page)).toMatchObject({ showTreeOfLife: true, speed: 1.2 });
    let saved = (await savedViz(page))!;
    expect('hexWander' in saved, 'hexWander unset').toBe(false);
    expect('frameRate' in saved, 'frameRate unset').toBe(false);
    // Their taps write them.
    await vizJump(page, 'hexes');
    await vizSwitch(page, 'Wandering hexes').click();
    await vizJump(page, 'comfort');
    await vizChoice(page, 'Frame rate', 'Standard · 30 fps').click();
    await expect.poll(() => savedViz(page)).toMatchObject({ hexWander: false, frameRate: 'standard' });
    saved = (await savedViz(page))!;
    expect(saved.showTreeOfLife).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('V3. the live preview: 55 % of the screen, a transparent scrim, the visuals drawing; a change shows while open; a tap above closes it @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await recordHudDraws(page);
    const dialogs = await playingSeeded(page);
    await openVisuals(page, 'more');
    const dialog = page.getByRole('dialog', { name: 'Visuals', exact: true });
    const vh = page.viewportSize()!.height;
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.height / vh - 0.55), `the sheet is ${Math.round((box.height / vh) * 1000) / 10} % of the screen`).toBeLessThanOrEqual(0.01);
    expect(Math.round(box.y + box.height), 'at the bottom').toBe(vh);
    const alpha = await page.getByTestId('sheet-visuals').evaluate((root) => {
      const scrim = root.firstElementChild as HTMLElement;
      const c = getComputedStyle(scrim).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(c);
      const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : [];
      return parts.length === 4 ? parts[3] : 1;
    });
    expect(alpha, "the scrim dims nothing").toBe(0);
    expect(await page.getByTestId('sheet-visuals').evaluate((root) => getComputedStyle(root.firstElementChild as HTMLElement).backdropFilter), 'no blur').toBe('none');
    // The visuals draw above it; Now Playing's own panel steps aside.
    await expect.poll(() => canvasHidden(page)).toBe(false);
    const d = (await drawsPerSecond(page, 3)).slice(1);
    expect(Math.min(...d), `draws/s with the sheet open: ${d.join(', ')}`).toBeGreaterThanOrEqual(DRAWING);
    await expect(page.getByTestId('view-now')).toBeHidden();
    // Idle while playing: the sheet renders nothing (DEV).
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const r = await renders(page);
    test.info().annotations.push({ type: 'renders over 3 s, the sheet open', description: JSON.stringify(r) });
    for (const name of ['VisualsSheet', 'VisualsSubtitle', 'VisualsBody', 'VisualsLook', 'VisualsHexes', 'VisualsOverlays', 'VisualsMotion', 'VisualsComfort', 'VizSlider']) {
      expect(r[name] ?? 0, `${name} over 3 s`).toBe(0);
    }
    // A change while open: applied, the sheet still open.
    await vizChoice(page, 'Visualizer colours', 'Hypnotic').click();
    await expect.poll(() => savedViz(page)).toMatchObject({ colorMode: 'cycle' });
    await expect(dialog).toBeVisible();
    // A tap above the sheet closes it.
    await page.mouse.click(Math.round(PHONE_VIEWPORT.width / 2), 150);
    await expect(page.getByTestId('sheet-visuals')).toHaveCount(0);
    await expect(page.getByTestId('view-now')).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test(`V4. a slider drag writes at most once every ${SLIDER_WRITE_MS} ms, follows the finger, and its release lands the final value at once`, async ({ page }) => {
    test.skip(ON_DEVICE, 'a mouse drag: the phone gate drags by finger (§5.11 step 3)');
    test.setTimeout(150_000);
    await recordHudDraws(page);
    await spyVizWrites(page, 'speed');
    const dialogs = await playingSeeded(page);
    await openVisuals(page, 'more');
    await vizJump(page, 'motion');
    const row = page.getByTestId('visuals-speed');
    const input = row.locator('input[type="range"]');
    const readout = row.locator('span.tabular-nums');
    const box = (await input.boundingBox())!;
    const cy = box.y + box.height / 2;
    // The thumb at 1.0 of 0.1–3 (Chrome's track inset is ~8 px each side); one step of 0.1 is ~13 px here.
    const xOf = (v: number) => box.x + 8 + ((v - 0.1) / 2.9) * (box.width - 16);
    const before = (await vizLog(page)).length;
    const t0 = await page.evaluate(() => performance.now());
    await page.mouse.move(xOf(1.0), cy);
    await page.mouse.down();
    const mismatches: string[] = [];
    for (let i = 1; i <= 45; i++) {
      await page.mouse.move(xOf(1.0) + i * ((xOf(2.4) - xOf(1.0)) / 45), cy);
      const [value, text] = await Promise.all([input.inputValue(), readout.textContent()]);
      if (text !== `${Number(value).toFixed(1)}x`) mismatches.push(`step ${i}: thumb ${value}, readout ${text}`);
      await page.waitForTimeout(33);
    }
    // The release, timed against the throttle (v16.4 re-review: decided on the page's clock). Held still until the
    // throttle is idle, one more step writes at once (its leading write), a last step is held for an interval, and the
    // release must save it at once, before the trailing timer could have. If the round trips let the timer in, nothing
    // is decided and the release is tried again: a fresh short drag from the thumb, the other way (up to RELEASE_TRIES).
    expect(mismatches, 'the readout follows the thumb at every step').toEqual([]);
    let decided = false;
    let t1 = 0;
    let firstDrag: { writes: number; elapsed: number } | null = null;
    for (let attempt = 1; attempt <= RELEASE_TRIES && !decided; attempt++) {
      const dir = attempt % 2 === 1 ? 1 : -1;
      const cur = Number(await input.inputValue());
      if (attempt > 1) {
        await page.mouse.move(xOf(cur), cy);
        await page.mouse.down();
      }
      await throttleIdle(page);
      const since = await page.evaluate(() => performance.now());
      const from = (await vizLog(page)).length;
      await page.mouse.move(xOf(cur + dir * 0.1), cy);
      await page.mouse.move(xOf(cur + dir * 0.2), cy);
      await page.mouse.up();
      if (attempt === 1) t1 = await page.evaluate(() => performance.now());
      const final = Number(await input.inputValue());
      if (attempt === 1) expect(final, 'the drag moved the thumb').toBeGreaterThan(2.4);
      await expect.poll(async () => (await savedViz(page))?.speed, { message: 'the final value is saved' }).toBe(final);
      const upAt = await page.evaluate(() => (window as any).__upAt as number);
      const log = await vizLog(page);
      if (attempt === 1) firstDrag = { writes: log.length - before, elapsed: upAt - t0 };
      decided = releaseLandsAtOnce(log, await inputLog(page), 'Simulation speed', from, since, final, upAt, `the mouse (try ${attempt})`);
    }
    expect(decided, `the mouse: the release timed against the throttle within ${RELEASE_TRIES} tries`).toBe(true);
    // The throttle's most for a drag of T ms (the first try's, from the press to its release): the leading write, one per
    // interval after it (ceil(T / interval)), and the release's flush; one more for a loaded machine's timing. The bound
    // follows the drag's own time, so a slow machine's longer drag is held to the same rate (v16.4 review: a fixed 12
    // failed past ~3.3 s). (The hold before the release adds time and at most its own leading write: inside the bound.)
    const { writes, elapsed } = firstDrag!;
    const bound = Math.ceil(elapsed / SLIDER_WRITE_MS) + 2 + 1;
    test.info().annotations.push({ type: 'writes during a 47-step drag', description: `${writes} in ${Math.round(elapsed)} ms (bound ${bound})` });
    expect(writes, `writes during the drag (${Math.round(elapsed)} ms; at most ${bound})`).toBeLessThanOrEqual(bound);
    expect(writes).toBeGreaterThanOrEqual(2);
    // The HUD during the drag, reported: the gate (median ≤ 31, max ≤ 32 draws/s) is §3.12's, measured on the production
    // build for the release and on the phone by V13; a dev server's two 1-s windows can't hold it.
    const hud = await page.evaluate(({ t0, t1 }) => ((window as any).__hud as Array<{ at: number; draws: number }>).filter((h) => h.at > t0 && h.at <= t1 + 1000).map((h) => h.draws), { t0, t1 });
    test.info().annotations.push({ type: 'HUD draws/s during the drag (dev server)', description: hud.join(', ') });
    expect(dialogs).toEqual([]);
  });

  test('V4b. the keyboard: a step lands at once on its keyup (not on the throttle\'s timer); 10 presses save the final value', async ({ page }) => {
    test.skip(ON_DEVICE, 'a keyboard: the phone has none');
    test.setTimeout(150_000);
    await spyVizWrites(page, 'sensitivity');
    const dialogs = await playingSeeded(page);
    await openVisuals(page, 'more');
    await vizJump(page, 'motion');
    const slider = vizSlider(page, 'Audio reactivity');
    await slider.focus();
    // The throttle idle, one press (written at once), then at once a second, inside the throttle's interval: its
    // release (keyup, change) must save it. Decided on the page's clock; tried again the other way if the round trips
    // let the trailing timer in (v16.4 re-review).
    let decided = false;
    for (let attempt = 1; attempt <= RELEASE_TRIES && !decided; attempt++) {
      const key = attempt % 2 === 1 ? 'ArrowRight' : 'ArrowLeft';
      const start = Number(await slider.inputValue());
      await throttleIdle(page);
      const since = await page.evaluate(() => performance.now());
      const from = (await vizLog(page)).length;
      await slider.press(key);
      await slider.press(key);
      const final = Number(await slider.inputValue());
      expect(final, `two steps of 0.1 from ${start}`).toBeCloseTo(start + (key === 'ArrowRight' ? 0.2 : -0.2), 5);
      await expect.poll(async () => (await savedViz(page))?.sensitivity, { message: 'the second step is saved' }).toBe(final);
      const keyUpAt = await page.evaluate(() => (window as any).__keyUpAt as number);
      decided = releaseLandsAtOnce(await vizLog(page), await inputLog(page), 'Audio reactivity', from, since, final, keyUpAt, `the keyboard (try ${attempt})`);
    }
    expect(decided, `the keyboard: the release timed against the throttle within ${RELEASE_TRIES} tries`).toBe(true);
    // Presses in a row to 2 (10 in all after one try): the final value saved.
    const now = Number(await slider.inputValue());
    await stepSlider(slider, 'ArrowRight', Math.round((2 - now) / 0.1));
    await expect.poll(async () => (await savedViz(page))?.sensitivity).toBe(2);
    expect(dialogs).toEqual([]);
  });

  test('V5. Pause visuals: the canvas hidden and 0 draws, saved, kept over a reload, the same switch in Safety & comfort; classic still draws @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    await recordHudDraws(page);
    const dialogs = await playingSeeded(page);
    expect(await stored(page, PAUSED_KEY), 'unset until a tap').toBeNull();
    await openVisuals(page, 'more');
    await vizJump(page, 'comfort');
    const pause = vizSwitch(page, 'Pause visuals');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('visuals-subtitle')).toHaveText('Paused · the music plays on');
    expect(await stored(page, PAUSED_KEY)).toBe('true');
    await expect.poll(() => canvasHidden(page)).toBe(true);
    expect((await drawsPerSecond(page, 3)).slice(1), 'draws/s while paused').toEqual([0, 0]);
    await page.keyboard.press('Escape');
    // A reload: still paused.
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(() => canvasHidden(page), { message: 'paused after a reload' }).toBe(true);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
    await tab(page, 'now');
    expect((await drawsPerSecond(page, 3)).slice(1), 'draws/s while paused and playing').toEqual([0, 0]);
    // The same switch in Safety & comfort.
    await tab(page, 'more');
    await moreRow(page, 'more-safety-row').click();
    const safety = page.getByTestId('safety-pause-visuals').getByRole('switch');
    await expect(safety).toHaveAttribute('aria-checked', 'true');
    await safety.click();
    expect(await stored(page, PAUSED_KEY)).toBe('false');
    await tab(page, 'now');
    await expect.poll(() => canvasHidden(page)).toBe(false);
    await tab(page, 'more');
    await safety.click();
    expect(await stored(page, PAUSED_KEY)).toBe('true');
    // Classic never reads it: it draws.
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await moreRow(page, 'more-back-to-classic').click();
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    await expect.poll(() => canvasHidden(page)).toBe(false);
    const d = (await drawsPerSecond(page, 3)).slice(1);
    expect(Math.min(...d), `classic draws: ${d.join(', ')}`).toBeGreaterThanOrEqual(DRAWING);
    expect(await stored(page, PAUSED_KEY), 'classic leaves the key alone').toBe('true');
    expect(dialogs).toEqual([]);
  });

  test('V6. the ways in: ⋯ › Visuals, More › Visualizer (to Now Playing with the sheet), Layers › Advanced › Open (no peek)', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page);
    await openVisuals(page, 'menu');
    await expect(page.getByTestId('menu-body'), 'the menu gave its place').toHaveCount(0);
    await page.keyboard.press('Escape');
    await tab(page, 'library');
    await openVisuals(page, 'more');
    await expect(page.getByTestId('tab-now-button')).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await openVisuals(page, 'layers');
    await expect(page.getByTestId('tab-now-button')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('peek-pill')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Harmonic Control', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await tab(page, 'layers');
    await page.getByTestId('layers-jump-advanced').click();
    await expect(page.getByTestId('layers-advanced')).toContainText('Every visual setting, with the visuals showing while you change them.');
    expect(dialogs).toEqual([]);
  });

  test('V7. on the Car screen the sheet says the visuals stay off, and nothing draws', async ({ page }) => {
    test.setTimeout(120_000);
    await recordHudDraws(page);
    const dialogs = await playingSeeded(page);
    await tab(page, 'now');
    await page.getByTestId('np-output').click();
    await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Car', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-car')).toBeVisible();
    await openVisuals(page, 'more');
    await expect(page.getByTestId('visuals-subtitle')).toHaveText('The Car screen keeps the visuals off.');
    expect((await drawsPerSecond(page, 3)).slice(1), 'draws/s on the Car screen').toEqual([0, 0]);
    expect(dialogs).toEqual([]);
  });

  test('V9. the rows that depend on others: Ripple intensity, the cube\'s rows, Position under Auto-Rotate, Wandering hexes dimmed, reduced motion', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page);
    await openVisuals(page, 'more');
    await vizJump(page, 'overlays');
    await expect(vizSlider(page, 'Ripple intensity')).toHaveCount(0);
    await vizSwitch(page, 'Hydro-Acoustics').click();
    await expect(vizSlider(page, 'Ripple intensity')).toBeVisible();
    await expect(page.getByTestId('visuals-cube-rows')).toHaveCount(0);
    await vizSwitch(page, 'Lo Shu Cube').click();
    await expect(page.getByTestId('visuals-cube-rows')).toBeVisible();
    await expect(vizSlider(page, 'Position'), 'disabled while Auto-Rotate is on').toBeDisabled();
    await vizSwitch(page, 'Auto-Rotate').click();
    await expect(vizSlider(page, 'Position')).toBeEnabled();
    for (const p of ['Vortex', 'Ascent', 'Pillar', 'Ouroboros']) await expect(vizSwitch(page, p)).toBeVisible();
    await expect(page.getByTestId('visuals-cube-rows')).toContainText('Light up walk paths without loading a playlist. Toggle individually or combine.');
    await vizJump(page, 'hexes');
    await vizSwitch(page, 'Hex grid').click();
    await expect(page.getByTestId('visuals-wander-row'), 'dimmed').toHaveClass(/opacity-50/);
    await expect(vizSwitch(page, 'Wandering hexes'), 'not disabled').toBeEnabled();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByTestId('visuals-wander')).toContainText('Held still: this device asks for reduced motion.');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.getByTestId('visuals-wander')).toContainText('Off-colour hexes glide to a neighbouring cell every few seconds, faster when the music is busy.');
    expect(dialogs).toEqual([]);
  });

  test('V10. a crash in the sheet\'s body shows its fallback in the sheet; the music plays on; Reload panel restores it (DEV)', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingSeeded(page);
    await openVisuals(page, 'more');
    await expect(page.getByTestId('visuals-body')).toBeVisible();
    const pauses = await pauseCount(page);
    await crash(page, 'sheet-visuals');
    const fallback = visualsSheet(page).getByRole('alert').filter({ hasText: /hit a problem/ });
    await expect(fallback).toBeVisible();
    const t0 = (await layerState(page)).music?.time ?? 0;
    await page.waitForTimeout(2000);
    expect(((await layerState(page)).music?.time ?? 0) - t0, 'the music moved on').toBeGreaterThanOrEqual(1.5);
    await fallback.getByRole('button', { name: 'Reload panel', exact: true }).click();
    await expect(page.getByTestId('visuals-body')).toBeVisible();
    expect(await pauseCount(page)).toBe(pauses);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, recording', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  /** Classic's Record dialog (the new layout gets its own in v16.5): a kind, then back into the new layout. */
  async function recordInClassic(page: Page, kind: RegExp): Promise<void> {
    await tab(page, 'more');
    if ((await page.getByTestId('more').getAttribute('data-more-view')) !== 'root') await tab(page, 'more');
    await moreRow(page, 'more-back-to-classic').click();
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    await page.locator('header').getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByText('Start Recording', { exact: true }).waitFor();
    await page.getByRole('button', { name: kind }).click();
    await expect(page.getByText('Start Recording', { exact: true }), 'the recording started').toBeHidden({ timeout: 10_000 });
    await openHarmonicControl(page);
    await page.getByTestId('try-new-layout').evaluate((b) => (b as HTMLButtonElement).click());
    await page.getByTestId('new-shell').waitFor();
  }

  async function stopRecording(page: Page): Promise<void> {
    await tab(page, 'more');
    await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), moreRow(page, 'more-stop-recording').click()]);
  }

  test('V12. Pause visuals holds through an Audio Only recording, and yields to a visual one (AV Mix) while it runs', async ({ page }) => {
    test.skip(ON_DEVICE, 'stopping a recording saves a file');
    test.setTimeout(180_000);
    await recordHudDraws(page);
    const dialogs = await playingSeeded(page);
    const canRecord = await page.evaluate(() => typeof MediaRecorder === 'function' && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function');
    test.skip(!canRecord, 'MediaRecorder or canvas.captureStream is not available here');
    await openVisuals(page, 'more');
    await vizJump(page, 'comfort');
    await vizSwitch(page, 'Pause visuals').click();
    await page.keyboard.press('Escape');
    await expect.poll(() => canvasHidden(page)).toBe(true);
    // Audio Only: the pause holds (a photosensitive user's pause is not lifted by recording sound).
    await recordInClassic(page, /Audio Only/);
    await tab(page, 'now');
    await expect.poll(() => canvasHidden(page), { message: 'Audio Only: still paused' }).toBe(true);
    expect((await drawsPerSecond(page, 3)).slice(1), 'draws/s, Audio Only').toEqual([0, 0]);
    await stopRecording(page);
    // AV Mix captures the canvas: the visuals run meanwhile, and the switch says so.
    await recordInClassic(page, /AV Mix/);
    await tab(page, 'now');
    await expect.poll(() => canvasHidden(page), { message: 'AV Mix: the visuals run' }).toBe(false);
    const d = (await drawsPerSecond(page, 3)).slice(1);
    expect(Math.min(...d), `draws/s, AV Mix: ${d.join(', ')}`).toBeGreaterThanOrEqual(DRAWING);
    await openVisuals(page, 'menu');
    await vizJump(page, 'comfort');
    await expect(page.getByTestId('visuals-pause')).toContainText('The visuals run while a visual recording runs.');
    await page.keyboard.press('Escape');
    await stopRecording(page);
    await tab(page, 'now');
    await expect.poll(() => canvasHidden(page), { message: 'paused again once it stops' }).toBe(true);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, by finger', () => {
  test.use({ viewport: PHONE_VIEWPORT, hasTouch: true });

  /** A finger drag (CDP touches, as tapAt sends them): down at x0, `steps` moves to x1 `stepMs` apart, up. */
  async function fingerDrag(page: Page, x0: number, x1: number, y: number, steps: number, stepMs: number): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y }] });
        await page.waitForTimeout(stepMs);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  test('V13. by finger: the sheet over the playing visuals (they draw), a Simulation speed drag inside the cap, Pause visuals 0 draws @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await recordHudDraws(page);
    const dialogs = await playingSeeded(page);
    const taps = tapCount(page);
    await tab(page, 'more');
    await taps.tap(moreRow(page, 'more-visualizer'));
    await expect(visualsSheet(page)).toBeVisible({ timeout: 5_000 });
    const open = (await drawsPerSecond(page, 3)).slice(1);
    test.info().annotations.push({ type: 'draws/s, the sheet open', description: open.join(', ') });
    // The phone (the android project): §5.11 step 3's gate, ≥ 25 (v16.4 review). Elsewhere the dev server's floor.
    const floor = ON_DEVICE ? 25 : DRAWING;
    expect(Math.min(...open), `draws/s with the sheet open: ${open.join(', ')} (at least ${floor})`).toBeGreaterThanOrEqual(floor);
    await taps.tap(page.getByTestId('visuals-jump-motion'));
    await expect(page.getByTestId('visuals-jump-motion')).toHaveAttribute('aria-current', 'true', { timeout: 5_000 });
    const input = page.getByTestId('visuals-speed').locator('input[type="range"]');
    const box = (await input.boundingBox())!;
    const y = box.y + box.height / 2;
    const xOf = (v: number) => box.x + 8 + ((v - 0.1) / 2.9) * (box.width - 16);
    const t0 = await page.evaluate(() => performance.now());
    await fingerDrag(page, xOf(1.0), xOf(2.6), y, 45, 33);
    const t1 = await page.evaluate(() => performance.now());
    await expect.poll(async () => Number(await input.inputValue()), { message: 'the finger moved the thumb', timeout: 5_000 }).toBeGreaterThan(1.5);
    const final = Number(await input.inputValue());
    await expect.poll(async () => (await savedViz(page))?.speed, { message: 'the final value is saved', timeout: 5_000 }).toBe(final);
    await page.waitForTimeout(1200);
    const hud = await page.evaluate(({ t0, t1 }) => ((window as any).__hud as Array<{ at: number; draws: number }>).filter((h) => h.at > t0 && h.at <= t1 + 1000).map((h) => h.draws), { t0, t1 });
    const sorted = [...hud].sort((a, b) => a - b);
    test.info().annotations.push({ type: 'draws/s during the finger drag', description: hud.join(', ') });
    expect(sorted[Math.floor(sorted.length / 2)] ?? 0, 'draws/s median during the drag').toBeLessThanOrEqual(31);
    expect(Math.max(...hud, 0), 'draws/s max during the drag').toBeLessThanOrEqual(32);
    await taps.tap(page.getByTestId('visuals-jump-comfort'));
    // As for Motion: wait until the jump has landed (its click comes ~0.3 s after the touch on the phone, and its scroll
    // would otherwise move Pause visuals out from under the next tap).
    await expect(page.getByTestId('visuals-jump-comfort')).toHaveAttribute('aria-current', 'true', { timeout: 5_000 });
    const pause = vizSwitch(page, 'Pause visuals');
    await expect(pause).toBeVisible({ timeout: 5_000 });
    await taps.tap(pause);
    await expect(pause).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
    await expect.poll(() => canvasHidden(page), { timeout: 5_000 }).toBe(true);
    expect((await drawsPerSecond(page, 3)).slice(1), 'draws/s with Pause visuals on').toEqual([0, 0]);
    await taps.tap(pause);
    await expect(pause).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 });
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, accessibility', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('V11. the Visuals sheet at each group, with its dependent rows: every control named, every target at least 44 × 44; Escape gives the focus back', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page);
    await openVisuals(page, 'more');
    await vizJump(page, 'overlays');
    await vizSwitch(page, 'Hydro-Acoustics').click();
    await vizSwitch(page, 'Lo Shu Cube').click();
    for (const g of ['look', 'hexes', 'overlays', 'motion', 'comfort'] as const) {
      await vizJump(page, g);
      await page.waitForTimeout(300);
      expect.soft(await unnamedControls(page), `${g}: unnamed controls`).toEqual([]);
      expect.soft(await smallTargets(page), `${g}: targets under 44 × 44`).toEqual([]);
    }
    // The jump chip focuses its group's heading (Layers' rule).
    await vizJump(page, 'motion');
    await expect(page.locator('#visuals-h-motion')).toBeFocused();
    // Escape closes the sheet (from ⋯: the focus goes back to the ⋯ button that opened the menu).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet-visuals')).toHaveCount(0);
    await openVisuals(page, 'menu');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet-visuals')).toHaveCount(0);
    await expect(page.getByTestId('np-menu-button')).toBeFocused();
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('V8. on the desktop the sheet is the panel beside the canvas: non-modal (the transport works), the visuals drawing', async ({ page }) => {
    test.skip(ON_DEVICE, 'the desktop shell');
    test.setTimeout(120_000);
    await recordHudDraws(page);
    const dialogs = await playingSeeded(page);
    await tab(page, 'more');
    await moreRow(page, 'more-visualizer').click();
    const region = page.getByRole('region', { name: 'Visuals', exact: true });
    await expect(page.getByTestId('desktop-panel').getByRole('region', { name: 'Visuals', exact: true })).toBeVisible();
    await expect(page.getByTestId('visuals-subtitle')).toHaveText('Changes show beside this panel as you make them');
    expect(await page.evaluate(() => document.getElementById('root')!.inert), 'non-modal: #root is not inert').toBe(false);
    const d = (await drawsPerSecond(page, 3)).slice(1);
    expect(Math.min(...d), `draws/s beside the panel: ${d.join(', ')}`).toBeGreaterThanOrEqual(DRAWING);
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await libraryState(page)).playing, { message: "the transport's Pause works with the panel open" }).toBe(false);
    await expect(region).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel').getByTestId('more-root'), 'Escape closes the panel back to More').toBeVisible();
    expect(dialogs).toEqual([]);
  });
});
