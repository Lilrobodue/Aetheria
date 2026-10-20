import { defineConfig } from '@playwright/test';
import { DEVICE, TEST_PORT, TEST_ORIGIN } from './tests/adb';

// Aetheria's browser smoke tests (v14.5+).
//
//   cd e2e && npm install      (once; downloads @playwright/test only)
//   npm test                   (from e2e/)
//   npm run test:device        (the same tests on the USB-connected Android
//                               phone's Chrome, plus the lock-screen test)
//
// Drives the INSTALLED Google Chrome (channel 'chrome'), so no browser download
// is needed, and starts the Vite dev server from the repo root on the tests'
// own port, 3199 — never 3100, the dev server you run yourself (on a phone a
// library loaded there lives in the same Chrome profile the tests use).
// Service workers are blocked so the app's offline cache can't serve a stale
// shell between runs. These tests are not part of the deploy.
//
// On a device (E2E_DEVICE set; see tests/adb.ts) the phone's Chrome loads the
// test server through `adb reverse`. The tests wipe http://localhost:3199's
// storage before each test and touch no other origin: not the live app's, and
// not localhost:3100. device-setup.ts wires up adb and turns the media volume
// down meanwhile.
//
// E2E_REUSE_SERVER=1 tests whatever already serves port 3199 instead of
// starting this checkout — only for deliberate runs against another build
// (e.g. the previous release, to prove a test fails on the old code).

// Android Chrome: the app's IS_MOBILE_DEVICE check switches on the silent
// media-session anchor and the mobile volume path. Desktop viewport, so the
// layout and selectors stay the same.
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './device-setup.ts',
  use: {
    baseURL: TEST_ORIGIN,
    channel: 'chrome',
    serviceWorkers: 'block',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  // real-library.spec.ts runs only when asked for (E2E_REAL_LIBRARY=1 on a
  // device run, --project=android-real): it drives YOUR library in YOUR tab.
  testIgnore: process.env.E2E_REAL_LIBRARY ? undefined : /real-library\.spec\.ts/,
  projects: DEVICE
    ? [
        { name: 'android', grepInvert: /@device|@real/ },
        // Turns the screen off (and leaves a phone with a secure lock locked),
        // so it runs after everything else.
        { name: 'android-lock-screen', grep: /@device/, dependencies: ['android'] },
        ...(process.env.E2E_REAL_LIBRARY ? [{ name: 'android-real', grep: /@real/ }] : []),
      ]
    : [
        { name: 'desktop', grepInvert: /@device|@real/ },
        { name: 'mobile-ua', grep: /@mobile/, grepInvert: /@device|@real/, use: { userAgent: ANDROID_UA } },
      ],
  webServer: {
    command: `npx vite --port ${TEST_PORT} --strictPort`,
    cwd: '..',
    url: TEST_ORIGIN,
    reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
    timeout: 120_000,
  },
});
