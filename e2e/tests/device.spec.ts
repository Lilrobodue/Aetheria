import { test, expect, ON_DEVICE } from './fixtures';
import { openApp, acceptDisclaimer, importTones, pauseCount, instrumentAudio, layerState, pickFrequency, seedLayers, layersState, metaRecords, seedTracks, keyFitState, KEY_FIT_KEY } from './helpers';
import { adb, mediaSession, chromeSessions } from './adb';

// Checks only a real phone can make (npm run test:device). Android's own media
// session — what the lock screen, the notification and the car show — is read
// with `adb shell dumpsys media_session`. The screen-off test must stay LAST.
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
