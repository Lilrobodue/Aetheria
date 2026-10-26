import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  cacheCounts,
  libraryRow,
  libraryRowButton,
  libraryState,
  openLibraryTab,
  openSeededNewLayout,
  phoneSize,
  startWalk,
  undoToast,
  PHONE_VIEWPORT,
} from './helpers';

// v15.7, the Library tab at 5,000 tracks (seeded straight into IndexedDB: helpers.seedLibraryRecords). The list is
// virtualized (64 px rows, overscan 6): it mounts a screen of rows whatever the library's size, reaches both ends,
// searches and sorts without a long task, and a row tap from a walk plays all 5,000 and comes back with Undo, the stored
// library untouched. The dev server; the production numbers are e2e/library-budget.mjs's.

const N = 5000;
const CRY = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
const nameOf = (i: number) => `tone-${String(i + 1).padStart(4, '0')}`;

const mountedRows = (page: Page) => page.getByTestId('library-row').count();

async function setScroll(page: Page, f: (sc: HTMLElement, list: HTMLElement) => number): Promise<void> {
  await page.evaluate((src) => {
    const sc = document.querySelector('[data-testid="library-scroll"]') as HTMLElement;
    const list = document.querySelector('[data-testid="library-list"]') as HTMLElement;
    // eslint-disable-next-line no-new-func
    sc.scrollTop = new Function('sc', 'list', `return (${src})(sc, list);`)(sc, list);
  }, f.toString());
}

/** Names of the mounted rows, in list order. */
async function rowNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="library-row"]'))
      .map((r) => ({ pos: Number(r.getAttribute('aria-posinset')), name: r.querySelector('[data-row-title]')?.textContent ?? '' }))
      .sort((a, b) => a.pos - b.pos)
      .map((r) => r.name)
  );
}

/** Long tasks (> 50 ms) from now on, in window.__longTasks. */
async function watchLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__longTasks = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  });
}

test.describe('5,000 tracks', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('1. at 5,000 the tab mounts at most 30 rows; the end shows tone-5000 at 5000; a jump to the middle shows its rows within two frames', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = await openSeededNewLayout(page, N, { real: 30 });
    await phoneSize(page);
    await openLibraryTab(page);
    await expect(page.getByTestId('library-row').first()).toHaveAttribute('aria-setsize', String(N));
    expect(await mountedRows(page), 'rows mounted at the top').toBeLessThanOrEqual(30);
    expect(await page.getByTestId('library-list').evaluate((el) => el.getBoundingClientRect().height)).toBe(N * 64);
    await setScroll(page, (sc) => sc.scrollHeight);
    await expect(libraryRow(page, 'tone-5000')).toHaveAttribute('aria-posinset', String(N));
    expect(await mountedRows(page), 'rows mounted at the end').toBeLessThanOrEqual(30);
    // A jump to the middle: within two frames the rows around tone-2500 are there.
    const shown = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const sc = document.querySelector('[data-testid="library-scroll"]') as HTMLElement;
          const list = document.querySelector('[data-testid="library-list"]') as HTMLElement;
          sc.scrollTop = list.offsetTop + 2499 * 64 - 200;
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(Array.from(document.querySelectorAll('[data-testid="library-row"] [data-row-title]')).map((e) => e.textContent ?? ''))
            )
          );
        })
    );
    expect(shown, 'tone-2500 within two frames').toContain('tone-2500');
    expect(shown.length).toBeLessThanOrEqual(30);
    expect(dialogs).toEqual([]);
  });

  test('2. at 5,000 a search for tone-4999 shows exactly one row; tone-1 lists its 1,000 (n × 64 px)', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = await openSeededNewLayout(page, N, { real: 10 });
    await phoneSize(page);
    await openLibraryTab(page);
    const field = page.getByTestId('library-search');
    await field.fill('tone-4999');
    await expect(page.getByTestId('library-summary')).toHaveText('1 of 5000 tracks matches · a tap plays your whole library from that track');
    expect(await rowNames(page)).toEqual(['tone-4999']);
    await field.fill('tone-1');
    const want = Array.from({ length: N }, (_, i) => nameOf(i)).filter((n) => n.includes('tone-1')).length;
    await expect(page.getByTestId('library-summary')).toContainText(`${want} of 5000 tracks match`);
    expect(await page.getByTestId('library-list').evaluate((el) => el.getBoundingClientRect().height)).toBe(want * 64);
    expect(await mountedRows(page)).toBeLessThanOrEqual(30);
    expect(dialogs).toEqual([]);
  });

  test('3. at 5,000 Name and Crystal sort to the right first and last rows, with no long task over 200 ms for the switch', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = await openSeededNewLayout(page, N, { real: 10 });
    await phoneSize(page);
    await openLibraryTab(page);
    const sort = page.getByRole('combobox', { name: 'Sort', exact: true });
    const firstAndLast = async () => {
      await setScroll(page, () => 0);
      await page.waitForTimeout(150);
      const first = (await rowNames(page))[0];
      await setScroll(page, (sc) => sc.scrollHeight);
      await page.waitForTimeout(150);
      const names = await rowNames(page);
      return [first, names[names.length - 1]];
    };
    await watchLongTasks(page);
    await sort.selectOption('name');
    expect(await firstAndLast()).toEqual(['tone-0001', 'tone-5000']);
    await sort.selectOption('crystal');
    // Lowest crystal first, ties in library order; the highest last.
    const lastHigh = Array.from({ length: N }, (_, i) => i).filter((i) => CRY[i % 27] === 6336).pop()!;
    expect(await firstAndLast()).toEqual(['tone-0001', nameOf(lastHigh)]);
    const tasks: number[] = await page.evaluate(() => (window as any).__longTasks);
    test.info().annotations.push({ type: 'long tasks (ms)', description: JSON.stringify(tasks) });
    expect(Math.max(0, ...tasks), 'no long task over 200 ms').toBeLessThanOrEqual(200);
    expect(dialogs).toEqual([]);
  });

  test('4. at 5,000 a row tap from a 27-step walk plays the library (5,000); Undo brings the walk back; the stored counts never change', async ({ page }) => {
    test.setTimeout(300_000);
    const dialogs = await openSeededNewLayout(page, N, { real: 30, crystals: 'real' });
    await phoneSize(page);
    const base = await cacheCounts(page);
    expect([base.blobs, base.meta, base.library]).toEqual([N, N, N]);
    await startWalk(page, 'C');
    const walk = await libraryState(page);
    expect(walk.ids.length).toBe(27);
    await openLibraryTab(page);
    const name = walk.current === 'tone-0010' ? 'tone-0011' : 'tone-0010';
    await setScroll(page, (sc, list) => list.offsetTop + 10 * 64 - 200);
    await libraryRowButton(page, name).click();
    await expect.poll(async () => { const s = await libraryState(page); return [s.ids.length, s.current, s.walk]; }, { timeout: 20_000 }).toEqual([N, name, null]);
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => { const s = await libraryState(page); return [s.ids, s.cursor, s.walk]; }, { timeout: 20_000 }).toEqual([walk.ids, walk.cursor, 'C']);
    await page.waitForTimeout(2600);
    const after = await cacheCounts(page);
    expect([after.blobs, after.meta, after.library, after.libraryRaw]).toEqual([base.blobs, base.meta, base.library, base.libraryRaw]);
    expect(dialogs).toEqual([]);
  });
});
