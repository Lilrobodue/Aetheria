import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  crash,
  libraryRow,
  libraryRowButton,
  libraryState,
  openLibraryTab,
  openSeededNewLayout,
  phoneSize,
  renders,
  resetRenders,
  rowMenu,
  sheet,
  tab,
  tapAt,
  undoToast,
  PHONE_VIEWPORT,
} from './helpers';

// v16.0, the queue, Stage B (spec §5.6): the new layout's ways in and the Up next sheet. The row menu's Play next and
// Add to queue with their toasts and the Library's marks; the sheet (queued, then the play order's own, the end line;
// the empty card); reorder by drag (mouse, touch) and keyboard, the row's inline actions, Clear with Undo; the no-crystal
// note; Now Playing's Up next line and the desktop transport's button; renders and cost; accessibility; the region's
// crash drill. Synthetic tones (tone-0001 …, openSeededNewLayout). Device-ready: taps by tapAt with every result polled
// (on the phone a CDP tap's click lands after tapAt returns), touch drags over CDP.

const name = (k: number) => `tone-${String(k).padStart(4, '0')}`;
const qstate = (page: Page) => page.evaluate(() => (window as any).__aetheriaQueue.state());
const waitingNames = async (page: Page) => (await qstate(page)).waitingNames as string[];

async function openQueueApp(page: Page, n: number, o: Parameters<typeof openSeededNewLayout>[2] = {}): Promise<string[]> {
  const dialogs = await openSeededNewLayout(page, n, o);
  await page.waitForFunction(() => typeof (window as any).__aetheriaQueue?.state === 'function', null, { timeout: 10_000 });
  return dialogs;
}

/** A finger tap on an element's centre (tapAt: Playwright's touchscreen here, CDP touches on the phone). */
async function tap(page: Page, target: Locator): Promise<void> {
  // Centred (a DOM scroll): on the phone the toasts sit over the bottom of the list.
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const b = (await target.boundingBox())!;
  await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
}

/** Play a Library row (the tab is opened if needed) and wait until it plays. */
async function playRow(page: Page, k: number): Promise<void> {
  if (!(await page.getByTestId('tab-library').isVisible().catch(() => false))) await openLibraryTab(page);
  await libraryRowButton(page, name(k)).click();
  await expect.poll(async () => { const s = await libraryState(page); return s.current === name(k) && s.playing && (s.t ?? 0) > 0.2; }, { message: `${name(k)} plays`, timeout: 20_000 }).toBe(true);
}

/** Play next / Add to queue through the dev hook, as a tap (the sheet's tests start from a queue). */
async function queue(page: Page, ks: number[], mode: 'next' | 'queue'): Promise<void> {
  for (const k of ks) {
    await page.evaluate(({ n, mode }) => {
      const s = (window as any).__aetheriaLibrary.state();
      const id = s.libraryIds[s.libraryNames.indexOf(n)];
      const b = document.createElement('button');
      b.addEventListener('click', () => (window as any).__aetheriaQueue.add([id], mode));
      document.body.appendChild(b);
      b.click();
      b.remove();
    }, { n: name(k), mode });
  }
}

const queueSheet = (page: Page) => sheet(page, 'Up next');
const queuedTitles = (page: Page) => page.getByTestId('queue-row').locator('[data-row-title]').allTextContents();
const nextTitles = (page: Page) => page.getByTestId('queue-next-row').locator('[data-row-title]').allTextContents();
const handle = (page: Page, i: number) => page.getByTestId('queue-handle').nth(i);

/** Open the Up next sheet: Now Playing's line on the phone, the transport's button on the desktop. */
async function openQueueSheet(page: Page): Promise<void> {
  const line = page.getByTestId('np-upnext');
  if (await page.getByTestId('desktop-queue').isVisible().catch(() => false)) await page.getByTestId('desktop-queue').click();
  else {
    if (!(await line.isVisible().catch(() => false))) await tab(page, 'now');
    await line.click();
  }
  await expect(queueSheet(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  if (ON_DEVICE) await page.setViewportSize({ width: 1280, height: 800 });
});

// ---------------------------------------------------------------------------------------------------------------
// S1. The row menu's Play next and Add to queue, by finger: the lines, the toasts, the marks.
// ---------------------------------------------------------------------------------------------------------------
test.describe('S1 (phone)', () => {
  test.use({ viewport: PHONE_VIEWPORT, hasTouch: true });
  test('S1. by finger: Play next and Add to queue from a row’s ⋯; their lines, the toasts, the rows’ marks; still “Playing from your library” @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await phoneSize(page);
    const dialogs = await openQueueApp(page, 30);
    await playRow(page, 1);
    // The lines with nothing queued.
    await tap(page, rowMenu(page, name(5)));
    const menu = page.getByRole('dialog', { name: name(5), exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('library-menu-next')).toContainText('Right after the track that’s playing');
    await expect(menu.getByTestId('library-menu-queue')).toContainText('Right after the track that’s playing');
    await expect(menu.getByRole('button')).toHaveText([/Play from here/, /Play next/, /Add to queue/, /Add to playlist…/, /Track info/, /Export with layers…/, /Delete from library…/, /Cancel/]); // v16.5: Export with layers… // v16.1: Add to playlist…
    await tap(page, menu.getByTestId('library-menu-next'));
    await expect(menu).toHaveCount(0);
    await expect(undoToast(page)).toContainText('Playing next: tone-0005.');
    await expect(libraryRow(page, name(5)).getByTestId('library-row-mark')).toHaveText('Queued · 1');
    await expect.poll(() => waitingNames(page)).toEqual([name(5)]);
    // Add to queue: after it; the toast says its place.
    await tap(page, rowMenu(page, name(7)));
    await expect(page.getByRole('dialog', { name: name(7), exact: true }).getByTestId('library-menu-queue')).toContainText('After the track waiting in your queue');
    await tap(page, page.getByRole('dialog', { name: name(7), exact: true }).getByTestId('library-menu-queue'));
    await expect(undoToast(page)).toContainText('Added to your queue: tone-0007 is 2nd.');
    await expect(libraryRow(page, name(7)).getByTestId('library-row-mark')).toHaveText('Queued · 2');
    await expect.poll(() => waitingNames(page)).toEqual([name(5), name(7)]);
    await tap(page, rowMenu(page, name(9)));
    await expect(page.getByRole('dialog', { name: name(9), exact: true }).getByTestId('library-menu-queue')).toContainText('After the 2 tracks waiting in your queue');
    await page.keyboard.press('Escape');
    // The tab stayed, and the library is still what plays.
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await expect(page.getByTestId('library-summary')).toContainText('Playing from your library');
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S2. The sheet's list: queued in order, then 50 of the library, the end line; nothing queued: the card.
// ---------------------------------------------------------------------------------------------------------------
test('S2. the sheet: Queued · 3 in order, then Next from Library (50), the end line; Clear: the empty card and its subtitle', async ({ page }) => {
  test.setTimeout(150_000);
  await openQueueApp(page, 60, { real: 10 });
  await playRow(page, 1);
  await queue(page, [10, 20, 30], 'queue');
  await openQueueSheet(page);
  const s = queueSheet(page);
  await expect(s.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await expect(s).toContainText('3 queued · then your library');
  await expect(s.getByRole('heading', { name: 'Queued · 3' })).toBeVisible();
  await expect.poll(() => queuedTitles(page)).toEqual([name(10), name(20), name(30)]);
  await expect(s.getByRole('heading', { name: 'Next from Library' })).toBeVisible();
  const next = await nextTitles(page);
  expect(next.length).toBe(50);
  expect(next.slice(0, 3)).toEqual([name(2), name(3), name(4)]);
  // 59 of the library's own tracks ahead (tone-0002 … tone-0060), 50 listed.
  await expect(s.getByTestId('queue-end')).toHaveText('Then 9 more tracks from your library (Repeat is off: it stops after the last).');
  await s.getByTestId('queue-clear').click();
  await expect(s.getByTestId('queue-empty')).toContainText('Nothing queued');
  await expect(s.getByTestId('queue-empty')).toContainText('In Library, a track’s ⋯ has Play next and Add to queue.');
  await expect(s).toContainText('Nothing queued · your library plays on');
  expect((await nextTitles(page)).length).toBe(50);
});

// ---------------------------------------------------------------------------------------------------------------
// S3. Drag: the third row to the top (the mouse on the desktop project; a finger on mobile-ua and on the phone).
// ---------------------------------------------------------------------------------------------------------------
test.describe('S3 (phone)', () => {
  test.use({ viewport: PHONE_VIEWPORT, hasTouch: true });
  test('S3. drag the third queued row to the top by its handle: the order and what plays next change, in one App commit @mobile', async ({ page }, info) => {
    test.setTimeout(150_000);
    await phoneSize(page);
    // The classic sound engine: v2's 250 ms loop goes on updating App for a while after a pause.
    await openQueueApp(page, 30, { engine: 'classic' });
    await playRow(page, 1);
    await queue(page, [5, 6, 7], 'queue');
    // Paused: App's 4 Hz clock would otherwise render it during the drag.
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await openQueueSheet(page);
    await expect.poll(() => queuedTitles(page)).toEqual([name(5), name(6), name(7)]);
    // On the phone the queue's own toasts can still close themselves (one App commit) during the drag, so let them end
    // and the app go quiet first: no App commit for 2.5 s, as S9b does.
    await expect(undoToast(page)).toBeHidden({ timeout: 20_000 });
    await page.evaluate(async () => {
      for (let calm = 0, tries = 0; calm < 5 && tries < 40; tries++) {
        (window as any).__aetheriaRenders = {};
        await new Promise((r) => setTimeout(r, 500));
        calm = ((window as any).__aetheriaRenders?.App ?? 0) === 0 ? calm + 1 : 0;
      }
    });
    const from = (await handle(page, 2).boundingBox())!;
    const to = (await handle(page, 0).boundingBox())!;
    const x = from.x + from.width / 2;
    const y0 = from.y + from.height / 2;
    const y1 = to.y + to.height / 2 - 4;
    const touch = info.project.name !== 'desktop' || ON_DEVICE;
    const yAt = (k: number) => y0 + ((y1 - y0) * k) / 12;
    // While the row is lifted and moving, nothing reaches App (only the drop writes).
    const appWhileDragging = async () => (await renders(page)).App ?? 0;
    let duringDrag = -1;
    if (touch) {
      // A finger: touch start, a press, moves, then the drop (CDP touches, as tapAt sends them on the phone).
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
        await page.waitForTimeout(250);
        for (let k = 1; k <= 2; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: yAt(k) }] });
        await expect.poll(() => page.getByTestId('queue-placeholder').count(), { message: 'the row is lifted, its place held' }).toBe(1);
        await resetRenders(page);
        for (let k = 3; k <= 12; k++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: yAt(k) }] });
          await page.waitForTimeout(30);
        }
        await page.waitForTimeout(200);
        duringDrag = await appWhileDragging();
        await resetRenders(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally {
        await cdp.detach().catch(() => {});
      }
    } else {
      await page.mouse.move(x, y0);
      await page.mouse.down();
      await page.waitForTimeout(200);
      await page.mouse.move(x, yAt(2), { steps: 2 });
      await expect(page.getByTestId('queue-placeholder')).toHaveCount(1);
      await resetRenders(page);
      await page.mouse.move(x, (y0 + y1) / 2, { steps: 6 });
      await page.mouse.move(x, y1, { steps: 6 });
      await page.waitForTimeout(200);
      duringDrag = await appWhileDragging();
      await resetRenders(page);
      await page.mouse.up();
    }
    expect(duringDrag, 'App never renders while the row is dragged').toBe(0);
    await expect.poll(() => waitingNames(page), { message: 'the queue reordered' }).toEqual([name(7), name(5), name(6)]);
    await expect.poll(() => queuedTitles(page)).toEqual([name(7), name(5), name(6)]);
    await expect(page.getByTestId('queue-placeholder')).toHaveCount(0);
    const r = await renders(page);
    test.info().annotations.push({ type: 'renders for the drop', description: JSON.stringify(r) });
    // StrictMode renders twice per commit in dev builds: one commit is at most 2.
    expect(r.App ?? 0, 'one App commit for the drop').toBeLessThanOrEqual(2);
    // What plays next followed: the swap, Next, the car all read the order.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('np-upnext-title')).toHaveText(name(7));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S4. Keyboard: lift, move, drop; Escape puts it back; Alt+arrow moves at once.
// ---------------------------------------------------------------------------------------------------------------
test('S4. keyboard: Space, ↑, ↑, Space moves the third to the top, announced, focus kept; Escape puts it back; Alt+↓ moves at once', async ({ page }) => {
  test.setTimeout(150_000);
  await openQueueApp(page, 30);
  await playRow(page, 1);
  await queue(page, [5, 6, 7], 'queue');
  await openQueueSheet(page);
  await expect.poll(() => queuedTitles(page)).toEqual([name(5), name(6), name(7)]);
  const live = page.getByTestId('queue-live');
  await handle(page, 2).focus();
  await page.keyboard.press('Space');
  await expect(live).toHaveText('Moving tone-0007, position 3 of 3');
  await page.keyboard.press('ArrowUp');
  await expect(live).toHaveText('Moving tone-0007, position 2 of 3');
  await page.keyboard.press('ArrowUp');
  await expect(live).toHaveText('Moving tone-0007, position 1 of 3');
  expect(await waitingNames(page), 'nothing written while lifted').toEqual([name(5), name(6), name(7)]);
  await page.keyboard.press('Space');
  await expect(live).toHaveText('Dropped at position 1');
  await expect.poll(() => waitingNames(page)).toEqual([name(7), name(5), name(6)]);
  await expect(handle(page, 0), 'the focus stays on the moved row’s handle').toBeFocused();
  await expect(handle(page, 0)).toHaveAttribute('aria-label', 'Reorder tone-0007, 1 of 3');
  // Escape puts it back, and the sheet stays open.
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(live).toHaveText('tone-0007 back at position 1');
  await expect(queueSheet(page)).toBeVisible();
  expect(await waitingNames(page)).toEqual([name(7), name(5), name(6)]);
  // Alt+↓: one place at once.
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => waitingNames(page)).toEqual([name(5), name(7), name(6)]);
  await expect(page.getByTestId('queue-handle').nth(1)).toBeFocused();
});

test.describe('S4b (phone)', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  test('S4b. on the phone’s modal sheet, Escape puts a lifted row back (keyboard or pointer) and never closes the sheet', async ({ page }) => {
    test.setTimeout(150_000);
    await phoneSize(page);
    await openQueueApp(page, 30);
    await playRow(page, 1);
    await queue(page, [5, 6, 7], 'queue');
    await openQueueSheet(page);
    const dlg = page.getByRole('dialog', { name: 'Up next' });
    await handle(page, 2).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('queue-live')).toHaveText('tone-0007 back at position 3');
    await expect(dlg, 'the sheet stays open').toBeVisible();
    expect(await waitingNames(page)).toEqual([name(5), name(6), name(7)]);
    // A pointer drag, then Escape: put back, the sheet open; a second Escape closes it.
    const b = (await handle(page, 2).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.move(b.x + b.width / 2, b.y - 60, { steps: 6 });
    await expect(page.getByTestId('queue-placeholder')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.getByTestId('queue-placeholder')).toHaveCount(0);
    await expect(dlg, 'the sheet stays open').toBeVisible();
    expect(await waitingNames(page)).toEqual([name(5), name(6), name(7)]);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S5. A queued row's ⋯: its actions inline, each 44 px or more; Move up / Move down at the ends; Play next; Remove.
// ---------------------------------------------------------------------------------------------------------------
test('S5. a row’s ⋯ opens Move up, Move down, Play next and Remove inline (≥ 44 px); the ends disable; each works', async ({ page }) => {
  test.setTimeout(150_000);
  await openQueueApp(page, 30);
  await playRow(page, 1);
  await queue(page, [5, 6, 7], 'queue');
  await openQueueSheet(page);
  const row = (i: number) => page.getByTestId('queue-row').nth(i);
  await row(0).getByTestId('queue-row-menu').click();
  const group = row(0).getByRole('group', { name: 'Options for tone-0005' });
  await expect(group, 'inline, inside its row').toBeVisible();
  await expect(row(0).getByTestId('queue-row-menu')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('dialog'), 'no sheet on the sheet (the desktop panel is a region)').toHaveCount(0);
  for (const b of await group.getByRole('button').all()) {
    const box = (await b.boundingBox())!;
    expect(box.height, 'each action at least 44 px tall').toBeGreaterThanOrEqual(44);
  }
  await expect(group.getByRole('button', { name: 'Move up' })).toBeDisabled();
  await expect(group.getByRole('button', { name: 'Play next' })).toBeDisabled();
  await group.getByRole('button', { name: 'Move down' }).click();
  await expect.poll(() => waitingNames(page)).toEqual([name(6), name(5), name(7)]);
  // The actions stay open on the moved row, the focus on Move down.
  await expect(row(1).getByRole('button', { name: 'Move down' })).toBeFocused();
  await row(1).getByRole('button', { name: 'Move down' }).click();
  await expect.poll(() => waitingNames(page)).toEqual([name(6), name(7), name(5)]);
  await expect(row(2).getByRole('button', { name: 'Move down' })).toBeDisabled();
  await row(2).getByRole('button', { name: 'Play next' }).click();
  await expect.poll(() => waitingNames(page)).toEqual([name(5), name(6), name(7)]);
  await row(1).getByTestId('queue-row-menu').click();
  await row(1).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => waitingNames(page)).toEqual([name(5), name(7)]);
  await expect(undoToast(page)).toContainText('Removed tone-0006 from your queue.');
  await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => waitingNames(page)).toEqual([name(5), name(6), name(7)]);
});

// ---------------------------------------------------------------------------------------------------------------
// S6. Clear, with Undo.
// ---------------------------------------------------------------------------------------------------------------
test('S6. Clear empties the queue (the toast says how many) and its Undo brings them back in order', async ({ page }) => {
  await openQueueApp(page, 30);
  await playRow(page, 1);
  await queue(page, [5, 6, 7], 'queue');
  await openQueueSheet(page);
  await queueSheet(page).getByTestId('queue-clear').click();
  await expect(undoToast(page)).toContainText('Cleared 3 queued tracks.');
  await expect(queueSheet(page).getByTestId('queue-empty')).toBeVisible();
  expect(await waitingNames(page)).toEqual([]);
  await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => queuedTitles(page)).toEqual([name(5), name(6), name(7)]);
});

// ---------------------------------------------------------------------------------------------------------------
// S7. A track with no crystal: the note in its row and in its toast.
// ---------------------------------------------------------------------------------------------------------------
test('S7. a track with no crystal: its toast and its queued row say it may stop there on a locked phone', async ({ page }) => {
  await openQueueApp(page, 30, { patch: [{ index: 9, crystal: null }] });
  await playRow(page, 1);
  await rowMenu(page, name(10)).click();
  await page.getByTestId('library-menu-next').click();
  await expect(undoToast(page)).toContainText('Playing next: tone-0010. It has no crystal yet, so on a locked phone the music may stop there.');
  await openQueueSheet(page);
  const facts = page.getByTestId('queue-row').first().locator('[data-row-facts]');
  await expect(facts).toHaveText('No crystal yet · may stop here on a locked phone');
  await expect(facts.locator('span')).toHaveClass(/text-status-alert/);
});

// ---------------------------------------------------------------------------------------------------------------
// S8. The ways in: Now Playing's line (phone), the transport's button (desktop).
// ---------------------------------------------------------------------------------------------------------------
test.describe('S8 (phone)', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  test('S8a. Now Playing’s Up next line names the next track, queued or not, with the count; a tap opens the sheet; focus returns to it', async ({ page }) => {
    test.setTimeout(120_000);
    await phoneSize(page);
    await openQueueApp(page, 30);
    await playRow(page, 1);
    await tab(page, 'now');
    const line = page.getByTestId('np-upnext');
    await expect(page.getByTestId('np-upnext-title')).toHaveText(name(2));
    await expect(line).toHaveAccessibleName('Up next: tone-0002. Open the queue');
    await queue(page, [10], 'next');
    await expect(page.getByTestId('np-upnext-title')).toHaveText(name(10));
    await expect(line).toContainText('1 queued');
    await expect(line).toHaveAccessibleName('Up next: tone-0010, 1 queued. Open the queue');
    await line.click();
    await expect(page.getByRole('dialog', { name: 'Up next' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Up next' })).toHaveCount(0);
    await expect(line, 'focus back on the line').toBeFocused();
  });
});

test('S8b. the desktop transport’s Up next button opens the queue in the panel; the transport stays live; Escape closes it', async ({ page }) => {
  test.setTimeout(120_000);
  await openQueueApp(page, 30);
  await playRow(page, 1);
  await queue(page, [10], 'next');
  const button = page.getByTestId('desktop-queue');
  await expect(button).toHaveAccessibleName('Up next, 1 queued');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(page.getByRole('region', { name: 'Up next' })).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  // The transport works with the panel open: Next plays the queued track.
  await page.getByTestId('desktop-transport').getByRole('button', { name: 'Next track', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).current).toBe(name(10));
  await expect(page.getByRole('region', { name: 'Up next' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Up next' })).toHaveCount(0);
  await button.click();
  await expect(page.getByRole('region', { name: 'Up next' })).toBeVisible();
  await button.click();
  await expect(page.getByRole('region', { name: 'Up next' }), 'a second press closes it').toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------
// S9. Renders and cost.
// ---------------------------------------------------------------------------------------------------------------
test.describe('S9 (phone)', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  test('S9a. 3 s of playback with the sheet open re-render nothing in it', async ({ page }) => {
    test.setTimeout(120_000);
    await phoneSize(page);
    await openQueueApp(page, 30);
    await playRow(page, 1);
    await queue(page, [5, 6, 7], 'queue');
    await openQueueSheet(page);
    await page.waitForTimeout(2500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const r = await renders(page);
    test.info().annotations.push({ type: 'renders with the sheet open, 3 s', description: JSON.stringify(r) });
    expect((await libraryState(page)).playing).toBe(true);
    for (const v of ['QueueSheet', 'QueueBody', 'QueueList', 'QueueRow', 'NextRow', 'NowPlaying']) expect.soft(r[v] ?? 0, `${v} renders`).toBe(0);
  });
});

test('S9b. a 1,000-track play order with 50 queued: a drop is one App commit and at most 16 ms of script', async ({ page }) => {
  test.setTimeout(240_000);
  await openQueueApp(page, 1000, { real: 6, engine: 'classic' }); // classic: no v2 loop updating App while paused
  await playRow(page, 1);
  await page.getByTestId('desktop-play').click(); // paused: no clock
  await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
  await page.evaluate(() => {
    const s = (window as any).__aetheriaLibrary.state();
    const b = document.createElement('button');
    b.addEventListener('click', () => {
      for (let k = 100; k < 150; k++) (window as any).__aetheriaQueue.add([s.libraryIds[k]], 'queue');
    });
    document.body.appendChild(b);
    b.click();
    b.remove();
  });
  await expect.poll(async () => (await waitingNames(page)).length, { timeout: 20_000 }).toBe(50);
  await openQueueSheet(page);
  await expect(page.getByTestId('queue-row')).toHaveCount(50);
  // The drop of a drag (the third row to the top), timed in the page from the pointer's release to the commit.
  const out = await page.evaluate(async () => {
    // First the app goes quiet: no App commit for 2.5 s, so the drop's window holds the drop's commits only. (The
    // restore ends its save guard 2 s after the library came back, one App commit, which this quick test can meet at
    // the drop: the full suite did once.) The App renders of each half second waited are kept.
    const quiet: number[] = [];
    for (let calm = 0; calm < 5 && quiet.length < 40; ) {
      (window as any).__aetheriaRenders = {};
      await new Promise((r) => setTimeout(r, 500));
      const n = (window as any).__aetheriaRenders?.App ?? 0;
      quiet.push(n);
      calm = n === 0 ? calm + 1 : 0;
    }
    const h = document.querySelectorAll<HTMLElement>('[data-testid="queue-handle"]');
    const third = h[2];
    const first = h[0];
    const r3 = third.getBoundingClientRect();
    const r1 = first.getBoundingClientRect();
    const x = r3.left + r3.width / 2;
    const at = (type: string, y: number) => third.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
    const y0 = r3.top + r3.height / 2;
    at('pointerdown', y0);
    await new Promise((r) => setTimeout(r, 200));
    at('pointermove', y0 - 20);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    at('pointermove', r1.top + r1.height / 2 - 4);
    await new Promise((r) => setTimeout(r, 100));
    (window as any).__aetheriaRenders = {};
    const t0 = performance.now();
    at('pointerup', r1.top + r1.height / 2 - 4);
    // React renders a tap's update in a microtask after the event: these run after its render, commit and effects.
    await new Promise<void>((r) => queueMicrotask(r));
    await Promise.resolve();
    const t1 = performance.now();
    await new Promise((r) => setTimeout(r, 300));
    return { ms: t1 - t0, renders: { ...((window as any).__aetheriaRenders ?? {}) }, quiet };
  });
  test.info().annotations.push({ type: 'the drop at 1,000 + 50', description: JSON.stringify(out) });
  await expect.poll(async () => (await waitingNames(page))[0]).toBe(name(103));
  expect(out.renders.App ?? 0, 'one App commit (StrictMode renders it twice)').toBeLessThanOrEqual(2);
  // The 16 ms budget is the desktop's (a dev build, StrictMode rendering twice); on the phone it is recorded only.
  if (!ON_DEVICE) expect(out.ms, 'the drop’s script, its render included').toBeLessThanOrEqual(16);
});

// ---------------------------------------------------------------------------------------------------------------
// S10. Accessibility.
// ---------------------------------------------------------------------------------------------------------------
test.describe('S10 (phone)', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  test('S10. names, lists, 44 × 44 targets (the handle 44 × 60), the sheet’s focus trap and focus return', async ({ page }) => {
    test.setTimeout(120_000);
    await phoneSize(page);
    await openQueueApp(page, 30);
    await playRow(page, 1);
    await queue(page, [5, 6, 7], 'queue');
    await tab(page, 'now');
    await openQueueSheet(page);
    const dlg = page.getByRole('dialog', { name: 'Up next' });
    await expect(handle(page, 0)).toHaveAccessibleName('Reorder tone-0005, 1 of 3');
    await expect(handle(page, 0)).toHaveAttribute('aria-roledescription', 'drag handle');
    await expect(dlg.getByRole('list').first().getByRole('listitem')).toHaveCount(3);
    const hb = (await handle(page, 0).boundingBox())!;
    expect([Math.round(hb.width), Math.round(hb.height)], 'the handle').toEqual([44, 60]);
    const small = await dlg.evaluate((root) =>
      Array.from(root.querySelectorAll('button')).filter((b) => b.offsetParent !== null).map((b) => { const r = b.getBoundingClientRect(); return { n: b.getAttribute('aria-label') || b.textContent?.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.w < 44 || b.h < 44));
    expect(small, 'every button 44 × 44 or more').toEqual([]);
    // The focus stays in the sheet (Tab from the last control wraps), and returns to the line when it closes.
    for (let k = 0; k < 20; k++) await page.keyboard.press('Tab');
    expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('np-upnext')).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S11. The crash drill: the queue region.
// ---------------------------------------------------------------------------------------------------------------
test('S11. the queue region crashes: the music plays on, the sheet keeps its Close, Reload panel brings it back', async ({ page }) => {
  test.setTimeout(120_000);
  await openQueueApp(page, 30);
  await playRow(page, 1);
  await queue(page, [5], 'queue');
  await openQueueSheet(page);
  await crash(page, 'queue');
  const panel = page.getByRole('region', { name: 'Up next' });
  await expect(panel).toContainText('This sheet hit a problem.');
  await expect(page.getByTestId('queue-body')).toHaveCount(0);
  const t0 = (await libraryState(page)).t ?? 0;
  await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > t0 + 0.5; }, { message: 'the music plays on' }).toBe(true);
  await panel.getByRole('button', { name: 'Reload panel' }).click();
  await expect(page.getByTestId('queue-body')).toBeVisible();
  await expect.poll(() => queuedTitles(page)).toEqual([name(5)]);
});

// ---------------------------------------------------------------------------------------------------------------
// S12. The Library's marks follow the queue.
// ---------------------------------------------------------------------------------------------------------------
test('S12. the Library marks follow: a played queued track loses its mark, the rest renumber; a reorder renumbers', async ({ page }) => {
  test.setTimeout(120_000);
  await openQueueApp(page, 30);
  await playRow(page, 1);
  await queue(page, [5, 7], 'queue');
  const mark = (k: number) => libraryRow(page, name(k)).getByTestId('library-row-mark');
  await expect(mark(5)).toHaveText('Queued · 1');
  await expect(mark(7)).toHaveText('Queued · 2');
  await page.getByTestId('desktop-transport').getByRole('button', { name: 'Next track', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).current).toBe(name(5));
  await expect(mark(5)).toHaveCount(0);
  await expect(mark(7)).toHaveText('Queued · 1');
  await queue(page, [9], 'queue');
  await expect(mark(9)).toHaveText('Queued · 2');
  const e = await page.evaluate(() => { const q = (window as any).__aetheriaQueue.state(); const s = (window as any).__aetheriaLibrary.state(); const i = q.waiting[1]; return { index: i, id: s.ids[i] }; });
  await page.evaluate((e) => { const b = document.createElement('button'); b.addEventListener('click', () => (window as any).__aetheriaQueue.edit({ move: { ...e, to: 0 } })); document.body.appendChild(b); b.click(); b.remove(); }, e);
  await expect(mark(9)).toHaveText('Queued · 1');
  await expect(mark(7)).toHaveText('Queued · 2');
  await expect(mark(3), 'a track not queued has no mark').toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------
// S13-S17 (the review's fixes): a lift outlives the list changing under it; every queued run is listed; the toast when
// nothing is loaded; the end under shuffle.
// ---------------------------------------------------------------------------------------------------------------
/** Wait until `k` plays with less than `left` seconds to go (tones of 9 s). */
async function nearEnd(page: Page, k: number, left: number): Promise<void> {
  await expect.poll(async () => { const s = await libraryState(page); return s.current === name(k) && s.playing && (s.t ?? 0) > 9 - left; }, { message: `${name(k)} nearly done`, timeout: 20_000 }).toBe(true);
}
const playing = async (page: Page) => (await libraryState(page)).current;

test('S13. a drag while the track runs out: the head starts playing under the lift and the drop moves the lifted row one place up among its neighbours; a lifted row that starts playing ends the lift, nothing moves', async ({ page }) => {
  // Review probe B: the drag held the row's place at the lift; the head left the list under it, and the drop moved the
  // row that had taken that place.
  test.setTimeout(150_000);
  await openQueueApp(page, 14, { real: 14, seconds: 9, engine: 'classic' });
  await playRow(page, 1);
  await queue(page, [10, 11, 12, 13], 'queue');
  await openQueueSheet(page);
  await expect.poll(() => queuedTitles(page)).toEqual([10, 11, 12, 13].map(name));
  const b0 = (await handle(page, 0).boundingBox())!;
  const b1 = (await handle(page, 1).boundingBox())!;
  const rowH = b1.y - b0.y;
  const liftAt = async (i: number) => {
    const b = (await handle(page, i).boundingBox())!;
    const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x, p.y - 8, { steps: 2 });
    await expect(page.getByTestId('queue-placeholder'), 'lifted').toHaveCount(1);
    return p;
  };
  await nearEnd(page, 1, 2.5); // the margin a phone needs (its polls are slower)
  const p = await liftAt(2); // tone-0012
  await expect.poll(() => playing(page), { timeout: 10_000 }).toBe(name(10));
  await expect.poll(() => queuedTitles(page)).toEqual([11, 12, 13].map(name));
  await expect(page.getByTestId('queue-placeholder'), 'still lifted').toHaveCount(1);
  // One row up from where it was lifted: above its neighbour tone-0011.
  await page.mouse.move(p.x, p.y - 8 - rowH, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => waitingNames(page), { message: 'the lifted row moved, one place up' }).toEqual([12, 11, 13].map(name));
  await expect.poll(() => queuedTitles(page)).toEqual([12, 11, 13].map(name));
  // Lifted, and then it starts playing: the lift ends, nothing moves.
  await nearEnd(page, 10, 2.5);
  const q = await liftAt(0); // tone-0012, next to play
  await expect.poll(() => playing(page), { timeout: 10_000 }).toBe(name(12));
  await expect(page.getByTestId('queue-placeholder'), 'the lift ended').toHaveCount(0);
  await expect(page.getByTestId('queue-live')).toHaveText('tone-0012 is no longer queued, so it was not moved');
  await page.mouse.move(q.x, q.y + rowH, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await waitingNames(page)).toEqual([11, 13].map(name));
});

test('S14. keyboard: a row lifted while the track runs out keeps its move among its neighbours (the head starts playing under it); a lifted row that starts playing ends the lift, the focus on the heading', async ({ page }) => {
  test.setTimeout(150_000);
  await openQueueApp(page, 14, { real: 14, seconds: 9, engine: 'classic' });
  await playRow(page, 1);
  await queue(page, [10, 11, 12, 13], 'queue');
  await openQueueSheet(page);
  await expect.poll(() => queuedTitles(page)).toEqual([10, 11, 12, 13].map(name));
  const live = page.getByTestId('queue-live');
  await nearEnd(page, 1, 2.5);
  await handle(page, 2).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await expect(live).toHaveText('Moving tone-0012, position 2 of 4');
  await expect.poll(() => playing(page), { timeout: 10_000 }).toBe(name(10));
  await expect.poll(() => queuedTitles(page)).toEqual([11, 12, 13].map(name));
  await expect(handle(page, 1), 'the lifted row keeps the focus').toBeFocused();
  await page.keyboard.press('Space');
  await expect.poll(() => waitingNames(page), { message: 'one place up, as moved' }).toEqual([12, 11, 13].map(name));
  await expect(live).toHaveText('Dropped at position 1');
  // Lifted, and then it starts playing: the lift ends; the focus goes to the heading, and the keys move nothing.
  await nearEnd(page, 10, 2.5);
  await handle(page, 0).focus();
  await page.keyboard.press('Space');
  await expect(live).toHaveText('Moving tone-0012, position 1 of 3');
  await expect.poll(() => playing(page), { timeout: 10_000 }).toBe(name(12));
  await expect(live).toHaveText('tone-0012 is no longer queued, so it was not moved');
  await expect(page.locator('#queue-queued-heading')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(await waitingNames(page)).toEqual([11, 13].map(name));
});

test('S15. after Previous then Play next the queue comes in two runs: both listed where they play, Next from Library between; their rows editable across the runs', async ({ page }) => {
  // Review probe C: the sheet listed the first queued run only; the second could not be seen, moved or removed.
  test.setTimeout(150_000);
  await openQueueApp(page, 30);
  await playRow(page, 1);
  const transport = page.getByTestId('desktop-transport');
  await transport.getByRole('button', { name: 'Next track', exact: true }).click();
  await expect.poll(() => playing(page)).toBe(name(2));
  await queue(page, [10], 'queue');
  await transport.getByRole('button', { name: 'Previous track', exact: true }).click();
  await expect.poll(() => playing(page)).toBe(name(1));
  await queue(page, [12], 'next');
  await expect.poll(() => waitingNames(page)).toEqual([name(12), name(10)]);
  expect((await libraryState(page)).names.slice(0, 5)).toEqual([1, 12, 2, 10, 3].map(name));
  await openQueueSheet(page);
  const s = queueSheet(page);
  await expect.poll(() => queuedTitles(page), { message: 'every queued track listed' }).toEqual([name(12), name(10)]);
  await expect.poll(() => s.locator('section h3').allTextContents(), { message: 'in the order of play' }).toEqual(['Queued · 2', 'Next from Library', 'Queued', 'Next from Library']);
  expect((await nextTitles(page)).slice(0, 2)).toEqual([name(2), name(3)]);
  await expect(handle(page, 0)).toHaveAccessibleName('Reorder tone-0012, 1 of 2');
  await expect(handle(page, 1)).toHaveAccessibleName('Reorder tone-0010, 2 of 2');
  // The second run's row: Move up crosses into the first run.
  const row = (i: number) => page.getByTestId('queue-row').nth(i);
  await row(1).getByTestId('queue-row-menu').click();
  await expect(row(1).getByRole('button', { name: 'Move down' })).toBeDisabled();
  await row(1).getByRole('button', { name: 'Move up' }).click();
  await expect.poll(() => waitingNames(page)).toEqual([name(10), name(12)]);
  await expect.poll(() => queuedTitles(page)).toEqual([name(10), name(12)]);
  // Remove, in the second run.
  await row(1).getByTestId('queue-row-menu').click();
  await row(1).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => waitingNames(page)).toEqual([name(10)]);
  await transport.getByRole('button', { name: 'Next track', exact: true }).click();
  await expect.poll(() => playing(page)).toBe(name(10));
});

test('S16. nothing loaded: the first track queued is told Play starts with it; one queued after it gets its place; Play starts with the first', async ({ page }) => {
  await openQueueApp(page, 30);
  expect((await libraryState(page)).current, 'nothing loaded').toBe(null);
  await openLibraryTab(page);
  await rowMenu(page, name(5)).click();
  await page.getByTestId('library-menu-queue').click();
  await expect(undoToast(page)).toContainText('Queued: tone-0005. Play starts with it.');
  await rowMenu(page, name(6)).click();
  await page.getByTestId('library-menu-queue').click();
  await expect(undoToast(page)).toContainText('Added to your queue: tone-0006 is 2nd.');
  await expect(undoToast(page)).not.toContainText('Play starts with it');
  await expect.poll(() => waitingNames(page)).toEqual([name(5), name(6)]);
  await page.getByTestId('desktop-play').click();
  await expect.poll(() => playing(page), { message: 'Play starts with the first queued track' }).toBe(name(5));
});

test.describe('S17 (phone)', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  test('S17. under shuffle the music never stops at the end (Repeat off): Now Playing’s line and the sheet’s end line say a new shuffle follows', async ({ page }) => {
    test.setTimeout(120_000);
    await phoneSize(page);
    await openQueueApp(page, 3);
    await playRow(page, 1);
    await tab(page, 'now');
    const now = page.getByTestId('view-now');
    await now.getByRole('button', { name: 'Shuffle', exact: true }).click();
    await expect.poll(async () => { const s = await libraryState(page); return s.shuffle && s.shuffled.length === 3; }).toBe(true);
    for (let k = 0; k < 3 && (await libraryState(page)).shufflePos < 2; k++) {
      const pos = (await libraryState(page)).shufflePos;
      await now.getByRole('button', { name: 'Next track', exact: true }).click();
      await expect.poll(async () => (await libraryState(page)).shufflePos).toBe(pos + 1);
    }
    await expect(now.getByRole('button', { name: 'Repeat', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('np-upnext-title')).toHaveText('A new shuffle');
    await expect(page.getByTestId('np-upnext')).toHaveAccessibleName('Up next: a new shuffle. Open the queue');
    await page.getByTestId('np-upnext').click();
    await expect(queueSheet(page).getByTestId('queue-end')).toHaveText('Then a new shuffle.');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S18-S20 (the re-review's fixes): a run that leaves the sheet mid-drag stops its auto-scroll; the focus of a run that
// remounts goes to its row where it is now; an edit that missed its track says so.
// ---------------------------------------------------------------------------------------------------------------
test('S18. a drag held at the list’s bottom edge when its run leaves the sheet (the row starts playing): the auto-scroll stops with it', async ({ page }) => {
  // Re-review probe F: the run's list unmounted under the drag and its frames went on scrolling the sheet for ever.
  test.setTimeout(150_000);
  await openQueueApp(page, 30, { real: 30, seconds: 9, engine: 'classic' });
  await playRow(page, 1);
  await queue(page, [20], 'queue');
  await openQueueSheet(page);
  await expect.poll(() => queuedTitles(page)).toEqual([name(20)]);
  const box = await page.evaluate(() => {
    let e: HTMLElement | null = document.querySelector('[data-testid="queue-body"]');
    while (e && !(e.scrollHeight > e.clientHeight && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement;
    if (!e) return null;
    e.setAttribute('data-test-scroller', '1');
    const r = e.getBoundingClientRect();
    return { bottom: r.bottom };
  });
  expect(box, 'the sheet scrolls').not.toBeNull();
  await nearEnd(page, 1, 2.5);
  const b = (await handle(page, 0).boundingBox())!;
  const x = b.x + b.width / 2;
  await page.mouse.move(x, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box!.bottom - 20, { steps: 8 });
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('[data-test-scroller]')!.scrollTop), { message: 'the edge scrolls the list' }).toBeGreaterThan(0);
  await expect.poll(() => playing(page), { timeout: 10_000 }).toBe(name(20));
  await expect(page.getByTestId('queue-row')).toHaveCount(0);
  await page.mouse.up();
  const after = await page.evaluate(async () => {
    const e = document.querySelector<HTMLElement>('[data-test-scroller]')!;
    e.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 600));
    return e.scrollTop;
  });
  expect(after, 'nothing scrolls it any more').toBe(0);
});

test('S19. a keyboard-lifted row whose run remounts (another write removed the run before it) keeps the focus, on its handle where it is now; one moved to another run is put back there, named', async ({ page }) => {
  test.setTimeout(150_000);
  await openQueueApp(page, 30);
  await playRow(page, 1);
  const transport = page.getByTestId('desktop-transport');
  await transport.getByRole('button', { name: 'Next track', exact: true }).click();
  await expect.poll(() => playing(page)).toBe(name(2));
  await queue(page, [10, 11], 'queue');
  await transport.getByRole('button', { name: 'Previous track', exact: true }).click();
  await expect.poll(() => playing(page)).toBe(name(1));
  await queue(page, [12], 'next');
  await openQueueSheet(page);
  await expect.poll(() => queuedTitles(page)).toEqual([name(12), name(10), name(11)]);
  await expect.poll(() => queueSheet(page).locator('section h3').allTextContents()).toEqual(['Queued · 3', 'Next from Library', 'Queued', 'Next from Library']);
  const live = page.getByTestId('queue-live');
  // (1) Lift tone-0011 (the second run); another write moves it to the first run (to the queue's top): put back there,
  // named, the focus on its handle there.
  await handle(page, 2).focus();
  await page.keyboard.press('Space');
  await expect(live).toHaveText('Moving tone-0011, position 3 of 3');
  const entry = async (k: number) => { const s = await libraryState(page); const q = await qstate(page); const i = (q.waiting as number[]).find((j) => s.names[j] === name(k))!; return { index: i, id: s.ids[i] }; };
  const e11 = await entry(11);
  await page.evaluate((e) => { const b = document.createElement('button'); b.addEventListener('click', () => (window as any).__aetheriaQueue.edit({ move: { ...e, to: 0 } })); document.body.appendChild(b); b.click(); b.remove(); }, e11);
  await expect.poll(() => queuedTitles(page)).toEqual([name(11), name(12), name(10)]);
  await expect(live).toHaveText('tone-0011 back at position 1');
  await expect(handle(page, 0), 'the focus follows it to its handle in the first run').toBeFocused();
  // (2) Lift tone-0010 (the second run); another write removes the first run's tracks: the second run becomes the first
  // (its list remounts), and the focus stays on tone-0010's handle, never on the page.
  await handle(page, 2).focus();
  await page.keyboard.press('Space');
  await expect(live).toHaveText('Moving tone-0010, position 3 of 3');
  const e12 = await entry(12);
  const e11b = await entry(11);
  await page.evaluate(([a, b]) => { const t = document.createElement('button'); t.addEventListener('click', () => { (window as any).__aetheriaQueue.edit({ remove: a }); (window as any).__aetheriaQueue.edit({ remove: b }); }); document.body.appendChild(t); t.click(); t.remove(); }, [e12, e11b]);
  await expect.poll(() => queuedTitles(page)).toEqual([name(10)]);
  await expect.poll(() => queueSheet(page).locator('section h3').allTextContents()).toEqual(['Next from Library', 'Queued · 1', 'Next from Library']);
  await expect(handle(page, 0), 'the focus on tone-0010’s handle where it is now').toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('S20. an edit that finds its track moved by another write (two in one tap: the second has the index from before the first) is not dropped silently', async ({ page }) => {
  await openQueueApp(page, 30);
  await playRow(page, 1);
  await queue(page, [5, 6, 7], 'queue');
  await openQueueSheet(page);
  await expect.poll(() => queuedTitles(page)).toEqual([name(5), name(6), name(7)]);
  const ids = await page.evaluate(() => { const s = (window as any).__aetheriaLibrary.state(); const q = (window as any).__aetheriaQueue.state(); return (q.waiting as number[]).map((i) => ({ index: i, id: s.ids[i] })); });
  // Remove tone-0005, then move tone-0007 by its index from before the removal (it is one place lower now).
  await page.evaluate((ids) => { const b = document.createElement('button'); b.addEventListener('click', () => { const q = (window as any).__aetheriaQueue; q.edit({ remove: ids[0] }); q.edit({ move: { ...ids[2], to: 0 } }); }); document.body.appendChild(b); b.click(); b.remove(); }, ids);
  await expect.poll(() => waitingNames(page)).toEqual([name(6), name(7)]);
  await expect(page.getByRole('status').getByText("The queue changed just then, so the track wasn't moved. Try it again.")).toBeVisible();
  // And a Remove that missed its track.
  const ids2 = await page.evaluate(() => { const s = (window as any).__aetheriaLibrary.state(); const q = (window as any).__aetheriaQueue.state(); return (q.waiting as number[]).map((i) => ({ index: i, id: s.ids[i] })); });
  await page.evaluate((ids) => { const b = document.createElement('button'); b.addEventListener('click', () => { const q = (window as any).__aetheriaQueue; q.edit({ remove: ids[0] }); q.edit({ remove: { index: ids[1].index + 5, id: ids[1].id } }); }); document.body.appendChild(b); b.click(); b.remove(); }, ids2);
  await expect.poll(() => waitingNames(page)).toEqual([name(7)]);
  await expect(page.getByRole('status').getByText('The queue changed just then, so nothing was removed. Try it again.')).toBeVisible();
});
