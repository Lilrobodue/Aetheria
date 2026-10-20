import { test, expect } from './fixtures';
import {
  openApp,
  acceptDisclaimer,
  importTones,
  addFiles,
  toneWav,
  elapsedSeconds,
  expectCache,
  instrumentAudio,
  layerState,
  pickFrequency,
  openHarmonicControl,
  tapTraditional,
  layerIntensity,
  openSafety,
  countConsole,
  rowOf,
} from './helpers';

// v14.6 sound Phase 0, measured on the app's own Web Audio graph (see
// instrumentAudio): the first tap's level, every stop path, Music only and the
// Safety Mute. Levels at the defaults (volume 0.8, phi mode on, Layer
// Intensity 1%): the tone's gain ramps to 0.100228 on a layer bus of 0.4 —
// 0.0401 peak, -26 dB under the music — and the drone sits at 0.08 while
// playing.
const TONE_TARGET = 0.100228;
const BUS = 0.4;
const DRONE = 0.08;
const MUSIC_ONLY_KEY = 'aetheria.musicOnly.v1';

const musicOnlySwitch = (page: import('@playwright/test').Page) => page.getByRole('switch', { name: 'Music only' });
const muteButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /^(Mute|Mute layers|Layers muted)$/ });

test('the first frequency tap plays the tone at its validated level @mobile', async ({ page }) => {
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await openHarmonicControl(page);
  await expect(layerIntensity(page)).toHaveText('1%');
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layerState(page)).toneTargets.length).toBeGreaterThan(0);
  // v14.5 jumped the slider to 30% here: a target of 1.0, ten times louder.
  await expect(layerIntensity(page)).toHaveText('1%');
  const first = await layerState(page);
  for (const t of first.toneTargets) expect(t).toBeCloseTo(TONE_TARGET, 6);
  expect(first.busFirst).toBeCloseTo(BUS, 6);
  expect(first.toneTargets[first.toneTargets.length - 1] * first.busFirst!).toBeCloseTo(0.0401, 4);

  await tapTraditional(page, 417);
  await expect.poll(async () => (await layerState(page)).toneTargets.length).toBeGreaterThan(first.toneTargets.length);
  for (const t of (await layerState(page)).toneTargets) expect(t).toBeCloseTo(TONE_TARGET, 6);
  expect(dialogs).toEqual([]);
});

test('a Lo Shu cube tap plays the tone at the same level', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  await page.getByRole('button', { name: /The Guidebook/ }).click();
  await page.getByRole('button', { name: 'Technical', exact: true }).click();
  await page.getByTitle(/^Play 528 Hz/).first().click();
  await expect.poll(async () => (await layerState(page)).toneTargets.length).toBeGreaterThan(0);
  const s = await layerState(page);
  expect(s.toneTargets[s.toneTargets.length - 1]).toBeCloseTo(TONE_TARGET, 6);
  expect(s.busFirst).toBeCloseTo(BUS, 6);
});

test('a tap under music keeps the tone at its level and leaves the beat alone', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  // 12 s tracks: phi timing peaks at 38.2% and 61.8% (4.6 s and 7.4 s).
  await importTones(page, 28, 12);
  // Every track gets a crystal, so the unanalysed-track detector stays out of it.
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  const before = await layerState(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  // The tap's own ramp (playback already made one).
  await expect.poll(async () => (await layerState(page)).toneTargets.length).toBeGreaterThan(before.toneTargets.length);
  const s = await layerState(page);
  expect(s.toneTargets[s.toneTargets.length - 1]).toBeCloseTo(TONE_TARGET, 6);
  // The tap no longer changes Layer Intensity, so the binaural pair isn't rebuilt.
  expect(s.mergerCount).toBe(before.mergerCount);
  await expect(layerIntensity(page)).toHaveText('1%');
  // Past the envelope's peaks: it topped out at the tone's level, not 10x it.
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(8);
  expect((await layerState(page)).envMax).toBeCloseTo(TONE_TARGET, 3);
});

test('Emergency Stop pauses the music and silences every layer @mobile', async ({ page }) => {
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await importTones(page, 2, 8);
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 15_000 }).toBeGreaterThan(0.5);
  await pickFrequency(page);
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);
  await openSafety(page);
  await page.getByRole('button', { name: 'Emergency Stop' }).click();

  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const stopped = await layerState(page);
  expect(stopped.music?.paused).toBe(true);
  expect(stopped.toneSounding).toBe(false);
  if (stopped.anchorPaused !== null) expect(stopped.anchorPaused).toBe(true);
  await page.waitForTimeout(1000);
  expect((await layerState(page)).music?.time).toBe(stopped.music?.time);
  // v14.5 played on and advanced to tone-02.
  await page.waitForTimeout(8000);
  await expect(page.getByTestId('now-playing-title')).toHaveText('tone-01');
  expect(dialogs).toEqual([]);
});

test('deleting the playing track stops and unloads it; Play starts the list again', async ({ page }) => {
  await instrumentAudio(page);
  const errors = countConsole(page, 'Audio element error:');
  await openApp(page, { acceptDialogs: true }); // the row Delete asks to confirm
  await importTones(page, 3, 30);
  await page.getByText('tone-02', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await pickFrequency(page);
  const oldSrc = (await layerState(page)).music!.src!;

  await rowOf(page, 'tone-02').getByTitle('Delete song').click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('Aetheria Harmonic Player');
  await expect.poll(async () => (await layerState(page)).music?.paused).toBe(true);
  const s = await layerState(page);
  // No source left (Chrome keeps the old currentSrc, but its URL is revoked below).
  expect(s.music?.src).toBeNull();
  expect(s.toneSounding).toBe(false);
  // The deleted file's URL is gone, so nothing can resume it.
  const fetched = await page.evaluate((u) => fetch(u).then(() => 'alive', () => 'revoked'), oldSrc);
  expect(fetched).toBe('revoked');
  expect(errors()).toBe(0);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('tone-01');
  await expect.poll(async () => (await layerState(page)).music?.paused).toBe(false);
  expect((await layerState(page)).music?.src).not.toBe(oldSrc);
  await expectCache(page, { blobs: 2 });
});

test('deleting the highlighted track while the music is paused leaves a tone-only session playing', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page, { acceptDialogs: true }); // the row Delete asks to confirm
  await importTones(page, 3, 30);
  await page.getByText('tone-02', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await pickFrequency(page); // a tone over the paused track
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);
  await rowOf(page, 'tone-02').getByTitle('Delete song').click();
  await expect(page.getByText('tone-02', { exact: true })).toHaveCount(0);
  // The deleted track is unloaded, but nothing that was sounding stopped.
  expect((await layerState(page)).music?.src).toBeNull();
  await page.waitForTimeout(1000);
  expect((await layerState(page)).toneSounding).toBe(true);
});

test('Next on the last track pauses it even when its length is unknown', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  await importTones(page, 2, 30);
  await page.getByText('tone-02', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  // A recorder WebM reports duration Infinity until it is played through.
  await page.evaluate(() => {
    const el = (window as any).__audio.music as HTMLMediaElement;
    Object.defineProperty(el, 'duration', { configurable: true, get: () => Infinity });
  });
  await page.getByRole('button', { name: 'Next track' }).click();
  await expect.poll(async () => (await layerState(page)).music?.paused).toBe(true);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('Next on the last track stops the music and the layers; Play resumes it @mobile', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  await importTones(page, 2, 30);
  await page.getByText('tone-02', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await pickFrequency(page);
  await page.getByRole('button', { name: 'Next track' }).click();

  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const stopped = await layerState(page);
  expect(stopped.music?.paused).toBe(true);
  expect(stopped.toneSounding).toBe(false);
  if (stopped.anchorPaused !== null) expect(stopped.anchorPaused).toBe(true);
  await expect(page.getByTestId('now-playing-title')).toHaveText('tone-02');
  await page.waitForTimeout(1000);
  expect((await layerState(page)).music?.time).toBe(stopped.music?.time);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await layerState(page)).music?.paused).toBe(false);
  await expect(page.getByTestId('now-playing-title')).toHaveText('tone-02');
  expect((await layerState(page)).music!.time).toBeGreaterThanOrEqual(stopped.music!.time);
});

test('the end of the list plays its tail out, then every layer is silent @mobile', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  await importTones(page, 2, 6);
  await page.getByText('tone-02', { exact: true }).click();
  await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 15_000 }).toBeGreaterThan(1);
  await pickFrequency(page);
  const pausesBefore = (await layerState(page)).musicPauses;
  // The track ends naturally: its tail isn't cut (no pause), then the tone stops too.
  await expect.poll(async () => (await layerState(page)).music?.ended, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(false);
  expect((await layerState(page)).musicPauses).toBe(pausesBefore);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('Clear ends a tone-only session, and a tone picked after it keeps playing', async ({ page }) => {
  await instrumentAudio(page);
  const errors = countConsole(page, 'Audio element error:');
  await openApp(page);
  await importTones(page, 2, 30);
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await pickFrequency(page);
  await page.getByRole('button', { name: 'Clear library and cache' }).click();
  await page.getByRole('button', { name: /^Confirm deleting all/ }).click();

  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(false);
  expect((await layerState(page)).music?.paused).toBe(true);
  await page.waitForTimeout(2000);
  // v14.5 answered the empty src's error by setting it again — for ever.
  expect(errors()).toBeLessThanOrEqual(1);

  await pickFrequency(page);
  await page.waitForTimeout(1000);
  expect((await layerState(page)).toneSounding).toBe(true);
  expect(errors()).toBeLessThanOrEqual(1);
});

test('Clear ends a tone with no track ever loaded', async ({ page }) => {
  // No music element exists yet, so no playback error can stop the tone:
  // only Clear itself does.
  await instrumentAudio(page);
  await openApp(page);
  await importTones(page, 2, 30);
  await pickFrequency(page);
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);
  expect((await layerState(page)).music).toBeNull();
  await page.getByRole('button', { name: 'Clear library and cache' }).click();
  await page.getByRole('button', { name: /^Confirm deleting all/ }).click();
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(false);
});

test('a track that cannot play stops the tone too', async ({ page }) => {
  await instrumentAudio(page);
  const errors = countConsole(page, 'Audio element error:');
  const dialogs = await openApp(page);
  await addFiles(page, [
    { name: 'tone-01.wav', mimeType: 'audio/wav', buffer: toneWav(30, 220) },
    { name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(4096, 7) },
  ]);
  await pickFrequency(page); // a tone-only session
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);
  await page.getByText('broken', { exact: true }).click();
  await expect.poll(async () => (await layerState(page)).toneSounding, { timeout: 5_000 }).toBe(false);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(errors()).toBeLessThanOrEqual(2);
  expect(dialogs).toEqual([]);
});

test('a play that fails without an element error stops the tone too', async ({ page }) => {
  // Only playTrack's catch can stop it here: the file plays fine in the
  // element, but its analysis decode fails.
  await instrumentAudio(page);
  await page.addInitScript(() => {
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...args: any[]) {
      if ((window as any).__failDecode) return Promise.reject(new DOMException('test decode failure', 'EncodingError'));
      return (decode as any).apply(this, args);
    } as typeof decode;
  });
  const errors = countConsole(page, 'Audio element error:');
  await openApp(page);
  await importTones(page, 1, 30);
  await pickFrequency(page); // a tone-only session
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);
  await page.evaluate(() => ((window as any).__failDecode = true));
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(async () => (await layerState(page)).toneSounding, { timeout: 10_000 }).toBe(false);
  expect(errors()).toBe(0);
});

test('a gapless advance onto a broken track stops every layer', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  // broken.wav right after tone-01 (the list is virtualised: keep both on screen),
  // then enough tracks for Auto-Distribute (it needs 27). tone-01 is long
  // enough for the frequency pick to finish before it ends, even on a phone.
  await addFiles(page, [
    { name: 'tone-01.wav', mimeType: 'audio/wav', buffer: toneWav(8, 220) },
    { name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(4096, 7) },
  ]);
  await importTones(page, 26, 3, 'more');
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 15_000 }).toBeGreaterThan(0.5);
  await pickFrequency(page);
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);
  // tone-01 runs out and the gapless swap loads the broken file.
  await expect.poll(async () => (await layerState(page)).toneSounding, { timeout: 15_000 }).toBe(false);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('Music only fades the tone, beat and drone and leaves the music alone @mobile', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  await importTones(page, 1, 30);
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: BUS, tau: 0.1 });
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBeCloseTo(DRONE, 6);
  const volume = (await layerState(page)).music!.volume;

  await openHarmonicControl(page);
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('music-only-chip')).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), MUSIC_ONLY_KEY)).toBe('true');
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: 0, tau: 0.25 });
  await expect.poll(async () => (await layerState(page)).droneLast).toEqual({ target: 0, tau: 0.25 });
  if ((await layerState(page)).ctxRunning) {
    await expect.poll(async () => (await layerState(page)).bus!, { timeout: 5_000 }).toBeLessThan(1e-3);
    await expect.poll(async () => (await layerState(page)).drone!, { timeout: 5_000 }).toBeLessThan(1e-3);
  }
  // The music is untouched.
  const during = await layerState(page);
  expect(during.music?.paused).toBe(false);
  expect(during.music?.volume).toBe(volume);
  const t = await elapsedSeconds(page);
  await expect.poll(() => elapsedSeconds(page), { timeout: 5_000 }).toBeGreaterThan(t);

  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('music-only-chip')).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), MUSIC_ONLY_KEY)).toBe('false');
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: BUS, tau: 0.25 });
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBeCloseTo(DRONE, 6);
  expect((await layerState(page)).droneLast?.tau).toBe(0.25);
});

test('a saved Music only holds from the first tap and through play and pause', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  await page.evaluate((k) => localStorage.setItem(k, 'true'), MUSIC_ONLY_KEY);
  await page.reload();
  await acceptDisclaimer(page); // v14.5 showed it on every launch
  await openHarmonicControl(page);
  await tapTraditional(page, 528); // no music: a tone-only first tap
  await expect.poll(async () => (await layerState(page)).busFirst).not.toBeNull();
  expect((await layerState(page)).busFirst).toBe(0);
  if ((await layerState(page)).ctxRunning) {
    await page.waitForTimeout(2000);
    expect((await layerState(page)).bus!).toBeLessThan(1e-3);
  }
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('music-only-chip')).toBeVisible();

  await importTones(page, 1, 30);
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBe(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBe(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await layerState(page)).music?.paused).toBe(false);
  await page.waitForTimeout(500);
  const s = await layerState(page);
  expect(s.droneLast?.target).toBe(0);
  if (s.ctxRunning) expect(s.bus!).toBeLessThan(1e-3);

  await page.reload();
  await acceptDisclaimer(page);
  await openHarmonicControl(page);
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');
});

test('Safety Mute turns Music only on, stays on, and rebuilds nothing @mobile', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  await importTones(page, 1, 30);
  await page.getByText('tone-01', { exact: true }).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  const before = await layerState(page);
  await openSafety(page);
  await muteButton(page).click();

  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: 0, tau: 0.25 });
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBe(0);
  await expect(muteButton(page)).toHaveText('Layers muted');
  // v14.5 set Layer Intensity to 0, which rebuilt the tone and the beat.
  expect((await layerState(page)).oscCount).toBe(before.oscCount);
  await muteButton(page).click();
  expect(await page.evaluate((k) => localStorage.getItem(k), MUSIC_ONLY_KEY)).toBe('true');
  await expect(page.getByTestId('music-only-chip')).toBeVisible();
  await expect(page.getByText('Layers off', { exact: true })).toBeVisible();
  const s = await layerState(page);
  expect(s.music?.paused).toBe(false);
  expect(s.music?.volume).toBe(before.music?.volume);

  await page.getByRole('button', { name: 'Close Safety Panel' }).click();
  await openHarmonicControl(page);
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(layerIntensity(page)).toHaveText('1%');
});

test('Mute holds through the first frequency tap', async ({ page }) => {
  await instrumentAudio(page);
  await openApp(page);
  await openSafety(page);
  await muteButton(page).click();
  await page.getByRole('button', { name: 'Close Safety Panel' }).click();
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layerState(page)).busFirst).not.toBeNull();
  // v14.5: Mute set 0%, and the first tap's boost jumped it straight to 30%.
  await expect(layerIntensity(page)).toHaveText('1%');
  expect((await layerState(page)).busFirst).toBe(0);
  await expect(page.getByTestId('music-only-chip')).toBeVisible();
});
