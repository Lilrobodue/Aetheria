import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  PHONE_VIEWPORT,
  libraryRowButton,
  libraryState,
  openLibraryTab,
  openSeededNewLayout,
  pauseCount,
  recordHudDraws,
  renders,
  resetRenders,
  rowMenu,
  tab,
  crash,
  controlStateSaves,
} from './helpers';
import { caughtDownloads, revoked, stubDownloads } from './downloads';
import { wavReport } from './wav';
import { moreRow, moreView } from './moreKit';
import { MEDIA, ffmpegAvailable, joined, junkAfterTag, midId3Bogus, understateFlac, id3v2Tag, apeTag, bogusLeadingTag } from './media';

// v16.5, Export with layers (the addendum §5.3, at the user's 24-bit 48 kHz, decision 4 B). A track or a playlist as a
// new WAV with its layers: the summary, Made for (decision 1 B), the file (24-bit 48 kHz, the music retuned and never
// scaled, the layers the app's own player's), the cap, the loud master's layer-only catch, a playlist as files or one
// long file (decision 2 B), Cancel, alongside playback, Share, renders, the guards, the lazy chunk, the engine against a
// full-rate render. Downloads are caught in the page (downloads.ts) or kept by the dev hook: nothing is saved, on a phone
// too. Runs against the dev server.

const PSF = 0.981818;
const LEVEL_BEAT = 0.0708;
const LEVEL_TONE = 0.0501;
const SEED_RATE = 8000;
const db = (x: number) => 20 * Math.log10(x);
/** A seeded real tone's pitch (helpers.seedLibraryRecords: 220 + (i % 40) × 17 Hz) and its level (8000 / 32768). */
const toneHz = (i: number) => 220 + (i % 40) * 17;
const SEED_DB = db(8000 / 32768);

/** φ timing's envelope (aetheria_sound_v2.phiEnvelope), for the expected layer level over a window. */
function phiEnvelope(position: number, duration: number): number {
  const PHI = 1.618033988749895, INV_PHI = 1 / PHI, INV_PHI2 = 1 / (PHI * PHI);
  if (duration <= 0) return 1;
  const p = Math.min(1, Math.max(0, position / duration));
  if (p < INV_PHI2) return 0.8 * Math.pow(p / INV_PHI2, PHI);
  if (p < INV_PHI) return 0.8 + (0.2 * (p - INV_PHI2)) / (INV_PHI - INV_PHI2);
  return Math.pow(1 - (0.3 * (p - INV_PHI)) / INV_PHI2, INV_PHI);
}
/** The Hann-weighted mean of φ over [t0, t1] of a T-second file (what a Hann DFT reads of a sine under that envelope). */
function hannPhi(t0: number, t1: number, T: number): number {
  let s = 0, w = 0;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    s += h * phiEnvelope(t0 + ((t1 - t0) * i) / (n - 1), T);
    w += h;
  }
  return s / w;
}

async function hookReady(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof (window as any).__aetheriaExport?.render === 'function', null, { timeout: 10_000 });
}
async function hookRender(page: Page, id: string, o: Record<string, unknown> = {}) {
  await hookReady(page);
  return page.evaluate(({ id, o }) => (window as any).__aetheriaExport.render(id, { keepBlob: true, ...o }), { id, o });
}

const exportSheet = (page: Page) => page.getByRole('dialog', { name: 'Export with layers', exact: true }).or(page.getByRole('region', { name: 'Export with layers', exact: true }));

/** Library › a row's ⋯ › Export with layers…. */
async function openExportFromRow(page: Page, name: string): Promise<void> {
  await openLibraryTab(page);
  await rowMenu(page, name).click();
  await page.getByTestId('library-menu-export').click();
  await expect(exportSheet(page)).toBeVisible();
}

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('E1. a track for headphones from its row ⋯: the summary, one download by name, and the file: 24-bit 48 kHz, retuned, the music at its level, the binaural pair, the drone, no clipping, click-free seams, its title, a round trip @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 20 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    await expect(sheet).toContainText('tone-0001 · 0:20');
    await expect(sheet.getByTestId('export-row-music')).toContainText('Retuned to 432 Hz, as you hear it');
    await expect(sheet.getByTestId('export-row-music')).toContainText('At its own level: never turned down');
    await expect(sheet.getByTestId('export-row-crystal')).toContainText('174 Hz · GUT');
    await expect(sheet.getByTestId('export-row-crystal')).toContainText('Its assigned crystal');
    await expect(sheet.getByTestId('export-row-layers')).toContainText('binaural beat, Alpha');
    await expect(sheet.getByTestId('export-row-keyfit')).toContainText('No key data for this track');
    await expect(sheet.getByTestId('export-row-phi')).toContainText('The layers rise and settle over the track');
    await expect(sheet.getByTestId('export-file-line')).toContainText('WAV · 24-bit · 48 kHz · 0:20');
    await expect(sheet.getByRole('group', { name: 'Made for' }).getByRole('button', { name: 'Headphones' })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    const files = await caughtDownloads(page, 1);
    expect(files.map((f) => f.name)).toEqual(['tone-0001 · 174 Hz · Aetheria.wav']);
    await expect(sheet.getByTestId('export-done-file')).toContainText('tone-0001 · 174 Hz · Aetheria.wav');
    await expect(sheet.getByTestId('export-done-file')).toContainText('WAV 24-bit 48 kHz');
    // The file.
    const T = (20 / PSF);
    const f = toneHz(0) * PSF;
    // The plan (the hook's record of the same spec): the carrier, the partner (carrier + 10 Hz, Alpha) and the drone.
    const planRec = (await hookRender(page, (await libraryState(page)).libraryIds[0])).files[0].plan;
    expect(planRec.rate, 'the layers rendered at 12,000 Hz (v16.5 review B18: a structural pin)').toBe(12_000);
    const plan = planRec.segments[0];
    const w = await wavReport(page, 'download', 0, [
      { f, t0: 6, t1: 14, ch: 0 },
      { f: toneHz(0), t0: 6, t1: 14, ch: 0 },
      { f: plan.carrierHz, t0: 6, t1: 14, ch: 0 },
      { f: plan.carrierHz + 10, t0: 6, t1: 14, ch: 1 },
      { f: plan.carrierHz + 10, t0: 6, t1: 14, ch: 0 },
      { f: plan.carrierHz, t0: 6, t1: 14, ch: 1 },
      { f: plan.droneHz, t0: 10, t1: 16, ch: 0 },
      { f: plan.toneHz, t0: 6, t1: 14, ch: 0 },
    ], { seams: true });
    test.info().annotations.push({ type: 'E1 levels (dB)', description: JSON.stringify({ plan, amps: w.amps.map((a) => +a.toFixed(2)), seam: w.seamD2, other: w.otherD2 }) });
    expect([w.format, w.channels, w.rate, w.bits]).toEqual([1, 2, 48_000, 24]);
    expect(Math.abs(w.frames - Math.round((20 * SEED_RATE * 48_000) / (SEED_RATE * PSF))), `frames ${w.frames}`).toBeLessThanOrEqual(2);
    expect(Math.abs(w.amps[0] - SEED_DB), `the music at f × PSF: ${w.amps[0].toFixed(3)} dB`).toBeLessThanOrEqual(0.1);
    expect(w.amps[1], 'nothing at the unshifted pitch').toBeLessThan(-80);
    const beatDb = db(LEVEL_BEAT * hannPhi(6, 14, T));
    expect(Math.abs(w.amps[2] - beatDb), `the carrier (L) ${w.amps[2].toFixed(2)} vs ${beatDb.toFixed(2)}`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(w.amps[3] - beatDb), `the partner (R) ${w.amps[3].toFixed(2)} vs ${beatDb.toFixed(2)}`).toBeLessThanOrEqual(0.5);
    expect(w.amps[4] - w.amps[3], 'the partner stays in the right ear').toBeLessThan(-60);
    expect(w.amps[5] - w.amps[2], 'the carrier stays in the left ear').toBeLessThan(-60);
    expect(w.amps[6], 'the drone is there').toBeGreaterThan(-45);
    expect(w.amps[7], 'the tone is there').toBeGreaterThan(db(LEVEL_TONE * 0.05) - 6);
    expect(w.clipped, 'no clipped samples').toBe(0);
    expect(w.seamD2, 'the slice seams are click-free').toBeLessThanOrEqual(1.02 * w.otherD2);
    expect(w.title).toBe('tone-0001');
    // A round trip: Chrome decodes the file again to the same length.
    const back = await page.evaluate(async () => {
      const d = (window as any).__downloads[0];
      const ctx = new OfflineAudioContext(2, 1, 48_000);
      const b = await ctx.decodeAudioData(d.buf.slice(0));
      return b.length;
    });
    expect(back).toBe(w.frames);
    expect(dialogs).toEqual([]);
  });

  test('E1b. the music’s top end: a 15 kHz tone in a 44.1 kHz file comes out at 15 kHz × PSF at its own level (the varispeed decode; a playbackRate resample would droop it)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('aetheria.musicOnly.v1', 'true'));
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 10, patch: [{ index: 0, seconds: 10, rate: 44_100, freq: 15_000, amp: 16_384 }] });
    const r = await hookRender(page, (await libraryState(page)).libraryIds[0]);
    expect(r.outcome).toBe('done');
    const w = await wavReport(page, 'hook', 0, [
      { f: 15_000 * PSF, t0: 3, t1: 7, ch: 0 },
      { f: 15_000, t0: 3, t1: 7, ch: 0 },
    ]);
    test.info().annotations.push({ type: 'E1b 15 kHz (dB)', description: JSON.stringify(w.amps.map((a) => +a.toFixed(3))) });
    expect(Math.abs(w.amps[0] - db(16_384 / 32_768)), `the 15 kHz tone at its level: ${w.amps[0].toFixed(3)} dB`).toBeLessThanOrEqual(0.1);
    expect(w.amps[1], 'nothing at the unshifted pitch').toBeLessThan(-80);
    expect(dialogs).toEqual([]);
  });

  test('E2. Made for: Speakers puts the carrier in both ears with the pulse and no drone; Tone only has the tone alone; the names say so; the default is the Output', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20 });
    await page.setViewportSize(PHONE_VIEWPORT);
    const id = (await libraryState(page)).libraryIds[0];
    const sp = await hookRender(page, id, { madeFor: 'speakers' });
    expect(sp.files[0].name).toBe('tone-0001 · 174 Hz · speakers · Aetheria.wav');
    const spPlan = sp.files[0].plan.segments[0];
    const s = await wavReport(page, 'hook', 0, [
      { f: spPlan.carrierHz, t0: 6, t1: 14, ch: 0 },
      { f: spPlan.carrierHz, t0: 6, t1: 14, ch: 1 },
      { f: spPlan.carrierHz + 10, t0: 6, t1: 14, ch: 0 },
      { f: spPlan.carrierHz - 10, t0: 6, t1: 14, ch: 1 },
      { f: spPlan.droneHz || 43.5, t0: 10, t1: 16, ch: 0 },
    ]);
    expect(Math.abs(s.amps[0] - s.amps[1]), 'the carrier equal in both ears').toBeLessThan(0.5);
    expect(s.amps[2], 'the pulse’s sidebands').toBeGreaterThan(s.amps[0] - 30);
    expect(s.amps[3]).toBeGreaterThan(s.amps[0] - 30);
    expect(s.amps[4], 'no drone').toBeLessThan(-80);
    const tone = await hookRender(page, id, { madeFor: 'tone' });
    expect(tone.files[0].name).toBe('tone-0001 · 174 Hz · tone only · Aetheria.wav');
    const tPlan = tone.files[0].plan.segments[0];
    const t = await wavReport(page, 'hook', 0, [
      { f: tPlan.toneHz, t0: 6, t1: 14, ch: 0 },
      { f: spPlan.carrierHz, t0: 6, t1: 14, ch: 0 },
      { f: 43.5, t0: 10, t1: 16, ch: 0 },
    ]);
    expect(t.amps[0], 'the tone').toBeGreaterThan(-75);
    expect(t.amps[1], 'no carrier').toBeLessThan(-80);
    expect(t.amps[2], 'no drone').toBeLessThan(-80);
    // The default follows the Output: Car → Tone only.
    await page.evaluate(() => localStorage.setItem('aetheria.layerOutput.v1', 'car'));
    await page.reload();
    await page.getByTestId('new-shell').waitFor();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(2);
    await page.setViewportSize(PHONE_VIEWPORT);
    await openExportFromRow(page, 'tone-0001');
    const group = exportSheet(page).getByRole('group', { name: 'Made for' });
    await expect(group.getByRole('button', { name: 'Tone only' })).toHaveAttribute('aria-pressed', 'true');
    await expect(group).toContainText('Your Output: Tone only');
    await group.getByRole('button', { name: 'Speakers' }).click();
    await expect(exportSheet(page).getByTestId('export-made-for-line')).toHaveText('A gentle pulse in place of the binaural beat; no drone.');
    expect(dialogs).toEqual([]);
  });

  test('E3. Music only: the summary says so; the file holds the music alone (every layer under −100 dB), the music unchanged', async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => localStorage.setItem('aetheria.musicOnly.v1', 'true'));
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openExportFromRow(page, 'tone-0001');
    await expect(exportSheet(page).getByTestId('export-row-layers')).toHaveText(/Music only is on, so the file has the music alone\./);
    await page.keyboard.press('Escape');
    const r = await hookRender(page, (await libraryState(page)).libraryIds[0]);
    expect(r.files[0].name).toBe('tone-0001 · Aetheria.wav');
    expect(r.files[0].plan).toBeNull();
    const w = await wavReport(page, 'hook', 0, [
      { f: toneHz(0) * PSF, t0: 6, t1: 14, ch: 0 },
      { f: 348, t0: 6, t1: 14, ch: 0 },
      { f: 358, t0: 6, t1: 14, ch: 1 },
      { f: 174, t0: 6, t1: 14, ch: 0 },
      { f: 43.5, t0: 6, t1: 14, ch: 0 },
    ]);
    expect(Math.abs(w.amps[0] - SEED_DB), 'the music unchanged').toBeLessThanOrEqual(0.05);
    for (const a of w.amps.slice(1)) expect(a, 'no layer').toBeLessThan(-100);
    expect(dialogs).toEqual([]);
  });

  test('E4. the cap: over it, the sheet names the limit and exports nothing; a stored length that was wrong is caught before the read and the decode (v16.5 review B1)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20, patch: [{ index: 1, storedSeconds: 5 }] });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(10));
    // The engine's own check, before the read: refused with nothing read or decoded.
    const pre = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), (await libraryState(page)).libraryIds[0]);
    expect([pre.outcome, pre.reason]).toEqual(['failed', 'cap']);
    expect(pre.steps, 'refused before the read: no step ran').toEqual([]);
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    await expect(sheet.getByTestId('export-cant')).toContainText('This track is');
    await expect(sheet.getByTestId('export-cant')).toContainText('Export with layers takes tracks up to');
    // The over-the-cap screen (export-overcap-phone.png): the limit, why, and Close; nothing to export.
    await expect(sheet.getByTestId('export-overcap')).toContainText('Longer tracks need more memory than');
    await expect(sheet.getByTestId('export-start')).toHaveCount(0);
    await page.waitForTimeout(3000);
    expect((await caughtDownloads(page)).length, 'no download').toBe(0);
    await sheet.getByTestId('export-close').click();
    await expect(exportSheet(page)).toHaveCount(0);
    // tone-0002 says 5 s, plays 20 s: its header's length refuses it before anything is read or decoded.
    const wrong = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), (await libraryState(page)).libraryIds[1]);
    expect([wrong.outcome, wrong.reason]).toEqual(['failed', 'cap']);
    expect(wrong.steps.map((s: any) => s.step), 'the length step only: no read, no decode').toEqual(['length']);
    await openExportFromRow(page, 'tone-0002');
    await expect(sheet.getByTestId('export-start')).toBeEnabled();
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-failed')).toBeVisible({ timeout: 30_000 });
    await expect(sheet.getByTestId('export-failed-line')).toContainText('The export stopped: This track is');
    expect((await caughtDownloads(page)).length, 'nothing saved').toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('E5. a loud master: the layer-only catch keeps the sum under full scale (0 clipped) and never turns the music down; at a −6 dB master it does nothing', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 2, {
      real: 2,
      seconds: 20,
      patch: [{ index: 0, amp: 32_700, freq: 348 * 1 / PSF, seconds: 20 }, { index: 1, amp: 16_384, seconds: 20 }],
    });
    const ids = (await libraryState(page)).libraryIds;
    const maxSnap = { toneLevel: 0.04, beatLevel: 0.12 };
    const r = await hookRender(page, ids[0], { snap: maxSnap });
    test.info().annotations.push({ type: 'E5 loud', description: JSON.stringify(r.files[0]) });
    expect(r.files[0].clipped, 'nothing clipped').toBe(0);
    expect(r.files[0].catchFraction, 'the catch worked').toBeGreaterThan(0);
    const w = await wavReport(page, 'hook', 0, [{ f: 348, t0: 6, t1: 14, ch: 1 }]);
    // The music (at 348 Hz after the retune) in the right ear, where the partner (358 Hz) doesn't sit: its own level.
    expect(Math.abs(w.amps[0] - db(32_700 / 32_768)), `the music never turned down: ${w.amps[0].toFixed(3)}`).toBeLessThanOrEqual(0.05);
    const quiet = await hookRender(page, ids[1]);
    expect(quiet.files[0].catchFraction, 'a −6 dB master: no catch').toBe(0);
    expect(quiet.files[0].clipped).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('E6. a playlist, one file per track: the sheet lists what each gets (too long, audio missing), Export saves the present tracks in order, names distinct', async ({ page }) => {
    test.setTimeout(180_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 5, {
      real: 5,
      seconds: 12,
      patch: [{ index: 3, seconds: 30 }],
      playlists: [{ id: 'pexport', name: 'Evening', indexes: [0, 1, 2, 3], missing: 1 }],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(20));
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    await page.locator('[data-testid="playlist-row"][data-playlist-id="pexport"]').getByRole('button', { name: /Options for/ }).click();
    await page.getByTestId('playlist-menu-export').click();
    const sheet = exportSheet(page);
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Evening · 5 tracks');
    const rows = sheet.getByTestId('export-track');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(3)).toContainText('Too long: skipped');
    await expect(rows.nth(4)).toContainText('Audio missing: skipped');
    await expect(sheet.getByTestId('export-totals')).toContainText('3 files, one per track');
    await expect(sheet.getByTestId('export-files-each')).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
    const files = await caughtDownloads(page, 3);
    expect(files.map((f) => f.name)).toEqual(['tone-0001 · 174 Hz · Aetheria.wav', 'tone-0002 · 285 Hz · Aetheria.wav', 'tone-0003 · 396 Hz · Aetheria.wav']);
    for (let i = 0; i < 3; i++) {
      const w = await wavReport(page, 'download', i, [{ f: toneHz(i) * PSF, t0: 4, t1: 8, ch: 0 }]);
      expect(Math.abs(w.frames - Math.round((12 * 48_000) / PSF)), `file ${i}: frames`).toBeLessThanOrEqual(2);
      expect(Math.abs(w.amps[0] - SEED_DB), `file ${i}: its music`).toBeLessThanOrEqual(0.1);
    }
    expect(dialogs).toEqual([]);
  });

  test('E6b. a playlist as ONE long file (decision 2 B): one download, its length the sum of the retuned tracks, the join click-free, the layers carrying on across it', async ({ page }) => {
    test.setTimeout(180_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 3, {
      real: 3,
      seconds: 12,
      patch: [{ index: 0, crystal: 528 }, { index: 1, crystal: 528 }, { index: 2, crystal: 528 }],
      playlists: [{ id: 'plongfile', name: 'Night', indexes: [0, 1, 2] }],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    await page.locator('[data-testid="playlist-row"][data-playlist-id="plongfile"]').getByRole('button', { name: /Options for/ }).click();
    await page.getByTestId('playlist-menu-export').click();
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-files-long').click();
    await expect(sheet.getByTestId('export-files-long')).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByTestId('export-files')).toContainText('One long file: no gaps, the layers carry on across tracks. Downloads only.');
    await expect(sheet.getByTestId('export-start')).toHaveText(/Export one file/);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
    const files = await caughtDownloads(page, 1);
    expect(files.map((f) => f.name)).toEqual(['Night · Aetheria.wav']);
    const each = Math.round((12 * 48_000) / PSF);
    const join1 = each / 48_000;
    // The carrier (528 → 264 Hz headphones' carrier, alpha) in 0.5 s windows around the first join: no step.
    const around = [-1.5, -1, -0.5, 0, 0.5, 1].map((d) => join1 + d);
    const w = await wavReport(page, 'download', 0, around.map((t) => ({ f: 264, t0: t, t1: t + 0.5, ch: 0 as const })), { seams: true, rmsWin: 0.25 });
    // φ timing (on, as here) restarts its envelope with each track, as App's level tick does live: a dip after the join.
    test.info().annotations.push({ type: 'E6b carrier around the join, φ timing on (dB)', description: w.amps.map((a) => a.toFixed(2)).join(' ') });
    expect(Math.abs(w.frames - 3 * each), `the length is the sum of the retuned tracks (${w.frames} vs ${3 * each})`).toBeLessThanOrEqual(6);
    expect(w.clipped).toBe(0);
    expect(w.seamD2, 'click-free').toBeLessThanOrEqual(1.02 * w.otherD2);
    // With φ timing off, the same playlist through the hook: one continuous player, the same crystal, so no retune and no
    // step at the join.
    const r = await hookRender(page, '', { playlistId: 'plongfile', files: 'long', snap: { phiOn: false } });
    expect(r.outcome).toBe('done');
    // v16.5 review: the seam oracle at the real joins (it read only k·4096 ± 2 before).
    const seamed = await wavReport(page, 'hook', 0, [], { seams: true, joins: r.files[0].joins });
    test.info().annotations.push({ type: 'E6b the joins (frames) and their 2nd differences', description: JSON.stringify({ joins: r.files[0].joins, joinD2: seamed.joinD2, otherD2: seamed.otherD2 }) });
    expect(r.files[0].joins.length).toBe(2);
    expect(seamed.seamD2, 'the joins and the slice seams are click-free').toBeLessThanOrEqual(1.02 * seamed.otherD2);
    const flat = await wavReport(page, 'hook', 0, around.map((t) => ({ f: 264, t0: t, t1: t + 0.5, ch: 0 as const })));
    test.info().annotations.push({ type: 'E6b carrier around the join, φ timing off (dB)', description: flat.amps.map((a) => a.toFixed(2)).join(' ') });
    const lo = Math.min(...flat.amps), hi = Math.max(...flat.amps);
    expect(hi - lo, 'the layers carry on across the join (no dip)').toBeLessThan(1);
    expect(dialogs).toEqual([]);
  });

  test('E7. Cancel mid-mix: no download, the job clears and a second export completes; its download URL is revoked', async ({ page }) => {
    test.setTimeout(180_000);
    await stubDownloads(page);
    // The revoke's 60 s, shortened in the page (as record.spec R9).
    await page.addInitScript(() => {
      const st = window.setTimeout;
      (window as any).setTimeout = function (fn: TimerHandler, ms?: number, ...rest: unknown[]) {
        return st(fn, ms === 60_000 ? 300 : ms, ...(rest as []));
      };
    });
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 50 }));
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-phase')).toHaveText('Writing the file', { timeout: 30_000 });
    await sheet.getByTestId('export-cancel').click();
    await expect(sheet.getByTestId('export-summary')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(5000);
    expect((await caughtDownloads(page)).length, 'nothing saved').toBe(0);
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 0 }));
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    expect((await caughtDownloads(page, 1)).length).toBe(1);
    await expect.poll(async () => (await revoked(page, 0)).mine, { timeout: 5_000, message: 'the file’s URL is revoked' }).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('E9. Share: offered within the limit, a File named as the download, typed audio/wav, the same size; over 50 MiB the line says so; a closed share sheet says nothing @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.__shared = [] as unknown[];
      w.__shareMode = 'ok';
      (navigator as any).canShare = () => true;
      (navigator as any).share = (d: { files: File[] }) => {
        w.__shared.push(d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
        return w.__shareMode === 'abort' ? Promise.reject(new DOMException('closed', 'AbortError')) : Promise.resolve();
      };
    });
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    const files = await caughtDownloads(page, 1);
    await expect(sheet.getByTestId('export-share-line')).toHaveText('Share sends a copy to another app. It takes files up to 50 MB.');
    await sheet.getByTestId('export-share').click();
    await expect.poll(() => page.evaluate(() => (window as any).__shared.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__shared[0])).toEqual([{ name: files[0].name, type: 'audio/wav', size: files[0].size }]);
    // A closed share sheet (AbortError): nothing said.
    await page.evaluate(() => ((window as any).__shareMode = 'abort'));
    await sheet.getByTestId('export-share').click();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('notices')).not.toContainText("Share isn't available");
    // Over 50 MiB: no Share, the line.
    await sheet.getByTestId('export-done-button').click();
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ fakeBytes: 51 * 1024 * 1024 }));
    await openExportFromRow(page, 'tone-0001');
    await exportSheet(page).getByTestId('export-start').click();
    await expect(exportSheet(page).getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    await expect(exportSheet(page).getByTestId('export-share')).toHaveCount(0);
    await expect(exportSheet(page).getByTestId('export-share-line')).toHaveText('Too large to share from here (over 50 MB). Open it from your downloads to send it.');
    // The sheet closed while it runs: the toast, with Share.
    await page.evaluate(() => { (window as any).__aetheriaExport.tuning({ fakeBytes: null, sliceDelayMs: 20 }); (window as any).__shareMode = 'ok'; });
    await exportSheet(page).getByTestId('export-done-button').click();
    await openExportFromRow(page, 'tone-0002');
    await exportSheet(page).getByTestId('export-start').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('notices')).toContainText('Saved to your downloads: tone-0002', { timeout: 60_000 });
    await page.getByTestId('notices').getByRole('button', { name: 'Share', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__shared.length)).toBe(3);
    expect(dialogs).toEqual([]);
  });

  test('E10. renders while running (DEV): only the progress leaf renders, at most 4 a second; App commits for the export: its start and its end', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 20 }));
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    // The app settles first (the restore's own work): a quiet 2 s before the export starts.
    await expect
      .poll(async () => { await resetRenders(page); await page.waitForTimeout(2000); return Object.values(await renders(page)).reduce((a: number, b) => a + (b as number), 0); }, { timeout: 30_000, message: 'the app is quiet' })
      .toBe(0);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-phase')).toHaveText('Writing the file', { timeout: 30_000 });
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const r = await renders(page);
    const others = Object.entries(r).filter(([k, n]) => k !== 'ExportProgress' && n > 0);
    test.info().annotations.push({ type: 'E10 renders over 3 s', description: JSON.stringify(r) });
    // StrictMode renders twice in dev: 4 a second for 3 s, + 1, is 13 renders, 26 counts.
    expect(r.ExportProgress ?? 0).toBeLessThanOrEqual(26);
    expect(r.ExportProgress ?? 0).toBeGreaterThan(0);
    expect(others, 'nothing else renders while it runs (paused: no clock)').toEqual([]);
    await resetRenders(page);
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    expect((await renders(page)).App ?? 0, 'the end: one App commit (two renders in StrictMode)').toBeLessThanOrEqual(2);
    expect(dialogs).toEqual([]);
  });

  test('E11b. Analyse tracks running holds Export: the sheet says so and Export is off; stopped, Export is on again', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 6, { real: 6, seconds: 40 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openLibraryTab(page);
    await page.waitForFunction(() => !!(window as any).__aetheriaAnalyse, null, { timeout: 10_000 });
    const phase = () => page.evaluate(() => (window as any).__aetheriaAnalyse.state().phase as string);
    // Slowed, so the run outlasts the checks.
    await page.evaluate(() => (window as any).__aetheriaAnalyse.tune({ duty: 0.02 }));
    await page.getByTestId('health-analyse-action').click();
    await expect.poll(phase, { timeout: 15_000 }).not.toBe('idle');
    await rowMenu(page, 'tone-0001').click();
    await page.getByTestId('library-menu-export').click();
    await expect(exportSheet(page).getByTestId('export-cant')).toHaveText("Analyse tracks is running. Export when it's done, or stop it in Library.");
    await expect(exportSheet(page).getByTestId('export-start')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByTestId('health-analyse-action').click();
    await expect.poll(phase, { timeout: 30_000 }).toBe('idle');
    await rowMenu(page, 'tone-0001').click();
    await page.getByTestId('library-menu-export').click();
    await expect(exportSheet(page).getByTestId('export-cant')).toHaveCount(0);
    await expect(exportSheet(page).getByTestId('export-start')).toBeEnabled();
    expect(dialogs).toEqual([]);
  });

  test('E11. the guards: About’s Reload waits for a running export; another row while one runs opens the running sheet; More follows it', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 60 }));
    await openExportFromRow(page, 'tone-0001');
    await exportSheet(page).getByTestId('export-start').click();
    await expect(exportSheet(page).getByTestId('export-running')).toBeVisible();
    await page.keyboard.press('Escape');
    // Another row opens the running sheet; More's card follows it.
    await openExportFromRow(page, 'tone-0002');
    await expect(exportSheet(page).getByTestId('export-running')).toBeVisible();
    await page.keyboard.press('Escape');
    await tab(page, 'more');
    if ((await moreView(page)) !== 'root') await tab(page, 'more');
    await expect(page.getByTestId('more-exporting-card')).toContainText(/Exporting tone-0001 · \d+ %/);
    await expect(moreRow(page, 'more-record-row')).toContainText(/Exporting tone-0001 · \d+ %/);
    // About's Reload.
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    // v16.5 review (B5): the update banner's Reload waits for it too, with About's words.
    await expect(page.getByTestId('notices').getByTestId('update-reload')).toBeDisabled();
    await expect(page.getByTestId('notices').getByTestId('update-reload-note')).toHaveText('Wait for the export to finish: reloading would lose it.');
    await moreRow(page, 'more-about-row').click();
    await expect(page.getByTestId('more-about').getByRole('button', { name: 'Reload', exact: true })).toBeDisabled();
    await expect(page.getByTestId('more-about')).toContainText('Wait for the export to finish: reloading would lose it.');
    await page.evaluate(() => (window as any).__aetheriaExport.cancel());
    await expect(page.getByTestId('more-about').getByRole('button', { name: 'Reload', exact: true })).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByTestId('notices').getByTestId('update-reload')).toBeEnabled();
    await expect(page.getByTestId('notices').getByTestId('update-reload-note')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('E14. crash drill (DEV): the Export sheet’s body falls back inside the sheet; the music plays on', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 40 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await openExportFromRow(page, 'tone-0002');
    const p0 = await pauseCount(page);
    await crash(page, 'sheet-export');
    await expect(exportSheet(page).getByText('This sheet hit a problem.')).toBeVisible();
    const t0 = (await libraryState(page)).t ?? 0;
    await page.waitForTimeout(2000);
    expect(((await libraryState(page)).t ?? 0) - t0).toBeGreaterThanOrEqual(1.5);
    expect(await pauseCount(page)).toBe(p0);
    expect(dialogs).toEqual([]);
  });

  test('E15. the ways in: Now Playing’s ⋯ (with a track), More › Record › Make a file, a playlist entry’s ⋯', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40, playlists: [{ id: 'pwaysin1', name: 'Ways', indexes: [1, 2] }] });
    await page.setViewportSize(PHONE_VIEWPORT);
    await tab(page, 'now');
    await page.getByTestId('np-menu-button').click();
    await expect(page.getByTestId('menu-export'), 'no track: no row').toHaveCount(0);
    await page.keyboard.press('Escape');
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await tab(page, 'now');
    await page.getByTestId('np-menu-button').click();
    await expect(page.getByTestId('menu-export')).toContainText('This track as a new WAV file, with its layers');
    await page.getByTestId('menu-export').click();
    await expect(exportSheet(page)).toContainText('tone-0001');
    await page.keyboard.press('Escape');
    await tab(page, 'more');
    if ((await moreView(page)) !== 'root') await tab(page, 'more');
    await moreRow(page, 'more-record-row').click();
    const rec = page.getByRole('dialog', { name: 'Record', exact: true });
    await expect(rec).toContainText('Export a file, or record live');
    await expect(rec.getByTestId('record-export')).toContainText('tone-0001 as a new WAV file, with its layers');
    await rec.getByTestId('record-export').click();
    await expect(exportSheet(page)).toContainText('tone-0001');
    await page.keyboard.press('Escape');
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    await page.locator('[data-testid="playlist-row"][data-playlist-id="pwaysin1"]').getByTestId('playlist-row-open').click();
    await page.locator('[data-testid="playlist-track"][data-index="0"]').getByRole('button', { name: /Options for/ }).click();
    await page.getByTestId('playlist-row-menu-export').click();
    await expect(exportSheet(page)).toContainText('tone-0002');
    expect(dialogs).toEqual([]);
  });
});


// ---- v16.5 review (Stage B): the export's gaps, each test a mutation's oracle.

/** A kept file (the dev hook's __exportBlobs[0]) decoded to floats in the page, as window[name] = { L, R, frames }. */
async function keepPcm(page: Page, name: string): Promise<number> {
  return page.evaluate(async (name) => {
    const b: Blob = (window as any).__exportBlobs[0];
    const buf = await b.arrayBuffer();
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    let off = 12, at = 0, size = 0;
    while (off + 8 <= v.byteLength) {
      const id = tag(off);
      const sz = v.getUint32(off + 4, true);
      if (id === 'data') { at = off + 8; size = Math.min(sz, v.byteLength - at); break; }
      off += 8 + sz + (sz & 1);
    }
    const frames = Math.floor(size / 6);
    const L = new Float32Array(frames), R = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < 2; c++) {
        const p = at + i * 6 + c * 3;
        let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16);
        if (x & 0x800000) x -= 0x1000000;
        (c ? R : L)[i] = x / 8388608;
      }
    }
    (window as any)[name] = { L, R, frames };
    return frames;
  }, name);
}

/** dB RMS of a kept file's frames [t0, t1) s (both channels), from keepPcm's floats. */
async function keptDb(page: Page, name: string, t0: number, t1: number): Promise<number> {
  return page.evaluate(({ name, t0, t1 }) => {
    const k = (window as any)[name];
    const a = Math.max(0, Math.round(t0 * 48_000)), z = Math.min(k.frames, Math.round(t1 * 48_000));
    let e = 0;
    for (let i = a; i < z; i++) e += k.L[i] ** 2 + k.R[i] ** 2;
    return 10 * Math.log10(e / Math.max(1, 2 * (z - a)) + 1e-30);
  }, { name, t0, t1 });
}

test.describe('phone, review', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('E4b. a track with no stored length is never read or decoded before its length is known within the cap (B1); a file whose length can’t be read is refused, with the words', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 20, patch: [{ index: 0, storedSeconds: 0 }, { index: 2, junk: true, storedSeconds: 0 }] });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    // Stored 0, the file 20 s, the cap 10 s: the header's length refuses it with nothing read or decoded.
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(10));
    const capped = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), ids[0]);
    test.info().annotations.push({ type: 'E4b stored 0, cap 10 s', description: JSON.stringify({ outcome: capped.outcome, reason: capped.reason, steps: capped.steps.map((s: any) => s.step), sources: capped.sources }) });
    expect([capped.outcome, capped.reason]).toEqual(['failed', 'cap']);
    // v16.5 final: refused with nothing read or decoded, whichever check refused it (on the Note 20 the app had already
    // stored the probe's 20 s, so the stored length's check refused it before the length step: steps []).
    expect(capped.steps.map((s: any) => s.step).filter((x: string) => x === 'read' || x === 'decode'), 'no read, no decode').toEqual([]);
    expect(capped.cap.seconds, 'refused at its length').toBeCloseTo(20, 1);
    // Within the cap: the same track exports, its length from the header.
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(null));
    const ok = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), ids[0]);
    expect(ok.outcome).toBe('done');
    expect(ok.steps.map((s: any) => s.step).slice(0, 3), 'the length first, then the read and the decode').toEqual(['length', 'read', 'decode']);
    // A file no probe can read, with no stored length: refused before any read or decode.
    const junk = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), ids[2]);
    expect([junk.outcome, junk.reason]).toEqual(['failed', 'length']);
    expect(junk.steps.map((s: any) => s.step)).toEqual(['length']);
    await openExportFromRow(page, 'tone-0003');
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-failed-line')).toHaveText("The export stopped: This track's length can't be read, so it can't be checked to fit in memory. Play it once, then try again.", { timeout: 30_000 });
    expect((await caughtDownloads(page)).length, 'nothing saved').toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('E6c. a playlist with a track Chrome can’t decode (an AIFF) in the middle: it is skipped and named, the others are saved (B6)', async ({ page }) => {
    test.setTimeout(180_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 3, {
      real: 3,
      seconds: 10,
      patch: [{ index: 1, aiff: true, seconds: 10 }],
      playlists: [{ id: 'paiffmix', name: 'Mixed', indexes: [0, 1, 2] }],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    await page.locator('[data-testid="playlist-row"][data-playlist-id="paiffmix"]').getByRole('button', { name: /Options for/ }).click();
    await page.getByTestId('playlist-menu-export').click();
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
    const files = await caughtDownloads(page, 2);
    expect(files.map((f) => f.name)).toEqual(['tone-0001 · 174 Hz · Aetheria.wav', 'tone-0003 · 396 Hz · Aetheria.wav']);
    await expect(sheet.getByTestId('export-done')).toContainText('Saved 2 of 3 to your downloads');
    await expect(sheet.getByTestId('export-skipped')).toHaveText("Skipped 1: tone-0002 (it can't be decoded in this browser).");
    await expect(sheet.getByTestId('export-done-file')).toHaveCount(2);
    expect(dialogs).toEqual([]);
  });

  test('E6d. a long file ends faded like a single track’s: its last 50 ms at most −60 dB (B3: the fade at the file’s real end)', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openSeededNewLayout(page, 2, {
      real: 2,
      seconds: 6,
      patch: [{ index: 0, crystal: 528, amp: 0 }, { index: 1, crystal: 528, amp: 0 }],
      playlists: [{ id: 'plendfade', name: 'End', indexes: [0, 1] }],
    });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const long = await hookRender(page, '', { playlistId: 'plendfade', files: 'long', snap: { phiOn: false } });
    expect(long.outcome).toBe('done');
    const T = (await keepPcm(page, '__long')) / 48_000;
    const longEnd = await keptDb(page, '__long', T - 0.05, T);
    const longMid = await keptDb(page, '__long', T / 2 - 0.5, T / 2 + 0.5);
    const one = await hookRender(page, ids[0], { snap: { phiOn: false } });
    expect(one.outcome).toBe('done');
    const T1 = (await keepPcm(page, '__one')) / 48_000;
    const oneEnd = await keptDb(page, '__one', T1 - 0.05, T1);
    test.info().annotations.push({ type: 'E6d the last 50 ms (dB): long, single; the long file’s middle', description: JSON.stringify({ longEnd, oneEnd, longMid, T, T1 }) });
    expect(longMid, 'the layers are there in the middle').toBeGreaterThan(-40);
    expect(oneEnd, 'a single track ends faded').toBeLessThanOrEqual(-60);
    expect(longEnd, 'the long file ends faded as well').toBeLessThanOrEqual(-60);
    expect(Math.abs(longEnd - oneEnd), 'like the single track’s').toBeLessThanOrEqual(3);
    expect(dialogs).toEqual([]);
  });

  test('E6e. a long file’s join 10 ms after a level tick: the carrier holds steady (0.1 s windows from 0.3 s before to 1 s after vary < 0.3 dB; B19b, B19c)', async ({ page }) => {
    test.setTimeout(180_000);
    // 12.0371 s tracks (8 kHz): the planned join at 12.2601 s, 10 ms after the 12.25 s tick.
    const dialogs = await openSeededNewLayout(page, 2, {
      real: 2,
      seconds: 12.0371,
      patch: [{ index: 0, crystal: 528, amp: 0, seconds: 12.0371 }, { index: 1, crystal: 528, amp: 0, seconds: 12.0371 }],
      playlists: [{ id: 'pltick12', name: 'Tick', indexes: [0, 1] }],
    });
    await hookReady(page);
    const r = await hookRender(page, '', { playlistId: 'pltick12', files: 'long', snap: { phiOn: false } });
    expect(r.outcome).toBe('done');
    const join = r.files[0].joins[0] / 48_000;
    expect(join, 'the join, 10 ms after a tick').toBeCloseTo(12.26, 2);
    const probes = Array.from({ length: 13 }, (_, k) => ({ f: 264, t0: join - 0.3 + k * 0.1, t1: join - 0.2 + k * 0.1, ch: 0 as const }));
    const w = await wavReport(page, 'hook', 0, probes);
    test.info().annotations.push({ type: 'E6e the carrier in 0.1 s windows around the join (dB)', description: w.amps.map((a) => a.toFixed(2)).join(' ') });
    expect(Math.max(...w.amps) - Math.min(...w.amps), 'steady across the join').toBeLessThan(0.3);
    expect(dialogs).toEqual([]);
  });

  test('E6f. a long file’s join is sample-continuous: a sine split across two tracks has no step where they meet (B7; the seam oracle reads the real join frames)', async ({ page }) => {
    test.setTimeout(180_000);
    const n = 6 * 44_100;
    const dialogs = await openSeededNewLayout(page, 2, {
      real: 2,
      seconds: 6,
      patch: [
        { index: 0, seconds: 6, rate: 44_100, freq: 1000, amp: 16_384, noFade: true },
        { index: 1, seconds: 6, rate: 44_100, freq: 1000, amp: 16_384, noFade: true, from: n },
      ],
      playlists: [{ id: 'plsine01', name: 'Sine', indexes: [0, 1] }],
    });
    await hookReady(page);
    // Music only (the layers would add their own tones): the music alone, without the dither.
    const r = await hookRender(page, '', { playlistId: 'plsine01', files: 'long', snap: { musicOnly: true }, dither: false });
    expect(r.outcome).toBe('done');
    const joins: number[] = r.files[0].joins;
    expect(joins.length).toBe(1);
    expect(Math.abs(joins[0] - (n * (48_000 / PSF)) / 44_100), `the join at its exact place (${joins[0]})`).toBeLessThanOrEqual(1);
    const w = await wavReport(page, 'hook', 0, [{ f: 1000 * PSF, t0: 1, t1: 5, ch: 0 }, { f: 1000 * PSF, t0: 7, t1: 11, ch: 0 }], { seams: true, joins });
    test.info().annotations.push({ type: 'E6f the join (2nd differences)', description: JSON.stringify({ joinD2: w.joinD2, otherD2: w.otherD2, ratio: w.joinD2 / w.otherD2, amps: w.amps }) });
    expect(w.joinD2, 'there is a join to measure').toBeGreaterThan(0);
    expect(w.joinD2, 'the join is the music’s own: no step').toBeLessThanOrEqual(1.02 * w.otherD2);
    expect(Math.abs(w.amps[0] - w.amps[1]), 'the same level either side (never scaled)').toBeLessThan(0.05);
    expect(Math.abs(w.amps[0] - db(16_384 / 32_768)), 'the music at its own level').toBeLessThan(0.1);
    expect(dialogs).toEqual([]);
  });

  test('E9b. Share’s 10 minutes: once they pass, Share goes from the Done screen and the line says where the file is; the toast’s Share says so too (B12)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.__shared = [] as unknown[];
      (navigator as any).canShare = () => true;
      (navigator as any).share = (d: { files: File[] }) => {
        w.__shared.push(d.files.length);
        return Promise.resolve();
      };
    });
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 12 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    await expect(sheet.getByTestId('export-share')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__aetheriaExport.state().sharing), 'one file kept for Share').toBe(1);
    await page.evaluate(() => (window as any).__aetheriaExport.endShareWindow());
    await expect(sheet.getByTestId('export-share'), 'Share goes with the files').toHaveCount(0);
    await expect(sheet.getByTestId('export-share-line')).toHaveText('Share kept its copy for 10 minutes. The file is in your downloads: send it from there.');
    expect(await page.evaluate(() => (window as any).__aetheriaExport.state().sharing)).toBe(0);
    // The sheet closed while it runs: the toast offers Share; past the window, its Share says why.
    await sheet.getByTestId('export-done-button').click();
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 20 }));
    await openExportFromRow(page, 'tone-0002');
    await exportSheet(page).getByTestId('export-start').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('notices')).toContainText('Saved to your downloads: tone-0002', { timeout: 60_000 });
    await page.evaluate(() => (window as any).__aetheriaExport.endShareWindow());
    await page.getByTestId('notices').getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.getByTestId('notices')).toContainText('Share kept its copy for 10 minutes.');
    expect(await page.evaluate(() => (window as any).__shared.length), 'nothing shared after the window').toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('E11c. while an export runs, Analyse tracks, Deep Scan and Record don’t start: the health card holds them with the reason, a tap says why, the Record sheet’s options are off (B10)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 4, { real: 4, seconds: 30, crystals: 'none' });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await page.waitForFunction(() => !!(window as any).__aetheriaAnalyse, null, { timeout: 10_000 });
    // Something plays (Record needs an AudioContext, so its options are only off for the export).
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0004').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 60 }));
    await openExportFromRow(page, 'tone-0001');
    await exportSheet(page).getByTestId('export-start').click();
    await expect(exportSheet(page).getByTestId('export-running')).toBeVisible();
    await page.keyboard.press('Escape');
    await openLibraryTab(page);
    const analyse = page.getByTestId('health-analyse-action');
    await expect(analyse).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('health-analyse')).toContainText('Unavailable while an export runs');
    // aria-disabled (Playwright waits for it to clear): a tap as a finger makes it, regardless.
    await analyse.click({ force: true });
    await expect(page.getByTestId('notices')).toContainText("Analyse tracks can't start while an export runs.");
    expect(await page.evaluate(() => (window as any).__aetheriaAnalyse.state().phase), 'Analyse tracks did not start').toBe('idle');
    const scan = page.getByTestId('health-scan-action').or(page.getByTestId('health-scan-assigned-action')).first();
    await expect(scan).toHaveAttribute('aria-disabled', 'true');
    await scan.click({ force: true });
    await expect(page.getByTestId('notices')).toContainText("Deep Scan can't start while an export runs.");
    await page.waitForTimeout(500);
    await expect(page.getByTestId('library-health-status'), 'Deep Scan did not start').not.toHaveText('Scanning…');
    await tab(page, 'more');
    if ((await moreView(page)) !== 'root') await tab(page, 'more');
    await moreRow(page, 'more-record-row').click();
    const rec = page.getByRole('dialog', { name: 'Record', exact: true });
    await expect(rec.getByTestId('record-exporting')).toHaveText('An export is running: record live when it is done.');
    await expect(rec.getByTestId('record-not-ready'), 'ready: the export is what holds them').toHaveCount(0);
    for (const k of ['audio', 'video', 'both']) await expect(rec.getByTestId(`record-option-${k}`)).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__aetheriaExport.cancel());
    await openLibraryTab(page);
    await expect(page.getByTestId('health-analyse-action'), 'after the export: Analyse tracks again').not.toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 });
    expect(dialogs).toEqual([]);
  });

  test('E17. the export’s wake lock is taken again when the page shows again (a hidden page loses it; B8)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.__vis = 'visible';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => w.__vis });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.__vis === 'hidden' });
      w.__locks = [] as any[];
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async () => {
            const s: any = new EventTarget();
            s.released = false;
            s.type = 'screen';
            s.release = async () => {
              if (s.released) return;
              s.released = true;
              s.dispatchEvent(new Event('release'));
            };
            w.__locks.push(s);
            return s;
          },
        },
      });
    });
    // Nothing plays (the app's own keep-alive lock is for playback): every lock here is the export's.
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 60 }));
    await openExportFromRow(page, 'tone-0001');
    await exportSheet(page).getByTestId('export-start').click();
    await expect(exportSheet(page).getByTestId('export-running')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__locks.length), { message: 'the export takes a lock' }).toBe(1);
    // Hidden: the browser releases the lock.
    await page.evaluate(() => {
      const w = window as any;
      w.__vis = 'hidden';
      for (const s of w.__locks) s.release();
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      (window as any).__vis = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => (window as any).__locks.length), { message: 'shown again: the lock is taken again', timeout: 5_000 }).toBe(2);
    expect(await page.evaluate(() => (window as any).__locks[1].released), 'and held').toBe(false);
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 0 }));
    await expect(exportSheet(page).getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__locks[1].released), { message: 'released when the export ends' }).toBe(true);
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('E8. alongside playback (Android UA): the music plays on gaplessly, the visuals and the app’s timers keep running, no long step starts near the playing track’s end @mobile', async ({ page }) => {
    test.skip(ON_DEVICE, 'the phone gate measures this with the hook (§5.6)');
    test.setTimeout(240_000);
    await recordHudDraws(page);
    const dialogs = await openSeededNewLayout(page, 6, { real: 6, seconds: 30, patch: [{ index: 5, seconds: 60, rate: 44_100, stereo: true }] });
    const ids = (await libraryState(page)).libraryIds;
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 1; }, { timeout: 20_000 }).toBe(true);
    // The export starts inside the playing track's last 20 s (30 s tracks, 12 s in): its reads and decodes must wait for
    // the next track (the mobile hold), or the step log shows them starting there.
    await expect.poll(async () => (await libraryState(page)).t ?? 0, { timeout: 20_000, intervals: [100] }).toBeGreaterThan(12);
    const p0 = await pauseCount(page);
    const title0 = (await libraryState(page)).current;
    const hud0 = await page.evaluate(() => (window as any).__hud.length);
    // v16.5 review: a 100 ms timer of the page's own, ticking through the whole job: the longest gap between its ticks
    // once the hold has ended (the read, the decode, the layers and the mix) is how long the app's timers waited (the HUD
    // line alone, once a second, averaged over a 20 s hold, missed a mix that starved them).
    const pt0 = await page.evaluate(() => { const w = window as any; w.__ticks = [] as number[]; w.__tickId = setInterval(() => w.__ticks.push(performance.now()), 100); return performance.now(); });
    const t0 = Date.now();
    const r = await hookRender(page, ids[5]);
    const secs = (Date.now() - t0) / 1000;
    const afterHold = pt0 + (r.steps[0]?.at ?? 0);
    const maxGap = await page.evaluate((from) => { const w = window as any; clearInterval(w.__tickId); const t = (w.__ticks as number[]).filter((x) => x >= from); let g = 0; for (let i = 1; i < t.length; i++) g = Math.max(g, t[i] - t[i - 1]); return Math.round(g); }, afterHold);
    test.info().annotations.push({ type: 'E8', description: JSON.stringify({ ms: r.ms, steps: r.steps, longTasks: r.longTasks, secs, maxTimerGapMs: maxGap }) });
    expect(r.outcome).toBe('done');
    const lines = (await page.evaluate(() => (window as any).__hud.length)) - hud0;
    expect(lines / Math.max(1, secs), 'the HUD line keeps coming (the app’s timers run)').toBeGreaterThanOrEqual(0.8);
    expect(maxGap, 'the app’s timers never wait long behind the export (its slices yield to them)').toBeLessThan(400);
    const mobile = await page.evaluate(() => /Android/.test(navigator.userAgent));
    for (const st of r.steps) {
      if (st.leftS !== null) expect(st.leftS, `${st.step} started with ${st.leftS} s left`).toBeGreaterThan(mobile ? 20 : 10);
    }
    await expect.poll(async () => (await libraryState(page)).current, { timeout: 60_000, message: 'the title advances' }).not.toBe(title0);
    expect(await pauseCount(page), 'gapless: no pause()').toBe(p0);
    expect(dialogs).toEqual([]);
  });

  test('E12. lazy: the engine chunk is not fetched at load; the idle prefetch fetches it within 35 s', async ({ page }) => {
    test.setTimeout(120_000);
    const seen: Array<{ url: string; at: number }> = [];
    const t0 = Date.now();
    page.on('request', (req) => {
      if (/export\/engine|engine-[A-Za-z0-9_-]+\.js/.test(req.url())) seen.push({ url: req.url(), at: Date.now() - t0 });
    });
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20 });
    await page.waitForTimeout(Math.max(0, 8000 - (Date.now() - t0)));
    expect(seen.filter((s) => s.at < 8000), 'nothing in the first 8 s').toEqual([]);
    await expect.poll(() => seen.length, { timeout: 35_000, message: 'the idle prefetch' }).toBeGreaterThan(0);
    expect(dialogs).toEqual([]);
  });

  test('E16. on the desktop the Export sheet is the panel beside the canvas (non-modal: the transport works)', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 40 });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await rowMenu(page, 'tone-0002').click();
    await page.getByTestId('library-menu-export').click();
    const panel = page.getByRole('region', { name: 'Export with layers', exact: true });
    await expect(panel).toBeVisible();
    await page.getByTestId('desktop-transport').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    expect(dialogs).toEqual([]);
  });
  test('E4c. a 96 kHz source gets the lower cap (B2): the engine reads its rate from the header and caps it by its own cost', async ({ page }) => {
    // v16.5 final: the computer's caps; a device runs with the phone's (the Note 20 got 300 s, its 96 kHz cap).
    test.skip(ON_DEVICE, 'the computer’s caps (a device runs with the phone’s)');
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 2, {
      real: 2,
      seconds: 6,
      patch: [{ index: 0, seconds: 6, rate: 96_000, stereo: true }, { index: 1, seconds: 6, rate: 44_100, stereo: true }],
    });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const hi = await hookRender(page, ids[0]);
    const cd = await hookRender(page, ids[1]);
    test.info().annotations.push({ type: 'E4c the sources', description: JSON.stringify({ hi: hi.sources, cd: cd.sources }) });
    expect([hi.outcome, cd.outcome]).toEqual(['done', 'done']);
    expect(hi.sources[0].sampleRate).toBe(96_000);
    expect(cd.sources[0].sampleRate).toBe(44_100);
    // The computer's caps (this project's), from the measured costs: 96 kHz 16-bit stereo 11 minutes, 44.1 kHz 23.
    expect(hi.sources[0].capSeconds, 'the 96 kHz file: the lower cap').toBe(11 * 60);
    expect(cd.sources[0].capSeconds, 'the 44.1 kHz file: the type’s cap').toBe(23 * 60);
    expect(hi.sources[0].costPerMin).toBeGreaterThan(cd.sources[0].costPerMin * 1.8);
    expect(dialogs).toEqual([]);
  });

  test('E13. the engine (DEV): the layers through the REAL mix at 12 kHz against the same mix at 48 kHz, and the compare path, with a 963 Hz crystal, the beat at 0, no drone, the tone at its max: SNR ≥ 60 dB; the plan says 12,000 Hz (B18)', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 30, patch: [{ index: 0, crystal: 963, amp: 0, seconds: 30 }] });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const snap = { toneLevel: 0.04, beatLevel: 0, droneEnabled: false, phiOn: false };
    const low = await hookRender(page, ids[0], { snap, dither: false });
    expect(low.outcome).toBe('done');
    expect(low.files[0].plan.rate, 'the layers at 12,000 Hz').toBe(12_000);
    await keepPcm(page, '__low');
    const full = await hookRender(page, ids[0], { snap, dither: false, layerRate: 48_000 });
    expect(full.files[0].plan.rate).toBe(48_000);
    await keepPcm(page, '__full');
    const real = await page.evaluate(() => {
      const a = (window as any).__low, b = (window as any).__full;
      const n = Math.min(a.frames, b.frames);
      let sig = 0, err = 0;
      for (let i = 96_000; i < n - 96_000; i++) {
        for (const [x, y] of [[a.L[i], b.L[i]], [a.R[i], b.R[i]]]) {
          sig += y * y;
          err += (x - y) ** 2;
        }
      }
      return { snrDb: 10 * Math.log10(sig / Math.max(err, 1e-30)), rmsDb: 10 * Math.log10(sig / (2 * (n - 192_000))) };
    });
    const c = await page.evaluate(({ id, snap }) => (window as any).__aetheriaExport.compare(id, 20, 'headphones', snap), { id: ids[0], snap });
    test.info().annotations.push({ type: 'E13 the real mix (12 kHz vs 48 kHz) and the compare path', description: JSON.stringify({ real, compare: c.snrDb, plan: low.files[0].plan.segments[0] }) });
    expect(real.rmsDb, 'the layers are in the file').toBeGreaterThan(-60);
    expect(real.snrDb, `the real mix: SNR ${real.snrDb.toFixed(1)} dB`).toBeGreaterThanOrEqual(60);
    expect(c.snrDb, `the compare path: SNR ${c.snrDb.toFixed(1)} dB`).toBeGreaterThanOrEqual(60);
    // The default spec (the seeded 285 Hz crystal): the compare path and the planned crystal.
    const d = await page.evaluate((id) => (window as any).__aetheriaExport.compare(id, 20), ids[1]);
    expect(d.snrDb).toBeGreaterThanOrEqual(70);
    expect(d.plan.segments[0].toneHz).toBe(285);
    expect(d.plan.rate).toBe(12_000);
    expect(dialogs).toEqual([]);
  });

  test('E18. a long file over 2 h keeps the drone’s duty cycle (B9): the offline player’s timer ticks past the first hour and its horizon follows the render', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 4, patch: [{ index: 0, crystal: 528 }] });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const one = await hookRender(page, ids[0], { snap: { droneEnabled: true, phiOn: false } });
    const spec = one.spec[0];
    expect(spec.gains.drone, 'the drone is on').toBeGreaterThan(0);
    const out = await page.evaluate(async (spec) => {
      const rl = await import('/utils/export/renderLayers.ts');
      const ls = await import('/utils/soundV2/layerSchedule.ts');
      // The mirrors keep every point (the player prunes the past as it ticks): the gate can be read over the whole render.
      const prune = (ls.ParamTrack as any).prototype.prune;
      (ls.ParamTrack as any).prototype.prune = function () {};
      try {
        const T = 9000;
        const segs = [{ spec, startS: 0, durS: T, bands: [{ t: 0, band: spec.startBand }] }];
        const ctx = new OfflineAudioContext(2, 128, 12_000);
        const s = rl.scheduleLayers(ctx, segs as any, T, { endFade: false });
        const g = (s.player as any).gateDrone;
        const span = (a: number, b: number) => {
          let lo = Infinity, hi = -Infinity;
          for (let t = a; t <= b; t += 2) {
            const v = g.valueAt(t);
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
          return [lo, hi];
        };
        const r = { ticks: s.rec.ticks, horizon: (s.player as any).droneHorizon, first: span(60, 7100), after: span(7300, 8990) };
        s.player.dispose();
        s.duck.dispose();
        return r;
      } finally {
        (ls.ParamTrack as any).prototype.prune = prune;
      }
    }, spec);
    test.info().annotations.push({ type: 'E18 the drone gate (min, max) before and after 2 h', description: JSON.stringify(out) });
    expect(out.ticks, 'the timer ticked').toBeGreaterThan(0);
    expect(out.horizon, 'the duty is scheduled past the render’s end').toBeGreaterThanOrEqual(9000);
    expect(out.first[0] < 0.5 && out.first[1] > 0.5, 'the duty rests and reopens in the first 2 h').toBe(true);
    expect(out.after[0] < 0.5 && out.after[1] > 0.5, 'and still after them').toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('E19. at a long file’s join Key fit’s duck holds a rise as App does (the track change’s 2 s glide; B11)', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 4, patch: [{ index: 0, crystal: 528 }] });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const one = await hookRender(page, ids[0], { snap: { phiOn: false } });
    const spec = one.spec[0];
    const calls = await page.evaluate(async (spec) => {
      const rl = await import('/utils/export/renderLayers.ts');
      const kf = await import('/utils/soundV2/keyFit.ts');
      const seen: Array<{ t: number; db: number; hold: number | null; silent: boolean | null }> = [];
      const set = (kf.KeyFitDuck as any).prototype.setTarget;
      (kf.KeyFitDuck as any).prototype.setTarget = function (this: any, db: number, o: any) {
        seen.push({ t: this.state().t, db, hold: o?.holdRiseUntil ?? null, silent: o?.silent ?? null });
        return set.call(this, db, o);
      };
      try {
        const J = 12.26;
        const segs = [
          { spec: { ...spec, duckDb: -3 }, startS: 0, durS: J, bands: [{ t: 0, band: spec.startBand }] },
          { spec: { ...spec, duckDb: 0 }, startS: J, durS: 10, bands: [{ t: 0, band: spec.startBand }] },
        ];
        const s = rl.scheduleLayers(new OfflineAudioContext(2, 128, 12_000), segs as any, J + 10, { endFade: false });
        s.player.dispose();
        s.duck.dispose();
        return seen;
      } finally {
        (kf.KeyFitDuck as any).prototype.setTarget = set;
      }
    }, spec);
    test.info().annotations.push({ type: 'E19 the duck’s targets', description: JSON.stringify(calls) });
    const atJoin = calls.find((c) => Math.abs(c.t - 12.26) < 0.01);
    expect(atJoin, 'a target at the join').toBeTruthy();
    expect(atJoin!.db).toBe(0);
    expect(atJoin!.hold, 'the rise waits for the track change’s 2 s glide').not.toBeNull();
    expect(atJoin!.hold!).toBeGreaterThanOrEqual(12.26 + 2 - 1e-6);
    expect(atJoin!.silent, 'the gates’ state is passed, as App passes it').not.toBeNull();
    expect(dialogs).toEqual([]);
  });

  test('E7b. no Blob outlives its save (B4): after a 3-file export none is kept (over Share’s limit); a shareable file is kept only until Share’s window ends', async ({ page }) => {
    test.skip(ON_DEVICE, 'a desktop measurement (the DevTools protocol’s garbage collection)');
    test.setTimeout(180_000);
    await stubDownloads(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.__blobRefs = [] as WeakRef<Blob>[];
      const make = URL.createObjectURL;
      URL.createObjectURL = function (b: Blob | MediaSource) {
        if (b instanceof Blob && b.type === 'audio/wav') w.__blobRefs.push(new WeakRef(b));
        return make.call(URL, b);
      };
      w.__fileRefs = [] as WeakRef<File>[];
      const F = window.File;
      (window as any).File = class extends F {
        constructor(parts: BlobPart[], name: string, o?: FilePropertyBag) {
          super(parts, name, o);
          // Only the Files made once the exports start (the library's own tracks are Files too).
          if (w.__countFiles && o?.type === 'audio/wav') w.__fileRefs.push(new WeakRef(this));
        }
      };
      // The saved file's URL is let go after 60 s: shortened here.
      const st = window.setTimeout;
      (window as any).setTimeout = function (fn: TimerHandler, ms?: number, ...rest: unknown[]) {
        return st(fn, ms === 60_000 ? 300 : ms, ...(rest as []));
      };
      (navigator as any).canShare = () => true;
      (navigator as any).share = () => Promise.resolve();
    });
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 8, playlists: [{ id: 'pgcfiles', name: 'Kept', indexes: [0, 1, 2] }] });
    await hookReady(page);
    // A full garbage collection through the DevTools protocol (no flag needed), three times, a task apart.
    const cdp = await page.context().newCDPSession(page);
    const alive = async () => {
      for (let k = 0; k < 3; k++) {
        await cdp.send('HeapProfiler.collectGarbage');
        await page.waitForTimeout(200);
      }
      return page.evaluate(() => {
        const w = window as any;
        return { blobs: w.__blobRefs.filter((r: WeakRef<Blob>) => r.deref()).length, files: w.__fileRefs.filter((r: WeakRef<File>) => r.deref()).length, made: w.__blobRefs.length };
      });
    };
    // Three files, each "51 MiB" (over Share's limit): none is kept.
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ fakeBytes: 51 * 1024 * 1024 }));
    await page.evaluate(() => ((window as any).__countFiles = true));
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    await page.locator('[data-testid="playlist-row"][data-playlist-id="pgcfiles"]').getByRole('button', { name: /Options for/ }).click();
    await page.getByTestId('playlist-menu-export').click();
    await exportSheet(page).getByTestId('export-start').click();
    await expect(exportSheet(page).getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
    await caughtDownloads(page, 3);
    await page.waitForTimeout(1000);
    const over = await alive();
    test.info().annotations.push({ type: 'E7b over Share’s limit: alive after gc', description: JSON.stringify(over) });
    expect(over.made, 'three files were made').toBe(3);
    expect(over.blobs, 'no Blob kept').toBe(0);
    expect(over.files, 'no File kept for Share').toBe(0);
    // One shareable file: kept for Share (one File), until the window ends.
    await exportSheet(page).getByTestId('export-done-button').click();
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ fakeBytes: null }));
    await page.getByTestId('library-view-tracks').click();
    await openExportFromRow(page, 'tone-0001');
    await exportSheet(page).getByTestId('export-start').click();
    await expect(exportSheet(page).getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    await expect(exportSheet(page).getByTestId('export-share')).toBeVisible();
    await page.waitForTimeout(1000);
    const held = await alive();
    expect(held.blobs, 'the saved Blob itself is let go').toBe(0);
    expect(held.files, 'one File kept for Share').toBe(1);
    await page.evaluate(() => (window as any).__aetheriaExport.endShareWindow());
    const after = await alive();
    test.info().annotations.push({ type: 'E7b shareable: during and after the window', description: JSON.stringify({ held, after }) });
    expect(after.files, 'after Share’s window: none').toBe(0);
    expect(dialogs).toEqual([]);
  });
});

// ---- v16.5 re-review: the second round's gaps, each test a mutation's oracle. Media made by ffmpeg (tests/media.ts:
// tones and noise only); a test that needs it says so and skips without it.

const b64 = (b: Buffer) => b.toString('base64');
const steps = (r: any) => r.steps.map((s: any) => s.step);
const stepsFor = (r: any, id: string) => r.steps.filter((s: any) => s.id === id).map((s: any) => s.step);
const sourceOf = (r: any, id: string) => r.sources.find((s: any) => s.id === id);

/** In the page: the peak of (the kept file's left channel − amp · sin(2π f m / rOut)) over [a, b), low-passed at
 *  16 kHz (a 255-tap Blackman-windowed sinc, as resample.check.ts), in dB relative to amp. */
async function joinErrorDb(page: Page, name: string, f: number, amp: number, a: number, b: number): Promise<number> {
  return page.evaluate(({ name, f, amp, a, b }) => {
    const k = (window as any)[name];
    const rOut = 48_000 / 0.981818;
    const N = 255, fc = 16_000 / rOut, h = new Float64Array(N);
    let s = 0;
    for (let i = 0; i < N; i++) {
      const d = i - 127;
      h[i] = (d === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d)) * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (N - 1)));
      s += h[i];
    }
    for (let i = 0; i < N; i++) h[i] /= s;
    const lo = Math.max(0, a - 127), hi = Math.min(k.frames, b + 128);
    const err = new Float64Array(hi - lo);
    for (let m = lo; m < hi; m++) err[m - lo] = k.L[m] - amp * Math.sin((2 * Math.PI * f * m) / rOut);
    let peak = 0;
    for (let m = Math.max(a, lo + 127); m < Math.min(b, hi - 128); m++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc += h[j] * err[m - lo + j - 127];
      peak = Math.max(peak, Math.abs(acc));
    }
    return 20 * Math.log10(peak / amp + 1e-12);
  }, { name, f, amp, a, b });
}

test.describe('phone, re-review', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('E20. an MP3’s length from its frames (re-review B1): a VBR file without a Xing header and a joined file with a stale one are refused after the read and before the decode, at their real length; within the cap the decode is the frames’ length; a long file’s plan scans them and skips one over the cap unread', async ({ page }) => {
    test.skip(!ffmpegAvailable(), 'ffmpeg is needed on PATH to make the test MP3s');
    test.setTimeout(180_000);
    // 3 minutes: 10 s of loud noise then a quiet tone, LAME V0, no Xing header (Chrome reads about 45 s); and two LAME
    // files joined (30 s + 150 s: the first one's Xing says 30 s).
    const vbr = MEDIA.vbrNoXing(180);
    const stale = joined(MEDIA.toneMp3(30, 220), MEDIA.toneMp3(150, 330));
    const dialogs = await openSeededNewLayout(page, 3, {
      real: 3,
      seconds: 10,
      patch: [{ index: 0, bytes: b64(vbr), seconds: 45 }, { index: 1, bytes: b64(stale), seconds: 169 }],
      playlists: [{ id: 'plvbrmp3', name: 'VBR', indexes: [2, 0] }],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const render = (id: string, o: Record<string, unknown> = {}) => page.evaluate(({ id, o }) => (window as any).__aetheriaExport.render(id, o), { id, o });
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(60));
    const noXing = await render(ids[0]);
    const staleR = await (async () => {
      await page.evaluate(() => (window as any).__aetheriaExport.setCaps(175));
      return render(ids[1]);
    })();
    test.info().annotations.push({ type: 'E20 refused before the decode', description: JSON.stringify({ noXing: { reason: noXing.reason, steps: steps(noXing), scan: noXing.sources[0]?.scan, cap: noXing.cap }, stale: { reason: staleR.reason, steps: steps(staleR), scan: staleR.sources[0]?.scan } }) });
    expect([noXing.outcome, noXing.reason]).toEqual(['failed', 'cap']);
    expect(steps(noXing), 'read, then refused: no decode').toEqual(['length', 'read']);
    expect(noXing.sources[0].scan.seconds, 'the frames say 3 minutes').toBeCloseTo(180, 0);
    expect(noXing.sources[0].scan.xingSeconds, 'no Xing header').toBeNull();
    expect(noXing.cap.seconds, 'refused at its real length').toBeCloseTo(180, 0);
    expect([staleR.outcome, staleR.reason]).toEqual(['failed', 'cap']);
    expect(steps(staleR)).toEqual(['length', 'read']);
    expect(staleR.sources[0].scan.seconds, 'every frame of the joined file').toBeGreaterThan(179.9);
    expect(staleR.sources[0].scan.xingAgrees, 'the stale Xing count disagrees, and the frames win').toBe(false);
    // Within the cap: decoded whole, and its length is the frames'.
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(null));
    const ok = await render(ids[0], { snap: { musicOnly: true } });
    expect(ok.outcome).toBe('done');
    expect(steps(ok).slice(0, 3)).toEqual(['length', 'read', 'decode']);
    expect(Math.abs(ok.files[0].outSeconds * PSF - ok.sources[0].scan.seconds), 'the decode is the frames’ length').toBeLessThan(0.1);
    // One long file: the plan scans each MP3 (8 MB slices), so the one over the cap is skipped before anything is read.
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(60));
    const long = await render('', { playlistId: 'plvbrmp3', files: 'long', snap: { musicOnly: true } });
    test.info().annotations.push({ type: 'E20 the long file', description: JSON.stringify({ outcome: long.outcome, skipped: long.skipped, steps: long.steps, vbr: sourceOf(long, ids[0]) }) });
    expect(long.outcome).toBe('done');
    expect(long.skipped.map((s: any) => [s.title, s.why])).toEqual([['tone-0001', 'too-long']]);
    expect(stepsFor(long, ids[0]), 'the VBR file: its length only, never read for a decode').toEqual(['length']);
    expect(sourceOf(long, ids[0]).scan.seconds).toBeCloseTo(180, 0);
    // The sheet: the stored 45 s fits, so Export runs, and stops with the real length.
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-failed-line')).toContainText('The export stopped: This track is 3 minutes long.', { timeout: 30_000 });
    expect(dialogs).toEqual([]);
  });

  test('E20b. a FLAC whose STREAMINFO says 5 s and holds 60 s: the decode’s own length is checked after it, on a track and in a long file; two that say 5 s and hold 20 s pass their own cap and not the long file’s (re-review B09b)', async ({ page }) => {
    test.skip(!ffmpegAvailable(), 'ffmpeg is needed on PATH to make the test FLAC');
    test.setTimeout(180_000);
    const flac = understateFlac(MEDIA.flac(60), 5 * 48_000);
    const flac20 = understateFlac(MEDIA.flac(20), 5 * 48_000);
    const dialogs = await openSeededNewLayout(page, 4, {
      real: 4,
      seconds: 10,
      patch: [
        { index: 0, bytes: b64(flac), ext: 'flac', mime: 'audio/flac', seconds: 5 },
        { index: 2, bytes: b64(flac20), ext: 'flac', mime: 'audio/flac', seconds: 5 },
        { index: 3, bytes: b64(flac20), ext: 'flac', mime: 'audio/flac', seconds: 5 },
      ],
      playlists: [{ id: 'plflac01', name: 'Flac', indexes: [1, 0] }, { id: 'plflac02', name: 'Flacs', indexes: [2, 3] }],
    });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(30));
    const one = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), ids[0]);
    const long = await page.evaluate(() => (window as any).__aetheriaExport.render('', { playlistId: 'plflac01', files: 'long' }));
    test.info().annotations.push({ type: 'E20b', description: JSON.stringify({ one: { reason: one.reason, steps: steps(one), cap: one.cap, established: one.sources[0]?.seconds }, long: { reason: long.reason, failedTitle: long.failedTitle, steps: long.steps.map((s: any) => s.step), cap: long.cap } }) });
    expect(one.sources[0].seconds, 'the header and the size both said it fits').toBeLessThan(30);
    expect([one.outcome, one.reason]).toEqual(['failed', 'cap']);
    expect(steps(one), 'refused after the decode').toEqual(['length', 'read', 'decode']);
    expect(one.cap.seconds, 'at its decoded length').toBeCloseTo(60, 0);
    expect([long.outcome, long.reason, long.failedTitle]).toEqual(['failed', 'cap', 'tone-0001']);
    expect(stepsFor(long, ids[0])).toContain('decode');
    expect(long.cap.seconds).toBeCloseTo(60, 0);
    // Two 20 s tracks: each within its own cap (30 s), the long file's 30 s passed by the second decode.
    const sum = await page.evaluate(() => (window as any).__aetheriaExport.render('', { playlistId: 'plflac02', files: 'long' }));
    test.info().annotations.push({ type: 'E20b two 20 s tracks', description: JSON.stringify({ reason: sum.reason, failedTitle: sum.failedTitle, cap: sum.cap }) });
    expect([sum.outcome, sum.reason, sum.failedTitle, sum.cap?.what]).toEqual(['failed', 'cap', 'tone-0004', 'long']);
    expect(sum.cap.seconds, 'the decodes so far').toBeCloseTo(40, 0);
    expect(dialogs).toEqual([]);
  });

  test('E21. MP3s with 100 KB and 600 KB of cover art: their rate is read past the tag (44.1 kHz), and their long file is the resampling of the two decodes back to back, the join included (re-review B7)', async ({ page }) => {
    test.skip(!ffmpegAvailable(), 'ffmpeg is needed on PATH to make the test MP3s');
    test.setTimeout(180_000);
    const dialogs = await openSeededNewLayout(page, 2, {
      real: 2,
      seconds: 6,
      patch: [{ index: 0, bytes: b64(MEDIA.withCover(6, 100)), seconds: 6 }, { index: 1, bytes: b64(MEDIA.withCover(6, 600)), seconds: 6 }],
      playlists: [{ id: 'plcover', name: 'Covers', indexes: [0, 1] }],
    });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const r = await hookRender(page, '', { playlistId: 'plcover', files: 'long', snap: { musicOnly: true }, dither: false });
    expect(r.outcome).toBe('done');
    expect(r.sources.map((s: any) => [s.container, s.sampleRate]), 'both read past their tags: MP3, 44.1 kHz').toEqual([['mp3', 44_100], ['mp3', 44_100]]);
    const frames = await keepPcm(page, '__cover');
    const join = r.files[0].joins[0];
    // The expectation: each MP3 decoded at its own rate (no resampling), the two back to back, resampled by the
    // engine's own kernel as one track. The long file must be that, sample for sample (24-bit, no dither).
    const cmp = await page.evaluate(async ({ ids, join, frames }) => {
      const db: IDBDatabase = await new Promise((res, rej) => { const q = indexedDB.open('aetheria-db'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      const blob = (id: string): Promise<Blob> => new Promise((res) => { const q = db.transaction('blobs').objectStore('blobs').get(id); q.onsuccess = () => res(q.result.fileBlob); });
      const dec = async (id: string) => (await new OfflineAudioContext(2, 1, 44_100).decodeAudioData(await (await blob(id)).arrayBuffer())).getChannelData(0);
      const a = await dec(ids[0]);
      const b = await dec(ids[1]);
      db.close();
      const x = new Float32Array(a.length + b.length);
      x.set(a);
      x.set(b, a.length);
      // The engine's own resampler, as the dev server serves it.
      const rs = await import('/utils/export/resample.ts');
      const rOut = 48_000 / 0.981818;
      const t = { T: 0, n: x.length, rIn: 44_100, step: 44_100 / rOut, off: 0, L: x, R: x, kernel: rs.designKernel(44_100, rOut) };
      const k = (window as any).__cover;
      const span = (from: number, n: number) => {
        const L = new Float32Array(n), R = new Float32Array(n);
        rs.addTrack(t, from, n, L, R);
        let d = 0;
        for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(L[i] - k.L[from + i]));
        return d;
      };
      return { atJoin: span(join - 4096, 8192), middle: span(Math.floor(frames / 4), 8192), joinExact: (a.length * rOut) / 44_100, decoded: [a.length, b.length] };
    }, { ids, join, frames });
    test.info().annotations.push({ type: 'E21 the long file against the decodes back to back', description: JSON.stringify(cmp) });
    expect(Math.abs(join - cmp.joinExact), 'the join where the first decode ends').toBeLessThanOrEqual(1);
    expect(cmp.middle, 'the middle: the same samples').toBeLessThan(1e-5);
    expect(cmp.atJoin, 'the join: the same samples (no resampler edge)').toBeLessThan(1e-5);
    expect(dialogs).toEqual([]);
  });

  test('E22. a long file of 44.1, 48 and 96 kHz tracks: each join’s error against the continuous sine is under the bound (−44 dB at 44.1 → 48, −29 dB at 48 → 96, under 16 kHz), the length Σ n · rOut / rIn (re-review B7)', async ({ page }) => {
    test.setTimeout(180_000);
    const rOut = 48_000 / PSF;
    const rates = [44_100, 48_000, 96_000];
    const n = rates.map((r, k) => Math.round(r * (2.3 + 0.17 * k)) + 7 * (k + 1));
    // Each track's first sample at its place in time: the sum of the tracks before it, and half a sample by each
    // rate (joinShift): the sine runs on through the joins.
    let tEnd = 0;
    const patch = rates.map((r, k) => {
      const t0 = tEnd + (1 / (2 * r) - 1 / (2 * rates[0]));
      tEnd += n[k] / r;
      return { index: k, seconds: n[k] / r, rate: r, freq: 200, amp: 16_384, noFade: true, from: t0 * r };
    });
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 3, patch, playlists: [{ id: 'plrates', name: 'Rates', indexes: [0, 1, 2] }] });
    await hookReady(page);
    const r = await hookRender(page, '', { playlistId: 'plrates', files: 'long', snap: { musicOnly: true }, dither: false });
    expect(r.outcome).toBe('done');
    expect(r.sources.map((s: any) => s.sampleRate)).toEqual(rates);
    const total = Math.round(n.reduce((a, x, k) => a + (x * rOut) / rates[k], 0));
    expect(r.files[0].frames, 'the length: round(Σ n · rOut / rIn)').toBe(total);
    await keepPcm(page, '__rates');
    const joins: number[] = r.files[0].joins;
    expect(joins.length).toBe(2);
    const amp = 16_384 / 32_768;
    const at = async (j: number) => joinErrorDb(page, '__rates', 200, amp, j - 800, j + 800);
    const e1 = await at(joins[0]);
    const e2 = await at(joins[1]);
    const mid = await joinErrorDb(page, '__rates', 200, amp, Math.round(joins[0] / 2) - 800, Math.round(joins[0] / 2) + 800);
    test.info().annotations.push({ type: 'E22 the joins’ error (dB, under 16 kHz)', description: JSON.stringify({ e44to48: e1, e48to96: e2, middle: mid, joins, total }) });
    expect(e1, '44.1 → 48 kHz').toBeLessThanOrEqual(-44);
    expect(e2, '48 → 96 kHz').toBeLessThanOrEqual(-29);
    expect(mid, 'mid-track: the resampler alone').toBeLessThanOrEqual(-80);
    expect(dialogs).toEqual([]);
  });

  test('E23. more than two channels is refused: a 6-channel WAV and (final fixes) a 5.1 Opus WebM before anything is read, a 5.1 AAC whose header doesn’t say after its decode, with the words; a playlist skips them and names them; mono exports L = R (re-review)', async ({ page }) => {
    test.setTimeout(180_000);
    await stubDownloads(page);
    const withOpus = ffmpegAvailable();
    const patch: any[] = [{ index: 0, channels: 6, rate: 48_000, seconds: 4, amp: 8000 }];
    if (withOpus) patch.push({ index: 2, bytes: b64(MEDIA.opus51(4)), ext: 'webm', mime: 'audio/webm', seconds: 4 }, { index: 3, bytes: b64(MEDIA.pce51(4)), ext: 'aac', mime: 'audio/aac', seconds: 4 });
    const dialogs = await openSeededNewLayout(page, withOpus ? 4 : 3, { real: withOpus ? 4 : 3, seconds: 6, patch, playlists: [{ id: 'plchans6', name: 'Channels', indexes: withOpus ? [0, 1, 2] : [0, 1] }] });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const six = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), ids[0]);
    expect([six.outcome, six.reason]).toEqual(['failed', 'channels']);
    expect(steps(six), 'the header said so: nothing read or decoded').toEqual(['length']);
    expect(six.sources).toEqual([]);
    if (withOpus) {
      const opus = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), ids[2]);
      test.info().annotations.push({ type: 'E23 the 5.1 Opus', description: JSON.stringify({ reason: opus.reason, steps: steps(opus), sources: opus.sources }) });
      expect([opus.outcome, opus.reason]).toEqual(['failed', 'channels']);
      // v16.5 final: the WebM's head is walked as EBML: its track's Channels (and OpusHead) say 6.
      expect(steps(opus), 'its head says 6 channels: refused before anything is read').toEqual(['length']);
      expect(opus.sources, 'nothing established, read or decoded').toEqual([]);
      const pce = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), ids[3]);
      test.info().annotations.push({ type: 'E23 the 5.1 AAC with a PCE', description: JSON.stringify({ reason: pce.reason, steps: steps(pce), sources: pce.sources }) });
      expect([pce.outcome, pce.reason]).toEqual(['failed', 'channels']);
      expect(steps(pce), 'its header didn’t say (a PCE): refused after the decode').toEqual(['length', 'read', 'decode']);
      expect([pce.sources[0].channels, pce.sources[0].scan?.kind, pce.sources[0].decodedChannels], 'measured by its frames, 6 channels only in the decode').toEqual([null, 'adts', 6]);
    }
    // Mono: L = R (music only, no dither).
    const mono = await hookRender(page, ids[1], { snap: { musicOnly: true }, dither: false });
    expect(mono.outcome).toBe('done');
    const same = await page.evaluate(async () => {
      const b: Blob = (window as any).__exportBlobs[0];
      const u = new Uint8Array(await b.arrayBuffer());
      let at = 12;
      while (at + 8 <= u.length && String.fromCharCode(u[at], u[at + 1], u[at + 2], u[at + 3]) !== 'data') at += 8 + (u[at + 4] | (u[at + 5] << 8) | (u[at + 6] << 16) | (u[at + 7] << 24));
      let diff = 0, loud = 0;
      for (let p = at + 8; p + 6 <= u.length; p += 6) {
        if (u[p] !== u[p + 3] || u[p + 1] !== u[p + 4] || u[p + 2] !== u[p + 5]) diff++;
        if (u[p + 2] !== 0 && u[p + 2] !== 0xff) loud++;
      }
      return { diff, loud };
    });
    expect(same.diff, 'mono: L = R').toBe(0);
    expect(same.loud, 'and there is music').toBeGreaterThan(1000);
    // The sheet's words; a playlist skips them by name.
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-failed-line')).toHaveText('The export stopped: This file has more than two channels. Export makes stereo files only.', { timeout: 30_000 });
    await sheet.getByTestId('export-retry').click();
    await page.keyboard.press('Escape');
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    await page.locator('[data-testid="playlist-row"][data-playlist-id="plchans6"]').getByRole('button', { name: /Options for/ }).click();
    await page.getByTestId('playlist-menu-export').click();
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
    expect((await caughtDownloads(page, 1)).map((f) => f.name)).toEqual(['tone-0002 · 285 Hz · Aetheria.wav']);
    await expect(sheet.getByTestId('export-skipped')).toHaveText(withOpus ? 'Skipped 2: tone-0001 (it has more than two channels); tone-0003 (it has more than two channels).' : 'Skipped 1: tone-0001 (it has more than two channels).');
    expect(dialogs).toEqual([]);
  });

  test('E24. the cost by what the bytes say (re-review B2): an M4A and an ADTS AAC named .mp3 cost AAC’s 105 MB a minute; an MP3 the others’ 86; (export memory) an AAC in Matroska (.mka) AAC’s too', async ({ page }) => {
    test.skip(!ffmpegAvailable(), 'ffmpeg is needed on PATH to make the test AAC and MP3');
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 4, {
      real: 4,
      seconds: 5,
      patch: [{ index: 0, bytes: b64(MEDIA.m4a(5)), seconds: 5 }, { index: 1, bytes: b64(MEDIA.adts(5)), seconds: 5 }, { index: 2, bytes: b64(MEDIA.toneMp3(5, 440)), seconds: 5 }, { index: 3, bytes: b64(MEDIA.mka(5)), seconds: 5, ext: 'mka', mime: 'audio/x-matroska' }],
    });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const got: any[] = [];
    for (const [k, id] of ids.entries()) {
      const r = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, { snap: { musicOnly: true } }), id);
      // v16.5 export memory: Chrome may not decode AAC in Matroska; its cost is set before the decode either way.
      if (k === 3) test.info().annotations.push({ type: 'E24 the .mka export', description: JSON.stringify([r.outcome, r.reason ?? null]) });
      else expect(r.outcome).toBe('done');
      if (k === 3) expect(r.outcome === 'done' || r.reason === 'decode', 'the .mka: done, or not decodable here').toBe(true);
      got.push([r.sources[0].container, r.sources[0].codec, r.sources[0].costPerMin]);
    }
    expect(got).toEqual([['mp4', 'aac', 105], ['adts', 'aac', 105], ['mp3', 'mp3', 86], ['webm', 'aac', 105]]);
    expect(dialogs).toEqual([]);
  });

  test('E25. a file that can’t be read (NotReadableError): a playlist skips it with the words and saves the others; alone it stops with its own words (re-review B6)', async ({ page }) => {
    test.setTimeout(180_000);
    await stubDownloads(page);
    // tone-0002's Blob (7.3 s: a size of its own) can't be read: its slices' reads reject as Chrome's do when the file
    // under a Blob is gone.
    await page.addInitScript(() => {
      const w = window as any;
      w.__unreadableSize = 44 + Math.round(7.3 * 8000) * 2;
      const bad = new WeakSet<Blob>();
      const slice = Blob.prototype.slice;
      Blob.prototype.slice = function (this: Blob, ...a: any[]) {
        const b = (slice as any).apply(this, a);
        if (this.size === w.__unreadableSize || bad.has(this)) bad.add(b);
        return b;
      } as typeof slice;
      const ab = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function (this: Blob) {
        if (bad.has(this) || this.size === w.__unreadableSize) return Promise.reject(new DOMException('The requested file could not be read.', 'NotReadableError'));
        return ab.call(this);
      };
    });
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 6, patch: [{ index: 1, seconds: 7.3 }], playlists: [{ id: 'plread01', name: 'Read', indexes: [0, 1, 2] }] });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const alone = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, {}), ids[1]);
    expect([alone.outcome, alone.reason]).toEqual(['failed', 'unreadable']);
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    await page.locator('[data-testid="playlist-row"][data-playlist-id="plread01"]').getByRole('button', { name: /Options for/ }).click();
    await page.getByTestId('playlist-menu-export').click();
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
    expect((await caughtDownloads(page, 2)).map((f) => f.name)).toEqual(['tone-0001 · 174 Hz · Aetheria.wav', 'tone-0003 · 396 Hz · Aetheria.wav']);
    await expect(sheet.getByTestId('export-done')).toContainText('Saved 2 of 3 to your downloads');
    await expect(sheet.getByTestId('export-skipped')).toHaveText("Skipped 1: tone-0002 (its audio can't be read).");
    await sheet.getByTestId('export-done-button').click();
    await page.getByTestId('library-view-tracks').click();
    await openExportFromRow(page, 'tone-0002');
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-failed-line')).toHaveText("The export stopped: This track's audio can't be read from this device's storage. Import it again, then try again.", { timeout: 30_000 });
    expect(dialogs).toEqual([]);
  });

  test('E26. Cancel waits 10 s at most (re-review B10/B5): a job that never answers is let go with the words; Record and Reload are free again at once, a new export, Analyse tracks and Deep Scan only once it has stopped (final fixes: its decode may still run), with the words; its late result changes nothing', async ({ page }) => {
    test.setTimeout(180_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 4, { real: 4, seconds: 30, crystals: 'none' });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0004').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    // The hang: App hears this job's result only when releaseHang() is called.
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 60, hang: true }));
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-running')).toBeVisible();
    const t0 = Date.now();
    await sheet.getByTestId('export-cancel').click();
    await expect(sheet.getByTestId('export-cancelling')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    await expect(page.getByTestId('notices').getByTestId('update-reload'), 'held while it cancels').toBeDisabled();
    // Let go after the wait, with the words; the sheet is the summary again.
    await expect(page.getByTestId('notices')).toContainText("Cancelled. The export didn't stop in time, so it was let go: nothing more from it will be saved.", { timeout: 15_000 });
    const waited = Date.now() - t0;
    test.info().annotations.push({ type: 'E26 let go after (ms)', description: String(waited) });
    expect(waited, 'about 10 s').toBeGreaterThanOrEqual(9_000);
    expect(await page.evaluate(() => (window as any).__aetheriaExport.state().running)).toBe(false);
    // v16.5 final: let go, but its promise hasn't settled (abandon() can't stop a decode): a new export waits, with the words.
    await expect(sheet.getByTestId('export-start'), 'no second export beside a decode that may still run').toBeDisabled();
    await expect(sheet.getByTestId('export-cant')).toHaveText('The cancelled export is still stopping. Export again when it has stopped.');
    await expect(page.getByTestId('notices').getByTestId('update-reload'), 'the banner’s Reload is free').toBeEnabled();
    // A track over the cap keeps its own screen meanwhile (the hold is the reason only when nothing more particular is).
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(10));
    await openExportFromRow(page, 'tone-0003');
    await expect(sheet.getByTestId('export-overcap')).toBeVisible();
    await expect(sheet.getByTestId('export-cant')).toContainText('This track is 1 minutes long.');
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(null));
    await page.keyboard.press('Escape');
    await openLibraryTab(page);
    const analyse = page.getByTestId('health-analyse-action');
    await expect(analyse, 'Analyse tracks waits too').toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('health-analyse')).toContainText('Unavailable while the cancelled export stops');
    await analyse.click({ force: true });
    await expect(page.getByTestId('notices')).toContainText("Analyse tracks can't start while the cancelled export is still stopping. Start it when it has stopped.");
    expect(await page.evaluate(() => (window as any).__aetheriaAnalyse?.state().phase ?? 'idle'), 'Analyse tracks did not start').toBe('idle');
    const scan = page.getByTestId('health-scan-action').or(page.getByTestId('health-scan-assigned-action')).first();
    await expect(scan, 'Deep Scan waits too').toHaveAttribute('aria-disabled', 'true');
    await scan.click({ force: true });
    await expect(page.getByTestId('notices')).toContainText("Deep Scan can't start while the cancelled export is still stopping.");
    await tab(page, 'more');
    if ((await moreView(page)) !== 'root') await tab(page, 'more');
    await moreRow(page, 'more-record-row').click();
    const rec = page.getByRole('dialog', { name: 'Record', exact: true });
    await expect(rec.getByTestId('record-exporting')).toHaveCount(0);
    await expect(rec.getByTestId('record-option-audio'), 'Record is free (it decodes nothing)').toBeEnabled();
    await page.keyboard.press('Escape');
    // The hung job's result arrives at last: it changes nothing (no screen, no file), and the hold ends.
    await page.evaluate(() => (window as any).__aetheriaExport.releaseHang());
    await openLibraryTab(page);
    await expect(page.getByTestId('health-analyse-action'), 'stopped: Analyse tracks is free').not.toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 });
    expect(await page.evaluate(() => (window as any).__aetheriaExport.state().last), 'the late result recorded nothing').toBeNull();
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 0, hang: false }));
    await openExportFromRow(page, 'tone-0002');
    await expect(sheet.getByTestId('export-cant'), 'the late result left no screen behind').toHaveCount(0);
    await expect(sheet.getByTestId('export-start'), 'stopped: Export is on again').toBeEnabled();
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    expect((await caughtDownloads(page, 1)).map((f) => f.name), 'only the second export saved').toEqual(['tone-0002 · Aetheria.wav']);
    expect(dialogs).toEqual([]);
  });

  test('E26b. the engine’s abandon() itself (final fixes): the wake lock released, its listeners dropped, nothing emitted after it while the step it was in returns, no lock asked for again, and the job ends cancelled', async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = await openSeededNewLayout(page, 1, { real: 1, seconds: 4 });
    await hookReady(page);
    const r = await page.evaluate(async () => {
      const w = window as any;
      // A wake lock that records what is asked of it.
      const lockLog = { requests: 0, releases: 0 };
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: async () => { lockLog.requests++; const s: any = { released: false, release: async () => { if (!s.released) { s.released = true; lockLog.releases++; } }, addEventListener: () => {} }; return s; } },
      });
      // A 12.5 s WAV whose whole-file read (the decode's) hangs until let through; the 64 KB header reads pass.
      const frames = 100_000;
      const b = new ArrayBuffer(44 + frames * 2);
      const dv = new DataView(b);
      const s4 = (o: number, x: string) => { for (let k = 0; k < 4; k++) dv.setUint8(o + k, x.charCodeAt(k)); };
      s4(0, 'RIFF'); dv.setUint32(4, 36 + frames * 2, true); s4(8, 'WAVE'); s4(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); s4(36, 'data'); dv.setUint32(40, frames * 2, true);
      const file = new Blob([b], { type: 'audio/wav' });
      let letThrough: (() => void) | null = null;
      let reading = false;
      const ab = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function (this: Blob) {
        if (this.size !== file.size) return ab.call(this);
        reading = true;
        return new Promise((resolve) => { letThrough = () => resolve(ab.call(this)); });
      };
      try {
        const engine = await import('/utils/export/engine.ts');
        const plan = await import('/utils/export/exportPlan.ts');
        const spec = plan.exportSpecFor({ engine: 'v2', musicOnly: true, output: 'headphones', droneEnabled: false, keyFitOn: false, toneLevel: 0.5, lowering: null, beatLevel: 0.5, presetName: 'Alpha', adaptive: false, phiOn: false, perfectGut: false, playingId: null, selectedHz: 0 } as any, { id: 'a', name: 'a' }, 'headphones');
        const job = engine.createJob('track', [{ id: 'a', title: 'a', duration: 12.5, file, fileName: 'a.wav', spec, envelope: null, name: 'a.wav' }], 'a', 'a.wav', {
          playback: () => null, mobile: false, deviceMemory: null, keepAwake: () => true, save: () => {}, software: 'test',
        });
        let before = 0, after = 0;
        job.store.subscribe(() => before++);
        const t0 = performance.now();
        while (!reading && performance.now() - t0 < 10_000) await new Promise((x) => setTimeout(x, 20));
        await new Promise((x) => setTimeout(x, 100));
        const held = { reading, requests: lockLog.requests, releases: lockLog.releases, listening: job.store.listening(), heardBefore: before };
        job.abandon();
        const afterAbandon = { releases: lockLog.releases, listening: job.store.listening() };
        job.store.subscribe(() => after++);
        const heardAtAbandon = before;
        // Past the progress throttle (250 ms), the read returns: the read step's progress would emit here.
        await new Promise((x) => setTimeout(x, 400));
        (letThrough as any)?.();
        const res = await job.promise;
        // The page shows again (a hidden page's lock would be asked for again while a job runs): not after abandon().
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise((x) => setTimeout(x, 200));
        return { held, afterAbandon, heardAfter: before - heardAtAbandon, lateListener: after, outcome: res.outcome, steps: res.steps.map((x: any) => x.step), requestsAtEnd: lockLog.requests };
      } finally {
        Blob.prototype.arrayBuffer = ab;
        void w;
      }
    });
    test.info().annotations.push({ type: 'E26b abandon()', description: JSON.stringify(r) });
    expect(r.held.reading, 'the job was in its read').toBe(true);
    expect([r.held.requests, r.held.releases, r.held.listening], 'a lock held, one listener').toEqual([1, 0, 1]);
    expect(r.held.heardBefore, 'it emitted while running').toBeGreaterThan(0);
    expect(r.afterAbandon, 'abandon(): the lock released, the listeners dropped').toEqual({ releases: 1, listening: 0 });
    expect([r.heardAfter, r.lateListener], 'nothing emitted after abandon(), to the old listener or a new one').toEqual([0, 0]);
    expect(r.outcome, 'the read returned into a cancelled job').toBe('cancelled');
    expect(r.steps, 'it stopped after its read: no decode').toEqual(['length', 'read']);
    expect(r.requestsAtEnd, 'no lock asked for again').toBe(1);
    expect(dialogs).toEqual([]);
  });

  test('E27. “Reload anyway” (the library couldn’t be saved before a reload) waits for a running export, with About’s words, as the other Reloads do (re-review)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    await controlStateSaves(page);
    const dialogs = await openSeededNewLayout(page, 2, { real: 2, seconds: 20 });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    await page.evaluate(() => {
      (window as any).__samePage = true;
      (window as any).__failStateSaves = true;
      window.dispatchEvent(new Event('aetheria:update-ready'));
    });
    await page.getByTestId('notices').getByTestId('update-reload').click();
    const anyway = page.getByTestId('notices').getByRole('button', { name: 'Reload anyway' });
    await expect(anyway).toBeVisible({ timeout: 30_000 });
    // An export starts; then "Reload anyway" is tapped: the note, no reload.
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 60 }));
    await openExportFromRow(page, 'tone-0001');
    await exportSheet(page).getByTestId('export-start').click();
    await expect(exportSheet(page).getByTestId('export-running')).toBeVisible();
    await page.keyboard.press('Escape');
    await anyway.click();
    await expect(page.getByTestId('notices')).toContainText('Wait for the export to finish: reloading would lose it.');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as any).__samePage), 'no reload').toBe(true);
    expect(await page.evaluate(() => (window as any).__aetheriaExport.state().running), 'the export runs on').toBe(true);
    // The toast with "Reload anyway" comes back after the note.
    await expect(anyway).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => (window as any).__aetheriaExport.cancel());
    expect(dialogs).toEqual([]);
  });
});

// v16.5 final fixes: a phone never decodes a file far past its memory cap (a renderer killed for memory stops the music
// too). ADTS AAC measured by its frames; the MP3 walk's edges; on a phone, no decode without a length the export
// established itself; the long file's plan checks the size bound before it walks a file; a read failing at a long
// file's decode names its track.
test.describe('phone, final fixes', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  /** In the page: each track's length by Chrome's own probe (an <audio>'s metadata: the app's) and by its decode at
   *  `rate` (no resampling when it is the file's). */
  async function truthOf(page: Page, ids: string[], rate: number): Promise<Array<{ probe: number; decoded: number | null }>> {
    return page.evaluate(async ({ ids, rate }) => {
      const db: IDBDatabase = await new Promise((res, rej) => { const q = indexedDB.open('aetheria-db'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      const blob = (id: string): Promise<Blob> => new Promise((res) => { const q = db.transaction('blobs').objectStore('blobs').get(id); q.onsuccess = () => res(q.result.fileBlob); });
      const out: Array<{ probe: number; decoded: number | null }> = [];
      for (const id of ids) {
        const b = await blob(id);
        const probe = await new Promise<number>((res) => { const a = new Audio(URL.createObjectURL(b)); a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(0); });
        let decoded: number | null = null;
        try {
          const d = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await b.arrayBuffer());
          decoded = d.length / d.sampleRate;
        } catch {}
        out.push({ probe, decoded });
      }
      db.close();
      return out;
    }, { ids, rate });
  }
  const renderOf = (page: Page) => (id: string, o: Record<string, unknown> = {}) => page.evaluate(({ id, o }) => (window as any).__aetheriaExport.render(id, o), { id, o });
  const AAC_FRAME = 1024 / 44_100;
  const MP3_FRAME = 1152 / 44_100;

  test('E28. ADTS AAC’s length from its frames (final fixes, B1): 300 s VBR and ABR streams that Chrome reads as a fraction of that are measured to the frame (their decodes) and refused after the read and before the decode under a 4-minute cap; a 30 s ADTS file is exported at its frames’ length; a long file’s plan walks them @mobile', async ({ page }) => {
    test.skip(!ffmpegAvailable(), 'ffmpeg is needed on PATH to make the test AAC');
    test.setTimeout(240_000);
    const dialogs = await openSeededNewLayout(page, 3, {
      real: 3,
      seconds: 10,
      patch: [
        { index: 0, bytes: b64(MEDIA.adtsVbr(300)), ext: 'aac', mime: 'audio/aac', seconds: 33 },
        { index: 1, bytes: b64(MEDIA.adtsAbr(300)), ext: 'aac', mime: 'audio/aac', seconds: 75 },
        { index: 2, bytes: b64(MEDIA.adts(30)), ext: 'aac', mime: 'audio/aac', seconds: 30 },
      ],
      playlists: [{ id: 'pladts01', name: 'ADTS', indexes: [0, 2] }],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const render = renderOf(page);
    const truth = await truthOf(page, ids, 44_100);
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(240));
    const got = [await render(ids[0]), await render(ids[1])];
    test.info().annotations.push({ type: 'E28 the 300 s ADTS files', description: JSON.stringify({ truth, got: got.map((r) => ({ reason: r.reason, steps: steps(r), scan: r.sources[0]?.scan, cap: r.cap })) }) });
    for (const [k, r] of got.entries()) {
      expect(truth[k].probe, 'Chrome’s own length: far short (the hole)').toBeLessThan(150);
      expect([r.outcome, r.reason]).toEqual(['failed', 'cap']);
      expect(steps(r), 'read, then refused: no decode').toEqual(['length', 'read']);
      expect(r.sources[0].scan.kind).toBe('adts');
      expect(Math.abs(r.sources[0].scan.seconds - (truth[k].decoded as number)), 'measured to the frame: its decode’s length').toBeLessThanOrEqual(AAC_FRAME + 1e-6);
      expect(r.cap.seconds, 'refused at its real length').toBeCloseTo(r.sources[0].scan.seconds, 3);
    }
    // A 30 s ADTS file within the cap: decoded whole, its file the frames' length.
    const ok = await render(ids[2], { snap: { musicOnly: true } });
    expect(ok.outcome).toBe('done');
    expect(steps(ok).slice(0, 3)).toEqual(['length', 'read', 'decode']);
    expect(Math.abs(ok.sources[0].scan.seconds - (truth[2].decoded as number)), 'its frames: its decode').toBeLessThanOrEqual(AAC_FRAME + 1e-6);
    expect(Math.abs(ok.files[0].outSeconds * PSF - (truth[2].decoded as number)), 'the file: the decode, retuned').toBeLessThan(0.05);
    // One long file: the plan walks each ADTS file, so the one over the cap is skipped before it is read for a decode.
    const long = await render('', { playlistId: 'pladts01', files: 'long', snap: { musicOnly: true } });
    test.info().annotations.push({ type: 'E28 the long file', description: JSON.stringify({ outcome: long.outcome, skipped: long.skipped, steps: long.steps.map((s: any) => s.step), vbr: sourceOf(long, ids[0]) }) });
    expect(long.outcome).toBe('done');
    expect(long.skipped.map((s: any) => [s.title, s.why])).toEqual([['tone-0001', 'too-long']]);
    expect(stepsFor(long, ids[0]), 'its length only, never read for a decode').toEqual(['length']);
    expect([sourceOf(long, ids[0]).scan.kind, Math.abs(sourceOf(long, ids[0]).scan.seconds - (truth[0].decoded as number)) <= AAC_FRAME + 1e-6]).toEqual(['adts', true]);
    expect(dialogs).toEqual([]);
  });

  test('E29. the MP3 walk’s edges (final fixes): an ID3 header with a bogus size mid-stream and 20 KB of junk after the leading tag, both read by Chrome as about 45 s: each measured within a frame of its decode, refused before the decode at its real length, exported whole within the cap @mobile', async ({ page }) => {
    test.skip(!ffmpegAvailable(), 'ffmpeg is needed on PATH to make the test MP3s');
    test.setTimeout(240_000);
    const vbr = MEDIA.vbrNoXing(180);
    const dialogs = await openSeededNewLayout(page, 2, {
      real: 2,
      seconds: 10,
      patch: [{ index: 0, bytes: b64(midId3Bogus(vbr)), seconds: 45 }, { index: 1, bytes: b64(junkAfterTag(vbr)), seconds: 45 }],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const render = renderOf(page);
    const truth = await truthOf(page, ids, 44_100);
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(150));
    const refused = [await render(ids[0]), await render(ids[1])];
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(null));
    const whole = [await render(ids[0], { snap: { musicOnly: true } }), await render(ids[1], { snap: { musicOnly: true } })];
    test.info().annotations.push({ type: 'E29 the MP3 edges', description: JSON.stringify({ truth, refused: refused.map((r) => ({ reason: r.reason, steps: steps(r), scan: r.sources[0]?.scan })), whole: whole.map((r) => ({ outcome: r.outcome, out: r.files[0]?.outSeconds, scan: r.sources[0]?.scan?.seconds })) }) });
    for (const k of [0, 1]) {
      expect(truth[k].probe, 'Chrome’s own length: about a quarter').toBeLessThan(60);
      const r = refused[k];
      expect([r.outcome, r.reason]).toEqual(['failed', 'cap']);
      expect(steps(r), 'read, then refused: no decode').toEqual(['length', 'read']);
      expect(r.sources[0].scan.seconds - (truth[k].decoded as number), 'never short, within a frame of its decode').toBeGreaterThanOrEqual(-1e-6);
      expect(Math.abs(r.sources[0].scan.seconds - (truth[k].decoded as number))).toBeLessThanOrEqual(MP3_FRAME + 1e-3);
      expect(r.cap.seconds, 'refused at its real length').toBeGreaterThan(179);
      expect(whole[k].outcome).toBe('done');
      expect(Math.abs(whole[k].files[0].outSeconds * PSF - (truth[k].decoded as number)), 'exported whole').toBeLessThan(0.1);
    }
    expect(dialogs).toEqual([]);
  });

  test('E30. a length the export can’t establish (final fixes): on a phone, a FLAC without its sample count, a fragmented M4A and a WebM without a Duration are refused before they are read, a layer II file named .mp3 after its read and before its decode, with the words, and a playlist skips them by name; a WAV of MP3, an Ogg and a µ-law WAV are measured and exported; on a computer the estimates stand @mobile', async ({ page }) => {
    test.skip(!ffmpegAvailable(), 'ffmpeg is needed on PATH to make the test media');
    test.setTimeout(240_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 7, {
      real: 7,
      seconds: 10,
      patch: [
        { index: 0, bytes: b64(understateFlac(MEDIA.flac(10), 0)), ext: 'flac', mime: 'audio/flac', seconds: 10 },
        { index: 1, bytes: b64(MEDIA.fragM4a(10)), ext: 'm4a', mime: 'audio/mp4', seconds: 10 },
        { index: 2, bytes: b64(MEDIA.webmLive(10)), ext: 'webm', mime: 'audio/webm', seconds: 10 },
        { index: 3, bytes: b64(MEDIA.mp2(10)), ext: 'mp3', mime: 'audio/mpeg', seconds: 10 },
        { index: 4, bytes: b64(MEDIA.wavMp3(10)), ext: 'wav', mime: 'audio/wav', seconds: 10 },
        { index: 5, bytes: b64(MEDIA.oggOpus(10)), ext: 'ogg', mime: 'audio/ogg', seconds: 10 },
        { index: 6, bytes: b64(MEDIA.ulawWav(10)), ext: 'wav', mime: 'audio/wav', seconds: 10 },
      ],
      playlists: [{ id: 'plmeasure', name: 'Measure', indexes: [0, 4] }],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const mobile = await page.evaluate(() => /Android/.test(navigator.userAgent));
    const render = renderOf(page);
    const r: any[] = [];
    for (const id of ids) r.push(await render(id, { snap: { musicOnly: true } }));
    const row = r.map((x) => ({ outcome: x.outcome, reason: x.reason ?? null, steps: steps(x), kind: x.sources[0]?.scan?.kind ?? null, scan: x.sources[0]?.scan?.seconds ?? null, out: x.files[0]?.outSeconds ?? null }));
    test.info().annotations.push({ type: `E30 (${mobile ? 'phone' : 'computer'})`, description: JSON.stringify(row) });
    if (mobile) {
      for (const k of [0, 1, 2]) expect([row[k].outcome, row[k].reason, row[k].steps], `track ${k + 1}: no length but Chrome’s: refused before it is read`).toEqual(['failed', 'untrusted', ['length']]);
      expect([row[3].outcome, row[3].reason, row[3].steps], 'layer II: no frames the walk knows: refused after the read, before the decode').toEqual(['failed', 'untrusted', ['length', 'read']]);
    } else {
      for (const k of [0, 1, 2]) expect(row[k].outcome, `track ${k + 1}: a computer keeps Chrome’s estimate (its 2 GB budget)`).toBe('done');
      expect([row[3].outcome, row[3].reason], 'layer II: Chrome can’t decode it').toEqual(['failed', 'decode']);
    }
    expect([row[4].outcome, row[4].kind], 'a WAV of MP3: its data chunk walked').toEqual(['done', 'mp3']);
    expect([row[5].outcome, row[5].kind], 'an Ogg: its pages walked').toEqual(['done', 'ogg']);
    for (const k of [4, 5]) expect(Math.abs(row[k].out * PSF - row[k].scan), `track ${k + 1}: the file is the walk’s length`).toBeLessThan(0.1);
    expect([row[6].outcome, row[6].kind], 'a µ-law WAV: its length from its data (no walk)').toEqual(['done', null]);
    if (mobile) {
      // The words, in the sheet; a playlist of files skips the track by name and saves the other.
      await openExportFromRow(page, 'tone-0001');
      const sheet = exportSheet(page);
      await sheet.getByTestId('export-start').click();
      await expect(sheet.getByTestId('export-failed-line')).toHaveText("The export stopped: This track's length can't be checked on a phone, so it can't be exported here. A computer can export it.", { timeout: 30_000 });
      await sheet.getByTestId('export-retry').click();
      await page.keyboard.press('Escape');
      await openLibraryTab(page);
      await page.getByTestId('library-view-playlists').click();
      await page.locator('[data-testid="playlist-row"][data-playlist-id="plmeasure"]').getByRole('button', { name: /Options for/ }).click();
      await page.getByTestId('playlist-menu-export').click();
      await sheet.getByTestId('export-start').click();
      await expect(sheet.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
      await expect(sheet.getByTestId('export-skipped')).toHaveText("Skipped 1: tone-0001 (its length can't be checked on a phone).");
      expect((await caughtDownloads(page, 1)).length).toBe(1);
    }
    expect(dialogs).toEqual([]);
  });

  test('E31. a long file’s plan checks the size bound before it walks a file (final fixes: a big MP3 with a wrong stored length was read through to be refused); a read that fails at a track’s decode names the track, in the words too', async ({ page }) => {
    test.skip(!ffmpegAvailable(), 'ffmpeg is needed on PATH to make the test MP3');
    test.setTimeout(180_000);
    // tone-0003's whole-file read (its decode's) fails as Chrome's does when the file under a Blob is gone; its 64 KB
    // header reads pass, so the plan establishes it.
    await page.addInitScript(() => {
      const w = window as any;
      w.__unreadableWhole = 44 + Math.round(7.3 * 8000) * 2;
      const ab = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function (this: Blob) {
        if (this.size === w.__unreadableWhole) return Promise.reject(new DOMException('The requested file could not be read.', 'NotReadableError'));
        return ab.call(this);
      };
    });
    const dialogs = await openSeededNewLayout(page, 4, {
      real: 4,
      seconds: 6,
      patch: [{ index: 0, bytes: b64(MEDIA.cbr320(120)), seconds: 30 }, { index: 2, seconds: 7.3 }],
      playlists: [{ id: 'plbig01', name: 'Big', indexes: [0, 1] }, { id: 'plread02', name: 'Read', indexes: [1, 2, 3] }],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const render = renderOf(page);
    // 120 s at 320 kbps: at least 120 s by its size alone, over a 60 s cap: refused without its frames walked.
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(60));
    const big = await render('', { playlistId: 'plbig01', files: 'long', snap: { musicOnly: true } });
    await page.evaluate(() => (window as any).__aetheriaExport.setCaps(null));
    test.info().annotations.push({ type: 'E31 the size bound first', description: JSON.stringify({ outcome: big.outcome, skipped: big.skipped, mp3: sourceOf(big, ids[0]) }) });
    expect(big.outcome).toBe('done');
    expect(big.skipped.map((s: any) => [s.title, s.why])).toEqual([['tone-0001', 'too-long']]);
    expect(sourceOf(big, ids[0]).seconds, 'refused at its size bound').toBeGreaterThan(119);
    expect(sourceOf(big, ids[0]).scan ?? null, 'its frames never walked (the file not read through)').toBeNull();
    expect(stepsFor(big, ids[0])).toEqual(['length']);
    // A long file whose second track can't be read at its decode: the failure names it.
    const rd = await render('', { playlistId: 'plread02', files: 'long', snap: { musicOnly: true } });
    test.info().annotations.push({ type: 'E31 the read at the decode', description: JSON.stringify({ outcome: rd.outcome, reason: rd.reason, failedTitle: rd.failedTitle, steps: rd.steps.map((s: any) => s.step) }) });
    expect([rd.outcome, rd.reason, rd.failedTitle]).toEqual(['failed', 'unreadable', 'tone-0003']);
    expect(stepsFor(rd, ids[2])).toEqual(['length', 'read']);
    await openLibraryTab(page);
    await page.getByTestId('library-view-playlists').click();
    await page.locator('[data-testid="playlist-row"][data-playlist-id="plread02"]').getByRole('button', { name: /Options for/ }).click();
    await page.getByTestId('playlist-menu-export').click();
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-files-long').click();
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-failed-line')).toHaveText("The export stopped: tone-0003's audio can't be read from this device's storage. Export one file per track to save the others.", { timeout: 60_000 });
    expect(dialogs).toEqual([]);
  });
});

// ---- v16.5 export memory ------------------------------------------------------------------------------------------
const ANDROID_UA_E = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';

test.describe('phone, export memory', () => {
  test.use({ viewport: PHONE_VIEWPORT, userAgent: ANDROID_UA_E });

  /** In the page: every one-byte read the engine makes of an output part (its receipt: a Blob read resolves once the
   *  browser holds the bytes) is counted, held `delayMs`, and failed when `fail` is set. */
  async function watchReceipts(page: Page, o: { delayMs?: number; fail?: boolean } = {}): Promise<void> {
    await page.evaluate((o) => {
      const w = window as any;
      w.__parts = { made: 0, inFlight: 0, maxInFlight: 0, sizes: [] as number[], fail: !!o.fail, delayMs: o.delayMs ?? 0 };
      if (w.__partsOrig) return;
      const orig = Blob.prototype.slice;
      w.__partsOrig = orig;
      Blob.prototype.slice = function (this: Blob, ...a: any[]) {
        const r: Blob = orig.apply(this, a as any);
        if (a.length === 1 && a[0] === this.size - 1 && this.type === '' && this.size > 1) {
          const st = w.__parts;
          st.made++;
          st.sizes.push(this.size);
          st.inFlight++;
          st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
          const ab = r.arrayBuffer.bind(r);
          (r as any).arrayBuffer = () => new Promise((res, rej) => setTimeout(() => { st.inFlight--; if (st.fail) rej(new DOMException('taken nowhere', 'NotReadableError')); else ab().then(res, rej); }, st.delayMs));
        }
        return r;
      } as typeof Blob.prototype.slice;
    }, o);
  }

  test('E32. the file leaves the renderer as it is made (export memory, fix 1): 4 MiB parts, each a Blob at once and its receipt awaited before the next (one in transit at most), on a track and a long file; a part the browser can’t take stops the export as out of memory, with the words, and nothing is saved', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 100, playlists: [{ id: 'plparts', name: 'Parts', indexes: [0, 1] }] });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    for (const [what, run] of [['a track', (id: string) => (window as any).__aetheriaExport.render(id, { snap: { musicOnly: true } })], ['a long file', () => (window as any).__aetheriaExport.render('', { playlistId: 'plparts', files: 'long', snap: { musicOnly: true } })]] as const) {
      // Each receipt held 500 ms: a next part made before it (no wait) would be a second in transit.
      await watchReceipts(page, { delayMs: 500 });
      const r = await page.evaluate(run, ids[0]);
      const parts = await page.evaluate(() => (window as any).__parts);
      test.info().annotations.push({ type: `E32 the parts: ${what}`, description: JSON.stringify({ made: parts.made, maxInFlight: parts.maxInFlight, first: parts.sizes.slice(0, 3), last: parts.sizes.slice(-1), bytes: r.files[0]?.bytes }) });
      expect(r.outcome, what).toBe('done');
      const bytes = r.files[0].bytes;
      expect(parts.made, `${what}: a receipt for every part`).toBeGreaterThanOrEqual(Math.ceil((bytes - 512) / (4 * 1024 * 1024)));
      expect(parts.made).toBeLessThanOrEqual(Math.ceil(bytes / (4 * 1024 * 1024)));
      expect(parts.sizes.slice(0, -1).every((s: number) => s === 4 * 1024 * 1024), `${what}: each part but the last is 4 MiB`).toBe(true);
      expect(parts.maxInFlight, `${what}: the next part waits for the last one’s receipt`).toBe(1);
    }
    // The browser can't take a part (its blob store full): the export stops as out of memory, with the words.
    await watchReceipts(page, { fail: true });
    const bad = await page.evaluate((id) => (window as any).__aetheriaExport.render(id, { snap: { musicOnly: true } }), ids[2]);
    expect([bad.outcome, bad.reason], 'out of memory, never a broken file').toEqual(['failed', 'memory']);
    await openExportFromRow(page, 'tone-0003');
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-failed-line')).toHaveText('The export stopped: Not enough memory for this track. Close other tabs or apps and try again.', { timeout: 60_000 });
    await page.waitForTimeout(1000);
    expect((await caughtDownloads(page)).length, 'nothing saved').toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('E26c. a let-go export still stopping a minute later (export memory, fix 7): the held lines add “or reload Aetheria” (the sheet, the health card, a tap’s words), and go with the hold when it stops', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 30, crystals: 'none' });
    await hookReady(page);
    // The minute, as 3 s here (the dev hook's tuning; the app's is STOPPING_LONG_MS, 60 s).
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 60, hang: true, stoppingLongMs: 3000 }));
    await openExportFromRow(page, 'tone-0001');
    const sheet = exportSheet(page);
    await sheet.getByTestId('export-start').click();
    await expect(sheet.getByTestId('export-running')).toBeVisible();
    await sheet.getByTestId('export-cancel').click();
    await expect(page.getByTestId('notices')).toContainText("Cancelled. The export didn't stop in time", { timeout: 15_000 });
    await expect(sheet.getByTestId('export-cant')).toHaveText('The cancelled export is still stopping. Export again when it has stopped.');
    await expect(sheet.getByTestId('export-cant'), 'a minute on: the reload added').toHaveText('The cancelled export is still stopping. Export again when it has stopped, or reload Aetheria.', { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await openLibraryTab(page);
    await expect(page.getByTestId('health-analyse')).toContainText('Unavailable while the cancelled export stops, or reload Aetheria');
    await page.getByTestId('health-analyse-action').click({ force: true });
    await expect(page.getByTestId('notices')).toContainText("Analyse tracks can't start while the cancelled export is still stopping. Start it when it has stopped, or reload Aetheria.");
    // It stops at last: the hold and its line go.
    await page.evaluate(() => (window as any).__aetheriaExport.releaseHang());
    await expect(page.getByTestId('health-analyse-action'), 'stopped: Analyse tracks is free').not.toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 });
    await expect(page.getByTestId('health-analyse')).not.toContainText('reload Aetheria');
    await page.evaluate(() => (window as any).__aetheriaExport.tuning({ sliceDelayMs: 0, hang: false, stoppingLongMs: null }));
    expect(dialogs).toEqual([]);
  });

  test('E34. tags and a bogus leading tag on a phone (export memory, fixes 4 and 5): a 60 s 64 kbps MP3 with 300 KB of cover art in a trailing ID3v2 tag, and one with 200 KB in a trailing APEv2 tag, are measured and exported (they were refused: 38 % and 29 % “junk”); an MP3 behind a leading ID3 header whose size runs past the file is measured by its frames, alone and in a long file’s plan (a 20-minute one too, walked in 8 MB slices: refused at its length, not as unmeasured)', async ({ page }) => {
    test.skip(!ffmpegAvailable(), 'ffmpeg is needed on PATH to make the test MP3s');
    test.setTimeout(240_000);
    const s60 = MEDIA.cbr64(60);
    const files = [Buffer.concat([s60, id3v2Tag(300_000)]), Buffer.concat([s60, apeTag(200_000)]), bogusLeadingTag(MEDIA.cbr64(120)), bogusLeadingTag(MEDIA.cbr64(1200))];
    const dialogs = await openSeededNewLayout(page, 4, {
      real: 4,
      seconds: 10,
      // The 20-minute file stored at 200 s (as Chrome may read it): under the phone's cap until it is walked.
      patch: files.map((b, index) => ({ index, bytes: b64(b), seconds: [60, 60, 120, 200][index] })),
      playlists: [{ id: 'pltagged', name: 'Tagged', indexes: [0, 1, 2, 3] }],
    });
    await hookReady(page);
    const ids = (await libraryState(page)).libraryIds;
    const one: any[] = [];
    for (const id of ids.slice(0, 3)) one.push(await page.evaluate((id) => (window as any).__aetheriaExport.render(id, { snap: { musicOnly: true } }), id));
    const long = await page.evaluate(() => (window as any).__aetheriaExport.render('', { playlistId: 'pltagged', files: 'long', snap: { musicOnly: true } }));
    const brief = (r: any) => ({ outcome: r.outcome, reason: r.reason ?? null, steps: r.steps.map((x: any) => x.step), scans: r.sources.map((s: any) => s.scan && { s: +s.scan.seconds.toFixed(3), junk: s.scan.junk, tags: s.scan.tags }), skipped: r.skipped, failedTitle: r.failedTitle });
    test.info().annotations.push({ type: 'E34 tags and a bogus leading tag', description: JSON.stringify({ sizes: files.map((b) => b.length), one: one.map(brief), long: brief(long) }) });
    for (const k of [0, 1]) {
      const scan = one[k].sources[0].scan;
      expect(one[k].outcome, `${['ID3v2', 'APEv2'][k]}: exported on a phone`).toBe('done');
      expect(Math.abs(scan.seconds - 60), 'its frames: 60 s').toBeLessThan(0.1);
      expect(scan.junk, 'its tag is no junk').toBeLessThan(1000);
      expect(scan.tags, 'its tag counted as one').toBeGreaterThan(k === 0 ? 300_000 : 200_000);
    }
    // Behind the bogus header: its frames measured (it gave no scan); Chrome may not decode it (its header says the
    // audio is past the end), and then says so.
    const b = one[2];
    expect(Math.abs(b.sources[0].scan.seconds - 120), 'a leading tag past the file: its frames after the header').toBeLessThan(0.1);
    expect(b.outcome === 'done' || b.reason === 'decode', 'exported, or not decodable here').toBe(true);
    // The long file's plan (each walked from the Blob in slices): all four measured; the 20-minute one (over 8 MB: its
    // first slice isn't its last) skipped as too long, not as unmeasured.
    expect(long.skipped.map((s: any) => [s.title, s.why]), 'only the 20-minute file skipped, as too long').toEqual([['tone-0004', 'too-long']]);
    expect(long.sources.map((s: any) => Math.round(s.scan?.seconds ?? 0)), 'the plan walked all four').toEqual([60, 60, 120, 1200]);
    expect(long.outcome === 'done' || (long.reason === 'decode' && long.failedTitle === 'tone-0003'), 'done, or stopped at the bogus file Chrome can’t decode').toBe(true);
    expect(dialogs).toEqual([]);
  });

  for (const [dm, words] of [
    [4, { track: 'This track is 4 minutes long. On a phone, Export with layers takes tracks up to 3 minutes; on a computer, up to 23.', long: 'This playlist is 9 minutes long. On this phone, its tracks need more memory than one long file can have: export one file per track instead.' }],
    [8, { track: null, long: null }],
    [2, { track: 'This track is 4 minutes long. On a phone, Export with layers takes tracks up to 1 minutes; on a computer, up to 23.', long: null }],
  ] as const) {
    test(`E33. the caps by tier on a phone (export memory, fixes 2 and 3), deviceMemory ${dm}: a 4-minute track and a playlist of three 3-minute tracks as one long file, the sheet’s words from the caps`, async ({ page }) => {
      await page.addInitScript((dm) => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => dm, configurable: true }), dm);
      test.setTimeout(150_000);
      const dialogs = await openSeededNewLayout(page, 4, {
        real: 4,
        seconds: 180,
        patch: [{ index: 0, storedSeconds: 240 }],
        playlists: [{ id: 'pltiers', name: 'Tier', indexes: [1, 2, 3] }],
      });
      expect(await page.evaluate(() => [/Android/.test(navigator.userAgent), (navigator as any).deviceMemory]), 'the phone path at this tier').toEqual([true, dm]);
      await openExportFromRow(page, 'tone-0001');
      const sheet = exportSheet(page);
      if (words.track) await expect(sheet.getByTestId('export-cant')).toHaveText(words.track);
      else await expect(sheet.getByTestId('export-start'), 'a 4-minute track: within the > 4 GB cap (10 minutes)').toBeEnabled();
      await page.keyboard.press('Escape');
      await openLibraryTab(page);
      await page.getByTestId('library-view-playlists').click();
      await page.locator('[data-testid="playlist-row"][data-playlist-id="pltiers"]').getByRole('button', { name: /Options for/ }).click();
      await page.getByTestId('playlist-menu-export').click();
      await expect(sheet).toBeVisible();
      if (dm === 2) {
        // ≤ 2 GB: each 3-minute track is over the 1-minute cap: skipped as too long.
        await expect(sheet.getByTestId('export-track').first()).toContainText('Too long: skipped');
      } else {
        await sheet.getByTestId('export-files-long').click();
        if (words.long) await expect(sheet.getByTestId('export-cant')).toHaveText(words.long);
        else await expect(sheet.getByTestId('export-start'), '> 4 GB: three 3-minute tracks (9 min) within the 26-minute long cap').toBeEnabled();
      }
      if (dm === 4) {
        // The engine's own count (each track's length its own): refused over the long file's cap before any decode (v16.5
        // final, the phone gate's model: no long-file minute at all on a ≤ 4 GB phone for 3-minute tracks; was 1).
        await page.keyboard.press('Escape');
        await hookReady(page);
        const r = await page.evaluate(() => (window as any).__aetheriaExport.render('', { playlistId: 'pltiers', files: 'long' }));
        expect([r.outcome, r.reason, r.cap?.what, r.cap?.phoneMin], 'the engine: over the long cap (none here)').toEqual(['failed', 'cap', 'long', 0]);
        expect(r.steps.every((x: any) => x.step === 'length'), 'nothing read for a decode').toBe(true);
      }
      expect(dialogs).toEqual([]);
    });
  }
});
