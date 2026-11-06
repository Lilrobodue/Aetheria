// e2e/upgrade-check.mjs (v16.8): the offline upgrade check (decisions 1 B / 2 A). Returning users of the previous release
// move to this one through the real service worker, on production builds served with GitHub-Pages-like headers
// (serve-dist.mjs), installed Chrome, fresh browser contexts of its own (never your profile, your tabs or your data).
//
//   vite build --config e2e/vite.e2e.config.ts --outDir <old> --emptyOutDir   (the previous build: the release before this one)
//   vite build --config e2e/vite.e2e.config.ts --outDir <new> --emptyOutDir   (this checkout)
//   node e2e/upgrade-check.mjs --old <old> --new <new> [--port 3199] [--version v16.8.1]
//                                       (v16.8.1: the new build's version, its header badge and its cache's name;
//                                       default the checkout's components/ErrorBoundary.tsx APP_VERSION)
//
// Profiles, each its own context:
//   classic  the previous build: ?layout=classic (a saved "classic", as Back to classic leaves it), the statement accepted
//   new      the previous build: ?layout=new (a beta user), the statement accepted
//   never    the previous build: opened, the statement accepted, no layout chosen (the common existing user)
//   fresh    first visit on v16.8
// Each returning profile closed the first-run tutorial on the previous build (its key set, as a real close sets it).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const E2E = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(E2E, 'package.json'));
const { chromium } = require('@playwright/test');
const { serve } = await import(pathToFileURL(path.join(E2E, 'serve-dist.mjs')).href);

const arg = (n, f) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const OLD = arg('old');
const NEW = arg('new');
const PORT = Number(arg('port', process.env.E2E_PORT || '3199'));
// v16.8.1: the version the new build carries (it was written in as v16.8).
const { readFileSync } = await import('node:fs');
const VERSION = arg('version', readFileSync(path.join(E2E, '..', 'components', 'ErrorBoundary.tsx'), 'utf8').match(/export const APP_VERSION = '([^']+)'/)?.[1]);
if (!VERSION) throw new Error('upgrade-check: no --version, and no APP_VERSION in components/ErrorBoundary.tsx');
const CACHE = `aetheria-${VERSION}-offline`;
if (!OLD || !NEW) {
  console.error('usage: node e2e/upgrade-check.mjs --old <previous release dist> --new <this build dist> [--port 3199]');
  process.exit(2);
}
if (PORT === 3100) throw new Error('port 3100 is your own dev server: pick another');
const ORIGIN = `http://localhost:${PORT}`;

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
const report = {};

const browser = await chromium.launch({ channel: 'chrome' });
let server = null;
const PROFILES = ['classic', 'new', 'never'];
const ctxs = {};
const pages = {};
const errors = {};
try {
  const appUp = async (page, timeout = 20_000) => {
    await page.locator('[data-testid="new-shell"], header [title="Safety Protocols"]').first().waitFor({ timeout });
    await page.waitForTimeout(800);
  };
  const accept = (page) => page.getByRole('button', { name: /I understand, let me begin/ });
  const state = async (page) => ({
    statement: await accept(page).isVisible().catch(() => false),
    shell: (await page.getByTestId('new-shell').count()) > 0,
    classic: (await page.locator('header [title="Safety Protocols"]').count()) > 0,
    card: await page.getByTestId('layout-card').isVisible().catch(() => false),
    tour: (await page.getByTestId('tour').count()) > 0,
    quickGuide: (await page.getByText('Quick Guide', { exact: true }).count()) > 0,
    layout: await page.evaluate(() => localStorage.getItem('aetheria.layout.v1')),
    notice: await page.evaluate(() => localStorage.getItem('aetheria.layoutNotice.v1')),
    accepted: await page.evaluate(() => localStorage.getItem('aetheria.disclaimer.v1')),
    caches: await page.evaluate(async () => await caches.keys()),
    controlled: await page.evaluate(() => !!navigator.serviceWorker.controller),
    version: await page.evaluate(() => document.querySelector('header h1 > span')?.textContent?.trim() ?? null),
  });
  const waitCached = async (page) => {
    for (let i = 0; i < 40; i++) {
      const n = await page.evaluate(async () => {
        let c = 0;
        for (const k of await caches.keys()) c += (await (await caches.open(k)).keys()).filter((r) => /\/assets\/main-.*\.js$/.test(r.url)).length;
        return c;
      });
      if (n) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };

  // ---- The previous build: the returning users' profiles ----
  server = await serve(OLD, { port: PORT });
  for (const p of PROFILES) {
    const ctx = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 411, height: 752 } });
    ctxs[p] = ctx;
    const page = await ctx.newPage();
    pages[p] = page;
    errors[p] = [];
    page.on('pageerror', (e) => errors[p].push(e.message));
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(`${ORIGIN}/${p === 'classic' ? '?layout=classic' : p === 'new' ? '?layout=new' : ''}`);
    await appUp(page);
    await page.evaluate(() => localStorage.setItem('aetheria_v3_tutorial_seen', 'true'));
    if (await accept(page).isVisible().catch(() => false)) await accept(page).click();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    check(`${p}: the previous build cached its main JS`, await waitCached(page));
    await page.reload();
    await appUp(page);
    report[`${p}.previous`] = await state(page);
  }
  check('classic on the previous build: classic, saved', report['classic.previous'].classic && report['classic.previous'].layout === 'classic', report['classic.previous']);
  check('new on the previous build: new, saved', report['new.previous'].shell && report['new.previous'].layout === 'new', report['new.previous']);
  check('never on the previous build: classic (the old default), nothing saved', report['never.previous'].classic && report['never.previous'].layout === null, report['never.previous']);
  await server.close();
  server = null;

  // ---- v16.8 on the same origin: the update ----
  server = await serve(NEW, { port: PORT });
  for (const p of PROFILES) {
    const page = pages[p];
    await page.reload(); // the network-first shell: the new index.html; the new SW installs
    await appUp(page);
    await page.waitForTimeout(4000);
    await page.reload(); // the new SW (skipWaiting + clients.claim) controls
    await appUp(page);
    report[`${p}.v168`] = await state(page);
  }
  const c = report['classic.v168'];
  check('classic: moved once to the new layout, with the card; the saved "classic" removed; marked due', c.shell && c.card && c.layout === null && c.notice === 'due', c);
  check('classic: the statement is not shown again', !c.statement && c.accepted === '2026-10-21', c);
  const n = report['new.v168'];
  check('new: the new layout, no card, the choice kept, marked seen', n.shell && !n.card && n.layout === 'new' && n.notice === 'seen', n);
  check('new: the statement is not shown again', !n.statement, n);
  const v = report['never.v168'];
  check('never: the new layout with the card, nothing saved, marked due', v.shell && v.card && v.layout === null && v.notice === 'due', v);
  check('never: the statement is not shown again; no tour by itself', !v.statement && !v.tour, v);
  for (const p of PROFILES) {
    check(`${p}: the only cache is ${CACHE}, controlled`, JSON.stringify(report[`${p}.v168`].caches) === JSON.stringify([CACHE]) && report[`${p}.v168`].controlled, report[`${p}.v168`].caches);
  }

  // The card stays until tapped (a reload: again), then never again.
  {
    const page = pages.classic;
    await page.reload();
    await appUp(page);
    report['classic.reload'] = await state(page);
    check('classic: the card left open comes back at the next launch', report['classic.reload'].card && report['classic.reload'].shell, report['classic.reload']);
    await page.getByRole('button', { name: 'Dismiss the layout notice', exact: true }).click();
    await page.reload();
    await appUp(page);
    report['classic.closed'] = await state(page);
    check('classic: closed with X, never again (the move does not repeat)', report['classic.closed'].shell && !report['classic.closed'].card && report['classic.closed'].notice === 'seen' && report['classic.closed'].layout === null, report['classic.closed']);
  }
  // The card's Use the classic layout: classic from then on.
  {
    const page = pages.never;
    await page.getByTestId('layout-card-classic').click();
    await page.locator('header [title="Safety Protocols"]').waitFor({ timeout: 10_000 });
    await page.reload();
    await appUp(page);
    report['never.classic'] = await state(page);
    check('never: Use the classic layout holds across a reload, no card', report['never.classic'].classic && !report['never.classic'].card && report['never.classic'].layout === 'classic' && report['never.classic'].notice === 'seen', report['never.classic']);
    check(`never: the classic header names ${VERSION}`, report['never.classic'].version === VERSION, report['never.classic'].version);
  }

  // ---- A new install on v16.8 ----
  {
    const ctx = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 411, height: 752 } });
    ctxs.fresh = ctx;
    const page = await ctx.newPage();
    pages.fresh = page;
    errors.fresh = [];
    page.on('pageerror', (e) => errors.fresh.push(e.message));
    await page.goto(ORIGIN + '/');
    await appUp(page);
    report['fresh.first'] = await state(page);
    const f = report['fresh.first'];
    check('fresh: the statement over the new layout; no card; marked fresh', f.statement && f.shell && !f.classic && !f.card && f.notice === 'fresh' && f.layout === null, f);
    await accept(page).click();
    await page.getByRole('dialog', { name: 'Tour, card 1 of 4', exact: true }).waitFor({ timeout: 10_000 });
    check("fresh: the new layout's tour, not classic's Quick Guide", (await page.getByText('Quick Guide', { exact: true }).count()) === 0);
    await page.getByTestId('tour').getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await waitCached(page);
    await page.reload();
    await appUp(page);
    report['fresh.second'] = await state(page);
    const s = report['fresh.second'];
    check('fresh: the next launch: the new layout, no statement, no tour, no card', s.shell && !s.statement && !s.tour && !s.card && s.notice === 'fresh', s);
  }

  // ---- Offline relaunches (the HTTP cache emptied first, so only the service worker's cache answers) ----
  for (const [p, want] of [['classic', 'new'], ['new', 'new'], ['never', 'classic'], ['fresh', 'new']]) {
    const page = pages[p];
    const cdp = await ctxs[p].newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await cdp.detach();
    await ctxs[p].setOffline(true);
    await page.reload();
    let booted = true;
    try {
      await appUp(page, 15_000);
    } catch {
      booted = false;
    }
    report[`${p}.offline`] = booted ? await state(page) : { booted };
    const o = report[`${p}.offline`];
    check(`${p}: offline, the app boots in the ${want} layout, no statement, no card`, booted && (want === 'new' ? o.shell : o.classic) && !o.statement && !o.card, o);
    await ctxs[p].setOffline(false);
  }
  for (const p of [...PROFILES, 'fresh']) check(`${p}: no page errors`, errors[p].length === 0, errors[p]);
} catch (e) {
  check('the check ran to the end', false, String(e?.stack ?? e));
} finally {
  await browser.close().catch(() => {});
  if (server) await server.close();
}
report.checks = checks;
const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify(report, null, 1));
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}`);
console.log(failed.length ? `FAIL (${failed.length} of ${checks.length})` : `PASS (${checks.length} checks)`);
process.exit(failed.length ? 1 : 0);
