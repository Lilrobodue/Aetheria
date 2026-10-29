import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  drawsPerSecond,
  expectShellHidden,
  importTones,
  instrumentAudio,
  layerState,
  newShell,
  openApp,
  openLayersTab,
  optInNewLayout,
  pauseCount,
  phoneSize,
  playInNewLayout,
  recordHudDraws,
  sheet,
  shellHidden,
  tab,
  tapAt,
  zenLayer,
  zenToggle,
  PHONE_VIEWPORT,
  peekClassicLibrary,
} from './helpers';

// v15.6, Zen in the new layout (spec §3.11; decisions 1 A and 2 A): an eye button in Now Playing's top bar (the desktop
// transport's right end), and a first row in the ⋯ menu, turn it on; the controls then hide 3 s after the last
// activity, only on the phone's Now Playing (never the Car screen) and on the desktop with no panel open. Hidden, the
// shell is inert and transparent, and a full-screen surface turns the first tap into a reveal, on `click`, so it never
// presses the control under the finger. The visuals never pause for it; the notices stay live in their slot; the track
// announcer stays outside the inert root. Never remembered. Classic's Zen is classic's (zen.spec.ts, unchanged).

// The visualizer draws (dev server: below its 30/s cap, layout.spec's measure).
const DRAWING = 8;
const shell = (page: Page) => newShell(page);

async function centre(target: Locator): Promise<{ x: number; y: number }> {
  const b = await target.boundingBox();
  if (!b) throw new Error('no box');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** A finger tap at an element's centre (inert elements still have a box). */
async function tapOn(page: Page, target: Locator): Promise<void> {
  const c = await centre(target);
  await tapAt(page, c.x, c.y);
}

/** A finger tap on the visuals, away from every control (the top of Now Playing's empty middle). */
async function tapVisuals(page: Page): Promise<void> {
  await tapAt(page, 205, 300);
}

/** Zen on from the eye button (a DOM click: no pointer moves, so the 3 s start from here), then hidden. */
async function zenOnAndHidden(page: Page): Promise<void> {
  const eye = page.getByTestId('zen-button');
  if ((await eye.getAttribute('aria-pressed')) !== 'true') await eye.evaluate((b) => (b as HTMLButtonElement).click());
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  await expectShellHidden(page);
}

/** Revealed: the shell is live again (poll: on a device the tap's click lands after tapAt returns). */
async function expectShown(page: Page, message = 'the controls show'): Promise<void> {
  await expect.poll(() => shellHidden(page), { message, timeout: 5_000, intervals: [100] }).toBe(false);
  await expect(shell(page)).not.toHaveAttribute('inert', /.*/);
}

/** The accessibility tree's names of the controls in it now (not ignored). */
async function axControlNames(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: any[] };
    const CONTROLS = new Set(['button', 'slider', 'link', 'switch', 'checkbox', 'combobox', 'radio']);
    return nodes.filter((n) => !n.ignored && CONTROLS.has(n.role?.value)).map((n) => String(n.name?.value ?? ''));
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** The Visualizer's uiInsets prop, read from React's fiber of its canvas (dev and production alike). */
async function vizInsets(page: Page): Promise<{ top: number; bottom: number } | null> {
  return page.evaluate(() => {
    const canvas = document.getElementById('viz-canvas') as any;
    const key = canvas ? Object.keys(canvas).find((k) => k.startsWith('__reactFiber$')) : undefined;
    let f = key ? canvas[key] : null;
    while (f && !(typeof f.type === 'function' && f.memoizedProps && 'uiInsets' in f.memoizedProps)) f = f.return;
    return f ? { ...f.memoizedProps.uiInsets } : null;
  });
}

test.describe('phone, touch', () => {
  test.use({ viewport: PHONE_VIEWPORT, hasTouch: true });

  test('1. the eye button and the ⋯ row turn Zen on: 3 s later the shell is inert, transparent and out of the AX tree; the visuals draw on; a notice stays live', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    await recordHudDraws(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    const eye = page.getByTestId('zen-button');
    await expect(eye).toHaveAccessibleName('Zen mode');
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await eye.evaluate((b) => (b as HTMLButtonElement).click());
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    expect(await shellHidden(page), 'still shown at once (it waits 3 s)').toBe(false);
    await page.waitForTimeout(2000);
    expect(await shellHidden(page), 'still shown at 2 s').toBe(false);
    await expectShellHidden(page, 'hidden by 4.5 s', 2500);
    await expect(shell(page)).toHaveAttribute('inert', /.*/);
    await expect(shell(page)).toHaveClass(/opacity-0/);
    const names = await axControlNames(page);
    for (const gone of ['Pause', 'Next track', 'Previous track', 'Seek', 'More options', 'Zen mode', 'Shuffle', 'Library']) {
      expect.soft(names, `"${gone}" is out of the accessibility tree`).not.toContain(gone);
    }
    expect.soft(names, 'the keyboard\'s way back is there').toContain('Show controls');
    // The visuals never pause for Zen.
    const draws = await drawsPerSecond(page, 2);
    test.info().annotations.push({ type: 'draws/s, Zen hidden', description: draws.join(', ') });
    expect.soft(Math.min(...draws), `the visuals draw (${draws.join(', ')}/s)`).toBeGreaterThanOrEqual(DRAWING);
    expect.soft(await page.evaluate(() => getComputedStyle(document.getElementById('viz-canvas')!).display)).not.toBe('none');

    // A notice while hidden: live and tappable, and its Dismiss reveals nothing.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('aetheria:cache-error', { detail: { what: 'tracks', count: 1, seq: 1 } })));
    const toast = page.getByTestId('notices').getByText(/could not be saved for offline use/);
    await expect(toast).toBeVisible();
    await tapOn(page, page.getByTestId('notices').getByRole('button', { name: 'Dismiss', exact: true }));
    await expect(toast, 'Dismiss works while hidden').toHaveCount(0);
    expect(await shellHidden(page), 'and the tap did not reveal the controls').toBe(true);

    // The ⋯ row: Leave Zen (while on), then Hide the controls (Zen).
    await tapVisuals(page);
    await expectShown(page);
    await page.getByTestId('np-menu-button').click();
    await expect(page.getByTestId('menu-zen')).toContainText('Leave Zen');
    await page.getByTestId('menu-zen').click();
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('np-menu-button').click();
    await expect(page.getByTestId('menu-zen')).toContainText('Hide the controls (Zen)');
    await expect(page.getByTestId('menu-zen')).toContainText('Tap anywhere to bring them back');
    await page.getByTestId('menu-zen').click();
    await expect(page.getByTestId('sheet-menu')).toHaveCount(0);
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expectShellHidden(page, 'the menu row hides them 3 s later');
    expect(dialogs).toEqual([]);
  });

  test('2. a tap on the hidden Play only reveals; a second tap within 3 s pauses @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await zenOnAndHidden(page);
    const play = page.getByTestId('np-play');
    const pausesBefore = await pauseCount(page);
    await tapOn(page, play);
    await expectShown(page, 'the tap revealed the controls');
    await page.waitForTimeout(800);
    expect((await layerState(page)).music?.paused, 'the reveal tap pressed nothing: still playing').toBe(false);
    expect(await pauseCount(page), 'no pause()').toBe(pausesBefore);
    await tapOn(page, play);
    await expect.poll(async () => (await layerState(page)).music?.paused, { message: 'the second tap pauses', timeout: 5_000 }).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('3. taps on the hidden seek bar, Next, the Library tab and the crystal chip press nothing', async ({ page }) => {
    test.setTimeout(180_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    const title = (await page.getByTestId('np-title').textContent()) ?? '';
    const targets: Array<[string, Locator, () => Promise<void>]> = [
      ['the seek bar at 80 %', page.getByTestId('np-seek'), async () => {}],
      ['Next', page.getByRole('button', { name: 'Next track' }), async () => {
        await expect(page.getByTestId('np-title'), 'Next was not pressed').toHaveText(title);
      }],
      ['the Library tab', page.getByTestId('tab-library-button'), async () => {
        await expect(page.getByTestId('view-now'), 'still on Now Playing').toBeVisible();
        await expect(page.getByTestId('tab-library')).toHaveCount(0);
      }],
      ['the crystal chip', page.getByTestId('chip-crystal'), async () => {
        await expect(page.getByTestId('sheet-crystal'), 'no sheet opened').toHaveCount(0);
      }],
    ];
    await zenOnAndHidden(page);
    for (const [what, target, check] of targets) {
      await expectShellHidden(page, `${what}: hidden first`);
      const t0 = (await layerState(page)).music!.time;
      const w0 = Date.now();
      if (what.startsWith('the seek bar')) {
        const b = (await target.boundingBox())!;
        await tapAt(page, b.x + b.width * 0.8, b.y + b.height / 2);
      } else {
        await tapOn(page, target);
      }
      await expectShown(page, `${what}: the tap revealed`);
      await page.waitForTimeout(700);
      const t1 = (await layerState(page)).music!.time;
      const elapsed = (Date.now() - w0) / 1000;
      expect.soft(Math.abs(t1 - t0 - elapsed), `${what}: the time moved on by itself only (no seek)`).toBeLessThanOrEqual(1);
      expect.soft((await layerState(page)).music!.paused, `${what}: still playing`).toBe(false);
      await check();
    }
    expect(dialogs).toEqual([]);
  });

  test('4. the keyboard: Tab reaches Show controls, Enter reveals, keys keep it shown, Shift+Tab reaches Zen mode and Enter leaves Zen', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await zenOnAndHidden(page);
    expect(await page.evaluate(() => document.activeElement === document.body), 'inert left the focus on <body>').toBe(true);
    await page.keyboard.press('Tab');
    const show = page.getByTestId('zen-show-controls');
    await expect(show, 'Tab lands on Show controls').toBeFocused();
    const box = (await show.boundingBox())!;
    expect(box.height, 'a real target while focused').toBeGreaterThanOrEqual(40);
    expect(box.y >= 0 && box.x >= 0 && box.y + box.height <= PHONE_VIEWPORT.height, 'in the viewport').toBe(true);
    expect(await shellHidden(page), 'focusing it reveals nothing yet').toBe(true);
    await page.keyboard.press('Enter');
    await expectShown(page, 'Enter reveals');
    // Keys keep it shown (5 s of Tab presses), and the focus is always on a control.
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(1000);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null), `Tab ${i + 1}: the focus is on a control`).toBe(true);
      expect(await shellHidden(page), `Tab ${i + 1}: still shown`).toBe(false);
    }
    // Shift+Tab back to Zen mode, Enter leaves Zen.
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('Shift+Tab');
      found = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Zen mode');
    }
    expect(found, 'Shift+Tab reaches the Zen button').toBe(true);
    const eye = page.getByTestId('zen-button');
    await expect(eye).toBeFocused();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(4000);
    expect(await shellHidden(page), 'Zen left: 4 s later still shown').toBe(false);
    expect(dialogs).toEqual([]);
  });

  test('5. activity keeps it shown; with none it hides 3 s after the last', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await page.getByTestId('zen-button').evaluate((b) => (b as HTMLButtonElement).click());
    // Taps on the visuals every 2 s for 7 s: shown throughout.
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(i === 0 ? 1000 : 2000);
      expect(await shellHidden(page), `at ${1 + 2 * i} s: shown`).toBe(false);
      await tapVisuals(page);
    }
    await page.waitForTimeout(2000);
    expect(await shellHidden(page), '2 s after the last tap: shown').toBe(false);
    await expectShellHidden(page, 'hidden about 3 s after the last tap', 2500);
    expect(dialogs).toEqual([]);
  });

  test('6. dormant: a sheet, the ⋯ menu, Track info and another tab keep it shown; it hides 3 s after each closes', async ({ page }) => {
    test.setTimeout(240_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await zenOnAndHidden(page);
    const stays = async (what: string) => {
      await page.waitForTimeout(6500);
      expect.soft(await shellHidden(page), `${what}: still shown past 6 s`).toBe(false);
    };
    const reveal = async () => {
      await tapVisuals(page);
      await expectShown(page);
    };
    // The Crystal sheet.
    await reveal();
    await page.getByTestId('chip-crystal').click();
    await expect(sheet(page, 'Crystal')).toBeVisible();
    await stays('the Crystal sheet');
    await page.keyboard.press('Escape');
    await expectShellHidden(page, 'hidden after the sheet closes');
    // The ⋯ menu.
    await reveal();
    await page.getByTestId('np-menu-button').click();
    await expect(page.getByTestId('menu-body')).toBeVisible();
    await stays('the menu');
    await page.keyboard.press('Escape');
    await expectShellHidden(page, 'hidden after the menu closes');
    // Track info's Dialog (a kit overlay).
    await reveal();
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-track-info').click();
    await expect(page.getByTestId('readout-dialog')).toBeVisible();
    await stays('Track info');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('readout-dialog')).toHaveCount(0);
    await expectShellHidden(page, 'hidden after Track info closes');
    // Another tab.
    await reveal();
    await tab(page, 'library');
    await stays('the Library tab');
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await tab(page, 'now');
    await expectShellHidden(page, 'back on Now Playing it hides');
    expect(dialogs).toEqual([]);
  });

  test('6b. dormant while v2 asks for the output; hides 3 s after the answer', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    // v2 with no output answered yet: the first play asks.
    const dialogs = await openApp(page, { engine: 'v2' });
    await importTones(page, 3, 60);
    await page.getByText('tone-01', { exact: true }).first().waitFor();
    await optInNewLayout(page);
    await phoneSize(page);
    await page.getByTestId('np-play').click();
    await expect(page.getByTestId('output-sheet')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('zen-button').evaluate((b) => (b as HTMLButtonElement).click());
    await page.waitForTimeout(6500);
    expect(await shellHidden(page), 'the output question: still shown past 6 s').toBe(false);
    await page.getByTestId('output-sheet').getByRole('button', { name: 'Headphones' }).evaluate((b) => (b as HTMLButtonElement).click());
    await expect(page.getByTestId('output-sheet')).toHaveCount(0);
    await expectShellHidden(page, 'hidden 3 s after the answer');
    expect(dialogs).toEqual([]);
  });

  test('7. Car ends Zen, and the Car screen has no Zen button and never hides', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    const eye = page.getByTestId('zen-button');
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('np-output').click();
    await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Car', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-car')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zen mode' }), 'no Zen button on the Car screen').toHaveCount(0);
    await page.waitForTimeout(4500);
    expect(await shellHidden(page), 'the Car screen never hides').toBe(false);
    await page.getByRole('button', { name: 'Change output', exact: true }).click();
    await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Headphones', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-now')).toBeVisible();
    await expect(eye, 'Car ended Zen').toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(4000);
    expect(await shellHidden(page), 'and it stays shown').toBe(false);
    expect(dialogs).toEqual([]);
  });

  test('8. no leak either way: Back to classic and a peek end Zen; classic comes back without Zen', async ({ page }) => {
    test.setTimeout(180_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    const eye = page.getByTestId('zen-button');
    // Back to classic while Zen is on.
    await zenOnAndHidden(page);
    await tapVisuals(page);
    await expectShown(page);
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-back-to-classic').click();
    await expect(page.locator('header').getByTitle('Safety Protocols', { exact: true })).toBeVisible();
    await page.waitForTimeout(4500);
    await expect(zenLayer(page), 'classic is not in Zen').not.toHaveClass(/opacity-0/);
    await expect(page.getByRole('button', { name: 'Show controls', exact: true })).toHaveCount(0);
    await optInNewLayout(page);
    await expect(eye, 'back in the new layout: Zen is off').toHaveAttribute('aria-pressed', 'false');
    // A peek ends it too.
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await tab(page, 'library');
    await peekClassicLibrary(page);
    await expect(page.getByTestId('peek-pill')).toBeVisible();
    await page.getByTestId('peek-pill').click();
    await tab(page, 'now');
    await expect(eye, 'the peek ended Zen').toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(4000);
    expect(await shellHidden(page)).toBe(false);
    expect(dialogs).toEqual([]);
  });

  test('10. hidden, the visuals get the whole screen (insets 0/0); shown, the bars’ again; a notice keeps its slot', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await page.evaluate(() => {
      (window as any).__aetheriaUpdateReady = true;
      window.dispatchEvent(new Event('aetheria:update-ready'));
    });
    const notices = page.getByTestId('notices');
    await expect(notices.getByText(/A new version of Aetheria is ready/)).toBeVisible();
    // Polled, every value kept for the annotation: on the phone the page opens at 1280 × 800 (the desktop shell, no
    // top bar: top 0) and phoneSize has only just switched it to the phone shell, whose bars are measured a commit later.
    // The annotation is updated at each sample, so it holds every value read even when a poll fails.
    const insetNote = { type: 'insets read (top/bottom), ms from the first read', description: '' };
    test.info().annotations.push(insetNote);
    const insetLog: string[] = [];
    const t0 = Date.now();
    const sampleInsets = async (label: string) => {
      const v = await vizInsets(page);
      insetLog.push(`${label} +${Date.now() - t0} ${v ? `${v.top}/${v.bottom}` : 'none'}`);
      insetNote.description = insetLog.join('; ');
      return v;
    };
    const covered = (v: { top: number; bottom: number } | null) => !!v && v.top > 40 && v.bottom > 200;
    await expect
      .poll(async () => covered(await sampleInsets('shown')), { message: 'shown: the top bar covers the top and Now Playing the bottom', timeout: 10_000, intervals: [50, 100, 250] })
      .toBe(true);
    const shown = (await sampleInsets('shown'))!;
    expect(shown.top, 'shown: the top bar covers the top').toBeGreaterThan(40);
    expect(shown.bottom, 'shown: Now Playing covers the bottom').toBeGreaterThan(200);
    const noticeTop = await notices.evaluate((el) => el.getBoundingClientRect().top);
    await zenOnAndHidden(page);
    await expect.poll(() => sampleInsets('hidden'), { message: 'hidden: the whole screen' }).toEqual({ top: 0, bottom: 0 });
    expect(await notices.evaluate((el) => el.getBoundingClientRect().top), 'the notice keeps its slot while hidden').toBe(noticeTop);
    // Through the reveal, every frame and every value its slot's style takes: the notice never moves, not even for the
    // one commit before the bars are measured again.
    await notices.evaluate((el) => {
      const w = window as any;
      w.__noticeFrames = [] as number[];
      w.__noticeStyles = [] as string[];
      w.__noticeObserver = new MutationObserver(() => w.__noticeStyles.push((el as HTMLElement).style.top));
      w.__noticeObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
      const tick = () => {
        w.__noticeFrames.push(el.getBoundingClientRect().top);
        if (w.__noticeFrames.length < 120) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await tapVisuals(page);
    await expectShown(page);
    // Re-measured after a reveal by a touch's click (on the phone a real touch, its click held for Chrome's tap check).
    await expect.poll(() => sampleInsets('revealed'), { message: 'shown again: the bars’ insets' }).toEqual(shown);
    await page.waitForTimeout(500);
    const sampled = await page.evaluate(() => {
      const w = window as any;
      w.__noticeObserver.disconnect();
      return { frames: w.__noticeFrames as number[], styles: w.__noticeStyles as string[] };
    });
    test.info().annotations.push({ type: 'notice top through the reveal', description: `${sampled.frames.length} frames: ${[...new Set(sampled.frames)].join(', ')}; style changes: ${sampled.styles.join(', ') || 'none'}` });
    expect(sampled.frames.length, 'frames sampled through the reveal').toBeGreaterThan(10);
    expect([...new Set(sampled.frames)], 'the notice’s top in every frame of the reveal').toEqual([noticeTop]);
    // Compared as numbers (a px value within 0.01 of the slot): the serialised top's digits differ by browser.
    expect(sampled.styles.filter((t) => !(/^-?\d+(?:\.\d+)?(?:e-?\d+)?px$/.test(t) && Math.abs(parseFloat(t) - noticeTop) < 0.01)), 'no other slot, even for one commit').toEqual([]);
    expect(await notices.evaluate((el) => el.getBoundingClientRect().top), 'and shown').toBe(noticeTop);
    expect(dialogs).toEqual([]);
  });

  test('11. an auto-advance while hidden updates the track announcer, which is outside the inert root', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page, { count: 4, seconds: 9 });
    await phoneSize(page);
    await zenOnAndHidden(page);
    const announcer = page.getByTestId('track-announcer');
    expect(await announcer.evaluate((el) => !!el.closest('[inert]')), 'the announcer is not inside an inert subtree').toBe(false);
    const before = (await announcer.textContent()) ?? '';
    await expect.poll(async () => (await announcer.textContent()) ?? '', { message: 'the next track is announced', timeout: 20_000 }).not.toBe(before);
    expect(await announcer.textContent()).toMatch(/^Now playing: tone-0\d$/);
    expect(await shellHidden(page), 'the advance revealed nothing').toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('12. Zen is never remembered: after a reload the controls show', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await zenOnAndHidden(page);
    await page.reload();
    await newShell(page).waitFor();
    await expect(page.getByTestId('zen-button')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(4500);
    expect(await shellHidden(page), 'after a reload: shown').toBe(false);
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('9. the desktop: Zen hides the nav and the transport; a mouse move reveals, then a click on Pause pauses; the Layers panel keeps it shown', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    if (ON_DEVICE) await page.setViewportSize({ width: 1280, height: 800 });
    const eye = page.getByTestId('zen-button-desktop');
    await expect(eye).toHaveAccessibleName('Zen mode');
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expectShellHidden(page, 'the nav and the transport hide');
    expect(await page.getByTestId('side-nav').evaluate((el) => !!el.closest('[inert]')), 'the nav is inert').toBe(true);
    expect(await page.getByTestId('desktop-transport').evaluate((el) => !!el.closest('[inert]')), 'the transport is inert').toBe(true);
    await page.mouse.move(640, 300);
    await page.mouse.move(660, 320);
    await expectShown(page, 'a mouse move reveals');
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await layerState(page)).music?.paused, { message: 'the click then pauses', timeout: 5_000 }).toBe(true);
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(false);
    // A panel open: dormant.
    await openLayersTab(page);
    await page.waitForTimeout(6500);
    expect(await shellHidden(page), 'the Layers panel keeps it shown').toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await expectShellHidden(page, 'panel closed: it hides again');
    // A sheet in the panel (non-modal on the desktop, so no kit overlay holds it: zenActive's sheet rule alone does).
    await page.mouse.move(640, 300);
    await page.mouse.move(650, 310);
    await expectShown(page);
    await page.getByTestId('desktop-crystal').click();
    await expect(page.getByRole('region', { name: 'Crystal', exact: true })).toBeVisible();
    await page.waitForTimeout(6500);
    expect(await shellHidden(page), 'the Crystal panel keeps it shown').toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await expectShellHidden(page, 'the Crystal panel closed: it hides again');
    expect(await zenToggle(page).count()).toBeGreaterThan(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('landscape phone, touch', () => {
  test.use({ viewport: { width: 882, height: 411 }, hasTouch: true });

  test('4b. landscape: after Show controls and Enter the focus is on a visible control (the top bar is hidden there)', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    if (ON_DEVICE) await page.setViewportSize({ width: 882, height: 411 });
    await expect(page.getByTestId('new-top-bar'), 'the top bar is hidden in landscape').toBeHidden();
    const eye = page.getByTestId('zen-button-landscape');
    await expect(eye).toBeVisible();
    await eye.evaluate((b) => (b as HTMLButtonElement).click());
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expectShellHidden(page);
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('zen-show-controls')).toBeFocused();
    await page.keyboard.press('Enter');
    await expectShown(page, 'Enter reveals');
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const a = document.activeElement as HTMLElement | null;
            return !a || a === document.body ? 'body' : a.getClientRects().length > 0 ? a.getAttribute('aria-label') || a.tagName : 'hidden element';
          }),
        { message: 'the focus is on a visible control, never <body>' }
      )
      .toBe('Zen mode');
    await expect(eye, 'the landscape header’s Zen button').toBeFocused();
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, touch, long press', () => {
  test.use({ viewport: PHONE_VIEWPORT, hasTouch: true });

  test('13. a finger held on the seek bar past 3 s keeps the controls shown; after it lifts they hide 3 s later', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playInNewLayout(page);
    await phoneSize(page);
    await page.getByTestId('zen-button').evaluate((b) => (b as HTMLButtonElement).click());
    await expect(page.getByTestId('zen-button')).toHaveAttribute('aria-pressed', 'true');
    const b = (await page.getByTestId('np-seek').boundingBox())!;
    const y = b.y + b.height / 2;
    const cdp = await page.context().newCDPSession(page);
    try {
      // A finger down on the seek bar, dragging slowly for 5 s (CDP touches, as on a phone).
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width * 0.3, y }] });
      const t0 = Date.now();
      let moves = 0;
      while (Date.now() - t0 < 5000) {
        moves++;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width * (0.3 + 0.002 * moves), y }] });
        await page.waitForTimeout(200);
        expect(await shellHidden(page), `held ${((Date.now() - t0) / 1000).toFixed(1)} s: still shown`).toBe(false);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach().catch(() => {});
    }
    const lifted = Date.now();
    await page.waitForTimeout(2000);
    expect(await shellHidden(page), '2 s after the finger lifts: still shown').toBe(false);
    await expectShellHidden(page, 'about 3 s after the finger lifts it hides', 3000);
    test.info().annotations.push({ type: 'hid after the lift', description: `${Date.now() - lifted} ms` });
    expect(dialogs).toEqual([]);
  });
});
