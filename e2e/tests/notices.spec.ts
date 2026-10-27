import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import { expectCache, importTones, layerState, instrumentAudio, openApp, pauseCount, pickFrequency, rowOf } from './helpers';

// v15.4: no native dialog is left in the app. Until v15.3 every mix button that found nothing, the two readouts, the
// recording failures and the row Delete raised alert() / confirm(): each froze the page (auto-advance with it) until
// someone tapped OK. Now the short notices are toasts in the always-mounted live region (8 s; the Lo Shu walk 10 s),
// the three long explanations a 12 s toast with Details, the readouts a scrollable dialog that stays until closed, and
// the Delete a confirmation dialog. The fixture's guard fails any test that sees a native dialog.

/** The live region that holds the toasts (App's notices). */
const notices = (page: Page) => page.getByRole('status');

/** A sidebar button by the start of its visible name (several have a second line, e.g. "111 Sequence 9 Orders"); the
 *  two readouts' names are two spans each ("Library" + "Diagnostics"). */
const sidebarButton = (page: Page, name: string): Locator => {
  const pattern =
    name === 'Library'
      ? /^Library\s*Diagnostics/
      : name === 'Current Track'
        ? /^Current Track\s*Analysis/
        : new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return page.locator('aside').getByRole('button', { name: pattern }).first();
};

async function tap(page: Page, name: string): Promise<void> {
  const button = sidebarButton(page, name);
  await button.scrollIntoViewIfNeeded();
  await button.click();
}

/** Close the Safety panel when it opened by itself (an unanalysed track does that). */
async function closeSafety(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close Safety Panel' });
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** Play a track from the list and wait until it is under way. */
async function playTone(page: Page, name = 'tone-01'): Promise<void> {
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 15_000 });
  await closeSafety(page);
}

// The one-liners, verbatim from the alerts they replace (HEART and HEAD rewritten: their list of "frequencies
// detected" was always empty, so the alert said only this).
const ONE_LINERS: Array<[string, string]> = [
  ['GUT Alignment', 'Not enough analyzed songs. Try scanning library first.'],
  ['Full Alignment', 'No analyzed songs found. Please scan your library first.'],
  ['HEART Alignment', 'HEART Alignment: no tracks have a HEART crystal (1206–3150 Hz) yet. Try scanning your library first, or use Auto-Distribute.'],
  ['HEAD Alignment', 'HEAD Alignment: no tracks have a HEAD crystal (3504 Hz and up) yet. Try scanning your library first, or use Auto-Distribute.'],
  // v15.9: the presets' neutral names, by their whole accessible name (the recipe is their second line; "Flow" alone
  // is also the visual settings' Flow switch).
  ['Grounding 174·285·396·417', 'No songs found for Grounding. Try scanning your library first or add more variety.'],
  ['Stillness 174·285·528', 'No songs found for Stillness. Try scanning your library first or add more variety.'],
  ['Uplift 396·417·639', 'No songs found for Uplift. Try scanning your library first or add more variety.'],
  ['Meditation 741·852·963', 'No songs found for Meditation. Try scanning your library first or add more variety.'],
  ['Flow 285·417·528·639·741', 'No songs found for Flow. Try scanning your library first or add more variety.'],
  ['Ultimate', 'Not enough analyzed songs for Ultimate Alignment. Please scan your library first.'],
  ['Current Track', 'No track currently selected for analysis.'],
];

// The three long ones: a one-line summary, then Details opens the whole explanation (the alert's text) in a dialog.
const WITH_DETAILS: Array<{ button: string; summary: string; title: string; detail: string }> = [
  { button: 'Golden Φ', summary: 'No tracks with golden ratio alignment above 30% yet.', title: 'Golden Φ', detail: 'Actual analysis results:' },
  {
    button: '111 Sequence',
    summary: 'The 111 Sequence needs at least one scanned track for the first frequency of each order.',
    title: '111 Sequence',
    detail: 'Requirements: At least one analyzed track',
  },
  { button: '2178Hz Filter', summary: 'No scanned 2178 Hz tracks for the SOURCE filter yet.', title: '2178 Hz SOURCE filter', detail: 'No pure 2178Hz tracks found for SOURCE field filter.' },
];

test('1. every mix button with an empty library says why in a toast, the long ones with Details', async ({ page }) => {
  test.setTimeout(150_000);
  const dialogs = await openApp(page);
  for (const [button, text] of ONE_LINERS) {
    await tap(page, button);
    await expect(notices(page), button).toContainText(text, { timeout: 5_000 });
  }
  for (const d of WITH_DETAILS) {
    await tap(page, d.button);
    await expect(notices(page), d.button).toContainText(d.summary, { timeout: 5_000 });
    await notices(page).getByRole('button', { name: 'Details', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: d.title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(d.detail);
    // Details takes the toast down: the dialog holds the whole text now.
    await expect(notices(page)).not.toContainText(d.summary);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  expect(dialogs).toEqual([]);
});

test('2. Golden Φ with tracks lists them in its Details', async ({ page }) => {
  const dialogs = await openApp(page);
  await importTones(page, 3, 10);
  await expect(page.getByText('tone-03', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await tap(page, 'Golden Φ');
  await notices(page).getByRole('button', { name: 'Details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Golden Φ', exact: true });
  await expect(dialog).toContainText('tone-01');
  await expect(dialog).toContainText('tone-03');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('3. a Lo Shu walk with an empty library says so in a toast', async ({ page }) => {
  const dialogs = await openApp(page);
  await page.getByRole('button', { name: /Lo Shu controls/ }).click();
  // The first walk (its button ends with its step count; the menu's first button is the Perfect GUT switch).
  await page.getByRole('menu').getByRole('button').filter({ hasText: /27$/ }).first().click();
  await expect(notices(page)).toContainText(/no matching songs in your library yet\. This walk needs/, { timeout: 5_000 });
  await page.mouse.click(3, 3); // the menu's click-away catcher
  expect(dialogs).toEqual([]);
});

test('4. the two readouts open in a dialog that stays until closed, and Copy copies them', async ({ page, context }) => {
  test.skip(ON_DEVICE, 'clipboard permissions are a local context option');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const dialogs = await openApp(page);
  await importTones(page, 3, 30);
  await playTone(page);

  await tap(page, 'Current Track');
  const analysis = page.getByRole('dialog', { name: 'Current track analysis', exact: true });
  await expect(analysis).toContainText('EXTENDED OCTAVE RANGE ANALYSIS');
  await expect(analysis).toContainText('tone-01');
  // It stays: no timer takes it down.
  await page.waitForTimeout(9_000);
  await expect(analysis).toBeVisible();
  await analysis.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(analysis.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('EXTENDED OCTAVE RANGE ANALYSIS');
  expect(copied).toContain('"tone-01"');
  await analysis.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(analysis).toHaveCount(0);

  await tap(page, 'Library');
  const diagnostics = page.getByRole('dialog', { name: 'Library diagnostics', exact: true });
  await expect(diagnostics).toContainText('PLAYLIST DIAGNOSTICS');
  await expect(diagnostics).toContainText('Total tracks: 3');
  await diagnostics.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(diagnostics).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test.describe('on a phone screen', () => {
  test.use({ viewport: { width: 411, height: 752 } });

  test('4. a long readout scrolls inside its dialog', async ({ page }) => {
    const dialogs = await openApp(page);
    await importTones(page, 28, 5);
    // The library drawer starts closed on a phone: the header's first button opens it.
    if (!(await page.locator('aside').getByRole('button', { name: /Auto-Distribute Frequencies/ }).isVisible().catch(() => false))) {
      await page.locator('header button').first().click();
    }
    await expectCache(page, { library: 28 }, 30_000); // the list is virtualised: count what is stored, not rows
    await tap(page, 'Auto-Distribute Frequencies');
    await expectCache(page, { analysed: 28 }, 30_000);
    await tap(page, 'Library');
    const diagnostics = page.getByRole('dialog', { name: 'Library diagnostics', exact: true });
    await expect(diagnostics).toContainText('FREQUENCY BREAKDOWN');
    const body = diagnostics.getByTestId('dialog-body');
    const box = await body.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(box.overflowY).toBe('auto');
    expect(box.scrollHeight, 'the readout is taller than its dialog').toBeGreaterThan(box.clientHeight);
    // The whole dialog fits the screen.
    const panel = await diagnostics.boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(752 + 1);
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(diagnostics.getByText(/RECOMMENDATIONS/)).toBeInViewport();
    await diagnostics.getByRole('button', { name: 'Close', exact: true }).click();
    expect(dialogs).toEqual([]);
  });
});

test('5. a recording that fails to start says so in a toast', async ({ page }) => {
  await page.addInitScript(() => {
    // The WAV recorder's worklet never loads, and MediaRecorder refuses to start.
    AudioWorklet.prototype.addModule = () => Promise.reject(new Error('stub'));
    const Real = window.MediaRecorder;
    const Refusing = function () {
      throw new Error('stub');
    } as unknown as { isTypeSupported: (t: string) => boolean };
    Refusing.isTypeSupported = (t: string) => Real.isTypeSupported(t);
    (window as any).MediaRecorder = Refusing;
  });
  const dialogs = await openApp(page);
  await importTones(page, 1, 30);
  await playTone(page); // startRecording needs the AudioContext
  const record = page.locator('header button').filter({ has: page.locator('svg.lucide-circle') });
  await record.click();
  await page.getByText('Start Recording', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Audio Only' }).click();
  await expect(notices(page)).toContainText('WAV recording failed to start.', { timeout: 5_000 });
  await page.getByRole('button', { name: 'Visuals Only' }).click();
  await expect(notices(page)).toContainText('Recording failed to start. Your browser might not support this format.', { timeout: 5_000 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(dialogs).toEqual([]);
});

test('6. Delete asks in the app first; Cancel and Escape keep the track, Delete removes it', async ({ page }) => {
  const dialogs = await openApp(page);
  await importTones(page, 3, 20);
  await expectCache(page, { blobs: 3, library: 3 });
  const confirm = page.getByRole('alertdialog', { name: 'Delete this track?' });
  const rootInert = () => page.evaluate(() => (document.getElementById('root') as HTMLElement & { inert: boolean }).inert);

  // Cancel (the first focus: a stray Enter keeps the track).
  await rowOf(page, 'tone-02').getByTitle('Delete song').click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('"tone-02"');
  await expect(confirm).toContainText('The original file is not touched.');
  await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(await rootInert(), '#root is inert while the dialog is open').toBe(true);
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(await rootInert()).toBe(false);

  // Escape.
  await rowOf(page, 'tone-02').getByTitle('Delete song').click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText('tone-02', { exact: true })).toHaveCount(1);
  await page.waitForTimeout(2500);
  await expectCache(page, { blobs: 3, library: 3 });

  // Delete.
  await rowOf(page, 'tone-02').getByTitle('Delete song').click();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText('tone-02', { exact: true })).toHaveCount(0);
  await expectCache(page, { blobs: 2, library: 2 });
  expect(dialogs).toEqual([]);
});

test('7. the music never pauses for a notice or a readout @mobile', async ({ page }) => {
  await instrumentAudio(page);
  const dialogs = await openApp(page);
  await importTones(page, 3, 30);
  await playTone(page);
  await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 15_000 }).toBeGreaterThan(1);
  const pauses = await pauseCount(page);
  const t0 = (await layerState(page)).music!.time;

  await tap(page, 'GUT Alignment'); // three unscanned tones: it finds nothing
  await expect(notices(page)).toContainText('Not enough analyzed songs. Try scanning library first.');
  await tap(page, 'Library');
  const diagnostics = page.getByRole('dialog', { name: 'Library diagnostics', exact: true });
  await expect(diagnostics).toBeVisible();
  await page.waitForTimeout(1500);
  await diagnostics.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(diagnostics).toHaveCount(0);
  await page.waitForTimeout(500);

  const s = await layerState(page);
  expect(s.music!.paused, 'the music still plays').toBe(false);
  expect(s.music!.time - t0, 'the music moved on meanwhile').toBeGreaterThan(1.5);
  expect(await pauseCount(page), 'no pause() meanwhile').toBe(pauses);
  expect(dialogs).toEqual([]);
});

test('8. the update banner says a reload stops the music, and never reloads without a tap', async ({ page }) => {
  test.setTimeout(90_000);
  const dialogs = await openApp(page);
  await importTones(page, 1, 60);
  await playTone(page);
  await page.evaluate(() => {
    (window as any).__samePage = true;
    (window as any).__aetheriaUpdateReady = true;
    window.dispatchEvent(new Event('aetheria:update-ready'));
  });
  const banner = notices(page).locator('div[aria-atomic="true"]').filter({ hasText: 'A new version of Aetheria is ready.' });
  await expect(banner).toContainText('A new version of Aetheria is ready. Reloading stops the music.');
  await page.waitForTimeout(10_000);
  expect(await page.evaluate(() => (window as any).__samePage === true), 'the same page after 10 s').toBe(true);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(banner).toHaveText(/A new version of Aetheria is ready\.\s*Reload/);
  await expect(banner).not.toContainText('Reloading stops the music.');
  await page.waitForTimeout(5_000);
  expect(await page.evaluate(() => (window as any).__samePage === true), 'the same page after 5 s more').toBe(true);
  expect(dialogs).toEqual([]);
});

test('9. a tone-only session gets the same warning on the update banner', async ({ page }) => {
  // No track: a frequency picked alone plays the tone (the app's dual gate: isPlaying || isSolfeggioActive), and a
  // reload would stop it just the same.
  const dialogs = await openApp(page);
  await pickFrequency(page, 528);
  await page.evaluate(() => {
    (window as any).__aetheriaUpdateReady = true;
    window.dispatchEvent(new Event('aetheria:update-ready'));
  });
  const banner = notices(page).locator('div[aria-atomic="true"]').filter({ hasText: 'A new version of Aetheria is ready.' });
  await expect(banner).toContainText('A new version of Aetheria is ready. Reloading stops the music.');
  await expect(page.getByRole('button', { name: 'Pause', exact: true }), 'no track plays').toHaveCount(0);
  expect(dialogs).toEqual([]);
});
