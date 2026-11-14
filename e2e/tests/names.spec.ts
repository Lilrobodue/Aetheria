// e2e/tests/names.spec.ts (v16.11, the 27 names; Joe and Alisha's 13 Nov answers, the review page "The 27 Names",
// all four recommendations taken on 14 Nov 2026). The app's one list of names (crystalCopy) is the codex's (Divination
// data/tones.json `name`); the script name leads with the function name on a labelled line (1 A); five lines that
// described another tone's new name read their paragraph's own sentence (2 A); the Guide's 6336 texts no longer call
// The Summit a corner or Completion (3 A); the Lo Shu cube's cells read the same list (4 A).
// Each test fails on v16.10.1 (the old names, the corner, the cube's own list).

import { type Locator, type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openSeededNewLayout, openApp, tab, phoneSize } from './helpers';
import { moreRow, moreView, textNodes } from './moreKit';

async function openGuideTechnical(page: Page): Promise<Locator> {
  await tab(page, 'more');
  await page.getByTestId('more').waitFor();
  if ((await moreView(page)) !== 'root') await tab(page, 'more');
  await moreRow(page, 'more-guide-row').click();
  await expect.poll(() => moreView(page)).toBe('guide');
  await page.getByTestId('guide-view-technical').click();
  const content = page.getByTestId('guide-content');
  await content.waitFor();
  return content;
}
async function classicTechnical(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /The Guidebook/ }).click();
  await page.getByRole('button', { name: 'Technical', exact: true }).first().click();
  const content = page.locator('div.custom-scrollbar').filter({ hasText: 'THE MASTER FREQUENCY ARCHITECTURE v3.0' }).first();
  await content.waitFor();
  return content;
}

/** A Guide card's title (its h5) and the labelled line under it, by the card's "N Hz" heading. */
async function card(content: Locator, hz: number): Promise<{ title: string; fn: string; text: string }> {
  // The card is the nearest box around its own "N Hz" heading (the h5's card), never an outer container.
  const heads = content.locator('h5').locator('xpath=..').filter({ has: content.page().locator(`span.font-mono:text-is("${hz} Hz")`) });
  await expect(heads, `one card for ${hz} Hz`).toHaveCount(1);
  return heads.evaluate((el) => ({
    title: el.querySelector('h5')?.textContent?.trim() ?? '',
    fn: el.querySelector('[data-testid="guide-card-function"]')?.textContent?.trim() ?? '',
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }));
}

const CARDS: ReadonlyArray<[number, string, string]> = [
  [174, 'The Circle', 'Foundation'], [396, 'The Storm', 'Liberating Fear & Guilt'], [741, 'The Spark', 'Awakening'], [852, 'The Still Point', 'Intuition'],
  [1692, 'The Edge', 'Unified Field Access'], [2178, 'The Source', 'Compassion Activation'], [3150, 'The Garden', 'Heart Completion'],
  [4566, 'The Chorus', 'Soul Star Connection'], [4920, 'The Vastness', 'Expressive Truth'], [6336, 'The Summit', 'SOURCE Embodiment'],
];

async function checkGuide(content: Locator, where: string): Promise<void> {
  // 1 A: every one of the 27 cards leads with its script name and labels its function name.
  await expect(content.getByTestId('guide-card-function'), `${where}: 27 labelled lines`).toHaveCount(27);
  for (const [hz, script, fn] of CARDS) {
    const c = await card(content, hz);
    expect(c.title, `${where}: ${hz}'s card title`).toBe(script);
    expect(c.fn, `${where}: ${hz}'s labelled line`).toBe(`Function name: ${fn}`);
  }
  // 2 A: the five lines.
  expect((await card(content, 1692)).text).toContain('In the Aetheria framework, the heart reaching past the body’s boundary, its power held steady.');
  expect((await card(content, 3150)).text).toContain('In the Aetheria framework, the heart’s work grown to its full height.');
  expect((await card(content, 4920)).text).toContain('In the Aetheria framework, awareness wide enough to hold the truth and gentle enough to say it.');
  // 3 A: The Summit is not a corner, and not "Completion".
  const all = (await textNodes(content)).join('\n');
  for (const gone of ['OUTERMOST VERTEX', 'outermost vertex', 'corner of the cube', 'returns home through this corner', 'Completion of the Ascent']) expect(all, `${where}: no "${gone}"`).not.toContain(gone);
  expect(all).toContain('THE SUMMIT · LAST OF THE 27');
  expect(all).toContain('6336 Hz — The Summit');
  expect((await card(content, 6336)).text).toContain('The last of the 27 and the top of the climb; a mirror number reducing to 9. The path that began at 174 Hz ends here;');
  // 4 A: the cube's cells read the same list (their hover names), the Perfect layer with its "+".
  for (const [hz, name] of [[396, 'Liberating Fear & Guilt'], [741, 'Awakening'], [852, 'Intuition'], [1692, 'Unified Field Access'], [6336, 'SOURCE Embodiment']] as const) {
    await expect(content.locator(`[title^="Play ${hz} Hz — "]`).first(), `${where}: the ${hz} cell`).toHaveAttribute('title', new RegExp(`^Play ${hz} Hz — ${name.replace(/[&+]/g, '\\$&')} \\(root`));
  }
  await expect(content.getByTestId('loshu-cell-names').first()).toContainText("Cell names: each tone's function name, as in the Guide.");
  // The Perfect GUT layer (review round 1): its six counterparts carry "+", its 741, 852 and 963 (the Solfeggio crystals
  // themselves) don't.
  await content.getByRole('button', { name: 'Lo Shu Perfect (75–963)', exact: true }).click();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [hz, name] of [[75, 'Foundation+'], [297, 'Liberating Fear & Guilt+'], [630, 'Connecting Relationships+'], [741, 'Awakening'], [852, 'Intuition'], [963, 'Divine Consciousness']] as const) {
    await expect(content.locator(`[title^="Play ${hz} Hz — "]`).first(), `${where}: the Perfect ${hz} cell`).toHaveAttribute('title', new RegExp(`^Play ${hz} Hz — ${esc(name)} \\(root`));
  }
  await content.getByRole('button', { name: 'Solfeggio (174–963)', exact: true }).click();
}

test.describe('the 27 names (v16.11)', () => {
  test('N1. the crystal meaning block (Layers › Crystal, as the Crystal sheet): the script name leads, "Function name: …" under it; a Perfect counterpart keeps its one name', async ({ page }) => {
    test.setTimeout(120_000);
    await phoneSize(page);
    await openSeededNewLayout(page, 6);
    await tab(page, 'layers');
    const block = page.getByTestId('crystal-meaning-section');
    await page.getByTestId('layers-crystal-tile').scrollIntoViewIfNeeded();
    for (const [hz, script, fn] of [[852, 'The Still Point', 'Intuition'], [741, 'The Spark', 'Awakening'], [1692, 'The Edge', 'Unified Field Access'], [4920, 'The Vastness', 'Expressive Truth']] as const) {
      await page.getByTestId(`crystal-${hz}`).first().click();
      await expect(block.getByTestId('crystal-meaning-title'), `${hz}`).toHaveText(`${hz} Hz · ${script}`);
      await expect(block.getByTestId('crystal-meaning-function'), `${hz}`).toHaveText(`Function name: ${fn}`);
    }
    await expect(block.getByTestId('crystal-meaning-association')).toHaveText('In the Aetheria framework, awareness wide enough to hold the truth and gentle enough to say it.');
    // A Lo Shu Perfect counterpart has no script name of its own.
    await page.getByTestId('crystal-417').first().click();
    await page.getByRole('switch', { name: 'Lo Shu Perfect GUT', exact: true }).first().click();
    await page.getByTestId('crystal-408').first().click();
    await expect(block.getByTestId('crystal-meaning-title')).toHaveText('408 Hz · Facilitating Change');
    await expect(block.getByTestId('crystal-meaning-function')).toHaveCount(0);
  });

  test('N2. the new layout\'s Guide (Technical): the 27 cards, the five lines, The Summit\'s texts, the cube\'s names', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSeededNewLayout(page, 3);
    await checkGuide(await openGuideTechnical(page), 'the Guide');
  });

  test('N3. classic\'s Guidebook (Technical): the same', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await checkGuide(await classicTechnical(page), 'classic');
  });
});
