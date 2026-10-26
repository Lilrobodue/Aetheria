import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  cacheCounts,
  countLibraryDeletes,
  libraryRowButton,
  libraryState,
  libraryUndo,
  openLibraryTab,
  openApp,
  openSeededNewLayout,
  phoneSize,
  savedState,
  seedLibraryRecords,
  startWalk,
  tab,
  undoToast,
  PHONE_VIEWPORT,
  type LibraryState,
} from './helpers';

// v15.8, the mix recipes (utils/mix/recipes.ts) and applyMix: the walks carry per-entry steps, so the Lo Shu cube's
// marker follows the track (decision 1 A); no generator writes the library; the three slips. Synthetic tones only
// (tone-NNNN, helpers.seedLibraryRecords), with crystals CRY[i % 27] and none at 852, so every walk has a gap there.

/** The 27 crystals in Layer Ascent's order (constants.ts LO_SHU_WALKS.A: ascending). */
const ASCENT = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
/** 30 tones, a crystal each (the 27 in turn), but none at 852 (index 7). */
const NO_852 = { patch: [{ index: 7, crystal: null }] };

/** From the next load on, a DevTools-shaped hook keeps React's latest root, so the Visualizer's props can be read. */
async function vizPropsHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), isDisabled: false,
      inject(r: unknown) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
      onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, setStrictMode() {},
      onCommitFiberRoot(_id: number, root: unknown) { w.__root = root; },
    };
    w.__vizProps = () => {
      const stack = [w.__root?.current];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        const p = f.memoizedProps;
        if (p && typeof p === 'object' && 'loShuWalkStep' in p && 'analyser' in p) return { step: p.loShuWalkStep, mode: p.loShuWalkMode };
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      return null;
    };
  });
}
const vizStep = (page: Page) => page.evaluate(() => (window as any).__vizProps()?.step ?? null);

/** The crystal of the play order's current track (the dev hook lists the library's). */
const playingCrystal = (s: LibraryState) => s.crystals[s.libraryNames.indexOf(s.current ?? '')];
/** Classic's toolbar Lo Shu button (its title names the walk while one is active). */
const loShuButton = (page: Page) => page.getByRole('button', { name: /^Lo Shu (controls|Walk active|Perfect GUT mapping)/ });
const nextOnNowPlaying = (page: Page) => page.getByTestId('view-now').getByRole('button', { name: 'Next track', exact: true });

/** Next until the cursor is `cursor` (each step polled). */
async function nextTo(page: Page, cursor: number): Promise<void> {
  for (let c = (await libraryState(page)).cursor; c < cursor; c++) {
    await nextOnNowPlaying(page).click();
    await expect.poll(async () => (await libraryState(page)).cursor, { message: `Next to ${c + 1}`, timeout: 15_000 }).toBe(c + 1);
  }
}

test.beforeEach(async ({ page, viewport }) => {
  if (ON_DEVICE && viewport) await page.setViewportSize(viewport);
});

test.describe('phone, the cube', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('1. the cube follows the track: with no track at 852, Layer Ascent’s step is the playing crystal’s position, and the Visualizer gets it, for ten tracks @mobile', async ({ page }) => {
    test.setTimeout(180_000);
    await vizPropsHook(page);
    const dialogs = await openSeededNewLayout(page, 30, NO_852);
    await phoneSize(page);
    await startWalk(page, 'A');
    const s0 = await libraryState(page);
    expect(s0.steps, 'one step per entry: every position but 852’s (7)').toEqual([...Array(27).keys()].filter((j) => j !== 7));
    for (let c = 0; c <= 9; c++) {
      await nextTo(page, c);
      await expect.poll(async () => (await libraryState(page)).playing, { message: `cursor ${c} plays`, timeout: 15_000 }).toBe(true);
      const s = await libraryState(page);
      const step = s.steps![c];
      expect(ASCENT[step], `cursor ${c}: the step names the playing crystal`).toBe(playingCrystal(s));
      await expect.poll(() => vizStep(page), { message: `cursor ${c}: the Visualizer’s step (v15.7 passed the cursor, one behind from 7)`, timeout: 5_000 }).toBe(step);
    }
    expect(dialogs).toEqual([]);
  });

  test('2. a Library tap’s Undo brings the steps back with the walk: the same steps, and the Visualizer on the playing crystal', async ({ page }) => {
    test.setTimeout(180_000);
    await vizPropsHook(page);
    const dialogs = await openSeededNewLayout(page, 30, NO_852);
    await phoneSize(page);
    await startWalk(page, 'A');
    await nextTo(page, 7);
    const before = await libraryState(page);
    expect(before.steps![7], 'past the gap: step 8 at cursor 7').toBe(8);
    await openLibraryTab(page);
    const name = before.current === 'tone-0011' ? 'tone-0012' : 'tone-0011';
    await libraryRowButton(page, name).click();
    await expect.poll(async () => { const s = await libraryState(page); return [s.current, s.walk, s.steps]; }, { message: 'the tap ends the walk', timeout: 15_000 }).toEqual([name, null, null]);
    await expect(undoToast(page)).toBeVisible();
    await libraryUndo(page);
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.walk, s.cursor, s.steps, s.current]; }, { message: 'the walk and its steps come back', timeout: 15_000 })
      .toEqual(['A', 7, before.steps, before.current]);
    await tab(page, 'now');
    await expect.poll(() => vizStep(page), { message: 'the Visualizer: steps[7]', timeout: 5_000 }).toBe(8);
    expect(ASCENT[8]).toBe(playingCrystal(await libraryState(page)));
    expect(dialogs).toEqual([]);
  });

  test('3. a walk’s end clears the steps: the Walks sheet’s clear, a Library tap, classic’s Clear walk badge and a Full Alignment; GUT Alignment sets the traditional steps', async ({ page }) => {
    test.setTimeout(240_000);
    await vizPropsHook(page);
    const dialogs = await openSeededNewLayout(page, 30, NO_852);
    await phoneSize(page);
    const ended = async (label: string) =>
      expect.poll(async () => { const s = await libraryState(page); return [s.walk, s.steps]; }, { message: label, timeout: 15_000 }).toEqual([null, null]);
    // The Walks sheet's Clear walk badge.
    await startWalk(page, 'A');
    expect((await libraryState(page)).steps?.length).toBe(26);
    await page.getByTestId('np-walks').click();
    await page.getByRole('button', { name: 'Clear walk badge', exact: true }).click();
    await ended('the Walks sheet’s clear');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet-walks')).toHaveCount(0);
    // A Library tap.
    await startWalk(page, 'B');
    expect((await libraryState(page)).steps?.length).toBe(26);
    await openLibraryTab(page);
    await libraryRowButton(page, 'tone-0003').click();
    await ended('a Library tap');
    // Classic (the Mixes stub's peek): GUT Alignment, then Clear walk badge; then GUT again and Full Alignment. On the
    // desktop width, where a mix leaves classic's drawer open (on a phone it closes it).
    await page.setViewportSize({ width: 1280, height: 800 });
    await tab(page, 'mixes');
    await page.getByTestId('peek-mixes').click();
    const drawer = page.locator('aside');
    await drawer.getByRole('button', { name: /^GUT Alignment/ }).click();
    await expect
      .poll(async () => { const s = await libraryState(page); return [s.walk, s.steps]; }, { message: 'GUT Alignment: the traditional nine but 852', timeout: 15_000 })
      .toEqual(['traditional', [0, 1, 2, 3, 4, 5, 6, 8]]);
    await expect.poll(() => vizStep(page), { timeout: 5_000 }).toBe(0);
    await loShuButton(page).click();
    // (A DOM click: the peek's "Back to the new layout" pill floats over the popover's foot.)
    await page.getByRole('button', { name: 'Clear walk badge', exact: true }).evaluate((b) => (b as HTMLElement).click());
    await ended('classic’s Clear walk badge');
    await expect.poll(() => vizStep(page), { message: 'no walk: -1', timeout: 5_000 }).toBe(-1);
    await drawer.getByRole('button', { name: /^GUT Alignment/ }).click();
    await expect.poll(async () => (await libraryState(page)).walk, { timeout: 15_000 }).toBe('traditional');
    await drawer.getByRole('button', { name: /^Full Alignment/ }).click();
    await ended('a Full Alignment (the walk-state effect)');
    expect(dialogs).toEqual([]);
  });
});

test.describe('desktop, classic', () => {
  test('4. no generator writes the library: the 13 mixes and the 6 walks leave the stored audio, metadata and library order alone, and delete nothing', async ({ page }) => {
    test.setTimeout(420_000);
    await countLibraryDeletes(page);
    await seedLibraryRecords(page, 30, { real: 30, seconds: 40 });
    const dialogs = await openApp(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the seeded library restores', timeout: 60_000 }).toBe(30);
    const drawer = page.locator('aside');
    // Auto-Distribute first (it writes every crystal: the one generator that may), then the baseline.
    await drawer.getByRole('button', { name: /^Auto-Distribute Frequencies/ }).click();
    await page.waitForTimeout(3000);
    const base = await cacheCounts(page);
    const baseOrder = (await savedState(page)).originalOrder as string[];
    expect([base.blobs, base.meta, base.library, base.libraryRaw]).toEqual([30, 30, 30, 30]);
    const settle = async (label: string) => {
      if ((await libraryState(page)).playing) {
        await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
        await expect.poll(async () => (await libraryState(page)).playing, { message: `${label}: paused`, timeout: 10_000 }).toBe(false);
      }
      await page.waitForTimeout(2600); // past the 2 s metadata debounce
      const c = await cacheCounts(page);
      expect.soft([c.blobs, c.meta, c.library, c.libraryRaw], `${label}: blobs, meta, library, libraryRaw`).toEqual([30, 30, 30, 30]);
      expect.soft(await page.evaluate(() => (window as any).__idbDeletes), `${label}: no IndexedDB delete or clear`).toBe(0);
      expect.soft((await savedState(page)).originalOrder, `${label}: the saved library order`).toEqual(baseOrder);
      expect.soft((await libraryState(page)).libraryIds, `${label}: the library in memory`).toEqual(baseOrder);
    };
    const MIXES = ['GUT Alignment', 'HEART Alignment', 'HEAD Alignment', 'Full Alignment', 'Qi Strength', 'Deep Healing', 'Mood Elevate', 'Meditation', 'Flow State', 'Golden Φ', '111 Sequence', '2178Hz Filter', 'Ultimate'];
    for (const label of MIXES) {
      await drawer.getByRole('button', { name: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
      await settle(label);
    }
    const WALKS = ['Layer Ascent', 'Pillar Walk', 'Flying Star Vortex', 'Combined Walk', 'Ouroboros', 'Calling a CABI'];
    for (const title of WALKS) {
      await loShuButton(page).click();
      await page.locator(`button[title^="${title}"]`).click();
      await expect.poll(async () => (await libraryState(page)).walk !== null, { message: `${title} starts`, timeout: 15_000 }).toBe(true);
      await settle(title);
    }
    expect(dialogs).toEqual([]);
  });
});

/**
 * Replace the LIBRARY in App's state (its originalPlaylist hook, found through the DevTools-shaped hook: the one state
 * hook holding exactly the library's tracks in library order) with the same tracks without their crystals. The play
 * order keeps its tracks, so a walk that plays goes on. No control does this (every way a crystal changes keeps it one of
 * the 27); it stands for the same-tick race in which a generator reads a library it can't match (spec §2.4).
 */
async function dropLibraryCrystals(page: Page): Promise<void> {
  const ids = (await libraryState(page)).libraryIds;
  const found = await page.evaluate((ids) => {
    const w = window as any;
    const same = (v: unknown) => Array.isArray(v) && v.length === ids.length && v.every((s: any, i: number) => s && s.id === ids[i]);
    const hits: any[] = [];
    const stack = [w.__root?.current];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        if (h.queue?.dispatch && same(h.memoizedState)) hits.push(h);
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    if (hits.length !== 1) return hits.length;
    hits[0].queue.dispatch(hits[0].memoizedState.map(({ harmonicFreq, closestSolfeggio, harmonicDeviation, ...s }: any) => s));
    return 1;
  }, ids);
  expect(found, 'exactly one state hook holds the library').toBe(1);
  await expect.poll(async () => (await libraryState(page)).crystals.every((c) => c === null), { message: 'the library has no crystal', timeout: 10_000 }).toBe(true);
}

test.describe('phone, the slips', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('5. GUT Alignment after an Ouroboros walk: its source line has no left-over phase, and the walk’s segments and phases are cleared (decision 3, slip a)', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openSeededNewLayout(page, 30, NO_852);
    await phoneSize(page);
    await startWalk(page, 'ouroboros');
    const o = await libraryState(page);
    expect(o.phases?.length, 'Ouroboros: one phase per entry').toBe(o.ids.length);
    await expect(page.getByTestId('np-source')).toContainText(' · ♾️');
    await tab(page, 'mixes');
    await page.getByTestId('peek-mixes').click();
    await page.locator('aside').getByRole('button', { name: /^GUT Alignment/ }).click();
    await expect.poll(async () => { const s = await libraryState(page); return [s.walk, s.segments, s.phases]; }, { message: 'GUT: traditional, no segments, no phases', timeout: 15_000 }).toEqual(['traditional', null, null]);
    await page.getByRole('button', { name: /Back to the new layout/ }).click();
    await tab(page, 'now');
    await expect(page.getByTestId('np-source')).toHaveText('Lo Shu walk · Solfeggio · step 1 of 8');
    expect(dialogs).toEqual([]);
  });

  test('6. a walk that finds nothing leaves the playing walk alone: a CAB plays, Layer Ascent finds no track, and the CAB keeps its segments ("Vortex 1/26") (decision 3, slip b)', async ({ page }) => {
    test.setTimeout(180_000);
    await vizPropsHook(page);
    const dialogs = await openSeededNewLayout(page, 30, NO_852);
    await phoneSize(page);
    await startWalk(page, 'combined');
    const cab = await libraryState(page);
    expect(cab.segments, 'the CAB: 26 per pass (no 852)').toEqual([26, 26, 26]);
    const source = (await page.getByTestId('np-source').textContent()) ?? '';
    expect(source, 'the source line names the CAB’s segment').toMatch(/^Lo Shu walk · .+ · step 1 of 78 · Vortex 1\/26$/);
    await dropLibraryCrystals(page);
    await page.getByTestId('np-walks').click();
    await page.getByTestId('walk-A').click();
    await expect(page.getByTestId('notices')).toContainText('Lo Shu · Layer Ascent: no matching songs in your library yet.');
    await page.waitForTimeout(500);
    const s = await libraryState(page);
    expect([s.walk, s.segments, s.phases, s.steps, s.ids], 'the CAB is untouched').toEqual(['combined', cab.segments, cab.phases, cab.steps, cab.ids]);
    await expect(page.getByTestId('np-source'), 'its source line keeps the segment').toHaveText(source);
    expect(dialogs).toEqual([]);
  });
});
