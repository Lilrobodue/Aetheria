import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  openApp,
  acceptDisclaimer,
  importTones,
  addFiles,
  elapsedSeconds,
  cacheCounts,
  expectCache,
  pauseCount,
  shrinkSavedLibrary,
  stubStorageFull,
  controlStateSaves,
  toneWav,
} from './helpers';

// Tests tagged @mobile also run under an Android user agent (see the config),
// which switches on the silent media-session anchor and the mobile volume path.
// With `npm run test:device` every test runs on the phone's Chrome instead.

/** A song row in the list (it holds the row's Delete button). */
const rowOf = (page: Page, name: string) =>
  page.locator('div.group').filter({ has: page.getByText(name, { exact: true }) });

test('imports, plays, pauses, skips and advances on its own @mobile', async ({ page }) => {
  const dialogs = await openApp(page);
  // 6 s tones: the pause below must land well before the auto-advance.
  await importTones(page, 3, 6);
  await expect(page.getByText('tone-01', { exact: true })).toBeVisible();

  await page.getByText('tone-01', { exact: true }).click();
  const title = page.getByTestId('now-playing-title');
  await expect(title).toHaveText('tone-01');
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

  // Pause holds the position.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const held = await elapsedSeconds(page);
  await page.waitForTimeout(1500);
  expect(await elapsedSeconds(page)).toBe(held);

  // Resume, then skip.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Next track' }).click();
  await expect(title).toHaveText('tone-02');

  // tone-02 runs out and the player advances by itself.
  await expect(title).toHaveText('tone-03', { timeout: 20_000 });
  expect(dialogs).toEqual([]);
});

test('gapless auto-advance across distributed tracks @mobile', async ({ page }) => {
  const dialogs = await openApp(page);
  await importTones(page, 28, 3);
  // Auto-Distribute gives every track a crystal, which is what the gapless
  // (lock-screen-safe) advance path requires.
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await page.getByText('tone-01', { exact: true }).click();
  const title = page.getByTestId('now-playing-title');
  await expect(title).toHaveText('tone-01');
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  const pausesBefore = await pauseCount(page);
  await expect(title).toHaveText('tone-02', { timeout: 15_000 });
  await expect(title).toHaveText('tone-03', { timeout: 15_000 });
  // The gapless swap never pauses the element; the playTrack fallback (the
  // path that drops the lock-screen card) always does.
  expect(await pauseCount(page)).toBe(pausesBefore);
  expect(dialogs).toEqual([]);
});

test('the library survives walks, imports, Auto-Distribute and Deep Scan (v14.5 data safety)', async ({ page }) => {
  // On v14.4 every step below lost stored audio: each of these paths wrote the
  // list that was showing over the library, and the blob sync then deleted the
  // rest of the library's audio. The cache is checked before any v14.5-only UI
  // so this test fails on the data loss itself.
  const dialogs = await openApp(page);
  await importTones(page, 40, 2);
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await expectCache(page, { blobs: 40, library: 40, playOrder: 40 });

  // A 27-step Lo Shu walk: the play order becomes 27 of the 40 tracks. The walk
  // starts playing; pause it, because these 2 s test tones would otherwise
  // change track faster than the 2 s metadata-save debounce can settle.
  await page.getByRole('button', { name: /Lo Shu controls/ }).click();
  await page.getByRole('button', { name: /^Ascent/ }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expectCache(page, { library: 40, playOrder: 27 });

  // Auto-Distribute with the walk showing.
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await page.waitForTimeout(3000);
  await expectCache(page, { blobs: 40, library: 40, playOrder: 27 });

  // Import with the walk showing. (The toast is transient: wait for it from
  // before the import, so the cache check can't make it be missed.)
  const toastSeen = page.getByText(/Added 2 tracks to your library/).waitFor({ timeout: 20_000 });
  await importTones(page, 2, 2, 'extra');
  await expectCache(page, { blobs: 42, library: 42, playOrder: 27 });
  await toastSeen;

  // Deep Scan with the walk showing analyses the two unscanned LIBRARY tracks
  // (they are not in the walk) and stores their results by id.
  await expectCache(page, { analysed: 40 });
  await page.getByRole('button', { name: /^Deep Scan/ }).click();
  await expectCache(page, { analysed: 42, blobs: 42, library: 42, playOrder: 27 }, 90_000);

  // And the whole library comes back after a reload, without repeats.
  await page.reload();
  await expect(page.getByText(/Restored \d+ tracks from cache/)).toBeVisible();
  await expectCache(page, { blobs: 42, library: 42, libraryRaw: 42 });
  expect(dialogs).toEqual([]);
});

test('deleting a track removes its stored audio and keeps the current track playing on', async ({ page }) => {
  await openApp(page, { acceptDialogs: true }); // the row's Delete asks to confirm
  await importTones(page, 3, 30);
  await expectCache(page, { blobs: 3, library: 3 });
  await page.getByText('tone-03', { exact: true }).click();
  const title = page.getByTestId('now-playing-title');
  await expect(title).toHaveText('tone-03');

  // Delete a track before the current one: the current track stays current.
  await rowOf(page, 'tone-01').getByTitle('Delete song').click();
  await expect(page.getByText('tone-01', { exact: true })).toHaveCount(0);
  await expect(title).toHaveText('tone-03');
  await expectCache(page, { blobs: 2, library: 2, meta: 2 });

  await page.reload();
  await acceptDisclaimer(page);
  await expectCache(page, { blobs: 2, library: 2 });
  await expect(page.getByText('tone-02', { exact: true })).toBeVisible();
  await expect(page.getByText('tone-01', { exact: true })).toHaveCount(0);
});

test('an emptied list still saves the library, and a reload restores it', async ({ page }) => {
  await openApp(page, { acceptDialogs: true });
  await importTones(page, 28, 30);
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await expectCache(page, { blobs: 28, library: 28, playOrder: 28 });

  // A few-track preset mix, then delete every track in it.
  await page.getByRole('button', { name: /Qi Strength/ }).click();
  await expect.poll(async () => (await cacheCounts(page)).playOrder, { timeout: 15_000 }).toBeLessThan(28);
  const mix = (await cacheCounts(page)).playOrder;
  const rows = page.locator('div.group').filter({ has: page.getByTitle('Delete song') });
  for (let i = 0; i < mix; i++) await rows.first().getByTitle('Delete song').click();
  await expect(page.getByText('This list is empty')).toBeVisible();
  await expectCache(page, { blobs: 28 - mix, library: 28 - mix, playOrder: 0 });

  // Import while the list is empty (v14.4 and early v14.5 saved nothing then).
  // The emptied list shows the library again, with the import.
  await importTones(page, 2, 30, 'extra');
  await expectCache(page, { blobs: 30 - mix, library: 30 - mix, playOrder: 30 - mix });
  await expect(page.getByText('This list is empty')).toHaveCount(0);

  await page.reload();
  await acceptDisclaimer(page);
  await expect(page.getByText(/Restored \d+ tracks from cache/)).toBeVisible();
  await expectCache(page, { blobs: 30 - mix, library: 30 - mix });
});

test('stored tracks the library lost are offered back (Recover)', async ({ page }) => {
  const dialogs = await openApp(page);
  await importTones(page, 3, 30);
  await expectCache(page, { blobs: 3, library: 3 });

  // The saved lists lose the third track while its audio stays stored.
  await shrinkSavedLibrary(page, 2);
  await page.goto('/');
  await acceptDisclaimer(page);
  await expect(page.getByText('Found 1 stored track that is not in your library.')).toBeVisible();
  await page.getByRole('button', { name: 'Recover 1' }).click();
  await expectCache(page, { blobs: 3, library: 3 });

  await page.reload();
  await acceptDisclaimer(page);
  await expectCache(page, { blobs: 3, library: 3 });
  await expect(page.getByText(/not in your library/)).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('Remove copies keeps the only stored copy when its re-import could not be saved', async ({ page }) => {
  const dialogs = await openApp(page);
  await importTones(page, 3, 30);
  await expectCache(page, { blobs: 3, library: 3 });
  await shrinkSavedLibrary(page, 2); // tone-03 becomes an orphan
  await stubStorageFull(page); // from here on, nothing new fits
  await page.goto('/');
  await acceptDisclaimer(page);
  await expect(page.getByText('Found 1 stored track that is not in your library.')).toBeVisible();

  // Re-import the same file (same name and size, a new id). Its save fails,
  // and the banner now calls the stored orphan a copy.
  await addFiles(page, [{ name: 'tone-03.wav', mimeType: 'audio/wav', buffer: toneWav(30, 220 + 2 * 37) }]);
  await expect(page.getByText(/^1 track could not be saved for offline use/)).toBeVisible();
  await expect(page.getByText('Found 1 stored copy of tracks already in your library.')).toBeVisible();

  // Removing it would delete the only stored copy: it is kept.
  await page.getByRole('button', { name: 'Remove copies' }).click();
  await expect(page.getByText(/^Kept 1 stored track/)).toBeVisible();
  await expectCache(page, { blobs: 3 });

  // The re-import was never stored, so the next launch offers the orphan back.
  await page.reload();
  await acceptDisclaimer(page);
  await expect(page.getByText('Found 1 stored track that is not in your library.')).toBeVisible();
  await expectCache(page, { blobs: 3 });
  expect(dialogs).toEqual([]);
});

test("'Not now' hides the Recover banner but Clear still counts those tracks", async ({ page }) => {
  await openApp(page);
  await importTones(page, 3, 30);
  await expectCache(page, { blobs: 3, library: 3 });
  await shrinkSavedLibrary(page, 2);
  await page.goto('/');
  await acceptDisclaimer(page);
  await expect(page.getByText('Found 1 stored track that is not in your library.')).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText(/not in your library/)).toHaveCount(0);

  // Clear deletes all three stored tracks, and says so.
  await page.getByRole('button', { name: 'Clear library and cache' }).click();
  await expect(page.getByText('Tap again to delete all 3 tracks and their analysis')).toBeVisible();
});

test('a storage warning is withdrawn once a later save stores those tracks', async ({ page }) => {
  await stubStorageFull(page);
  await openApp(page, { acceptDialogs: true }); // the row Delete asks to confirm
  await importTones(page, 3, 30);
  const warning = page.getByText(/^3 tracks could not be saved for offline use/);
  await expect(warning).toBeVisible();
  await expectCache(page, { blobs: 0 });

  // Space frees up, and the next save (a delete changes the stored set) stores
  // the other two: the warning is no longer true and goes.
  await page.evaluate(() => ((window as any).__storageFull = false));
  await rowOf(page, 'tone-01').getByTitle('Delete song').click();
  await expectCache(page, { blobs: 2 });
  await expect(warning).toHaveCount(0);
});

test('Reload for an update waits when the library could not be saved', async ({ page }) => {
  await stubStorageFull(page);
  await openApp(page, { acceptDialogs: true }); // the row Delete asks to confirm
  await importTones(page, 3, 30);
  await expect(page.getByText(/^3 tracks could not be saved for offline use/)).toBeVisible();
  await page.evaluate(() => {
    (window as any).__samePage = true;
    window.dispatchEvent(new Event('aetheria:update-ready'));
  });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  // The flush can't store the import either: no reload, and a way to go ahead.
  const held = page.getByText(/couldn't be saved, so the update is waiting/);
  await expect(held).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload anyway' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__samePage)).toBe(true);

  // Space frees up and a later save stores the rest: the notice is no longer
  // true, so it goes (the update banner stays for the real reload).
  await page.evaluate(() => ((window as any).__storageFull = false));
  await rowOf(page, 'tone-01').getByTitle('Delete song').click();
  await expectCache(page, { blobs: 2 });
  await expect(held).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
});

test('a failure that a later save made good does not hold the reload', async ({ page }) => {
  // Hold every audio save 3 s in its free-space check, so the flush is still
  // running while the reports below arrive.
  await page.addInitScript(() => {
    const storage = navigator.storage as any;
    const estimate = storage.estimate.bind(storage);
    storage.estimate = () => new Promise((resolve) => setTimeout(() => resolve(estimate()), 3000));
  });
  await openApp(page);
  await importTones(page, 3, 30);
  await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByText('Saving your library before reloading…')).toBeVisible();
  // While it saves, one save fails and a save that started after it succeeds:
  // nothing is left unsaved, so the reload goes ahead.
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => {
      const fire = (type: string, detail: object) => window.dispatchEvent(new CustomEvent(type, { detail }));
      fire('aetheria:cache-error', { count: 1, reason: 'write-failed', what: 'tracks', seq: 1000 });
      fire('aetheria:cache-ok', { what: 'tracks', seq: 1001 });
    }),
  ]);
  await expect(page.getByText(/Restored 3 tracks from cache/)).toBeVisible();
});

test('cache warnings: only a later save withdraws one, and a state warning can come back', async ({ page }) => {
  await openApp(page);
  const fire = (type: string, detail: object) =>
    page.evaluate(({ type, detail }) => window.dispatchEvent(new CustomEvent(type, { detail })), { type, detail });

  const tracksWarning = page.getByText(/^3 tracks could not be saved for offline use/);
  await fire('aetheria:cache-error', { count: 3, reason: 'storage-full', what: 'tracks', seq: 10 });
  await expect(tracksWarning).toBeVisible();
  // A save that started before the failure finishing late proves nothing.
  await fire('aetheria:cache-ok', { what: 'tracks', seq: 9 });
  await expect(tracksWarning).toBeVisible();
  await fire('aetheria:cache-ok', { what: 'tracks', seq: 11 });
  await expect(tracksWarning).toHaveCount(0);

  const stateWarning = page.getByText(/^Your latest library changes could not be saved/);
  await fire('aetheria:cache-error', { count: 1, reason: 'write-failed', what: 'state', seq: 20 });
  await expect(stateWarning).toBeVisible();
  await fire('aetheria:cache-ok', { what: 'state', seq: 21 });
  await expect(stateWarning).toHaveCount(0);
  // A new spell of failures warns again (once).
  await fire('aetheria:cache-error', { count: 1, reason: 'write-failed', what: 'state', seq: 30 });
  await expect(stateWarning).toBeVisible();

  // A repeat failure in the same spell isn't shown again but still counts: a
  // state save that started before it proves nothing.
  await fire('aetheria:cache-error', { count: 1, reason: 'write-failed', what: 'state', seq: 35 });
  await fire('aetheria:cache-ok', { what: 'state', seq: 32 });
  await expect(stateWarning).toBeVisible();

  // The tracks warning outranks it; once that one is withdrawn, the state
  // warning (its spell still on) takes the slot back.
  await fire('aetheria:cache-error', { count: 3, reason: 'storage-full', what: 'tracks', seq: 40 });
  await expect(tracksWarning).toBeVisible();
  await expect(stateWarning).toHaveCount(0);
  await fire('aetheria:cache-ok', { what: 'tracks', seq: 41 });
  await expect(tracksWarning).toHaveCount(0);
  await expect(stateWarning).toBeVisible();

  // Dismissed, it stays away for the rest of the spell...
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(stateWarning).toHaveCount(0);
  await fire('aetheria:cache-error', { count: 1, reason: 'write-failed', what: 'state', seq: 42 });
  await fire('aetheria:cache-error', { count: 3, reason: 'storage-full', what: 'tracks', seq: 43 });
  await fire('aetheria:cache-ok', { what: 'tracks', seq: 44 });
  await expect(tracksWarning).toHaveCount(0);
  await expect(stateWarning).toHaveCount(0);
  // ...until a confirmed success ends it: the next failure warns again.
  await fire('aetheria:cache-ok', { what: 'state', seq: 45 });
  await fire('aetheria:cache-error', { count: 1, reason: 'write-failed', what: 'state', seq: 46 });
  await expect(stateWarning).toBeVisible();
});

test('freeing space with Discard saves the library order again, not only the audio', async ({ page }) => {
  await controlStateSaves(page);
  await openApp(page);
  await importTones(page, 3, 30);
  await expectCache(page, { blobs: 3, library: 3 });
  await shrinkSavedLibrary(page, 2); // tone-03 becomes an orphan
  await stubStorageFull(page);
  await page.goto('/');
  await acceptDisclaimer(page);
  await expect(page.getByText('Found 1 stored track that is not in your library.')).toBeVisible();

  // A full device: the import's audio can't be stored, and its state save
  // (the saved library order) fails too.
  await page.evaluate(() => ((window as any).__failStateSaves = true));
  await importTones(page, 2, 30, 'extra');
  await expect(page.getByText(/^2 tracks could not be saved for offline use/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__cacheEvents.some((e: any) => e.type === 'cache-error' && e.what === 'state')), { timeout: 10_000 })
    .toBe(true);

  // Space comes back. Discard changes no list, so its retry must save the
  // order itself — or the import comes back as orphans on the next launch.
  await page.evaluate(() => {
    (window as any).__storageFull = false;
    (window as any).__failStateSaves = false;
  });
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('button', { name: 'Tap again to delete them' }).click();
  await expectCache(page, { blobs: 4, library: 4 });
  await expect(page.getByText(/could not be saved/)).toHaveCount(0);
});

test('Reload for an update stores an import that is still being saved', async ({ page }) => {
  // Hold every audio save ~3 s in its free-space check, so the import is still
  // being saved when Reload is tapped. (Without this, these small files are
  // stored before the page goes, and the test proves nothing.)
  await page.addInitScript(() => {
    const storage = navigator.storage as any;
    const estimate = storage.estimate.bind(storage);
    storage.estimate = () => new Promise((resolve) => setTimeout(() => resolve(estimate()), 3000));
  });
  const dialogs = await openApp(page);
  await importTones(page, 3, 30);
  // The update banner (a new service worker raises it; blocked in tests).
  // Reloading without storing the import first lost it.
  await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Reload', exact: true }).click(),
  ]);
  await expect(page.getByText(/Restored 3 tracks from cache/)).toBeVisible();
  await acceptDisclaimer(page);
  await expectCache(page, { blobs: 3, library: 3 });
  expect(dialogs).toEqual([]);
});

test('the perf HUD is off unless switched on', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await openApp(page);
  await page.waitForTimeout(2500);
  expect(logs.some((l) => l.startsWith('[perf]'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('aetheria.perfhud.v1'))).toBeNull();

  await page.goto('/?perf=1');
  await expect.poll(() => logs.some((l) => l.startsWith('[perf]')), { timeout: 5_000 }).toBe(true);
  await page.goto('/?perf=0');
  expect(await page.evaluate(() => localStorage.getItem('aetheria.perfhud.v1'))).toBeNull();
});

test('cache round trips pass on a throwaway database', async ({ page }) => {
  await page.goto('/tools/cache-check.html');
  await expect(page.getByTestId('cache-check-result')).toHaveText('ALL PASS (17)', { timeout: 30_000 });
});
