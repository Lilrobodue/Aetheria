import { test as base, expect, chromium, type Browser, type Page } from '@playwright/test';
import { DEVICE, TEST_ORIGIN } from './adb';
import { closeOtherTestTabs } from './leftoverTabs';

// The suite's `test`. Locally it is Playwright's own (a fresh browser context
// per test). With E2E_DEVICE set it drives the phone's Chrome instead, over the
// DevTools socket that device-setup forwards to localhost:9222: the phone has
// one Chrome profile — the user's own — so each test gets a new tab with
// everything the TEST origin stored cleared first. Only that origin: the live
// app's and the user's own dev server's (localhost:3100) are never touched.
export const ON_DEVICE = !!DEVICE;

/**
 * The native-dialog guard (v15.4), on every test's page: an alert(), confirm()
 * or prompt() freezes the page's JavaScript until someone taps OK, and with it
 * auto-advance and the lock-screen card. Each one is recorded (and dismissed, so
 * the test can go on) in the page's `__nativeDialogs` list, which openApp
 * returns; the fixture fails the test at its end if the list is not empty.
 * Idempotent: a second call returns the same list.
 */
export function watchNativeDialogs(page: Page): string[] {
  const existing = (page as any).__nativeDialogs as string[] | undefined;
  if (existing) return existing;
  const opened: string[] = [];
  (page as any).__nativeDialogs = opened;
  page.on('dialog', (d) => {
    opened.push(`${d.type()}: ${d.message().slice(0, 120)}`);
    d.dismiss().catch(() => {});
  });
  return opened;
}

function expectNoNativeDialogs(opened: string[]): void {
  expect(opened, 'a native alert/confirm/prompt opened: it freezes the page, and with it auto-advance').toEqual([]);
}

/**
 * On a device, no failure artifact may be taken (playwright.config.ts): the CDP context the tests share holds the
 * user's own Chrome tabs, and Playwright's page snapshot and screenshots would capture them. Fails fast, before a
 * tab is opened, if a screenshot, trace or video option is on (a CLI flag overrides the config), or if the page
 * snapshot is not switched off.
 */
export function assertNoDeviceArtifacts(options: { screenshot: unknown; trace: unknown; video: unknown }): void {
  const modeOf = (v: unknown) => (typeof v === 'string' ? v : ((v as { mode?: string } | null | undefined)?.mode ?? 'off'));
  const on = Object.entries(options).filter(([, v]) => modeOf(v) !== 'off').map(([k]) => k);
  if (on.length) {
    throw new Error(`On a device, ${on.join(', ')} would capture the user's own Chrome tabs: run without them.`);
  }
  if (process.env.PLAYWRIGHT_NO_COPY_PROMPT !== '1') {
    throw new Error("On a device the failure page snapshot must be off (PLAYWRIGHT_NO_COPY_PROMPT=1, set by playwright.config.ts).");
  }
}

/**
 * v16.7.3 (fix round 1, F5): a device run's own limits, before it touches the phone. The test origin is never port 3100
 * (the user's dev server: clearing it would wipe the user's library) and the run has exactly one worker (the leftover
 * guard closes every other tab at the test origin, which a second worker's live test would own).
 */
export function assertDeviceRun(testOrigin: string, workers: number): void {
  if (new URL(testOrigin).port === '3100') throw new Error(`Refusing to run on ${testOrigin}: port 3100 is the user's own dev server.`);
  if (workers !== 1) throw new Error(`Refusing to run with ${workers} workers on a device: one worker only (another worker's test tab would look like a leftover).`);
}

/**
 * v16.8: the new layout is the app's default, and a saved "classic" from before v16.8 is moved to it once (decision
 * 1 B). The suites written for classic keep testing classic: `layoutSeed` (default 'classic') is saved before the
 * tab's first load, as a tap on "Use the classic layout" after the move would, unless the profile already holds a
 * choice; with it the moved-over card's memory (aetheria.layoutNotice.v1 = 'seen'), so no seeded test ever meets the
 * one-time move or the card. Once per tab (a sessionStorage flag), so a test that clears storage and reloads sees
 * the real default. The new-layout helpers write 'new' themselves (their init scripts run after this one) or load
 * ?layout=new. `test.use({ layoutSeed: null })` seeds nothing: the tests of the default itself (default-layout.spec).
 * Fix round 1 (review N2): only on `origin`, the tests' own (TEST_ORIGIN): a tab that followed a link elsewhere (on
 * the phone, the live app) is never seeded, so it never cancels that origin's one-time move. fixtures-seed.spec.ts
 * checks the rules on the desktop. (v16.9's classic removal was cancelled, 2026-11-08: the option stays.)
 */
export type LayoutSeed = 'classic' | 'new' | null;
export const SEED_KEYS = { layout: 'aetheria.layout.v1', notice: 'aetheria.layoutNotice.v1' } as const;

export async function seedLayout(page: Page, layoutSeed: LayoutSeed, origin: string): Promise<void> {
  if (!layoutSeed) return;
  await page.addInitScript(
    ({ v, keys, origin }) => {
      if (location.origin !== origin) return; // another origin (or about:blank): never seeded
      try {
        if (sessionStorage.getItem('__e2eLayoutSeeded') === null) {
          sessionStorage.setItem('__e2eLayoutSeeded', '1');
          if (localStorage.getItem(keys.layout) === null) localStorage.setItem(keys.layout, v);
          if (localStorage.getItem(keys.notice) === null) localStorage.setItem(keys.notice, 'seen');
        }
      } catch {
        // No storage here (e.g. about:blank): nothing to seed.
      }
    },
    { v: layoutSeed, keys: SEED_KEYS, origin }
  );
}

const localTest = base.extend<{ layoutSeed: LayoutSeed }>({
  layoutSeed: ['classic', { option: true }],
  page: async ({ page, layoutSeed }, use) => {
    const opened = watchNativeDialogs(page);
    await seedLayout(page, layoutSeed, TEST_ORIGIN);
    await use(page);
    expectNoNativeDialogs(opened);
  },
});

const deviceTest = base.extend<{ layoutSeed: LayoutSeed }, { phoneChrome: Browser }>({
  layoutSeed: ['classic', { option: true }],
  phoneChrome: [
    async ({ screenshot, trace, video }, use, workerInfo) => {
      // Before connecting: once the phone's context exists, a trace or a screenshot would already record its tabs.
      assertNoDeviceArtifacts({ screenshot, trace, video });
      // v16.7.3 (fix round 1, F5): never the user's own dev server's origin (its storage is the user's library), and one
      // worker only (another worker's live test tab would look like a leftover to closeOtherTestTabs).
      assertDeviceRun(TEST_ORIGIN, workerInfo.config.workers);
      const browser = await chromium.connectOverCDP('http://localhost:9222');
      await use(browser);
      await browser.close(); // disconnects; the phone's Chrome keeps running
    },
    { scope: 'worker' },
  ],
  context: async ({ phoneChrome }, use) => {
    await use(phoneChrome.contexts()[0]);
  },
  page: async ({ context, phoneChrome, baseURL, screenshot, trace, video, layoutSeed }, use) => {
    assertNoDeviceArtifacts({ screenshot, trace, video });
    const page = await context.newPage();
    // v16.7.3 (fix round 1, F5): any throw while setting the tab up (the origin
    // guard, a leftover that won't close, the clear) closes this tab first, so
    // no about:blank tab is left in the user's own Chrome.
    try {
      // The phone's existing profile has no baseURL (Playwright applies it only
      // to contexts it creates), so resolve the tests' relative URLs here.
      const goto = page.goto.bind(page);
      page.goto = (url, options) => goto(new URL(url, baseURL).toString(), options);
      const origin = new URL(baseURL!).origin;
      if (origin !== TEST_ORIGIN) throw new Error(`Refusing to clear ${origin}: only ${TEST_ORIGIN} is the tests' own.`);
      // v16.7.3: a stopped run's leftover tab at the test origin could save its
      // stale library over this test's (leftoverTabs.ts). Test-origin tabs only.
      const closed = await closeOtherTestTabs(phoneChrome, page, TEST_ORIGIN);
      if (closed) console.log(`[fixtures] closed ${closed} leftover ${TEST_ORIGIN} tab${closed === 1 ? '' : 's'}`);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
      await cdp.detach();
      // The desktop runs' layout, so every selector holds; the engine, the audio
      // stack, the media session and the (mobile) user agent are the phone's.
      await page.setViewportSize({ width: 1280, height: 800 });
      // No service worker, as `serviceWorkers: 'block'` does locally: it would
      // cache dev modules between runs.
      await page.addInitScript(() => {
        if (navigator.serviceWorker) (navigator.serviceWorker as any).register = () => new Promise(() => {});
        // Every media element the app plays (it keeps them out of the DOM), so
        // the teardown below can stop them all.
        const media = ((window as any).__e2eMedia = new Set<HTMLMediaElement>());
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
          media.add(this);
          return play.call(this);
        };
      });
      // v16.8: the layout seed, inside the try (a throw here still closes the tab) and after the clear, so its
      // once-per-tab sessionStorage flag starts unset at this tab's first load.
      await seedLayout(page, layoutSeed, TEST_ORIGIN);
    } catch (e) {
      await page.close().catch(() => {});
      throw e;
    }
    const opened = watchNativeDialogs(page);
    await use(page);
    // Stop the app's media and release its media session, then unload it.
    // A tab torn down a moment after its lock-screen card appeared (a failed
    // play leaves the silent anchor looping) can strand Chrome's Android card
    // on PLAYING until Chrome restarts, and a stranded card takes the media
    // keys the next test sends.
    await page
      .evaluate(() => {
        for (const el of (window as any).__e2eMedia ?? []) {
          try { el.pause(); } catch {}
        }
        try {
          navigator.mediaSession.playbackState = 'none';
          navigator.mediaSession.metadata = null;
        } catch {}
      })
      .catch(() => {});
    await page.waitForTimeout(1000).catch(() => {});
    await page.goto('about:blank').catch(() => {});
    await page.close();
    // After the teardown above, so a failing guard never skips it.
    expectNoNativeDialogs(opened);
  },
});

export const test = (ON_DEVICE ? deviceTest : localTest) as typeof localTest;
export { expect };
