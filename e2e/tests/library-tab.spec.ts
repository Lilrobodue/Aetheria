import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import { planAssign, assignConfirmText, assignNeedsConfirm } from '../../utils/mix/distribution.ts';
import {
  addFiles,
  cacheCounts,
  countLibraryDeletes,
  crash,
  drawsPerSecond,
  libraryRow,
  libraryRowButton,
  libraryState,
  layersState,
  libraryUndo,
  metaRecords,
  newShell,
  openNewLayout,
  openLibraryTab,
  openSeededNewLayout,
  pauseCount,
  peekClassicLibrary,
  phoneSize,
  recordHudDraws,
  recordLiveDecodes,
  recordMediaMetadata,
  renders,
  resetRenders,
  rowMenu,
  savedState,
  sheet,
  shrinkSavedLibrary,
  startWalk,
  tab,
  tapAt,
  toneWav,
  undoToast,
  acceptDisclaimerNew,
  LIBRARY_SORT_KEY,
  PHONE_VIEWPORT,
  type CrashView,
  type LibraryState,
} from './helpers';

// v15.7, the Library tab (new layout): always the whole library, a search and a sort, a virtualized list, a row tap that
// makes the library the play order from that track (in the list's sort; first in a fresh shuffle under shuffle) with a
// 10 s Undo, the row menu (Play from here, Track info, Delete), the health card (Assign, Analyse, Deep Scan, Review) and
// the Import sheet with "Recover N tracks". A tap, its Undo, a sort and a search never write the library or delete
// audio (check:writers pins the writers; test 13 counts the stores). Synthetic tones only (tone-NNNN), seeded straight
// into IndexedDB as an earlier session would have saved them (helpers.seedLibraryRecords).

const ANCHOR_UA = /Android|iPhone|iPad|Mobile/i;
const DRAWING = 8;

/** Over the next 2 s the music plays on: time ≥ 1.5 s on, no pause(), the card still playing (layout.spec's check,
 *  through the dev hook's element time). */
async function expectMusicPlaysOn(page: Page, label: string): Promise<void> {
  const before = await libraryState(page);
  const pauses = await pauseCount(page);
  const title = await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null);
  await page.waitForTimeout(2000);
  const after = await libraryState(page);
  expect.soft((after.t ?? 0) - (before.t ?? 0), `${label}: the music moved on`).toBeGreaterThanOrEqual(1.5);
  expect.soft(after.playing, `${label}: playing`).toBe(true);
  expect.soft(await pauseCount(page), `${label}: no pause() meanwhile`).toBe(pauses);
  expect.soft(await page.evaluate(() => navigator.mediaSession.playbackState), `${label}: the card says playing`).toBe('playing');
  expect.soft(await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null), `${label}: the card's title is unchanged`).toBe(title);
}

/** From the next load on, every change of the mini-player's title as { t, title } in window.__miniTitles. */
async function recordMiniTitles(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { t: number; title: string | null }[] = ((window as any).__miniTitles = []);
    let last: string | null | undefined;
    const check = () => {
      const el = document.querySelector('[data-testid="mini-title"]');
      const title = el ? el.textContent : null;
      if (title !== last) {
        last = title;
        log.push({ t: performance.now(), title });
      }
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

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

/** Scroll the list so the row at `index` (of the list as shown) is mounted and in view. */
async function revealIndex(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    const sc = document.querySelector('[data-testid="library-scroll"]') as HTMLElement;
    const list = document.querySelector('[data-testid="library-list"]') as HTMLElement;
    sc.scrollTop = Math.max(0, list.offsetTop + i * 64 - 120);
  }, index);
}

/** The row's play button, scrolling the (virtualized) list until the row is mounted. */
async function findRow(page: Page, name: string): Promise<Locator> {
  const btn = libraryRowButton(page, name);
  if ((await btn.count()) > 0) return btn;
  const st = await libraryState(page);
  const guess = st.libraryNames.indexOf(name);
  if (guess >= 0) {
    await revealIndex(page, guess);
    if (await btn.waitFor({ timeout: 1500 }).then(() => true, () => false)) return btn;
  }
  const n = await page.getByTestId('library-list').evaluate((el) => Math.round(el.getBoundingClientRect().height / 64));
  for (let i = 0; i < n; i += 6) {
    await revealIndex(page, i);
    if (await btn.waitFor({ timeout: 300 }).then(() => true, () => false)) return btn;
  }
  await btn.waitFor();
  return btn;
}

/** Open a row's menu (its ⋯), scrolling the list to the row first. */
async function openRowMenu(page: Page, name: string): Promise<void> {
  await findRow(page, name);
  await rowMenu(page, name).click();
}

/** A finger tap on a row (tapAt: Playwright's touchscreen here, real CDP touches on a phone), or a click. */
async function tapRow(page: Page, name: string, o: { touch?: boolean } = {}): Promise<void> {
  const btn = await findRow(page, name);
  await btn.scrollIntoViewIfNeeded();
  if (o.touch) {
    const box = (await btn.boundingBox())!;
    await tapAt(page, box.x + 80, box.y + box.height / 2);
  } else {
    await btn.click();
  }
}

/** A finger tap at a control's centre. */
async function tapOn(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await tapAt(page, box.x + box.width / 2, box.y + box.height / 2);
}

/** Wait until the play order's current track is `name` and playing past `after` s. */
async function expectPlaying(page: Page, name: string, after = 0.2, timeout = 20_000): Promise<LibraryState> {
  await expect
    .poll(async () => { const s = await libraryState(page); return s.current === name && s.playing && (s.t ?? 0) > after; }, { message: `${name} plays`, timeout })
    .toBe(true);
  return libraryState(page);
}

/** The rows' names in list order (the mounted ones). */
async function rowNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="library-row"]'))
      .map((r) => ({ pos: Number(r.getAttribute('aria-posinset')), name: r.querySelector('[data-row-title]')?.textContent ?? '' }))
      .sort((a, b) => a.pos - b.pos)
      .map((r) => r.name)
  );
}

/** Every row's name in list order, scrolling the list through (it is virtualized). */
async function allRowNames(page: Page, n: number): Promise<string[]> {
  const byPos = new Map<number, string>();
  for (let i = 0; i < n; i += 4) {
    await revealIndex(page, i);
    await page.waitForTimeout(80);
    const got = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="library-row"]')).map(
        (r) => [Number(r.getAttribute('aria-posinset')), r.querySelector('[data-row-title]')?.textContent ?? ''] as [number, string]
      )
    );
    for (const [p, name] of got) byPos.set(p, name);
  }
  return Array.from({ length: n }, (_, i) => byPos.get(i + 1) ?? '?');
}

/** A row to tap that is not the walk's current track (tone-0010 unless it is, else tone-0011), and its library index. */
function pickTap(before: LibraryState): { name: string; index: number } {
  const name = before.current === 'tone-0010' ? 'tone-0011' : 'tone-0010';
  return { name, index: before.libraryNames.indexOf(name) };
}

const canvasDisplay = (page: Page) => page.evaluate(() => getComputedStyle(document.getElementById('viz-canvas')!).display);
const search = (page: Page) => page.getByTestId('library-search');
const sortSelect = (page: Page) => page.getByRole('combobox', { name: 'Sort', exact: true });
const summary = (page: Page) => page.getByTestId('library-summary');
const healthLine = (page: Page, id: string) => page.getByTestId(`health-${id}-line`);
const healthAction = (page: Page, id: string) => page.getByTestId(`health-${id}-action`);
const nextOnNowPlaying = (page: Page) => page.getByTestId('view-now').getByRole('button', { name: 'Next track', exact: true });

/** v15.8: the plan Assign will make for the library as seeded (seedLibraryRecords stores a crystal as harmonicFreq =
 *  closestSolfeggio with deviation 3, an assigned crystal; the ids are random per run, so the plan is computed). */
async function seededPlan(page: Page) {
  const s = await libraryState(page);
  if (s.origins.some((o) => o !== 'assigned' && o !== 'none')) throw new Error('seededPlan: only for seeded (assigned) crystals');
  const lib = s.libraryIds.map((id, i) => ({
    id, name: s.libraryNames[i], duration: s.libraryDurations[i] ?? undefined,
    ...(s.crystals[i] ? { closestSolfeggio: s.crystals[i] as number, ...(s.scanned[i] ? { harmonicFreq: s.crystals[i] as number } : {}), harmonicDeviation: 3 } : {}),
  }));
  const log = console.log;
  console.log = () => {};
  try { return planAssign(lib); } finally { console.log = log; }
}

// On the phone the page fixture sets the desktop runs' size (fixtures.ts), and test.use's viewport doesn't reach a
// CDP-connected page: each describe's own size is applied here instead, as phoneSize does in the other specs.
test.beforeEach(async ({ page, viewport }) => {
  if (ON_DEVICE && viewport) await page.setViewportSize(viewport);
});

// ---------------------------------------------------------------------------------------------------------------
// 1-6: the tab, search and sort
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('1. the header, the search row, the summary, the health card and every library track while a walk plays; the visuals pause behind it and resume on Now Playing @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await recordHudDraws(page);
    const dialogs = await openSeededNewLayout(page, 30);
    await phoneSize(page);
    await startWalk(page, 'C');
    await page.evaluate(() => ((document.getElementById('viz-canvas') as any).__e2eMark = 'v157'));
    await openLibraryTab(page);
    const t = page.getByTestId('tab-library');
    await expect(t.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
    await expect(t.getByText('Beta', { exact: true })).toBeVisible();
    await expect(page.getByTestId('library-import')).toHaveText('Import');
    await expect(search(page)).toHaveAttribute('placeholder', 'Search 30 tracks');
    await expect(sortSelect(page)).toHaveValue('library');
    await expect(summary(page)).toHaveText('30 tracks · 20 min · Playing from Lo Shu walk · Vortex');
    await expect(page.getByTestId('library-health')).toBeVisible();
    await expect(page.getByText('The new Library is coming in a later beta')).toHaveCount(0);
    // Every library track, each id once (the list is virtualized: scroll it through).
    const seen = new Set<string>();
    for (let i = 0; i < 30; i += 6) {
      await revealIndex(page, i);
      await page.waitForTimeout(100);
      for (const id of await page.locator('[data-testid="library-row"]').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-row-id')!))) seen.add(id);
    }
    const s = await libraryState(page);
    expect([...seen].sort(), 'every library track is listed, each once').toEqual([...s.libraryIds].sort());
    expect(s.ids.length, 'the walk is the play order').toBe(27);
    await expect(page.getByTestId('library-row').first()).toHaveAttribute('aria-setsize', '30');
    // The visuals pause behind the solid tab, and resume on Now Playing on the same canvas.
    await expect.poll(async () => Math.max(...(await drawsPerSecond(page, 1))), { message: 'the visualizer stops', timeout: 10_000, intervals: [0] }).toBe(0);
    expect.soft(await drawsPerSecond(page, 2), '0.0 draws/s behind the tab').toEqual([0, 0]);
    expect.soft(await canvasDisplay(page)).toBe('none');
    await tab(page, 'now');
    await expect.poll(async () => Math.min(...(await drawsPerSecond(page, 1))), { message: 'the visualizer draws again', timeout: 10_000, intervals: [0] }).toBeGreaterThanOrEqual(DRAWING);
    expect(await page.evaluate(() => (document.getElementById('viz-canvas') as any).__e2eMark), 'the same canvas').toBe('v157');
    expect(dialogs).toEqual([]);
  });

  test('2. while a 27-step walk plays over a 30-track library the tab lists all 30; classic’s drawer still lists the walk', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await phoneSize(page);
    await startWalk(page, 'C');
    await openLibraryTab(page);
    await expect(page.getByTestId('library-row').first()).toHaveAttribute('aria-setsize', '30');
    expect(await page.getByTestId('library-list').evaluate((el) => el.getBoundingClientRect().height), 'n × 64 px').toBe(30 * 64);
    await revealIndex(page, 29);
    await expect(libraryRow(page, 'tone-0030')).toHaveAttribute('aria-posinset', '30');
    await peekClassicLibrary(page);
    await expect(page.locator('aside').getByText('27 Tracks', { exact: true }), 'classic lists the play order (the walk)').toBeVisible();
    await page.getByTestId('peek-pill').click();
    await expect(page.getByTestId('tab-library')).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('3. search: narrows by name with a match count, no results and Clear search, Escape clears; the query survives a tab switch but not a reload; App never renders while typing', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await phoneSize(page);
    await openLibraryTab(page);
    await page.waitForTimeout(2500); // past the restore's own state changes
    const field = search(page);
    await field.click();
    await resetRenders(page);
    await page.keyboard.type('tone-001', { delay: 120 });
    await expect(summary(page)).toHaveText('10 of 30 tracks match · a tap plays your whole library from that track');
    await page.keyboard.type('7', { delay: 120 });
    await expect(summary(page)).toHaveText('1 of 30 tracks matches · a tap plays your whole library from that track');
    expect(await rowNames(page)).toEqual(['tone-0017']);
    const r = await renders(page);
    test.info().annotations.push({ type: 'renders while typing', description: JSON.stringify(r) });
    expect(r.App ?? 0, 'App renders while typing').toBe(0);
    expect(r.LibraryTab ?? 0, 'the tab renders').toBeGreaterThan(0);
    await expect(field, 'the count describes the field').toHaveAttribute('aria-describedby', 'library-summary-line');
    // A tap while searching plays the WHOLE library from that track, never the matches.
    await tapRow(page, 'tone-0017');
    const st = await expectPlaying(page, 'tone-0017');
    expect([st.ids, st.cursor], 'the whole library, from tone-0017').toEqual([st.libraryIds, 16]);
    // No results, and Clear search.
    await field.fill('xyz');
    await expect(page.getByTestId('library-no-results')).toContainText('No tracks match ‘xyz’');
    await expect(page.getByTestId('library-health'), 'no health card while searching').toHaveCount(0);
    await page.getByTestId('library-no-results').getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(field).toHaveValue('');
    await expect(page.getByTestId('library-row').first()).toHaveAttribute('aria-setsize', '30');
    // Escape with text clears it.
    await field.fill('tone-002');
    await field.press('Escape');
    await expect(field).toHaveValue('');
    // A tab switch keeps the query; a reload doesn't.
    await field.fill('tone-0017');
    await tab(page, 'more');
    await openLibraryTab(page);
    await expect(search(page)).toHaveValue('tone-0017');
    expect(await rowNames(page)).toEqual(['tone-0017']);
    await page.reload();
    await acceptDisclaimerNew(page);
    await openLibraryTab(page);
    await expect(search(page)).toHaveValue('');
    expect(dialogs).toEqual([]);
  });
});

test('4. sort: Library order, Name (numeric-aware), Newest first, Length and Crystal (no crystal last, ties in library order)', async ({ page }) => {
  test.setTimeout(120_000);
  const CRY = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
  const dialogs = await openSeededNewLayout(page, 12, { pad: false, crystals: 'some', real: 2 });
  await openLibraryTab(page);
  const lib = Array.from({ length: 12 }, (_, i) => {
    const num = i + 1;
    return { name: `tone-${num}`, len: i < 2 ? 40 : 150 + ((num * 37) % 240), hz: num % 10 < 7 ? CRY[(num * 7) % 27] : Infinity, i };
  });
  const order = async (sort: string) => {
    await sortSelect(page).selectOption(sort);
    await expect(sortSelect(page)).toHaveValue(sort);
    await page.waitForTimeout(150);
    return allRowNames(page, 12);
  };
  expect(await order('library')).toEqual(lib.map((x) => x.name));
  expect(await order('name'), 'numeric-aware: tone-2 before tone-10').toEqual(['tone-1', 'tone-2', 'tone-3', 'tone-4', 'tone-5', 'tone-6', 'tone-7', 'tone-8', 'tone-9', 'tone-10', 'tone-11', 'tone-12']);
  expect(await order('newest')).toEqual(lib.map((x) => x.name).reverse());
  expect(await order('length')).toEqual([...lib].sort((a, b) => a.len - b.len || a.i - b.i).map((x) => x.name));
  const crystal = await order('crystal');
  expect(crystal, 'crystal: lowest first, ties in library order, none last').toEqual([...lib].sort((a, b) => (a.hz === b.hz ? a.i - b.i : a.hz < b.hz ? -1 : 1)).map((x) => x.name));
  expect(crystal.slice(-3), 'the three without a crystal last').toEqual(['tone-7', 'tone-8', 'tone-9']);
  await expect(page.getByTestId('library-sort')).toContainText('Crystal');
  expect(dialogs).toEqual([]);
});

test.describe('phone, the sort', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('5. the sort decides what plays next (decision 2 A): Name → Next plays the next name; Library order → the play order is the library, "Library · 5 of 8"', async ({ page }) => {
    test.setTimeout(120_000);
    const names = ['tone-05', 'tone-02', 'tone-08', 'tone-01', 'tone-03', 'tone-07', 'tone-04', 'tone-06'];
    const dialogs = await openSeededNewLayout(page, 8, { names });
    await openLibraryTab(page);
    await sortSelect(page).selectOption('name');
    await tapRow(page, 'tone-03');
    let s = await expectPlaying(page, 'tone-03');
    expect(s.names, 'the play order is the library in the list’s order').toEqual([...names].sort());
    expect(s.cursor).toBe(2);
    await expect(page.getByTestId('mini-player')).toContainText('Library 3/8');
    await page.getByTestId('mini-player').getByRole('button', { name: 'Next track', exact: true }).click();
    s = await expectPlaying(page, 'tone-04');
    expect(s.cursor, 'the next NAME (by import it would be tone-07)').toBe(3);
    // Library order: the play order is the library itself.
    await sortSelect(page).selectOption('library');
    await tapRow(page, 'tone-03');
    s = await expectPlaying(page, 'tone-03');
    expect(s.ids, 'the library itself').toEqual(s.libraryIds);
    expect(s.cursor).toBe(4);
    await tab(page, 'now');
    await expect(page.getByTestId('np-source')).toHaveText('Library · 5 of 8');
    await nextOnNowPlaying(page).click();
    await expectPlaying(page, 'tone-07');
    expect(dialogs).toEqual([]);
  });

  test('6. the sort is saved only from the select: absent after a session that never touched it; a junk value reads as Library order', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 12);
    await openLibraryTab(page);
    await search(page).fill('tone-000');
    await search(page).fill('');
    await revealIndex(page, 8);
    await tapRow(page, 'tone-0004');
    await expectPlaying(page, 'tone-0004');
    await tab(page, 'now');
    await openLibraryTab(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), LIBRARY_SORT_KEY), 'never written without the select').toBeNull();
    await sortSelect(page).selectOption('newest');
    expect(await page.evaluate((k) => localStorage.getItem(k), LIBRARY_SORT_KEY)).toBe('newest');
    await page.reload();
    await acceptDisclaimerNew(page);
    await openLibraryTab(page);
    await expect(sortSelect(page)).toHaveValue('newest');
    expect((await rowNames(page))[0]).toBe('tone-0012');
    await page.evaluate((k) => localStorage.setItem(k, 'sideways'), LIBRARY_SORT_KEY);
    await page.reload();
    await acceptDisclaimerNew(page);
    await openLibraryTab(page);
    await expect(sortSelect(page)).toHaveValue('library');
    await expect(page.getByTestId('library-sort')).toContainText('Library order');
    expect((await rowNames(page))[0]).toBe('tone-0001');
    expect(await page.evaluate((k) => localStorage.getItem(k), LIBRARY_SORT_KEY), 'no effect rewrites it').toBe('sideways');
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 7-13: the row tap and its Undo
// ---------------------------------------------------------------------------------------------------------------

/** A walk (Vortex) playing at step 2, a few seconds in; returns its state just before the tap. */
async function walkAtStep2(page: Page, seconds = 4): Promise<void> {
  await startWalk(page, 'C');
  await nextOnNowPlaying(page).click();
  await expect.poll(async () => (await libraryState(page)).cursor, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await libraryState(page)).t ?? 0, { timeout: 20_000 }).toBeGreaterThan(seconds);
}

test.describe('phone, the row tap', () => {
  test.use({ viewport: PHONE_VIEWPORT, hasTouch: true });

  test('7. a row tap during a walk plays the whole library from that track: the order, the cursor, the card and the title name it at once; the toast; the saved state @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await recordMediaMetadata(page);
    await recordMiniTitles(page);
    const dialogs = await openSeededNewLayout(page, 30);
    await phoneSize(page);
    await walkAtStep2(page, 5);
    await openLibraryTab(page);
    const before = await libraryState(page);
    expect(before.walk).toBe('C');
    const tap = pickTap(before);
    const pauses = await pauseCount(page);
    const t0 = await page.evaluate(() => performance.now());
    await tapRow(page, tap.name, { touch: true });
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.ids.length, s.current, s.walk, s.cursor]; }, { message: `the library from ${tap.name}`, timeout: 15_000 })
      .toEqual([30, tap.name, null, tap.index]);
    const s = await expectPlaying(page, tap.name);
    expect(s.ids, 'the play order is the library').toEqual(s.libraryIds);
    expect(s.src, 'the element plays the tapped track: a new source').not.toBe(before.src);
    expect(s.t ?? 99, 'from its start (the walk’s step was past 5 s)').toBeLessThan(before.t ?? 0);
    // Every card title and mini-player title written since the tap names the tapped track: none names the old cursor's.
    await page.waitForTimeout(500);
    const cards = await page.evaluate((t0) => ((window as any).__metaSets as any[]).filter((m) => m.t >= t0).map((m) => m.title), t0);
    const minis = await page.evaluate((t0) => ((window as any).__miniTitles as any[]).filter((m) => m.t >= t0).map((m) => m.title), t0);
    test.info().annotations.push({ type: 'titles since the tap', description: JSON.stringify({ cards, minis }) });
    expect(cards.length, 'the card was re-sent').toBeGreaterThan(0);
    expect([...new Set(cards)], 'every card title since the tap').toEqual([tap.name]);
    expect([...new Set(minis)], 'every mini-player title since the tap').toEqual([tap.name]);
    expect((await pauseCount(page)) - pauses, 'at most playTrack’s one pause()').toBeLessThanOrEqual(1);
    await expect(undoToast(page)).toContainText('Playing your library from this track. The Vortex walk stopped.');
    // The saved state follows (one meta save, as a Next).
    await expect
      .poll(async () => { const st = await savedState(page); return st ? [st.loShuWalkMode, JSON.stringify(st.playlistOrder) === JSON.stringify(s.libraryIds)] : null; }, { timeout: 10_000 })
      .toEqual([null, true]);
    await expectMusicPlaysOn(page, 'after the tap');
    expect(dialogs).toEqual([]);
  });

  test('8. Undo brings back the exact earlier state: the walk, its order, cursor, segments and position, the card; Next goes on through the walk; the saved state @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await phoneSize(page);
    await walkAtStep2(page, 4);
    await openLibraryTab(page);
    const before = await libraryState(page);
    const tap = pickTap(before);
    await tapRow(page, tap.name, { touch: true });
    await expectPlaying(page, tap.name);
    await tapOn(page, undoToast(page).getByRole('button', { name: 'Undo', exact: true }));
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.ids, s.cursor, s.walk, s.segments, s.phases, s.current, s.playing]; }, { message: 'the earlier state', timeout: 15_000 })
      .toEqual([before.ids, before.cursor, before.walk, before.segments, before.phases, before.current, true]);
    await expect.poll(async () => (await libraryState(page)).t ?? 0, { timeout: 10_000 }).toBeGreaterThan(1);
    const back = await libraryState(page);
    expect(Math.abs((back.t ?? 0) - (before.t ?? 0)), `back at its position (${before.t} → ${back.t})`).toBeLessThan(2);
    await expect.poll(() => page.evaluate(() => [navigator.mediaSession.metadata?.title, navigator.mediaSession.playbackState])).toEqual([before.current, 'playing']);
    await expect(undoToast(page), 'the toast goes').toHaveCount(0);
    await page.getByTestId('mini-player').getByRole('button', { name: 'Next track', exact: true }).click();
    await expect.poll(async () => { const s = await libraryState(page); return [s.cursor, s.walk, s.ids.length, s.current]; }).toEqual([before.cursor + 1, 'C', 27, before.names[before.cursor + 1]]);
    await expect.poll(async () => { const st = await savedState(page); return st ? [st.loShuWalkMode, st.playlistOrder.length] : null; }, { timeout: 10_000 }).toEqual(['C', 27]);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, Undo', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('8b. under shuffle the Undo brings back the shuffle order and its position too', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await tab(page, 'now');
    await page.getByTestId('view-now').getByRole('button', { name: 'Shuffle', exact: true }).click();
    await startWalk(page, 'C');
    await expect.poll(async () => (await libraryState(page)).shuffled.length).toBe(27);
    await openLibraryTab(page);
    const before = await libraryState(page);
    await tapRow(page, 'tone-0010');
    await expect.poll(async () => { const s = await libraryState(page); return [s.ids.length, s.shuffled.length, s.shuffled[0], s.shufflePos]; }).toEqual([30, 30, 9, 0]);
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.ids, s.cursor, s.walk, s.shuffled, s.shufflePos]; }, { timeout: 15_000 })
      .toEqual([before.ids, before.cursor, 'C', before.shuffled, before.shufflePos]);
    expect(dialogs).toEqual([]);
  });

  test('8c. a second Undo does nothing; an Undo after another play order says so and changes nothing; after a Clear it does nothing', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await startWalk(page, 'C');
    await openLibraryTab(page);
    await tapRow(page, 'tone-0010');
    await expectPlaying(page, 'tone-0010');
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).walk).toBe('C');
    const afterUndo = await libraryState(page);
    await libraryUndo(page);
    await page.waitForTimeout(800);
    const again = await libraryState(page);
    expect([again.ids, again.cursor, again.walk, again.current], 'a second Undo changes nothing').toEqual([afterUndo.ids, afterUndo.cursor, afterUndo.walk, afterUndo.current]);
    // Another play order since: the Undo refuses and says why. (v15.9: a walk now has its own Undo, so the other play
    // order is classic's Restore Library, which leaves none: a row tapped in the Newest-first list, then Restore.)
    await sortSelect(page).selectOption('newest');
    await tapRow(page, 'tone-0011');
    await expectPlaying(page, 'tone-0011');
    await peekClassicLibrary(page);
    await page.locator('aside').getByRole('button', { name: 'Restore Library', exact: true }).click();
    await expect.poll(async () => { const s = await libraryState(page); return JSON.stringify(s.ids) === JSON.stringify(s.libraryIds); }, { message: 'Restore: the library in its own order', timeout: 10_000 }).toBe(true);
    await page.getByTestId('peek-pill').click();
    const restored = await libraryState(page);
    await libraryUndo(page);
    await expect(page.getByTestId('notices')).toContainText("The play order changed since, so the earlier one can't come back.");
    await page.waitForTimeout(500);
    const still = await libraryState(page);
    expect([still.ids, still.cursor, still.current], 'nothing changed').toEqual([restored.ids, restored.cursor, 'tone-0011']);
    await sortSelect(page).selectOption('library');
    // A Clear since: nothing.
    await openLibraryTab(page);
    await tapRow(page, 'tone-0012');
    await expectPlaying(page, 'tone-0012');
    await peekClassicLibrary(page);
    await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
    await page.getByRole('button', { name: /^Confirm deleting all 30 tracks/ }).click();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 15_000 }).toBe(0);
    // A new library since (two tracks imported): the earlier tap's Undo must not touch its play order.
    await page.getByTestId('peek-pill').click();
    await openLibraryTab(page);
    await page.getByTestId('library-import').click();
    await addFiles(page, [1, 2].map((i) => ({ name: `new-${i}.wav`, mimeType: 'audio/wav', buffer: toneWav(3, 300 + i * 40) })));
    await expect.poll(async () => { const s = await libraryState(page); return [s.libraryIds.length, s.ids.length]; }, { timeout: 15_000 }).toEqual([2, 2]);
    await page.keyboard.press('Escape');
    const fresh = await libraryState(page);
    await libraryUndo(page);
    await page.waitForTimeout(800);
    const cleared = await libraryState(page);
    expect([cleared.ids, cleared.libraryIds], 'after Clear the Undo does nothing').toEqual([fresh.ids, fresh.libraryIds]);
    await expect(page.getByTestId('notices'), 'and says nothing').not.toContainText('The play order changed since');
    expect(dialogs).toEqual([]);
  });

  test('9. Undo when the earlier track was paused: the walk comes back paused and unloaded; Play starts that track from 0', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await startWalk(page, 'C');
    // 20 s in, then paused.
    const seek = page.getByTestId('np-seek');
    await seek.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await libraryState(page)).t ?? 0).toBeGreaterThan(18);
    await page.getByTestId('np-play').click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    const before = await libraryState(page);
    const tap = pickTap(before);
    await openLibraryTab(page);
    await tapRow(page, tap.name);
    await expectPlaying(page, tap.name);
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.ids, s.cursor, s.walk, s.current, s.playing, s.src]; }, { timeout: 15_000 })
      .toEqual([before.ids, before.cursor, 'C', before.current, false, null]);
    await page.getByTestId('mini-player').getByRole('button', { name: 'Play', exact: true }).click();
    const s = await expectPlaying(page, before.current!);
    expect(s.t ?? 99, 'from the start (the pinned resumePlayback has no seek)').toBeLessThan(5);
    expect(dialogs).toEqual([]);
  });

  test('10. Undo after a delete: the walk without the deleted step (its mode ends); with the earlier track deleted, nothing plays', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await walkAtStep2(page, 1);
    const before = await libraryState(page);
    // A walk step after the cursor, not the tapped track.
    const tap = pickTap(before);
    // A walk step before the cursor (step 1, the cursor is on step 2), so the restored cursor moves back by one.
    const gone = [before.names[0], ...before.names.slice(before.cursor + 3)].find((n) => n !== tap.name && n !== before.current)!;
    await openLibraryTab(page);
    await tapRow(page, tap.name);
    await expectPlaying(page, tap.name);
    await revealIndex(page, before.libraryNames.indexOf(gone));
    await openRowMenu(page, gone);
    await page.getByTestId('library-menu-delete').click();
    await page.getByRole('alertdialog', { name: 'Delete this track?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length).toBe(29);
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    const goneId = before.ids[before.names.indexOf(gone)];
    const expectIds = before.ids.filter((id) => id !== goneId);
    const removedBefore = before.ids.slice(0, before.cursor).filter((id) => id === goneId).length;
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.ids, s.cursor, s.walk, s.current]; }, { timeout: 15_000 })
      .toEqual([expectIds, before.cursor - removedBefore, null, before.current]);
    await expectPlaying(page, before.current!);

    // The earlier track itself deleted: the Undo leaves nothing playing.
    await startWalk(page, 'C');
    await nextOnNowPlaying(page).click();
    await expect.poll(async () => (await libraryState(page)).cursor).toBe(1);
    const b2 = await libraryState(page);
    const tap2 = pickTap(b2);
    await openLibraryTab(page);
    await tapRow(page, tap2.name);
    await expectPlaying(page, tap2.name);
    await revealIndex(page, b2.libraryNames.indexOf(b2.current!));
    await openRowMenu(page, b2.current!);
    await page.getByTestId('library-menu-delete').click();
    await page.getByRole('alertdialog', { name: 'Delete this track?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length).toBe(28);
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.cursor, s.playing, s.src, s.walk]; }, { timeout: 15_000 })
      .toEqual([-1, false, null, null]);
    expect(dialogs).toEqual([]);
  });

  test('11. shuffle: the tapped track is first in a fresh shuffle order at position 0, from the library and from a walk; off, no shuffle order', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await tab(page, 'now');
    await page.getByTestId('view-now').getByRole('button', { name: 'Shuffle', exact: true }).click();
    await openLibraryTab(page);
    await tapRow(page, 'tone-0005');
    await expect.poll(async () => { const s = await libraryState(page); return [s.cursor, s.shuffled[0], s.shufflePos, s.shuffled.length]; }).toEqual([4, 4, 0, 30]);
    await tapRow(page, 'tone-0012');
    await expect.poll(async () => { const s = await libraryState(page); return [s.cursor, s.shuffled[0], s.shufflePos, s.shuffled.length]; }).toEqual([11, 11, 0, 30]);
    let s = await libraryState(page);
    expect([...s.shuffled].sort((a, b) => a - b), 'a permutation of the library').toEqual(Array.from({ length: 30 }, (_, i) => i));
    await startWalk(page, 'C');
    await openLibraryTab(page);
    await tapRow(page, 'tone-0007');
    await expect.poll(async () => { const st = await libraryState(page); return [st.ids.length, st.cursor, st.shuffled[0], st.shufflePos, st.shuffled.length, st.walk]; }).toEqual([30, 6, 6, 0, 30, null]);
    s = await libraryState(page);
    expect([...s.shuffled].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    await tab(page, 'now');
    await page.getByTestId('view-now').getByRole('button', { name: 'Shuffle', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).shuffled).toEqual([]);
    expect(dialogs).toEqual([]);
  });

  test('12. a tap on the playing row neither restarts it nor shows a toast; paused, it resumes where it was', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 12);
    await openLibraryTab(page);
    await tapRow(page, 'tone-0003');
    await expectPlaying(page, 'tone-0003', 2);
    await page.waitForTimeout(500);
    const pauses = await pauseCount(page);
    const t1 = (await libraryState(page)).t!;
    await tapRow(page, 'tone-0003');
    await page.waitForTimeout(1200);
    const s = await libraryState(page);
    expect(s.t!, 'it plays on, not from 0').toBeGreaterThan(t1);
    expect(await pauseCount(page), 'no pause()').toBe(pauses);
    await expect(undoToast(page), 'no toast').toHaveCount(0);
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    const tp = (await libraryState(page)).t!;
    await tapRow(page, 'tone-0003');
    await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
    expect((await libraryState(page)).t!, 'resumed where it was').toBeGreaterThanOrEqual(tp - 0.05);
    await expect(undoToast(page)).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, data safety', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('13. data safety: taps, Undo, a sort and a search never change the stored audio, metadata or library, and delete nothing', async ({ page }) => {
    test.setTimeout(240_000);
    await countLibraryDeletes(page);
    const dialogs = await openSeededNewLayout(page, 8);
    const base = await cacheCounts(page);
    const baseOrder = (await savedState(page)).originalOrder as string[];
    expect([base.blobs, base.meta, base.library, base.libraryRaw]).toEqual([8, 8, 8, 8]);
    const check = async (step: string) => {
      await page.waitForTimeout(2600); // past the 2 s metadata debounce
      const c = await cacheCounts(page);
      expect.soft([c.blobs, c.meta, c.library, c.libraryRaw], `${step}: blobs, meta, library, libraryRaw`).toEqual([base.blobs, base.meta, base.library, base.libraryRaw]);
      expect.soft(await page.evaluate(() => (window as any).__idbDeletes), `${step}: no IndexedDB delete or clear`).toBe(0);
      expect.soft((await savedState(page)).originalOrder, `${step}: the saved library order`).toEqual(baseOrder);
      expect.soft((await libraryState(page)).libraryIds, `${step}: the library in memory`).toEqual(baseOrder);
    };
    await startWalk(page, 'C');
    await openLibraryTab(page);
    await tapRow(page, 'tone-0005');
    await expectPlaying(page, 'tone-0005');
    await check('a tap from a walk');
    await libraryUndo(page);
    await expect.poll(async () => (await libraryState(page)).walk).toBe('C');
    const walkBack = await libraryState(page);
    await check('Undo');
    await sortSelect(page).selectOption('newest');
    await tapRow(page, 'tone-0002');
    await expectPlaying(page, 'tone-0002');
    await check('a tap in Newest-first order');
    await search(page).fill('tone-000');
    await search(page).fill('tone-0004');
    await check('a search');
    await search(page).fill('');
    await sortSelect(page).selectOption('crystal');
    await check('a sort change');
    await tapRow(page, 'tone-0007');
    await expectPlaying(page, 'tone-0007');
    await libraryUndo(page);
    // tone-0002's toast was still up (the checks take about 8 s of its 10): one chain, so the Undo goes back to before
    // tone-0002, the walk (test 32).
    await expect.poll(async () => { const s = await libraryState(page); return [s.walk, s.current]; }).toEqual(['C', walkBack.current]);
    await check('a second tap in the chain, Undo');
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await check('paused');
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 14-16: the row menu, Track info, Delete
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone, the row menu', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('14. ⋯ opens the menu named by the track; Escape closes it and focus returns to the ⋯; Play from here = a tap; on the desktop it is modal and centred', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 12);
    await openLibraryTab(page);
    const opener = rowMenu(page, 'tone-0003');
    await opener.click();
    const menu = page.getByRole('dialog', { name: 'tone-0003', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('library-menu-play')).toContainText('Play from here');
    // v16.0: Play next and Add to queue after it (nothing is loaded here, so both go first when Play is pressed).
    await expect(menu.getByTestId('library-menu-next')).toContainText('Play next');
    await expect(menu.getByTestId('library-menu-next')).toContainText('First when you press Play');
    await expect(menu.getByTestId('library-menu-queue')).toContainText('Add to queue');
    await expect(menu.getByRole('button')).toHaveText([/Play from here/, /Play next/, /Add to queue/, /Add to playlist…/, /Track info/, /Delete from library…/, /Cancel/]); // v16.1: Add to playlist…
    await expect(menu.getByTestId('library-menu-info')).toContainText('Track info');
    await expect(menu.getByTestId('library-menu-delete')).toContainText('Delete from library…');
    await expect(menu.getByTestId('library-menu-delete')).toContainText('The original file is not touched.');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(opener, 'focus back on the ⋯').toBeFocused();
    await opener.click();
    await page.getByTestId('library-menu-play').click();
    await expect(page.getByRole('dialog', { name: 'tone-0003' })).toHaveCount(0);
    const s = await expectPlaying(page, 'tone-0003');
    expect([s.ids, s.cursor]).toEqual([s.libraryIds, 2]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('tab-library').waitFor();
    await openRowMenu(page, 'tone-0005');
    const m2 = page.getByRole('dialog', { name: 'tone-0005', exact: true });
    await expect(m2).toHaveAttribute('aria-modal', 'true');
    const box = (await m2.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 640), 'centred').toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - 400), 'centred vertically').toBeLessThan(2);
    await page.keyboard.press('Escape');
    expect(dialogs).toEqual([]);
  });

  test('15. Track info: the crystal and where it came from, the key, visual sync, the file and the date added; an unanalysed track; Copy copies the same rows', async ({ page }) => {
    test.setTimeout(120_000);
    await stubClipboard(page);
    const dialogs = await openSeededNewLayout(page, 8, { crystals: 'none', patch: [{ index: 2, crystal: 528, key: 'Am', confidence: 0.62, visual: true }] });
    await openLibraryTab(page);
    await openRowMenu(page, 'tone-0003');
    await page.getByTestId('library-menu-info').click();
    const info = page.getByRole('dialog', { name: 'Track info', exact: true });
    await expect(info).toBeVisible();
    const rows = async () => info.locator('dl > div').evaluateAll((ds) => ds.map((d) => [d.querySelector('dt')!.textContent, d.querySelector('dd')!.textContent]));
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`; });
    expect(await rows()).toEqual([
      ['Length', '0:40'],
      ['Crystal', '528 Hz · GUTAssigned, not scanned yet. An assigned crystal, not a measured pitch.'],
      ['Key', 'A minor · confidence 0.62From Analyse tracks'],
      ['Visual sync', 'From Analyse tracks'],
      ['File', 'tone-0003.wav · 625 KB'],
      ['Added', today],
    ]);
    await expect(info.getByText('tone-0003', { exact: true })).toBeVisible();
    await info.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(info.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__copied)).toBe(
      ['tone-0003', 'Length: 0:40', 'Crystal: 528 Hz · GUT (Assigned, not scanned yet. An assigned crystal, not a measured pitch.)', 'Key: A minor · confidence 0.62 (From Analyse tracks)', 'Visual sync: From Analyse tracks', 'File: tone-0003.wav · 625 KB', `Added: ${today}`].join('\n')
    );
    await info.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(info).toHaveCount(0);
    await openRowMenu(page, 'tone-0005');
    await page.getByTestId('library-menu-info').click();
    expect((await rows()).slice(1, 4)).toEqual([['Crystal', 'None yet'], ['Key', 'Not analysed yet'], ['Visual sync', 'None yet']]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Track info' })).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('16. Delete: the same confirmation with one new-layout sentence; Cancel keeps it; Delete removes the row, the audio and the metadata and stops the music; classic’s text is unchanged', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openSeededNewLayout(page, 8);
    await openLibraryTab(page);
    await tapRow(page, 'tone-0004');
    await expectPlaying(page, 'tone-0004');
    const ask = page.getByRole('alertdialog', { name: 'Delete this track?' });
    await openRowMenu(page, 'tone-0004');
    await page.getByTestId('library-menu-delete').click();
    await expect(ask).toBeVisible();
    await expect(ask.getByTestId('dialog-body')).toHaveText('"tone-0004" will be removed from your library, and the copy stored on this device deleted. The original file is not touched. It is playing now, so the music stops.');
    await expect(ask.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel takes the first focus').toBeFocused();
    await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(ask).toHaveCount(0);
    await page.waitForTimeout(500);
    expect((await libraryState(page)).libraryIds.length, 'Cancel keeps it').toBe(8);
    await expectPlaying(page, 'tone-0004');
    await openRowMenu(page, 'tone-0004');
    await page.getByTestId('library-menu-delete').click();
    await ask.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(libraryRow(page, 'tone-0004')).toHaveCount(0);
    await expect.poll(async () => { const s = await libraryState(page); return [s.libraryIds.length, s.cursor, s.playing, s.src]; }).toEqual([7, -1, false, null]);
    await expect.poll(async () => { const c = await cacheCounts(page); return [c.blobs, c.meta]; }, { timeout: 10_000 }).toEqual([7, 7]);
    await expect(page.getByTestId('mini-player')).toHaveCount(0);
    await tab(page, 'now');
    await expect(page.getByTestId('np-empty')).toBeVisible();
    // A track in a walk that's playing, not the one playing: the other sentence.
    await startWalk(page, 'C');
    const s = await libraryState(page);
    const other = s.names.find((n) => n !== s.current)!;
    await openLibraryTab(page);
    await openRowMenu(page, other);
    await page.getByTestId('library-menu-delete').click();
    await expect(ask.getByTestId('dialog-body')).toHaveText(`"${other}" will be removed from your library, and the copy stored on this device deleted. The original file is not touched. It also comes out of the list that's playing.`);
    await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
    // Classic: the dialog's text byte for byte as v15.6, even for the playing track.
    await tab(page, 'more');
    await page.getByTestId('more-back-to-classic').click();
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    const cur = (await libraryState(page)).current!;
    await page.locator('div.group').filter({ has: page.getByText(cur, { exact: true }) }).getByTitle('Delete song').evaluate((b) => (b as HTMLElement).click());
    await expect(ask.getByTestId('dialog-body')).toHaveText(`"${cur}" will be removed from your library, and the copy stored on this device deleted. The original file is not touched.`);
    await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 17: the health card (stage B)
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone, the health card', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('17a. Crystals: none anywhere → Assign runs at once and every track has one; some there → it asks first, and Cancel changes nothing', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30, { crystals: 'none' });
    await openLibraryTab(page);
    await expect(healthLine(page, 'crystals')).toHaveText('30 of 30 tracks have none');
    await expect(page.getByTestId('library-health-status')).toHaveText('2 to do');
    await healthAction(page, 'crystals').click();
    await expect(page.getByTestId('assign-dialog'), 'no question when no track has a crystal').toHaveCount(0);
    await expect(healthLine(page, 'crystals')).toHaveText('All 30 tracks have one');
    expect((await libraryState(page)).crystals.every((c) => typeof c === 'number' && c > 0)).toBe(true);
    await peekClassicLibrary(page);
    await expect(page.locator('aside div.group').first().getByText(/^\d+Hz$/), 'classic shows the crystals').toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('17b. Crystals with some already assigned: the confirmation gives the plan’s counts (v15.8); Cancel keeps every crystal; Assign gives the rest one', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30, { crystals: 'some' });
    await openLibraryTab(page);
    const before = (await libraryState(page)).crystals;
    const have = before.filter((c) => c !== null).length;
    await expect(healthLine(page, 'crystals')).toHaveText(`${30 - have} of 30 tracks have none`);
    // The seeded crystals are assigned ones (not a scan): Assign places them anew once, so it asks first.
    const plan = await seededPlan(page);
    expect(assignNeedsConfirm(plan), 'assigned crystals move: it asks').toBe(true);
    await healthAction(page, 'crystals').click();
    const ask = page.getByRole('alertdialog', { name: 'Assign crystals?' });
    await expect(ask).toBeVisible();
    await expect(ask.getByTestId('dialog-body')).toHaveText(assignConfirmText(plan).body);
    await expect(ask).toContainText(`${30 - have} tracks without one get a crystal.`);
    await expect(ask.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(500);
    expect((await libraryState(page)).crystals, 'Cancel changes nothing').toEqual(before);
    await healthAction(page, 'crystals').click();
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(healthLine(page, 'crystals')).toHaveText('All 30 tracks have one');
    expect(dialogs).toEqual([]);
  });

  test('17c. Analyse: the count is countAnalysable’s; the button starts the pass, the card shows its progress, Deep Scan waits, Stop stops it', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30, { real: 30, seconds: 40, crystals: 'some' });
    await openLibraryTab(page);
    await expect(healthAction(page, 'analyse')).toHaveText('Analyse 30');
    await expect(healthLine(page, 'analyse')).toHaveText(/^30 to analyse · /);
    // Slowed (the dev hook's duty, read at the start), so the run outlasts the checks on a fast desktop.
    await page.evaluate(() => (window as any).__aetheriaAnalyse.tune({ duty: 0.02 }));
    await healthAction(page, 'analyse').click();
    await expect.poll(() => page.evaluate(() => (window as any).__aetheriaAnalyse.state().phase), { timeout: 15_000 }).not.toBe('idle');
    await expect(healthLine(page, 'analyse')).toHaveText(/^Analysing \d+ of 30 · /);
    await expect(page.getByTestId('library-health-status')).toHaveText('Analysing…');
    await expect(healthAction(page, 'scan')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('health-scan')).toContainText('Unavailable while Analyse tracks runs');
    await expect(healthAction(page, 'analyse')).toHaveText('Stop');
    await healthAction(page, 'analyse').click();
    await expect.poll(() => page.evaluate(() => (window as any).__aetheriaAnalyse.state().phase), { timeout: 30_000 }).toBe('idle');
    await expect(healthLine(page, 'analyse')).toHaveText(/to analyse · |All analysed/);
    expect(dialogs).toEqual([]);
  });

  test('17d. Deep Scan: the count is scanLibrary’s queue (v15.8: no measurement or no crystal); the assigned ones are offered apart; Scan starts it, Analyse waits, Stop cancels it', async ({ page }) => {
    test.setTimeout(150_000);
    // Two tracks with a crystal but never scanned (no harmonicFreq): the Scan count is scanLibrary's queue, not "no crystal".
    const dialogs = await openSeededNewLayout(page, 30, { crystals: 'some', patch: [{ index: 0, unscanned: true }, { index: 1, unscanned: true }] });
    await openLibraryTab(page);
    const unscanned = (await libraryState(page)).scanned.filter((x) => !x).length;
    expect(unscanned).toBe(11);
    await expect(healthLine(page, 'crystals'), 'nine without a crystal').toHaveText('9 of 30 tracks have none');
    // v15.8 (decision 6): Scan measures the 9 with no crystal and the 2 with a crystal but no harmonicFreq (v15.7's
    // scope); the 19 assigned ones (a crystal and its harmonicFreq, never measured) are a separate, explicit choice.
    await expect(healthLine(page, 'scan')).toHaveText(`Optional · ${unscanned} unscanned · about 27 min`);
    await expect(healthLine(page, 'scan-assigned')).toHaveText('Also scan the 19 assigned tracks (about 47 min)');
    await healthAction(page, 'scan').click();
    await expect(healthLine(page, 'scan')).toHaveText(/^Scanning · \d+ %$/, { timeout: 15_000 });
    await expect(page.getByText('Deep Analysis In Progress'), 'not classic’s box (v15.7: the card says it)').toHaveCount(0);
    await expect(page.getByTestId('library-health-status')).toHaveText('Scanning…');
    await expect(healthAction(page, 'analyse')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('health-analyse')).toContainText('Unavailable while Deep Scan runs');
    await healthAction(page, 'scan').click();
    await expect(healthLine(page, 'scan')).toHaveText(/^Optional · \d+ unscanned · /, { timeout: 30_000 });
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 18-20: renders, the desktop, accessibility
// ---------------------------------------------------------------------------------------------------------------

test.describe('phone, renders', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('18. while playing nothing on the tab re-renders (only the mini-player’s progress); a 2 s scroll renders rows, never App', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 200, { real: 10 });
    await openLibraryTab(page);
    await tapRow(page, 'tone-0002');
    await expectPlaying(page, 'tone-0002', 1);
    await page.waitForTimeout(2500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const r = await renders(page);
    test.info().annotations.push({ type: 'renders on the Library tab, 3 s', description: JSON.stringify(r) });
    for (const view of ['LibraryTab', 'LibraryList', 'LibraryRow', 'HealthCard', 'SearchSortRow']) expect.soft(r[view] ?? 0, `${view} renders`).toBe(0);
    expect.soft(r.MiniProgress ?? 0, 'MiniProgress renders').toBeGreaterThanOrEqual(8);
    // Paused (no clock), a 2 s scroll: rows come and go, App never renders.
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await page.waitForTimeout(500);
    await resetRenders(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const sc = document.querySelector('[data-testid="library-scroll"]') as HTMLElement;
          const t0 = performance.now();
          const step = () => {
            sc.scrollTop += 8;
            if (performance.now() - t0 < 2000) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        })
    );
    const s = await renders(page);
    test.info().annotations.push({ type: 'renders during a 2 s scroll', description: JSON.stringify(s) });
    expect(s.App ?? 0, 'App renders while scrolling').toBe(0);
    expect(s.LibraryRow ?? 0, 'rows came into view').toBeGreaterThan(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('19. Library in the 420 px panel; the transport works meanwhile; Escape clears the search first, then closes the panel; Import takes the panel and Close returns', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await tab(page, 'library');
    const panel = page.getByTestId('desktop-panel');
    await expect(panel.getByTestId('tab-library')).toBeVisible();
    expect((await panel.boundingBox())!.width).toBe(420);
    await tapRow(page, 'tone-0002');
    await expectPlaying(page, 'tone-0002');
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await expect(panel.getByTestId('tab-library')).toBeVisible();
    await page.getByTestId('desktop-play').click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
    await search(page).fill('tone-001');
    await search(page).press('Escape');
    await expect(search(page)).toHaveValue('');
    await expect(panel, 'the first Escape only clears').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('desktop-panel')).toHaveCount(0);
    await tab(page, 'library');
    await page.getByTestId('library-import').click();
    await expect(page.getByRole('region', { name: 'Import music', exact: true })).toBeVisible();
    await expect(page.getByTestId('tab-library'), 'the sheet takes the panel').toHaveCount(0);
    await page.getByRole('region', { name: 'Import music' }).getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(page.getByTestId('tab-library'), 'Close returns to the Library').toBeVisible();
    expect(dialogs).toEqual([]);
  });
});

/** Chrome's AX tree: controls with no name. */
async function unnamedControls(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: any[] };
    const CONTROLS = new Set(['button', 'slider', 'link', 'switch', 'checkbox', 'textbox', 'searchbox', 'combobox', 'menuitem', 'tab', 'radio', 'spinbutton']);
    return nodes
      .filter((n) => !n.ignored && CONTROLS.has(n.role?.value) && !String(n.name?.value ?? '').trim())
      .map((n) => `${n.role.value} #${n.backendDOMNodeId}`);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Every control in the shell and an open dialog under 44 × 44 (a file input counts as its label's box). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-testid="new-shell"], [role="dialog"][aria-modal="true"], [role="alertdialog"]'));
    const out: string[] = [];
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [role="slider"], [role="switch"], input, select'))) {
        const target = el instanceof HTMLInputElement && el.type === 'file' ? (el.closest('label') as HTMLElement) : el;
        const r = target.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(target).visibility === 'hidden') continue;
        if (r.bottom < 0 || r.top > innerHeight) continue;
        if (r.width < 44 - 0.5 || r.height < 44 - 0.5) out.push(`${el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30) || el.tagName}: ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

test.describe('phone, accessibility', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('20. named controls ≥ 44 × 44 in four states; the list’s keys; aria-current on the playing row only; aria-setsize is the library', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await openLibraryTab(page);
    await tapRow(page, 'tone-0002');
    await expectPlaying(page, 'tone-0002');
    // The roving tab stop is the playing row (before any other row has had the focus).
    await expect(page.locator('[data-row-index][tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('[data-row-index][tabindex="0"]')).toHaveAttribute('data-row-index', '1');
    const states: Array<[string, () => Promise<void>]> = [
      ['the top', async () => {}],
      ['searching', async () => { await search(page).fill('tone-001'); }],
      ['the row menu', async () => { await search(page).fill(''); await openRowMenu(page, 'tone-0004'); await page.getByRole('dialog', { name: 'tone-0004' }).waitFor(); }],
      ['the Import sheet', async () => { await page.keyboard.press('Escape'); await page.getByTestId('library-import').click(); await page.getByRole('dialog', { name: 'Import music' }).waitFor(); }],
    ];
    for (const [state, enter] of states) {
      await enter();
      await page.waitForTimeout(300);
      expect.soft(await unnamedControls(page), `${state}: unnamed controls`).toEqual([]);
      expect.soft(await smallTargets(page), `${state}: targets under 44 × 44`).toEqual([]);
    }
    await page.keyboard.press('Escape');
    // aria-current on the playing row only; the set size is the library's.
    await expect(page.locator('[data-testid="library-list"] [aria-current="true"]')).toHaveCount(1);
    await expect(libraryRowButton(page, 'tone-0002')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('library-row').first()).toHaveAttribute('aria-setsize', '30');
    await expect(page.locator('[data-row-index][tabindex="0"]'), 'one tab stop').toHaveCount(1);
    // The keys.
    await page.locator('[data-row-index="1"]').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-row-index="4"]')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('[data-row-index="29"]')).toBeFocused();
    await expect(libraryRow(page, 'tone-0030')).toHaveAttribute('aria-posinset', '30');
    await page.keyboard.press('Home');
    await expect(page.locator('[data-row-index="0"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expectPlaying(page, 'tone-0001');
    await page.keyboard.press('ArrowRight');
    await expect(rowMenu(page, 'tone-0001')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-row-index="0"]')).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('dialog', { name: 'tone-0001', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 21: the Import sheet (stage B)
// ---------------------------------------------------------------------------------------------------------------

/** From the next load on, the duration probes (App's getAudioDuration: an <audio> made by createElement) wait while
 *  window.__holdDurations is true; window.__releaseDurations() lets them go. The music element (new Audio()) is not
 *  affected. */
async function holdDurationProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__holdDurations = false;
    w.__held = [] as Array<() => void>;
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!;
    const create = Document.prototype.createElement;
    (Document.prototype as any).createElement = function (this: Document, tag: string, ...rest: unknown[]) {
      const el = (create as any).call(this, tag, ...rest);
      if (String(tag).toLowerCase() === 'audio') {
        Object.defineProperty(el, 'src', {
          configurable: true,
          get() { return d.get!.call(el); },
          set(v: string) {
            const go = () => d.set!.call(el, v);
            if (w.__holdDurations) w.__held.push(go);
            else go();
          },
        });
      }
      return el;
    };
    w.__releaseDurations = () => {
      w.__holdDurations = false;
      w.__held.splice(0).forEach((f: () => void) => f());
    };
  });
}

test.describe('phone, the Import sheet', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('21. Choose files adds the tracks and says what was skipped and what is still being read; Recover brings a stored track back, even after the banner’s Not now; Discard takes two taps', async ({ page }) => {
    test.setTimeout(180_000);
    await holdDurationProbes(page);
    const dialogs = await openSeededNewLayout(page, 8);
    await openLibraryTab(page);
    await page.getByTestId('library-import').click();
    const importer = page.getByRole('dialog', { name: 'Import music', exact: true });
    await expect(importer).toBeVisible();
    await expect(importer.getByText('Choose a folder')).toBeVisible();
    await expect(importer).toContainText('Plays MP3, WAV, FLAC, M4A, AAC, OGG, Opus, WebM and AIFF. Playlists (.m3u), WMA and Apple Lossless are skipped.');
    await page.evaluate(() => ((window as any).__holdDurations = true));
    await addFiles(page, [
      ...[1, 2, 3].map((i) => ({ name: `new-${i}.wav`, mimeType: 'audio/wav', buffer: toneWav(3, 300 + i * 40) })),
      { name: 'list.m3u', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\n') },
    ]);
    const last = page.getByTestId('import-last');
    await expect(last).toContainText('Added 3 tracks to your library');
    await expect(last).toContainText('Skipped 1 file that is not playable audio.');
    await expect(last).toContainText('Reading track lengths · 3 left');
    await page.evaluate(() => (window as any).__releaseDurations());
    await expect(last).not.toContainText('Reading track lengths', { timeout: 20_000 });
    expect((await libraryState(page)).libraryIds.length).toBe(11);
    await page.keyboard.press('Escape');
    await expect(importer).toHaveCount(0);

    // A stored track the saved library lost (v14.4's shrink), offered back.
    await expect.poll(async () => { const c = await cacheCounts(page); return [c.blobs, c.meta, c.library]; }, { timeout: 15_000 }).toEqual([11, 11, 11]);
    await shrinkSavedLibrary(page, 10);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    const banner = page.getByTestId('notices').getByText(/stored track that is not in your library/);
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('notices').getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(banner).toHaveCount(0);
    await openLibraryTab(page);
    await expect(healthLine(page, 'orphans')).toHaveText('1 stored track is not in your library');
    await healthAction(page, 'orphans').click();
    const recover = page.getByTestId('import-recover');
    await expect(recover).toContainText('1 stored track is not in your library');
    await expect(page.getByTestId('import-recover-button'), 'the sheet opens at the offer').toBeFocused();
    await page.getByTestId('import-recover-button').click();
    await expect(recover).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await libraryState(page)).libraryIds.length).toBe(11);
    await expect.poll(async () => (await cacheCounts(page)).library, { timeout: 15_000 }).toBe(11);
    await page.keyboard.press('Escape');

    // Discard: two taps.
    await expect.poll(async () => (await savedState(page))?.originalOrder?.length, { timeout: 15_000 }).toBe(11);
    await shrinkSavedLibrary(page, 10);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await openLibraryTab(page);
    await expect(healthLine(page, 'orphans')).toHaveText('1 stored track is not in your library', { timeout: 20_000 });
    await healthAction(page, 'orphans').click();
    const discard = page.getByTestId('import-discard-button');
    await discard.click();
    await expect(discard).toHaveText('Tap again to delete them');
    await expect.poll(async () => (await cacheCounts(page)).blobs, 'one tap deletes nothing').toBe(11);
    await page.waitForTimeout(650); // the second tap counts from 600 ms after the first (test 25)
    await discard.click();
    await expect(page.getByTestId('import-recover')).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await cacheCounts(page)).blobs, { timeout: 15_000 }).toBe(10);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 22: the new regions' crash drills
// ---------------------------------------------------------------------------------------------------------------

const DRILLS: Array<{ view: CrashView; open: (p: Page) => Promise<void>; present: (p: Page) => Locator; others: (p: Page) => Locator[] }> = [
  { view: 'library-list', open: async () => {}, present: (p) => p.getByTestId('library-list'), others: (p) => [p.getByTestId('library-health'), search(p)] },
  { view: 'library-health', open: async () => {}, present: (p) => p.getByTestId('library-health'), others: (p) => [p.getByTestId('library-list'), search(p)] },
  {
    view: 'library-menu',
    open: async (p) => { await openRowMenu(p, 'tone-0005'); },
    present: (p) => p.getByTestId('library-menu-body'),
    others: (p) => [p.getByRole('dialog', { name: 'tone-0005' })],
  },
  {
    view: 'sheet-import',
    open: async (p) => { await p.getByTestId('library-import').click(); },
    present: (p) => p.getByTestId('import-body'),
    others: (p) => [p.getByRole('dialog', { name: 'Import music' })],
  },
];

test.describe('phone, crash drills', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  for (const d of DRILLS) {
    test(`22. a crash in ${d.view} keeps the music and the rest of the tab; Reload panel brings it back`, async ({ page }) => {
      test.setTimeout(120_000);
      const dialogs = await openSeededNewLayout(page, 12);
      await openLibraryTab(page);
      await tapRow(page, 'tone-0002');
      await expectPlaying(page, 'tone-0002', 0.5);
      await d.open(page);
      await expect(d.present(page)).toBeVisible();
      const pauses = await pauseCount(page);
      await crash(page, d.view);
      const fallback = page.getByRole('alert').filter({ hasText: /hit a problem/ });
      await expect(fallback).toBeVisible();
      for (const o of d.others(page)) await expect(o, 'the rest stays').toBeVisible();
      await expectMusicPlaysOn(page, `after the ${d.view} crash`);
      await fallback.getByRole('button', { name: 'Reload panel', exact: true }).click();
      await expect(fallback).toHaveCount(0);
      await expect(d.present(page)).toBeVisible();
      expect(await pauseCount(page), 'no pause through the drill').toBe(pauses);
      expect(dialogs).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 23-32: the review's fixes (v15.7 round 2)
// ---------------------------------------------------------------------------------------------------------------

/** Each live decode's end time so far (-1 while it runs): recordLiveDecodes' log. */
const liveDecodeEnds = (page: Page): Promise<number[]> => page.evaluate(() => ((window as any).__liveDecodes as Array<{ end: number }>).map((d) => d.end));

/** From the next load on, count play() calls on media elements other than the silent anchor (a data: URL) in
 *  window.__playCount: the music element, with or without a source. */
async function countPlays(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__playCount = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!String(this.getAttribute('src') ?? '').startsWith('data:')) w.__playCount++;
      return play.call(this);
    };
  });
}

/** From the next load on, while window.__slowPlay is true, a play() of the music (not the silent anchor's data: URL)
 *  stays pending 2.5 s, as a big file's can on a slow phone; a new source meanwhile rejects it with an AbortError, as
 *  the browser's media load algorithm does (window.__abortedPlays counts those). */
async function slowPlays(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__slowPlay = false;
    w.__abortedPlays = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const real = play.call(this);
      const src = this.getAttribute('src') ?? '';
      if (!w.__slowPlay || src.startsWith('data:')) return real;
      real.catch(() => {});
      const t0 = performance.now();
      return new Promise<void>((resolve, reject) => {
        const tick = () => {
          if ((this.getAttribute('src') ?? '') !== src) {
            w.__abortedPlays++;
            reject(new DOMException('The play() request was interrupted by a new load request.', 'AbortError'));
          } else if (performance.now() - t0 >= 2500) real.then(resolve, reject);
          else setTimeout(tick, 20);
        };
        tick();
      });
    };
  });
}

/** Tap a row whose playTrack decodes first (an unscanned track), its decode slowed by 3 s; returns the decode's index
 *  once it is running. */
async function tapPending(page: Page, name: string): Promise<number> {
  const n = (await liveDecodeEnds(page)).length;
  await page.evaluate(() => ((window as any).__slowLiveDecode = true));
  await tapRow(page, name);
  await expect.poll(async () => (await liveDecodeEnds(page)).length, { message: `${name}'s decode starts` }).toBe(n + 1);
  await page.evaluate(() => ((window as any).__slowLiveDecode = false));
  expect((await liveDecodeEnds(page))[n], `${name} is still decoding`).toBe(-1);
  return n;
}

/** Wait for decode `i` to end, then long enough for its playTrack to have written anything it was going to (the
 *  frequency check, the card, play(), the cursor). */
async function afterDecode(page: Page, i: number): Promise<void> {
  await expect.poll(async () => (await liveDecodeEnds(page))[i] > 0, { message: 'the slowed decode ends', timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(3000);
}

/** The card titles written since `t0` (recordMediaMetadata's log). */
const cardTitlesSince = (page: Page, t0: number): Promise<Array<string | null>> =>
  page.evaluate((t0) => ((window as any).__metaSets as Array<{ t: number; title: string | null }>).filter((m) => m.t >= t0).map((m) => m.title), t0);

/** Two library tracks never scanned (no harmonicFreq, a crystal kept): playTrack decodes them before it plays. */
const UNSCANNED = { patch: [{ index: 9, unscanned: true }, { index: 10, unscanned: true }] };

test.describe('phone, a pending play', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('23a. a tap on an unscanned track, then Undo before its decode ends: the walk stays, and the late decode writes nothing', async ({ page }) => {
    test.setTimeout(150_000);
    await recordLiveDecodes(page);
    await recordMediaMetadata(page);
    const dialogs = await openSeededNewLayout(page, 30, UNSCANNED);
    await walkAtStep2(page, 3);
    await openLibraryTab(page);
    const before = await libraryState(page);
    const tap = pickTap(before);
    expect(before.scanned[tap.index], `${tap.name} is unscanned`).toBe(false);
    const d = await tapPending(page, tap.name);
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.walk, s.cursor, s.current, s.playing]; }, { message: 'the walk back', timeout: 15_000 })
      .toEqual(['C', before.cursor, before.current, true]);
    const t0 = await page.evaluate(() => performance.now());
    await afterDecode(page, d);
    const s = await libraryState(page);
    expect([s.walk, s.ids, s.cursor, s.current, s.playing], 'still the walk at its track after the decode').toEqual(['C', before.ids, before.cursor, before.current, true]);
    expect(await cardTitlesSince(page, t0), 'no card names the tapped track after the decode').not.toContain(tap.name);
    expect(await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null)).toBe(before.current);
    await expectMusicPlaysOn(page, 'after the late decode');
    expect(dialogs).toEqual([]);
  });

  test('23b. a tap on an unscanned track, then a tap on another before its decode ends: the second stays', async ({ page }) => {
    test.setTimeout(150_000);
    await recordLiveDecodes(page);
    await recordMediaMetadata(page);
    const dialogs = await openSeededNewLayout(page, 30, UNSCANNED);
    await openLibraryTab(page);
    await tapRow(page, 'tone-0005');
    await expectPlaying(page, 'tone-0005');
    const d = await tapPending(page, 'tone-0010');
    await tapRow(page, 'tone-0013');
    const playing = await expectPlaying(page, 'tone-0013');
    const t0 = await page.evaluate(() => performance.now());
    await afterDecode(page, d);
    const s = await libraryState(page);
    expect([s.current, s.cursor, s.playing, s.src], 'the second tap’s track, cursor and source after the decode').toEqual(['tone-0013', 12, true, playing.src]);
    expect(await cardTitlesSince(page, t0), 'no card names the first tap’s track').not.toContain('tone-0010');
    expect(await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null)).toBe('tone-0013');
    await expect(page.getByTestId('mini-title')).toHaveText('tone-0013');
    await expectMusicPlaysOn(page, 'after the late decode');
    expect(dialogs).toEqual([]);
  });

  test('23c. Next onto an unscanned track, then a tap before its decode ends: the tapped track stays', async ({ page }) => {
    test.setTimeout(150_000);
    await recordLiveDecodes(page);
    await recordMediaMetadata(page);
    const dialogs = await openSeededNewLayout(page, 30, UNSCANNED);
    await openLibraryTab(page);
    await tapRow(page, 'tone-0009');
    await expectPlaying(page, 'tone-0009');
    const n = (await liveDecodeEnds(page)).length;
    await page.evaluate(() => ((window as any).__slowLiveDecode = true));
    await page.getByTestId('mini-player').getByRole('button', { name: 'Next track', exact: true }).click();
    await expect.poll(async () => (await liveDecodeEnds(page)).length, { message: 'tone-0010’s decode starts' }).toBe(n + 1);
    await page.evaluate(() => ((window as any).__slowLiveDecode = false));
    await tapRow(page, 'tone-0015');
    const playing = await expectPlaying(page, 'tone-0015');
    const t0 = await page.evaluate(() => performance.now());
    await afterDecode(page, n);
    const s = await libraryState(page);
    expect([s.current, s.cursor, s.playing, s.src], 'the tapped track after the decode').toEqual(['tone-0015', 14, true, playing.src]);
    expect(await cardTitlesSince(page, t0), 'no card names the Next’s track').not.toContain('tone-0010');
    await expectMusicPlaysOn(page, 'after the late decode');
    expect(dialogs).toEqual([]);
  });

  test('23d. paused, a tap on an unscanned track, then Undo before its decode ends: nothing starts after the decode', async ({ page }) => {
    test.setTimeout(150_000);
    await countPlays(page);
    await recordLiveDecodes(page);
    const dialogs = await openSeededNewLayout(page, 30, UNSCANNED);
    await openLibraryTab(page);
    await tapRow(page, 'tone-0005');
    await expectPlaying(page, 'tone-0005');
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    const d = await tapPending(page, 'tone-0010');
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.cursor, s.current, s.playing, s.src]; }, { message: 'back, paused and unloaded' })
      .toEqual([4, 'tone-0005', false, null]);
    const plays = await page.evaluate(() => (window as any).__playCount);
    await afterDecode(page, d);
    expect(await page.evaluate(() => (window as any).__playCount), 'no play() after the decode').toBe(plays);
    const s = await libraryState(page);
    expect([s.cursor, s.current, s.playing, s.src], 'still paused and unloaded').toEqual([4, 'tone-0005', false, null]);
    expect(dialogs).toEqual([]);
  });

  test('23e. the tone on, a pick, then a quick second pick: the tone stays on throughout and the second track plays (the first pick, superseded, stops nothing)', async ({ page }) => {
    test.setTimeout(150_000);
    await slowPlays(page);
    await recordLiveDecodes(page);
    const dialogs = await openSeededNewLayout(page, 30, UNSCANNED);
    const tone = async (): Promise<number> => (await layersState(page))?.requested?.tone_hz ?? 0;
    /** A crystal with nothing playing (or paused): the tone alone, as a user turns it on; then back to the Library. */
    const toneOn = async () => {
      await tab(page, 'now');
      await page.getByTestId('chip-crystal').click();
      await page.getByTestId('crystal-528').click();
      if (await page.getByTestId('sheet-crystal').isVisible().catch(() => false)) await page.keyboard.press('Escape');
      await expect(page.getByTestId('tone-only-banner')).toBeVisible();
      await expect.poll(tone, { message: 'the tone plays' }).toBe(528);
      await openLibraryTab(page);
    };

    // 1. The first pick decodes (unscanned, the decode slowed); the second comes before that ends.
    await toneOn();
    const d = await tapPending(page, 'tone-0011');
    await tapRow(page, 'tone-0013');
    await expectPlaying(page, 'tone-0013');
    await afterDecode(page, d);
    const s = await libraryState(page);
    expect([s.current, s.playing], 'the second pick plays').toEqual(['tone-0013', true]);
    expect(await tone(), 'the tone, after the first pick’s late decode').toBeGreaterThan(0);

    // 2. The first pick's play() still pending (as a big file's can be on a phone) when the second pick sets its source:
    // the browser aborts it, and its catch must leave the tone alone. The second decodes for 3 s meanwhile.
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await toneOn();
    await page.evaluate(() => ((window as any).__slowPlay = true));
    await tapRow(page, 'tone-0005');
    await page.evaluate(() => ((window as any).__slowPlay = false));
    const d2 = await tapPending(page, 'tone-0010');
    await expect.poll(() => page.evaluate(() => (window as any).__abortedPlays), { message: 'the first pick’s play() was aborted by the second' }).toBe(1);
    const held: number[] = [];
    for (let i = 0; i < 15; i++) {
      held.push(await tone());
      await page.waitForTimeout(100);
    }
    expect((await liveDecodeEnds(page))[d2], 'sampled while the second pick still decodes').toBe(-1);
    expect(held.every((hz) => hz === 528), `the tone while the second pick decodes: ${held.join(', ')}`).toBe(true);
    await expectPlaying(page, 'tone-0010');
    expect(await tone(), 'the tone with the second track playing').toBeGreaterThan(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, a tap racing a patch', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('24. a tap in the commit where track lengths land: the play order holds the library’s own tracks, and the saved metadata keeps the lengths', async ({ page }) => {
    test.setTimeout(150_000);
    await holdDurationProbes(page);
    const dialogs = await openSeededNewLayout(page, 8);
    await openLibraryTab(page);
    await sortSelect(page).selectOption('newest'); // the imports first: their rows are mounted
    await page.getByTestId('library-import').click();
    await page.evaluate(() => ((window as any).__holdDurations = true));
    await addFiles(page, [1, 2, 3].map((i) => ({ name: `new-${i}.wav`, mimeType: 'audio/wav', buffer: toneWav(3, 300 + i * 40) })));
    await expect(page.getByTestId('import-last')).toContainText('Reading track lengths · 3 left');
    await page.keyboard.press('Escape');
    await expect(libraryRow(page, 'new-1').locator('[data-row-facts]')).toHaveText(/Reading length/);
    // The first commit that shows a length on a new row, in the same task (a MutationObserver's microtask, before the
    // passive effects that sync the handlers' library): a tap on tone-0004.
    await page.evaluate(() => {
      const w = window as any;
      w.__raced = null;
      const mo = new MutationObserver(() => {
        if (w.__raced) return;
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="library-row"]'));
        const title = (r: HTMLElement) => r.querySelector('[data-row-title]')?.textContent ?? '';
        if (!rows.some((r) => /^new-/.test(title(r)) && /\d:\d\d/.test(r.querySelector('[data-row-facts]')?.textContent ?? ''))) return;
        mo.disconnect();
        const st = w.__aetheriaLibrary.state();
        w.__raced = { names: st.libraryNames, lengths: st.libraryDurations };
        rows.find((r) => title(r) === 'tone-0004')!.querySelector<HTMLElement>('button[data-row-index]')!.click();
      });
      mo.observe(document.querySelector('[data-testid="library-list"]')!, { subtree: true, childList: true, characterData: true });
    });
    await page.evaluate(() => (window as any).__releaseDurations());
    await expect.poll(() => page.evaluate(() => (window as any).__raced !== null), { message: 'the lengths land', timeout: 20_000 }).toBe(true);
    const raced = await page.evaluate(() => (window as any).__raced as { names: string[]; lengths: Array<number | null> });
    expect(raced.names.some((n, i) => /^new-/.test(n) && !raced.lengths[i]), 'the tap read the library one commit old (the race)').toBe(true);
    await expectPlaying(page, 'tone-0004');
    const newLengths = (s: LibraryState) => s.names.flatMap((n, i) => (/^new-/.test(n) ? [s.durations[i] ?? 0] : []));
    await expect
      .poll(async () => newLengths(await libraryState(page)).map((d) => d > 2.5), { message: 'the play order’s copies have their lengths', timeout: 15_000 })
      .toEqual([true, true, true]);
    const s = await libraryState(page);
    expect([s.ids, s.cursor], 'the same play order and cursor').toEqual([s.ids, s.names.indexOf('tone-0004')]);
    await page.waitForTimeout(2600); // the metadata save's debounce
    await expect
      .poll(async () => (await metaRecords(page)).filter((m) => /^new-/.test(m.name)).map((m) => (m.duration ?? 0) > 2.5), { message: 'the saved lengths', timeout: 15_000 })
      .toEqual([true, true, true]);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, Discard', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('25. Discard: a double tap is one tap (the second counts only from 600 ms), on the banner and in the Import sheet; a later tap deletes', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 8);
    await expect.poll(async () => (await savedState(page))?.originalOrder?.length, { timeout: 15_000 }).toBe(8);
    await shrinkSavedLibrary(page, 7);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    const notices = page.getByTestId('notices');
    await expect(notices.getByText(/stored track that is not in your library/)).toBeVisible({ timeout: 20_000 });
    await notices.getByRole('button', { name: 'Discard', exact: true }).dblclick();
    await page.waitForTimeout(1000);
    expect((await cacheCounts(page)).blobs, 'a double tap on the banner deletes nothing').toBe(8);
    await expect(notices.getByRole('button', { name: 'Tap again to delete them', exact: true }), 'it is armed').toBeVisible();
    await expect(notices.getByRole('button', { name: 'Discard', exact: true }), 'it disarms after 4 s').toBeVisible({ timeout: 6000 });
    await openLibraryTab(page);
    await healthAction(page, 'orphans').click();
    const discard = page.getByTestId('import-discard-button');
    await discard.dblclick();
    await page.waitForTimeout(1000);
    expect((await cacheCounts(page)).blobs, 'a double tap in the sheet deletes nothing').toBe(8);
    await expect(discard).toHaveText('Tap again to delete them');
    await discard.click();
    await expect(page.getByTestId('import-recover')).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await cacheCounts(page)).blobs, { message: 'a tap after 600 ms deletes', timeout: 15_000 }).toBe(7);
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop, the Import panel', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('26. closing the Import panel returns the focus to Import, or to the health card’s Review', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 8);
    await expect.poll(async () => (await savedState(page))?.originalOrder?.length, { timeout: 15_000 }).toBe(8);
    await tab(page, 'library');
    const importer = page.getByRole('region', { name: 'Import music', exact: true });
    const openImport = page.getByTestId('library-import');
    await openImport.click();
    await expect(importer).toBeVisible();
    await importer.getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await expect(openImport, 'Close: the focus is back on Import').toBeFocused();
    await openImport.press('Enter');
    await expect(importer).toBeVisible();
    await importer.getByRole('button', { name: 'Close panel', exact: true }).press('Enter');
    await expect(openImport, 'from the keyboard too').toBeFocused();
    // Review (a stored track not in the library) opens it at the offer; closing returns to Review.
    await shrinkSavedLibrary(page, 7);
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await tab(page, 'library');
    await healthAction(page, 'orphans').click();
    await expect(importer).toBeVisible();
    await importer.getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(healthAction(page, 'orphans'), 'the focus is back on Review').toBeFocused();
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, notices', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('27. classic’s Analysis Status box never shows in the new layout: an import’s skips are the sheet’s, Deep Scan’s progress the card’s, a walk’s message a toast; classic unchanged', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openSeededNewLayout(page, 30, { crystals: 'some' });
    const box = page.getByText('Analysis Status', { exact: true }).or(page.getByText('Deep Analysis In Progress', { exact: true }));
    const notices = page.getByTestId('notices');
    const skipped = [{ name: 'new-1.wav', mimeType: 'audio/wav', buffer: toneWav(3, 340) }, { name: 'list.m3u', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\n') }];
    await openLibraryTab(page);
    await page.getByTestId('library-import').click();
    await addFiles(page, skipped);
    await expect(page.getByTestId('import-last')).toContainText('Skipped 1 file that is not playable audio.');
    await page.waitForTimeout(1000);
    await expect(box, 'no box for an import').toHaveCount(0);
    await expect(notices, 'and no toast: the sheet says it').not.toContainText('Skipped');
    await page.keyboard.press('Escape');
    await startWalk(page, 'C');
    // v15.9: a walk's message is its Undo toast's words (the classic notice would push the Undo out).
    await expect(notices, 'a walk’s message is its Undo toast').toContainText(/^Playing Flying Star Vortex: \d+ of 27 positions\./);
    await expect(notices).not.toContainText('positions filled');
    await expect(box).toHaveCount(0);
    await openLibraryTab(page);
    const scanAt = Date.now();
    await healthAction(page, 'scan').click();
    await expect(healthLine(page, 'scan')).toHaveText(/^Scanning · \d+ %$/, { timeout: 15_000 });
    await page.waitForTimeout(2000);
    await expect(box, 'no box for Deep Scan').toHaveCount(0);
    await expect(notices, 'no start or progress toast: the card says it').not.toContainText(/Starting deep fractal analysis|Analyzing: /);
    await healthAction(page, 'scan').click();
    await expect(healthLine(page, 'scan')).toHaveText(/^Optional · /, { timeout: 30_000 });
    // Classic: the box, as v15.6.
    await tab(page, 'more');
    await page.getByTestId('more-back-to-classic').click();
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    // Deep Scan's start clears the notice 8 s later, whatever it says by then (v15.6): past that, so the import's own
    // words are still up when they are read.
    await page.waitForTimeout(Math.max(0, scanAt + 9000 - Date.now()));
    await addFiles(page, [{ ...skipped[0], name: 'new-2.wav' }, skipped[1]]);
    await expect(page.getByText('Analysis Status', { exact: true }), 'classic shows its box').toBeVisible();
    await expect(page.getByText(/Skipped 1 file that is not a playable audio format/)).toBeVisible();
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, after Assign', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('28. after Assign (no Deep Scan) every track has a crystal, Deep Scan still offers the assigned ones, and a scanned track keeps its crystal; Track info says which is which (v15.8)', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30, { crystals: 'none', patch: [{ index: 2, crystal: 528, scanned: true }] });
    await openLibraryTab(page);
    const info = page.getByRole('dialog', { name: 'Track info', exact: true });
    const crystalNote = async (name: string) => {
      await openRowMenu(page, name);
      await page.getByTestId('library-menu-info').click();
      await expect(info).toBeVisible();
      const note = await info.locator('dl > div').filter({ has: page.locator('dt', { hasText: 'Crystal' }) }).locator('dd').textContent();
      await page.keyboard.press('Escape');
      await expect(info).toHaveCount(0);
      return note;
    };
    await expect(healthLine(page, 'scan')).toHaveText(/^Optional · 29 unscanned · /);
    expect(await crystalNote('tone-0003'), 'the scanned track, before').toContain('From Deep Scan. An assigned crystal, not a measured pitch.');
    const before = await libraryState(page);
    await healthAction(page, 'crystals').click();
    await expect(page.getByTestId('assign-dialog'), 'no question: no crystal a track has would change').toHaveCount(0);
    await expect(healthLine(page, 'crystals')).toHaveText('All 30 tracks have one');
    const after = await libraryState(page);
    expect(after.crystals[2], 'the scanned track keeps Deep Scan’s crystal').toBe(before.crystals[2]);
    expect(after.scanned.every(Boolean), 'every track playback-ready (an assigned crystal’s harmonicFreq is the crystal)').toBe(true);
    expect([after.origins[2], after.origins.filter((o) => o === 'assigned').length], 'one scan, 29 assigned').toEqual(['scan', 29]);
    await expect(healthLine(page, 'scan'), 'not "All 30 tracks scanned"').toHaveText('1 of 30 scanned');
    await expect(healthAction(page, 'scan'), 'nothing left in Scan’s default scope').toHaveCount(0);
    await expect(healthLine(page, 'scan-assigned'), 'Deep Scan can still measure them, explicitly').toHaveText('Also scan the 29 assigned tracks (about 1 h 12 min)');
    await expect(healthAction(page, 'scan-assigned')).toHaveText('Scan');
    const assigned = await crystalNote('tone-0005');
    expect(assigned, 'an assigned track').toContain('Assigned, not scanned yet. An assigned crystal, not a measured pitch.');
    expect(await crystalNote('tone-0003'), 'the scanned track, kept').toContain('From Deep Scan. An assigned crystal, not a measured pitch.');
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, the list’s range', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  /** Change the sort or the query from the page itself, then record the next 30 frames: in each, the scroll position,
   *  the list's row slots in the scroller's view (by geometry: 64 px each) and how many of them have no row mounted.
   *  (The roving tab stop's row is always mounted, so "some row in view" would pass at the top with row 1 alone.) */
  async function framesAfter(page: Page, change: { sort?: string; query?: string }): Promise<Array<{ top: number; slots: number; empty: number }>> {
    return page.evaluate(
      (change) =>
        new Promise((resolve) => {
          const sc = document.querySelector('[data-testid="library-scroll"]') as HTMLElement;
          const frames: Array<{ top: number; slots: number; empty: number }> = [];
          if (change.sort !== undefined) {
            const el = document.querySelector('select[aria-label="Sort"]') as HTMLSelectElement;
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, change.sort);
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            const el = document.querySelector('[data-testid="library-search"]') as HTMLInputElement;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, change.query);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const step = () => {
            const view = sc.getBoundingClientRect();
            const list = document.querySelector('[data-testid="library-list"]') as HTMLElement | null;
            const mounted = new Set(Array.from(document.querySelectorAll<HTMLElement>('[data-testid="library-row"]')).map((r) => Number(r.getAttribute('aria-posinset'))));
            let slots = 0;
            let empty = 0;
            if (list) {
              const lb = list.getBoundingClientRect();
              const n = Math.round(lb.height / 64);
              const from = Math.max(0, Math.floor((view.top - lb.top) / 64));
              const to = Math.min(n, Math.ceil((view.bottom - lb.top) / 64));
              for (let i = from; i < to; i++) {
                slots++;
                if (!mounted.has(i + 1)) empty++;
              }
            }
            frames.push({ top: sc.scrollTop, slots, empty });
            if (frames.length < 30) requestAnimationFrame(step);
            else resolve(frames);
          };
          requestAnimationFrame(step);
        }),
      change
    );
  }

  /** Scroll the list to row `i` and wait until the rows there are mounted. */
  async function scrollToRow(page: Page, i: number): Promise<void> {
    await revealIndex(page, i);
    await expect
      .poll(() => page.evaluate((i) => Array.from(document.querySelectorAll('[data-testid="library-row"]')).some((r) => Number(r.getAttribute('aria-posinset')) === i + 1), i))
      .toBe(true);
  }

  test('29a. a sort or a search change with the list scrolled far down: every frame after it shows rows (the top ones), none blank', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 200, { real: 10 });
    await openLibraryTab(page);
    for (const change of [{ sort: 'name' }, { query: 'tone-01' }, { sort: 'length' }, { query: '' }]) {
      await scrollToRow(page, 80); // the query matches 100
      const frames = await framesAfter(page, change);
      test.info().annotations.push({ type: `frames after ${JSON.stringify(change)}`, description: JSON.stringify(frames.slice(0, 8)) });
      expect.soft(frames.filter((f) => f.empty > 0).length, `${JSON.stringify(change)}: frames with an empty row slot in view`).toBe(0);
      expect.soft(frames[0].slots, `${JSON.stringify(change)}: the list is in view`).toBeGreaterThan(0);
      expect.soft(frames[frames.length - 1].top, `${JSON.stringify(change)}: at the top`).toBe(0);
    }
    expect(dialogs).toEqual([]);
  });

  test('29b. the health card opening moves the list: its range follows at once, with no scroll', async ({ page }) => {
    test.setTimeout(150_000);
    // Every track with a crystal, a key and visual sync: nothing to do, so the card starts folded to one line.
    const done = Array.from({ length: 200 }, (_, i) => ({ index: i, key: 'Am', confidence: 0.6, visual: true }));
    const dialogs = await openSeededNewLayout(page, 200, { real: 10, patch: done });
    await openLibraryTab(page);
    await expect(page.getByTestId('library-health')).toHaveAttribute('data-open', 'false');
    /** The mounted rows are exactly the list's range for the scroller's position now (OVERSCAN 6), the roving tab
     *  stop's row aside. */
    const rangeIsCurrent = () =>
      page.evaluate(() => {
        const sc = document.querySelector('[data-testid="library-scroll"]') as HTMLElement;
        const list = document.querySelector('[data-testid="library-list"]') as HTMLElement;
        const n = Math.round(list.getBoundingClientRect().height / 64);
        const first = Math.floor(Math.max(0, sc.scrollTop - list.offsetTop) / 64);
        const start = Math.min(n, Math.max(0, first - 6));
        const end = Math.min(n, first + Math.ceil(sc.clientHeight / 64) + 1 + 6);
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="library-row"]')).map((r) => ({
          p: Number(r.getAttribute('aria-posinset')),
          roving: !!r.querySelector('[data-row-index][tabindex="0"]'),
        }));
        const have = new Set(rows.map((r) => r.p));
        for (let p = start + 1; p <= end; p++) if (!have.has(p)) return false;
        return rows.every((r) => r.roving || (r.p >= start + 1 && r.p <= end));
      });
    // Chrome's scroll anchoring would scroll by the card's growth (a scroll event, which recomputes the range anyway);
    // Safari has none, so it is turned off here: only the content's ResizeObserver can follow the move.
    await page.addStyleTag({ content: '[data-testid="library-scroll"] { overflow-anchor: none; }' });
    // Scrolled ten rows into the list (the card above the view): opening the card moves every row in view down.
    await page.evaluate(() => {
      const sc = document.querySelector('[data-testid="library-scroll"]') as HTMLElement;
      const list = document.querySelector('[data-testid="library-list"]') as HTMLElement;
      sc.scrollTop = list.offsetTop + 10 * 64;
    });
    await expect.poll(rangeIsCurrent, { message: 'before' }).toBe(true);
    const top = await page.evaluate(() => (document.querySelector('[data-testid="library-scroll"]') as HTMLElement).scrollTop);
    const offset = await page.evaluate(() => (document.querySelector('[data-testid="library-list"]') as HTMLElement).offsetTop);
    // A click from the page: no scrolling into view, so only the card's growth moves the list.
    await page.getByTestId('library-health-toggle').evaluate((b) => (b as HTMLElement).click());
    await expect(page.getByTestId('library-health')).toHaveAttribute('data-open', 'true');
    const moved = await page.evaluate(() => (document.querySelector('[data-testid="library-list"]') as HTMLElement).offsetTop);
    test.info().annotations.push({ type: 'the list moved', description: `${offset} → ${moved} px` });
    expect(moved - offset, 'the card grew above the list').toBeGreaterThan(64);
    expect(await page.evaluate(() => (document.querySelector('[data-testid="library-scroll"]') as HTMLElement).scrollTop), 'no scroll').toBe(top);
    await expect.poll(rangeIsCurrent, { message: 'the range follows', timeout: 2000 }).toBe(true);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, the current row', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('30. the current row says Paused with a still Pause icon while paused, Playing with the still AudioLines icon while it plays; no other row says either', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openSeededNewLayout(page, 12);
    await openLibraryTab(page);
    await tapRow(page, 'tone-0003');
    await expectPlaying(page, 'tone-0003');
    const row = libraryRow(page, 'tone-0003');
    const facts = row.locator('[data-row-facts]');
    const icons = () => row.locator('svg').evaluateAll((svgs) => svgs.map((s) => [s.getAttribute('class'), getComputedStyle(s).animationName]));
    await expect(facts).toHaveText(/^Playing · 0:40 · /);
    expect((await icons()).some(([c]) => /lucide-audio-lines/.test(c ?? ''))).toBe(true);
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(facts).toHaveText(/^Paused · 0:40 · /);
    const paused = await icons();
    expect(paused.some(([c]) => /lucide-pause/.test(c ?? '')), 'the Pause icon').toBe(true);
    expect(paused.some(([c]) => /lucide-audio-lines/.test(c ?? '')), 'not AudioLines').toBe(false);
    expect(paused.every(([, a]) => a === 'none'), 'no animation').toBe(true);
    await expect(row.locator('button[data-row-index]')).toHaveAttribute('aria-current', 'true');
    await expect(libraryRow(page, 'tone-0004').locator('[data-row-facts]')).not.toHaveText(/^(Playing|Paused) · /);
    await page.getByTestId('mini-player').getByRole('button', { name: 'Play', exact: true }).click();
    await expect(facts).toHaveText(/^Playing · /);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, Now Playing empty', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('31. Now Playing with an empty library: Import music opens the Import sheet, and an import fills the library', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openNewLayout(page);
    await tab(page, 'now');
    const empty = page.getByTestId('np-empty');
    await expect(empty).toContainText('Your library is empty');
    await expect(empty).toContainText('Import music from this device. Aetheria keeps its own copy here; your files are not changed.');
    await empty.getByRole('button', { name: 'Import music', exact: true }).click();
    await expect(sheet(page, 'Import music')).toBeVisible();
    await addFiles(page, [{ name: 'new-1.wav', mimeType: 'audio/wav', buffer: toneWav(3, 340) }]);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 15_000 }).toBe(1);
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, an Undo chain', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('32. two taps within the toast’s life, then Undo: back to before the FIRST tap (the walk, playing at its place; paused when it was paused)', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openSeededNewLayout(page, 30);
    await walkAtStep2(page, 3);
    await openLibraryTab(page);
    const before = await libraryState(page);
    const [a, b, c, d] = ['tone-0010', 'tone-0011', 'tone-0012', 'tone-0013', 'tone-0014'].filter((n) => n !== before.current);
    await tapRow(page, a);
    await expectPlaying(page, a);
    await tapRow(page, b);
    await expectPlaying(page, b);
    await expect(undoToast(page), 'the first tap’s words stay').toContainText('Playing your library from this track. The Vortex walk stopped.');
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.ids, s.cursor, s.walk, s.current, s.playing]; }, { message: 'the walk, before the first tap', timeout: 15_000 })
      .toEqual([before.ids, before.cursor, 'C', before.current, true]);
    await expect.poll(async () => (await libraryState(page)).t ?? 0, { timeout: 10_000 }).toBeGreaterThan(1);
    expect(Math.abs(((await libraryState(page)).t ?? 0) - (before.t ?? 0)), 'at its place').toBeLessThan(3);
    // Paused: the chain keeps the first tap's "paused".
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    const paused = await libraryState(page);
    await tapRow(page, c);
    await expectPlaying(page, c);
    await tapRow(page, d);
    await expectPlaying(page, d);
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.ids, s.cursor, s.walk, s.current, s.playing, s.src]; }, { message: 'the walk, paused, unloaded', timeout: 15_000 })
      .toEqual([paused.ids, paused.cursor, 'C', paused.current, false, null]);
    expect(dialogs).toEqual([]);
  });

  test('32b. another toast since a tap (Assign’s summary) ends its chain: the next tap’s Undo goes back only to that tap', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 30, { crystals: 'some' });
    await openLibraryTab(page);
    await tapRow(page, 'tone-0003');
    await expectPlaying(page, 'tone-0003');
    await tapRow(page, 'tone-0005');
    await expectPlaying(page, 'tone-0005');
    await expect(undoToast(page)).toBeVisible();
    // Assign: the play order keeps its ids (a patch), and Auto-Distribute's summary takes the toast's place.
    const plan = await seededPlan(page);
    await healthAction(page, 'crystals').click();
    if (assignNeedsConfirm(plan)) await page.getByRole('alertdialog', { name: 'Assign crystals?' }).getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByTestId('notices')).toContainText('Crystals assigned:');
    await expect(undoToast(page)).toHaveCount(0);
    await tapRow(page, 'tone-0007');
    await expectPlaying(page, 'tone-0007');
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.current, s.playing]; }, { message: 'back to tone-0005, not tone-0003', timeout: 15_000 })
      .toEqual(['tone-0005', true]);
    expect(dialogs).toEqual([]);
  });
});
