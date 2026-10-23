import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, ON_DEVICE } from './fixtures';
import { adb, TEST_ORIGIN } from './adb';

// @parity (v15.1, build spec §11.3): the key analysis on this browser's production decode path, against the
// reference analyser's stored values. It drives the dev page tools/chroma-check.html, with tools/serve-readonly.mjs
// serving the reference files on 127.0.0.1:3210 (on a device, through `adb reverse tcp:3210`). Skipped unless
// E2E_PARITY_LIB is set, so the normal suites only list it as skipped. Its environment:
//
//   E2E_PARITY_LIB      the reference library.json
//   E2E_PARITY_AUDIO    the folder of the audio files (WAVs by `source`, or MP3s by `<stem>.mp3`)
//   E2E_PARITY_EXT      wav | mp3
//   E2E_PARITY_BOUNDS   tolerant | mp3 (default: by EXT)
//   E2E_PARITY_SUBSET   optional: a JSON array of `source`s to run (tools/chroma-parity.ts --write-subset)
//   E2E_PARITY_ENV      optional N: also compare band envelopes (22050 Hz against 48 kHz decodes) on every Nth track
//   E2E_PARITY_OUT      where the report (rows by library index) is written
//
// The paths stay in the environment: nothing about the reference data is written here.

const LIB = process.env.E2E_PARITY_LIB || '';
const AUDIO = process.env.E2E_PARITY_AUDIO || '';
const EXT = (process.env.E2E_PARITY_EXT || 'wav').toLowerCase();
const BOUNDS = process.env.E2E_PARITY_BOUNDS || (EXT === 'mp3' ? 'mp3' : 'tolerant');
const SUBSET = process.env.E2E_PARITY_SUBSET || '';
const ENV_EVERY = process.env.E2E_PARITY_ENV || '';
const OUT = process.env.E2E_PARITY_OUT || '';
const PORT = 3210;
const SERVER = fileURLToPath(new URL('../../tools/serve-readonly.mjs', import.meta.url));

test.describe('@parity key analysis parity', () => {
  test.skip(!LIB, 'set E2E_PARITY_LIB, E2E_PARITY_AUDIO, E2E_PARITY_EXT and E2E_PARITY_OUT to run it');

  let server: ChildProcess | null = null;
  let reversed = false;

  test.beforeAll(async () => {
    if (!AUDIO) throw new Error('E2E_PARITY_AUDIO is not set');
    const mounts = [`lib=${dirname(LIB)}`, `audio=${AUDIO}`];
    if (SUBSET) mounts.push(`sub=${dirname(SUBSET)}`);
    server = spawn(process.execPath, [SERVER, '--port', String(PORT), '--origin', TEST_ORIGIN, ...mounts], { stdio: ['ignore', 'pipe', 'pipe'] });
    const s = server;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('serve-readonly did not start')), 15_000);
      s.stdout?.on('data', (d: Buffer) => {
        if (String(d).includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      s.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`serve-readonly exited (${code})`));
      });
    });
    if (ON_DEVICE) {
      adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
      reversed = true;
    }
  });

  test.afterAll(async () => {
    if (reversed) {
      try {
        adb('reverse', '--remove', `tcp:${PORT}`);
      } catch {}
    }
    if (server && server.exitCode === null) server.kill();
    server = null;
  });

  test('the production decode path matches the reference within its bounds', async ({ page }) => {
    test.setTimeout(50 * 60_000);
    const base = `http://127.0.0.1:${PORT}`;
    const q = new URLSearchParams({ lib: `${base}/lib/${encodeURIComponent(basename(LIB))}`, src: `${base}/audio`, ext: EXT, bounds: BOUNDS });
    if (SUBSET) q.set('list', `${base}/sub/${encodeURIComponent(basename(SUBSET))}`);
    if (ENV_EVERY) q.set('env', ENV_EVERY);
    let report = '';
    page.on('console', (m) => {
      const t = m.text();
      if (t.startsWith('[chroma-check] ')) report = t.slice('[chroma-check] '.length);
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/tools/chroma-check.html?${q}`);
    const result = page.getByTestId('chroma-check-result');
    await expect(result).toHaveText(/^(PASS|FAIL)/, { timeout: 45 * 60_000 });
    if (OUT && report) writeFileSync(OUT, JSON.stringify(JSON.parse(report), null, 1) + '\n');
    expect(errors).toEqual([]);
    await expect(result).toHaveText(/^PASS \(\d+\)$/);
  });
});
