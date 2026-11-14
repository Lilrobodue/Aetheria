// e2e/tests/dna-out.spec.ts (v16.10, DNA out; Joe's call, 14 Nov 2026: nothing about DNA in anything the app shows)
//
// The Guide's words rule, Advanced's line under the scan-scores switch, and the screens a user sees with the scores on
// (a Library row's badge, Track info's scores) never say DNA; the score is the Tone-set score. (The Guide's 528 crystal:
// evidence.spec and guide.spec.)
// Each fails on v16.9.1, which still says DNA in all of them.

import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { tab, openLibraryTab, rowMenu, PHONE_VIEWPORT } from './helpers';
import { moreRow, moreView, playingSeeded } from './moreKit';

async function openMorePage(page: Page, view: 'safety' | 'advanced'): Promise<void> {
  await tab(page, 'more');
  await page.getByTestId('more').waitFor();
  if ((await moreView(page)) !== 'root') await tab(page, 'more');
  await moreRow(page, `more-${view}-row`).click();
  await expect.poll(() => moreView(page)).toBe(view);
}

test.describe('DNA out (v16.10)', () => {
  test('DO1. How sure are we? › The words we use: "We don’t say a sound heals or cures.", the rest as it was; no DNA in the section', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await playingSeeded(page, 3);
    await openMorePage(page, 'safety');
    await page.getByTestId('safety-how-sure-row').click();
    await expect.poll(() => moreView(page)).toBe('guide');
    const how = page.getByTestId('how-sure');
    await expect(how).toBeVisible();
    const words = how.locator('section[aria-labelledby="how-sure-words"]');
    await expect(words).toContainText('We don’t say a sound heals or cures. Where a tradition teaches that, we write “Traditionally associated with …” and tag it Tradition. Nothing in Aetheria is a treatment; for a health concern, see a qualified professional.');
    await expect(how).not.toContainText('DNA');
    await expect(words, 'the rule names no claim it rules out').not.toContainText('pineal');
    expect(dialogs).toEqual([]);
  });

  test('DO2. Advanced: the line under the scan-scores switch names the tone-set scores; with the scores on, a row’s badge reads "Tones" and Track info says "Tone-set score", never DNA', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(PHONE_VIEWPORT);
    const dialogs = await playingSeeded(page, 3, { patch: [{ index: 0, scanned: true, fractal: { goldenRatioAlignment: 0.75, pattern111Presence: 0.55, dnaResonanceScore: 0.65 } }] });
    await openMorePage(page, 'advanced');
    const row = page.getByTestId('advanced-scan-scores');
    await expect(row).toContainText("Deep Scan's golden-ratio, 111 and tone-set scores, on Library rows and in Track info.");
    await expect(page.getByTestId('more')).not.toContainText('DNA');
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await openLibraryTab(page);
    const badge = page.locator('[data-scan-badge="dna"]').first();
    await expect(badge).toHaveText('Tones');
    await expect(page.getByTestId('tab-library')).not.toContainText('DNA');
    await rowMenu(page, 'tone-0001').click();
    await page.getByTestId('library-menu-info').click();
    const info = page.getByTestId('track-info-dialog');
    await expect(info.getByTestId('track-info-scores')).toContainText('Tone-set score');
    await expect(info.getByTestId('track-info-scores')).toContainText('A level read at a fixed list of tones, some of them Solfeggio');
    await expect(info).not.toContainText('DNA');
    expect(dialogs).toEqual([]);
  });
});
