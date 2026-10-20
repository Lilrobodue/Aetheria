import { test as base, expect, chromium, type Browser } from '@playwright/test';
import { DEVICE, TEST_ORIGIN } from './adb';

// The suite's `test`. Locally it is Playwright's own (a fresh browser context
// per test). With E2E_DEVICE set it drives the phone's Chrome instead, over the
// DevTools socket that device-setup forwards to localhost:9222: the phone has
// one Chrome profile — the user's own — so each test gets a new tab with
// everything the TEST origin stored cleared first. Only that origin: the live
// app's and the user's own dev server's (localhost:3100) are never touched.
export const ON_DEVICE = !!DEVICE;

const deviceTest = base.extend<{}, { phoneChrome: Browser }>({
  phoneChrome: [
    async ({}, use) => {
      const browser = await chromium.connectOverCDP('http://localhost:9222');
      await use(browser);
      await browser.close(); // disconnects; the phone's Chrome keeps running
    },
    { scope: 'worker' },
  ],
  context: async ({ phoneChrome }, use) => {
    await use(phoneChrome.contexts()[0]);
  },
  page: async ({ context, baseURL }, use) => {
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
    });
    await use(page);
    await page.close();
  },
});

export const test = (ON_DEVICE ? deviceTest : base) as typeof base;
export { expect };
