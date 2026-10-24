import { type BrowserContext, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, ON_DEVICE } from './fixtures';
import { importTones, openHarmonicControl, openSafety } from './helpers';

// Screenshot parity (v15.3, opt-in): the same 25 states at 1280×800 and 411×752, pixel for pixel, against the
// previous release. v15.3 removed the Tailwind CDN and added the full gold scale and the knob fix; this proves that
// only the allowed differences change and everything else is identical (threshold 0.02, maxDiffPixels 0; the
// config's expect.toHaveScreenshot holds the options and says why 0.02, tests/parity.css hides what moves on its
// own).
//
// Runs against a PRODUCTION build served with GitHub-Pages-like headers, never the dev server:
//
//   vite build --config e2e/vite.e2e.config.ts --outDir <old> --emptyOutDir      (the previous release, sealed)
//   node e2e/serve-dist.mjs --dir <old> --port <E2E_PORT>
//   cd e2e && E2E_REUSE_SERVER=1 E2E_PARITY=1 npx playwright test parity --update-snapshots=all   (the baseline)
//   ... run it once more without --update-snapshots: must pass (the noise check)
//   then serve the new build on the same port and run it without --update-snapshots: must pass.
//
// Take the baseline and the comparison on the same day and the same Chrome, back to back. The baselines go to
// e2e/parity-baseline/ (gitignored: machine- and Chrome-specific). Unmasked copies of every shot go to
// E2E_PARITY_SHOTS (default test-results/parity-unmasked)/<version badge>/, for before/after crops.
//
// The masks are the allowed differences only (the user's decisions for v15.3):
//   - the gold tints v15.3 activates and the user kept: gold-100/200/300 text (its line boxes grown by 2 px, for
//     glyphs that overhang), the 2178 Hz SOURCE panel's bg-gold-900/20 and the two to-gold-900/20 gradients;
//   - the switch tracks that are ON (their knob moved right). OFF switches are compared.
// The Auto-Distribute Frequencies button is NOT masked: it must look exactly as in v15.2.1. Every shot asserts that
// no mask touches it.

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 411, height: 752 },
} as const;
type Viewport = keyof typeof VIEWPORTS;

const HIDE_CSS = fs.readFileSync(fileURLToPath(new URL('./parity.css', import.meta.url)), 'utf8');
const SHOTS_DIR = process.env.E2E_PARITY_SHOTS || fileURLToPath(new URL('../test-results/parity-unmasked', import.meta.url));

// Gold text tints. The Lo Shu walk chips' text-gold-100 shows only on an active walk.
const GOLD_TEXT = '[class~="text-gold-100"],[class~="text-gold-200"],[class~="text-gold-300"]';

/**
 * A glyph can overhang its element's box by a pixel (measured: the last letter of a Guidebook label), and that pixel
 * turns gold too. So gold text is masked by its line boxes grown by 2 px, drawn as transparent fixed overlays that
 * paint nothing and take no pointer events (re-placed before every shot).
 */
async function placeGoldTextMasks(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    document.querySelectorAll('[data-parity-mask]').forEach((n) => n.remove());
    for (const el of Array.from(document.querySelectorAll(selector))) {
      for (const r of Array.from(el.getClientRects())) {
        if (!r.width || !r.height) continue;
        const m = document.createElement('div');
        m.setAttribute('data-parity-mask', '');
        m.style.cssText =
          `position:fixed;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;` +
          'margin:0;padding:0;border:0;background:transparent;pointer-events:none;z-index:2147483647';
        document.body.appendChild(m);
      }
    }
  }, GOLD_TEXT);
}

/** The allowed differences, as locators (resolved at each shot). */
function allowedDifferences(page: Page): Locator[] {
  return [
    // Gold text tints (see placeGoldTextMasks).
    page.locator('[data-parity-mask]'),
    // Gold fills: the SOURCE panel (a div) and the two gradients. The one BUTTON that carried bg-gold-900/20 in
    // v15.2.1 is Auto-Distribute, which v15.3 keeps as it was, so it is left out.
    page.locator('[class~="bg-gold-900/20"]:not(button),[class~="to-gold-900/20"]'),
    // The switch tracks that are ON (an OFF track is bg-slate-700). Both builds share the track classes.
    page.locator('button.w-8.h-4.rounded-full.relative:not(.bg-slate-700)'),
  ];
}

const autoDistribute = (page: Page) => page.getByRole('button', { name: /Auto-Distribute Frequencies/ });

/**
 * When the Auto-Distribute button is in the shot (on screen and not under an overlay such as the Guidebook), fails if
 * any mask overlaps it. Returns whether it was in the shot.
 */
async function autoDistributeUnmasked(page: Page, masks: Locator[], shot: string): Promise<boolean> {
  const button = autoDistribute(page);
  if ((await button.count()) === 0 || !(await button.first().isVisible())) return false;
  const b = await button.first().boundingBox();
  if (!b) return false;
  // On top at its centre or either end: the topmost element there is the button or inside it.
  const inShot = await button.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [0.1, 0.5, 0.9].some((fx) => {
      const x = r.left + r.width * fx;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    });
  });
  if (!inShot) return false;
  for (const m of masks) {
    const boxes = await m.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return [r.left, r.top, r.right, r.bottom];
      })
    );
    const covering = boxes.filter(([l, t, r, btm]) => r > l && btm > t && r > b.x && l < b.x + b.width && btm > b.y && t < b.y + b.height);
    expect(covering, `${shot}: a mask overlaps the Auto-Distribute button`).toEqual([]);
  }
  return true;
}

/** Close what opens by itself (the Safety panel for an unanalysed track) or was left open (the Lo Shu menu). */
async function closeAll(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const close = page.getByRole('button', { name: 'Close Safety Panel' });
    if (await close.isVisible().catch(() => false)) {
      await close.click().catch(() => {});
      await page.waitForTimeout(300);
      continue;
    }
    const loShuOpen =
      (await page.getByText('Switch to Lo Shu Perfect').isVisible().catch(() => false)) ||
      (await page.getByText('Switch back to Solfeggio').isVisible().catch(() => false));
    if (loShuOpen) {
      await page.mouse.click(3, 3); // its click-away catcher
      await page.waitForTimeout(300);
      continue;
    }
    break;
  }
}

async function walk(page: Page, context: BrowserContext, vp: Viewport): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => {
    // Seeded Math.random (mulberry32): the tones' detected-frequency guesses and the shuffles repeat run to run.
    let a = 0x9e3779b9;
    Math.random = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Some switches ON and some OFF, so both knob positions are in the shots. Once, before the app's first load.
    if (!localStorage.getItem('__paritySeeded')) {
      localStorage.setItem('__paritySeeded', '1');
      const v = JSON.parse(localStorage.getItem('aetheria.vizSettings.v1') || '{}');
      Object.assign(v, {
        showWaterRipples: true,
        showTreeOfLife: false,
        showLoShuCube: true,
        loShuCubeAutoRotate: true,
        loShuShowVortex: true,
        loShuShowAscent: false,
        morphEnabled: true,
      });
      localStorage.setItem('aetheria.vizSettings.v1', JSON.stringify(v));
    }
  });

  const masks = allowedDifferences(page);
  let label = process.env.E2E_PARITY_LABEL || '';
  const unmaskedSeen: string[] = [];
  const shot = async (state: string) => {
    await page.waitForTimeout(700);
    if (!label) label = ((await page.locator('header h1 > span').first().textContent().catch(() => '')) || 'build').trim();
    // The version badge differs by design (and on the phone its length decides whether the h1 wraps): one fixed
    // text in both builds.
    await page.evaluate(() => {
      const badge = document.querySelector('header h1 > span');
      if (badge) badge.textContent = 'v15.x';
    });
    const name = `${vp}-${state}`;
    await placeGoldTextMasks(page);
    if (await autoDistributeUnmasked(page, masks, name)) unmaskedSeen.push(state);
    await expect.soft(page, `${name} matches the baseline`).toHaveScreenshot(`${name}.png`, { mask: masks });
    await page.evaluate(() => document.querySelectorAll('[data-parity-mask]').forEach((n) => n.remove()));
    const out = path.join(SHOTS_DIR, label, `${name}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, animations: 'disabled', caret: 'hide', scale: 'css', style: HIDE_CSS });
  };

  // The first-run screens.
  await page.goto('/');
  await page.getByTestId('disclaimer').waitFor();
  await shot('disclaimer');
  await page.getByRole('button', { name: /I understand, let me begin/ }).click();
  await page.getByText('Quick Guide', { exact: true }).waitFor();
  await shot('tutorial');
  for (let i = 0; i < 8; i++) {
    const next = page.getByRole('button', { name: /^Next/ });
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(200);
  }
  await shot('tutorial-last');
  await page.getByText('Quick Guide', { exact: true }).locator('xpath=..').getByRole('button').click();

  // The library.
  await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
  await shot('main-empty');
  await importTones(page, 3, 60);
  await page.getByText('tone-01', { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await closeAll(page);
  await shot('main-tracks');

  // v2's first play asks for the output (a new profile: the release default engine).
  await page.getByText('tone-01', { exact: true }).first().click();
  await page.getByTestId('output-sheet').waitFor();
  await shot('output-sheet');
  await page.getByTestId('output-sheet').getByRole('button', { name: 'Headphones' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  await closeAll(page);
  await shot('paused-v2');

  await page.getByTestId('layers-quick-switch').click();
  await page.getByRole('dialog', { name: 'Layer sound and output', exact: true }).waitFor();
  await shot('layers-popover');
  await page.keyboard.press('Escape');

  // The update and offline notices.
  await closeAll(page);
  await page.evaluate(() => {
    (window as any).__aetheriaUpdateReady = true;
    window.dispatchEvent(new Event('aetheria:update-ready'));
  });
  await context.setOffline(true);
  await page.waitForTimeout(800);
  await shot('toasts');
  await context.setOffline(false);
  const dismiss = page.getByRole('button', { name: 'Dismiss update notice' });
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  // Back online, the indicator says so for 3 s: let it go, or whichever shot lands in those 3 s differs by timing.
  await page.getByText('Back Online', { exact: true }).waitFor({ state: 'hidden', timeout: 10_000 });

  // Harmonic Control (v2), its Key fit card and the phi switch, the Visualization Engine and its switches.
  await closeAll(page);
  await openHarmonicControl(page);
  await shot('harmonic-v2');
  await page.getByTestId('key-fit-row').scrollIntoViewIfNeeded();
  await shot('keyfit-card');
  await page.getByText('Track Timing: Phi-proportioned', { exact: true }).scrollIntoViewIfNeeded();
  await shot('phi-knob');
  const engine = page.getByRole('button', { name: 'Visualization Engine' });
  await engine.scrollIntoViewIfNeeded();
  if (!(await page.getByRole('switch', { name: 'Wandering hexes' }).isVisible().catch(() => false))) await engine.click();
  await page.getByRole('switch', { name: 'Wandering hexes' }).waitFor();
  await page.getByText('Hex Visual Mode').scrollIntoViewIfNeeded();
  await shot('viz-engine');
  await page.locator('select').filter({ has: page.locator('option[value="spectrum"]') }).first().selectOption('spectrum');
  await page.getByText('Hydro-Acoustics').scrollIntoViewIfNeeded();
  await shot('viz-knobs-1');
  await page.getByText('Path Illumination').scrollIntoViewIfNeeded();
  await shot('viz-knobs-2');
  await page.getByText('Show Sacred Geometry').scrollIntoViewIfNeeded();
  await shot('viz-knobs-3');

  // Harmonic Control (classic).
  const engineAB = page.getByRole('group', { name: 'Layer sound: v2 / classic' });
  await engineAB.scrollIntoViewIfNeeded();
  await engineAB.getByRole('button', { name: 'Classic', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('heading', { name: 'Harmonic Control', exact: true }).scrollIntoViewIfNeeded();
  await shot('harmonic-classic');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if (await page.getByRole('heading', { name: 'Harmonic Control', exact: true }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();
  }

  // Safety, the Frequency Lab, the Lo Shu menu.
  await closeAll(page);
  await openSafety(page);
  await shot('safety');
  await closeAll(page);
  await page.getByTitle('Advanced Frequency Selection').click();
  await page.getByText('Advanced Frequency Laboratory').waitFor();
  await shot('freq-lab');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.getByText('Advanced Frequency Laboratory').isVisible().catch(() => false)) await page.mouse.click(5, 5);
  await closeAll(page);
  await page.getByRole('button', { name: /Lo Shu controls/ }).click();
  await page.waitForTimeout(400);
  await shot('loshu-menu');
  await page.mouse.click(3, 3);

  // The Guidebook (on the phone, from the sidebar).
  await closeAll(page);
  if (vp === 'phone') {
    await page.getByRole('banner').getByRole('button').first().click();
    await page.waitForTimeout(500);
  }
  await page.getByRole('button', { name: /The Guidebook/ }).click();
  await page.waitForTimeout(600);
  await shot('guidebook');
  await page.getByText('The 27 Frequencies').first().scrollIntoViewIfNeeded();
  await shot('guidebook-2');
  await page.getByRole('button', { name: 'Technical', exact: true }).click();
  await page.waitForTimeout(500);
  await shot('guidebook-technical');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // A reload restores the library; then Zen mode.
  await page.reload();
  await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
  await page.getByText('tone-01', { exact: true }).first().waitFor();
  await page.waitForTimeout(3000);
  await closeAll(page);
  await shot('restored');
  await page.getByTitle('Zen Mode (Hide UI)', { exact: true }).click({ force: true });
  await page.waitForTimeout(4000);
  await shot('zen');

  test.info().annotations.push({ type: 'auto-distribute compared unmasked in', description: unmaskedSeen.join(', ') || '(none)' });
  fs.writeFileSync(path.join(SHOTS_DIR, label, `${vp}-summary.json`), JSON.stringify({ label, vp, autoDistributeUnmasked: unmaskedSeen, pageErrors: errors }, null, 1));
  expect.soft(errors, 'page errors').toEqual([]);
}

test.describe('screenshot parity with the previous release', () => {
  test.skip(ON_DEVICE, 'a desktop comparison of two production builds');

  for (const vp of Object.keys(VIEWPORTS) as Viewport[]) {
    test.describe(vp, () => {
      test.use({ viewport: VIEWPORTS[vp] });
      test(`${vp}: 25 states match the baseline outside the allowed differences`, async ({ page, context }) => {
        test.setTimeout(240_000);
        await walk(page, context, vp);
      });
    });
  }
});
