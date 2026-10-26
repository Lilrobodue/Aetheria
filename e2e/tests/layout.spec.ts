import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  acceptDisclaimer,
  crash,
  drawsPerSecond,
  expectCache,
  importTones,
  instrumentAudio,
  layerState,
  layersState,
  layoutPref,
  newShell,
  openApp,
  openHarmonicControl,
  openNewLayout,
  optInNewLayout,
  pauseCount,
  peekClassicLibrary,
  recordHudDraws,
  renders,
  resetRenders,
  seedLayers,
  sheet,
  tab,
  tapCount,
  LAYER_OUTPUT_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
  type CrashView,
} from './helpers';

// v15.5, the new layout (opt-in beta): classic stays the default; Harmonic Control's "Try the new layout" opens a
// shell with five tabs (phone) or a side nav, a panel and a transport (desktop), Now Playing with its chips and the
// Sound, Crystal and Walks sheets, a Car screen, and stubs that peek into classic. App stays the only owner of state;
// the views read sliced contexts, so the 4 Hz clock re-renders only the time readers. The Visualizer stays where it
// was, outside the layout branch: a switch never remounts it, and the heat guard (React's <Activity>) pauses it while a
// solid screen covers it. Tests use the synthetic tone WAVs only.

const ANCHOR_UA = /Android|iPhone|iPad|Mobile/i;

/** Close the Safety panel when it opened by itself (an unanalysed track does that). A DOM click: on a 411 × 752
 *  phone its Close sits under classic's player bar. */
async function closeSafety(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close Safety Panel' });
  if (await close.isVisible().catch(() => false)) await close.evaluate((b) => (b as HTMLButtonElement).click());
}

/** On a device the fixture sizes the page as a desktop: the phone shell needs a phone's viewport. */
async function phoneSize(page: Page): Promise<void> {
  if (ON_DEVICE) await page.setViewportSize(PHONE_VIEWPORT);
}

/**
 * Classic first (the import lives there): v2 with Headphones answered (the user's own setup) or classic, `count`
 * tones, optionally Auto-Distributed, tone-01 playing; then the opt-in. Returns the native-dialog list.
 */
async function playingInNewLayout(
  page: Page,
  o: { count?: number; seconds?: number; engine?: 'v2' | 'classic'; autoDistribute?: boolean; optIn?: boolean } = {}
): Promise<string[]> {
  const engine = o.engine ?? 'v2';
  const dialogs = await openApp(page, { engine });
  if (engine === 'v2') await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, o.count ?? 3, o.seconds ?? 60);
  if (o.autoDistribute) await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await page.getByText('tone-01', { exact: true }).first().click();
  await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 20_000 }).toBeGreaterThan(1);
  await closeSafety(page);
  if (o.optIn !== false) await optInNewLayout(page);
  return dialogs;
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

/** Over the next 2 s the music plays on untouched (isolation.spec's check): time ≥ 1.5 s on, no pause, the context
 *  runs, the card unchanged, and (on a phone UA) the silent anchor plays. */
async function expectMusicPlaysOn(page: Page, label: string): Promise<void> {
  const mobile = await page.evaluate((re) => new RegExp(re).test(navigator.userAgent), ANCHOR_UA.source);
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

const VIEWS = ['view-now', 'tab-library', 'tab-mixes', 'tab-layers', 'more'] as const;
const viewOf = { now: 'view-now', library: 'tab-library', mixes: 'tab-mixes', layers: 'tab-layers', more: 'more' } as const;
const classicHeader = (page: Page) => page.locator('header').getByTitle('Safety Protocols', { exact: true });
const moreOptions = (page: Page) => page.getByRole('button', { name: 'More options', exact: true });

// The visualizer draws (dev server: React's dev build makes each of App's few commits a long task, so it draws below
// its 30/s cap, ~13–18/s in classic, measured since v14.8; a production build holds 30). "Drawing" is well above 0,
// "paused" is 0.0 in every window.
const DRAWING = 8;

// ---------------------------------------------------------------------------------------------------------------
// 1. The opt-in and persistence
// ---------------------------------------------------------------------------------------------------------------

test('1. classic is the default; the opt-in, a reload, Back to classic and ?layout= save the choice; junk is classic', async ({ page }) => {
  test.setTimeout(150_000);
  await instrumentAudio(page);
  const dialogs = await playingInNewLayout(page, { optIn: false });
  // A whole classic session: never written without a tap.
  await openHarmonicControl(page);
  await page.getByRole('heading', { name: 'Harmonic Control', exact: true }).locator('xpath=..').getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await acceptDisclaimer(page);
  await expect(newShell(page)).toHaveCount(0);
  expect(await layoutPref(page), 'a classic session writes no layout choice').toBeNull();

  // Harmonic Control › Try the new layout: the shell, saved; Harmonic Control closed.
  await optInNewLayout(page);
  expect(await layoutPref(page)).toBe('new');
  await expect(page.getByRole('heading', { name: 'Harmonic Control', exact: true })).toHaveCount(0);
  await expect(classicHeader(page)).toHaveCount(0);

  // A reload stays new.
  await page.reload();
  await newShell(page).waitFor();
  await expect(classicHeader(page)).toHaveCount(0);

  // ⋯ › Back to classic.
  await moreOptions(page).click();
  await page.getByTestId('menu-back-to-classic').click();
  await expect(classicHeader(page)).toBeVisible();
  await expect(newShell(page)).toHaveCount(0);
  expect(await layoutPref(page)).toBe('classic');

  // ?layout=new and ?layout=classic set it and save it.
  await page.goto('/?layout=new');
  await newShell(page).waitFor();
  expect(await layoutPref(page)).toBe('new');
  await page.goto('/?layout=classic');
  await acceptDisclaimer(page);
  await expect(newShell(page)).toHaveCount(0);
  expect(await layoutPref(page)).toBe('classic');

  // A stored value that isn't one: classic, and left as it is.
  await page.evaluate((k) => localStorage.setItem(k, 'garbage'), LAYOUT_KEY);
  await page.goto('/');
  await acceptDisclaimer(page);
  await expect(newShell(page)).toHaveCount(0);
  expect(await layoutPref(page)).toBe('garbage');
  expect(dialogs).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. The load gate: a saved 'new' never shows classic first
// ---------------------------------------------------------------------------------------------------------------

test('2. with the choice saved, classic never attaches, not even for a frame (and not after a reload)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__classicSeen = [];
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="player-bar"]')) w.__classicSeen.push('player-bar');
      if (document.querySelector('header button[aria-label="Library"]')) w.__classicSeen.push('header Library');
    }).observe(document, { childList: true, subtree: true });
  });
  const dialogs = await openNewLayout(page, { via: 'seed' });
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).__classicSeen)).toEqual([]);
  await page.reload();
  await newShell(page).waitFor();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).__classicSeen), 'after a reload').toEqual([]);
  expect(await layoutPref(page)).toBe('new');
  expect(dialogs).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Tabs: one view in the DOM at a time, the mini-player, closed sheets unmounted, focus to the heading
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('3. each tab shows its view and only that one; the mini-player on the other four; a closed sheet is gone', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    await phoneSize(page);
    for (const t of ['library', 'mixes', 'layers', 'more', 'now'] as const) {
      await tab(page, t);
      await expect(page.getByTestId(viewOf[t])).toBeVisible();
      for (const v of VIEWS) await expect(page.getByTestId(v), `${t}: ${v}`).toHaveCount(v === viewOf[t] ? 1 : 0);
      await expect(page.getByTestId('mini-player'), `${t}: the mini-player`).toHaveCount(t === 'now' ? 0 : 1);
      await expect(page.getByTestId(`tab-${t}-button`)).toHaveAttribute('aria-current', 'page');
      // Focus moves to the new view's heading.
      const heading = page.getByTestId(viewOf[t]).locator('[data-view-heading]');
      await expect(heading, `${t}: the heading has the focus`).toBeFocused();
    }
    // A closed sheet is not in the DOM.
    await expect(page.getByTestId('sheet-crystal')).toHaveCount(0);
    await page.getByTestId('chip-crystal').click();
    await expect(sheet(page, 'Crystal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet-crystal')).toHaveCount(0);
    await expect(page.getByTestId('crystal-body')).toHaveCount(0);
    await expectMusicPlaysOn(page, 'after the tabs');
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Tap counts (the plan's gate): Crystal 2, Output 2, Walk 2
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone, touch', () => {
  test.use({ viewport: PHONE_VIEWPORT, hasTouch: true });

  test('4. from Now Playing: a crystal, a walk and an output in two taps each @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page, { count: 28, seconds: 30, autoDistribute: true });
    await phoneSize(page);
    const taps = tapCount(page);

    // Crystal: the chip, then a cell. Mid-track, on a crystal that isn't the track's, so the chip must name what the
    // layers PLAY, not the track's crystal (classic's pill keeps the track's).
    const chip = page.getByTestId('chip-crystal');
    const trackHz = Number(/(\d+) Hz/.exec((await chip.getAttribute('aria-label')) ?? '')?.[1] ?? 0);
    const target = trackHz === 1449 ? 1692 : 1449;
    await taps.tap(chip, 'the crystal chip');
    await taps.tap(page.getByTestId(`crystal-${target}`), `the ${target} Hz cell`);
    expect(taps.count, 'taps for a crystal').toBe(2);
    await expect(page.getByTestId('sheet-crystal'), 'the sheet closed').toHaveCount(0);
    await expect(chip).toHaveAttribute('aria-label', new RegExp(`^Crystal ${target} Hz`));
    await expect.poll(async () => (await layersState(page))?.requested?.canonical_hz ?? 0, { timeout: 10_000 }).toBe(target);

    // Walk: Walks, then Flying Star Vortex: it builds the walk and plays it.
    taps.reset();
    await taps.tap(page.getByTestId('np-walks'), 'Walks');
    await taps.tap(page.getByTestId('walk-C'), 'Flying Star Vortex');
    expect(taps.count, 'taps for a walk').toBe(2);
    await expect(page.getByTestId('np-source')).toHaveText('Lo Shu walk · Vortex · step 1 of 27', { timeout: 15_000 });
    await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 15_000 }).toBeGreaterThan(1);
    const t0 = (await layerState(page)).music!.time;
    await page.waitForTimeout(1500);
    expect((await layerState(page)).music!.time - t0, 'the walk plays').toBeGreaterThan(1);
    expect((await layerState(page)).music!.paused).toBe(false);

    // Output: Output, then the Output group's Car. Saved; the Car screen; the layers say Car.
    const nowHz = Number(/(\d+) Hz/.exec((await chip.getAttribute('aria-label')) ?? '')?.[1] ?? 0);
    taps.reset();
    await taps.tap(page.getByTestId('np-output'), 'Output');
    await taps.tap(sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Car', exact: true }), 'Car in the Output group');
    expect(taps.count, 'taps for an output').toBe(2);
    // Polled: on a phone the tap's click comes from Chrome's gesture detector after the touch, so it can land a moment
    // after the tap returns (Note 20, 2026-10-24: a one-shot read here still saw 'headphones').
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), LAYER_OUTPUT_KEY), { timeout: 10_000, message: 'Car is saved' })
      .toBe('car');
    await expect(sheet(page, 'Sound').getByText('Layers v2 · Car (tone only)', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-car')).toBeVisible();
    await expect(page.getByTestId('car-line')).toHaveText(`Music and a quiet tone for the ${nowHz} Hz crystal · no beat`);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5. A crash drill per new region: the music plays on, Reload panel brings it back
// ---------------------------------------------------------------------------------------------------------------

type Drill = {
  view: Exclude<CrashView, 'root'>;
  desktop?: boolean;
  open?: (page: Page) => Promise<void>;
  /** What shows once the region is back. */
  present: (page: Page) => Locator;
  mobile?: boolean;
};

const openSheetFrom = (testId: string) => async (page: Page) => {
  await page.getByTestId(testId).click();
};

const DRILLS: Drill[] = [
  { view: 'shell', present: (p) => newShell(p), mobile: true },
  { view: 'now-playing', present: (p) => p.getByTestId('view-now'), mobile: true },
  { view: 'mini-player', open: (p) => tab(p, 'library'), present: (p) => p.getByTestId('mini-player') },
  { view: 'desktop-transport', desktop: true, present: (p) => p.getByTestId('desktop-transport') },
  { view: 'tab-library', open: (p) => tab(p, 'library'), present: (p) => p.getByTestId('tab-library') },
  { view: 'tab-mixes', open: (p) => tab(p, 'mixes'), present: (p) => p.getByTestId('tab-mixes') },
  { view: 'tab-layers', open: (p) => tab(p, 'layers'), present: (p) => p.getByTestId('tab-layers') },
  { view: 'more', open: (p) => tab(p, 'more'), present: (p) => p.getByTestId('more') },
  { view: 'sheet-sound', open: openSheetFrom('np-output'), present: (p) => p.getByTestId('sound-body') },
  { view: 'sheet-crystal', open: openSheetFrom('chip-crystal'), present: (p) => p.getByTestId('crystal-body') },
  { view: 'sheet-walks', open: openSheetFrom('np-walks'), present: (p) => p.getByTestId('walks-body') },
  { view: 'menu', open: openSheetFrom('np-menu-button'), present: (p) => p.getByTestId('menu-body') },
  // v15.6: the Layers tab's five section regions.
  { view: 'layers-sound', open: (p) => tab(p, 'layers'), present: (p) => p.getByTestId('layers-sound') },
  { view: 'layers-crystal', open: (p) => tab(p, 'layers'), present: (p) => p.getByTestId('layers-crystal') },
  { view: 'layers-levels', open: (p) => tab(p, 'layers'), present: (p) => p.getByTestId('layers-levels') },
  { view: 'layers-beat', open: (p) => tab(p, 'layers'), present: (p) => p.getByTestId('layers-beat') },
  { view: 'layers-advanced', open: (p) => tab(p, 'layers'), present: (p) => p.getByTestId('layers-advanced') },
  // v15.7: the Library tab's four regions.
  { view: 'library-list', open: (p) => tab(p, 'library'), present: (p) => p.getByTestId('library-list') },
  { view: 'library-health', open: (p) => tab(p, 'library'), present: (p) => p.getByTestId('library-health') },
  {
    view: 'library-menu',
    open: async (p) => {
      await tab(p, 'library');
      await p.getByRole('button', { name: 'Options for tone-02', exact: true }).click();
    },
    present: (p) => p.getByTestId('library-menu-body'),
  },
  {
    view: 'sheet-import',
    open: async (p) => {
      await tab(p, 'library');
      await p.getByTestId('library-import').click();
    },
    present: (p) => p.getByTestId('import-body'),
  },
];

const fallbackOf = (page: Page, view: Drill['view']): Locator =>
  view === 'shell'
    ? page.getByTestId('shell-fallback')
    : view === 'mini-player' || view === 'desktop-transport'
      ? page.getByTestId('safe-transport')
      : page.getByRole('alert').filter({ hasText: /hit a problem/ });

for (const d of DRILLS) {
  test.describe(d.desktop ? 'desktop shell' : 'phone shell', () => {
    test.use({ viewport: d.desktop ? { width: 1280, height: 800 } : PHONE_VIEWPORT });

    test(`5. a crash in ${d.view} keeps the music playing, and its fallback brings it back${d.mobile ? ' @mobile' : ''}`, async ({ page }) => {
      test.setTimeout(120_000);
      await instrumentAudio(page);
      const dialogs = await playingInNewLayout(page);
      if (!d.desktop) await phoneSize(page);
      if (d.open) await d.open(page);
      await expect(d.present(page)).toBeVisible();
      const pausesBefore = await pauseCount(page);

      await crash(page, d.view);
      const fallback = fallbackOf(page, d.view);
      await expect(fallback, 'the fallback shows').toBeVisible();
      await expectMusicPlaysOn(page, `after the ${d.view} crash`);

      if (d.view === 'shell') {
        await expect(fallback.getByRole('button', { name: 'Use the classic layout', exact: true })).toBeVisible();
        await fallback.getByRole('button', { name: 'Reload panel', exact: true }).click();
        await expect(newShell(page), 'the shell is back').toBeVisible();
        await expectMusicPlaysOn(page, 'after Reload panel');
        // Again, and this time the way out: classic, saved, the music on.
        await crash(page, 'shell');
        await page.getByTestId('shell-fallback').getByRole('button', { name: 'Use the classic layout', exact: true }).click();
        await expect(classicHeader(page)).toBeVisible();
        expect(await layoutPref(page)).toBe('classic');
        await expectMusicPlaysOn(page, 'in classic after the shell crash');
      } else {
        if (d.view === 'now-playing') {
          // The basic transport in the view's slot: Pause pauses, Play resumes.
          const safe = page.getByTestId('safe-transport');
          await safe.getByRole('button', { name: 'Pause', exact: true }).click();
          await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(true);
          await safe.getByRole('button', { name: 'Play', exact: true }).click();
          await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(false);
        }
        const reload =
          d.view === 'mini-player' || d.view === 'desktop-transport'
            ? fallback.getByRole('button', { name: 'Reload controls', exact: true })
            : fallback.getByRole('button', { name: 'Reload panel', exact: true });
        await reload.click();
        await expect(fallbackOf(page, d.view), 'the fallback is gone').toHaveCount(0);
        await expect(d.present(page), 'the region is back').toBeVisible();
        await expectMusicPlaysOn(page, `after reloading ${d.view}`);
        if (d.view !== 'now-playing') expect(await pauseCount(page), 'no pause through the whole drill').toBe(pausesBefore);
      }
      expect(dialogs).toEqual([]);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 6. A layout switch mid-track keeps the music, the card and the visualizer (the same canvas, never remounted)
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone, switch', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('6. classic → new → classic mid-track: same canvas, same Visualizer, drawing, the music and the card unchanged @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    await recordHudDraws(page);
    const dialogs = await playingInNewLayout(page, { optIn: false });
    await phoneSize(page);
    await page.evaluate(() => {
      const canvas = document.getElementById('viz-canvas') as any;
      canvas.__e2eId = 'the-canvas';
      (window as any).__vizAtStart = (window as any).__aetheriaVisualizer;
    });
    const title = await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null);
    const pausesBefore = await pauseCount(page);
    const check = async (step: string) => {
      const same = await page.evaluate(() => ({
        canvas: (document.getElementById('viz-canvas') as any)?.__e2eId === 'the-canvas',
        visualizer: !!(window as any).__aetheriaVisualizer && (window as any).__aetheriaVisualizer === (window as any).__vizAtStart,
      }));
      expect.soft(same.canvas, `${step}: the same <canvas> node`).toBe(true);
      expect.soft(same.visualizer, `${step}: the same Visualizer (no remount)`).toBe(true);
      const draws = await drawsPerSecond(page, 2);
      test.info().annotations.push({ type: `draws/s, ${step}`, description: draws.join(', ') });
      expect.soft(Math.min(...draws), `${step}: the visualizer draws (${draws.join(', ')}/s)`).toBeGreaterThanOrEqual(DRAWING);
      await expectMusicPlaysOn(page, step);
      expect.soft(await pauseCount(page), `${step}: no pause() since the start`).toBe(pausesBefore);
      expect.soft(await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null), `${step}: the card's title`).toBe(title);
    };
    await check('classic');
    await optInNewLayout(page);
    await check('the new layout');
    await moreOptions(page).click();
    await page.getByTestId('menu-back-to-classic').click();
    await expect(classicHeader(page)).toBeVisible();
    await check('classic again');
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Only the time readers follow the 4 Hz clock
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone, renders', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('7. while playing, Now Playing, the chips, the tab bar and the top bar never re-render; the time readers do', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    await phoneSize(page);
    await page.waitForTimeout(2500); // past the start's own changes (the layers' first transitions)
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const now = await renders(page);
    test.info().annotations.push({ type: 'renders on Now Playing, 3 s', description: JSON.stringify(now) });
    for (const view of ['NowPlaying', 'NowPlayingChips', 'TabBar', 'TopBar', 'PhoneShell', 'AppShell']) {
      expect.soft(now[view] ?? 0, `${view} renders`).toBe(0);
    }
    expect.soft(now.SeekBar ?? 0, 'SeekBar renders').toBeGreaterThanOrEqual(8);
    expect.soft(now.TimeText ?? 0, 'TimeText renders').toBeGreaterThanOrEqual(8);

    await tab(page, 'library');
    await page.waitForTimeout(1500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const lib = await renders(page);
    test.info().annotations.push({ type: 'renders on the Library tab, 3 s', description: JSON.stringify(lib) });
    // v15.7: the Library tab (no longer a stub) renders nothing on the clock either.
    for (const view of ['LibraryTab', 'LibraryList', 'LibraryRow', 'HealthCard']) expect.soft(lib[view] ?? 0, `${view} renders`).toBe(0);
    expect.soft(lib.MiniPlayer ?? 0, 'MiniPlayer renders').toBe(0);
    expect.soft(lib.MiniProgress ?? 0, 'MiniProgress renders').toBeGreaterThanOrEqual(8);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 8. The heat guard
// ---------------------------------------------------------------------------------------------------------------

const canvasDisplay = (page: Page) => page.evaluate(() => getComputedStyle(document.getElementById('viz-canvas')!).display);

async function expectPaused(page: Page, what: string): Promise<void> {
  // The pause applies within a frame; the first window after it may still hold draws from before.
  await expect.poll(async () => Math.max(...(await drawsPerSecond(page, 1))), { message: `${what}: the visualizer stops`, timeout: 10_000, intervals: [0] }).toBe(0);
  const draws = await drawsPerSecond(page, 2);
  expect.soft(draws, `${what}: 0.0 draws/s for 2 consecutive seconds`).toEqual([0, 0]);
  expect.soft(await canvasDisplay(page), `${what}: the canvas is display:none`).toBe('none');
}

async function expectDrawing(page: Page, what: string): Promise<void> {
  test.info().annotations.push({ type: `draws/s, ${what}`, description: (await drawsPerSecond(page, 2)).join(', ') });
  await expect.poll(async () => Math.min(...(await drawsPerSecond(page, 1))), { message: `${what}: the visualizer draws`, timeout: 10_000, intervals: [0] }).toBeGreaterThanOrEqual(DRAWING);
  expect.soft(await canvasDisplay(page), `${what}: the canvas shows`).not.toBe('none');
}

test.describe('phone, heat guard', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('8. a solid tab and the Car screen pause the visualizer on the same canvas; a sheet, the desktop and classic never do', async ({ page }) => {
    test.setTimeout(180_000);
    await instrumentAudio(page);
    await recordHudDraws(page);
    const dialogs = await playingInNewLayout(page);
    await phoneSize(page);
    await page.evaluate(() => ((document.getElementById('viz-canvas') as any).__e2eId = 'the-canvas'));
    await expectDrawing(page, 'Now Playing');
    for (const t of ['library', 'mixes', 'layers', 'more'] as const) {
      await tab(page, t);
      await expectPaused(page, t);
      await expectMusicPlaysOn(page, `${t} (paused visuals)`);
    }
    await tab(page, 'now');
    await expectDrawing(page, 'back on Now Playing');
    expect(await page.evaluate(() => (document.getElementById('viz-canvas') as any).__e2eId), 'the same canvas node').toBe('the-canvas');

    // A sheet leaves the top of the canvas showing: no pause.
    await page.getByTestId('chip-crystal').click();
    await expect(sheet(page, 'Crystal')).toBeVisible();
    await expectDrawing(page, 'a sheet open');
    await page.keyboard.press('Escape');

    // The Car screen is solid: paused.
    await page.getByTestId('np-output').click();
    await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Car', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-car')).toBeVisible();
    await expectPaused(page, 'the Car screen');
    await page.getByRole('button', { name: 'Change output', exact: true }).click();
    await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Headphones', exact: true }).click();
    await page.keyboard.press('Escape');
    await expectDrawing(page, 'Headphones again');

    // The desktop shell, any section: never paused.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('side-nav')).toBeVisible();
    for (const t of ['library', 'more'] as const) {
      await tab(page, t);
      await expectDrawing(page, `desktop ${t}`);
    }
    await tab(page, 'now');
    await page.setViewportSize(PHONE_VIEWPORT);

    // Classic: never paused (here with the library drawer over the canvas).
    await moreOptions(page).click();
    await page.getByTestId('menu-back-to-classic').click();
    await expect(classicHeader(page)).toBeVisible();
    await expectDrawing(page, 'classic');
    expect(dialogs).toEqual([]);
  });

  test('8b. a video recording keeps the visuals drawing behind a solid tab', async ({ page }) => {
    // Stopping the recording downloads a .webm: on a device that would land in the phone's own Downloads.
    test.skip(ON_DEVICE, 'stopping the recording would save a file on the phone');
    test.setTimeout(120_000);
    await instrumentAudio(page);
    await recordHudDraws(page);
    const dialogs = await playingInNewLayout(page, { optIn: false });
    await phoneSize(page);
    const canRecord = await page.evaluate(() => typeof MediaRecorder === 'function' && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function');
    test.skip(!canRecord, 'MediaRecorder or canvas.captureStream is not available here');
    // Classic's Record dialog: Visuals Only.
    await page.locator('header button').filter({ has: page.locator('svg.lucide-circle') }).click();
    await page.getByText('Start Recording', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Visuals Only/ }).click();
    await expect(page.getByText('Start Recording', { exact: true }), 'the recording started (its dialog closed)').toBeHidden({ timeout: 10_000 });
    await optInNewLayout(page);
    await expect(page.getByTestId('rec-stop')).toBeVisible();
    await tab(page, 'library');
    await expectDrawing(page, 'Library while recording');
    // Stop it from the menu (on Now Playing).
    await tab(page, 'now');
    await moreOptions(page).click();
    await page.getByRole('button', { name: /Stop recording/ }).click();
    await expect(page.getByTestId('rec-stop')).toHaveCount(0);
    await tab(page, 'library');
    await expectPaused(page, 'Library after the recording');
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 9. Accessibility: names, targets, Escape, the seek bar's keys
// ---------------------------------------------------------------------------------------------------------------

/** Chrome's accessibility tree: the controls with no name. */
async function unnamedControls(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: any[] };
    const CONTROLS = new Set(['button', 'slider', 'link', 'switch', 'checkbox', 'textbox', 'combobox', 'menuitem', 'tab', 'radio', 'spinbutton']);
    return nodes
      .filter((n) => !n.ignored && CONTROLS.has(n.role?.value) && !String(n.name?.value ?? '').trim())
      .map((n) => `${n.role.value} #${n.backendDOMNodeId}`);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Every control in the shell and the open sheet, with its box grown by its ::after box, under 44 × 44. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"][aria-modal="true"]'));
    const out: string[] = [];
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [role="slider"], input[type="range"], [role="switch"]'))) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('.sr-only')) continue;
        let w = r.width;
        let h = r.height;
        const after = getComputedStyle(el, '::after');
        if (after.content && after.content !== 'none' && after.position === 'absolute') {
          const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
          w = Math.max(w, r.width - px(after.left) - px(after.right));
          h = Math.max(h, r.height - px(after.top) - px(after.bottom));
        }
        if (w < 44 - 0.5 || h < 44 - 0.5) {
          const name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30) || el.tagName;
          out.push(`${name}: ${Math.round(w)}×${Math.round(h)}`);
        }
      }
    }
    return out;
  });
}

test.describe('phone, accessibility', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('9. every control is named and at least 44 × 44; Escape closes the sheet back to its chip; the seek bar has keys', async ({ page }) => {
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    await phoneSize(page);
    const states: Array<[string, () => Promise<void>]> = [
      ['Now Playing, playing', async () => {}],
      ['the Crystal sheet', async () => {
        await page.getByTestId('chip-crystal').click();
        await expect(sheet(page, 'Crystal')).toBeVisible();
      }],
      ['the menu', async () => {
        await page.keyboard.press('Escape');
        await moreOptions(page).click();
        await expect(page.getByTestId('menu-body')).toBeVisible();
      }],
      ['the mini-player on Library', async () => {
        await page.keyboard.press('Escape');
        await tab(page, 'library');
        await expect(page.getByTestId('mini-player')).toBeVisible();
      }],
      // v15.7: the Library tab, its row menu and the Import sheet.
      ['the Library tab', async () => {
        await expect(page.getByTestId('library-list')).toBeVisible();
      }],
      ['the row menu', async () => {
        await page.getByRole('button', { name: 'Options for tone-02', exact: true }).click();
        await expect(page.getByTestId('library-menu-body')).toBeVisible();
      }],
      ['the Import sheet', async () => {
        await page.keyboard.press('Escape');
        await page.getByTestId('library-import').click();
        await expect(page.getByTestId('import-body')).toBeVisible();
        await page.keyboard.press('Escape');
      }],
      // v15.6: the Layers tab (each section on screen in turn).
      ['the Layers tab', async () => {
        await tab(page, 'layers');
        await expect(page.getByTestId('tab-layers')).toBeVisible();
      }],
      ['the Layers tab, Beat', async () => {
        await page.getByTestId('layers-jump-beat').click();
        await expect(page.getByTestId('layers-jump-beat')).toHaveAttribute('aria-current', 'true');
      }],
      ['the Layers tab, Advanced', async () => {
        await page.getByTestId('layers-jump-advanced').click();
        await expect(page.getByTestId('layers-jump-advanced')).toHaveAttribute('aria-current', 'true');
      }],
      ['Car', async () => {
        await tab(page, 'now');
        await page.getByTestId('np-output').click();
        await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Car', exact: true }).click();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('view-car')).toBeVisible();
      }],
    ];
    for (const [state, enter] of states) {
      await enter();
      await page.waitForTimeout(300);
      expect.soft(await unnamedControls(page), `${state}: unnamed controls`).toEqual([]);
      expect.soft(await smallTargets(page), `${state}: targets under 44 × 44`).toEqual([]);
    }
    // Back to Headphones and Now Playing for the keyboard checks.
    await page.getByRole('button', { name: 'Change output', exact: true }).click();
    await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Headphones', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-now')).toBeVisible();

    // Escape closes only the top sheet and gives the focus back to the chip that opened it.
    const chip = page.getByTestId('chip-crystal');
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page, 'Crystal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet-crystal')).toHaveCount(0);
    await expect(chip).toBeFocused();
    await expect(page.getByTestId('view-now'), 'one Escape, one overlay: Now Playing stays').toBeVisible();

    // The seek bar: ArrowRight +5 s, Home to the start.
    const seek = page.getByTestId('np-seek');
    await seek.focus();
    const before = Number(await seek.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(await seek.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(before + 4);
    await page.keyboard.press('Home');
    await expect.poll(async () => Number(await seek.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(1);
    await expect(seek).toHaveAttribute('aria-valuetext', /^\d+:\d{2} of \d+:\d{2}$/);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 10. The desktop shell
// ---------------------------------------------------------------------------------------------------------------

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('10. the side nav and the 88 px transport; Crystal opens in the panel, the transport works meanwhile; Escape closes it', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    await expect(page.getByTestId('side-nav')).toBeVisible();
    const h = await page.getByTestId('desktop-transport').evaluate((el) => el.getBoundingClientRect().height);
    expect(h, 'the transport is 88 px').toBe(88);
    await page.getByTestId('desktop-crystal').click();
    const panel = page.getByRole('region', { name: 'Crystal', exact: true });
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('desktop-panel')).toBeVisible();
    // Non-modal: the transport's Pause works while it is open.
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(true);
    await expect(panel).toBeVisible();
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await layerState(page)).music?.paused, { timeout: 5_000 }).toBe(false);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    // A section's panel closes with Escape too.
    await tab(page, 'library');
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 11. A landscape phone
// ---------------------------------------------------------------------------------------------------------------

test.describe('landscape phone', () => {
  test.use({ viewport: { width: 882, height: 411 }, hasTouch: true });

  test('11. Now Playing fits in two columns: every element inside the viewport, the tab bar shows, Play ≥ 44 px', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    if (ON_DEVICE) await page.setViewportSize({ width: 882, height: 411 });
    await expect(page.getByTestId('view-now')).toBeVisible();
    // Two columns: what plays on the left, the controls beside it on the right (not stacked under it).
    const title = (await page.getByTestId('np-title').boundingBox())!;
    const seek = (await page.getByTestId('np-seek').boundingBox())!;
    expect(seek.x, 'the seek bar sits to the right of the title').toBeGreaterThanOrEqual(title.x + 882 * 0.4);
    expect(seek.y, 'and beside it, not under it').toBeLessThan(title.y + title.height + 120);
    // The panel itself (its gradient's padding included) and everything in it lie inside the viewport.
    const outside = await page.getByTestId('view-now').evaluate((root) => {
      const out: string[] = [];
      for (const el of [root as HTMLElement, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).display === 'none') continue;
        if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) {
          out.push(`${el.tagName}.${(el.getAttribute('class') || '').split(' ')[0]} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
      return out;
    });
    expect(outside, 'Now Playing elements outside the viewport').toEqual([]);
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await expect(page.getByTestId('new-top-bar')).toBeHidden();
    const play = await page.getByTestId('np-play').boundingBox();
    expect(play!.width).toBeGreaterThanOrEqual(44);
    expect(play!.height).toBeGreaterThanOrEqual(44);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 12. The peek into classic
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone, peek', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('12. Open the classic library peeks: classic with the library and a way back; the choice stays new', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    await phoneSize(page);
    const pill = page.getByTestId('peek-pill');
    await expect(pill, 'no pill in the new layout').toHaveCount(0);
    await tab(page, 'library');
    await peekClassicLibrary(page);
    await expect(classicHeader(page)).toBeVisible();
    await expect(page.locator('aside').getByText('tone-02', { exact: true }), 'the library is open').toBeVisible();
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText('Back to the new layout');
    expect(await layoutPref(page), 'the choice stays new').toBe('new');
    await expectMusicPlaysOn(page, 'peeking');
    // The pill goes back to the stub.
    await pill.click();
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await expect(pill).toHaveCount(0);
    // A reload during a peek opens the new layout.
    await peekClassicLibrary(page);
    await expect(pill).toBeVisible();
    await page.reload();
    await newShell(page).waitFor();
    await expect(pill).toHaveCount(0);
    await expect(page.getByTestId('view-now')).toBeVisible();
    // Classic proper has no pill.
    await tab(page, 'more');
    await page.getByTestId('more-back-to-classic').click();
    await expect(classicHeader(page)).toBeVisible();
    await expect(pill).toHaveCount(0);
    expect(await layoutPref(page)).toBe('classic');
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// v15.5 review fixes (12b-21)
// ---------------------------------------------------------------------------------------------------------------

/** The Visualizer's particles, read from React's fiber of its <canvas> (dev and production alike): how many, and the
 *  share whose morph target lies on the r = 250 Fibonacci sphere (the shape before any crystal applies; 963 Hz's too). */
async function particleShape(page: Page): Promise<{ count: number; onSphere: number }> {
  return page.evaluate(() => {
    const canvas = document.getElementById('viz-canvas') as any;
    const key = canvas ? Object.keys(canvas).find((k) => k.startsWith('__reactFiber$')) : undefined;
    let fiber = key ? canvas[key] : null;
    while (fiber && typeof fiber.type !== 'function') fiber = fiber.return;
    let hook = fiber?.memoizedState;
    let particles: any[] | null = null;
    while (hook) {
      const v = hook.memoizedState;
      if (v && typeof v === 'object' && 'current' in v && Array.isArray(v.current) && v.current[0] && 'tx' in v.current[0] && 'basePhase' in v.current[0]) {
        particles = v.current;
        break;
      }
      hook = hook.next;
    }
    if (!particles) return { count: 0, onSphere: -1 };
    const on = particles.filter((p) => Math.abs(Math.hypot(p.tx, p.ty, p.tz) - 250) < 0.5).length;
    return { count: particles.length, onSphere: on / particles.length };
  });
}

/** Write a walk mode into the saved play state (from another same-origin page, as shrinkSavedLibrary does). */
async function saveWalkMode(page: Page, mode: string): Promise<void> {
  await page.goto('/manifest.json');
  await page.evaluate(async (mode) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('playlist-state', 'readwrite');
    const store = tx.objectStore('playlist-state');
    const state: any = await new Promise((resolve) => {
      const r = store.get('current');
      r.onsuccess = () => resolve(r.result);
    });
    state.loShuWalkMode = mode;
    store.put(state);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, mode);
}

const canRecordHere = (page: Page) =>
  page.evaluate(() => typeof MediaRecorder === 'function' && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function');

/** Classic's Record dialog: Visuals Only (a video recording of the canvas). */
async function startVisualsRecording(page: Page): Promise<void> {
  await page.locator('header button').filter({ has: page.locator('svg.lucide-circle') }).click();
  await page.getByText('Start Recording', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Visuals Only/ }).click();
  await expect(page.getByText('Start Recording', { exact: true }), 'the recording started (its dialog closed)').toBeHidden({ timeout: 10_000 });
}

test.describe('phone, review fixes', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("13. after a heat-guard pause the visuals take the crystal's shape again, not the starting sphere", async ({ page }) => {
    // The reveal re-runs the Visualizer's particle setup (Fibonacci sphere targets); its morph effect must re-apply the
    // crystal's shape. 528 Hz is an octahedron: almost none of its targets lie on the sphere. (The hex-wander tokens
    // go home on a reveal, by design.)
    test.setTimeout(150_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    await phoneSize(page);
    await page.getByTestId('chip-crystal').click();
    await page.getByTestId('crystal-528').click();
    await expect.poll(async () => (await particleShape(page)).onSphere, { message: "528 Hz's shape applies" }).toBeLessThan(0.5);
    const before = await particleShape(page);
    for (const via of ['the Library tab', 'the Car screen'] as const) {
      if (via === 'the Library tab') {
        await tab(page, 'library');
      } else {
        await page.getByTestId('np-output').click();
        await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Car', exact: true }).click();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('view-car')).toBeVisible();
      }
      await expect.poll(() => canvasDisplay(page), { message: `${via}: paused` }).toBe('none');
      if (via === 'the Library tab') {
        await tab(page, 'now');
      } else {
        await page.getByRole('button', { name: 'Change output', exact: true }).click();
        await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Headphones', exact: true }).click();
        await page.keyboard.press('Escape');
      }
      await expect.poll(() => canvasDisplay(page), { message: `back from ${via}: shown` }).not.toBe('none');
      await page.waitForTimeout(500);
      const after = await particleShape(page);
      expect(after.count, `back from ${via}: the same number of particles`).toBe(before.count);
      expect(after.onSphere, `back from ${via}: 528 Hz's shape again (the share on the starting sphere)`).toBeLessThan(0.5);
    }
    expect(dialogs).toEqual([]);
  });

  test('15. Zen turned on during a peek ends as the new layout comes back', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    await phoneSize(page);
    await tab(page, 'library');
    await peekClassicLibrary(page);
    await expect(page.getByTestId('peek-pill')).toBeVisible();
    // Classic's Zen toggle (a DOM click: on a phone the open library drawer lies over most of the player bar).
    await page.getByTitle('Zen Mode (Hide UI)', { exact: true }).evaluate((b) => (b as HTMLElement).click());
    await page.getByTestId('peek-pill').click();
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await page.waitForTimeout(4500); // past Zen's 3 s hide
    await expect(page.getByRole('button', { name: 'Show controls', exact: true }), "Zen's hidden-UI button never appears").toHaveCount(0);
    await expect(page.getByTestId('tab-library')).toBeVisible();
    expect(await canvasDisplay(page), 'the heat guard still pauses the visuals').toBe('none');
    expect(dialogs).toEqual([]);
  });

  test('16. the Car line under classic and under Music only; REC on the Car screen stops the recording', async ({ page }) => {
    test.skip(ON_DEVICE, 'stopping the recording would save a file on the phone');
    test.setTimeout(150_000);
    await instrumentAudio(page);
    // Classic layers with a saved Car output (from an earlier v2 session).
    const dialogs = await openApp(page, { engine: 'classic' });
    await seedLayers(page, { engine: 'classic', output: 'car' });
    await importTones(page, 3, 60);
    await page.getByText('tone-01', { exact: true }).first().click();
    await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 20_000 }).toBeGreaterThan(1);
    await closeSafety(page);
    const canRecord = await canRecordHere(page);
    if (canRecord) await startVisualsRecording(page);
    await optInNewLayout(page);
    await phoneSize(page);
    await expect(page.getByTestId('view-car')).toBeVisible();
    await expect(page.getByTestId('car-line')).toHaveText('Classic layers ignore Car output');
    // Music only on (from the Sound sheet): the line says so, in either engine.
    await page.getByRole('button', { name: 'Change output', exact: true }).click();
    await sheet(page, 'Sound').getByRole('switch', { name: 'Music only' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('car-line')).toHaveText('Only the music · Music only is on');
    await page.getByRole('button', { name: 'Change output', exact: true }).click();
    await sheet(page, 'Sound').getByRole('switch', { name: 'Music only' }).click();
    await page.keyboard.press('Escape');
    if (canRecord) {
      // REC on the Car screen; a tap stops the recording (classic's own handler).
      const rec = page.getByTestId('view-car').getByTestId('rec-stop');
      await expect(rec).toBeVisible();
      await rec.click();
      await expect(page.getByTestId('rec-stop')).toHaveCount(0);
      await expect.poll(() => canvasDisplay(page), { message: 'no recording: the Car screen pauses the visuals again' }).toBe('none');
    }
    expect(dialogs).toEqual([]);
  });

  test('16b. REC shows in the top bar and in More while recording, and a tap stops it', async ({ page }) => {
    test.skip(ON_DEVICE, 'stopping the recording would save a file on the phone');
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page, { optIn: false });
    test.skip(!(await canRecordHere(page)), 'MediaRecorder or canvas.captureStream is not available here');
    await startVisualsRecording(page);
    await optInNewLayout(page);
    await phoneSize(page);
    const rec = page.getByTestId('new-top-bar').getByTestId('rec-stop');
    await expect(rec).toBeVisible();
    await expect(rec).toHaveAccessibleName(/stop recording/i);
    await tab(page, 'more');
    await expect(page.getByTestId('more-stop-recording')).toBeVisible();
    await tab(page, 'now');
    await rec.click();
    await expect(page.getByTestId('rec-stop')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test("18. a restored walk mode the app doesn't know never takes the app down, in either layout", async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openApp(page);
    await importTones(page, 3, 30);
    await expectCache(page, { library: 3 });
    const rootFallback = page.getByRole('alert').filter({ hasText: 'Aetheria stopped after a problem.' });
    await saveWalkMode(page, 'not-a-walk');
    await page.goto('/');
    await acceptDisclaimer(page);
    await expect(page.getByText(/Restored 3 tracks/)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await expect(rootFallback, 'classic: no root crash').toHaveCount(0);
    await expect(classicHeader(page)).toBeVisible();
    // The new layout too (the bad mode restored again).
    await saveWalkMode(page, 'not-a-walk');
    await page.goto('/?layout=new');
    await newShell(page).waitFor();
    await page.waitForTimeout(2000);
    await expect(rootFallback, 'the new layout: no root crash').toHaveCount(0);
    await expect(newShell(page)).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('19. a seek drag shows its place and seeks once, on release: through the last seconds it starts no advance', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    await phoneSize(page);
    const title = (await page.getByTestId('np-title').textContent()) ?? '';
    const box = (await page.getByTestId('np-seek').boundingBox())!;
    const y = box.y + box.height / 2;
    const at = (f: number) => box.x + box.width * f;
    const timeBefore = (await layerState(page)).music!.time;
    await page.mouse.move(at(0.5), y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(at(0.5 + 0.05 * i), y);
    // Held in the track's last seconds, inside the auto-advance look-ahead, for over a second.
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(at(i % 2 ? 0.995 : 0.975), y);
      await page.waitForTimeout(40);
    }
    // While held: the bar shows the finger; the music has not been moved.
    const held = await page.getByTestId('np-seek-progress').evaluate((el) => parseFloat((el as HTMLElement).style.width));
    expect(held, 'the bar follows the drag').toBeGreaterThan(95);
    expect((await layerState(page)).music!.time, 'no seek while held').toBeLessThan(timeBefore + 10);
    await page.mouse.move(at(0.4), y);
    await page.mouse.up();
    await expect.poll(async () => (await layerState(page)).music!.time, { message: 'one seek, to where it was released' }).toBeGreaterThan(20);
    expect((await layerState(page)).music!.time).toBeLessThan(30);
    await expect(page.getByTestId('np-title'), 'no advance').toHaveText(title);
    expect(dialogs).toEqual([]);
  });

  test('17. ?layout= is applied, saved and dropped from the address: a reload follows a later choice', async ({ page }) => {
    const dialogs = await openNewLayout(page, { via: 'query' });
    expect(new URL(page.url()).searchParams.has('layout'), 'the param is gone from the address').toBe(false);
    expect(await layoutPref(page)).toBe('new');
    await tab(page, 'more');
    await page.getByTestId('more-back-to-classic').click();
    await expect(classicHeader(page)).toBeVisible();
    await page.reload();
    await acceptDisclaimer(page);
    await expect(newShell(page), 'the reload follows Back to classic').toHaveCount(0);
    expect(await layoutPref(page)).toBe('classic');
    expect(dialogs).toEqual([]);
  });
});

test.describe('small phone, review fixes', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("12b. the peek pill covers none of classic's header or transport controls, at four sizes", async ({ page }) => {
    test.setTimeout(240_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    const sizes = [
      { width: 360, height: 780 },
      { width: 411, height: 752 },
      { width: 412, height: 915 },
      { width: 1280, height: 800 },
    ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      // v15.6: Layers is no stub any more: its peek is Advanced › Visualizer settings › Open (Harmonic Control).
      for (const stub of ['library', 'layers'] as const) {
        await tab(page, stub);
        if (stub === 'library') {
          await peekClassicLibrary(page);
        } else {
          await page.getByTestId('layers-jump-advanced').click();
          await page.getByTestId('layers-open-visualizer').click();
        }
        const pill = page.getByTestId('peek-pill');
        await expect(pill).toBeVisible();
        await page.waitForTimeout(400); // the insets follow classic's player bar
        const hits = await page.evaluate(() => {
          const pill = document.querySelector('[data-testid="peek-pill"]')!.getBoundingClientRect();
          const controls = Array.from(
            document.querySelectorAll<HTMLElement>(
              'header button, header a[href], header input, [data-testid="player-bar"] button, [data-testid="player-bar"] input, [data-testid="player-bar"] [role="slider"]'
            )
          );
          const out: string[] = [];
          let checked = 0;
          for (const el of controls) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
            checked++;
            const name = el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim().slice(0, 20) || el.tagName;
            if (r.right > pill.left + 0.5 && pill.right > r.left + 0.5 && r.bottom > pill.top + 0.5 && pill.bottom > r.top + 0.5) out.push(`${name}: overlaps the pill`);
            const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
            const cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
            const top = document.elementFromPoint(cx, cy);
            if (top && top.closest('[data-testid="peek-pill"]')) out.push(`${name}: a tap at its centre hits the pill`);
          }
          const pc = document.elementFromPoint(pill.left + pill.width / 2, pill.top + pill.height / 2);
          if (!pc || !pc.closest('[data-testid="peek-pill"]')) out.push('the pill itself is covered');
          return { out, checked };
        });
        expect(hits.checked, `${size.width}×${size.height}, from ${stub}: controls checked`).toBeGreaterThan(5);
        expect(hits.out, `${size.width}×${size.height}, peeking from ${stub}`).toEqual([]);
        await pill.click();
        await expect(pill).toHaveCount(0);
      }
      await tab(page, 'now');
    }
    expect(dialogs).toEqual([]);
  });

  test('14. notices sit clear of every control in the new layout, and the Music-only toast names the Sound sheet', async ({ page }) => {
    test.setTimeout(180_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    if (ON_DEVICE) await page.setViewportSize({ width: 360, height: 780 });
    const clear = async (state: string) => {
      await page.waitForTimeout(300);
      const found = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="notices"] > div')).filter((c) => c.getBoundingClientRect().height > 0);
        // v15.7: the Library tab's scrolling content passes under a notice; its spacer lets every row scroll clear of it
        // (checked below), so only the fixed controls count here.
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="new-shell"] button, [data-testid="new-shell"] [role="slider"], [data-testid="new-shell"] input')
        ).filter((el) => !el.closest('[data-testid="library-scroll"]'));
        const out: string[] = [];
        for (const card of cards) {
          const c = card.getBoundingClientRect();
          for (const el of controls) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (r.right > c.left + 0.5 && c.right > r.left + 0.5 && r.bottom > c.top + 0.5 && c.bottom > r.top + 0.5) {
              out.push(`${(card.textContent || '').trim().slice(0, 30)} over ${el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 24) || el.tagName}`);
            }
          }
        }
        return { cards: cards.length, out };
      });
      expect(found.cards, `${state}: a notice shows`).toBeGreaterThan(0);
      expect(found.out, `${state}: notices over controls`).toEqual([]);
    };
    // The update banner (it stays until dismissed), in every state.
    await page.evaluate(() => {
      (window as any).__aetheriaUpdateReady = true;
      window.dispatchEvent(new Event('aetheria:update-ready'));
    });
    await clear('Now Playing');
    await tab(page, 'library');
    await clear('the Library tab, above the mini-player');
    // Scrolled to its end, the list's last row and its ⋯ sit clear of the notice (the spacer).
    await page.getByTestId('library-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(300);
    const lastRowClear = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="notices"] > div')).find((c) => c.getBoundingClientRect().height > 0)!.getBoundingClientRect();
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="library-row"]'));
      const last = rows.sort((a, b) => Number(b.getAttribute('aria-posinset')) - Number(a.getAttribute('aria-posinset')))[0].getBoundingClientRect();
      return last.bottom <= card.top + 0.5;
    });
    expect(lastRowClear, 'the last row scrolls clear of the notice').toBe(true);
    await tab(page, 'now');
    await page.getByTestId('np-output').click();
    await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Car', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('view-car')).toBeVisible();
    await clear('the Car screen');
    await page.getByRole('button', { name: 'Change output', exact: true }).click();
    await sheet(page, 'Sound').getByRole('group', { name: 'Output' }).getByRole('button', { name: 'Headphones', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('desktop-crystal').click();
    await expect(sheet(page, 'Crystal')).toBeVisible();
    await clear('the desktop, the Crystal panel open');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 360, height: 780 });
    await page.getByRole('button', { name: 'Dismiss update notice' }).click();

    // The Music-only toast (a crystal picked under Music only): clear of the seek bar and Play, and it names the
    // Sound sheet, where Music only lives in the new layout.
    await page.getByTestId('np-output').click();
    await sheet(page, 'Sound').getByRole('switch', { name: 'Music only' }).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('chip-crystal').click();
    await page.getByTestId('crystal-639').click();
    const toast = page.getByTestId('notices').getByText(/Music only is on, so the tone is silent/);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText('Music only is on, so the tone is silent. Turn it off in the Sound sheet.');
    await clear('the Music-only toast on Now Playing');
    expect(dialogs).toEqual([]);
  });

  test('20. Perfect GUT switched off after a pick: every readout names the crystal v2 plays, and its cell is marked', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    if (ON_DEVICE) await page.setViewportSize({ width: 360, height: 780 });
    const chip = page.getByTestId('chip-crystal');
    // Perfect GUT on, then 528's cell (it plays as 519).
    await chip.click();
    await sheet(page, 'Crystal').getByRole('switch', { name: 'Lo Shu Perfect GUT' }).click();
    await page.getByTestId('crystal-519').click();
    await expect(chip).toHaveAttribute('aria-label', /^Crystal 519 Hz/);
    await expect.poll(async () => (await layersState(page))?.requested?.canonical_hz ?? 0).toBe(519);
    // Perfect GUT off again: v2 plays 528, and so says every readout.
    await chip.click();
    await sheet(page, 'Crystal').getByRole('switch', { name: 'Lo Shu Perfect GUT' }).click();
    await expect.poll(async () => (await layersState(page))?.requested?.canonical_hz ?? 0).toBe(528);
    await expect(page.getByTestId('crystal-528'), "528's cell is the playing one").toHaveAttribute('aria-pressed', 'true');
    await expect(sheet(page, 'Crystal').getByText(/^Playing 528 Hz/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chip).toHaveAttribute('aria-label', /^Crystal 528 Hz/);
    await tab(page, 'library');
    await expect(page.getByTestId('mini-player')).toContainText('528 Hz');
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop, review fixes', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('21. a panel opened in place of another gives the focus back to its own opener', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingInNewLayout(page);
    await page.getByTestId('desktop-output').click();
    await expect(page.getByRole('region', { name: 'Sound', exact: true })).toBeVisible();
    // Every place the focus goes from here on.
    await page.evaluate(() => {
      const trail: string[] = ((window as any).__focusTrail = []);
      document.addEventListener('focusin', (e) => trail.push((e.target as HTMLElement).getAttribute('data-testid') || (e.target as HTMLElement).tagName), true);
    });
    await page.getByTestId('desktop-crystal').click();
    await expect(page.getByRole('region', { name: 'Crystal', exact: true })).toBeVisible();
    // Sound, closing as Crystal opens in its place, leaves the focus where the user put it (it never pulls it back
    // to Output, its own opener), so Crystal's opener is the tile.
    expect(await page.evaluate(() => (window as any).__focusTrail), 'the focus never goes back to Output').not.toContain('desktop-output');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await expect(page.getByTestId('desktop-crystal'), 'the crystal tile that opened Crystal').toBeFocused();
    expect(dialogs).toEqual([]);
  });
});
