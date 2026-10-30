import { createHash } from 'node:crypto';
import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { PHONE_VIEWPORT, libraryState, openSeededNewLayout, openLibraryTab, libraryRowButton, renders, resetRenders, tab, undoToast, backToClassicViaMore, phoneSize } from './helpers';
import { moreRow, moreView, textNodes } from './moreKit';

// v16.5, the Guide (v16.4 spec §3.7, §5.3 guide.spec): the one Plain language / Technical control; the Technical view
// moved VERBATIM out of App (its text nodes equal classic's Guidebook's in the same build, and the previous release's:
// a pinned hash); the cube in the new layout (a cell plays its tone, Perfect GUT is Layers' switch, the palette, a
// walk tile starts the walk with its Undo); the PWA guard on its links; where it was left; renders. Dev server.

/** The text of classic's Technical Guidebook as v16.4's build rendered it (the negative-control run's hash of
 *  textNodes() over the Guidebook's scrolling content, desktop 1280 × 800): the move changed no word. */
const TECHNICAL_TEXT_SHA = 'bb60693cfce7df9a'; // 908 text nodes, the base build (v16.4 on v16.3, 640f0bf)

const sha = (parts: string[]) => createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex').slice(0, 16);

/** More › Guide. */
async function openGuide(page: Page): Promise<void> {
  await tab(page, 'more');
  await page.getByTestId('more').waitFor();
  if ((await moreView(page)) !== 'root') await tab(page, 'more');
  await moreRow(page, 'more-guide-row').click();
  await expect.poll(() => moreView(page)).toBe('guide');
}

const viewButton = (page: Page, v: 'plain' | 'technical') => page.getByTestId(`guide-view-${v}`);

/** A seeded library of 27 tracks with the 27 crystals (the first 3 real 40 s tones), tone-0001 playing. */
async function playing27(page: Page): Promise<string[]> {
  // v16.5 final (the Note 20: G3 and G6 found no mini-player): on a device the fixture sizes the page as a desktop and
  // test.use's viewport never reaches the phone's own context, so the phone shell needs its viewport set here.
  await phoneSize(page);
  const dialogs = await openSeededNewLayout(page, 27, { real: 3, seconds: 40, crystals: 'all' });
  await openLibraryTab(page);
  await libraryRowButton(page, 'tone-0001').click();
  await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 0.3; }, { timeout: 20_000 }).toBe(true);
  return dialogs;
}

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('G1. one control, "Guide view": Plain language shows the Guidebook, Technical the cube; aria-pressed follows', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playing27(page);
    await openGuide(page);
    const group = page.getByRole('group', { name: 'Guide view', exact: true });
    await expect(group.getByRole('button')).toHaveText(['Plain language', 'Technical']);
    await expect(viewButton(page, 'plain')).toHaveAttribute('aria-pressed', 'true');
    await expect(viewButton(page, 'technical')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('guide-content').getByText('The Aetheria Guidebook', { exact: true })).toBeVisible();
    await viewButton(page, 'technical').click();
    await expect(viewButton(page, 'technical')).toHaveAttribute('aria-pressed', 'true');
    await expect(viewButton(page, 'plain')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('guide-content').locator('[title^="Play 528 Hz"]').first()).toBeVisible();
    await expect(page.getByTestId('guide-content').getByText('THE MASTER FREQUENCY ARCHITECTURE v3.0')).toBeVisible();
    await expect(page.getByTestId('guide-content').getByText('The Aetheria Guidebook', { exact: true })).toHaveCount(0);
    // The control stays at the top while the guide scrolls (sticky).
    await page.getByTestId('more-scroll').evaluate((el) => (el.scrollTop = 3000));
    const box = await group.boundingBox();
    const scroller = await page.getByTestId('more-scroll').boundingBox();
    expect(Math.abs((box?.y ?? 0) - (scroller?.y ?? 0)), 'the view control is pinned at the top').toBeLessThanOrEqual(1);
    expect(dialogs).toEqual([]);
  });

  test('G3. the cube in the new layout: a cell plays its crystal, Perfect GUT is Layers’ switch, the palette is the saved one, a walk tile starts the walk with its Undo', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playing27(page);
    await openGuide(page);
    await viewButton(page, 'technical').click();
    const content = page.getByTestId('guide-content');
    // A cell: 528 Hz plays (the mini-player's crystal follows).
    await content.locator('[title^="Play 528 Hz"]').first().click();
    await expect(page.getByTestId('mini-player')).toContainText('528 Hz');
    // Perfect GUT: the cube's switch is Layers' state.
    await content.getByRole('button', { name: 'Lo Shu Perfect (75–963)', exact: true }).click();
    await expect(page.getByTestId('mini-player')).toContainText('519 Hz');
    await tab(page, 'layers');
    await expect(page.getByRole('switch', { name: /Perfect GUT|Lo Shu Perfect/ }).first()).toHaveAttribute('aria-checked', 'true');
    await openGuide(page);
    await content.getByRole('button', { name: 'Solfeggio (174–963)', exact: true }).click();
    await expect(page.getByTestId('mini-player')).toContainText('528 Hz');
    // The palette: the same key as Visuals › Crystal colours.
    await content.getByRole('button', { name: 'Spectrum (visible light)', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('aetheria.frequencyColorMode.v1'))).toBe('spectrum');
    await content.getByRole('button', { name: 'Chakra (original)', exact: true }).click();
    // A walk tile: the walk starts playing, with v15.9's Undo toast.
    const walkA = content.locator('button[title]').filter({ hasText: 'Vortex' }).first();
    await walkA.click();
    await expect.poll(async () => (await libraryState(page)).walk, { timeout: 15_000, message: 'the walk plays' }).not.toBeNull();
    await expect(undoToast(page)).toBeVisible();
    await tab(page, 'now');
    await expect(page.getByTestId('np-source')).toContainText('Lo Shu walk');
    expect(dialogs).toEqual([]);
  });

  test('G3b. the cube’s cells contain their content (final fixes, the Note 20’s G3): at 360 px with a wide, large font every cell’s centre hits that cell, never a neighbour’s label @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 10, crystals: 'all' });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openGuide(page);
    await viewButton(page, 'technical').click();
    const cells = page.getByTestId('guide-content').locator('[title^="Play "]');
    await expect(cells.first()).toBeVisible();
    // Where the label fits, it keeps its size (the cell shrinks it only when it is narrower than the label).
    const sizes = await cells.evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el.querySelector('.font-mono span') ?? el).fontSize))]);
    expect(sizes, 'the labels at the phone’s width and a normal font: 16 px, as before').toEqual(['16px']);
    // A wider, larger font than desktop Chrome's (the phone's own font and its text scaling made a label wider than its
    // cell, and a centred label spills over both neighbours), at 360 px.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.addStyleTag({ content: '[data-testid="guide-content"] * { font-family: "Courier New", "Lucida Console", monospace !important; } [data-testid="guide-content"] .font-mono { font-size: 2.75rem !important; }' });
    const misses = await cells.evaluateAll((els) =>
      els.flatMap((el, i) => {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const owner = hit?.closest('[title^="Play "]') ?? null;
        // The label shrinks to fit its cell (not cut by the clip): its width within the cell's.
        const label = (el.querySelector('.font-mono span') ?? el.querySelector('.font-mono'))?.getBoundingClientRect();
        const fits = !!label && label.width <= r.width + 0.5;
        return owner === el && fits ? [] : [{ i, cell: el.getAttribute('title'), hit: owner?.getAttribute('title') ?? hit?.tagName ?? null, fits }];
      })
    );
    test.info().annotations.push({ type: 'G3b cells whose centre hits another', description: JSON.stringify(misses) });
    expect(await cells.count(), 'the 27 cells').toBe(27);
    expect(misses, 'every cell’s centre hits that cell').toEqual([]);
    // And when the label itself is forced large (a text scaling applied after the cell's sizing): clipped to its cell.
    await page.addStyleTag({ content: '[data-testid="guide-content"] .font-mono span { font-size: 2.75rem !important; }' });
    const clipped = await cells.evaluateAll((els) =>
      els.flatMap((el, i) => {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const owner = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[title^="Play "]') ?? null;
        return owner === el ? [] : [{ i, cell: el.getAttribute('title'), hit: owner?.getAttribute('title') ?? null }];
      })
    );
    expect(clipped, 'a label larger than its cell is clipped to it').toEqual([]);
    expect(dialogs).toEqual([]);
  });

  test('G4. the guard: a link in the Guide opens through window.open (once), and the page stays on the player', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      const w = window as any;
      w.__opened = [] as unknown[][];
      window.open = ((...args: unknown[]) => {
        w.__opened.push(args);
        return null;
      }) as typeof window.open;
    });
    const dialogs = await playing27(page);
    const url = page.url();
    await openGuide(page);
    const harvard = page.getByTestId('guide-content').locator('a[href*="harvard"]').first();
    await harvard.scrollIntoViewIfNeeded();
    const href = await harvard.getAttribute('href');
    // v16.5 final: on a device the context also holds the user's own tabs, so only pages opened during the test count
    // (listened for, never touched).
    const opened: Page[] = [];
    const onPage = (p: Page) => opened.push(p);
    page.context().on('page', onPage);
    await harvard.click();
    expect(await page.evaluate(() => (window as any).__opened)).toEqual([[href, '_blank', 'noopener,noreferrer']]);
    expect(page.url()).toBe(url);
    await page.waitForTimeout(500);
    page.context().off('page', onPage);
    expect(opened.length, 'no tab or window opened').toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('G5. where it was left: the Technical view and its scroll come back after Library (±2 px)', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playing27(page);
    await openGuide(page);
    await viewButton(page, 'technical').click();
    const scroller = page.getByTestId('more-scroll');
    await scroller.evaluate((el) => (el.scrollTop = 2400));
    await page.waitForTimeout(200);
    const top = await scroller.evaluate((el) => el.scrollTop);
    expect(top).toBeGreaterThan(1000);
    await tab(page, 'library');
    await tab(page, 'more');
    await expect.poll(() => moreView(page)).toBe('guide');
    await expect(viewButton(page, 'technical')).toHaveAttribute('aria-pressed', 'true');
    const back = await page.getByTestId('more-scroll').evaluate((el) => el.scrollTop);
    expect(Math.abs(back - top), 'the same scrollTop').toBeLessThanOrEqual(2);
    expect(dialogs).toEqual([]);
  });

  test('G6. renders (DEV): the Guide renders 0 times over 3 s of playback; at most once on a track change', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playing27(page);
    // v16.5 final (the Note 20: MiniProgress rendered 0 times, so the window proved nothing): the clock is App's
    // requestAnimationFrame loop, which runs only while the page draws frames. On a device, the test's tab is brought
    // to the front (its own tab only), and the window starts once the clock is seen running.
    await page.bringToFront();
    await openGuide(page);
    await viewButton(page, 'technical').click();
    await page.waitForTimeout(500);
    await resetRenders(page);
    await expect.poll(async () => (await renders(page)).MiniProgress ?? 0, { timeout: 15_000, message: 'the clock runs on the Technical view (the page draws frames)' }).toBeGreaterThan(0);
    const seen = await page.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus() }));
    test.info().annotations.push({ type: 'G6 the page at the window', description: JSON.stringify(seen) });
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const r = await renders(page);
    expect(r.GuidePage ?? 0, 'no render while playing').toBe(0);
    expect(r.MiniProgress ?? 0, 'the clock ran (the mini-player’s progress)').toBeGreaterThanOrEqual(8);
    await resetRenders(page);
    await page.getByTestId('mini-player').getByRole('button', { name: 'Next track', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).current).toBe('tone-0002');
    await page.waitForTimeout(800);
    // React's StrictMode renders twice in dev: one render is 2 counts.
    expect((await renders(page)).GuidePage ?? 0, 'one render at most on a track change').toBeLessThanOrEqual(2);
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('G2. verbatim: the Guide’s Technical text equals classic’s Guidebook (Technical) in this build, and the previous release’s', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    // The new layout's Guide (in the 420 px panel).
    await tab(page, 'more');
    await moreRow(page, 'more-guide-row').click();
    await page.getByTestId('guide-view-technical').click();
    const mine = await textNodes(page.getByTestId('guide-content'));
    // Classic's Guidebook, Technical.
    await backToClassicViaMore(page);
    const classic = await classicTechnicalText(page);
    test.info().annotations.push({ type: 'technical text', description: `${classic.length} text nodes, sha ${sha(classic)}` });
    expect(mine.length).toBeGreaterThan(300);
    expect(mine, 'the Guide shows classic’s Technical view, node for node').toEqual(classic);
    if (TECHNICAL_TEXT_SHA) expect(sha(classic), 'the same text as the previous release’s classic Guidebook').toBe(TECHNICAL_TEXT_SHA);
    expect(dialogs).toEqual([]);
  });

  test('G2b. (the pin’s source) classic’s Technical Guidebook text, hashed: run on the previous release’s build for TECHNICAL_TEXT_SHA', async ({ page }) => {
    test.setTimeout(120_000);
    const { openApp } = await import('./helpers');
    const dialogs = await openApp(page);
    const classic = await classicTechnicalText(page);
    test.info().annotations.push({ type: 'technical text sha', description: `${classic.length} nodes, ${sha(classic)}` });
    expect(classic.length).toBeGreaterThan(300);
    if (TECHNICAL_TEXT_SHA) expect(sha(classic)).toBe(TECHNICAL_TEXT_SHA);
    expect(dialogs).toEqual([]);
  });
});

/** Classic's Guidebook (desktop: the sidebar's button), Technical: the text nodes of its scrolling content. */
async function classicTechnicalText(page: Page): Promise<string[]> {
  await page.getByRole('button', { name: /The Guidebook/ }).click();
  await page.getByRole('button', { name: 'Technical', exact: true }).first().click();
  const content = page.locator('div.custom-scrollbar').filter({ hasText: 'THE MASTER FREQUENCY ARCHITECTURE v3.0' }).first();
  await content.waitFor();
  return textNodes(content);
}
