// The mix golden's fidelity (v15.8): does the lifted code the golden runs (scripts/check-mix-golden.mjs: App's own
// generators, mixInput, applyMix and autoDistribute, lifted by AST, with the recipe modules) describe what the REAL app
// does? Starts this checkout's dev server (port 3298 unless --port; --reuse to use one already there), seeds the
// golden's F160 fixture straight into IndexedDB, and for each of 25 checks: a fresh context, the classic control
// clicked by a DOM click with Math.random seeded for exactly that synchronous click, then the app's own state read back
// (the dev hook __aetheriaLibrary, localStorage, the saved play state, the page's text, the Visualizer's props through a
// DevTools-shaped hook). The expectation is the lifted code run IN THE SAME CHROME, on the same tracks and seed (V8's
// short-array sort differs between Node and Chrome, so the random-tiebreak walks are compared engine to engine).
// Then the cube: Layer Ascent and a CAB, Next through each, the Visualizer's step against the crystal playing.
//
//   node e2e/mix-parity.mjs [--port 3298] [--reuse] [--report <json>] [--only gen,gen]
//
// Exits 1 on any difference. Synthetic tracks only (the Collection paths are not exercised here: the golden does that).

import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', '3298'));
const REUSE = process.argv.includes('--reuse');
const REPORT = arg('report');
const ONLY = arg('only')?.split(',');
const ORIGIN = `http://localhost:${PORT}`;

const { loadTs, liftText, APP_FUNCS_V158, ENV_NAMES } = await import(pathToFileURL(path.join(ROOT, 'scripts/mix-golden/lift.mjs')).href);
const { buildFixtures, mulberry32 } = await import(pathToFileURL(path.join(ROOT, 'scripts/mix-golden/fixture.mjs')).href);
const { runScenarios } = await import(pathToFileURL(path.join(ROOT, 'scripts/mix-golden/recorder.mjs')).href);
const ts = loadTs(ROOT);
const cjs = (file) => ts.transpileModule(readFileSync(path.join(ROOT, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// The candidate's modules as CommonJS text, keyed by file name: the page runs them through a tiny require.
const MODULES = {
  'constants': cjs('constants.ts'),
  'crystalData': cjs('utils/crystalData.ts'),
  'recipes': cjs('utils/mix/recipes.ts'),
  'distribution': cjs('utils/mix/distribution.ts'),
  'listOps': cjs('utils/library/listOps.ts'),
};
const C = await import(pathToFileURL(path.join(ROOT, 'utils/crystalData.ts')).href);
const D = await import(pathToFileURL(path.join(ROOT, 'utils/mix/distribution.ts')).href);
const R = await import(pathToFileURL(path.join(ROOT, 'utils/mix/recipes.ts')).href);
const moduleNames = Object.keys({ ...C, ...D, ...R }).filter((k) => typeof ({ ...C, ...D, ...R })[k] === 'function' || k === k.toUpperCase());
const lifted = liftText(ts, readFileSync(path.join(ROOT, 'App.tsx'), 'utf8'), {
  moduleFuncs: [],
  appFuncs: APP_FUNCS_V158,
  envNames: [...new Set([...ENV_NAMES, 'setLoShuWalkSteps', ...moduleNames])],
  moduleImports: Object.fromEntries(moduleNames.map((k) => [k, true])),
});
const F160 = buildFixtures().F160.map(({ collection, ...s }) => s);

// ---- the server -------------------------------------------------------------------------------------------------------
let server = null;
let serverLog = '';
const stopServer = () => { if (server) try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' }); } catch {} };
if (!REUSE) {
  server = spawn('npx', ['vite', '--config', 'e2e/vite.e2e.config.ts', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, shell: true, env: { ...process.env, E2E_VITE_CACHE: process.env.E2E_VITE_CACHE || 'node_modules/.vite-e2e' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  process.on('exit', stopServer);
}
let up = false;
for (let i = 0; i < 240 && !up; i++) {
  try { up = (await fetch(ORIGIN + '/manifest.json')).ok; } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) { console.error(`no server on ${ORIGIN}`); stopServer(); process.exit(2); }

const INIT = ({ exp, cube }) => {
  localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
  localStorage.setItem('aetheria.layerEngine.v1', 'v2');
  localStorage.setItem('aetheria.layerOutput.v1', 'headphones');
  if (sessionStorage.getItem('__seeded') === null) {
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('aetheria.experienceLevel.v1', exp);
    if (cube) localStorage.setItem('aetheria.vizSettings.v1', JSON.stringify({ showLoShuCube: true, loShuCubeAutoRotate: false }));
  }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, setStrictMode() {},
    onCommitFiberRoot(_id, root) { window.__root = root; },
  };
  window.__vizProps = () => {
    const stack = [window.__root?.current];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      const p = f.memoizedProps;
      if (p && typeof p === 'object' && 'loShuWalkStep' in p && 'analyser' in p) return { step: p.loShuWalkStep, mode: p.loShuWalkMode, freq: p.selectedFrequency };
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return null;
  };
};

async function seed(page) {
  await page.goto(ORIGIN + '/manifest.json');
  await page.evaluate(async ({ lib }) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db', 2);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ['blobs', 'meta']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); if (!d.objectStoreNames.contains('playlist-state')) d.createObjectStore('playlist-state', { keyPath: 'key' }); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const rate = 4000, len = rate * 20, buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 330 * i) / rate) * 6000 * Math.min(1, i / 200, (len - i) / 200)), true);
    const tone = new Blob([buf], { type: 'audio/wav' });
    const put = (store, recs) => new Promise((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); for (const r of recs) tx.objectStore(store).put(r); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    await put('blobs', lib.map((s) => ({ id: s.id, fileBlob: tone, fileName: s.file.name, fileType: 'audio/wav' })));
    await put('meta', lib.map(({ file, ...m }) => m));
    await put('playlist-state', [{ key: 'current', playlistOrder: lib.map((s) => s.id), originalOrder: lib.map((s) => s.id), currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 528, savedAt: Date.now() }]);
    db.close();
  }, { lib: F160 });
}

async function openApp(context, opts) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss());
  await page.addInitScript(INIT, opts);
  await page.goto(ORIGIN + '/');
  await page.getByTitle('Safety Protocols', { exact: true }).waitFor({ timeout: 60000 });
  const accept = page.getByRole('button', { name: /I understand, let me begin/ });
  if (await accept.isVisible().catch(() => false)) await accept.click();
  await page.waitForFunction((n) => window.__aetheriaLibrary && window.__aetheriaLibrary.state().libraryIds.length === n, F160.length, { timeout: 60000 });
  return page;
}

/** The lifted code (this checkout's App + modules), in this page's engine, on `lib`. */
async function expectInPage(page, gen, sc, lib) {
  return page.evaluate(({ liftedJs, MODULES, runSrc, mulSrc, lib, sc, gen, envModules }) => {
    const cache = {};
    const load = (name) => {
      if (name === 'types') return {};
      if (cache[name]) return cache[name].exports;
      const m = (cache[name] = { exports: {} });
      const req = (spec) => load(spec.replace(/^.*\//, '').replace(/\.tsx?$/, ''));
      new Function('module', 'exports', 'require', MODULES[name])(m, m.exports, req);
      return m.exports;
    };
    const all = { ...load('crystalData'), ...load('distribution'), ...load('recipes') };
    const L = load('listOps');
    const deps = { ...Object.fromEntries(envModules.map((k) => [k, all[k]])), dedupeById: L.dedupeById, patchById: L.patchById };
    const run = new Function('return ' + runSrc)();
    const ev = (code) => { const m = { exports: {} }; new Function('module', 'exports', 'require', code)(m, m.exports, () => ({})); return m.exports; };
    const quiet = console.log; console.log = () => {};
    try {
      return Object.values(run(ev(liftedJs).makeApp, deps, { X: lib }, [{ ...sc, fixture: 'X' }], [gen], mulSrc))[0];
    } finally { console.log = quiet; }
  }, { liftedJs: lifted.js, MODULES, runSrc: runScenarios.toString(), mulSrc: mulberry32.toString(), lib, sc, gen, envModules: moduleNames });
}

const LABEL = {
  gut: 'GUT Alignment', heart: 'HEART Alignment', head: 'HEAD Alignment', full: 'Full Alignment', 'preset:qi': 'Qi Strength',
  'preset:healing': 'Deep Healing', 'preset:mood': 'Mood Elevate', 'preset:meditation': 'Meditation', 'preset:flow': 'Flow State',
  golden: 'Golden Φ', seq111: '111 Sequence', source2178: '2178Hz Filter', ultimate: 'Ultimate', restore: 'Restore Library',
  autoDistribute: 'Auto-Distribute Frequencies',
};
const WALK_TITLE = { 'walk:A': 'Layer Ascent', 'walk:B': 'Pillar Walk', 'walk:C': 'Flying Star Vortex', 'walk:combined': 'Combined Walk', 'walk:ouroboros': 'Ouroboros', 'walk:cabi': 'Calling a CABI' };

async function clickSeeded(page, gen, seed) {
  if (gen.startsWith('walk:')) {
    await page.getByRole('button', { name: /^Lo Shu (controls|Walk active|Perfect GUT mapping)/ }).click();
    await page.waitForFunction((t) => [...document.querySelectorAll('button[title]')].some((b) => b.title.startsWith(t)), WALK_TITLE[gen]);
  }
  return page.evaluate(({ gen, seed, mulSrc, label, title }) => {
    const btn = gen.startsWith('walk:')
      ? [...document.querySelectorAll('button[title]')].find((b) => b.title.startsWith(title))
      : [...document.querySelectorAll('aside button')].find((b) => b.textContent.replace(/\s+/g, ' ').trim().startsWith(label));
    if (!btn) return 'no button';
    const real = Math.random;
    let n = 0;
    const r = new Function('return ' + mulSrc)()(seed);
    Math.random = () => { n++; return r(); };
    try { btn.click(); } finally { Math.random = real; }
    return n;
  }, { gen, seed, mulSrc: mulberry32.toString(), label: LABEL[gen], title: WALK_TITLE[gen] });
}

async function savedState(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const st = await new Promise((resolve) => { const r = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('current'); r.onsuccess = () => resolve(r.result); });
    db.close();
    return { selectedSolfeggio: st?.selectedSolfeggio ?? null, walk: st?.loShuWalkMode ?? null, order: st?.playlistOrder?.length ?? null };
  });
}

const CHECKS = [
  ['gut', 'beginner', 1], ['heart', 'beginner', 1], ['head', 'beginner', 1], ['head', 'expert', 1], ['full', 'beginner', 1],
  ['preset:qi', 'beginner', 1], ['preset:healing', 'beginner', 1], ['preset:mood', 'beginner', 1], ['preset:meditation', 'beginner', 1],
  ['preset:flow', 'beginner', 1], ['golden', 'beginner', 1], ['seq111', 'beginner', 1], ['source2178', 'beginner', 1],
  ['ultimate', 'beginner', 1], ['walk:A', 'beginner', 1], ['walk:B', 'intermediate', 1], ['walk:C', 'beginner', 1],
  ['walk:combined', 'beginner', 1], ['walk:combined', 'beginner', 2], ['walk:ouroboros', 'beginner', 1], ['walk:ouroboros', 'beginner', 3],
  ['walk:cabi', 'beginner', 1], ['autoDistribute', 'beginner', 1], ['autoDistribute', 'beginner', 2], ['restore', 'beginner', 1],
];
const report = { origin: ORIGIN, checks: [], cube: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (const [gen, exp, seedN] of CHECKS.filter(([g]) => !ONLY || ONLY.includes(g))) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const seedPage = await context.newPage();
    await seed(seedPage);
    await seedPage.close();
    const page = await openApp(context, { exp, cube: false });
    // The restore probes the lengths of tracks stored without one; Assign's stand-ins read them, so wait for them all.
    if (gen === 'autoDistribute') await page.waitForFunction(() => window.__aetheriaLibrary.state().libraryDurations.every((d) => typeof d === 'number' && d > 0), null, { timeout: 60000 });
    const st0 = await page.evaluate(() => window.__aetheriaLibrary.state());
    const lib = F160.map((s, i) => ({ ...s, duration: st0.libraryDurations[i] }));
    const want = await expectInPage(page, gen, { exp, history: null, historyName: 'none', seed: seedN, width: 1280 }, lib);
    const rngCalls = await clickSeeded(page, gen, seedN);
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => window.__aetheriaLibrary.state());
    const ls = await page.evaluate(() => ({ exp: localStorage.getItem('aetheria.experienceLevel.v1'), viz: JSON.parse(localStorage.getItem('aetheria.vizSettings.v1') || '{}') }));
    const bodyText = await page.evaluate(() => document.body.innerText);
    const W = want.canon.state;
    // The 2 s debounced save, polled until it holds the new play order.
    let saved = await savedState(page);
    for (let i = 0; i < 24 && saved.order !== (W.setPlaylist ? W.setPlaylist.ids.length : saved.order); i++) { await page.waitForTimeout(500); saved = await savedState(page); }
    await page.waitForTimeout(500);
    saved = await savedState(page);
    const vizFreq = await page.evaluate(() => window.__vizProps()?.freq ?? null);
    const wantOrder = W.setPlaylist ? W.setPlaylist.ids : st0.ids;
    const firstNotice = want.canon.notices.find((n) => n[0] === 0 && n[1]);
    const c = {
      gen, exp, seed: seedN,
      rngCallsApp: rngCalls, rngCallsLifted: want.rngCalls, thrown: want.canon.thrown,
      order: JSON.stringify(st.ids) === JSON.stringify(wantOrder),
      cursor: W.setCurrentSongIndex === undefined ? st.cursor === st0.cursor : st.cursor === W.setCurrentSongIndex,
      walk: (st.walk ?? null) === (W.setLoShuWalkMode ?? null),
      segments: W.setLoShuWalkSegments === undefined ? true : JSON.stringify(st.segments) === JSON.stringify(W.setLoShuWalkSegments),
      phases: W.setLoShuWalkPhases === undefined ? true : JSON.stringify(st.phases) === JSON.stringify(W.setLoShuWalkPhases),
      steps: W.setLoShuWalkSteps === undefined ? true : JSON.stringify(st.steps) === JSON.stringify(W.setLoShuWalkSteps),
      playing: st.playing === want.canon.play.length > 0,
      experience: ls.exp === (W.setUserExperienceLevel ?? exp),
      viz: !W.setVizSettings || Object.entries(W.setVizSettings).every(([k, v]) => JSON.stringify(ls.viz[k]) === JSON.stringify(v)),
      notice: !firstNotice || bodyText.includes(firstNotice[1].slice(0, 60)),
      selectedSolfeggio: W.setSelectedSolfeggio !== undefined ? saved.selectedSolfeggio === W.setSelectedSolfeggio && vizFreq === W.setSelectedSolfeggio : true,
      crystals: gen !== 'autoDistribute' ? true : (() => {
        const ch = new Map((W.setOriginalPlaylist?.changed ?? []).map(([id, t]) => [id, t[1]]));
        return st.libraryIds.every((id, i) => (ch.has(id) ? ch.get(id) === st.crystals[i] : st.crystals[i] === (F160[i].closestSolfeggio ?? null)));
      })(),
      lengths: { app: st.ids.length, lifted: wantOrder.length },
    };
    c.ok = !c.thrown && ['order', 'cursor', 'walk', 'segments', 'phases', 'steps', 'playing', 'experience', 'viz', 'notice', 'selectedSolfeggio', 'crystals'].every((k) => c[k]) && c.rngCallsApp === c.rngCallsLifted;
    report.checks.push(c);
    console.log(`${c.ok ? 'OK  ' : 'DIFF'} ${gen.padEnd(18)} ${exp.padEnd(12)} seed ${seedN}  draws ${c.rngCallsApp}/${c.rngCallsLifted}  order ${c.order} (${c.lengths.app}/${c.lengths.lifted}) cursor ${c.cursor} walk ${c.walk} seg ${c.segments} ph ${c.phases} steps ${c.steps} play ${c.playing} exp ${c.experience} viz ${c.viz} notice ${c.notice} tone ${c.selectedSolfeggio} crystals ${c.crystals}`);
    await context.close();
  }

  // ---- the cube: the Visualizer's step names the crystal that plays -----------------------------------------------------
  const SEQS = (() => { const m = { exports: {} }; new Function('module', 'exports', 'require', MODULES.constants)(m, m.exports, () => ({})); return m.exports.LO_SHU_WALKS; })();
  for (const [gen, nexts] of (ONLY ? [] : [['walk:A', 12], ['walk:combined', 14]])) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const sp = await context.newPage();
    await seed(sp);
    await sp.close();
    const page = await openApp(context, { exp: 'expert', cube: true });
    await clickSeeded(page, gen, 1);
    await page.waitForFunction(() => window.__aetheriaLibrary.state().playing, null, { timeout: 20000 });
    const SEQ = SEQS[gen.slice(5)];
    const rows = [];
    for (let k = 0; k <= nexts; k++) {
      await page.waitForFunction((c) => window.__aetheriaLibrary.state().cursor === c, k, { timeout: 15000 });
      await page.waitForTimeout(350);
      const st = await page.evaluate(() => window.__aetheriaLibrary.state());
      const vp = await page.evaluate(() => window.__vizProps());
      const playing = st.crystals[st.libraryIds.indexOf(st.ids[st.cursor])];
      rows.push({ cursor: st.cursor, playing, cubeStep: vp?.step ?? null, cubeCrystal: vp && vp.step >= 0 ? SEQ[vp.step] : null });
      if (k < nexts) await page.getByRole('button', { name: 'Next track' }).click();
    }
    const off = rows.filter((r) => r.cubeCrystal !== r.playing);
    report.cube.push({ gen, rows, off: off.length, ok: off.length === 0 });
    console.log(`${off.length ? 'DIFF' : 'OK  '} cube ${gen}: ${rows.length} tracks, the Visualizer's step on the playing crystal for ${rows.length - off.length}`);
    await context.close();
  }
} finally {
  await browser.close();
  stopServer();
}
const bad = report.checks.filter((c) => !c.ok).length + report.cube.filter((c) => !c.ok).length;
report.summary = `${report.checks.filter((c) => c.ok).length} of ${report.checks.length} checks match the lifted code in the same Chrome; cube ${report.cube.filter((c) => c.ok).length} of ${report.cube.length}`;
if (REPORT) writeFileSync(REPORT, JSON.stringify(report, null, 1) + '\n');
console.log(`mix-parity: ${report.summary}`);
process.exit(bad ? 1 : 0);
