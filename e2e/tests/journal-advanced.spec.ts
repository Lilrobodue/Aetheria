import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  PHONE_VIEWPORT,
  acceptDisclaimerNew,
  backToClassicViaMore,
  libraryRow,
  libraryRowButton,
  libraryState,
  openLibraryTab,
  openSeededNewLayout,
  pauseCount,
  renders,
  resetRenders,
  rowMenu,
  tab,
  openHarmonicControl,
} from './helpers';
import { moreRow, moreView, playingSeeded } from './moreKit';

// v16.5, the Journal and Advanced (v16.4 spec §3.9, §3.10, §5.3 journal-advanced.spec). The Journal page runs
// classic's ExperienceTracker with classic's handlers, moved into App functions: the same steps in either layout write
// the same records (J1, J1b). Advanced: the experimental scan scores (off by default; badges and Track info's section at
// scanScores.ts's 30 / 20 / 30 %, labelled as scores, never the safety level), the honest ⋯ › Track info, the layout
// switch, the perf readout. Runs against the dev server.

const SCORES_KEY = 'aetheria.scanScores.v1';

/** More › a page. */
async function openPage(page: Page, view: 'journal' | 'advanced'): Promise<void> {
  await tab(page, 'more');
  await page.getByTestId('more').waitFor();
  if ((await moreView(page)) !== 'root') await tab(page, 'more');
  await moreRow(page, `more-${view}-row`).click();
  await expect.poll(() => moreView(page)).toBe(view);
}

interface JournalSnap {
  sessions: number;
  last: { keys: string[]; notes: number; completed: boolean } | null;
  reports: number;
}

async function journalSnap(page: Page): Promise<JournalSnap> {
  return page.evaluate(() => {
    const sessions = JSON.parse(localStorage.getItem('aetheria_sessions') || '[]');
    const effects = JSON.parse(localStorage.getItem('aetheria_effects_db') || '[]');
    const last = sessions.length ? sessions[sessions.length - 1] : null;
    return {
      sessions: sessions.length,
      last: last ? { keys: Object.keys(last).sort(), notes: (last.notes ?? []).length, completed: !!last.completed } : null,
      reports: effects.reduce((n: number, e: any) => n + ((e.userReports ?? []).length), 0),
    };
  });
}

/** Document a session in the tracker under `root`: start, the pre-session form, one note, end, the post-session form. */
async function documentSession(page: Page, root: ReturnType<Page['locator']>, note: string): Promise<JournalSnap[]> {
  const snaps: JournalSnap[] = [await journalSnap(page)];
  await root.getByRole('button', { name: /Start Experience Documentation/ }).click();
  await page.getByRole('button', { name: 'Start Documenting', exact: true }).click();
  await expect(root.getByText('Session Active')).toBeVisible();
  snaps.push(await journalSnap(page));
  const input = root.getByPlaceholder('Add observation or note...');
  await input.fill(note);
  await input.press('Enter');
  await expect.poll(async () => (await journalSnap(page)).last?.notes ?? 0).toBeGreaterThan(0);
  snaps.push(await journalSnap(page));
  await root.getByRole('button', { name: 'End Session', exact: true }).click();
  await page.getByRole('button', { name: 'Save Experience', exact: true }).click();
  await expect(root.getByRole('button', { name: /Start Experience Documentation/ })).toBeVisible();
  snaps.push(await journalSnap(page));
  return snaps;
}

const delta = (s: JournalSnap[]) =>
  s.slice(1).map((x, i) => ({ sessions: x.sessions - s[i].sessions, reports: x.reports - s[i].reports, keys: x.last?.keys ?? null, notes: x.last?.notes ?? null, completed: x.last?.completed ?? null }));

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('J1. the Journal while playing: the same steps in classic’s Harmonic Control and on the Journal page write the same records', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 60 });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    // Classic first.
    await backToClassicViaMore(page);
    // Harmonic Control may already be open (a desktop window): open it only if it isn't.
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    await page.waitForTimeout(500);
    if (!(await page.getByRole('heading', { name: 'Harmonic Control', exact: true }).isVisible())) await openHarmonicControl(page);
    // Classic has one tracker (in Harmonic Control): the page is its root.
    await page.getByRole('button', { name: /Start Experience Documentation/ }).scrollIntoViewIfNeeded();
    const classic = delta(await documentSession(page, page.locator('body'), 'classic note'));
    // Then the new layout's Journal page (Harmonic Control is still open: its own "Try the new layout").
    await page.getByTestId('try-new-layout').click();
    await page.getByTestId('new-shell').waitFor();
    await openPage(page, 'journal');
    const journal = page.getByTestId('more-journal');
    await expect(journal).toContainText('Document how a session felt: before and after, sensations and notes. Kept on this device only.');
    await expect(journal).toContainText('Experimental: self-reports, not measurements.');
    await expect(page.getByTestId('more').getByText('Experimental', { exact: true }).first()).toBeVisible();
    const mine = delta(await documentSession(page, journal, 'new note'));
    test.info().annotations.push({ type: 'J1 deltas (start, note, end)', description: JSON.stringify({ classic, mine }) });
    // Classic's behaviour, step by step (the shared functions are checked, not only their agreement): the start writes a
    // session, the note joins it, the end completes it.
    expect(classic.map((d) => [d.sessions, d.notes, d.completed]), 'classic: start, note, end').toEqual([[1, 0, false], [0, 1, false], [0, 1, true]]);
    expect(mine, 'the Journal page: the same records as classic').toEqual(classic);
    expect(dialogs).toEqual([]);
  });

  test('J1b. the Journal while paused: the start form’s Start Documenting writes the session (classic’s onSessionStart, moved)', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 60 });
    await openPage(page, 'journal');
    const journal = page.getByTestId('more-journal');
    const s0 = await journalSnap(page);
    await journal.getByRole('button', { name: /Start Experience Documentation/ }).click();
    await page.getByRole('button', { name: 'Start Documenting', exact: true }).click();
    await expect(journal.getByText('Session Active')).toBeVisible();
    const s1 = await journalSnap(page);
    expect(s1.sessions - s0.sessions, 'nothing plays, so the start form wrote it').toBe(1);
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await expect(moreRow(page, 'more-journal-row')).toContainText('A session is being documented');
    // Back on the page, the tracker (mounted again) shows its start form again, as classic's does when Harmonic Control
    // is closed and reopened (its own mount effect; unchanged): Start Documenting writes no second session.
    await openPage(page, 'journal');
    await page.getByRole('button', { name: 'Start Documenting', exact: true }).click();
    await expect(journal.getByText('Session Active')).toBeVisible();
    expect((await journalSnap(page)).sessions, 'still one session').toBe(s1.sessions);
    await journal.getByRole('button', { name: 'End Session', exact: true }).click();
    await expect.poll(async () => (await journalSnap(page)).last?.completed).toBe(true);
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await expect(moreRow(page, 'more-journal-row')).toContainText('Notes on how a session felt, kept on this device');
    expect(dialogs).toEqual([]);
  });

  test('J3. earlier sessions are kept (A6): a session, a reload, another: both stored, with a stored entry the tracker can’t read left as it was', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 60 });
    const odd = { note: 'not a session', v: 1 };
    await page.evaluate((o) => localStorage.setItem('aetheria_sessions', JSON.stringify([o])), odd);
    const playAndJournal = async () => {
      await page.reload();
      await page.getByTestId('new-shell').waitFor();
      await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(3);
      await openLibraryTab(page);
      await libraryRowButton(page, 'tone-0001').click();
      await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
      await openPage(page, 'journal');
    };
    await playAndJournal();
    await documentSession(page, page.getByTestId('more-journal'), 'first note');
    await playAndJournal();
    await documentSession(page, page.getByTestId('more-journal'), 'second note');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aetheria_sessions') || '[]'));
    test.info().annotations.push({ type: 'J3 stored', description: JSON.stringify(stored.map((x: any) => ({ id: x.id ?? null, notes: (x.notes ?? []).length, completed: x.completed ?? null }))) });
    expect(stored.length, 'the entry it can’t read and both sessions').toBe(3);
    expect(stored[0], 'kept as it was').toEqual(odd);
    expect(stored.slice(1).map((x: any) => [x.completed, x.notes.map((n: any) => String(n.content).replace(/^\[[\d:]+\] /, ''))])).toEqual([[true, ['first note']], [true, ['second note']]]);
    expect(dialogs).toEqual([]);
  });

  test('J3b. stored sessions that can’t be read at all are never written over (A6)', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 60 });
    await page.evaluate(() => localStorage.setItem('aetheria_sessions', '{not json'));
    await page.reload();
    await page.getByTestId('new-shell').waitFor();
    await openPage(page, 'journal');
    const journal = page.getByTestId('more-journal');
    await journal.getByRole('button', { name: /Start Experience Documentation/ }).click();
    await page.getByRole('button', { name: 'Start Documenting', exact: true }).click();
    await expect(journal.getByText('Session Active')).toBeVisible();
    await journal.getByRole('button', { name: 'End Session', exact: true }).click();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => localStorage.getItem('aetheria_sessions')), 'left as it was').toBe('{not json');
    expect(dialogs).toEqual([]);
  });

  test('J3c. two windows (a tab and the installed app) keep each other’s sessions (re-review A6): each save reads the stored list again and merges by id', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = await openSeededNewLayout(page, 3, { real: 3, seconds: 60 });
    const odd = { note: 'not a session', v: 1 };
    await page.evaluate((o) => localStorage.setItem('aetheria_sessions', JSON.stringify([o])), odd);
    // The second window: the same origin's storage (the context's), the app loaded again (an absolute URL: on a phone
    // the context has no base URL). Closed whatever happens.
    const other = await page.context().newPage();
    try {
      await other.goto(new URL('/', page.url()).toString());
      await acceptDisclaimerNew(other);
      await expect.poll(async () => (await libraryState(other)).libraryIds.length, { timeout: 30_000 }).toBe(3);
      const start = async (p: Page) => {
        await openPage(p, 'journal');
        const j = p.getByTestId('more-journal');
        await j.getByRole('button', { name: /Start Experience Documentation/ }).click();
        await p.getByRole('button', { name: 'Start Documenting', exact: true }).click();
        await expect(j.getByText('Session Active')).toBeVisible();
        return j;
      };
      const note = async (p: Page, j: ReturnType<Page['locator']>, text: string) => {
        const input = j.getByPlaceholder('Add observation or note...');
        await input.fill(text);
        await input.press('Enter');
        await expect.poll(() => p.evaluate((t) => (localStorage.getItem('aetheria_sessions') || '').includes(t), text)).toBe(true);
      };
      const end = async (p: Page, j: ReturnType<Page['locator']>) => {
        await j.getByRole('button', { name: 'End Session', exact: true }).click();
        await p.getByRole('button', { name: 'Save Experience', exact: true }).click();
        await expect(j.getByRole('button', { name: /Start Experience Documentation/ })).toBeVisible();
      };
      // Each window starts its session, then they take turns: every save lands on the other's.
      const ja = await start(page);
      const jb = await start(other);
      await note(page, ja, 'from the tab');
      await note(other, jb, 'from the app');
      await note(page, ja, 'the tab again');
      await end(page, ja);
      await end(other, jb);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aetheria_sessions') || '[]'));
      test.info().annotations.push({ type: 'J3c stored', description: JSON.stringify(stored.map((x: any) => ({ id: x.id ?? null, notes: (x.notes ?? []).map((n: any) => n.content), completed: x.completed ?? null }))) });
      expect(stored.length, 'the entry it can’t read and both windows’ sessions').toBe(3);
      expect(stored[0], 'kept as it was').toEqual(odd);
      const strip = (x: any) => [x.completed, x.notes.map((n: any) => String(n.content).replace(/^\[[\d:]+\] /, ''))];
      expect(stored.slice(1).map(strip)).toEqual([[true, ['from the tab', 'the tab again']], [true, ['from the app']]]);
    } finally {
      await other.close();
    }
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('J2. renders (DEV): the Journal page renders 0 times in 3 s of playback without a session, at most 4 (its 1 Hz) with one', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page, 3);
    await openPage(page, 'journal');
    await page.waitForTimeout(500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    expect((await renders(page)).JournalPage ?? 0, 'no session: still').toBe(0);
    const journal = page.getByTestId('more-journal');
    await journal.getByRole('button', { name: /Start Experience Documentation/ }).click();
    await page.getByRole('button', { name: 'Start Documenting', exact: true }).click();
    await expect(journal.getByText('Session Active')).toBeVisible();
    await page.waitForTimeout(500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const n = (await renders(page)).JournalPage ?? 0;
    // StrictMode doubles each render in dev: 1 Hz for 3 s is up to 4 renders, 8 counts.
    expect(n, 'a session: about once a second').toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(8);
    await journal.getByRole('button', { name: 'End Session', exact: true }).click();
    expect(dialogs).toEqual([]);
  });

  test('A1. experimental scan scores: off by default; on, the rows over scanScores’ cut-offs get badges with their names, rows AT a cut-off none, and Track info a labelled section without the safety level', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 4, {
      real: 4,
      seconds: 40,
      patch: [
        { index: 0, fractal: { goldenRatioAlignment: 0.75, pattern111Presence: 0.55, dnaResonanceScore: 0.65, sacredGeometryAlignment: 0.9, schumannResonanceHarmony: 0.12, infiniteOrderHarmonics: [1838, 919.2], safetyLevel: 'CAUTION', recommendedVolume: 0.42 } },
        { index: 1, fractal: { goldenRatioAlignment: 0.3, pattern111Presence: 0.2, dnaResonanceScore: 0.3 } },
        { index: 2, fractal: { goldenRatioAlignment: 0.42, pattern111Presence: 0.25, dnaResonanceScore: 0.31 } },
      ],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    await openLibraryTab(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), SCORES_KEY), 'the key is absent until a tap').toBeNull();
    await expect(page.locator('[data-scan-badge]'), 'off by default: no badges').toHaveCount(0);
    await rowMenu(page, 'tone-0001').click();
    await page.getByRole('button', { name: /Track info/ }).first().click();
    await expect(page.getByTestId('track-info-dialog')).toBeVisible();
    await expect(page.getByTestId('track-info-scores'), 'off: no section').toHaveCount(0);
    await page.getByTestId('track-info-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    // On.
    await openPage(page, 'advanced');
    const sw = page.getByTestId('advanced-scan-scores').getByRole('switch');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate((k) => localStorage.getItem(k), SCORES_KEY)).toBe('true');
    await openLibraryTab(page);
    const badges = (name: string) => libraryRow(page, name).locator('[data-scan-badge]');
    await expect(badges('tone-0001')).toHaveText(['Φ 75%', '111', 'DNA']);
    expect(await badges('tone-0001').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual([
      'Experimental score: golden ratio 75 %',
      'Experimental score: 111 pattern 55 %',
      'Experimental score: DNA resonance 65 %',
    ]);
    await expect(badges('tone-0002'), 'AT the cut-offs (over is exclusive): none').toHaveCount(0);
    await expect(badges('tone-0003'), 'between classic’s 70/50/60 and 30/20/30: the new cut-offs apply').toHaveText(['Φ 42%', '111', 'DNA']);
    await expect(badges('tone-0004'), 'no Deep Scan reading: none').toHaveCount(0);
    // Track info's section.
    await rowMenu(page, 'tone-0001').click();
    await page.getByRole('button', { name: /Track info/ }).first().click();
    const section = page.getByTestId('track-info-scores');
    await expect(section).toBeVisible();
    await expect(section.getByRole('heading')).toHaveText('Experimental scan scores');
    await expect(section).toContainText("Scores from Deep Scan's reading of the spectrum, which is not a pitch measurement. Not evidence of any effect.");
    await expect(section.locator('dt')).toHaveText(['Golden ratio score', '111 pattern score', 'DNA resonance score', 'Sacred geometry score', 'Schumann harmony score', 'Peaks in the reading (Hz)']);
    await expect(section).toContainText('A name for a score, not a biological measure');
    await expect(section).toContainText('Higher for noisy sound than for pure tones');
    await expect(section).toContainText("Not the track's pitches");
    await expect(page.getByTestId('track-info-dialog')).not.toContainText(/CAUTION|SAFE|Safety|recommended volume|0\.42/i);
    await page.getByTestId('track-info-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    // Off again: gone.
    await openPage(page, 'advanced');
    await page.getByTestId('advanced-scan-scores').getByRole('switch').click();
    expect(await page.evaluate((k) => localStorage.getItem(k), SCORES_KEY)).toBe('false');
    await openLibraryTab(page);
    await expect(page.locator('[data-scan-badge]')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('A2. the honest Track info: ⋯ › Track info opens the Track info dialog for the playing track (not classic’s readout); "DNA Resonance Score" nowhere; with nothing loaded, classic’s toast; classic’s own button keeps its readout', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 3, {
      real: 3,
      seconds: 40,
      patch: [{ index: 0, scanned: true, fractal: { dnaResonanceScore: 0.66 } }],
    });
    await page.setViewportSize(PHONE_VIEWPORT);
    // Nothing loaded: classic's toast.
    await tab(page, 'now');
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-track-info').click();
    await expect(page.getByTestId('notices')).toContainText('No track currently selected for analysis.');
    await expect(page.getByTestId('track-info-dialog')).toHaveCount(0);
    // Playing tone-0001.
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await tab(page, 'now');
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-track-info').click();
    const dialog = page.getByTestId('track-info-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('tone-0001');
    await expect(page.getByTestId('readout-dialog')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('DNA Resonance Score');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    // With scores on: DNA resonance carries its note.
    await openPage(page, 'advanced');
    await page.getByTestId('advanced-scan-scores').getByRole('switch').click();
    await tab(page, 'now');
    await page.getByTestId('np-menu-button').click();
    await page.getByTestId('menu-track-info').click();
    await expect(dialog.getByTestId('track-info-scores')).toContainText('DNA resonance score');
    await expect(dialog.getByTestId('track-info-scores')).toContainText('A name for a score, not a biological measure');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    // Classic's Current Track Analysis still opens its readout.
    await backToClassicViaMore(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openHarmonicControl(page);
    await page.getByRole('button', { name: /Current Track Analysis|Track Analysis/ }).first().click();
    await expect(page.getByTestId('readout-dialog')).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('A3. the layout switch: Advanced › Use the classic layout shows classic; the music keeps advancing', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page, 3);
    await openPage(page, 'advanced');
    await expect(page.getByTestId('advanced-layout')).toContainText('new (beta)');
    await expect(page.getByTestId('advanced-layout')).toContainText('The classic layout has every control on one screen. The music keeps playing when you switch.');
    const p0 = await pauseCount(page);
    const t0 = (await libraryState(page)).t ?? 0;
    await page.getByTestId('more-advanced').getByTestId('more-back-to-classic').click();
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    await page.waitForTimeout(2000);
    const s = await libraryState(page);
    expect((s.t ?? 0) - t0, 'the music moved on').toBeGreaterThanOrEqual(1.5);
    expect(s.playing).toBe(true);
    expect(await pauseCount(page), 'no pause()').toBe(p0);
    expect(await page.evaluate(() => localStorage.getItem('aetheria.layout.v1'))).toBe('classic');
    expect(dialogs).toEqual([]);
  });

  test('A4. the performance readout: a tap saves the key; after a reload the HUD shows (On now); a tap off removes the key', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page, 3);
    await openPage(page, 'advanced');
    const perf = page.getByTestId('advanced-perf');
    await expect(perf).toContainText('Frames, renders and long tasks in a corner of the screen. Shows from the next launch.');
    await expect(perf).not.toContainText('On now');
    await expect(page.getByTestId('perf-hud')).toHaveCount(0);
    await perf.getByRole('switch').click();
    expect(await page.evaluate(() => localStorage.getItem('aetheria.perfhud.v1'))).toBe('1');
    await expect(page.getByTestId('perf-hud'), 'not in this session').toHaveCount(0);
    await page.reload();
    await page.getByTestId('new-shell').waitFor();
    await expect(page.getByTestId('perf-hud')).toBeVisible({ timeout: 10_000 });
    await openPage(page, 'advanced');
    await expect(page.getByTestId('advanced-perf')).toContainText('On now');
    await expect(page.getByTestId('advanced-perf').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('advanced-perf').getByRole('switch').click();
    expect(await page.evaluate(() => localStorage.getItem('aetheria.perfhud.v1'))).toBeNull();
    expect(dialogs).toEqual([]);
  });
});
