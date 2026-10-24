import { type Locator, type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  acceptDisclaimer,
  crash,
  expectCache,
  importTones,
  instrumentAudio,
  layerState,
  openApp,
  openHarmonicControl,
  openSafety,
  pauseCount,
  zenLayer,
  type CrashView,
} from './helpers';

// v15.4 isolation: until v15.3 a render error anywhere in the classic layout unmounted the whole React root, and App's
// unmount cleanup stopped the music, closed the AudioContext and left a black screen under a lock-screen card still
// saying PLAYING (11 of 11 regions, measured). Now each of 12 regions sits under its own error boundary, with its JSX
// deferred into the boundary (a throw in App's own inline JSX escapes any boundary): the music plays on, the region
// shows a fallback with "Reload panel" (the transport a basic one, the visuals a pill), and three crashes in a page
// session switch a region off. A crash of App itself (the root) still stops the music; its page releases the
// lock-screen card and reloads only when tapped. The crashes come from the dev hook window.__aetheriaCrash.

type Drill = {
  view: Exclude<CrashView, 'root'>;
  /** Open the panel first (modals). */
  open?: (page: Page) => Promise<void>;
  /** What shows once the region is back. */
  present: (page: Page) => Locator;
  /** Focus something inside the region first, so the crash takes the focus with it. */
  focusInside?: (page: Page) => Locator;
  mobile?: boolean;
};

const DRILLS: Drill[] = [
  { view: 'visualizer', present: (p) => p.locator('canvas#viz-canvas') },
  { view: 'header', present: (p) => p.locator('header').getByTitle('Harmonic Control', { exact: true }) },
  {
    view: 'library',
    present: (p) => p.locator('aside').getByText('tone-02', { exact: true }),
    focusInside: (p) => p.getByPlaceholder('Search songs...'),
    mobile: true,
  },
  {
    view: 'harmonic',
    open: openHarmonicControl,
    present: (p) => p.getByRole('heading', { name: 'Harmonic Control', exact: true }),
  },
  {
    view: 'guidebook',
    open: async (p) => {
      await p.locator('aside').getByRole('button', { name: /The Guidebook/ }).click();
      await p.getByRole('heading', { name: 'The Guidebook', exact: true }).waitFor();
    },
    present: (p) => p.getByRole('heading', { name: 'The Guidebook', exact: true }),
  },
  {
    view: 'frequency-lab',
    open: async (p) => {
      await p.getByTitle('Advanced Frequency Selection').click();
      await p.getByText('Advanced Frequency Laboratory').waitFor();
    },
    present: (p) => p.getByText('Advanced Frequency Laboratory'),
  },
  { view: 'safety', open: openSafety, present: (p) => p.getByRole('button', { name: 'Emergency Stop' }) },
  {
    view: 'record',
    open: async (p) => {
      await p.locator('header button').filter({ has: p.locator('svg.lucide-circle') }).click();
      await p.getByText('Start Recording', { exact: true }).waitFor();
    },
    present: (p) => p.getByText('Start Recording', { exact: true }),
  },
  {
    view: 'tutorial',
    open: async (p) => {
      await p.locator('header button').filter({ has: p.locator('svg.lucide-circle-question-mark') }).click();
      await p.getByText('Quick Guide', { exact: true }).waitFor();
    },
    present: (p) => p.getByText('Quick Guide', { exact: true }),
  },
  {
    view: 'links',
    open: async (p) => {
      await p.getByTitle('Links & Resources').click();
      await p.waitForTimeout(400);
    },
    present: (p) => p.getByTitle('Links & Resources'),
  },
  {
    // A toast first (its state is App's, so the reloaded region shows it again).
    view: 'notices',
    open: async (p) => {
      await p.locator('aside').getByRole('button', { name: /^GUT Alignment/ }).click();
    },
    present: (p) => p.getByRole('status').getByText('Not enough analyzed songs. Try scanning library first.'),
  },
  {
    view: 'transport',
    present: (p) => p.getByTestId('player-bar'),
    focusInside: (p) => p.getByTestId('player-bar').getByRole('button', { name: 'Pause', exact: true }),
    mobile: true,
  },
];

/** The fallback a crashed region shows. */
const fallbackOf = (page: Page, view: Drill['view']): Locator =>
  view === 'visualizer'
    ? page.getByRole('button', { name: /Restart visuals/ })
    : view === 'transport'
      ? page.getByTestId('safe-transport')
      : page.getByRole('alert').filter({ hasText: /hit a problem/ });

/** Close the Safety panel when it opened by itself (an unanalysed track does that). */
async function closeSafety(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close Safety Panel' });
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** Import three tones and play the first, under way. */
async function playing(page: Page): Promise<void> {
  await importTones(page, 3, 30);
  await page.getByText('tone-01', { exact: true }).first().click();
  await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 15_000 }).toBeGreaterThan(1);
  await expect(page.getByTestId('now-playing-title')).toHaveText('tone-01');
}

interface Snapshot {
  time: number;
  paused: boolean;
  ctxRunning: boolean;
  anchorPaused: boolean | null;
  pauses: number;
  playbackState: string;
  title: string | null;
}

async function snapshot(page: Page): Promise<Snapshot> {
  const s = await layerState(page);
  const ms = await page.evaluate(() => ({
    playbackState: navigator.mediaSession.playbackState as string,
    title: navigator.mediaSession.metadata?.title ?? null,
  }));
  return {
    time: s.music?.time ?? -1,
    paused: s.music?.paused ?? true,
    ctxRunning: s.ctxRunning,
    anchorPaused: s.anchorPaused,
    pauses: await pauseCount(page),
    ...ms,
  };
}

/** Over the next 2 s the music plays on untouched: time moves ≥ 1.5 s, no pause, the context runs, the lock-screen
 *  card is unchanged, and (with the anchor on) the anchor plays. */
async function expectMusicPlaysOn(page: Page, label: string, mobile: boolean): Promise<void> {
  const before = await snapshot(page);
  await page.waitForTimeout(2000);
  const after = await snapshot(page);
  expect.soft(after.time - before.time, `${label}: the music moved on`).toBeGreaterThanOrEqual(1.5);
  expect.soft(after.paused, `${label}: the music element is not paused`).toBe(false);
  expect.soft(after.pauses, `${label}: no pause() meanwhile`).toBe(before.pauses);
  expect.soft(after.ctxRunning, `${label}: the AudioContext runs`).toBe(true);
  expect.soft(after.playbackState, `${label}: the lock-screen card still says playing`).toBe('playing');
  expect.soft(after.title, `${label}: the card's title is unchanged`).toBe(before.title);
  if (mobile) expect.soft(after.anchorPaused, `${label}: the silent anchor plays on`).toBe(false);
}

for (const d of DRILLS) {
  test(`1. a crash in ${d.view} keeps the music playing, and Reload panel brings it back${d.mobile ? ' @mobile' : ''}`, async ({ page }) => {
    test.setTimeout(90_000);
    await instrumentAudio(page);
    const dialogs = await openApp(page);
    await playing(page);
    if (d.view !== 'safety') await closeSafety(page);
    if (d.open) await d.open(page);
    await expect(d.present(page)).toBeVisible();
    if (d.focusInside) await d.focusInside(page).focus();
    await page.evaluate(() => document.activeElement?.setAttribute('data-e2e-focus', ''));
    const mobile = await page.evaluate(() => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));
    const titleBefore = await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null);
    const pausesBefore = await pauseCount(page);

    await crash(page, d.view);
    const fallback = fallbackOf(page, d.view);
    await expect(fallback, 'the fallback shows').toBeVisible();
    await expectMusicPlaysOn(page, `after the ${d.view} crash`, mobile);
    expect(await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null)).toBe(titleBefore);

    // Focus that went down with the region lands on the fallback's main button.
    const focusLost = await page.evaluate(() => !document.querySelector('[data-e2e-focus]'));
    if (focusLost) {
      const main =
        d.view === 'transport'
          ? fallback.getByRole('button', { name: 'Pause', exact: true })
          : d.view === 'visualizer'
            ? fallback
            : fallback.getByRole('button', { name: 'Reload panel', exact: true });
      await expect(main, 'the lost focus moves to the fallback').toBeFocused();
    }

    if (d.view === 'transport') {
      // The basic controls work: Pause pauses, Play resumes.
      await fallback.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(true);
      await fallback.getByRole('button', { name: 'Play', exact: true }).click();
      await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(false);
      await fallback.getByRole('button', { name: 'Reload controls', exact: true }).click();
    } else if (d.view === 'visualizer') {
      await fallback.click();
    } else {
      await fallback.getByRole('button', { name: 'Reload panel', exact: true }).click();
    }
    await expect(fallbackOf(page, d.view), 'the fallback is gone').toHaveCount(0);
    await expect(d.present(page), 'the region is back').toBeVisible();
    await expectMusicPlaysOn(page, `after Reload panel in ${d.view}`, mobile);
    if (d.view !== 'transport') expect(await pauseCount(page), 'no pause through the whole drill').toBe(pausesBefore);
    expect(dialogs).toEqual([]);
  });
}

test('1b. an expression in a region\'s own JSX that throws (a corrupt saved setting) stays in that region', async ({ page }) => {
  // No dev hook: a saved Visualization setting the app can't read (speed null) makes Harmonic Control's JSX throw as
  // it opens (`vizSettings.speed.toFixed`). The region's JSX is deferred into its boundary, so that throw is caught
  // there; written inline in App, the same throw would take down the root and stop the music (spec §2.4, measured).
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__e2eSpeedSeeded')) return;
    sessionStorage.setItem('__e2eSpeedSeeded', '1');
    localStorage.setItem('aetheria.vizSettings.v1', JSON.stringify({ speed: null }));
  });
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await playing(page);
  await closeSafety(page);
  await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();
  const fallback = page.getByRole('alert').filter({ hasText: /hit a problem/ });
  await expect(fallback).toBeVisible();
  await expectMusicPlaysOn(page, 'after the throw in Harmonic Control', false);
  await expect(page.locator('header')).toBeVisible();
  await fallback.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(fallback).toHaveCount(0);
  await expectMusicPlaysOn(page, 'after Close', false);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('aetheria.viewErrors.v1') || '[]'));
  expect(log[0]?.view).toBe('harmonic');
  expect(log[0]?.message).toMatch(/toFixed/);
  expect(dialogs).toEqual([]);
});

test('2. a region that crashes three times stays off until a restart; the music plays on', async ({ page }) => {
  test.setTimeout(90_000);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await playing(page);
  await closeSafety(page);
  const fallback = page.getByRole('alert').filter({ hasText: /hit a problem|switched off/ });
  for (let i = 1; i <= 2; i++) {
    await crash(page, 'library');
    await expect(fallback).toContainText('hit a problem');
    await fallback.getByRole('button', { name: 'Reload panel', exact: true }).click();
    await expect(page.locator('aside').getByText('tone-02', { exact: true })).toBeVisible();
  }
  // The third crash takes the focus with it (the search field): the switched-off card's Close gets it, not <body>
  // (its first render briefly had Reload panel, which took the focus and then went).
  await page.getByPlaceholder('Search songs...').focus();
  await crash(page, 'library');
  await expect(fallback).toContainText('This panel is switched off until you restart the app. The music keeps playing.');
  await expect(fallback.getByRole('button', { name: 'Reload panel' })).toHaveCount(0);
  await expect(fallback.getByRole('button', { name: 'Close', exact: true }), 'the lost focus lands on Close').toBeFocused();
  await expectMusicPlaysOn(page, 'switched off', false);
  await fallback.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(fallback).toHaveCount(0);
  await expect(page.locator('aside')).toHaveCount(0);
  await expectMusicPlaysOn(page, 'after Close', false);
  expect(dialogs).toEqual([]);
});

test('2b. in Zen Mode the basic player bar offers the way out, switched off too', async ({ page }) => {
  // The real player bar holds the only Zen toggle: without this a transport crash in Zen left the UI hiding every 3 s.
  test.setTimeout(90_000);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await playing(page);
  await closeSafety(page);
  let x = 300;
  const reveal = async () => {
    x = x === 300 ? 340 : 300; // a real move each time: the mouse reveals by moving
    await page.mouse.move(x, 320);
    await expect(zenLayer(page)).not.toHaveAttribute('inert', /.*/);
  };
  await page.getByTitle('Zen Mode (Hide UI)', { exact: true }).click();
  const safe = page.getByTestId('safe-transport');
  const leave = safe.getByRole('button', { name: 'Leave Zen mode', exact: true });
  await crash(page, 'transport');
  await expect(leave).toBeVisible();
  // Twice more (Reload controls between): switched off, it still offers the way out.
  for (let i = 0; i < 2; i++) {
    await reveal();
    await safe.getByRole('button', { name: 'Reload controls', exact: true }).click();
    await expect(page.getByTestId('player-bar')).toBeVisible();
    await crash(page, 'transport');
  }
  await expect(safe.getByRole('button', { name: 'Reload controls' })).toHaveCount(0);
  await expect(leave).toBeVisible();
  const box = (await leave.boundingBox())!;
  expect(box.height, 'a 44 px target').toBeGreaterThanOrEqual(44);
  await reveal();
  await leave.click();
  await expect(leave).toHaveCount(0);
  await page.waitForTimeout(4000);
  await expect(zenLayer(page), 'out of Zen, the UI stays').not.toHaveClass(/opacity-0/);
  await expect(zenLayer(page)).not.toHaveAttribute('inert', /.*/);
  await expectMusicPlaysOn(page, 'after leaving Zen from the basic bar', false);
  expect(dialogs).toEqual([]);
});

test('2c. a reloaded library list starts at its top, rows drawn', async ({ page }) => {
  // The list draws only the rows near its scroll position. A reloaded <aside> starts at scroll 0, so the drawn range
  // must follow, or a list scrolled far down shows a blank spacer until the next scroll.
  test.setTimeout(90_000);
  const dialogs = await openApp(page);
  await importTones(page, 60, 1);
  await expectCache(page, { library: 60 }, 30_000);
  const aside = page.locator('aside');
  await expect(aside.getByText('tone-01', { exact: true })).toBeVisible();
  await aside.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(aside.getByText('tone-60', { exact: true })).toBeVisible();
  await expect(aside.getByText('tone-01', { exact: true }), 'scrolled away, row 1 is not drawn').toHaveCount(0);
  await crash(page, 'library');
  const fallback = page.getByRole('alert').filter({ hasText: /hit a problem/ });
  await fallback.getByRole('button', { name: 'Reload panel', exact: true }).click();
  await expect(aside.getByText('tone-01', { exact: true }), 'row 1, at the top again').toBeVisible({ timeout: 2_000 });
  expect(await aside.evaluate((el) => el.scrollTop)).toBe(0);
  expect(dialogs).toEqual([]);
});

test('3. a root crash stops the app, releases the lock-screen card and reloads only when tapped', async ({ page }) => {
  test.setTimeout(90_000);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await playing(page);
  await expectCache(page, { blobs: 3, library: 3 });
  await page.evaluate(() => ((window as any).__samePage = true));

  await crash(page, 'root');
  const fallback = page.getByRole('alert').filter({ hasText: 'Aetheria stopped after a problem.' });
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText('Your library is saved on this device.');
  await expect
    .poll(() => page.evaluate(() => ({ state: navigator.mediaSession.playbackState, metadata: navigator.mediaSession.metadata })))
    .toEqual({ state: 'none', metadata: null });
  await page.waitForTimeout(5000);
  expect(await page.evaluate(() => (window as any).__samePage === true), 'no reload by itself').toBe(true);
  expect(await page.evaluate(() => ({ state: navigator.mediaSession.playbackState, metadata: navigator.mediaSession.metadata })))
    .toEqual({ state: 'none', metadata: null });

  await Promise.all([page.waitForEvent('load'), fallback.getByRole('button', { name: 'Reload', exact: true }).click()]);
  await acceptDisclaimer(page);
  await expect(page.getByText(/Restored 3 tracks/)).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => (window as any).__samePage === undefined), 'a new page').toBe(true);
  expect(dialogs).toEqual([]);
});

test('4. crashes are kept in a 20-entry log on this device, newest first', async ({ page }) => {
  test.setTimeout(90_000);
  // 20 older entries already there: the ring keeps the newest 20.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__e2eLogSeeded')) return;
    sessionStorage.setItem('__e2eLogSeeded', '1');
    const old = Array.from({ length: 20 }, (_, i) => ({ t: 1000 - i, view: 'old', message: `old ${i}`, version: 'v0' }));
    localStorage.setItem('aetheria.viewErrors.v1', JSON.stringify(old));
  });
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await playing(page);
  await closeSafety(page);
  for (const view of ['library', 'header', 'notices'] as const) {
    await crash(page, view);
    const fallback = page.getByRole('alert').filter({ hasText: /hit a problem/ });
    await expect(fallback).toBeVisible();
    await fallback.getByRole('button', { name: 'Reload panel', exact: true }).click();
    await expect(fallback).toHaveCount(0);
  }
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('aetheria.viewErrors.v1') || 'null'));
  expect(Array.isArray(log)).toBe(true);
  expect(log.length).toBe(20);
  expect(log.slice(0, 3).map((e: any) => e.view)).toEqual(['notices', 'header', 'library']);
  expect(log[3].view, 'the oldest entries dropped off the end').toBe('old');
  expect(log[0].message).toContain('Test crash in notices');
  expect(log[0].message.length).toBeLessThanOrEqual(300);
  expect(log[0].version).toMatch(/^v\d+\.\d+/);
  // ErrorBoundary.tsx's APP_VERSION is bumped with the header badge.
  const badge = ((await page.locator('header h1 > span').first().textContent()) ?? '').trim();
  expect(log[0].version, 'the log records the version the header shows').toBe(badge);
  for (let i = 1; i < log.length; i++) expect(log[i - 1].t, `entry ${i} is older`).toBeGreaterThanOrEqual(log[i].t);
  expect(dialogs).toEqual([]);
});

test('5. a crash-recovery checkpoint never moves the playing track', async ({ page }) => {
  test.setTimeout(60_000);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await importTones(page, 3, 60);
  await page.getByText('tone-02', { exact: true }).first().click();
  const title = page.getByTestId('now-playing-title');
  await expect(title).toHaveText('tone-02');
  await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 15_000 }).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title ?? null)).toBe('tone-02');

  // StabilityManager's checkpoint (written every 30 s while playing) says the first track; then more than five
  // uncaught errors (from timers: render errors under the boundaries never reach it) make it post RESTORE_STATE.
  await page.evaluate(() => {
    localStorage.setItem('aetheria_checkpoint', JSON.stringify({ timestamp: Date.now(), currentSongIndex: 0, isPlaying: true, volume: 0.8 }));
    for (let i = 0; i < 6; i++) setTimeout(() => { throw new Error('e2e window error ' + i); }, i * 10);
  });
  await page.waitForTimeout(2000);
  await expect(title).toHaveText('tone-02');
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null)).toBe('tone-02');
  expect((await layerState(page)).music?.paused).toBe(false);
  expect(dialogs).toEqual([]);
});
