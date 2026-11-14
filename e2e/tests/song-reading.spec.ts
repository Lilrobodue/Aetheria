// e2e/tests/song-reading.spec.ts (v16.9): Track info's "What it says", the song reading by the crystal Deep Scan gave.
//
// The reading follows Deep Scan's crystal (scanCrystalOf its harmonicFreq), never the one a spread moved it to; a track
// Deep Scan hasn't read gets the "Scan this track" line instead, one it couldn't read its own line; Copy carries the
// reading after the rows, its tags in words. The expected words are written out here (not imported), so the negative
// control on v16.8.9 fails on the assertions themselves.

import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openSeededNewLayout, openLibraryTab, rowMenu, PHONE_VIEWPORT } from './helpers';

const HOW = 'Deep Scan gives a song its crystal, and the reading follows that crystal. The scan places a song among the 27; it is not the song’s measured pitch. The Aetheria Divination app reads a song file the same way.';
const UNSCANNED = 'Scan this track (Library › Deep Scan) to read what its crystal holds.';
const FAILED = 'Deep Scan couldn’t read this track, so it has no reading.';
const LABELS = ['Scanned as', 'In the cube', 'Hexagram', 'Geometry', 'Moon mansion'];
const MOVED_BY_ASSIGN = 'It now plays on 4566 Hz, where Assign placed it; the reading follows the crystal its scan gave.';

/** From the next load on, navigator.clipboard.writeText records into window.__copied. */
async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__copied = null;
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t: string) => { w.__copied = t; return Promise.resolve(); }, readText: () => Promise.resolve(w.__copied ?? '') },
      });
    } catch {}
  });
}

/** Seven tracks:
 *  - tone-0001: scanned on 4566 (The Chorus), an older record's shape (no crystalSource);
 *  - tone-0002: assigned, never scanned (528);
 *  - tone-0003: scanned on 174, then spread to 4566;
 *  - tone-0004: no crystal at all;
 *  - tone-0005: scanned on 1692, the shape Deep Scan writes today (crystalSource 'scan');
 *  - tone-0006: scanned on 5274;
 *  - tone-0007: a scan that couldn't read it (440 Hz, its 528 placeholder, 999). */
async function seeded(page: Page, o: { scores?: boolean } = {}): Promise<string[]> {
  await stubClipboard(page);
  if (o.scores) await page.addInitScript(() => { try { localStorage.setItem('aetheria.scanScores.v1', 'true'); } catch {} });
  const dialogs = await openSeededNewLayout(page, 7, {
    real: 7,
    seconds: 40,
    patch: [
      { index: 0, crystal: 4566, scanned: true },
      { index: 1, crystal: 528 },
      { index: 2, crystal: 174, scanned: true, spreadTo: 4566 },
      { index: 3, crystal: null },
      { index: 4, crystal: 1692, scanned: true, fields: { crystalSource: 'scan' } },
      { index: 5, crystal: 5274, scanned: true },
      { index: 6, crystal: 528, fields: { crystalSource: 'scan', harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999 } },
    ],
  });
  await openLibraryTab(page);
  return dialogs;
}

async function openInfo(page: Page, name: string) {
  await rowMenu(page, name).click();
  await page.getByTestId('library-menu-info').click();
  const info = page.getByRole('dialog', { name: 'Track info', exact: true });
  await expect(info).toBeVisible();
  return info;
}

async function closeInfo(page: Page) {
  const info = page.getByRole('dialog', { name: 'Track info', exact: true });
  await info.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(info).toHaveCount(0);
}

const readingRows = (page: Page) =>
  page.getByTestId('track-info-reading').locator('dl > div').evaluateAll((ds) => ds.map((d) => [d.querySelector('dt')!.textContent, d.querySelector('dd')!.textContent]));

/** Track info's Copy for a track: the clipboard text. */
async function copied(page: Page, name: string): Promise<string> {
  const info = await openInfo(page, name);
  await page.evaluate(() => ((window as any).__copied = null));
  await info.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(info.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  const t = (await page.evaluate(() => (window as any).__copied)) as string;
  await closeInfo(page);
  return t;
}

test.describe('Track info, What it says', () => {
  test('SR1. a scanned track: the section after the rows, its heading and Tradition tag, the five rows in order with the Judgment quoted, the Design choice note; no moved note', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await seeded(page);
    const info = await openInfo(page, 'tone-0001');
    const section = info.getByTestId('track-info-reading');
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute('data-evidence', 'tradition');
    await expect(section.getByRole('heading', { level: 3, name: 'What it says' })).toBeVisible();
    await expect(section.locator('#track-info-h-reading + *'), 'the Tradition tag beside the heading').toHaveText('Tradition');
    const rows = await readingRows(page);
    expect(rows.map((r) => r[0])).toEqual(LABELS);
    // The user (14 Nov): "Scanned as": the dialog keeps one Crystal row, its own.
    await expect(info.locator('dt').filter({ hasText: /^Crystal$/ }), 'one Crystal row in Track info').toHaveCount(1);
    expect(rows[0][1]).toBe('4566 Hz · The Chorus · Soul starIn the Aetheria framework, the first transpersonal gate: the soul star.');
    expect(rows[1][1]).toBe('HEAD layer, palace 4, south-east, Wood, ☴ Xun');
    expect(rows[2][1]).toMatch(/^45 Gathering Together/);
    await expect(section.locator('blockquote')).toHaveText(/^In \(the state denoted by\) Žhui, the king will repair to his ancestral temple\./);
    expect(rows[2][1]).toContain('The Judgment, in James Legge’s translation.');
    expect(rows[3][1]).toBe('Harmonic Web. The interconnected web of all harmonic relationships, visualizing the music of the spheres.');
    expect(rows[4][1]).toBe('22 Shravana, “To Hear”. Its deity: Vishnu, preserver of the universe. Its symbol: ear, or three footprints. Its ruling planet: Moon.');
    await expect(section.getByText(HOW, { exact: true })).toBeVisible();
    await expect(section.locator('[data-evidence="design"]'), 'the scan note: Design choice').toContainText('Design choice');
    await expect(section.getByText(/It now plays on/), 'its own crystal: no moved note').toHaveCount(0);
    // Its place: after the info rows' list, inside the dialog.
    const after = await info.evaluate((d) => {
      const s = d.querySelector('[data-testid="track-info-reading"]')!;
      const firstDl = d.querySelector('dl')!;
      return !!(firstDl.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) && !s.contains(firstDl);
    });
    expect(after, 'after the info rows').toBe(true);
    // The long Judgment wraps: nothing wider than the dialog.
    const over = await section.evaluate((s) => s.scrollWidth - s.clientWidth);
    expect(over, 'no sideways overflow at phone width').toBeLessThanOrEqual(1);
    await closeInfo(page);
    expect(dialogs).toEqual([]);
  });

  test('SR2. a track Deep Scan hasn’t read (assigned, or no crystal): the Scan line; one it couldn’t read: its own line; no reading rows', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await seeded(page);
    for (const [name, line] of [['tone-0002', UNSCANNED], ['tone-0004', UNSCANNED], ['tone-0007', FAILED]] as const) {
      const info = await openInfo(page, name);
      const section = info.getByTestId('track-info-reading');
      await expect(section.getByRole('heading', { level: 3, name: 'What it says' })).toBeVisible();
      await expect(info.getByTestId('track-info-reading-none'), name).toHaveText(line);
      await expect(section.locator('dl'), `${name}: no rows`).toHaveCount(0);
      await expect(section.locator('blockquote')).toHaveCount(0);
      await expect(section.getByText(/It now plays on/), `${name}: no moved line`).toHaveCount(0);
      await closeInfo(page);
    }
    expect(dialogs).toEqual([]);
  });

  test('SR3. a scanned track a spread moved: the reading is its scan crystal’s (174, not 4566), with the line saying where Assign placed it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await seeded(page);
    const info = await openInfo(page, 'tone-0003');
    const section = info.getByTestId('track-info-reading');
    const rows = await readingRows(page);
    expect(rows.map((r) => r[0])).toEqual(LABELS);
    expect(rows[0][1]).toMatch(/^174 Hz · The Circle · Foundation/);
    expect(rows[2][1]).toMatch(/^8 Holding Together/);
    expect(rows[4][1]).toMatch(/^1 Ashwini, “The Horsemen”\./);
    await expect(section.getByText(MOVED_BY_ASSIGN, { exact: true })).toBeVisible();
    await closeInfo(page);
    expect(dialogs).toEqual([]);
  });

  test('SR4. Copy: the reading after the rows with its tags in words (the scanned track); the moved line for the spread one; nothing added for an unscanned or unreadable one', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await seeded(page);
    const one = await copied(page, 'tone-0001');
    const at = one.indexOf('\n\nWhat it says (Tradition)\n');
    expect(at, 'the reading follows the rows, after a blank line').toBeGreaterThan(0);
    expect(one.slice(0, at)).toMatch(/^tone-0001\n/);
    expect(one.slice(at + 2).split('\n')).toEqual([
      'What it says (Tradition)',
      'Scanned as: 4566 Hz · The Chorus · Soul star',
      '  In the Aetheria framework, the first transpersonal gate: the soul star.',
      'In the cube: HEAD layer, palace 4, south-east, Wood, ☴ Xun',
      'Hexagram: 45 Gathering Together',
      expect.stringMatching(/^ {2}“In \(the state denoted by\) Žhui, the king will repair to his ancestral temple\..*advantageous\.”$/),
      '  The Judgment, in James Legge’s translation.',
      'Geometry: Harmonic Web. The interconnected web of all harmonic relationships, visualizing the music of the spheres.',
      'Moon mansion: 22 Shravana, “To Hear”. Its deity: Vishnu, preserver of the universe. Its symbol: ear, or three footprints. Its ruling planet: Moon.',
      `${HOW} (Design choice)`,
    ]);
    const moved = await copied(page, 'tone-0003');
    expect(moved).toContain('\n\nWhat it says (Tradition)\nScanned as: 174 Hz · The Circle · Foundation\n');
    expect(moved).toContain(`\n${MOVED_BY_ASSIGN}\n${HOW} (Design choice)`);
    for (const name of ['tone-0002', 'tone-0007']) {
      const none = await copied(page, name);
      expect(none, `${name}: Copy unchanged`).not.toContain('What it says');
      expect(none).not.toContain(UNSCANNED);
      expect(none).not.toContain(FAILED);
    }
    expect(dialogs).toEqual([]);
  });

  test('SR5. the desktop: the same section in the Track info dialog at 1280 × 800, nothing wider than it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialogs = await seeded(page);
    const info = await openInfo(page, 'tone-0001');
    const section = info.getByTestId('track-info-reading');
    await expect(section.getByRole('heading', { level: 3, name: 'What it says' })).toBeVisible();
    expect((await readingRows(page)).map((r) => r[0])).toEqual(LABELS);
    const over = await info.evaluate((d) => {
      const s = d.querySelector('[data-testid="track-info-reading"]') as HTMLElement;
      return Math.max(s.scrollWidth - s.clientWidth, s.getBoundingClientRect().right - d.getBoundingClientRect().right);
    });
    expect(over, 'inside the dialog').toBeLessThanOrEqual(1);
    await closeInfo(page);
    expect(dialogs).toEqual([]);
  });

  test('SR6. review round 1: the record Deep Scan writes today (crystalSource "scan") reads too; the codex’s geometry lines, with no health words (1692, 5274)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await seeded(page);
    for (const [name, label, geometry] of [
      ['tone-0005', /^1692 Hz · The Edge · /, 'Fibonacci Spiral. The spiral of nature based on the Golden Ratio, found in galaxies and shells.'],
      ['tone-0006', /^5274 Hz · The Temple · /, 'Healing Mandala. Complex circular patterns representing the journey from fragmentation to wholeness.'],
    ] as const) {
      const info = await openInfo(page, name);
      const rows = await readingRows(page);
      expect(rows.map((r) => r[0]), name).toEqual(LABELS);
      expect(rows[0][1]).toMatch(label);
      expect(rows[3][1], `${name}: the codex's line`).toBe(geometry);
      const text = (await info.getByTestId('track-info-reading').textContent()) ?? '';
      expect(text, `${name}: no DNA`).not.toContain('DNA');
      expect(text, `${name}: no "and healing"`).not.toContain('and healing');
      await closeInfo(page);
    }
    expect(dialogs).toEqual([]);
  });

  test('SR7. review round 1: with Experimental scan scores on, the reading comes before the scores, in the dialog and in Copy', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await seeded(page, { scores: true });
    const info = await openInfo(page, 'tone-0001');
    await expect(info.getByTestId('track-info-scores')).toBeVisible();
    const order = await info.evaluate((d) => {
      const r = d.querySelector('[data-testid="track-info-reading"]')!;
      const s = d.querySelector('[data-testid="track-info-scores"]')!;
      return !!(r.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order, 'the reading, then the scores').toBe(true);
    await closeInfo(page);
    const t = await copied(page, 'tone-0001');
    const reading = t.indexOf('\n\nWhat it says (Tradition)\n');
    const scores = t.indexOf('\n\nExperimental scan scores\n');
    expect(reading, 'the reading in Copy').toBeGreaterThan(0);
    expect(scores, 'the scores after it, a blank line between').toBeGreaterThan(reading);
    expect(t.slice(reading, scores).trimEnd().endsWith(`${HOW} (Design choice)`), 'the reading ends before the scores').toBe(true);
    expect(dialogs).toEqual([]);
  });
});
