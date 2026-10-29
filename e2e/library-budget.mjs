// The Library tab's performance budget (v15.7, spec §3.11), measured on a PRODUCTION build served with Pages-like
// headers (serve-dist.mjs), in the installed Chrome at 411×752 (a phone), playing, over a library seeded straight into
// IndexedDB (tone-0001 …: the first 30 real tones, the rest tiny WAVs with a stated length).
//
//   node e2e/library-budget.mjs --dist <v15.7 dist> [--ref <v15.6 dist>] [--port 3298] [--sizes 1000,5000] [--out <json>]
//
// Per size it measures, on the Library tab:
//   idle (playing)        components per commit (React's DevTools hook: the fibers each commit rendered), main-thread
//                         ms/s (CDP Performance.getMetrics), the GPU process's CPU % (SystemInfo.getProcessInfo) and
//                         the visualizer's draws/s (the perf HUD);
//   slow and fast scroll  8 and 48 px per frame for 4 s: the same, plus fibers per commit, App renders, rows mounted;
//   slow scroll at 4× CPU (Emulation.setCPUThrottlingRate) and its frame p95 (rAF intervals);
//   search                six keys 400 ms apart, paused: script ms per key, App renders per key;
//   sort                  Name then Crystal: change → the next frame;
//   a row tap             the click's synchronous work, and the metadata saves in the 3 s after (one, as a Next);
//   the tab's mount       at 4× CPU: the tab button's click → the first frame with rows (reported, not gated).
// With --ref (the previous release, whose Library tab is a stub) it measures that stub's idle window the same way, as
// the same-session reference. It exits 1 on any limit and writes the JSON report (--out, else stdout).
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
const REF = arg('ref');
const PORT = Number(arg('port', '3298'));
const SIZES = arg('sizes', '1000,5000').split(',').map(Number);
const OUT = arg('out');
if (!DIST) {
  console.error('usage: node e2e/library-budget.mjs --dist <dist> [--ref <dist>] [--port 3298] [--sizes 1000,5000] [--out <json>]');
  process.exit(2);
}
const ORIGIN = `http://localhost:${PORT}`;
const PHONE = { width: 411, height: 752 };

// §3.11's limits.
const LIMITS = {
  idleComponentsMed: 3,
  idleMainMsPerS: 32,
  idleGpuPct: 2.5,
  idleDraws: 0,
  slowMainMsPerS: 80,
  slowScriptMsPerS: 25,
  slowGpuPct: 10,
  slowComponentsMed: 10,
  slowComponentsMax: 30,
  slowFibersMed: 60,
  fastMainMsPerS: 170,
  fastGpuPct: 12,
  slow4xMainMsPerS: 420,
  slow4xFrameP95: 16.7,
  searchScriptMsPerKey: 6,
  searchAppRendersPerKey: 0,
  sortToFrameMs: 30,
  tapHandlerMs: 5,
  tapMetaSaves: 1,
  rowsMounted: 30,
};

// Before the app: the tutorial seen, v2 with Headphones, the new layout, the HUD on; a React DevTools-shaped hook that
// counts, per commit, the fibers React visited and the components that rendered, and whether App rendered (its fiber
// found once as the function component with the most hooks); IndexedDB puts on the state store counted.
const INIT = () => {
  localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
  localStorage.setItem('aetheria.perfhud.v1', '1');
  localStorage.setItem('aetheria.layerEngine.v1', 'v2');
  localStorage.setItem('aetheria.layerOutput.v1', 'headphones');
  localStorage.setItem('aetheria.layout.v1', 'new');
  localStorage.setItem('aetheria.disclaimer.v1', '2026-10-21');
  const w = window;
  w.__statePuts = 0;
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...a) {
    if (this.name === 'playlist-state' && a[0]?.key === 'current') w.__statePuts++; // v16.1: not the saved playlists' 'pl:' puts
    return put.apply(this, a);
  };
  const F = (w.__fib = { on: false, skip: 1, commits: 0, perCommit: [], app: new WeakSet(), appCommits: 0, total: 0 });
  let prev = new WeakSet();
  const COMPONENT = new Set([0, 1, 11, 14, 15]);
  const hooks = (f) => {
    let n = 0;
    for (let h = f.memoizedState; h && n < 2000 && typeof h === 'object' && 'next' in h; h = h.next) n++;
    return n;
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, setStrictMode() {},
    onCommitFiberRoot(_id, root) {
      const stack = [root.current];
      const all = [];
      while (stack.length) {
        const f = stack.pop();
        all.push(f);
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      // App: the function component with the most hooks (found on the first commits, kept with its alternate).
      if (!F.appFound) {
        let best = null, most = 0;
        for (const f of all) if (f.tag === 0) { const n = hooks(f); if (n > most) { most = n; best = f; } }
        if (best && most > 100) { F.app.add(best); if (best.alternate) F.app.add(best.alternate); F.appFound = true; }
      }
      if (!F.on) { prev = new WeakSet(all); return; }
      let visited = 0, rendered = 0, appRendered = false;
      for (const f of all) {
        const isApp = F.app.has(f) || (f.alternate && F.app.has(f.alternate));
        if (isApp) { F.app.add(f); if (f.alternate) F.app.add(f.alternate); }
        if (!prev.has(f)) {
          visited++;
          if (COMPONENT.has(f.tag) && (f.flags & 1)) { rendered++; if (isApp) appRendered = true; }
        }
      }
      prev = new WeakSet(all);
      F.total = all.length;
      if (F.skip > 0) { F.skip--; return; }
      F.commits++;
      if (appRendered) F.appCommits++;
      if (F.perCommit.length < 2000) F.perCommit.push([visited, rendered]);
    },
  };
};

// The synthetic library (helpers.seedLibraryRecords' schema and rules: crystals on the real tones, keys and envelopes
// on some).
const SEED = async ({ n, real, seconds }) => {
  const CRY = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
  const wav = (secs, freq) => {
    const rate = 8000, len = Math.max(8, Math.round(secs * rate)), buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) { const f = Math.min(1, i / 400, (len - i) / 400); v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000 * f), true); }
    return new Blob([buf], { type: 'audio/wav' });
  };
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('aetheria-db', 2);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['blobs', 'meta']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); if (!d.objectStoreNames.contains('playlist-state')) d.createObjectStore('playlist-state', { keyPath: 'key' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const t0 = Date.now() - n * 1000, ids = [], tiny = wav(0.01, 440);
  for (let start = 0; start < n; start += 500) {
    const tx = db.transaction(['blobs', 'meta'], 'readwrite');
    for (let i = start; i < Math.min(n, start + 500); i++) {
      const num = i + 1, name = `tone-${String(num).padStart(4, '0')}`, id = `${t0 + i * 1000}-${Math.random().toString(36).slice(2, 11)}`;
      ids.push(id);
      const isReal = i < real;
      tx.objectStore('blobs').put({ id, fileBlob: isReal ? wav(seconds, 220 + (i % 40) * 17) : tiny, fileName: `${name}.wav`, fileType: 'audio/wav' });
      const meta = { id, name, duration: isReal ? seconds : 150 + ((num * 37) % 240) };
      if (isReal || num % 10 < 7) { const hz = isReal ? CRY[i % 27] : CRY[(num * 7) % 27]; meta.harmonicFreq = hz; meta.closestSolfeggio = hz; meta.harmonicDeviation = 3; }
      if (num % 2 === 0) { meta.chroma = Array.from({ length: 12 }, (_, k) => (k === num % 12 ? 0.34 : 0.06)); meta.chromaA4Hz = 440; meta.musicKey = ['Am', 'C', 'Em', 'G'][num % 4]; meta.keyConfidence = 0.62; meta.chromaVersion = 1; }
      if (num % 5 < 2) { const a = () => new Uint8Array(20).fill(90); meta.visualEnvelope = { fps: 20, sub: a(), bass: a(), mid: a(), high: a() }; }
      tx.objectStore('meta').put(meta);
    }
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  const tx = db.transaction('playlist-state', 'readwrite');
  tx.objectStore('playlist-state').put({ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 396, savedAt: Date.now() });
  await new Promise((res) => { tx.oncomplete = res; });
  db.close();
  return ids.length;
};

const med = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const round = (x, d = 1) => (x === null || x === undefined ? null : +Number(x).toFixed(d));

async function metrics(session) {
  const { metrics } = await session.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { task: m.TaskDuration, script: m.ScriptDuration };
}
async function gpu(bsession) {
  const { processInfo } = await bsession.send('SystemInfo.getProcessInfo');
  return processInfo.filter((p) => String(p.type).toLowerCase() === 'gpu').reduce((a, p) => a + p.cpuTime, 0);
}
async function censusStart(page) {
  await page.evaluate(() => { const F = window.__fib; F.on = true; F.skip = 1; F.commits = 0; F.appCommits = 0; F.perCommit = []; });
}
async function censusStop(page) {
  return page.evaluate(() => {
    const F = window.__fib;
    F.on = false;
    return { commits: F.commits, appCommits: F.appCommits, perCommit: F.perCommit.slice() };
  });
}
/** The HUD's draws/s over the next `n` one-second lines. */
async function hudDraws(page, perf, n = 3) {
  const start = perf.length;
  const t0 = Date.now();
  while (perf.length < start + n + 1 && Date.now() - t0 < (n + 4) * 1000) await page.waitForTimeout(250);
  return perf.slice(start + 1, start + 1 + n).map((l) => Number(/draws ([\d.]+)\/s/.exec(l)?.[1] ?? NaN));
}

/** One measured window of `seconds` while `during` runs (or idles): main-thread and script ms/s, GPU %, the census. */
async function window_(page, session, bsession, seconds, during) {
  await censusStart(page);
  const m0 = await metrics(session), g0 = await gpu(bsession), t0 = Date.now();
  const extra = during ? await during() : (await page.waitForTimeout(seconds * 1000), null);
  const m1 = await metrics(session), g1 = await gpu(bsession), t1 = Date.now();
  const c = await censusStop(page);
  const s = (t1 - t0) / 1000;
  const comps = c.perCommit.map((x) => x[1]);
  const fibers = c.perCommit.map((x) => x[0]);
  return {
    seconds: round(s),
    mainMsPerS: round(((m1.task - m0.task) * 1000) / s),
    scriptMsPerS: round(((m1.script - m0.script) * 1000) / s),
    gpuPct: round(((g1 - g0) * 100) / s),
    commitsPerS: round(c.commits / s, 2),
    appCommits: c.appCommits,
    componentsMed: med(comps),
    componentsMax: comps.length ? Math.max(...comps) : null,
    fibersMed: med(fibers),
    ...(extra ?? {}),
  };
}

/** Scroll the Library list by `px` per frame for `ms`, recording the frame intervals and the rows mounted. */
const SCROLL = ({ px, ms }) =>
  new Promise((resolve) => {
    const sc = document.querySelector('[data-testid="library-scroll"]');
    const frames = [];
    let rows = 0, last = performance.now(), dir = 1;
    const t0 = last;
    const step = (now) => {
      frames.push(now - last);
      last = now;
      rows = Math.max(rows, document.querySelectorAll('[data-testid="library-row"]').length);
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - px) dir = -1;
      if (sc.scrollTop <= px && dir < 0) dir = 1;
      sc.scrollTop += dir * px;
      if (now - t0 < ms) requestAnimationFrame(step);
      else resolve({ frames: frames.slice(1), rows });
    };
    requestAnimationFrame(step);
  });

async function openSeeded(browser, n, { stub = false } = {}) {
  const context = await browser.newContext({ baseURL: ORIGIN, viewport: PHONE, serviceWorkers: 'block' });
  const page = await context.newPage();
  const perf = [];
  const errors = [];
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[perf] ')) perf.push(t.slice(7)); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.dismiss());
  await page.addInitScript(INIT);
  await page.goto('/manifest.json');
  await page.evaluate(SEED, { n, real: 30, seconds: 120 });
  await page.goto('/');
  await page.getByTestId('new-shell').waitFor({ timeout: 60_000 });
  const accept = page.getByRole('button', { name: /I understand, let me begin/ });
  if (await accept.isVisible().catch(() => false)) await accept.click();
  // Play tone-0002 (from Now Playing's Play: the play order's first track, then Next), then the Library tab.
  await page.getByTestId('np-source').filter({ hasText: `${n} tracks` }).waitFor({ timeout: 60_000 }); // restored
  await page.getByTestId('np-play').click();
  try {
    await page.waitForFunction(() => navigator.mediaSession.playbackState === 'playing', null, { timeout: 30_000 });
  } catch (e) {
    await page.screenshot({ path: path.join(HERE, 'test-results', 'library-budget-no-play.png') }).catch(() => {});
    throw new Error(`library-budget: nothing played (${errors.join('; ')})`);
  }
  await page.getByTestId('tab-library-button').click();
  await page.getByTestId(stub ? 'tab-library' : 'library-scroll').waitFor({ timeout: 30_000 });
  // Past the restore's own changes and the first play's, and the metadata save each of them schedules 2 s later (at
  // 5,000 tracks one rewrite of every record: a long task that would land in the idle window).
  await page.waitForTimeout(6500);
  const session = await context.newCDPSession(page);
  await session.send('Performance.enable');
  return { context, page, session, perf, errors };
}

async function measureSize(browser, bsession, n) {
  const out = { n };
  const { context, page, session, perf, errors } = await openSeeded(browser, n);
  try {
    out.idle = await window_(page, session, bsession, 4);
    out.idle.draws = await hudDraws(page, perf, 2);
    // Scrolls (playing), then at 4× CPU.
    out.slowScroll = await window_(page, session, bsession, 4, async () => {
      const r = await page.evaluate(SCROLL, { px: 8, ms: 4000 });
      return { framesP95: round(pct(r.frames, 0.95)), rowsMax: r.rows };
    });
    out.fastScroll = await window_(page, session, bsession, 4, async () => {
      const r = await page.evaluate(SCROLL, { px: 48, ms: 4000 });
      return { framesP95: round(pct(r.frames, 0.95)), rowsMax: r.rows };
    });
    await page.waitForTimeout(3000);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    out.slowScroll4x = await window_(page, session, bsession, 4, async () => {
      const r = await page.evaluate(SCROLL, { px: 8, ms: 4000 });
      return { framesP95: round(pct(r.frames, 0.95)), rowsMax: r.rows };
    });
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // A row tap (not the first play of the session): the click's synchronous work, then the state saves in 3 s.
    await page.getByTestId('library-scroll').evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(500);
    const tap = await page.evaluate(async () => {
      const btn = document.querySelector('[data-testid="library-row"] [data-row-index="4"]');
      const before = window.__statePuts;
      const t0 = performance.now();
      btn.click();
      const handlerMs = performance.now() - t0;
      await new Promise((r) => requestAnimationFrame(() => r()));
      const frameMs = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 3200));
      return { handlerMs, frameMs, metaSaves: window.__statePuts - before };
    });
    out.tap = { handlerMs: round(tap.handlerMs, 2), frameMs: round(tap.frameMs), metaSaves: tap.metaSaves };
    // Sort: change → the next frame.
    out.sort = {};
    for (const s of ['name', 'crystal', 'library']) {
      out.sort[s] = round(
        await page.evaluate(
          (s) =>
            new Promise((resolve) => {
              const sel = document.querySelector('select[aria-label="Sort"]');
              const t0 = performance.now();
              sel.value = s;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              requestAnimationFrame(() => resolve(performance.now() - t0));
            }),
          s
        )
      );
      await page.waitForTimeout(600);
    }
    // Search, paused (so App renders only for a cause): six keys 400 ms apart.
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForTimeout(1500);
    const field = page.getByTestId('library-search');
    await field.click();
    await page.waitForTimeout(500);
    const keys = 'tone-1';
    out.search = await window_(page, session, bsession, 0, async () => {
      for (const k of keys) {
        await page.keyboard.type(k);
        await page.waitForTimeout(400);
      }
      return {};
    });
    out.search.keys = keys.length;
    // The window's script is the keys' (plus 400 ms idles): per key.
    out.search.scriptMsPerKey = round((out.search.scriptMsPerS * out.search.seconds) / keys.length, 2);
    out.search.appRendersPerKey = round(out.search.appCommits / keys.length, 2);
    await field.fill('');
    // The tab's mount at 4× CPU: Now Playing, then the tab button's click → the first frame with rows.
    await page.getByTestId('tab-now-button').click();
    await page.waitForTimeout(1500);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    out.mount4xMs = round(
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const t0 = performance.now();
            document.querySelector('[data-testid="tab-library-button"]').click();
            const check = () => (document.querySelector('[data-testid="library-row"]') ? resolve(performance.now() - t0) : requestAnimationFrame(check));
            requestAnimationFrame(check);
          })
      )
    );
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    out.pageErrors = errors.slice();
  } finally {
    await context.close();
  }
  return out;
}

async function measureStub(browser, bsession, n) {
  const { context, page, session, perf } = await openSeeded(browser, n, { stub: true });
  try {
    const idle = await window_(page, session, bsession, 4);
    idle.draws = await hudDraws(page, perf, 2);
    return { n, idle };
  } finally {
    await context.close();
  }
}

function gate(r) {
  const fails = [];
  const at = (cond, what) => { if (!cond) fails.push(what); };
  const L = LIMITS;
  at(r.idle.componentsMed <= L.idleComponentsMed, `idle components/commit ${r.idle.componentsMed} > ${L.idleComponentsMed}`);
  at(r.idle.mainMsPerS <= L.idleMainMsPerS, `idle main ${r.idle.mainMsPerS} ms/s > ${L.idleMainMsPerS}`);
  at(r.idle.gpuPct <= L.idleGpuPct, `idle GPU ${r.idle.gpuPct} % > ${L.idleGpuPct}`);
  at(r.idle.draws.every((d) => d === L.idleDraws), `idle draws ${r.idle.draws} ≠ 0`);
  if (r.n >= 5000) {
    at(r.slowScroll.mainMsPerS <= L.slowMainMsPerS, `slow scroll main ${r.slowScroll.mainMsPerS} > ${L.slowMainMsPerS}`);
    at(r.slowScroll.scriptMsPerS <= L.slowScriptMsPerS, `slow scroll script ${r.slowScroll.scriptMsPerS} > ${L.slowScriptMsPerS}`);
    at(r.slowScroll.gpuPct <= L.slowGpuPct, `slow scroll GPU ${r.slowScroll.gpuPct} > ${L.slowGpuPct}`);
    at(r.slowScroll.componentsMed <= L.slowComponentsMed, `slow scroll components/commit med ${r.slowScroll.componentsMed} > ${L.slowComponentsMed}`);
    at(r.slowScroll.componentsMax <= L.slowComponentsMax, `slow scroll components/commit max ${r.slowScroll.componentsMax} > ${L.slowComponentsMax}`);
    at(r.slowScroll.fibersMed <= L.slowFibersMed, `slow scroll fibers/commit med ${r.slowScroll.fibersMed} > ${L.slowFibersMed}`);
    at(r.fastScroll.mainMsPerS <= L.fastMainMsPerS, `fast scroll main ${r.fastScroll.mainMsPerS} > ${L.fastMainMsPerS}`);
    at(r.fastScroll.gpuPct <= L.fastGpuPct, `fast scroll GPU ${r.fastScroll.gpuPct} > ${L.fastGpuPct}`);
    at(r.slowScroll4x.mainMsPerS <= L.slow4xMainMsPerS, `slow scroll 4× main ${r.slowScroll4x.mainMsPerS} > ${L.slow4xMainMsPerS}`);
    at(r.slowScroll4x.framesP95 <= L.slow4xFrameP95, `slow scroll 4× frame p95 ${r.slowScroll4x.framesP95} > ${L.slow4xFrameP95}`);
    at(r.search.scriptMsPerKey <= L.searchScriptMsPerKey, `search script ${r.search.scriptMsPerKey} ms/key > ${L.searchScriptMsPerKey}`);
    at(r.search.appRendersPerKey <= L.searchAppRendersPerKey, `search App renders ${r.search.appRendersPerKey}/key > 0`);
    for (const [s, ms] of Object.entries(r.sort)) at(ms <= L.sortToFrameMs, `sort ${s} → frame ${ms} ms > ${L.sortToFrameMs}`);
  }
  at(r.tap.handlerMs <= L.tapHandlerMs, `tap handler ${r.tap.handlerMs} ms > ${L.tapHandlerMs}`);
  at(r.tap.metaSaves === L.tapMetaSaves, `tap meta saves ${r.tap.metaSaves} ≠ ${L.tapMetaSaves}`);
  for (const w of ['slowScroll', 'fastScroll', 'slowScroll4x']) at(r[w].rowsMax <= L.rowsMounted, `${w} rows mounted ${r[w].rowsMax} > ${L.rowsMounted}`);
  at(!r.pageErrors.length, `page errors: ${r.pageErrors.join('; ')}`);
  return fails;
}

const report = { dist: path.resolve(DIST), ref: REF ? path.resolve(REF) : null, limits: LIMITS, sizes: [], reference: [], failures: [] };
const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const bsession = await browser.newBrowserCDPSession();
let server = null;
try {
  if (REF) {
    server = await serve(REF, { port: PORT });
    for (const n of SIZES) report.reference.push(await measureStub(browser, bsession, n));
    await server.close();
    server = null;
  }
  server = await serve(DIST, { port: PORT });
  for (const n of SIZES) {
    const r = await measureSize(browser, bsession, n);
    r.failures = gate(r);
    report.sizes.push(r);
    report.failures.push(...r.failures.map((f) => `${n}: ${f}`));
  }
} finally {
  if (server) await server.close();
  await browser.close();
}
const json = JSON.stringify(report, null, 1);
if (OUT) fs.writeFileSync(OUT, json);
else console.log(json);
console.log(report.failures.length ? `library-budget: ${report.failures.length} over the budget:\n  ${report.failures.join('\n  ')}` : `library-budget: every limit holds at ${SIZES.join(' and ')} tracks.`);
process.exit(report.failures.length ? 1 : 0);
