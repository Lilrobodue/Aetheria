import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  openApp,
  acceptDisclaimer,
  importTones,
  addFiles,
  toneWav,
  expectCache,
  pauseCount,
  instrumentAudio,
  layerState,
  pickFrequency,
  openHarmonicControl,
  openSafety,
  setSlider,
  seedLayers,
  seedTracks,
  layersState,
  layersCreated,
  metaRecords,
  elapsedSeconds,
  analyseTune,
  keyFitState,
  keyFitSwitch,
  keyFitChip,
  keyFitStatus,
  meanLayerRms,
  KEY_FIT_KEY,
  SOUND_LOG_KEY,
  type SeedKey,
} from './helpers';

// Key fit (v15.2): a key-aware duck of the v2 layers (utils/soundV2/keyFit.ts). The duck is read through the dev
// hook (window.__aetheriaLayers.keyFit(): its mirror, target, τ, hold and counters); the tracks are generated tones
// whose stored key data (chroma, A4, confidence, key) and crystal are seeded into IndexedDB (helpers.seedTracks),
// so every expected duck is v2's own musicFit on synthetic data: one-hot C# under 528 Hz rubs (−6 dB at confidence
// 0.9, −3 dB at 0.6, none at 0.4: an unclear key), one-hot F# sits well (0 dB). Every test ends with no dialog and
// no page error. The first test is about the default (on since v15.2.1, off in v15.2) and leaves the switch unset;
// every other test sets it itself (setup's keyFit), so none of them depends on the default.

const ONE = (k: number): number[] => Array.from({ length: 12 }, (_, i) => (i === k ? 1 : 0));
const RUB_09: SeedKey = { chroma: ONE(1), chromaA4Hz: 440, keyConfidence: 0.9, musicKey: 'C#' }; // −6.0 dB at 528
const RUB_06: SeedKey = { ...RUB_09, keyConfidence: 0.6 }; // −3.0 dB
const RUB_04: SeedKey = { ...RUB_09, keyConfidence: 0.4 }; // unclear: 0
const FIT_09: SeedKey = { chroma: ONE(6), chromaA4Hz: 440, keyConfidence: 0.9, musicKey: 'F#' }; // 0 dB at 528
const G6 = 10 ** (-6 / 20);

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const listed = (page: Page, name: string) => page.getByRole('complementary').getByText(name, { exact: true });
const engineButton = (page: Page, name: 'Classic' | 'v2') =>
  page.getByRole('group', { name: 'Layer sound: v2 / classic' }).getByRole('button', { name, exact: true });
const toneSlider = (page: Page) => page.getByRole('slider', { name: 'Tone level' });
const chipSays = (page: Page, text: string) => expect(keyFitChip(page)).toHaveAttribute('aria-label', text, { timeout: 10_000 });

/** openApp, the A/B choices, `seconds`-long tones (or `files`), the cache saved, the tracks' crystals and key data
 *  seeded, and a reload into the app. Returns openApp's dialogs. */
async function setup(
  page: Page,
  o: {
    output: 'headphones' | 'car';
    keyFit?: boolean;
    engine?: 'v2' | 'classic';
    tones?: [number, number];
    files?: Array<{ name: string; mimeType: string; buffer: Buffer }>;
    seeds: Array<{ index: number; crystal?: number; key?: SeedKey | null }>;
  }
): Promise<string[]> {
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: o.engine ?? 'v2', output: o.output, ...(o.keyFit === undefined ? {} : { keyFit: o.keyFit }) });
  if (o.files) await addFiles(page, o.files);
  else await importTones(page, o.tones![0], o.tones![1]);
  const n = o.files ? o.files.length : o.tones![0];
  await expectCache(page, { blobs: n, meta: n, library: n });
  await seedTracks(page, o.seeds);
  await page.goto('/');
  await acceptDisclaimer(page);
  return dialogs;
}

/** Play a track from the list and wait until it is under way. */
async function startTrack(page: Page, name = 'tone-01'): Promise<void> {
  await listed(page, name).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
}

/** Seek the playing track to `fraction` of its length (the seek strip, as clock.spec does). */
async function seekTo(page: Page, fraction: number): Promise<void> {
  const strip = page.getByTestId('seek-progress').locator('xpath=..');
  const box = await strip.boundingBox();
  await strip.click({ position: { x: box!.width * fraction, y: box!.height / 2 } });
}

/** The duck's gain has settled within 0.1 % of `gain`, the gates are open and the host is past any glide: a reading
 *  of the layers now is the steady level under that duck (critique m6: polls, not fixed waits). */
async function settled(page: Page, gain: number, timeout = 20_000): Promise<void> {
  await expect.poll(async () => Math.abs((await keyFitState(page)).value / gain - 1), { timeout, message: `the duck settles at ${gain}` }).toBeLessThan(1e-3);
  await expect.poll(async () => (await layersState(page)).gates.tone_beat, { timeout }).toBe(1);
  // The host glides for 2 s after a seek: two host reads 300 ms apart within 1 % (the φ envelope moves ≤ 1.4 %/s).
  await expect.poll(async () => {
    const a = (await layersState(page)).host_level;
    await page.waitForTimeout(300);
    const b = (await layersState(page)).host_level;
    return Math.abs(b / a - 1);
  }, { timeout, message: 'the host has settled' }).toBeLessThan(0.01);
}

/**
 * Review C2: record every KeyFitDuck.setTarget call with the player's state at that moment (the dev server's own module
 * instance, patched in the page), so a hold can be compared with the retune_at it was taken from, however late the test
 * reads it (a retune from silence is pending for 50 ms only).
 */
async function recordSends(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as any;
    if (w.__keyFitSends) return;
    w.__keyFitSends = [];
    const { KeyFitDuck } = await import('/utils/soundV2/keyFit.ts');
    const set = KeyFitDuck.prototype.setTarget;
    KeyFitDuck.prototype.setTarget = function (this: any, db: number, o: any) {
      const player = w.__aetheriaLayers?.state() ?? null;
      const sent = set.call(this, db, o);
      w.__keyFitSends.push({ db, sent, player, duck: this.state() });
      return sent;
    };
  });
}
/** Tap a frequency in Advanced Frequency Selection; the first send it causes, with the player's state at that send. */
async function pickAndSend(page: Page, hz: number): Promise<{ duck: any; player: any }> {
  const n0: number = await page.evaluate(() => (window as any).__keyFitSends.length);
  await pickFrequency(page, hz);
  const first = () => page.evaluate((n) => ((window as any).__keyFitSends as any[]).slice(n).find((x) => x.sent) ?? null, n0);
  await expect.poll(first, { message: 'the fit effect sends the tap\'s duck' }).not.toBeNull();
  return (await first())!;
}

/** The music element's volume and playback rate (the music never changes). */
const musicLevel = (page: Page) =>
  page.evaluate(() => {
    const m = (window as any).__audio?.music as HTMLMediaElement | null;
    return m ? { volume: m.volume, rate: m.playbackRate } : null;
  });

test('Key fit is on by default, saved only when tapped, and v2 only', async ({ page }) => {
  // v15.2.1: on by default for a profile that never tapped the switch (v15.2 shipped it off). Only a tap writes the
  // key, so a tapped Off stays off across a reload, and an unset profile keeps following the release default.
  const errors = pageErrors(page);
  const dialogs = await setup(page, {
    output: 'headphones', tones: [3, 30],
    seeds: [{ index: 0, crystal: 528, key: RUB_09 }, { index: 1, crystal: 528, key: FIT_09 }, { index: 2, crystal: 528, key: null }],
  });
  await openHarmonicControl(page);
  await expect(keyFitSwitch(page)).toHaveAttribute('aria-checked', 'true');
  expect(await stored(page, KEY_FIT_KEY)).toBeNull();

  // Unset: the duck applies on a track that rubs, and the chip shows it; playing it writes nothing.
  await startTrack(page);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  await chipSays(page, 'Key fit −6.0 dB');
  expect((await keyFitState(page)).target_db).toBe(-6);
  await expect(keyFitStatus(page)).toHaveText('On. On this track the layers are 6.0 dB softer.');
  expect(await stored(page, KEY_FIT_KEY), 'nothing saved before a tap').toBeNull();

  // Nor does a reload: still on, still unset.
  await page.reload();
  await acceptDisclaimer(page);
  await openHarmonicControl(page);
  await expect(keyFitSwitch(page)).toHaveAttribute('aria-checked', 'true');
  expect(await stored(page, KEY_FIT_KEY), 'nothing saved by a load').toBeNull();

  // A tap turns it off and saves that; the chip goes, and the card says what it would do.
  await startTrack(page);
  await chipSays(page, 'Key fit −6.0 dB');
  await keyFitSwitch(page).click();
  expect(await stored(page, KEY_FIT_KEY)).toBe('false');
  await expect(keyFitChip(page)).toHaveCount(0);
  await expect(keyFitStatus(page)).toHaveText('Off. On this track it would make the layers 6.0 dB softer.');
  await expect.poll(async () => (await keyFitState(page)).target_db).toBe(0);

  // Saved: still off after a reload, the default notwithstanding; the new duck is never sent anything.
  await page.reload();
  await acceptDisclaimer(page);
  await openHarmonicControl(page);
  await expect(keyFitSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await startTrack(page);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  await expect(keyFitChip(page)).toHaveCount(0);
  const s0 = await keyFitState(page);
  expect({ target_db: s0.target_db, sends: s0.sends, value: s0.value }).toEqual({ target_db: 0, sends: 0, value: 1 });
  await expect(keyFitStatus(page)).toHaveText('Off. On this track it would make the layers 6.0 dB softer.');
  expect(await stored(page, KEY_FIT_KEY)).toBe('false');

  // A tap turns it on again and saves that.
  await keyFitSwitch(page).click();
  expect(await stored(page, KEY_FIT_KEY)).toBe('true');
  await chipSays(page, 'Key fit −6.0 dB');
  await expect(keyFitStatus(page)).toHaveText('On. On this track the layers are 6.0 dB softer.');

  // Classic: no card, no chip, no duck, no v2 player.
  await seedLayers(page, { engine: 'classic', keyFit: true });
  await openHarmonicControl(page);
  await expect(engineButton(page, 'Classic')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('key-fit-row')).toHaveCount(0);
  await startTrack(page);
  await page.waitForTimeout(500);
  await expect(keyFitChip(page)).toHaveCount(0);
  expect(await keyFitState(page)).toBeNull();
  expect(await layersCreated(page)).toBe(false);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

/** Car, Key fit on, the tone slider at 0 dB, a 60 s track seeked to 45 %: the duck settled at −6. */
async function carAtMinus6(page: Page): Promise<string[]> {
  await instrumentAudio(page);
  const dialogs = await setup(page, { output: 'car', keyFit: true, tones: [1, 60], seeds: [{ index: 0, crystal: 528, key: RUB_09 }] });
  await openHarmonicControl(page);
  await setSlider(toneSlider(page), 0.01);
  await startTrack(page);
  await seekTo(page, 0.45);
  await expect.poll(async () => (await layersState(page))?.requested?.render ?? null).toBe('off');
  expect((await keyFitState(page)).target_db).toBe(-6);
  await chipSays(page, 'Key fit −6.0 dB');
  await settled(page, G6);
  return dialogs;
}

test('Car: switching Key fit lands at once on the tone, and the music is untouched @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await carAtMinus6(page);
  const m1 = await musicLevel(page);
  const r1 = await meanLayerRms(page);

  await keyFitSwitch(page).click();
  // The switch lands in ~0.15 s (τ 0.05 s): within 99.9 % of unity well inside 3 s.
  await expect.poll(async () => (await keyFitState(page)).value, { timeout: 3_000 }).toBeGreaterThan(0.999);
  const s2 = await keyFitState(page);
  expect({ target_db: s2.target_db, tau_s: s2.tau_s }).toEqual({ target_db: 0, tau_s: 0.05 });
  const m2 = await musicLevel(page);
  const r2 = await meanLayerRms(page);

  await keyFitSwitch(page).click();
  await expect.poll(async () => (await keyFitState(page)).value, { timeout: 3_000 }).toBeLessThan(G6 * 1.001);
  expect((await keyFitState(page)).tau_s).toBe(0.05);
  const m3 = await musicLevel(page);
  const r3 = await meanLayerRms(page);

  test.info().annotations.push({ type: 'rms', description: `R1 ${r1.toExponential(4)}, R2 ${r2.toExponential(4)}, R3 ${r3.toExponential(4)}; R2/R1 ${(r2 / r1).toFixed(4)}, R3/R2 ${(r3 / r2).toFixed(4)}` });
  expect(r2 / r1, 'off: the tone 6 dB up (×1.995)').toBeGreaterThanOrEqual(1.85);
  expect(r2 / r1).toBeLessThanOrEqual(2.15);
  expect(r3 / r2, 'on again: 6 dB down (×0.501)').toBeGreaterThanOrEqual(0.46);
  expect(r3 / r2).toBeLessThanOrEqual(0.54);
  expect(m1).not.toBeNull();
  expect(m2).toEqual(m1);
  expect(m3).toEqual(m1);

  // Critique M2: a seek glides the host for 2 s. The level tick holds a duck rise when it sees the seek (a holdRise
  // call), and the switch turned off inside that window waits for its end before the duck rises. Review C1: the hold is
  // checked against the window's end itself (read through the dev hook), so a slow tap costs nothing but window.
  const holds0 = (await keyFitState(page)).holds;
  // Back to 30 %: the track plays past 45 % by now, so this is always a jump the tick sees (a seek to 60 % could land
  // within 1 s of where the track had got to, and the tick would see no seek). Left of ~25 % the library panel covers
  // the strip.
  await seekTo(page, 0.3);
  await expect.poll(async () => (await keyFitState(page)).holds, { timeout: 3_000, intervals: [50], message: 'the level tick saw the seek' }).toBeGreaterThan(holds0);
  await keyFitSwitch(page).click();
  await expect.poll(async () => (await keyFitState(page)).target_db).toBe(0);
  const w = await keyFitState(page);
  // The glide window's end on the duck's clock: the duck's time and performance.now() read in one task.
  const glideEnd: number = await page.evaluate(() => {
    const L = (window as any).__aetheriaLayers;
    return L.keyFit().t + (L.glideUntil() - performance.now()) / 1000;
  });
  test.info().annotations.push({ type: 'glide wait', description: `the rise waits until ${w.hold_until?.toFixed(3)} s; the glide window ends at ${glideEnd.toFixed(3)} s` });
  expect(w.hold_until, 'the switch waits for the host glide window').not.toBeNull();
  expect(w.start_at).toBe(w.hold_until);
  expect(Math.abs(w.hold_until - glideEnd), "the hold is the glide window's end").toBeLessThan(0.1);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('each track\'s duck glides in at a track change: none without key data or with an unclear key @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await setup(page, {
    output: 'headphones', keyFit: true, tones: [6, 10],
    seeds: [
      { index: 0, crystal: 528, key: RUB_09 }, { index: 1, crystal: 528, key: RUB_06 }, { index: 2, crystal: 528, key: null },
      { index: 3, crystal: 528, key: RUB_04 }, { index: 4, crystal: 528, key: FIT_09 },
      // Review B4: analysed with no pitch found (chromaVersion alone): never retried, so the copy must not send the user
      // to Analyse tracks.
      { index: 5, crystal: 528, key: 'empty' },
    ],
  });
  await startTrack(page);
  const title = page.getByTestId('now-playing-title');
  await expect.poll(async () => (await keyFitState(page))?.target_db ?? null).toBe(-6);
  await chipSays(page, 'Key fit −6.0 dB');
  const pausesBefore = await pauseCount(page);
  const sends0 = (await keyFitState(page)).sends;
  const steps: Array<[string, number, string, string | null]> = [
    ['tone-02', -3, 'Key fit −3.0 dB', null],
    ['tone-03', 0, 'Key fit · no key data', 'This track has no key data yet. Analyse tracks gives it some.'],
    ['tone-04', 0, 'Key fit 0 dB', "This track's key is unclear"],
    ['tone-05', 0, 'Key fit 0 dB', null],
    ['tone-06', 0, 'Key fit · no key data', 'Analyse tracks found no clear key in this track, so the layers stay at their set level.'],
  ];
  for (const [name, db, chip, hint] of steps) {
    await expect(title).toHaveText(name, { timeout: 15_000 });
    await expect.poll(async () => (await keyFitState(page)).target_db, { message: `${name}'s duck` }).toBeCloseTo(db, 9);
    if (name === 'tone-02') {
      // Review A3: the new track's rise (−6 → −3) waits until the level tick has seen the new source and its host glide is
      // over: the hold is that glide window's end (read through the dev hook in the same task as the duck).
      await expect.poll(() => page.evaluate(() => {
        const L = (window as any).__aetheriaLayers, d = L.keyFit();
        const end = d.t + (L.glideUntil() - performance.now()) / 1000;
        return d.hold_until !== null && d.start_at === d.hold_until && Math.abs(d.hold_until - end) < 0.1;
      }), { message: "tone-02's rise waits for the glide window's end" }).toBe(true);
    }
    await chipSays(page, chip);
    if (hint) await expect(keyFitChip(page)).toHaveAttribute('title', new RegExp(`^${hint.replace(/[.?]/g, '\\$&')}`));
    const s = await keyFitState(page);
    if (s.sends > sends0) expect(s.tau_s, `${name}: a track's duck glides with τ 2 s`).toBe(2);
  }
  expect((await keyFitState(page)).sends, 'sends: the first, tone-02 and tone-03 (tone-04, -05 and -06 keep 0 dB)').toBe(sends0 + 2);
  expect(await pauseCount(page), 'the gapless swap ran (no pause)').toBe(pausesBefore);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('a crystal change waits for the retune\'s silence before the duck rises', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await setup(page, { output: 'headphones', keyFit: true, tones: [1, 40], seeds: [{ index: 0, crystal: 528, key: RUB_09 }] });
  await startTrack(page);
  await expect.poll(async () => (await keyFitState(page))?.target_db ?? null).toBe(-6);
  await recordSends(page);
  const before = await keyFitState(page);
  // The tap's send, with the player's state at that send (the retune pending).
  const { duck: s, player } = await pickAndSend(page, 396);
  expect(s.sends).toBe(before.sends + 1);
  // Critique M2: the plan effect asked the duck to hold any rise in flight for the retune (a holdRise call).
  expect(s.holds, 'a hold for the retune').toBeGreaterThan(before.holds);
  // RUB under 396 Hz sits well: 0 dB (critique M1: exactly +0). The rise waits for the player's retune_at (review C2).
  expect(s.target_db).toBe(0);
  expect(player.phase).toBe('retuning');
  expect(s.hold_until, "the hold is the player's retune_at").toBe(player.retune_at);
  expect(s.start_at).toBe(s.hold_until);
  const anchors = s.events.filter((e: any) => e.type === 'set' && e.t < s.start_at);
  expect(anchors.length, `an anchor before the held start (${JSON.stringify(s.events)})`).toBeGreaterThan(0);
  const anchorT = Math.max(...anchors.map((e: any) => e.t));
  expect(s.events.filter((e: any) => e.type === 'tgt' && e.t > anchorT && e.t < s.start_at), 'no glide while it waits').toEqual([]);
  expect(s.events.some((e: any) => e.type === 'tgt' && e.t === s.start_at && e.v === 1), 'the rise to unity starts at the hold').toBe(true);
  expect((await layersState(page)).requested.canonical_hz).toBe(396);
  test.info().annotations.push({ type: 'hold', description: `anchor ${anchorT.toFixed(3)} s, rise at ${s.start_at.toFixed(3)} s (retune_at)` });
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('key data that arrives mid-play reaches the playing track', async ({ page }) => {
  const errors = pageErrors(page);
  // A pure C#5 (critique m7: 120 s, so the pass finishes with the track still playing), crystal 528, no key data yet.
  const dialogs = await setup(page, {
    output: 'headphones', keyFit: true,
    files: [{ name: 'tone-01.wav', mimeType: 'audio/wav', buffer: toneWav(120, 554.37) }],
    seeds: [{ index: 0, crystal: 528, key: null }],
  });
  await startTrack(page);
  await chipSays(page, 'Key fit · no key data');
  // No key data: the duck is sent nothing and stays at unity (review C2: a check that can fail).
  const s0 = await keyFitState(page);
  expect({ sends: s0.sends, target_db: s0.target_db, value: s0.value }).toEqual({ sends: 0, target_db: 0, value: 1 });

  await analyseTune(page, { duty: 1, nativeLeftS: 0 });
  await page.getByTestId('analyse-tracks').click();
  await expect.poll(async () => (await metaRecords(page))[0]?.chroma?.length ?? 0, { timeout: 90_000, intervals: [500, 1000] }).toBe(12);
  const m = (await metaRecords(page))[0];
  // The duck v2's own module gives for the stored data, computed in the page.
  const E = await page.evaluate(async ({ chroma, a4, conf }) => {
    const V = await import('/utils/soundV2/aetheria_sound_v2.ts');
    return V.musicFit(V.toneOf(528, 'headphones'), chroma, a4 * 0.981818, conf).duck_db as number;
  }, { chroma: m.chroma, a4: m.chromaA4Hz, conf: m.keyConfidence });
  test.info().annotations.push({ type: 'fit', description: `key ${m.musicKey}, confidence ${m.keyConfidence}, A4 ${m.chromaA4Hz}: ${E} dB` });
  expect(E).toBeLessThan(-0.5);
  await expect.poll(async () => Math.abs((await keyFitState(page)).target_db - E), { timeout: 15_000 }).toBeLessThan(1e-9);
  expect((await keyFitState(page)).tau_s).toBe(2);
  await chipSays(page, `Key fit −${(-E).toFixed(1)} dB`);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('pause, stops and Music only hold the duck; tone alone plays with none @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await setup(page, { output: 'headphones', keyFit: true, tones: [1, 60], seeds: [{ index: 0, crystal: 528, key: RUB_09 }] });
  await startTrack(page);
  await expect.poll(async () => (await keyFitState(page))?.target_db ?? null).toBe(-6);
  const req0 = (await keyFitState(page)).requests, holds0 = (await keyFitState(page)).holds;

  // Pause: the chip goes and nothing is sent; a rise in flight would have been held (critique M2: a holdRise call).
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(keyFitChip(page)).toHaveCount(0);
  await page.waitForTimeout(2000);
  expect((await keyFitState(page)).requests, 'no request while paused').toBe(req0);
  expect((await keyFitState(page)).holds, 'the pause holds the duck').toBeGreaterThan(holds0);

  // A frequency tapped while paused plays the tone alone: no duck, its rise held for the tone-alone voice's retune (the
  // player's retune_at at that send: review C2).
  await recordSends(page);
  const tap = await pickAndSend(page, 528);
  let s = tap.duck;
  expect(s.target_db).toBe(0);
  expect(tap.player.phase).toBe('retuning');
  expect(s.hold_until, "the hold is the player's retune_at").toBe(tap.player.retune_at);
  expect(s.start_at).toBe(s.hold_until);
  await chipSays(page, 'Key fit · tone alone');

  // Play: the track's duck again, a fall, at once.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await keyFitState(page)).target_db).toBe(-6);
  s = await keyFitState(page);
  expect(s.events.some((e: any) => e.type === 'set' && e.t === s.start_at), 'the fall starts at its own call').toBe(true);
  expect(s.events.some((e: any) => e.type === 'tgt' && e.t === s.start_at && Math.abs(e.v - G6) < 1e-12)).toBe(true);
  await chipSays(page, 'Key fit −6.0 dB');

  // Music only: the chip goes, nothing is sent; off again, the duck is where it was (nothing to send).
  await openHarmonicControl(page);
  const musicOnly = page.getByRole('switch', { name: 'Music only' });
  const req1 = (await keyFitState(page)).requests, sends1 = (await keyFitState(page)).sends, holds1 = (await keyFitState(page)).holds;
  await musicOnly.click();
  await expect(musicOnly).toHaveAttribute('aria-checked', 'true');
  await expect(keyFitChip(page)).toHaveCount(0);
  // Review B3: the card says nothing applies now, and what would when the layers play.
  await expect(keyFitStatus(page)).toHaveText('On. The layers are off now; on this track they would be 6.0 dB softer.');
  await page.waitForTimeout(2000);
  expect((await keyFitState(page)).requests, 'no request under Music only').toBe(req1);
  expect((await keyFitState(page)).holds, 'Music only (stopLayersNow) holds the duck').toBeGreaterThan(holds1);
  await musicOnly.click();
  await expect(musicOnly).toHaveAttribute('aria-checked', 'false');
  await chipSays(page, 'Key fit −6.0 dB');
  await expect(keyFitStatus(page)).toHaveText('On. On this track the layers are 6.0 dB softer.');
  s = await keyFitState(page);
  expect(s.target_db).toBe(-6);
  expect(s.sends, 'nothing to send coming back').toBe(sends1);

  // Emergency Stop.
  const req2 = (await keyFitState(page)).requests;
  await openSafety(page);
  await page.getByRole('button', { name: 'Emergency Stop' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.waitForTimeout(2000);
  expect((await keyFitState(page)).requests, 'no request after Emergency Stop').toBe(req2);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('leaving v2 keeps the duck, and the next player plays through it', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await carAtMinus6(page);
  const d0 = await keyFitState(page);

  await engineButton(page, 'Classic').click();
  await expect.poll(() => layersCreated(page), { timeout: 10_000, message: 'the v2 player is disposed 3 s after leaving' }).toBe(false);
  let s = await keyFitState(page);
  expect({ target_db: s.target_db, created_at: s.created_at, sends: s.sends }).toEqual({ target_db: -6, created_at: d0.created_at, sends: d0.sends });

  await engineButton(page, 'v2').click();
  await expect.poll(() => layersCreated(page), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  s = await keyFitState(page);
  expect(s.created_at, 'the same duck').toBe(d0.created_at);
  expect(s.sends, 'nothing to send: −6 was already the target').toBe(d0.sends);
  // Classic's tone and beat stop 2 s after v2 takes over; then only v2's tone is on the bus.
  await expect.poll(async () => (await layerState(page)).toneSounding, { timeout: 10_000 }).toBe(false);
  await settled(page, G6);
  const r1 = await meanLayerRms(page);
  await keyFitSwitch(page).click();
  await expect.poll(async () => (await keyFitState(page)).value, { timeout: 3_000 }).toBeGreaterThan(0.999);
  const r2 = await meanLayerRms(page);
  test.info().annotations.push({ type: 'rms', description: `R1 ${r1.toExponential(4)}, R2 ${r2.toExponential(4)}; R2/R1 ${(r2 / r1).toFixed(4)}` });
  expect(r2 / r1, 'the new player plays through the duck').toBeGreaterThanOrEqual(1.85);
  expect(r2 / r1).toBeLessThanOrEqual(2.15);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('the sound log records the switch and the duck that applied', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await setup(page, {
    output: 'headphones', keyFit: true, tones: [2, 10],
    seeds: [{ index: 0, crystal: 528, key: RUB_09 }, { index: 1, crystal: 528, key: RUB_06 }],
  });
  await openHarmonicControl(page);
  await startTrack(page);
  await chipSays(page, 'Key fit −6.0 dB');
  await expect(page.getByTestId('now-playing-title')).toHaveText('tone-02', { timeout: 15_000 });
  await chipSays(page, 'Key fit −3.0 dB');
  await keyFitSwitch(page).click();
  await expect(keyFitChip(page)).toHaveCount(0);

  const wanted = [
    { key_fit: true, duck_db: -6, fit_db: -6, track_key: 'C#' },
    { key_fit: true, duck_db: -3, fit_db: -3, key_confidence: 0.6 },
    { key_fit: false, duck_db: 0, fit_db: -3 },
  ];
  const matched = async (): Promise<number> => {
    const raw = await stored(page, SOUND_LOG_KEY);
    const sessions: any[] = raw ? JSON.parse(raw) : [];
    const open = [...sessions].sort((a, b) => a.started - b.started).at(-1);
    let k = 0;
    for (const e of open?.entries ?? []) if (k < wanted.length && Object.entries(wanted[k]).every(([f, v]) => e[f] === v)) k++;
    return k;
  };
  await expect.poll(matched, { timeout: 15_000, intervals: [500, 1000] }).toBe(3);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('on a 411 px phone the chip never breaks mid-label, and without it the status row is v15.1\'s @mobile', async ({ page }) => {
  // Review B2: the transport's status row at the user's phone width. With the chip, whole chips wrap onto a second line
  // (no chip breaks mid-label, none runs off the screen); without it, the chips' row is exactly v15.1's.
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 411, height: 752 });
  const dialogs = await setup(page, { output: 'headphones', keyFit: true, tones: [1, 60], seeds: [{ index: 0, crystal: 528, key: RUB_09 }] });
  await startTrack(page);
  await chipSays(page, 'Key fit −6.0 dB');
  const group = page.getByTestId('layers-badge').locator('xpath=..');
  /** The chips' row: its class, the Hz pill's height (one word: always one line) and each chip's height and edges. */
  const rowOf = () => group.evaluate((g) => {
    const kids = [...g.children].filter((c) => c.getAttribute('data-testid') !== 'transport-time');
    const r = (c: Element) => c.getBoundingClientRect();
    return {
      cls: g.className, pill: r(kids[0]).height,
      chips: kids.map((c) => ({ t: (c.textContent ?? '').trim(), h: r(c).height, l: r(c).left, right: r(c).right })),
      width: window.innerWidth,
    };
  });
  const on = await rowOf();
  test.info().annotations.push({ type: 'row with the chip', description: JSON.stringify(on) });
  expect(on.chips.some((c) => c.t === 'Key fit −6.0 dB')).toBe(true);
  for (const c of on.chips) {
    expect(c.h, `${c.t}: one line (the Hz pill is ${on.pill} px)`).toBeLessThanOrEqual(on.pill + 1);
    expect(c.l, `${c.t}: on the screen`).toBeGreaterThanOrEqual(0);
    expect(c.right, `${c.t}: on the screen`).toBeLessThanOrEqual(on.width);
  }

  // Key fit off: no chip, and the chips' row is v15.1's own markup (v15.1 lets the layers badge break here: the row then
  // renders exactly as it did).
  await openHarmonicControl(page);
  await keyFitSwitch(page).click();
  await expect(keyFitChip(page)).toHaveCount(0);
  const off = await rowOf();
  test.info().annotations.push({ type: 'row without the chip', description: JSON.stringify(off) });
  expect(off.cls).toBe('flex items-center gap-2');
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('if the duck cannot be made, nothing claims a duck: the chip, the card and the sound log say none applies', async ({ page }) => {
  // Review B6. Only the duck's GainNode fails (the stack names its constructor; the dev server keeps the names), so the
  // v2 player is made and plays straight into the bus, as App's fallback does.
  const errors = pageErrors(page);
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await page.addInitScript(() => {
    const proto = (window as any).BaseAudioContext.prototype;
    const make = proto.createGain;
    proto.createGain = function (...a: unknown[]) {
      if ((new Error().stack ?? '').includes('KeyFitDuck')) throw new Error('test: no duck on this engine');
      return make.apply(this, a);
    };
  });
  const dialogs = await setup(page, { output: 'headphones', keyFit: true, tones: [1, 60], seeds: [{ index: 0, crystal: 528, key: RUB_09 }] });
  await openHarmonicControl(page);
  await startTrack(page);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  expect(await keyFitState(page), 'no duck').toBeNull();
  await chipSays(page, 'Key fit · unavailable');
  await expect(keyFitChip(page)).toHaveAttribute('title', 'Key fit could not start on this device, so the layers play at their set level.');
  await expect(keyFitStatus(page)).toHaveText('On. Key fit could not start on this device, so the layers play at their set level.');
  // The sound log: the switch is on, the duck that applied is 0 (the would-be −6 rides along as fit_db), and no entry
  // claims a duck.
  const entries = async (): Promise<any[]> => {
    const raw = await stored(page, SOUND_LOG_KEY);
    const sessions: any[] = raw ? JSON.parse(raw) : [];
    return [...sessions].sort((a, b) => a.started - b.started).at(-1)?.entries ?? [];
  };
  await expect.poll(async () => (await entries()).some((e) => e.key_fit === true && Object.is(e.duck_db, 0) && e.fit_db === -6), { timeout: 15_000, intervals: [500, 1000] }).toBe(true);
  expect((await entries()).filter((e) => typeof e.duck_db === 'number' && e.duck_db !== 0), 'no entry claims a duck').toEqual([]);
  expect(consoleErrors.some((t) => t.includes('Key fit unavailable')), 'App logs the failure').toBe(true);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});
