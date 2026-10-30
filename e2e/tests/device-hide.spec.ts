import { chromium, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE, assertNoDeviceArtifacts, watchNativeDialogs } from './fixtures';
import {
  acceptDisclaimerNew,
  appUrl,
  closeSecondTab,
  countStatePuts,
  expectLibraryAtLeast,
  importTones,
  isOtherLocalOrigin,
  libraryRowButton,
  libraryState,
  lifecycleLine,
  lifecycleLog,
  openApp,
  openSeededNewLayout,
  optInNewLayout,
  pauseCount,
  recordLifecycle,
  rowMenu,
  savedState,
  seedToneLibrary,
  statePuts,
  tapAt,
  LAYER_ENGINE_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
  type LifecycleEvent,
} from './helpers';
import { adb, assertUnlocked, chromeSessions, mediaSession, TEST_ORIGIN, TEST_PORT } from './adb';
import { RawCdp } from './rawCdp';
import { stubDownloads, caughtDownloads, wavInfo } from './downloads';

// v16.0.1, D1-D3: the hide flush on the phone, with a REAL hide. Only with E2E_HIDE=1, and then this file alone runs
// (playwright.config.ts), so no worker-wide Playwright connection is open while a test sends its key.
//
// Why a file of its own (measured on the Note 20, scratchpad v1601/probes/home-probe*.mjs): while a Playwright
// connectOverCDP connection is open, Chrome on Android keeps EVERY tab it is attached to "visible" after the home key or
// the screen lock: no visibilitychange, timers at full rate (Playwright auto-attaches to every page and emulates focus).
// A raw DevTools session (the browser's own socket, a flat session) does not: the page goes hidden about 300 ms after
// the key. So each test opens its own Playwright connection (not the suite's fixtures; their safety steps are repeated
// here), sets up by finger, marks its tab with a unique title, attaches a raw session to that tab (found by the title AND
// the test origin), DISCONNECTS Playwright, then sends the key and drives the hidden phase over the raw session. It
// reconnects Playwright afterwards for the checks. It touches no other tab: only its own are closed, other tabs' URLs are
// only read (the crash guard), and never `am force-stop` or `am kill`.
// Test-only effect, for the release notes: during any device run, Playwright keeps ALL of the phone's tabs visible.
//
// The desktop dry run (E2E_HIDE=1 without E2E_DEVICE): the same code against a Chrome launched here with a DevTools port
// (TEST_PORT + 6000). Playwright's own Chrome hides nothing, so there the key is a synthetic hide (visibilityState
// 'hidden' and visibilitychange, through the raw session), the return is nothing, and the lock-screen card is read from
// the page (what it plays) instead of adb.
//
// Order (each locking test needs its own unlock first, so run them one at a time, -g): D1 (screen on), v16.1's D-PL1
// (screen on), D3 (locks), v16.5's D-R2 (locks), D2 (locks; last).

const DRY = !ON_DEVICE;
const DEVTOOLS = ON_DEVICE ? 'http://localhost:9222' : `http://localhost:${TEST_PORT + 6000}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.beforeEach(() => {
  if (!ON_DEVICE) return;
  // As device.spec: a PLAYING card left over would take the keys and be the card read.
  const playing = chromeSessions().filter((s) => s.state === 'playing');
  expect(playing, 'Chrome already shows a PLAYING card: stop that playback, or restart Chrome on the phone if the card is stale').toEqual([]);
});

/** The desktop dry run's Chrome, with a DevTools port for connectOverCDP and the raw socket. Null on the phone. */
async function dryRunChrome(): Promise<Browser | null> {
  if (!DRY) return null;
  return chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${TEST_PORT + 6000}`] });
}

/** A Playwright connection of this test's own (the phone's Chrome, or the dry run's): its default context. */
async function connect(): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.connectOverCDP(DEVTOOLS);
  return { browser, context: browser.contexts()[0] };
}

/** Pages of another local origin open anywhere in the browser (the crash guard's question), read before anything runs. */
function otherLocalPages(context: BrowserContext): string[] {
  return context.pages().map((p) => p.url()).filter(isOtherLocalOrigin);
}

/**
 * A new tab set up as the device fixture sets its own: the test origin's storage cleared first (`clear`; only that
 * origin), the desktop viewport, no service worker, every media element tracked for the teardown, native dialogs
 * watched, and relative URLs resolved against the test origin (the phone's context has no baseURL).
 */
async function openTab(context: BrowserContext, clear: boolean): Promise<Page> {
  const page = await context.newPage();
  const goto = page.goto.bind(page);
  page.goto = (url, options) => goto(new URL(url, TEST_ORIGIN).toString(), options);
  if (clear) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', { origin: TEST_ORIGIN, storageTypes: 'all' });
    await cdp.detach();
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    if (navigator.serviceWorker) (navigator.serviceWorker as any).register = () => new Promise(() => {});
    const media = ((window as any).__e2eMedia = new Set<HTMLMediaElement>());
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      media.add(this);
      return play.call(this);
    };
  });
  watchNativeDialogs(page);
  return page;
}

/** A finger's tap: CDP touch on the phone (tapAt); a mouse click in the dry run (its tab has no touch). */
async function tap(page: Page, target: Locator, what: string): Promise<void> {
  const box = await target.boundingBox();
  expect(box, what).toBeTruthy();
  if (ON_DEVICE) await tapAt(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
  else await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

/** The key: home or the screen lock on the phone; a synthetic hide in the dry run (through the raw session). */
async function sendKey(how: 'home' | 'lock', raw: RawCdp, sid: string): Promise<void> {
  if (ON_DEVICE) {
    adb('shell', 'input', 'keyevent', how === 'home' ? 'KEYCODE_HOME' : 'KEYCODE_SLEEP');
    return;
  }
  await raw.evaluate(sid, `(() => {
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
}

/** Chrome back in front (home), or the screen back on (lock: the keyguard stays up; DOM reads only from then on). */
function comeBack(how: 'home' | 'lock'): void {
  if (!ON_DEVICE) return;
  if (how === 'home') adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main');
  else adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
}

/** Close our own tab, by its id, once its URL is checked to be the test's (or blank). Never another tab. */
async function closeOurTab(raw: RawCdp, targetId: string): Promise<void> {
  const t = (await raw.pages()).find((x) => x.targetId === targetId);
  if (!t) return;
  if (t.url !== 'about:blank' && !t.url.startsWith(TEST_ORIGIN + '/')) throw new Error(`Not closing ${t.url}: not the test's tab`);
  await raw.send('Target.closeTarget', { targetId });
}

/** The fixture's media teardown for our tab over the raw session (Playwright may be disconnected): stop its media,
 *  release its media session, a second for Chrome's card, then a blank page, then close it. */
async function rawTeardown(raw: RawCdp, sid: string, targetId: string): Promise<void> {
  await raw
    .evaluate(sid, `(() => {
      for (const el of window.__e2eMedia ?? []) { try { el.pause(); } catch {} }
      try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch {}
      return true;
    })()`, 5_000)
    .catch(() => {});
  await sleep(1000);
  await raw.send('Page.navigate', { url: 'about:blank' }, sid, 5_000).catch(() => {});
  await sleep(300);
  await closeOurTab(raw, targetId);
}

/** The same teardown through Playwright, for a failure before the raw session took over (Playwright still on): a
 *  tab left playing would strand a PLAYING card that takes the car's keys. */
async function pwTeardown(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      for (const el of (window as any).__e2eMedia ?? []) { try { el.pause(); } catch {} }
      try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch {}
    })
    .catch(() => {});
  await sleep(1000);
  await page.goto('about:blank').catch(() => {});
  await sleep(300);
  await page.close().catch(() => {});
}

const READ_LOG = `JSON.parse(localStorage.getItem('e2e.lifecycle') || '[]')`;

// ---------------------------------------------------------------------------------------------------------------
// D1, D2: a change made just before Chrome goes to the background survives the renderer being killed there.
// ---------------------------------------------------------------------------------------------------------------

/**
 * 10 seeded tones with crystals, the new layout on the phone, NOTHING PLAYING (no media card can be stranded by the
 * kill). By finger, from the Library's ⋯: Play next tone-07 (left to save), then Add to queue tone-09, whose save is
 * still waiting when, at once, Playwright disconnects and the home key (D1) or the screen lock (D2) hides the page. 500 ms
 * after the page says it is hidden (read over the raw session), the tab's renderer is killed (Page.crash over the raw
 * session, after the crash guard over every tab's URL). Then the record is read from a new tab with no app on it, and
 * the app is opened there: both queued must be back, written at the hide.
 */
async function killedInBackground(how: 'home' | 'lock', artifacts: { screenshot: unknown; trace: unknown; video: unknown }): Promise<void> {
  test.setTimeout(240_000);
  if (ON_DEVICE) {
    assertNoDeviceArtifacts(artifacts);
    assertUnlocked();
  }
  const TITLE = `aetheria-e2e-hide-${how}-${Date.now()}`;
  let dryChrome: Browser | null = null;
  let conn: { browser: Browser; context: BrowserContext } | null = null;
  let raw: RawCdp | null = null;
  let ours: { targetId: string; sid: string } | null = null;
  let tab: Page | null = null;
  let setupTab: Page | null = null; // until the raw session takes over: torn down through Playwright on a failure
  try {
    dryChrome = await dryRunChrome();
    conn = await connect();
    // The crash at the end would refuse: say so before anything is done.
    expect(otherLocalPages(conn.context), 'no other local origin open in Chrome (the crash guard refuses: it could share the renderer); close it first').toEqual([]);
    const page = await openTab(conn.context, true);
    setupTab = page;
    const setUp = async (p: Page) => {
      await p.addInitScript(({ keys }) => {
        try {
          localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
          localStorage.setItem(keys.engine, 'classic');
          localStorage.setItem(keys.layout, 'new');
        } catch {
          // No storage here (about:blank): nothing to seed.
        }
      }, { keys: { engine: LAYER_ENGINE_KEY, layout: LAYOUT_KEY } });
      await countStatePuts(p);
      await recordLifecycle(p);
    };
    await setUp(page);
    const ids = await seedToneLibrary(page, { n: 10, cursor: 0 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the seeded library restores', timeout: 60_000 }).toBe(10);
    await expect.poll(() => statePuts(page), { message: "the launch's own save", timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    const s0 = await libraryState(page);
    expect([s0.current, s0.playing], 'the cursor on tone-01, nothing playing').toEqual(['tone-01', false]);

    // By finger (taps spaced past Android's double-tap window by tapAt); every outcome polled (a tap lands after tapAt).
    const at = async (target: Locator, what: string) => {
      await target.evaluate((el) => el.scrollIntoView({ block: 'center' })); // a DOM scroll; the tap itself is a finger's
      await page.waitForTimeout(300);
      await tap(page, target, what);
    };
    const reveal = async (k: number) => {
      // Bring a row of the virtualized list into the DOM (a DOM scroll), so its ⋯ can be tapped.
      await page.getByTestId('library-scroll').evaluate((sc, top) => { sc.scrollTop = top; }, Math.max(0, (k - 4) * 64));
      await page.waitForTimeout(300);
    };
    const queueState = () => page.evaluate(() => (window as any).__aetheriaQueue.state());
    await at(page.getByTestId('tab-library-button'), 'the Library tab');
    await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
    await reveal(7);
    await at(rowMenu(page, 'tone-07'), 'the ⋯ of tone-07');
    await expect(page.getByRole('dialog', { name: 'tone-07', exact: true })).toBeVisible({ timeout: 5_000 });
    await at(page.getByTestId('library-menu-next'), 'Play next');
    await expect.poll(async () => (await queueState()).waitingNames, { timeout: 10_000, message: 'Play next by finger' }).toEqual(['tone-07']);
    // Its save lands first, so the change still waiting at the hide is the second one.
    await expect.poll(async () => (await savedState(page))?.queue?.waiting?.length ?? 0, { timeout: 10_000, message: 'tone-07 saved' }).toBe(1);
    const putsBefore = await statePuts(page);

    // The raw side, attached now so nothing stands between the second change and the key: our tab by its unique title
    // and the test origin.
    await page.evaluate((t) => { document.title = t; }, TITLE);
    raw = await RawCdp.connect(DEVTOOLS);
    const target = await raw.ourPage(TITLE);
    ours = { targetId: target.targetId, sid: await raw.attach(target.targetId) };

    await reveal(9);
    await at(rowMenu(page, 'tone-09'), 'the ⋯ of tone-09');
    await expect(page.getByRole('dialog', { name: 'tone-09', exact: true })).toBeVisible({ timeout: 5_000 });
    await at(page.getByTestId('library-menu-queue'), 'Add to queue');
    await expect.poll(async () => (await queueState()).waitingNames, { timeout: 10_000, message: 'Add to queue by finger' }).toEqual(['tone-07', 'tone-09']);
    const addedAt = await page.evaluate(() => Date.now());

    // Playwright off the phone (while attached it keeps the tab visible), then at once the home key (D1) or the lock (D2).
    await conn.browser.close();
    conn = null;
    setupTab = null;
    await sendKey(how, raw, ours.sid);
    let hidden: LifecycleEvent | undefined;
    try {
      const until = Date.now() + 10_000;
      while (!hidden && Date.now() < until) {
        hidden = (await raw.evaluate<LifecycleEvent[]>(ours.sid, READ_LOG)).find((x) => x.e === 'visibilitychange' && x.vis === 'hidden' && x.t >= addedAt);
        if (!hidden) await sleep(100);
      }
      expect(hidden, `the page says it is hidden (${how === 'home' ? 'the home key' : 'the screen lock'}), read over the raw session`).toBeTruthy();
      await sleep(500);
      // The crash guard over every tab's URL, then Page.crash (sent, not awaited); resolves on Chrome's crash report.
      await raw.crash(ours.targetId, ours.sid);
      // Our crashed tab, closed by its id (its URL checked first) BEFORE Chrome comes back: brought to the front,
      // Android Chrome reloads a tab whose renderer died in the background, and that reload would run the app again.
      await closeOurTab(raw, ours.targetId);
      ours = null;
    } finally {
      comeBack(how);
    }
    expect(hidden!.puts, 'the second change’s save was still waiting when the page was hidden (the debounce had not run)').toBe(putsBefore);

    // Playwright again, for the checks, in a new tab (the storage kept).
    conn = await connect();
    tab = await openTab(conn.context, false);
    await setUp(tab);
    await tab.setViewportSize(PHONE_VIEWPORT);
    // The record first, from a page with no app on it (the app, once restored, saves again 4 s later).
    await tab.goto(appUrl('/manifest.json'), { waitUntil: 'commit' });
    let st: any = null;
    await expect.poll(async () => (st = await savedState(tab!).catch(() => null)), { timeout: 15_000, message: 'the record can be read' }).not.toBeNull();
    expect([st.playlistOrder.length, st.currentSongIndex, st.queue], 'the record: 12 entries, the cursor on tone-01, tone-07 then tone-09 waiting').toEqual([12, 0, { waiting: [1, 2], played: [] }]);
    expect(Math.abs(st.savedAt - hidden!.t), 'written at the hide (the flush), not by the debounce 2 s after the change').toBeLessThan(250);
    await expectLibraryAtLeast(tab, ids);
    // The events from the hide to the kill (the next entry after them is this tab's own load).
    const log = await lifecycleLog(tab);
    const from = log.findIndex((x) => x.e === 'visibilitychange' && x.vis === 'hidden' && x.t >= addedAt);
    const nextLoad = log.findIndex((x, i) => i > from && x.e === 'load');
    const beforeKill = log.slice(from, nextLoad < 0 ? undefined : nextLoad);
    test.info().annotations.push({
      type: `v16.0.1 ${how === 'home' ? 'D1 (home key)' : 'D2 (screen lock)'}${DRY ? ', desktop dry run' : ''}: the events, Add to queue → kill`,
      description: `${lifecycleLine(beforeKill)}; hidden ${hidden!.t - addedAt} ms after the add; pagehide before the kill: ${beforeKill.some((x) => x.e === 'pagehide') ? 'yes' : 'no'}; freeze: ${beforeKill.some((x) => x.e === 'freeze') ? 'yes' : 'no'}`,
    });
    // Then the app, in the same new tab: a new renderer, and the restore.
    await tab.goto(appUrl('/'), { waitUntil: 'commit' });
    const now = () =>
      tab!
        .evaluate(() => {
          const L = (window as any).__aetheriaLibrary;
          const Q = (window as any).__aetheriaQueue;
          if (!L || !Q) return null;
          const s = L.state();
          const q = Q.state();
          return { order: s.ids.length, library: s.libraryIds.length, cursor: s.cursor, current: s.current, waiting: q.waiting, waitingNames: q.waitingNames, playing: s.playing };
        })
        .catch(() => null);
    await expect.poll(async () => (await now())?.library ?? 0, { timeout: 60_000, message: 'the app restores in the new tab' }).toBe(10);
    await expect
      .poll(now, { timeout: 10_000, message: 'both queued are back, right after tone-01; nothing plays' })
      .toEqual({ order: 12, library: 10, cursor: 0, current: 'tone-01', waiting: [1, 2], waitingNames: ['tone-07', 'tone-09'], playing: false });
  } finally {
    if (setupTab && conn && !ours) await pwTeardown(setupTab); // a failure before the raw session took over
    if (tab) await closeSecondTab(tab);
    if (raw && ours) await rawTeardown(raw, ours.sid, ours.targetId).catch(() => {}); // a failure while detached
    raw?.close();
    if (conn) await conn.browser.close();
    if (dryChrome) await dryChrome.close();
  }
}

test('v16.0.1 D1: backgrounded, then killed (a real hide: Playwright detached): Play next and Add to queue by finger, the home key at once, the tab’s renderer killed 500 ms after the hide; the app comes back with both queued', async ({ screenshot, trace, video }) => {
  // Screen on. Sends Chrome to the background with the home key (no tab of the user's is touched) and brings it back
  // with am start.
  await killedInBackground('home', { screenshot, trace, video });
});

// ---------------------------------------------------------------------------------------------------------------
// v16.1 D-PL1: a saved playlist made by finger just before a background kill comes back whole.
// ---------------------------------------------------------------------------------------------------------------

/**
 * v16.1 (spec §5.10 step 3), D1's pattern. 30 seeded tones, the new layout on the phone. By finger: Library › Playlists ›
 * New playlist "Evening" (its view opens); Go to Tracks; a row's ⋯ › Add to playlist › Evening for tone-07 and tone-03;
 * Playlists › Evening's ▶ and the mini-player's Pause (NOTHING PLAYING at the kill, so no media card can be stranded);
 * back to Tracks. Then the third Add to playlist (tone-09), the LAST tap, and, as in D1, at once: Playwright detached, the
 * home key, the hide read over the raw session, and 500 ms later the tab's renderer killed. A playlist is written at the
 * tap, so nothing of it may wait for a timer: the gap from the third add's tap to the kill (the page's clock, read just
 * before the crash goes out) must be under 2 s, so a 2 s debounce (the M4 and M4h mutants) would lose that add; both
 * gaps, tap → hide and tap → kill, are printed. Then, from a new tab: the records (Evening's three entries in
 * order; the play order is what was played, Evening's first two, the cursor on the first), and the app restored:
 * Evening with its three tracks, and the play order its first two (decision 4: an edit while it plays applies on the
 * next Play), so the source line no longer names it (as PL16): "Play order · 1 of 2".
 */
test('v16.1 D-PL1: a playlist made by finger (New playlist, two Add to playlist, Play, Pause, then a third Add to playlist), then at once the home key and the tab’s renderer killed (a real hide: Playwright detached): it comes back with its three tracks in order, and the play order is what was played', async ({ screenshot, trace, video }) => {
  // Screen on. Sends Chrome to the background with the home key and brings it back with am start, as D1.
  test.setTimeout(240_000);
  if (ON_DEVICE) {
    assertNoDeviceArtifacts({ screenshot, trace, video });
    assertUnlocked();
  }
  const TITLE = `aetheria-e2e-hide-playlist-${Date.now()}`;
  let dryChrome: Browser | null = null;
  let conn: { browser: Browser; context: BrowserContext } | null = null;
  let raw: RawCdp | null = null;
  let ours: { targetId: string; sid: string } | null = null;
  let tab: Page | null = null;
  let setupTab: Page | null = null; // until the raw session takes over: torn down through Playwright on a failure
  const playlists = (p: Page) => p.evaluate(() => (window as any).__aetheriaPlaylists?.state() ?? null).catch(() => null);
  try {
    dryChrome = await dryRunChrome();
    conn = await connect();
    expect(otherLocalPages(conn.context), 'no other local origin open in Chrome (the crash guard refuses: it could share the renderer); close it first').toEqual([]);
    const page = await openTab(conn.context, true);
    setupTab = page;
    const setUp = async (p: Page) => {
      await p.addInitScript(({ keys }) => {
        try {
          localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
          localStorage.setItem(keys.engine, 'classic');
          localStorage.setItem(keys.layout, 'new');
        } catch {
          // No storage here (about:blank): nothing to seed.
        }
      }, { keys: { engine: LAYER_ENGINE_KEY, layout: LAYOUT_KEY } });
      await countStatePuts(p);
      await recordLifecycle(p);
    };
    await setUp(page);
    const ids = await seedToneLibrary(page, { n: 30, cursor: -1 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the seeded library restores', timeout: 60_000 }).toBe(30);
    await expect.poll(async () => (await playlists(page))?.status, { message: 'the playlists are read back', timeout: 20_000 }).toBe('ready');

    // By finger; every outcome polled (a tap lands after tapAt). `at` scrolls its target into view first.
    const at = async (target: Locator, what: string) => {
      await target.evaluate((el) => el.scrollIntoView({ block: 'center' })); // a DOM scroll; the tap itself is a finger's
      await page.waitForTimeout(300);
      await tap(page, target, what);
    };
    const add = async (k: number) => {
      const tone = `tone-${String(k).padStart(2, '0')}`;
      // Bring the row of the virtualized list into the DOM (a DOM scroll), so its ⋯ can be tapped.
      await page.getByTestId('library-scroll').evaluate((sc, top) => { sc.scrollTop = top; }, Math.max(0, (k - 4) * 64));
      await page.waitForTimeout(300);
      await at(rowMenu(page, tone), `the ⋯ of ${tone}`);
      await expect(page.getByRole('dialog', { name: tone, exact: true })).toBeVisible({ timeout: 5_000 });
      await at(page.getByTestId('library-menu-playlist'), 'Add to playlist…');
      await expect(page.getByRole('dialog', { name: 'Add to playlist' })).toBeVisible({ timeout: 5_000 });
      await at(page.getByTestId('playlist-add-row').filter({ hasText: 'Evening' }), 'Evening');
      await expect.poll(async () => (await playlists(page))?.lists?.[0]?.names, { timeout: 10_000, intervals: [50, 100], message: `${tone} added by finger` }).toContain(tone);
    };
    // Library › Playlists › New playlist "Evening" (its view opens).
    await at(page.getByTestId('tab-library-button'), 'the Library tab');
    await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
    await at(page.getByTestId('library-view-playlists'), 'Playlists');
    await expect(page.getByTestId('playlists-new')).toBeVisible({ timeout: 5_000 });
    await at(page.getByTestId('playlists-new'), 'New playlist');
    const name = page.getByRole('dialog', { name: 'New playlist' }).getByLabel('Name');
    await expect(name).toBeVisible({ timeout: 5_000 });
    await name.fill('Evening');
    await at(page.getByTestId('playlist-name-save'), 'Save');
    await expect(page.getByTestId('playlist-title')).toHaveText('Evening', { timeout: 10_000 });
    // Tracks › a row's ⋯ › Add to playlist › Evening: tone-07, tone-03.
    await at(page.getByTestId('playlist-go-tracks'), 'Go to Tracks');
    await expect(page.getByTestId('library-list')).toBeVisible({ timeout: 5_000 });
    await add(7);
    await add(3);
    const secondAddAt = Date.now();
    // Playlists › Evening's ▶, then Pause (the segment, the row and the mini-player are in view: no scroll), then back
    // to Tracks: all before the third add, so that add is the last tap before the key.
    await tap(page, page.getByTestId('library-view-playlists'), 'Playlists');
    await expect(page.getByTestId('playlist-row').first()).toBeVisible({ timeout: 5_000 });
    await tap(page, page.getByTestId('playlist-row').first().getByTestId('playlist-row-play'), 'Play Evening');
    await expect.poll(async () => (await libraryState(page)).names, { timeout: 15_000, message: 'Evening plays, in its order: its two tracks' }).toEqual(['tone-07', 'tone-03']);
    await tap(page, page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }), 'Pause');
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 10_000, message: 'paused: nothing plays at the kill' }).toBe(false);
    await tap(page, page.getByTestId('library-view-tracks'), 'Tracks');
    await expect(page.getByTestId('library-list')).toBeVisible({ timeout: 5_000 });

    // The raw side, attached now so nothing stands between the third add and the key: our tab by its unique title and
    // the test origin.
    await page.evaluate((t) => { document.title = t; }, TITLE);
    raw = await RawCdp.connect(DEVTOOLS);
    const target = await raw.ourPage(TITLE);
    ours = { targetId: target.targetId, sid: await raw.attach(target.targetId) };

    // No write of the earlier adds may still be on a timer when the third is made: a 2 s delay of the second add's write
    // would otherwise carry the third along with it before the kill (a mutant with a timer per write passed so in the
    // desktop dry run, where Play and Pause take under 2 s; on the phone they take longer, and this waits nothing).
    const settle = 2_500 - (Date.now() - secondAddAt);
    if (settle > 0) await page.waitForTimeout(settle);
    // The third add, the last tap: its time is the page's own, taken as the tap's click arrives (on the phone a tap
    // lands about 300 ms after tapAt returns).
    await page.evaluate(() => {
      const w = window as any;
      w.__lastClickAt = 0;
      document.addEventListener('click', () => { w.__lastClickAt = Date.now(); }, true);
    });
    await add(9);
    const addedAt = await page.evaluate(() => (window as any).__lastClickAt as number);
    expect(addedAt, 'the third add’s tap was seen').toBeGreaterThan(0);

    // Playwright off the phone (while attached it keeps the tab visible), then at once the home key.
    await conn.browser.close();
    conn = null;
    setupTab = null;
    await sendKey('home', raw, ours.sid);
    let hidden: LifecycleEvent | undefined;
    let killAt = 0; // the page's Date.now() as the kill goes out
    try {
      const until = Date.now() + 10_000;
      while (!hidden && Date.now() < until) {
        hidden = (await raw.evaluate<LifecycleEvent[]>(ours.sid, READ_LOG)).find((x) => x.e === 'visibilitychange' && x.vis === 'hidden' && x.t >= addedAt);
        if (!hidden) await sleep(100);
      }
      expect(hidden, 'the page says it is hidden (the home key), read over the raw session').toBeTruthy();
      await sleep(500);
      // The crash guard over every tab's URL, then Page.crash (sent, not awaited); resolves on Chrome's crash report.
      // The page's own clock is read over the raw session last before the crash goes out (after the guard's target
      // listing): the tap → kill gap ends at the kill, not at the hide.
      const sid = ours.sid;
      await raw.crash(ours.targetId, sid, async () => { killAt = await raw!.evaluate<number>(sid, 'Date.now()'); });
      // Our crashed tab, closed by its id (its URL checked first) BEFORE Chrome comes back (it would reload it).
      await closeOurTab(raw, ours.targetId);
      ours = null;
    } finally {
      comeBack('home');
    }
    const toHidden = hidden!.t - addedAt;
    const toKill = killAt - addedAt;
    test.info().annotations.push({
      type: `v16.1 D-PL1${DRY ? ', desktop dry run' : ''}: the third add’s tap → the hide, → the kill`,
      description: `${toHidden} ms, ${toKill} ms (a 2 s debounce would lose the add when the kill comes under 2 s)`,
    });
    // On stdout too: the device run's list reporter shows no annotations.
    console.log(`D-PL1 gaps: tap→hidden ${toHidden} ms, tap→kill ${toKill} ms${DRY ? ' (desktop dry run)' : ''}`);

    // Playwright again, for the checks, in a new tab (the storage kept).
    conn = await connect();
    tab = await openTab(conn.context, false);
    await setUp(tab);
    await tab.setViewportSize(PHONE_VIEWPORT);
    // The records first, from a page with no app on it.
    await tab.goto(appUrl('/manifest.json'), { waitUntil: 'commit' });
    const stored = () =>
      tab!.evaluate(async () => {
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          const r = indexedDB.open('aetheria-db');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          const st = db.transaction('playlist-state', 'readonly').objectStore('playlist-state');
          const all: any[] = await new Promise((resolve, reject) => {
            const r = st.getAll(IDBKeyRange.bound('pl:', 'pl;', false, true));
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          return all.map((x) => ({ name: x.name, names: x.entries.map((e: { name: string }) => e.name) }));
        } finally {
          db.close();
        }
      });
    await expect.poll(() => stored().catch(() => null), { timeout: 15_000, message: 'Evening on disk: its three entries, in order' }).toEqual([{ name: 'Evening', names: ['tone-07', 'tone-03', 'tone-09'] }]);
    const st = await savedState(tab);
    expect([st?.playlistOrder, st?.currentSongIndex], 'the play order on disk is what was played: Evening’s first two, the cursor on the first').toEqual([[ids[6], ids[2]], 0]);
    // Then the app, in the same new tab: a new renderer, and the restore.
    await tab.goto(appUrl('/'), { waitUntil: 'commit' });
    await expect.poll(async () => (await playlists(tab!))?.status ?? null, { timeout: 60_000, message: 'the app restores in the new tab' }).toBe('ready');
    const s = await playlists(tab);
    expect(s.lists.map((l: { name: string; ids: string[] }) => [l.name, l.ids]), 'Evening, its three tracks in order').toEqual([['Evening', [ids[6], ids[2], ids[8]]]]);
    await expect.poll(async () => { const L = await libraryState(tab!).catch(() => null); return L ? [L.names, L.cursor] : null; }, { timeout: 15_000, message: 'the play order restored: Evening’s first two, the cursor on the first' }).toEqual([['tone-07', 'tone-03'], 0]);
    // Decision 4: the edit made while Evening played applies on its next Play, so the play order is no longer Evening
    // (its present tracks are three now) and the source line says so, as PL16.
    expect(s.playing, 'the play order is not Evening any more').toBe(null);
    await expect.poll(() => tab!.getByTestId('np-source').textContent().catch(() => null), { timeout: 15_000, message: 'the source line: the play order, 1 of 2' }).toBe('Play order · 1 of 2');
    // Written at the tap: the kill came before any 2 s timer started by that tap could have written it. (Last, so that
    // on a slow phone a long gap still shows whether the data came back.)
    expect(killAt, 'the kill’s time was read').toBeGreaterThan(0);
    expect(toKill, 'the third add’s tap → the kill under 2 s (so a 2 s debounce would lose that add)').toBeLessThan(2_000);
  } finally {
    if (setupTab && conn && !ours) await pwTeardown(setupTab); // a failure before the raw session took over
    if (tab) await closeSecondTab(tab);
    if (raw && ours) await rawTeardown(raw, ours.sid, ours.targetId).catch(() => {}); // a failure while detached
    raw?.close();
    if (conn) await conn.browser.close();
    if (dryChrome) await dryChrome.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// D3: locked while playing, with a real hide (a no-regression check of the flush during locked playback).
// ---------------------------------------------------------------------------------------------------------------

test('v16.0.1 D3: locked while playing, with a real hide (Playwright detached): the flush writes at the hide, during locked playback, and the card keeps following three gapless advances; after the wake Now Playing names the card’s track and nothing paused @device', async ({ screenshot, trace, video }) => {
  // The existing screen-off test's setup (28 tones of 4 s, Auto-Distribute, the new layout, Play by finger), then
  // Playwright detached and the lock sent right after an advance, so that advance's save is still waiting at the hide
  // (a save comes 2 s after a change): the hide must write it at once. Turns the screen off; a phone with a secure lock
  // stays locked after the test (unlock it by hand before D2).
  test.setTimeout(240_000);
  if (ON_DEVICE) {
    assertNoDeviceArtifacts({ screenshot, trace, video });
    assertUnlocked();
  }
  const TITLE = `aetheria-e2e-hide-play-${Date.now()}`;
  let dryChrome: Browser | null = null;
  let conn: { browser: Browser; context: BrowserContext } | null = null;
  let raw: RawCdp | null = null;
  let ours: { targetId: string; sid: string } | null = null;
  let setupTab: Page | null = null; // until the raw session takes over: torn down through Playwright on a failure
  try {
    dryChrome = await dryRunChrome();
    conn = await connect();
    const page = await openTab(conn.context, true);
    setupTab = page;
    await countStatePuts(page);
    await recordLifecycle(page);
    const dialogs = await openApp(page);
    await importTones(page, 28, 4);
    // Auto-Distribute gives every track a crystal, which the gapless advance needs.
    await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
    await page.setViewportSize(PHONE_VIEWPORT);
    await optInNewLayout(page);
    await expect(page.getByTestId('view-now')).toBeVisible();
    // The card: Android's own on the phone; in the dry run, what the page plays.
    type Card = { state: string; title: string } | null;
    const pageCard = (s: { playing: boolean; current: string | null }): Card => ({ state: s.playing ? 'playing' : 'paused', title: s.current ?? '' });
    await tap(page, page.getByTestId('np-play'), "Now Playing's Play button");
    await expect.poll(async () => (ON_DEVICE ? mediaSession() : pageCard(await libraryState(page)))?.state, { timeout: 15_000, message: 'the card PLAYING' }).toBe('playing');
    const pausesBefore = await pauseCount(page);

    await page.evaluate((t) => { document.title = t; }, TITLE);
    raw = await RawCdp.connect(DEVTOOLS);
    const target = await raw.ourPage(TITLE);
    ours = { targetId: target.targetId, sid: await raw.attach(target.targetId) };
    await conn.browser.close();
    conn = null;
    setupTab = null;

    type Snap = { now: number; cursor: number; current: string | null; playing: boolean; puts: number; putTimes: number[]; log: LifecycleEvent[] };
    const snap = () =>
      raw!.evaluate<Snap>(ours!.sid, `(() => {
        const s = window.__aetheriaLibrary.state();
        return { now: Date.now(), cursor: s.cursor, current: s.current, playing: s.playing, puts: window.__statePuts,
          putTimes: window.__statePutTimes.slice(), log: ${READ_LOG} };
      })()`);
    // The lock right after an advance: its save is then still waiting (2 s) when the page goes hidden (~0.3 s later).
    const start = await snap();
    let atAdvance: Snap = start;
    const advanceBy = Date.now() + 10_000;
    while (atAdvance.cursor === start.cursor && Date.now() < advanceBy) {
      await sleep(100);
      atAdvance = await snap();
    }
    expect(atAdvance.cursor, 'an advance to lock on (Playwright detached, the tab still playing)').not.toBe(start.cursor);
    await sendKey('lock', raw, ours.sid);

    const first = atAdvance.current ?? '';
    const titles: string[] = [];
    const snaps: Snap[] = [];
    let hidden: LifecycleEvent | undefined;
    let last: Snap = atAdvance;
    let cardNow: Card = null;
    let playingCards = 0;
    try {
      const until = Date.now() + 60_000;
      while (Date.now() < until) {
        last = await snap();
        snaps.push(last);
        hidden ??= last.log.find((x) => x.e === 'visibilitychange' && x.vis === 'hidden' && x.t >= atAdvance.now);
        const c = ON_DEVICE ? mediaSession() : pageCard(last);
        if (c && c.state === 'playing' && c.title !== first && !titles.includes(c.title)) titles.push(c.title);
        if (titles.length >= 3 && hidden) break;
        await sleep(400);
      }
      cardNow = ON_DEVICE ? mediaSession() : pageCard(last);
      playingCards = ON_DEVICE ? chromeSessions().filter((s) => s.state === 'playing').length : 1;
    } finally {
      if (ON_DEVICE) adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
    }
    const putsAfterHide = hidden ? last.putTimes.filter((t) => t >= hidden!.t).map((t) => t - hidden!.t) : [];
    test.info().annotations.push({
      type: `v16.0.1 D3${DRY ? ', desktop dry run' : ''}: locked playback`,
      description: `card titles ${[first, ...titles].join(' → ')}; hidden ${hidden ? hidden.t - atAdvance.now : '-'} ms after the advance; state puts after the hide at +${putsAfterHide.join(', +')} ms; cursor ${atAdvance.cursor} → ${last.cursor}`,
    });
    expect(hidden, 'the page says it is hidden: a real hide while locked, read over the raw session').toBeTruthy();
    expect(hidden!.puts, 'the advance’s save was still waiting at the hide (else this run proves nothing: run it again)').toBe(atAdvance.puts);
    // The playback first (so a failed flush below still shows whether the advances went on).
    expect(titles.length, 'three gapless advances on the PLAYING card while locked, its title following').toBeGreaterThanOrEqual(3);
    expect(cardNow?.state, 'the card still says playing').toBe('playing');
    expect(playingCards, 'one PLAYING Chrome card: none stranded').toBe(1);
    // The flush ran during locked playback: a state put at the hide.
    const flushPut = last.putTimes.find((t) => t >= hidden!.t && t <= hidden!.t + 250);
    expect(flushPut, `a state put landed at or within 250 ms of the hide: the flush ran during locked playback (puts after the hide: +${putsAfterHide.join(', +') || 'none'} ms)`).toBeDefined();
    const after = snaps.filter((s) => s.now > flushPut!);
    expect(Math.max(...after.map((s) => s.cursor)) - atAdvance.cursor, 'and the advances went on after it (three tracks on, the page’s own cursor)').toBeGreaterThanOrEqual(3);

    // After the wake: Playwright again, for DOM and state reads only (behind the keyguard Chrome draws no frames: no taps).
    conn = await connect();
    let back: Page | undefined;
    for (const p of conn.context.pages().filter((x) => x.url().startsWith(TEST_ORIGIN + '/'))) {
      if ((await p.title()) === TITLE) back = p;
    }
    expect(back, 'our tab, found again by its title on the test origin').toBeTruthy();
    const backDialogs = watchNativeDialogs(back!);
    expect(await pauseCount(back!), 'the gapless swap never paused').toBe(pausesBefore);
    await expect
      .poll(async () => {
        const np = (await back!.getByTestId('np-title').textContent()) ?? '';
        const c = ON_DEVICE ? mediaSession() : pageCard(await libraryState(back!));
        return np === (c?.title ?? '-');
      }, { timeout: 10_000, message: "Now Playing's title is the card's" })
      .toBe(true);
    expect([...dialogs, ...backDialogs], 'no native dialog').toEqual([]);
  } finally {
    // The fixture's media teardown for our tab, then only our tab closed: through Playwright for a failure before the
    // raw session took over (the tab may be PLAYING), over the raw session after it (Playwright may be off).
    if (setupTab && conn && !ours) await pwTeardown(setupTab);
    if (raw && ours) await rawTeardown(raw, ours.sid, ours.targetId).catch((e) => console.warn('[D3] teardown:', e));
    raw?.close();
    if (conn) await conn.browser.close();
    if (dryChrome) await dryChrome.close();
  }
});

test('v16.5 D-R2: recording while locked, with a real hide (Playwright detached): Audio Only by finger, the screen lock; the page goes hidden, the card follows three gapless advances and the recording goes on; after the wake it stops into a file as long as the wall time with the music at its end @device', async ({ screenshot, trace, video }) => {
  // device.spec's recording with the screen off, with a REAL hide (Playwright detached; the raw session reads the page).
  // 30 seeded tones of 4 s, the new layout, Music only; tone-0001 then Record › Audio Only by finger. After the wake,
  // Playwright again for DOM reads and the stop by el.click() (no tap behind the keyguard); the file is caught in the page
  // (stubDownloads: nothing saved). Turns the screen off; unlock by hand before D2.
  test.setTimeout(240_000);
  if (ON_DEVICE) {
    assertNoDeviceArtifacts({ screenshot, trace, video });
    assertUnlocked();
  }
  const TITLE = `aetheria-e2e-hide-rec-${Date.now()}`;
  let dryChrome: Browser | null = null;
  let conn: { browser: Browser; context: BrowserContext } | null = null;
  let raw: RawCdp | null = null;
  let ours: { targetId: string; sid: string } | null = null;
  let setupTab: Page | null = null;
  try {
    dryChrome = await dryRunChrome();
    conn = await connect();
    const page = await openTab(conn.context, true);
    setupTab = page;
    await stubDownloads(page);
    await page.addInitScript(() => localStorage.setItem('aetheria.musicOnly.v1', 'true'));
    const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4 });
    await page.setViewportSize(PHONE_VIEWPORT);
    type Card = { state: string; title: string } | null;
    const pageCard = (s: { playing: boolean; current: string | null }): Card => ({ state: s.playing ? 'playing' : 'paused', title: s.current ?? '' });
    await tap(page, page.getByTestId('tab-library-button'), 'the Library tab');
    await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
    const row = libraryRowButton(page, 'tone-0001');
    await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await tap(page, row, 'tone-0001');
    await expect.poll(async () => (ON_DEVICE ? mediaSession() : pageCard(await libraryState(page)))?.state, { timeout: 15_000, message: 'the card PLAYING' }).toBe('playing');
    await tap(page, page.getByTestId('tab-more-button'), 'More');
    await expect(page.getByTestId('more')).toBeVisible({ timeout: 5_000 });
    await tap(page, page.getByTestId('more-record-row'), 'Record');
    await expect(page.getByTestId('record-option-audio')).toBeEnabled({ timeout: 5_000 });
    await tap(page, page.getByTestId('record-option-audio'), 'Audio Only');
    await expect(page.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    const wall0 = Date.now();
    const pausesBefore = await pauseCount(page);

    await page.evaluate((t) => { document.title = t; }, TITLE);
    raw = await RawCdp.connect(DEVTOOLS);
    const target = await raw.ourPage(TITLE);
    ours = { targetId: target.targetId, sid: await raw.attach(target.targetId) };
    await conn.browser.close();
    conn = null;
    setupTab = null;

    type Snap = { current: string | null; playing: boolean; vis: string; recording: boolean };
    const snap = () =>
      raw!.evaluate<Snap>(ours!.sid, `(() => {
        const s = window.__aetheriaLibrary.state();
        return { current: s.current, playing: s.playing, vis: document.visibilityState,
          recording: !!document.querySelector('[data-testid="record-stop-save"]') };
      })()`);
    const start = await snap();
    await sendKey('lock', raw, ours.sid);
    const first = start.current ?? '';
    const titles: string[] = [];
    let hidden = false;
    let recordingThroughout = true;
    let playingCards = 0;
    try {
      const until = Date.now() + 60_000;
      while (Date.now() < until) {
        const s = await snap();
        if (s.vis === 'hidden') hidden = true;
        if (hidden && !s.recording) recordingThroughout = false;
        const c = ON_DEVICE ? mediaSession() : pageCard(s);
        if (c && c.state === 'playing' && c.title !== first && !titles.includes(c.title)) titles.push(c.title);
        if (titles.length >= 3 && hidden) break;
        await sleep(400);
      }
      playingCards = ON_DEVICE ? chromeSessions().filter((s) => s.state === 'playing').length : 1;
    } finally {
      if (ON_DEVICE) adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
    }
    test.info().annotations.push({ type: `v16.5 D-R2${DRY ? ', desktop dry run' : ''}: recording while locked`, description: `card titles ${[first, ...titles].join(' → ')}; hidden ${hidden}; recording throughout ${recordingThroughout}` });
    expect(hidden, 'the page says it is hidden: a real hide while locked, read over the raw session').toBe(true);
    expect(titles.length, 'three gapless advances on the PLAYING card while locked').toBeGreaterThanOrEqual(3);
    expect(playingCards, 'one PLAYING Chrome card: none stranded').toBe(1);
    expect(recordingThroughout, 'the recording went on while hidden').toBe(true);

    // After the wake: Playwright again; DOM reads, and the stop by el.click() (no tap: Chrome draws no frames behind the keyguard).
    conn = await connect();
    let back: Page | undefined;
    for (const p of conn.context.pages().filter((x) => x.url().startsWith(TEST_ORIGIN + '/'))) {
      if ((await p.title()) === TITLE) back = p;
    }
    expect(back, 'our tab, found again by its title on the test origin').toBeTruthy();
    const backDialogs = watchNativeDialogs(back!);
    expect(await pauseCount(back!), 'the gapless swap never paused').toBe(pausesBefore);
    await back!.evaluate(() => (document.querySelector('[data-testid="record-stop-save"]') as HTMLButtonElement).click());
    const [file] = await caughtDownloads(back!, 1, 30_000);
    const w = await wavInfo(back!, 0, { win: 10, head: 2, tail: 2 });
    const wallS = (Date.now() - wall0) / 1000;
    test.info().annotations.push({ type: 'v16.5 D-R2 the file', description: JSON.stringify({ name: file.name, size: file.size, rate: w.rate, seconds: w.seconds, tail: w.tailRms, wallS }) });
    expect(Math.abs(w.seconds - wallS), 'it recorded the whole time, hidden too').toBeLessThan(5);
    expect(w.tailRms, 'the music at its end, three advances on').toBeGreaterThan(0.05);
    expect([...dialogs, ...backDialogs], 'no native dialog').toEqual([]);
  } finally {
    if (setupTab && conn && !ours) await pwTeardown(setupTab);
    if (raw && ours) await rawTeardown(raw, ours.sid, ours.targetId).catch((e) => console.warn('[D-R2] teardown:', e));
    raw?.close();
    if (conn) await conn.browser.close();
    if (dryChrome) await dryChrome.close();
  }
});

test('v16.0.1 D2: locked, then killed (a real hide: Playwright detached): Play next and Add to queue by finger, the screen lock at once, the tab’s renderer killed 500 ms after the hide; after the wake the app comes back with both queued @device', async ({ screenshot, trace, video }) => {
  // D1 with the screen lock in place of the home key. Turns the screen off; a phone with a secure lock stays locked
  // after the test (unlock it by hand). Nothing plays, so no card can be stranded. Last.
  await killedInBackground('lock', { screenshot, trace, video });
});
