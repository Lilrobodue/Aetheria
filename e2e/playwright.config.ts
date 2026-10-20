import { defineConfig } from '@playwright/test';

// Aetheria's browser smoke tests (v14.5+).
//
//   cd e2e && npm install      (once; downloads @playwright/test only)
//   npm test                   (from e2e/)
//
// Drives the INSTALLED Google Chrome (channel 'chrome'), so no browser download
// is needed, and starts the Vite dev server from the repo root on its own port.
// Service workers are blocked so the app's offline cache can't serve a stale
// shell between runs. These tests are not part of the deploy.
//
// E2E_REUSE_SERVER=1 tests whatever already serves port 3100 instead of
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
  use: {
    baseURL: 'http://localhost:3100',
    channel: 'chrome',
    serviceWorkers: 'block',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    { name: 'desktop' },
    { name: 'mobile-ua', grep: /@mobile/, use: { userAgent: ANDROID_UA } },
  ],
  webServer: {
    command: 'npx vite --port 3100 --strictPort',
    cwd: '..',
    url: 'http://localhost:3100',
    reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
    timeout: 120_000,
  },
});
