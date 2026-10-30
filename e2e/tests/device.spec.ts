import { type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect, ON_DEVICE } from './fixtures';
import { acceptDisclaimerNew, seedToneLibrary, LAYER_ENGINE_KEY, LAYOUT_KEY } from './helpers';
import { openApp, acceptDisclaimer, importTones, pauseCount, instrumentAudio, layerState, pickFrequency, seedLayers, layersState, metaRecords, seedTracks, keyFitState, KEY_FIT_KEY, crash, optInNewLayout, layoutPref, tapAt, shellHidden, PHONE_VIEWPORT, openSeededNewLayout, openLibraryTab, libraryState, startWalk, libraryRowButton, rowMenu, recordHudDraws, type LibraryState } from './helpers';
import { adb, mediaSession, chromeSessions } from './adb';
import { stubDownloads, caughtDownloads, wavInfo } from './downloads';

// Checks only a real phone can make (npm run test:device). Android's own media
// session — what the lock screen, the notification and the car show — is read
// with `adb shell dumpsys media_session`. The screen-off tests must stay LAST
// (v15.4: the panel-crash one after the lock-screen one, the root crash last;
// v15.5: the new layout's one before the lock-screen one; v15.6: the new layout in Zen after it; v15.7: the Library
// tab's row tap after that; v15.8: the walk after Assign after that; v15.9: a mix from the Mixes tab after that; v16.0:
// the queue after that; v16.1: a saved playlist after that; v16.2: a filtered set after that; v16.3: a built mix after
// that; v16.4: Keep screen awake off with Pause visuals on after that; v16.5: a recording, then an export, with the
// screen off, after that).
// While Playwright is connected, Chrome on Android keeps every tab visible: no test here ever sees a real hide. The
// tests that need one (v16.0.1's D1-D3, the hide flush; v16.1's D-PL1, a playlist made just before a background kill)
// are in device-hide.spec.ts, run on their own with E2E_HIDE=1.
test.skip(!ON_DEVICE, 'needs an Android device (npm run test:device)');

// Android sends the media keys to a card that is PLAYING, so a card left over
// from other playback would take the keys these tests send, and the card they
// read would be the wrong one.
test.beforeEach(() => {
  const playing = chromeSessions().filter((s) => s.state === 'playing');
  expect(playing, 'Chrome already shows a PLAYING card: stop that playback, or restart Chrome on the phone if the card is stale').toEqual([]);
});

test('a car or lock-screen Next on the last track pauses the music and the layers @device', async ({ page }) => {
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await importTones(page, 2, 30);
  await page.getByText('tone-02', { exact: true }).click();
  await expect.poll(() => mediaSession(), { timeout: 15_000 }).toEqual({ state: 'playing', title: 'tone-02' });
  await pickFrequency(page);
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);

  // The media key the car and the lock screen send.
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_NEXT');
  await expect
    .poll(async () => (await layerState(page)).music?.paused, { timeout: 10_000, message: 'Next on the last track pauses the music' })
    .toBe(true);
  // The tone stops on the next render, a moment after the music.
  await expect.poll(async () => (await layerState(page)).toneSounding, { message: 'and the tone' }).toBe(false);
  await expect
    .poll(() => mediaSession(), { timeout: 10_000, message: 'and the card shows it paused' })
    .toEqual({ state: 'paused', title: 'tone-02' });

  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PLAY');
  await expect
    .poll(() => mediaSession(), { timeout: 10_000, message: 'Play resumes it' })
    .toEqual({ state: 'playing', title: 'tone-02' });
  // PAUSE, not STOP: Chrome's Android card offers no stop action
  // (PlaybackState actions=382), so Android drops a STOP key before the page.
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE');
  await expect
    .poll(async () => (await layerState(page)).music?.paused, { timeout: 10_000, message: 'Pause pauses it' })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

test('v2: a car or lock-screen Next on the last track pauses the music and the v2 layers @device', async ({ page }) => {
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 2, 30);
  await page.getByText('tone-02', { exact: true }).click();
  await expect.poll(() => mediaSession(), { timeout: 15_000 }).toEqual({ state: 'playing', title: 'tone-02' });
  await pickFrequency(page);
  // The v2 player plays 528 Hz: on headphones its tone is 528 Hz itself.
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);

  // The media key the car and the lock screen send.
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_NEXT');
  await expect
    .poll(async () => (await layerState(page)).music?.paused, { timeout: 10_000, message: 'Next on the last track pauses the music' })
    .toBe(true);
  // The v2 layers stop with it: nothing requested, then every gate closed
  // (the tone and beat in 0.8 s, the drone in at most 3 s).
  await expect
    .poll(async () => { const s = await layersState(page); return s ? s.requested : 'no player'; }, { message: 'and the v2 layers' })
    .toBeNull();
  await expect.poll(async () => (await layersState(page)).phase, { timeout: 5_000, message: 'which fall silent' }).toBe('silent');
  await expect
    .poll(() => mediaSession(), { timeout: 10_000, message: 'and the card shows it paused' })
    .toEqual({ state: 'paused', title: 'tone-02' });

  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PLAY');
  await expect
    .poll(() => mediaSession(), { timeout: 10_000, message: 'Play resumes it' })
    .toEqual({ state: 'playing', title: 'tone-02' });
  await expect
    .poll(async () => (await layersState(page)).requested?.tone_hz ?? 0, { message: 'and the v2 layers with it' })
    .toBe(528);
  // PAUSE, not STOP: Chrome's Android card offers no stop action.
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE');
  await expect
    .poll(async () => (await layerState(page)).music?.paused, { timeout: 10_000, message: 'Pause pauses it' })
    .toBe(true);
  await expect.poll(async () => (await layersState(page)).requested, { message: 'and the v2 layers' }).toBeNull();
  expect(dialogs).toEqual([]);
});

test('the new layout keeps the lock-screen card across three gapless advances with the screen off @device', async ({ page }) => {
  // v15.5 (spec §5.7): the screen-off advance of the test below, played from the new layout's Now Playing (opt-in
  // beta). Turns the screen off; on a phone with a secure lock it stays locked after the test (unlock it by hand).
  const dialogs = await openApp(page);
  await importTones(page, 28, 4);
  // Auto-Distribute gives every track a crystal, which the gapless advance needs.
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  // The phone shell (the fixture sizes the tab as a desktop; this tab only, it is closed after the test), then the
  // opt-in a user taps: Harmonic Control › Try the new layout.
  await page.setViewportSize(PHONE_VIEWPORT);
  await optInNewLayout(page);
  await expect(page.getByTestId('view-now')).toBeVisible();
  expect(await layoutPref(page), 'the new layout is the saved choice').toBe('new');
  // Play from Now Playing, with a finger (nothing loaded yet: Play starts the play order at its first track).
  const play = await page.getByTestId('np-play').boundingBox();
  expect(play, "Now Playing's Play button").toBeTruthy();
  await tapAt(page, play!.x + play!.width / 2, play!.y + play!.height / 2);
  await expect.poll(() => mediaSession()?.state, { timeout: 15_000 }).toBe('playing');
  const first = mediaSession()!.title;
  await expect(page.getByTestId('np-title')).toHaveText(first);
  const pausesBefore = await pauseCount(page);

  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card, its title following' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles with the screen off', description: [first, ...titles].join(' → ') });
  // After the wake, DOM reads only: the secure keyguard stays up for the phone's lock delay and Chrome draws no frames
  // behind it, so a locator click or tap would wait for ever (v15.4's panel-crash test). No wait for an unlock.
  // The gapless swap never pauses the element; the playTrack fallback (which drops the card on a locked phone) does.
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  await expect(page.getByTestId('new-shell'), 'still the new layout').toBeAttached();
  await expect(page.getByTestId('view-now')).toBeAttached();
  await expect
    .poll(async () => ((await page.getByTestId('np-title').textContent()) ?? '') === (mediaSession()?.title ?? '-'), {
      timeout: 10_000,
      message: "Now Playing's title is the card's",
    })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

test('in Zen, the new layout keeps the lock-screen card across three gapless advances with the screen off @device', async ({ page }) => {
  // v15.6 (spec §5.9 step 3): the test above with the new layout's Zen on and hidden before the screen goes off (the
  // shell inert and transparent: nothing of it may touch the card or the advance). Turns the screen off; a phone with a
  // secure lock stays locked after the test (unlock it by hand).
  const dialogs = await openApp(page);
  await importTones(page, 28, 4);
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await page.setViewportSize(PHONE_VIEWPORT);
  await optInNewLayout(page);
  await expect(page.getByTestId('view-now')).toBeVisible();
  const play = await page.getByTestId('np-play').boundingBox();
  expect(play, "Now Playing's Play button").toBeTruthy();
  await tapAt(page, play!.x + play!.width / 2, play!.y + play!.height / 2);
  await expect.poll(() => mediaSession()?.state, { timeout: 15_000 }).toBe('playing');
  // Zen on with a finger, then hidden (3 s later): polled, as the tap's click lands after tapAt returns.
  const eye = await page.getByTestId('zen-button').boundingBox();
  expect(eye, 'the Zen button').toBeTruthy();
  await tapAt(page, eye!.x + eye!.width / 2, eye!.y + eye!.height / 2);
  await expect(page.getByTestId('zen-button')).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  await expect
    .poll(() => shellHidden(page), { timeout: 10_000, message: 'Zen hides the controls before the screen goes off' })
    .toBe(true);
  const first = mediaSession()!.title;
  const pausesBefore = await pauseCount(page);

  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card, its title following' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles with the screen off, in Zen', description: [first, ...titles].join(' → ') });
  // After the wake, DOM reads only (the keyguard: no frames, no taps).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  await expect(page.getByTestId('new-shell'), 'still the new layout').toBeAttached();
  expect(await shellHidden(page), 'still in Zen, hidden: nothing revealed it').toBe(true);
  await expect
    .poll(async () => ((await page.getByTestId('np-title').textContent()) ?? '') === (mediaSession()?.title ?? '-'), {
      timeout: 10_000,
      message: "Now Playing's title is the card's",
    })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

test('the Library tab: a row tap during a walk puts the tapped track on the card at once; car Next 2/2 and Pause/Play follow the library; with the screen off it advances through the library @device', async ({ page }) => {
  // v15.7 (spec §5.9 step 3), the riskiest path: a walk plays, a Library row is tapped, and the card, the car keys and
  // the gapless advance all follow the LIBRARY from that track. Screen on first (the car keys), then off. Turns the
  // screen off; a phone with a secure lock stays locked after the test (unlock it by hand).
  const dialogs = await openApp(page);
  await importTones(page, 28, 4);
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await page.setViewportSize(PHONE_VIEWPORT);
  await optInNewLayout(page);
  await expect(page.getByTestId('view-now')).toBeVisible();
  const at = async (testId: string) => {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, testId).toBeTruthy();
    await tapAt(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
  };
  // A walk, with a finger (Walks › Vortex): polled, as each tap's click lands after tapAt returns.
  await at('np-walks');
  await expect(page.getByTestId('walk-C')).toBeVisible({ timeout: 5_000 });
  await at('walk-C');
  await expect.poll(() => mediaSession()?.state, { timeout: 15_000 }).toBe('playing');
  // The Library tab, and a row: tone-10 (or tone-11 when the walk is on tone-10).
  await at('tab-library-button');
  await expect(page.getByTestId('library-list')).toBeVisible({ timeout: 5_000 });
  const walkTitle = mediaSession()!.title;
  const n = walkTitle === 'tone-10' ? 11 : 10;
  const name = (k: number) => `tone-${String(k).padStart(2, '0')}`;
  // The list is virtualized: scroll it so the row is mounted and in view (a DOM scroll; the tap itself is a finger's).
  await page.evaluate((i) => {
    const sc = document.querySelector('[data-testid="library-scroll"]') as HTMLElement;
    const list = document.querySelector('[data-testid="library-list"]') as HTMLElement;
    sc.scrollTop = Math.max(0, list.offsetTop + i * 64 - 120);
  }, n - 1);
  const row = page.getByTestId('library-row').filter({ has: page.locator('[data-row-title]').getByText(name(n), { exact: true }) });
  await expect(row).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  const box = await row.boundingBox();
  expect(box, `the ${name(n)} row`).toBeTruthy();
  await tapAt(page, box!.x + 80, box!.y + box!.height / 2);
  await expect
    .poll(() => mediaSession(), { timeout: 15_000, message: 'the card names the tapped track' })
    .toEqual({ state: 'playing', title: name(n) });
  await expect(page.getByTestId('mini-title')).toHaveText(name(n));
  // The car's (and the lock screen's) Next, twice: the library's next tracks, in order.
  for (const k of [n + 1, n + 2]) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_NEXT');
    await expect.poll(() => mediaSession(), { timeout: 15_000, message: `car Next → ${name(k)}` }).toEqual({ state: 'playing', title: name(k) });
  }
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE');
  await expect.poll(() => mediaSession()?.state, { timeout: 10_000, message: 'Pause' }).toBe('paused');
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PLAY');
  await expect.poll(() => mediaSession(), { timeout: 10_000, message: 'Play' }).toEqual({ state: 'playing', title: name(n + 2) });
  const first = name(n + 2);
  const pausesBefore = await pauseCount(page);

  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card, through the library' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles with the screen off, from a Library row', description: [first, ...titles].join(' → ') });
  expect(titles.slice(0, 3), 'the library in order from the tapped track').toEqual([name(n + 3), name(n + 4), name(n + 5)]);
  // After the wake, DOM reads only (the keyguard: no frames, no taps).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  await expect(page.getByTestId('tab-library'), 'still the Library tab').toBeAttached();
  await expect
    .poll(async () => ((await page.getByTestId('mini-title').textContent()) ?? '') === (mediaSession()?.title ?? '-'), {
      timeout: 10_000,
      message: "the mini-player's title is the card's",
    })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

test('v15.8: after Assign, a Layer Ascent walk with the screen off: no gap on the path, the card follows three gapless advances across assigned tracks without a decode; after the wake the cube’s step names the crystal playing @device', async ({ page }) => {
  // v15.8 (spec §5.8, addendum A5): Assign on a seeded synthetic library (30 tones, a crystal each but none at 852),
  // then the walk. Assign fills 852, so the walk has every position; its tracks are assigned (not scanned) yet
  // playback-ready, so playTrack never decodes them. Turns the screen off; a secure lock stays locked after the test.
  await page.addInitScript(() => {
    const w = window as any;
    w.__decodes = 0;
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: unknown[]) { w.__decodes++; return (decode as any).apply(this, a); } as typeof decode;
  });
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4, patch: [{ index: 7, crystal: null }] });
  await page.setViewportSize(PHONE_VIEWPORT);
  await openLibraryTab(page);
  await expect(page.getByTestId('health-crystals-line')).toHaveText('1 of 30 tracks have none');
  const assign = await page.getByTestId('health-crystals-action').boundingBox();
  await tapAt(page, assign!.x + assign!.width / 2, assign!.y + assign!.height / 2);
  // On the phone a CDP tap lands ~300 ms after tapAt returns, so every outcome is polled, never read once. Before
  // Assign the library already holds 26 crystals and one null (none at 852): only real crystals count, and the origins
  // and the playback-ready marker are part of the same condition, so the wait proves Assign ran.
  const assigned = (s: LibraryState) =>
    new Set(s.crystals.filter((c) => typeof c === 'number' && c > 0)).size === 27 && s.origins.every((o) => o === 'assigned') && s.scanned.every(Boolean);
  // The seeded crystals are an older placement's (no recorded origin): when some move, Assign asks first.
  const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
  await expect.poll(async () => (await ask.isVisible()) || assigned(await libraryState(page)), { message: 'Assign asks, or applies', timeout: 15_000 }).toBe(true);
  if (await ask.isVisible()) {
    const yes = await ask.getByRole('button', { name: 'Assign', exact: true }).boundingBox();
    await tapAt(page, yes!.x + yes!.width / 2, yes!.y + yes!.height / 2);
  }
  await expect
    .poll(async () => assigned(await libraryState(page)), { message: 'Assign applied: every crystal has a track; every track assigned (not scanned) and playback-ready', timeout: 15_000 })
    .toBe(true);
  await startWalk(page, 'A');
  const s0 = await libraryState(page);
  expect(s0.steps, 'no gap: every position of the path').toEqual([...Array(27).keys()]);
  await expect.poll(() => mediaSession()?.state, { timeout: 15_000 }).toBe('playing');
  const first = mediaSession()!.title;
  const pausesBefore = await pauseCount(page);
  const decodesBefore = await page.evaluate(() => (window as any).__decodes);

  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card, its title following' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles with the screen off', description: [first, ...titles].join(' → ') });
  // After the wake, DOM and state reads only (no click or tap: Chrome draws no frames behind the keyguard).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  expect(await page.evaluate(() => (window as any).__decodes) - decodesBefore, 'no decode: assigned tracks are playback-ready').toBe(0);
  const s = await libraryState(page);
  expect([s.walk, s.steps], 'the walk and its steps intact').toEqual(['A', s0.steps]);
  expect(s.cursor, 'three tracks on').toBeGreaterThanOrEqual(3);
  const ASCENT = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
  expect(ASCENT[s.steps![s.cursor]], 'the cube’s step names the crystal playing').toBe(s.crystals[s.libraryNames.indexOf(s.current ?? '')]);
  // (4 s tones advance on their own: the card and the state are compared as one polled pair.)
  await expect
    .poll(async () => (await libraryState(page)).current === (mediaSession()?.title ?? '-'), { message: 'the card names the track playing', timeout: 10_000 })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

test('v15.9: Grounding from the Mixes tab puts its first track on the card at once; with the screen off the card follows three gapless advances through the mix, in its order; after the wake the order and the cursor are intact @device', async ({ page }) => {
  // v15.9 (spec §5.10 step 4): a mix now starts playing (startPlayOrder), so the card, the car and the gapless advance
  // must follow the MIX from its first track. 30 seeded tones of 4 s (crystals the 27 in turn), the new layout on the
  // phone, the Mixes tab, Grounding by a finger tap: tone-0001, tone-0028, tone-0002, tone-0029, tone-0003, tone-0030,
  // tone-0004. Turns the screen off; a phone with a secure lock stays locked after the test (unlock it by hand).
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4 });
  await page.setViewportSize(PHONE_VIEWPORT);
  const at = async (testId: string) => {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, testId).toBeTruthy();
    await tapAt(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
  };
  await at('tab-mixes-button');
  await expect(page.getByTestId('tab-mixes')).toBeVisible({ timeout: 5_000 });
  const row = page.getByTestId('mix-preset:qi');
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' })); // a DOM scroll; the tap itself is a finger's
  await page.waitForTimeout(300);
  await at('mix-preset:qi');
  const MIX = ['tone-0001', 'tone-0028', 'tone-0002', 'tone-0029', 'tone-0003', 'tone-0030', 'tone-0004'];
  // Polled: the tap's click lands after tapAt returns.
  await expect.poll(async () => (await libraryState(page)).names, { timeout: 15_000, message: 'the mix is the play order' }).toEqual(MIX);
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'the card names the mix’s first track at once' }).toEqual({ state: 'playing', title: MIX[0] });
  const s0 = await libraryState(page);
  const first = mediaSession()!.title;
  const pausesBefore = await pauseCount(page);

  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card, through the mix' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles with the screen off, from the Mixes tab', description: [first, ...titles].join(' → ') });
  expect(titles.slice(0, 3), 'the mix in its order: its 2nd, 3rd and 4th tracks').toEqual(MIX.slice(1, 4));
  // After the wake, DOM and state reads only (no click or tap: Chrome draws no frames behind the keyguard).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  const s = await libraryState(page);
  expect([s.ids, s.walk], 'the mix’s order intact, no walk').toEqual([s0.ids, null]);
  expect(s.cursor, 'three tracks on').toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('tab-mixes'), 'still the Mixes tab').toBeAttached();
  // (4 s tones advance on their own: the card and the state are compared as one polled pair.)
  await expect
    .poll(async () => (await libraryState(page)).current === (mediaSession()?.title ?? '-'), { message: 'the card names the track playing', timeout: 10_000 })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

test('v16.0: by finger, Play next tone-0020 then Add to queue tone-0025 from the Library’s ⋯; with the screen off the card follows three gapless advances through the queue, then the library; after the wake the order is intact and both queued tracks played @device', async ({ page }) => {
  // v16.0 (spec §5.10 step 4): queued tracks are entries of the play order, so the gapless swap, with the screen off,
  // plays them next. 30 seeded tones of 4 s with crystals, the new layout on the phone; tone-0001 from the Library by a
  // finger tap, paused while the two are queued by finger (a 4 s tone would end first), then Play. Turns the screen off;
  // a phone with a secure lock stays locked after the test (unlock it by hand).
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4 });
  await page.setViewportSize(PHONE_VIEWPORT);
  const at = async (target: ReturnType<typeof page.getByTestId>, what: string) => {
    await target.evaluate((el) => el.scrollIntoView({ block: 'center' })); // a DOM scroll; the tap itself is a finger's
    await page.waitForTimeout(300);
    const box = await target.boundingBox();
    expect(box, what).toBeTruthy();
    await tapAt(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
  };
  const reveal = async (k: number) => {
    // Bring a row of the virtualized list into the DOM (a DOM scroll), so its ⋯ can be tapped.
    await page.getByTestId('library-scroll').evaluate((sc, top) => { sc.scrollTop = top; }, Math.max(0, (k - 4) * 64));
    await page.waitForTimeout(300);
  };
  const queueState = () => page.evaluate(() => (window as any).__aetheriaQueue.state());
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  // Polled: the tap's click lands after tapAt returns.
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await at(page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }), 'Pause');
  await expect.poll(async () => (await libraryState(page)).playing, { timeout: 10_000, message: 'paused' }).toBe(false);
  await reveal(20);
  await at(rowMenu(page, 'tone-0020'), 'the ⋯ of tone-0020');
  await expect(page.getByRole('dialog', { name: 'tone-0020', exact: true })).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('library-menu-next'), 'Play next');
  await expect.poll(async () => (await queueState()).waitingNames, { timeout: 10_000, message: 'Play next by finger' }).toEqual(['tone-0020']);
  await reveal(25);
  await at(rowMenu(page, 'tone-0025'), 'the ⋯ of tone-0025');
  await expect(page.getByRole('dialog', { name: 'tone-0025', exact: true })).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('library-menu-queue'), 'Add to queue');
  await expect.poll(async () => (await queueState()).waitingNames, { timeout: 10_000, message: 'Add to queue by finger' }).toEqual(['tone-0020', 'tone-0025']);
  await at(page.getByTestId('mini-player').getByRole('button', { name: 'Play', exact: true }), 'Play');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 plays again' }).toEqual({ state: 'playing', title: 'tone-0001' });
  const s0 = await libraryState(page);
  const pausesBefore = await pauseCount(page);
  const first = mediaSession()!.title;

  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card: the queue, then the library' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles with the screen off, with a queue', description: [first, ...titles].join(' → ') });
  expect(titles.slice(0, 3), 'the queue in its order, then the library').toEqual(['tone-0020', 'tone-0025', 'tone-0002']);
  // After the wake, DOM and state reads only (no click or tap: Chrome draws no frames behind the keyguard).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  const s = await libraryState(page);
  const q = await queueState();
  expect(s.ids, 'the order intact').toEqual(s0.ids);
  expect(s.ids.filter((_: string, i: number) => q.marks[i] === 0), 'the play order’s own entries: the library, in order').toEqual(s.libraryIds);
  expect([q.marks[1], q.marks[2]], 'both queued tracks played').toEqual([2, 2]);
  expect(s.cursor, 'three tracks on').toBeGreaterThanOrEqual(3);
  // (4 s tones advance on their own: the card and the state are compared as one polled pair.)
  await expect
    .poll(async () => (await libraryState(page)).current === (mediaSession()?.title ?? '-'), { message: 'the card names the track playing', timeout: 10_000 })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

/**
 * v16.1 (spec §5.10): a saved playlist on the phone. D-PL2: Clear (the new layout's Library tools) keeps a playlist, its
 * tracks missing, with the screen on (the android project); then the screen-off test below. (D-PL1, a playlist made just
 * before a background kill, needs a real hide: it is in device-hide.spec.ts.) Every tap is a finger's (tapAt, spaced
 * past Android's double-tap window), and every outcome is polled (a tap's click lands after tapAt returns).
 */
async function playlistPhone(page: Page): Promise<{ at: (t: Locator, what: string) => Promise<void> }> {
  /** What covers the point (null: the target itself); 'offline-ready' for the app's Ready Offline banner. Arms the
   *  click watch on the target. */
  const cover = (target: Locator, x: number, y: number) => target.evaluate((el, p) => {
    const w = window as any;
    if (!w.__atClicks) {
      w.__atClicks = [] as { x: number; y: number; on: boolean }[];
      document.addEventListener('click', (e: MouseEvent) => {
        if (e.isTrusted) w.__atClicks.push({ x: e.clientX, y: e.clientY, on: !!w.__atTarget && (w.__atTarget === e.target || w.__atTarget.contains(e.target as Node)) });
      }, true);
    }
    w.__atClicks.length = 0;
    w.__atTarget = el;
    const hit = document.elementFromPoint(p.x, p.y);
    if (hit && (el === hit || el.contains(hit))) return null;
    // The Ready Offline notice: classic's banner is itself the labelled button; v16.4's new-layout card holds it as its X.
    const dismiss = document.querySelector('[aria-label="Dismiss offline-ready notice"]');
    if (hit && dismiss && (dismiss.contains(hit) || dismiss.parentElement?.contains(hit))) return 'offline-ready';
    return hit ? `${hit.tagName.toLowerCase()}${hit.getAttribute('data-testid') ? `[data-testid=${hit.getAttribute('data-testid')}]` : ''}` : 'nothing';
  }, { x, y });
  const at = async (target: Locator, what: string) => {
    await target.evaluate((el) => el.scrollIntoView({ block: 'center' })); // a DOM scroll; the tap itself is a finger's
    await page.waitForTimeout(300);
    const box = await target.boundingBox();
    expect(box, what).toBeTruthy();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    let hit = await cover(target, x, y);
    if (hit === 'offline-ready') {
      // The app's Ready Offline notice (shown once offline support installs, until tapped away: a banner at the top of
      // the phone's screen before v16.4, a card in the notices since): tap its dismiss first, as a person would.
      const banner = page.getByRole('button', { name: 'Dismiss offline-ready notice' });
      const b = await banner.boundingBox();
      if (b) await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
      await expect(banner, 'the Ready Offline banner, tapped away').toHaveCount(0, { timeout: 5_000 });
      hit = await cover(target, x, y);
    }
    expect(hit, `${what}: nothing covers it`).toBeNull();
    await tapAt(page, x, y);
    // Under the tests' viewport emulation Android Chrome dispatches the click about 0.3 s after the touch: wait for it
    // to arrive on the target, so the next step's scroll can't move the content under it (a label may forward a
    // second click to its input).
    await expect
      .poll(() => page.evaluate((p) => (window as any).__atClicks.filter((c: { x: number; y: number }) => Math.abs(c.x - p.x) <= 4 && Math.abs(c.y - p.y) <= 4).some((c: { on: boolean }) => c.on), { x, y }), { timeout: 3_000, intervals: [50, 100], message: `${what}: the tap’s click arrives on it` })
      .toBe(true);
  };
  return { at };
}
const playlistsState = (p: Page) => p.evaluate(() => (window as any).__aetheriaPlaylists?.state() ?? null).catch(() => null);

test('v16.1 D-PL2: Clear by finger (the Library tools, unticked, after 600 ms) keeps the playlist, its tracks missing', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(({ keys }) => {
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      localStorage.setItem(keys.engine, 'classic');
      localStorage.setItem(keys.layout, 'new');
    } catch {
      // No storage here.
    }
  }, { keys: { engine: LAYER_ENGINE_KEY, layout: LAYOUT_KEY } });
  const ids = await seedToneLibrary(page, { n: 30, cursor: -1 });
  // Evening, seeded beside the library (a record as the app writes it).
  const e = (k: number) => ({ id: ids[k - 1], name: `tone-${String(k).padStart(2, '0')}`, file: `tone-${String(k).padStart(2, '0')}.wav`, size: 1 });
  const evening = { key: 'pl:pevening1', v: 1, id: 'pevening1', name: 'Evening', createdAt: 1, updatedAt: 1, entries: [e(2), e(5), e(8)] };
  await page.evaluate(async (evening) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction('playlist-state', 'readwrite');
    tx.objectStore('playlist-state').put(evening);
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  }, evening);
  /** On disk, read in the page (a raw IndexedDB open, no app code): whether the play state is there, how many tracks'
   *  audio, and every 'pl:' record of the playlist-state store. */
  const disk = () =>
    page
      .evaluate(async () => {
        const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        const req = <T,>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try {
          const tx = db.transaction(['blobs', 'playlist-state'], 'readonly');
          const st = tx.objectStore('playlist-state');
          const current = (await req(st.get('current'))) !== undefined;
          const blobs = await req(tx.objectStore('blobs').count());
          const pl = ((await req(st.getAll())) as { key: string }[]).filter((r) => typeof r.key === 'string' && r.key.startsWith('pl:'));
          return { current, blobs, pl };
        } finally {
          db.close();
        }
      })
      .catch(() => null);
  const before = await disk();
  expect([before?.current, before?.blobs, before?.pl], 'seeded: the play state, 30 tracks’ audio, Evening').toEqual([true, 30, [evening]]);
  await page.setViewportSize(PHONE_VIEWPORT);
  await page.goto('/');
  await acceptDisclaimerNew(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the seeded library restores', timeout: 60_000 }).toBe(30);
  await expect.poll(async () => (await playlistsState(page))?.status, { message: 'the playlists are read back', timeout: 20_000 }).toBe('ready');
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
  const toggle = page.getByTestId('library-health-toggle');
  if (await toggle.isVisible().catch(() => false)) await at(toggle, 'the health card');
  await expect(page.getByTestId('library-tools-clear')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('library-tools-clear'), 'Clear library…');
  const d = page.getByRole('alertdialog', { name: 'Clear your library?' });
  await expect(d).toBeVisible({ timeout: 5_000 });
  await expect(d.getByRole('checkbox', { name: 'Also delete my playlist' })).not.toBeChecked();
  await page.waitForTimeout(700); // past the 600 ms guard
  await at(d.getByTestId('clear-library-confirm'), 'Delete 30 tracks');
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 20_000, message: 'the library is cleared' }).toBe(0);
  // On disk: the Clear has committed (one transaction: the play state and the audio gone) and Evening's record is still
  // there, byte for byte, its three entries in order. Polled: the Clear's transaction commits after the tap's task.
  await expect
    .poll(disk, { timeout: 20_000, message: 'on disk: the Clear committed (no play state, no audio), Evening kept with its entries' })
    .toEqual({ current: false, blobs: 0, pl: [evening] });
  await expect.poll(async () => (await playlistsState(page))?.lists?.map((l: { name: string; present: number; missing: number }) => [l.name, l.present, l.missing]), { timeout: 10_000, message: 'Evening kept, its 3 tracks missing' }).toEqual([['Evening', 0, 3]]);
  await at(page.getByTestId('library-view-playlists'), 'Playlists');
  await expect(page.getByTestId('playlist-row').first().locator('[data-row-facts]')).toHaveText('3 tracks · 3 missing', { timeout: 5_000 });
});

test('v16.1: a saved playlist plays in its own order with the screen off: Play by finger, then the card follows three gapless advances through the playlist (not the library); after the wake the source line and the cursor @device', async ({ page }) => {
  // v16.1 (spec §5.10 step 5): a playlist is a play order, so the gapless swap and the media session follow it. 30
  // seeded tones of 4 s with crystals, the new layout on the phone; Evening (8 tracks, an order other than the
  // library's) made through the hook, then its ▶ by finger, and Now Playing. Turns the screen off; a phone with a secure
  // lock stays locked after the test (unlock it by hand). LAST of the v16.1 tests (its own unlock).
  // v16.1 re-review: the card is read from the moment it shows Evening's first track, before the taps that follow (a
  // 4 s track can advance during them), and again after each; every title it shows must be the playlist's next one.
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4 });
  await page.setViewportSize(PHONE_VIEWPORT);
  await expect.poll(async () => (await playlistsState(page))?.status, { message: 'the playlists are read back', timeout: 20_000 }).toBe('ready');
  const lib = await libraryState(page);
  const ks = [10, 3, 7, 1, 5, 12, 2, 9];
  const order = ks.map((k) => lib.libraryIds[k - 1]);
  const names = ks.map((k) => `tone-${String(k).padStart(4, '0')}`);
  const id = await page.evaluate((order) => {
    let out: string | null = null;
    const b = document.createElement('button');
    b.addEventListener('click', () => { out = (window as any).__aetheriaPlaylists.create('Evening', order); });
    document.body.appendChild(b);
    b.click();
    b.remove();
    return out;
  }, order);
  expect(id).toBeTruthy();
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('library-view-playlists'), 'Playlists');
  await expect(page.getByTestId('playlist-row').first()).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('playlist-row').first().getByTestId('playlist-row-play'), 'Play Evening');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0010 on the card' }).toEqual({ state: 'playing', title: names[0] });
  // Every title the PLAYING card shows, in order, from Evening's first (just read off the card): read now, before the
  // taps below, and after each of them, then every 500 ms with the screen off.
  const seen: string[] = [names[0]];
  const look = () => {
    const s = mediaSession();
    if (s && s.state === 'playing' && !seen.includes(s.title)) seen.push(s.title);
    return s;
  };
  await at(page.getByTestId('tab-now-button'), 'Now Playing');
  look();
  await expect(page.getByTestId('np-source')).toHaveText(/^Playlist · Evening · [1-3] of 8$/, { timeout: 5_000 });
  look();
  const pausesBefore = await pauseCount(page);
  look();
  const beforeSleep = seen.length;
  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  try {
    await expect
      .poll(
        () => {
          look();
          return seen.length - beforeSleep;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card with the screen off' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(look()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles, a playlist (| the screen off)', description: `${seen.slice(0, beforeSleep).join(' → ')} | ${seen.slice(beforeSleep).join(' → ')}` });
  // A window over the playlist's order: each title the card showed is the playlist's next track (never a library
  // neighbour, never a skip), however many advanced before the screen went off.
  expect(seen, 'the playlist’s own order, not the library’s, from its first track').toEqual(names.slice(0, seen.length));
  // After the wake, DOM and state reads only (no click or tap: Chrome draws no frames behind the keyguard).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  const s = await libraryState(page);
  expect(s.ids, 'the play order is the playlist').toEqual(order);
  // (4 s tones advance on their own: the line and the cursor are compared as one polled pair.)
  await expect
    .poll(async () => {
      const c = (await libraryState(page)).cursor;
      const line = await page.evaluate(() => document.querySelector('[data-testid="np-source"]')?.textContent ?? null);
      return c >= 3 && line === `Playlist · Evening · ${c + 1} of 8`;
    }, { message: 'the source line names the playlist and the cursor', timeout: 10_000 })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// v16.2, smart filters (spec §5.10). 528 Hz on tone-0004, -0011, -0014, -0024 and 639 Hz on tone-0008, -0018, -0021,
// -0028: eight tones, no two next to each other in the library (tone-0005/-0006 keep other crystals). Eight, not six
// (the v16.2 device fix): the screen-off test below needs two of them left after its third advance (see there).
// ---------------------------------------------------------------------------------------------------------------
const FILTER_PATCH = [
  { index: 4, crystal: 174 }, { index: 5, crystal: 285 },
  { index: 3, crystal: 528 }, { index: 10, crystal: 528 }, { index: 13, crystal: 528 }, { index: 23, crystal: 528 },
  { index: 7, crystal: 639 }, { index: 17, crystal: 639 }, { index: 20, crystal: 639 }, { index: 27, crystal: 639 },
];
const FILTER_SET = [3, 7, 10, 13, 17, 20, 23, 27];
const filterChip = (page: Page, value: string) => page.getByTestId('library-filters').locator(`button[data-facet="crystal"][data-value="${value}"]`);

/** By finger: Library › Filters › 528 Hz, 639 Hz › Show 8 tracks. */
async function filterByFinger(page: Page, at: (t: Locator, what: string) => Promise<void>): Promise<void> {
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('library-filters-button')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('library-filters-button'), 'Filters');
  await expect(page.getByTestId('library-filters-body')).toBeVisible({ timeout: 5_000 });
  await at(filterChip(page, '528'), '528 Hz');
  await expect(filterChip(page, '528')).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  await at(filterChip(page, '639'), '639 Hz');
  await expect(filterChip(page, '639')).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  await at(page.getByTestId('filters-show'), 'Show 8 tracks');
  await expect(page.getByTestId('library-filters-body')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId('library-filter-count')).toHaveText(/^8 of 30 tracks/, { timeout: 5_000 });
}

test('v16.2 D-F1: by finger, filter to 528 and 639 Hz, Play these, then ⋯ › Add to queue; a reload brings the chips and "8 of 30" back, and the play order and its 8 queued; the phone’s cost', async ({ page }) => {
  // Screen on (the android project). The cost lines are this phone's baseline, recorded with its battery temperature.
  test.setTimeout(180_000);
  const temp = Number(/temperature: (\d+)/.exec(adb('shell', 'dumpsys', 'battery'))?.[1] ?? NaN) / 10;
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 40, patch: FILTER_PATCH });
  await page.setViewportSize(PHONE_VIEWPORT);
  const lib = await libraryState(page);
  const setIds = FILTER_SET.map((k) => lib.libraryIds[k]);
  const { at } = await playlistPhone(page);
  // A chip tap's commit, the app's own work: from the click's dispatch (performance.now() in a capture listener on the
  // document, which runs before React's listener at the root) to the chip's aria-pressed change (a MutationObserver,
  // after React's commit). v16.2 device fix: not from the click's e.timeStamp. On the phone that stamp is the TOUCH
  // time (4-7 ms after touchstart), and Chrome dispatches the click about 290 ms after the touch (its gesture handling
  // under the tests' setViewportSize emulation; see tapAt), so it measured Chrome's tap delay: 328-347 ms a tap, where
  // the app's own work was 44 and 57 ms on the phone's dev build. touchstart → click is recorded beside it
  // (touchToClick, in the annotation only; not gated).
  await page.evaluate(() => {
    const w = window as any;
    const onChip = (e: Event) => !!(e.target as HTMLElement)?.closest?.('button[data-facet]');
    w.__touchAt = 0;
    w.__handlerAt = 0;
    w.__touchToClick = [] as number[];
    w.__commitMs = [] as number[];
    document.addEventListener('touchstart', (e) => { if (onChip(e)) w.__touchAt = performance.now(); }, { capture: true, passive: true });
    document.addEventListener('click', (e) => {
      if (!onChip(e)) return;
      w.__handlerAt = performance.now();
      if (w.__touchAt) { w.__touchToClick.push(w.__handlerAt - w.__touchAt); w.__touchAt = 0; }
    }, true);
    new MutationObserver((ms) => {
      for (const m of ms) if (m.attributeName === 'aria-pressed' && w.__handlerAt) { w.__commitMs.push(performance.now() - w.__handlerAt); w.__handlerAt = 0; }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    w.__longTasks = [] as number[];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  await filterByFinger(page, at);
  const { commits, touchToClick } = await page.evaluate(() => ({ commits: (window as any).__commitMs as number[], touchToClick: (window as any).__touchToClick as number[] }));
  await at(page.getByTestId('library-play-these'), 'Play these');
  await expect.poll(async () => (await libraryState(page)).ids, { timeout: 15_000, message: 'the eight, in the list’s order' }).toEqual(setIds);
  await at(page.getByTestId('library-filter-more'), '⋯');
  await expect(page.getByTestId('library-filter-actions-body')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('filter-action-queue'), 'Add to queue');
  await expect.poll(async () => (await page.evaluate(() => (window as any).__aetheriaQueue.state())).waiting.length, { timeout: 15_000, message: '8 queued' }).toBe(8);
  // Typing 5 keys with the filters on: no long task over 100 ms.
  await page.evaluate(() => { (window as any).__longTasks.length = 0; });
  const field = page.getByTestId('library-search');
  await field.evaluate((el) => (el as HTMLInputElement).focus());
  for (const ch of 'tone-') {
    await page.keyboard.type(ch);
    await page.waitForTimeout(400);
  }
  const typing: number[] = await page.evaluate(() => (window as any).__longTasks.slice());
  await page.waitForTimeout(2600); // the play order's debounced save
  await page.reload();
  await acceptDisclaimerNew(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(30);
  await expect.poll(async () => { const s = await libraryState(page); return s.ids.filter((id) => setIds.includes(id)).length >= 8; }, { timeout: 20_000, message: 'the play order is back' }).toBe(true);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('library-filter-count')).toHaveText(/^8 of 30 tracks/, { timeout: 10_000 });
  await expect(page.getByTestId('library-search')).toHaveValue('');
  expect(await page.getByTestId('library-active-chips').locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))).toEqual(['Remove 528 Hz', 'Remove 639 Hz']);
  const q = await page.evaluate(() => (window as any).__aetheriaQueue.state());
  const s = await libraryState(page);
  expect(s.ids.filter((_, i) => !q.waiting.includes(i)), 'the play order’s own entries: the eight, in order').toEqual(setIds);
  expect(q.waiting.length, 'eight queued').toBe(8);
  test.info().annotations.push({ type: 'D-F1 cost (the phone’s baseline)', description: JSON.stringify({ batteryC: temp, chipCommitMs: commits.map((c) => Math.round(c)), touchToClickMs: touchToClick.map((c) => Math.round(c)), typingLongTasksMs: typing }) });
  // The gate: the app's own work for a chip tap, at most 150 ms on the phone's dev build (about 3× the 44 and 57 ms
  // measured there; a production build is several times faster). Both taps measured, so it never passes empty.
  expect(commits, 'both chip taps measured (528 Hz, 639 Hz)').toHaveLength(2);
  expect(Math.max(...commits), 'a chip tap’s commit, click handler → aria-pressed (ms)').toBeLessThanOrEqual(150);
  expect(Math.max(0, ...typing), 'no long task over 100 ms while typing').toBeLessThanOrEqual(100);
  expect(dialogs).toEqual([]);
});

test('v16.2: a filtered set plays in its own order with the screen off: Play these by finger, then the card follows three gapless advances through the eight (never their library neighbours); after the wake the source line and the cursor @device', async ({ page }) => {
  // v16.2 (spec §5.10 step 4): a filtered set is a play order, so the gapless swap and the media session follow it. 30
  // seeded tones of 4 s with crystals; by finger, Library › Filters › 528 Hz, 639 Hz › Show 8 tracks › Play these, then
  // Now Playing. Turns the screen off; a phone with a secure lock stays locked after the test (unlock it by hand). LAST of
  // the v16.2 tests (its own unlock).
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4, patch: FILTER_PATCH });
  await page.setViewportSize(PHONE_VIEWPORT);
  const lib = await libraryState(page);
  const setIds = FILTER_SET.map((k) => lib.libraryIds[k]);
  const names = FILTER_SET.map((k) => `tone-${String(k + 1).padStart(4, '0')}`);
  const { at } = await playlistPhone(page);
  await filterByFinger(page, at);
  await at(page.getByTestId('library-play-these'), 'Play these');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: `${names[0]} on the card` }).toEqual({ state: 'playing', title: names[0] });
  await at(page.getByTestId('tab-now-button'), 'Now Playing');
  await expect(page.getByTestId('np-source')).toHaveText(/^Play order · [12] of 8$/, { timeout: 5_000 });
  const pausesBefore = await pauseCount(page);
  const first = mediaSession()!.title;
  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card, in the filtered order' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles with the screen off, a filtered set', description: [first, ...titles].join(' → ') });
  // v16.2 review: `first` is read a moment after the card showed names[0] (the Now Playing tap and its checks come
  // between), and with 4 s tones an advance can land in that moment. So the titles are a window of the filtered order
  // from wherever `first` sits in it (early enough for three more): each advance the next of the eight, never a library
  // neighbour, never a skip.
  // v16.2 device fix: and early enough that two of the set remain after the third advance. With six, `first` at 2 put
  // the third advance on the last track: the order ended one 4 s tone later, the silent anchor's pause() counted, and the
  // reads after the poll (up to 0.5 s of it, then three adb calls: 2-3.5 s on the Note 20) could outlast that tone,
  // failing "the gapless swap never pauses" with nothing wrong. `first` sits at 0-2 (the source line said 1 or 2 of 8,
  // and one more advance may land before it is read), so from any of those the eight leave two tones (8 s) after the
  // third advance.
  const from = names.indexOf(first);
  expect(from, `${first} is one of the eight, early enough for three advances and two tracks after them`).toBeGreaterThanOrEqual(0);
  expect(from, `${first} is one of the eight, early enough for three advances and two tracks after them`).toBeLessThanOrEqual(names.length - 6);
  expect([first, ...titles.slice(0, 3)], 'the filtered order, never a library neighbour').toEqual(names.slice(from, from + 4));
  // After the wake, DOM and state reads only (no click or tap: Chrome draws no frames behind the keyguard).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  expect((await libraryState(page)).ids, 'the play order is the eight').toEqual(setIds);
  await expect
    .poll(async () => {
      const c = (await libraryState(page)).cursor;
      const line = await page.evaluate(() => document.querySelector('[data-testid="np-source"]')?.textContent ?? null);
      return c >= 3 && line === `Play order · ${c + 1} of 8`;
    }, { message: 'the source line names the play order and the cursor', timeout: 10_000 })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// v16.3, Create a mix (spec §5.11 steps 3 and 4). By finger (tapAt, 400 ms apart), every outcome polled.
// ---------------------------------------------------------------------------------------------------------------
const B_TONE = (k: number) => `tone-${String(k + 1).padStart(4, '0')}`;

test('v16.3 D-B1: by finger, Create a mix › Start from Evening › a Lo Shu walk › Vortex › Play, then Grounding’s ⋯ › Add to queue; a reload brings the walk back with Grounding queued after it; the phone’s cost', async ({ page }) => {
  // Screen on (the android project). The cost lines are this phone's baseline, recorded with its battery temperature.
  test.setTimeout(180_000);
  const temp = Number(/temperature: (\d+)/.exec(adb('shell', 'dumpsys', 'battery'))?.[1] ?? NaN) / 10;
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 40, crystals: 'all' });
  await page.setViewportSize(PHONE_VIEWPORT);
  const lib = await libraryState(page);
  // Evening: the first 20 tones (crystals 174 … 3504 Hz, one each).
  await expect.poll(() => page.evaluate(() => (window as any).__aetheriaPlaylists?.state()?.status), { timeout: 10_000 }).toBe('ready');
  await page.evaluate((ids) => (window as any).__aetheriaPlaylists.create('Evening', ids), lib.libraryIds.slice(0, 20));
  const { at } = await playlistPhone(page);
  // v16.3 review (from v16.2's D-F1 on the phone): a click's timeStamp is the TOUCH time, and Chrome dispatches the click
  // ~290 ms after touchstart here (its gesture handling under setViewportSize's emulation), so the commit is measured
  // from the click's handler (this capture listener runs just before the app's), and touchstart → click is recorded on
  // its own (an annotation, not gated).
  await page.evaluate(() => {
    const w = window as any;
    w.__handlerAt = 0;
    w.__touchAt = 0;
    w.__commitMs = [] as number[];
    w.__touchToClickMs = [] as number[];
    const sel = '[data-testid^="builder-follow-"], [data-testid^="builder-walk-"]';
    document.addEventListener('touchstart', (e) => { if ((e.target as HTMLElement)?.closest?.(sel)) w.__touchAt = performance.now(); }, { capture: true, passive: true });
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement)?.closest?.(sel)) return;
      w.__handlerAt = performance.now();
      if (w.__touchAt) w.__touchToClickMs.push(w.__handlerAt - w.__touchAt);
      w.__touchAt = 0;
    }, true);
    new MutationObserver((ms) => {
      for (const m of ms) if (m.attributeName === 'aria-checked' && w.__handlerAt && (m.target as HTMLElement).getAttribute('aria-checked') === 'true') { w.__commitMs.push(performance.now() - w.__handlerAt); w.__handlerAt = 0; }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-checked'] });
    w.__longTasks = [] as number[];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  await at(page.getByTestId('tab-mixes-button'), 'the Mixes tab');
  await expect(page.getByTestId('mixes-create')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('mixes-create'), 'Create a mix');
  await expect(page.getByTestId('mix-builder')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('builder-source-playlist'), 'Start from › Playlist');
  await expect(page.getByTestId('builder-source-sheet')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('builder-source-sheet').getByText('Evening', { exact: true }), 'Evening');
  await expect(page.getByTestId('builder-source-playlist')).toHaveAttribute('aria-label', 'Evening, 20 tracks', { timeout: 5_000 });
  await at(page.getByTestId('builder-follow-walk'), 'A Lo Shu walk');
  await expect(page.getByTestId('builder-follow-walk')).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
  await at(page.getByTestId('builder-walk-C'), 'Vortex');
  await expect(page.getByTestId('builder-walk-C')).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
  await expect(page.getByTestId('builder-count')).toHaveText(/^20 of 27 positions/, { timeout: 5_000 });
  const commits: number[] = await page.evaluate(() => (window as any).__commitMs);
  const touchToClick: number[] = await page.evaluate(() => (window as any).__touchToClickMs);
  await at(page.getByTestId('builder-play'), 'Play');
  await expect.poll(async () => { const s = await libraryState(page); return s.walk === 'C' && s.ids.length === 20; }, { timeout: 15_000, message: 'Vortex from Evening plays as a walk' }).toBe(true);
  const walkIds = (await libraryState(page)).ids;
  await at(page.getByRole('button', { name: 'Back to Mixes', exact: true }), 'Back');
  await expect(page.getByTestId('mix-more-preset:qi')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('mix-more-preset:qi'), 'Grounding’s ⋯');
  await expect(page.getByTestId('mix-menu-body')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('mix-action-queue'), 'Add to queue');
  await expect.poll(async () => (await page.evaluate(() => (window as any).__aetheriaQueue.state())).waiting.length, { timeout: 15_000, message: 'Grounding queued: 7' }).toBe(7);
  const longTasks: number[] = await page.evaluate(() => (window as any).__longTasks.slice());
  await page.waitForTimeout(2600); // the play order's debounced save
  await page.reload();
  await acceptDisclaimerNew(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(30);
  await expect.poll(async () => (await libraryState(page)).walk, { timeout: 20_000, message: 'the walk is back' }).toBe('C');
  const s = await libraryState(page);
  const q = await page.evaluate(() => (window as any).__aetheriaQueue.state());
  expect(s.ids.filter((_, i) => !q.waiting.includes(i)), 'the walk’s own entries, in order').toEqual(walkIds);
  expect(q.waiting.length, 'Grounding’s 7 queued after it').toBe(7);
  expect(s.steps?.filter((x) => x === -1).length, 'its queued entries are step −1').toBe(7);
  test.info().annotations.push({ type: 'D-B1 cost (the phone’s baseline)', description: JSON.stringify({ batteryC: temp, followCommitMs: commits.map((c) => Math.round(c)), touchToClickMs: touchToClick.map((c) => Math.round(c)), longTasksMs: longTasks }) });
  // From the click's handler to the chosen tile's aria-checked: the app's own work, ≤ 150 ms on the phone's DEV build
  // (about 3× v16.2's 44-57 ms measured the same way; production is several times faster). Touch → click is not gated.
  expect(commits.length, 'each Follow and walk tap measured').toBeGreaterThanOrEqual(2);
  expect(Math.max(0, ...commits), 'a Follow tap’s commit, from its click handler (ms)').toBeLessThanOrEqual(150);
  // The session's longest task on the phone's DEV build: 94 ms (2026-10-29 morning), then 102 and 107 ms (always the
  // session's first); the per-tap commits stay at 24-35 ms. Production is several times faster, so 150 ms (the commit
  // gate) still catches a regression of the kind the review found (the walk memo, ~100 ms a tap at 5,000 tracks).
  expect(Math.max(0, ...longTasks), 'no long task over 150 ms in the session (the dev build)').toBeLessThanOrEqual(150);
  expect(dialogs).toEqual([]);
});

// v16.3 review: Grounding's four crystals three times each (tone-0001…0009, -0028…0030), so "3 per crystal" builds 12:
// room for a late first title, three advances and the checks after the wake before the order ends.
const BUILT_PATCH = [{ index: 4, crystal: 174 }, { index: 5, crystal: 285 }, { index: 6, crystal: 396 }, { index: 7, crystal: 417 }, { index: 8, crystal: 417 }];
const BUILT_SET = [0, 1, 2, 3, 4, 5, 6, 7, 8, 27, 28, 29];

test('v16.3: a built mix plays in its own order with the screen off: by finger, Create a mix › 3 per crystal › Shuffle › Play; the card follows three gapless advances in the built order (never a library neighbour); after the wake the source line and the cursor @device', async ({ page }) => {
  // v16.3 (spec §5.11 step 4): a built mix is a play order, so the gapless swap and the media session follow it. 30
  // seeded tones of 4 s with crystals. No real page hide is needed (the builder saves at the tap; the play order's save is
  // v16.0.1's). Turns the screen off; a phone with a secure lock stays locked after the test (unlock it by hand). LAST of
  // the v16.3 tests (its own unlock).
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4, crystals: 'all', patch: BUILT_PATCH });
  await page.setViewportSize(PHONE_VIEWPORT);
  const lib = await libraryState(page);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-mixes-button'), 'the Mixes tab');
  await expect(page.getByTestId('mixes-create')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('mixes-create'), 'Create a mix');
  await expect(page.getByTestId('builder-per-3')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('builder-per-3'), '3 per crystal');
  await expect(page.getByTestId('builder-per-3')).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
  await at(page.getByTestId('builder-order-list').getByText('Shuffle, least recently played first', { exact: true }), 'Shuffle');
  await expect(page.getByTestId('builder-order-shuffle-note')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('builder-play'), 'Play');
  // Grounding, 3 per crystal on these 30 (BUILT_PATCH): 174, 285, 396 and 417 three each = 12, shuffled.
  await expect.poll(async () => (await page.evaluate(() => (window as any).__aetheriaBuilder.state())).ids.length, { timeout: 15_000, message: 'the built mix plays' }).toBe(BUILT_SET.length);
  const built: string[] = (await page.evaluate(() => (window as any).__aetheriaBuilder.state())).ids;
  expect([...built].sort(), 'the built mix is Grounding’s twelve').toEqual(BUILT_SET.map((k) => lib.libraryIds[k]).sort());
  const names = built.map((id) => B_TONE(lib.libraryIds.indexOf(id)));
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: `${names[0]} on the card` }).toEqual({ state: 'playing', title: names[0] });
  await at(page.getByTestId('tab-now-button'), 'Now Playing');
  await expect(page.getByTestId('np-source')).toHaveText(new RegExp(`^Play order · [12] of ${built.length}$`), { timeout: 5_000 });
  const pausesBefore = await pauseCount(page);
  const first = mediaSession()!.title;
  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card, in the built order' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles with the screen off, a built mix', description: [first, ...titles].join(' → ') });
  // v16.3 review (as v16.2's fix): `first` is read a moment after the card showed names[0] (the Now Playing tap and its
  // checks come between), and with 4 s tones an advance can land in that moment. So the titles are a window of the built
  // order from wherever `first` sits in it: each advance the next of the twelve, never a library neighbour, never a skip.
  // And early enough that a track is still to come after the third advance: the order must not end before the checks
  // after the wake (its end pauses the silent anchor, which `__pauseCount` would count).
  // v16.3 re-review (as v16.2's device fix): TWO tracks after the third advance, not one: with one, the order can end one
  // 4 s tone after the third advance, and the poll's last 0.5 s, the three adb reads (2-3.5 s on the Note 20) and the wake
  // can outlast it. `first` sits at 0-2 (the source line said 1 or 2 of 12, and one more advance may land before it is
  // read); the bound allows up to 6, so the twelve leave room.
  const from = names.indexOf(first);
  expect(from, `${first} is one of the built mix, early enough for three advances and two tracks after them`).toBeGreaterThanOrEqual(0);
  expect(from, `${first} is one of the built mix, early enough for three advances and two tracks after them`).toBeLessThanOrEqual(names.length - 6);
  expect([first, ...titles.slice(0, 3)], 'the built order, never a library neighbour').toEqual(names.slice(from, from + 4));
  // After the wake, DOM and state reads only (no click or tap: Chrome draws no frames behind the keyguard).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  expect((await libraryState(page)).ids, 'the play order is the built mix').toEqual(built);
  await expect
    .poll(async () => {
      const c = (await libraryState(page)).cursor;
      const line = await page.evaluate(() => document.querySelector('[data-testid="np-source"]')?.textContent ?? null);
      return c >= 3 && line === `Play order · ${c + 1} of ${built.length}`;
    }, { message: 'the source line names the play order and the cursor', timeout: 10_000 })
    .toBe(true);
  expect(dialogs).toEqual([]);
});

/**
 * v16.4 (spec §5.11 step 4): Keep screen awake as Android itself lists it, screen on (the android project). While music
 * plays with the switch on, `dumpsys power` lists a screen wake lock of Chrome's (its uid); with it off, none of Chrome's.
 * The switch by finger in Safety & comfort. If Android lists no Chrome screen lock even with the switch on, the page-side
 * checks stand (safety-about.spec S3, and S3b–S3f for the races) and this test says so in its annotations rather than
 * failing.
 * v16.4 review: the page side is checked here too, on the phone's real wake lock: a pass-through spy on
 * navigator.wakeLock.request keeps the sentinels Chrome returns, so the test reads how many the page holds (released
 * is Chrome's own flag): at most one ever, none once off. Its output says plainly which sides it could check.
 * v16.4 re-review: the "on" side can fail. With the switch on while music plays the page must have asked Chrome for a
 * lock, and must hold Chrome's one lock unless Chrome refused it or had not answered yet (a lock taken and let go while
 * music plays fails). Each [wake lock] line is printed only once the assertions it describes have passed (a FAILED line
 * otherwise, then the failure).
 */
function chromeScreenLocks(): string[] {
  const uid = /userId=(\d+)/.exec(adb('shell', 'dumpsys', 'package', 'com.android.chrome'))?.[1] ?? '';
  const power = adb('shell', 'dumpsys', 'power');
  const section = power.slice(power.indexOf('Wake Locks:'), power.indexOf('Suspend Blockers:') > 0 ? power.indexOf('Suspend Blockers:') : undefined);
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /SCREEN_(BRIGHT|DIM)_WAKE_LOCK|FULL_WAKE_LOCK/.test(l) && ((uid && new RegExp(`uid=${uid}\\b`).test(l)) || /chrome/i.test(l)));
}

test('v16.4: Keep screen awake, by finger in Safety & comfort: on, Android lists a Chrome screen wake lock while music plays; off, none of Chrome’s', async ({ page }) => {
  test.setTimeout(180_000);
  // The page side: a pass-through spy (the real request; the sentinels it returns are kept to read their released flag).
  await page.addInitScript(() => {
    const w = window as any;
    w.__wlReal = { supported: false, requests: 0, settled: 0, errors: [] as string[], sentinels: [] as any[] };
    try {
      const lock = (navigator as any).wakeLock;
      if (!lock || typeof lock.request !== 'function') return;
      const request = lock.request.bind(lock);
      w.__wlReal.supported = true;
      lock.request = async (type: string) => {
        w.__wlReal.requests++;
        try {
          const sentinel = await request(type);
          w.__wlReal.settled++;
          w.__wlReal.sentinels.push(sentinel);
          return sentinel;
        } catch (e) {
          w.__wlReal.settled++;
          w.__wlReal.errors.push(String((e as Error)?.name ?? e));
          throw e;
        }
      };
    } catch {}
  });
  const pageLocks = () =>
    page.evaluate(() => {
      const r = (window as any).__wlReal;
      return { supported: !!r?.supported, requests: r?.requests ?? 0, settled: r?.settled ?? 0, held: (r?.sentinels ?? []).filter((x: any) => !x.released).length, errors: [...(r?.errors ?? [])] as string[] };
    });
  // Each line is printed once the assertions it describes have passed; a FAILED line otherwise, then the failure.
  const lines: string[] = [];
  const report = (side: string, assertions: () => void, line: () => string): void => {
    try {
      assertions();
    } catch (e) {
      console.log(`[wake lock] ${side}: FAILED (${String((e as Error)?.message ?? e).split(/\r?\n/)[0]})`);
      throw e;
    }
    lines.push(`${side}: ${line()}`);
    console.log(`[wake lock] ${lines[lines.length - 1]}`);
  };
  const dialogs = await openSeededNewLayout(page, 6, { real: 6, seconds: 40 });
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  await expect.poll(async () => (await libraryState(page)).playing, { timeout: 15_000, message: 'tone-0001 plays' }).toBe(true);
  await page.waitForTimeout(2000);
  const on = chromeScreenLocks();
  const pageOn = await pageLocks();
  test.info().annotations.push({ type: 'Chrome screen locks, Keep screen awake on', description: on.join(' | ') || '(none)' });
  test.info().annotations.push({ type: 'the page, Keep screen awake on', description: JSON.stringify(pageOn) });
  report(
    'page side, switch on',
    () => {
      expect(pageOn.supported, 'this Chrome has navigator.wakeLock (the spy wraps its request)').toBe(true);
      expect(pageOn.requests, 'on, music playing: the page asked Chrome for a lock').toBeGreaterThan(0);
      expect(pageOn.held, 'on: the page holds at most one lock').toBeLessThanOrEqual(1);
      if (pageOn.held === 0) {
        const answering = pageOn.requests > pageOn.settled;
        expect(pageOn.errors.length > 0 || answering, 'on: the page holds no lock, yet Chrome neither refused one nor is still answering (a lock let go while music plays)').toBe(true);
      }
    },
    () =>
      pageOn.held === 1
        ? `CHECKED (it asked, ${pageOn.requests} request(s), and holds Chrome’s one lock)`
        : pageOn.errors.length
          ? `PARTLY CHECKED (it asked; Chrome refused: ${pageOn.errors.join(', ')})`
          : 'PARTLY CHECKED (it asked; Chrome had not answered 2 s on)'
  );
  await at(page.getByTestId('tab-more-button'), 'More');
  await expect(page.getByTestId('more')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('more-safety-row'), 'Safety & comfort');
  const sw = page.getByTestId('safety-keep-awake').getByRole('switch');
  await expect(sw).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
  await at(sw, 'Keep screen awake');
  await expect(sw).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aetheria.keepAwake.v1')), { timeout: 5_000 }).toBe('false');
  await page.waitForTimeout(2000);
  const off = chromeScreenLocks();
  const pageOff = await pageLocks();
  test.info().annotations.push({ type: 'Chrome screen locks, Keep screen awake off', description: off.join(' | ') || '(none)' });
  test.info().annotations.push({ type: 'the page, Keep screen awake off', description: JSON.stringify(pageOff) });
  report(
    'page side, switch off',
    () => expect(pageOff.held, 'off: the page holds none').toBe(0),
    () => 'CHECKED (it holds none)'
  );
  // Which Android side this run could check, said plainly (the list reporter prints it).
  report(
    'Android side',
    () => expect(off, 'off: Android lists no screen wake lock of Chrome’s').toEqual([]),
    () => (on.length > 0 ? 'CHECKED (Android listed Chrome’s screen lock with the switch on, and none with it off)' : 'NOT CHECKED (Android listed no Chrome screen lock with the switch on; none with it off)')
  );
  test.info().annotations.push({ type: 'checked', description: lines.join('; ') });
  if (on.length === 0) test.info().annotations.push({ type: 'inconclusive', description: 'Android listed no Chrome screen lock with the switch on either: the page-side checks stand (this test\'s, and S3, S3b–S3f)' });
  // Back on, for the user's own use of this profile.
  await at(sw, 'Keep screen awake');
  await expect(sw).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
  expect(dialogs).toEqual([]);
});

/**
 * v16.4 (spec §5.11 step 5): the comfort settings with the screen off. 30 seeded tones of 4 s, the new layout; Keep
 * screen awake off and Pause visuals on, by finger in Safety & comfort; tone-0001 from the Library by finger; the screen
 * off: the card follows three gapless advances, no pause, one PLAYING card. After the wake, DOM reads only: both keys
 * still set and the canvas display:none. Turns the screen off; a phone with a secure lock stays locked after the test
 * (unlock it by hand). LAST of the v16.4 tests (its own unlock).
 */
test('v16.4: Keep screen awake off and Pause visuals on, set by finger: with the screen off the card follows three gapless advances; after the wake both are still set and the canvas still hidden @device', async ({ page }) => {
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4 });
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-more-button'), 'More');
  await expect(page.getByTestId('more')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('more-safety-row'), 'Safety & comfort');
  const awake = page.getByTestId('safety-keep-awake').getByRole('switch');
  const pause = page.getByTestId('safety-pause-visuals').getByRole('switch');
  await expect(awake).toBeVisible({ timeout: 5_000 });
  await at(awake, 'Keep screen awake');
  await expect(awake).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 });
  await at(pause, 'Pause visuals');
  await expect(pause).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await at(page.getByTestId('tab-now-button'), 'Now Playing');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('viz-canvas')!).display), { timeout: 5_000, message: 'the visuals are paused on Now Playing' }).toBe('none');
  const pausesBefore = await pauseCount(page);
  const first = mediaSession()!.title;
  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances on the PLAYING card' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card: none stranded').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  test.info().annotations.push({ type: 'card titles with the screen off, Keep screen awake off, Pause visuals on', description: [first, ...titles].join(' → ') });
  // After the wake, DOM and state reads only (no click or tap: Chrome draws no frames behind the keyguard).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  const after = await page.evaluate(() => ({
    awake: localStorage.getItem('aetheria.keepAwake.v1'),
    paused: localStorage.getItem('aetheria.visualsPaused.v1'),
    canvas: getComputedStyle(document.getElementById('viz-canvas')!).display,
  }));
  expect(after, 'both settings kept, the visuals still paused').toEqual({ awake: 'false', paused: 'true', canvas: 'none' });
  expect(dialogs).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// v16.5: Record, the Guide and Export with layers (the v16.4 spec §5.11 v16.5; the export addendum §5.6). By finger
// (tapAt, spaced), every outcome polled. NO file is saved on the phone: the app's <a download> click is caught in the
// test tab (its bytes read in the page), and the export's own measurements use the dev hook, which keeps the file in
// memory. Screen on, except the two screen-off tests at the end of this block (each its own unlock; LOCKS the phone).
// While Playwright is connected the tab stays "visible" with the screen off: device-hide.spec's v16.5 D-R2 repeats the
// recording with a REAL hide (E2E_HIDE=1).
// ---------------------------------------------------------------------------------------------------------------

/**
 * The phone's Chrome renderers in the meminfo figure the export's phone model is measured in (exportPlan PHONE_BUDGET_MB's
 * note): every renderer line of `dumpsys meminfo`, in all four of its listings (RSS and PSS, each by process and by OOM
 * adjustment), so 4.0 × the renderers' PSS (the Note 20: 128 MB held in a tab read 549). A quarter of it is MB.
 */
function chromeRendererMeminfoMB(): number {
  let kb = 0;
  for (const line of adb('shell', 'dumpsys', 'meminfo').split('\n')) {
    const m = /^\s*([\d,]+)K: com\.android\.chrome:sandboxed_process/.exec(line);
    if (m) kb += Number(m[1].replace(/,/g, ''));
  }
  return kb / 1024;
}
const batteryC = (): number => Number(/temperature: (\d+)/.exec(adb('shell', 'dumpsys', 'battery'))?.[1] ?? NaN) / 10;

/**
 * The long synthetic masters for the export measurements (a sine plus pink noise, made here by ffmpeg into
 * test-results/export-media, never committed), at the measured phone caps (exportPlan DECODE_MB_PER_MIN): tone-0091.mp3
 * (3 min, 44.1 kHz), tone-0092.mp3 (10 min, 48 kHz 320k: the heaviest decode of the MP3 group, at its cap), tone-0093.m4a
 * (8 min, AAC 256k, at its cap). With no ffmpeg on PATH the test says so and skips. v16.5 final fixes (the Note 20's D-E1:
 * 1,136 MB at the 10-minute cap): the caps with the export's own peak (exportPlan exportPeakMB): tone-0096.mp3 (5 min,
 * 48 kHz 320k: the MP3 group's heaviest at the new phone cap) and tone-0097.m4a (3 min, AAC 256k, at its new cap), new
 * names so a cached 10-minute file is never taken for them. v16.5 export memory (the caps per tier under the
 * envelope): tone-0098.mp3 (3 min, 48 kHz 320k: the ≤ 4 GB cap's heaviest), tone-0099.mp3 (1 min, 48 kHz 320k: the
 * ≤ 2 GB cap's), tone-0088.m4a (2 min AAC: ≤ 4 GB's) and tone-0089.m4a (1 min AAC: ≤ 2 GB's). The user's 1,200 MB budget
 * over 4 GB (2026-10-30): tone-0092.mp3 (10 min, 48 kHz) is at that tier's cap again, and tone-0087.m4a (5 min AAC) at its AAC cap.
 * The phone gate's 1,500 (the same day): tone-0092.mp3 at the 10-minute cap still; AAC's cap is 6 minutes, tone-0087.m4a under it.
 */
const EXPORT_MEDIA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/export-media');
const MASTERS: Record<string, { seconds: number; codec: string[]; input?: string[] }> = {
  'tone-0091.mp3': { seconds: 180, codec: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  'tone-0092.mp3': { seconds: 600, codec: ['-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '320k'] },
  'tone-0093.m4a': { seconds: 480, codec: ['-c:a', 'aac', '-b:a', '256k'] },
  'tone-0096.mp3': { seconds: 300, codec: ['-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '320k'] },
  'tone-0097.m4a': { seconds: 180, codec: ['-c:a', 'aac', '-b:a', '256k'] },
  'tone-0098.mp3': { seconds: 180, codec: ['-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '320k'] },
  'tone-0099.mp3': { seconds: 60, codec: ['-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '320k'] },
  'tone-0088.m4a': { seconds: 120, codec: ['-c:a', 'aac', '-b:a', '256k'] },
  'tone-0089.m4a': { seconds: 60, codec: ['-c:a', 'aac', '-b:a', '256k'] },
  'tone-0087.m4a': { seconds: 300, codec: ['-c:a', 'aac', '-b:a', '256k'] },
  // v16.5 re-review (B1): 25 minutes of VBR without a Xing header (20 s of loud noise, then a quiet tone: Chrome guesses
  // about 5 minutes), and 25 minutes at 320 kbps CBR without one (60 MB: the frame scan over tens of MB).
  'tone-0094.mp3': { seconds: 1500, codec: ['-c:a', 'libmp3lame', '-q:a', '0', '-write_xing', '0'], input: ['-f', 'lavfi', '-i', 'anoisesrc=d=20:c=pink:a=0.5:r=44100', '-f', 'lavfi', '-i', 'sine=f=220:d=1480:r=44100,volume=0.01', '-filter_complex', '[0][1]concat=n=2:v=0:a=1,aformat=channel_layouts=stereo'] },
  'tone-0095.mp3': { seconds: 1500, codec: ['-c:a', 'libmp3lame', '-b:a', '320k', '-write_xing', '0'], input: ['-f', 'lavfi', '-i', 'anoisesrc=d=1500:c=pink:a=0.3:r=44100', '-ac', '2'] },
};
function makeMasters(files: string[]): boolean {
  fs.mkdirSync(EXPORT_MEDIA, { recursive: true });
  for (const f of new Set(files)) {
    const out = path.join(EXPORT_MEDIA, f);
    if (fs.existsSync(out)) continue;
    const m = MASTERS[f];
    const input = m.input ?? ['-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=44100:duration=${m.seconds}`, '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.08:sample_rate=44100:duration=${m.seconds}`, '-filter_complex', '[0][1]amix=inputs=2,aformat=channel_layouts=stereo'];
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, ...m.codec, out], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

/**
 * The masters added to the seeded library (the app closed: from /manifest.json, as seedLibraryRecords writes), at the
 * end of the library's order, each with a crystal, named tone-0101, tone-0102, … in order (a file may repeat); with
 * `playlist`, also a saved playlist of them (v16.1's record). Then the app again. Returns their ids.
 */
async function addMasters(page: Page, files: string[], playlist?: { id: string; name: string }): Promise<string[]> {
  test.skip(!makeMasters(files), 'ffmpeg is needed on PATH to make the synthetic export masters');
  await page.route('**/__export-media/*', (route) => route.fulfill({ path: path.join(EXPORT_MEDIA, path.basename(new URL(route.request().url()).pathname)) }));
  await page.goto('/manifest.json');
  const ids = await page.evaluate(async ({ files, playlist }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const out: string[] = [];
    const tx0 = db.transaction('playlist-state', 'readonly');
    const state: any = await new Promise((resolve) => { const r = tx0.objectStore('playlist-state').get('current'); r.onsuccess = () => resolve(r.result); });
    const blobs: Record<string, Blob> = {};
    for (const [k, f] of files.entries()) {
      const blob = (blobs[f] ??= await (await fetch('/__export-media/' + f)).blob());
      const type = f.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg';
      const secs = await new Promise<number>((res) => { const a = new Audio(URL.createObjectURL(blob)); a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(0); });
      const id = `${Date.now()}-m${k}-${f.replace(/\W/g, '')}`;
      const tx = db.transaction(['blobs', 'meta'], 'readwrite');
      tx.objectStore('blobs').put({ id, fileBlob: new Blob([blob], { type }), fileName: f, fileType: type });
      tx.objectStore('meta').put({ id, name: `tone-${String(101 + k).padStart(4, '0')}`, duration: secs, harmonicFreq: 528, closestSolfeggio: 528, harmonicDeviation: 3 });
      await new Promise((r) => (tx.oncomplete = r));
      out.push(id);
    }
    const tx = db.transaction('playlist-state', 'readwrite');
    tx.objectStore('playlist-state').put({ ...state, playlistOrder: [...state.playlistOrder, ...out], originalOrder: [...state.originalOrder, ...out], savedAt: Date.now() });
    if (playlist) {
      const entries = out.map((id, k) => ({ id, name: `tone-${String(101 + k).padStart(4, '0')}`, file: files[k], size: blobs[files[k]].size }));
      tx.objectStore('playlist-state').put({ key: `pl:${playlist.id}`, v: 1, id: playlist.id, name: playlist.name, createdAt: Date.now(), updatedAt: Date.now(), entries });
    }
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
    return out;
  }, { files, playlist: playlist ?? null });
  await page.goto('/');
  await acceptDisclaimerNew(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.filter((x) => ids.includes(x)).length, { timeout: 60_000, message: 'the masters restore' }).toBe(ids.length);
  return ids;
}

test('v16.5 D-R1: by finger, More › Record › Audio Only; the mini-player’s REC on Library opens Record; Stop and save after one gapless advance: the file has the music after the advance (decision 3 A)', async ({ page }) => {
  test.setTimeout(180_000);
  await stubDownloads(page);
  await page.addInitScript(() => localStorage.setItem('aetheria.musicOnly.v1', 'true'));
  const dialogs = await openSeededNewLayout(page, 6, { real: 6, seconds: 12 });
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await at(page.getByTestId('tab-more-button'), 'More');
  await expect(page.getByTestId('more')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('more-record-row'), 'Record');
  await expect(page.getByTestId('record-option-audio')).toBeEnabled({ timeout: 5_000 });
  await at(page.getByTestId('record-option-audio'), 'Audio Only');
  await expect(page.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
  const wall0 = Date.now();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('record-recording')).toBeHidden({ timeout: 5_000 });
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('mini-player').getByTestId('rec-open')).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => mediaSession()?.title, { timeout: 30_000, message: 'one gapless advance' }).toBe('tone-0002');
  await page.waitForTimeout(4000);
  await at(page.getByTestId('mini-player').getByTestId('rec-open'), 'REC');
  await expect(page.getByTestId('record-stop-save')).toBeVisible({ timeout: 5_000 });
  await at(page.getByTestId('record-stop-save'), 'Stop and save');
  const [file] = await caughtDownloads(page, 1, 30_000);
  const w = await wavInfo(page, 0, { win: 10, head: 2, tail: 2 });
  const wallS = (Date.now() - wall0) / 1000;
  test.info().annotations.push({ type: 'v16.5 D-R1 the recording', description: JSON.stringify({ name: file.name, size: file.size, rate: w.rate, bits: w.bits, seconds: w.seconds, head: w.headRms, tail: w.tailRms, wallS }) });
  expect(file.name).toMatch(/^aetheria-rec-audio-\d+Hz-24bit-\d+\.wav$/);
  expect(Math.abs(w.seconds - wallS), 'its length is the time it recorded').toBeLessThan(5);
  expect(w.headRms, 'the first track').toBeGreaterThan(0.05);
  expect(w.tailRms, 'the music after the advance').toBeGreaterThan(0.05);
  expect(dialogs).toEqual([]);
});

test('v16.5 D-G1: the Guide by finger: a link goes to window.open (stubbed: nothing opens) and the page stays; a Lo Shu cube cell in Technical plays its crystal', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    const w = window as any;
    w.__opened = [];
    window.open = ((...a: unknown[]) => { w.__opened.push(String(a[0])); return null; }) as typeof window.open;
  });
  const dialogs = await openSeededNewLayout(page, 27, { real: 3, seconds: 40 });
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await at(page.getByTestId('tab-more-button'), 'More');
  await at(page.getByTestId('more-guide-row'), 'Guide');
  await expect(page.getByTestId('more-guide')).toBeVisible({ timeout: 5_000 });
  const url = page.url();
  await at(page.getByTestId('guide-content').locator('a[href*="harvard"]').first(), 'the Harvard link');
  await expect.poll(() => page.evaluate(() => (window as any).__opened.length), { timeout: 5_000, message: 'the link went to window.open' }).toBe(1);
  expect(page.url(), 'the app stays').toBe(url);
  await at(page.getByTestId('guide-view-technical'), 'Technical');
  await expect(page.getByTestId('more-guide')).toHaveAttribute('data-guide-view', 'technical', { timeout: 5_000 });
  const cell = page.getByTestId('guide-content').locator('[title^="Play 528 Hz"]').first();
  await at(cell, 'the 528 Hz cell');
  await expect(page.getByTestId('mini-player'), 'the crystal plays').toContainText('528 Hz', { timeout: 5_000 });
  expect(mediaSession()?.state, 'the music plays on').toBe('playing');
  expect(dialogs).toEqual([]);
});

test('v16.5 D-E1: Export with layers on the phone (the dev hook, nothing saved) while the library plays on Now Playing with the visuals: each tier’s cap files (export memory: 48 kHz MP3s of 1, 3, 5 and 10 minutes, M4As of 1, 2, 3 and 5; a 3-minute 44.1 kHz MP3) at 24-bit 48 kHz: the time, the renderers’ peak (the meminfo figure) against each tier’s budget whose cap takes the file, the HUD, no pause, the step log, the battery', async ({ page }) => {
  test.setTimeout(1_800_000);
  await recordHudDraws(page);
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 40 });
  const files = ['tone-0091.mp3', 'tone-0099.mp3', 'tone-0098.mp3', 'tone-0096.mp3', 'tone-0092.mp3', 'tone-0089.m4a', 'tone-0088.m4a', 'tone-0097.m4a', 'tone-0087.m4a'];
  const ids = await addMasters(page, files);
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await at(page.getByTestId('tab-now-button'), 'Now Playing');
  await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.render === 'function', null, { timeout: 30_000 });
  const c0 = batteryC();
  for (const [k, id] of ids.entries()) {
    const pauses = await pauseCount(page);
    const base = chromeRendererMeminfoMB();
    let peak = base;
    let on = true;
    const sampler = (async () => {
      while (on) {
        peak = Math.max(peak, chromeRendererMeminfoMB());
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    const hud0 = await page.evaluate(() => performance.now());
    const r = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), id);
    on = false;
    await sampler;
    const draws: number[] = await page.evaluate((t0) => ((window as any).__hud as any[]).filter((h) => h.at > t0).map((h) => h.draws), hud0);
    const sorted = draws.slice().sort((a, b) => a - b);
    const row = {
      file: files[k],
      outcome: r.outcome,
      reason: r.reason ?? null,
      s: Math.round(r.ms.total / 100) / 10,
      ms: r.ms,
      peakOverBaseMB: Math.round(peak - base),
      hudMedian: sorted[Math.floor(sorted.length / 2)] ?? null,
      hudMin: sorted[0] ?? null,
      steps: r.steps.map((x: any) => `${x.step}@${Math.round(x.at)}ms left ${x.leftS === null ? '-' : Math.round(x.leftS)}s`),
      longTasks: r.longTasks.length,
      longestTask: Math.max(0, ...r.longTasks),
      file0: r.files[0] ? { bytes: r.files[0].bytes, outSeconds: r.files[0].outSeconds, catchFraction: r.files[0].catchFraction } : null,
    };
    test.info().annotations.push({ type: 'v16.5 D-E1 export', description: JSON.stringify(row) });
    expect(r.outcome, `${files[k]}: done`).toBe('done');
    expect(await pauseCount(page), 'no fallback pause').toBe(pauses);
    for (const st of r.steps) if (st.leftS !== null) expect(st.leftS, `${st.step} started away from the playing track’s last 20 s`).toBeGreaterThan(20);
    expect(row.hudMedian ?? 0, 'the visuals keep drawing').toBeGreaterThanOrEqual(25);
    // v16.5 export memory: per tier (> 4 GB, ≤ 4 GB, ≤ 2 GB: exportPlan's budgets and caps, from the app itself), the
    // measured peak against the budget of every tier whose cap takes this file (the Note 20 stands in for the smaller
    // phones: the same Chrome, the same work); and against the model's own prediction (the envelope), softly.
    const tiers = await page.evaluate(async ({ name, seconds }) => {
      const url = '/utils/export/exportPlan.ts';
      const p = await import(url);
      const kind = p.fileKind({ name });
      return { model: p.exportPeakMB(kind, seconds, true), rows: [8, 4, 2].map((dm) => ({ dm, budget: p.decodeBudgetMB(true, dm), cap: p.exportCapSeconds(kind, true, dm) })) };
    }, { name: files[k], seconds: MASTERS[files[k]].seconds });
    const perTier = tiers.rows.map((t: any) => ({ ...t, within: MASTERS[files[k]].seconds <= t.cap + 1, overBudgetMB: Math.round(row.peakOverBaseMB - t.budget) }));
    test.info().annotations.push({ type: 'v16.5 D-E1 per tier', description: JSON.stringify({ file: files[k], peak: row.peakOverBaseMB, model: Math.round(tiers.model), perTier }) });
    for (const t of perTier) if (t.within) expect(row.peakOverBaseMB, `${files[k]}: within the ${t.dm} GB tier's cap (${t.cap / 60} min), so within its ${t.budget} MB budget`).toBeLessThanOrEqual(t.budget);
    // The 5-minute 48 kHz reading against the ≤ 4 GB budget too: over it, the ≤ 4 GB cap must leave the file out.
    if (files[k] === 'tone-0096.mp3') {
      const t4 = perTier.find((t: any) => t.dm === 4)!;
      expect(row.peakOverBaseMB <= t4.budget || !t4.within, `the 5-minute 48 kHz file (${row.peakOverBaseMB} MB) against the ≤ 4 GB budget (${t4.budget}): within it, or outside that tier's cap (${t4.cap / 60} min)`).toBe(true);
    }
    expect.soft(row.peakOverBaseMB, `${files[k]}: the model's ${Math.round(tiers.model)} MB covers the phone's peak`).toBeLessThanOrEqual(tiers.model);
  }
  test.info().annotations.push({ type: 'v16.5 D-E1 battery °C before / after', description: `${c0} / ${batteryC()}` });
  expect(mediaSession()?.state, 'the music played on').toBe('playing');
  expect(dialogs).toEqual([]);
});

test('v16.5 D-E3: the live audio is untouched by an export: a recording of the live layers alone (a silent track with a crystal, Track shape off) stays steady and click-free while the 5-minute export runs', async ({ page }) => {
  test.setTimeout(900_000);
  await stubDownloads(page);
  const dialogs = await openSeededNewLayout(page, 2, { real: 1, seconds: 600, patch: [{ index: 0, amp: 0, crystal: 528 }] });
  const [id] = await addMasters(page, ['tone-0096.mp3']);
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  // Track shape off: the layers hold one level (φ timing would move it over the track).
  await at(page.getByTestId('tab-layers-button'), 'Layers');
  const shape = page.getByTestId('layers-advanced').getByRole('switch', { name: 'Track shape' });
  await expect(shape).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
  await at(shape, 'Track shape');
  await expect(shape).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 });
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001 (silent, 528 Hz)');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await page.waitForTimeout(6000); // the layers' fade-in
  await at(page.getByTestId('tab-more-button'), 'More');
  await at(page.getByTestId('more-record-row'), 'Record');
  await expect(page.getByTestId('record-option-audio')).toBeEnabled({ timeout: 5_000 });
  await at(page.getByTestId('record-option-audio'), 'Audio Only');
  await expect(page.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
  const rec0 = Date.now();
  await page.waitForTimeout(10_000);
  await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.render === 'function', null, { timeout: 30_000 });
  const pauses = await pauseCount(page);
  const e0 = (Date.now() - rec0) / 1000;
  const r = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), id);
  const e1 = (Date.now() - rec0) / 1000;
  await page.waitForTimeout(10_000);
  await at(page.getByTestId('record-stop-save'), 'Stop and save');
  await caughtDownloads(page, 1, 60_000);
  const a = await page.evaluate(({ e0, e1 }) => {
    const d = (window as any).__downloads[0];
    const v = new DataView(d.buf);
    let off = 12, rate = 48000, ch = 2, bits = 24, at = 44, size = 0;
    while (off + 8 <= v.byteLength) {
      const tid = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
      const sz = v.getUint32(off + 4, true);
      if (tid === 'fmt ') { ch = v.getUint16(off + 10, true); rate = v.getUint32(off + 12, true); bits = v.getUint16(off + 22, true); }
      if (tid === 'data') { at = off + 8; size = Math.min(sz, v.byteLength - at); break; }
      off += 8 + sz + (sz & 1);
    }
    const B = bits / 8, fb = B * ch, frames = Math.floor(size / fb);
    const s = (k: number, c: number) => { const p = at + k * fb + c * B; if (B === 2) return v.getInt16(p, true) / 32768; let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16); if (x & 0x800000) x -= 0x1000000; return x / 8388608; };
    const W = Math.round(rate / 2);
    const wins: { t: number; db: number; d2: number }[] = [];
    for (let f = 0; f + W <= frames; f += W) {
      let e = 0, d2 = 0;
      for (let k = f; k < f + W; k++) {
        for (let c = 0; c < ch; c++) {
          const x = s(k, c);
          e += x * x;
          if (k > 0 && k + 1 < frames) d2 = Math.max(d2, Math.abs(s(k + 1, c) - 2 * x + s(k - 1, c)));
        }
      }
      wins.push({ t: f / rate, db: 10 * Math.log10(e / (W * ch) + 1e-20), d2 });
    }
    const inside = wins.filter((w) => w.t >= e0 && w.t + 0.5 <= e1);
    const outside = wins.filter((w) => (w.t + 0.5 < e0 || w.t > e1) && w.t >= 1 && w.t + 1.5 <= frames / rate);
    const med = (xs: number[]) => { const q = xs.slice().sort((p, q2) => p - q2); return q[Math.floor(q.length / 2)] ?? NaN; };
    const ref = med(outside.map((w) => w.db));
    return {
      seconds: frames / rate,
      rate,
      outsideN: outside.length,
      insideN: inside.length,
      refDb: ref,
      insideDbMin: Math.min(...inside.map((w) => w.db)) - ref,
      insideDbMax: Math.max(...inside.map((w) => w.db)) - ref,
      d2Inside: Math.max(...inside.map((w) => w.d2)),
      d2Outside: Math.max(...outside.map((w) => w.d2)),
    };
  }, { e0, e1 });
  test.info().annotations.push({ type: 'v16.5 D-E3 the live layers during the export', description: JSON.stringify({ exportS: r.ms.total / 1000, outcome: r.outcome, e0, e1, ...a }) });
  expect(r.outcome).toBe('done');
  expect(await pauseCount(page), 'nothing paused').toBe(pauses);
  expect(a.insideN, 'the recording covers the export').toBeGreaterThan(4);
  expect(a.refDb, 'the live layers are in the recording').toBeGreaterThan(-60);
  expect(a.insideDbMin, 'no dropout while exporting (−0.5 dB)').toBeGreaterThanOrEqual(-0.5);
  expect(a.insideDbMax, 'no jump while exporting (+0.5 dB)').toBeLessThanOrEqual(0.5);
  expect(a.d2Inside, 'click-free while exporting (2nd difference)').toBeLessThanOrEqual(1.02 * a.d2Outside);
  expect(dialogs).toEqual([]);
});

/** Chrome's browser process RSS (MB) on the phone, `dumpsys meminfo`'s first listing (its blob store holds a finished
 *  file's parts there, paged to disk). */
function chromeBrowserRssMB(): number {
  for (const line of adb('shell', 'dumpsys', 'meminfo').split('\n')) {
    const m = /^\s*([\d,]+)K: com\.android\.chrome \(pid/.exec(line);
    if (m) return Number(m[1].replace(/,/g, '')) / 1024;
  }
  return NaN;
}

test('v16.5 D-E4: one long file at the phone’s cap (export memory: the 3-minute MP3s as many as the long-file cap takes, from the app’s own model: 8, 24 minutes on an 8 GB phone) through the dev hook while the library plays: done and whole; the renderers’ peak within the budget (the output leaves the renderer as it is made); Chrome’s peak; one more track refused before any decode', async ({ page }) => {
  test.setTimeout(1_800_000);
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 40 });
  // v16.5 export memory: the cap from the app's own model on this phone (deviceMemory), and the model's peak there.
  const plan = await page.evaluate(async () => {
    const url = '/utils/export/exportPlan.ts';
      const p = await import(url);
    const dm = (navigator as any).deviceMemory ?? null;
    const heavy = p.exportPeakMB('other', 180, true);
    const cap = p.longFileCapSeconds(true, heavy, dm);
    const count = Math.floor(cap / 180);
    return { dm, cap, count, budget: p.decodeBudgetMB(true, dm), model: p.longFilePeakMB(true, heavy, count * 180), modelOver: p.longFilePeakMB(true, heavy, (count + 1) * 180) };
  });
  test.info().annotations.push({ type: 'v16.5 D-E4 the plan', description: JSON.stringify(plan) });
  expect(plan.count, 'the long-file cap takes at least two 3-minute tracks on this phone').toBeGreaterThanOrEqual(2);
  // One track more than the cap: refused over the long file's cap before anything is read for a decode.
  await addMasters(page, Array(plan.count + 1).fill('tone-0091.mp3'), { id: 'plongover', name: 'Over' });
  await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.render === 'function', null, { timeout: 30_000 });
  const over = await page.evaluate(() => (window as any).__aetheriaExport.render('', { playlistId: 'plongover', files: 'long' }));
  test.info().annotations.push({ type: 'v16.5 D-E4 one more track', description: JSON.stringify({ outcome: over.outcome, reason: over.reason, cap: over.cap, steps: over.steps.map((x: any) => x.step) }) });
  expect([over.outcome, over.reason, over.cap?.what], 'one track over the cap: refused').toEqual(['failed', 'cap', 'long']);
  expect(over.steps.every((x: any) => x.step === 'length'), 'nothing read for a decode').toBe(true);
  await addMasters(page, Array(plan.count).fill('tone-0091.mp3'), { id: 'plongphone', name: 'Long' });
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.render === 'function', null, { timeout: 30_000 });
  const pauses = await pauseCount(page);
  const r0 = chromeRendererMeminfoMB();
  const b0 = chromeBrowserRssMB();
  let rPeak = r0;
  let bPeak = b0;
  let on = true;
  const sampler = (async () => {
    while (on) {
      rPeak = Math.max(rPeak, chromeRendererMeminfoMB());
      bPeak = Math.max(bPeak, chromeBrowserRssMB());
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  const c0 = batteryC();
  const r = await page.evaluate(() => (window as any).__aetheriaExport.render('', { playlistId: 'plongphone', files: 'long', keepBlob: true }));
  on = false;
  await sampler;
  const f = r.files[0];
  const row = { outcome: r.outcome, reason: r.reason ?? null, s: Math.round(r.ms.total / 100) / 10, ms: r.ms, rendererPeakOverBaseMB: Math.round(rPeak - r0), browserPeakOverBaseMB: Math.round(bPeak - b0), model: Math.round(plan.model), budget: plan.budget, bytes: f?.bytes ?? null, outSeconds: f?.outSeconds ?? null, joins: f?.joins?.length ?? null, batteryC: [c0, batteryC()] };
  test.info().annotations.push({ type: 'v16.5 D-E4 one long file at the phone cap', description: JSON.stringify(row) });
  expect(r.outcome, 'done (a refusal or a failure here sets the phone’s long-file cap lower)').toBe('done');
  // v16.5 export memory: the renderers' peak within the budget at the cap (the Note 20 measured 1,865 at 45 minutes
  // before the output left the renderer, and 1,747 to 2,616 at 42 before each decode was let go once used: engine letGo);
  // the model's prediction there, softly (exportPlan PHONE_LONG_MB_PER_MIN).
  expect(row.rendererPeakOverBaseMB, `the renderers' peak at the long-file cap (${plan.count} tracks) within the ${plan.budget} MB budget`).toBeLessThanOrEqual(plan.budget);
  expect.soft(row.rendererPeakOverBaseMB, `the model's ${row.model} MB covers it`).toBeLessThanOrEqual(plan.model);
  expect(f.bytes - f.frames * 6, 'the data is every frame (24-bit stereo) plus a header under 1 kB').toBeGreaterThan(0);
  expect(f.bytes - f.frames * 6).toBeLessThan(1024);
  expect(f.joins.length, 'a join between each two tracks').toBe(plan.count - 1);
  // v16.5 review: done AND whole, read back from the file itself (the byte check above holds by construction): its RIFF
  // and data sizes against the Blob's, the frames, and the music present across it (just after each of the first
  // joins, in the middle, near the end), read in small slices (the ~780 MB file never crosses into one buffer).
  const back = await page.evaluate(async (joins: number[]) => {
    const b: Blob = (window as any).__exportBlobs[0];
    const v = new DataView(await b.slice(0, 4096).arrayBuffer());
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    let off = 12, at = 0, size = 0;
    while (off + 8 <= v.byteLength) {
      const id = tag(off);
      const sz = v.getUint32(off + 4, true);
      if (id === 'data') { at = off + 8; size = sz; break; }
      off += 8 + sz + (sz & 1);
    }
    const frames = Math.floor(size / 6);
    const rmsAt = async (frame: number) => {
      const n = 24_000;
      const a = Math.max(0, Math.min(frames - n, frame));
      const d = new DataView(await b.slice(at + a * 6, at + (a + n) * 6).arrayBuffer());
      let e = 0;
      for (let i = 0; i < n * 2; i++) {
        let x = d.getUint8(i * 3) | (d.getUint8(i * 3 + 1) << 8) | (d.getUint8(i * 3 + 2) << 16);
        if (x & 0x800000) x -= 0x1000000;
        e += (x / 8388608) ** 2;
      }
      return Math.sqrt(e / (n * 2));
    };
    const rms = [];
    for (const fr of [48_000, joins[0] + 4800, joins[Math.min(1, joins.length - 1)] + 4800, Math.floor(frames / 2), frames - 5 * 48_000]) rms.push(await rmsAt(fr));
    const riff = v.getUint32(4, true);
    (window as any).__exportBlobs = null;
    return { blob: b.size, riff, at, dataSize: size, frames, rms };
  }, f.joins);
  test.info().annotations.push({ type: 'v16.5 D-E4 the file read back', description: JSON.stringify(back) });
  expect(back.riff, 'RIFF size = the file less 8').toBe(back.blob - 8);
  expect(back.at + back.dataSize, 'the data runs to the end of the file').toBe(back.blob);
  expect(back.frames, 'every frame').toBe(f.frames);
  expect(Math.min(...back.rms), 'the music is there across the file (after the joins, the middle, the end)').toBeGreaterThan(0.005);
  expect(await pauseCount(page), 'nothing paused').toBe(pauses);
  expect(mediaSession()?.state, 'the music played on').toBe('playing');
  expect(dialogs).toEqual([]);
});

test('v16.5 D-E5: an MP3’s length from its frames on the phone (re-review B1) while the library plays: a 25-minute VBR file without a Xing header (Chrome guesses about 5 minutes) is refused after its read and before its decode, the renderers’ peak small; the frame scan’s time on it and, in a long file’s plan, on a 60 MB one', async ({ page }) => {
  test.setTimeout(600_000);
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 40 });
  const ids = await addMasters(page, ['tone-0094.mp3', 'tone-0095.mp3'], { id: 'plscan25m', name: 'Scan' });
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.render === 'function', null, { timeout: 30_000 });
  const pauses = await pauseCount(page);
  const base = chromeRendererMeminfoMB();
  let peak = base;
  let on = true;
  const sampler = (async () => {
    while (on) {
      peak = Math.max(peak, chromeRendererMeminfoMB());
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  const one = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), ids[0]);
  on = false;
  await sampler;
  // The plan's way (8 MB slices from the Blob), the 60 MB file too: with the caps at 1,600 s (the dev hook) both are
  // scanned whole in the plan (the CBR file's stored length, 25 minutes, is over the phone's own cap), and the plan
  // (50 minutes) is refused over the long file's cap before anything is read for a decode. v16.5 final: 1,600 s, not
  // 2,000: with a regressed plan scan the VBR file would be planned at Chrome's guess (about 5 minutes) and the CBR at
  // 25, 30 minutes in all, under 2,000 s, so the 25-minute VBR would have been decoded on the phone; under 1,600 s
  // the plan is refused either way (the test still fails on the scan's lengths), and no decode can start.
  await page.evaluate(() => (window as any).__aetheriaExport.setCaps(1600));
  const long = await page.evaluate(() => (window as any).__aetheriaExport.render('', { playlistId: 'plscan25m', files: 'long' }));
  await page.evaluate(() => (window as any).__aetheriaExport.setCaps(null));
  const src = one.sources[0];
  const row = {
    one: { outcome: one.outcome, reason: one.reason, steps: one.steps.map((x: any) => x.step), stored: src?.seconds, scanSeconds: src?.scan?.seconds ?? null, scanMs: src?.scanMs ?? null, cap: one.cap, ms: one.ms, peakOverBaseMB: Math.round(peak - base) },
    plan: long.sources.map((x: any) => ({ seconds: x.seconds, scanSeconds: x.scan?.seconds ?? null, scanMs: x.scanMs ?? null })),
    planOutcome: [long.outcome, long.reason, long.cap?.what ?? null],
    planSteps: long.steps.map((x: any) => x.step),
  };
  test.info().annotations.push({ type: 'v16.5 D-E5 the frame scan on the phone', description: JSON.stringify(row) });
  expect([one.outcome, one.reason], 'refused over the cap').toEqual(['failed', 'cap']);
  expect(row.one.steps, 'read, then refused: no decode').toEqual(['length', 'read']);
  expect(row.one.scanSeconds, 'its frames say 25 minutes').toBeGreaterThan(1495);
  expect(row.one.scanMs, 'the scan of the read bytes: milliseconds').toBeLessThan(200);
  expect(row.one.peakOverBaseMB, 'no decode: the renderers’ peak is the read, not 2 GB').toBeLessThan(200);
  expect(row.plan.length, 'both in the plan').toBe(2);
  expect(row.plan.every((x: any) => x.scanSeconds > 1495), 'both scanned whole in the plan').toBe(true);
  expect(row.planOutcome, 'the plan over the long file’s cap').toEqual(['failed', 'cap', 'long']);
  expect(row.planSteps, 'nothing read for a decode').toEqual(['length', 'length']);
  expect(await pauseCount(page), 'nothing paused').toBe(pauses);
  expect(mediaSession()?.state, 'the music played on').toBe('playing');
  expect(dialogs).toEqual([]);
});

test('v16.5 D-E2: Share’s limits on the phone: canShare takes a 1 MB audio/wav file; share() of 51 MiB is refused without a sheet', async ({ page }) => {
  test.setTimeout(60_000);
  const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 10 });
  const facts = await page.evaluate(async () => {
    const small = new File([new Uint8Array(1_000_000)], 'a.wav', { type: 'audio/wav' });
    const big = new File([new Uint8Array(51 * 1024 * 1024)], 'b.wav', { type: 'audio/wav' });
    const can = (navigator as any).canShare?.({ files: [small] }) ?? null;
    const canBig = (navigator as any).canShare?.({ files: [big] }) ?? null;
    let bigErr: string | null = null;
    try {
      await (navigator as any).share({ files: [big] });
    } catch (e) {
      bigErr = (e as any)?.name ?? String(e);
    }
    return { can, canBig, bigErr };
  });
  test.info().annotations.push({ type: 'v16.5 D-E2 share facts', description: JSON.stringify(facts) });
  expect(facts.can, 'a small audio/wav file can be shared').toBe(true);
  expect(facts.bigErr, '51 MiB is refused (the app checks 50 MiB itself first)').not.toBeNull();
  expect(dialogs).toEqual([]);
});

/**
 * v16.5 (the v16.4 spec §5.11 v16.5 step 5): a recording with the screen off. 30 seeded tones of 4 s, the new layout,
 * Music only; tone-0001 by finger, then Audio Only by finger; the screen off: the card follows ≥ 3 gapless advances while
 * recording. After the wake, DOM reads only, and the stop through the page (el.click(): no tap behind the keyguard): the
 * file is as long as the wall time and has the music at its end. LOCKS the phone: its own unlock.
 */
test('v16.5: a recording with the screen off keeps recording while the card follows three gapless advances; after the wake it stops into a file with the music at its end @device', async ({ page }) => {
  test.setTimeout(240_000);
  await stubDownloads(page);
  await page.addInitScript(() => localStorage.setItem('aetheria.musicOnly.v1', 'true'));
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4 });
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await expect(page.getByTestId('tab-library')).toBeVisible({ timeout: 5_000 });
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await at(page.getByTestId('tab-more-button'), 'More');
  await at(page.getByTestId('more-record-row'), 'Record');
  await expect(page.getByTestId('record-option-audio')).toBeEnabled({ timeout: 5_000 });
  await at(page.getByTestId('record-option-audio'), 'Audio Only');
  await expect(page.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
  const wall0 = Date.now();
  const pausesBefore = await pauseCount(page);
  const first = mediaSession()!.title;
  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
          return titles.length;
        },
        { timeout: 45_000, intervals: [500], message: 'three gapless advances while recording' }
      )
      .toBeGreaterThanOrEqual(3);
    expect(chromeSessions().filter((s) => s.state === 'playing').length, 'one PLAYING Chrome card').toBe(1);
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  // After the wake: DOM and state reads, and the stop by el.click() (no tap: Chrome draws no frames behind the keyguard).
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  expect(await page.evaluate(() => !!document.querySelector('[data-testid="record-stop-save"]')), 'still recording, the sheet open').toBe(true);
  await page.evaluate(() => (document.querySelector('[data-testid="record-stop-save"]') as HTMLButtonElement).click());
  const [file] = await caughtDownloads(page, 1, 30_000);
  const w = await wavInfo(page, 0, { win: 10, head: 2, tail: 2 });
  const wallS = (Date.now() - wall0) / 1000;
  test.info().annotations.push({ type: 'v16.5 a recording with the screen off', description: JSON.stringify({ name: file.name, size: file.size, rate: w.rate, seconds: w.seconds, tail: w.tailRms, wallS, titles: [first, ...titles] }) });
  expect(Math.abs(w.seconds - wallS), 'it recorded the whole time').toBeLessThan(5);
  expect(w.tailRms, 'the music at its end, three advances on').toBeGreaterThan(0.05);
  expect(dialogs).toEqual([]);
});

/**
 * v16.5 (the export addendum §5.6 step 6): an export with the screen off. The 10-minute master (the phone cap: the user's 1,500 budget) renders through the dev
 * hook (nothing saved) while the library plays; 20 s in, the screen goes off for 120 s; after the wake, state reads only:
 * the export finishes, its file whole (24-bit 48 kHz: 288,000 bytes an output second, plus the header), the card held ≥ 2
 * advances, nothing paused. LOCKS the phone: its own unlock. LAST of the v16.5 tests.
 */
test('v16.5: an export with the screen off finishes, its file whole, while the card follows the advances @device', async ({ page }) => {
  test.setTimeout(900_000);
  const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 4 });
  const [id] = await addMasters(page, ['tone-0092.mp3']);
  await page.setViewportSize(PHONE_VIEWPORT);
  const { at } = await playlistPhone(page);
  await at(page.getByTestId('tab-library-button'), 'the Library tab');
  await at(libraryRowButton(page, 'tone-0001'), 'tone-0001');
  await expect.poll(() => mediaSession(), { timeout: 15_000, message: 'tone-0001 on the card' }).toEqual({ state: 'playing', title: 'tone-0001' });
  await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.render === 'function', null, { timeout: 30_000 });
  await page.evaluate((id) => {
    const w = window as any;
    w.__exportDone = null;
    w.__aetheriaExport.render(id, {}).then((r: any) => (w.__exportDone = r));
  }, id);
  await page.waitForTimeout(20_000);
  const first = mediaSession()!.title;
  const pausesBefore = await pauseCount(page);
  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  const titles: string[] = [];
  try {
    const end = Date.now() + 120_000;
    while (Date.now() < end) {
      const s = mediaSession();
      if (s && s.state === 'playing' && s.title !== first && !titles.includes(s.title)) titles.push(s.title);
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  await expect.poll(() => page.evaluate(() => !!(window as any).__exportDone), { timeout: 600_000, intervals: [2000], message: 'the export finishes' }).toBe(true);
  const r = await page.evaluate(() => (window as any).__exportDone);
  test.info().annotations.push({ type: 'v16.5 an export with the screen off', description: JSON.stringify({ outcome: r.outcome, reason: r.reason, s: r.ms.total / 1000, files: r.files, titles: [first, ...titles] }) });
  expect(r.outcome).toBe('done');
  const f = r.files[0];
  expect(f.bytes - f.frames * 6, 'the data is every frame (24-bit stereo) plus a header under 1 kB').toBeGreaterThan(0);
  expect(f.bytes - f.frames * 6).toBeLessThan(1024);
  expect(Math.abs(f.outSeconds - 600 / 0.981818), 'the whole 10 minutes, retuned').toBeLessThan(1);
  expect(titles.length, 'the card held two advances or more with the screen off').toBeGreaterThanOrEqual(2);
  expect(await pauseCount(page), 'nothing paused').toBe(pausesBefore);
  expect(dialogs).toEqual([]);
});

test('with the screen off, playback keeps advancing gaplessly and the lock-screen card follows @device', async ({ page }) => {
  // Turns the screen off; on a phone with a secure lock it stays locked after
  // the test (unlock it by hand). Put any other device test before this one.
  // E2E_LAYER_ENGINE=v2 runs it with the v2 layers and checks they follow each
  // gapless swap; unset, it is the classic test. E2E_KEY_FIT=1 (v15.2; implies v2) also gives every track key data
  // and turns Key fit on, and checks the duck retargets with the screen off.
  const KEY_FIT = process.env.E2E_KEY_FIT === '1';
  const V2 = process.env.E2E_LAYER_ENGINE === 'v2' || KEY_FIT;
  const dialogs = await openApp(page);
  if (V2) await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 28, 4);
  // Auto-Distribute gives every track a crystal, which the gapless advance needs.
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  if (KEY_FIT) {
    // Once the debounced save has the crystals: every track gets key data that rubs (one-hot C# at confidence 0.9) and
    // a crystal of its own, alternating 528 Hz (−6 dB) and 396 Hz (0 dB), so every advance changes the duck and the
    // crystal whatever Auto-Distribute chose (review C2: 9 of its 27 crystals give 0 dB for both earlier seeds). Key fit
    // on, and a reload.
    await expect.poll(async () => (await metaRecords(page)).filter((m) => m.closestSolfeggio !== null).length, { timeout: 30_000 }).toBe(28);
    const rub = { chroma: Array.from({ length: 12 }, (_, i) => (i === 1 ? 1 : 0)), chromaA4Hz: 440, keyConfidence: 0.9, musicKey: 'C#' };
    await seedTracks(page, Array.from({ length: 28 }, (_, i) => ({ index: i, crystal: i % 2 ? 396 : 528, key: rub })));
    await page.evaluate((k) => localStorage.setItem(k, 'true'), KEY_FIT_KEY);
    await page.goto('/');
    await acceptDisclaimer(page);
  }
  await page.getByText('tone-01', { exact: true }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('tone-01');
  await expect.poll(() => mediaSession(), { timeout: 15_000 }).toEqual({ state: 'playing', title: 'tone-01' });
  // The crystals the v2 player was asked for, one read per track.
  const crystals = new Set<number>();
  const readV2 = async (title: string) => {
    if (!V2) return;
    const requested = (await layersState(page))?.requested;
    expect(requested, `v2 plays under ${title}`).toBeTruthy();
    expect(requested.canonical_hz, `v2's crystal under ${title}`).toBeGreaterThan(0);
    crystals.add(requested.canonical_hz);
  };
  await readV2('tone-01');
  const pausesBefore = await pauseCount(page);
  const requestsBefore = KEY_FIT ? (await keyFitState(page)).requests : 0;

  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  try {
    for (const title of ['tone-02', 'tone-03', 'tone-04']) {
      await expect.poll(() => mediaSession(), { timeout: 15_000, intervals: [500] }).toEqual({ state: 'playing', title });
      await readV2(title);
    }
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  // The gapless swap never pauses the element; the playTrack fallback (which
  // drops the lock-screen card on a locked phone) always does.
  expect(await pauseCount(page)).toBe(pausesBefore);
  // v2 followed the swaps with the screen off (4 s tracks keep it retuning).
  if (V2) expect([...crystals].length, `crystals seen: ${[...crystals].join(', ')}`).toBeGreaterThanOrEqual(2);
  // Key fit: the duck was retargeted with the screen off, once at least for each of the three advances (−6 ↔ 0 dB).
  if (KEY_FIT) expect((await keyFitState(page)).requests, 'requests to the duck across the three advances').toBeGreaterThanOrEqual(requestsBefore + 3);
  expect(dialogs).toEqual([]);
});

test('a panel crash with the screen off keeps the card and the gapless advance @device', async ({ page }) => {
  // v15.4 isolation on the phone: the library list and the transport crash (the dev hook) with the screen off; the
  // lock-screen card stays PLAYING and keeps following the gapless advance, and both panels come back afterwards.
  const dialogs = await openApp(page);
  await importTones(page, 28, 4);
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await page.getByText('tone-01', { exact: true }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('tone-01');
  await expect.poll(() => mediaSession(), { timeout: 15_000 }).toEqual({ state: 'playing', title: 'tone-01' });
  const pausesBefore = await pauseCount(page);

  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  try {
    await crash(page, 'library');
    await crash(page, 'transport');
    const titles: string[] = [];
    await expect
      .poll(
        () => {
          const s = mediaSession();
          if (s && s.state === 'playing' && !titles.includes(s.title)) titles.push(s.title);
          return titles.filter((t) => t !== 'tone-01').length;
        },
        { timeout: 30_000, intervals: [500], message: 'two gapless advances on the PLAYING card' }
      )
      .toBeGreaterThanOrEqual(2);
    expect(mediaSession()?.state, 'the card still says playing').toBe('playing');
    // The library card's Reload panel button as it is now, to tell after the wake whether it was replaced meanwhile.
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('[role="alert"] button')).find((x) => x.textContent === 'Reload panel');
      (window as any).__e2eReloadPanel = b ?? null;
    });
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  }
  expect(await pauseCount(page), 'the gapless swap never pauses').toBe(pausesBefore);
  // Screen on: both fallbacks show, and Reload panel / Reload controls bring both back. The library's card by its
  // own words: SafeTransport carries an sr-only alert ("The player bar hit a problem…") that /hit a problem/ also matches.
  const library = page.getByRole('alert').filter({ hasText: /library list hit a problem/ });
  await expect(library).toBeVisible();
  await expect(page.getByTestId('safe-transport')).toBeVisible();
  await expect(page.getByTestId('safe-transport').getByRole('alert')).toHaveText(/player bar hit a problem/);
  const reloadPanel = await page.evaluate(() => {
    const before = (window as any).__e2eReloadPanel as Element | null;
    const now = Array.from(document.querySelectorAll('[role="alert"] button')).find((x) => x.textContent === 'Reload panel') ?? null;
    return { seenBefore: !!before, sameNode: !!before && before === now, beforeStillConnected: !!before?.isConnected };
  });
  console.log('[device a] the Reload panel button across the screen-off:', JSON.stringify(reloadPanel));
  test.info().annotations.push({ type: 'Reload panel button across the screen-off', description: JSON.stringify(reloadPanel) });
  // DOM clicks, not locator.click(): after the wake the secure keyguard stays up for the phone's lock delay (5 s on
  // the Note 20), and Chrome draws no frames behind it. Playwright's click waits for the element to hold still over
  // animation frames, so it would wait for ever (it did: 120 s). A real tap on Reload panel on a phone is covered by
  // isolation.spec's crash drills (@mobile). No wait for an unlock here.
  await library.getByRole('button', { name: 'Reload panel', exact: true }).evaluate((b) => (b as HTMLElement).click());
  await page.getByTestId('safe-transport').getByRole('button', { name: 'Reload controls', exact: true }).evaluate((b) => (b as HTMLElement).click());
  // Both back, read from the DOM (no frames needed): the cards gone, the list and the player bar there again.
  await expect(library).toHaveCount(0);
  await expect(page.getByTestId('safe-transport')).toHaveCount(0);
  await expect(page.locator('aside').getByText(/^tone-\d\d$/).first()).toBeAttached();
  await expect(page.getByTestId('player-bar')).toBeAttached();
  await expect(page.getByTestId('now-playing-title')).toHaveText(/^tone-\d\d$/);
  expect(dialogs).toEqual([]);
});

test('a root crash releases the card @device', async ({ page }) => {
  // Keep this one last: it ends with the app stopped (the fixture's teardown then runs as usual).
  const dialogs = await openApp(page);
  await importTones(page, 1, 30);
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => mediaSession(), { timeout: 15_000 }).toEqual({ state: 'playing', title: 'tone-01' });
  await crash(page, 'root');
  await expect(page.getByRole('alert').filter({ hasText: 'Aetheria stopped after a problem.' })).toBeVisible();
  await expect
    .poll(() => mediaSession()?.state ?? 'none', { timeout: 3_000, intervals: [250], message: 'the card no longer says PLAYING' })
    .not.toBe('playing');
  expect(dialogs).toEqual([]);
});
