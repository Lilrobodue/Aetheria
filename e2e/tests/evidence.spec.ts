import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  PHONE_VIEWPORT, openApp, openHarmonicControl, openSeededNewLayout, tab, sheet, phoneSize, renders, resetRenders, openLibraryTab, libraryRowButton,
  libraryState, rowMenu,
} from './helpers';
import { moreRow, moreView, unnamedControls } from './moreKit';
import { tagAudit, shot, focusedId, topInScroller } from './copyKit';

// v16.6, "How sure are we?" (spec §6.3 evidence.spec, E1–E9; §6.4 the render counts). An evidence tag opens the Guide's
// "How sure are we?" at its tier in one tap: the new layout's More › Guide (the view kept, the tier's heading focused at
// the top, "Back to <where you were>" one tap back), classic's Guidebook modal (Escape closes it back to the panel), or a
// scroll in place inside the Guide. Every tag is a named 44 × 44 button inside its block; the section has the seven
// tiers in both views and both layouts, its references go through the PWA guard; the crystal meaning block; the places
// each layout names. Dev server (the render counts read the DEV hook). E2E_SHOTS=<dir> saves the review screenshots.

const TIERS = ['arithmetic', 'tier1', 'tier2', 'tier3', 'open', 'design', 'tradition'];
const MORE_SCROLL = '[data-testid="more-scroll"]';

/** More › Guide, in a view. */
async function openGuide(page: Page, view: 'plain' | 'technical' = 'plain'): Promise<void> {
  await tab(page, 'more');
  await page.getByTestId('more').waitFor();
  if ((await moreView(page)) !== 'root') await tab(page, 'more');
  await moreRow(page, 'more-guide-row').click();
  await expect.poll(() => moreView(page)).toBe('guide');
  await page.getByTestId(`guide-view-${view}`).click();
  await expect(page.getByTestId('more-guide')).toHaveAttribute('data-guide-view', view);
}

/** The heading of a tier sits at the top of the scroller (0–max px from its top) and has the focus. */
async function arrivedAt(page: Page, tier: string, scroller: string, max = 120): Promise<void> {
  await expect.poll(() => focusedId(page), { message: `#how-sure-${tier} has the focus` }).toBe(`how-sure-${tier}`);
  await expect
    .poll(async () => {
      const t = await topInScroller(page, `how-sure-${tier}`, scroller);
      return t !== null && t >= 0 && t <= max;
    }, { message: `#how-sure-${tier} at the top of its scroller`, timeout: 5000 })
    .toBe(true);
}

/** window.open stubbed: counts the calls, opens nothing. */
async function stubOpen(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__opens = [];
    w.open = (url: string) => {
      w.__opens.push(String(url));
      return null;
    };
  });
}
const opens = (page: Page) => page.evaluate(() => ((window as any).__opens ?? []) as string[]);

/** Review D5: the focus is on an evidence tag of `tier` inside `scope` (a CSS selector). */
const focusOnTag = (page: Page, tier: string, scope: string) =>
  page.evaluate(
    ({ tier, scope }) => {
      const a = document.activeElement;
      return !!a && a.getAttribute('data-evidence-tag') === tier && !!a.closest(scope);
    },
    { tier, scope }
  );

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  // On a device the fixture sizes the page as a desktop and test.use's viewport never reaches the phone's own context.
  test.beforeEach(async ({ page }) => phoneSize(page));

  test('E1. Now Playing › Crystal › the meaning block’s Tradition tag opens the Guide at Tradition in 1 tap, the view kept; "Back to Crystal" reopens the sheet @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await phoneSize(page);
    const dialogs = await openSeededNewLayout(page, 6);
    await openGuide(page, 'technical'); // the view a tag must keep
    await tab(page, 'now');
    await page.getByTestId('chip-crystal').click();
    const meaning = page.getByTestId('crystal-meaning-sheet');
    await expect(meaning).toBeVisible();
    await shot(page, 'new-crystal-sheet');
    const url = page.url();
    const tag = meaning.locator('[data-evidence-tag]').first();
    const tier = (await tag.getAttribute('data-evidence-tag')) ?? '';
    expect(['tradition', 'design']).toContain(tier);
    await tag.click();
    await expect.poll(() => moreView(page)).toBe('guide');
    await expect(page.getByTestId('more-guide')).toHaveAttribute('data-guide-view', 'technical');
    await arrivedAt(page, tier, MORE_SCROLL);
    const back = page.getByTestId('evidence-back');
    await expect(back).toHaveText('Back to Crystal');
    await shot(page, 'howsure-arrival');
    await back.click();
    await expect(sheet(page, 'Crystal')).toBeVisible();
    await expect(page.getByTestId('crystal-meaning-sheet')).toBeVisible();
    await expect.poll(() => focusOnTag(page, tier, '[data-testid="crystal-meaning-sheet"]'), { message: 'review D5: the focus is back on the tag' }).toBe(true);
    expect(page.url(), 'the URL never changes').toBe(url);
    expect(dialogs).toEqual([]);
  });

  test('E1b. a tag on a More page (Advanced): the mounted More tab goes to the Guide at the tier; "Back to Advanced" returns', async ({ page }) => {
    await openSeededNewLayout(page, 6);
    await tab(page, 'more');
    await page.getByTestId('more').waitFor();
    if ((await moreView(page)) !== 'root') await tab(page, 'more');
    await moreRow(page, 'more-advanced-row').click();
    await expect.poll(() => moreView(page)).toBe('advanced');
    await page.getByTestId('more-advanced').locator('[data-evidence-tag="design"]').click();
    await expect.poll(() => moreView(page)).toBe('guide');
    await arrivedAt(page, 'design', MORE_SCROLL);
    await expect(page.getByTestId('evidence-back')).toHaveText('Back to Advanced');
    await page.getByTestId('evidence-back').click();
    await expect.poll(() => moreView(page)).toBe('advanced');
  });

  test('E4n. inside the Guide (new layout): a Plain-view tag scrolls to its tier in place, no navigation, the heading focused', async ({ page }) => {
    await openSeededNewLayout(page, 6);
    await openGuide(page, 'plain');
    await shot(page, 'guide-plain-tags');
    const tag = page.getByTestId('guide-content').locator('[data-evidence="tier1"] [data-evidence-tag="tier1"]').first();
    await tag.click();
    await arrivedAt(page, 'tier1', MORE_SCROLL);
    expect(await moreView(page)).toBe('guide');
    await expect(page.getByTestId('evidence-back'), 'no way back inside the Guide').toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('E5n. the new layout’s tags: named buttons, 44 × 44, each in its block (Crystal sheet, Layers, Mixes, the Guide in both views); no unnamed control', async ({ page }) => {
    test.setTimeout(150_000);
    await openSeededNewLayout(page, 6, { patch: [{ index: 0, scanned: true }] });
    const check = async (where: string) => {
      const a = await tagAudit(page);
      expect(a.problems, where).toEqual([]);
      expect(a.count, `${where}: tags`).toBeGreaterThan(0);
      expect(await unnamedControls(page), `${where}: unnamed controls`).toEqual([]);
    };
    await page.getByTestId('chip-crystal').click();
    await check('the Crystal sheet');
    await page.keyboard.press('Escape');
    await tab(page, 'layers');
    await check('Layers');
    await shot(page, 'new-layers-top');
    await page.getByTestId('layers-beat-evidence').scrollIntoViewIfNeeded();
    await shot(page, 'new-layers-beat');
    await tab(page, 'mixes');
    await check('Mixes');
    await page.getByTestId('mixes-lead-sets').scrollIntoViewIfNeeded();
    await shot(page, 'new-mixes-sets');
    await openGuide(page, 'plain');
    await check('the Guide, Plain');
    await page.getByTestId('guide-view-technical').click();
    await check('the Guide, Technical');
    await tab(page, 'more');
    if ((await moreView(page)) !== 'root') await tab(page, 'more');
    await moreRow(page, 'more-safety-row').click();
    await expect(page.getByTestId('safety-how-sure-row')).toBeVisible();
    await shot(page, 'new-safety-row');
    // The row opens the Guide at the section; Back returns to Safety & comfort.
    await page.getByTestId('safety-how-sure-row').click();
    await expect.poll(() => moreView(page)).toBe('guide');
    await expect.poll(() => focusedId(page)).toBe('how-sure');
    await page.getByTestId('more').getByRole('button', { name: 'Back to Safety & comfort' }).click();
    await expect.poll(() => moreView(page)).toBe('safety');
  });

  test('E8. the meaning block: 528 Hz · Transformation, its association, its shape, Tradition; Perfect GUT 519 Hz: 528’s words + the counterpart line; 111: Design choice; the sheet shows the same block', async ({ page }) => {
    await openSeededNewLayout(page, 6);
    await tab(page, 'layers');
    const block = page.getByTestId('crystal-meaning-section');
    await page.getByTestId('layers-crystal-tile').scrollIntoViewIfNeeded();
    await page.getByTestId('crystal-528').first().click();
    await expect(block.getByTestId('crystal-meaning-title')).toHaveText('528 Hz · Transformation');
    await expect(block.getByTestId('crystal-meaning-association')).toHaveText('Traditionally associated with transformation, miracles and DNA repair. In Solfeggio teaching it is called “the miracle tone”.');
    await expect(block.getByTestId('crystal-meaning-shape')).toHaveText('Shape: Metatron\'s Cube · Light');
    await expect(block.locator('[data-evidence-tag]')).toHaveCount(1);
    await expect(block.locator('[data-evidence-tag="tradition"]')).toHaveCount(1);
    await expect(block).toHaveAttribute('data-evidence', 'tradition');
    await shot(page, 'new-layers-crystal-528', { locator: block });
    // Perfect GUT: 528 plays as 519.
    const perfect = page.getByRole('switch', { name: 'Lo Shu Perfect GUT', exact: true }).first();
    await perfect.click();
    await page.getByTestId('crystal-519').first().click();
    await expect(block.getByTestId('crystal-meaning-title')).toHaveText('519 Hz · Transformation');
    // Review B4: the counterpart line first, then its crystal's association, said as its crystal's.
    await expect(block.getByTestId('crystal-meaning-perfect')).toHaveText('Lo Shu Perfect counterpart of 528 Hz.');
    await expect(block.getByTestId('crystal-meaning-association')).toHaveText('Its crystal, 528 Hz, is traditionally associated with transformation, miracles and DNA repair. In Solfeggio teaching it is called “the miracle tone”.');
    expect(
      await block.evaluate((b) => {
        const p = b.querySelector('[data-testid="crystal-meaning-perfect"]');
        const a = b.querySelector('[data-testid="crystal-meaning-association"]');
        return !!p && !!a && !!(p.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
      'the counterpart line comes before the association'
    ).toBe(true);
    await expect(block.locator('[data-evidence-tag="arithmetic"]')).toHaveCount(1);
    await perfect.click();
    // 111: the chip's own words, Design choice.
    await page.getByTestId('crystal-111').first().click();
    await expect(block.getByTestId('crystal-meaning-title')).toHaveText('111 Hz');
    await expect(block.getByTestId('crystal-meaning-association')).toHaveText('Not one of the 27 crystals.');
    await expect(block.locator('[data-evidence-tag]')).toHaveCount(1);
    await expect(block.locator('[data-evidence-tag="design"]')).toHaveCount(1);
    // The Crystal sheet shows the same block.
    await tab(page, 'now');
    await page.getByTestId('chip-crystal').click();
    await expect(page.getByTestId('crystal-meaning-sheet').getByTestId('crystal-meaning-association')).toHaveText('Not one of the 27 crystals.');
  });

  test('E1c. review D1: Library › a row’s ⋯ › Track info › its Design choice tag opens the Guide; "Back to Track info" reopens Track info for that track, on Library, the focus on the tag', async ({ page }) => {
    test.setTimeout(120_000);
    await openSeededNewLayout(page, 6, { crystals: 'none', patch: [{ index: 2, crystal: 528 }] });
    await openLibraryTab(page);
    await rowMenu(page, 'tone-0003').click();
    await page.getByTestId('library-menu-info').click();
    const info = page.getByRole('dialog', { name: 'Track info', exact: true });
    await expect(info).toBeVisible();
    await info.locator('[data-evidence="design"] [data-evidence-tag="design"]').click();
    await expect.poll(() => moreView(page)).toBe('guide');
    await arrivedAt(page, 'design', MORE_SCROLL);
    await expect(page.getByTestId('evidence-back')).toHaveText('Back to Track info');
    await page.getByTestId('evidence-back').click();
    await expect(info).toBeVisible();
    await expect(info.getByText('tone-0003', { exact: true })).toBeVisible();
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await expect.poll(() => focusOnTag(page, 'design', '[data-testid="track-info-dialog"]'), { message: 'review D5: the focus is back on the tag' }).toBe(true);
  });

  test('§6.4 render counts: over 3 s of playback, the Crystal sheet’s body and meaning, Layers › Crystal and the Guide render 0 times; a crystal change renders the block once', async ({ page }) => {
    test.setTimeout(150_000);
    await openSeededNewLayout(page, 6, { real: 2, seconds: 40 });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 0.3; }, { timeout: 20_000 }).toBe(true);
    await tab(page, 'now');
    await page.getByTestId('chip-crystal').click();
    await expect(page.getByTestId('crystal-meaning-sheet')).toBeVisible();
    await page.waitForTimeout(500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    let r = await renders(page);
    expect(r.CrystalBody ?? 0, 'CrystalBody').toBe(0);
    expect(r.CrystalMeaning ?? 0, 'CrystalMeaning (sheet)').toBe(0);
    // The harness works: the 4 Hz clock reaches Now Playing's time readers (the mini-player's MiniProgress shows on the
    // other tabs, checked below).
    expect((r.SeekBar ?? 0) + (r.TimeText ?? 0), 'the clock reaches the seek bar').toBeGreaterThanOrEqual(8);
    await page.keyboard.press('Escape');
    await tab(page, 'layers');
    await page.waitForTimeout(500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    r = await renders(page);
    expect(r.MiniProgress ?? 0, 'the harness works: the clock reaches MiniProgress').toBeGreaterThanOrEqual(8);
    expect(r.LayersCrystal ?? 0, 'LayersCrystal').toBe(0);
    expect(r.CrystalMeaning ?? 0, 'CrystalMeaning (Layers)').toBe(0);
    await resetRenders(page);
    await page.getByTestId('crystal-639').first().click();
    await expect(page.getByTestId('crystal-meaning-section').getByTestId('crystal-meaning-title')).toHaveText('639 Hz · Connection');
    r = await renders(page);
    // One render: DEV runs under React.StrictMode, which calls a component's render twice, so it counts 1 or 2.
    expect(r.CrystalMeaning ?? 0, 'a crystal change renders the block once').toBeGreaterThanOrEqual(1);
    expect(r.CrystalMeaning ?? 0, 'a crystal change renders the block once').toBeLessThanOrEqual(2);
    await openGuide(page, 'plain');
    await page.waitForTimeout(500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    r = await renders(page);
    expect(r.GuidePage ?? 0, 'GuidePage').toBe(0);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('E2. the Layers panel › Beat’s tag opens the More panel at Mixed evidence; Escape closes the panel; the transport stays usable', async ({ page }) => {
    test.setTimeout(120_000);
    await openSeededNewLayout(page, 6, { real: 2, seconds: 40 });
    await tab(page, 'layers');
    const tag = page.getByTestId('layers-beat-evidence').locator('[data-evidence-tag="tier2"]');
    await tag.click();
    await expect.poll(() => moreView(page)).toBe('guide');
    await arrivedAt(page, 'tier2', MORE_SCROLL);
    await expect(page.getByTestId('evidence-back')).toHaveText('Back to Layers');
    await shot(page, 'desktop-howsure-tier2');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('more')).toHaveCount(0);
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
  });

  test('E2b. review D2: over More › Advanced, ⋯ › Track info’s tag: "Back to Track info" reopens Track info with More on Advanced (not More’s root)', async ({ page }) => {
    test.setTimeout(120_000);
    await openSeededNewLayout(page, 6, { real: 2, seconds: 40, crystals: 'none', patch: [{ index: 0, crystal: 528 }] });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await tab(page, 'more');
    await page.getByTestId('more').waitFor();
    if ((await moreView(page)) !== 'root') await tab(page, 'more');
    await moreRow(page, 'more-advanced-row').click();
    await expect.poll(() => moreView(page)).toBe('advanced');
    await page.getByRole('button', { name: 'More options', exact: true }).first().click();
    await page.getByTestId('menu-track-info').click();
    const info = page.getByRole('dialog', { name: 'Track info', exact: true });
    await expect(info).toBeVisible();
    await info.locator('[data-evidence="design"] [data-evidence-tag="design"]').first().click();
    await expect.poll(() => moreView(page)).toBe('guide');
    await expect(page.getByTestId('evidence-back')).toHaveText('Back to Track info');
    await page.getByTestId('evidence-back').click();
    await expect(info).toBeVisible();
    await expect.poll(() => moreView(page), { message: 'More is back on Advanced' }).toBe('advanced');
  });

  test('E6. How sure are we? in both views and both layouts: the seven tiers’ headings; Technical lists sources under Tier 1, 2 and 3; a reference goes to window.open once and the page stays', async ({ page }) => {
    test.setTimeout(150_000);
    await openSeededNewLayout(page, 6);
    const sections = async (where: string, scope: ReturnType<Page['locator']>) => {
      for (const t of TIERS) await expect(scope.locator(`h3#how-sure-${t}`), `${where}: ${t}`).toHaveCount(1);
    };
    await openGuide(page, 'plain');
    await sections('new, Plain', page.getByTestId('guide-content'));
    await shot(page, 'howsure-plain', { locator: page.getByTestId('how-sure') });
    await page.getByTestId('guide-view-technical').click();
    const content = page.getByTestId('guide-content');
    await sections('new, Technical', content);
    for (const t of ['tier1', 'tier2', 'tier3']) expect(await content.locator(`[data-how-sure-tier="${t}"] [data-how-sure-ref]`).count(), `${t}: sources`).toBeGreaterThanOrEqual(1);
    await shot(page, 'howsure-technical', { locator: page.getByTestId('how-sure') });
    await stubOpen(page);
    const url = page.url();
    await content.locator('[data-how-sure-tier="tier2"] [data-how-sure-ref]').first().click();
    expect(await opens(page)).toHaveLength(1);
    expect(page.url()).toBe(url);
  });

  test('E7. under reduced motion the scroll lands at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSeededNewLayout(page, 6);
    await openGuide(page, 'plain');
    await page.getByTestId('guide-content').locator('[data-evidence="tier2"] [data-evidence-tag="tier2"]').first().click();
    // Two frames: the click's frame and the scroll's.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const t = await topInScroller(page, 'how-sure-tier2', MORE_SCROLL);
    expect(t !== null && t >= 0 && t <= 120, `top ${t}`).toBe(true);
  });

  test('E9. each layout names its own places: classic says "Click "Deep Scan"", the new layout "In Library, open Library health and tap Scan"; the cube’s settings and the Tree of Life the same', async ({ page }) => {
    test.setTimeout(120_000);
    await openSeededNewLayout(page, 6);
    await openGuide(page, 'plain');
    const content = page.getByTestId('guide-content');
    await expect(content).toContainText('In Library, open Library health and tap Scan');
    await expect(content).toContainText('More › Visualizer › Overlays › Lo Shu Cube');
    await expect(content).not.toContainText('Click "Deep Scan"');
    await page.getByTestId('guide-view-technical').click();
    await expect(content).toContainText('Turn on "Tree of Life" in More › Visualizer › Overlays');
  });
});

test.describe('classic', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const guidebook = (page: Page) => page.locator('div.max-w-4xl').filter({ has: page.getByRole('heading', { name: 'The Guidebook', exact: true }) });

  test('E6c. classic’s Guidebook has the section in both views; it guards its own references (window.open once, the page stays)', async ({ page }) => {
    await openApp(page);
    await page.locator('aside').getByRole('button', { name: /The Guidebook/ }).click();
    const modal = guidebook(page);
    for (const t of TIERS) await expect(modal.locator(`h3#how-sure-${t}`), `classic, Plain: ${t}`).toHaveCount(1);
    await page.getByRole('button', { name: 'Technical', exact: true }).first().click();
    for (const t of TIERS) await expect(modal.locator(`h3#how-sure-${t}`), `classic, Technical: ${t}`).toHaveCount(1);
    for (const t of ['tier1', 'tier2', 'tier3']) expect(await modal.locator(`[data-how-sure-tier="${t}"] [data-how-sure-ref]`).count(), `${t}: sources`).toBeGreaterThanOrEqual(1);
    await shot(page, 'classic-guidebook-technical');
    await stubOpen(page);
    const url = page.url();
    await modal.locator('[data-how-sure-tier="tier1"] [data-how-sure-ref]').first().click();
    expect(await opens(page)).toHaveLength(1);
    expect(page.url()).toBe(url);
  });

  test('E9c. classic’s Guidebook keeps classic’s places: "Click "Deep Scan"", the gear icon, the Visualization Engine', async ({ page }) => {
    await openApp(page);
    await page.locator('aside').getByRole('button', { name: /The Guidebook/ }).click();
    const modal = guidebook(page);
    await expect(modal).toContainText('Click "Deep Scan"');
    await expect(modal).toContainText('by clicking the gear icon in the app header');
    await expect(modal).not.toContainText('In Library, open Library health');
    await page.getByRole('button', { name: 'Technical', exact: true }).first().click();
    await expect(modal).toContainText('Enable "Tree of Life" in Visualization Engine');
  });

  test('E3. Harmonic Control › Binaural Beat’s tag opens the Guidebook at Mixed evidence in 1 tap; Escape closes it and Harmonic Control is still open, the focus back on the tag', async ({ page }) => {
    const dialogs = await openApp(page);
    await openHarmonicControl(page);
    const block = page.locator('[data-evidence="tier2"]').filter({ hasText: 'The evidence on whether a beat moves your own brainwaves is mixed.' });
    await block.scrollIntoViewIfNeeded();
    await shot(page, 'classic-beat-tags');
    await block.locator('[data-evidence-tag="tier2"]').click();
    await expect(page.getByRole('heading', { name: 'The Guidebook', exact: true })).toBeVisible();
    await expect.poll(() => focusedId(page)).toBe('how-sure-tier2');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const h = document.getElementById('how-sure-tier2');
          const sc = h?.closest('.overflow-y-auto');
          if (!h || !sc) return false;
          const a = h.getBoundingClientRect();
          const b = sc.getBoundingClientRect();
          return a.top >= b.top - 1 && a.top <= b.top + 120;
        }), { timeout: 5000 })
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'The Guidebook', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Harmonic Control', exact: true })).toBeVisible();
    // Review D5: the focus is back on the tag that opened it.
    await expect.poll(() => block.locator('[data-evidence-tag="tier2"]').evaluate((el) => el === document.activeElement)).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('E3b. review D4: the Frequency Lab (above the Guidebook, z-[150] over z-[100]) holds no evidence tag or tagged block', async ({ page }) => {
    await openApp(page);
    const before = await page.locator('[data-evidence-tag]').count();
    await page.getByTitle('Advanced Frequency Selection').click();
    const lab = page.getByTestId('frequency-lab');
    await expect(lab).toBeVisible();
    await expect(lab.locator('[data-evidence-tag], [data-evidence], [data-evidence-legend], [data-evidence-text]')).toHaveCount(0);
    expect(await page.locator('[data-evidence-tag]').count(), 'the lab adds no tag anywhere').toBe(before);
  });

  test('E4c. inside classic’s Guidebook a tag scrolls in place; E5c. classic’s tags (Harmonic Control, the Guidebook) are named 44 × 44 buttons in their blocks; the Safety panel’s button opens the section', async ({ page }) => {
    await openApp(page);
    await openHarmonicControl(page);
    let a = await tagAudit(page);
    expect(a.problems, 'Harmonic Control').toEqual([]);
    expect(a.count).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Close', exact: true }).first().click().catch(() => {});
    await page.goto('about:blank');
    await openApp(page);
    await page.locator('aside').getByRole('button', { name: /The Guidebook/ }).click();
    a = await tagAudit(page);
    expect(a.problems, 'the Guidebook').toEqual([]);
    expect(a.count).toBeGreaterThan(0);
    const tag = page.locator('[data-evidence="open"] [data-evidence-tag="open"]').first();
    await tag.click();
    await expect.poll(() => focusedId(page)).toBe('how-sure-open');
    await expect(page.getByRole('heading', { name: 'The Guidebook', exact: true })).toHaveCount(1);
    await shot(page, 'classic-guidebook-howsure');
    await page.keyboard.press('Escape');
    // Safety: Range, Comfort, the button (decision 4 A: the statement itself unchanged).
    await page.getByTitle('Safety Protocols', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Emergency Stop' })).toBeVisible();
    await shot(page, 'classic-safety-after', { locator: page.getByRole('button', { name: 'Emergency Stop' }).locator('xpath=ancestor::div[contains(@class,"w-96")][1]') });
    await expect(page.getByText('Range', { exact: true })).toBeVisible();
    await expect(page.getByText('Comfort', { exact: true })).toBeVisible();
    await page.getByTestId('safety-how-sure').click();
    await expect(page.getByRole('heading', { name: 'The Guidebook', exact: true })).toBeVisible();
    await expect.poll(() => focusedId(page)).toBe('how-sure');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Emergency Stop' }), 'the Safety panel is still open').toBeVisible();
  });
});
