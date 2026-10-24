import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
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
  // parity.spec.ts (v15.3) too (E2E_PARITY=1): it compares a production build
  // served by serve-dist.mjs with screenshots of the previous release. Matched
  // by its whole file name, so chroma-parity.spec.ts is not caught by it.
  testIgnore: [
    ...(process.env.E2E_REAL_LIBRARY ? [] : [/real-library\.spec\.ts/]),
    ...(process.env.E2E_PARITY ? [] : [/[\\/]parity\.spec\.ts$/]),
  ],
  // The parity baselines: machine- and Chrome-specific, never committed (.gitignore).
  snapshotPathTemplate: '{testDir}/../parity-baseline/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixels: 0,
      // Playwright's default (0.2) is blind to a 20%-alpha dark fill on the near-black UI: the Auto-Distribute
      // button's old bg-gold-900/20, put back, passed at 0.2 (measured: its pixels sit at 0.06). 0.02 still
      // ignores the one-level rounding the build's minifier gives semi-transparent colours (#f59e0b4d = 0.302 for
      // /30; at most 0.004), which v15.2.1 hid under the Tailwind CDN's unminified copies of the same rules.
      threshold: 0.02,
      stylePath: fileURLToPath(new URL('./tests/parity.css', import.meta.url)),
    },
  },
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
    command: `npx vite --config e2e/vite.e2e.config.ts --port ${TEST_PORT} --strictPort`,
    cwd: '..',
    url: TEST_ORIGIN,
    reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
    timeout: 120_000,
  },
});
