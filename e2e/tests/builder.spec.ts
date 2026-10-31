import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import { cacheCounts, countBlobSaves, crash, libraryRowButton, libraryState, metaRecords, openLibraryTab, renders, resetRenders, savedState, seedLibraryRecords, tab, PHONE_VIEWPORT } from './helpers';
import { savedViz } from './tones';
import {
  BUILDER_KEY,
  EVENING,
  GROUNDING,
  MIX_NAMES,
  GUT,
  MIX_IDS,
  N,
  ROWS,
  ROWS60,
  S,
  bstate,
  heard,
  builderWrites,
  fmtTotal,
  idsOf,
  instrumentBuilder,
  launchBuilder,
  libraryKs,
  makePlaylist,
  openBuilderApp,
  openMixMenu,
  perCrystal,
  press,
  qstate,
  secondsOf,
  setAll,
  startHook,
  storeLog,
  summaryHook,
  toastText,
  toneName,
  undoButton,
} from './builderSeed';
// v16.3 re-review: Play from the queue's one switch (the app's own constant): R1 and K1 test whichever mode is set.
import { QUEUE_UNPICKED } from '../../components/shell/mixes/builder/builderViewModel.ts';

// v16.3, Create a mix (spec §5.4). Stage A drives App's builder functions through the dev hook window.__aetheriaBuilder
// (each call inside a click event: a tap's priority and task, as the UI makes it); Stage C adds each one's UI path. The
// expected orders come from builderSeed.ts's oracles over the seed, never from the builder.

/** Play the library from tone k (a Library row's tap) and wait until it plays. */
async function playLibraryFrom(page: Page, k: number): Promise<void> {
  await openLibraryTab(page);
  await libraryRowButton(page, toneName(k)).click();
  await expect.poll(() => heard(page), { message: `${toneName(k)} plays` }).toBe(toneName(k));
  await expect.poll(async () => { const s = await libraryState(page); return s.cursor === k && s.playing; }, { message: `${toneName(k)} is the current track` }).toBe(true);
}
const sourceLine = (page: Page) => page.getByTestId('np-source');

test.beforeEach(async ({ page }) => {
  if (ON_DEVICE) await page.setViewportSize(PHONE_VIEWPORT);
});

test('the seed: the oracles agree with themselves', async () => {
  expect(perCrystal(libraryKs, GROUNDING, 1), 'Grounding, 1 per crystal: tone-01 by its golden ratio score, then the smaller deviations').toEqual([0, 1, 2, 11]);
  expect(perCrystal(libraryKs, GUT, 3).length, 'GUT, 3 per crystal').toBe(13);
  expect(setAll(EVENING, GROUNDING), 'Grounding from Evening').toEqual([28, 1, 9]);
  expect(ROWS.filter((r) => r.crystal === null).length, 'one tone without a crystal').toBe(1);
});

// ---------------------------------------------------------------------------------------------------------------
// B1. Play a built mix: Grounding · 1 per crystal (low to high is a set's pattern).
// ---------------------------------------------------------------------------------------------------------------
test('B1. Play a built mix: the oracle\'s 4 from the first, the toast with Undo, the source line; Undo brings back the library from where it was @mobile', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await playLibraryFrom(page, 2);
  await expect.poll(async () => (await libraryState(page)).t ?? 0, { message: 'tone-03 plays on' }).toBeGreaterThan(1.5);
  const four = perCrystal(libraryKs, GROUNDING, 1);
  await startHook(page, S({ per: 1, order: 'low-high' }));
  await expect.poll(async () => (await bstate(page)).ids, { message: 'the play order is the best match on each Grounding crystal' }).toEqual(idsOf(ids, four));
  const s = await bstate(page);
  expect(s.cursor, 'from the first').toBe(0);
  expect(s.label, 'named by the builder').toBe('Grounding · 1 per crystal');
  expect(s.libraryIds, 'the library is untouched').toEqual(ids);
  await expect.poll(() => heard(page), { message: 'the first plays' }).toBe(toneName(four[0]));
  await expect(toastText(page)).toContainText('Playing Grounding · 1 per crystal: 4 tracks.');
  await expect(undoButton(page)).toBeVisible();
  await tab(page, 'now');
  await expect(sourceLine(page)).toHaveText('Play order · 1 of 4');
  await undoButton(page).click();
  await expect.poll(async () => (await bstate(page)).ids, { message: 'Undo: the library again' }).toEqual(ids);
  expect((await bstate(page)).cursor).toBe(2);
  await expect.poll(() => heard(page), { message: 'tone-03 again' }).toBe(toneName(2));
  await expect.poll(async () => (await libraryState(page)).t ?? 0, { message: 'from about where it was' }).toBeGreaterThan(1.2);
});

// ---------------------------------------------------------------------------------------------------------------
// B2. Play next / Add to queue from the builder; a write while a start is in flight lands after it.
// ---------------------------------------------------------------------------------------------------------------
test('B2. Play next / Add to queue (GUT · 3 per crystal, 13 tracks): after the playing entry / after 2 waiting, in the mix\'s order; v16.1\'s toasts; one Undo removes all 13; in flight it lands after the started track', async ({ page }) => {
  const ids = await openBuilderApp(page);
  const mix = perCrystal(libraryKs, GUT, 3);
  const gut3 = S({ follow: { kind: 'set', set: 'gut' }, per: 3 });
  // A start in flight: tone-30 has no crystal, so its tap decodes it (held); then Play next of the mix.
  await openLibraryTab(page);
  await page.evaluate(() => { (window as any).__holdDecode = true; });
  await page.getByTestId('library-search').fill(toneName(29)); // its row is below the list's window: the search finds it (a tap still plays the whole library)
  await libraryRowButton(page, toneName(29)).click();
  await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
  await startHook(page, gut3, 'next');
  await page.waitForTimeout(400);
  await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
  await expect.poll(() => heard(page), { message: 'the tapped track plays' }).toBe(toneName(29));
  await expect.poll(async () => (await bstate(page)).ids, { message: 'the 13 right after the started track' }).toEqual([...ids, ...idsOf(ids, mix)]);
  expect((await bstate(page)).cursor, 'the tapped track is current').toBe(29);
  await expect(toastText(page)).toContainText('Playing next: 13 tracks from GUT · 3 per crystal.');
  expect((await qstate(page)).waitingNames, 'in the mix\'s order').toEqual(mix.map(toneName));
  await undoButton(page).click();
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'one Undo removes all 13' }).toBe(0);
  expect((await bstate(page)).ids).toEqual(ids);
  // Two waiting (tone-26, tone-27), then Play next: before them; Undo; then Add to queue: after them.
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), [ids[25], ids[26]]);
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(2);
  await startHook(page, gut3, 'next');
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'Play next: right after the playing entry' }).toEqual([...mix, 25, 26].map(toneName));
  await expect(toastText(page)).toContainText('Playing next: 13 tracks from GUT · 3 per crystal.');
  await undoButton(page).click();
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'Undo: the 2 stay' }).toEqual([25, 26].map(toneName));
  await startHook(page, gut3, 'queue');
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'Add to queue: after the 2 waiting' }).toEqual([25, 26, ...mix].map(toneName));
  await expect(toastText(page)).toContainText('Added 13 tracks from GUT · 3 per crystal to your queue.');
  await undoButton(page).click();
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'Undo removes all 13' }).toEqual([25, 26].map(toneName));
  expect((await bstate(page)).libraryIds, 'the library is untouched').toEqual(ids);
});

// ---------------------------------------------------------------------------------------------------------------
// B3. Save as a playlist.
// ---------------------------------------------------------------------------------------------------------------
test('B3. Save as a playlist: the Dialog\'s name is the mix\'s and its sentence; one record of the order, from the builder; a later build leaves it', async ({ page }) => {
  const ids = await openBuilderApp(page);
  const four = perCrystal(libraryKs, GROUNDING, 1);
  await expect.poll(() => page.evaluate(() => (window as any).__aetheriaPlaylists?.state()?.status)).toBe('ready');
  await page.evaluate(() => { (window as any).__storeLog.length = 0; });
  await startHook(page, S({ per: 1 }), 'save');
  const d = page.getByRole('dialog', { name: 'Save as a playlist' });
  await expect(d).toBeVisible();
  await expect(d.getByLabel('Name')).toHaveValue('Grounding · 1 per crystal');
  await expect(page.getByTestId('playlist-name-sentence')).toHaveText('The 4 tracks of this mix, in its order. The playlist keeps them; building the mix again may pick others.');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toastText(page)).toContainText('Saved Grounding · 1 per crystal: 4 tracks.');
  const list = async () => (await page.evaluate(() => (window as any).__aetheriaPlaylists.state())).lists.find((p: any) => p.name === 'Grounding · 1 per crystal');
  await expect.poll(async () => (await list())?.ids, { message: 'the record holds the mix\'s order' }).toEqual(idsOf(ids, four));
  expect((await list()).from, 'saved from the builder').toEqual({ kind: 'builder', label: 'Grounding · 1 per crystal' });
  expect((await page.evaluate(() => (window as any).__storeLog.slice())).filter((l: string) => /^playlist-state\.put\(pl:/.test(l)).length, 'one record written').toBe(1);
  // A walk's sentence says it plays without the cube.
  await startHook(page, S({ follow: { kind: 'walk', mode: 'C' }, per: 'all' }), 'save');
  await expect(page.getByTestId('playlist-name-sentence')).toContainText('It plays as a playlist, without the cube’s steps.');
  await expect(d.getByLabel('Name')).toHaveValue('Flying Star Vortex');
  await d.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Another build (and a play of it) leaves the saved one as it was.
  await startHook(page, S({ per: 3 }));
  await expect.poll(async () => (await bstate(page)).label).toBe('Grounding · 3 per crystal');
  expect((await list())?.ids, 'the playlist keeps its tracks').toEqual(idsOf(ids, four));
  expect((await page.evaluate(() => (window as any).__aetheriaPlaylists.state())).lists.length, 'nothing else was saved').toBe(1);
});

// ---------------------------------------------------------------------------------------------------------------
// B4. Every Mixes-tab mix is a builder setting.
// ---------------------------------------------------------------------------------------------------------------
/** A tile's or row's count as the tab shows it ("62 tracks", "26 of 27 positions"; a disabled one: 0). */
async function tileCount(page: Page, id: string): Promise<number> {
  const t = page.getByTestId(`mix-${id}`);
  const text = (await t.getAttribute('aria-label')) ?? (await t.innerText());
  const m = /(\d+) (?:of \d+ positions|tracks?)/.exec(text);
  return m ? Number(m[1]) : 0;
}
test('B4. every Mixes-tab mix as a builder setting (19, on 60 tones): the summary\'s count is the tile\'s, it names the mix, and Play plays what the tile\'s tap plays (the same order; a random walk the same crystals position by position)', async ({ page }) => {
  test.setTimeout(240_000);
  const ids = await openBuilderApp(page, { rows: ROWS60 });
  const crystalOf = (id: string) => ROWS60[ids.indexOf(id)].crystal;
  await tab(page, 'mixes');
  const played: string[] = [];
  for (const id of MIX_IDS) {
    const settings = await page.evaluate((id) => (window as any).__aetheriaBuilder.settingsOf(id), id);
    const sum = await summaryHook(page, settings);
    const n = await tileCount(page, id);
    expect(sum.count, `${id}: the summary's count is the tile's`).toBe(n);
    expect(sum.named, `${id}: the same as the mix`).toBe(id);
    if (n === 0) continue;
    await page.getByTestId(`mix-${id}`).click();
    await expect.poll(async () => (await bstate(page)).ids.length, { message: `${id}: the tile plays` }).toBe(n);
    const tapped = (await bstate(page)).ids;
    await undoButton(page).click();
    await expect.poll(async () => (await bstate(page)).ids, { message: `${id}: Undo` }).toEqual(ids);
    await startHook(page, settings);
    await expect.poll(async () => (await bstate(page)).ids.length, { message: `${id}: the builder plays` }).toBe(n);
    const built = (await bstate(page)).ids;
    if (['walk:combined', 'walk:ouroboros', 'walk:cabi'].includes(id)) expect(built.map(crystalOf), `${id}: the same crystals, position by position`).toEqual(tapped.map(crystalOf));
    else expect(built, `${id}: the same order`).toEqual(tapped);
    await undoButton(page).click();
    await expect.poll(async () => (await bstate(page)).ids, { message: `${id}: Undo` }).toEqual(ids);
    played.push(id);
  }
  expect(played, 'every mix the seed fills was played both ways').toEqual(MIX_IDS);
});

// ---------------------------------------------------------------------------------------------------------------
// B5. Sources: a playlist (Evening) and the queue.
// ---------------------------------------------------------------------------------------------------------------
test('B5. Sources: from Evening every track is Evening\'s and the summary counts Evening; from the queue Play is the 3 once (the queue not carried), says so, and Undo brings the queue back; Play next / Add to queue refuse', async ({ page }) => {
  const ids = await openBuilderApp(page);
  const evening = await makePlaylist(page, 'Evening', ids, EVENING);
  const fromEvening = S({ source: { kind: 'playlist', id: evening } });
  const sum = await summaryHook(page, fromEvening);
  expect([sum.sourceTotal, sum.count, sum.name], 'the summary counts Evening').toEqual([EVENING.length, setAll(EVENING, GROUNDING).length, 'Grounding · from Evening']);
  await startHook(page, fromEvening);
  await expect.poll(async () => (await bstate(page)).ids, { message: 'Grounding from Evening' }).toEqual(idsOf(ids, setAll(EVENING, GROUNDING)));
  expect((await bstate(page)).ids.every((id) => idsOf(ids, EVENING).includes(id)), 'only Evening\'s tracks').toBe(true);
  await expect(toastText(page)).toContainText('Playing Grounding · from Evening: 3 tracks.');
  // The queue: the library from tone-03, 3 queued (tone-09 174 Hz, tone-04 417 Hz, tone-13 1206 Hz).
  await playLibraryFrom(page, 2);
  const queued = [8, 3, 12];
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), idsOf(ids, queued));
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(3);
  const before = await bstate(page);
  const fromQueue = S({ source: { kind: 'queue' }, follow: { kind: 'set', set: 'all' } });
  expect((await summaryHook(page, fromQueue)).sourceTotal, 'the summary counts the queue').toBe(3);
  await startHook(page, fromQueue);
  const want = [8, 3, 12]; // All 27, every track: by crystal (174, 417, 1206)
  await expect.poll(async () => (await bstate(page)).ids, { message: 'the 3, each once' }).toEqual(idsOf(ids, want));
  expect((await bstate(page)).marks, 'nothing left queued').toBeNull();
  expect((await qstate(page)).waiting.length).toBe(0);
  await expect(toastText(page)).toContainText('Playing Full Alignment · from your queue: 3 tracks. Your queue is in it now.');
  await undoButton(page).click();
  await expect.poll(async () => (await bstate(page)).ids, { message: 'Undo: the old order with its queue' }).toEqual(before.ids);
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'the 3 queued again' }).toEqual(queued.map(toneName));
  // Play next / Add to queue of a mix of the queue: refused, the queue as it was.
  for (const mode of ['next', 'queue'] as const) {
    await startHook(page, fromQueue, mode);
    await expect(toastText(page)).toContainText('This mix is made of your queue, so its tracks are queued already.');
    expect((await qstate(page)).waitingNames).toEqual(queued.map(toneName));
  }
  expect((await bstate(page)).libraryIds, 'the library is untouched').toEqual(ids);
});

// ---------------------------------------------------------------------------------------------------------------
// B9. A walk reordered: a plain mix.
// ---------------------------------------------------------------------------------------------------------------
test('B9. Vortex shuffled plays as a mix: no walk mode, no steps; one track per crystal the walk fills; the source line "Play order · 1 of 24"; the toast counts tracks', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await startHook(page, S({ follow: { kind: 'walk', mode: 'C' }, order: 'shuffle' }));
  // Vortex visits each of the 27 crystals once: the 24 with a track here (not 852, 5982, 6336).
  await expect.poll(async () => (await bstate(page)).ids.length, { message: 'one track per filled position' }).toBe(24);
  const s = await bstate(page);
  const crystals = s.ids.map((id) => ROWS[ids.indexOf(id)].crystal);
  expect(new Set(crystals).size, 'each crystal once').toBe(24);
  expect(s.walk, 'no walk mode').toBeNull();
  expect(s.steps, 'no cube steps').toBeNull();
  expect(s.label).toBe('Flying Star Vortex · shuffled');
  await expect(toastText(page)).toContainText('Playing Flying Star Vortex · shuffled: 24 tracks.');
  await tab(page, 'now');
  await expect(sourceLine(page)).toHaveText('Play order · 1 of 24');
  // The pattern, for contrast: a walk, its steps, the toast counts positions.
  await startHook(page, S({ follow: { kind: 'walk', mode: 'C' } }));
  await expect.poll(async () => (await bstate(page)).walk).toBe('C');
  expect((await bstate(page)).steps?.length).toBe(24);
  await expect(toastText(page)).toContainText('Playing Flying Star Vortex: 24 of 27 positions.');
});

// ---------------------------------------------------------------------------------------------------------------
// B13. Data safety: every builder op × 3 against 30 stored tones.
// ---------------------------------------------------------------------------------------------------------------
test('B13. every builder op × 3 (Play, Play next, Add to queue, Save, each Undo, Start over, a reload, every source, a mix\'s ⋯): the library, its records and audio untouched; the state store only the play order and Save\'s records', async ({ page }) => {
  test.setTimeout(300_000);
  await countBlobSaves(page);
  const ids = await openBuilderApp(page);
  const evening = await makePlaylist(page, 'Evening', ids, EVENING);
  await page.waitForTimeout(2500); // the restore's own saves settle
  const base = await cacheCounts(page);
  const metaBefore = await metaRecords(page);
  const log: string[] = [];
  let blobRuns = 0;
  let blobBase = await page.evaluate(() => (window as any).__blobSaveRuns as number);
  await page.evaluate(() => { (window as any).__storeLog.length = 0; });
  const harvest = async () => {
    log.push(...(await storeLog(page)));
    blobRuns += (await page.evaluate(() => (window as any).__blobSaveRuns as number)) - blobBase;
  };
  let saves = 0;
  const sources = [S({ per: 1 }), S({ source: { kind: 'playlist', id: evening }, follow: { kind: 'set', set: 'all' }, per: 3 }), S({ follow: { kind: 'walk', mode: 'combined' }, filters: { length: ['3to5', '5to10'] } })];
  for (let round = 0; round < 3; round++) {
    for (const s of sources) {
      await startHook(page, s);
      await expect(undoButton(page)).toBeVisible();
      await undoButton(page).click();
      for (const mode of ['next', 'queue'] as const) {
        await startHook(page, s, mode);
        await expect(toastText(page)).toContainText('tracks from'); // nothing loaded: v16.1's "Queued: … Play starts with them."
        await undoButton(page).click();
        await expect.poll(async () => (await qstate(page)).waiting.length).toBe(0);
      }
    }
    // The queue as a source: 3 queued, Play, Undo.
    await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), [ids[4], ids[5], ids[6]]);
    await expect.poll(async () => (await qstate(page)).waiting.length).toBe(3);
    await startHook(page, S({ source: { kind: 'queue' }, follow: { kind: 'any' } }));
    await expect(toastText(page)).toContainText('Your queue is in it now.');
    await undoButton(page).click();
    await expect.poll(async () => (await qstate(page)).waiting.length).toBe(3);
    await page.evaluate(() => (window as any).__tap(() => (window as any).__aetheriaQueue.edit({ clear: true })));
    await expect.poll(async () => (await qstate(page)).waiting.length).toBe(0);
    // A Mixes-tab mix's ⋯ (queue, Undo) and Save.
    await page.evaluate(() => (window as any).__tap(() => (window as any).__aetheriaBuilder.queueMix('preset:flow', 'queue')));
    await expect(toastText(page)).toContainText('7 tracks from Flow');
    await undoButton(page).click();
    await startHook(page, S({ per: 1 }), 'save');
    const d = page.getByRole('dialog', { name: 'Save as a playlist' });
    await d.getByLabel('Name').fill(`Built ${round}`);
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    saves++;
    await expect(page.getByText(`Saved Built ${round}: 4 tracks.`)).toBeVisible();
    // The builder's own taps: open it, Start over, Back (Start over saves Grounding: a tap).
    await tab(page, 'mixes');
    await page.getByTestId('mixes-create').click();
    await page.getByTestId('builder-start-over').click();
    await page.getByRole('button', { name: 'Back to Mixes', exact: true }).click();
    // A reload.
    await harvest();
    await page.reload();
    await launchBuilder(page);
    await page.waitForTimeout(2500);
    blobBase = await page.evaluate(() => (window as any).__blobSaveRuns as number);
  }
  await page.waitForTimeout(2500); // the play order's debounced save
  await harvest();
  const after = await cacheCounts(page);
  expect([after.blobs, after.meta, after.library, after.analysed, after.keyed, after.envVisual, after.envScan, after.failedMarks], 'the stored library').toEqual([base.blobs, base.meta, base.library, base.analysed, base.keyed, base.envVisual, base.envScan, base.failedMarks]);
  expect((await savedState(page)).originalOrder, 'the library\'s order').toEqual(ids);
  expect((await libraryState(page)).libraryIds, 'the library in memory').toEqual(ids);
  expect(await metaRecords(page), 'every metadata record as it was').toEqual(metaBefore);
  const kinds: Record<string, number> = {};
  for (const l of log) kinds[l.replace(/\(.*/, '')] = (kinds[l.replace(/\(.*/, '')] ?? 0) + 1;
  test.info().annotations.push({ type: 'store writes over the three rounds', description: JSON.stringify(kinds) });
  expect(log.filter((l) => /^blobs\./.test(l)), 'no audio write').toEqual([]);
  expect(log.filter((l) => /^meta\.(delete|clear|add)/.test(l)), 'no metadata record deleted or added').toEqual([]);
  expect(log.filter((l) => /^meta\.put/.test(l)).filter((l) => !ids.includes(l.slice('meta.put('.length, -1))), 'metadata puts only of library tracks').toEqual([]);
  expect(log.filter((l) => l.startsWith('playlist-state.') && !/^playlist-state\.put\((current|pl:p[a-z0-9]+)\)$/.test(l)), 'the state store: the play order and the saves only').toEqual([]);
  expect(log.filter((l) => /^playlist-state\.put\(pl:/.test(l)).length, 'one playlist put per Save').toBe(saves);
  expect(blobRuns, 'no blob save ran').toBe(0);
  expect((await page.evaluate(() => (window as any).__aetheriaPlaylists.state())).lists.length, 'Evening and the three saves').toBe(4);
});

// ---------------------------------------------------------------------------------------------------------------
// B14. Mixes never change the visual settings (v15.9's decision).
// ---------------------------------------------------------------------------------------------------------------
test('B14. the visual settings never change: Play of a set, a walk, an experimental mix, a queued mix, and each Undo', async ({ page }) => {
  await openBuilderApp(page);
  const base = await savedViz(page);
  const runs: Array<[string, () => Promise<unknown>]> = [
    ['a set', () => startHook(page, S({ per: 3 }))],
    ['a walk', () => startHook(page, S({ follow: { kind: 'walk', mode: 'A' } }))],
    ['an experimental mix', () => startHook(page, S({ follow: { kind: 'golden' } }))],
    ['a queued mix', () => page.evaluate(() => (window as any).__tap(() => (window as any).__aetheriaBuilder.queueMix('walk:B', 'queue')))],
  ];
  for (const [what, run] of runs) {
    await run();
    await expect(undoButton(page)).toBeVisible();
    expect(await savedViz(page), `${what}: the saved visual settings`).toBe(base);
    await undoButton(page).click();
    await page.waitForTimeout(200);
    expect(await savedViz(page), `${what}'s Undo`).toBe(base);
  }
  expect(N).toBe(30);
});

// =====================================================================================================================
// Stage C: the builder view, by finger (press: a CDP touch on the phone, a click elsewhere).
// =====================================================================================================================
const builderView = (page: Page) => page.getByTestId('mix-builder');
const footerCount = (page: Page) => page.getByTestId('builder-count');
const footerName = (page: Page) => page.getByTestId('builder-name');
const tapId = (page: Page, id: string) => press(page, page.getByTestId(id));
async function openBuilder(page: Page): Promise<void> {
  await tab(page, 'mixes');
  await tapId(page, 'mixes-create');
  await expect(builderView(page)).toBeVisible();
}
const countText = (ks: readonly number[], positions?: number) => `${positions !== undefined ? `${ks.length} of ${positions} positions` : `${ks.length} ${ks.length === 1 ? 'track' : 'tracks'}`} · ${fmtTotal(secondsOf(ks))}`;

test('B1b. by finger: Create a mix opens at Grounding ("Same as Grounding in Mixes"); 1 per crystal; Play: the 4, the toast; the view stays; Undo @mobile', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await playLibraryFrom(page, 2);
  await openBuilder(page);
  await expect(page.getByRole('heading', { name: 'Create a mix', level: 1 }), 'opening focuses the heading').toBeFocused();
  const nine = setAll(libraryKs, GROUNDING);
  await expect(footerCount(page)).toHaveText(countText(nine));
  await expect(footerName(page)).toHaveText('Same as Grounding in Mixes');
  await expect(page.getByTestId('builder-warn'), 'tone-30 has no crystal').toHaveText('1 without a crystal left out');
  await tapId(page, 'builder-per-1');
  const four = perCrystal(libraryKs, GROUNDING, 1);
  await expect(footerCount(page)).toHaveText(countText(four));
  await expect(footerName(page)).toHaveText('Grounding · 1 per crystal');
  await expect(page.getByTestId('builder-per').getByText('The best match on each crystal')).toBeVisible();
  await tapId(page, 'builder-play');
  await expect.poll(async () => (await bstate(page)).ids, { message: 'the oracle\'s 4' }).toEqual(idsOf(ids, four));
  await expect(toastText(page)).toContainText('Playing Grounding · 1 per crystal: 4 tracks.');
  await expect(builderView(page), 'the view stays open after Play').toBeVisible();
  await expect(page.getByTestId('mini-title')).toHaveText(toneName(four[0]));
  await press(page, undoButton(page));
  await expect.poll(async () => (await bstate(page)).ids, { message: 'Undo: the library again' }).toEqual(ids);
});

test('B2b. by finger: Play next and ⋯ › Add to queue (GUT · 3 per crystal): in the mix\'s order, v16.1\'s toasts, one Undo each @mobile', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await playLibraryFrom(page, 2);
  const mix = perCrystal(libraryKs, GUT, 3);
  await openBuilder(page);
  await tapId(page, 'builder-set-gut');
  await tapId(page, 'builder-per-3');
  await expect(footerCount(page)).toHaveText(countText(mix));
  await tapId(page, 'builder-play-next');
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'right after the playing entry' }).toEqual(mix.map(toneName));
  await expect(toastText(page)).toContainText('Playing next: 13 tracks from GUT · 3 per crystal.');
  await press(page, undoButton(page));
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(0);
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), [ids[25], ids[26]]);
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(2);
  await tapId(page, 'builder-more');
  const more = page.getByTestId('builder-more-sheet');
  await expect(more.getByTestId('builder-action-queue')).toContainText('All 13, after the 2 tracks waiting in your queue');
  await press(page, more.getByTestId('builder-action-queue'));
  await expect(more, 'the sheet closes first').toHaveCount(0);
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'after the 2' }).toEqual([25, 26, ...mix].map(toneName));
  await expect(toastText(page)).toContainText('Added 13 tracks from GUT · 3 per crystal to your queue.');
  await press(page, undoButton(page));
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([25, 26].map(toneName));
});

test('B3b. by finger: ⋯ › Save as a playlist…: the Dialog with the mix\'s name and sentence; one record of the order', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await expect.poll(() => page.evaluate(() => (window as any).__aetheriaPlaylists?.state()?.status)).toBe('ready');
  await openBuilder(page);
  await tapId(page, 'builder-per-1');
  await tapId(page, 'builder-more');
  await expect(page.getByTestId('builder-more-sheet').getByTestId('builder-action-save')).toContainText('A new playlist of these 4, in this order');
  await tapId(page, 'builder-action-save');
  const d = page.getByRole('dialog', { name: 'Save as a playlist' });
  await expect(d.getByLabel('Name')).toHaveValue('Grounding · 1 per crystal');
  await expect(page.getByTestId('playlist-name-sentence')).toHaveText('The 4 tracks of this mix, in its order. The playlist keeps them; building the mix again may pick others.');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toastText(page)).toContainText('Saved Grounding · 1 per crystal: 4 tracks.');
  const lists = (await page.evaluate(() => (window as any).__aetheriaPlaylists.state())).lists;
  expect(lists.map((p: any) => [p.name, p.ids, p.from])).toEqual([['Grounding · 1 per crystal', idsOf(ids, perCrystal(libraryKs, GROUNDING, 1)), { kind: 'builder', label: 'Grounding · 1 per crystal' }]]);
  // A later change in the builder leaves it.
  await tapId(page, 'builder-per-all');
  expect((await page.evaluate(() => (window as any).__aetheriaPlaylists.state())).lists[0].ids).toEqual(idsOf(ids, perCrystal(libraryKs, GROUNDING, 1)));
});

test('B4b. every Mixes-tab mix through Customize… (19, on 60 tones): the footer\'s count is the tile\'s, "Same as … in Mixes", and Play plays what the tile\'s tap plays', async ({ page }) => {
  test.setTimeout(300_000);
  const ids = await openBuilderApp(page, { rows: ROWS60 });
  const crystalOf = (id: string) => ROWS60[ids.indexOf(id)].crystal;
  await tab(page, 'mixes');
  const done: string[] = [];
  for (const id of MIX_IDS) {
    const n = await tileCount(page, id);
    if (n === 0) {
      await expect(page.getByTestId(`mix-more-${id}`)).toHaveCount(0);
      continue;
    }
    const tile = page.getByTestId(`mix-${id}`);
    const [name, fullName] = MIX_NAMES[id];
    await press(page, tile);
    await expect.poll(async () => (await bstate(page)).ids.length, { message: `${id}: the tile plays` }).toBe(n);
    const tapped = (await bstate(page)).ids;
    await press(page, undoButton(page));
    await expect.poll(async () => (await bstate(page)).ids).toEqual(ids);
    const menu = await openMixMenu(page, id, fullName);
    await press(page, menu.getByTestId('mix-action-customize'));
    await expect(footerName(page), `${id}: named`).toHaveText(`Same as ${name} in Mixes`);
    await expect(footerCount(page), `${id}: the tile's count`).toHaveText(new RegExp(`^${n} (of \\d+ positions|tracks?)`));
    await tapId(page, 'builder-play');
    await expect.poll(async () => (await bstate(page)).ids.length, { message: `${id}: the builder plays` }).toBe(n);
    const built = (await bstate(page)).ids;
    if (['walk:combined', 'walk:ouroboros', 'walk:cabi'].includes(id)) expect(built.map(crystalOf), `${id}: position by position`).toEqual(tapped.map(crystalOf));
    else expect(built, `${id}: the same order`).toEqual(tapped);
    await press(page, undoButton(page));
    await expect.poll(async () => (await bstate(page)).ids).toEqual(ids);
    await press(page, page.getByRole('button', { name: 'Back to Mixes', exact: true }));
    done.push(id);
  }
  expect(done, 'every mix the seed fills').toEqual(MIX_IDS);
});

test('B5b. by finger: Start from › Evening (the sheet) counts Evening; the queue (3 waiting, Any crystal): Play only, the 3 once, Undo brings the queue back @mobile', async ({ page }) => {
  const ids = await openBuilderApp(page);
  await makePlaylist(page, 'Evening', ids, EVENING);
  await playLibraryFrom(page, 2);
  await openBuilder(page);
  await tapId(page, 'builder-source-playlist');
  const sheet = page.getByTestId('builder-source-sheet');
  await expect(sheet).toBeVisible();
  await press(page, sheet.getByText('Evening', { exact: true }));
  await expect(sheet, 'a pick closes the sheet').toHaveCount(0);
  const fromEvening = setAll(EVENING, GROUNDING);
  await expect(footerCount(page), 'the footer counts Evening').toHaveText(countText(fromEvening));
  await expect(footerName(page)).toHaveText('Grounding · from Evening');
  await expect(page.getByTestId('builder-source-playlist')).toHaveAttribute('aria-label', 'Evening, 10 tracks');
  await tapId(page, 'builder-play');
  await expect.poll(async () => (await bstate(page)).ids).toEqual(idsOf(ids, fromEvening));
  // The queue.
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), idsOf(ids, [8, 3, 12]));
  await expect(page.getByTestId('builder-source-queue')).toHaveAttribute('aria-label', 'Queue, 3 waiting');
  await tapId(page, 'builder-source-queue');
  await tapId(page, 'builder-follow-any');
  await expect(footerCount(page)).toHaveText(countText([8, 3, 12]));
  await expect(page.getByTestId('builder-play-next'), 'Play next is not offered from the queue').toHaveCount(0);
  await expect(page.getByTestId('builder-queue-line')).toHaveText('Your queue becomes this mix.');
  const before = await bstate(page);
  await tapId(page, 'builder-play');
  await expect.poll(async () => (await bstate(page)).ids, { message: 'the 3, each once' }).toEqual(idsOf(ids, [8, 3, 12]));
  await expect(toastText(page)).toContainText('Your queue is in it now.');
  await press(page, undoButton(page));
  await expect.poll(async () => (await bstate(page)).ids).toEqual(before.ids);
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([8, 3, 12].map(toneName));
});

test('B6. the filter sheet: no crystal group; "Experimental scores" collapsed with its lead; "Golden ratio score over 30 %" narrows the footer to the oracle\'s; Clear all restores', async ({ page }) => {
  await openBuilderApp(page);
  await openBuilder(page);
  await tapId(page, 'builder-filters-button');
  const sheet = page.getByTestId('builder-filter-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Assigned crystal', { exact: true }), 'no crystal group').toHaveCount(0);
  await expect(sheet.getByText('Crystals are picked under Follow.')).toBeVisible();
  const toggle = sheet.getByTestId('builder-filters-experimental-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sheet.getByTestId('builder-filters-experimental-lead'), 'collapsed by default').toHaveCount(0);
  await press(page, toggle);
  await expect(sheet.getByTestId('builder-filters-experimental-lead')).toHaveText("Scores from Deep Scan's reading of the spectrum, which is not a pitch measurement. Not evidence of any effect. Each one you pick narrows the mix.");
  const gold = sheet.locator('[data-facet="x-golden"][data-value="over"]');
  await expect(gold).toHaveAttribute('aria-label', 'Golden ratio score over 30 %, 4 tracks');
  await press(page, gold);
  await expect(gold).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByText('4 of 30 tracks', { exact: true })).toBeVisible();
  const over = libraryKs.filter((k) => (ROWS[k].scores?.golden ?? 0) > 0.3);
  const want = setAll(over, GROUNDING);
  await expect(footerCount(page), 'the footer: Grounding\'s tracks over 30 %').toHaveText(countText(want));
  await expect(footerName(page)).toHaveText('Grounding · Golden ratio score over 30 %');
  await press(page, sheet.getByTestId('builder-filters-done'));
  await expect(page.getByTestId('builder-active-chips').getByRole('button', { name: 'Remove Golden ratio score over 30 %', exact: true })).toBeVisible();
  await tapId(page, 'builder-filters-button');
  await press(page, page.getByTestId('builder-filters-clear'));
  await page.keyboard.press('Escape');
  await expect(footerCount(page), 'Clear all restores').toHaveText(countText(setAll(libraryKs, GROUNDING)));
  await expect(footerName(page)).toHaveText('Same as Grounding in Mixes');
});

test('B6b. v16.6 decisions 11 and 13: the DNA resonance score filter: its chip sits in a Design choice block with its tag; the mix\'s name says "Experimental resonance score over 30 %", never DNA; no experimental chip, no tag', async ({ page }) => {
  await openBuilderApp(page);
  await openBuilder(page);
  await tapId(page, 'builder-filters-button');
  const sheet = page.getByTestId('builder-filter-sheet');
  await press(page, sheet.getByTestId('builder-filters-experimental-toggle'));
  await press(page, sheet.locator('[data-facet="x-dna"][data-value="over"]'));
  await expect(footerName(page)).toHaveText('Grounding · Experimental resonance score over 30 %');
  await press(page, sheet.getByTestId('builder-filters-done'));
  const block = page.getByTestId('builder-chips-block');
  await expect(block).toHaveAttribute('data-evidence', 'design');
  await expect(block.getByRole('button', { name: 'Remove DNA resonance score over 30 %', exact: true })).toBeVisible();
  await expect(block.locator('[data-evidence-tag="design"]')).toBeVisible();
  await expect(footerName(page)).not.toContainText('DNA');
  // Removing the only chip removes the block and its tag.
  await press(page, block.getByRole('button', { name: 'Remove DNA resonance score over 30 %', exact: true }));
  await expect(page.getByTestId('builder-chips-block')).toHaveCount(0);
  await expect(page.getByTestId('builder-filters').locator('[data-evidence-tag]')).toHaveCount(0);
});

test('B7. the footer follows each tap; a tap renders App 0 times; 3 s of playback renders none of the builder\'s views; at 1,000 tracks a tap ≤ 16 ms of script and no long task over 50 ms', async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(ON_DEVICE, 'the phone\'s budget is D-B1\'s');
  await openBuilderApp(page, { seconds: 30 });
  await playLibraryFrom(page, 0);
  await openBuilder(page);
  await page.waitForTimeout(1500);
  await resetRenders(page);
  await page.waitForTimeout(3000);
  const r = await renders(page);
  test.info().annotations.push({ type: 'renders, 3 s of playback, the builder open', description: JSON.stringify(r) });
  for (const v of ['MixBuilder', 'BuilderFooter', 'MixBuilder:summary', 'MixesTab']) expect.soft(r[v] ?? 0, `${v} renders while it plays`).toBe(0);
  expect.soft(r.MiniProgress ?? 0, 'the clock kept going').toBeGreaterThan(0);
  // Taps while paused (the clock commits App on its own while playing).
  await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
  await page.waitForTimeout(500);
  for (const [id, want] of [['builder-per-1', countText(perCrystal(libraryKs, GROUNDING, 1))], ['builder-set-gut', countText(perCrystal(libraryKs, GUT, 1))], ['builder-per-3', countText(perCrystal(libraryKs, GUT, 3))]] as const) {
    await resetRenders(page);
    await tapId(page, id);
    await expect(footerCount(page), `after ${id}`).toHaveText(want);
    const t = await renders(page);
    expect(t.App ?? 0, `App renders for ${id}`).toBe(0);
    expect(t.MixBuilder ?? 0, `the view renders for ${id}`).toBeGreaterThan(0);
  }
  expect(await builderWrites(page)).toHaveLength(3);
});

test('B7b. at 1,000 tracks: a Follow or chip tap ≤ 16 ms of script; no long task over 50 ms', async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(ON_DEVICE, 'the phone\'s budget is D-B1\'s');
  await instrumentBuilder(page);
  await seedLibraryRecords(page, 1000, { crystals: 'some', real: 2, seconds: 30, keys: true, envelopes: true });
  await launchBuilder(page, { n: 1000 });
  await openBuilder(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const script = async () => ((await cdp.send('Performance.getMetrics')).metrics.find((m: any) => m.name === 'ScriptDuration')?.value ?? 0) * 1000;
  await page.evaluate(() => {
    const w = window as any;
    w.__longTasks = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  const costs: Record<string, number> = {};
  // Warm the views once (the first mount of a kind's choices is the dev server's React, not the tap's work).
  for (const id of ['builder-follow-walk', 'builder-follow-set', 'builder-per-1', 'builder-per-all']) {
    await tapId(page, id);
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => { (window as any).__longTasks.length = 0; });
  for (const id of ['builder-set-gut', 'builder-per-3', 'builder-set-preset:flow', 'builder-per-1', 'builder-set-all']) {
    await page.waitForTimeout(400);
    const before = await script();
    await page.getByTestId(id).click();
    await expect(page.getByTestId(id)).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(300);
    costs[id] = Math.round((await script()) - before);
  }
  const long: number[] = await page.evaluate(() => (window as any).__longTasks.slice());
  test.info().annotations.push({ type: '1,000 tracks: script per tap (ms, dev server)', description: JSON.stringify(costs) }, { type: 'long tasks', description: JSON.stringify(long) });
  for (const [id, ms] of Object.entries(costs)) expect.soft(ms, `${id}: script`).toBeLessThanOrEqual(16); // the spec's bound, even on the dev server (measured 8-11 ms)
  expect(long.filter((d) => d > 50), 'no long task over 50 ms').toEqual([]);
});

test('B8. saved settings (decision 2 A): after a reload the builder opens as it was left; a hostile saved value is Grounding, no error, nothing written; written from taps only', async ({ page }) => {
  await openBuilderApp(page);
  await openBuilder(page);
  expect(await builderWrites(page), 'opening writes nothing').toEqual([]);
  await tapId(page, 'builder-per-1');
  await press(page, page.getByTestId('builder-order-list').getByText('Shuffle, least recently played first', { exact: true }));
  await expect(page.getByTestId('builder-order-shuffle-note')).toHaveText('Least recently played first. Aetheria remembers what you played until the app closes.');
  const writes = await builderWrites(page);
  expect(writes.length, 'one write per tap').toBe(2);
  expect(JSON.parse(writes[1].slice(4))).toEqual({ v: 1, source: { kind: 'library' }, follow: { kind: 'set', set: 'preset:qi' }, per: 1, order: 'shuffle', f: {} });
  const count = await footerCount(page).textContent();
  // Back, the tab and Play: no write.
  await tapId(page, 'builder-play');
  await press(page, page.getByRole('button', { name: 'Back to Mixes', exact: true }));
  await tab(page, 'library');
  await tab(page, 'mixes');
  expect(await builderWrites(page), 'Back, the tab and Play write nothing').toHaveLength(2);
  await page.reload();
  await launchBuilder(page);
  expect(await builderWrites(page), 'a reload writes nothing').toEqual([]);
  await openBuilder(page);
  await expect(page.getByTestId('builder-per-1')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('builder-order-list').getByRole('radio', { name: 'Shuffle, least recently played first' })).toBeChecked();
  await expect(footerCount(page)).toHaveText(count ?? '');
  await expect(footerName(page)).toHaveText('Grounding · 1 per crystal · shuffled');
  expect(await builderWrites(page), 'opening writes nothing').toEqual([]);
  // Start over: Grounding, saved (a tap).
  await tapId(page, 'builder-start-over');
  await expect(footerName(page)).toHaveText('Same as Grounding in Mixes');
  expect((await builderWrites(page)).length).toBe(1);
});

test('B8b. a hostile saved value opens at Grounding with no error and nothing written', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openBuilderApp(page, { saved: '{"v":1,"follow":{"kind":"walk","mode":"Z"},"source":{"kind":"playlist","id":"__proto__"},"per":2,"f":{"x-golden":["under"]}}' });
  await openBuilder(page);
  await expect(footerName(page)).toHaveText('Same as Grounding in Mixes');
  await expect(page.getByTestId('builder-source-library')).toHaveAttribute('aria-pressed', 'true');
  expect(await builderWrites(page), 'nothing written').toEqual([]);
  expect(errors).toEqual([]);
});

test('B9b. by finger: Vortex shuffled says it plays as a mix, and Play gives no walk', async ({ page }) => {
  await openBuilderApp(page);
  await openBuilder(page);
  await tapId(page, 'builder-follow-walk');
  await tapId(page, 'builder-walk-C');
  await expect(page.getByTestId('builder-walk-C')).toHaveAttribute('aria-label', 'Vortex, 24 of 27');
  await expect(footerName(page), 'the tile\'s name').toHaveText('Same as Vortex in Mixes');
  await expect(page.getByTestId('builder-per')).toContainText('One track per position, as the walk picks them.');
  await press(page, page.getByTestId('builder-order-list').getByText('Shuffle, least recently played first', { exact: true }));
  await expect(page.getByTestId('builder-order-walk-note')).toHaveText('Reordered, it plays as a mix: the cube won’t follow the walk’s steps.');
  await expect(footerCount(page)).toHaveText(/^24 tracks · /);
  await tapId(page, 'builder-play');
  await expect.poll(async () => (await bstate(page)).ids.length).toBe(24);
  expect((await bstate(page)).walk).toBeNull();
  await expect(toastText(page)).toContainText('Playing Flying Star Vortex · shuffled: 24 tracks.');
});

test('B10. accessibility: named controls with their counts, at least 44 × 44; radiogroups; the footer is live; focus on open, on Back, and Escape closes a sheet back to its opener', async ({ page }) => {
  await openBuilderApp(page);
  await tab(page, 'mixes');
  await openBuilder(page);
  await expect(page.getByRole('heading', { name: 'Create a mix', level: 1 })).toBeFocused();
  await expect(page.getByTestId('builder-set-preset:qi')).toHaveAttribute('aria-label', 'Grounding, 9 tracks');
  await expect(page.getByTestId('builder-source-library')).toHaveAttribute('aria-label', 'Library, 30 tracks');
  await expect(page.getByTestId('builder-count')).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByRole('radiogroup', { name: 'Follow' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Crystal sets' })).toBeVisible();
  // Every control in the view: at least 44 × 44 (a chip by its ::after target: 32 px tall, 44 px with it).
  const small = await builderView(page).evaluate((root) => {
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, [role="radio"], input'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const style = getComputedStyle(el, '::after');
      const extra = style.content !== 'none' && style.position === 'absolute' ? -2 * parseFloat(style.top || '0') : 0;
      const h = Math.max(r.height, r.height + extra);
      if (el.tagName === 'INPUT') continue; // the kit's radios: their label row is the target (56 px)
      if (h < 44 || r.width < 44) out.push(`${el.getAttribute('aria-label') ?? el.textContent?.trim()} ${Math.round(r.width)}×${Math.round(h)}`);
    }
    return out;
  });
  expect(small, 'controls under 44 × 44').toEqual([]);
  // Escape closes a sheet, the focus back on its opener.
  await tapId(page, 'builder-filters-button');
  await expect(page.getByTestId('builder-filter-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('builder-filter-sheet')).toHaveCount(0);
  await expect(page.getByTestId('builder-filters-button')).toBeFocused();
  await page.getByRole('button', { name: 'Back to Mixes', exact: true }).click();
  await expect(page.getByTestId('mixes-create'), 'Back: the focus on Create a mix').toBeFocused();
});

test('B11. crash drill: mix-builder, mix-builder-footer, mix-menu: each region\'s fallback, the music plays on, Reload panel brings it back', async ({ page }) => {
  await openBuilderApp(page, { seconds: 30 });
  await playLibraryFrom(page, 0);
  await openBuilder(page);
  for (const [view, fallback, back] of [['mix-builder', 'mix-builder-fallback', 'builder-follow'], ['mix-builder-footer', 'mix-builder-footer-fallback', 'builder-play']] as const) {
    await crash(page, view);
    await expect(page.getByTestId(fallback)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Mixes', exact: true }), 'the header stays').toBeVisible();
    expect((await libraryState(page)).playing, `${view}: the music plays on`).toBe(true);
    await page.getByTestId(fallback).getByRole('button', { name: 'Reload panel' }).click();
    await expect(page.getByTestId(back)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Back to Mixes', exact: true }).click();
  const menu = await openMixMenu(page, 'preset:qi', 'Grounding');
  await crash(page, 'mix-menu');
  await expect(menu.getByText('This sheet hit a problem.')).toBeVisible();
  expect((await libraryState(page)).playing, 'mix-menu: the music plays on').toBe(true);
  await menu.getByRole('button', { name: 'Reload panel' }).click();
  await expect(menu.getByTestId('mix-action-next')).toBeVisible();
});

test('B12. desktop: the builder in the 420 px panel, its footer at the panel\'s foot; the sheets centred and modal; after Play the transport names the mix\'s first track', async ({ page }) => {
  test.skip(ON_DEVICE, 'the desktop shell');
  await openBuilderApp(page, { viewport: { width: 1280, height: 800 } });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /Mixes/ }).click();
  await tapId(page, 'mixes-create');
  const view = builderView(page);
  await expect(view).toBeVisible();
  const vb = (await view.boundingBox())!;
  expect(Math.round((await page.getByTestId('tab-mixes').boundingBox())!.width), 'the panel\'s width').toBe(420);
  const fb = (await page.getByTestId('builder-footer').boundingBox())!;
  expect(fb.y + fb.height, 'the footer at the panel\'s foot').toBeGreaterThan(vb.y + vb.height - 2);
  await tapId(page, 'builder-filters-button');
  const dialog = page.getByRole('dialog', { name: 'Filters' });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const db = (await dialog.boundingBox())!;
  expect(Math.abs(db.x + db.width / 2 - 640), 'centred').toBeLessThan(2);
  await page.keyboard.press('Escape');
  await tapId(page, 'builder-per-1');
  await tapId(page, 'builder-play');
  // (The desktop transport shows the title and the chips, no source line: the play order and its first track.)
  const four = perCrystal(libraryKs, GROUNDING, 1);
  await expect.poll(async () => (await bstate(page)).ids.length).toBe(4);
  await expect(page.getByTestId('desktop-title')).toHaveText(toneName(four[0]));
  await expect(view, 'the builder stays in the panel').toBeVisible();
});

test('B15. classic: no builder and no ⋯; with saved builder settings its drawer and counts are as without', async ({ page }) => {
  await openBuilderApp(page, { layout: 'classic', hook: false }); // no v16.3 hook needed: a baseline on v16.2 too
  const drawer = async () => (await page.locator('aside').innerText()).replace(/\s+/g, ' ');
  const before = await drawer();
  expect(await page.locator('[data-testid^="mix-more-"], [data-testid="mix-builder"], [data-testid="mixes-create"]').count(), 'nothing of the builder').toBe(0);
  await page.evaluate((k) => localStorage.setItem(k, '{"v":1,"source":{"kind":"library"},"follow":{"kind":"walk","mode":"C"},"per":"all","order":"shuffle","f":{"length":["lt3"]}}'), BUILDER_KEY);
  await page.reload();
  await launchBuilder(page, { layout: 'classic', hook: false });
  expect(await drawer(), 'the drawer with saved builder settings').toBe(before);
  expect(await page.locator('[data-testid^="mix-more-"], [data-testid="mix-builder"], [data-testid="mixes-create"]').count()).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// v16.3 review fixes (R1-R7): each fails on 24e51ad.
// ---------------------------------------------------------------------------------------------------------------
// v16.3 re-review: R1 and K1 follow builderViewModel's QUEUE_UNPICKED, so whichever mode is set is tested ('leave': the
// queue becomes the mix; 'keep': the queued tracks it leaves out stay queued, right after its first track).
const KEEP = QUEUE_UNPICKED === 'keep';
test(`R1. review fix 1 (QUEUE_UNPICKED '${QUEUE_UNPICKED}'): from a queue of 10, Grounding keeps 3: before Play the footer says what happens to the other 7 (leave: they leave the queue; keep: they stay queued after its first track, one line); Play: the 3 once, and the 7 gone or kept; the toast says so once; Undo brings all 10 back; with every queued track picked, the words are as before @mobile`, async ({ page }) => {
  const ids = await openBuilderApp(page);
  await playLibraryFrom(page, 0);
  const queued = [3, 5, 13, 9, 15, 20, 2, 22, 24, 17];
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), idsOf(ids, queued));
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(10);
  const picked = setAll(queued, GROUNDING);
  expect(picked, 'Grounding of the ten: tone-10 (285 Hz), tone-03 (396), tone-04 (417)').toEqual([9, 2, 3]);
  const unpicked = queued.filter((k) => !picked.includes(k));
  await openBuilder(page);
  await tapId(page, 'builder-source-queue');
  await expect(footerCount(page)).toHaveText(countText(picked));
  if (KEEP) {
    await expect(page.getByTestId('builder-queue-left'), 'before Play').toHaveText('7 of your queued tracks aren’t in this mix: they stay queued and play after its first track.');
    await expect(page.getByTestId('builder-queue-line'), 'keep: the left-out line is the only one').toHaveCount(0);
  } else {
    await expect(page.getByTestId('builder-queue-line')).toHaveText('Your queue becomes this mix.');
    await expect(page.getByTestId('builder-queue-left'), 'before Play').toHaveText('7 of your queued tracks aren’t in this mix: they leave the queue.');
  }
  const before = await bstate(page);
  await tapId(page, 'builder-play');
  if (KEEP) {
    await expect.poll(async () => (await bstate(page)).ids, { message: 'the 3 once, the 7 right after the first' }).toEqual(idsOf(ids, [picked[0], ...unpicked, ...picked.slice(1)]));
    expect((await qstate(page)).waitingNames, 'the 7 still queued, in their order').toEqual(unpicked.map(toneName));
    await expect(toastText(page)).toContainText('Playing Grounding · from your queue: 3 tracks. The 7 queued tracks not in it play next.');
  } else {
    await expect.poll(async () => (await bstate(page)).ids, { message: 'the 3, each once' }).toEqual(idsOf(ids, picked));
    expect((await bstate(page)).marks, 'nothing left queued').toBeNull();
    expect((await qstate(page)).waiting.length, 'the queue became the mix').toBe(0);
    await expect(toastText(page)).toContainText('Playing Grounding · from your queue: 3 tracks. Your queue became this mix. 7 queued tracks left the queue.');
  }
  expect((await toastText(page).innerText()).match(/\b7\b/g), 'the toast counts the 7 once').toHaveLength(1);
  await press(page, undoButton(page));
  await expect.poll(async () => (await bstate(page)).ids, { message: 'Undo: the old order' }).toEqual(before.ids);
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'all 10 queued again, in order' }).toEqual(queued.map(toneName));
  // Every queued track in the mix (any crystal): no line, and the toast's words as they were.
  await tapId(page, 'builder-follow-any');
  await expect(footerCount(page)).toHaveText(countText(queued));
  await expect(page.getByTestId('builder-queue-left')).toHaveCount(0);
  await tapId(page, 'builder-play');
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(0);
  await expect(toastText(page)).toContainText('Playing Any crystal · from your queue: 10 tracks. Your queue is in it now.');
});

test('R2. review fix 3: Grounding plays with its 9 queued after it; Create a mix › Queue › Play uses the queue up (the 9 once), with the toast and its Undo, which queues the 9 again @mobile', async ({ page }) => {
  const ids = await openBuilderApp(page);
  const mix = setAll(libraryKs, GROUNDING);
  await tab(page, 'mixes');
  await tapId(page, 'mix-preset:qi');
  await expect.poll(async () => (await bstate(page)).ids, { message: 'Grounding plays' }).toEqual(idsOf(ids, mix));
  await expect.poll(async () => (await libraryState(page)).playing, { message: 'it plays' }).toBe(true);
  const menu = await openMixMenu(page, 'preset:qi', 'Grounding');
  await press(page, menu.getByTestId('mix-action-queue'));
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'its 9 queued after it' }).toBe(9);
  const before = await bstate(page);
  expect(before.cursor, 'on Grounding\'s first entry').toBe(0);
  await tapId(page, 'mixes-create');
  await expect(builderView(page)).toBeVisible();
  await tapId(page, 'builder-source-queue');
  await expect(footerCount(page)).toHaveText(countText(mix));
  await expect(page.getByTestId('builder-queue-left'), 'every queued track is in it').toHaveCount(0);
  await tapId(page, 'builder-play');
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'the queue is used up' }).toBe(0);
  expect((await bstate(page)).ids, 'the 9, once').toEqual(idsOf(ids, mix));
  await expect(toastText(page)).toContainText('Playing Grounding · from your queue: 9 tracks. Your queue is in it now.');
  await press(page, undoButton(page));
  await expect.poll(async () => (await qstate(page)).waiting.length, { message: 'Undo: the 9 queued again' }).toBe(9);
  expect((await bstate(page)).ids).toEqual(before.ids);
});

test('R3. review fix 4: a scanned 2178 Hz track whose stored deviation is not a number: Experimental counts it, 2178 Hz · SOURCE builds and plays it, nothing crashes @mobile', async ({ page }) => {
  const rows = ROWS.map((r, k) => (k === 16 ? { ...r, dev: '1.5' as unknown as number, scores: { golden: 0.4, p111: 0.1, dna: 0.2 } } : r));
  const ids = await openBuilderApp(page, { rows });
  await openBuilder(page);
  await tapId(page, 'builder-follow-exp');
  await expect(page.getByTestId('builder-exp-source2178')).toHaveAttribute('aria-label', /, 1 track$/);
  await tapId(page, 'builder-exp-source2178');
  await expect(footerCount(page)).toHaveText(countText([16]));
  await expect(page.getByText('This tab hit a problem.')).toHaveCount(0);
  await expect(page.getByTestId('mix-builder-view-fallback')).toHaveCount(0);
  await tapId(page, 'builder-play');
  await expect.poll(async () => (await bstate(page)).ids, { message: 'it plays' }).toEqual([ids[16]]);
});

test('R4. review fix 4: a crash inside the builder\'s model work shows its fallback in the tab (the Mixes tab and the music stay); a tab switch comes back to the list; Reload panel brings the builder back; Back too; the Filters and Start from sheets\' bodies are regions of their own @mobile', async ({ page }) => {
  const ids = await openBuilderApp(page, { seconds: 30 });
  await makePlaylist(page, 'Evening', ids, EVENING);
  await playLibraryFrom(page, 0);
  await openBuilder(page);
  const fallback = page.getByTestId('mix-builder-view-fallback');
  await crash(page, 'mix-builder-model');
  await expect(fallback).toContainText('Create a mix hit a problem.');
  await expect(page.getByText('This tab hit a problem.'), 'the Mixes tab stays').toHaveCount(0);
  expect((await libraryState(page)).playing, 'the music plays on').toBe(true);
  // The crash forgot that the builder was open: a tab switch comes back to the list.
  await openLibraryTab(page);
  await tab(page, 'mixes');
  await expect(page.getByTestId('mixes-create'), 'the list').toBeVisible();
  await expect(fallback).toHaveCount(0);
  // Again, then Reload panel: the builder is back (and open for the session again).
  await tapId(page, 'mixes-create');
  await expect(builderView(page)).toBeVisible();
  await crash(page, 'mix-builder-model');
  await expect(fallback).toBeVisible();
  await press(page, fallback.getByRole('button', { name: 'Reload panel' }));
  await expect(page.getByTestId('builder-follow')).toBeVisible();
  await expect(footerCount(page)).toHaveText(countText(setAll(libraryKs, GROUNDING)));
  await openLibraryTab(page);
  await tab(page, 'mixes');
  await expect(builderView(page), 'open again after Reload panel').toBeVisible();
  // The Filters sheet's body: its own region (the builder stays).
  await tapId(page, 'builder-filters-button');
  const filters = page.getByTestId('builder-filter-sheet');
  await expect(page.getByTestId('builder-filters-body')).toBeVisible();
  await crash(page, 'mix-builder-filters');
  await expect(filters.getByText('This sheet hit a problem.')).toBeVisible();
  await expect(fallback).toHaveCount(0);
  await press(page, filters.getByRole('button', { name: 'Reload panel' }));
  await expect(page.getByTestId('builder-filters-body')).toBeVisible();
  await tapId(page, 'builder-filters-done');
  await expect(filters).toHaveCount(0);
  // The Start from sheet's body too.
  await tapId(page, 'builder-source-playlist');
  const source = page.getByTestId('builder-source-sheet');
  await expect(source.getByText('Evening', { exact: true })).toBeVisible();
  await crash(page, 'mix-builder-source');
  await expect(source.getByText('This sheet hit a problem.')).toBeVisible();
  await press(page, source.getByRole('button', { name: 'Reload panel' }));
  await expect(source.getByText('Evening', { exact: true })).toBeVisible();
  await press(page, source.getByText('Evening', { exact: true }));
  await expect(source).toHaveCount(0);
  // A third crash switches the builder off for the session; its Back still goes to the list, which works.
  await crash(page, 'mix-builder-model');
  await expect(fallback).toContainText('switched off');
  await press(page, fallback.getByRole('button', { name: 'Back to Mixes', exact: true }));
  await expect(page.getByTestId('mixes-create')).toBeVisible();
  await tapId(page, 'mix-preset:qi');
  await expect.poll(async () => (await bstate(page)).ids, { message: 'a mix still starts from the list' }).toEqual(idsOf(ids, setAll(libraryKs, GROUNDING)));
  expect((await libraryState(page)).playing, 'the music plays on').toBe(true);
});

test('R5. review fix 6: with the storage refusing the builder\'s writes, Create a mix opens again at the session\'s taps (not the stale stored value); a reload brings back what was saved @mobile', async ({ page }) => {
  await openBuilderApp(page);
  await openBuilder(page);
  await tapId(page, 'builder-per-1');
  await expect(page.getByTestId('builder-per-1')).toHaveAttribute('aria-checked', 'true');
  expect(await builderWrites(page), 'saved once').toHaveLength(1);
  // From here the storage is full for the builder's key.
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      if (k === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  }, BUILDER_KEY);
  await tapId(page, 'builder-per-3');
  await press(page, page.getByTestId('builder-order-list').getByText('Shuffle, least recently played first', { exact: true }));
  await expect(page.getByTestId('builder-order-shuffle-note')).toBeVisible();
  await expect(page.getByTestId('builder-per-3')).toHaveAttribute('aria-checked', 'true');
  await press(page, page.getByRole('button', { name: 'Back to Mixes', exact: true }));
  await tapId(page, 'mixes-create');
  await expect(builderView(page)).toBeVisible();
  await expect(page.getByTestId('builder-per-3'), 'the session\'s taps, not the stored "1 per crystal"').toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('builder-order-shuffle-note')).toBeVisible();
  // A reload (the storage writes again): what was saved, 1 per crystal in the pattern's order.
  await launchBuilder(page);
  await openBuilder(page);
  await expect(page.getByTestId('builder-per-1')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('builder-order-shuffle-note')).toHaveCount(0);
});

test('R6. review fix 7: the Mixes list\'s place comes back only on the way back from the builder: Back restores it; scrolled to the top, a tab switch keeps the top @mobile', async ({ page }) => {
  await openBuilderApp(page);
  await tab(page, 'mixes');
  await expect(page.getByTestId('mixes-create')).toBeVisible();
  const list = page.getByTestId('mixes-scroll');
  const top = () => list.evaluate((el) => Math.round(el.scrollTop));
  expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight), 'the list scrolls').toBeGreaterThan(300);
  await list.evaluate((el) => { el.scrollTop = 300; });
  await expect.poll(top).toBe(300);
  // Open the builder from there (a mix's ⋯ in view › Customize…), and Back: the list where it was, the focus on that ⋯.
  const more = await list.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const b = Array.from(el.querySelectorAll<HTMLElement>('[data-testid^="mix-more-"]')).find((x) => { const r = x.getBoundingClientRect(); return r.top >= box.top + 8 && r.bottom <= box.bottom - 8; });
    return b?.dataset.testid ?? null;
  });
  expect(more, 'a mix\'s ⋯ in view').toBeTruthy();
  await tapId(page, more!);
  await press(page, page.getByTestId('mix-action-customize'));
  await expect(builderView(page)).toBeVisible();
  await press(page, page.getByRole('button', { name: 'Back to Mixes', exact: true }));
  await expect(page.getByTestId(more!), 'Back: the focus on that ⋯').toBeFocused();
  await expect.poll(top, { message: 'Back: the list where it was' }).toBe(300);
  // To the top, then another tab and back: still the top.
  await list.evaluate((el) => { el.scrollTop = 0; });
  await expect.poll(top).toBe(0);
  await openLibraryTab(page);
  await tab(page, 'mixes');
  await expect(page.getByTestId('mixes-create')).toBeVisible();
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  expect(await top(), 'a tab switch: the top, not the place the builder was opened from').toBe(0);
});

test('R7. review fix 8: the builder\'s radiogroups are keyboard radio groups: one Tab stop each (the chosen radio), the arrow keys move and pick (wrapping), Home and End', async ({ page }) => {
  test.skip(ON_DEVICE, 'a keyboard');
  await openBuilderApp(page);
  await openBuilder(page);
  const stops = () => builderView(page).evaluate((root) => Array.from(root.querySelectorAll('[role="radiogroup"]')).map((g) => Array.from(g.querySelectorAll('[role="radio"]')).filter((r) => r.getAttribute('tabindex') !== '-1').length));
  expect(await stops(), 'one Tab stop in each radiogroup (Follow, the crystal sets, Tracks per crystal)').toEqual([1, 1, 1]);
  await page.getByTestId('builder-source-queue').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('builder-follow-set'), 'Tab enters Follow at its chosen kind').toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('builder-follow-any')).toBeFocused();
  await expect(page.getByTestId('builder-follow-any')).toHaveAttribute('aria-checked', 'true');
  await expect(footerCount(page)).toHaveText(countText(libraryKs.filter((k) => ROWS[k].crystal !== null)));
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('builder-filters-button'), 'one Tab stop: Tab leaves Follow').toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('builder-follow-any')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('builder-follow-exp')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('builder-follow-walk'), 'the arrows wrap').toBeFocused();
  await expect(page.getByTestId('builder-follow-walk')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  await expect(page.getByTestId('builder-follow-exp')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByTestId('builder-follow-walk')).toHaveAttribute('aria-checked', 'true');
  // The walks: one Tab stop (Ascent, chosen), the arrows move and pick.
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('builder-walk-A')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('builder-walk-B')).toBeFocused();
  await expect(page.getByTestId('builder-walk-B')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('builder-walk-cabi'), 'back past the first: the last').toHaveAttribute('aria-checked', 'true');
  expect(await stops(), 'one Tab stop in Follow and the walks').toEqual([1, 1]);
});

test('R8. review fix 5: the walk choices\' counts come from the pool\'s crystals (one summary per tap): with a filter on, each walk\'s choice says what its own footer says @mobile', async ({ page }) => {
  await openBuilderApp(page);
  await openBuilder(page);
  await tapId(page, 'builder-follow-walk');
  await expect(page.getByTestId('builder-walk-C')).toHaveAttribute('aria-label', 'Vortex, 24 of 27');
  // Under 3 min: every fourth tone (150 s).
  await tapId(page, 'builder-filters-button');
  await press(page, page.getByTestId('builder-filters-body').locator('button[data-facet="length"][data-value="lt3"]'));
  await tapId(page, 'builder-filters-done');
  await expect(page.getByTestId('builder-filter-sheet')).toHaveCount(0);
  const vortex = new Set(libraryKs.filter((k) => ROWS[k].duration === 150 && ROWS[k].crystal !== null).map((k) => ROWS[k].crystal)).size;
  await expect(page.getByTestId('builder-walk-C'), 'Vortex: one position per crystal left').toHaveAttribute('aria-label', `Vortex, ${vortex} of 27`);
  for (const mode of ['A', 'B', 'C', 'combined', 'ouroboros', 'cabi']) {
    await tapId(page, `builder-walk-${mode}`);
    await expect(page.getByTestId(`builder-walk-${mode}`)).toHaveAttribute('aria-checked', 'true');
    const m = /, (\d+) of (\d+)$/.exec((await page.getByTestId(`builder-walk-${mode}`).getAttribute('aria-label')) ?? '');
    expect(m, `${mode}: its choice counts`).toBeTruthy();
    await expect(footerCount(page), `${mode}: the choice's count is the footer's`).toHaveText(new RegExp(`^${m![1]} of ${m![2]} positions`));
  }
});

// ---------------------------------------------------------------------------------------------------------------
// v16.3 re-review fixes (K1, R9).
// ---------------------------------------------------------------------------------------------------------------
test(`K1. re-review fix 1 (QUEUE_UNPICKED '${QUEUE_UNPICKED}'): from a queue of 4, Grounding keeps 3 and leaves one: the footer's one-track words; after Play, Up next (keep: the one left out first, then the mix; leave: the mix only); the toast; Undo brings the 4 back @mobile`, async ({ page }) => {
  const ids = await openBuilderApp(page);
  await playLibraryFrom(page, 0);
  const queued = [3, 5, 9, 2];
  await page.evaluate((q) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(q, 'queue')), idsOf(ids, queued));
  await expect.poll(async () => (await qstate(page)).waiting.length).toBe(4);
  const picked = setAll(queued, GROUNDING);
  expect(picked, 'Grounding of the four: tone-10 (285 Hz), tone-03 (396), tone-04 (417)').toEqual([9, 2, 3]);
  const unpicked = queued.filter((k) => !picked.includes(k));
  expect(unpicked, 'tone-06 (no Grounding crystal)').toEqual([5]);
  await openBuilder(page);
  await tapId(page, 'builder-source-queue');
  await expect(footerCount(page)).toHaveText(countText(picked));
  await expect(page.getByTestId('builder-queue-left'), 'before Play').toHaveText(KEEP
    ? '1 of your queued tracks isn’t in this mix: it stays queued and plays after its first track.'
    : '1 of your queued tracks isn’t in this mix: it leaves the queue.');
  await expect(page.getByTestId('builder-queue-line')).toHaveCount(KEEP ? 0 : 1);
  const before = await bstate(page);
  await tapId(page, 'builder-play');
  await expect.poll(async () => (await bstate(page)).ids, { message: 'the play order' }).toEqual(idsOf(ids, KEEP ? [picked[0], ...unpicked, ...picked.slice(1)] : picked));
  await expect.poll(async () => (await qstate(page)).upcoming, { message: 'Up next' }).toEqual({
    queued: KEEP ? unpicked.map(toneName) : [],
    more: 0,
    next: picked.slice(1).map(toneName),
    end: 'stop',
  });
  await expect(toastText(page)).toContainText(KEEP
    ? 'Playing Grounding · from your queue: 3 tracks. The queued track not in it plays next.'
    : 'Playing Grounding · from your queue: 3 tracks. Your queue became this mix. 1 queued track left the queue.');
  await expect(toastText(page)).not.toContainText('Your queued track plays next.');
  await press(page, undoButton(page));
  await expect.poll(async () => (await bstate(page)).ids, { message: 'Undo: the old order' }).toEqual(before.ids);
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'Undo: the 4 queued again, in order' }).toEqual(queued.map(toneName));
  expect((await libraryState(page)).libraryIds, 'the library untouched').toEqual(ids);
});

test('R9. re-review fix 2: a crash its saved settings cause (the dev drill mix-builder-settings, on Vortex) comes back after a reload, the Mixes list beside it; the fallback\'s Start over goes back to Grounding (saved and for the session) and the builder opens, after another reload too @mobile', async ({ page }) => {
  // The drill throws inside the builder's summary while its settings follow Vortex. An init script: it holds across reloads.
  await page.addInitScript(() => {
    (window as any).__aetheriaCrashWhen = { 'mix-builder-settings': (s: any) => s?.follow?.kind === 'walk' && s?.follow?.mode === 'C' };
  });
  const ids = await openBuilderApp(page);
  await playLibraryFrom(page, 0);
  await openBuilder(page);
  await tapId(page, 'builder-follow-walk');
  await expect(page.getByTestId('builder-walk-A')).toHaveAttribute('aria-checked', 'true');
  const fallback = page.getByTestId('mix-builder-view-fallback');
  await tapId(page, 'builder-walk-C'); // the tap saves Vortex, then the summary throws
  await expect(fallback).toContainText('Create a mix hit a problem.');
  const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.follow ?? null, BUILDER_KEY);
  expect(await saved(), 'the tap saved Vortex').toEqual({ kind: 'walk', mode: 'C' });
  // A reload: Create a mix opens straight into the fallback; Back goes to the list, which works.
  await launchBuilder(page);
  await openLibraryTab(page);
  await tab(page, 'mixes');
  await tapId(page, 'mixes-create');
  await expect(fallback, 'after a reload, the saved settings crash again').toContainText('Create a mix hit a problem.');
  await expect(page.getByText('This tab hit a problem.'), 'the Mixes tab stays').toHaveCount(0);
  await press(page, fallback.getByRole('button', { name: 'Back to Mixes', exact: true }));
  await expect(page.getByTestId('mixes-create'), 'the list').toBeVisible();
  await tapId(page, 'mix-preset:qi');
  await expect.poll(async () => (await bstate(page)).ids, { message: 'a mix starts from the list' }).toEqual(idsOf(ids, setAll(libraryKs, GROUNDING)));
  // Again: the fallback, and its Start over.
  await tapId(page, 'mixes-create');
  await expect(fallback).toBeVisible();
  const startOver = fallback.getByRole('button', { name: 'Start over', exact: true });
  await expect(startOver).toBeVisible();
  await press(page, startOver);
  await expect(builderView(page), 'Start over: the builder opens').toBeVisible();
  await expect(fallback).toHaveCount(0);
  await expect(page.getByTestId('builder-follow-set')).toHaveAttribute('aria-checked', 'true');
  await expect(footerName(page)).toHaveText('Same as Grounding in Mixes');
  await expect(footerCount(page)).toHaveText(countText(setAll(libraryKs, GROUNDING)));
  await expect(page.getByRole('heading', { name: 'Create a mix', level: 1 }), 'the focus on its heading').toBeFocused();
  expect(await saved(), 'Grounding saved').toEqual({ kind: 'set', set: 'preset:qi' });
  // For the session: Back and Create a mix again opens Grounding; and after another reload too.
  await press(page, page.getByRole('button', { name: 'Back to Mixes', exact: true }));
  await tapId(page, 'mixes-create');
  await expect(page.getByTestId('builder-follow-set')).toHaveAttribute('aria-checked', 'true');
  await launchBuilder(page);
  await openBuilder(page);
  await expect(page.getByTestId('builder-follow-set'), 'after a reload').toHaveAttribute('aria-checked', 'true');
  await expect(fallback).toHaveCount(0);
});

test('R9b. re-review fix 2, the session mirror: with the storage refusing the builder\'s writes, settings that crash the builder (the session\'s, Vortex) reopen into the fallback; Start over puts Grounding in the session, so Back and Create a mix open the builder at Grounding @mobile', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__aetheriaCrashWhen = { 'mix-builder-settings': (s: any) => s?.follow?.kind === 'walk' && s?.follow?.mode === 'C' };
  });
  await openBuilderApp(page);
  // From the start the storage is full for the builder's key: every tap's settings live in the session only.
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      if (k === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  }, BUILDER_KEY);
  await openBuilder(page);
  await tapId(page, 'builder-follow-walk');
  const fallback = page.getByTestId('mix-builder-view-fallback');
  await tapId(page, 'builder-walk-C');
  await expect(fallback).toContainText('Create a mix hit a problem.');
  // Back, then Create a mix: the session's Vortex again (the stored value is stale), so the fallback.
  await press(page, fallback.getByRole('button', { name: 'Back to Mixes', exact: true }));
  await tapId(page, 'mixes-create');
  await expect(fallback, 'the session\'s settings crash again').toContainText('Create a mix hit a problem.');
  await press(page, fallback.getByRole('button', { name: 'Start over', exact: true }));
  await expect(builderView(page)).toBeVisible();
  await expect(page.getByTestId('builder-follow-set')).toHaveAttribute('aria-checked', 'true');
  // Back and Create a mix: the session's Grounding, not the crash.
  await press(page, page.getByRole('button', { name: 'Back to Mixes', exact: true }));
  await tapId(page, 'mixes-create');
  await expect(builderView(page), 'the session holds Grounding').toBeVisible();
  await expect(fallback).toHaveCount(0);
  await expect(page.getByTestId('builder-follow-set')).toHaveAttribute('aria-checked', 'true');
  await expect(footerName(page)).toHaveText('Same as Grounding in Mixes');
});

test('R9c. v16.4: after the third crash (the saved settings, Vortex) the builder is switched off, yet its fallback still offers Start over: Grounding saved and for the session, the list, and the next Create a mix opens at Grounding; settings that still crash cost one strike per Create a mix and Start over none, never a loop @mobile', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__aetheriaCrashWhen = { 'mix-builder-settings': (s: any) => s?.follow?.kind === 'walk' && s?.follow?.mode === 'C' };
  });
  const ids = await openBuilderApp(page);
  // The builder's strikes: each caught crash is one entry of the view error log (ErrorBoundary's recordViewError).
  const strikes = () => page.evaluate(() => (JSON.parse(localStorage.getItem('aetheria.viewErrors.v1') || '[]') as Array<{ view?: string }>).filter((e) => e?.view === 'mix-builder-view').length);
  const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.follow ?? null, BUILDER_KEY);
  const fallback = page.getByTestId('mix-builder-view-fallback');
  const startOver = fallback.getByRole('button', { name: 'Start over', exact: true });
  const s0 = await strikes();
  await openBuilder(page);
  await tapId(page, 'builder-follow-walk');
  await tapId(page, 'builder-walk-C'); // the tap saves Vortex, then the summary throws: the first crash
  await expect(fallback).toContainText('Create a mix hit a problem.');
  await expect.poll(strikes, { message: 'one strike' }).toBe(s0 + 1);
  // Back and Create a mix, twice: the saved Vortex crashes the builder again, and the third crash switches it off.
  for (const k of [2, 3]) {
    await press(page, fallback.getByRole('button', { name: 'Back to Mixes', exact: true }));
    await tapId(page, 'mixes-create');
    await expect(fallback, `crash ${k}`).toBeVisible();
    await expect.poll(strikes, { message: `${k} strikes` }).toBe(s0 + k);
  }
  await expect(fallback).toContainText('switched off');
  await expect(fallback.getByRole('button', { name: 'Reload panel' }), 'Reload panel is refused').toHaveCount(0);
  expect(await saved(), 'Vortex still saved').toEqual({ kind: 'walk', mode: 'C' });
  // Switched off, Start over is still offered: Grounding saved, and the list.
  await expect(startOver, 'switched off, Start over is still offered').toBeVisible();
  await press(page, startOver);
  await expect(page.getByTestId('mixes-create'), 'Start over: back to the list').toBeVisible();
  await expect(fallback).toHaveCount(0);
  await expect(page.getByTestId('mixes-create'), 'the focus on Create a mix').toBeFocused();
  await page.waitForTimeout(500);
  await expect(builderView(page), 'Start over opens nothing by itself').toHaveCount(0);
  await expect(fallback).toHaveCount(0);
  expect(await saved(), 'Grounding saved').toEqual({ kind: 'set', set: 'preset:qi' });
  expect(await strikes(), 'Start over mounted nothing').toBe(s0 + 3);
  // The next Create a mix opens at Grounding.
  await tapId(page, 'mixes-create');
  await expect(builderView(page), 'the builder opens').toBeVisible();
  await expect(fallback).toHaveCount(0);
  await expect(page.getByTestId('builder-follow-set')).toHaveAttribute('aria-checked', 'true');
  await expect(footerName(page)).toHaveText('Same as Grounding in Mixes');
  await expect(footerCount(page)).toHaveText(countText(setAll(libraryKs, GROUNDING)));
  expect(await strikes(), 'Grounding: no crash').toBe(s0 + 3);
  // Never a loop: with Grounding crashing too, each Create a mix costs one strike; Start over goes to the list for none.
  await press(page, page.getByRole('button', { name: 'Back to Mixes', exact: true }));
  await page.evaluate(() => {
    (window as any).__aetheriaCrashWhen['mix-builder-settings'] = () => true;
  });
  for (const k of [4, 5]) {
    await tapId(page, 'mixes-create');
    await expect(fallback).toContainText('switched off');
    await expect.poll(strikes, { message: `${k} strikes: one for the tap` }).toBe(s0 + k);
    await expect(startOver).toBeVisible();
    await press(page, startOver);
    await expect(page.getByTestId('mixes-create')).toBeVisible();
    await expect(fallback).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(fallback, 'Start over opens nothing by itself').toHaveCount(0);
    expect(await strikes(), 'Start over: no strike, nothing mounted').toBe(s0 + k);
  }
  expect(await saved(), 'Grounding saved').toEqual({ kind: 'set', set: 'preset:qi' });
  expect((await libraryState(page)).libraryIds, 'the library untouched').toEqual(ids);
});
