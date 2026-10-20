// npm run test:device [-- <playwright args>]: the suite on the Android device.
// E2E_DEVICE picks it (default: the one USB-connected phone; see tests/adb.ts).
// Runs Playwright's CLI with this Node directly (no shell), so arguments such
// as -g "a test name" arrive intact.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, E2E_DEVICE: process.env.E2E_DEVICE || 'usb' },
});
process.exit(result.status ?? 1);
