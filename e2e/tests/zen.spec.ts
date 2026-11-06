import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import { hideZen, importTones, openApp, tapAt, zenLayer } from './helpers';

// Zen Mode on a touch screen (v15.4). Until v15.3 the hidden UI was only transparent (opacity-0) and still live, so
// the tap meant to bring it back also pressed whatever invisible control lay under the finger: it opened Harmonic
// Control, skipped the track, or dropped the volume from 80 % to 3 % without even showing the UI (measured). Now the
// hidden UI is inert: the tap lands on the app's root, which only reveals; a second tap within the 3 s uses the
// control. Taps while shown keep it shown; a mouse still reveals by moving; the keyboard gets a "Show controls" button.

const harmonicHeading = (page: Page) => page.getByRole('heading', { name: 'Harmonic Control', exact: true });
const masterVolume = (page: Page) => page.locator('input[type="range"][title^="Master Volume"]');
/** Zen's "Show controls" (visually hidden until it has the focus). */
const showControls = (page: Page) => page.getByRole('button', { name: 'Show controls', exact: true });
/** An element's rendered width (an sr-only one is 1 px: not on screen). */
const widthOf = async (target: Locator): Promise<number> => (await target.boundingBox())?.width ?? 0;

/** The centre of an element's box (inert elements still have one). */
async function centre(target: Locator): Promise<{ x: number; y: number }> {
  const b = await target.boundingBox();
  if (!b) throw new Error('no box');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Hidden, and (v15.4) inert: soft, so on an older build the test goes on to show what the tap did. */
async function hidden(page: Page): Promise<void> {
  await hideZen(page);
  await expect.soft(zenLayer(page), 'the hidden UI is inert').toHaveAttribute('inert', /.*/);
}

async function revealed(page: Page): Promise<void> {
  await expect(zenLayer(page), 'the tap revealed the UI').not.toHaveClass(/opacity-0/, { timeout: 2_000 });
  await expect(zenLayer(page), 'and it is live again').not.toHaveAttribute('inert', /.*/);
}

/** Close the Safety panel when it opened by itself (an unanalysed track does that). */
async function closeSafety(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close Safety Panel' });
  if (await close.isVisible().catch(() => false)) await close.click();
}

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 411, height: 752 }, hasTouch: true, isMobile: true });

  async function setUp(page: Page): Promise<string[]> {
    const dialogs = await openApp(page);
    await importTones(page, 3, 60);
    await page.getByText('tone-01', { exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 15_000 });
    await closeSafety(page);
    // A phone's library drawer covers most of the screen: close it if it is open, so the screen's middle is empty
    // (the device runs at a desktop width, where the drawer sits beside the main area).
    const drawer = await page.locator('aside').boundingBox();
    if (!ON_DEVICE && drawer && drawer.x + drawer.width > 50) {
      await page.locator('header button').first().click();
      await page.waitForTimeout(400);
    }
    return dialogs;
  }

  test('1. a tap on the hidden Harmonic Control button only reveals; a second tap opens it', async ({ page }) => {
    const dialogs = await setUp(page);
    await hidden(page);
    const at = await centre(page.getByTitle('Harmonic Control', { exact: true }));
    await tapAt(page, at.x, at.y);
    await revealed(page);
    await page.waitForTimeout(500);
    await expect(harmonicHeading(page), 'the reveal tap opened nothing').toHaveCount(0);
    await tapAt(page, at.x, at.y);
    await expect(harmonicHeading(page), 'a second tap within the 3 s opens it').toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('2. a tap on the hidden volume slider leaves the volume alone', async ({ page }) => {
    const dialogs = await setUp(page);
    const before = await masterVolume(page).inputValue();
    await hidden(page);
    const b = (await masterVolume(page).boundingBox())!;
    await tapAt(page, b.x + b.width * 0.15, b.y + b.height / 2);
    await page.waitForTimeout(400);
    expect(await masterVolume(page).inputValue(), 'the volume').toBe(before);
    await revealed(page);
    expect(dialogs).toEqual([]);
  });

  test('3. a tap on the hidden Next button keeps the track', async ({ page }) => {
    const dialogs = await setUp(page);
    const title = page.getByTestId('now-playing-title');
    await expect(title).toHaveText('tone-01');
    await hidden(page);
    const at = await centre(page.getByTestId('player-bar').locator('button[aria-label="Next track"]'));
    await tapAt(page, at.x, at.y);
    await page.waitForTimeout(800);
    await expect(title, 'the same track').toHaveText('tone-01');
    await revealed(page);
    expect(dialogs).toEqual([]);
  });

  test('4. with the UI hidden, the keyboard finds "Show controls", and Enter reveals', async ({ page }) => {
    const dialogs = await setUp(page);
    await hidden(page);
    await page.keyboard.press('Tab');
    const show = page.getByRole('button', { name: 'Show controls', exact: true });
    await expect(show).toBeFocused();
    await expect(show).toBeInViewport();
    const b = (await show.boundingBox())!;
    expect(b.width, 'visible while focused').toBeGreaterThan(40);
    await page.keyboard.press('Enter');
    await revealed(page);
    await expect(show).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('5. taps while the UI shows keep it showing', async ({ page }) => {
    const dialogs = await setUp(page);
    // tapAt, not locator.tap(): the phone's CDP context has no hasTouch ("The page does not support tap").
    const zen = await centre(page.getByTitle('Zen Mode (Hide UI)', { exact: true }));
    await tapAt(page, zen.x, zen.y);
    await expect(page.getByTitle('Show UI', { exact: true }), 'Zen Mode is on').toHaveCount(1);
    // An empty spot in the middle: the main area, nothing to press.
    const vp = page.viewportSize()!;
    for (let t = 0; t < 7000; t += 2000) {
      await tapAt(page, vp.width / 2, vp.height / 2);
      await page.waitForTimeout(2000);
      await expect(zenLayer(page), `still shown after ${(t + 2000) / 1000} s`).not.toHaveAttribute('inert', /.*/);
      await expect(zenLayer(page)).not.toHaveClass(/opacity-0/);
    }
    // And with no tap, it hides 3 s after the last one.
    await expect(zenLayer(page)).toHaveClass(/opacity-0/, { timeout: 6_000 });
    expect(dialogs).toEqual([]);
  });

  test('7. the keyboard keeps the controls showing, and reaches the Zen toggle to leave Zen', async ({ page }) => {
    test.skip(ON_DEVICE, 'keyboard focus order at the phone test viewport');
    const dialogs = await setUp(page);
    await hidden(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Show controls', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await revealed(page);
    // Keys keep it showing well past the 3 s, and the focus never drops to <body>.
    for (let i = 1; i <= 5; i++) {
      await page.waitForTimeout(1000);
      await page.keyboard.press('Tab');
      await expect(zenLayer(page), `after ${i} s of keys`).not.toHaveAttribute('inert', /.*/);
      expect(await page.evaluate(() => document.activeElement !== document.body), `focus after ${i} s`).toBe(true);
    }
    // Backwards to the Zen toggle (the player bar's last button) and out of Zen.
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('title') === 'Show UI')) break;
      await page.keyboard.press('Shift+Tab');
    }
    await expect(page.getByTitle('Show UI', { exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTitle('Zen Mode (Hide UI)', { exact: true })).toHaveCount(1);
    await page.waitForTimeout(4000);
    await expect(zenLayer(page), 'out of Zen, the UI stays').not.toHaveClass(/opacity-0/);
    expect(dialogs).toEqual([]);
  });

  test('8. a search field tapped in Zen keeps its focus (and a phone its keyboard) past the 3 s', async ({ page }) => {
    const dialogs = await openApp(page);
    await importTones(page, 3, 10);
    await expect(page.getByText('tone-03', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    const menu = page.locator('header button').first();
    // The open drawer covers the player bar's Zen button on a phone: close it, enter Zen, open it again.
    const drawer = await page.locator('aside').boundingBox();
    if (!ON_DEVICE && drawer && drawer.x + drawer.width > 50) {
      await menu.click();
      await page.waitForTimeout(500);
    }
    const zen = await centre(page.getByTitle('Zen Mode (Hide UI)', { exact: true }));
    await tapAt(page, zen.x, zen.y);
    await expect(page.getByTitle('Show UI', { exact: true })).toHaveCount(1);
    if (!ON_DEVICE) {
      const m = await centre(menu);
      await tapAt(page, m.x, m.y);
      await page.waitForTimeout(500);
    }
    const search = page.getByPlaceholder('Search songs...');
    const s = await centre(search);
    await tapAt(page, s.x, s.y);
    await expect(search).toBeFocused();
    await page.waitForTimeout(5000);
    await expect(search, 'still focused after 5 s').toBeFocused();
    await expect(zenLayer(page)).not.toHaveAttribute('inert', /.*/);
    await page.keyboard.type('tone-02');
    await expect(search).toHaveValue('tone-02');
    // Leaving the field lets Zen hide the UI again.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(zenLayer(page)).toHaveClass(/opacity-0/, { timeout: 8_000 });
    expect(dialogs).toEqual([]);
  });

  // v16.8 (Chrome 157, components/shell/zenFocus.ts): when the hide makes the focused control inert, Chrome 157 starts
  // the next Tab from that control, finds nothing after it and leaves the page (only a second Tab reached "Show
  // controls"). Fix round 1 puts back exactly the Chrome 156 behaviour: no focus moves at the hide (nothing new on
  // screen), and while the focus is lost to the hide one Tab goes to "Show controls". A focus somewhere that stays
  // visible (a notice) keeps its own Tab order.
  test('9. hidden from the keyboard: the focus is not moved (nothing new on screen); one Tab reaches "Show controls", and it shows; Enter reveals', async ({ page }) => {
    test.skip(ON_DEVICE, 'keyboard focus order at the phone test viewport');
    const dialogs = await setUp(page);
    // To the Zen toggle (the player bar's last button) by the keyboard, as a keyboard user gets there.
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('title') === 'Zen Mode (Hide UI)')) break;
      await page.keyboard.press('Shift+Tab');
    }
    const toggle = page.getByTitle('Zen Mode (Hide UI)', { exact: true });
    await expect(toggle, 'the keyboard reached the Zen toggle').toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTitle('Show UI', { exact: true }), 'Zen Mode is on').toBeFocused();
    // No key and no pointer from here: the controls hide 3 s later.
    await expect(zenLayer(page), 'Zen Mode hides the UI').toHaveClass(/opacity-0/, { timeout: 8_000 });
    await expect(zenLayer(page)).toHaveAttribute('inert', /.*/);
    const show = showControls(page);
    await page.waitForTimeout(500);
    await expect(show, 'the hide moved no focus to Show controls').not.toBeFocused();
    expect(await widthOf(show), 'Show controls stays off screen (visually hidden until focused)').toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    await expect(show, 'one Tab reaches it').toBeFocused();
    await expect(show).toBeInViewport();
    expect(await widthOf(show), 'and then it shows').toBeGreaterThan(40);
    await expect(zenLayer(page), 'focusing it revealed nothing').toHaveAttribute('inert', /.*/);
    await page.keyboard.press('Enter');
    await revealed(page);
    expect(dialogs).toEqual([]);
  });

  test('10. hidden after a mouse click on the Zen toggle: nothing new on screen (the focus is not moved to "Show controls"); one Tab reaches it', async ({ page }) => {
    test.skip(ON_DEVICE, 'keyboard focus order at the phone test viewport');
    const dialogs = await setUp(page);
    await hidden(page); // hideZen: a mouse click (Playwright's click), which focuses the toggle
    const show = showControls(page);
    await page.waitForTimeout(500);
    await expect(show, 'a click hid it: the focus is not moved there').not.toBeFocused();
    expect(await widthOf(show), '"Show controls" stays off screen (visually hidden until focused)').toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    await expect(show, 'one Tab reaches it').toBeFocused();
    expect(await widthOf(show), 'and then it shows').toBeGreaterThan(40);
    expect(dialogs).toEqual([]);
  });

  test('10b. hidden after a real touch tap on the Zen toggle: no focus move, nothing new on screen; one Tab still reaches "Show controls"', async ({ page }) => {
    test.skip(ON_DEVICE, 'keyboard focus order at the phone test viewport');
    const dialogs = await setUp(page);
    const at = await centre(page.getByTitle('Zen Mode (Hide UI)', { exact: true }));
    await page.touchscreen.tap(at.x, at.y); // a real touch (hasTouch), not a mouse click
    await expect(page.getByTitle('Show UI', { exact: true }), 'Zen Mode is on').toHaveCount(1);
    await expect(zenLayer(page), 'Zen Mode hides the UI').toHaveClass(/opacity-0/, { timeout: 8_000 });
    await expect(zenLayer(page)).toHaveAttribute('inert', /.*/);
    const show = showControls(page);
    await page.waitForTimeout(500);
    await expect(show, 'a tap hid it: the focus is not moved there').not.toBeFocused();
    expect(await widthOf(show), '"Show controls" stays off screen').toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    await expect(show, 'one Tab reaches it').toBeFocused();
    expect(await widthOf(show), 'and then it shows').toBeGreaterThan(40);
    expect(dialogs).toEqual([]);
  });

  test('11. a notice stays visible in Zen and keeps its own Tab order: Reload focused while hidden, Tab goes to "Dismiss update notice", not to "Show controls"', async ({ page }) => {
    test.skip(ON_DEVICE, 'keyboard focus order at the phone test viewport');
    const dialogs = await setUp(page);
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    const reload = page.getByTestId('update-reload');
    await expect(reload).toBeVisible();
    await hidden(page);
    await expect(zenLayer(page)).toHaveAttribute('inert', /.*/);
    await reload.focus(); // the keyboard's way to it (no pointer), as a screen reader's or a skip link's would be
    await expect(reload).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Dismiss update notice', exact: true }), "the notice's next control").toBeFocused();
    await expect(showControls(page)).not.toBeFocused();
    expect(dialogs).toEqual([]);
  });

  test('11b. a keyboard focus on a notice that stays visible is never moved by the hide: Reload keeps it, and Tab goes on in the notice', async ({ page }) => {
    test.skip(ON_DEVICE, 'keyboard focus order at the phone test viewport');
    const dialogs = await setUp(page);
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    const reload = page.getByTestId('update-reload');
    await expect(reload).toBeVisible();
    await page.getByTitle('Zen Mode (Hide UI)', { exact: true }).click();
    await expect(page.getByTitle('Show UI', { exact: true }), 'Zen Mode is on').toHaveCount(1);
    await reload.focus();
    await page.keyboard.press('Shift'); // a key: the keyboard's focus now (it matches :focus-visible)
    expect(await reload.evaluate((el) => el.matches(':focus-visible')), "Reload has the keyboard's focus").toBe(true);
    // No pointer from here: the controls hide 3 s after the key.
    await expect(zenLayer(page), 'Zen Mode hides the UI').toHaveClass(/opacity-0/, { timeout: 8_000 });
    await expect(zenLayer(page)).toHaveAttribute('inert', /.*/);
    await page.waitForTimeout(500);
    await expect(reload, 'the hide left the focus on Reload').toBeFocused();
    expect(await widthOf(showControls(page)), '"Show controls" stays off screen').toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Dismiss update notice', exact: true })).toBeFocused();
    expect(dialogs).toEqual([]);
  });
});

// Review B1 (fix round 1): Chrome 157 gives a mouse-focused button :focus-visible after ANY key (Shift alone, a letter,
// the media keys). So nothing keyed on :focus-visible may move the focus at the hide: after a click on the Zen toggle and
// a key, "Show controls" stays off screen (it would otherwise sit at the top left all session). Classic has no Space
// shortcut: Space there presses the focused toggle and leaves Zen, so Shift alone is the case.
test.describe('with a mouse and a keyboard', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('12. a mouse click on the Zen toggle, then Shift alone: after the hide no focus move, "Show controls" off screen; one Tab reaches it', async ({ page }) => {
    test.skip(ON_DEVICE, 'a mouse and a keyboard');
    const dialogs = await openApp(page);
    await importTones(page, 2, 60);
    await page.getByText('tone-01', { exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 15_000 });
    await closeSafety(page);
    const toggle = page.getByTitle('Zen Mode (Hide UI)', { exact: true });
    await toggle.click();
    const on = page.getByTitle('Show UI', { exact: true });
    await expect(on, 'the click focused the toggle').toBeFocused();
    await page.keyboard.press('Shift');
    expect(await on.evaluate((el) => el.matches(':focus-visible')), 'Chrome: :focus-visible after a key').toBe(true);
    await expect(zenLayer(page), 'Zen Mode hides the UI').toHaveClass(/opacity-0/, { timeout: 8_000 });
    await expect(zenLayer(page)).toHaveAttribute('inert', /.*/);
    const show = showControls(page);
    await page.waitForTimeout(500);
    await expect(show, 'the hide moved no focus to Show controls').not.toBeFocused();
    expect(await widthOf(show), 'the pill is not on screen').toBeLessThanOrEqual(1);
    await page.waitForTimeout(1000);
    expect(await widthOf(show), 'nor a second later').toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    await expect(show, 'one Tab reaches it').toBeFocused();
    expect(await widthOf(show), 'and then it shows').toBeGreaterThan(40);
    expect(dialogs).toEqual([]);
  });

  test('13. a click on words in the player bar (no control: the focus on <body>), then the hide: one Tab reaches "Show controls"', async ({ page }) => {
    test.skip(ON_DEVICE, 'a mouse and a keyboard');
    const dialogs = await openApp(page);
    await importTones(page, 2, 60);
    await page.getByText('tone-01', { exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 15_000 });
    await closeSafety(page);
    await page.getByTitle('Zen Mode (Hide UI)', { exact: true }).evaluate((b) => (b as HTMLButtonElement).click());
    await expect(page.getByTitle('Show UI', { exact: true }), 'Zen Mode is on').toHaveCount(1);
    // Chrome's starting point goes where the click landed, inside the UI that the hide makes inert.
    await page.getByTestId('now-playing-title').click();
    expect(await page.evaluate(() => document.activeElement === document.body), 'words take no focus').toBe(true);
    await expect(zenLayer(page), 'Zen Mode hides the UI').toHaveClass(/opacity-0/, { timeout: 8_000 });
    await expect(zenLayer(page)).toHaveAttribute('inert', /.*/);
    const show = showControls(page);
    await page.waitForTimeout(500);
    expect(await widthOf(show), '"Show controls" off screen').toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    await expect(show, 'one Tab reaches it').toBeFocused();
    expect(dialogs).toEqual([]);
  });
});

test('6. with a mouse, a move reveals and a click works as before', async ({ page }) => {
  test.skip(ON_DEVICE, 'a mouse');
  const dialogs = await openApp(page);
  await hideZen(page);
  await expect(zenLayer(page)).toHaveAttribute('inert', /.*/);
  await page.mouse.move(640, 300);
  await expect(zenLayer(page)).not.toHaveClass(/opacity-0/);
  await expect(zenLayer(page)).not.toHaveAttribute('inert', /.*/);
  await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();
  await expect(harmonicHeading(page)).toBeVisible();
  expect(dialogs).toEqual([]);
});
