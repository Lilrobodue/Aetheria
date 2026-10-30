import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  PHONE_VIEWPORT,
  crash,
  drawsPerSecond,
  layerState,
  instrumentAudio,
  libraryState,
  newShell,
  pauseCount,
  recordHudDraws,
  renders,
  resetRenders,
  tab,
  tapCount,
} from './helpers';
import {
  DRAWING,
  canvasHidden,
  moreRow,
  moreView,
  openMorePage,
  playingSeeded,
  smallTargets,
  unnamedControls,
  visualsSheet,
} from './moreKit';

// v16.4, the More area, part 1 (spec §3.2, §5.3 more.spec): the root's structure and its status lines, the pages'
// navigation (focus, Back, where it was left), the heat guard on every page, each page's crash region, renders while
// playing, accessibility, and the tap counts. Runs against the dev server (the crash and render drills need its
// hooks); every test fails on v16.1, which has no More rows, pages or sheet (§5.4).

const PAGES = [
  { view: 'safety', title: 'Safety & comfort', row: 'more-safety-row', back: 'Back to More' },
  { view: 'about', title: 'About', row: 'more-about-row', back: 'Back to More' },
  { view: 'links', title: 'Links', row: 'more-links-row', back: 'Back to More' },
] as const;

const heading = (page: Page) => page.getByTestId('more').getByRole('heading', { level: 1 });

/** Over the next 2 s the music moves on, with no pause() (layout.spec's check, shortened). */
async function expectMusicMoves(page: Page, label: string): Promise<void> {
  const t0 = (await layerState(page)).music?.time ?? 0;
  const p0 = await pauseCount(page);
  await page.waitForTimeout(2000);
  const s = await layerState(page);
  expect.soft((s.music?.time ?? 0) - t0, `${label}: the music moved on`).toBeGreaterThanOrEqual(1.5);
  expect.soft(s.music?.paused, `${label}: not paused`).toBe(false);
  expect.soft(await pauseCount(page), `${label}: no pause()`).toBe(p0);
}

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('M1. the root: four headings and their rows in order; the Visualizer and About lines follow their state', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page);
    await tab(page, 'more');
    const root = page.getByTestId('more-root');
    await expect(root).toBeVisible();
    await expect(heading(page)).toHaveText('More');
    await expect(root.locator('h2')).toHaveText(['Visuals and recording', 'Safety', 'About', 'In the classic layout for now']);
    await expect(root.locator('section')).toHaveCount(4);
    for (const s of await root.locator('section').all()) {
      const by = await s.getAttribute('aria-labelledby');
      expect(by && (await page.locator(`#${by}`).count()), 'each group is labelled by its heading').toBe(1);
    }
    await expect(root.getByRole('button')).toHaveText([
      /^Visualizer/,
      /^Safety & comfort/,
      /^About/,
      /^Links/,
      /^Guide, Record, Journal, scan scores/,
    ]);
    const viz = moreRow(page, 'more-visualizer');
    await expect(viz).toContainText('Spectrum Lens · Chakra · wandering hexes · 30 fps');
    await expect(moreRow(page, 'more-safety-row')).toContainText('Stop all sound, Music only, the safety statement');
    await expect(moreRow(page, 'more-links-row')).toContainText('Apps, books, music, community and contact');
    await expect(moreRow(page, 'more-back-to-classic')).toContainText('Use the classic layout; the music keeps playing');
    // About: the version, then "an update is ready" and its dot once one is.
    const about = moreRow(page, 'more-about-row');
    await expect(about).toContainText('Version v16.4');
    await expect(about).not.toContainText('an update is ready');
    await expect(page.getByTestId('more-update-dot')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    await expect(about).toContainText('Version v16.4 · an update is ready');
    await expect(page.getByTestId('more-update-dot')).toBeVisible();
    // The Visualizer line follows a setting changed in the sheet, and Pause visuals.
    await viz.click();
    await expect(visualsSheet(page)).toBeVisible();
    await visualsSheet(page).getByRole('group', { name: 'Visualizer colours' }).getByRole('button', { name: 'Hypnotic', exact: true }).click();
    await page.getByTestId('visuals-jump-comfort').click();
    await page.getByTestId('visuals-pause').getByRole('switch').click();
    await page.keyboard.press('Escape');
    await tab(page, 'more');
    await expect(moreRow(page, 'more-visualizer')).toContainText('Paused · the music plays on');
    await moreRow(page, 'more-visualizer').click();
    await page.getByTestId('visuals-jump-comfort').click();
    await page.getByTestId('visuals-pause').getByRole('switch').click();
    await page.keyboard.press('Escape');
    await tab(page, 'more');
    await expect(moreRow(page, 'more-visualizer')).toContainText('Spectrum Lens · Hypnotic · wandering hexes · 30 fps');
    expect(dialogs).toEqual([]);
  });

  test('M2. each page opens with its h1 focused; Back returns to its row; Library and back keeps the page and its scroll; the More tab again goes to the root', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingSeeded(page);
    await tab(page, 'more');
    for (const p of PAGES) {
      await moreRow(page, p.row).click();
      await expect.poll(() => moreView(page)).toBe(p.view);
      await expect(heading(page)).toHaveText(p.title);
      await expect(heading(page), `${p.title}: its h1 has the focus`).toBeFocused();
      const back = page.getByRole('button', { name: p.back, exact: true });
      // Back is first in the page's tab order (the header's first control).
      const first = await page.getByTestId('more').evaluate((el) => {
        const f = el.querySelector('button, a[href], input, select, [tabindex="0"]');
        return f?.getAttribute('aria-label') ?? null;
      });
      expect(first, `${p.title}: Back first`).toBe(p.back);
      await back.click();
      await expect.poll(() => moreView(page)).toBe('root');
      await expect(moreRow(page, p.row), `${p.title}: Back returns to its row`).toBeFocused();
    }
    // The statement, under Safety & comfort.
    await moreRow(page, 'more-safety-row').click();
    await page.getByTestId('safety-statement-row').click();
    await expect.poll(() => moreView(page)).toBe('statement');
    await expect(heading(page)).toHaveText('Safety statement');
    await expect(heading(page)).toBeFocused();
    await page.getByRole('button', { name: 'Back to Safety & comfort', exact: true }).click();
    await expect.poll(() => moreView(page)).toBe('safety');
    await expect(page.getByTestId('safety-statement-row')).toBeFocused();
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();

    // Links, scrolled; Library and back: the same page at the same place.
    await moreRow(page, 'more-links-row').click();
    const scroller = page.getByTestId('more-scroll');
    await scroller.evaluate((el) => (el.scrollTop = 300));
    // The phone reports a fractional scrollTop (300.19 on the Note 20: device pixels), so within a pixel.
    await expect.poll(() => scroller.evaluate((el) => Math.abs(el.scrollTop - 300) <= 1)).toBe(true);
    await tab(page, 'library');
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await tab(page, 'more');
    await expect.poll(() => moreView(page)).toBe('links');
    const top = await page.getByTestId('more-scroll').evaluate((el) => el.scrollTop);
    expect(Math.abs(top - 300), `the scroll is kept (${top})`).toBeLessThanOrEqual(2);
    // The More tab, tapped while it shows: the root.
    await tab(page, 'more');
    await expect.poll(() => moreView(page)).toBe('root');
    expect(dialogs).toEqual([]);
  });

  test('M2b. Links opened from About goes Back to About (to its Links row), also after Library and back; from the root, Back to More', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingSeeded(page);
    await openMorePage(page, 'about');
    await page.getByTestId('about-links-row').click();
    await expect.poll(() => moreView(page)).toBe('links');
    await expect(heading(page)).toHaveText('Links');
    await expect(heading(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Back to About', exact: true }), "Links' Back names About, which opened it").toBeVisible();
    await page.getByRole('button', { name: 'Back to About', exact: true }).click();
    await expect.poll(() => moreView(page), { message: 'Back returns to About, where Links was opened' }).toBe('about');
    await expect(page.getByTestId('about-links-row'), "About's Links row has the focus").toBeFocused();
    // Where it was left holds the opener: Library and back, then Back still goes to About.
    await page.getByTestId('about-links-row').click();
    await expect.poll(() => moreView(page)).toBe('links');
    await tab(page, 'library');
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await tab(page, 'more');
    await expect.poll(() => moreView(page)).toBe('links');
    await page.getByRole('button', { name: 'Back to About', exact: true }).click();
    await expect.poll(() => moreView(page)).toBe('about');
    // From the root, Links' Back is "Back to More" and goes to the root.
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await expect.poll(() => moreView(page)).toBe('root');
    await moreRow(page, 'more-links-row').click();
    await expect.poll(() => moreView(page)).toBe('links');
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await expect.poll(() => moreView(page)).toBe('root');
    await expect(moreRow(page, 'more-links-row')).toBeFocused();
    expect(dialogs).toEqual([]);
  });

  test('M3. on every More page the visualizer is paused (display:none, 0 draws); back on Now Playing the same canvas draws @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await recordHudDraws(page);
    const dialogs = await playingSeeded(page);
    await tab(page, 'now');
    await page.evaluate(() => ((document.getElementById('viz-canvas') as any).__m3 = 1));
    for (const view of ['root', 'safety', 'statement', 'about', 'links'] as const) {
      if (view === 'root') await tab(page, 'more');
      else await openMorePage(page, view);
      await expect.poll(() => canvasHidden(page), { message: `${view}: the canvas is hidden` }).toBe(true);
      // The window running at the switch may still hold a draw: the next two.
      const d = (await drawsPerSecond(page, 3)).slice(1);
      expect(d, `${view}: draws/s`).toEqual([0, 0]);
    }
    await tab(page, 'now');
    await expect.poll(() => canvasHidden(page)).toBe(false);
    const d = await drawsPerSecond(page, 2);
    expect(Math.min(...d), 'Now Playing draws again').toBeGreaterThanOrEqual(DRAWING);
    expect(await page.evaluate(() => (document.getElementById('viz-canvas') as any).__m3), 'the same canvas node').toBe(1);
    expect(dialogs).toEqual([]);
  });

  test('M5. 3 s of playback re-render no More page (DEV); MiniProgress follows the clock', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingSeeded(page);
    const pagesOf = { root: 'MoreRoot', safety: 'SafetyPage', statement: 'StatementPage', about: 'AboutPage', links: 'LinksPage' } as const;
    for (const [view, name] of Object.entries(pagesOf) as Array<[keyof typeof pagesOf, string]>) {
      if (view === 'root') {
        await tab(page, 'more');
        if ((await moreView(page)) !== 'root') await tab(page, 'more');
      } else await openMorePage(page, view);
      await page.waitForTimeout(500);
      await resetRenders(page);
      await page.waitForTimeout(3000);
      const r = await renders(page);
      test.info().annotations.push({ type: `renders over 3 s on ${view}`, description: JSON.stringify(r) });
      expect(r[name] ?? 0, `${name} over 3 s of playback`).toBe(0);
      expect(r.MoreTab ?? 0, `MoreTab over 3 s on ${view}`).toBe(0);
      expect(r.MiniProgress ?? 0, `MiniProgress follows the clock on ${view}`).toBeGreaterThanOrEqual(8);
    }
    expect((await libraryState(page)).playing).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('M6. the root and every page: no unnamed control in Chrome\'s accessibility tree, every target at least 44 × 44', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingSeeded(page);
    for (const view of ['root', 'safety', 'statement', 'about', 'links'] as const) {
      if (view === 'root') {
        await tab(page, 'more');
        if ((await moreView(page)) !== 'root') await tab(page, 'more');
      } else await openMorePage(page, view);
      await page.waitForTimeout(300);
      expect.soft(await unnamedControls(page), `${view}: unnamed controls`).toEqual([]);
      expect.soft(await smallTargets(page), `${view}: targets under 44 × 44`).toEqual([]);
    }
    // The update card's buttons too.
    await openMorePage(page, 'about');
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    await expect(page.getByTestId('about-update')).toBeVisible();
    expect.soft(await smallTargets(page), 'About with the update card: targets').toEqual([]);
    expect.soft(await unnamedControls(page), 'About with the update card: names').toEqual([]);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, crash drills', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  const DRILLS = [
    { view: 'more', open: async (p: Page) => tab(p, 'more'), present: 'more-root' },
    { view: 'more-safety', open: async (p: Page) => openMorePage(p, 'safety'), present: 'more-safety' },
    { view: 'more-about', open: async (p: Page) => openMorePage(p, 'about'), present: 'more-about' },
    { view: 'more-links', open: async (p: Page) => openMorePage(p, 'links'), present: 'more-links' },
  ] as const;

  for (const d of DRILLS) {
    test(`M4. a crash in ${d.view} shows its fallback, the music plays on, the other pages work, Reload panel restores it (DEV)`, async ({ page }) => {
      test.setTimeout(120_000);
      await instrumentAudio(page);
      const dialogs = await playingSeeded(page);
      await d.open(page);
      await expect(page.getByTestId(d.present)).toBeVisible();
      const pauses = await pauseCount(page);
      await crash(page, d.view);
      const fallback = page.getByRole('alert').filter({ hasText: /hit a problem/ });
      await expect(fallback).toBeVisible();
      await expectMusicMoves(page, `after the ${d.view} crash`);
      if (d.view !== 'more') {
        // The header's Back still works, and another page opens.
        await page.getByRole('button', { name: 'Back to More', exact: true }).click();
        await expect.poll(() => moreView(page)).toBe('root');
        const other = d.view === 'more-links' ? 'about' : 'links';
        await moreRow(page, `more-${other}-row`).click();
        await expect(page.getByTestId(`more-${other}`), 'another page opens').toBeVisible();
        await page.getByRole('button', { name: 'Back to More', exact: true }).click();
        await d.open(page);
      }
      await page.getByRole('button', { name: 'Reload panel', exact: true }).click();
      await expect(fallback).toHaveCount(0);
      await expect(page.getByTestId(d.present), 'the region is back').toBeVisible();
      await expectMusicMoves(page, `after reloading ${d.view}`);
      expect(await pauseCount(page), 'no pause through the drill').toBe(pauses);
      await expect(newShell(page)).toBeVisible();
      expect(dialogs).toEqual([]);
    });
  }
});

test.describe('phone, touch', () => {
  test.use({ viewport: PHONE_VIEWPORT, hasTouch: true });

  test('M7. tap counts: Visuals 2, the statement 3, Keep screen awake 3, About 2, Links 2 @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingSeeded(page);
    const taps = tapCount(page);
    // Each count starts on Now Playing (or Library), with More left at its root.
    const fromRoot = async (start: 'now' | 'library' = 'now') => {
      await tab(page, 'more');
      if ((await moreView(page)) !== 'root') await tab(page, 'more');
      await expect.poll(() => moreView(page)).toBe('root');
      await tab(page, start);
      await expect(page.getByTestId(start === 'now' ? 'view-now' : 'tab-library')).toBeVisible();
      taps.reset();
    };
    // The visual settings from another tab: More › Visualizer.
    await fromRoot('library');
    await taps.tap(page.getByTestId('tab-more-button'));
    await expect.poll(() => moreView(page)).toBe('root');
    await taps.tap(moreRow(page, 'more-visualizer'));
    await expect(visualsSheet(page)).toBeVisible();
    expect(taps.count, 'Visuals from another tab').toBe(2);
    await page.keyboard.press('Escape');
    // From Now Playing: ⋯ › Visuals.
    await fromRoot();
    await taps.tap(page.getByTestId('np-menu-button'));
    await expect(page.getByTestId('menu-visuals')).toBeVisible();
    await taps.tap(page.getByTestId('menu-visuals'));
    await expect(visualsSheet(page)).toBeVisible();
    expect(taps.count, 'Visuals from Now Playing').toBe(2);
    await page.keyboard.press('Escape');
    // The statement: More › Safety & comfort › Safety statement.
    await fromRoot();
    await taps.tap(page.getByTestId('tab-more-button'));
    await expect.poll(() => moreView(page)).toBe('root');
    await taps.tap(moreRow(page, 'more-safety-row'));
    await expect.poll(() => moreView(page)).toBe('safety');
    await taps.tap(page.getByTestId('safety-statement-row'));
    await expect.poll(() => moreView(page)).toBe('statement');
    expect(taps.count, 'the statement').toBe(3);
    // Keep screen awake: More › Safety & comfort › the switch.
    await fromRoot();
    await taps.tap(page.getByTestId('tab-more-button'));
    await expect.poll(() => moreView(page)).toBe('root');
    await taps.tap(moreRow(page, 'more-safety-row'));
    await expect.poll(() => moreView(page)).toBe('safety');
    const awake = page.getByTestId('safety-keep-awake').getByRole('switch');
    await taps.tap(awake);
    await expect(awake).toHaveAttribute('aria-checked', 'false');
    expect(taps.count, 'Keep screen awake').toBe(3);
    await awake.click(); // back on
    await expect(awake).toHaveAttribute('aria-checked', 'true');
    // About and Links: two each.
    for (const [row, view] of [['more-about-row', 'about'], ['more-links-row', 'links']] as const) {
      await fromRoot();
      await taps.tap(page.getByTestId('tab-more-button'));
      await expect.poll(() => moreView(page)).toBe('root');
      await taps.tap(moreRow(page, row));
      await expect.poll(() => moreView(page)).toBe(view);
      expect(taps.count, view).toBe(2);
    }
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('M1d. on the desktop More is the 420 px panel, its pages open inside it with Back, and Escape closes it', async ({ page }) => {
    test.skip(ON_DEVICE, 'the desktop shell');
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page);
    await tab(page, 'more');
    const panel = page.getByTestId('desktop-panel');
    await expect(panel.getByTestId('more-root')).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(Math.round(box.width)).toBe(420);
    await expect(heading(page)).toBeFocused();
    await expect(panel.getByRole('button', { name: 'Close panel', exact: true })).toBeVisible();
    await moreRow(page, 'more-about-row').click();
    await expect(panel.getByTestId('more-about')).toBeVisible();
    await expect(heading(page)).toHaveText('About');
    await panel.getByRole('button', { name: 'Back to More', exact: true }).click();
    await expect(panel.getByTestId('more-root')).toBeVisible();
    expect.soft(await unnamedControls(page), 'the desktop panel: names').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('M1e. on the desktop, with the Visuals panel in More\'s place, a click on the active More section opens More at its root', async ({ page }) => {
    test.skip(ON_DEVICE, 'the desktop shell');
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page);
    await tab(page, 'more');
    const panel = page.getByTestId('desktop-panel');
    await moreRow(page, 'more-about-row').click();
    await expect(panel.getByTestId('more-about')).toBeVisible();
    // ⋯ › Visuals: the panel shows the Visuals sheet; More stays the active section (its tab is not mounted).
    await page.getByTestId('desktop-transport').getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByTestId('menu-visuals').click();
    await expect(panel.getByRole('region', { name: 'Visuals', exact: true })).toBeVisible();
    await expect(page.getByTestId('more')).toHaveCount(0);
    await expect(page.getByTestId('nav-more')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('nav-more').click();
    await expect(panel.getByTestId('more')).toBeVisible();
    await expect.poll(() => moreView(page), { message: 'the active More section: its root' }).toBe('root');
    await expect(panel.getByTestId('more-root')).toBeVisible();
    expect(dialogs).toEqual([]);
  });
});
