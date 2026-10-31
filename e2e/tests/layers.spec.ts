import { chromium, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  openApp,
  acceptDisclaimer,
  importTones,
  addFiles,
  toneWav,
  elapsedSeconds,
  expectCache,
  pauseCount,
  instrumentAudio,
  layerState,
  openHarmonicControl,
  tapTraditional,
  layerIntensity,
  openSafety,
  LAYER_ENGINE_KEY,
  LAYER_OUTPUT_KEY,
  LAYER_OUTPUT_ASK_AGAIN_KEY,
  DRONE_KEY,
  SOUND_LOG_KEY,
  TONE_LEVEL_V2_KEY,
  TONE_LEVEL_CLASSIC_KEY,
  setSlider,
  seedLayers,
  layersState,
  layersCreated,
  isMobileBuild,
  busRms,
  recordStops,
  stopsSince,
  writeBandEnvelope,
} from './helpers';

// v14.9 Layers v2 (sound Phase 1): the "Layer sound: v2 / classic" A/B. The v2
// player is read through the app's dev hook (helpers.layersState: its state(),
// the mirror of every gain it scheduled); classic through the instrumented
// Web Audio graph (helpers.instrumentAudio). Under v2, layerState's bus still
// reads classic's layer bus, but its drone, toneTargets and envMax may be the
// player's, so v2 checks use layersState. v15.0: v2 is the default (a new
// profile plays v2, asks for its output once, and saves no choice until
// tapped); its tone level starts at the slider's lowest step before off, and
// each engine keeps its own level, saved only when its slider is moved.
// openApp saves Classic for the classic tests unless told { engine: 'default' }
// (or seedLayers chooses v2). Host levels at the default volume 0.8: tone only
// 0.8 on every device (no music, so no duck to follow); with music
// (phone ? 0.625 : 0.8) × the φ envelope. Every test ends with no dialog and no
// page error.

const TONE_TARGET = 0.100228; // classic's tone ramp at the defaults (sound.spec)
const BUS = 0.4; // classic's layer bus at volume 0.8
const DRONE = 0.08; // classic's sub-bass drone while playing at volume 0.8 (sound.spec)

/** Uncaught page errors from now on. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Dialogs a page raises from now on, dismissed (openApp does this for the app). */
function pageDialogs(page: Page): string[] {
  const dialogs: string[] = [];
  page.on('dialog', async (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    await d.dismiss();
  });
  return dialogs;
}

const engineButton = (page: Page, name: 'Classic' | 'v2') =>
  page.getByRole('group', { name: 'Layer sound: v2 / classic' }).getByRole('button', { name, exact: true });
const outputButton = (page: Page, name: 'Headphones' | 'Speakers' | 'Phone speaker' | 'Car') =>
  page.getByRole('group', { name: 'Output', exact: true }).getByRole('button', { name, exact: true });
const outputSheet = (page: Page) => page.getByTestId('output-sheet');
const sheetButton = (page: Page, name: string) => outputSheet(page).getByRole('button', { name, exact: true });
const musicOnlySwitch = (page: Page) => page.getByRole('switch', { name: 'Music only' });
const droneSwitch = (page: Page) => page.getByRole('switch', { name: 'Sub-bass drone' });
const badge = (page: Page) => page.getByTestId('layers-badge');
const quickSwitch = (page: Page) => page.getByTestId('layers-quick-switch');
/** The status row's band chip (the Waves icon), beside the badge. */
const bandChip = (page: Page) =>
  page.getByTestId('now-playing-title').locator('xpath=..').locator('span:has(> svg.lucide-waves)');
const chipText = async (page: Page) => ((await bandChip(page).textContent()) ?? '').trim();
const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
/** The A/B keys localStorage holds, with their values. */
const storedLayerKeys = (page: Page) =>
  page.evaluate(
    (keys) => Object.fromEntries(keys.flatMap((k) => (localStorage.getItem(k) === null ? [] : [[k, localStorage.getItem(k)]]))),
    [LAYER_ENGINE_KEY, LAYER_OUTPUT_KEY, LAYER_OUTPUT_ASK_AGAIN_KEY, DRONE_KEY, SOUND_LOG_KEY]
  );
/** The saved output and a pending "Ask me again" ('1'), null when unset. */
const storedOutput = async (page: Page) =>
  ({ output: await stored(page, LAYER_OUTPUT_KEY), askAgain: await stored(page, LAYER_OUTPUT_ASK_AGAIN_KEY) });
/** The tone level keys localStorage holds, with their values. */
const storedToneKeys = (page: Page) =>
  page.evaluate(
    (keys) => Object.fromEntries(keys.flatMap((k) => (localStorage.getItem(k) === null ? [] : [[k, localStorage.getItem(k)]]))),
    [TONE_LEVEL_V2_KEY, TONE_LEVEL_CLASSIC_KEY]
  );
/** v2's tone slider and its readout in Harmonic Control; classic's slider is the "Layer Intensity" one. */
const toneSlider = (page: Page) => page.getByRole('slider', { name: 'Tone level' });
const toneReadoutText = (page: Page) => page.getByText('Tone level', { exact: true }).locator('xpath=following-sibling::span[1]');
const classicToneSlider = (page: Page) => page.getByText('Layer Intensity', { exact: true }).locator('xpath=../../input');
/** v2's release default (v15.0), the slider's lowest step before off, as Harmonic Control reads it. */
const V2_DEFAULT_READOUT = '−26.0 dB · −52.0 dB re music';
const pageNow = (page: Page) => page.evaluate(() => performance.now());

/** A track's row in the list (after a reload the now-playing title shows the same name). */
const listed = (page: Page, name: string) => page.getByRole('complementary').getByText(name, { exact: true });

/** Play an imported track from the list and wait until it is under way. */
async function startTrack(page: Page, name = 'tone-01'): Promise<void> {
  await listed(page, name).click();
  await expect.poll(() => elapsedSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
}

/** Click from inside the page and return its performance.now() at that instant, so a timing check starts at the
 *  click itself (Playwright's own click runs its actionability checks first). */
async function clickAt(target: Locator): Promise<number> {
  await target.waitFor();
  return target.evaluate((el) => {
    const t = performance.now();
    (el as HTMLElement).click();
    return t;
  });
}

/**
 * Tap `target` and time the v2 stop that follows: when App asks the player to fall (setHostLevel(0, { glideS }),
 * stamped at the call; the live player comes from its registry, utils/soundV2/layerPlayer.ts), the fall it asks
 * for, and the host level read glideS + 50 ms after that call. The e2e server is a dev build: its React commits
 * (~60/s while playing) put 0–330 ms between a tap and the effect and can hold the page for as long again, so no
 * sampled time is precise here, but a read that comes late can only find the host lower.
 */
async function tapAndTimeStop(
  target: Locator
): Promise<{ stopAt: number; reactMs: number; glideS: number; hostAfter: number; readS: number }> {
  await target.waitFor();
  return target.evaluate(async (el) => {
    const hook = (window as any).__aetheriaLayers;
    const player = ((globalThis as any)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [])[0];
    if (!player) throw new Error('No live v2 player to stop');
    const t0 = performance.now();
    let stop: { at: number; t: number; glideS: number } | null = null;
    const setHostLevel = player.setHostLevel;
    player.setHostLevel = function (x: number, opts?: { glideS?: number }) {
      if (!stop && x === 0 && opts?.glideS !== undefined) stop = { at: performance.now(), t: player.state().t, glideS: opts.glideS };
      return setHostLevel.call(this, x, opts);
    };
    try {
      (el as HTMLElement).click();
      while (!stop && performance.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10));
    } finally {
      delete player.setHostLevel; // the prototype's again
    }
    if (!stop) return { stopAt: -1, reactMs: -1, glideS: -1, hostAfter: -1, readS: -1 };
    const { at, t, glideS } = stop;
    await new Promise((r) => setTimeout(r, Math.max(0, at + glideS * 1000 + 50 - performance.now())));
    const s = hook.state();
    return { stopAt: at, reactMs: at - t0, glideS, hostAfter: s ? s.host_level : -1, readS: s ? s.t - t : -1 };
  });
}

/** The vendored φ envelope (utils/soundV2/aetheria_sound_v2.ts, phiEnvelope; pinned), written out: 0 → 0.8 at 38.2 %
 *  → 1 at 61.8 % → 0.8 at the end. */
function phiEnvelope(position: number, duration: number): number {
  const PHI = 1.6180339887, INV_PHI = 0.6180339887, INV_PHI2 = 0.3819660113;
  if (duration <= 0) return 1;
  const p = Math.min(1, Math.max(0, position / duration));
  if (p < INV_PHI2) return 0.8 * Math.pow(p / INV_PHI2, PHI);
  if (p < INV_PHI) return 0.8 + (0.2 * (p - INV_PHI2)) / (INV_PHI - INV_PHI2);
  return Math.pow(1 - (0.3 * (p - INV_PHI)) / INV_PHI2, INV_PHI);
}

/**
 * For `ms`, record every host level App sends the live v2 player (a spy on its setHostLevel, found through the
 * registry as in tapAndTimeStop) with the music element's position and duration read in that same call — the same
 * task, so the currentTime App's level was computed from — and the player's host mirror just before the level lands.
 * Needs instrumentAudio (the music element).
 */
async function recordHostLevels(page: Page, ms: number) {
  return page.evaluate(async (ms) => {
    const w = window as any;
    const player = ((globalThis as any)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [])[0];
    const el: HTMLMediaElement | null = w.__audio?.music ?? null;
    if (!player || !el) throw new Error('recordHostLevels needs a live v2 player and the music element (instrumentAudio)');
    const sent: { x: number; glideS: number | null; pos: number; dur: number; hostBefore: number }[] = [];
    const setHostLevel = player.setHostLevel;
    player.setHostLevel = function (x: number, opts?: { glideS?: number }) {
      sent.push({ x, glideS: opts?.glideS ?? null, pos: el.currentTime, dur: el.duration, hostBefore: player.state().host_level });
      return setHostLevel.call(this, x, opts);
    };
    try {
      await new Promise((r) => setTimeout(r, ms));
    } finally {
      delete player.setHostLevel; // the prototype's again
    }
    return sent;
  }, ms);
}

/** The output question's card. */
const sheetCard = (page: Page) => outputSheet(page).locator('xpath=./div[1]');

/** The open output question sits between the header and the player bar (v15.0: it is every new profile's first
 *  play), so neither is covered: the card ends above the bar and starts below the header's buttons, and the
 *  transport answers a plain click (Playwright's own: it fails if anything covers Pause). Leaves the music playing. */
async function expectSheetClearOfTheBar(page: Page, where: string): Promise<void> {
  const card = await sheetCard(page).boundingBox();
  const bar = await page.getByTestId('player-bar').boundingBox();
  const gear = await page.getByRole('button', { name: 'Harmonic Control', exact: true }).boundingBox();
  expect(card && bar && gear, `${where}: the sheet, the player bar and the header are on screen`).toBeTruthy();
  test.info().annotations.push({
    type: 'sheet',
    description: `${where}: card ${card!.y.toFixed(0)}–${(card!.y + card!.height).toFixed(0)} px, header buttons end ${(gear!.y + gear!.height).toFixed(0)}, bar starts ${bar!.y.toFixed(0)}`,
  });
  expect(card!.y + card!.height, `${where}: the sheet's bottom vs the player bar's top`).toBeLessThanOrEqual(bar!.y + 0.5);
  expect(card!.y, `${where}: the sheet's top vs the header buttons' bottom`).toBeGreaterThanOrEqual(gear!.y + gear!.height - 0.5);
  await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(outputSheet(page), `${where}: the question stays until it is answered`).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
}

/** The tap stops the v2 layers: App asks within 1 s (dev server), for a `glideS` fall, and the host is silent by
 *  then. Returns when App stopped them (the page's performance.now()). */
async function expectStop(target: Locator, glideS: number, what: string): Promise<number> {
  const stop = await tapAndTimeStop(target);
  test.info().annotations.push({
    type: 'stop',
    description: `${what}: App ${stop.reactMs.toFixed(0)} ms, fall ${stop.glideS} s, host ${stop.hostAfter} read ${stop.readS.toFixed(3)} s after it`,
  });
  expect(stop.reactMs, `${what}: ms until App stops the v2 layers (-1 = it never did)`).toBeGreaterThanOrEqual(0);
  expect(stop.reactMs, `${what}: ms until App stops the v2 layers`).toBeLessThanOrEqual(1000);
  expect(stop.glideS, `${what}: the stop's fall, s`).toBe(glideS);
  expect(stop.hostAfter, `${what}: the host ${glideS} s after the stop`).toBeGreaterThanOrEqual(0);
  expect(stop.hostAfter, `${what}: the host ${glideS} s after the stop`).toBeLessThan(1e-3);
  return stop.stopAt;
}

test('v2 is the default: a new profile plays v2, asks for its output once, and saves no choice until tapped @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await openApp(page, { engine: 'default' });
  await openHarmonicControl(page);
  await expect(engineButton(page, 'v2')).toHaveAttribute('aria-pressed', 'true');
  await expect(engineButton(page, 'Classic')).toHaveAttribute('aria-pressed', 'false');
  // The pressed default is not a choice: tapping it saves nothing, so the profile keeps following the release default.
  await engineButton(page, 'v2').click();
  await expect(engineButton(page, 'v2')).toHaveAttribute('aria-pressed', 'true');
  // v2's chrome shows from the start: the badge (output not answered yet) and the quick switch.
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Headphones (assumed)');
  await expect(quickSwitch(page)).toBeVisible();

  // The first play asks for the output; the music and the v2 layers play meanwhile, as headphones. The question
  // leaves the player bar free: Pause and Play work while it is open.
  await importTones(page, 1, 30);
  await startTrack(page);
  await expect(outputSheet(page)).toBeVisible();
  await expectSheetClearOfTheBar(page, 'desktop size');
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  expect((await layersState(page)).requested.render).toBe('binaural');
  expect(await layersCreated(page)).toBe(true);
  // Classic's layer bus starts (and stays) at 0, and classic builds no tone.
  const c = await layerState(page);
  expect(c.busFirst).toBe(0);
  expect(c.toneSounding).toBe(false);
  // Still no choice saved: no engine, output, drone, sound log or tone level key.
  expect(await storedLayerKeys(page)).toEqual({});
  expect(await storedToneKeys(page)).toEqual({});

  // Answered once per device: saved, and not asked again.
  await sheetButton(page, 'Headphones').click();
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await storedLayerKeys(page)).toEqual({ [LAYER_OUTPUT_KEY]: 'headphones' });
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Headphones');
  await expectCache(page, { blobs: 1, library: 1 });
  await page.reload();
  await acceptDisclaimer(page);
  await startTrack(page);
  await page.waitForTimeout(1000);
  await expect(outputSheet(page)).toHaveCount(0);
  // Still v2, by default: the engine was never saved.
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Headphones');
  expect(await stored(page, LAYER_ENGINE_KEY)).toBeNull();
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('the engine choice is saved only when tapped and survives a reload', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page, { engine: 'default' });
  await openHarmonicControl(page);
  await engineButton(page, 'Classic').click();
  await expect(engineButton(page, 'Classic')).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page, LAYER_ENGINE_KEY)).toBe('classic');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers classic');

  await page.reload();
  await acceptDisclaimer(page);
  await openHarmonicControl(page);
  await expect(engineButton(page, 'Classic')).toHaveAttribute('aria-pressed', 'true');
  await expect(engineButton(page, 'v2')).toHaveAttribute('aria-pressed', 'false');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers classic');

  // v2, chosen this time: saved, so it holds even if the default ever changes.
  await engineButton(page, 'v2').click();
  await expect(engineButton(page, 'v2')).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page, LAYER_ENGINE_KEY)).toBe('v2');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Headphones (assumed)');
  await page.reload();
  await acceptDisclaimer(page);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Headphones (assumed)');
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('classic, once chosen, plays as it did and never creates the v2 player or asks for an output @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await openApp(page); // Classic chosen, as a tap on it would
  await openHarmonicControl(page);
  await expect(engineButton(page, 'Classic')).toHaveAttribute('aria-pressed', 'true');
  await expect(engineButton(page, 'v2')).toHaveAttribute('aria-pressed', 'false');

  await importTones(page, 1, 30);
  await startTrack(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layerState(page)).toneTargets.length).toBeGreaterThan(1);
  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: 0, tau: 0.25 });
  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: BUS, tau: 0.25 });

  // v14.7's levels (sound.spec) at classic's own 1 %, and nothing of v2: no player, no output question, no v2 key.
  await expect(layerIntensity(page)).toHaveText('1%');
  const s = await layerState(page);
  expect(s.busFirst).toBeCloseTo(BUS, 6);
  for (const t of s.toneTargets) expect(t).toBeCloseTo(TONE_TARGET, 6);
  expect(s.toneSounding).toBe(true);
  expect(await layersCreated(page)).toBe(false);
  expect(await layersState(page)).toBeNull();
  await expect(outputSheet(page)).toHaveCount(0);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers classic');
  expect(await stored(page, LAYER_ENGINE_KEY)).toBe('classic');
  expect(await stored(page, LAYER_OUTPUT_KEY)).toBeNull();
  expect(await stored(page, DRONE_KEY)).toBeNull();
  expect(await storedToneKeys(page)).toEqual({});
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

const CLASSIC_OUTPUT_NOTE =
  'Output and Car apply to v2. Classic plays its beat and drone whatever the output: for driving, use v2 with Car output, or Music only.';
const classicNote = (page: Page) => page.getByTestId('classic-output-note');

test('classic chosen with Car saved says Car is v2 only, and plays its tone, beat and drone as before @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await openApp(page); // Classic chosen, as a tap on it would
  await seedLayers(page, { output: 'car' }); // as a v2 visit would have saved it
  await openHarmonicControl(page);
  await expect(engineButton(page, 'Classic')).toHaveAttribute('aria-pressed', 'true');
  // Classic has no output: the panel says where Car is, since its Output group is v2's.
  await expect(classicNote(page)).toHaveText(CLASSIC_OUTPUT_NOTE);
  await expect(page.getByRole('group', { name: 'Output', exact: true })).toHaveCount(0);

  // The sound is classic's, Car or not (copy only): the tone at its validated level on a 0.4 bus, the beat and the drone.
  await importTones(page, 1, 30);
  await startTrack(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layerState(page)).toneTargets.length).toBeGreaterThan(1);
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBeCloseTo(DRONE, 6);
  const s = await layerState(page);
  expect(s.busFirst).toBeCloseTo(BUS, 6);
  expect(s.busLast?.target).toBeCloseTo(BUS, 6);
  for (const t of s.toneTargets) expect(t).toBeCloseTo(TONE_TARGET, 6);
  expect(s.toneSounding).toBe(true);
  expect(s.mergerCount, "classic's binaural pair").toBeGreaterThan(0);
  expect(await layersCreated(page)).toBe(false);
  await expect(outputSheet(page)).toHaveCount(0);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers classic');
  expect(await stored(page, LAYER_OUTPUT_KEY)).toBe('car');

  // Under v2 the line goes: the Output group shows Car itself.
  await engineButton(page, 'v2').click();
  await expect(classicNote(page)).toHaveCount(0);
  await expect(outputButton(page, 'Car')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test("the tone level: v2 starts at its lowest step before off, classic at its 1 %, and the player gets v2's @mobile", async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page, { engine: 'default' });
  await openHarmonicControl(page);
  // v2, the default: one step above off (0.0005), 26 dB under its validated level.
  await expect(toneReadoutText(page)).toHaveText(V2_DEFAULT_READOUT);
  await expect(toneSlider(page)).toHaveValue('0.0005');
  await expect(toneSlider(page)).toHaveAttribute('step', '0.0005');
  await expect(toneSlider(page)).toHaveAttribute('min', '0');
  await expect(toneSlider(page)).toHaveAttribute('aria-valuetext', V2_DEFAULT_READOUT);
  // Classic keeps its own default; v2's comes back with v2. Flipping engines saves no level.
  await engineButton(page, 'Classic').click();
  await expect(layerIntensity(page)).toHaveText('1%');
  await engineButton(page, 'v2').click();
  await expect(toneReadoutText(page)).toHaveText(V2_DEFAULT_READOUT);
  // The Safety panel reads v2's level in dB too (0.05 % would round to "0%").
  await openSafety(page);
  await expect(page.getByText('Volume', { exact: true }).locator('xpath=following-sibling::span[1]')).toHaveText(V2_DEFAULT_READOUT);
  await page.getByTitle('Close Safety Protocols').click();
  // So does Effects Documentation's session panel; classic's stays a percent.
  await page.getByRole('button', { name: 'Start Experience Documentation' }).click();
  await page.getByRole('button', { name: 'Start Documenting', exact: true }).click();
  const documentedVolume = page.getByText('Volume:', { exact: true }).locator('xpath=..');
  await expect(documentedVolume).toHaveText(`🔊 Volume: ${V2_DEFAULT_READOUT}`);
  await engineButton(page, 'Classic').click();
  await expect(documentedVolume).toHaveText('🔊 Volume: 1%');
  await engineButton(page, 'v2').click();
  await expect(documentedVolume).toHaveText(`🔊 Volume: ${V2_DEFAULT_READOUT}`);

  // The player plays that level: 0.0005 over the 0.01 that is 0 dB.
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.gains?.tone ?? -1).toBeCloseTo(0.05, 9);
  expect(await storedToneKeys(page)).toEqual({});
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test("each engine remembers its own tone level across a reload, saved only when the user moves that engine's slider", async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page, { engine: 'default' });
  await openHarmonicControl(page);
  // v2 (the default): moved to 0.002, saved under v2's key alone.
  await setSlider(toneSlider(page), 0.002);
  await expect(toneReadoutText(page)).toHaveText('−14.0 dB · −40.0 dB re music');
  expect(await storedToneKeys(page)).toEqual({ [TONE_LEVEL_V2_KEY]: '0.002' });
  await page.reload();
  await acceptDisclaimer(page);
  await openHarmonicControl(page);
  await expect(toneReadoutText(page)).toHaveText('−14.0 dB · −40.0 dB re music');

  // Classic has its own level, its default until moved; moving it saves under classic's key alone.
  await engineButton(page, 'Classic').click();
  await expect(layerIntensity(page)).toHaveText('1%');
  expect(await storedToneKeys(page)).toEqual({ [TONE_LEVEL_V2_KEY]: '0.002' });
  await setSlider(classicToneSlider(page), 0.05);
  await expect(layerIntensity(page)).toHaveText('5%');
  expect(await storedToneKeys(page)).toEqual({ [TONE_LEVEL_V2_KEY]: '0.002', [TONE_LEVEL_CLASSIC_KEY]: '0.05' });
  await page.reload();
  await acceptDisclaimer(page);
  await openHarmonicControl(page);
  await expect(layerIntensity(page)).toHaveText('5%');

  // Back to v2: its own level, which the player plays (0.002 / 0.01 = 0.2, −14 dB).
  await engineButton(page, 'v2').click();
  await expect(toneReadoutText(page)).toHaveText('−14.0 dB · −40.0 dB re music');
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.gains?.tone ?? -1).toBeCloseTo(0.2, 9);
  expect(await storedToneKeys(page)).toEqual({ [TONE_LEVEL_V2_KEY]: '0.002', [TONE_LEVEL_CLASSIC_KEY]: '0.05' });
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('the disclaimer shows once more for the v15.0 driving line, word for word', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = pageDialogs(page);
  // A device that accepted the earlier wording (v14.6's version '2026-04-16'), on its first load only.
  await page.addInitScript(() => {
    localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
    if (sessionStorage.getItem('__acceptedOld') === null) {
      sessionStorage.setItem('__acceptedOld', '1');
      localStorage.setItem('aetheria.disclaimer.v1', '2026-04-16');
    }
  });
  await page.goto('/');
  const disclaimer = page.getByTestId('disclaimer');
  await expect(disclaimer).toBeVisible();
  const audioWarning = disclaimer.getByRole('heading', { name: 'Audio Warning' }).locator('xpath=following-sibling::p[1]');
  await expect(audioWarning).toContainText(
    "Beats and the drone are for when you can relax. While driving, use Car output (only the music and a quiet tone) and your car's own controls."
  );
  await expect(disclaimer).not.toContainText('Do not use while driving');
  // The old line's other half stays, as its own sentence after the new one.
  await expect(audioWarning).toContainText("and your car's own controls. Do not use while operating heavy machinery. Start at low volume");
  await page.getByRole('button', { name: /I understand, let me begin/ }).click();
  await expect(disclaimer).toHaveCount(0);
  expect(await stored(page, 'aetheria.disclaimer.v1')).toBe('2026-10-21');
  // Once: accepted, it stays away.
  await page.reload();
  await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
  await expect(disclaimer).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test("v2: a first tap plays the tone alone, at the music's level and v2's default tone level @mobile", async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  // The gate opens over 2.5 s. Timed in the page on the player's own clock (state().t, the AudioContext's) from its
  // first state: the tap itself creates the context, and a click's round trip would eat the margin.
  const openS = await page.evaluate(async () => {
    const hook = (window as any).__aetheriaLayers;
    const end = performance.now() + 10_000;
    let t0: number | null = null;
    while (performance.now() < end) {
      const s = hook.state();
      if (s?.requested) {
        if (t0 === null) t0 = s.t as number;
        if (s.gates.tone_beat >= 1) return s.t - t0;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return -1;
  });
  test.info().annotations.push({ type: 'gate', description: `open ${openS.toFixed(3)} s after the first state` });
  expect(openS, 'audio-clock s until the gate is open (-1 = not within 10 s)').toBeGreaterThanOrEqual(0);
  expect(openS, 'audio-clock s until the gate is open').toBeLessThanOrEqual(3);

  const s = await layersState(page);
  expect(s.requested.render).toBe('off');
  expect(s.sounding.tone_hz).toBe(528);
  expect(s.sounding.partner_hz).toBe(0);
  expect(s.sounding.drone_hz).toBe(0);
  // The host is the volume, 0.8, on every device: no music plays, so there is no duck to follow.
  expect(Math.abs(s.host_level - 0.8), `host ${s.host_level}`).toBeLessThanOrEqual(0.001);
  // v2's default tone level (v15.0), the slider's lowest step before off: 0.0005 / 0.01 = 0.05 (−26 dB).
  expect(s.gains.tone).toBeCloseTo(0.05, 9);
  // Classic's layer bus started (and stays) at 0, and the open tone is really on the master bus:
  // 0.0501 × 0.8 × 0.05 = 0.002 peak, an RMS of 0.0028 through the visualizer's ×2.
  expect((await layerState(page)).busFirst).toBe(0);
  await expect.poll(() => busRms(page), { timeout: 1_000 }).toBeGreaterThan(0.002);
  expect(await busRms(page)).toBeLessThan(0.004);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('v2: a tap while a track is paused plays the tone at the same level @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 1, 30);
  await startTrack(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.render ?? null).toBe('off');
  // The paused element sits ~1 s into its φ envelope (0.8 × phiEnvelope(1, 30) ≈ 0.012): a tone-only voice ignores
  // it. The rise may wait for the pause's fades to finish (no swell), hence the poll.
  await expect
    .poll(async () => Math.abs((await layersState(page)).host_level - 0.8), { timeout: 5_000, message: 'host level − 0.8' })
    .toBeLessThanOrEqual(0.001);
  expect((await layersState(page)).requested.tone_hz).toBe(528);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('v2: playing asks for the output once and shapes the layers for it @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2' });
  await importTones(page, 1, 30);
  await startTrack(page);
  await expect(outputSheet(page)).toBeVisible();
  await openHarmonicControl(page);
  await tapTraditional(page, 528);

  // Unanswered, the layers play as headphones: the binaural beat at Alpha and the drone.
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  const h = (await layersState(page)).requested;
  expect(h.render).toBe('binaural');
  expect(h.carrier_hz).toBe(264);
  expect(Math.abs(h.partner_hz - 274), `partner ${h.partner_hz}`).toBeLessThan(0.05);
  expect(h.drone_hz).toBe(33);
  // The music itself is untouched (applyMusicElementVolume at the defaults: 0.8, a phone min(1, 0.8 × 1.6)),
  // and classic's layer bus is held at 0.
  const c = await layerState(page);
  const mobile = await isMobileBuild(page);
  expect(c.music?.volume).toBeCloseTo(mobile ? 1 : 0.8, 6);
  expect(c.busLast?.target).toBe(0);

  // The host the layers sit under while music plays: the music's own level × the φ envelope at the element's
  // position, (phone ? min(0.8, 0.625) : 0.8) × phiEnvelope(pos, dur). Past the track start's 2 s glide window and
  // the 528 retune (a host rise waits for its closes, A8), each level App sends must be exactly that at the position
  // it was read, and the player's mirror, just before each lands, lies within the three before it (0.25 s ramps on a
  // 4 Hz tick that this busy dev page delays and bunches; ±0.1 dB for a resend it keeps as a remainder).
  await expect.poll(() => elapsedSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(5);
  await expect.poll(async () => (await layersState(page)).phase, { timeout: 10_000 }).toBe('open');
  const sent = await recordHostLevels(page, 4_000);
  const factor = mobile ? 0.625 : 0.8;
  test.info().annotations.push({ type: 'host', description: sent.map((s) => `${s.x.toFixed(5)} at ${s.pos.toFixed(3)} s`).join(', ') });
  expect(sent.length, 'levels App sent in 4 s (a 4 Hz tick)').toBeGreaterThanOrEqual(6);
  const dB01 = 10 ** (0.1 / 20);
  sent.forEach((s, k) => {
    expect(s.glideS, 'no glide this long after the start').toBeNull();
    expect(Math.abs(s.x - factor * phiEnvelope(s.pos, s.dur)), `host sent at ${s.pos.toFixed(3)} of ${s.dur} s: ${s.x}`).toBeLessThanOrEqual(1e-9);
    if (k < 3) return;
    const prev = sent.slice(k - 3, k).map((p) => p.x);
    expect(s.hostBefore, `the host mirror before ${s.x} lands, vs ${prev.join(', ')}`).toBeGreaterThanOrEqual(Math.min(...prev) / dB01);
    expect(s.hostBefore, `the host mirror before ${s.x} lands, vs ${prev.join(', ')}`).toBeLessThanOrEqual(Math.max(...prev) * dB01);
  });

  await sheetButton(page, 'Speakers').click();
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await stored(page, LAYER_OUTPUT_KEY)).toBe('speakers');
  await expect.poll(async () => (await layersState(page)).requested.render).toBe('pulse');
  const sp = (await layersState(page)).requested;
  expect(sp.drone_hz).toBe(0);
  expect(sp.partner_hz).toBe(0);
  expect(sp.pulse_rate_hz).toBe(10);

  // Answered once per device.
  await expectCache(page, { blobs: 1, library: 1 });
  await page.reload();
  await acceptDisclaimer(page);
  await startTrack(page);
  await page.waitForTimeout(1000);
  await expect(outputSheet(page)).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('v2: Ask me later waits for the next session; Ask me again asks again', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2' });
  await importTones(page, 1, 30);
  await startTrack(page);
  await expect(outputSheet(page)).toBeVisible();
  await sheetButton(page, 'Ask me later').click();
  await expect(outputSheet(page)).toHaveCount(0);

  // Not again this session, however often the music starts.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(outputSheet(page)).toHaveCount(0);

  // A new session asks again.
  await expectCache(page, { blobs: 1, library: 1 });
  await page.reload();
  await acceptDisclaimer(page);
  await startTrack(page);
  await expect(outputSheet(page)).toBeVisible();
  await sheetButton(page, 'Car').click();
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await stored(page, LAYER_OUTPUT_KEY)).toBe('car');

  // "Ask me again" keeps the answer and saves the question; it comes with the next play or tap.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await openHarmonicControl(page);
  await page.getByRole('button', { name: 'Ask me again', exact: true }).click();
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: '1' });
  await page.waitForTimeout(500);
  await expect(outputSheet(page)).toHaveCount(0);
  await tapTraditional(page, 528);
  await expect(outputSheet(page)).toBeVisible();
  // The same answer is an answer too: it ends the question.
  await sheetButton(page, 'Car').click();
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: null });
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

const ASKED_AGAIN_NOTE = 'Asked again: the current output stays until you answer.';
/** The row's promise (layerCopy.ts): it asks when the layers next play, and the output stays until the answer (both
 *  saved, so across restarts too). */
const ASK_AGAIN_DESCRIPTION =
  "Asks again which output you're using, now or when the layers next play. Your current output stays until you answer.";
const askAgainButton = (page: Page) => page.getByRole('button', { name: 'Ask me again', exact: true });

/** The voice App last asked the v2 player for is Car's, the tone alone (528 Hz, or any when told): no beat, no pulse,
 *  no drone. */
async function expectCarToneOnly(page: Page, what: string, toneHz: number | 'any' = 528): Promise<void> {
  const r = (await layersState(page))?.requested;
  expect(r?.render, `${what}: the render`).toBe('off');
  if (toneHz === 'any') expect(r?.tone_hz, `${what}: the tone`).toBeGreaterThan(0);
  else expect(r?.tone_hz, `${what}: the tone`).toBe(toneHz);
  expect([r?.partner_hz, r?.beat_hz, r?.pulse_rate_hz, r?.drone_hz], `${what}: partner, beat, pulse and drone Hz`).toEqual([0, 0, 0, 0]);
}

/** After a restart, once the layers play: the first voice App asks the v2 player for is Car's (the track's own tone),
 *  and stays so for 2 s (the plan effect retunes within ~1 s of a change of output), and so is the voice sounding. */
async function expectCarFromTheStart(page: Page, what: string): Promise<void> {
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBeGreaterThan(0);
  for (let ms = 0; ms <= 2000; ms += 500) {
    await expectCarToneOnly(page, `${what}, +${ms} ms`, 'any');
    await page.waitForTimeout(500);
  }
  await expect.poll(async () => (await layersState(page))?.sounding?.tone_hz ?? 0).toBeGreaterThan(0);
  const s = (await layersState(page)).sounding;
  expect([s.render, s.partner_hz, s.beat_hz, s.pulse_rate_hz, s.drone_hz], `${what}: the sounding voice: render, partner, beat, pulse, drone`)
    .toEqual(['off', 0, 0, 0, 0]);
}

test('v2: Ask me again while playing keeps Car until a new answer, through Ask me later and a restart @mobile', async ({ page }) => {
  test.setTimeout(180_000); // two sessions (~75 s here), and under load a click can take 5-10 s
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'car' });
  await importTones(page, 1, 120);   // under load a click can take 5-10 s, and 60 s of music ran out mid-test
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  await expectCarToneOnly(page, 'Car saved');

  // Asked again while the layers play: the question comes at once and is saved beside the answer, which stays saved
  // and in effect until a new one (it used to fall back to headphones' beat and drone within a second).
  await expect(page.getByText(ASK_AGAIN_DESCRIPTION, { exact: true })).toBeVisible();
  await askAgainButton(page).click();
  await expect(outputSheet(page)).toBeVisible();
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: '1' });
  for (let ms = 0; ms <= 2000; ms += 250) {   // the plan effect retunes within ~1 s of a change of output
    await expectCarToneOnly(page, `asked again, +${ms} ms`);
    await page.waitForTimeout(250);
  }
  const sounding = (await layersState(page)).sounding;
  expect([sounding?.render, sounding?.partner_hz, sounding?.drone_hz], 'the sounding voice: render, partner, drone').toEqual(['off', 0, 0]);
  // The panel shows Car and a pending question, not "Headphones (assumed)".
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toBeVisible();
  await expect(outputButton(page, 'Car')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Headphones (assumed)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Not answered yet: playing as headphones.', { exact: true })).toHaveCount(0);
  await expect(askAgainButton(page)).toHaveCount(0);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Car (tone only)');

  // The answer applies and is saved, and ends the question: headphones' binaural beat and drone.
  await sheetButton(page, 'Headphones').click();
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await storedOutput(page)).toEqual({ output: 'headphones', askAgain: null });
  await expect.poll(async () => (await layersState(page)).requested?.render).toBe('binaural');
  const h = (await layersState(page)).requested;
  expect(h.drone_hz).toBe(33);
  expect(h.partner_hz, 'the binaural partner').toBeGreaterThan(h.carrier_hz);
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toHaveCount(0);
  await expect(askAgainButton(page)).toBeVisible();

  // Car again, from the panel. Asked again, "Ask me later" hides the question for the session and keeps Car and the
  // question, both saved.
  await outputButton(page, 'Car').click();
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: null });
  await expect.poll(async () => (await layersState(page)).requested?.render).toBe('off');
  await askAgainButton(page).click();
  await expect(outputSheet(page)).toBeVisible();
  await sheetButton(page, 'Ask me later').click();
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: '1' });
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  await expectCarToneOnly(page, 'Ask me later');
  // Not asked again this session, and still Car after a pause and a play.
  await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();   // closes it
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await layersState(page)).requested).toBeNull();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await layersState(page)).requested?.tone_hz ?? 0).toBe(528);
  await page.waitForTimeout(1000);
  await expect(outputSheet(page)).toHaveCount(0);
  await expectCarToneOnly(page, 'played again');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Car (tone only)');

  // A restart before the answer (Android kills a backgrounded PWA routinely) keeps both: Car from the first voice,
  // never headphones' beat and drone, and the question again when the layers next play, not before.
  await expectCache(page, { blobs: 1, library: 1 });
  await page.reload();
  await acceptDisclaimer(page);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Car (tone only)');
  await page.waitForTimeout(500);
  await expect(outputSheet(page)).toHaveCount(0);
  await startTrack(page);
  await expect(outputSheet(page)).toBeVisible();
  await expectCarFromTheStart(page, 'restarted');
  await openHarmonicControl(page);
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toBeVisible();
  await expect(outputButton(page, 'Car')).toHaveAttribute('aria-pressed', 'true');
  await expect(askAgainButton(page)).toHaveCount(0);

  // The answer is saved and ends the question: headphones' beat and drone from now on.
  await sheetButton(page, 'Headphones').click();
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await storedOutput(page)).toEqual({ output: 'headphones', askAgain: null });
  await expect.poll(async () => (await layersState(page)).requested?.render).toBe('binaural');
  const after = (await layersState(page)).requested;
  expect(after.drone_hz, 'the drone').toBeGreaterThan(0);
  expect(after.partner_hz, 'the binaural partner').toBeGreaterThan(after.carrier_hz);
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toHaveCount(0);
  await expect(askAgainButton(page)).toBeVisible();
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('v2: under Music only, Ask me again asks when the layers next play, and Car stays until the answer, across a restart @mobile', async ({ page }) => {
  test.setTimeout(180_000); // two sessions (~75 s here), and under load a click can take 5-10 s
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'car' });
  await importTones(page, 1, 120);   // under load a click can take 5-10 s, and 60 s of music ran out mid-test
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  await expectCarToneOnly(page, 'Car saved');

  // Under Music only the row still shows, but no layers play: the question waits for them, not for a play (the row
  // used to say "now or at the next play").
  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await layersState(page)).requested).toBeNull();
  await expect(page.getByText(ASK_AGAIN_DESCRIPTION, { exact: true })).toBeVisible();
  await askAgainButton(page).click();
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: '1' });
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toBeVisible();
  await expect(outputButton(page, 'Car')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1000);
  await expect(outputSheet(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();   // closes it
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(outputSheet(page)).toHaveCount(0);
  expect((await layersState(page)).requested, 'no layers under Music only').toBeNull();

  // Music only off while the music plays: the layers play again, so the question comes now, and until it is
  // answered they play as Car (tone only), not as headphones.
  await openHarmonicControl(page);
  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(outputSheet(page)).toBeVisible();
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  for (let ms = 0; ms <= 2000; ms += 500) {   // the plan effect retunes within ~1 s of a change of output
    await expectCarToneOnly(page, `Music only off, +${ms} ms`);
    await page.waitForTimeout(500);
  }
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Car (tone only)');

  // "Ask me later", Music only on again, and a restart: Car and the question are both still saved, so the next
  // session plays Car, and the question waits for the layers again.
  await sheetButton(page, 'Ask me later').click();
  await expect(outputSheet(page)).toHaveCount(0);
  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: '1' });
  await expectCache(page, { blobs: 1, library: 1 });
  await page.reload();
  await acceptDisclaimer(page);
  await startTrack(page);
  await page.waitForTimeout(1000);
  await expect(outputSheet(page)).toHaveCount(0);
  expect((await layersState(page))?.requested ?? null, 'no layers under Music only').toBeNull();
  await openHarmonicControl(page);
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toBeVisible();
  await expect(outputButton(page, 'Car')).toHaveAttribute('aria-pressed', 'true');

  // Music only off: the layers play, the question comes with them, and Car is in effect until the answer.
  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(outputSheet(page)).toBeVisible();
  await expectCarFromTheStart(page, 'restarted, Music only off');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Car (tone only)');

  // The answer is saved and ends the question: Speakers' pulse, no drone.
  await sheetButton(page, 'Speakers').click();
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await storedOutput(page)).toEqual({ output: 'speakers', askAgain: null });
  await expect.poll(async () => (await layersState(page)).requested?.render).toBe('pulse');
  expect((await layersState(page)).requested.drone_hz, 'no drone off headphones').toBe(0);
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toHaveCount(0);
  await expect(askAgainButton(page)).toBeVisible();
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('v2: with storage blocked, Ask me again and its answer hold for the session, and nothing throws', async ({ page }) => {
  const errors = pageErrors(page);
  // React reports an error thrown in a click handler as a console error, not a page error (disclaimer.spec).
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('[SW]')) errors.push(m.text());
  });
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'car' });
  await openHarmonicControl(page);
  // As when the browser blocks site storage mid-session: every read and write throws from here on (the test keeps
  // the real getItem for its own reads).
  await page.evaluate(() => {
    (window as any).__getItem = Storage.prototype.getItem;
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
      (Storage.prototype as any)[method] = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
    }
  });
  const saved = () =>
    page.evaluate((keys) => keys.map((k) => (window as any).__getItem.call(localStorage, k)), [LAYER_OUTPUT_KEY, LAYER_OUTPUT_ASK_AGAIN_KEY]);

  // Asked again, the question holds for the session with Car in effect; nothing is saved.
  await askAgainButton(page).click();
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toBeVisible();
  await expect(outputButton(page, 'Car')).toHaveAttribute('aria-pressed', 'true');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Car (tone only)');
  expect(await saved()).toEqual(['car', null]);
  // The answer applies for the session and ends the question.
  await outputButton(page, 'Speakers').click();
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toHaveCount(0);
  await expect(outputButton(page, 'Speakers')).toHaveAttribute('aria-pressed', 'true');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers v2 · Speakers (pulse)');
  await expect(askAgainButton(page)).toBeVisible();
  expect(await saved()).toEqual(['car', null]);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

/** The transport's layers popover (OutputQuickSwitch); the output question is a dialog of its own, named by its heading. */
const layersPopover = (page: Page) => page.getByRole('dialog', { name: 'Layer sound and output', exact: true });

test('one Escape answers the output question over the layers popover, and the next one closes the popover', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'car' });
  await importTones(page, 1, 120);
  await startTrack(page);

  // The popover first, then the question over it: "Ask me again" there while the layers play asks at once.
  await quickSwitch(page).click();
  await expect(layersPopover(page)).toBeVisible();
  await layersPopover(page).getByRole('button', { name: 'Ask me again', exact: true }).click();
  await expect(outputSheet(page)).toBeVisible();
  // The question sits on top: one Escape is its "Ask me later" (the answer and the question stay saved) and nothing
  // else; the popover under it stays open (both used to go at once). The next Escape closes the popover.
  await page.keyboard.press('Escape');
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: '1' });
  await page.waitForTimeout(500);
  await expect(layersPopover(page), 'the popover after the first Escape').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(layersPopover(page)).toHaveCount(0);
  await expect(outputSheet(page)).toHaveCount(0);

  // The question first (a new session asks again when the layers play), then the popover opened from the player bar
  // under it: the same, one Escape each, the question's first.
  await expectCache(page, { blobs: 1, library: 1 });
  await page.reload();
  await acceptDisclaimer(page);
  await startTrack(page);
  await expect(outputSheet(page)).toBeVisible();
  await quickSwitch(page).click();
  await expect(layersPopover(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(outputSheet(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(layersPopover(page), 'the popover after the first Escape').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(layersPopover(page)).toHaveCount(0);
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: '1' });
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('a saved Music only keeps the output question away until the layers are wanted; on a phone it leaves the transport free @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page, { engine: 'default' });
  // A profile as v14.6–v14.8 left it with Music only on: no engine chosen, so v2 by default, with its layers off.
  await page.evaluate(() => localStorage.setItem('aetheria.musicOnly.v1', 'true'));
  await page.reload();
  await acceptDisclaimer(page);
  await importTones(page, 1, 60);
  await startTrack(page);
  await page.waitForTimeout(1000);
  // No question about layers that stay silent, and no v2 player for them.
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await layersCreated(page)).toBe(false);

  // On the user's phone (412 × 915), Music only off while the music plays: the layers are wanted now, so the
  // question comes, between the header and the player bar.
  await page.setViewportSize({ width: 412, height: 915 });
  await openHarmonicControl(page);
  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(outputSheet(page)).toBeVisible();
  await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();   // closes it
  await expect(page.getByRole('heading', { name: 'Harmonic Control', exact: true })).toHaveCount(0);
  await expectSheetClearOfTheBar(page, 'phone 412 × 915');

  // Turned sideways there is less room than the card needs: it still fits between them (its card scrolls).
  await page.setViewportSize({ width: 915, height: 412 });
  await expect.poll(async () => {
    const card = await sheetCard(page).boundingBox();
    const bar = await page.getByTestId('player-bar').boundingBox();
    return card && bar ? card.y + card.height - bar.y : NaN;
  }, { message: "landscape: the sheet's bottom vs the player bar's top" }).toBeLessThanOrEqual(0.5);
  await expectSheetClearOfTheBar(page, 'phone 915 × 412');
  await sheetButton(page, 'Headphones').click();
  await expect(outputSheet(page)).toHaveCount(0);
  expect(await stored(page, LAYER_OUTPUT_KEY)).toBe('headphones');
  expect(await stored(page, LAYER_ENGINE_KEY)).toBeNull();
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('v2: Music only and Emergency Stop silence the layers at once @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 1, 20);
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  // 4 s into 20 s the φ envelope is ≥ 0.28, so the host is well above 0.1 (×0.625 on a phone).
  await expect.poll(() => elapsedSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  expect((await layersState(page)).host_level).toBeGreaterThan(0.1);

  // Music only stops v2 with a 0.1 s fall (a pause would leave the host up and close over 0.8 s / 3 s).
  await expectStop(musicOnlySwitch(page), 0.1, 'Music only');
  expect((await layersState(page)).requested).toBeNull();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'true');
  await musicOnlySwitch(page).click();
  await expect(musicOnlySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await layersState(page)).host_level, { timeout: 5_000 }).toBeGreaterThan(0.1);

  await openSafety(page);
  await expectStop(page.getByRole('button', { name: 'Emergency Stop' }), 0.1, 'Emergency Stop');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect((await layerState(page)).music?.paused).toBe(true);
  expect((await layersState(page)).requested).toBeNull();
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('switching engines mid-track hands over without stopping classic at full level, and leaves nothing behind @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  await recordStops(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 1, 60);
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  // Under v2 a new crystal is a player call only: classic builds no tone.
  const oscs = (await layerState(page)).oscCount;
  await tapTraditional(page, 417);
  await expect.poll(async () => (await layersState(page)).requested?.canonical_hz).toBe(417);
  expect((await layerState(page)).oscCount).toBe(oscs);

  // v2 → classic: v2 falls in 0.25 s, classic's bus rises (τ 0.25) and its tone is built; 3 s on, the player is gone.
  const left = await expectStop(engineButton(page, 'Classic'), 0.25, 'v2 → classic');
  expect((await layersState(page)).requested).toBeNull();
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: BUS, tau: 0.25 });
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);
  await page.waitForTimeout(Math.max(0, left + 3500 - (await pageNow(page))));
  expect(await layersCreated(page), 'the player is disposed 3 s after leaving v2').toBe(false);
  expect(await layersState(page)).toBeNull();

  // Classic → v2: classic's tone and beat keep running while their bus falls (stopping them now would click at
  // full level); 2 s after App flips (its new player and the teardown timer come from the same effects), at
  // −69.5 dB, they are torn down.
  const toV2 = await clickAt(engineButton(page, 'v2'));
  const sample = () =>
    page.evaluate((since) => {
      const w = window as any;
      const tone = w.__audio.toneOscs[w.__audio.toneOscs.length - 1];
      return {
        now: performance.now() as number,
        toneSounding: !!tone && !w.__audio.stopped.has(tone),
        stops: (w.__stopTimes as number[]).filter((s) => s > since).length,
        created: w.__aetheriaLayers.created() as boolean,
      };
    }, toV2);
  let flipped = -1;
  for (let s = await sample(); s.now < toV2 + 1200; s = await sample()) {
    expect(s.toneSounding, 'classic tone still running').toBe(true);
    expect(s.stops, 'stop() calls since the flip').toBe(0);
    if (flipped < 0 && s.created) flipped = s.now;
    await page.waitForTimeout(50);
  }
  if (flipped < 0) {
    await expect.poll(() => layersCreated(page)).toBe(true);
    flipped = await pageNow(page);
  }
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: 0, tau: 0.25 });
  expect((await layersState(page)).requested?.canonical_hz).toBe(417);
  await expect
    .poll(async () => (await layerState(page)).toneSounding, { timeout: Math.max(100, flipped + 3000 - (await pageNow(page))) })
    .toBe(false);
  const stops = await stopsSince(page, toV2);
  expect(stops, 'classic was torn down').toBeGreaterThan(0);
  expect(await stopsSince(page, toV2 + 1700), 'every stop came ≥ 1.7 s after the flip').toBe(stops);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

/** From the next page load on, keep the handlers the app gives navigator.mediaSession (what the lock screen's, the
 *  notification's and the car's buttons call) in window.__mediaHandlers, so a test can press them. */
async function captureMediaSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__mediaHandlers = {};
    const ms = navigator.mediaSession;
    if (!ms) return;
    const set = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      w.__mediaHandlers[action] = handler;
      return set(action, handler);
    };
  });
}

const pressMediaKey = (page: Page, action: 'play' | 'pause') =>
  page.evaluate((a) => {
    const handler = (window as any).__mediaHandlers[a];
    if (!handler) throw new Error(`The app set no '${a}' media-session handler`);
    handler({ action: a });
  }, action);

/** Record what App asks the live v2 player to play from now on (a spy on its play(), found through the registry):
 *  the crystal, or null for silence, in window.__v2Plays. */
async function spyOnPlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const player = ((globalThis as any)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [])[0];
    if (!player) throw new Error('No live v2 player to watch');
    const plays: (number | null)[] = (w.__v2Plays = []);
    const play = player.play;
    player.play = function (plan: { canonical_hz: number } | null, ...rest: unknown[]) {
      plays.push(plan ? plan.canonical_hz : null);
      return play.call(this, plan, ...rest);
    };
  });
}

test('v2 follows gapless advances and the lock-screen Pause and Play @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  await captureMediaSession(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  // Auto-Distribute (it needs 27 tracks) gives every track a crystal, which the gapless (lock-screen-safe) advance
  // needs: the 27 crystals once each and one twice, matched at random, so any three tracks play at least two. 4 s
  // tracks, as in the device's screen-off test.
  await importTones(page, 28, 4);
  await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  await startTrack(page);
  await expect.poll(async () => (await layersState(page))?.requested?.canonical_hz ?? 0).toBeGreaterThan(0);
  await spyOnPlays(page);
  const pausesBefore = await pauseCount(page);
  const crystals = new Set<number>([(await layersState(page)).requested.canonical_hz]);

  // Two gapless swaps: v2 retunes to each track's crystal and is never stopped on the way (no play(null)).
  const title = page.getByTestId('now-playing-title');
  for (const name of ['tone-02', 'tone-03']) {
    await expect(title).toHaveText(name, { timeout: 15_000 });
    await expect.poll(async () => (await layersState(page)).requested?.canonical_hz ?? 0).toBeGreaterThan(0);
    await page.waitForTimeout(500); // the plan effect follows the swap's commit
    crystals.add((await layersState(page)).requested.canonical_hz);
  }
  const plays: (number | null)[] = await page.evaluate(() => (window as any).__v2Plays);
  test.info().annotations.push({ type: 'crystals', description: `${[...crystals].join(' → ')}; play() calls ${plays.join(', ')}` });
  expect(plays.length, "App's play() calls seen during the advances").toBeGreaterThan(0);
  expect(plays, "App's play() calls during the advances (null = silence)").not.toContain(null);
  expect(crystals.size, `crystals v2 played: ${[...crystals].join(', ')}`).toBeGreaterThanOrEqual(2);
  // The gapless swap never pauses the element; the playTrack fallback (the path that drops the lock-screen card) does.
  expect(await pauseCount(page)).toBe(pausesBefore);

  // The lock screen's (and the car's) Pause and Play: the music and the v2 layers stop together and come back.
  await pressMediaKey(page, 'pause');
  await expect.poll(async () => (await layerState(page)).music?.paused).toBe(true);
  await expect.poll(async () => (await layersState(page)).requested).toBeNull();
  await expect.poll(async () => (await layersState(page)).phase, { timeout: 5_000 }).toBe('silent');
  await pressMediaKey(page, 'play');
  await expect.poll(async () => (await layerState(page)).music?.paused).toBe(false);
  await expect.poll(async () => (await layersState(page)).requested?.canonical_hz ?? 0).toBeGreaterThan(0);
  await page.evaluate(() => {
    const player = ((globalThis as any)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [])[0];
    if (player) delete player.play; // the prototype's again
  });
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

/**
 * From the next page load on, while window.__failLayersOnce is true the next createChannelMerger throws (once, like a
 * browser without it), and every oscillator created while it is armed is kept in window.__armedOscs; started and
 * stopped sources are recorded.
 */
async function failLayersOnce(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__failLayersOnce = false;
    const armed: OscillatorNode[] = (w.__armedOscs = []);
    const started: WeakSet<object> = (w.__startedSources = new WeakSet());
    const stopped: WeakSet<object> = (w.__stoppedSources = new WeakSet());
    const B = BaseAudioContext.prototype as any;
    const merger = B.createChannelMerger;
    B.createChannelMerger = function (...args: unknown[]) {
      if (w.__failLayersOnce) {
        w.__failLayersOnce = false;
        throw new DOMException('test: no channel merger', 'NotSupportedError');
      }
      return merger.apply(this, args);
    };
    const osc = B.createOscillator;
    B.createOscillator = function () {
      const n = osc.call(this);
      if (w.__failLayersOnce) armed.push(n);
      return n;
    };
    const S = AudioScheduledSourceNode.prototype as any;
    const start = S.start;
    const stop = S.stop;
    S.start = function (...args: unknown[]) {
      started.add(this);
      return start.apply(this, args);
    };
    S.stop = function (...args: unknown[]) {
      stopped.add(this);
      return stop.apply(this, args);
    };
  });
}

test('if v2 cannot start, classic plays, the panel says so, and nothing of v2 is left running', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  await failLayersOnce(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2' });
  await openHarmonicControl(page);
  await page.evaluate(() => ((window as any).__failLayersOnce = true));
  await tapTraditional(page, 528);

  await expect(page.getByTestId('v2-unavailable')).toBeVisible();
  await expect(page.getByTestId('v2-unavailable')).toHaveText('v2 unavailable on this device: classic is playing.');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers classic · v2 unavailable');
  // Classic took over: its bus rises to 0.4 and its tone ramps to the validated level.
  await expect.poll(async () => (await layerState(page)).busLast?.target).toBe(BUS);
  await expect.poll(async () => (await layerState(page)).toneTargets.length).toBeGreaterThan(0);
  const s = await layerState(page);
  expect(s.toneTargets[s.toneTargets.length - 1]).toBeCloseTo(TONE_TARGET, 6);
  expect(s.toneSounding).toBe(true);
  expect(await layersCreated(page)).toBe(false);
  await expect(outputSheet(page)).toHaveCount(0); // nothing to ask while classic plays
  // The failed constructor made its oscillators, then cleaned up: none of them is left running.
  const v2 = await page.evaluate(() => {
    const w = window as any;
    const running = w.__armedOscs.filter((n: object) => w.__startedSources.has(n) && !w.__stoppedSources.has(n));
    return { fired: !w.__failLayersOnce, made: w.__armedOscs.length as number, running: running.length as number };
  });
  expect(v2.fired, 'the merger failure was hit').toBe(true);
  expect(v2.made, 'oscillators the player made before it failed').toBeGreaterThan(0);
  expect(v2.running, 'of them still running').toBe(0);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('if the v2 player fails mid-session, classic takes over and nothing throws', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 1, 30);
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  // The tone/beat gate's AudioParam starts throwing (white-box: the player's mirror of it holds the param); the next
  // retune's close hits it inside play(), which reports it, and App drops v2 for the session.
  await page.evaluate(() => {
    const player = ((globalThis as any)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [])[0];
    player.gateTB.param.linearRampToValueAtTime = () => {
      throw new DOMException('test: the gate failed', 'InvalidStateError');
    };
  });
  await tapTraditional(page, 417);

  await expect(page.getByTestId('v2-unavailable')).toBeVisible();
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers classic · v2 unavailable');
  await expect.poll(async () => (await layerState(page)).busLast?.target).toBe(BUS);
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);
  expect(await layersCreated(page), 'the failed player is disposed').toBe(false);
  expect((await layerState(page)).music?.paused, 'the music plays on').toBe(false);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

const V2_UNAVAILABLE_CAR = 'v2 unavailable on this device. For Car output the layers are off; only the music plays.';
// v15.0.1: the classic note once v2 has failed this session, the Output group's line after a v2 failure, and the Car
// fallback's cues (layerCopy.ts).
const CLASSIC_OUTPUT_NOTE_V2_FAILED =
  'Output and Car apply to v2, which is unavailable on this device. Classic plays its beat and drone whatever the output: ' +
  'for driving, choose v2 with Car output (the layers turn off), or Music only.';
const OUTPUT_V2_FAILED_NOTE = "v2 is unavailable on this device: Car turns the layers off; any other output plays classic's beat and drone.";
const BEAT_OFF_CAR_FALLBACK = 'Car: layers off (v2 unavailable)';
const V2_UNAVAILABLE_CAR_TONE = 'v2 unavailable on this device. For Car output the layers are off, so the tone is silent.';
const V2_UNAVAILABLE_CAR_RECORDING =
  "v2 unavailable on this device. For Car output the layers are off and the music can't be recorded here, so this recording will be silent.";

test('if the v2 player fails mid-session with Car saved, classic stays silent and only the music plays @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'car' });
  await importTones(page, 1, 60);
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  expect((await layersState(page)).requested.render).toBe('off');
  // The failure of the test above: the next retune's close throws inside play(), and App drops v2 for the session.
  await page.evaluate(() => {
    const player = ((globalThis as any)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [])[0];
    player.gateTB.param.linearRampToValueAtTime = () => {
      throw new DOMException('test: the gate failed', 'InvalidStateError');
    };
  });
  await tapTraditional(page, 417);

  // Classic has no Car render (it always plays its beat and drone), so for Car the fallback is the music alone.
  await expect(page.getByTestId('v2-unavailable')).toHaveText(V2_UNAVAILABLE_CAR);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers off · Car · v2 unavailable');
  await expect(badge(page)).toHaveAttribute('title', V2_UNAVAILABLE_CAR);
  expect(await layersCreated(page), 'the failed player is disposed').toBe(false);
  // For 3 s (classic's fade in, τ 0.25 s, would be all but done in 1): classic's layer bus and drone are held at 0 and
  // nothing reaches the master bus, while the music plays on.
  expect((await layerState(page)).ctxRunning, 'the context runs, so silence on the bus is real').toBe(true);
  const t0 = await elapsedSeconds(page);
  for (let ms = 500; ms <= 3000; ms += 500) {
    await page.waitForTimeout(500);
    const s = await layerState(page);
    expect(s.busLast?.target, `classic's layer bus target, +${ms} ms`).toBe(0);
    expect(s.droneLast?.target, `classic's drone target, +${ms} ms`).toBe(0);
    expect(await busRms(page), `the master bus RMS, +${ms} ms`).toBeLessThan(1e-4);
    expect(s.music?.paused, `the music plays on, +${ms} ms`).toBe(false);
  }
  expect(await elapsedSeconds(page), 'the music moved on').toBeGreaterThan(t0);

  // Classic chosen afterwards is classic as it was (Car never applies to it, and the panel says so): its layers return.
  // Its note is this session's (v15.0.1): with v2 failed, v2 with Car is the layers off, not a quiet tone.
  await engineButton(page, 'Classic').click();
  await expect(classicNote(page)).toHaveText(CLASSIC_OUTPUT_NOTE_V2_FAILED);
  await expect(page.getByTestId('v2-unavailable')).toHaveText('v2 unavailable on this device: classic is playing.');
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers classic');
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: BUS, tau: 0.25 });
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBeCloseTo(DRONE, 6);
  await expect.poll(async () => (await layerState(page)).toneSounding).toBe(true);
  await expect.poll(() => busRms(page), { timeout: 2_000 }).toBeGreaterThan(1e-3);
  expect((await layerState(page)).music?.paused, 'the music plays on').toBe(false);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test("after v2 fails, the Output group stays with one line on what it does then, and Car there silences classic at once @mobile", async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 1, 60);
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  // The mid-session failure (above): the next retune's close throws inside play(), and App drops v2 for the session.
  await page.evaluate(() => {
    const player = ((globalThis as any)[Symbol.for('aetheria.soundV2.layerPlayers.v1')] ?? [])[0];
    player.gateTB.param.linearRampToValueAtTime = () => {
      throw new DOMException('test: the gate failed', 'InvalidStateError');
    };
  });
  await tapTraditional(page, 417);
  await expect(page.getByTestId('v2-unavailable')).toHaveText('v2 unavailable on this device: classic is playing.');
  // Headphones: classic plays its beat and drone.
  await expect.poll(async () => (await layerState(page)).busLast?.target).toBe(BUS);
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBeCloseTo(DRONE, 6);

  // The Output group stays, so Car can still be chosen, with the line for this state in place of v2's descriptions;
  // v2's drone switch and "Ask me again" go.
  const group = page.getByRole('group', { name: 'Output', exact: true });
  await expect(group).toBeVisible();
  await expect(group.getByText(OUTPUT_V2_FAILED_NOTE, { exact: true })).toBeVisible();
  await expect(group.getByText('Binaural beat + sub-bass drone. Both earbuds in; mono audio and spatial audio off.', { exact: true }))
    .toHaveCount(0);
  await expect(outputButton(page, 'Headphones')).toHaveAttribute('aria-pressed', 'true');
  await expect(droneSwitch(page)).toHaveCount(0);
  await expect(askAgainButton(page)).toHaveCount(0);
  await expect(quickSwitch(page).locator('svg')).toHaveClass(/lucide-layers/);

  // Car: saved, and classic's layers fall at once (Music only's fade, τ 0.25 s), so only the music plays.
  await outputButton(page, 'Car').click();
  expect(await storedOutput(page)).toEqual({ output: 'car', askAgain: null });
  await expect(outputButton(page, 'Car')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: 0, tau: 0.25 });
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBe(0);
  await expect.poll(() => busRms(page), { timeout: 5_000, message: 'the master bus RMS after Car' }).toBeLessThan(1e-4);
  expect((await layerState(page)).music?.paused, 'the music plays on').toBe(false);
  await expect(page.getByTestId('v2-unavailable')).toHaveText(V2_UNAVAILABLE_CAR);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers off · Car · v2 unavailable');
  await expect(quickSwitch(page).locator('svg')).toHaveClass(/lucide-volume-x/);
  await expect(group.getByText(OUTPUT_V2_FAILED_NOTE, { exact: true })).toBeVisible();
  await expect(droneSwitch(page)).toHaveCount(0);
  await expect(askAgainButton(page)).toHaveCount(0);

  // Any other output plays classic's beat and drone again, as the line says.
  await outputButton(page, 'Speakers').click();
  expect(await storedOutput(page)).toEqual({ output: 'speakers', askAgain: null });
  await expect.poll(async () => (await layerState(page)).busLast).toEqual({ target: BUS, tau: 0.25 });
  await expect.poll(async () => (await layerState(page)).droneLast?.target).toBeCloseTo(DRONE, 6);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers classic · v2 unavailable');
  await expect(quickSwitch(page).locator('svg')).toHaveClass(/lucide-layers/);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('if v2 cannot start with Car saved, every cue says the layers are off: the quick switch, the band chip, the beat slider, the adaptive band, a tone tap and a recording @mobile', async ({ page }) => {
  const errors = pageErrors(page);
  await instrumentAudio(page);
  await failLayersOnce(page);
  await recordAdaptive(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'car' });
  await importTones(page, 1, 120);
  await expectCache(page, { blobs: 1, meta: 1, library: 1 });
  // As if Deep-Scanned at full intensity: classic's adaptive, were it to run, would step the band toward Gamma every 3 s.
  await writeBandEnvelope(page, 255, 120);
  await page.goto('/');
  await acceptDisclaimer(page);
  // v2 with Car: its icon, no beat on the chip, and its beat slider off.
  const icon = quickSwitch(page).locator('svg');
  const beat = page.getByRole('slider', { name: 'Beat level' });
  await expect(icon).toHaveClass(/lucide-car/);
  await expect(bandChip(page)).toHaveText('Beat off');
  await expect(beat).toBeDisabled();
  await expect(beat).toHaveAttribute('title', 'Car: tone only');

  // The play's v2 player cannot start (or the tone tap's, if the track's own frequency is no crystal): classic would take
  // over, but it has no Car render, so the layers stay off (v14.9's fallback; the music plays on).
  await page.evaluate(() => ((window as any).__failLayersOnce = true));
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect(page.getByTestId('v2-unavailable')).toHaveText(V2_UNAVAILABLE_CAR);
  const failedAt = await pageNow(page);
  expect(await page.evaluate(() => !(window as any).__failLayersOnce), 'the merger failure was hit').toBe(true);
  await expect(badge(page)).toHaveAttribute('aria-label', 'Layers off · Car · v2 unavailable');

  // Every cue says so, as under Music only: the quick switch's icon, the chip (no beat), and v2's Car slider, off, with
  // a title that says why; never classic's Layers icon, its preset's name or its "Binaural Volume" slider.
  await expect(icon).toHaveClass(/lucide-volume-x/);
  await expect(bandChip(page)).toHaveText('Beat off');
  await expect(beat).toBeDisabled();
  await expect(beat).toHaveAttribute('title', BEAT_OFF_CAR_FALLBACK);
  await expect(beat).toHaveAttribute('aria-valuetext', BEAT_OFF_CAR_FALLBACK);
  await expect(page.getByTitle(/^Binaural Volume/)).toHaveCount(0);
  // Nothing moves the band while the music plays: neither adaptive effect arms its 3 s interval (classic's would arm at
  // once and step toward Gamma), and the chip has shown only 'Beat off' since the page loaded.
  await page.waitForTimeout(Math.max(0, failedAt + 4_000 - (await pageNow(page))));
  const log = await adaptiveLog(page);
  test.info().annotations.push({ type: 'adaptive', description: adaptiveReport(log, 0) || 'nothing armed, no chip change' });
  expect(eventsAfter(log, 0, 'arm'), '3 s adaptive intervals armed').toEqual([]);
  expect([...new Set(eventsAfter(log, 0, 'chip').map((x) => x.text))], 'what the chip showed').toEqual(['Beat off']);
  expect((await layerState(page)).music?.paused, 'the music plays on').toBe(false);

  // A tone tap says why it is silent.
  await tapTraditional(page, 417);
  await expect(page.getByText(V2_UNAVAILABLE_CAR_TONE, { exact: true })).toBeVisible();

  // So does a recording that can't tap the music (as in a browser without captureStream): it would be silence.
  await page.evaluate(() => delete (HTMLMediaElement.prototype as any).captureStream);
  await page.locator('header button:has(svg.lucide-circle)').click();
  await page.getByRole('button', { name: 'Audio Only' }).click();
  await expect(page.getByRole('button', { name: 'REC' })).toBeVisible();
  await expect(page.getByText(V2_UNAVAILABLE_CAR_RECORDING, { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'REC' }).click();
  await download;
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('the drone switch is saved only when tapped and reaches the player', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 1, 30);
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.drone_hz ?? 0).toBe(33);
  expect((await layersState(page)).gains.drone).toBe(1);
  expect(await stored(page, DRONE_KEY)).toBeNull();

  await expect(droneSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await droneSwitch(page).click();
  await expect(droneSwitch(page)).toHaveAttribute('aria-checked', 'false');
  expect(await stored(page, DRONE_KEY)).toBe('false');
  await expect.poll(async () => (await layersState(page)).gains.drone).toBe(0);
  expect((await layersState(page)).drone.resting).toBe(false);

  await page.reload();
  await acceptDisclaimer(page);
  await openHarmonicControl(page);
  await expect(droneSwitch(page)).toHaveAttribute('aria-checked', 'false');
  // Off headphones v2 plays no drone, so the switch has nothing to do.
  await outputButton(page, 'Speakers').click();
  await expect(droneSwitch(page)).toBeDisabled();
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('v2 sliders read in dB; classic keeps its percent readouts', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  await openHarmonicControl(page);
  await expect(layerIntensity(page)).toHaveText('1%');
  await expect(page.getByText('Tone level', { exact: true })).toHaveCount(0);
  await expect(page.getByTitle('Binaural Volume: 15%')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Beat level' })).toHaveCount(0);

  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await openHarmonicControl(page);
  await expect(page.getByText('Layer Intensity', { exact: true })).toHaveCount(0);
  // v2's own default (v15.0), not classic's 1 %: the lowest step before off.
  await expect(toneReadoutText(page)).toHaveText(V2_DEFAULT_READOUT);
  const tone = toneSlider(page);
  await expect(tone).toHaveAttribute('max', '0.04');
  await expect(tone).toHaveAttribute('aria-valuetext', V2_DEFAULT_READOUT);
  // 0 dB is still the 1 % the validated −26 dB sits at.
  await setSlider(tone, 0.01);
  await expect(toneReadoutText(page)).toHaveText('+0.0 dB · −26.0 dB re music');
  const beat = page.getByRole('slider', { name: 'Beat level' });
  await expect(beat).toHaveAttribute('title', 'Beat +0.0 dB · −23.0 dB re music');
  await expect(beat).toHaveAttribute('max', '0.12');
  await expect(page.getByTitle(/^Binaural Volume/)).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('v2 copy changes stay in v2', async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  // v16.6 (C1): classic's bands name the EEG band (utils/copy BAND_LINES), never "best for".
  const gammaClassic = 'The band above 30 Hz.';
  const gammaV2 =
    'Gamma (40 Hz) is a design choice: the MIT 40 Hz work used light flicker and click trains, not binaural beats, ' +
    'and above about 30 Hz a binaural beat is heard as two tones rather than a beat.';
  const phiClassic = ['Volume Ratios: 1.0 : 0.618 : 0.382', 'Binaural Phase: 137.5° golden angle offset'];
  const phiV2 = [
    'Layer levels: tone −26, beat −23, drone −24 dB under the music (fixed; φ ratios are classic only)',
    'Binaural: carrier left, partner right (no phase offset)',
    'One continuous envelope on every layer: 0 → 0.8 at 38.2% → 1 at 61.8% → 0.8 at the end',
  ];
  const shown = async (texts: string[], count: number) => {
    for (const t of texts) await expect(page.getByText(t, { exact: true }), t).toHaveCount(count);
  };

  await openHarmonicControl(page);
  await shown([gammaClassic, ...phiClassic, 'Track Timing: Phi-proportioned'], 1);
  await shown([gammaV2, ...phiV2], 0);

  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await openHarmonicControl(page);
  await shown([gammaV2, ...phiV2, 'Track Timing: Phi-proportioned'], 1);
  await shown([gammaClassic, ...phiClassic], 0);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test("v2's presets note follows the output: under Car there is no beat or pulse to adapt", async ({ page }) => {
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  const carNote = page.getByText('Car: tone only, so there is no beat or pulse.', { exact: true });
  const note = page.getByText(
    'Adaptive stops at Beta; Gamma is a manual choice. Off headphones the beat is a gentle pulse, capped at Alpha.',
    { exact: true }
  );
  await seedLayers(page, { engine: 'v2', output: 'car' });
  await openHarmonicControl(page);
  await expect(carNote).toBeVisible();
  await expect(note).toHaveCount(0);
  for (const o of ['Headphones', 'Speakers', 'Phone speaker'] as const) {
    await outputButton(page, o).click();
    await expect(note, o).toBeVisible();
    await expect(carNote, o).toHaveCount(0);
  }
  await outputButton(page, 'Car').click();
  await expect(carNote).toBeVisible();
  // Asked again, Car stays the output in effect, so the note stays Car's.
  await askAgainButton(page).click();
  await expect(page.getByText(ASKED_AGAIN_NOTE, { exact: true })).toBeVisible();
  await expect(carNote).toBeVisible();
  await expect(note).toHaveCount(0);
  // Classic's presets carry neither (v14.7's copy).
  await engineButton(page, 'Classic').click();
  await expect(carNote).toHaveCount(0);
  await expect(note).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

// The perf HUD reader of hex.spec.ts (?perf=1): one line a second, with a `hex <moves>/s …` part while the wander runs.
function parseHud(line: string): { draws: number; hex: { moves: number } | null } {
  const draws = /draws ([\d.]+)\/s/.exec(line);
  if (!draws) throw new Error(`Not a perf HUD line: ${line}`);
  const hex = /hex ([\d.]+)\/s on ([\d.]+) glide ([\d.]+) e/.exec(line);
  return { draws: Number(draws[1]), hex: hex ? { moves: Number(hex[1]) } : null };
}

/** Record every line the perf HUD shows in window.__hud (call before openApp). */
async function recordHud(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__hud = [];
    const attach = () => {
      const hud = document.querySelector('[data-testid="perf-hud"]');
      if (!hud) return false;
      new MutationObserver(() => w.__hud.push(hud.textContent ?? '')).observe(hud, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      return true;
    };
    const watch = new MutationObserver(() => {
      if (attach()) watch.disconnect();
    });
    watch.observe(document, { childList: true, subtree: true });
  });
}

const latestMoves = async (page: Page) => {
  const line: string | undefined = await page.evaluate(() => (window as any).__hud.at(-1));
  return line === undefined ? 0 : (parseHud(line).hex?.moves ?? 0);
};

/**
 * Count the grid hexagons the canvas strokes in each frame into window.__hexFrames (call before openApp): a frame
 * starts at the full-canvas clear, and a grid hexagon is a stroked 6-corner path with corner 0 at (x + size, y) and
 * corner 3 at (x − size, y), size 40–120 px. hex.spec's draw recorder, counting only.
 */
async function countHexDraws(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__hexFrames = [];
    let count = -1;
    let path: number[] = [];
    const P = CanvasRenderingContext2D.prototype as any;
    const fillRect = P.fillRect;
    P.fillRect = function (x: number, y: number, width: number, height: number) {
      if (x === 0 && y === 0 && width === this.canvas.width && height === this.canvas.height) {
        if (count >= 0) {
          w.__hexFrames.push(count);
          if (w.__hexFrames.length > 600) w.__hexFrames.shift();
        }
        count = 0;
      }
      return fillRect.call(this, x, y, width, height);
    };
    const beginPath = P.beginPath;
    P.beginPath = function () {
      path = [];
      return beginPath.call(this);
    };
    const moveTo = P.moveTo;
    P.moveTo = function (x: number, y: number) {
      path.push(x, y);
      return moveTo.call(this, x, y);
    };
    const lineTo = P.lineTo;
    P.lineTo = function (x: number, y: number) {
      path.push(x, y);
      return lineTo.call(this, x, y);
    };
    const stroke = P.stroke;
    P.stroke = function (...args: unknown[]) {
      if (count >= 0 && path.length === 12) {
        const size = (path[0] - path[6]) / 2;
        if (size > 40 && size < 120 && Math.abs(path[1] - path[7]) < 1e-6) count++;
      }
      return stroke.apply(this, args);
    };
  });
}

test('with v2 selected the hex Pulse mode still wanders while music plays', async ({ page }) => {
  const errors = pageErrors(page);
  await recordHud(page);
  await countHexDraws(page);
  const dialogs = await openApp(page, { query: '?perf=1' });
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 1, 120);
  await startTrack(page);
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  const wander = page.getByRole('switch', { name: 'Wandering hexes' });
  if (!(await wander.isVisible())) await page.getByRole('button', { name: 'Visualization Engine' }).click();
  await expect(wander).toHaveAttribute('aria-checked', 'true');
  await page.locator('select', { has: page.locator('option[value="pulse"]') }).selectOption('pulse');
  await expect.poll(() => latestMoves(page), { timeout: 10_000 }).toBeGreaterThan(0);
  // The wander's pace comes from the track's envelope (or its fallback pulse), not the analyser, so the moves alone
  // can't tell whether the visualizer has one. Its cells can: a cell's Pulse level is 0 without the analyser
  // (Visualizer.tsx, `bufferLength > 0`), and a cell that dim is not drawn at all. With it, the radial wave's crest
  // lights a band of cells in every frame.
  await page.evaluate(() => ((window as any).__hexFrames = []));
  await page.waitForTimeout(3000);
  const drawn: number[] = await page.evaluate(() => (window as any).__hexFrames);
  test.info().annotations.push({ type: 'hexes', description: `${drawn.length} frames, ${Math.min(...drawn)}–${Math.max(...drawn)} hexagons each` });
  expect(drawn.length, 'frames drawn in 3 s').toBeGreaterThan(0);
  expect(Math.max(...drawn), 'grid hexagons the Pulse mode draws in a frame').toBeGreaterThan(10);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

// The dev page (tools/sound-check.html, build spec §8) renders the v2 player offline and checks it. Measured on this
// PC (headless Chrome 155 and Edge 155, the e2e dev server, 2026-10-21): 18–22 s a test in Chrome, 18–25 s in Edge
// with its launch. The timeout is twice that, but at least 120 s.
const SOUND_CHECK_TIMEOUT = 120_000;
const SOUND_CHECK_ROWS = 46; // rows Chromium runs (Firefox would skip the suspend mode; v15.2 adds Key fit's C14, C14b, C15 and C15c)

test('the sound-check page passes in Chrome (desktop only)', async ({ page }) => {
  test.skip(ON_DEVICE, 'renders ~50 M frames: too long for the phone, and it would warm it before the soak');
  test.setTimeout(SOUND_CHECK_TIMEOUT);
  const errors = pageErrors(page);
  const dialogs = pageDialogs(page);
  await page.goto('/tools/sound-check.html');
  const result = page.getByTestId('sound-check-result');
  await expect(result).toHaveText(/^(ALL PASS|FAIL)/, { timeout: SOUND_CHECK_TIMEOUT - 10_000 });
  await expect(result).toHaveText(`ALL PASS (${SOUND_CHECK_ROWS})`);
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('the sound-check page passes in Edge (desktop only)', async ({ baseURL }) => {
  test.skip(ON_DEVICE, 'renders ~50 M frames: too long for the phone, and it would warm it before the soak');
  test.setTimeout(SOUND_CHECK_TIMEOUT);
  const edge = await chromium
    .launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] })
    .catch((e: Error) => {
      if (/is not found at|not installed/i.test(e.message)) return null;
      throw e;
    });
  test.skip(!edge, 'Microsoft Edge is not installed');
  try {
    const page = await edge!.newPage({ serviceWorkers: 'block' });
    const errors = pageErrors(page);
    const dialogs = pageDialogs(page);
    await page.goto(`${baseURL}/tools/sound-check.html`);
    const result = page.getByTestId('sound-check-result');
    await expect(result).toHaveText(/^(ALL PASS|FAIL)/, { timeout: SOUND_CHECK_TIMEOUT - 10_000 });
    await expect(result).toHaveText(`ALL PASS (${SOUND_CHECK_ROWS})`);
    expect(errors).toEqual([]);
    expect(dialogs).toEqual([]);
  } finally {
    await edge!.close();
  }
});

/** The channels of a 24-bit PCM WAV (the app's "Audio Only" recording) as floats. */
function readWav24(buf: Buffer): { rate: number; channels: Float32Array[] } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let at = 12;
  let rate = 0;
  let count = 0;
  let bits = 0;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      count = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 24 || count < 2) throw new Error(`Expected 24-bit stereo, got ${bits}-bit × ${count}`);
      const frames = Math.floor(Math.min(size, buf.length - body) / (3 * count));
      const channels = Array.from({ length: count }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < count; c++) channels[c][i] = buf.readIntLE(body + (i * count + c) * 3, 3) / 8388607;
      }
      return { rate, channels };
    }
    at = body + size + (size & 1);
  }
  throw new Error('No data chunk');
}

const windows = new Map<number, Float64Array>();
/** Amplitude of the `hz` component of x in [t, t + len) s: a Goertzel through a Blackman-Harris window, scaled so a
 *  steady sine of amplitude A reads A. */
function level(x: Float32Array, rate: number, hz: number, t: number, len: number): number {
  const n = Math.round(len * rate);
  const start = Math.round(t * rate);
  if (start < 0 || start + n > x.length) throw new Error(`Window at ${t.toFixed(2)} s is outside the recording`);
  let w = windows.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / (n - 1);
      w[i] = 0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a);
    }
    windows.set(n, w);
  }
  const k = 2 * Math.cos((2 * Math.PI * hz) / rate);
  let s1 = 0;
  let s2 = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s0 = x[start + i] * w[i] + k * s1 - s2;
    s2 = s1;
    s1 = s0;
    sum += w[i];
  }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2))) / sum;
}
const dB = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));

/** Centre times of 0.1 s windows every 10 ms over the recording, with the `hz` amplitude in each. */
function sweep(x: Float32Array, rate: number, hz: number): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  for (let t = 0.05; t + 0.05 <= x.length / rate; t += 0.01) out.push({ t, v: level(x, rate, hz, t - 0.05, 0.1) });
  return out;
}

test('a recording of the A/B flips holds one engine at a time (desktop only)', async ({ page }) => {
  test.skip(ON_DEVICE, 'records and analyses 16 s of 48 kHz audio; a desktop run covers the engines');
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  // Headphones answered beforehand, so the v2 flip asks nothing. Classic is the engine (openApp chose it), and each
  // engine plays its own default tone level (v15.0: v2's sits 26 dB under its validated level).
  await seedLayers(page, { output: 'headphones' });
  // A silent track: the recording holds only the layers.
  const silence = toneWav(40, 220);
  silence.fill(0, 44);
  await addFiles(page, [{ name: 'silence-01.wav', mimeType: 'audio/wav', buffer: silence }]);
  // φ Track Timing off before anything plays: no envelope on either engine, so every layer holds its level (once
  // classic's φ loop has run, its beat stays at the envelope's last value).
  await openHarmonicControl(page);
  await page.getByText('Track Timing: Phi-proportioned', { exact: true }).locator('xpath=../../button').click();
  await startTrack(page, 'silence-01');
  await expect(page.getByText(/^Track Peak:/)).toHaveCount(0); // shown only while timing is on
  await tapTraditional(page, 852);
  // Classic's drone glides to 852's pitch over 8 s.
  await page.waitForTimeout(8_500);

  await page.locator('header button:has(svg.lucide-circle)').click();
  await page.getByRole('button', { name: 'Audio Only' }).click();
  await expect(page.getByRole('button', { name: 'REC' })).toBeVisible();
  await page.waitForTimeout(5_000);
  const toV2 = await clickAt(engineButton(page, 'v2'));
  await page.waitForTimeout(6_000);
  const toClassic = await clickAt(engineButton(page, 'Classic'));
  await page.waitForTimeout(5_000);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'REC' }).click();
  const { rate, channels } = readWav24(readFileSync(await (await download).path()));
  const [L, R] = channels;

  // Each engine's components at 852 Hz: classic tone 86.16, beat 200 (L) / 210 (R), drone 53.25; v2 tone 852,
  // beat 213 (L) / 223 (R), drone 26.625 — the ones checked are unique and ≥ 13 Hz from every other.
  // tA = v2's onset: its tone (nothing else near 852 Hz) first within 40 dB of its peak.
  const v2Tone = sweep(L, rate, 852);
  const v2Peak = Math.max(...v2Tone.map((p) => p.v));
  const tA = v2Tone.find((p) => p.v >= v2Peak / 100)!.t;
  // tB = classic's re-onset: its tone back within 40 dB of its level before tA.
  const classicTone = sweep(L, rate, 86.16);
  const before = classicTone.filter((p) => p.t > 0.5 && p.t < tA - 0.5).map((p) => p.v).sort((a, b) => a - b);
  const classicSteady = before[before.length >> 1];
  const tB = classicTone.find((p) => p.t > tA + 3 && p.v >= classicSteady / 100)?.t;
  expect(tB, 'classic came back').toBeDefined();
  // The onsets are the two taps: as far apart in the recording as in the page, give or take each flip's render and
  // v2's 0.05 s lead (measured 0.05–0.21 s), where a misdetection would be off by seconds.
  const visit = (toClassic - toV2) / 1000;
  expect(Math.abs(tB! - tA - visit), `onsets ${(tB! - tA).toFixed(3)} s apart, taps ${visit.toFixed(3)} s`).toBeLessThan(0.5);

  const components = (list: [string, Float32Array, number][]) => list.map(([name, x, hz]) => ({ name, x, hz }));
  const classic = components([['classic beat 200 Hz L', L, 200], ['classic tone L', L, 86.16], ['classic tone R', R, 86.16], ['classic drone L', L, 53.25], ['classic drone R', R, 53.25]]);
  const v2 = components([['v2 beat 223 Hz R', R, 223], ['v2 tone L', L, 852], ['v2 tone R', R, 852], ['v2 drone L', L, 26.625], ['v2 drone R', R, 26.625]]);
  const report: string[] = [`tA ${tA.toFixed(3)} s, tB ${tB!.toFixed(3)} s, taps ${visit.toFixed(3)} s apart`];
  // classic → v2: the outgoing classic layers ≥ 35 dB down 1 s after v2's onset and ≥ 60 dB down 2 s after (classic's
  // validated τ 0.25 fade reaches −60 dB at 1.73 s).
  for (const c of classic) {
    const ref = dB(level(c.x, rate, c.hz, tA - 0.75, 0.5));
    const at1 = dB(level(c.x, rate, c.hz, tA + 1, 0.5)) - ref;
    const at2 = dB(level(c.x, rate, c.hz, tA + 2, 0.5)) - ref;
    report.push(`${c.name}: steady ${ref.toFixed(1)} dBFS, ${at1.toFixed(1)} / ${at2.toFixed(1)} dB`);
    expect(ref, `${c.name}: steady level (dBFS)`).toBeGreaterThan(-60);
    expect.soft(at1, `${c.name}: tA+1…1.5 s, dB re steady`).toBeLessThanOrEqual(-35);
    expect.soft(at2, `${c.name}: tA+2…2.5 s, dB re steady`).toBeLessThanOrEqual(-60);
  }
  // v2 → classic: every v2 layer ≥ 60 dB down within 1 s (its 0.25 s stop, not the 3 s drone close of a pause).
  for (const c of v2) {
    const ref = dB(level(c.x, rate, c.hz, tB! - 0.75, 0.5));
    const after = dB(level(c.x, rate, c.hz, tB! + 0.5, 0.5)) - ref;
    report.push(`${c.name}: before ${ref.toFixed(1)} dBFS, ${after.toFixed(1)} dB`);
    expect(ref, `${c.name}: level before the flip back (dBFS)`).toBeGreaterThan(-60);
    expect.soft(after, `${c.name}: tB+0.5…1.0 s, dB re before`).toBeLessThanOrEqual(-60);
  }
  test.info().annotations.push({ type: 'levels', description: report.join('; ') });
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});

/** One event of recordAdaptive's record, at the page's performance.now(). */
type AdaptiveEvent = { t: number; e: 'arm' | 'tick' | 'clear' | 'chip'; id?: number; text?: string };

/**
 * From the next page load on, record the adaptive band on the page's own clock: every arm, tick and clear of a 3 s
 * interval (the app's only ones are the two adaptive effects', classic's and v2's) and every text the band chip shows
 * (a MutationObserver from document start, so it watches before the effect arms). The hysteresis is judged from these
 * times however long the steps around it take: opening Harmonic Control and tapping a tone take 7-9 s on a busy
 * machine, longer than the two ticks being judged.
 */
async function recordAdaptive(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { t: number; e: string; id?: number; text?: string }[] = ((window as any).__adaptive = []);
    const live = new Set<number>();
    const set = window.setInterval, clear = window.clearInterval;
    (window as any).setInterval = (handler: unknown, ms?: number, ...args: unknown[]) => {
      if (ms !== 3000 || typeof handler !== 'function') return set.call(window, handler as TimerHandler, ms, ...args);
      const id: number = set.call(window, () => {
        log.push({ t: performance.now(), e: 'tick', id });
        handler(...args);
      }, ms);
      live.add(id);
      log.push({ t: performance.now(), e: 'arm', id });
      return id;
    };
    (window as any).clearInterval = (id?: number) => {
      if (id !== undefined && live.delete(id)) log.push({ t: performance.now(), e: 'clear', id });
      clear.call(window, id);
    };
    let shown: string | null = null;
    new MutationObserver(() => {
      const title = document.querySelector('[data-testid="now-playing-title"]');
      const chip = title?.parentElement?.querySelector('span:has(> svg.lucide-waves)');
      const text = chip ? (chip.textContent ?? '').trim() : null;
      if (text === null || text === shown) return;
      shown = text;
      log.push({ t: performance.now(), e: 'chip', text });
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}
const adaptiveLog = (page: Page): Promise<AdaptiveEvent[]> => page.evaluate(() => (window as any).__adaptive);
/** The record's events of one kind after page time `t`. */
const eventsAfter = (log: AdaptiveEvent[], t: number, e: AdaptiveEvent['e']) => log.filter((x) => x.e === e && x.t > t);
/** The tick times of the interval first armed after page time `t` (none before it arms). */
function ticksOfArmAfter(log: AdaptiveEvent[], t: number): number[] {
  const arm = log.find((x) => x.e === 'arm' && x.t > t);
  return arm ? log.filter((x) => x.e === 'tick' && x.id === arm.id).map((x) => x.t) : [];
}
/** The most 3 s intervals live at once in the record. */
function mostLive(log: AdaptiveEvent[]): number {
  let live = 0, most = 0;
  for (const x of log) {
    if (x.e === 'arm') most = Math.max(most, ++live);
    else if (x.e === 'clear') live--;
  }
  return most;
}
/** The beat the v2 player was last asked for and the chip's last text, read together on the page ("20 Hz · Beta"). */
const beatAndChip = (page: Page) =>
  page.evaluate(() => {
    const chips = ((window as any).__adaptive as AdaptiveEvent[]).filter((x) => x.e === 'chip');
    return `${(window as any).__aetheriaLayers.state()?.requested?.beat_hz} Hz · ${chips[chips.length - 1]?.text}`;
  });
/** The record after page time `t0`, for the report: "tick +3.00 s, chip Beta +6.01 s, …". */
const adaptiveReport = (log: AdaptiveEvent[], t0: number) =>
  log.filter((x) => x.t > t0).map((x) => `${x.e}${x.text ? ' ' + x.text : ''} +${((x.t - t0) / 1000).toFixed(2)} s`).join(', ');

test("v2's adaptive band steps through its hysteresis, stops at its cap, and classic's adaptive stays off under v2", async ({ page }) => {
  const errors = pageErrors(page);
  await recordAdaptive(page);
  const dialogs = await openApp(page);
  await seedLayers(page, { engine: 'v2', output: 'headphones' });
  await importTones(page, 1, 120);   // the two phases take ~45 s here, more under load
  await expectCache(page, { blobs: 1, meta: 1, library: 1 });
  // As if Deep-Scanned at full intensity throughout: adaptive's target is Gamma (intensity 1.0).
  await writeBandEnvelope(page, 255, 120);
  await page.goto('/');
  await acceptDisclaimer(page);
  await expect(bandChip(page)).toHaveText('Alpha'); // the preset starts at Alpha; adaptive is on by default

  // Headphones: the play arms the 3 s interval; a step needs two agreeing ticks in a row, and headphones stop at Beta.
  // Six ticks: the step at the second, then none. (The waits count every 3 s tick, so a second interval or a re-arm
  // fails below, by name; the times judged are the play's own interval's.)
  const played = await pageNow(page);
  await listed(page, 'tone-01').click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await openHarmonicControl(page);
  await tapTraditional(page, 528);
  await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0).toBe(528);
  await expect.poll(async () => eventsAfter(await adaptiveLog(page), played, 'tick').length, { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
  const hp = await adaptiveLog(page);
  test.info().annotations.push({ type: 'headphones', description: adaptiveReport(hp, played) });
  // Classic's adaptive (every 3 s too, a band a tick, no hysteresis or cap) never runs beside v2's.
  expect(mostLive(hp), '3 s intervals live at once').toBe(1);
  const [armed, ...rearmed] = eventsAfter(hp, played, 'arm');
  expect(armed, 'the play arms the interval').toBeDefined();
  expect([...rearmed, ...eventsAfter(hp, played, 'clear')], 'no re-arm (it would reset the hysteresis): not even the band step').toEqual([]);
  const [, t2, t3] = ticksOfArmAfter(hp, played);
  const steps = eventsAfter(hp, played, 'chip');
  expect(steps.map((x) => x.text), 'the chip over six ticks: one step, to the binaural cap').toEqual(['Beta']);
  expect(steps[0].t, 'one tick is not enough').toBeGreaterThan(t2);
  expect(steps[0].t, 'two agreeing ticks are: the step comes before the third').toBeLessThan(t3);
  expect(await beatAndChip(page), "Beta's beat reaches the player").toBe('20 Hz · Beta');

  // Off headphones the pulse is capped at Alpha at once (the render change re-arms the interval with the pulse's cap);
  // the preset follows after two agreeing ticks, then holds: six ticks, the pulse sampled meanwhile.
  const toSpeakers = await clickAt(outputButton(page, 'Speakers'));
  // The player plays Alpha's pulse while the preset is still Beta: the cap, not a step (that would take two ticks).
  await expect.poll(() => beatAndChip(page), { timeout: 5_000 }).toBe('10 Hz · Pulse · Alpha (capped)');
  const deadline = Date.now() + 40_000;
  while (eventsAfter(await adaptiveLog(page), toSpeakers, 'tick').length < 6) {
    expect(Date.now(), 'six ticks after the tap').toBeLessThan(deadline);
    expect((await layersState(page)).requested.beat_hz, 'the pulse stays at Alpha').toBe(10);
    await page.waitForTimeout(500);
  }
  const sp = await adaptiveLog(page);
  test.info().annotations.push({ type: 'speakers', description: adaptiveReport(sp, toSpeakers) });
  expect(mostLive(sp), '3 s intervals live at once').toBe(1);
  const [pulseArmed, ...more] = eventsAfter(sp, toSpeakers, 'arm');
  expect(pulseArmed, 'the render change re-arms the interval').toBeDefined();
  expect(more, 'once').toEqual([]);
  expect(eventsAfter(sp, toSpeakers, 'clear').map((x) => x.id), "the headphones interval's clear").toEqual([armed.id]);
  const [p1, p2, p3] = ticksOfArmAfter(sp, toSpeakers);
  const chips = eventsAfter(sp, toSpeakers, 'chip');
  expect(chips.map((x) => x.text), 'the chip over six ticks off headphones').toEqual(['Pulse · Alpha (capped)', 'Pulse · Alpha']);
  expect(chips[0].t, 'capped at once, before any tick').toBeLessThan(p1);
  expect(chips[1].t, 'one tick is not enough').toBeGreaterThan(p2);
  expect(chips[1].t, 'two agreeing ticks are: the preset steps before the third').toBeLessThan(p3);
  expect(await chipText(page)).toBe('Pulse · Alpha');
  expect(errors).toEqual([]);
  expect(dialogs).toEqual([]);
});
