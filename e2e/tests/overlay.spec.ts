import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { expectCache, importTones, openApp, rowOf } from './helpers';

// v15.4's modal Dialog (components/ui/Dialog.tsx) and the shared overlay stack (components/ui/overlayStack.ts): focus
// stays inside the dialog (Tab and Shift+Tab wrap), Escape and the scrim close it, focus goes back to what opened it,
// and the rest of the app (#root) is inert meanwhile. The stack joins v15.0.1's "one Escape, one overlay" rule: an
// Escape that closes a dialog never also reaches the output question or the layers popover under it.

const diagnosticsButton = (page: Page) => page.locator('aside').getByRole('button', { name: /^Library\s*Diagnostics/ });
const diagnostics = (page: Page) => page.getByRole('dialog', { name: 'Library diagnostics', exact: true });
const rootInert = (page: Page) => page.evaluate(() => (document.getElementById('root') as HTMLElement & { inert: boolean }).inert);
/** Whether the focused element is inside the open dialog (either role). */
const focusInDialog = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return !!a && !!a.closest('[role="dialog"][aria-modal="true"],[role="alertdialog"]');
  });

test('1. focus stays in the dialog, Escape closes it and focus goes back; #root is inert meanwhile', async ({ page }) => {
  const dialogs = await openApp(page);
  await diagnosticsButton(page).click();
  await expect(diagnostics(page)).toBeVisible();
  expect(await focusInDialog(page), 'focus moves into the dialog').toBe(true);
  expect(await rootInert(page), '#root is inert while the dialog is open').toBe(true);

  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await focusInDialog(page), `Tab ${i + 1}`).toBe(true);
  }
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInDialog(page), `Shift+Tab ${i + 1}`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(diagnostics(page)).toHaveCount(0);
  await expect(diagnosticsButton(page), 'focus goes back to the button that opened it').toBeFocused();
  expect(await rootInert(page), '#root after').toBe(false);
  expect(dialogs).toEqual([]);
});

test('2. the scrim closes a readout, and on the delete dialog it is Cancel', async ({ page }) => {
  const dialogs = await openApp(page);
  await diagnosticsButton(page).click();
  await expect(diagnostics(page)).toBeVisible();
  await page.mouse.click(5, 5); // outside the centred panel: the scrim
  await expect(diagnostics(page)).toHaveCount(0);

  await importTones(page, 2, 20);
  await expectCache(page, { blobs: 2, library: 2 });
  await rowOf(page, 'tone-01').getByTitle('Delete song').click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete this track?' });
  await expect(confirm).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(confirm).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(page.getByText('tone-01', { exact: true })).toHaveCount(1);
  await expectCache(page, { blobs: 2, library: 2 });
  expect(dialogs).toEqual([]);
});

test('3. one Escape closes the dialog and leaves the output question under it; the next one answers the question', async ({ page }) => {
  const dialogs = await openApp(page, { engine: 'default' });
  await importTones(page, 1, 60);
  await page.getByText('tone-01', { exact: true }).first().click();
  const sheet = page.getByTestId('output-sheet');
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  await diagnosticsButton(page).click();
  await expect(diagnostics(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(diagnostics(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(sheet, 'the question is still open after the first Escape').toBeVisible();

  await page.keyboard.press('Escape'); // the question's "Ask me later"
  await expect(sheet).toHaveCount(0);
  expect(dialogs).toEqual([]);
});
