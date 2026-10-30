import { type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { crash, hideZen, importTones, openApp, openHarmonicControl, openNewLayout, openSafety, peekClassicLibrary, seedLibraryRecords } from './helpers';

// v15.3 "style foundation": the app's CSS is the bundled main-*.css alone. Until v15.2.1 index.html also ran the
// Tailwind Play CDN, which regenerated the same rules in the page and hid any class the build had missed; it is gone
// (with the dead aistudiocdn import map), so these tests guard what it used to hide:
//   a. every class on screen has a rule (none built from strings, none in an unscanned file);
//   b. no Tailwind runtime and no dead CDN anywhere;
//   c. the full gold scale renders its tints (except the Auto-Distribute button, kept exactly as in v15.2.1) and the
//      switch knobs sit right when ON;
//   d. the --ae-* CSS variables (src/index.css) equal the tokens in tailwind.config.js.

const TAILWIND_CONFIG = fileURLToPath(new URL('../../tailwind.config.js', import.meta.url));

// Class tokens in the DOM that no rule styles, on purpose: lucide's icon markers, and tokens no stylesheet has ever
// defined (the tailwindcss-animate plugin was never installed; custom-scrollbar and safe-area-top are defined nowhere).
const LUCIDE = /^lucide(-|$)/;
const INERT = new Set(['animate-in', 'fade-in', 'zoom-in', 'slide-in-from-right', 'custom-scrollbar', 'safe-area-top']);

/** Every class token on an element now, with the first state it was seen in. */
async function collectClasses(page: Page, state: string, seen: Map<string, string>): Promise<void> {
  const tokens = await page.evaluate(() => {
    const out = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('[class]'))) {
      for (const t of (el.getAttribute('class') || '').split(/\s+/)) if (t) out.add(t);
    }
    return [...out];
  });
  for (const t of tokens) if (!seen.has(t)) seen.set(t, state);
}

/** Every class a selector in any stylesheet names (nested rules included), unescaped. */
async function stylesheetClasses(page: Page): Promise<Set<string>> {
  const list = await page.evaluate(() => {
    const out = new Set<string>();
    const re = /\.((?:\\.|[\w-])+)/g;
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const sel = (rule as CSSStyleRule).selectorText;
        if (sel) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(sel))) out.add(m[1].replace(/\\(.)/g, '$1'));
        }
        const inner = (rule as CSSGroupingRule).cssRules;
        if (inner) walk(inner);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules);
      } catch {
        // A cross-origin sheet without CORS can't be read; the app has none.
      }
    }
    return [...out];
  });
  return new Set(list);
}

/** Close the Safety panel when it opened by itself (an unanalysed track does that). */
async function closeSafety(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close Safety Panel' });
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** The 7 switch tracks (Phi timing, the Visualization Engine's toggles): a 32×16 button holding a 12 px knob. */
const switchTracks = (page: Page) => page.locator('button.w-8.h-4.rounded-full.relative');

/** The knob's left offset inside its track, in px. */
const knobOffset = (track: Locator) =>
  track.evaluate((el) => {
    const knob = el.firstElementChild as HTMLElement;
    return Math.round(knob.getBoundingClientRect().left - el.getBoundingClientRect().left);
  });

async function openVisualizationEngine(page: Page): Promise<void> {
  await openHarmonicControl(page);
  const engine = page.getByRole('button', { name: 'Visualization Engine' });
  await engine.scrollIntoViewIfNeeded();
  if (!(await page.getByRole('switch', { name: 'Wandering hexes' }).isVisible().catch(() => false))) await engine.click();
  await page.getByRole('switch', { name: 'Wandering hexes' }).waitFor();
}

test.describe('style foundation (v15.3)', () => {
  test('a. every class on screen has a rule in the stylesheets', async ({ page }) => {
    test.setTimeout(180_000);
    const seen = new Map<string, string>();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    // A new profile: the disclaimer, then every Quick Guide step.
    await page.goto('/');
    await page.getByTestId('disclaimer').waitFor();
    await collectClasses(page, 'disclaimer', seen);
    await page.getByRole('button', { name: /I understand, let me begin/ }).click();
    await page.getByText('Quick Guide', { exact: true }).waitFor();
    for (let i = 0; i < 10; i++) {
      await collectClasses(page, `quick guide ${i + 1}`, seen);
      const next = page.getByRole('button', { name: /^Next/ });
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
    }
    await page.getByText('Quick Guide', { exact: true }).locator('xpath=..').getByRole('button').click();

    // The library, v2's first play (the output question), playing, the layers popover.
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    await collectClasses(page, 'main empty', seen);
    await importTones(page, 3, 30);
    await page.getByText('tone-01', { exact: true }).first().waitFor({ timeout: 20_000 });
    await closeSafety(page);
    await collectClasses(page, 'main with 3 tones', seen);
    await page.getByText('tone-01', { exact: true }).first().click();
    await page.getByTestId('output-sheet').waitFor();
    await collectClasses(page, 'output sheet', seen);
    await page.getByTestId('output-sheet').getByRole('button', { name: 'Headphones' }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await closeSafety(page);
    await collectClasses(page, 'playing v2', seen);
    await page.getByTestId('layers-quick-switch').click();
    await page.getByRole('dialog', { name: 'Layer sound and output', exact: true }).waitFor();
    await collectClasses(page, 'layers popover', seen);
    await page.keyboard.press('Escape');

    // Harmonic Control: v2 with the Visualization Engine open (the switches), the Spectrum Lens, then classic.
    await closeSafety(page);
    await openVisualizationEngine(page);
    await collectClasses(page, 'harmonic control v2 + visualization engine', seen);
    await page.locator('select').filter({ has: page.locator('option[value="spectrum"]') }).first().selectOption('spectrum');
    await collectClasses(page, 'visualization engine, spectrum lens', seen);
    const engineAB = page.getByRole('group', { name: 'Layer sound: v2 / classic' });
    await engineAB.scrollIntoViewIfNeeded();
    await engineAB.getByRole('button', { name: 'Classic', exact: true }).click();
    await page.waitForTimeout(500);
    await collectClasses(page, 'harmonic control classic', seen);
    await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();

    // Safety, the Frequency Lab, the Lo Shu menu.
    await openSafety(page);
    await collectClasses(page, 'safety', seen);
    await closeSafety(page);
    await page.getByTitle('Advanced Frequency Selection').click();
    await page.getByText('Advanced Frequency Laboratory').waitFor();
    await collectClasses(page, 'frequency lab', seen);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.getByText('Advanced Frequency Laboratory').isVisible().catch(() => false)) await page.mouse.click(5, 5);
    await page.getByText('Advanced Frequency Laboratory').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: /Lo Shu controls/ }).click();
    await page.getByText(/Switch to Lo Shu Perfect|Switch back to Solfeggio/).first().waitFor();
    await collectClasses(page, 'lo shu menu', seen);
    await page.mouse.click(3, 3); // its click-away catcher

    // The Guidebook (both tabs), the Record dialog, the Links panel.
    await page.getByRole('button', { name: /The Guidebook/ }).click();
    await page.getByRole('button', { name: 'Technical', exact: true }).waitFor();
    await collectClasses(page, 'guidebook accessible', seen);
    await page.getByRole('button', { name: 'Technical', exact: true }).click();
    await page.waitForTimeout(300);
    await collectClasses(page, 'guidebook technical', seen);
    await page.mouse.click(5, 5); // its backdrop closes it
    await page.getByRole('button', { name: 'Technical', exact: true }).waitFor({ state: 'hidden' });
    await page.locator('header button').filter({ has: page.locator('svg.lucide-circle') }).click();
    await page.getByText('Start Recording', { exact: true }).waitFor();
    await collectClasses(page, 'record dialog', seen);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByTitle('Links & Resources').click();
    await page.waitForTimeout(400);
    await collectClasses(page, 'links panel', seen);
    await page.getByTitle('Links & Resources').click();

    // v15.4's kit and fallbacks: a readout dialog, the delete confirmation, a panel's fallback, the basic transport,
    // the visuals pill, Zen's "Show controls", and last the root fallback (then a reload).
    await page.locator('aside').getByRole('button', { name: /^Library\s*Diagnostics/ }).click();
    const readout = page.getByRole('dialog', { name: 'Library diagnostics', exact: true });
    await readout.waitFor();
    await collectClasses(page, 'readout dialog', seen);
    await readout.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('div.group').filter({ has: page.getByText('tone-01', { exact: true }) }).getByTitle('Delete song').click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete this track?' });
    await confirm.waitFor();
    await collectClasses(page, 'delete dialog', seen);
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await openHarmonicControl(page);
    await crash(page, 'harmonic');
    const panelFallback = page.getByRole('alert').filter({ hasText: /hit a problem/ });
    await panelFallback.waitFor();
    await collectClasses(page, 'panel fallback', seen);
    await panelFallback.getByRole('button', { name: 'Close', exact: true }).click();
    await crash(page, 'transport');
    await page.getByTestId('safe-transport').waitFor();
    await collectClasses(page, 'safe transport', seen);
    await page.getByTestId('safe-transport').getByRole('button', { name: 'Reload controls', exact: true }).click();
    await crash(page, 'visualizer');
    await page.getByRole('button', { name: /Restart visuals/ }).waitFor();
    await collectClasses(page, 'visuals pill', seen);
    await page.getByRole('button', { name: /Restart visuals/ }).click();
    await hideZen(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Show controls', exact: true })).toBeFocused();
    await collectClasses(page, 'zen, show controls focused', seen);
    await page.keyboard.press('Enter');
    await crash(page, 'root');
    await page.getByRole('alert').filter({ hasText: 'Aetheria stopped after a problem.' }).waitFor();
    await collectClasses(page, 'root fallback', seen);
    await page.reload();
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();

    const styled = await stylesheetClasses(page);
    const unstyled = [...seen]
      .filter(([t]) => !styled.has(t) && !LUCIDE.test(t) && !INERT.has(t))
      .map(([t, state]) => `${t} (${state})`)
      .sort();
    expect(seen.size, 'the walk saw the app').toBeGreaterThan(300);
    expect(
      unstyled,
      'classes in the DOM with no rule: build class names from complete literals in a scanned file (tailwind.config.js content)'
    ).toEqual([]);
  });

  test('b. no Tailwind runtime and no dead CDN', async ({ page }) => {
    const cdn: string[] = [];
    page.on('request', (r) => {
      if (/tailwindcss\.com|aistudiocdn\.com/.test(r.url())) cdn.push(r.url());
    });
    await openApp(page);
    await page.waitForTimeout(1000);
    expect.soft(cdn, 'requests to cdn.tailwindcss.com or aistudiocdn.com').toEqual([]);
    expect.soft(await page.evaluate(() => typeof (window as any).tailwind), 'window.tailwind').toBe('undefined');
    expect.soft(await page.locator('script[type="importmap"]').count(), 'an import map in the page').toBe(0);
    // Absolute URLs: on a device the CDP context has no baseURL, so a relative request would throw.
    const html = await (await page.request.get(new URL('/', page.url()).href)).text();
    expect.soft(html, 'the served index.html').not.toMatch(/tailwind/i);
    expect.soft(html, 'the served index.html').not.toContain('aistudiocdn');
    const sw = await (await page.request.get(new URL('/sw.js', page.url()).href)).text();
    expect.soft(sw, 'the service worker').not.toContain('tailwindcss.com');
    expect.soft(sw, 'the service worker').not.toContain('aistudiocdn');
  });

  test('c. the gold scale renders, Auto-Distribute stays as it was', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /I understand, let me begin/ }).click();
    await page.getByText('Quick Guide', { exact: true }).waitFor();
    // gold-400 (unchanged since v15.2.1): the header title.
    await expect.soft(page.locator('header h1')).toHaveCSS('color', 'rgb(251, 191, 36)');
    // gold-200 (new in v15.3): the Quick Guide's bold labels.
    const label = page.locator('strong.text-gold-200').first();
    for (let i = 0; i < 10 && !(await label.isVisible().catch(() => false)); i++) {
      await page.getByRole('button', { name: /^Next/ }).click();
    }
    await expect.soft(label).toHaveCSS('color', 'rgb(253, 230, 138)');
    await page.getByText('Quick Guide', { exact: true }).locator('xpath=..').getByRole('button').click();
    // The Auto-Distribute button keeps v15.2.1's look (the user's decision): no fill, at rest or hovered.
    const autoDistribute = page.getByRole('button', { name: /Auto-Distribute Frequencies/ });
    await autoDistribute.scrollIntoViewIfNeeded();
    await expect.soft(autoDistribute).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await autoDistribute.hover();
    await page.waitForTimeout(300);
    await expect.soft(autoDistribute, 'hovered').toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('c. the switch knobs sit right when ON and slide back when OFF', async ({ page }) => {
    await openApp(page);
    await openVisualizationEngine(page);
    const tracks = [];
    for (const t of await switchTracks(page).all()) if (await t.isVisible()) tracks.push(t);
    expect(tracks.length, 'switches on screen').toBeGreaterThanOrEqual(4);
    for (const [i, t] of tracks.entries()) {
      const off = /\bbg-slate-700\b/.test((await t.getAttribute('class')) ?? '');
      expect.soft(await knobOffset(t), `switch ${i + 1} (${off ? 'off' : 'on'})`).toBe(off ? 2 : 18);
    }
    // Tree of Life is off by default: on, then off again.
    const tree = page.getByText('Tree of Life', { exact: true }).locator('xpath=..').locator('button.w-8.h-4.rounded-full.relative');
    await tree.scrollIntoViewIfNeeded();
    expect(await knobOffset(tree), 'Tree of Life, off').toBe(2);
    await tree.click();
    await page.waitForTimeout(300);
    expect(await knobOffset(tree), 'Tree of Life, on').toBe(18);
    await tree.click();
    await page.waitForTimeout(300);
    expect(await knobOffset(tree), 'Tree of Life, off again').toBe(2);
  });

  test('e. the new layout (v15.5): every class on screen has a rule; no blur and no endless animation over the canvas', async ({ page }) => {
    // I13 for the new shell: no backdrop-filter and no infinite animation (classic's six blurs and two endless
    // animations restyle and re-filter the page every frame, spec §2.5), and every class from a complete literal.
    test.setTimeout(240_000);
    const seen = new Map<string, string>();
    const effects = new Set<string>();
    const census = async (state: string) => {
      await page.waitForTimeout(250);
      await collectClasses(page, state, seen);
      const found = await page.evaluate(() => {
        const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [data-testid="shell-fallback"], [role="dialog"], [data-testid="peek-pill"]'));
        const out: string[] = [];
        for (const root of roots) {
          for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const cs = getComputedStyle(el);
            const tag = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.')}`;
            if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push(`backdrop-filter ${cs.backdropFilter} on ${tag}`);
            if (cs.animationName && cs.animationName !== 'none' && /infinite/.test(cs.animationIterationCount)) out.push(`infinite animation ${cs.animationName} on ${tag}`);
          }
        }
        return out;
      });
      for (const f of found) effects.add(`${f} (${state})`);
    };
    const playRow = page.getByRole('group', { name: 'Output' });
    await page.setViewportSize({ width: 411, height: 752 });
    await openApp(page, { engine: 'v2' });
    await page.evaluate(() => localStorage.setItem('aetheria.layerOutput.v1', 'headphones'));
    await page.reload();
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    await importTones(page, 3, 60);
    await page.getByText('tone-01', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Pause', exact: true }).first().waitFor({ timeout: 20_000 });
    const close = page.getByRole('button', { name: 'Close Safety Panel' });
    if (await close.isVisible().catch(() => false)) await close.evaluate((b) => (b as HTMLButtonElement).click());
    await openHarmonicControl(page);
    await page.getByTestId('try-new-layout').click();
    await page.getByTestId('new-shell').waitFor();
    await census('new layout, now playing');

    // Each sheet, the menu. (v16.0: the Up next sheet, from Now Playing's line.)
    for (const [open, title] of [['chip-crystal', 'Crystal'], ['np-output', 'Sound'], ['np-walks', 'Walks'], ['np-upnext', 'Up next']] as const) {
      await page.getByTestId(open).click();
      await page.getByRole('dialog', { name: title, exact: true }).waitFor();
      await census(`sheet ${title}`);
      await page.keyboard.press('Escape');
    }
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-body').waitFor();
    await census('menu');
    await page.keyboard.press('Escape');

    // Tone only: paused, then a crystal.
    await page.getByTestId('np-play').click();
    await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
    await page.getByTestId('chip-crystal').click();
    await page.getByTestId('crystal-528').click();
    await page.getByTestId('tone-only-banner').waitFor();
    await census('tone only');
    await page.getByTestId('tone-only-banner').getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByTestId('np-play').click();
    await page.getByRole('button', { name: 'Pause', exact: true }).first().waitFor();

    // The mini-player on each stub, and the fallbacks.
    for (const t of ['library', 'mixes', 'layers', 'more'] as const) {
      await page.getByTestId(`tab-${t}-button`).click();
      await census(`stub ${t} + mini-player`);
    }

    // v15.6: the Layers tab at each section, the crystal filter on (the tab and the Crystal sheet), the bands under Car,
    // the classic engine's look, and Zen (on and revealed, the menu's row, hidden).
    await page.getByTestId('tab-layers-button').click();
    for (const s of ['crystal', 'levels', 'beat', 'advanced'] as const) {
      await page.getByTestId(`layers-jump-${s}`).click();
      await census(`layers ${s}`);
    }
    const filterSwitch = page.getByRole('switch', { name: 'Filter the crystals by experience level' });
    await filterSwitch.click();
    await page.getByTestId('layers-jump-crystal').click();
    await page.getByTestId('crystal-filter-note').waitFor();
    await census('layers crystal, filtered');
    await page.getByTestId('layers-jump-sound').click();
    await page.getByTestId('layers-output').getByRole('button', { name: 'Car', exact: true }).click();
    await page.getByTestId('layers-jump-beat').click();
    await census('layers beat, Car');
    await page.getByTestId('layers-jump-sound').click();
    await page.getByTestId('layers-output').getByRole('button', { name: 'Headphones', exact: true }).click();
    await page.getByTestId('layers-engine').getByRole('button', { name: 'Classic', exact: true }).click();
    await census('layers, classic engine');
    await page.getByTestId('layers-engine').getByRole('button', { name: 'v2', exact: true }).click();
    await page.getByTestId('tab-now-button').click();
    await page.getByTestId('chip-crystal').click();
    await page.getByRole('dialog', { name: 'Crystal', exact: true }).waitFor();
    await census('sheet Crystal, filtered');
    await page.keyboard.press('Escape');
    await page.getByTestId('tab-layers-button').click();
    await page.getByTestId('layers-jump-advanced').click();
    await filterSwitch.click();
    await page.getByTestId('tab-now-button').click();
    await page.getByTestId('zen-button').click();
    await census('zen on, revealed');
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-body').waitFor();
    await census('menu, zen on');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-testid="new-shell"]')?.hasAttribute('inert'), null, { timeout: 10_000 });
    await census('zen hidden');
    await page.mouse.move(200, 300);
    await page.mouse.move(210, 310);
    await page.getByTestId('zen-button').click();
    await page.getByTestId('tab-more-button').click();
    await crash(page, 'more');
    await page.getByRole('alert').filter({ hasText: /hit a problem/ }).waitFor();
    await census('tab fallback');
    await page.getByRole('button', { name: 'Reload panel', exact: true }).click();
    await crash(page, 'mini-player');
    await page.getByTestId('safe-transport').waitFor();
    await census('mini-player fallback');
    await page.getByRole('button', { name: 'Reload controls', exact: true }).click();
    await page.getByTestId('tab-library-button').click();
    await peekClassicLibrary(page);
    await page.getByTestId('peek-pill').waitFor();
    await census('peek');
    await page.getByTestId('peek-pill').click();
    await page.getByTestId('tab-now-button').click();
    await crash(page, 'now-playing');
    await page.getByRole('alert').filter({ hasText: /hit a problem/ }).waitFor();
    await census('now playing fallback');
    await page.getByRole('button', { name: 'Reload panel', exact: true }).click();
    await page.getByTestId('chip-crystal').click();
    await crash(page, 'sheet-crystal');
    await page.getByRole('alert').filter({ hasText: /hit a problem/ }).waitFor();
    await census('sheet fallback');
    await page.keyboard.press('Escape');

    // Car.
    await page.getByTestId('np-output').click();
    await playRow.getByRole('button', { name: 'Car', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('view-car').waitFor();
    await census('car');
    await page.getByRole('button', { name: 'Change output', exact: true }).click();
    await playRow.getByRole('button', { name: 'Headphones', exact: true }).click();
    await page.keyboard.press('Escape');

    // A landscape phone, then the desktop shell with its panel (a sheet, a stub), then the shell's own fallback.
    await page.setViewportSize({ width: 882, height: 411 });
    await page.getByTestId('view-now').waitFor();
    await census('landscape');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('side-nav').waitFor();
    await census('desktop');
    await page.getByTestId('desktop-crystal').click();
    await page.getByRole('region', { name: 'Crystal', exact: true }).waitFor();
    await census('desktop, crystal panel');
    await page.getByTestId('nav-library').click();
    await page.getByTestId('tab-library').waitFor();
    await census('desktop, library panel');
    await page.getByTestId('nav-layers').click();
    await page.getByTestId('tab-layers').waitFor();
    await census('desktop, layers panel');
    await crash(page, 'desktop-transport');
    await page.getByTestId('safe-transport').waitFor();
    await census('desktop transport fallback');
    await page.getByRole('button', { name: 'Reload controls', exact: true }).click();
    await crash(page, 'shell');
    await page.getByTestId('shell-fallback').waitFor();
    await census('shell fallback');

    const styled = await stylesheetClasses(page);
    const unstyled = [...seen]
      .filter(([t]) => !styled.has(t) && !LUCIDE.test(t) && !INERT.has(t))
      .map(([t, state]) => `${t} (${state})`)
      .sort();
    expect(seen.size, 'the walk saw the new layout').toBeGreaterThan(150);
    expect(unstyled, 'classes in the DOM with no rule').toEqual([]);
    expect([...effects], 'backdrop-filter or an endless animation in the new layout').toEqual([]);
  });

  test('f. the Library tab (v15.7): every class on screen has a rule; no blur and no endless animation, in each of its states', async ({ page }) => {
    test.setTimeout(240_000);
    const seen = new Map<string, string>();
    const effects = new Set<string>();
    const census = async (state: string) => {
      await page.waitForTimeout(250);
      await collectClasses(page, state, seen);
      const found = await page.evaluate(() => {
        const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"], [role="alertdialog"], [data-testid="notices"]'));
        const out: string[] = [];
        for (const root of roots) {
          for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const cs = getComputedStyle(el);
            const tag = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.')}`;
            if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push(`backdrop-filter ${cs.backdropFilter} on ${tag}`);
            if (cs.animationName && cs.animationName !== 'none' && /infinite/.test(cs.animationIterationCount)) out.push(`infinite animation ${cs.animationName} on ${tag}`);
          }
        }
        return out;
      });
      for (const f of found) effects.add(`${f} (${state})`);
    };
    await page.setViewportSize({ width: 411, height: 752 });
    // Empty first (a new profile), then 30 seeded tracks.
    await openNewLayout(page, { engine: 'v2', output: 'headphones' });
    await page.getByTestId('tab-library-button').click();
    await page.getByTestId('library-empty').waitFor();
    await census('library, empty');
    await seedLibraryRecords(page, 30, { crystals: 'some', keys: true, envelopes: true });
    await page.goto('/');
    await page.getByTestId('new-shell').waitFor();
    await page.getByTestId('tab-library-button').click();
    await page.getByTestId('library-list').waitFor();
    await census('library, top');
    const row = (name: string) => page.getByTestId('library-row').filter({ has: page.locator('[data-row-title]').getByText(name, { exact: true }) }).locator('button[data-row-index]');
    await row('tone-0003').click();
    await page.getByTestId('mini-title').filter({ hasText: 'tone-0003' }).waitFor({ timeout: 20_000 }); // playing; then a tap that changes it
    await row('tone-0005').click();
    await page.getByTestId('notices').getByRole('button', { name: 'Undo', exact: true }).waitFor();
    await census('library, playing, the Undo toast');
    await page.getByTestId('library-scroll').evaluate((el) => (el.scrollTop = 64 * 14));
    await census('library, mid-list');
    await page.getByTestId('library-search').fill('tone-001');
    await census('library, searching');
    await page.getByTestId('library-search').fill('nothing like this');
    await page.getByTestId('library-no-results').waitFor();
    await census('library, no results');
    await page.getByTestId('library-search').fill('');
    await page.getByRole('button', { name: 'Options for tone-0002', exact: true }).click();
    await page.getByTestId('library-menu-body').waitFor();
    await census('row menu');
    await page.getByTestId('library-menu-info').click();
    await page.getByRole('dialog', { name: 'Track info', exact: true }).waitFor();
    await census('track info');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Options for tone-0002', exact: true }).click();
    await page.getByTestId('library-menu-delete').click();
    await page.getByRole('alertdialog', { name: 'Delete this track?' }).waitFor();
    await census('delete');
    await page.keyboard.press('Escape');
    await page.getByTestId('health-crystals-action').click();
    await page.getByTestId('assign-dialog').waitFor();
    await census('assign crystals');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__aetheriaAnalyse.tune({ duty: 0.02 }));
    await page.getByTestId('health-analyse-action').click();
    await page.getByTestId('library-health-status').getByText('Analysing…').waitFor();
    await census('health card, analysing');
    await page.getByTestId('health-analyse-action').click();
    await page.getByTestId('library-import').click();
    await page.getByTestId('import-body').waitFor();
    await census('import sheet');
    await page.keyboard.press('Escape');
    await crash(page, 'library-list');
    await page.getByRole('alert').filter({ hasText: /hit a problem/ }).waitFor();
    await census('list fallback');
    await page.getByRole('button', { name: 'Reload panel', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('desktop-panel').waitFor();
    await census('desktop, library panel');
    await page.getByTestId('library-import').click();
    await page.getByRole('region', { name: 'Import music', exact: true }).waitFor();
    await census('desktop, import panel');

    const styled = await stylesheetClasses(page);
    const unstyled = [...seen]
      .filter(([t]) => !styled.has(t) && !LUCIDE.test(t) && !INERT.has(t))
      .map(([t, state]) => `${t} (${state})`)
      .sort();
    expect(seen.size, 'the walk saw the Library tab').toBeGreaterThan(100);
    expect(unstyled, 'classes in the DOM with no rule').toEqual([]);
    expect([...effects], 'backdrop-filter or an endless animation in the Library tab').toEqual([]);
  });

  test('g. saved playlists (v16.1): every class on screen has a rule; no blur and no endless animation, in each of their states', async ({ page }) => {
    test.setTimeout(240_000);
    const seen = new Map<string, string>();
    const effects = new Set<string>();
    const census = async (state: string) => {
      await page.waitForTimeout(250);
      await collectClasses(page, state, seen);
      const found = await page.evaluate(() => {
        const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"], [role="alertdialog"], [data-testid="notices"]'));
        const out: string[] = [];
        for (const root of roots) {
          for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const cs = getComputedStyle(el);
            const tag = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.')}`;
            if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push(`backdrop-filter ${cs.backdropFilter} on ${tag}`);
            if (cs.animationName && cs.animationName !== 'none' && /infinite/.test(cs.animationIterationCount)) out.push(`infinite animation ${cs.animationName} on ${tag}`);
          }
        }
        return out;
      });
      for (const f of found) effects.add(`${f} (${state})`);
    };
    // The storage note shows only when the browser says the storage isn't persistent.
    await page.addInitScript(() => {
      (navigator.storage as any).persisted = async () => false;
    });
    await page.setViewportSize({ width: 411, height: 752 });
    await openNewLayout(page, { engine: 'v2', output: 'headphones' });
    await page.getByTestId('tab-library-button').click();
    await page.getByTestId('library-view-playlists').click();
    await page.getByTestId('playlists-empty').waitFor();
    await census('playlists, empty, with the storage note');
    await seedLibraryRecords(page, 30, { crystals: 'some', keys: true });
    // Two playlists (one with a missing entry) and one record that can't be read.
    await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const st: any = await new Promise((resolve) => { const q = db.transaction('playlist-state').objectStore('playlist-state').get('current'); q.onsuccess = () => resolve(q.result); });
      const ids: string[] = st.originalOrder;
      const e = (i: number) => ({ id: ids[i], name: `tone-${String(i + 1).padStart(4, '0')}`, file: `tone-${String(i + 1).padStart(4, '0')}.wav`, size: 1 });
      const tx = db.transaction('playlist-state', 'readwrite');
      tx.objectStore('playlist-state').put({ key: 'pl:pevening1', v: 1, id: 'pevening1', name: 'Evening', createdAt: 2, updatedAt: 2, entries: [e(0), e(1), { id: 'gone', name: 'tone-0203', file: 'tone-0203.wav', size: 9 }, e(3), e(4), e(5)], from: { kind: 'queue' } });
      tx.objectStore('playlist-state').put({ key: 'pl:pfocus001', v: 1, id: 'pfocus001', name: 'Focus', createdAt: 1, updatedAt: 1, entries: [e(6), e(7)] });
      tx.objectStore('playlist-state').put({ key: 'pl:pbroken01', v: 2, id: 'pbroken01', name: 'Broken', createdAt: 1, updatedAt: 1, entries: [] });
      await new Promise((r) => (tx.oncomplete = r));
      db.close();
    });
    await page.goto('/');
    await page.getByTestId('new-shell').waitFor();
    await page.getByTestId('tab-library-button').click();
    await page.getByTestId('library-view-tracks').waitFor();
    await page.getByTestId('library-list').waitFor();
    await census('library, tracks, the switch');
    await page.getByTestId('library-view-playlists').click();
    await page.getByTestId('playlists-list').waitFor();
    await census('playlists, the list, unreadable');
    await page.locator('[data-playlist-id="pevening1"]').getByRole('button', { name: 'Play Evening', exact: true }).click();
    await page.getByTestId('notices').getByRole('button', { name: 'Undo', exact: true }).waitFor();
    await census('playlists, playing, its toast');
    await page.locator('[data-playlist-id="pfocus001"]').getByTestId('playlist-row-menu').click();
    await page.getByTestId('playlist-menu-body').waitFor();
    await census('a playlist\'s menu');
    await page.getByTestId('playlist-menu-rename').click();
    await page.getByTestId('playlist-name-dialog').waitFor();
    await census('the name Dialog, rename');
    await page.keyboard.press('Escape');
    await page.locator('[data-playlist-id="pevening1"] [data-testid="playlist-row-open"]').click();
    await page.getByTestId('playlist-title').waitFor();
    await census('a playlist\'s view, playing, a missing entry');
    await page.locator('[data-testid="playlist-track"][data-index="1"] [data-row-menu]').first().click();
    await page.getByTestId('playlist-row-menu-body').waitFor();
    await census('an entry\'s menu');
    await page.getByTestId('playlist-row-menu-playlist').click();
    await page.getByTestId('playlist-add-body').waitFor();
    await census('Add to playlist');
    await page.getByTestId('playlist-add-new').click();
    await page.getByTestId('playlist-add-name').waitFor();
    await census('Add to playlist, New playlist inline');
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="playlist-track"][data-missing]').locator('[data-row-menu]').click();
    await page.getByTestId('playlist-row-menu-body').waitFor();
    await census('a missing entry\'s menu');
    await page.keyboard.press('Escape');
    await page.getByTestId('playlist-edit').click();
    await census('edit mode');
    await page.locator('[data-testid="playlist-track"][data-index="3"] [data-testid="playlist-handle"]').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await census('edit mode, a row lifted');
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="playlist-track"][data-index="2"] [data-row-menu]').first().click();
    await page.getByTestId('playlist-row-menu-body').waitFor();
    await census('edit mode, an entry\'s menu');
    await page.keyboard.press('Escape');
    await page.getByTestId('playlist-done').click();
    await crash(page, 'playlist-detail');
    await page.getByTestId('playlist-detail-fallback').waitFor();
    await census('a playlist\'s view, fallback');
    await page.getByRole('button', { name: 'Reload panel', exact: true }).click();
    await page.getByTestId('playlist-back').click();
    await crash(page, 'playlists');
    await page.getByTestId('playlists-fallback').waitFor();
    await census('the list, fallback');
    await page.getByRole('button', { name: 'Reload panel', exact: true }).click();
    // The health card's Library tools and the new Clear.
    await page.getByTestId('library-view-tracks').click();
    const toggle = page.getByTestId('library-health-toggle');
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.getByTestId('library-tools').waitFor();
    await census('the Library tools');
    await page.getByTestId('library-tools-clear').click();
    await page.getByTestId('clear-library-dialog').waitFor();
    await census('the Clear dialog');
    await page.getByTestId('clear-library-also').click();
    await census('the Clear dialog, ticked');
    await page.keyboard.press('Escape');
    // Now Playing's ⋯ and Up next with a queue (Save as playlist), and the save Dialog.
    await page.getByTestId('tab-now-button').click();
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-save-playlist').waitFor();
    await census('Now Playing\'s ⋯, the two rows');
    await page.getByTestId('menu-save-playlist').click();
    await page.getByTestId('playlist-name-dialog').waitFor();
    await census('the name Dialog, save');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const s = (window as any).__aetheriaLibrary.state();
      (window as any).__aetheriaQueue.add([s.libraryIds[20], s.libraryIds[21]], 'queue');
    });
    await page.getByTestId('np-upnext').click();
    await page.getByTestId('queue-save').waitFor();
    await census('Up next, Save as playlist');
    await page.keyboard.press('Escape');
    // The desktop panel: the list and a playlist's view.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('nav-library').click();
    await page.getByTestId('library-view-playlists').click();
    await page.getByTestId('playlists-list').waitFor();
    await census('desktop, the list');
    await page.locator('[data-playlist-id="pevening1"] [data-testid="playlist-row-open"]').click();
    await page.getByTestId('playlist-title').waitFor();
    await census('desktop, a playlist\'s view');
    // Classic: Clear's tickbox (only with playlists), armed and ticked.
    await page.setViewportSize({ width: 411, height: 752 });
    await page.goto('/?layout=classic');
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    const clear = page.getByRole('button', { name: 'Clear library and cache', exact: true });
    await clear.scrollIntoViewIfNeeded();
    await page.getByTestId('clear-also-playlists').click();
    await clear.click();
    await census('classic Clear, armed, ticked');

    const styled = await stylesheetClasses(page);
    const unstyled = [...seen]
      .filter(([t]) => !styled.has(t) && !LUCIDE.test(t) && !INERT.has(t))
      .map(([t, state]) => `${t} (${state})`)
      .sort();
    expect(seen.size, 'the walk saw the playlists').toBeGreaterThan(100);
    expect(unstyled, 'classes in the DOM with no rule').toEqual([]);
    expect([...effects], 'backdrop-filter or an endless animation').toEqual([]);
  });

  test('h. smart filters (v16.2): every class on screen has a rule; no blur and no endless animation, in each of their states', async ({ page }) => {
    test.setTimeout(240_000);
    const seen = new Map<string, string>();
    const effects = new Set<string>();
    const census = async (state: string) => {
      await page.waitForTimeout(250);
      await collectClasses(page, state, seen);
      const found = await page.evaluate(() => {
        const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"], [role="alertdialog"], [data-testid="notices"]'));
        const out: string[] = [];
        for (const root of roots) {
          for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const cs = getComputedStyle(el);
            const tag = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.')}`;
            if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push(`backdrop-filter ${cs.backdropFilter} on ${tag}`);
            if (cs.animationName && cs.animationName !== 'none' && /infinite/.test(cs.animationIterationCount)) out.push(`infinite animation ${cs.animationName} on ${tag}`);
          }
        }
        return out;
      });
      for (const f of found) effects.add(`${f} (${state})`);
    };
    await page.setViewportSize({ width: 411, height: 752 });
    await openNewLayout(page, { engine: 'v2', output: 'headphones' });
    await seedLibraryRecords(page, 30, { crystals: 'some', keys: true, envelopes: true });
    await page.goto('/');
    await page.getByTestId('new-shell').waitFor();
    await page.getByTestId('tab-library-button').click();
    await page.getByTestId('library-list').waitFor();
    await census('library, the Filters button');
    const sheet = page.getByRole('dialog', { name: 'Filters', exact: true });
    const chip = (facet: string, value: string) => sheet.locator(`button[data-facet="${facet}"][data-value="${value}"]`);
    await page.getByTestId('library-filters-button').click();
    await sheet.getByTestId('library-filters-body').waitFor();
    await census('filter sheet, top');
    await chip('crystal', '528').click();
    await chip('crystal', '639').click();
    await chip('crystal', '5274').scrollIntoViewIfNeeded();
    await census('filter sheet, picked (a regime mixed), a quiet chip');
    await chip('confidence', 'partial').scrollIntoViewIfNeeded();
    await census('filter sheet, the key groups');
    await sheet.getByTestId('filters-show').click();
    await page.getByTestId('library-filter-bar').waitFor();
    await census('library, filtered');
    await page.getByTestId('library-filter-more').click();
    await page.getByTestId('library-filter-actions-body').waitFor();
    await census('the filters’ ⋯ sheet');
    await page.getByTestId('filter-action-save').click();
    await page.getByRole('dialog', { name: 'Save as a playlist' }).waitFor();
    await census('save as a playlist, from the filters');
    await page.keyboard.press('Escape');
    await page.getByTestId('library-filters-button').click();
    await chip('length', 'ge10').click();
    await chip('crystal', '528').click();
    await chip('crystal', '639').click();
    await chip('crystal', '174').click();
    await sheet.getByTestId('filters-show').click();
    await page.getByTestId('library-search').fill('nothing like this');
    await page.getByTestId('library-filter-empty').waitFor();
    await census('library, no filter results, with a search');
    await page.getByTestId('library-search').fill('');
    await crash(page, 'library-filter-bar');
    await page.getByTestId('library-filter-bar-fallback').waitFor();
    await census('filter bar fallback');
    await page.getByTestId('library-filter-bar-fallback').getByRole('button', { name: 'Reload panel', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('desktop-panel').waitFor();
    await census('desktop, the library panel filtered');
    await page.getByTestId('library-filters-button').click();
    await sheet.getByTestId('library-filters-body').waitFor();
    await census('desktop, the filter sheet');

    const styled = await stylesheetClasses(page);
    const unstyled = [...seen]
      .filter(([t]) => !styled.has(t) && !LUCIDE.test(t) && !INERT.has(t))
      .map(([t, state]) => `${t} (${state})`)
      .sort();
    expect(seen.size, 'the walk saw the filters').toBeGreaterThan(100);
    expect(unstyled, 'classes in the DOM with no rule').toEqual([]);
    expect([...effects], 'backdrop-filter or an endless animation').toEqual([]);
  });

  test('i. Create a mix and the ⋯ (v16.3): every class on screen has a rule; no blur and no endless animation, in each of their states', async ({ page }) => {
    test.setTimeout(240_000);
    const seen = new Map<string, string>();
    const effects = new Set<string>();
    const census = async (state: string) => {
      await page.waitForTimeout(250);
      await collectClasses(page, state, seen);
      const found = await page.evaluate(() => {
        const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"], [role="alertdialog"], [data-testid="notices"]'));
        const out: string[] = [];
        for (const root of roots) {
          for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const cs = getComputedStyle(el);
            const tag = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.')}`;
            if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push(`backdrop-filter ${cs.backdropFilter} on ${tag}`);
            if (cs.animationName && cs.animationName !== 'none' && /infinite/.test(cs.animationIterationCount)) out.push(`infinite animation ${cs.animationName} on ${tag}`);
          }
        }
        return out;
      });
      for (const f of found) effects.add(`${f} (${state})`);
    };
    await page.setViewportSize({ width: 411, height: 752 });
    await openNewLayout(page, { engine: 'v2', output: 'headphones' });
    await seedLibraryRecords(page, 30, { crystals: 'some', keys: true, envelopes: true, patch: [{ index: 0, scanned: true }, { index: 3, scanned: true }] });
    await page.goto('/');
    await page.getByTestId('new-shell').waitFor();
    await page.getByTestId('tab-mixes-button').click();
    await page.getByTestId('mixes-create').waitFor();
    await census('mixes, Create a mix and the ⋯');
    await page.getByTestId('mix-more-preset:qi').click();
    await page.getByTestId('mix-menu-body').waitFor();
    await census('a mix’s ⋯ sheet');
    await page.keyboard.press('Escape');
    await page.getByTestId('mixes-create').click();
    await page.getByTestId('mix-builder').waitFor();
    await census('create a mix, a crystal set');
    await page.getByTestId('builder-set-custom').click();
    await page.getByTestId('builder-crystal-528').click();
    await census('create a mix, custom crystals');
    await page.getByTestId('builder-follow-walk').click();
    await page.getByTestId('builder-walk-C').click();
    await page.getByTestId('builder-order-list').getByText('Shuffle, least recently played first', { exact: true }).click();
    await census('create a mix, a walk reordered');
    await page.getByTestId('builder-follow-exp').click();
    await page.getByTestId('builder-exp-seq111').click();
    await census('create a mix, experimental');
    await page.getByTestId('builder-follow-any').click();
    await page.getByTestId('builder-filters-button').click();
    await page.getByTestId('builder-filters-experimental-toggle').click();
    await page.locator('button[data-facet="length"][data-value="ge10"]').click();
    await census('the builder’s filter sheet, the scores open');
    await page.getByTestId('builder-filters-done').click();
    await census('create a mix, a filter on, no track (0)');
    await page.getByTestId('builder-start-over').click();
    await page.getByTestId('builder-more').click();
    await page.getByTestId('builder-more-body').waitFor();
    await census('the footer’s ⋯');
    await page.getByTestId('builder-action-save').click();
    await page.getByRole('dialog', { name: 'Save as a playlist' }).waitFor();
    await census('save as a playlist, from a mix');
    await page.keyboard.press('Escape');
    await crash(page, 'mix-builder');
    await page.getByTestId('mix-builder-fallback').waitFor();
    await census('create a mix fallback');
    await page.getByTestId('mix-builder-fallback').getByRole('button', { name: 'Reload panel', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('mix-builder').waitFor();
    await census('desktop, create a mix in the panel');
    await page.getByTestId('builder-source-playlist').count();
    await page.getByTestId('builder-filters-button').click();
    await census('desktop, the builder’s filter sheet');

    const styled = await stylesheetClasses(page);
    const unstyled = [...seen]
      .filter(([t]) => !styled.has(t) && !LUCIDE.test(t) && !INERT.has(t))
      .map(([t, state]) => `${t} (${state})`)
      .sort();
    expect(seen.size, 'the walk saw the builder').toBeGreaterThan(100);
    expect(unstyled, 'classes in the DOM with no rule').toEqual([]);
    expect([...effects], 'backdrop-filter or an endless animation').toEqual([]);
  });

  test('j. the More area (v16.4): every class on screen has a rule; no blur and no endless animation, in each of its states', async ({ page }) => {
    test.setTimeout(240_000);
    const seen = new Map<string, string>();
    const effects = new Set<string>();
    const census = async (state: string) => {
      await page.waitForTimeout(250);
      await collectClasses(page, state, seen);
      const found = await page.evaluate(() => {
        const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"], [role="alertdialog"], [data-testid="notices"]'));
        const out: string[] = [];
        for (const root of roots) {
          for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const cs = getComputedStyle(el);
            const tag = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.')}`;
            if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push(`backdrop-filter ${cs.backdropFilter} on ${tag}`);
            if (cs.animationName && cs.animationName !== 'none' && /infinite/.test(cs.animationIterationCount)) out.push(`infinite animation ${cs.animationName} on ${tag}`);
          }
        }
        return out;
      });
      for (const f of found) effects.add(`${f} (${state})`);
    };
    await page.setViewportSize({ width: 411, height: 752 });
    await seedLibraryRecords(page, 6, { real: 6, seconds: 40 });
    await openNewLayout(page, { engine: 'v2', output: 'headphones' });
    await page.getByTestId('tab-library-button').click();
    await page.getByRole('button', { name: /^tone-0001/ }).first().click();
    await page.getByTestId('tab-more-button').click();
    await page.getByTestId('more-root').waitFor();
    await census('More, the root');
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    await census('More, the root, an update ready');
    await page.getByTestId('more-safety-row').click();
    await page.getByTestId('more-safety').waitFor();
    await census('Safety & comfort');
    await page.getByTestId('safety-statement-row').click();
    await page.getByTestId('more-statement').waitFor();
    await census('the safety statement');
    await page.getByRole('button', { name: 'Back to Safety & comfort', exact: true }).click();
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await page.getByTestId('more-about-row').click();
    await page.getByTestId('about-update').waitFor();
    await census('About, the update card');
    await page.getByTestId('about-tour-row').click();
    for (let i = 1; i <= 4; i++) {
      await page.getByRole('dialog', { name: `Tour, card ${i} of 4`, exact: true }).waitFor();
      await census(`the tour, card ${i}`);
      if (i < 4) await page.getByTestId('tour').getByRole('button', { name: 'Next', exact: true }).click();
    }
    await page.getByTestId('tour').getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await page.getByTestId('more-links-row').click();
    await page.getByTestId('more-links').waitFor();
    await census('Links');
    await crash(page, 'more-links');
    await page.getByTestId('more-page-fallback').waitFor();
    await census('a page fallback');
    await page.getByRole('button', { name: 'Reload panel', exact: true }).click();
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    // The Visuals sheet at each jump, with the dependent rows and the pause.
    await page.getByTestId('more-visualizer').click();
    await page.getByRole('dialog', { name: 'Visuals', exact: true }).waitFor();
    for (const j of ['look', 'hexes', 'overlays', 'motion', 'comfort'] as const) {
      await page.getByTestId(`visuals-jump-${j}`).click();
      await census(`the Visuals sheet, ${j}`);
    }
    await page.getByTestId('visuals-jump-overlays').click();
    await page.getByRole('switch', { name: 'Hydro-Acoustics', exact: true }).click();
    await page.getByRole('switch', { name: 'Lo Shu Cube', exact: true }).click();
    await census('the Visuals sheet, the cube and ripples');
    await page.getByTestId('visuals-jump-hexes').click();
    await page.getByRole('switch', { name: 'Hex grid', exact: true }).click();
    await census('the Visuals sheet, the grid off');
    await page.getByTestId('visuals-jump-comfort').click();
    await page.getByRole('switch', { name: 'Pause visuals', exact: true }).click();
    await census('the Visuals sheet, paused');
    await page.getByRole('switch', { name: 'Pause visuals', exact: true }).click();
    await crash(page, 'sheet-visuals');
    await page.getByRole('dialog', { name: 'Visuals', exact: true }).getByRole('alert').waitFor();
    await census('the Visuals sheet, fallback');
    await page.keyboard.press('Escape');
    // The menu's Visuals row; the desktop panel: More and the Visuals panel.
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-visuals').waitFor();
    await census('the menu, Visuals');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('nav-more').click();
    await page.getByTestId('desktop-panel').getByTestId('more-root').waitFor();
    await census('desktop, More');
    await page.getByTestId('more-visualizer').click();
    await page.getByRole('region', { name: 'Visuals', exact: true }).waitFor();
    await census('desktop, the Visuals panel');

    const styled = await stylesheetClasses(page);
    const unstyled = [...seen]
      .filter(([t]) => !styled.has(t) && !LUCIDE.test(t) && !INERT.has(t))
      .map(([t, state]) => `${t} (${state})`)
      .sort();
    expect(seen.size, 'the walk saw the More area').toBeGreaterThan(100);
    expect(unstyled, 'classes in the DOM with no rule').toEqual([]);
    expect([...effects], 'backdrop-filter or an endless animation').toEqual([]);
  });

  test('k. the More area part 2 (v16.5): every class on screen has a rule; no blur and no endless animation, in each of its states', async ({ page }) => {
    // Classic's moved content (the Guidebook's two views, the Journal's tracker) keeps its own look and effects (the
    // Technical view's and the tracker's pulsing dots, the tracker's own blurred modals), so the effects scan skips those
    // two subtrees; their classes are still checked.
    test.setTimeout(240_000);
    const seen = new Map<string, string>();
    const effects = new Set<string>();
    const census = async (state: string) => {
      await page.waitForTimeout(250);
      await collectClasses(page, state, seen);
      const found = await page.evaluate(() => {
        const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"], [role="alertdialog"], [data-testid="notices"]'));
        const out: string[] = [];
        for (const root of roots) {
          for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            if (el.closest('[data-testid="guide-content"], [data-testid="journal-tracker"]')) continue;
            const cs = getComputedStyle(el);
            const tag = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.')}`;
            if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push(`backdrop-filter ${cs.backdropFilter} on ${tag}`);
            if (cs.animationName && cs.animationName !== 'none' && /infinite/.test(cs.animationIterationCount)) out.push(`infinite animation ${cs.animationName} on ${tag}`);
          }
        }
        return out;
      });
      for (const f of found) effects.add(`${f} (${state})`);
    };
    await page.setViewportSize({ width: 411, height: 752 });
    await seedLibraryRecords(page, 6, {
      real: 6,
      seconds: 40,
      patch: [{ index: 0, scanned: true, fractal: { goldenRatioAlignment: 0.75, pattern111Presence: 0.55, dnaResonanceScore: 0.65, infiniteOrderHarmonics: [1838] } }],
    });
    await openNewLayout(page, { engine: 'v2', output: 'headphones' });
    // Before anything plays: Record not ready.
    await page.getByTestId('tab-more-button').click();
    await page.getByTestId('more-root').waitFor();
    await census('More, the root (v16.5)');
    await page.getByTestId('more-record-row').click();
    await page.getByRole('dialog', { name: 'Record', exact: true }).waitFor();
    await census('Record, not ready');
    await page.keyboard.press('Escape');
    await page.getByTestId('tab-library-button').click();
    await page.getByRole('button', { name: /^tone-0001/ }).first().click();
    await page.getByTestId('tab-more-button').click();
    await page.getByTestId('more-record-row').click();
    await page.getByRole('dialog', { name: 'Record', exact: true }).getByTestId('record-option-audio').waitFor();
    await census('Record, ready');
    await page.getByTestId('record-option-audio').click();
    await page.getByTestId('record-recording').waitFor();
    await census('Record, recording');
    await crash(page, 'sheet-record');
    await page.getByRole('dialog', { name: 'Record', exact: true }).getByRole('alert').waitFor();
    await census('Record, fallback');
    await page.keyboard.press('Escape');
    await page.getByTestId('more-recording-card').waitFor();
    await census('More, the root while recording');
    await page.getByTestId('tab-library-button').click();
    await page.getByTestId('mini-player').getByTestId('rec-open').waitFor();
    await census('Library, REC on the mini-player');
    await page.getByTestId('tab-now-button').click();
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-body').waitFor();
    await census('the menu while recording');
    await page.keyboard.press('Escape');
    await page.getByTestId('tab-more-button').click();
    await page.getByTestId('more-stop-recording').click();
    // The Guide, both views.
    await page.getByTestId('more-guide-row').click();
    await page.getByTestId('more-guide').waitFor();
    await census('the Guide, Plain language');
    await page.getByTestId('guide-view-technical').click();
    await census('the Guide, Technical');
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    // The Journal, Advanced, the scan scores.
    await page.getByTestId('more-journal-row').click();
    await page.getByTestId('more-journal').waitFor();
    await census('the Journal');
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await page.getByTestId('more-advanced-row').click();
    await page.getByTestId('more-advanced').waitFor();
    await census('Advanced');
    await page.getByTestId('advanced-scan-scores').getByRole('switch').click();
    await census('Advanced, the scores on');
    await page.getByTestId('tab-library-button').click();
    await page.locator('[data-scan-badge]').first().waitFor();
    await census('Library, the scan-score badges');
    await page.getByRole('button', { name: 'Options for tone-0001', exact: true }).click();
    await page.getByRole('button', { name: /Track info/ }).first().click();
    await page.getByTestId('track-info-scores').waitFor();
    await census('Track info, the scores');
    await page.getByTestId('track-info-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTestId('tab-more-button').click();
    await crash(page, 'more-advanced');
    await page.getByTestId('more-page-fallback').waitFor();
    await census('a v16.5 page fallback');
    await page.getByRole('button', { name: 'Reload panel', exact: true }).click();
    // The desktop panel: Record and the Guide.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('nav-more').click();
    await page.getByTestId('desktop-panel').getByTestId('more').waitFor();
    if ((await page.getByTestId('more').getAttribute('data-more-view')) !== 'root') await page.getByTestId('nav-more').click();
    await page.getByTestId('more-record-row').click();
    await page.getByRole('region', { name: 'Record', exact: true }).waitFor();
    await census('desktop, the Record panel');

    const styled = await stylesheetClasses(page);
    const unstyled = [...seen]
      .filter(([t]) => !styled.has(t) && !LUCIDE.test(t) && !INERT.has(t))
      .map(([t, state]) => `${t} (${state})`)
      .sort();
    expect(seen.size, 'the walk saw the part-2 pages').toBeGreaterThan(100);
    expect(unstyled, 'classes in the DOM with no rule').toEqual([]);
    expect([...effects], 'backdrop-filter or an endless animation').toEqual([]);
  });

  test('l. Export with layers (v16.5): every class on screen has a rule; no blur and no endless animation, in each of its states', async ({ page }) => {
    test.setTimeout(240_000);
    const seen = new Map<string, string>();
    const effects = new Set<string>();
    const census = async (state: string) => {
      await page.waitForTimeout(250);
      await collectClasses(page, state, seen);
      const found = await page.evaluate(() => {
        const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"], [role="alertdialog"], [data-testid="notices"]'));
        const out: string[] = [];
        for (const root of roots) {
          for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const cs = getComputedStyle(el);
            const tag = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.')}`;
            if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push(`backdrop-filter ${cs.backdropFilter} on ${tag}`);
            if (cs.animationName && cs.animationName !== 'none' && /infinite/.test(cs.animationIterationCount)) out.push(`infinite animation ${cs.animationName} on ${tag}`);
          }
        }
        return out;
      });
      for (const f of found) effects.add(`${f} (${state})`);
    };
    await page.addInitScript(() => {
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (this.hasAttribute('download')) return;
        return click.call(this);
      };
    });
    await page.setViewportSize({ width: 411, height: 752 });
    await seedLibraryRecords(page, 4, { real: 4, seconds: 12, playlists: [{ id: 'pstyles1', name: 'Evening', indexes: [0, 1, 2], missing: 1 }] });
    await openNewLayout(page, { engine: 'v2', output: 'headphones' });
    await page.getByTestId('tab-library-button').click();
    await page.getByRole('button', { name: 'Options for tone-0001', exact: true }).click();
    await page.getByTestId('library-menu-export').waitFor();
    await census('the row ⋯ with Export');
    await page.getByTestId('library-menu-export').click();
    await page.getByTestId('export-summary').waitFor();
    await census('Export, the summary (a track)');
    await page.getByRole('group', { name: 'Made for' }).getByRole('button', { name: 'Speakers' }).click();
    await census('Export, Made for Speakers');
    await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.tuning === 'function');
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 40 }));
    await page.getByTestId('export-start').click();
    await page.getByTestId('export-running').waitFor();
    await census('Export, running');
    await page.getByTestId('export-done').waitFor({ timeout: 60_000 });
    await census('Export, done');
    await page.getByTestId('export-done-button').click();
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(5));
    await page.getByRole('button', { name: 'Options for tone-0002', exact: true }).click();
    await page.getByTestId('library-menu-export').click();
    await page.getByTestId('export-cant').waitFor();
    await census('Export, over the cap');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(null));
    await page.getByTestId('library-view-playlists').click();
    await page.getByRole('button', { name: 'Options for Evening', exact: true }).click();
    await page.getByTestId('playlist-menu-export').waitFor();
    await census('the playlist ⋯ with Export');
    await page.getByTestId('playlist-menu-export').click();
    await page.getByTestId('export-tracks').waitFor();
    await census('Export, a playlist');
    await page.getByTestId('export-files-long').click();
    await census('Export, a playlist as one long file');
    await page.getByTestId('export-start').click();
    await page.getByTestId('export-running').waitFor();
    await page.keyboard.press('Escape');
    await page.getByTestId('tab-more-button').click();
    await page.getByTestId('more-exporting-card').waitFor();
    await census('More while exporting');
    await page.getByTestId('more-record-row').click();
    await page.getByTestId('record-make-file').waitFor();
    await census('Record, Make a file while exporting');
    await page.keyboard.press('Escape');
    // The crash drill on the open sheet (a crash arms the mounted region), then the job cancelled for the desktop part.
    await page.getByTestId('more-exporting-open').click();
    await page.getByRole('dialog', { name: 'Export with layers', exact: true }).getByTestId('export-running').waitFor();
    await crash(page, 'sheet-export');
    await page.getByRole('dialog', { name: 'Export with layers', exact: true }).getByRole('alert').waitFor();
    await census('Export, fallback');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { (window as any).__aetheriaExport.cancel(); (window as any).__aetheriaExport.tuning({ sliceDelayMs: 0 }); });
    await page.waitForFunction(() => !(window as any).__aetheriaExport.state().running, null, { timeout: 15_000 });
    // The desktop panel.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('nav-library').click();
    await page.getByTestId('library-view-tracks').click(); // the Library came back on Playlists
    await page.getByRole('button', { name: 'Options for tone-0003', exact: true }).click();
    await page.getByTestId('library-menu-export').click();
    await page.getByRole('region', { name: 'Export with layers', exact: true }).waitFor();
    await census('desktop, the Export panel');

    const styled = await stylesheetClasses(page);
    const unstyled = [...seen]
      .filter(([t]) => !styled.has(t) && !LUCIDE.test(t) && !INERT.has(t))
      .map(([t, state]) => `${t} (${state})`)
      .sort();
    expect(seen.size, 'the walk saw Export').toBeGreaterThan(100);
    expect(unstyled, 'classes in the DOM with no rule').toEqual([]);
    expect([...effects], 'backdrop-filter or an endless animation').toEqual([]);
  });

  test('d. the --ae-* CSS variables equal the tailwind.config.js tokens', async ({ page }) => {
    // The config is ESM (the root package is "type": "module"); imported through a data: URL so the test runner's
    // own loader never transforms it.
    const source = readFileSync(TAILWIND_CONFIG, 'utf8');
    const config = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
    const ext = config.theme.extend;
    const expected = new Map<string, string>();
    for (const group of ['gold', 'surface', 'ink', 'line', 'regime', 'status']) {
      expect(ext.colors[group], `colors.${group} in the config`).toBeTruthy();
      for (const [key, value] of Object.entries(ext.colors[group] as Record<string, string>)) {
        expected.set(key === 'DEFAULT' ? `--ae-${group}` : `--ae-${group}-${key}`, value);
      }
    }
    const scales: Array<[string, string, string[]]> = [
      ['spacing', '--ae-', []],
      ['borderRadius', '--ae-radius-', ['pill']], // = rounded-full; no variable
      ['transitionDuration', '--ae-dur-', []],
      ['transitionTimingFunction', '--ae-ease-', []],
    ];
    for (const [scale, prefix, without] of scales) {
      for (const [key, value] of Object.entries(ext[scale] as Record<string, string>)) {
        if (!without.includes(key)) expected.set(`${prefix}${key}`, value);
      }
    }

    await openApp(page);
    const actual = await page.evaluate((names) => {
      const cs = getComputedStyle(document.documentElement);
      const values: Record<string, string> = {};
      for (const n of names) values[n] = cs.getPropertyValue(n).trim();
      // Every --ae-* declared on :root, so a variable without a token fails too.
      const declared = new Set<string>();
      const walk = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          const style = (rule as CSSStyleRule).style;
          if (style && (rule as CSSStyleRule).selectorText === ':root') {
            for (const prop of Array.from(style)) if (prop.startsWith('--ae-')) declared.add(prop);
          }
          const inner = (rule as CSSGroupingRule).cssRules;
          if (inner) walk(inner);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules);
        } catch {}
      }
      return { values, declared: [...declared] };
    }, [...expected.keys()]);

    const norm = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();
    const mismatched = [...expected]
      .filter(([name, value]) => norm(actual.values[name]) !== norm(value))
      .map(([name, value]) => `${name}: page "${actual.values[name]}", config "${value}"`);
    expect(mismatched, 'variables that differ from the config').toEqual([]);
    const orphans = actual.declared.filter((n) => !expected.has(n));
    expect(orphans, '--ae-* variables with no token in the config').toEqual([]);
    expect(expected.size, 'tokens checked').toBeGreaterThan(40);
  });
});
