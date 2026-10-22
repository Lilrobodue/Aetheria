import { createHash } from 'node:crypto';
import { test, expect } from './fixtures';
import { openApp, openSafety } from './helpers';

// The launch disclaimer's acceptance is saved per wording version (v14.6):
// it shows on first launch, then only when its wording changes.
const KEY = 'aetheria.disclaimer.v1';
const VERSION = '2026-10-21'; // v15.0's driving line (before it, '2026-04-16')
// SHA-256 (first 12 hex) of the disclaimer's words (text nodes trimmed, joined by spaces).
// v15.0: the new driving line, then the old line's heavy-machinery half as its own sentence (with the old driving
// line: '82eec8662a12'; the new line alone, never shipped: 'd5c39f327152').
const WORDING_PIN = 'e11c6705b97a';

const acceptButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /I understand, let me begin/ });
const stored = (page: import('@playwright/test').Page) => page.evaluate((k) => localStorage.getItem(k), KEY);

test('the disclaimer shows on first launch, stays accepted, and shows again for new wording', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
    // The Nov 2025 key accepted an older wording; it must not count.
    localStorage.setItem('aetheria_v3_disclaimer', 'true');
    // Flags any disclaimer that appears at all, even for one frame.
    (window as any).__disclaimerShown = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="disclaimer"]')) (window as any).__disclaimerShown = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  await expect(acceptButton(page)).toBeVisible();
  expect(await stored(page)).toBeNull();
  await acceptButton(page).click();
  await expect(acceptButton(page)).toHaveCount(0);
  expect(await stored(page)).toBe(VERSION);

  // Accepted: not even a flash on the next launch.
  await page.reload();
  await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
  await expect(acceptButton(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__disclaimerShown)).toBe(false);

  // An acceptance of other wording doesn't count.
  await page.evaluate((k) => localStorage.setItem(k, 'older-wording'), KEY);
  await page.reload();
  await expect(acceptButton(page)).toBeVisible();
  await acceptButton(page).click();
  expect(await stored(page)).toBe(VERSION);
  expect(errors).toEqual([]);
});

test('the disclaimer shows on every launch when storage is blocked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // React reports an error thrown in a click handler with reportError: it
  // shows up as a console error, not as an uncaught page error.
  page.on('console', (m) => {
    // (The suite blocks service workers, so the app logs a [SW] registration error.)
    if (m.type() === 'error' && !m.text().startsWith('[SW]')) errors.push(m.text());
  });
  // As when the browser blocks site storage: every read and write throws.
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
      (Storage.prototype as any)[method] = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
    }
  });
  await page.goto('/');
  await expect(acceptButton(page)).toBeVisible();
  await acceptButton(page).click();
  await expect(acceptButton(page)).toHaveCount(0);
  await page.reload();
  await expect(acceptButton(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('the disclaimer wording is unchanged (or its version was bumped)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aetheria_v3_tutorial_seen', 'true'));
  await page.goto('/');
  await expect(acceptButton(page)).toBeVisible();
  // The words only: each text node trimmed, empty ones dropped, so layout and
  // line breaks in the JSX don't move the pin.
  const words = await page.getByTestId('disclaimer').evaluate((root) => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    }
    return parts.join(' ');
  });
  const pin = createHash('sha256').update(words).digest('hex').slice(0, 12);
  expect(
    pin,
    'The disclaimer wording changed: bump DISCLAIMER_VERSION in App.tsx (it then shows once more), and update VERSION and WORDING_PIN here.'
  ).toBe(WORDING_PIN);
});

test('the disclaimer can be read again from Safety Protocols', async ({ page }) => {
  await openApp(page); // accepts it
  const accepted = await stored(page);
  await openSafety(page);
  await page.getByRole('button', { name: 'Read the disclaimer' }).click();
  await expect(acceptButton(page)).toBeVisible();
  await acceptButton(page).click();
  await expect(acceptButton(page)).toHaveCount(0);
  expect(await stored(page)).toBe(accepted);
});
