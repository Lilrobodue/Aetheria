import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import { libraryRowButton, libraryState, openLibraryTab, seedLibraryRecords, tab, PHONE_VIEWPORT } from './helpers';
import {
  CRY,
  MIX_IDS,
  builderWrites,
  openMixMenu,
  GROUNDING,
  WALK_A,
  WALK_C,
  WALK_CAB,
  S,
  bstate,
  filled,
  heard,
  idsOf,
  instrumentBuilder,
  launchBuilder,
  libraryKs,
  openBuilderApp,
  qstate,
  queueMixHook,
  setAll,
  startHook,
  toastText,
  toneName,
  undoButton,
  walkPick,
} from './builderSeed';

// v16.3, whole-mix queueing (spec §5.5): a Mixes-tab mix, whole, through the queue's one writer and v16.0's anchor rule.
// Stage A drives App's queueMix through the dev hook (inside a click event); Stage B adds the ⋯'s UI path. The expected
// orders come from builderSeed.ts's oracles over the seed.

async function playLibraryFrom(page: Page, k: number): Promise<void> {
  await openLibraryTab(page);
  await libraryRowButton(page, toneName(k)).click();
  await expect.poll(() => heard(page), { message: `${toneName(k)} plays` }).toBe(toneName(k));
  await expect.poll(async () => { const s = await libraryState(page); return s.cursor === k && s.playing; }, { message: `${toneName(k)} is the current track` }).toBe(true);
}
const upNextTitles = (page: Page) => page.getByTestId('queue-row').locator('[data-row-title]').allTextContents();
const sourceLine = (page: Page) => page.getByTestId('np-source');

test.beforeEach(async ({ page }) => {
  if (ON_DEVICE) await page.setViewportSize(PHONE_VIEWPORT);
});

// ---------------------------------------------------------------------------------------------------------------
// Q1. Play next, a crystal set.
// ---------------------------------------------------------------------------------------------------------------
test('Q1. Grounding, Play next: its recipe order right after the playing entry; "Playing next: 9 tracks from Grounding."; Up next lists them; one Undo removes all 9 @mobile', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await playLibraryFrom(page, 2);
  const mix = setAll(libraryKs, GROUNDING);
  expect(mix.length).toBe(9);
  // Stage B: the Grounding row's ⋯ (Stage A drove queueMix through the hook; Q4 still does, for its timing).
  const menu = await openMixMenu(page, 'preset:qi', 'Grounding');
  await expect(menu.getByTestId('mix-menu-sub')).toHaveText('174 · 285 · 396 · 417 Hz · 9 tracks');
  await expect(menu.getByTestId('mix-action-next')).toContainText('All 9, right after the track that’s playing, in the mix’s order.');
  await expect(menu.getByTestId('mix-action-queue'), 'nothing waiting: the same place').toContainText('All 9, right after the track that’s playing, in the mix’s order.');
  await expect(menu.getByTestId('mix-action-save')).toContainText('A new playlist of these 9, in the mix’s order');
  await menu.getByTestId('mix-action-next').click();
  await expect(menu, 'the sheet closes first').toHaveCount(0);
  await expect.poll(async () => (await bstate(page)).ids, { message: 'right after the playing entry, in the recipe\'s order' }).toEqual([...ids.slice(0, 3), ...idsOf(ids, mix), ...ids.slice(3)]);
  expect((await bstate(page)).cursor, 'the playing track stays').toBe(2);
  await expect(toastText(page)).toContainText('Playing next: 9 tracks from Grounding.');
  await tab(page, 'now');
  await page.getByTestId('np-upnext').click();
  await expect.poll(() => upNextTitles(page), { message: 'Up next lists them' }).toEqual(mix.map(toneName));
  await page.keyboard.press('Escape');
  await undoButton(page).click();
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'one Undo removes all 9' }).toBe(0);
  expect((await bstate(page)).ids).toEqual(ids);
});

// ---------------------------------------------------------------------------------------------------------------
// Q2. Add to queue, a walk, while the library plays.
// ---------------------------------------------------------------------------------------------------------------
test('Q2. Vortex, Add to queue while the library plays: after the 2 waiting, the walk\'s picks in order; no walk starts; "They play as tracks, not as a walk." @mobile', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await playLibraryFrom(page, 2);
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), [ids[25], ids[26]]);
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(2);
  const vortex = walkPick(libraryKs, WALK_C);
  const menu = await openMixMenu(page, 'walk:C', 'Flying Star Vortex');
  await expect(menu.getByTestId('mix-menu-sub')).toHaveText('Flying Star spiral · 24 of 27 positions');
  await expect(menu.getByTestId('mix-action-next')).toContainText('All 24, right after the track that’s playing, in the mix’s order. They play as tracks, not as a walk.');
  await expect(menu.getByTestId('mix-action-queue')).toContainText('All 24, after the 2 tracks waiting in your queue. They play as tracks, not as a walk.');
  await expect(menu.getByTestId('mix-action-queue'), 'Vortex is no random draw').not.toContainText('A new draw.');
  await menu.getByTestId('mix-action-queue').click();
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'after the 2 waiting, the walk\'s order' }).toEqual([25, 26, ...vortex].map(toneName));
  expect((await bstate(page)).walk, 'the library plays on, no walk').toBeNull();
  await expect(toastText(page)).toContainText(`Added ${vortex.length} tracks from Flying Star Vortex to your queue. They play as tracks, not as a walk.`);
});

// ---------------------------------------------------------------------------------------------------------------
// Q3. A walk queued during a walk.
// ---------------------------------------------------------------------------------------------------------------
test('Q3. Vortex queued while Ascent plays: Ascent stays the walk, the queued entries are step −1; reaching them the line says "Your queue · 1 of 24 · then Ascent step 2 …"; after a reload the walk and the queue are back', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await startHook(page, S({ follow: { kind: 'walk', mode: 'A' } }));
  const ascent = walkPick(libraryKs, WALK_A);
  await expect.poll(async () => (await bstate(page)).ids, { message: 'Ascent plays' }).toEqual(idsOf(ids, ascent));
  await expect.poll(() => heard(page)).toBe(toneName(ascent[0]));
  const vortex = walkPick(libraryKs, WALK_C);
  await (await openMixMenu(page, 'walk:C', 'Flying Star Vortex')).getByTestId('mix-action-queue').click();
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'the 24 queued' }).toBe(vortex.length);
  let s = await bstate(page);
  expect(s.walk, 'Ascent stays the walk').toBe('A');
  expect(s.steps?.filter((x) => x === -1).length, 'each queued entry is step −1').toBe(vortex.length);
  expect(s.ids.slice(1, 1 + vortex.length), 'right after the playing step').toEqual(idsOf(ids, vortex));
  await tab(page, 'now');
  await expect(sourceLine(page)).toHaveText('Lo Shu walk · Ascent · step 1 of 24');
  await page.getByRole('button', { name: 'Next track', exact: true }).first().click();
  await expect.poll(() => heard(page), { message: 'the first queued plays' }).toBe(toneName(vortex[0]));
  await expect(sourceLine(page)).toHaveText(/^Your queue · 1 of 24 · then Ascent step 2 of 24$/);
  s = await bstate(page);
  expect(s.walk, 'still Ascent').toBe('A');
  await page.waitForTimeout(2500); // the play order's save
  await page.reload();
  await launchBuilder(page);
  await expect.poll(async () => (await bstate(page)).walk, { message: 'the walk is back' }).toBe('A');
  s = await bstate(page);
  expect(s.ids, 'the play order is back').toEqual([ids[ascent[0]], ...idsOf(ids, vortex), ...idsOf(ids, ascent.slice(1))]);
  expect(s.steps?.filter((x) => x === -1).length, 'and its queued entries').toBe(vortex.length);
  expect((await qstate(page)).waiting.length, 'still waiting (less the one played)').toBe(vortex.length - 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Q4. Large: Full Alignment on 440 tracks.
// ---------------------------------------------------------------------------------------------------------------
test('Q4. Full Alignment queued on 440 seeded tracks: one write; Up next lists 100 then "and 340 more queued"; Undo removes all; the tap ≤ 50 ms of script', async ({ page }) => {
  test.setTimeout(180_000);
  await instrumentBuilder(page);
  await seedLibraryRecords(page, 440, { crystals: 'all', real: 2, seconds: 30 });
  await launchBuilder(page, { n: 440 });
  const ms: number = await page.evaluate(() => {
    const t0 = performance.now();
    (window as any).__tap(() => (window as any).__aetheriaBuilder.queueMix('full', 'queue'));
    return performance.now() - t0;
  });
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'all 440 queued in one write' }).toBe(440);
  test.info().annotations.push({ type: 'Full Alignment, 440 tracks: the tap', description: `${ms.toFixed(1)} ms` });
  expect(ms, 'the tap\'s script').toBeLessThanOrEqual(50);
  await expect(toastText(page)).toContainText('Queued: 440 tracks from Full Alignment. Play starts with them.');
  expect((await qstate(page)).undo, 'one write, one Undo').not.toBeNull();
  await tab(page, 'now');
  await page.getByTestId('np-upnext').click();
  await expect.poll(async () => (await upNextTitles(page)).length, { message: 'the first 100' }).toBe(100);
  await expect(page.getByText('and 340 more queued', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await undoButton(page).click();
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'Undo removes every one' }).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// Q5. A start in flight.
// ---------------------------------------------------------------------------------------------------------------
test('Q5. a mix queued while a start is in flight lands after the starting track', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await openLibraryTab(page);
  await page.evaluate(() => { (window as any).__holdDecode = true; });
  await page.getByTestId('library-search').fill(toneName(29)); // its row is below the list's window: the search finds it (a tap still plays the whole library)
  await libraryRowButton(page, toneName(29)).click(); // no crystal: decoded, held
  await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
  await (await openMixMenu(page, 'preset:qi', 'Grounding')).getByTestId('mix-action-next').click();
  await page.waitForTimeout(400);
  await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
  await expect.poll(() => heard(page)).toBe(toneName(29));
  await expect.poll(async () => (await bstate(page)).ids, { message: 'Grounding after the started track' }).toEqual([...ids, ...idsOf(ids, setAll(libraryKs, GROUNDING))]);
  expect((await bstate(page)).cursor).toBe(29);
});

// ---------------------------------------------------------------------------------------------------------------
// Q6. Random walks: each Add to queue a new, full draw.
// ---------------------------------------------------------------------------------------------------------------
test('Q6. CAB twice: two full draws (each the 72 filled positions, crystal by crystal), the second after the first', async ({ page }) => {
  await openBuilderApp(page);
  await playLibraryFrom(page, 2);
  const crystals = filled(WALK_CAB);
  expect(crystals.length).toBe(72);
  const cab = 'Combined Walk — Calling a CAB (C·A·B)';
  let menu = await openMixMenu(page, 'walk:combined', cab);
  await expect(menu.getByTestId('mix-action-queue')).toContainText('They play as tracks, not as a walk. A new draw.');
  await expect(menu.getByTestId('mix-action-save')).toContainText('A new playlist of this draw, in the mix’s order');
  await menu.getByTestId('mix-action-queue').click();
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(72);
  await expect(toastText(page)).toContainText('Added 72 tracks from Combined Walk — Calling a CAB (C·A·B) to your queue. They play as tracks, not as a walk.');
  const firstDraw = await (async () => { const q = await qstate(page); const st = await bstate(page); return q.waiting.map((i: number) => st.ids[i]); })();
  menu = await openMixMenu(page, 'walk:combined', cab);
  await expect(menu.getByTestId('mix-action-queue')).toContainText('All 72, after the 72 tracks waiting in your queue.');
  await menu.getByTestId('mix-action-queue').click();
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'a second full draw' }).toBe(144);
  const s = await bstate(page);
  const lib = s.libraryIds;
  const crystalOf = (id: string) => CRY[lib.indexOf(id)];
  const waiting: number[] = (await qstate(page)).waiting;
  const queued = waiting.map((i) => crystalOf(s.ids[i]));
  expect(queued.slice(0, 72), 'the first draw, position by position').toEqual(crystals);
  expect(queued.slice(72), 'the second, after it').toEqual(crystals);
  expect(waiting.slice(0, 72).map((i) => s.ids[i]), 'the first draw’s entries stay first, as they were').toEqual(firstDraw);
});

// ---------------------------------------------------------------------------------------------------------------
// Q7. Nothing to queue.
// ---------------------------------------------------------------------------------------------------------------
test('Q7. a disabled mix has no ⋯ (every live one has one); a mix with no tracks queues nothing and shows its recipe\'s toast', async ({ page }) => {
  await openBuilderApp(page);
  await playLibraryFrom(page, 2);
  await tab(page, 'mixes');
  for (const id of MIX_IDS) {
    const live = await page.getByTestId(`mix-${id}`).evaluate((el) => el.tagName === 'BUTTON');
    await expect(page.getByTestId(`mix-more-${id}`), `${id}: ${live ? 'live, a ⋯' : 'disabled, no ⋯'}`).toHaveCount(live ? 1 : 0);
  }
  expect(await page.getByTestId('mix-source2178').evaluate((el) => el.tagName), 'SOURCE has no track here: not a button').not.toBe('BUTTON');
  const before = await bstate(page);
  await queueMixHook(page, 'source2178', 'queue'); // no Deep-Scanned 2178 Hz tone in the seed
  await expect(toastText(page)).toBeVisible();
  await expect(toastText(page)).not.toContainText('to your queue');
  await page.waitForTimeout(300);
  expect((await qstate(page)).waiting.length, 'nothing queued').toBe(0);
  expect((await bstate(page)).ids).toEqual(before.ids);
  expect(WALK_A.length).toBe(27);
});

// ---------------------------------------------------------------------------------------------------------------
// Q8. Save from the ⋯.
// ---------------------------------------------------------------------------------------------------------------
test('Q8. a mix\'s ⋯ › Save as a playlist…: the sheet closes, the Dialog with the mix\'s name and sentence; one record of the mix\'s order, saved from a mix', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await expect.poll(() => page.evaluate(() => (window as any).__aetheriaPlaylists?.state()?.status)).toBe('ready');
  await page.evaluate(() => { (window as any).__storeLog.length = 0; });
  const menu = await openMixMenu(page, 'preset:qi', 'Grounding');
  await menu.getByTestId('mix-action-save').click();
  await expect(menu).toHaveCount(0);
  const d = page.getByRole('dialog', { name: 'Save as a playlist' });
  await expect(d.getByLabel('Name')).toHaveValue('Grounding');
  await expect(page.getByTestId('playlist-name-sentence')).toHaveText('The 9 tracks of this mix, in its order. The playlist keeps them; building the mix again may pick others.');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toastText(page)).toContainText('Saved Grounding: 9 tracks.');
  const list = async () => (await page.evaluate(() => (window as any).__aetheriaPlaylists.state())).lists.find((p: any) => p.name === 'Grounding');
  await expect.poll(async () => (await list())?.ids, { message: 'the mix\'s order' }).toEqual(idsOf(ids, setAll(libraryKs, GROUNDING)));
  expect((await list()).from).toEqual({ kind: 'builder', label: 'Grounding' });
  expect((await page.evaluate(() => (window as any).__storeLog.slice())).filter((l: string) => /^playlist-state\.put\(pl:/.test(l)).length, 'one record').toBe(1);
});

// ---------------------------------------------------------------------------------------------------------------
// Q9. Customize….
// ---------------------------------------------------------------------------------------------------------------
test('Q9. Customize… opens Create a mix at the mix\'s own settings ("Same as Grounding in Mixes"), nothing saved; Back returns the focus to that ⋯', async ({ page }) => {
  await openBuilderApp(page);
  const menu = await openMixMenu(page, 'preset:qi', 'Grounding');
  await expect(menu.getByTestId('mix-action-customize')).toContainText('Open it in Create a mix: another source, filters, how many per crystal, the order');
  await menu.getByTestId('mix-action-customize').click();
  await expect(page.getByTestId('mix-builder')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create a mix', level: 1 })).toBeFocused();
  await expect(page.getByTestId('builder-name')).toHaveText('Same as Grounding in Mixes');
  await expect(page.getByTestId('builder-count')).toHaveText(/^9 tracks · /);
  await expect(page.getByTestId('builder-set-preset:qi')).toHaveAttribute('aria-checked', 'true');
  expect(await builderWrites(page), 'Customize… saves nothing until a tap changes something').toEqual([]);
  await page.getByRole('button', { name: 'Back to Mixes', exact: true }).click();
  await expect(page.getByTestId('mix-more-preset:qi'), 'Back: the focus on the ⋯ it came from').toBeFocused();
  // Another mix's Customize… opens at its own settings (never the saved or the default ones).
  await (await openMixMenu(page, 'walk:C', 'Flying Star Vortex')).getByTestId('mix-action-customize').click();
  await expect(page.getByTestId('builder-name'), 'the tile\'s name').toHaveText('Same as Vortex in Mixes');
  await expect(page.getByTestId('builder-walk-C')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('builder-count')).toHaveText(/^24 of 27 positions · /);
});
