// e2e/tests/summit.spec.ts (v16.9.1, The Summit; the user's decisions, 14 Nov 2026)
//
// Deep Scan's rule gives 6336 Hz now (a measured 6318–6363 Hz); a track it read on 396 before then moves to 6336 as the
// library loads, quietly and with no rescan; nothing Assign or a spread placed moves. The tone heard still folds: 6336
// on the v2 sound plays at 792 Hz. All of it fails on v16.9 (the tracks stay on 396, the tone 396 Hz).

import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openSeededNewLayout, openLibraryTab, rowMenu, libraryRowButton, layersState, metaRecords, PHONE_VIEWPORT } from './helpers';

/** Six tracks:
 *  - tone-0001: Deep Scan read 6340 Hz and kept it on 396, an older record's shape (its scan fields, no crystalSource);
 *  - tone-0002: the same at 6330 Hz, the shape Deep Scan writes today (crystalSource 'scan');
 *  - tone-0003: read at 6300 Hz, on 3150 (outside the band: stays);
 *  - tone-0004: read at 6340 Hz, then a spread placed it on 528 (Assign's: stays on 528);
 *  - tone-0005: assigned to 396, never scanned (stays);
 *  - tone-0006: (review round 1) read at 6340 Hz, an older record an older Auto-Distribute re-stored on Deep Scan's own
 *    396 (its own score, 12.5, as the deviation): moves to 6336, read as Deep Scan's own, no moved line. */
async function seeded(page: Page): Promise<string[]> {
  const dialogs = await openSeededNewLayout(page, 6, {
    real: 6,
    seconds: 40,
    patch: [
      { index: 0, crystal: 396, scanned: true, fields: { harmonicFreq: 6340, harmonicDeviation: 6340 - 396 } },
      { index: 1, crystal: 396, fields: { crystalSource: 'scan', harmonicFreq: 6330, harmonicDeviation: 6330 - 396 } },
      { index: 2, crystal: 3150, fields: { crystalSource: 'scan', harmonicFreq: 6300, harmonicDeviation: 6300 - 3150 } },
      { index: 3, crystal: 528, fields: { crystalSource: 'assigned', harmonicFreq: 6340, harmonicDeviation: 1000 + (6340 - 528) } },
      { index: 4, crystal: 396 },
      { index: 5, crystal: 396, scanned: true, fields: { harmonicFreq: 6340, harmonicDeviation: 12.5 } },
    ],
  });
  await openLibraryTab(page);
  return dialogs;
}

const info = (page: Page) => page.getByRole('dialog', { name: 'Track info', exact: true });

/** Track info's Crystal row and the reading's "Scanned as" row (null without a reading), for a track. */
async function crystalRows(page: Page, name: string): Promise<{ crystal: string; scannedAs: string | null; moved: string | null; none: string | null }> {
  await rowMenu(page, name).click();
  await page.getByTestId('library-menu-info').click();
  await expect(info(page)).toBeVisible();
  const r = await info(page).evaluate((d) => {
    const row = (root: Element | null, label: string) => {
      if (!root) return null;
      const dt = [...root.querySelectorAll('dl > div > dt')].find((x) => x.textContent === label);
      return dt ? (dt.parentElement!.querySelector('dd')!.textContent ?? '') : null;
    };
    const reading = d.querySelector('[data-testid="track-info-reading"]');
    const moved = reading ? [...reading.querySelectorAll('p')].map((p) => p.textContent ?? '').find((t) => t.startsWith('It now plays on')) ?? null : null;
    return { crystal: row(d, 'Crystal') ?? '', scannedAs: row(reading, 'Scanned as'), moved, none: d.querySelector('[data-testid="track-info-reading-none"]')?.textContent ?? null };
  });
  await info(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(info(page)).toHaveCount(0);
  return r;
}

test.describe('The Summit (v16.9.1)', () => {
  test('SU1. on load, the tracks Deep Scan read near 6336 Hz move from 396 to 6336, The Summit (both record shapes); outside the band, a spread placement and an assigned track stay', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await seeded(page);
    for (const name of ['tone-0001', 'tone-0002', 'tone-0006']) {
      const r = await crystalRows(page, name);
      expect(r.crystal, `${name}: its Crystal row`).toMatch(/^6336 Hz · HEAD/);
      expect(r.scannedAs, `${name}: read as The Summit`).toMatch(/^6336 Hz · The Summit · /);
      expect(r.moved, `${name}: on its own crystal, no moved line`).toBeNull();
    }
    const out = await crystalRows(page, 'tone-0003');
    expect(out.crystal, 'tone-0003 (6300 Hz): stays').toMatch(/^3150 Hz · HEART/);
    expect(out.scannedAs).toMatch(/^3150 Hz · The Garden · /);
    const spread = await crystalRows(page, 'tone-0004');
    expect(spread.crystal, 'tone-0004: Assign placed it, it stays').toMatch(/^528 Hz · GUT/);
    expect(spread.scannedAs, 'its reading is its scan crystal’s: The Summit').toMatch(/^6336 Hz · The Summit · /);
    expect(spread.moved).toBe('It now plays on 528 Hz, where Assign placed it; the reading follows the crystal its scan gave.');
    const assigned = await crystalRows(page, 'tone-0005');
    expect(assigned.crystal, 'tone-0005: assigned, stays').toMatch(/^396 Hz · GUT/);
    expect(assigned.scannedAs).toBeNull();
    expect(assigned.none).toBe('Scan this track (Library › Deep Scan) to read what its crystal holds.');
    expect(dialogs).toEqual([]);
  });

  test('SU2. a track moved to 6336 plays its tone folded: 792 Hz on the v2 sound (headphones), not 6336 and not 396', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await seeded(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await layersState(page))?.requested?.tone_hz ?? 0, { timeout: 20_000, message: 'the v2 tone for 6336' }).toBe(792);
    expect(dialogs).toEqual([]);
  });

  test('SU3. the move is saved (the stored record says 6336 once the restored library is saved) and holds after a reload', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await seeded(page);
    expect((await crystalRows(page, 'tone-0001')).crystal).toMatch(/^6336 Hz · HEAD/);
    // Review round 1: saved, not only re-read each load (the save as the load gate reopens).
    const stored = async (name: string) => (await metaRecords(page)).find((m) => m.name === name)?.closestSolfeggio ?? null;
    await expect.poll(() => stored('tone-0001'), { timeout: 20_000, message: 'tone-0001 stored on 6336' }).toBe(6336);
    expect(await stored('tone-0002'), 'tone-0002 stored on 6336').toBe(6336);
    expect(await stored('tone-0006'), 'tone-0006 (re-stored) stored on 6336').toBe(6336);
    expect(await stored('tone-0004'), 'the spread one stored on 528').toBe(528);
    expect(await stored('tone-0003'), 'the 6300 Hz one stored on 3150').toBe(3150);
    await page.reload();
    await openLibraryTab(page);
    await expect(rowMenu(page, 'tone-0001')).toBeVisible({ timeout: 20_000 });
    const again = await crystalRows(page, 'tone-0001');
    expect(again.crystal, 'after a reload').toMatch(/^6336 Hz · HEAD/);
    expect(again.scannedAs).toMatch(/^6336 Hz · The Summit · /);
    expect((await crystalRows(page, 'tone-0004')).crystal, 'the spread one still on 528').toMatch(/^528 Hz · GUT/);
    expect(dialogs).toEqual([]);
  });
});
