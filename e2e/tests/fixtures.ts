import { test as base, expect, chromium, type Browser, type Page } from '@playwright/test';
import { DEVICE, TEST_ORIGIN } from './adb';

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

const localTest = base.extend({
  page: async ({ page }, use) => {
    const opened = watchNativeDialogs(page);
    await use(page);
    expectNoNativeDialogs(opened);
  },
});

const deviceTest = base.extend<{}, { phoneChrome: Browser }>({
  phoneChrome: [
    async ({ screenshot, trace, video }, use) => {
      // Before connecting: once the phone's context exists, a trace or a screenshot would already record its tabs.
      assertNoDeviceArtifacts({ screenshot, trace, video });
      const browser = await chromium.connectOverCDP('http://localhost:9222');
      await use(browser);
      await browser.close(); // disconnects; the phone's Chrome keeps running
    },
    { scope: 'worker' },
  ],
  context: async ({ phoneChrome }, use) => {
    await use(phoneChrome.contexts()[0]);
  },
  page: async ({ context, baseURL, screenshot, trace, video }, use) => {
    assertNoDeviceArtifacts({ screenshot, trace, video });
    const page = await context.newPage();
    // The phone's existing profile has no baseURL (Playwright applies it only
    // to contexts it creates), so resolve the tests' relative URLs here.
    const goto = page.goto.bind(page);
    page.goto = (url, options) => goto(new URL(url, baseURL).toString(), options);
    const origin = new URL(baseURL!).origin;
    if (origin !== TEST_ORIGIN) throw new Error(`Refusing to clear ${origin}: only ${TEST_ORIGIN} is the tests' own.`);
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

export const test = (ON_DEVICE ? deviceTest : localTest) as typeof base;
export { expect };
