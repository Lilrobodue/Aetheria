import { type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { crash, hideZen, importTones, openApp, openHarmonicControl, openSafety } from './helpers';

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
