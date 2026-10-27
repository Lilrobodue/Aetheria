import { test, expect, ON_DEVICE } from './fixtures';
import { openApp, acceptDisclaimer, importTones, pauseCount, instrumentAudio, layerState, pickFrequency, seedLayers, layersState, metaRecords, seedTracks, keyFitState, KEY_FIT_KEY, crash, optInNewLayout, layoutPref, tapAt, shellHidden, PHONE_VIEWPORT, openSeededNewLayout, openLibraryTab, libraryState, startWalk, type LibraryState } from './helpers';
import { adb, mediaSession, chromeSessions } from './adb';

// Checks only a real phone can make (npm run test:device). Android's own media
// session — what the lock screen, the notification and the car show — is read
// with `adb shell dumpsys media_session`. The screen-off tests must stay LAST
// (v15.4: the panel-crash one after the lock-screen one, the root crash last;
// v15.5: the new layout's one before the lock-screen one; v15.6: the new layout in Zen after it; v15.7: the Library
// tab's row tap after that; v15.8: the walk after Assign after that; v15.9: a mix from the Mixes tab after that).
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
