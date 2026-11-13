import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openSeededNewLayout, openNewLayout, tab, newShell } from './helpers';
import { moreRow } from './moreKit';
import { MENU_AWAY_LIVE, MENU_SHOWN_LIVE } from '../../components/shell/shortcuts/keysModel.ts';

// v16.8.9, the side menu away (the user's decisions, 2026-11-13; spec scratchpad v1689/v1689-spec.md; mockup option A).
// The logo next to "Aetheria" (and the rail's, below 1280) hides the desktop side menu: it slides off the left edge and
// goes inert; the logo floats where it was (nav-show) to bring it back. An open panel slides to the window's edge and its
// header makes room for the logo. C hides or shows it; while it is away, L, / and ? slide it out to their place (Q and V
// open their panels with it still away). Remembered on the browser (aetheria.navAway.v1).

const NAV_AWAY_KEY = 'aetheria.navAway.v1';

/** The 220 ms slide, done. */
const settle = (page: Page) => page.waitForTimeout(400);

async function nav(page: Page) {
  return page.getByTestId('side-nav').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, inert: (el as HTMLElement & { inert: boolean }).inert === true };
  });
}
const panelLeft = async (page: Page) => (await page.getByTestId('desktop-panel').boundingBox())!.x;
const showBox = async (page: Page) => (await page.getByTestId('nav-show').boundingBox())!;

/** The panel's header: the left edge of its first visible thing (a control, the heading, a word). */
async function headerStart(page: Page): Promise<number | null> {
  return page.getByTestId('desktop-panel').evaluate((panel) => {
    const head = panel.querySelector('header, [data-panel-head]');
    if (!head) return null;
    const boxes = Array.from(head.querySelectorAll('*'))
      .filter((e) => e.tagName === 'BUTTON' || e.childElementCount === 0)
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    return boxes.length ? Math.min(...boxes.map((r) => r.left)) : null;
  });
}

/** The menu away (by its logo), settled. */
async function hide(page: Page): Promise<void> {
  await page.getByTestId('nav-hide').click();
  await expect(page.getByTestId('nav-show')).toBeVisible();
  await settle(page);
}
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
async function expectHeaderRoom(page: Page, what: string): Promise<void> {
  await expect(page.getByTestId('desktop-panel')).toBeVisible();
  await settle(page);
  expect(await panelLeft(page), `${what}: the panel at the window's edge`).toBeLessThanOrEqual(0.5);
  const start = await headerStart(page);
  const logo = await showBox(page);
  expect(start, `${what}: a header`).not.toBeNull();
  expect(start!, `${what}: the header's first thing (${Math.round(start!)}) right of the floating logo (${Math.round(logo.x + logo.width)})`).toBeGreaterThanOrEqual(logo.x + logo.width + 8);
}

test.describe('desktop side menu', () => {
  for (const width of [1280, 1279] as const) {
    test(`N1. ${width} px: the logo hides the menu (off the edge, inert); the logo floats in its place; an open panel goes to the edge with header room; the floating logo brings it back; the focus follows`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 800 });
      const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
      await tab(page, 'library');
      await expect(page.getByTestId('desktop-panel')).toBeVisible();
      const navW = width >= 1280 ? 200 : 72;
      expect((await nav(page)).left, 'shown: at the edge').toBe(0);
      expect(Math.round(await panelLeft(page)), 'the panel beside the menu').toBe(navW);
      await expect(page.getByTestId('nav-hide')).toHaveAttribute('aria-expanded', 'true');
      const hideBox = (await page.getByTestId('nav-hide').boundingBox())!;
      expect(Math.round(hideBox.width) >= 44 && Math.round(hideBox.height) >= 44, `the logo button 44 × 44 (${hideBox.width} × ${hideBox.height})`).toBe(true);
      // Away.
      await hide(page);
      const away = await nav(page);
      expect(away.right, 'away: off the left edge').toBeLessThanOrEqual(0.5);
      expect(away.inert, 'away: inert').toBe(true);
      const logo = page.getByTestId('nav-show');
      await expect(logo).toHaveAttribute('aria-expanded', 'false');
      await expect(logo).toHaveAttribute('aria-label', 'Show the menu');
      const b = await showBox(page);
      expect(Math.round(b.width) >= 44 && Math.round(b.height) >= 44, `the floating logo 44 × 44 (${b.width} × ${b.height})`).toBe(true);
      expect(Math.abs(b.x - hideBox.x) <= 2 && Math.abs(b.y - hideBox.y) <= 2, `in the menu logo's place (${Math.round(b.x)},${Math.round(b.y)} vs ${Math.round(hideBox.x)},${Math.round(hideBox.y)})`).toBe(true);
      await expect(logo, 'the focus to the floating logo').toBeFocused();
      // Review round 1: right after the skip links in the tab order (a panel is open: Skip to the panel comes before it).
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByTestId('skip-panel'), 'Shift+Tab from the floating logo: the skip link').toBeFocused();
      await logo.focus();
      await expectHeaderRoom(page, 'Library');
      // The slide is over: the panel no longer animates (a resize across 1280 px jumps, as v16.7 made it; desktop-keys R1).
      await expect(page.getByTestId('desktop-panel')).not.toHaveAttribute('data-nav-sliding', /.*/);
      // Back.
      await logo.click();
      await expect(page.getByTestId('nav-show')).toHaveCount(0);
      await settle(page);
      const back = await nav(page);
      expect([back.left, back.inert], 'back: at the edge, not inert').toEqual([0, false]);
      expect(Math.round(await panelLeft(page)), 'the panel beside the menu again').toBe(navW);
      await expect(page.getByTestId('nav-hide'), 'the focus to the menu\'s logo').toBeFocused();
      expect(dialogs).toEqual([]);
    });
  }

  test('N2. remembered: away stays away after a reload (the key "away"); shown stays shown (the key removed)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await hide(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), NAV_AWAY_KEY)).toBe('away');
    await page.reload();
    await newShell(page).waitFor();
    await expect(page.getByTestId('nav-show'), 'after a reload: still away').toBeVisible();
    expect((await nav(page)).right).toBeLessThanOrEqual(0.5);
    await page.getByTestId('nav-show').click();
    await settle(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), NAV_AWAY_KEY), 'shown: the key removed').toBeNull();
    await page.reload();
    await newShell(page).waitFor();
    await expect(page.getByTestId('nav-hide'), 'after a reload: shown').toBeVisible();
    await expect(page.getByTestId('nav-show')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('N3. C hides and shows it, read on the live line; from inside the menu the focus goes to the floating logo; not while typing; not with the shortcuts off', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await blur(page);
    await page.keyboard.press('c');
    await expect(page.getByTestId('nav-show'), 'C: away').toBeVisible();
    await expect(page.getByTestId('key-live')).toHaveText(MENU_AWAY_LIVE);
    await expect(page.getByTestId('key-feedback'), 'no pill').toHaveCount(0);
    await page.keyboard.press('c');
    await expect(page.getByTestId('nav-show'), 'C again: back').toHaveCount(0);
    await expect(page.getByTestId('key-live')).toHaveText(MENU_SHOWN_LIVE);
    // From inside the menu: the focus is not lost in the inert nav.
    await page.getByTestId('nav-mixes').focus();
    await page.keyboard.press('c');
    await expect(page.getByTestId('nav-show')).toBeFocused();
    await page.keyboard.press('c');
    await expect(page.getByTestId('nav-show')).toHaveCount(0);
    // Review round 1: the floating logo, which goes, hands the focus to the menu's logo (it was lost to the body).
    await expect(page.getByTestId('nav-hide'), 'C back from the floating logo: the menu\'s logo').toBeFocused();
    // The focus outside the menu stays where it is, both ways.
    await page.getByTestId('desktop-play').focus();
    await page.keyboard.press('c');
    await expect(page.getByTestId('nav-show')).toBeVisible();
    await expect(page.getByTestId('desktop-play'), 'C away: the focus stays on Play').toBeFocused();
    await page.keyboard.press('c');
    await expect(page.getByTestId('nav-show')).toHaveCount(0);
    await expect(page.getByTestId('desktop-play'), 'C back: the focus stays on Play').toBeFocused();
    // Typing a "c" in the Library's search: a letter, not the key.
    await tab(page, 'library');
    await page.getByTestId('library-search').fill('');
    await page.getByTestId('library-search').type('c');
    await expect(page.getByTestId('library-search')).toHaveValue('c');
    await expect(page.getByTestId('nav-show'), 'typing: the menu stays').toHaveCount(0);
    await page.getByTestId('library-search').fill('');
    await tab(page, 'now');
    // The shortcuts off (the "?" dialog's switch): C does nothing; the logo still works.
    await blur(page);
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
    const sw = page.getByTestId('shortcuts-dialog').getByRole('switch', { name: 'Keyboard shortcuts' });
    await sw.click();
    await expect(sw, 'the shortcuts off').toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
    await blur(page);
    await page.keyboard.press('c');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('nav-show'), 'shortcuts off: C does nothing').toHaveCount(0);
    await hide(page);
    await page.getByTestId('nav-show').click();
    await expect(page.getByTestId('nav-show')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('N4. while away: L slides it out to Layers, / to the Library search, ? to the shortcuts; Q and V open their panels with it still away (header room)', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    const awayThenPress = async (key: string) => {
      if ((await page.getByTestId('nav-show').count()) === 0) await hide(page);
      await blur(page);
      await page.keyboard.press(key);
    };
    await awayThenPress('l');
    await expect(page.getByTestId('nav-show'), 'L: back').toHaveCount(0);
    await expect(page.getByTestId('nav-layers')).toHaveAttribute('aria-current', 'page');
    await tab(page, 'now');
    await awayThenPress('/');
    await expect(page.getByTestId('nav-show'), '/: back').toHaveCount(0);
    await expect(page.getByTestId('library-search')).toBeFocused();
    await page.keyboard.press('Escape');
    await tab(page, 'now');
    await awayThenPress('?');
    await expect(page.getByTestId('nav-show'), '?: back').toHaveCount(0);
    await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
    // Review round 1: from the floating logo (a click put the focus there), the focus comes back to the menu's logo.
    await hide(page);
    await expect(page.getByTestId('nav-show')).toBeFocused();
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('nav-hide'), '? then Esc from the floating logo: the menu\'s logo').toBeFocused();
    await hide(page);
    await page.keyboard.press('l');
    await expect(page.getByTestId('nav-layers')).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('l');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await expect(page.getByTestId('nav-hide'), 'L then L from the floating logo: the menu\'s logo').toBeFocused();
    // L with Layers already open and the menu away: the menu comes out, Layers stays open.
    await tab(page, 'layers');
    await hide(page);
    await blur(page);
    await page.keyboard.press('l');
    await expect(page.getByTestId('nav-show')).toHaveCount(0);
    await expect(page.getByTestId('desktop-panel'), 'Layers stays open').toBeVisible();
    await expect(page.getByTestId('nav-layers')).toHaveAttribute('aria-current', 'page');
    await tab(page, 'now');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    // A panel opened from a menu row, then the menu away: its Esc gives the focus to the floating logo (the row is inert).
    await page.getByTestId('nav-mixes').focus();
    await page.keyboard.press('q');
    await expect(page.getByTestId('desktop-panel')).toBeVisible();
    await page.keyboard.press('c');
    await expect(page.getByTestId('nav-show')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await expect(page.getByTestId('nav-show'), 'the fallback: the floating logo, not the body').toBeFocused();
    // Review round 2: a panel opened from the floating logo (V), then the menu back (C, the logo gone): its Esc gives the
    // focus to the menu's own logo, not the body.
    await page.keyboard.press('v');
    await expect(page.getByTestId('desktop-panel')).toBeVisible();
    await page.keyboard.press('c');
    await expect(page.getByTestId('nav-show')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await expect(page.getByTestId('nav-hide'), 'the opener gone: the menu\'s logo').toBeFocused();
    // Q and V: their panels, the menu still away.
    await awayThenPress('q');
    await expect(page.getByTestId('nav-show'), 'Q: still away').toBeVisible();
    await expectHeaderRoom(page, 'Up next (Q)');
    await blur(page);
    await page.keyboard.press('q');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await awayThenPress('v');
    await expect(page.getByTestId('nav-show'), 'V: still away').toBeVisible();
    await expectHeaderRoom(page, 'Visuals (V)');
    await blur(page);
    await page.keyboard.press('v');
    expect(dialogs).toEqual([]);
  });

  test('N5. header room in every panel view while away: Library, Mixes, Layers, More and a More page, Crystal, Walks, Output (Sound), Up next', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await hide(page);
    // The nav is away and inert, so open each place through the transport and the keys, as a user can.
    const views: Array<[string, () => Promise<void>]> = [
      ['Library', async () => { await blur(page); await page.keyboard.press('/'); await expect(page.getByTestId('library-search')).toBeFocused(); await page.getByTestId('nav-hide').click(); await settle(page); }],
      ['Crystal', async () => { await page.getByTestId('desktop-crystal').click(); }],
      ['Walks', async () => { await page.getByTestId('desktop-walks').click(); }],
      ['Output (Sound)', async () => { await page.getByTestId('desktop-output').click(); }],
      ['Up next', async () => { await page.getByTestId('desktop-queue').click(); }],
      // Review round 1: Import (the Library's own button; its sheet takes the panel).
      ['Import', async () => { await blur(page); await page.keyboard.press('/'); await expect(page.getByTestId('library-search')).toBeFocused(); await page.getByTestId('nav-hide').click(); await settle(page); await page.getByTestId('library-import').click(); }],
    ];
    for (const [what, open] of views) {
      await open();
      await expect(page.getByTestId('nav-show'), `${what}: still away`).toBeVisible();
      await expectHeaderRoom(page, what);
      // Close everything that is open (Import gives the panel back to the Library first), and it must close.
      for (let i = 0; i < 3 && (await page.getByTestId('desktop-panel').count()) > 0; i++) {
        await blur(page);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
      await expect(page.getByTestId('desktop-panel'), `${what}: closed by Escape`).toHaveCount(0);
    }
    // Mixes, Layers, More and a More page: shown, opened, then away (the panel goes to the edge with it).
    for (const t of ['mixes', 'layers', 'more'] as const) {
      await page.getByTestId('nav-show').click();
      await settle(page);
      await tab(page, t);
      await hide(page);
      await expectHeaderRoom(page, t);
      if (t === 'mixes') {
        // Review round 1: the mix builder's own header (Back first: pl-1).
        await page.getByTestId('mixes-create').click();
        await expect(page.getByTestId('mix-builder')).toBeVisible();
        await expectHeaderRoom(page, 'Mixes › Create a mix');
      }
      if (t === 'more') {
        await moreRow(page, 'more-guide-row').click();
        await expectHeaderRoom(page, 'More › Guide');
      }
    }
    expect(dialogs).toEqual([]);
  });

  test('N6. the empty-library card moves to the edge while away; reduced motion: no slide', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialogs = await openNewLayout(page);
    const card = page.getByTestId('desktop-empty');
    await expect(card).toBeVisible();
    const left = () => card.evaluate((el) => el.parentElement!.getBoundingClientRect().left);
    expect(Math.round(await left()), 'shown: beside the menu').toBe(200);
    await hide(page);
    expect(Math.round(await left()), 'away: from the edge').toBe(0);
    await page.getByTestId('nav-show').click();
    // motion-reduce:transition-none turns the transition's property off (its duration stays declared).
    const motion = () => page.getByTestId('side-nav').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { property: cs.transitionProperty, duration: cs.transitionDuration };
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await motion()).property, 'reduced motion: no slide').toBe('none');
    // Review round 1: the panel and its header room too, under reduced motion: at the edge on the next frame.
    await tab(page, 'library');
    await expect(page.getByTestId('desktop-panel')).toBeVisible();
    await page.getByTestId('nav-hide').click();
    const nextFrame = await page.evaluate(
      () =>
        new Promise<{ left: number; head: number }>((resolve) =>
          requestAnimationFrame(() => {
            const panel = document.querySelector('[data-testid="desktop-panel"]')!;
            const head = panel.querySelector('header, [data-panel-head]') as HTMLElement;
            resolve({ left: panel.getBoundingClientRect().left, head: parseFloat(getComputedStyle(head).paddingLeft) });
          })
        )
    );
    expect(nextFrame.left, 'reduced motion: the panel at the edge at once').toBeLessThanOrEqual(0.5);
    expect(nextFrame.head, "reduced motion: the header's room at once (72 px)").toBe(72);
    await page.getByTestId('nav-show').click();
    await tab(page, 'now');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await motion(), 'the slide: transform, 220 ms').toEqual({ property: 'transform', duration: '0.22s' });
    expect(dialogs).toEqual([]);
  });

  test('N7. the shortcuts list has "Show or hide the menu" with C; both logo buttons name C (aria-keyshortcuts)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await blur(page);
    await page.keyboard.press('?');
    const dialog = page.getByTestId('shortcuts-dialog');
    await expect(dialog).toBeVisible();
    // Review round 1: the row itself and its keycap (the group's text always has a "C", in "Close the panel").
    const row = dialog.locator('[data-shortcut="menu"]');
    await expect(row).toContainText('Show or hide the menu');
    await expect(row.locator('kbd')).toHaveText(['C']);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('nav-hide')).toHaveAttribute('aria-keyshortcuts', 'C');
    await expect(page.getByTestId('side-nav')).toHaveAttribute('id', 'desktop-side-nav');
    await expect(page.getByTestId('nav-hide')).toHaveAttribute('aria-controls', 'desktop-side-nav');
    await hide(page);
    await expect(page.getByTestId('nav-show')).toHaveAttribute('aria-keyshortcuts', 'C');
    await expect(page.getByTestId('nav-show')).toHaveAttribute('aria-controls', 'desktop-side-nav');
    expect(dialogs).toEqual([]);
  });
});
