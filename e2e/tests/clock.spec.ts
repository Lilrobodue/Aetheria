import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import { openApp, acceptDisclaimer, importTones, elapsedSeconds, seedLayers, layersState, expectCache, seedTracks, keyFitState, keyFitChip, LAYER_ENGINE_KEY } from './helpers';

// v14.8: while music plays, App sets its transport time (the clock text, the
// seek bar, the φ phase badge and the lock screen's position) four times a
// second, not on every animation frame: re-rendering the whole App ~60 times a
// second was most of the renderer's CPU on the phone. Read off the perf HUD
// (?perf=1: draws, rAF and App commits per second) and off what the page
// records: when the clock text and the seek bar change and where the music was
// then, every lock-screen position update, and the φ gain automation (it still
// runs every frame, so classic sound is unchanged).

interface HudWindow { draws: number; raf: number; commits: number }

function parseHud(line: string): HudWindow {
  const m = /draws ([\d.]+)\/s · rAF ([\d.]+)\/s · commits ([\d.]+)\/s/.exec(line);
  if (!m) throw new Error(`Not a perf HUD line: ${line}`);
  return { draws: Number(m[1]), raf: Number(m[2]), commits: Number(m[3]) };
}

/** Record, in window.__t: every perf HUD line; each change of the clock text and of the seek bar's
 *  width with the music's position then; each lock-screen position update (when, and the position
 *  sent); and how many setTargetAtTime calls the φ gains made (their 0.3 s time constant). The
 *  music element is __t.music(). Call before openApp. */
async function recordTransport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // The music element (a blob: src; the app keeps it out of the DOM), for its position.
    let music: HTMLMediaElement | null = null;
    const T = ((window as any).__t = {
      hud: [] as string[],
      clock: [] as { at: number; text: string; pos: number }[],
      seek: [] as { at: number; width: number }[],
      position: [] as { at: number; position: number }[],
      phi: 0,
      music: () => music,
    });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if ((this.getAttribute('src') || '').startsWith('blob:')) music = this;
      return play.call(this);
    };
    const session = navigator.mediaSession as any;
    if (session && typeof session.setPositionState === 'function') {
      const set = session.setPositionState.bind(session);
      session.setPositionState = (state?: MediaPositionState) => {
        T.position.push({ at: performance.now(), position: state?.position ?? NaN });
        return set(state);
      };
    }
    const toward = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (this: AudioParam, value: number, time: number, tau: number) {
      if (tau === 0.3) T.phi++;
      return toward.call(this, value, time, tau);
    };
    const attached = new Set<string>();
    const attach = (selector: string, record: (el: HTMLElement) => void) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el || attached.has(selector)) return;
      attached.add(selector);
      new MutationObserver(() => record(el)).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    };
    const watch = new MutationObserver(() => {
      attach('[data-testid="perf-hud"]', (el) => T.hud.push(el.textContent ?? ''));
      attach('[data-testid="transport-time"]', (el) => {
        const text = (el.textContent ?? '').trim();
        if (T.clock.at(-1)?.text !== text) T.clock.push({ at: performance.now(), text, pos: music ? music.currentTime : -1 });
      });
      attach('[data-testid="seek-progress"]', (el) => {
        const width = parseFloat(el.style.width);
        if (T.seek.at(-1)?.width !== width) T.seek.push({ at: performance.now(), width });
      });
      if (attached.size === 3) watch.disconnect();
    });
    watch.observe(document, { childList: true, subtree: true });
  });
}

const hudCount = (page: Page) => page.evaluate(() => (window as any).__t.hud.length as number);
const now = (page: Page) => page.evaluate(() => performance.now());
const seconds = (text: string) => {
  const m = /^(\d+):(\d{2})/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// The heat guard runs once per engine (v15.0): Classic, chosen, and v2, the default a new profile plays, with its
// output answered (Headphones) beforehand as a user's would be. v2's own work (its 250 ms host tick and the player's
// tick) must set no React state, so it holds the same commit and draw budget. The φ gains are classic's: under v2
// they are torn down 2 s after it takes over (its host level follows the φ envelope instead). v15.2 adds a third run,
// v2 with Key fit on and a ducked track (the heat rule, build spec D16): the same budget, and the duck is sent
// nothing at all while the track plays on (its request counter stays put across the six windows).
async function playingKeepsUp(page: Page, engine: 'classic' | 'default' | 'keyfit'): Promise<void> {
  const v2 = engine !== 'classic';
  const keyFit = engine === 'keyfit';
  // The user's phone, where the renders were the heat (the canvas is CSS-px sized, so this is its load too).
  await page.setViewportSize({ width: 411, height: 752 });
  await recordTransport(page);
  const dialogs = await openApp(page, { query: '?perf=1', engine: v2 ? 'default' : 'classic' });
  if (v2) await seedLayers(page, keyFit ? { output: 'headphones', keyFit: true } : { output: 'headphones' });
  await importTones(page, 1, 120);
  if (keyFit) {
    // The track at 528 Hz with key data that rubs (one-hot C#, confidence 0.9: −6 dB), then back to the HUD page.
    await expectCache(page, { blobs: 1, meta: 1, library: 1 });
    await seedTracks(page, [{ index: 0, crystal: 528, key: { chroma: Array.from({ length: 12 }, (_, i) => (i === 1 ? 1 : 0)), chromaA4Hz: 440, keyConfidence: 0.9, musicKey: 'C#' } }]);
    await page.goto('/?perf=1');
    await acceptDisclaimer(page);
  }
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  if (keyFit) await expect(keyFitChip(page)).toHaveAttribute('aria-label', 'Key fit −6.0 dB', { timeout: 10_000 });
  const requests0 = keyFit ? (await keyFitState(page)).requests : 0;

  // Six whole HUD windows of steady playing, from the one after the window under way.
  const from = (await hudCount(page)) + 1;
  await expect.poll(() => hudCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(from);
  const t0 = await now(page);
  const phi0 = await page.evaluate(() => (window as any).__t.phi as number);
  await expect.poll(() => hudCount(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(from + 6);
  const t1 = await now(page);
  const requests1 = keyFit ? (await keyFitState(page)).requests : 0;
  const T = await page.evaluate(() => (window as any).__t);
  const windows = (T.hud as string[]).slice(from, from + 6).map(parseHud);
  const span = (t1 - t0) / 1000;
  const within = <V extends { at: number }>(xs: V[]) => xs.filter((x) => x.at >= t0 && x.at <= t1);

  // The engine under test is the one playing: v2's player, never saved as a choice; or classic, with no player.
  test.info().annotations.push({
    type: 'hud',
    description: `${engine}: commits/s ${windows.map((w) => w.commits).join(', ')}; draws/s ${windows.map((w) => w.draws).join(', ')}; rAF/s ${windows.map((w) => w.raf).join(', ')}; φ gain updates/s ${((T.phi - phi0) / span).toFixed(1)}${keyFit ? `; Key fit requests ${requests0} → ${requests1}` : ''}`,
  });
  if (keyFit) expect(requests1, 'requests to the duck while the track plays on (none: nothing it hears changes)').toBe(requests0);
  if (v2) {
    expect((await layersState(page))?.requested?.tone_hz ?? 0, 'the v2 layers play').toBeGreaterThan(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), LAYER_ENGINE_KEY)).toBeNull();
  } else {
    expect(await layersState(page)).toBeNull();
  }

  // Commits: the clock's 4 a second, and little else (every frame, ~60).
  for (const w of windows) expect.soft(w.commits, 'App commits/s').toBeLessThanOrEqual(8);
  // And per frame (v15.0): re-rendering on every frame drags the frame rate down with it on a busy or slow machine
  // (the dev server's App commit is slow), so the rate alone can stay under 8 while every frame commits. Taken over
  // the six windows together: every frame committing is ~1 in each of them; one window the machine stalled (5
  // commits in 8 frames) is not.
  const total = (k: 'commits' | 'raf') => windows.reduce((s, w) => s + w[k], 0);
  expect.soft(total('commits') / Math.max(total('raf'), 1), 'App commits per animation frame').toBeLessThanOrEqual(0.5);
  // Draws: never above the visualizer's 30 fps cap, and not falling behind. A production build holds 30 either
  // way. On this dev server each of the ~5 commits left is a long task (React's dev build captures a stack for
  // every element it creates, which costs more the bigger App is), so the draws follow the machine: ~21-26 when
  // this was written, and on 2026-10-21 17-18 for v14.8 and 13-16 for v15.0, with the same commits (~130 and
  // ~145 ms each). Every frame committing is the check above; this one catches a visualizer that falls behind.
  const draws = windows.map((w) => w.draws).sort((a, b) => a - b);
  for (const d of draws) expect.soft(d, 'draws/s never above the 30 fps cap').toBeLessThanOrEqual(31);
  expect.soft(draws[3], 'draws/s, median').toBeGreaterThanOrEqual(12);

  // The clock text: every second in turn, each shown soon after the music reaches it: within a frame
  // plus React's render, which a busy dev build can delay a few tenths (a 1 s step would lag ~1 s).
  const lag = ON_DEVICE ? 0.8 : 0.6;
  const clock = within(T.clock as { at: number; text: string; pos: number }[]);
  const shown = clock.map((c) => seconds(c.text));
  expect.soft(clock.length, 'the clock changed about once a second').toBeGreaterThanOrEqual(Math.floor(span * 0.98) - 1);
  expect.soft(shown.filter((s, i) => i > 0 && s !== shown[i - 1] + 1), 'the clock skipped or repeated a second').toEqual([]);
  expect.soft(clock.filter((c) => !(c.pos >= seconds(c.text) && c.pos < seconds(c.text) + lag)).map((c) => `${c.text} at ${c.pos.toFixed(2)} s`),
    `the clock changed more than ${lag} s after the music reached it`).toEqual([]);
  // On the quarter-second grid it turns a frame and a render after the music reaches each second (~0.1 s
  // here); set 0.25 s after the last set instead, it trailed by a median ~0.23 s. Not checked on a device.
  const lags = clock.map((c) => c.pos - seconds(c.text)).sort((a, b) => a - b);
  if (!ON_DEVICE) expect.soft(lags[Math.floor(lags.length / 2)], 'median lag of the clock behind the music (s)').toBeLessThanOrEqual(0.16);
  // The seek bar: it grows, a few steps a second (4, one per quarter second).
  const seek = within(T.seek as { at: number; width: number }[]);
  expect.soft(seek.filter((s, i) => i > 0 && !(s.width > seek[i - 1].width)).length, 'seek bar steps that did not grow').toBe(0);
  expect.soft(seek.length / span, 'seek bar changes per second').toBeGreaterThanOrEqual(2.5);
  // The lock screen's position: about once a second (useMediaSession's own 1 s throttle).
  const position = (T.position as { at: number }[]).map((p) => p.at).filter((at) => at >= t0 && at <= t1);
  const gaps = position.slice(1).map((at, i) => (at - position[i]) / 1000);
  expect.soft(position.length, 'lock-screen position updates').toBeGreaterThanOrEqual(Math.floor(span) - 1);
  expect.soft(gaps.filter((g) => g < 0.95 || g > 1.6).map((g) => g.toFixed(2)), 'lock-screen updates closer than 0.95 s or further than 1.6 s apart').toEqual([]);
  // The φ gains still follow every frame: two gains, one call each per animation frame (classic's).
  const raf = windows.map((w) => w.raf).sort((a, b) => a - b)[3];
  if (!v2) expect.soft((T.phi - phi0) / span, `φ gain updates/s (rAF ${raf}/s)`).toBeGreaterThanOrEqual(1.5 * raf);

  // A seek back: the clock follows it there and keeps counting from it.
  const before = await elapsedSeconds(page);
  const strip = page.getByTestId('seek-progress').locator('xpath=..');
  const box = await strip.boundingBox();
  await strip.click({ position: { x: box!.width * 0.02, y: box!.height / 2 } }); // 2 % of 120 s
  await expect.poll(() => elapsedSeconds(page), { timeout: 5_000 }).toBeLessThanOrEqual(before - 4);
  const sought = await elapsedSeconds(page);
  await expect.poll(() => elapsedSeconds(page), { timeout: 6_000, message: 'the clock counts on after the seek' }).toBeGreaterThanOrEqual(sought + 3);
  expect(dialogs).toEqual([]);
}

for (const engine of ['classic', 'default', 'keyfit'] as const) {
  const which = engine === 'default' ? 'v2, the default' : engine === 'keyfit' ? 'v2 with Key fit on' : 'classic';
  const keepUp = engine !== 'classic' ? 'the clock, the seek bar and the lock screen' : 'the clock, the seek bar, the lock screen and the φ gains';
  test(`playing (${which}), App commits a few times a second and the visualizer draws its 30 frames; ${keepUp} keep up @mobile`, async ({ page }) =>
    playingKeepsUp(page, engine));
}

test('paused at any point, the clock, the seek bar and the lock screen show where the music stopped @mobile', async ({ page }) => {
  // While playing, the time is set as the music crosses each quarter second, and once more, to the
  // element's own time, when playback stops. Set only every 0.25 s, a pause could leave the clock a
  // second behind, and the lock screen with it (useMediaSession re-sends the App's time on pause).
  test.setTimeout(180_000); // ten pauses, each waiting for its point in a second, on a busy or slow device
  await page.setViewportSize({ width: 411, height: 752 });
  await recordTransport(page);
  const dialogs = await openApp(page);
  await importTones(page, 1, 120);
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const playButton = page.getByRole('button', { name: 'Play', exact: true });
  const pauseButton = page.getByRole('button', { name: 'Pause', exact: true });
  // Where in its second the music is paused: reproducible pseudo-random points, every other one in
  // the second's first quarter (where a time set up to 0.25 s ago can still be in the previous second).
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const points = Array.from({ length: 10 }, (_, i) => (i % 2 ? 0.03 + 0.2 * rnd() : 0.03 + 0.92 * rnd()));
  const wrong: string[] = [];
  for (const [i, point] of points.entries()) {
    // Tap Pause from inside an animation frame, the first one at `point` (to +0.15 s, room for a slow
    // frame) into a second; give up (and fail below) if the music stops or 10 s pass.
    const clickedAt = await page.evaluate((point) => new Promise<number>((resolve) => {
      const music = (window as any).__t.music() as HTMLMediaElement;
      const until = performance.now() + 10_000;
      const tick = () => {
        const into = music.currentTime % 1;
        if (!music.paused && music.currentTime >= 1 && into >= point && into < point + 0.15) {
          (document.querySelector('button[aria-label="Pause"]') as HTMLButtonElement).click();
          resolve(performance.now());
          return;
        }
        if (music.paused || performance.now() > until) { resolve(NaN); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), point);
    expect(clickedAt, `pause ${i + 1}: no frame ${point.toFixed(2)}-${(point + 0.15).toFixed(2)} s into a second while playing, in 10 s`).not.toBeNaN();
    await expect(playButton).toBeVisible();
    await page.waitForTimeout(400); // React's commits and useMediaSession's paused update
    const s = await page.evaluate((clickedAt) => {
      const T = (window as any).__t;
      const music = T.music() as HTMLMediaElement;
      const sent = (T.position as { at: number; position: number }[]).filter((p) => p.at >= clickedAt);
      return {
        paused: music.paused, at: music.currentTime, duration: music.duration,
        clock: (document.querySelector('[data-testid="transport-time"]')?.textContent ?? '').trim(),
        width: parseFloat((document.querySelector('[data-testid="seek-progress"]') as HTMLElement).style.width),
        lock: sent.length ? sent[sent.length - 1].position : NaN,
      };
    }, clickedAt);
    expect(s.paused, 'the music paused').toBe(true);
    const where = `pause ${i + 1}, ${point.toFixed(2)} into a second, at ${s.at.toFixed(3)} s`;
    const bar = (s.width / 100) * s.duration;
    if (seconds(s.clock) !== Math.floor(s.at)) wrong.push(`${where}: the clock shows "${s.clock}"`);
    if (!(Math.abs(bar - s.at) <= 0.05)) wrong.push(`${where}: the seek bar is at ${bar.toFixed(3)} s`);
    if (!(Math.abs(s.lock - s.at) <= 0.05)) wrong.push(`${where}: the lock screen was last sent ${s.lock.toFixed(3)} s`);
    await playButton.click();
    await expect(pauseButton).toBeVisible();
    await page.waitForTimeout(700 + 110 * i); // a different phase each time
  }
  expect(wrong, 'paused positions not where the music stopped').toEqual([]);
  expect(dialogs).toEqual([]);
});
