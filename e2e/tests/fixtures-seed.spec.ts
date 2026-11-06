import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE, SEED_KEYS } from './fixtures';
import { TEST_PORT } from './adb';
import { newShell } from './helpers';

// v16.8 fix round 1 (tests N1, N2): the fixture's layout seed (fixtures.ts, seedLayout), on the desktop fixture
// (localTest). The suites written for classic depend on it, and the tests of the default on its absence:
//   - seeded before the tab's first load: "classic" and the moved-over card's memory ("seen"), so classic opens;
//   - once per tab: after the test clears localStorage and reloads, nothing is seeded again (the real default);
//   - `layoutSeed: null` seeds nothing;
//   - only on the tests' own origin: the same server under another origin (127.0.0.1) is never seeded.
// The device fixture's seed (inside v16.7.3's setup try) is checked by the scratch harness, not here.

const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const classicUp = (page: Page) => page.locator('header [title="Safety Protocols"]').first().waitFor({ timeout: 30_000 });

test.describe('the classic seed (the default option)', () => {
  test('S1. seeded at the first load: classic opens, the notice "seen"; after localStorage.clear() and a reload, not seeded again (the new layout, nothing saved)', async ({ page }) => {
    test.skip(ON_DEVICE, 'the desktop fixture');
    await page.goto('/');
    await classicUp(page);
    expect(await stored(page, SEED_KEYS.layout), 'seeded: the layout').toBe('classic');
    expect(await stored(page, SEED_KEYS.notice), "seeded: the card's memory").toBe('seen');
    expect(await page.evaluate(() => sessionStorage.getItem('__e2eLayoutSeeded')), 'once per tab: the flag').toBe('1');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await newShell(page).waitFor({ timeout: 30_000 });
    expect(await stored(page, SEED_KEYS.layout), 'not seeded again: no layout saved').toBeNull();
    expect(await stored(page, SEED_KEYS.notice), 'the app marks a new install itself').toBe('fresh');
  });

  test('S2. another origin of the same server (127.0.0.1) is never seeded: the new layout there, nothing saved', async ({ page }) => {
    test.skip(ON_DEVICE, 'the desktop fixture');
    await page.goto('/');
    await classicUp(page);
    expect(await stored(page, SEED_KEYS.layout), 'the test origin is seeded').toBe('classic');
    await page.goto(`http://127.0.0.1:${TEST_PORT}/`);
    expect(await page.evaluate(() => location.origin)).toBe(`http://127.0.0.1:${TEST_PORT}`);
    await newShell(page).waitFor({ timeout: 30_000 });
    expect(await stored(page, SEED_KEYS.layout), 'another origin: no layout saved').toBeNull();
    expect(await stored(page, SEED_KEYS.notice), 'another origin: the app marks it itself').toBe('fresh');
  });
});

test.describe('layoutSeed: null', () => {
  test.use({ layoutSeed: null });

  test('S3. seeds nothing: the new layout, no layout saved, the notice marked by the app', async ({ page }) => {
    test.skip(ON_DEVICE, 'the desktop fixture');
    await page.goto('/');
    await newShell(page).waitFor({ timeout: 30_000 });
    expect(await stored(page, SEED_KEYS.layout)).toBeNull();
    expect(await stored(page, SEED_KEYS.notice)).toBe('fresh');
    expect(await page.evaluate(() => sessionStorage.getItem('__e2eLayoutSeeded')), 'no seed ran').toBeNull();
  });
});
