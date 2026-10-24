// Offline relaunch check (v15.3) with the REAL service worker, on a production build served with
// GitHub-Pages-like headers (serve-dist.mjs; never `vite preview`, whose Vary: Origin + no-cache stalls any
// offline reload). Installed Chrome at 411×752, service workers allowed, a fresh profile.
//
//   node e2e/offline-check.mjs --dist <new dist> [--from <previous release dist>] [--port 3199]
//                              [--version v15.3] [--shot <png>]
//
// Without --from: a first visit to the new build. With --from: a returning user's upgrade — the previous release
// is served and visited first (its SW installs and caches), then the same origin serves the new build and the page
// reloads twice (the network-first shell finds the new SW; skipWaiting + clients.claim take over).
//
// Online, it asserts: the only cache is aetheria-<version>-offline; no cache name or cached URL names Tailwind or
// aistudiocdn; the cache holds /, the new build's main CSS and main JS; no request to cdn.tailwindcss.com or
// aistudiocdn.com since the new build was served; the header badge reads <version>. Then the browser's HTTP cache
// is emptied (or Pages' max-age=600 would serve the files for ten minutes without the service worker), the network
// goes away (context.setOffline) and the page reloads: the app boots, styled from the one cached main CSS (> 900 rules), with
// the --ae-* variables, the "Offline Mode" indicator and no page errors. <version> defaults to the new build's
// sw.js CACHE_NAME. Exit code 1 on any failure; a JSON report on stdout.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve-dist.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DIST = arg('dist');
const FROM = arg('from');
const PORT = Number(arg('port', process.env.E2E_PORT || '3199'));
if (!DIST) {
  console.error('usage: node e2e/offline-check.mjs --dist <new dist> [--from <old dist>] [--port 3199] [--version v15.3] [--shot <png>]');
  process.exit(2);
}
const ORIGIN = `http://localhost:${PORT}`;
const swSource = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
const cacheFromSw = /["'](aetheria-(v[\d.]+)-offline)["']/.exec(swSource);
const VERSION = arg('version', cacheFromSw?.[2] ?? '');
const CACHE = `aetheria-${VERSION}-offline`;
const SHOT = path.resolve(arg('shot', path.join(HERE, 'test-results', FROM ? 'offline-check-upgrade.png' : 'offline-check.png')));
// The new build's own bundle names, read from its index.html.
const newHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const MAIN_CSS = /\/assets\/main-[\w-]+\.css/.exec(newHtml)?.[0];
const MAIN_JS = /\/assets\/main-[\w-]+\.js/.exec(newHtml)?.[0];

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
};
const report = { mode: FROM ? 'upgrade' : 'fresh', dist: path.resolve(DIST), from: FROM ? path.resolve(FROM) : null, version: VERSION };

const browser = await chromium.launch({ channel: 'chrome' });
let server = null;
try {
  check('the new build names its version', VERSION && cacheFromSw && cacheFromSw[1] === CACHE, { swCacheName: cacheFromSw?.[1] ?? null });
  check('the new build has a main CSS and JS', MAIN_CSS && MAIN_JS, { MAIN_CSS, MAIN_JS });

  const ctx = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 411, height: 752 } });
  const requests = []; // { phase, url }
  let phase = FROM ? 'old' : 'new';
  ctx.on('request', (r) => requests.push({ phase, url: r.url() }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push({ phase, message: e.message }));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.addInitScript(() => localStorage.setItem('aetheria_v3_tutorial_seen', 'true'));

  const appUp = async (timeout = 20_000) => {
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor({ timeout });
    const accept = page.getByRole('button', { name: /I understand, let me begin/ });
    if (await accept.isVisible().catch(() => false)) await accept.click();
  };
  const cacheContents = () =>
    page.evaluate(async () => {
      const out = {};
      for (const name of await caches.keys()) {
        out[name] = (await (await caches.open(name)).keys()).map((r) => r.url.replace(location.origin, ''));
      }
      return out;
    });
  const waitForCached = async (paths, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const all = Object.values(await cacheContents()).flat();
      if (paths.every((p) => (p instanceof RegExp ? all.some((u) => p.test(u)) : all.includes(p)))) return true;
      if (Date.now() > end) return false;
      await page.waitForTimeout(500);
    }
  };

  if (FROM) {
    // The previous release, as a returning user has it.
    server = await serve(FROM, { port: PORT });
    await page.goto(ORIGIN + '/');
    await appUp();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    check('the previous release cached its main CSS', await waitForCached([/^\/assets\/main-[\w-]+\.css$/], 20_000));
    await page.reload();
    await appUp();
    await page.waitForTimeout(1500);
    report.before = {
      badge: (await page.locator('header h1 > span').first().textContent())?.trim(),
      caches: await cacheContents(),
      controlled: await page.evaluate(() => !!navigator.serviceWorker.controller),
    };
    await server.close();
    server = null;

    // The same origin now serves the new build.
    server = await serve(DIST, { port: PORT });
    phase = 'new';
    await page.reload(); // network-first shell: the new index.html; the new SW is found and installs
    await appUp();
    await page.waitForTimeout(4000);
    await page.reload(); // the new SW (skipWaiting + clients.claim) controls
    await appUp();
  } else {
    server = await serve(DIST, { port: PORT });
    await page.goto(ORIGIN + '/');
    await appUp();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await waitForCached([MAIN_CSS], 20_000);
    await page.reload();
    await appUp();
  }

  // ---- Online ----
  const cachedAll = await waitForCached(['/', MAIN_CSS, MAIN_JS], 20_000);
  await page.waitForTimeout(1000);
  const caches = await cacheContents();
  const names = Object.keys(caches);
  const cachedUrls = Object.values(caches).flat();
  const newRequests = requests.filter((r) => r.phase === 'new');
  const cdnRequests = (re) => newRequests.filter((r) => re.test(r.url)).map((r) => r.url);
  report.online = {
    caches: Object.fromEntries(Object.entries(caches).map(([n, urls]) => [n, urls.filter((u) => /^\/$|assets|tailwind|aistudiocdn/.test(u))])),
    cachedUrlCount: cachedUrls.length,
    controller: await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
    tailwindRequests: cdnRequests(/tailwindcss\.com/),
    aistudiocdnRequests: cdnRequests(/aistudiocdn\.com/),
    badge: (await page.locator('header h1 > span').first().textContent())?.trim(),
    tailwindGlobal: await page.evaluate(() => typeof window.tailwind),
  };
  check(`caches.keys() is ['${CACHE}']`, names.length === 1 && names[0] === CACHE, names);
  check('no cache name names Tailwind', !names.some((n) => /tailwind/i.test(n)), names);
  check('no cached URL is Tailwind or aistudiocdn', !cachedUrls.some((u) => /tailwind|aistudiocdn/i.test(u)), cachedUrls.filter((u) => /tailwind|aistudiocdn/i.test(u)));
  check(`the cache holds /, ${MAIN_CSS} and ${MAIN_JS}`, cachedAll && ['/', MAIN_CSS, MAIN_JS].every((p) => (caches[CACHE] ?? []).includes(p)));
  check('the page is controlled by /sw.js', report.online.controller === `${ORIGIN}/sw.js`, report.online.controller);
  check('no request to cdn.tailwindcss.com since the new build was served', report.online.tailwindRequests.length === 0, report.online.tailwindRequests);
  check('no request to aistudiocdn.com since the new build was served', report.online.aistudiocdnRequests.length === 0, report.online.aistudiocdnRequests);
  check('no Tailwind runtime (window.tailwind undefined)', report.online.tailwindGlobal === 'undefined', report.online.tailwindGlobal);
  check(`the header badge reads ${VERSION}`, report.online.badge === VERSION, report.online.badge);

  // ---- Offline ----
  // Empty the browser's HTTP cache first: Pages' max-age=600 would otherwise answer the service worker's fetches
  // from it for ten minutes, offline or not, and the boot would prove nothing about the SW's own cache. A relaunch
  // after those ten minutes is the case that matters (airplane mode, hours later).
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.detach();
  report.httpCacheCleared = true;
  const errorsBefore = errors.length;
  await ctx.setOffline(true);
  phase = 'offline';
  const t0 = Date.now();
  await page.reload();
  const booted = await page
    .getByTitle('Safety Protocols', { exact: true })
    .waitFor({ timeout: 15_000 })
    .then(() => true, () => false);
  report.offline = { booted, bootMs: Date.now() - t0 };
  check('offline: the app boots (Safety Protocols visible within 15 s)', booted, `${report.offline.bootMs} ms`);
  if (booted) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => {
      const sheets = [...document.styleSheets].map((sheet) => {
        let rules = -1;
        try {
          rules = sheet.cssRules.length;
        } catch {}
        return { href: sheet.href ? sheet.href.replace(location.origin, '') : null, tag: sheet.ownerNode?.nodeName ?? null, rules };
      });
      const header = document.querySelector('header');
      const hs = header ? getComputedStyle(header) : null;
      const hc = document.querySelector('button[aria-label="Harmonic Control"]');
      const cs = hc ? getComputedStyle(hc) : null;
      return {
        sheets,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        header: hs ? { display: hs.display, justify: hs.justifyContent, borderBottom: hs.borderBottomColor } : null,
        hcButton: cs ? { radius: cs.borderTopLeftRadius, border: cs.borderTopColor, borderWidth: cs.borderTopWidth, padding: cs.paddingTop } : null,
        gold400: getComputedStyle(document.documentElement).getPropertyValue('--ae-gold-400').trim(),
      };
    });
    report.offline.styled = s;
    const linked = s.sheets.filter((x) => x.href);
    check('offline: body background rgb(2, 6, 23)', s.bodyBg === 'rgb(2, 6, 23)', s.bodyBg);
    check(
      'offline: header flex / space-between / bottom border rgba(30, 41, 59, 0.5)',
      s.header && s.header.display === 'flex' && s.header.justify === 'space-between' && s.header.borderBottom === 'rgba(30, 41, 59, 0.5)',
      s.header
    );
    check(
      'offline: Harmonic Control button radius 9999px, border rgb(30, 41, 59) 1px, padding 6px',
      s.hcButton && s.hcButton.radius === '9999px' && s.hcButton.border === 'rgb(30, 41, 59)' && s.hcButton.borderWidth === '1px' && s.hcButton.padding === '6px',
      s.hcButton
    );
    check(
      `offline: exactly one linked stylesheet, ${MAIN_CSS}, with > 900 rules`,
      linked.length === 1 && linked[0].href === MAIN_CSS && linked[0].rules > 900,
      linked
    );
    check('offline: --ae-gold-400 is #fbbf24', s.gold400.toLowerCase() === '#fbbf24', s.gold400);
    const indicator =
      (await page.getByText('Offline Mode', { exact: true }).isVisible().catch(() => false)) &&
      (await page.getByText('App cached for offline use', { exact: true }).isVisible().catch(() => false));
    check('offline: the "Offline Mode / App cached for offline use" indicator shows', indicator);
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    await page.screenshot({ path: SHOT, animations: 'disabled', style: 'canvas{visibility:hidden !important}' });
    report.offline.screenshot = SHOT;
  }
  report.pageErrors = errors;
  check('no page errors on the new build (online and offline)', errors.filter((e) => e.phase !== 'old').length === 0, errors);
  report.offline.newErrors = errors.length - errorsBefore;
  await ctx.setOffline(false);
  await ctx.close();
} catch (e) {
  check('the check ran to the end', false, String(e?.stack ?? e));
} finally {
  await browser.close().catch(() => {});
  if (server) await server.close();
}

report.checks = checks;
const failed = checks.filter((c) => !c.ok);
report.result = failed.length ? `FAIL (${failed.length} of ${checks.length})` : `PASS (${checks.length} checks)`;
console.log(JSON.stringify(report, null, 1));
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}`);
console.log(report.result);
process.exit(failed.length ? 1 : 0);
