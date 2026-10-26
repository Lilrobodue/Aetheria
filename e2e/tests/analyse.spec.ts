import { type Page } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import {
  openApp,
  acceptDisclaimer,
  importTones,
  addFiles,
  toneWav,
  expectCache,
  cacheCounts,
  metaRecords,
  savedState,
  countBlobSaves,
  controllableVisibility,
  recordIntervals3s,
  recordMediaMetadata,
  recordLiveDecodes,
  countKeyDecodes,
  recordKeyYields,
  instrumentAudio,
  pauseCount,
  pickFrequency,
  countConsole,
  seedLayers,
  rowOf,
  analyseHook,
  analyseState,
  analyseLast,
  analyseRuns,
  analyseLog,
  analysePlan,
  analysePhases,
  analysePlaying,
  analyseTune,
  analyseMobile,
  waitRuns,
  visualizerEnvelope,
  type AnalyseStep,
} from './helpers';

// Analyse tracks (v15.1): key analysis and visual sync, one user-started pass (utils/library/analysePass.ts).
// The dev hook window.__aetheriaAnalyse paces and reads it: tune() before the tap, then wait for runs() to grow
// and read last(). Persisted state (IndexedDB) is asserted rather than transient toasts, except where a toast
// is the point. A tap on a control that is aria-disabled at that moment uses dispatchEvent('click'): Playwright
// treats aria-disabled="true" as disabled and click() would wait for it to enable.

const analyseButton = (page: Page) => page.getByTestId('analyse-tracks');
const deepScanButton = (page: Page) => page.getByRole('button', { name: /^Deep Scan/ });
const autoDistribute = (page: Page) => page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
const isNative = (r: AnalyseStep) => r.kind === 'probe' || r.kind === 'read' || r.kind === 'decode' || r.kind === 'envelope';
const INFLIGHT_KEY = 'aetheria.analyse.inflight.v1';

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
/** Bytes no decoder reads as audio (seeded, so every run gets the same file). */
function brokenWav(seed: number, size = 24_000): Buffer {
  const b = Buffer.alloc(size);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    b[i] = x & 0xff;
  }
  return b;
}
/** A stereo 16-bit PCM WAV (8 kHz): a sine on the left and a fifth above it on the right. */
function stereoToneWav(seconds: number, freq: number): Buffer {
  const rate = 8000;
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(2, 22); // stereo
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 400, (n - i) / 400);
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000 * fade), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * 1.5 * i) / rate) * 8000 * fade), 46 + i * 4);
  }
  return b;
}
const doneAtLeast = (page: Page, n: number, timeout = 60_000) =>
  expect.poll(async () => (await analyseState(page)).done, { timeout, intervals: [100, 250] }).toBeGreaterThanOrEqual(n);
const phaseIs = (page: Page, phase: string, timeout = 3_000) =>
  expect.poll(async () => (await analyseState(page)).phase, { timeout, intervals: [100, 250] }).toBe(phase);
/** The stored key count once it holds still across two reads 2.5 s apart and `alsoWhile` holds for THAT count (the
 *  condition is given the very value returned: re-reading it there let a save landing in between pass a 3 and return
 *  a 2, v15.8's phone gate). */
async function settledKeyed(page: Page, alsoWhile: (keyed: number) => Promise<boolean> = async () => true, timeout = 60_000): Promise<number> {
  let settled = -1;
  await expect.poll(async () => {
    const a = (await cacheCounts(page)).keyed;
    await page.waitForTimeout(2500);
    const b = (await cacheCounts(page)).keyed;
    if (a === b && (await alsoWhile(a))) settled = a;
    return settled;
  }, { timeout, intervals: [100] }).toBeGreaterThanOrEqual(0);
  return settled;
}

test('Analyse tracks gives Auto-Distributed tracks a visual envelope and key data, never saves audio, and keeps their crystals', async ({ page }) => {
  await countBlobSaves(page);
  const errors = pageErrors(page);
  const dialogs = await openApp(page);
  await importTones(page, 27, 3);
  await autoDistribute(page);
  await expectCache(page, { blobs: 27, analysed: 27 });
  const crystals = (await metaRecords(page)).map((m) => [m.id, m.harmonicFreq, m.closestSolfeggio, m.harmonicDeviation]);
  await analyseHook(page);
  const runs0 = await analyseRuns(page);
  const blobRuns0 = await page.evaluate(() => (window as any).__blobSaveRuns as number);

  await analyseButton(page).click();
  await waitRuns(page, runs0 + 1);
  expect(await analyseLast(page)).toMatchObject({ outcome: 'finished', analysed: 27 });
  await expectCache(page, { envVisual: 27, keyed: 27, envScan: 0, blobs: 27, library: 27 });

  const records = await metaRecords(page);
  expect(records.map((m) => [m.id, m.harmonicFreq, m.closestSolfeggio, m.harmonicDeviation])).toEqual(crystals);
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as any).__blobSaveRuns as number)).toBe(blobRuns0);
  for (const m of records) {
    expect(m.chromaIsArray && m.chroma?.length === 12, `${m.name}: its chroma is an Array of 12`).toBe(true);
    expect(typeof m.musicKey, `${m.name}: musicKey`).toBe('string');
  }
  // tone-01 is a pure 220 Hz tone: A or Am (a 2.8e-4 tie), chroma peak on A, A4 within 10 cents of 440.
  const t1 = records.find((m) => m.name === 'tone-01')!;
  expect(t1.musicKey!.startsWith('A'), `tone-01's key ${t1.musicKey}`).toBe(true);
  expect(t1.chroma!.indexOf(Math.max(...t1.chroma!))).toBe(9);
  expect(Math.abs(1200 * Math.log2(t1.chromaA4Hz! / 440))).toBeLessThanOrEqual(10);

  await page.reload();
  await expect(page.getByText(/Restored \d+ tracks from cache/)).toBeVisible();
  await expectCache(page, { envVisual: 27, keyed: 27 });
  await expect(analyseButton(page)).toContainText('All tracks analysed');
  await expect(rowOf(page, 'tone-01').locator('span[title^="Key A"]')).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

for (const engine of ['v2', 'classic'] as const) {
  test(`The playing track goes first, its envelope reaches the visuals at once, the beat band stays still, and the lock-screen card isn't re-sent (${engine})`, async ({ page }) => {
    await recordIntervals3s(page);
    await recordMediaMetadata(page);
    const errors = pageErrors(page);
    const dialogs = await openApp(page);
    if (engine === 'v2') await seedLayers(page, { engine: 'v2', output: 'headphones' });
    // `long` first, so its row is on screen (the list is virtualized).
    await addFiles(page, [{ name: 'long.wav', mimeType: 'audio/wav', buffer: toneWav(40, 330) }]);
    await expect(page.getByText('long', { exact: true })).toBeVisible();
    await importTones(page, 27, 3);
    await autoDistribute(page);
    await expectCache(page, { blobs: 28, analysed: 28 });
    await page.getByText('long', { exact: true }).click();
    await expect(page.getByTestId('now-playing-title')).toHaveText('long');
    await expect.poll(async () => (await analysePlaying(page))?.name ?? null).toBe('long');
    const longId = (await analysePlaying(page))!.id;
    const mobile = await analyseMobile(page);
    // long has no envelope yet: the Visualizer runs its fallback pulse.
    expect(await visualizerEnvelope(page)).toBe(0);

    // No tune(): the default duty.
    await analyseButton(page).click();
    await expect.poll(async () => {
      const p = await analysePlaying(page);
      return !!p && p.id === longId && p.envelope > 0 && p.source === 'analyse';
    }, { timeout: mobile ? 30_000 : 15_000, intervals: [100, 250] }).toBe(true);
    // The Visualizer's own input, not only the playlist state: its RAF loop now samples long's envelope.
    const frames = (await analysePlaying(page))!.envelope;
    await expect.poll(() => visualizerEnvelope(page), { message: "the Visualizer samples long's envelope", timeout: 5_000, intervals: [100, 250] }).toBe(frames);
    const log = await analyseLog(page);
    const decodes = log.filter((r) => r.kind === 'decode');
    expect(decodes[0]?.id).toBe(longId);
    // The playing track's result is applied alone and at once: the first flush is long's, before any other
    // track is decoded.
    const flushes = log.filter((r) => r.kind === 'flush');
    expect(flushes[0]?.ids).toEqual([longId]);
    const otherDecode = decodes.find((r) => r.id !== longId);
    if (otherDecode) expect(flushes[0].at).toBeLessThan(otherDecode.at);
    const F = flushes.find((r) => r.ids?.includes(longId))!.at;

    // Two adaptive ticks later: no 3 s interval armed after F (Q1), and no metadata re-sent around F (the memo).
    await page.waitForFunction((t) => performance.now() > t, F + 7000, { timeout: 30_000 });
    await expect(page.getByTestId('now-playing-title')).toHaveText('long');
    const arms = await page.evaluate((t) => (window as any).__intervals3s.filter((x: any) => x.e === 'arm' && x.t > t), F);
    expect(arms).toEqual([]);
    const sets = await page.evaluate((t) => (window as any).__metaSets.filter((x: any) => x.t >= t && x.t <= t + 3000), F);
    expect(sets).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('Stop keeps what was analysed, and the next run does only the rest', async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page);
  await importTones(page, 27, 3);
  await expectCache(page, { blobs: 27 });
  await analyseTune(page, { duty: 0.05 });
  await analyseButton(page).click();
  await doneAtLeast(page, 3);
  await analyseButton(page).click(); // stop
  await phaseIs(page, 'idle');
  await page.waitForTimeout(3000); // the stop's results reach IndexedDB with the 2 s debounced save
  const K = await settledKeyed(page);
  expect(K).toBeGreaterThanOrEqual(3);

  const runs = await analyseRuns(page);
  await analyseTune(page, { duty: null }); // the second run at the device's own pace
  await analyseButton(page).click();
  expect((await analyseState(page)).total).toBe(27 - K);
  await waitRuns(page, runs + 1, 240_000);
  await expectCache(page, { keyed: 27 });
});

test('Clear stops the pass: no summary, and nothing saved afterwards', async ({ page }) => {
  await openApp(page);
  await importTones(page, 27, 3);
  await expectCache(page, { blobs: 27 });
  await analyseTune(page, { duty: 0.05 });
  await analyseButton(page).click();
  await doneAtLeast(page, 2);
  const runs = await analyseRuns(page);
  await page.getByRole('button', { name: 'Clear library and cache' }).click();
  await page.getByRole('button', { name: 'Confirm deleting all 27 tracks from this device' }).click();
  await phaseIs(page, 'idle');
  await waitRuns(page, runs + 1, 3_000);
  expect(await analyseLast(page)).toMatchObject({ outcome: 'stopped', reason: 'clear' });
  // No end-of-run toast for a library that is gone.
  const summary = page.getByText(/Analysed \d+ tracks? in|No track could be analysed|Stopped after|Stopped\. Nothing/);
  for (let i = 0; i < 32; i++) {
    expect(await summary.count()).toBe(0);
    await page.waitForTimeout(250);
  }
  const empty = { blobs: 0, meta: 0, library: 0, playOrder: 0, analysed: 0, keyed: 0, envVisual: 0, failedMarks: 0 };
  await expectCache(page, empty);
  await page.waitForTimeout(5000);
  expect(await cacheCounts(page)).toMatchObject(empty);
});

test('Reload for an update saves results the pass had not applied yet', async ({ page }) => {
  await openApp(page);
  await importTones(page, 27, 3);
  await expectCache(page, { blobs: 27 });
  // No batch flush and nothing playing: only the reload's merge can save these results.
  await analyseTune(page, { flushMs: 600_000, duty: 0.05 });
  await analyseButton(page).click();
  await doneAtLeast(page, 3);
  expect(await analyseRuns(page)).toBe(0);
  expect((await cacheCounts(page)).keyed).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Reload', exact: true }).click(),
  ]);
  await expect(page.getByText(/Restored \d+ tracks from cache/)).toBeVisible();
  await acceptDisclaimer(page);
  expect((await cacheCounts(page)).keyed).toBeGreaterThanOrEqual(3);
});

test('A plain reload mid-pass keeps what was flushed, and a new run resumes', async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  await importTones(page, 27, 3);
  await expectCache(page, { blobs: 27 });
  // flushMs 5000 lets each debounced 2 s save land between flushes (1500 would starve it). Duty 0.01 keeps the pass
  // running across several flushes: at 0.05 it outlasted the first flush only while the dev build's App render was a
  // ~140 ms long task per progress update (v15.3); v15.4's per-region renders made the dev pass ~3× faster, and it
  // finished all 27 before the first flush (production is unchanged, ~0.85 s for this pass either way).
  await analyseTune(page, { flushMs: 5000, duty: 0.01 });
  await analyseButton(page).click();
  const K = await settledKeyed(page, async (keyed) => (await analyseRuns(page)) === 0 && keyed >= 3, 90_000);
  expect(K).toBeGreaterThanOrEqual(3);
  expect(await analyseRuns(page)).toBe(0);

  await page.reload();
  await expect(page.getByText(/Restored \d+ tracks from cache/)).toBeVisible();
  await acceptDisclaimer(page);
  const keyed = (await cacheCounts(page)).keyed;
  expect(keyed).toBeGreaterThanOrEqual(K);
  // A reload is not a crash: the page cleared the in-flight marker as it went (pagehide).
  expect(await page.evaluate((k) => localStorage.getItem(k), INFLIGHT_KEY)).toBeNull();
  await analyseButton(page).click();
  expect((await analyseState(page)).total).toBe(27 - keyed);
  expect((await analysePlan(page))?.crashSkipped).toBe(0);
  await expect(page.getByText(/Skipped \d+ tracks?/)).toHaveCount(0);
});

test('The pass does not hold other saves back, and saves about once per flush', async ({ page }) => {
  test.setTimeout(420_000);
  await openApp(page);
  await importTones(page, 27, 3);
  await expectCache(page, { blobs: 27 });
  await page.waitForTimeout(2500);
  const saves = countConsole(page, '[PlaylistCache] Meta+state saved');
  await analyseTune(page, { flushMs: 5000, duty: 0.05 });
  const saves0 = saves();
  await analyseButton(page).click();
  await doneAtLeast(page, 1);
  await pickFrequency(page, 528);
  await expect.poll(async () => (await savedState(page))?.selectedSolfeggio, { timeout: 5_000, intervals: [100, 250] }).toBe(528);
  expect(['running', 'holding']).toContain((await analyseState(page)).phase);
  await waitRuns(page, 1, 360_000);
  const runMs = (await analyseLast(page))!.ms;
  await page.waitForTimeout(2500); // the final flush's save
  expect(saves() - saves0).toBeLessThanOrEqual(Math.ceil(runMs / 5000) + 3);
});

test('Deep Scan and Analyse tracks never run together', async ({ page }) => {
  await openApp(page);
  await importTones(page, 27, 3);
  await expectCache(page, { blobs: 27 });
  await analyseTune(page, { duty: 0.02 });
  await analyseButton(page).click();
  await expect(deepScanButton(page)).toHaveAttribute('aria-disabled', 'true');
  await deepScanButton(page).dispatchEvent('click');
  await expect(page.getByText('Deep Scan is unavailable while Analyse tracks runs. Stop it first, or wait for it to finish.')).toBeVisible();
  for (let i = 0; i < 12; i++) {
    expect(await page.getByText(/Analyzing \d+%/).count()).toBe(0);
    await page.waitForTimeout(250);
  }

  await analyseButton(page).click(); // stop
  await phaseIs(page, 'idle', 5_000);
  await importTones(page, 2, 3, 'extra');
  await expectCache(page, { blobs: 29 });
  await deepScanButton(page).click();
  await expect(page.getByText(/Analyzing \d+%/)).toBeVisible();
  await expect(analyseButton(page)).toHaveAttribute('aria-disabled', 'true');
  const runs = await analyseRuns(page);
  await analyseButton(page).dispatchEvent('click');
  await expect(page.getByText('Analyse tracks is unavailable while Deep Scan runs.')).toBeVisible();
  await page.waitForTimeout(500);
  expect((await analyseState(page)).phase).toBe('idle');
  expect(await analyseRuns(page)).toBe(runs);
  await deepScanButton(page).click(); // cancel the scan
});

test('Gapless advances keep working while the pass runs, and no step starts or ends near a track end @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  // Four 25 s tracks to play through, then 23 fillers that are never played: 10 s long, so their analysis keeps
  // native steps starting through the played tracks' last 20 s (phone) / 10 s (desktop) — 3 s fillers left the
  // queue empty by then on desktop, where the margin could not be told apart from no margin at all.
  const files = Array.from({ length: 27 }, (_, i) => ({
    name: `tone-${String(i + 1).padStart(2, '0')}.wav`,
    mimeType: 'audio/wav',
    buffer: toneWav(i < 4 ? 25 : 10, 220 + i * 37),
  }));
  await addFiles(page, files);
  await autoDistribute(page);
  await expectCache(page, { blobs: 27, analysed: 27 });
  await page.getByText('tone-01', { exact: true }).click();
  const title = page.getByTestId('now-playing-title');
  await expect(title).toHaveText('tone-01');
  const pauses0 = await pauseCount(page);
  const mobile = await analyseMobile(page);
  // A low duty keeps the queue running into tone-01's last 20 s (phone) / 10 s (desktop), so the margins are
  // actually exercised (the 3 s tones are only milliseconds of work each); not so low that the pass sleeps through
  // that window between two gates. Desktop 0.02: at 0.05 the queue reached that window only while the dev build's
  // App render was a ~140 ms long task per progress update (v15.3); v15.4's per-region renders made the dev pass ~3×
  // faster (production is unchanged).
  await analyseTune(page, { duty: mobile ? 0.05 : 0.02 });
  await analyseButton(page).click();
  await expect(title).toHaveText('tone-02', { timeout: 40_000 });
  await expect(title).toHaveText('tone-03', { timeout: 40_000 });
  await expect(title).toHaveText('tone-04', { timeout: 40_000 });

  expect(await pauseCount(page)).toBe(pauses0);
  expect(await page.evaluate(() => (window as any).__audio.musicEnded as number)).toBe(0);
  const M = mobile ? 20 : 10;
  const log = await analyseLog(page);
  const natives = log.filter(isNative);
  expect(natives.length).toBeGreaterThan(0);
  expect(natives.filter((r) => !(r.left === null || r.left > M))).toEqual([]);
  expect(natives.filter((r) => !(r.into === null || r.into >= 2))).toEqual([]);
  expect(natives.filter((r) => !(r.leftEnd === null || r.leftEnd > 5))).toEqual([]);
  expect(log.filter((r) => r.kind === 'slice' && !(r.left === null || r.left > 5))).toEqual([]);
  expect(log.filter((r) => r.kind === 'flush' && !(r.leftEnd === null || r.leftEnd > 5))).toEqual([]);
  const s = await analyseState(page);
  expect(s.done > 0 || (await analyseRuns(page)) >= 1).toBe(true);
  // The queue was still running near a track's end: the pass held for it.
  expect((await analysePhases(page)).some((p) => p.phase === 'holding' && p.hold === 'end')).toBe(true);
  expect(dialogs).toEqual([]);
});

test('On a phone the pass parks while the page is hidden and goes on when shown; on desktop it keeps going @mobile', async ({ page }) => {
  await controllableVisibility(page);
  await openApp(page);
  await importTones(page, 27, 3);
  await expectCache(page, { blobs: 27 });
  await analyseTune(page, { duty: 0.05 });
  const mobile = await analyseMobile(page);
  await analyseButton(page).click();
  await doneAtLeast(page, 1);
  const hideT = await page.evaluate(() => { (window as any).__setHidden(true); return performance.now(); });
  if (mobile) {
    await phaseIs(page, 'parked');
    const parkT = (await analysePhases(page)).find((p) => p.phase === 'parked' && p.t >= hideT)!.t;
    const done0 = (await analyseState(page)).done;
    await page.waitForTimeout(6000);
    const log = await analyseLog(page);
    // One native step in flight at the hide may complete; nothing starts after the park.
    expect(log.filter((r) => isNative(r) && r.at > parkT && r.at < parkT + 6000)).toEqual([]);
    const inFlight = log.filter((r) => isNative(r) && r.at <= parkT && r.at + r.ms > hideT).map((r) => r.id);
    // Its result is never applied (the track is redone after the show).
    expect(log.filter((r) => r.kind === 'flush' && r.at > hideT && r.ids?.some((id) => inFlight.includes(id)))).toEqual([]);
    expect((await analyseState(page)).done).toBe(done0);
    await page.evaluate(() => (window as any).__setHidden(false));
    await expect.poll(async () => (await analyseState(page)).done, { timeout: 15_000 }).toBeGreaterThan(done0);
  } else {
    const done0 = (await analyseState(page)).done;
    await expect.poll(async () => (await analyseState(page)).done, { timeout: 15_000 }).toBeGreaterThan(done0);
    expect((await analyseLog(page)).some((r) => isNative(r) && r.at > hideT + 50)).toBe(true);
    expect((await analyseState(page)).phase).not.toBe('parked');
    await page.evaluate(() => (window as any).__setHidden(false));
  }
});

test('An unreadable file is marked after three tries, and the button offers a retry', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [{ name: 'broken.wav', mimeType: 'audio/wav', buffer: brokenWav(1) }]);
  await importTones(page, 1, 3);
  await expectCache(page, { blobs: 2 });
  await analyseButton(page).click();
  await waitRuns(page, 1);
  const broken = async () => (await metaRecords(page)).find((m) => m.name === 'broken');
  await expect.poll(async () => (await broken())?.analysisFailedV ?? null, { timeout: 15_000 }).toBe(1);
  await expect(analyseButton(page)).toContainText("1 couldn't be read · tap to try again");

  await analyseButton(page).click();
  // The retry's plan, read once the run is over: a one-track run can finish before a slow phone reads its state.
  await waitRuns(page, 2);
  expect(await analysePlan(page)).toMatchObject({ total: 1, retry: true });
  expect((await analyseLast(page))?.failed).toBe(1);
  await page.waitForTimeout(2500);
  expect((await broken())?.analysisFailedV).toBe(1);
});

test('When no track can be read, nothing is marked', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [1, 2, 3].map((i) => ({ name: `broken-${i}.wav`, mimeType: 'audio/wav', buffer: brokenWav(i) })));
  await expectCache(page, { blobs: 3 });
  await analyseButton(page).click();
  await waitRuns(page, 1);
  expect(await analyseLast(page)).toMatchObject({ outcome: 'error', reason: 'unreadable' });
  await expect(page.getByText(/no track could be read/)).toBeVisible();
  await page.waitForTimeout(3000);
  expect((await cacheCounts(page)).failedMarks).toBe(0);
  await expect(analyseButton(page)).toContainText('3 to analyse · ');
});

test('Deep Scan stores key data on desktop only, leaves the pass\'s fields alone, and never re-decodes for a key it has @mobile', async ({ page }) => {
  test.setTimeout(300_000);
  await countKeyDecodes(page);
  await openApp(page);
  const mobile = await analyseMobile(page);
  // (a) Deep Scan alone: its key step runs on desktop only (D10).
  await importTones(page, 2, 3);
  await expectCache(page, { blobs: 2 });
  await deepScanButton(page).click();
  await expectCache(page, { analysed: 2 }, 90_000);
  if (!mobile) {
    await expectCache(page, { keyed: 2 });
  } else {
    expect((await cacheCounts(page)).keyed).toBe(0);
    await page.waitForTimeout(3000);
    expect((await cacheCounts(page)).keyed).toBe(0);
  }

  // (b) The pass, then Deep Scan over tracks the pass analysed.
  await importTones(page, 2, 3, 'more');
  await expectCache(page, { blobs: 4 });
  const runs = await analyseRuns(page);
  await analyseButton(page).click();
  await waitRuns(page, runs + 1);
  await expectCache(page, { keyed: 4, envVisual: 2 });
  const recsB = await metaRecords(page);
  expect(recsB.filter((m) => m.envVisual > 0).map((m) => m.name).sort()).toEqual(['more-01', 'more-02']);
  const decodes0 = await page.evaluate(() => (window as any).__keyDecodes as number);
  await deepScanButton(page).click();
  await expectCache(page, { analysed: 4 }, 90_000);
  const recs = await metaRecords(page);
  for (const name of ['more-01', 'more-02']) {
    const m = recs.find((r) => r.name === name)!;
    const before = recsB.find((r) => r.name === name)!;
    expect(m.envVisual, `${name} keeps its visual envelope`).toBeGreaterThan(0);
    expect([m.chromaVersion, m.musicKey, m.chromaA4Hz, m.keyConfidence, m.chroma], `${name} keeps its key data`)
      .toEqual([before.chromaVersion, before.musicKey, before.chromaA4Hz, before.keyConfidence, before.chroma]);
    expect(m.harmonicFreq, `${name} is now Deep-Scanned`).not.toBeNull();
    expect(m.envScan, `${name} has Deep Scan's envelope`).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => (window as any).__keyDecodes as number)).toBe(decodes0);
});

test("Deep Scan's key step yields through messages, never timers, which a hidden, silent desktop tab throttles", async ({ page }) => {
  test.setTimeout(180_000);
  await countKeyDecodes(page);
  await recordKeyYields(page);
  await openApp(page);
  test.skip(await analyseMobile(page), "Deep Scan's key step runs on desktop only");
  // Stereo and 40 s: the 22050 Hz downmix runs in 4 slices of 262,144 samples, so the key step yields at least 3
  // times however fast this machine is (a mono file skips the downmix).
  await addFiles(page, [{ name: 'stereo.wav', mimeType: 'audio/wav', buffer: stereoToneWav(40, 330) }]);
  await expectCache(page, { blobs: 1 });
  await deepScanButton(page).click();
  await expectCache(page, { analysed: 1, keyed: 1 }, 120_000);
  expect(await page.evaluate(() => (window as any).__keyDecodes as number)).toBe(1);
  const y: { timers: number; messages: number; timerStacks: string[] } = await page.evaluate(() => (window as any).__keyYields);
  expect(y.timers, `timers set inside the key analysis:\n${y.timerStacks.join('\n\n')}`).toBe(0);
  expect(y.messages, 'message yields inside the key analysis').toBeGreaterThanOrEqual(3);
});

test('The pass never starts a decode while a track without a crystal is starting @mobile', async ({ page }) => {
  await recordLiveDecodes(page);
  await openApp(page);
  await importTones(page, 6, 20);
  await expectCache(page, { blobs: 6, meta: 6 });
  const tone6 = (await metaRecords(page)).find((m) => m.name === 'tone-06')!.id;
  await analyseTune(page, { duty: 0.05 });
  await analyseButton(page).click();
  await doneAtLeast(page, 1);
  await page.evaluate(() => { (window as any).__slowLiveDecode = true; });
  await page.getByText('tone-06', { exact: true }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('tone-06', { timeout: 20_000 });
  await expect.poll(async () => (await analysePlaying(page))?.id ?? null, { timeout: 10_000 }).toBe(tone6);
  const live: { start: number; end: number }[] = await page.evaluate(() => (window as any).__liveDecodes);
  const done = live.filter((d) => d.end > 0);
  expect(done.length).toBeGreaterThanOrEqual(1);
  const end = Math.max(...done.map((d) => d.end));
  await expect.poll(async () => (await analyseLog(page)).some((r) => r.kind === 'decode' && r.at > end), { timeout: 30_000 }).toBe(true);
  const log = await analyseLog(page);
  const inside = log.filter((r) => isNative(r) && done.some((d) => r.at > d.start + 50 && r.at < d.end));
  expect(inside).toEqual([]);
  expect(log.filter((r) => isNative(r) && r.at > end).length).toBeGreaterThan(0);
  // The playing track jumped to the front of the queue: of the tracks not yet started when the live decode began,
  // tone-06 is decoded first. (A track whose file read was already under way then finishes first: its decode
  // waited at the gate, and may land just after the hold.)
  const liveStart = Math.min(...done.map((d) => d.start));
  const started = new Set(log.filter((r) => r.kind === 'read' && r.at < liveStart).map((r) => r.id));
  expect(log.find((r) => r.kind === 'decode' && r.at > end && !started.has(r.id))?.id).toBe(tone6);
});

test('A track the app closed on last time is skipped and marked', async ({ page }) => {
  await openApp(page);
  await importTones(page, 3, 3);
  await expectCache(page, { blobs: 3, meta: 3 });
  const recs = await metaRecords(page);
  const id2 = recs.find((m) => m.name === 'tone-02')!.id;
  await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: INFLIGHT_KEY, v: `1:${id2}` });
  await analyseTune(page, { duty: 0.05 });
  await analyseButton(page).click();
  await expect(page.getByText(/Skipped 1 track/)).toBeVisible();
  expect((await analyseState(page)).total).toBe(2);
  expect((await analysePlan(page))?.crashSkipped).toBe(1);
  await waitRuns(page, 1);
  expect((await analyseLast(page))?.crashSkipped).toBe(1);
  await expect.poll(async () => (await metaRecords(page)).filter((m) => m.chromaVersion === 1).length, { timeout: 15_000 }).toBe(2);
  const after = await metaRecords(page);
  const t2 = after.find((m) => m.id === id2)!;
  expect(t2.analysisFailedV).toBe(1);
  expect(t2.chromaVersion).toBeNull();
  expect(after.filter((m) => m.id !== id2).every((m) => m.chromaVersion === 1)).toBe(true);
  expect(await page.evaluate((k) => localStorage.getItem(k), INFLIGHT_KEY)).toBeNull();
});

test('A pass over real-length MP3s keeps the main thread free @perf', async ({ page }) => {
  const dir = process.env.E2E_ANALYSE_MP3_DIR;
  test.skip(!dir, 'set E2E_ANALYSE_MP3_DIR to a folder holding ref-01.mp3 … ref-10.mp3');
  test.setTimeout(20 * 60_000);
  await page.addInitScript(() => {
    const w = window as any;
    w.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__longTasks.push({ t: e.startTime, d: e.duration });
      }).observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
    } catch {
      // Long-task timing is Chromium-only.
    }
  });
  await openApp(page);
  const names = Array.from({ length: 10 }, (_, i) => `ref-${String(i + 1).padStart(2, '0')}`);
  await page.getByLabel('Add files').setInputFiles(names.map((n) => join(dir!, `${n}.mp3`)));
  await expectCache(page, { blobs: 10 }, 120_000);
  await expect.poll(async () => (await metaRecords(page)).filter((m) => (m.duration ?? 0) > 0).length, { timeout: 120_000 }).toBe(10);
  await page.getByText('ref-01', { exact: true }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('ref-01', { timeout: 30_000 });
  // Report only: the long tasks of the app itself playing, before the pass (the dev build's own rendering).
  const b0 = await page.evaluate(() => performance.now());
  await page.waitForTimeout(15_000);
  const t0 = await page.evaluate(() => performance.now());
  await analyseButton(page).click();
  await waitRuns(page, 1, 15 * 60_000);
  const t1 = await page.evaluate(() => performance.now());
  const log = await analyseLog(page);
  const recs = await metaRecords(page);
  const longTasks: { t: number; d: number }[] = await page.evaluate(() => (window as any).__longTasks);
  const during = longTasks.filter((x) => x.t >= t0 && x.t <= t1);
  const before = longTasks.filter((x) => x.t >= b0 && x.t < t0);
  const baseline = { seconds: +((t0 - b0) / 1000).toFixed(1), longTasks: before.length, over100: before.filter((x) => x.d > 100).length, perSecond: +(before.length / ((t0 - b0) / 1000)).toFixed(2) };

  const perTrack = recs.map((m, i) => {
    const mins = (m.duration ?? 0) / 60;
    const of = (k: AnalyseStep['kind']) => log.filter((r) => r.id === m.id && r.kind === k);
    const sum = (rs: AnalyseStep[]) => rs.reduce((a, r) => a + r.ms, 0);
    return {
      index: i, minutes: +mins.toFixed(2),
      decodePerMin: +(sum(of('decode')) / mins).toFixed(1),
      envelopePerMin: +(sum(of('envelope')) / mins).toFixed(1),
      slicesPerMin: +(sum(of('slice')) / mins).toFixed(1),
      maxSlice: +Math.max(0, ...of('slice').map((r) => r.ms)).toFixed(1),
    };
  });
  const report = { last: await analyseLast(page), runMs: t1 - t0, baselineBeforeThePass: baseline, longTasksPerSecond: +(during.length / ((t1 - t0) / 1000)).toFixed(2), longTasks: during, perTrack };
  if (process.env.E2E_ANALYSE_PERF_OUT) writeFileSync(process.env.E2E_ANALYSE_PERF_OUT, JSON.stringify(report, null, 2));
  test.info().annotations.push({ type: 'perf', description: JSON.stringify(report) });

  expect(report.last).toMatchObject({ outcome: 'finished', analysed: 10 });
  expect(log.filter((r) => r.kind === 'slice' && r.ms > 20)).toEqual([]);
  expect(during.filter((x) => x.d > 100)).toEqual([]);
  expect(during.length).toBeLessThanOrEqual(10);
  for (const t of perTrack) {
    expect(t.decodePerMin, `#${t.index} decode ms per audio minute`).toBeLessThanOrEqual(1.5 * 140);
    expect(t.envelopePerMin, `#${t.index} envelope ms per audio minute`).toBeLessThanOrEqual(1.5 * 128);
    expect(t.slicesPerMin, `#${t.index} slice ms per audio minute`).toBeLessThanOrEqual(1.5 * 49);
  }
});
