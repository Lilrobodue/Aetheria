import { createHash } from 'node:crypto';
import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  PHONE_VIEWPORT, acceptDisclaimer, libraryState, openApp, openHarmonicControl, openLibraryTab, openSafety, openSeededNewLayout, libraryRowButton,
  seedLibraryRecords, tab, sheet, rowOf, closeSafetyPanel, phoneSize,
} from './helpers';
import { moreRow, moreView, openMorePage, DISCLAIMER_KEY } from './moreKit';
import { domScan, domFailures, shot } from './copyKit';

// v16.6, the DOM gate (spec §5.8, §6.3 copy-dom.spec): check:copy's rule on the rendered screens of both layouts, for
// what the static scan can't see (one-word data labels, data rendered inside a tagged block, text built at run time).
// On every screen, each visible text node, inline run, title, aria-label and placeholder with a gate word sits in a
// [data-evidence] block with a visible tag, or matches an allow-list entry for that word inside the entry's dom.scope
// (scripts/copy-allow.json, the static gate's own file); D2: no unit holds a RETIRED phrase (scripts/copy-words.mjs).
// Review C1: 5274 Hz (its geometry, "Healing Mandala · Healing", kept with a Tradition tag by decision 8) is visited in
// both layouts: classic's status pills and the new layout's Crystal sheet. D3: the safety statement's words are unchanged (decision 4 A) and an
// acceptance of '2026-10-21' still holds: no re-show. Synthetic tones only. Dev server.

const WORDING_PIN = 'e11c6705b97a'; // disclaimer.spec's pin: v16.6 does not change the statement
const DISCLAIMER_VERSION = '2026-10-21';

/** The DOM gate over the page now: no untagged, unallowed hit and no retired phrase. */
async function gate(page: Page, where: string, seen: string[]): Promise<void> {
  const hits = await domScan(page);
  const bad = domFailures(hits);
  seen.push(`${where}: ${hits.length} hit(s)`);
  expect(bad.map((h) => `${h.kind} ${h.words.join('/')}${h.retired.length ? ` retired[${h.retired.join('; ')}]` : ''}: ${h.text}`), `${where}`).toEqual([]);
}

/** High experimental scores, so every badge and score row shows. */
const SCORES = { goldenRatioAlignment: 0.82, pattern111Presence: 0.66, dnaResonanceScore: 0.74, sacredGeometryAlignment: 0.4, schumannResonanceHarmony: 0.3, infiniteOrderHarmonics: [176.5, 353, 529.5], safetyLevel: 'SAFE', recommendedVolume: 0.3 };

test.describe('classic', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('D1c/D2c. classic: the first-run statement, the tutorial, the Guidebook (both views), Harmonic Control at Expert, the Journal, the Frequency Lab, Safety, the readout, the diagnostics and Links: every hit tagged or allowed, no retired phrase', async ({ page }) => {
    test.setTimeout(300_000);
    const seen: string[] = [];
    await seedLibraryRecords(page, 3, { real: 3, seconds: 20, crystals: 'all', patch: [{ index: 0, scanned: true, fractal: SCORES }, { index: 1, scanned: true, fractal: SCORES }, { index: 2, crystal: 5274 }] });
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('__e2eCopyDom') === null) {
          sessionStorage.setItem('__e2eCopyDom', '1');
          localStorage.setItem('aetheria.layerEngine.v1', 'classic');
        }
      } catch {}
    });
    await page.goto('/');
    // The first-run statement (fresh storage), with the Links panel mounted behind it.
    await expect(page.getByRole('button', { name: /I understand, let me begin/ })).toBeVisible();
    await gate(page, 'the first-run statement', seen);
    await page.getByRole('button', { name: /I understand, let me begin/ }).click();
    // The tutorial (first run): its six steps.
    const tutorial = page.getByRole('button', { name: 'Next', exact: true });
    for (let step = 1; step <= 6; step++) {
      await gate(page, `the tutorial, step ${step}`, seen);
      if (step < 6) await tutorial.click();
    }
    await page.getByRole('button', { name: /^Start/ }).last().click().catch(() => {});
    await acceptDisclaimer(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(3);
    // The library rows (badges with scores) and the drawer.
    await gate(page, 'the library', seen);
    // The Guidebook, both views (the whole scroller is in the DOM).
    await page.locator('aside').getByRole('button', { name: /The Guidebook/ }).click();
    await gate(page, 'the Guidebook, Plain', seen);
    await page.getByRole('button', { name: 'Technical', exact: true }).first().click();
    await gate(page, 'the Guidebook, Technical', seen);
    await page.keyboard.press('Escape');
    // Harmonic Control at Expert (every order shows), and the Journal's start and end forms.
    await openHarmonicControl(page);
    await page.getByRole('combobox', { name: 'Experience level' }).selectOption('expert');
    await gate(page, 'Harmonic Control (Expert)', seen);
    await shot(page, 'classic-harmonic-expert');
    await page.getByRole('button', { name: /Start Experience Documentation/ }).click();
    await gate(page, 'the Journal’s start form', seen);
    await page.getByRole('button', { name: 'Start Documenting', exact: true }).click();
    await gate(page, 'the Journal, documenting', seen);
    // A note, so ending the session opens its end form (ExperienceTracker shows it only with notes).
    await page.getByPlaceholder('Add observation or note...').fill('a test note');
    await page.getByPlaceholder('Add observation or note...').press('Enter');
    await page.getByRole('button', { name: 'End Session', exact: true }).click();
    await gate(page, 'the Journal’s end form', seen);
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.reload();
    await acceptDisclaimer(page);
    // The Frequency Lab.
    await page.getByTitle('Advanced Frequency Selection').click();
    await gate(page, 'the Frequency Lab', seen);
    await page.reload();
    await acceptDisclaimer(page);
    // Safety.
    await openSafety(page);
    await gate(page, 'Safety', seen);
    await page.getByRole('button', { name: 'Close Safety Panel' }).evaluate((b) => (b as HTMLButtonElement).click());
    // The readout (a scanned track with scores) and the diagnostics.
    await rowOf(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await closeSafetyPanel(page);
    await page.getByRole('button', { name: /Current Track/ }).click();
    const readout = page.getByRole('dialog', { name: 'Current track analysis', exact: true });
    await expect(readout).toBeVisible();
    await gate(page, 'the readout', seen);
    await expect(readout).toContainText("Deep Scan's reading");
    await expect(readout).toContainText('EXPERIMENTAL SCAN SCORES');
    await expect(readout).toContainText('COMFORT:');
    await expect(readout).not.toContainText('EXCELLENT');
    await expect(readout).not.toContainText('Safety Level');
    await readout.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('button', { name: /Library\s*Diagnostics/ }).click();
    const diag = page.getByRole('dialog', { name: 'Library diagnostics', exact: true });
    await expect(diag).toBeVisible();
    await expect(diag).toContainText('DNA resonance score over 30 %');
    await gate(page, 'the diagnostics', seen);
    await diag.getByRole('button', { name: 'Close', exact: true }).first().click();
    // Review C1: a 5274 Hz track: the status pills name its geometry ("Healing", title "Healing Mandala …"), so the
    // row is a Tradition block with a visible tag.
    await rowOf(page, 'tone-0003').click();
    const pills = page.locator('[data-evidence="tradition"]').filter({ has: page.getByText('Healing', { exact: true }) });
    await expect(pills).toHaveCount(1, { timeout: 20_000 });
    await expect(pills.locator('[data-evidence-tag="tradition"]')).toBeVisible();
    await gate(page, 'the status pills at 5274 Hz', seen);
    await shot(page, 'classic-pills-5274');
    // Links.
    await page.getByTitle('Links & Resources').click();
    await gate(page, 'Links', seen);
    test.info().annotations.push({ type: 'classic screens', description: seen.join(' · ') });
  });
});

test.describe('new layout', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  // On a device the fixture sizes the page as a desktop and test.use's viewport never reaches the phone's own context.
  test.beforeEach(async ({ page }) => phoneSize(page));

  test('D1n/D2n. the new layout: Now Playing, the Crystal sheet (528, 519 with Perfect GUT, 111, 5274), the Sound, Walks and Up next sheets, Layers, Mixes, Library and Track info with scores, the Mix builder with a score filter, More and every page, the Record sheet and the tour: every hit tagged or allowed, no retired phrase', async ({ page }) => {
    test.setTimeout(300_000);
    const seen: string[] = [];
    await openSeededNewLayout(page, 6, { real: 2, seconds: 30, patch: [{ index: 0, scanned: true, fractal: SCORES }, { index: 2, scanned: true, fractal: SCORES }] });
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0001').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 20_000 }).toBe(true);
    await tab(page, 'now');
    await gate(page, 'Now Playing', seen);
    // The Crystal sheet: 528, then 519 under Perfect GUT, then 111, then 5274 (review C1: its Healing Mandala, tagged).
    for (const pick of ['528', 'perfect', '111', '5274']) {
      await page.getByTestId('chip-crystal').click();
      const crystal = sheet(page, 'Crystal');
      await expect(crystal).toBeVisible();
      if (pick === 'perfect') {
        await crystal.getByRole('switch', { name: 'Lo Shu Perfect GUT', exact: true }).click();
        await crystal.getByTestId('crystal-519').click();
      } else await crystal.getByTestId(`crystal-${pick}`).click();
      await page.getByTestId('chip-crystal').click();
      await expect(sheet(page, 'Crystal')).toBeVisible();
      await gate(page, `the Crystal sheet (${pick})`, seen);
      if (pick === '5274') {
        const block = sheet(page, 'Crystal').locator('[data-evidence="tradition"]').filter({ hasText: 'Healing Mandala' });
        await expect(block.first()).toBeVisible();
        await expect(block.first().locator('[data-evidence-tag="tradition"]')).toBeVisible();
      }
      if (pick === 'perfect') await sheet(page, 'Crystal').getByRole('switch', { name: 'Lo Shu Perfect GUT', exact: true }).click();
      await page.keyboard.press('Escape');
    }
    // The Sound, Walks and Up next sheets.
    await page.getByTestId('chip-layers').click();
    await gate(page, 'the Sound sheet', seen);
    await page.keyboard.press('Escape');
    await page.getByTestId('np-walks').click();
    await gate(page, 'the Walks sheet', seen);
    await page.keyboard.press('Escape');
    if (await page.getByTestId('np-upnext').isVisible().catch(() => false)) {
      await page.getByTestId('np-upnext').click();
      await gate(page, 'Up next', seen);
      await page.keyboard.press('Escape');
    }
    // Layers (every section is in the DOM), Mixes.
    await tab(page, 'layers');
    await gate(page, 'Layers', seen);
    await tab(page, 'mixes');
    await gate(page, 'Mixes', seen);
    // Advanced: the scan scores on, then Library (the badges) and Track info (its scores section).
    await openMorePage(page, 'advanced');
    await gate(page, 'More › Advanced', seen);
    await page.getByRole('switch', { name: 'Show experimental scan scores', exact: true }).click();
    await openLibraryTab(page);
    await gate(page, 'Library, with the scan scores', seen);
    // Decisions 11 and 13: the Mix builder with the DNA resonance score filter: its chip is tagged Design choice, the
    // mix's name (the footer) says "Experimental resonance score".
    await tab(page, 'mixes');
    await page.getByTestId('mixes-create').click();
    await page.getByTestId('builder-filters-button').click();
    const fsheet = page.getByTestId('builder-filter-sheet');
    await fsheet.getByTestId('builder-filters-experimental-toggle').click();
    await fsheet.locator('[data-facet="x-dna"][data-value="over"]').click();
    await gate(page, 'the builder’s filter sheet (DNA resonance score)', seen);
    await fsheet.getByTestId('builder-filters-done').click();
    await expect(page.getByTestId('builder-chips-block').locator('[data-evidence-tag="design"]')).toBeVisible();
    await expect(page.getByTestId('builder-name')).toContainText('Experimental resonance score over 30 %');
    await expect(page.getByTestId('builder-name')).not.toContainText('DNA');
    await gate(page, 'the Mix builder (DNA resonance score)', seen);
    await shot(page, 'new-builder-dna-chip');
    await tab(page, 'now');
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByTestId('menu-track-info').click();
    await expect(page.getByTestId('track-info-dialog')).toBeVisible();
    await gate(page, 'Track info', seen);
    await page.getByTestId('track-info-dialog').getByRole('button', { name: 'Close', exact: true }).first().click();
    // More and every page.
    for (const view of ['safety', 'statement', 'about', 'links', 'journal'] as const) {
      await openMorePage(page, view);
      await gate(page, `More › ${view}`, seen);
    }
    await openMorePage(page, 'guide');
    await gate(page, 'More › Guide, Plain', seen);
    await page.getByTestId('guide-view-technical').click();
    await gate(page, 'More › Guide, Technical', seen);
    await tab(page, 'more');
    if ((await moreView(page)) !== 'root') await tab(page, 'more');
    await gate(page, 'More', seen);
    // The Record sheet.
    await moreRow(page, 'more-record-row').click();
    await gate(page, 'the Record sheet', seen);
    await expect(page.getByText('Choose a recording mode.', { exact: true })).toBeVisible();
    await expect(page.getByText(/to prevent crashes/)).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The tour's four cards.
    await openMorePage(page, 'about');
    await page.getByTestId('about-tour-row').click();
    const tour = page.getByTestId('tour');
    await expect(tour).toBeVisible();
    for (let card = 1; card <= 4; card++) {
      await gate(page, `the tour, card ${card}`, seen);
      if (card < 4) await tour.getByRole('button', { name: /Next/ }).click();
    }
    await shot(page, 'new-tour-card4');
    test.info().annotations.push({ type: 'new-layout screens', description: seen.join(' · ') });
  });
});

test('D3. the statement: its words hash to the unchanged pin, and an acceptance of 2026-10-21 holds across the upgrade (no re-show)', async ({ page }) => {
  // A second browser context (the returning user) can't be made on a device: Android Chrome can't set its window bounds.
  // The statement's words and its acceptance are the same on every engine; the desktop run checks them.
  test.skip(ON_DEVICE, 'a second browser context: not on Android Chrome (the desktop run checks the statement)');
  await page.addInitScript(() => localStorage.setItem('aetheria_v3_tutorial_seen', 'true'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /I understand, let me begin/ })).toBeVisible();
  const words = await page.getByTestId('disclaimer').evaluate((root) => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    }
    return parts.join(' ');
  });
  expect(createHash('sha256').update(words).digest('hex').slice(0, 12), 'the statement is unchanged (decision 4 A)').toBe(WORDING_PIN);
  // A returning user: the acceptance as the live origin stores it.
  const context = await page.context().browser()!.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const p2 = await context.newPage();
  try {
    await p2.addInitScript(({ key, version }) => {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      if (localStorage.getItem(key) === null) localStorage.setItem(key, version);
    }, { key: DISCLAIMER_KEY, version: DISCLAIMER_VERSION });
    await p2.goto(new URL('/', page.url()).toString());
    await p2.getByTitle('Safety Protocols', { exact: true }).waitFor();
    await p2.waitForTimeout(1500);
    await expect(p2.getByRole('button', { name: /I understand, let me begin/ }), 'no re-show for an accepted 2026-10-21').toHaveCount(0);
  } finally {
    await context.close();
  }
});
