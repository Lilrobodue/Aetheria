import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE, watchNativeDialogs } from './fixtures';
import {
  PHONE_VIEWPORT,
  LAYOUT_KEY,
  addFiles,
  closeSafetyPanel,
  crash,
  expectShellHidden,
  holdRestore,
  libraryState,
  newShell,
  openNewLayout,
  openSeededNewLayout,
  optInNewLayout,
  peekClassicLibrary,
  phoneSize,
  seedLibraryRecords,
  sheet,
  tab,
  toneWav,
  zenToggle,
} from './helpers';
import { DISCLAIMER_KEY, TUTORIAL_KEY, inAxTree, openMorePage, stored } from './moreKit';

// v16.8, the new layout becomes the default (spec §3, §5.3; decisions.md: 1 B, 2 A, 3 A, 4 A, 5 A).
//
// Who opens which layout at the first v16.8 launch (shellModel.layoutAtLaunch, Node-checked in shellModel.check.ts):
//   - a new install (no prior use): the new layout, then its 4-card tour; marked 'fresh' (never the card);
//   - an existing user (prior use: a statement acceptance or the tutorial's key) who never chose: the new layout and
//     the moved-over card (marked 'due' until one of its buttons is tapped);
//   - a saved "classic" from before v16.8 (decision 1 B): moved once, the same card, the saved value removed; a later
//     "Use the classic layout" tap is a v16.8 choice and holds (the mark says the move is done);
//   - a saved "new": new, no card ('seen'); junk: as "never chose"; ?layout=: as asked, no card; storage that throws:
//     new, no card, the statement every launch.
// The card: "Aetheria now opens in the new layout. …" with Show the tour, Use the classic layout and X, first in the
// notices; never over the statement, the tour, the phone's Car screen or a classic peek.
// The statement is a real modal in both layouts: on <body>, #root inert, Tab trapped, Escape does nothing.
// Every test here sees the real default: no fixture seed.

test.use({ layoutSeed: null });

const NOTICE_KEY = 'aetheria.layoutNotice.v1';
const VERSION = '2026-10-21';
const CARD_TEXT = 'Aetheria now opens in the new layout. For this version, the classic layout is still in More › Advanced.';
const DESKTOP = { width: 1280, height: 800 };

const card = (page: Page) => page.getByTestId('layout-card');
const tour = (page: Page) => page.getByTestId('tour');
const statement = (page: Page) => page.getByTestId('disclaimer');
const acceptButton = (page: Page) => page.getByRole('button', { name: /I understand, let me begin/ });
const classicHeader = (page: Page) => page.locator('header').getByTitle('Safety Protocols', { exact: true });
const quickGuide = (page: Page) => page.getByText('Quick Guide', { exact: true });

/** Either layout has rendered (under the statement too). */
async function appUp(page: Page): Promise<void> {
  await page.locator('[data-testid="new-shell"], header [title="Safety Protocols"]').first().waitFor({ timeout: 30_000 });
}

interface Profile {
  /** aetheria.disclaimer.v1 (the accepted wording; any value counts as prior use). */
  accepted?: string | null;
  tutorial?: boolean;
  layout?: string | null;
  mark?: string | null;
  engine?: 'v2' | 'classic';
  output?: 'headphones' | 'car';
}

/** The moved user: the current wording accepted and the tutorial seen, as v16.7 leaves an existing profile. */
const MOVED: Profile = { accepted: VERSION, tutorial: true };

/** A profile as an earlier version left it: written before the tab's first load (once per tab), and pause() counted. */
async function profile(page: Page, p: Profile): Promise<void> {
  await page.addInitScript(
    ({ p, keys }) => {
      try {
        if (sessionStorage.getItem('__e2eProfile') === null) {
          sessionStorage.setItem('__e2eProfile', '1');
          const set = (k: string, v: string | null | undefined) => {
            if (v !== null && v !== undefined) localStorage.setItem(k, v);
          };
          set(keys.disclaimer, p.accepted);
          if (p.tutorial) localStorage.setItem(keys.tutorial, 'true');
          set(keys.layout, p.layout);
          set(keys.notice, p.mark);
          localStorage.setItem(keys.engine, p.engine ?? 'v2');
          localStorage.setItem(keys.output, p.output ?? 'headphones');
        }
      } catch {}
      const w = window as any;
      w.__pauseCount = 0;
      const original = HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
        w.__pauseCount++;
        return original.call(this);
      };
    },
    {
      p,
      keys: {
        disclaimer: DISCLAIMER_KEY,
        tutorial: TUTORIAL_KEY,
        layout: LAYOUT_KEY,
        notice: NOTICE_KEY,
        engine: 'aetheria.layerEngine.v1',
        output: 'aetheria.layerOutput.v1',
      },
    }
  );
}

const pauses = (page: Page) => page.evaluate(() => (window as any).__pauseCount as number);

/** Nothing of `what` for `ms` (a state that must never come, sampled every 100 ms). */
async function expectNever(what: Locator, ms: number, message: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    expect(await what.count(), message).toBe(0);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The card's words, buttons and place: in the notices' live region, overlapping no other notice. */
async function expectCard(page: Page): Promise<void> {
  await expect(card(page)).toBeVisible();
  await expect(page.getByTestId('notices').getByTestId('layout-card')).toHaveCount(1);
  await expect(card(page)).toContainText(CARD_TEXT);
  await expect(card(page).getByTestId('layout-card-tour')).toHaveText('Show the tour');
  await expect(card(page).getByTestId('layout-card-classic')).toHaveText('Use the classic layout');
  await expect(card(page).getByRole('button', { name: 'Dismiss the layout notice', exact: true })).toBeVisible();
  await expect(card(page)).toHaveAttribute('aria-atomic', 'true');
  const overlaps = await page.evaluate(() => {
    const stack = document.querySelector('[data-testid="notices"]')!;
    const mine = stack.querySelector('[data-testid="layout-card"]')!.getBoundingClientRect();
    const hit: string[] = [];
    for (const el of Array.from(stack.children)) {
      if (el.getAttribute('data-testid') === 'layout-card') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < mine.right && mine.left < r.right && r.top < mine.bottom && mine.top < r.bottom) hit.push((el.textContent ?? '').slice(0, 40));
    }
    return hit;
  });
  expect(overlaps, 'the card overlaps no other notice').toEqual([]);
}

/** Watch for classic's player bar and header Library button, from the first frame (layout.spec 2's observer). */
async function watchClassic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__classicSeen = [];
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="player-bar"]')) w.__classicSeen.push('player-bar');
      if (document.querySelector('header button[aria-label="Library"]')) w.__classicSeen.push('header Library');
    }).observe(document, { childList: true, subtree: true });
  });
}
const classicSeen = (page: Page) => page.evaluate(() => (window as any).__classicSeen as string[]);

/** When each of the notices' live region and the card first attached (performance.now(), from the first frame). */
async function watchFirstSeen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__firstSeen = {};
    // v16.8 (5.1, the phone gate 2026-11-02: L2 read the card after it had already gone "off" on the slower phone): the
    // card's aria-live from its insertion on, recorded as it changes, so L2 checks what a screen reader met however
    // late the test looks. One entry per value: the card element (1 = the first inserted), its own aria-live then, and
    // the live region's around it. Mutation records carry the old value, so a change in the same task as the
    // insertion still shows the value it was inserted with.
    // Fix round 1 (tests S1, N3): each entry carries its observer batch (one per callback: a change made in the same task
    // as the insertion, say from a layout effect's synchronous re-render, lands in the insertion's batch, and no screen
    // reader ever meets the card "polite"), and card 1's aria-live two animation frames after its insertion (once the
    // page has rendered it) is kept in __cardAtFrame2. The live region is an explicit aria-live or a role that is live by
    // itself (status and log: polite; alert: assertive), whichever is nearest.
    w.__cardLive = [];
    w.__cardAtFrame2 = undefined;
    const cards = new WeakMap<Element, number>();
    const LIVE_ROLES: Record<string, string> = { status: 'polite', log: 'polite', alert: 'assertive' };
    const region = (el: Element) => {
      const r = el.parentElement?.closest('[aria-live], [role="status"], [role="log"], [role="alert"]');
      return r ? (r.getAttribute('aria-live') ?? LIVE_ROLES[r.getAttribute('role') ?? ''] ?? null) : null;
    };
    let batch = 0;
    new MutationObserver((records) => {
      const t = performance.now();
      batch++;
      for (const id of ['notices', 'layout-card']) {
        if (w.__firstSeen[id] === undefined && document.querySelector(`[data-testid="${id}"]`)) w.__firstSeen[id] = t;
      }
      records.forEach((r, i) => {
        if (r.type === 'childList') {
          for (const node of Array.from(r.addedNodes)) {
            if (!(node instanceof Element)) continue;
            const el = node.matches('[data-testid="layout-card"]') ? node : node.querySelector('[data-testid="layout-card"]');
            if (!el || cards.has(el)) continue;
            // Its aria-live as inserted: a later change in this same batch holds it as its old value.
            const later = records.slice(i + 1).find((q) => q.type === 'attributes' && q.target === el);
            const n = w.__cardLive.filter((e: any) => e.first).length + 1;
            cards.set(el, n);
            w.__cardLive.push({ n, batch, own: later ? later.oldValue : el.getAttribute('aria-live'), region: region(el), first: true });
            if (n === 1) requestAnimationFrame(() => requestAnimationFrame(() => (w.__cardAtFrame2 = { own: el.getAttribute('aria-live') })));
          }
        } else if (r.type === 'attributes' && r.target instanceof Element && cards.has(r.target)) {
          // The value after this change: the next change's old value, or the value now.
          const next = records.slice(i + 1).find((q) => q.type === 'attributes' && q.target === r.target);
          w.__cardLive.push({ n: cards.get(r.target), batch, own: next ? next.oldValue : r.target.getAttribute('aria-live'), region: region(r.target), first: false });
        }
      });
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-live'], attributeOldValue: true });
  });
}
const firstSeen = (page: Page) => page.evaluate(() => (window as any).__firstSeen as Record<string, number>);
/** The card's aria-live history (watchFirstSeen): each value it had, per card element, from its insertion on. */
const cardLive = (page: Page) =>
  page.evaluate(() => (window as any).__cardLive as { n: number; batch: number; own: string | null; region: string | null; first: boolean }[]);
/** Card 1's own aria-live two animation frames after its insertion (watchFirstSeen); undefined until then. */
const cardAtFrame2 = (page: Page) => page.evaluate(() => (window as any).__cardAtFrame2 as { own: string | null } | undefined);
/** Classic's first header control, where the focus lands in classic (review B4). */
const classicLibraryButton = (page: Page) => page.locator('header').getByRole('button', { name: 'Library', exact: true });

/** "Beta" in the shell's chrome: the top bar, the side nav and every view's header (the Layers tab's Beat section names
 *  a "Beta" band in its body, which is not a label). */
const betaInChrome = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="new-shell"] header, [data-testid="side-nav"], [data-testid="new-top-bar"]'))
      .map((el) => el.textContent ?? '')
      .filter((t) => /beta/i.test(t))
  );

// ---------------------------------------------------------------------------------------------------------------
// The default
// ---------------------------------------------------------------------------------------------------------------

for (const [label, viewport] of [['phone', PHONE_VIEWPORT], ['desktop', DESKTOP]] as const) {
  test.describe(`L1, ${label}`, () => {
    test.use({ viewport });

    test(`L1. a fresh profile (${label}): the statement over the new layout, then the 4-card tour, then the empty library's Import music; marked fresh; a reload: no card, no tour @mobile @default`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/');
      if (label === 'phone') await phoneSize(page);
      await newShell(page).waitFor();
      await expect(statement(page)).toBeVisible();
      await expect(classicHeader(page)).toHaveCount(0);
      await expect(card(page), 'never over the statement').toHaveCount(0);
      await acceptButton(page).click();
      await expect(page.getByRole('dialog', { name: 'Tour, card 1 of 4', exact: true })).toBeVisible();
      await expect(quickGuide(page), "classic's Quick Guide is not shown").toHaveCount(0);
      await expect(card(page), 'never over the tour').toHaveCount(0);
      const next = tour(page).getByRole('button', { name: 'Next', exact: true });
      await next.click();
      await next.click();
      await next.click();
      await expect(page.getByRole('dialog', { name: 'Tour, card 4 of 4', exact: true })).toContainText(
        label === 'desktop' ? 'Five sections on the left.' : 'Five tabs at the bottom of the screen.'
      );
      await tour(page).getByRole('button', { name: 'Done', exact: true }).click();
      await expect(tour(page)).toHaveCount(0);
      if (label === 'desktop') {
        await expect(page.getByTestId('desktop-empty')).toBeVisible();
        await expect(page.getByTestId('desktop-empty').getByRole('button', { name: 'Import music', exact: true })).toBeVisible();
      } else {
        await expect(page.getByTestId('np-empty')).toContainText('Your library is empty');
        await expect(page.getByTestId('np-empty').getByRole('button', { name: 'Import music', exact: true })).toBeVisible();
      }
      expect(await stored(page, LAYOUT_KEY), 'the layout choice is still unset').toBeNull();
      expect(await stored(page, NOTICE_KEY), 'this device started on v16.8').toBe('fresh');
      await expectNever(card(page), 1000, 'no card for a new install');

      // A second launch: the statement accepted and the tour seen are prior use now, but the device is marked fresh.
      await page.reload();
      await newShell(page).waitFor();
      await expectNever(card(page).or(tour(page)).or(statement(page)), 2000, 'a reload: no card, no tour, no statement');
      expect(await stored(page, NOTICE_KEY)).toBe('fresh');
      expect(errors).toEqual([]);
    });
  });
}

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('L2. a moved profile (prior use, no saved layout): the new layout with the card in the notices, after the live region is there; X closes it for good, the focus on the view\'s heading; the layout stays unset @default', async ({ page }) => {
    await profile(page, MOVED);
    await watchFirstSeen(page);
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expect(statement(page)).toHaveCount(0);
    await expectCard(page);
    // Review B3: not in the live region's first frame (a screen reader skips content inserted with its region).
    const seen = await firstSeen(page);
    expect(seen.layoutCard ?? seen['layout-card'], 'the card attached').toBeDefined();
    expect(seen['layout-card'] - seen.notices, 'the card comes after the live region (ms)').toBeGreaterThanOrEqual(50);
    // Announced once (v16.8, 5.1): as inserted it had no aria-live of its own, so it was read through the notices'
    // polite region; from the recorded history, not the attribute now (on a slow phone it may already be "off").
    const live = await cardLive(page);
    const inserted = live.find((e) => e.first && e.n === 1);
    expect(inserted, 'the card was inserted (recorded from the first frame)').toBeDefined();
    expect(inserted!.region, "into the notices' polite live region").toBe('polite');
    expect(inserted!.own ?? inserted!.region, 'announced: polite as inserted, never "off" the first time').toBe('polite');
    // Fix round 1 (tests S1): not "off" in the same task as the insertion either. Two frames after it the page has
    // rendered the card, so a screen reader met it polite. On a device a correct build may re-render between those two
    // frames (its launch is slower), so there the batch check below stands alone and the frame is only recorded.
    await expect.poll(() => cardAtFrame2(page), { message: 'card 1 two frames after its insertion (recorded)', timeout: 5_000 }).toBeDefined();
    const frame2 = (await cardAtFrame2(page))!;
    if (ON_DEVICE) test.info().annotations.push({ type: 'card at frame 2', description: String(frame2.own) });
    else expect(frame2.own, 'two frames after its insertion the card is still not "off" (the page rendered it polite)').not.toBe('off');
    // Then "off" (announced once): a re-render (another tab and back) carries aria-live="off", on the same card or on a
    // card element mounted again (review N3: a remount on the tab switch is correct, if it comes in "off").
    await tab(page, 'library');
    await tab(page, 'now');
    await expect(card(page), 'read once: after its first showing it is "off"').toHaveAttribute('aria-live', 'off');
    const history = await cardLive(page);
    const values = history.map((e) => e.own ?? e.region);
    expect(values[0], 'the history: polite first').toBe('polite');
    expect(values[values.length - 1], 'then off').toBe('off');
    const firstOff = history.find((e) => e.own === 'off');
    expect(firstOff!.batch, '"off" came in a later task than the insertion (not its own batch)').toBeGreaterThan(inserted!.batch);
    for (const e of history.filter((x) => x.first && x.n > 1)) expect(e.own, `card element ${e.n}, mounted again, comes in "off"`).toBe('off');
    expect(await stored(page, NOTICE_KEY), 'the card is due until tapped').toBe('due');
    await card(page).getByRole('button', { name: 'Dismiss the layout notice', exact: true }).click();
    await expect(card(page)).toHaveCount(0);
    // Review B4: the focus lands on the view's heading, not on <body>.
    await expect(page.getByTestId('np-title'), 'the focus on Now Playing\'s heading').toBeFocused();
    expect(await stored(page, NOTICE_KEY)).toBe('seen');
    expect(await stored(page, LAYOUT_KEY), 'the layout stays unset').toBeNull();
    await page.reload();
    await newShell(page).waitFor();
    await expectNever(card(page), 2000, 'closed: never again');
    await expect(tour(page)).toHaveCount(0);
    expect(await stored(page, LAYOUT_KEY)).toBeNull();
    expect(await stored(page, NOTICE_KEY)).toBe('seen');
  });

  test('L2b. the card left open comes back at the next launch (it stays until one of its buttons is tapped)', async ({ page }) => {
    await profile(page, MOVED);
    await page.goto('/');
    await phoneSize(page);
    await expectCard(page);
    await page.reload();
    await newShell(page).waitFor();
    await expectCard(page);
    expect(await stored(page, NOTICE_KEY)).toBe('due');
    // Another tab and back: still there (it is not a timed toast).
    await tab(page, 'library');
    await expect(card(page)).toBeVisible();
    await tab(page, 'now');
    await expect(card(page)).toBeVisible();
  });

  test('L3. the card\'s Use the classic layout while a track plays: classic, saved; the music plays on; a reload stays classic, no card; the pill brings the new layout back, no card @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await profile(page, MOVED);
    await seedLibraryRecords(page, 3, { real: 3, seconds: 40 });
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(3);
    await expectCard(page);
    await page.getByTestId('view-now').getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 0.5; }, { timeout: 20_000, message: 'a track plays' }).toBe(true);
    const p0 = await pauses(page);
    const t0 = (await libraryState(page)).t ?? 0;
    await card(page).getByTestId('layout-card-classic').click();
    await expect(classicHeader(page)).toBeVisible();
    await expect(newShell(page)).toHaveCount(0);
    expect(await stored(page, LAYOUT_KEY)).toBe('classic');
    expect(await stored(page, NOTICE_KEY)).toBe('seen');
    // Review B4: the focus lands on classic's first header control, not on <body>.
    await expect(classicLibraryButton(page), 'the focus in classic').toBeFocused();
    await page.waitForTimeout(1500);
    const s1 = await libraryState(page);
    expect(s1.playing, 'the music plays on').toBe(true);
    expect((s1.t ?? 0) - t0, 'the time moves on').toBeGreaterThan(1);
    expect(await pauses(page), 'no pause() through the switch').toBe(p0);
    await closeSafetyPanel(page);

    await page.reload();
    await appUp(page);
    await expect(classicHeader(page), 'a tap after the move holds').toBeVisible();
    await expect(newShell(page)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    expect(await stored(page, LAYOUT_KEY)).toBe('classic');

    await optInNewLayout(page);
    expect(await stored(page, LAYOUT_KEY)).toBe('new');
    await expectNever(card(page), 1500, 'the pill: no card');
  });

  test('L4. the card\'s Show the tour: the tour, the card gone for good; closing the tour puts the focus in the shell', async ({ page }) => {
    await profile(page, MOVED);
    await page.goto('/');
    await phoneSize(page);
    await expectCard(page);
    await card(page).getByTestId('layout-card-tour').click();
    await expect(page.getByRole('dialog', { name: 'Tour, card 1 of 4', exact: true })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect(await stored(page, NOTICE_KEY)).toBe('seen');
    await tour(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(tour(page)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="new-shell"]')), { message: 'the focus is in the shell' })
      .toBe(true);
    await expect(card(page)).toHaveCount(0);
    await page.reload();
    await newShell(page).waitFor();
    await expectNever(card(page), 1500, 'no card after Show the tour');
  });

  test('L5. decision 1 B: a saved "classic" from before v16.8 is moved once (the card, the saved value removed); a later Back to classic holds, and the card waits for its own tap', async ({ page }) => {
    test.setTimeout(150_000);
    await profile(page, { ...MOVED, layout: 'classic' });
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expect(classicHeader(page)).toHaveCount(0);
    await expectCard(page);
    await expect.poll(() => stored(page, LAYOUT_KEY), { message: 'the old choice is removed (moved once)' }).toBeNull();
    expect(await stored(page, NOTICE_KEY)).toBe('due');
    // Still moved at the next launch, the card still due.
    await page.reload();
    await newShell(page).waitFor();
    await expectCard(page);
    // ⋯ › Back to classic (not the card's button): a v16.8 choice, respected at the next launch; and (review A1) an
    // explicit switch answers the card: it never shows again.
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByTestId('menu-back-to-classic').click();
    await expect(classicHeader(page)).toBeVisible();
    expect(await stored(page, LAYOUT_KEY)).toBe('classic');
    expect(await stored(page, NOTICE_KEY), 'the switch answered the card').toBe('seen');
    await page.reload();
    await appUp(page);
    await expect(classicHeader(page), 'the move never repeats').toBeVisible();
    await expect(newShell(page)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    await optInNewLayout(page);
    await expectNever(card(page), 1500, 'back in the new layout: no card');
    expect(await stored(page, NOTICE_KEY)).toBe('seen');
  });

  for (const path of ['menu', 'advanced', 'crash card', 'address'] as const) {
    test(`L5c. review A1: ${path}, with the card due: classic, and the card answered (never again, also back in the new layout)`, async ({ page }) => {
      test.setTimeout(120_000);
      await profile(page, MOVED);
      await page.goto('/');
      await phoneSize(page);
      await expectCard(page);
      if (path === 'menu') {
        await page.getByRole('button', { name: 'More options', exact: true }).click();
        await page.getByTestId('menu-back-to-classic').click();
      } else if (path === 'advanced') {
        // The card sits over the bottom of this tab (as Ready Offline does) at 411 x 752: the keyboard's path (focus,
        // Enter) reaches the rows under it.
        await tab(page, 'more');
        const row = page.getByTestId('more-root').getByTestId('more-advanced-row');
        await row.focus();
        await page.keyboard.press('Enter');
        const button = page.getByTestId('more-advanced').getByTestId('more-back-to-classic');
        await button.focus();
        await page.keyboard.press('Enter');
      } else if (path === 'crash card') {
        await crash(page, 'shell');
        await page.getByTestId('shell-fallback').getByRole('button', { name: 'Use the classic layout', exact: true }).click();
      } else {
        await page.goto('/?layout=classic');
      }
      await appUp(page);
      await expect(classicHeader(page)).toBeVisible();
      expect(await stored(page, LAYOUT_KEY)).toBe('classic');
      await expect.poll(() => stored(page, NOTICE_KEY), { message: 'the switch answered the card' }).toBe('seen');
      await optInNewLayout(page);
      await expectNever(card(page), 1500, 'back in the new layout: no card');
      await page.reload();
      await newShell(page).waitFor();
      await expectNever(card(page), 1000, 'nor at the next launch');
    });
  }

  test('L5e. the card names More › Advanced, and on the phone that row is reachable by a tap with the card up (the notice spacer scrolls it clear)', async ({ page }) => {
    await profile(page, MOVED);
    await page.goto('/');
    await phoneSize(page);
    await expectCard(page);
    await tab(page, 'more');
    await expect(page.getByTestId('more-notice-spacer')).toHaveJSProperty('offsetHeight', await card(page).evaluate((c) => Math.ceil(c.closest('[data-testid="notices"]')!.getBoundingClientRect().height) + 8));
    await page.getByTestId('more-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const row = page.getByTestId('more-root').getByTestId('more-advanced-row');
    const hidden = await row.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && !el.contains(top);
    });
    expect(hidden, 'scrolled to the end, the Advanced row is under nothing').toBe(false);
    await row.click();
    await expect(page.getByTestId('more-advanced').getByTestId('more-back-to-classic')).toBeVisible();
  });

  test('L5d. review A1: the pill from classic with the card still due (a classic saved after the move) answers it too', async ({ page }) => {
    await profile(page, { ...MOVED, layout: 'classic', mark: 'due' });
    await page.goto('/');
    await appUp(page);
    await expect(classicHeader(page)).toBeVisible();
    await optInNewLayout(page);
    await expectNever(card(page), 1500, 'the pill: no card');
    expect(await stored(page, NOTICE_KEY)).toBe('seen');
  });

  test('L5b. a saved "classic" after the move (marked) is the user\'s choice: classic, no card, nothing written', async ({ page }) => {
    for (const mark of ['seen', 'fresh', 'due']) {
      await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} }).catch(() => {});
      await page.goto('/manifest.json');
      await page.evaluate(({ keys, mark, v }) => {
        localStorage.clear();
        localStorage.setItem(keys.d, v);
        localStorage.setItem(keys.t, 'true');
        localStorage.setItem(keys.l, 'classic');
        localStorage.setItem(keys.n, mark);
        localStorage.setItem('aetheria.layerEngine.v1', 'classic');
      }, { keys: { d: DISCLAIMER_KEY, t: TUTORIAL_KEY, l: LAYOUT_KEY, n: NOTICE_KEY }, mark, v: VERSION });
      await page.goto('/');
      await appUp(page);
      await expect(classicHeader(page), `mark ${mark}: classic`).toBeVisible();
      await expect(newShell(page)).toHaveCount(0);
      await page.waitForTimeout(800);
      expect(await stored(page, LAYOUT_KEY), `mark ${mark}: the choice is kept`).toBe('classic');
      expect(await stored(page, NOTICE_KEY), `mark ${mark}: unchanged`).toBe(mark);
      await expect(card(page)).toHaveCount(0);
    }
  });

  test('L6. a saved "new" (a beta user): the new layout, no card; the layout untouched, marked seen', async ({ page }) => {
    await profile(page, { ...MOVED, layout: 'new' });
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expectNever(card(page), 1500, 'no card for a beta user');
    expect(await stored(page, LAYOUT_KEY)).toBe('new');
    expect(await stored(page, NOTICE_KEY)).toBe('seen');
    await page.reload();
    await newShell(page).waitFor();
    await expectNever(card(page), 1000, 'no card after a reload');
  });

  test('L7. junk in the key: with prior use the new layout and the card; without, the new layout, no card, marked fresh; the junk is left as it is', async ({ page }) => {
    await profile(page, { ...MOVED, layout: 'garbage' });
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expectCard(page);
    expect(await stored(page, LAYOUT_KEY)).toBe('garbage');
    expect(await stored(page, NOTICE_KEY)).toBe('due');
    // Without prior use (a fresh profile with junk): the statement, the new layout, no card.
    await page.goto('/manifest.json');
    await page.evaluate(({ l }) => { localStorage.clear(); localStorage.setItem(l, 'garbage'); }, { l: LAYOUT_KEY });
    await page.goto('/');
    await newShell(page).waitFor();
    await expect(statement(page)).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect(await stored(page, NOTICE_KEY)).toBe('fresh');
    expect(await stored(page, LAYOUT_KEY)).toBe('garbage');
    await acceptButton(page).click();
    await tour(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expectNever(card(page), 1000, 'no card without prior use');
  });

  test('L8. storage blocked (every access throws): the new layout, the statement on every launch, no card, no page error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('[SW]')) errors.push(m.text());
    });
    await page.addInitScript(() => {
      for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
        (Storage.prototype as any)[method] = () => {
          throw new DOMException('blocked', 'SecurityError');
        };
      }
    });
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expect(classicHeader(page)).toHaveCount(0);
    await expect(acceptButton(page)).toBeVisible();
    await acceptButton(page).click();
    await expect(acceptButton(page)).toHaveCount(0);
    await expectNever(card(page).or(tour(page)), 1000, 'no card, no tour');
    await page.reload();
    await newShell(page).waitFor();
    await expect(acceptButton(page), 'the statement again: nothing could be remembered').toBeVisible();
    await expect(classicHeader(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('L9. Car: a moved profile with Output = Car opens the Car screen with no card; Output → Headphones, and the card appears @mobile', async ({ page }) => {
    await profile(page, { ...MOVED, engine: 'v2', output: 'car' });
    await page.goto('/');
    await phoneSize(page);
    await expect(page.getByTestId('view-car')).toBeVisible({ timeout: 30_000 });
    await expectNever(card(page), 2000, 'never on the Car screen');
    await page.getByRole('button', { name: 'Change output', exact: true }).click();
    await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Headphones', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-car')).toHaveCount(0);
    await expect(page.getByTestId('view-now')).toBeVisible();
    await expectCard(page);
  });

  test('L10. a moved profile with an older acceptance: the statement first, no card behind it; accepted, no tour (seen), then the card', async ({ page }) => {
    await profile(page, { accepted: '2026-04-16', tutorial: true });
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expect(statement(page)).toBeVisible();
    await expectNever(card(page), 1500, 'never over the statement');
    await acceptButton(page).click();
    await expect(statement(page)).toHaveCount(0);
    await expectCard(page);
    await expect(tour(page)).toHaveCount(0);
    expect(await stored(page, DISCLAIMER_KEY)).toBe(VERSION);
  });

  test('L10b. prior use, the statement half alone (accepted, the tutorial never closed): the card, no statement, no tour', async ({ page }) => {
    await profile(page, { accepted: VERSION, tutorial: false });
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expectCard(page);
    await expect(statement(page)).toHaveCount(0);
    await expect(tour(page)).toHaveCount(0);
    expect(await stored(page, NOTICE_KEY)).toBe('due');
  });

  test('L10c. prior use, the tutorial half alone (closed, no statement accepted): the statement first, then the card (no tour)', async ({ page }) => {
    await profile(page, { accepted: null, tutorial: true });
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expect(statement(page)).toBeVisible();
    await expectNever(card(page), 1000, 'never over the statement');
    expect(await stored(page, NOTICE_KEY)).toBe('due');
    await acceptButton(page).click();
    await expectCard(page);
    await expect(tour(page)).toHaveCount(0);
  });

  test('L12. no saved layout: classic never attaches, not even for a frame, for a new install and a moved profile, before and after a reload', async ({ page }) => {
    await watchClassic(page);
    await page.goto('/');
    await newShell(page).waitFor();
    await page.waitForTimeout(1000);
    expect(await classicSeen(page), 'a new install').toEqual([]);
    await acceptButton(page).click();
    await page.reload();
    await newShell(page).waitFor();
    await page.waitForTimeout(1000);
    expect(await classicSeen(page), 'a new install, reloaded').toEqual([]);
    // A moved profile (a fresh tab's storage written as v16.7 leaves it).
    await page.goto('/manifest.json');
    await page.evaluate(({ d, t, v }) => { localStorage.clear(); localStorage.setItem(d, v); localStorage.setItem(t, 'true'); }, { d: DISCLAIMER_KEY, t: TUTORIAL_KEY, v: VERSION });
    await page.goto('/');
    await newShell(page).waitFor();
    await page.waitForTimeout(1000);
    expect(await classicSeen(page), 'a moved profile').toEqual([]);
    await expect(card(page)).toBeVisible();
    await page.reload();
    await newShell(page).waitFor();
    await page.waitForTimeout(1000);
    expect(await classicSeen(page), 'a moved profile, reloaded').toEqual([]);
  });

  test('L13. ?layout=classic, then ?layout=new, on a fresh profile: each saved and kept by a plain reload, no card on any launch', async ({ page }) => {
    await page.goto('/?layout=classic');
    await appUp(page);
    await expect(classicHeader(page)).toBeVisible();
    await expect(newShell(page)).toHaveCount(0);
    await expect.poll(() => stored(page, LAYOUT_KEY)).toBe('classic');
    expect(await stored(page, NOTICE_KEY)).toBe('fresh');
    await page.goto('/');
    await appUp(page);
    await expect(classicHeader(page), 'the address\'s choice holds (no second move)').toBeVisible();
    await expect(newShell(page)).toHaveCount(0);
    await page.goto('/?layout=new');
    await newShell(page).waitFor();
    await expect.poll(() => stored(page, LAYOUT_KEY)).toBe('new');
    await page.goto('/');
    await newShell(page).waitFor();
    await expect(card(page)).toHaveCount(0);
    expect(await stored(page, NOTICE_KEY)).toBe('fresh');
  });

  test('L14. a classic peek (Library › Open the classic library) never shows the card; back in the new layout it is there again', async ({ page }) => {
    test.setTimeout(120_000);
    await profile(page, MOVED);
    await seedLibraryRecords(page, 3, { real: 3, seconds: 40 });
    await page.goto('/');
    await phoneSize(page);
    await newShell(page).waitFor();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(3);
    await expectCard(page);
    await peekClassicLibrary(page);
    await expect(newShell(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back to the new layout' })).toBeVisible();
    await expectNever(card(page), 1500, 'never during a peek');
    expect(await stored(page, NOTICE_KEY), 'a peek is not a tap on the card').toBe('due');
    await page.getByRole('button', { name: 'Back to the new layout' }).click();
    await newShell(page).waitFor();
    await expectCard(page);
    // Review B3: read once: back from the peek it carries aria-live="off" (not announced again).
    await expect(card(page)).toHaveAttribute('aria-live', 'off');
  });

  test('B1. no "Beta" anywhere in the new layout (each tab); Advanced reads "new"', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewLayout(page, { via: 'seed' });
    await phoneSize(page);
    for (const t of ['now', 'library', 'mixes', 'layers', 'more'] as const) {
      await tab(page, t);
      await page.waitForTimeout(300);
      expect(await betaInChrome(page), `${t}: no "Beta" in the top bar, the nav or a header`).toEqual([]);
    }
    // About's version line said "new layout (beta)" (the spec's list of labels missed it).
    await openMorePage(page, 'about');
    await expect(page.getByTestId('about-version')).toHaveText(/^Version v\d+\.\d+(\.\d+)? · new layout$/); // (v16.8.1: a patch number too)
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await openMorePage(page, 'advanced');
    const layout = page.getByTestId('advanced-layout');
    await expect(layout).toContainText('new');
    await expect(layout).not.toContainText('beta');
    await expect(layout).not.toContainText('Beta');
  });
});

test.describe('desktop', () => {
  test.use({ viewport: DESKTOP });

  test('L4d. desktop: Show the tour from the card; closing it puts the focus in the shell', async ({ page }) => {
    await profile(page, MOVED);
    await page.goto('/');
    await expectCard(page);
    await card(page).getByTestId('layout-card-tour').click();
    await expect(page.getByRole('dialog', { name: 'Tour, card 1 of 4', exact: true })).toBeVisible();
    await tour(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(tour(page)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="new-shell"]')), { message: 'the focus is in the shell' })
      .toBe(true);
  });

  test('B1d. desktop: no "Beta" in the nav or any section', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewLayout(page, { via: 'seed' });
    await expect(page.getByTestId('new-shell')).toHaveAttribute('data-shell', 'desktop');
    for (const t of ['library', 'mixes', 'layers', 'more', 'now'] as const) {
      await tab(page, t);
      await page.waitForTimeout(300);
      expect(await betaInChrome(page), `${t}: no "Beta" in the top bar, the nav or a header`).toEqual([]);
    }
  });

  test('D-E1. desktop, an empty library: the Import music card over the visuals; Import music opens the Import sheet in the panel; any open section or Zen hides it; an import of 2 tones ends it', async ({ page }) => {
    test.setTimeout(120_000);
    await profile(page, { ...MOVED, layout: 'new', mark: 'seen' });
    await page.goto('/');
    await newShell(page).waitFor();
    const empty = page.getByTestId('desktop-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Your library is empty');
    await expect(empty).toContainText('Import music from this device. Aetheria keeps its own copy here; your files are not changed.');
    await expect(card(page)).toHaveCount(0);
    // A section hides it; back on Now Playing it shows again.
    await tab(page, 'library');
    await expect(empty).toHaveCount(0);
    await tab(page, 'now');
    await expect(empty).toBeVisible();
    // Zen hides it with the shell.
    await zenToggle(page).click();
    await page.mouse.move(5, 5);
    await expectShellHidden(page, 'Zen hides the shell', 10_000);
    await expect(empty).toHaveCount(0);
    await page.mouse.move(600, 400);
    await page.mouse.move(620, 420);
    await expect(newShell(page)).not.toHaveClass(/opacity-0/, { timeout: 10_000 });
    await zenToggle(page).click();
    await expect(empty).toBeVisible();
    // Import music: the Import sheet takes the panel, the card goes.
    await empty.getByRole('button', { name: 'Import music', exact: true }).click();
    await expect(page.getByTestId('desktop-panel').getByTestId('sheet-import')).toBeVisible();
    await expect(empty).toHaveCount(0);
    await addFiles(page, [1, 2].map((i) => ({ name: `tone-${String(i).padStart(2, '0')}.wav`, mimeType: 'audio/wav', buffer: toneWav(4, 220 + i * 37) })));
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(2);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet-import')).toHaveCount(0);
    await expectNever(empty, 1500, 'a library: no card');
  });

  test('D-E3. a crash in the empty-library card (its own region) leaves the shell: the card goes, the nav and the transport stay', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await profile(page, { ...MOVED, layout: 'new', mark: 'seen' });
    await page.goto('/');
    await newShell(page).waitFor();
    await expect(page.getByTestId('desktop-empty')).toBeVisible();
    await crash(page, 'desktop-empty');
    // The drill fires on the region's next render: a section open and closed re-renders it.
    await tab(page, 'library');
    await tab(page, 'now');
    await expect(page.getByTestId('desktop-empty')).toHaveCount(0);
    await expect(page.getByTestId('side-nav')).toBeVisible();
    await expect(page.getByTestId('desktop-transport')).toBeVisible();
    await expect(newShell(page)).toBeVisible();
    expect(errors, 'a region crash is caught (no page error)').toEqual([]);
  });

  test('D-E4. review B2: while the saved library is read back, no "Your library is empty"; once restored, none either', async ({ page }) => {
    await holdRestore(page);
    await profile(page, { ...MOVED, layout: 'new', mark: 'seen' });
    await seedLibraryRecords(page, 3, { real: 3, seconds: 40 });
    await page.goto('/');
    await newShell(page).waitFor();
    await expect.poll(() => page.evaluate(() => (window as any).__restoreHeld ?? 0), { message: 'the restore is held' }).toBeGreaterThan(0);
    await expectNever(page.getByTestId('desktop-empty'), 2000, 'the restore in flight: no empty card');
    await page.evaluate(() => (window as any).__releaseRestore());
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(3);
    await expectNever(page.getByTestId('desktop-empty'), 1000, 'restored: no empty card');
  });

  test('D-E5. review B1: at 1024 x 600, with the moved-over card and Ready Offline in the notices, Import music is under no notice', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await profile(page, MOVED);
    await page.goto('/');
    await newShell(page).waitFor();
    await expectCard(page);
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OFFLINE_READY', added: 3, total: 9 } })));
    await expect(page.getByTestId('offline-ready')).toBeVisible();
    const importButton = page.getByTestId('desktop-empty').getByRole('button', { name: 'Import music', exact: true });
    await expect(importButton).toBeVisible();
    const hits = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="desktop-empty"] button')!.getBoundingClientRect();
      const card = document.querySelector('[data-testid="desktop-empty"]')!.getBoundingClientRect();
      const out: string[] = [];
      for (const el of Array.from(document.querySelector('[data-testid="notices"]')!.children)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        for (const [what, x] of [['the button', b], ['the card', card]] as const) {
          if (r.left < x.right && x.left < r.right && r.top < x.bottom && x.top < r.bottom) out.push(`${what} under ${(el.textContent ?? '').slice(0, 30)}`);
        }
      }
      return out;
    });
    expect(hits, 'nothing of the empty card under a notice').toEqual([]);
    await importButton.click();
    await expect(page.getByTestId('desktop-panel').getByTestId('sheet-import')).toBeVisible();
  });

  test('D-E2. desktop with a library: no Import music card at any point after the restore', async ({ page }) => {
    await openSeededNewLayout(page, 3);
    await expectNever(page.getByTestId('desktop-empty'), 2500, 'a library: no card');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The statement: a real modal in both layouts
// ---------------------------------------------------------------------------------------------------------------

/** The modal's checks: on <body> outside #root, #root inert, a labelled dialog focused on its panel at the top, Tab
 *  held inside it, `hidden` out of the accessibility tree, Escape doing nothing. */
async function expectStatementModal(page: Page, hidden: { role: string; name: string }): Promise<void> {
  await expect(acceptButton(page)).toBeVisible();
  const where = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="disclaimer"]')!;
    return { onBody: s.parentElement === document.body, inRoot: !!document.getElementById('root')!.contains(s), rootInert: (document.getElementById('root') as any).inert === true };
  });
  expect(where, 'a child of <body>, outside #root, #root inert').toEqual({ onBody: true, inRoot: false, rootInert: true });
  const dialog = page.getByRole('dialog', { name: 'Welcome to Aetheria', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect
    .poll(() => page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && a.getAttribute('role') === 'dialog' && !!a.closest('[data-testid="disclaimer"]') && a.scrollTop === 0;
    }), { message: 'the focus is on the panel, at its top' })
    .toBe(true);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="disclaimer"]')), `Tab ${i + 1} stays inside`).toBe(true);
  }
  await page.keyboard.press('Tab');
  await expect(acceptButton(page), 'its one focusable').toBeFocused();
  expect(await inAxTree(page, hidden.role, hidden.name), `${hidden.name} behind it is out of the accessibility tree`).toBe(false);
  expect(await inAxTree(page, 'button', 'I understand, let me begin'), 'the accept button is in it').toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(acceptButton(page), 'Escape does nothing (a gate)').toBeVisible();
}

for (const [label, viewport] of [['phone', PHONE_VIEWPORT], ['desktop', DESKTOP]] as const) {
  test.describe(`L11, ${label}`, () => {
    test.use({ viewport });

    test(`L11. the statement over the new layout (${label}): a real modal; on accept the tour has the focus, and after it #root is live @default`, async ({ page }) => {
      await page.goto('/');
      if (label === 'phone') await phoneSize(page);
      await newShell(page).waitFor();
      await expectStatementModal(page, { role: 'button', name: 'Next track' });
      await acceptButton(page).click();
      await expect(statement(page)).toHaveCount(0);
      await expect(tour(page).getByRole('button', { name: 'Next', exact: true }), "the tour's Next has the focus").toBeFocused();
      await tour(page).getByRole('button', { name: 'Close', exact: true }).click();
      await expect(tour(page)).toHaveCount(0);
      expect(await page.evaluate(() => (document.getElementById('root') as any).inert), '#root is live again').toBe(false);
      expect(await inAxTree(page, 'button', 'Next track')).toBe(true);
    });
  });
}

test.describe('L11b, classic', () => {
  test.use({ layoutSeed: 'classic', viewport: DESKTOP });

  test('L11b. the statement over classic: the same modal; classic\'s header is out of reach; accepted, classic\'s Quick Guide (unchanged)', async ({ page }) => {
    await page.goto('/');
    await appUp(page);
    await expect(classicHeader(page)).toBeAttached();
    await expectStatementModal(page, { role: 'button', name: 'Library' });
    await acceptButton(page).click();
    await expect(statement(page)).toHaveCount(0);
    await expect(quickGuide(page)).toBeVisible();
    await expect(tour(page)).toHaveCount(0);
    expect(await page.evaluate(() => (document.getElementById('root') as any).inert)).not.toBe(true);
  });

  test('L11e. classic\'s Read the disclaimer: the modal again; accepted, the focus goes back to the page, the acceptance unchanged', async ({ page }) => {
    await page.addInitScript(({ d, t, v }) => { localStorage.setItem(d, v); localStorage.setItem(t, 'true'); }, { d: DISCLAIMER_KEY, t: TUTORIAL_KEY, v: VERSION });
    await page.goto('/');
    await appUp(page);
    await expect(statement(page)).toHaveCount(0);
    await page.getByTitle('Safety Protocols', { exact: true }).click();
    await page.getByRole('button', { name: 'Read the disclaimer' }).click();
    await expect(acceptButton(page)).toBeVisible();
    expect(await page.evaluate(() => (document.getElementById('root') as any).inert)).toBe(true);
    await acceptButton(page).click();
    await expect(statement(page)).toHaveCount(0);
    expect(await page.evaluate(() => (document.getElementById('root') as any).inert)).toBe(false);
    expect(await stored(page, DISCLAIMER_KEY)).toBe(VERSION);
    await expect(quickGuide(page)).toHaveCount(0);
    // Review B4: the focus goes back to Safety Protocols (the Read button went with its panel), not to <body>.
    await expect(page.locator('header').getByTitle('Safety Protocols', { exact: true }), 'the focus back on Safety Protocols').toBeFocused();
  });

  test('L11f. review A5: a portal on <body> outside #root (a tooltip, the visuals-stopped pill) is inert while the statement shows, and given back after', async ({ page }) => {
    await page.goto('/');
    await appUp(page);
    await expect(acceptButton(page)).toBeVisible();
    // One such portal, added while the statement shows (as a tooltip's is), and one already there before it closes.
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'e2e-portal';
      d.innerHTML = '<button type="button">Portal control</button>';
      document.body.appendChild(d);
    });
    await expect.poll(() => page.evaluate(() => (document.getElementById('e2e-portal') as any).inert), { message: 'inert under the statement' }).toBe(true);
    expect(await inAxTree(page, 'button', 'Portal control'), 'out of the accessibility tree').toBe(false);
    expect(await page.evaluate(() => (document.querySelector('[data-testid="disclaimer"]') as any).inert), 'the statement itself is live').toBe(false);
    await acceptButton(page).click();
    await expect(statement(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (document.getElementById('e2e-portal') as any).inert), { message: 'given back' }).toBe(false);
    await page.evaluate(() => document.getElementById('e2e-portal')?.remove());
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The move and the library (fidelity review N3, adopted from the reviewer's scratch spec in fix round 1)
// ---------------------------------------------------------------------------------------------------------------

/** IndexedDB (each store, the schema, the databases) and localStorage, as the page sees them now. */
async function dumpStorage(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = (store: string) =>
      new Promise<any[]>((res, rej) => {
        const r = db.transaction(store, 'readonly').objectStore(store).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const blobs = (await all('blobs')).map((b) => ({ id: b.id, fileName: b.fileName, fileType: b.fileType, size: b.fileBlob?.size ?? null }));
    const meta = await all('meta');
    const state = (await all('playlist-state')).map((s) => {
      const { savedAt, ...rest } = s;
      return rest;
    });
    const stores = Array.from(db.objectStoreNames);
    const version = db.version;
    db.close();
    const ls: Record<string, string | null> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      ls[k] = localStorage.getItem(k);
    }
    const dbs = (await indexedDB.databases()).map((d) => `${d.name}@${d.version}`).sort();
    return { blobs, meta, state, stores, version, ls, dbs };
  });
}
type StorageDump = Awaited<ReturnType<typeof dumpStorage>>;

/** IndexedDB's changes from a to b, per store and field (ids by their library index: each launch mints its own). */
function idbChanges(a: StorageDump, b: StorageDump): string[] {
  const idx = new Map(a.blobs.map((x, i) => [x.id, i]));
  const norm = (s: string) => s.replace(/\d{10,}-[\w-]+/g, (m) => (idx.has(m) ? `#${idx.get(m)}` : m));
  const out: string[] = [];
  const byId = (l: any[], k: string) => new Map(l.map((x) => [x[k], x]));
  for (const [store, key, la, lb] of [
    ['blobs', 'id', a.blobs, b.blobs],
    ['meta', 'id', a.meta, b.meta],
    ['playlist-state', 'key', a.state, b.state],
  ] as const) {
    const ma = byId(la as any[], key);
    const mb = byId(lb as any[], key);
    for (const [k, va] of ma) {
      const vb = mb.get(k);
      if (!vb) {
        out.push(`${store}: ${norm(String(k))} deleted`);
        continue;
      }
      for (const f of new Set([...Object.keys(va), ...Object.keys(vb)])) {
        if (JSON.stringify(va[f]) !== JSON.stringify(vb[f])) out.push(`${store}: ${store === 'meta' ? 'record' : norm(String(k))}.${f} changed`);
      }
    }
    for (const k of mb.keys()) if (!ma.has(k)) out.push(`${store}: ${norm(String(k))} added`);
  }
  if (JSON.stringify(a.stores) !== JSON.stringify(b.stores) || a.version !== b.version) out.push(`schema ${a.version}:${a.stores} -> ${b.version}:${b.stores}`);
  if (JSON.stringify(a.dbs) !== JSON.stringify(b.dbs)) out.push(`databases ${a.dbs} -> ${b.dbs}`);
  return [...new Set(out)].sort();
}

/** localStorage's changes from a to b, one line per key. */
function lsChanges(a: StorageDump, b: StorageDump): string[] {
  const keys = new Set([...Object.keys(a.ls), ...Object.keys(b.ls)]);
  return [...keys].filter((k) => a.ls[k] !== b.ls[k]).map((k) => `${k}: ${a.ls[k]} -> ${b.ls[k]}`).sort();
}

const DATA_TRACKS = 12;
/** What every launch, moved or not, does to the play state: the launch snapshot of the walk. */
const LAUNCH_SNAPSHOT = 'playlist-state: current.walk changed';
const layoutLines = (l: string[]) => l.filter((x) => x.startsWith(`${LAYOUT_KEY}:`) || x.startsWith(`${NOTICE_KEY}:`));
const otherLines = (l: string[]) => l.filter((x) => !x.startsWith(`${LAYOUT_KEY}:`) && !x.startsWith(`${NOTICE_KEY}:`));

/** A populated library (audio, metadata with keys and envelopes, a saved playlist, a play state with a cursor and a
 *  queue, as a v16.7.3 session saves it) and a profile with prior use; launched, then reloaded, with IndexedDB and
 *  localStorage dumped before the launch, after it and after the reload. */
async function launchWithLibrary(page: Page, p: { layout: string | null; notice: string | null }) {
  await seedLibraryRecords(page, DATA_TRACKS, {
    real: 2,
    seconds: 20,
    crystals: 'some',
    keys: true,
    envelopes: true,
    playlists: [{ id: 'pdata0001', name: 'data list', indexes: [0, 3, 5], missing: 1 }],
  });
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const cur = await new Promise<any>((res, rej) => {
      const r = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('current');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('playlist-state', 'readwrite');
    tx.objectStore('playlist-state').put({ ...cur, currentSongIndex: 2, queue: { waiting: [7, 8], played: [] } });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
  await page.evaluate(
    ({ p, k }) => {
      localStorage.setItem(k.disclaimer, k.version);
      localStorage.setItem(k.tutorial, 'true');
      localStorage.setItem('aetheria.layerEngine.v1', 'v2');
      localStorage.setItem('aetheria.layerOutput.v1', 'headphones');
      if (p.layout !== null) localStorage.setItem(k.layout, p.layout);
      if (p.notice !== null) localStorage.setItem(k.notice, p.notice);
    },
    { p, k: { disclaimer: DISCLAIMER_KEY, tutorial: TUTORIAL_KEY, version: VERSION, layout: LAYOUT_KEY, notice: NOTICE_KEY } }
  );
  const before = await dumpStorage(page);
  await page.goto('/');
  await appUp(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(DATA_TRACKS);
  await page.waitForTimeout(9000); // the restore's own rewrite and every save debounce
  const after = await dumpStorage(page);
  const shell = (await newShell(page).count()) > 0;
  const shown = await card(page).isVisible().catch(() => false);
  await page.reload();
  await appUp(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(DATA_TRACKS);
  await page.waitForTimeout(6000);
  const reloaded = await dumpStorage(page);
  return { before, after, reloaded, shell, card: shown };
}

for (const [label, viewport] of [['phone', PHONE_VIEWPORT], ['desktop', DESKTOP]] as const) {
  test.describe(`L15, ${label}`, () => {
    test.use({ viewport });

    test(`L15. the move with a populated library (${label}): IndexedDB's blobs, meta and play state change exactly as at a launch that is not moved (the walk's launch snapshot only), localStorage only in the layout and notice keys`, async ({ page, browser }) => {
      test.skip(ON_DEVICE, 'three profiles side by side, each in a context of its own');
      test.setTimeout(240_000);
      const moved1B = await launchWithLibrary(page, { layout: 'classic', notice: null });
      expect([moved1B.shell, moved1B.card], 'a saved "classic" from before v16.8 (1 B): the new layout and the card').toEqual([true, true]);

      // The other two profiles, each in a fresh context of its own (the suite's options).
      const own = async () => {
        const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', baseURL: test.info().project.use.baseURL });
        const p = await ctx.newPage();
        return { ctx, p, dialogs: watchNativeDialogs(p) };
      };
      const n = await own();
      const never = await launchWithLibrary(n.p, { layout: null, notice: null });
      expect([never.shell, never.card], 'never chose: the new layout and the card').toEqual([true, true]);
      await n.ctx.close();
      const c = await own();
      const control = await launchWithLibrary(c.p, { layout: 'classic', notice: 'seen' });
      expect([control.shell, control.card], 'the control (a v16.8 classic choice): classic, no card').toEqual([false, false]);
      await c.ctx.close();
      expect([...n.dialogs, ...c.dialogs], 'no native dialog in the other two contexts').toEqual([]);

      for (const [name, r] of [['1 B', moved1B], ['never', never], ['control', control]] as const) {
        expect(r.after.blobs.map((b) => [b.fileName, b.size]), `${name}: the blobs untouched`).toEqual(r.before.blobs.map((b) => [b.fileName, b.size]));
        expect(r.reloaded.blobs.length, `${name}: every blob after the reload`).toBe(DATA_TRACKS);
        expect(idbChanges(r.before, r.after).filter((x) => x !== LAUNCH_SNAPSHOT), `${name}: IndexedDB unchanged but the launch snapshot`).toEqual([]);
        expect(idbChanges(r.before, r.reloaded).filter((x) => x !== LAUNCH_SNAPSHOT), `${name}: and after the reload`).toEqual([]);
      }
      expect(idbChanges(moved1B.before, moved1B.after), '1 B: IndexedDB as the control').toEqual(idbChanges(control.before, control.after));
      expect(idbChanges(never.before, never.after), 'never: IndexedDB as the control').toEqual(idbChanges(control.before, control.after));
      expect(idbChanges(moved1B.before, moved1B.reloaded), '1 B after the reload: as the control').toEqual(idbChanges(control.before, control.reloaded));
      expect(idbChanges(never.before, never.reloaded), 'never after the reload: as the control').toEqual(idbChanges(control.before, control.reloaded));

      const ls = { moved1B: lsChanges(moved1B.before, moved1B.after), never: lsChanges(never.before, never.after), control: lsChanges(control.before, control.after) };
      expect(otherLines(ls.moved1B), '1 B: localStorage as the control, but the layout keys').toEqual(otherLines(ls.control));
      expect(otherLines(ls.never), 'never: localStorage as the control, but the layout keys').toEqual(otherLines(ls.control));
      expect(layoutLines(ls.moved1B), '1 B: the saved "classic" removed, the card due').toEqual([`${LAYOUT_KEY}: classic -> undefined`, `${NOTICE_KEY}: undefined -> due`]);
      expect(layoutLines(ls.never), 'never: the card due').toEqual([`${NOTICE_KEY}: undefined -> due`]);
      expect(layoutLines(ls.control), 'the control: the layout keys untouched').toEqual([]);
    });
  });
}
