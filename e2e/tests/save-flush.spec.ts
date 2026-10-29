import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE, watchNativeDialogs } from './fixtures';
import {
  acceptDisclaimer,
  acceptDisclaimerNew,
  addFiles,
  appUrl,
  cacheCounts,
  closeSecondTab,
  confirmDelete,
  controllableVisibility,
  countBlobSaves,
  countStatePuts,
  crashPage,
  expectLibraryAtLeast,
  holdRestore,
  libraryRowButton,
  libraryState,
  lifecycleLine,
  lifecycleLog,
  localPagesBesides,
  openLibraryTab,
  recordLifecycle,
  rowMenu,
  savedState,
  secondTab,
  seedToneLibrary,
  statePutLibraries,
  statePuts,
  toneWav,
  LAYER_ENGINE_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
} from './helpers';
import { TEST_PORT } from './adb';

// v16.0.1, the hide flush (spec §5.3). A change to the play state is saved 2 s after it settles (the debounce); a page
// reloaded, closed, navigated away from or killed in the background within those 2 s lost it (v16.0: 30 of 30). Now the
// save that is waiting runs when the page is hidden or goes away (visibilitychange hidden, pagehide, freeze): the same
// save, its state record first through a connection opened while it waited, committed explicitly. These tests make each
// change, then end the page 300 ms later (inside the debounce: each checks that the save is still waiting then), and
// read what came back: the record from a page with no app on it, or the restore of the reloaded app.
// The probe's method (scratchpad v1601/probes): 10 synthetic tones, tone k lasting 6 + 0.25 k s (30 + 0.25 k s where
// music would otherwise advance mid-test), each with a crystal; the new layout at phone size; classic layers (no output
// question); every test waits for the launch's own save first, so nothing is pending when the change is made.
// Playwright keeps every page visible, so "hidden" is controllableVisibility's synthetic one, installed only in the tests
// that hide (it fixes visibilityState for the page's life, which would also hide the real visibilitychange an exit
// fires: the exits F1-F6 and F8 keep the browser's own events). A background kill is CDP
// Page.crash. Must fail on v16.0 (§5.4): F1-F9, F11, F13. F10 and F14 guard behaviour v16.0 already has. F15 (Reload for
// an update during a slow restore) fails on any build whose flushAndReload ignores the load gate. F16 tests crashPage.

const N = 10;
const toneName = (k: number) => `tone-${String(k).padStart(2, '0')}`;
/** Tones long enough that nothing advances by itself while a test runs (the default ones last 6.25-8.5 s). */
const LONG = Array.from({ length: N }, (_, i) => 30 + 0.25 * (i + 1));

type Layout = 'new' | 'classic';

/** Before the app, on every load of the tab: the tutorial seen, classic layers (no output question), the layout; a tap
 *  wrapper (a queue call inside a click: a tap's priority); the state-record put counter; the synthetic visibility. */
async function instrument(page: Page, layout: Layout, o: { hide?: boolean } = {}): Promise<void> {
  await page.addInitScript(({ keys, layout }) => {
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      localStorage.setItem(keys.engine, 'classic');
      localStorage.setItem(keys.layout, layout);
    } catch {
      // No storage here (about:blank): nothing to seed.
    }
    (window as any).__tap = (f: () => void) => {
      const b = document.createElement('button');
      b.addEventListener('click', () => f());
      document.body.appendChild(b);
      b.click();
      b.remove();
    };
  }, { keys: { engine: LAYER_ENGINE_KEY, layout: LAYOUT_KEY }, layout });
  await countStatePuts(page);
  if (o.hide) await controllableVisibility(page);
}

/** Load the app over the seeded library and wait until it has restored and made its own launch save. */
async function launch(page: Page, layout: Layout, path = '/'): Promise<void> {
  if (layout === 'new') await page.setViewportSize(PHONE_VIEWPORT);
  await page.goto(appUrl(path));
  if (layout === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library restores', timeout: 60_000 }).toBeGreaterThan(0);
  await page.waitForFunction(() => typeof (window as any).__aetheriaQueue?.state === 'function', null, { timeout: 10_000 });
}

/** The seeded app, steady: restored, and its launch save made (2 s after the restore + the 2 s debounce). */
async function open(page: Page, o: { layout?: Layout; cursor?: number; seconds?: number[]; noCrystal?: number[]; hide?: boolean } = {}): Promise<string[]> {
  const layout = o.layout ?? 'new';
  await instrument(page, layout, { hide: o.hide });
  const ids = await seedToneLibrary(page, { n: N, cursor: o.cursor ?? 0, seconds: o.seconds, noCrystal: o.noCrystal });
  await launch(page, layout);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(N);
  await expect.poll(() => statePuts(page), { message: "the launch's own save", timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300);
  return ids;
}

const qstate = (page: Page) => page.evaluate(() => (window as any).__aetheriaQueue.state());
const idOf = async (page: Page, name: string) => {
  const s = await libraryState(page);
  return s.libraryIds[s.libraryNames.indexOf(name)];
};
/** Play next / Add to queue, as a tap. */
async function queue(page: Page, names: string[], mode: 'next' | 'queue'): Promise<void> {
  const ids = await Promise.all(names.map((n) => idOf(page, n)));
  await page.evaluate(({ ids, mode }) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(ids, mode)), { ids, mode });
}
/** Next (Now Playing's in the new layout, the player bar's in classic), until the cursor is `k`. */
async function next(page: Page, k: number): Promise<void> {
  const button = (await page.getByTestId('view-now').isVisible().catch(() => false))
    ? page.getByTestId('view-now').getByRole('button', { name: 'Next track', exact: true })
    : page.getByRole('button', { name: 'Next track', exact: true }).first();
  await button.click();
  await expect.poll(async () => (await libraryState(page)).cursor, { message: `Next: the cursor on ${k}` }).toBe(k);
}
const hide = (page: Page, hidden: boolean) => page.evaluate((h) => (window as any).__setHidden(h), hidden);

/**
 * On the phone, a tab that goes away while its media card is PLAYING can strand the card (v14.6), and the car's keys
 * then go to it. So there the music is paused before the page goes (a DOM click on Pause: the pause is never saved and
 * schedules no save, so the waiting save is the same). Elsewhere nothing is done.
 */
async function quietOnDevice(page: Page): Promise<void> {
  if (!ON_DEVICE) return;
  await page.evaluate(() => {
    const pause = Array.from(document.querySelectorAll('button[aria-label="Pause"]')).find((b) => (b as HTMLElement).offsetParent !== null);
    (pause as HTMLElement | undefined)?.click();
  });
  await expect.poll(async () => (await libraryState(page)).playing, { message: 'paused before the page goes', timeout: 5_000 }).toBe(false);
}

/** Wait until `ms` after the change (t0), then check that its save is still waiting: a page that went after the
 *  debounce had saved would prove nothing. */
async function exitAt(page: Page, t0: number, puts0: number, ms = 300): Promise<void> {
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  expect(await statePuts(page), 'the save is still waiting when the page goes (inside the 2 s debounce)').toBe(puts0);
}

/** After a reload or a return: the app restored (the library back). */
async function restored(page: Page, layout: Layout, n = N): Promise<void> {
  if (layout === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library restores', timeout: 60_000 }).toBe(n);
}

// ---------------------------------------------------------------------------------------------------------------
// F1-F5: each play-state action, then a reload 300 ms later (E2).
// ---------------------------------------------------------------------------------------------------------------

test('F1. Next, then a reload 300 ms later: the restored cursor and track are the new ones @mobile', async ({ page }) => {
  const ids = await open(page);
  const puts0 = await statePuts(page);
  const t0 = Date.now();
  await next(page, 1);
  await quietOnDevice(page);
  await exitAt(page, t0, puts0);
  await page.reload();
  await restored(page, 'new');
  await expect.poll(async () => { const s = await libraryState(page); return [s.cursor, s.current]; }, { message: 'the restored cursor', timeout: 10_000 }).toEqual([1, toneName(2)]);
  expect((await savedState(page))?.currentSongIndex, 'the record').toBe(1);
  await expectLibraryAtLeast(page, ids);
});

test('F2. A Library row tap (tone-05), then a reload 300 ms later: the restored order and cursor are the tap’s', async ({ page }) => {
  const ids = await open(page);
  await openLibraryTab(page);
  const puts0 = await statePuts(page);
  const t0 = Date.now();
  await libraryRowButton(page, toneName(5)).click();
  await expect.poll(async () => (await libraryState(page)).current, { message: 'the tap plays tone-05' }).toBe(toneName(5));
  const tapped = await libraryState(page);
  await quietOnDevice(page);
  await exitAt(page, t0, puts0);
  await page.reload();
  await restored(page, 'new');
  await expect.poll(async () => { const s = await libraryState(page); return [s.ids, s.cursor, s.current]; }, { message: 'the tap’s order and cursor', timeout: 10_000 })
    .toEqual([tapped.ids, tapped.cursor, toneName(5)]);
  await expectLibraryAtLeast(page, ids);
});

test('F3. Play next (tone-07), then a reload 300 ms later: tone-07 waits right after the cursor; the order has 11 @mobile', async ({ page }) => {
  const ids = await open(page);
  const puts0 = await statePuts(page);
  const t0 = Date.now();
  await queue(page, [toneName(7)], 'next');
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'Play next' }).toEqual([toneName(7)]);
  await exitAt(page, t0, puts0);
  await page.reload();
  await restored(page, 'new');
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'the restored queue', timeout: 10_000 }).toEqual([toneName(7)]);
  const s = await libraryState(page);
  const q = await qstate(page);
  expect([s.ids.length, q.waiting[0] - s.cursor, s.current], 'order 11, tone-07 right after the cursor, the cursor on tone-01').toEqual([11, 1, toneName(1)]);
  await expectLibraryAtLeast(page, ids);
});

test('F4. Two queued and saved, the second moved to the top, then a reload 300 ms later: the moved order is back', async ({ page }) => {
  const ids = await open(page);
  let puts = await statePuts(page);
  await queue(page, [toneName(7), toneName(8)], 'queue');
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([toneName(7), toneName(8)]);
  await expect.poll(async () => (await savedState(page))?.queue?.waiting?.length ?? 0, { message: 'the two queued are saved', timeout: 10_000 }).toBe(2);
  await expect.poll(() => statePuts(page)).toBeGreaterThan(puts);
  await page.waitForTimeout(300);
  puts = await statePuts(page);
  const e = await page.evaluate(() => {
    const q = (window as any).__aetheriaQueue.state();
    const s = (window as any).__aetheriaLibrary.state();
    const index = (q.waiting as number[]).find((i) => s.names[i] === 'tone-08')!;
    return { index, id: s.ids[index] };
  });
  const t0 = Date.now();
  await page.evaluate((e) => (window as any).__tap(() => (window as any).__aetheriaQueue.edit({ move: { ...e, to: 0 } })), e);
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'tone-08 moved to the top' }).toEqual([toneName(8), toneName(7)]);
  await exitAt(page, t0, puts);
  await page.reload();
  await restored(page, 'new');
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'the moved order', timeout: 10_000 }).toEqual([toneName(8), toneName(7)]);
  await expectLibraryAtLeast(page, ids);
});

test('F5. The cursor on tone-05, tone-08 queued and saved, tone-02 deleted, then a reload 300 ms later: still tone-05, the queue kept, 9 tracks', async ({ page }) => {
  const ids = await open(page, { cursor: 4 });
  expect((await libraryState(page)).current).toBe(toneName(5));
  await queue(page, [toneName(8)], 'next');
  await expect.poll(async () => (await savedState(page))?.queue?.waiting?.length ?? 0, { message: 'tone-08 queued and saved', timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(300);
  const deleted = await idOf(page, toneName(2));
  await openLibraryTab(page);
  await rowMenu(page, toneName(2)).click();
  await page.getByTestId('library-menu-delete').click();
  const puts0 = await statePuts(page);
  const t0 = Date.now();
  await confirmDelete(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the delete' }).toBe(9);
  await exitAt(page, t0, puts0);
  await page.reload();
  await restored(page, 'new', 9);
  await expect.poll(async () => { const s = await libraryState(page); return [s.current, s.libraryIds.includes(deleted)]; }, { message: 'still on tone-05; tone-02 gone', timeout: 10_000 })
    .toEqual([toneName(5), false]);
  expect((await qstate(page)).waitingNames, 'the queue is still there').toEqual([toneName(8)]);
  const st = await savedState(page);
  expect([new Set(st?.originalOrder).size, st?.currentSongIndex], 'the record: 9 tracks, the cursor on tone-05').toEqual([9, 3]);
  await expectLibraryAtLeast(page, ids.filter((id) => id !== deleted));
});

// ---------------------------------------------------------------------------------------------------------------
// F6, F7: the other ways a page goes (E1).
// ---------------------------------------------------------------------------------------------------------------

test('F6a. Next, then the tab closed (beforeunload run) 300 ms later: the cursor is kept', async ({ page }) => {
  const ids = await open(page);
  const puts0 = await statePuts(page);
  const t0 = Date.now();
  await next(page, 1);
  await quietOnDevice(page);
  await exitAt(page, t0, puts0);
  const closed = new Promise((resolve) => page.once('close', resolve));
  await page.close({ runBeforeUnload: true });
  await closed;
  const tab = await secondTab(page);
  try {
    await instrument(tab, 'new');
    await launch(tab, 'new');
    await restored(tab, 'new');
    await expect.poll(async () => { const s = await libraryState(tab); return [s.cursor, s.current]; }, { message: 'the cursor kept', timeout: 10_000 }).toEqual([1, toneName(2)]);
    await expectLibraryAtLeast(tab, ids);
  } finally {
    await closeSecondTab(tab);
  }
});

test('F6b. Next, then a same-origin navigation 300 ms later: the record holds the cursor, and the app comes back on it', async ({ page }) => {
  const ids = await open(page);
  const puts0 = await statePuts(page);
  const t0 = Date.now();
  await next(page, 1);
  await quietOnDevice(page);
  await exitAt(page, t0, puts0);
  await page.goto(appUrl('/manifest.json'));
  expect((await savedState(page))?.currentSongIndex, 'the record, read with no app on the page').toBe(1);
  await expectLibraryAtLeast(page, ids);
  await page.goto(appUrl('/'));
  await restored(page, 'new');
  await expect.poll(async () => { const s = await libraryState(page); return [s.cursor, s.current]; }, { message: 'the cursor kept', timeout: 10_000 }).toEqual([1, toneName(2)]);
});

test('F7. Next, a hide, then the renderer killed 50 ms later (the phone’s background kill): the cursor is kept @mobile', async ({ page }) => {
  const ids = await open(page, { hide: true });
  const puts0 = await statePuts(page);
  const t0 = Date.now();
  await next(page, 1);
  await quietOnDevice(page);
  await exitAt(page, t0, puts0);
  await hide(page, true);
  await page.waitForTimeout(50);
  await crashPage(page);
  const tab = await secondTab(page);
  try {
    await instrument(tab, 'new');
    await launch(tab, 'new');
    await restored(tab, 'new');
    await expect.poll(async () => { const s = await libraryState(tab); return [s.cursor, s.current]; }, { message: 'the cursor kept', timeout: 10_000 }).toEqual([1, toneName(2)]);
    await expectLibraryAtLeast(tab, ids);
  } finally {
    await closeSecondTab(tab);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// F8: the back/forward cache (E3). Playwright launches Chrome with it switched off (--disable-back-forward-cache); a
// user's Chrome has it on. A launch option is worker-scoped (test.use can't change it per test), so each F8 test
// launches its own Chrome without that switch. Desktop only.
// ---------------------------------------------------------------------------------------------------------------

/** A page of a Chrome with the back/forward cache on, as a user runs it; closed after `fn`. */
async function inBfcacheChrome(
  playwright: { chromium: { launch: (o: object) => Promise<any> } },
  baseURL: string | undefined,
  fn: (page: Page) => Promise<void>
): Promise<void> {
  const browser = await playwright.chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required'],
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
  });
  try {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
    const page: Page = await context.newPage();
    const dialogs = watchNativeDialogs(page);
    await recordLifecycle(page);
    await fn(page);
    expect(dialogs).toEqual([]);
  } finally {
    await browser.close();
  }
}

test('F8a. The back/forward cache, nothing played: Play next, a navigation 300 ms later: the record holds the queue while away; after Back (the same page, from the cache) nothing more is written; a later change saves', async ({ playwright, baseURL }) => {
  test.skip(ON_DEVICE, 'desktop only: it launches its own Chrome with the back/forward cache on');
  await inBfcacheChrome(playwright, baseURL, async (page) => {
    const ids = await open(page);
    const puts0 = await statePuts(page);
    const t0 = Date.now();
    await queue(page, [toneName(7)], 'next');
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([toneName(7)]);
    await exitAt(page, t0, puts0);
    await page.goto(appUrl('/manifest.json'));
    const away = await savedState(page);
    expect([away?.playlistOrder?.length, away?.queue], 'the record read while away holds the queue').toEqual([11, { waiting: [1], played: [] }]);
    await expectLibraryAtLeast(page, ids);
    // A page restored from the cache fires no load event: wait for the commit only.
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForFunction(() => !!(window as any).__aetheriaLibrary, null, { timeout: 30_000 });
    const log = await lifecycleLog(page);
    test.info().annotations.push({ type: 'F8a events', description: lifecycleLine(log) });
    expect(log.some((x) => x.e === 'pageshow' && x.persisted === true), 'Back restores the same page from the cache (pageshow persisted)').toBe(true);
    expect(await statePuts(page), "the launch's save and the flush's").toBe(puts0 + 1);
    await page.waitForTimeout(3000);
    expect(await statePuts(page), 'after Back, nothing more is written in 3 s').toBe(puts0 + 1);
    await queue(page, [toneName(9)], 'queue');
    await expect.poll(async () => (await savedState(page))?.queue?.waiting?.length ?? 0, { message: 'a later change saves', timeout: 10_000 }).toBe(2);
  });
});

test('F8b. The back/forward cache, after a play: Next, a navigation 300 ms later, Back: a fresh load (never cached once anything played) that restores the new cursor', async ({ playwright, baseURL }) => {
  test.skip(ON_DEVICE, 'desktop only: it launches its own Chrome with the back/forward cache on');
  await inBfcacheChrome(playwright, baseURL, async (page) => {
    const ids = await open(page, { seconds: LONG });
    const puts0 = await statePuts(page);
    const t0 = Date.now();
    await next(page, 1);
    await exitAt(page, t0, puts0);
    await page.goto(appUrl('/manifest.json'));
    await page.goBack({ waitUntil: 'commit' });
    await restored(page, 'new');
    // Chrome evicts a page that has played: App's initAudio makes a MediaStreamAudioDestinationNode (the recorder's).
    const nav = await page.evaluate(() => {
      const e: any = performance.getEntriesByType('navigation')[0];
      const reasons: string[] = [];
      const walk = (r: any) => {
        if (!r) return;
        for (const x of r.reasons ?? []) reasons.push(x.reason);
        for (const c of r.children ?? []) walk(c);
      };
      walk(e?.notRestoredReasons);
      return { type: e?.type as string, reasons };
    });
    const log = await lifecycleLog(page);
    test.info().annotations.push({ type: 'F8b events', description: `${lifecycleLine(log)}; navigation ${nav.type}, not restored: ${nav.reasons.join(', ')}` });
    expect([nav.type, nav.reasons.includes('mediastream')], 'Back is a fresh load (the not-restored reason: mediastream)').toEqual(['back_forward', true]);
    await expect.poll(async () => { const s = await libraryState(page); return [s.cursor, s.current]; }, { message: 'the new cursor restored', timeout: 10_000 }).toEqual([1, toneName(2)]);
    await expectLibraryAtLeast(page, ids);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// F9: no extra writes (E6).
// ---------------------------------------------------------------------------------------------------------------

test('F9. No extra writes: hides with nothing pending write nothing; each flush writes once, the cancelled timer and the show nothing; pagehide and freeze alone flush; a show alone does not; no audio @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  await countBlobSaves(page);
  const ids = await open(page, { seconds: LONG, hide: true });
  await page.waitForTimeout(2000);
  const blobs0 = await page.evaluate(() => (window as any).__blobSaveRuns as number);
  let p = await statePuts(page);
  for (let i = 0; i < 5; i++) {
    await hide(page, true);
    await page.waitForTimeout(100);
    await hide(page, false);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500);
  expect(await statePuts(page), 'five hide/show cycles with nothing pending: nothing written').toBe(p);

  // Next, a hide: one write at the hide; none from the cancelled timer; none on the show.
  await next(page, 1);
  await page.waitForTimeout(300);
  expect(await statePuts(page), 'the save waits (the debounce)').toBe(p);
  await hide(page, true);
  await expect.poll(() => statePuts(page), { message: 'the hide flushed it', timeout: 1_000, intervals: [50] }).toBe(p + 1);
  await page.waitForTimeout(3000);
  expect(await statePuts(page), 'the cancelled timer wrote nothing').toBe(p + 1);
  await hide(page, false);
  await page.waitForTimeout(500);
  expect(await statePuts(page), 'the show wrote nothing').toBe(p + 1);
  expect((await savedState(page))?.currentSongIndex).toBe(1);
  await expectLibraryAtLeast(page, ids);
  p += 1;

  // pagehide alone (no visibility change), after a change.
  await next(page, 2);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(() => statePuts(page), { message: 'pagehide alone flushed it', timeout: 1_000, intervals: [50] }).toBe(p + 1);
  await page.waitForTimeout(3000);
  expect(await statePuts(page), 'and nothing more').toBe(p + 1);
  expect((await savedState(page))?.currentSongIndex).toBe(2);
  p += 1;

  // freeze alone, after a change.
  await next(page, 3);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.dispatchEvent(new Event('freeze')));
  await expect.poll(() => statePuts(page), { message: 'freeze alone flushed it', timeout: 1_000, intervals: [50] }).toBe(p + 1);
  await page.waitForTimeout(3000);
  expect(await statePuts(page), 'and nothing more').toBe(p + 1);
  expect((await savedState(page))?.currentSongIndex).toBe(3);
  p += 1;

  // Last: a change, then a visibilitychange to visible (no hide): no flush; the debounce saves 2 s after the change.
  await next(page, 4);
  await page.waitForTimeout(300);
  await hide(page, false);
  await page.waitForTimeout(500);
  expect(await statePuts(page), 'a visibilitychange to visible writes nothing').toBe(p);
  await expect.poll(() => statePuts(page), { message: 'the debounce saves it', timeout: 5_000 }).toBe(p + 1);
  expect(await page.evaluate(() => (window as any).__blobSaveRuns as number), 'no audio saved: the flush never writes blobs').toBe(blobs0);
});

// ---------------------------------------------------------------------------------------------------------------
// F10, F11: the gates (E4).
// ---------------------------------------------------------------------------------------------------------------

test('F10. Deep Scan running: Next and a hide write nothing while it scans; once it settles, its save holds the new cursor', async ({ page }) => {
  test.setTimeout(180_000);
  // Every decode held while __holdDecode is set, so the scan stays running.
  await page.addInitScript(() => {
    const w = window as any;
    w.__holdDecode = false;
    w.__held = [];
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: any[]) {
      if (!w.__holdDecode) return (decode as any).apply(this, a);
      return new Promise((resolve, reject) => { w.__held.push(() => (decode as any).apply(this, a).then(resolve, reject)); });
    } as any;
    w.__releaseDecodes = () => { w.__holdDecode = false; const h = w.__held; w.__held = []; h.forEach((f: () => void) => f()); };
  });
  const seconds = Array.from({ length: N }, (_, i) => (i < 5 ? LONG[i] : 6 + 0.25 * (i + 1)));
  const ids = await open(page, { layout: 'classic', seconds, noCrystal: [6, 7, 8, 9, 10], hide: true });
  await page.evaluate(() => { (window as any).__holdDecode = true; });
  await page.getByRole('button', { name: /^Deep Scan/ }).click();
  await page.waitForFunction(() => (window as any).__held.length > 0, null, { timeout: 15_000 });
  const puts0 = await statePuts(page);
  await next(page, 1);
  await page.waitForTimeout(300);
  await hide(page, true);
  await page.waitForTimeout(2600);
  expect(await statePuts(page), 'nothing written while Deep Scan runs (the hide found nothing waiting)').toBe(puts0);
  await hide(page, false);
  await page.evaluate(() => (window as any).__releaseDecodes());
  await expect.poll(async () => (await libraryState(page)).scanned.every(Boolean), { message: 'the scan settles', timeout: 90_000 }).toBe(true);
  await expect
    .poll(async () => { const st = await savedState(page); const s = await libraryState(page); return st?.currentSongIndex === s.cursor && s.cursor >= 1; }, { message: 'the settle save holds the new cursor', timeout: 15_000 })
    .toBe(true);
  await expectLibraryAtLeast(page, ids);
});

test('F11. The load gate: an import while the saved library is still restoring; neither a hide nor the debounce writes before the restore lands; then the merged 11 are saved', async ({ page }) => {
  test.setTimeout(150_000);
  await instrument(page, 'classic', { hide: true });
  await holdRestore(page);
  const ids = await seedToneLibrary(page, { n: N, cursor: 0 });
  await page.goto(appUrl('/'));
  await acceptDisclaimer(page);
  await page.waitForFunction(() => typeof (window as any).__releaseRestore === 'function' && (window as any).__restoreHeld > 0 && !!(window as any).__aetheriaLibrary, null, { timeout: 30_000 });
  expect((await libraryState(page)).libraryIds.length, 'the restore is held').toBe(0);
  await addFiles(page, [{ name: 'tone-11.wav', mimeType: 'audio/wav', buffer: toneWav(8.75, 330) }]);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the import alone, in memory' }).toBe(1);
  await page.waitForTimeout(400);
  await hide(page, true);
  await page.waitForTimeout(300);
  expect(await statePuts(page), 'the hide wrote nothing (the gate)').toBe(0);
  expect(new Set((await savedState(page))?.originalOrder).size, 'the record still names the 10 stored tracks').toBe(N);
  await expectLibraryAtLeast(page, ids, 'after the hide, the saved library');
  await hide(page, false);
  await page.waitForTimeout(2600);
  expect(await statePuts(page), 'the debounce wrote nothing either (the gate holds its timer)').toBe(0);
  expect(new Set((await savedState(page))?.originalOrder).size, 'the record still names the 10 stored tracks').toBe(N);
  await expectLibraryAtLeast(page, ids, 'after the debounce, the saved library');
  await page.evaluate(() => (window as any).__releaseRestore());
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the restore lands, merged', timeout: 30_000 }).toBe(11);
  await expect.poll(async () => new Set((await savedState(page))?.originalOrder).size, { message: 'the merged 11 are saved', timeout: 15_000 }).toBe(11);
  // The import alone was dropped, not written and then overwritten by the merge: the page's only state put is the
  // merged 11's (a second save comes 2 s after a change at the earliest, so none can have followed it yet).
  expect((await statePutLibraries(page)).filter((n) => n !== 11), 'every state put named the merged 11 (never the import alone)').toEqual([]);
  expect(await statePuts(page), 'one state put in all: the merged 11').toBe(1);
  await expectLibraryAtLeast(page, ids);
});

// ---------------------------------------------------------------------------------------------------------------
// F13, F14: the version guard (E5) and the epoch.
// ---------------------------------------------------------------------------------------------------------------

test('F13. An older save still opening its connection when the flush writes a newer one: the record keeps the newer cursor', async ({ page }) => {
  // Hold the success of every 'aetheria-db' open made while __holdOpen is set (openDB sets onsuccess on its request).
  await page.addInitScript(() => {
    const w = window as any;
    w.__holdOpen = null;
    w.__heldOpens = 0;
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, ...a: any[]) {
      const real: IDBOpenDBRequest = (open as any).apply(this, a);
      const gate = w.__holdOpen;
      if (!gate || a[0] !== 'aetheria-db') return real;
      w.__heldOpens++;
      return new Proxy(real, {
        set(t, k, v) {
          if (k === 'onsuccess' && typeof v === 'function') { t.onsuccess = (ev) => { gate.then(() => v.call(t, ev)); }; return true; }
          (t as any)[k] = v;
          return true;
        },
        get(t, k) { const x = (t as any)[k]; return typeof x === 'function' ? x.bind(t) : x; },
      });
    } as any;
  });
  const ids = await open(page, { seconds: LONG, hide: true });
  await next(page, 1);
  await page.waitForTimeout(300);
  // Save A (cursor 1) fires 2 s after Next; its open is held, so it is still opening when the flush writes.
  await page.evaluate(() => { const w = window as any; w.__holdOpen = new Promise((r) => (w.__releaseOpen = r)); });
  await page.waitForFunction(() => (window as any).__heldOpens >= 1, null, { timeout: 5_000 });
  await page.evaluate(() => { (window as any).__holdOpen = null; });
  await next(page, 2);
  await page.waitForTimeout(200);
  await hide(page, true);
  await expect.poll(async () => (await savedState(page))?.currentSongIndex, { message: 'the flush wrote the newer cursor (at once: the debounce would take 2 s)', timeout: 1_000 }).toBe(2);
  await page.evaluate(() => (window as any).__releaseOpen());
  await page.waitForTimeout(1000);
  expect((await savedState(page))?.currentSongIndex, 'the older save did not put its cursor back').toBe(2);
  await page.waitForTimeout(2000);
  expect((await savedState(page))?.currentSongIndex, 'and nothing changes it later').toBe(2);
  await expectLibraryAtLeast(page, ids);
});

test('F14. Clear right after a change, then a hide: nothing is written; the stores stay empty', async ({ page }) => {
  await open(page, { layout: 'classic', hide: true });
  const puts0 = await statePuts(page);
  await next(page, 1);
  await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
  expect(await statePuts(page), 'the change’s save is still waiting at the Clear').toBe(puts0);
  await page.getByRole('button', { name: /^Confirm deleting all 10 tracks/ }).click();
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the Clear' }).toBe(0);
  await expect.poll(async () => { const c = await cacheCounts(page); return [c.blobs, c.meta, c.library]; }, { message: 'the stores are empty', timeout: 10_000 }).toEqual([0, 0, 0]);
  const puts1 = await statePuts(page);
  await hide(page, true);
  await page.waitForTimeout(1000);
  expect(await statePuts(page), 'the hide wrote nothing').toBe(puts1);
  expect(await savedState(page), 'no state record').toBeNull();
  const c = await cacheCounts(page);
  expect([c.blobs, c.meta, c.library], 'the stores stay empty').toEqual([0, 0, 0]);
});

// ---------------------------------------------------------------------------------------------------------------
// F15: Reload for an update while the saved library is still restoring (flushAndReload and the load gate).
// ---------------------------------------------------------------------------------------------------------------

test('F15. Reload for an update after an import, while the saved library is still restoring: the stored library is not saved over; after the reload all 10 are back and the import is offered to recover', async ({ page }) => {
  test.setTimeout(150_000);
  await instrument(page, 'classic');
  await holdRestore(page); // the first load's only: the reloaded app restores at once
  const ids = await seedToneLibrary(page, { n: N, cursor: 0 });
  await page.goto(appUrl('/'));
  await acceptDisclaimer(page);
  await page.waitForFunction(() => typeof (window as any).__releaseRestore === 'function' && (window as any).__restoreHeld > 0 && !!(window as any).__aetheriaLibrary, null, { timeout: 30_000 });
  expect((await libraryState(page)).libraryIds.length, 'the restore is held').toBe(0);
  await addFiles(page, [{ name: 'tone-11.wav', mimeType: 'audio/wav', buffer: toneWav(8.75, 330) }]);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the import alone, in memory' }).toBe(1);
  const imported = (await libraryState(page)).libraryIds[0];
  // The update banner (a new service worker raises it; blocked in tests), and its Reload: flushAndReload. The restore
  // is still held, so the lists in memory hold the import alone.
  await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
  expect(await statePuts(page), 'nothing saved the state before the reload').toBe(0);
  await Promise.all([
    page.waitForEvent('load', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Reload', exact: true }).click(),
  ]);
  await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds, { message: 'the stored library is all back, in its order', timeout: 60_000 }).toEqual(ids);
  expect((await savedState(page))?.originalOrder, 'the record still names the stored 10').toEqual(ids);
  // The import's audio was stored before the reload (add-only), so it is offered back: an orphan to recover.
  await expect(page.getByText('Found 1 stored track that is not in your library.')).toBeVisible({ timeout: 10_000 });
  expect((await cacheCounts(page)).blobs, 'the 10 and the import stored').toBe(N + 1);
  await page.getByRole('button', { name: 'Recover 1' }).click();
  await expect.poll(async () => (await libraryState(page)).libraryIds, { message: 'Recover brings the import back after the 10', timeout: 10_000 }).toEqual([...ids, imported]);
  await expect.poll(async () => (await savedState(page))?.originalOrder?.length ?? 0, { message: 'and the 11 are saved', timeout: 15_000 }).toBe(N + 1);
  await expectLibraryAtLeast(page, [...ids, imported]);
});

// ---------------------------------------------------------------------------------------------------------------
// F16: crashPage itself (F7, D1, D2). Page.crash kills the tab's whole renderer process, and a port is not part of a
// site: another local origin (on the phone, the user's localhost:3100 tab) could share it.
// ---------------------------------------------------------------------------------------------------------------

test('F16. crashPage refuses while a page of another local origin is open anywhere in the browser, and the test tab lives on', async ({ page }) => {
  test.skip(ON_DEVICE, 'desktop only: it opens pages of other local origins');
  await page.goto(appUrl('/manifest.json'));
  const crashes: string[] = [];
  page.on('crash', () => crashes.push(page.url()));
  // Another context of the same browser: the check covers every page the browser knows, not only the test's context.
  const other = await page.context().browser()!.newContext({ serviceWorkers: 'block' });
  try {
    // Answered by the route: no request leaves the browser, so no server and no one else's port is touched.
    await other.route(/^http:\/\/(127\.0\.0\.1|localhost):\d+\//, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>other</title><p>another local origin</p>' }));
    const tab = await other.newPage();
    for (const url of [`http://127.0.0.1:${TEST_PORT}/`, `http://localhost:${TEST_PORT + 10000}/`]) {
      await tab.goto(url);
      expect(localPagesBesides(page), 'seen as another local origin').toEqual([url]);
      await expect(crashPage(page), `refused with ${url} open`).rejects.toThrow(/^Refusing to crash the test tab: .*Open now: /);
      await page.waitForTimeout(500);
      expect(crashes, 'the test tab was not crashed').toEqual([]);
      expect(await page.evaluate(() => 6 * 7), 'the test tab still runs script').toBe(42);
    }
    // The URL check stands too: a tab of another origin is never crashed.
    await expect(crashPage(tab)).rejects.toThrow(/^Refusing to crash http:\/\/localhost:\d+\/: only a tab of /);
    // A blank page, and another page of the test origin itself, do not count.
    await tab.goto('about:blank');
    const same = await page.context().newPage();
    try {
      await same.goto(appUrl('/manifest.json'));
      expect(localPagesBesides(page), 'about:blank and the test origin do not count').toEqual([]);
    } finally {
      await same.close();
    }
  } finally {
    await other.close();
  }
  expect(crashes, 'the test tab was never crashed').toEqual([]);
});
