import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import { acceptDisclaimerNew, seedToneLibrary, LAYER_ENGINE_KEY, LAYOUT_KEY } from './helpers';
import { openApp, acceptDisclaimer, importTones, pauseCount, instrumentAudio, layerState, pickFrequency, seedLayers, layersState, metaRecords, seedTracks, keyFitState, KEY_FIT_KEY, crash, optInNewLayout, layoutPref, tapAt, shellHidden, PHONE_VIEWPORT, openSeededNewLayout, openLibraryTab, libraryState, startWalk, libraryRowButton, rowMenu, type LibraryState } from './helpers';
import { adb, mediaSession, chromeSessions } from './adb';

// Checks only a real phone can make (npm run test:device). Android's own media
// session — what the lock screen, the notification and the car show — is read
// with `adb shell dumpsys media_session`. The screen-off tests must stay LAST
// (v15.4: the panel-crash one after the lock-screen one, the root crash last;
// v15.5: the new layout's one before the lock-screen one; v15.6: the new layout in Zen after it; v15.7: the Library
// tab's row tap after that; v15.8: the walk after Assign after that; v15.9: a mix from the Mixes tab after that; v16.0:
// the queue after that; v16.1: a saved playlist after that; v16.2: a filtered set after that; v16.3: a built mix after
// that; v16.4: Keep screen awake off with Pause visuals on after that).
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
