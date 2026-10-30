import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  PHONE_VIEWPORT,
  crash,
  drawsPerSecond,
  instrumentAudio,
  libraryState,
  layerState,
  pauseCount,
  recordHudDraws,
  renders,
  resetRenders,
  tab,
} from './helpers';
import { DRAWING, MUSIC_ONLY_KEY, PAUSED_KEY, moreRow, openMorePage, playingSeeded, smallTargets, unnamedControls } from './moreKit';
import { caughtDownloads, revoked, stubDownloads, wavInfo } from './downloads';

// v16.5, Record and the REC pill (v16.4 spec §3.8, §5.3 record.spec; decisions 3 A and 4 A). The Record sheet in its
// states, starting from More, the REC pill on every tab (a tap opens Record; the Car screen's stops), Stop and save,
// the recording across a gapless track change (decision 3 A: the music is still there after the first track, in BOTH
// layouts: R4 in the new layout, R4c in classic), video unavailable, Pause visuals, renders, About's Reload guard.
// Every file is caught in the page (downloads.ts), so nothing is saved: on a phone too. Runs against the dev server.

/** What follows the 4 Hz clock anyway (layout.spec 7): App itself and the time readers. */
const CLOCK_READERS = ['App', 'SeekBar', 'TimeText', 'MiniProgress'];

const recordSheet = (page: Page) => page.getByRole('dialog', { name: 'Record', exact: true }).or(page.getByRole('region', { name: 'Record', exact: true }));

/** More › Record. */
async function openRecordFromMore(page: Page): Promise<void> {
  await tab(page, 'more');
  await page.getByTestId('more').waitFor();
  if ((await page.getByTestId('more').getAttribute('data-more-view')) !== 'root') await tab(page, 'more');
  await moreRow(page, 'more-record-row').click();
  await expect(recordSheet(page)).toBeVisible();
}

/** A recording runs (App's isRecording, through the REC pill or the card), and its kind. */
async function expectRecording(page: Page): Promise<void> {
  await expect(page.getByTestId('rec-open').or(page.getByTestId('rec-stop')).first()).toBeVisible({ timeout: 10_000 });
}

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('R1. not ready: before anything has played, Record shows the three options off and why; opening it makes no AudioContext', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      const w = window as any;
      w.__ctxMade = 0;
      const A = window.AudioContext;
      (window as any).AudioContext = class extends A {
        constructor(...args: any[]) {
          super(...args);
          w.__ctxMade++;
        }
      };
    });
    const { openSeededNewLayout } = await import('./helpers');
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 8 });
    await page.setViewportSize(PHONE_VIEWPORT);
    const before = await page.evaluate(() => (window as any).__ctxMade);
    await openRecordFromMore(page);
    const sheet = recordSheet(page);
    await expect(sheet.getByTestId('record-not-ready')).toHaveText('Play something first: a recording starts from what is playing.');
    await expect(sheet.getByText('Choose a recording mode. Audio-only is recommended for long sessions to prevent crashes.', { exact: true })).toBeVisible();
    for (const k of ['audio', 'video', 'both']) await expect(sheet.getByTestId(`record-option-${k}`)).toBeDisabled();
    await expect(sheet.getByTestId('record-option-audio')).toContainText('Audio Only');
    await expect(sheet.getByTestId('record-option-video')).toContainText('Visuals Only');
    await expect(sheet.getByTestId('record-option-both')).toContainText('AV Mix');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__ctxMade), 'opening Record made no AudioContext').toBe(before);
    expect(await unnamedControls(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    expect(dialogs).toEqual([]);
  });

  test('R2. Audio Only from More: REC in the top bar, and on the mini-player of Library, Mixes, Layers and More; the More card reads Recording @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await stubDownloads(page);
    const dialogs = await playingSeeded(page, 3);
    await openRecordFromMore(page);
    const sheet = recordSheet(page);
    await expect(sheet.getByTestId('record-not-ready')).toHaveCount(0);
    await sheet.getByTestId('record-option-audio').click();
    await expect(sheet.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByTestId('record-kind')).toHaveText('Audio Only · a 24-bit WAV file');
    await expect(sheet.getByRole('heading', { name: 'Record' })).toBeVisible();
    await page.keyboard.press('Escape');
    for (const t of ['library', 'mixes', 'layers', 'more'] as const) {
      await tab(page, t);
      await expect(page.getByTestId('mini-player').getByTestId('rec-open'), `REC on the mini-player (${t})`).toBeVisible();
    }
    const card = page.getByTestId('more-recording-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/^Recording · \d+:\d\d/);
    await expect(card).toContainText('Audio Only · saved to your downloads when you stop');
    await expect(moreRow(page, 'more-record-row')).toContainText(/Recording · \d+:\d\d/);
    await tab(page, 'now');
    await expect(page.getByTestId('new-top-bar').getByTestId('rec-open')).toBeVisible();
    await expect(page.getByTestId('mini-player')).toHaveCount(0);
    // The More card's Stop and save stops at once and saves one WAV.
    await tab(page, 'more');
    await page.getByTestId('more-stop-recording').click();
    const files = await caughtDownloads(page, 1);
    expect(files.map((f) => f.name)[0]).toMatch(/^aetheria-rec-audio-\d+Hz-24bit-\d+\.wav$/);
    await expect(page.getByTestId('rec-open')).toHaveCount(0);
    await expect(page.getByTestId('notices')).toContainText('Saved to your downloads.');
    expect(dialogs).toEqual([]);
  });

  test('R3. the pill (decision 4 A): a mini-player REC tap opens Record, its time runs; Stop and save saves one WAV with the toast; the Car screen keeps its one-tap stop @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await playingSeeded(page, 3);
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expectRecording(page);
    await page.keyboard.press('Escape');
    await tab(page, 'library');
    const pill = page.getByTestId('mini-player').getByTestId('rec-open');
    await expect(pill).toHaveAccessibleName('Rec, recording. Open Record');
    await pill.click();
    const sheet = recordSheet(page);
    await expect(sheet.getByTestId('record-recording'), 'a tap opens Record (it does not stop)').toBeVisible();
    await expect(pill).toBeVisible();
    const t0 = await sheet.getByTestId('record-elapsed').textContent();
    await page.waitForTimeout(2000);
    const t1 = await sheet.getByTestId('record-elapsed').textContent();
    const secs = (s: string | null) => { const [m, x] = (s ?? '0:00').split(':').map(Number); return m * 60 + x; };
    expect(secs(t1) - secs(t0), 'the elapsed time runs (2 ± 1 s in 2 s)').toBeGreaterThanOrEqual(1);
    expect(secs(t1) - secs(t0)).toBeLessThanOrEqual(3);
    await sheet.getByTestId('record-stop-save').click();
    const files = await caughtDownloads(page, 1);
    expect(files).toHaveLength(1);
    expect(files[0].name.endsWith('.wav')).toBe(true);
    expect(files[0].size ?? 0).toBeGreaterThan(44);
    await expect(page.getByTestId('notices')).toContainText('Saved to your downloads.');
    await expect(page.getByTestId('rec-open')).toHaveCount(0);
    await expect(sheet, 'Stop and save closes Record').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('R3b. the Car screen keeps the one-tap stop: its REC stops the recording at once and saves', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const { openSeededNewLayout, libraryRowButton, openLibraryTab } = await import('./helpers');
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    // Output = Car (the seeding answers Headphones on the first load only), then the app again.
    await page.evaluate(() => localStorage.setItem('aetheria.layerOutput.v1', 'car'));
    await page.reload();
    await page.getByTestId('new-shell').waitFor();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(3);
    await page.setViewportSize(PHONE_VIEWPORT);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await tab(page, 'now');
    const car = page.getByTestId('view-car');
    await expect(car).toBeVisible();
    const rec = car.getByTestId('rec-stop');
    await expect(rec).toHaveAccessibleName('Rec, stop recording');
    await rec.click();
    await expect(page.getByTestId('rec-stop')).toHaveCount(0);
    const files = await caughtDownloads(page, 1);
    expect(files[0].name.endsWith('.wav')).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('R4. a recording across a gapless track change keeps the music (decision 3 A): Music only, 8 s tones, from 1 s into tone-0001 to 4 s into tone-0002 @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    await page.addInitScript((k) => localStorage.setItem(k, 'true'), MUSIC_ONLY_KEY);
    await instrumentAudio(page);
    const dialogs = await playingSeeded(page, 3, { seconds: 8 });
    await expect.poll(async () => (await libraryState(page)).t ?? 0, { timeout: 15_000 }).toBeGreaterThan(1);
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    const pauses = await pauseCount(page);
    await expect
      .poll(async () => { const s = await libraryState(page); return s.current === 'tone-0002' && (s.t ?? 0) > 4; }, { timeout: 30_000, message: 'tone-0002, 4 s in' })
      .toBe(true);
    expect(await pauseCount(page), 'a gapless advance, no pause()').toBe(pauses);
    await recordSheet(page).getByTestId('record-stop-save').click();
    await caughtDownloads(page, 1);
    const w = await wavInfo(page, 0, { win: 0.5, tail: 2, head: 4 });
    test.info().annotations.push({ type: 'R4 RMS per 0.5 s', description: w.rms.map((x) => x.toFixed(3)).join(' ') });
    expect(w.bits).toBe(24);
    expect(w.channels).toBe(2);
    expect(w.seconds, 'about 11 s recorded').toBeGreaterThan(8);
    expect(w.headRms, 'the first track is in the file').toBeGreaterThan(0.05);
    expect(w.tailRms, 'the music after the track change: RMS of the last 2 s').toBeGreaterThan(0.05);
    expect(w.tailRms, '…at least half the first track’s').toBeGreaterThanOrEqual(0.5 * w.headRms);
    expect(w.tailRms, '…never doubled (one live source at a time)').toBeLessThanOrEqual(1.5 * w.headRms);
    expect((await layerState(page)).music?.paused, 'the music plays on').toBe(false);
    expect(dialogs).toEqual([]);
  });

  test('R4c. the same in the classic layout: its Record dialog, across a gapless track change, keeps the music @mobile', async ({ page }) => {
    // Classic's own Record path (the header's Record, Audio Only, REC): the negative control runs this one on the
    // previous release's build, where the second track records as silence.
    test.setTimeout(150_000);
    await stubDownloads(page);
    await page.addInitScript((k) => localStorage.setItem(k, 'true'), MUSIC_ONLY_KEY);
    const dialogs = await playingSeeded(page, 3, { seconds: 8 });
    await tab(page, 'now');
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-back-to-classic').click();
    const record = page.getByRole('button', { name: 'Record', exact: true });
    await record.waitFor({ timeout: 10_000 });
    await expect.poll(async () => { const s = await libraryState(page); return s.current === 'tone-0001' && (s.t ?? 0) > 1; }, { timeout: 15_000 }).toBe(true);
    await record.click();
    await page.getByRole('button', { name: /Audio Only/ }).click();
    const rec = page.getByText('REC', { exact: true });
    await rec.waitFor({ timeout: 10_000 });
    await expect
      .poll(async () => { const s = await libraryState(page); return s.current === 'tone-0002' && (s.t ?? 0) > 4; }, { timeout: 30_000, message: 'tone-0002, 4 s in' })
      .toBe(true);
    await rec.click();
    await caughtDownloads(page, 1);
    const w = await wavInfo(page, 0, { win: 0.5, tail: 2, head: 4 });
    test.info().annotations.push({ type: 'R4c RMS per 0.5 s', description: w.rms.map((x) => x.toFixed(3)).join(' ') });
    expect(w.headRms, 'the first track is in the file').toBeGreaterThan(0.05);
    expect(w.tailRms, 'the music after the track change (classic)').toBeGreaterThan(0.05);
    expect(w.tailRms).toBeGreaterThanOrEqual(0.5 * w.headRms);
    expect(dialogs).toEqual([]);
  });

  test('R5. video unavailable (no MediaRecorder): Visuals Only and AV Mix are off with their line; Audio Only works', async ({ page }) => {
    test.setTimeout(120_000);
    await stubDownloads(page);
    await page.addInitScript(() => {
      delete (window as any).MediaRecorder;
    });
    const dialogs = await playingSeeded(page, 3);
    await openRecordFromMore(page);
    const sheet = recordSheet(page);
    await expect(sheet.getByTestId('record-no-video')).toHaveText("This browser can't record video.");
    await expect(sheet.getByTestId('record-option-video')).toBeDisabled();
    await expect(sheet.getByTestId('record-option-both')).toBeDisabled();
    await expect(sheet.getByTestId('record-option-audio')).toBeEnabled();
    await sheet.getByTestId('record-option-audio').click();
    await expect(sheet.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await sheet.getByTestId('record-stop-save').click();
    expect((await caughtDownloads(page, 1))[0].name.endsWith('.wav')).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('R6. Pause visuals on: an AV Mix recording runs the visuals and they pause again after; an Audio Only one keeps them paused', async ({ page }) => {
    test.skip(ON_DEVICE, 'the HUD rates are the desktop’s dev-server rates');
    test.setTimeout(180_000);
    await stubDownloads(page);
    await recordHudDraws(page);
    await page.addInitScript((k) => localStorage.setItem(k, 'true'), PAUSED_KEY);
    const dialogs = await playingSeeded(page, 3);
    const canVideo = await page.evaluate(() => typeof MediaRecorder === 'function' && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function');
    test.skip(!canVideo, 'MediaRecorder or canvas.captureStream is not available here');
    await tab(page, 'now');
    expect(Math.max(...(await drawsPerSecond(page, 2))), 'paused before').toBe(0);
    await openRecordFromMore(page);
    await expect(recordSheet(page).getByTestId('record-visuals-note')).toHaveText('The visuals run while a visual recording runs.');
    await recordSheet(page).getByTestId('record-option-both').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await tab(page, 'now');
    expect(Math.min(...(await drawsPerSecond(page, 2))), 'AV Mix: the visuals run').toBeGreaterThanOrEqual(DRAWING);
    await tab(page, 'more');
    await page.getByTestId('more-stop-recording').click();
    await caughtDownloads(page, 1);
    await tab(page, 'now');
    await drawsPerSecond(page, 1);
    expect(Math.max(...(await drawsPerSecond(page, 2))), 'paused again after').toBe(0);
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await tab(page, 'now');
    expect(Math.max(...(await drawsPerSecond(page, 2))), 'Audio Only: still paused').toBe(0);
    await tab(page, 'more');
    await page.getByTestId('more-stop-recording').click();
    await caughtDownloads(page, 2);
    expect(dialogs).toEqual([]);
  });

  test('R7. renders while recording (DEV): with the sheet open only RecordElapsed renders, at most 4 in 3 s; on the More root likewise', async ({ page }) => {
    // Dev builds run React's StrictMode, which renders each component twice: one render is 2 counts.
    test.setTimeout(120_000);
    await stubDownloads(page);
    const dialogs = await playingSeeded(page, 3);
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    // Over Now Playing (no mini-player, no More root behind it): the sheet's own leaf is the only one.
    await tab(page, 'now');
    await page.getByTestId('new-top-bar').getByTestId('rec-open').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible();
    expect(await page.locator('[data-record-elapsed]').count()).toBe(1);
    await page.waitForTimeout(500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const r = await renders(page);
    const others = Object.entries(r).filter(([k, n]) => k !== 'RecordElapsed' && !CLOCK_READERS.includes(k) && n > 0);
    expect(r.RecordElapsed ?? 0, 'RecordElapsed ticks (about 3 renders)').toBeGreaterThanOrEqual(4);
    expect(r.RecordElapsed ?? 0, 'at most 4 renders in 3 s').toBeLessThanOrEqual(8);
    expect(others, 'nothing else renders with the sheet open').toEqual([]);
    await page.keyboard.press('Escape');
    await tab(page, 'more');
    // The More root: two leaves (the card's and the Record row's).
    expect(await page.locator('[data-record-elapsed]').count()).toBe(2);
    await page.waitForTimeout(500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const m = await renders(page);
    const moreOthers = Object.entries(m).filter(([k, n]) => k !== 'RecordElapsed' && !CLOCK_READERS.includes(k) && n > 0);
    expect(m.RecordElapsed ?? 0, 'two leaves, each at most 4 renders').toBeLessThanOrEqual(16);
    expect(moreOthers, 'on the More root only the elapsed leaves (and the mini-player’s progress) render').toEqual([]);
    await page.getByTestId('more-stop-recording').click();
    await caughtDownloads(page, 1);
    expect(dialogs).toEqual([]);
  });

  test('R8. while recording, About’s Reload is off with its line', async ({ page }) => {
    test.setTimeout(120_000);
    await stubDownloads(page);
    const dialogs = await playingSeeded(page, 3);
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    await openMorePage(page, 'about');
    const reload = page.getByTestId('more-about').getByRole('button', { name: 'Reload', exact: true });
    await expect(reload).toBeDisabled();
    await expect(page.getByTestId('more-about')).toContainText('Stop the recording first: reloading would lose it.');
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await page.getByTestId('more-stop-recording').click();
    await caughtDownloads(page, 1);
    await openMorePage(page, 'about');
    await expect(page.getByTestId('more-about').getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
    expect(dialogs).toEqual([]);
  });

  test('R9. the saved recording’s download URL is revoked (it stayed in memory until a reload before v16.5)', async ({ page }) => {
    test.setTimeout(120_000);
    await stubDownloads(page);
    // A minute is too long to wait: the timer's delay is shortened in the page (only for a revoke's 60 s).
    await page.addInitScript(() => {
      const st = window.setTimeout;
      (window as any).setTimeout = function (fn: TimerHandler, ms?: number, ...rest: unknown[]) {
        return st(fn, ms === 60_000 ? 300 : ms, ...(rest as []));
      };
    });
    const dialogs = await playingSeeded(page, 3);
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    await recordSheet(page).getByTestId('record-stop-save').click();
    await caughtDownloads(page, 1);
    await expect.poll(async () => (await revoked(page, 0)).mine, { timeout: 5_000, message: 'the recording’s URL is revoked' }).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('R10. crash drill (DEV): the Record sheet’s body falls back inside the sheet; Close works; the music plays on', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page, 3);
    await openRecordFromMore(page);
    const p0 = await pauseCount(page);
    await crash(page, 'sheet-record');
    await expect(recordSheet(page).getByText('This sheet hit a problem.')).toBeVisible();
    const t0 = (await libraryState(page)).t ?? 0;
    await page.waitForTimeout(2000);
    expect(((await libraryState(page)).t ?? 0) - t0, 'the music moved on').toBeGreaterThanOrEqual(1.5);
    expect(await pauseCount(page)).toBe(p0);
    await recordSheet(page).getByRole('button', { name: 'Close', exact: true }).first().click();
    await expect(recordSheet(page)).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

// v16.5 review (A1–A5): the recording path's gaps. Each test is a mutation's oracle: a double tap is one capture (A1);
// an Audio Only recording keeps the heat guard, a visual one doesn't (A2); the music is followed when it starts after
// the recording and through the playback-error recovery's new element (A3), and in a second recording of the session;
// a failed AV Mix start leaves no music tap behind (A4); the ⋯ menu's rows stay put and Stop and save never lands on an
// option (A5).

/** Count the WAV capture worklets (Audio Only's) and the messages each one posts; optionally slow the worklet's load. */
async function instrumentCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__wavNodes = [];
    w.__slowWorkletMs = 0;
    const Orig = (window as any).AudioWorkletNode;
    if (Orig) {
      (window as any).AudioWorkletNode = class extends Orig {
        constructor(ctx: any, name: string, opts: any) {
          super(ctx, name, opts);
          if (name === 'wav-capture') {
            const rec = { msgs: 0 };
            w.__wavNodes.push(rec);
            this.port.addEventListener('message', () => {
              rec.msgs++;
            });
          }
        }
      };
    }
    const add = (window as any).AudioWorklet?.prototype?.addModule;
    if (add) {
      (window as any).AudioWorklet.prototype.addModule = function (this: unknown, ...a: unknown[]) {
        const p = add.apply(this, a);
        return w.__slowWorkletMs ? p.then((v: unknown) => new Promise((r) => setTimeout(() => r(v), w.__slowWorkletMs))) : p;
      };
    }
    // The music taps: every MediaStreamAudioSourceNode the app makes, and whether it is connected now.
    w.__taps = [];
    const make = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (this: AudioContext, s: MediaStream) {
      const n = make.call(this, s);
      const rec = { live: false };
      w.__taps.push(rec);
      const c = n.connect.bind(n) as (...a: unknown[]) => unknown;
      const d = n.disconnect.bind(n) as (...a: unknown[]) => unknown;
      (n as any).connect = (...a: unknown[]) => {
        rec.live = true;
        return c(...a);
      };
      (n as any).disconnect = (...a: unknown[]) => {
        rec.live = false;
        return d(...a);
      };
      return n;
    };
    // A MediaRecorder that throws while __mrThrow is set (AV Mix's start failing).
    const MR = (window as any).MediaRecorder;
    if (MR) {
      (window as any).MediaRecorder = class extends MR {
        constructor(s: MediaStream, o?: unknown) {
          if (w.__mrThrow) throw new DOMException('refused', 'NotSupportedError');
          super(s, o);
        }
      };
    }
  });
}
const liveTaps = (page: Page) => page.evaluate(() => ((window as any).__taps as Array<{ live: boolean }>).filter((t) => t.live).length);
const wavMsgs = (page: Page) => page.evaluate(() => ((window as any).__wavNodes as Array<{ msgs: number }>).map((n) => n.msgs));

test.describe('phone, review', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('R12. a double tap on Audio Only starts ONE capture, and Stop leaves none running; while it starts the three options are off (A1)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    await instrumentCapture(page);
    const dialogs = await playingSeeded(page, 3);
    // The worklet's first load, slowed: the options are off while the start is in flight.
    await page.evaluate(() => ((window as any).__slowWorkletMs = 1500));
    await openRecordFromMore(page);
    const sheet = recordSheet(page);
    await sheet.getByTestId('record-option-audio').click();
    for (const k of ['audio', 'video', 'both']) await expect(sheet.getByTestId(`record-option-${k}`), `${k}: off while starting`).toBeDisabled();
    await expect(sheet.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await sheet.getByTestId('record-stop-save').click();
    await caughtDownloads(page, 1);
    // A double tap (the worklet loaded now: the start lands between the taps).
    await page.evaluate(() => ((window as any).__slowWorkletMs = 0));
    await openRecordFromMore(page);
    const n0 = (await wavMsgs(page)).length;
    await sheet.getByTestId('record-option-audio').dblclick();
    await expect(sheet.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    expect((await wavMsgs(page)).length - n0, 'one capture node for the double tap').toBe(1);
    expect(await page.getByTestId('rec-open').count(), 'still recording (the second tap did not stop it)').toBeGreaterThan(0);
    await sheet.getByTestId('record-stop-save').click();
    await caughtDownloads(page, 2);
    await page.waitForTimeout(500);
    const m0 = await wavMsgs(page);
    await page.waitForTimeout(2000);
    const m1 = await wavMsgs(page);
    test.info().annotations.push({ type: 'R12 messages per capture node, after Stop and 2 s later', description: JSON.stringify({ m0, m1 }) });
    expect(m1, 'no capture keeps running after Stop').toEqual(m0);
    expect((await caughtDownloads(page)).length, 'one file per recording').toBe(2);
    expect(dialogs).toEqual([]);
  });

  test('R13. the heat guard: an Audio Only recording keeps the visuals paused behind the Library tab; an AV Mix one runs them (A2)', async ({ page }) => {
    test.skip(ON_DEVICE, 'the HUD rates are the desktop’s dev-server rates');
    test.setTimeout(180_000);
    await stubDownloads(page);
    await recordHudDraws(page);
    const dialogs = await playingSeeded(page, 3);
    const canVideo = await page.evaluate(() => typeof MediaRecorder === 'function' && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function');
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await tab(page, 'library');
    await drawsPerSecond(page, 1);
    const audioOnly = await drawsPerSecond(page, 3);
    await tab(page, 'more');
    await page.getByTestId('more-stop-recording').click();
    await caughtDownloads(page, 1);
    test.info().annotations.push({ type: 'R13 draws/s behind Library, Audio Only', description: JSON.stringify(audioOnly) });
    expect(Math.max(...audioOnly), 'Audio Only: 0 draws behind the Library tab').toBe(0);
    test.skip(!canVideo, 'MediaRecorder or canvas.captureStream is not available here');
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-both').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await tab(page, 'library');
    await drawsPerSecond(page, 1);
    const av = await drawsPerSecond(page, 3);
    test.info().annotations.push({ type: 'R13 draws/s behind Library, AV Mix', description: JSON.stringify(av) });
    expect(Math.min(...av), 'AV Mix: the visuals draw (the recording captures them)').toBeGreaterThanOrEqual(DRAWING);
    await tab(page, 'more');
    await page.getByTestId('more-stop-recording').click();
    await caughtDownloads(page, 2);
    expect(dialogs).toEqual([]);
  });

  test('R13b. the Car screen likewise: an Audio Only recording keeps the visuals behind it paused (A2)', async ({ page }) => {
    test.skip(ON_DEVICE, 'the HUD rates are the desktop’s dev-server rates');
    test.setTimeout(150_000);
    await stubDownloads(page);
    await recordHudDraws(page);
    const { openSeededNewLayout, libraryRowButton, openLibraryTab } = await import('./helpers');
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await page.evaluate(() => localStorage.setItem('aetheria.layerOutput.v1', 'car'));
    await page.reload();
    await page.getByTestId('new-shell').waitFor();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(3);
    await page.setViewportSize(PHONE_VIEWPORT);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await tab(page, 'now');
    await expect(page.getByTestId('view-car')).toBeVisible();
    await drawsPerSecond(page, 1);
    const car = await drawsPerSecond(page, 3);
    test.info().annotations.push({ type: 'R13b draws/s behind the Car screen, Audio Only', description: JSON.stringify(car) });
    expect(Math.max(...car), 'Audio Only on the Car screen: 0 draws').toBe(0);
    await page.getByTestId('view-car').getByTestId('rec-stop').click();
    await caughtDownloads(page, 1);
    expect(dialogs).toEqual([]);
  });

  test('R14. a recording started over a tone alone (no music loaded yet) records the music once a track plays (A3)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    await page.addInitScript((k) => localStorage.setItem(k, 'true'), MUSIC_ONLY_KEY);
    const { openSeededNewLayout, libraryRowButton, openLibraryTab, phoneSize } = await import('./helpers');
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await phoneSize(page);
    // The Guide's cube plays a crystal (selectFrequency → the AudioContext; no music element yet).
    await tab(page, 'more');
    await moreRow(page, 'more-guide-row').click();
    await page.getByTestId('guide-view-technical').click();
    await page.getByTestId('guide-content').locator('[title^="Play 528 Hz"]').first().click();
    await openRecordFromMore(page);
    await expect(recordSheet(page).getByTestId('record-option-audio')).toBeEnabled({ timeout: 5_000 });
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 4; }, { timeout: 20_000 }).toBe(true);
    await page.getByTestId('mini-player').getByTestId('rec-open').click();
    await recordSheet(page).getByTestId('record-stop-save').click();
    await caughtDownloads(page, 1);
    const w = await wavInfo(page, 0, { win: 0.5, tail: 2, head: 1 });
    test.info().annotations.push({ type: 'R14 RMS per 0.5 s (Music only: silence until the track)', description: w.rms.map((x) => x.toFixed(3)).join(' ') });
    expect(w.headRms, 'before the track: silence (Music only)').toBeLessThan(0.01);
    expect(w.tailRms, 'the music is in the file: RMS of the last 2 s').toBeGreaterThan(0.05);
    expect(dialogs).toEqual([]);
  });

  test('R15. the playback-error recovery (a new music element) keeps the music in a running recording (A3)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    await page.addInitScript((k) => localStorage.setItem(k, 'true'), MUSIC_ONLY_KEY);
    // The music's play() rejects twice with an unknown error while __playFails > 0 (the anchor's data: URL plays):
    // resumePlayback's last recovery drops the element and playTrack makes a new one.
    await page.addInitScript(() => {
      const w = window as any;
      w.__playFails = 0;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        if (w.__playFails > 0 && this.src.startsWith('blob:')) {
          w.__playFails--;
          return Promise.reject(new DOMException('a test failure', 'UnknownError'));
        }
        return play.call(this);
      };
    });
    const dialogs = await playingSeeded(page, 3, { seconds: 40 });
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await tab(page, 'library');
    await page.waitForTimeout(2000);
    const mini = page.getByTestId('mini-player');
    await mini.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await page.evaluate(() => ((window as any).__playFails = 2));
    await mini.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > 1; }, { timeout: 20_000, message: 'the recovery plays the track again' }).toBe(true);
    expect(await page.evaluate(() => (window as any).__playFails), 'both failures happened (the recovery path ran)').toBe(0);
    await page.waitForTimeout(4000);
    await mini.getByTestId('rec-open').click();
    await recordSheet(page).getByTestId('record-stop-save').click();
    await caughtDownloads(page, 1);
    const w = await wavInfo(page, 0, { win: 0.5, tail: 2, head: 2 });
    test.info().annotations.push({ type: 'R15 RMS per 0.5 s', description: JSON.stringify(w.rms.map((x) => +x.toFixed(3))) });
    expect(w.headRms, 'before the pause').toBeGreaterThan(0.05);
    expect(w.tailRms, 'after the recovery: the music is still recorded').toBeGreaterThan(0.05);
    expect(w.tailRms, '…never doubled').toBeLessThanOrEqual(1.5 * w.headRms);
    expect(dialogs).toEqual([]);
  });

  test('R16. a failed AV Mix start leaves no music tap; the next AV Mix has exactly one (A4)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    await instrumentCapture(page);
    const dialogs = await playingSeeded(page, 3);
    const canVideo = await page.evaluate(() => typeof MediaRecorder === 'function' && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function');
    test.skip(!canVideo, 'MediaRecorder or canvas.captureStream is not available here');
    await page.evaluate(() => ((window as any).__mrThrow = true));
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-both').click();
    await expect(page.getByTestId('notices')).toContainText('Recording failed to start.');
    expect(await liveTaps(page), 'the failed start let its music tap go').toBe(0);
    await page.evaluate(() => ((window as any).__mrThrow = false));
    await recordSheet(page).getByTestId('record-option-both').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    expect(await liveTaps(page), 'one music tap (never two: the music would be doubled)').toBe(1);
    await recordSheet(page).getByTestId('record-stop-save').click();
    await caughtDownloads(page, 1);
    expect(await liveTaps(page), 'none after Stop').toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('R17. a second recording in the session, across a gapless change, keeps the music after the change (one live source)', async ({ page }) => {
    test.setTimeout(180_000);
    await stubDownloads(page);
    await page.addInitScript((k) => localStorage.setItem(k, 'true'), MUSIC_ONLY_KEY);
    const dialogs = await playingSeeded(page, 4, { seconds: 8 });
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    await recordSheet(page).getByTestId('record-stop-save').click();
    await caughtDownloads(page, 1);
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    const from = (await libraryState(page)).current;
    await expect
      .poll(async () => { const s = await libraryState(page); return s.current !== from && (s.t ?? 0) > 3; }, { timeout: 40_000, message: 'the next track, 3 s in' })
      .toBe(true);
    await recordSheet(page).getByTestId('record-stop-save').click();
    await caughtDownloads(page, 2);
    const w = await wavInfo(page, 1, { win: 0.5, tail: 2, head: 1 });
    test.info().annotations.push({ type: 'R17 the second recording, RMS per 0.5 s', description: w.rms.map((x) => x.toFixed(3)).join(' ') });
    expect(w.headRms, 'its first track').toBeGreaterThan(0.05);
    expect(w.tailRms, 'the music after the change').toBeGreaterThan(0.05);
    expect(w.tailRms, '…never doubled').toBeLessThanOrEqual(1.5 * w.headRms);
    expect(dialogs).toEqual([]);
  });

  test('R18. the ⋯ menu keeps its rows in place while recording: Stop recording takes Record’s slot; Save as a playlist stays where it was (A5)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await playingSeeded(page, 3);
    await tab(page, 'now');
    const rects = async () => {
      await page.getByTestId('np-menu-button').click();
      const menu = page.getByTestId('menu-body');
      await menu.waitFor();
      const box = async (id: string) => ((await menu.getByTestId(id).count()) ? await menu.getByTestId(id).boundingBox() : null);
      const r = {
        record: await box('menu-record'),
        stop: await box('menu-stop-recording'),
        save: await box('menu-save-playlist'),
        add: await box('menu-add-to-playlist'),
        classic: await box('menu-back-to-classic'),
      };
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('menu-body')).toHaveCount(0);
      return r;
    };
    const idle = await rects();
    await openRecordFromMore(page);
    await recordSheet(page).getByTestId('record-option-audio').click();
    await expect(recordSheet(page).getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await tab(page, 'now');
    const rec = await rects();
    test.info().annotations.push({ type: 'R18 rows idle / recording', description: JSON.stringify({ idle, rec }) });
    expect(idle.record && idle.save && rec.stop && rec.save, 'the rows are there').toBeTruthy();
    expect(rec.record, 'no Record row while recording').toBeNull();
    expect(rec.stop!.y, 'Stop recording sits in Record’s slot').toBeCloseTo(idle.record!.y, 0);
    expect(rec.save!.y, 'Save as a playlist stays where it was').toBeCloseTo(idle.save!.y, 0);
    expect(rec.add!.y).toBeCloseTo(idle.add!.y, 0);
    expect(rec.classic!.y).toBeCloseTo(idle.classic!.y, 0);
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-stop-recording').click();
    await caughtDownloads(page, 1);
    await expect(page.getByTestId('rec-open')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('R19. Stop and save never lands where an option was: no overlap with Audio Only, Visuals Only or AV Mix (A5, the phone sheet)', async ({ page }) => {
    test.setTimeout(150_000);
    await stubDownloads(page);
    const dialogs = await playingSeeded(page, 3);
    const canVideo = await page.evaluate(() => typeof MediaRecorder === 'function' && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function');
    for (const kind of (canVideo ? ['audio', 'both'] : ['audio']) as Array<'audio' | 'both'>) {
      await openRecordFromMore(page);
      const sheet = recordSheet(page);
      const opts = [];
      for (const k of ['audio', 'video', 'both']) opts.push(await sheet.getByTestId(`record-option-${k}`).boundingBox());
      await sheet.getByTestId(`record-option-${kind}`).click();
      await expect(sheet.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
      const stop = await sheet.getByTestId('record-stop-save').boundingBox();
      test.info().annotations.push({ type: `R19 ${kind}: the options, then Stop and save`, description: JSON.stringify({ opts, stop }) });
      for (const o of opts) {
        const overlap = !!o && !!stop && o.x < stop.x + stop.width && stop.x < o.x + o.width && o.y < stop.y + stop.height && stop.y < o.y + o.height;
        expect(overlap, `Stop and save overlaps an option (${JSON.stringify(o)})`).toBe(false);
      }
      await sheet.getByTestId('record-stop-save').click();
      await expect(page.getByTestId('rec-open')).toHaveCount(0);
    }
    await caughtDownloads(page, canVideo ? 2 : 1);
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('R19b. on the desktop panel too, Stop and save never overlaps an option (A5)', async ({ page }) => {
    test.setTimeout(120_000);
    await stubDownloads(page);
    const { openSeededNewLayout, libraryRowButton, openLibraryTab } = await import('./helpers');
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await tab(page, 'more');
    await moreRow(page, 'more-record-row').click();
    const panel = page.getByRole('region', { name: 'Record', exact: true });
    const opts = [];
    for (const k of ['audio', 'video', 'both']) opts.push(await panel.getByTestId(`record-option-${k}`).boundingBox());
    await panel.getByTestId('record-option-audio').click();
    await expect(panel.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    const stop = await panel.getByTestId('record-stop-save').boundingBox();
    test.info().annotations.push({ type: 'R19b the options, then Stop and save', description: JSON.stringify({ opts, stop }) });
    for (const o of opts) {
      const overlap = !!o && !!stop && o.x < stop.x + stop.width && stop.x < o.x + o.width && o.y < stop.y + stop.height && stop.y < o.y + o.height;
      expect(overlap, `Stop and save overlaps an option (${JSON.stringify(o)})`).toBe(false);
    }
    await panel.getByTestId('record-stop-save').click();
    await caughtDownloads(page, 1);
    expect(dialogs).toEqual([]);
  });


  test('R11. on the desktop, Record is the panel beside the canvas (non-modal: the transport works); REC on the transport opens it', async ({ page }) => {
    test.setTimeout(120_000);
    await stubDownloads(page);
    const { openSeededNewLayout, libraryRowButton, openLibraryTab } = await import('./helpers');
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 40 });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await tab(page, 'more');
    await moreRow(page, 'more-record-row').click();
    const panel = page.getByRole('region', { name: 'Record', exact: true });
    await expect(panel).toBeVisible();
    await panel.getByTestId('record-option-audio').click();
    await expect(panel.getByTestId('record-recording')).toBeVisible({ timeout: 10_000 });
    // Non-modal: the transport's Pause works while it is open.
    await page.getByTestId('desktop-transport').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await page.getByTestId('desktop-transport').getByRole('button', { name: 'Play', exact: true }).click();
    await panel.getByRole('button', { name: 'Close panel', exact: true }).click();
    const rec = page.getByTestId('desktop-transport').getByTestId('rec-open');
    await rec.click();
    await expect(panel).toBeVisible();
    await panel.getByTestId('record-stop-save').click();
    await caughtDownloads(page, 1);
    expect(dialogs).toEqual([]);
  });
});
