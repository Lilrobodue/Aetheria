import { type Locator, type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  acceptDisclaimerNew,
  addFiles,
  cacheCounts,
  countLibraryDeletes,
  crash,
  drawsPerSecond,
  layersState,
  libraryRowButton,
  libraryState,
  libraryUndo,
  openLibraryTab,
  pauseCount,
  peekClassicLibrary,
  recordHudDraws,
  renders,
  resetRenders,
  savedState,
  sheet,
  tab,
  toneWav,
  undoToast,
  LAYER_ENGINE_KEY,
  LAYER_OUTPUT_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
} from './helpers';
import { heard, mediaHooks, seedTones, toneName, vizProps, type ToneSeed } from './tones';

// v15.9, Stage B: the new layout's Mixes tab (components/shell/mixes/), in place of v15.5's stub. The six walks as
// tiles, the journeys, crystal sets and Experimental scores as rows, each with what it would play right now; a tap
// starts the mix (App's startMix → the classic generator → startPlayOrder) and the tab stays. Synthetic tones only.

/** The default library: 30 tones, the 27 crystals in turn but none at 852 (tone-08), every one with a crystal Deep
 *  Scanned, two over Golden Φ's 30 % (tone-21 at 60 %, tone-23 at 50 %). */
const LIB: ToneSeed = { n: 30, crystal: (i) => (i === 7 ? null : [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336][i % 27]), scanned: () => true, golden: (i) => (i === 20 ? 0.6 : i === 22 ? 0.5 : 0.2) };
/** What each mix plays on LIB (the counts are mixCounts': each must be what a tap then plays). */
const EXPECTED: Record<string, string> = {
  'walk:A': '26 of 27 positions', 'walk:B': '26 of 27 positions', 'walk:C': '26 of 27 positions', 'walk:combined': '78 of 81 positions',
  'walk:ouroboros': '28 of 29 positions', 'walk:cabi': '106 of 110 positions',
  gut: '8 tracks', heart: '9 tracks', head: '9 tracks', ultimate: '26 tracks', full: '29 tracks',
  'preset:qi': '7 tracks', 'preset:healing': '5 tracks', 'preset:mood': '4 tracks', 'preset:meditation': '2 tracks', 'preset:flow': '6 tracks',
  golden: '2 tracks', seq111: '9 tracks', source2178: '1 track',
};
const IDS = Object.keys(EXPECTED);
const WALK_IDS = IDS.filter((id) => id.startsWith('walk:'));
const mix = (page: Page, id: string): Locator => page.getByTestId(`mix-${id}`);
const countOf = (text: string) => Number(/^(\d+)/.exec(text)![1]);

/** The new layout (v2, Headphones) over a seeded tone library, then the Mixes tab. */
async function openMixes(page: Page, s: ToneSeed = LIB, o: { open?: boolean; before?: () => Promise<void> } = {}): Promise<void> {
  await page.addInitScript(({ keys }) => {
    localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
    if (sessionStorage.getItem('__mixesTab') === null) {
      sessionStorage.setItem('__mixesTab', '1');
      localStorage.setItem(keys.layout, 'new');
      localStorage.setItem(keys.engine, 'v2');
      localStorage.setItem(keys.output, 'headphones');
    }
  }, { keys: { layout: LAYOUT_KEY, engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY } });
  await mediaHooks(page);
  if (o.before) await o.before();
  await seedTones(page, s);
  await page.goto('/');
  await acceptDisclaimerNew(page);
  if (o.open === false) return;
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the library restores', timeout: 60_000 }).toBe(s.n - (s.noBlob?.length ?? 0));
  await tab(page, 'mixes');
  await expect(page.getByTestId('tab-mixes')).toBeVisible();
}

/** Wait until a mix plays: its order (`n` entries) from its first track, the music element on that track. */
async function expectMixPlays(page: Page, n: number, what: string): Promise<void> {
  await expect
    .poll(async () => { const s = await libraryState(page); const h = await heard(page); return s.ids.length === n && s.cursor === 0 && s.playing && h.name === s.names[0]; }, { message: `${what} plays its ${n}`, timeout: 15_000 })
    .toBe(true);
}

test.beforeEach(async ({ page, viewport }) => {
  if (ON_DEVICE && viewport) await page.setViewportSize(viewport);
});

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('M1. the tab: the heading, the summary, six walk tiles, five journeys, five sets, three Experimental rows; every count is what its tap plays; the visuals pause behind it @mobile', async ({ page }) => {
    test.setTimeout(240_000);
    await recordHudDraws(page);
    await openMixes(page);
    const t = page.getByTestId('tab-mixes');
    await expect(t.getByRole('heading', { name: 'Mixes', level: 1 })).toBeVisible();
    await expect(t.getByText('Beta', { exact: true })).toBeVisible();
    await expect(page.getByTestId('mixes-summary')).toHaveText('30 tracks · 29 with a crystal');
    await expect(t.getByText('A tap builds a play order from your library and starts it. ⋯ queues it, saves it or changes it.')).toBeVisible();
    await expect(page.getByText('The new Mixes are coming in a later beta')).toHaveCount(0);
    for (const [h2, ids] of [['Lo Shu walks', 6], ['Journeys', 5], ['Crystal sets', 5], ['Experimental', 3]] as const) {
      const list = t.getByRole('list', { name: h2, exact: true });
      await expect(list.getByRole('listitem'), h2).toHaveCount(ids);
    }
    // Every count, and then the tap: what plays is exactly that many entries, from the first, and the tab stays.
    const seen: Record<string, string> = {};
    for (const id of IDS) {
      const b = mix(page, id);
      await b.scrollIntoViewIfNeeded();
      const label = (await b.getAttribute('aria-label')) ?? '';
      const text = label.split(', ')[label.split(', ').length - (label.endsWith(', playing') ? 2 : 1)];
      seen[id] = text;
      await b.click();
      await expectMixPlays(page, countOf(text), id);
      await expect(page.getByTestId('tab-mixes'), `${id}: the tab stays`).toBeVisible();
    }
    expect(seen, 'the counts on this library').toEqual(EXPECTED);
    // The visuals pause behind the solid tab, and resume on Now Playing.
    await expect.poll(async () => Math.max(...(await drawsPerSecond(page, 1))), { message: 'the visualizer stops', timeout: 10_000, intervals: [0] }).toBe(0);
    await tab(page, 'now');
    await expect.poll(async () => Math.min(...(await drawsPerSecond(page, 1))), { message: 'the visualizer draws again', timeout: 10_000, intervals: [0] }).toBeGreaterThanOrEqual(8);
  });

  test('M2. Grounding from a library track plays its own first track, says "Playing Grounding: 7 tracks." with Undo, and stays on the tab; Undo goes back @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await openMixes(page);
    await openLibraryTab(page);
    await libraryRowButton(page, toneName(4)).click();
    await expect.poll(async () => { const h = await heard(page); return h.name === toneName(4) && h.t > 0.5; }, { message: 'tone-05 plays', timeout: 20_000 }).toBe(true);
    const before = await libraryState(page);
    await tab(page, 'mixes');
    await mix(page, 'preset:qi').click();
    await expectMixPlays(page, 7, 'Grounding');
    const s = await libraryState(page);
    expect(s.names, 'the 174, 285, 396 and 417 tracks').toEqual([0, 27, 1, 28, 2, 29, 3].map(toneName));
    const h = await heard(page);
    expect(h.name).toBe(toneName(0));
    expect(h.t, 'from its start').toBeLessThan(3);
    await expect.poll(async () => (await heard(page)).card, { message: 'the lock-screen card' }).toBe(toneName(0));
    await expect(page.getByTestId('mini-title')).toHaveText(toneName(0));
    await expect(undoToast(page)).toContainText('Playing Grounding: 7 tracks.');
    await expect(page.getByTestId('tab-mixes'), 'still on Mixes').toBeVisible();
    await expect(mix(page, 'preset:qi'), 'the focus stays on the tapped row').toBeFocused();
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => { const u = await libraryState(page); return [u.ids, u.current]; }, { message: 'back to the library at tone-05', timeout: 15_000 })
      .toEqual([before.ids, toneName(4)]);
  });

  test('M3. a walk tile plays the walk; its tile says Playing (aria-current), Paused while the music is paused, and the Walks sheet agrees', async ({ page }) => {
    test.setTimeout(120_000);
    await openMixes(page);
    await mix(page, 'walk:C').click();
    await expect.poll(async () => { const s = await libraryState(page); return s.walk === 'C' && s.playing && s.ids.length === 26; }, { timeout: 15_000 }).toBe(true);
    await expect(undoToast(page)).toContainText('Playing Flying Star Vortex: 26 of 27 positions.');
    const tile = mix(page, 'walk:C');
    await expect(tile).toHaveAttribute('aria-current', 'true');
    await expect(tile).toHaveAccessibleName('Flying Star Vortex, 26 of 27 positions, playing');
    await expect(tile).toContainText('Playing');
    for (const id of WALK_IDS.filter((x) => x !== 'walk:C')) await expect(mix(page, id), `${id} is not playing`).not.toHaveAttribute('aria-current', 'true');
    // Paused: the walk is still the play order (aria-current), and its tile says so.
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing, { message: 'paused' }).toBe(false);
    await expect(tile).toHaveAccessibleName('Flying Star Vortex, 26 of 27 positions, paused');
    await expect(tile).toContainText('Paused');
    await expect(tile).not.toContainText('Playing');
    await expect(tile).toHaveAttribute('aria-current', 'true');
    await page.getByTestId('mini-player').getByRole('button', { name: 'Play', exact: true }).click();
    await expect(tile).toHaveAccessibleName('Flying Star Vortex, 26 of 27 positions, playing');
    await expect(tile).toContainText('Playing');
    await tab(page, 'now');
    await page.getByTestId('np-walks').click();
    await expect(page.getByTestId('walk-C')).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    // Another walk from the sheet: the tab follows.
    await page.getByTestId('np-walks').click();
    await page.getByTestId('walk-A').click();
    await expect.poll(async () => (await libraryState(page)).walk, { timeout: 15_000 }).toBe('A');
    await tab(page, 'mixes');
    await expect(mix(page, 'walk:A')).toHaveAttribute('aria-current', 'true');
    await expect(mix(page, 'walk:C')).not.toHaveAttribute('aria-current', 'true');
  });

  test('M4a. an empty library: "Nothing to mix yet", and Import music opens the Import sheet', async ({ page }) => {
    test.setTimeout(90_000);
    await openMixes(page, { n: 0 });
    await expect(page.getByTestId('mixes-empty')).toContainText('Nothing to mix yet');
    await expect(page.getByTestId('mixes-empty')).toContainText('Mixes are built from your library. Import music first; your files are not changed.');
    await expect(page.locator('[data-testid^="mix-"]'), 'no tiles').toHaveCount(0);
    await page.getByTestId('mixes-empty').getByRole('button', { name: 'Import music', exact: true }).click();
    await expect(sheet(page, 'Import music')).toBeVisible();
    await expect(page.getByTestId('import-body')).toBeVisible();
  });

  test('M4b. no crystals: the card, every mix dimmed "No tracks yet"; Open Library opens the Library tab; Assign crystals gives every track one and the counts appear', async ({ page }) => {
    test.setTimeout(120_000);
    await openMixes(page, { n: 30, crystal: () => null });
    const card = page.getByTestId('mixes-no-crystals');
    await expect(card).toContainText('Your tracks have no crystals yet');
    await expect(card).toContainText('Every mix follows the crystals. Assign them now (instant), or let Deep Scan measure them (slow).');
    for (const id of IDS) {
      await expect(mix(page, id), `${id}: dimmed, not a button`).toContainText('No tracks yet');
      expect(await mix(page, id).evaluate((el) => el.tagName), id).not.toBe('BUTTON');
    }
    await expect(page.getByTestId('mixes-111-open'), 'the 111 line’s Open stays live').toBeEnabled();
    await card.getByRole('button', { name: 'Open Library', exact: true }).click();
    await expect(page.getByTestId('tab-library')).toBeVisible();
    await tab(page, 'mixes');
    await card.getByRole('button', { name: 'Assign crystals', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).crystals.every((c) => typeof c === 'number' && c > 0), { message: 'Assign gave every track a crystal', timeout: 15_000 }).toBe(true);
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('mixes-summary')).toHaveText('30 tracks · 30 with a crystal');
    await expect(mix(page, 'gut')).toHaveAccessibleName(/^GUT Alignment, \d+ tracks?$/);
    expect(await mix(page, 'gut').evaluate((el) => el.tagName)).toBe('BUTTON');
    await expect(mix(page, 'golden'), 'nothing Deep Scanned yet').toContainText('Needs Deep Scan');
  });

  test('M4c. no Deep Scan: the Experimental rows say "Needs Deep Scan" and are not buttons; the other mixes play', async ({ page }) => {
    test.setTimeout(120_000);
    await openMixes(page, { n: 30 });
    for (const id of ['golden', 'seq111', 'source2178']) {
      await expect(mix(page, id)).toContainText('Needs Deep Scan');
      expect(await mix(page, id).evaluate((el) => el.tagName), id).not.toBe('BUTTON');
    }
    await expect(mix(page, 'gut')).toHaveAccessibleName('GUT Alignment, 9 tracks');
    await expect(page.getByTestId('mixes-experimental')).toContainText('They need tracks Deep Scan has measured.');
    await mix(page, 'gut').click();
    await expectMixPlays(page, 9, 'GUT Alignment');
  });

  test('M5. the 111 Sequence’s Open goes to Layers › Crystal, scrolled to it; the 111 Hz chip there plays 111 Hz', async ({ page }) => {
    test.setTimeout(120_000);
    await openMixes(page);
    await expect(page.getByTestId('mixes-experimental')).toContainText('Plays each track’s own crystal. For a 111 Hz tone: Layers › Crystal');
    const open = page.getByTestId('mixes-111-open');
    await open.scrollIntoViewIfNeeded();
    await expect(open).toHaveAccessibleName('Open Layers › Crystal');
    await open.click();
    await expect(page.getByTestId('tab-layers')).toBeVisible();
    const chip = page.getByTestId('layers-crystal').getByTestId('crystal-111');
    await expect.poll(async () => { const b = await page.getByTestId('layers-crystal').boundingBox(); return !!b && b.y >= 0 && b.y < PHONE_VIEWPORT.height - 200; }, { message: 'the Crystal section in view' }).toBe(true);
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await expect.poll(async () => (await vizProps(page))?.hz, { message: 'the tone is 111 Hz' }).toBe(111);
  });

  test('M6. while the library is still being read back, every mix waits ("Loading your library…"); then the counts and the buttons come', async ({ page }) => {
    test.setTimeout(120_000);
    // Hold the restore's metadata read until the test lets it go.
    await page.addInitScript(() => {
      const w = window as any;
      w.__holdRestore = true;
      w.__held = [];
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...a: unknown[]) {
        const req = (getAll as any).apply(this, a);
        if (this.name !== 'meta' || !w.__holdRestore) return req;
        let user: ((e: Event) => void) | null = null;
        Object.defineProperty(req, 'onsuccess', { configurable: true, get: () => user, set: (fn) => { user = fn; } });
        req.addEventListener('success', (e: Event) => {
          const fire = () => user && user.call(req, e);
          if (w.__holdRestore) w.__held.push(fire);
          else fire();
        });
        return req;
      };
      w.__releaseRestore = () => { w.__holdRestore = false; for (const f of w.__held.splice(0)) f(); };
    });
    await openMixes(page, LIB, { open: false });
    await tab(page, 'mixes');
    await expect(page.getByTestId('mixes-summary')).toHaveText('Loading your library…');
    await expect(page.getByTestId('mixes-empty'), 'not "Nothing to mix yet" while it loads').toHaveCount(0);
    for (const id of ['walk:A', 'gut', 'preset:qi', 'golden']) {
      await expect(mix(page, id)).toContainText('Loading…');
      expect(await mix(page, id).evaluate((el) => el.tagName), id).not.toBe('BUTTON');
    }
    await page.evaluate(() => (window as any).__releaseRestore());
    await expect(page.getByTestId('mixes-summary')).toHaveText('30 tracks · 29 with a crystal', { timeout: 15_000 });
    await expect(mix(page, 'gut')).toHaveAccessibleName('GUT Alignment, 8 tracks');
    await mix(page, 'gut').click();
    await expectMixPlays(page, 8, 'GUT Alignment');
  });

  test('M6b. a restore that never settles: the wait ends after its bound (the empty state), and an import ends it at once', async ({ page }) => {
    test.setTimeout(150_000);
    // The restore's metadata read never comes back (an IndexedDB request that never fires).
    await page.addInitScript(() => {
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...a: unknown[]) {
        const req = (getAll as any).apply(this, a);
        if (this.name === 'meta') Object.defineProperty(req, 'onsuccess', { configurable: true, get: () => null, set: () => {} });
        return req;
      };
    });
    await openMixes(page, LIB, { open: false });
    const t0 = Date.now();
    await tab(page, 'mixes');
    await expect(page.getByTestId('mixes-summary')).toHaveText('Loading your library…');
    // The bound (15 s from the first render): then what there is, an empty library.
    await expect(page.getByTestId('mixes-empty'), 'the wait ends').toBeVisible({ timeout: 25_000 });
    const waited = Date.now() - t0;
    expect(waited, 'not before its bound').toBeGreaterThan(9_000);
    await expect(page.getByTestId('mixes-summary')).toHaveCount(0);
    // An import ends a wait at once: a fresh page, the restore stalled again, a file added from the Import sheet.
    await page.reload();
    await acceptDisclaimerNew(page);
    await tab(page, 'mixes');
    await expect(page.getByTestId('mixes-summary')).toHaveText('Loading your library…');
    await tab(page, 'library');
    await page.getByTestId('library-import').click();
    await addFiles(page, [{ name: 'new-1.wav', mimeType: 'audio/wav', buffer: toneWav(3, 340) }]);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 15_000 }).toBe(1);
    await page.keyboard.press('Escape');
    await tab(page, 'mixes');
    await expect(page.getByTestId('mixes-no-crystals'), 'the imported track (no crystal yet), with no wait').toBeVisible({ timeout: 3_000 });
    expect(Date.now() - t0 < 60_000).toBe(true);
  });

  test('M13. a mix tapped in a classic peek, then back to the new layout: its Undo toast stays, and no classic notice lands there (Ultimate’s at once, 111’s after 500 ms)', async ({ page }) => {
    test.setTimeout(150_000);
    await openMixes(page);
    const notices = page.getByTestId('notices');
    for (const [label, toast, notice] of [
      ['111 Sequence', 'Playing 111 Sequence: 9 tracks.', '111 Pattern Complete Journey'],
      ['Ultimate', 'Playing Ultimate: 26 tracks.', 'Ultimate Alignment activated'],
    ] as const) {
      await peekClassicLibrary(page);
      await expect(page.locator('aside').getByRole('button', { name: new RegExp('^' + label) }).first()).toBeAttached();
      // The mix, then straight back (inside 111's 500 ms): DOM clicks, one task apart.
      await page.evaluate((label) => {
        const b = [...document.querySelectorAll('aside button')].find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim().startsWith(label)) as HTMLButtonElement;
        b.click();
      }, label);
      await page.getByTestId('peek-pill').evaluate((b) => (b as HTMLElement).click());
      await expect(page.getByTestId('new-shell')).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(notices, `${label}: the Undo toast stays`).toContainText(toast);
      await expect(notices.getByRole('button', { name: 'Undo', exact: true }), `${label}: Undo offered`).toHaveCount(1);
      await expect(notices, `${label}: no classic notice in the new layout`).not.toContainText(notice);
      await expect(page.getByText('Analysis Status', { exact: true })).toHaveCount(0);
      await page.waitForTimeout(1000);
      await expect(notices, `${label}: still none a second later`).not.toContainText(notice);
      if (label === '111 Sequence') {
        // Its notice (500 ms) never fired after the peek ended: a second peek, inside the notice's 10 s, shows none.
        await peekClassicLibrary(page);
        await page.waitForTimeout(500);
        await expect(page.getByText(/111 Pattern Complete Journey/), 'the delayed notice did not fire into the new layout').toHaveCount(0);
        await page.getByTestId('peek-pill').evaluate((b) => (b as HTMLElement).click());
        await expect(page.getByTestId('new-shell')).toBeVisible();
      }
    }
  });

  test('M7. accessibility: every mix a named button with its recipe as its description, ≥ 44 × 44; lists labelled by their headings; keyboard activation', async ({ page }) => {
    test.setTimeout(120_000);
    await openMixes(page);
    const t = page.getByTestId('tab-mixes');
    await expect(t.locator('[data-view-heading]')).toBeFocused();
    for (const id of IDS) {
      const b = mix(page, id);
      await expect(b).toHaveAccessibleName(new RegExp(`, ${EXPECTED[id]}$`));
      const sub = await b.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? null);
      expect(sub, `${id}: described by its recipe`).toBeTruthy();
      await expect(b).toHaveAccessibleDescription(sub!);
    }
    const small = await t.locator('button').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { name: b.getAttribute('aria-label') ?? b.textContent, w: r.width, h: r.height }; }).filter((r) => r.w < 44 || r.h < 44));
    expect(small, 'no target under 44 × 44').toEqual([]);
    const tiles = await t.locator('[data-testid^="mix-walk:"]').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
    expect(Math.min(...tiles), 'walk tiles ≥ 96 px').toBeGreaterThanOrEqual(96);
    const rows = await t.locator('[data-testid="mix-gut"], [data-testid="mix-preset:qi"], [data-testid="mix-golden"]').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
    expect(rows, 'rows 64 px').toEqual([64, 64, 64]);
    for (const h of ['Lo Shu walks', 'Journeys', 'Crystal sets', 'Experimental']) await expect(t.getByRole('list', { name: h, exact: true })).toHaveCount(1);
    // Keyboard: focus a row, Enter starts it.
    await mix(page, 'preset:flow').focus();
    await page.keyboard.press('Enter');
    await expectMixPlays(page, 6, 'Flow by keyboard');
    await expect(undoToast(page)).toContainText('Playing Flow: 6 tracks.');
  });

  test('M8. idle, and while a mix plays, nothing on the tab re-renders (only the mini-player’s progress)', async ({ page }) => {
    test.setTimeout(120_000);
    await openMixes(page);
    await expect(page.getByText(/Restored \d+ tracks/), 'the restore’s save gate closed').toHaveCount(0, { timeout: 10_000 });
    await resetRenders(page);
    await page.waitForTimeout(3000);
    expect(Object.keys(await renders(page)).filter((k) => k.startsWith('Mixes')), 'idle: no render').toEqual([]);
    await mix(page, 'preset:qi').click();
    await expectMixPlays(page, 7, 'Grounding');
    await page.waitForTimeout(1500);
    await resetRenders(page);
    await page.waitForTimeout(3000);
    const r = await renders(page);
    expect(Object.keys(r).filter((k) => k.startsWith('Mixes')), 'the tab: no render while it plays').toEqual([]);
    expect(r.App ?? 0, 'App follows the clock (4/s), as before').toBeGreaterThan(0);
  });

  test('M10. a crash in each of the tab’s three regions keeps the music and the rest of the tab; Reload panel brings it back', async ({ page }) => {
    test.setTimeout(180_000);
    await openMixes(page);
    await mix(page, 'preset:qi').click();
    await expectMixPlays(page, 7, 'Grounding');
    const regions = [
      { view: 'mixes-walks' as const, content: 'mixes-walks', others: ['mixes-journeys', 'mixes-experimental'] },
      { view: 'mixes-lists' as const, content: 'mixes-journeys', others: ['mixes-walks', 'mixes-experimental'] },
      { view: 'mixes-experimental' as const, content: 'mixes-experimental', others: ['mixes-walks', 'mixes-sets'] },
    ];
    for (const r of regions) {
      const pauses = await pauseCount(page);
      const t0 = (await libraryState(page)).t ?? 0;
      await crash(page, r.view);
      const fallback = page.getByTestId(`${r.view}-fallback`);
      await expect(fallback, `${r.view}: its fallback`).toBeVisible();
      await expect(page.getByTestId(r.content), `${r.view}: gone`).toHaveCount(0);
      for (const o of r.others) await expect(page.getByTestId(o), `${r.view}: ${o} stays`).toBeVisible();
      await expect(page.getByTestId('tab-mixes')).toBeVisible();
      await expect.poll(async () => { const s = await libraryState(page); return s.playing && (s.t ?? 0) > t0; }, { message: `${r.view}: the music plays on` }).toBe(true);
      expect(await pauseCount(page), `${r.view}: never paused`).toBe(pauses);
      await fallback.getByRole('button', { name: 'Reload panel', exact: true }).click();
      await expect(page.getByTestId(r.content), `${r.view}: back`).toBeVisible();
    }
  });

  test('M11. data safety from the tab: every mix, then Undo, never changes the stored audio, metadata or library, and deletes nothing', async ({ page }) => {
    test.setTimeout(480_000);
    await countLibraryDeletes(page);
    await openMixes(page);
    await page.waitForTimeout(3000);
    const base = await cacheCounts(page);
    const baseOrder = (await savedState(page)).originalOrder as string[];
    expect([base.blobs, base.meta, base.library, base.libraryRaw]).toEqual([30, 30, 30, 30]);
    const settle = async (label: string) => {
      await page.waitForTimeout(2600); // past the 2 s metadata debounce
      const c = await cacheCounts(page);
      expect.soft([c.blobs, c.meta, c.library, c.libraryRaw], `${label}: blobs, meta, library, libraryRaw`).toEqual([30, 30, 30, 30]);
      expect.soft(await page.evaluate(() => (window as any).__idbDeletes), `${label}: no IndexedDB delete or clear`).toBe(0);
      expect.soft((await savedState(page)).originalOrder, `${label}: the saved library order`).toEqual(baseOrder);
      expect.soft((await libraryState(page)).libraryIds, `${label}: the library in memory`).toEqual(baseOrder);
    };
    for (const id of IDS) {
      const b = mix(page, id);
      await b.scrollIntoViewIfNeeded();
      await b.click();
      await expectMixPlays(page, countOf(EXPECTED[id]), id);
      await settle(id);
      await libraryUndo(page);
      await settle(`${id}, then Undo`);
    }
  });

  test('M12. 30 s of playback with the tab open: the counts are computed once', async ({ page }) => {
    test.setTimeout(120_000);
    await openMixes(page);
    await mix(page, 'walk:A').click();
    await expect.poll(async () => (await libraryState(page)).playing, { timeout: 15_000 }).toBe(true);
    const c0 = (await renders(page))['MixesTab:counts'] ?? 0;
    expect(c0, 'once (twice under React’s dev StrictMode)').toBeGreaterThanOrEqual(1);
    expect(c0).toBeLessThanOrEqual(2);
    await page.waitForTimeout(30_000);
    expect((await renders(page))['MixesTab:counts'] ?? 0, 'no new count in 30 s of playback').toBe(c0);
    expect((await libraryState(page)).playing).toBe(true);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('M9. the Mixes panel: non-modal, the transport works meanwhile, a tap plays and the panel stays; Escape closes it', async ({ page }) => {
    test.setTimeout(150_000);
    await openMixes(page);
    const panel = page.getByTestId('desktop-panel');
    await expect(panel.getByTestId('tab-mixes')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Close panel', exact: true })).toBeVisible();
    await mix(page, 'preset:healing').click();
    await expectMixPlays(page, 5, 'Stillness');
    await expect(undoToast(page)).toContainText('Playing Stillness: 5 tracks.');
    await expect(panel.getByTestId('tab-mixes'), 'the panel stays').toBeVisible();
    // The transport, beside the panel.
    const transport = page.getByTestId('desktop-transport');
    await transport.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await transport.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
    await transport.getByRole('button', { name: 'Next track', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).cursor).toBe(1);
    await expect(panel.getByTestId('tab-mixes')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tab-mixes')).toHaveCount(0);
    expect((await libraryState(page)).playing, 'the music plays on').toBe(true);
    expect((await layersState(page))?.requested?.tone_hz ?? null, 'the layers on the playing track').not.toBe(222);
  });
});
