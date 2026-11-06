// Heat and performance soak on the phone — the release thermal gate.
//
//   node perf-soak.mjs --label B0-v14.5 [--minutes 20] [--origin http://localhost:3100] [--layout new|classic|as-is]
//
// Plays the library in YOUR open tab of --origin from its first track with the
// perf HUD on (?perf=1), and every second reads the HUD's line (visualizer
// draws, animation frames, React commits, long tasks, and the Spectrum layer's
// hexagons and µs per frame while it runs); every 30 s the phone's
// temperatures (AP / SKIN / battery), the page's JS heap and the playback
// state. Same conditions every run so releases compare: screen kept on, fixed
// brightness, media volume 2. Everything it changes is put back at the end
// (HUD off with ?perf=0, settings restored). It never imports, deletes or
// clears anything. Serve a PRODUCTION build on --origin for numbers that match
// the deployed app (vite build --outDir X, then vite preview --outDir X).
// Results: soak-results/<label>.json, and a summary on stdout.
// v16.8 (the new layout is the default): it runs whichever layout the tab opens (--layout as-is, the default: the
// layout is never written), or the one asked for with --layout new|classic (through ?layout=, which saves it; the
// tab's saved layout choice and v16.8's layout notice are put back at the end exactly as they were). B0 was measured
// in classic, so compare a soak with the same layout (the summary names it). In the new layout it presses Now
// Playing's Play (the phone's np-play or the desktop's desktop-play, a DOM click as real-library's press does): the
// play order, the walk, the queue and the shuffle stay exactly as the tab had them (a Library row's tap would replace
// them, and that would be saved), and the moved-over card, if it shows, is left alone. The soak then plays from the
// tab's own cursor; the track it starts on is logged. Classic's sidebar plays the library's first track in place.
// v16.8 (review 3): it refuses to run while the tab has tracks waiting in the queue: playing marks them played, so the
// user's queue would empty (and that is saved). Play or clear them first.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { adb, assertUnlocked, mediaSession } from './tests/adb.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const label = arg('label', `soak-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
const minutes = Number(arg('minutes', '20'));
const origin = arg('origin', 'http://localhost:3100');
const layoutArg = arg('layout', 'as-is');
if (!['new', 'classic', 'as-is'].includes(layoutArg)) throw new Error('--layout is new, classic or as-is');
const LAYOUT_KEYS = ['aetheria.layout.v1', 'aetheria.layoutNotice.v1'];

const temps = () => {
  const out = adb('shell', 'dumpsys', 'thermalservice');
  const section = out.split('Current temperatures from HAL:')[1] ?? '';
  const read = (name) => Number(new RegExp(`mValue=([\\d.]+), mType=\\d+, mName=${name},`).exec(section)?.[1] ?? NaN);
  return { ap: read('AP'), skin: read('SKIN'), battery: read('BAT') };
};
const setting = (ns, key) => adb('shell', 'settings', 'get', ns, key).trim();

adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
assertUnlocked();
adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote');

const saved = {
  stayOn: setting('global', 'stay_on_while_plugged_in'),
  brightnessMode: setting('system', 'screen_brightness_mode'),
  brightness: setting('system', 'screen_brightness'),
  volume: /volume is (\d+)/.exec(adb('shell', 'cmd', 'media_session', 'volume', '--stream', '3', '--get'))?.[1],
};
const restore = () => {
  adb('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', saved.stayOn);
  adb('shell', 'settings', 'put', 'system', 'screen_brightness_mode', saved.brightnessMode);
  adb('shell', 'settings', 'put', 'system', 'screen_brightness', saved.brightness);
  if (saved.volume) adb('shell', 'cmd', 'media_session', 'volume', '--stream', '3', '--set', saved.volume);
};

const browser = await chromium.connectOverCDP('http://localhost:9222');
const tab = browser.contexts()[0].pages().find((p) => p.url().replace(/[?#].*$/, '') === origin + '/');
if (!tab) throw new Error(`Open your library at ${origin} on the phone first.`);

let savedLayoutKeys = null; // --layout new|classic: the tab's own values, put back at the end
let shownLayout = null;
const perf = [];
const samples = [];
const errors = [];
tab.on('console', (m) => {
  const t = m.text();
  const x = /^\[perf\] draws ([\d.]+)\/s · rAF ([\d.]+)\/s · commits ([\d.]+)\/s · long (\d+) \((\d+) ms\)/.exec(t);
  if (x) {
    const entry = { at: Date.now(), draws: +x[1], raf: +x[2], commits: +x[3], longTasks: +x[4], longMs: +x[5] };
    // v14.8: the Spectrum layer's part, present only in windows where it ran.
    const sp = / · spec ([\d.]+)\/f (\d+)µs/.exec(t);
    if (sp) { entry.specDrawn = +sp[1]; entry.specUs = +sp[2]; }
    // v15.1: Analyse tracks' work (ms per second, main thread and native steps), present only in windows where it worked.
    const ps = / · pass main (\d+) ms\/s native (\d+) ms\/s/.exec(t);
    if (ps) { entry.passMainMs = +ps[1]; entry.passNativeMs = +ps[2]; }
    perf.push(entry);
  } else if (m.type() === 'error') errors.push(t);
});
tab.on('pageerror', (e) => errors.push(e.message));

try {
  adb('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '3'); // AC + USB
  adb('shell', 'settings', 'put', 'system', 'screen_brightness_mode', '0');
  adb('shell', 'settings', 'put', 'system', 'screen_brightness', '100');
  adb('shell', 'cmd', 'media_session', 'volume', '--stream', '3', '--set', '2');
  await tab.bringToFront();

  if (layoutArg !== 'as-is') {
    savedLayoutKeys = await tab.evaluate((keys) => keys.map((k) => [k, localStorage.getItem(k)]), LAYOUT_KEYS);
  }
  await tab.goto(`${origin}/?perf=1${layoutArg === 'as-is' ? '' : `&layout=${layoutArg}`}`);
  // From v14.6 the disclaimer shows only until accepted: wait for the app (v16.8: either layout, under the statement
  // too), then accept it only if it is there.
  await tab.locator('[data-testid="new-shell"], header [title="Safety Protocols"]').first().waitFor({ timeout: 30_000 });
  shownLayout = (await tab.getByTestId('new-shell').count()) > 0 ? 'new' : 'classic';
  const accept = tab.getByRole('button', { name: /I understand, let me begin/ });
  if (await accept.isVisible().catch(() => false)) await accept.click();
  const waiting = await tab.evaluate(async () => {
    // The live queue (the dev hook) or, in a production build, the saved one.
    const live = window.__aetheriaQueue?.state?.();
    if (live && Array.isArray(live.waiting)) return live.waiting.length;
    const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await new Promise((res, rej) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const state = await req(db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('current'));
    db.close();
    return state?.queue?.waiting?.length ?? 0;
  });
  if (waiting > 0) {
    throw new Error(`[soak] Your tab has ${waiting} track(s) waiting in the queue: the soak's play would mark them played and empty your queue. Play or clear them first, then run the soak again.`);
  }
  let first;
  if (shownLayout === 'new') {
    // Now Playing's Play, by a DOM click (no hit-testing, nothing else touched): the tab's own play order from its cursor.
    await tab.locator('[data-testid="np-play"], [data-testid="desktop-play"]').first().dispatchEvent('click');
    await tab.waitForFunction(() => navigator.mediaSession.playbackState === 'playing', null, { timeout: 15_000 });
    first = await tab.evaluate(() => navigator.mediaSession.metadata?.title ?? '');
  } else {
    first = await tab.evaluate(async () => {
      const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const db = await new Promise((res, rej) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const state = await req(db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('current'));
      const meta = await req(db.transaction('meta', 'readonly').objectStore('meta').get(state.originalOrder[0]));
      db.close();
      return meta?.name;
    });
    await tab.getByText(first, { exact: true }).first().click();
    await tab.getByTestId('now-playing-title').filter({ hasText: first }).waitFor({ timeout: 15_000 });
  }

  const cdp = await tab.context().newCDPSession(tab);
  await cdp.send('Performance.enable');
  const heapMB = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return Math.round((metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576);
  };

  const start = Date.now();
  const end = start + minutes * 60_000;
  console.log(`[soak] ${label}: ${minutes} min from "${first}" (${shownLayout} layout)`);
  while (Date.now() < end) {
    const s = { min: +((Date.now() - start) / 60_000).toFixed(1), ...temps(), heapMB: await heapMB(), media: mediaSession() };
    samples.push(s);
    console.log(`[soak] ${s.min} min  AP ${s.ap}°  SKIN ${s.skin}°  BAT ${s.battery}°  heap ${s.heapMB} MB  ${s.media?.state} "${s.media?.title}"`);
    await new Promise((r) => setTimeout(r, Math.min(30_000, end - Date.now())));
  }
  samples.push({ min: minutes, ...temps(), heapMB: await heapMB(), media: mediaSession() });
  await cdp.detach();
  if (shownLayout === 'new') {
    if (await tab.evaluate(() => navigator.mediaSession.playbackState === 'playing').catch(() => false)) {
      await tab.locator('[data-testid="np-play"], [data-testid="desktop-play"]').first().dispatchEvent('click').catch(() => {});
    }
  } else {
    await tab.getByRole('button', { name: 'Pause', exact: true }).first().click().catch(() => {});
  }
} finally {
  if (savedLayoutKeys) {
    await tab
      .evaluate((pairs) => {
        for (const [k, v] of pairs) {
          if (v === null) localStorage.removeItem(k);
          else localStorage.setItem(k, v);
        }
      }, savedLayoutKeys)
      .catch((e) => {
        // Never silent: the tab's layout keys are not as they were; say what they were, to put back by hand.
        console.error(`[soak] could not put back the layout keys (${e?.message ?? e}); they were: ${JSON.stringify(savedLayoutKeys)}`);
      });
  }
  await tab.goto(`${origin}/?perf=0`).catch(() => {}); // HUD off again
  restore();
  await browser.close();
}

const steady = perf.filter((p) => p.at > perf[0]?.at + 60_000); // skip the first minute
const stat = (key) => {
  const v = steady.map((p) => p[key]).filter((x) => x !== undefined).sort((a, b) => a - b);
  const q = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
  return { median: q(0.5), p95: q(0.95) };
};
const summary = {
  label,
  minutes,
  origin,
  layout: shownLayout,
  when: new Date().toISOString(),
  draws: stat('draws'),
  raf: stat('raf'),
  commits: stat('commits'),
  // Spectrum hexagons drawn per frame and the layer's µs per frame (null when it never ran).
  spec: steady.some((p) => p.specDrawn !== undefined) ? { drawnPerFrame: stat('specDrawn'), us: stat('specUs') } : null,
  // Analyse tracks' ms of work per second while it ran (null when it never did).
  pass: steady.some((p) => p.passMainMs !== undefined) ? { mainMsPerS: stat('passMainMs'), nativeMsPerS: stat('passNativeMs'), windows: steady.filter((p) => p.passMainMs !== undefined).length } : null,
  longTasksPerMin: +((steady.reduce((s, p) => s + p.longTasks, 0) / Math.max(1, steady.length)) * 60).toFixed(1),
  longMsPerMin: Math.round((steady.reduce((s, p) => s + p.longMs, 0) / Math.max(1, steady.length)) * 60),
  temps: {
    start: samples[0] && { ap: samples[0].ap, skin: samples[0].skin, battery: samples[0].battery },
    end: samples.at(-1) && { ap: samples.at(-1).ap, skin: samples.at(-1).skin, battery: samples.at(-1).battery },
    maxSkin: Math.max(...samples.map((s) => s.skin)),
    maxAp: Math.max(...samples.map((s) => s.ap)),
  },
  heapMB: { start: samples[0]?.heapMB, end: samples.at(-1)?.heapMB },
  stoppedPlaying: samples.filter((s) => s.media?.state !== 'playing').map((s) => s.min),
  errors: errors.slice(0, 20),
};
mkdirSync(new URL('./soak-results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./soak-results/${label}.json`, import.meta.url), JSON.stringify({ summary, samples, perf }, null, 2));
console.log(JSON.stringify(summary, null, 2));
