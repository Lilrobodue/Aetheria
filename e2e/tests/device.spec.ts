import { test, expect, ON_DEVICE } from './fixtures';
import { openApp, acceptDisclaimer, importTones, pauseCount, instrumentAudio, layerState, pickFrequency, seedLayers, layersState, metaRecords, seedTracks, keyFitState, KEY_FIT_KEY, crash, optInNewLayout, layoutPref, tapAt, shellHidden, PHONE_VIEWPORT } from './helpers';
import { adb, mediaSession, chromeSessions } from './adb';

// Checks only a real phone can make (npm run test:device). Android's own media
// session — what the lock screen, the notification and the car show — is read
// with `adb shell dumpsys media_session`. The screen-off tests must stay LAST
// (v15.4: the panel-crash one after the lock-screen one, the root crash last;
// v15.5: the new layout's one before the lock-screen one; v15.6: the new layout in Zen after it).
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
