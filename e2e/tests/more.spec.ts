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
// v16.5 (part 2): the full root (five headings: Record, Guide, Journal and Advanced join; the classic row moved into
// Advanced), the three new pages in every walk (M2, M3, M5, M6, the crash drills), and M7b's tap counts.

const PAGES = [
  { view: 'safety', title: 'Safety & comfort', row: 'more-safety-row', back: 'Back to More' },
  { view: 'about', title: 'About', row: 'more-about-row', back: 'Back to More' },
  { view: 'links', title: 'Links', row: 'more-links-row', back: 'Back to More' },
  { view: 'guide', title: 'Guide', row: 'more-guide-row', back: 'Back to More' },
  { view: 'journal', title: 'Journal', row: 'more-journal-row', back: 'Back to More' },
  { view: 'advanced', title: 'Advanced', row: 'more-advanced-row', back: 'Back to More' },
] as const;

/** Every page of the More tab (the root first). */
const ALL_VIEWS = ['root', 'safety', 'statement', 'about', 'links', 'guide', 'journal', 'advanced'] as const;

/** The page's own h1 (the Guide's Plain language view brings the Guidebook's own h1 too: classic's, moved verbatim). */
const heading = (page: Page) => page.getByTestId('more').locator('h1[data-view-heading]');

/** v16.5: targets under 44 × 44 outside the Guide's content (classic's Guidebook, moved verbatim). */
async function smallOutsideGuideContent(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const content = document.querySelector('[data-testid="guide-content"]');
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="new-shell"] button, [data-testid="new-shell"] a[href], [data-testid="new-shell"] [role="switch"]'))) {
      if (content && content.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('.sr-only')) continue;
      const after = getComputedStyle(el, '::after');
      let w = r.width;
      let h = r.height;
      if (after.content && after.content !== 'none' && after.position === 'absolute') {
        const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
        w = Math.max(w, r.width - px(after.left) - px(after.right));
        h = Math.max(h, r.height - px(after.top) - px(after.bottom));
      }
      if (w < 43.5 || h < 43.5) out.push(`${el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30)}: ${Math.round(w)}×${Math.round(h)}`);
    }
    return out;
  });
}

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

  test('M1. the root: five headings and their rows in order; the Visualizer, About and Journal lines follow their state', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page);
    await tab(page, 'more');
    const root = page.getByTestId('more-root');
    await expect(root).toBeVisible();
    await expect(heading(page)).toHaveText('More');
    await expect(root.locator('h2')).toHaveText(['Visuals and recording', 'Learn', 'Safety', 'About', 'Advanced']);
    await expect(root.locator('section')).toHaveCount(5);
    for (const s of await root.locator('section').all()) {
      const by = await s.getAttribute('aria-labelledby');
      expect(by && (await page.locator(`#${by}`).count()), 'each group is labelled by its heading').toBe(1);
    }
    await expect(root.getByRole('button')).toHaveText([/^Visualizer/, /^Record/, /^Guide/, /^Journal/, /^Safety & comfort/, /^About/, /^Links/, /^Advanced/]);
    const viz = moreRow(page, 'more-visualizer');
    await expect(viz).toContainText('Spectrum Lens · Chakra · wandering hexes · 30 fps');
    await expect(moreRow(page, 'more-safety-row')).toContainText('Stop all sound, Music only, the safety statement');
    await expect(moreRow(page, 'more-links-row')).toContainText('Apps, books, music, community and contact');
    await expect(moreRow(page, 'more-record-row')).toContainText('Audio, visuals or both, saved to your downloads');
    await expect(moreRow(page, 'more-guide-row')).toContainText('Plain language or technical, with the Lo Shu cube');
    await expect(moreRow(page, 'more-journal-row')).toContainText('Notes on how a session felt, kept on this device');
    await expect(moreRow(page, 'more-journal-row')).toContainText('Experimental');
    await expect(moreRow(page, 'more-advanced-row')).toContainText('Experimental scan scores, the classic layout');
    await expect(moreRow(page, 'more-back-to-classic'), 'the classic row moved into Advanced').toHaveCount(0);
    // About: the version, then "an update is ready" and its dot once one is.
    const about = moreRow(page, 'more-about-row');
    await expect(about).toContainText('Version v16.6');
    await expect(about).not.toContainText('an update is ready');
    await expect(page.getByTestId('more-update-dot')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    await expect(about).toContainText('Version v16.6 · an update is ready');
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
    for (const view of ALL_VIEWS) {
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
    const pagesOf = { root: 'MoreRoot', safety: 'SafetyPage', statement: 'StatementPage', about: 'AboutPage', links: 'LinksPage', guide: 'GuidePage', journal: 'JournalPage', advanced: 'AdvancedPage' } as const;
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
    for (const view of ALL_VIEWS) {
      if (view === 'root') {
        await tab(page, 'more');
        if ((await moreView(page)) !== 'root') await tab(page, 'more');
      } else await openMorePage(page, view);
      await page.waitForTimeout(300);
      expect.soft(await unnamedControls(page), `${view}: unnamed controls`).toEqual([]);
      // v16.5: the Guide's content is classic's Guidebook, moved verbatim (its inline text links and the cube's small
      // classic buttons keep their sizes until the copy and polish passes); its own controls are held to 44 × 44.
      const small = await smallTargets(page);
      expect.soft(view === 'guide' ? await smallOutsideGuideContent(page) : small, `${view}: targets under 44 × 44`).toEqual([]);
    }
    // The Guide's Technical view: the cube's controls are named.
    await openMorePage(page, 'guide');
    await page.getByTestId('guide-view-technical').click();
    expect.soft(await unnamedControls(page), 'the Guide, Technical: unnamed controls').toEqual([]);
    expect.soft(await smallOutsideGuideContent(page), 'the Guide, Technical: its own targets').toEqual([]);
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
    // v16.5
    { view: 'more-guide', open: async (p: Page) => openMorePage(p, 'guide'), present: 'more-guide' },
    { view: 'more-journal', open: async (p: Page) => openMorePage(p, 'journal'), present: 'more-journal' },
    { view: 'more-advanced', open: async (p: Page) => openMorePage(p, 'advanced'), present: 'more-advanced' },
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
    // About and Links: two each. v16.5 re-review (M7): the More root is taller now, and the Links row sits where the
    // restore's toast ("✓ Restored N tracks from cache") shows for its first seconds: let it go first (as M7b does
    // for "Saved to your downloads").
    await expect(page.getByText(/Restored \d+ tracks? from cache/)).toHaveCount(0, { timeout: 20_000 });
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

test.describe('phone, touch (v16.5)', () => {
  test.use({ viewport: PHONE_VIEWPORT, hasTouch: true });

  test('M7b. tap counts (v16.5): the Guide 2, a recording 3 from another tab and 3 from Now Playing, the classic layout 3, stopping a recording 2 from another tab @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const { stubDownloads, caughtDownloads } = await import('./downloads');
    await stubDownloads(page);
    const dialogs = await playingSeeded(page);
    const taps = tapCount(page);
    const fromRoot = async (start: 'now' | 'library' = 'now') => {
      await tab(page, 'more');
      if ((await moreView(page)) !== 'root') await tab(page, 'more');
      await expect.poll(() => moreView(page)).toBe('root');
      await tab(page, start);
      await expect(page.getByTestId(start === 'now' ? 'view-now' : 'tab-library')).toBeVisible();
      taps.reset();
    };
    // The Guide: More › Guide.
    await fromRoot('library');
    await taps.tap(page.getByTestId('tab-more-button'));
    await expect.poll(() => moreView(page)).toBe('root');
    await taps.tap(moreRow(page, 'more-guide-row'));
    await expect.poll(() => moreView(page)).toBe('guide');
    expect(taps.count, 'the Guide').toBe(2);
    // A recording from Now Playing: ⋯ › Record › Audio Only.
    await fromRoot();
    await taps.tap(page.getByTestId('np-menu-button'));
    await expect(page.getByTestId('menu-record')).toBeVisible();
    await taps.tap(page.getByTestId('menu-record'));
    const sheet = page.getByRole('dialog', { name: 'Record', exact: true });
    await expect(sheet).toBeVisible();
    await taps.tap(sheet.getByTestId('record-option-audio'));
    await expect(sheet.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    expect(taps.count, 'a recording from Now Playing').toBe(3);
    await page.keyboard.press('Escape');
    // Stopping it from another tab: the mini-player's REC › Stop and save.
    await tab(page, 'library');
    taps.reset();
    await taps.tap(page.getByTestId('mini-player').getByTestId('rec-open'));
    await expect(sheet).toBeVisible();
    await taps.tap(sheet.getByTestId('record-stop-save'));
    await expect(page.getByTestId('rec-open')).toHaveCount(0);
    expect(taps.count, 'stopping a recording from another tab').toBe(2);
    await caughtDownloads(page, 1);
    // A recording from another tab: More › Record › Audio Only.
    await fromRoot('library');
    await taps.tap(page.getByTestId('tab-more-button'));
    await expect.poll(() => moreView(page)).toBe('root');
    await taps.tap(moreRow(page, 'more-record-row'));
    await expect(sheet).toBeVisible();
    await taps.tap(sheet.getByTestId('record-option-audio'));
    await expect(sheet.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    expect(taps.count, 'a recording from another tab').toBe(3);
    await sheet.getByTestId('record-stop-save').click();
    await caughtDownloads(page, 2);
    // The toast "Saved to your downloads." sits over the list's end: let it go first.
    await expect(page.getByTestId('notices')).not.toContainText('Saved to your downloads.', { timeout: 20_000 });
    // The classic layout: More › Advanced › Use the classic layout.
    await fromRoot('library');
    await taps.tap(page.getByTestId('tab-more-button'));
    await expect.poll(() => moreView(page)).toBe('root');
    await taps.tap(moreRow(page, 'more-advanced-row'));
    await expect.poll(() => moreView(page)).toBe('advanced');
    await taps.tap(page.getByTestId('more-advanced').getByTestId('more-back-to-classic'));
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    expect(taps.count, 'the classic layout').toBe(3);
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
