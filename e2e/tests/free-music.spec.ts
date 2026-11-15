// e2e/tests/free-music.spec.ts (v16.13, "Aetheria's 222"; review page aeb068c3, the user's answers of 15 Nov 2026)
//
// The free music, end to end, against a fake of its site: page.route answers MUSIC_BASE with short Ogg Opus tones and
// envelope files, and a dev build's window.__aetheriaFreeList replaces the shipped list with a small one whose sizes
// are the tones'. The last test reads the shipped list itself (no download).
//   F1 a group: fixed ids, titles, lengths, the list's reading (Deep Scan's, at its rate), the key and the envelope;
//      saved; its playlist; the group rows after.        F2 no doubles: All adds only what is missing; the playlists
//      are topped up, never doubled.                     F3 a failed download stops the add; what came is in; Add gets
//      the rest.   F4 a short download is refused.        F5 Stop.   F6 Choose tracks: one track.
//   F7 a reload keeps them (ids, crystals, envelopes, playlists).    F8 the empty Library's offer opens the panel.
//   F9 nothing is fetched before a tap; the music site alone after.  F10 classic's three buttons.
//   F11 a track whose envelope file fails comes in without one.      F12 the shipped list: 222, its groups and sizes.

import { type Page, type Route } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import { openNewLayout, openApp, openLibraryTab, libraryState, cacheCounts, PHONE_VIEWPORT, phoneSize, rowMenu, stubStorageFull } from './helpers';
import { MEDIA, ffmpegAvailable } from './media';
import { MUSIC_BASE, envelopeBytes, PLAYLIST_NAMES } from '../../utils/freeMusic/model.ts';

const CORS = { 'Access-Control-Allow-Origin': '*' };
const TONE = () => MEDIA.oggOpus(2);
const ENV = Buffer.from(envelopeBytes({ fps: 20, sub: new Uint8Array(40).fill(30), bass: new Uint8Array(40).fill(200), mid: new Uint8Array(40).fill(90), high: new Uint8Array(40).fill(50) }));
const CHROMA = [0.1, 0.05, 0.1, 0.05, 0.1, 0.1, 0.05, 0.1, 0.05, 0.1, 0.1, 0.1];

interface Fixture { id: string; title: string; slug: string; kind: 'instrumental' | 'song'; crystal: number }
const TRACKS: Fixture[] = [
  { id: 'aetheria-test-glow', title: 'Test Glow', slug: 'test-glow', kind: 'instrumental', crystal: 528 },
  { id: 'aetheria-test-river', title: "Test River's Edge", slug: 'test-river', kind: 'instrumental', crystal: 1449 },
  { id: 'aetheria-test-stone', title: 'Test Stone', slug: 'test-stone', kind: 'song', crystal: 3150 },
  { id: 'aetheria-test-lantern', title: 'Test Lantern: Night', slug: 'test-lantern', kind: 'song', crystal: 6336 },
  { id: 'aetheria-test-ember', title: 'Test Ember', slug: 'test-ember', kind: 'song', crystal: 174 },
];
const ids = (kind?: 'instrumental' | 'song') => TRACKS.filter((t) => !kind || t.kind === kind).map((t) => t.id);

function testList(size: number) {
  return {
    v: 1,
    tracks: TRACKS.map((t) => ({
      id: t.id, title: t.title, file: `tracks/${t.slug}.ogg`, kind: t.kind, duration: 2, size,
      harmonicFreq: t.crystal + 0.4, closestSolfeggio: t.crystal, harmonicDeviation: 0.4, scanRate: 48000, isAetheriaCandidate: false,
      chroma: CHROMA, chromaA4Hz: 440.1, musicKey: 'Am', keyConfidence: 0.7, chromaVersion: 1, env: `tracks/${t.slug}.env`,
    })),
  };
}

interface Site { hits: string[]; fail: Set<string>; short: Set<string>; delayMs: number; hold: Promise<void> | null; holdPath: string | null }
/** The fake music site; its answers can be changed while a test runs (fail, short, delay, hold: every request, or the
 *  one at holdPath). */
async function serveMusic(page: Page): Promise<Site> {
  const tone = TONE();
  const site: Site = { hits: [], fail: new Set(), short: new Set(), delayMs: 0, hold: null, holdPath: null };
  await page.route(`${MUSIC_BASE}**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/aetheria-music\//, '');
    site.hits.push(path);
    if (site.hold && (site.holdPath === null || site.holdPath === path)) await site.hold;
    if (site.delayMs) await new Promise((r) => setTimeout(r, site.delayMs));
    // (A request Stop aborted while it was held can't be answered any more: that's expected, not a failure.)
    const answer = (o: Parameters<Route['fulfill']>[0]) => route.fulfill(o).catch(() => {});
    // A failure's body is a whole file's worth: a server's error page can be any size, so only the status tells.
    if (site.fail.has(path)) return answer({ status: 500, headers: CORS, body: path.endsWith('.env') ? ENV : tone });
    if (path.endsWith('.ogg')) return answer({ status: 200, headers: { ...CORS, 'Content-Type': 'audio/ogg' }, body: site.short.has(path) ? tone.subarray(0, tone.length - 64) : tone });
    if (path.endsWith('.env')) return answer({ status: 200, headers: { ...CORS, 'Content-Type': 'application/octet-stream' }, body: ENV });
    return answer({ status: 404, headers: CORS, body: '' });
  });
  return site;
}

async function seedList(page: Page) {
  // Batches of 4 (the app's are 12): the 5-track lists then need two, as All 222 needs many.
  await page.addInitScript((l) => { (window as any).__aetheriaFreeList = l; (window as any).__aetheriaFreeBatch = 4; }, testList(TONE().length));
}

const sheet = (page: Page) => page.getByTestId('sheet-import');
async function openFreePanel(page: Page) {
  await openLibraryTab(page);
  await page.getByTestId('library-import').click();
  await sheet(page).getByTestId('import-free').click();
  await expect(sheet(page).getByTestId('free-music')).toBeVisible();
}
const statusLine = (page: Page) => sheet(page).getByTestId('free-status-line');
/** The stored metadata's reading fields, by id (crystalOrigin derives 'scan' for a record without crystalSource, so
 *  the libraryState origins alone can't show the list's reading was carried). */
const storedReadings = (page: Page) =>
  page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const metas: any[] = await new Promise((res, rej) => { const r = db.transaction('meta', 'readonly').objectStore('meta').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    db.close();
    return metas.map((m) => [m.id, m.crystalSource ?? null, m.scanRate ?? null, m.closestSolfeggio ?? null, m.musicKey ?? null]).sort();
  });
const playlists = (page: Page) => page.evaluate(() => (window as any).__aetheriaPlaylists?.state()?.lists ?? []) as Promise<Array<{ id: string; name: string; ids: string[] }>>;
const freePlaylist = async (page: Page, kind: 'instrumental' | 'song') => (await playlists(page)).filter((p) => p.name === PLAYLIST_NAMES[kind]);

test.beforeEach(async ({ page, viewport }) => {
  test.skip(!ffmpegAvailable(), 'needs ffmpeg for the test tones');
  if (ON_DEVICE && viewport) await page.setViewportSize(viewport);
});

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("F1. Instrumentals: each comes in with its fixed id, title, length, the list's reading, key and envelope; saved; in its playlist; the rows say so", async ({ page }) => {
    test.setTimeout(120_000);
    const site = await serveMusic(page);
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await expect(sheet(page).getByRole('button', { name: 'Back to Import music', exact: true }), 'from the choice, the focus is on Back').toBeFocused();
    await expect(sheet(page).getByTestId('free-group-all')).toContainText('All 5 tracks');
    await expect(sheet(page).getByTestId('free-add-instrumental')).toHaveAccessibleName('Add the 2 instrumentals');
    await expect(sheet(page).getByTestId('free-group-instrumental')).toContainText('2 tracks');
    await expect(sheet(page).getByTestId('free-credit')).toContainText('Music by Aetheria · Big Banana Studios. Free to play in Aetheria.');
    // v16.13.2: the mastering credit, its own line right under the credit.
    await expect(sheet(page).getByTestId('free-mastering')).toHaveText("Mastered by Masterchannel's Wez Clarke.");
    await expect(sheet(page).locator('[data-testid="free-credit"] > p').nth(1)).toHaveAttribute('data-testid', 'free-mastering');
    await expect(sheet(page).getByTestId('free-credit')).toContainText('Creative Commons BY-NC 4.0');
    await sheet(page).getByTestId('free-add-instrumental').click();
    await expect(statusLine(page)).toHaveText('Added 2 tracks to your library. They\'re in "Aetheria · Instrumentals" too.', { timeout: 30_000 });
    const st = await libraryState(page);
    expect(st.libraryIds).toEqual(ids('instrumental'));
    expect(st.libraryNames).toEqual(['Test Glow', "Test River's Edge"]);
    expect(st.libraryDurations).toEqual([2, 2]);
    expect(st.crystals).toEqual([528, 1449]);
    expect(st.origins).toEqual(['scan', 'scan']);
    expect(st.scanRates).toEqual([48000, 48000]);
    expect(st.ids, 'a fresh library: the play order is the library').toEqual(ids('instrumental'));
    expect(st.files?.map((f) => f?.name), 'files named after the titles').toEqual(['Test Glow.ogg', "Test River's Edge.ogg"]);
    await expect.poll(async () => { const c = await cacheCounts(page); return [c.blobs, c.meta, c.envScan, c.keyed]; }, { timeout: 15_000 }).toEqual([2, 2, 2, 2]);
    expect(await storedReadings(page), "stored as Deep Scan's own reading, at its rate, with the key").toEqual([
      ['aetheria-test-glow', 'scan', 48000, 528, 'Am'],
      ['aetheria-test-river', 'scan', 48000, 1449, 'Am'],
    ]);
    const pl = await freePlaylist(page, 'instrumental');
    expect(pl.map((p) => p.ids)).toEqual([ids('instrumental')]);
    expect(await freePlaylist(page, 'song')).toEqual([]);
    await expect(sheet(page).getByTestId('free-add-instrumental')).toHaveText('Added');
    await expect(sheet(page).getByTestId('free-add-instrumental')).toHaveAccessibleName('Added: the instrumentals are in your library');
    await expect(sheet(page).getByTestId('free-add-instrumental')).toHaveAttribute('aria-disabled', 'true');
    await expect(sheet(page).getByTestId('free-status-end'), 'on the phone the end line is read (the toast under the sheet is not)').not.toHaveAttribute('aria-live', 'off');
    await expect(sheet(page).getByTestId('free-group-all')).toContainText('3 more tracks');
    expect(site.hits.filter((h) => h.endsWith('.ogg')).sort()).toEqual(['tracks/test-glow.ogg', 'tracks/test-river.ogg']);
    expect(dialogs).toEqual([]);
  });

  test('F2. no doubles: All after Instrumentals adds the three songs only; Instrumentals is not topped up twice; then everything says Added', async ({ page }) => {
    test.setTimeout(120_000);
    const site = await serveMusic(page);
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await sheet(page).getByTestId('free-add-instrumental').click();
    await expect(statusLine(page)).toContainText('Added 2 tracks', { timeout: 30_000 });
    await sheet(page).getByTestId('free-add-all').click();
    await expect(statusLine(page)).toHaveText('Added 3 tracks to your library. They\'re in "Aetheria · Songs" too.', { timeout: 30_000 });
    const st = await libraryState(page);
    expect(st.libraryIds).toEqual([...ids('instrumental'), ...ids('song')]);
    expect(new Set(st.libraryIds).size).toBe(5);
    expect(site.hits.filter((h) => h.endsWith('.ogg')).length, 'each file fetched once').toBe(5);
    expect((await freePlaylist(page, 'instrumental')).map((p) => p.ids)).toEqual([ids('instrumental')]);
    expect((await freePlaylist(page, 'song')).map((p) => p.ids)).toEqual([ids('song')]);
    for (const g of ['all', 'instrumental', 'song']) await expect(sheet(page).getByTestId(`free-add-${g}`)).toHaveText('Added');
    await sheet(page).getByTestId('free-add-all').click({ force: true });
    await page.waitForTimeout(500);
    expect(site.hits.filter((h) => h.endsWith('.ogg')).length, 'a press with nothing missing fetches nothing').toBe(5);
    expect(dialogs).toEqual([]);
  });

  test('F3. a failed download stops the add: what came is in, the line says so; Add then gets the rest', async ({ page }) => {
    test.setTimeout(120_000);
    const site = await serveMusic(page);
    site.fail.add('tracks/test-lantern.ogg');
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await sheet(page).getByTestId('free-add-song').click();
    // The songs in the list's order: Stone, Lantern, Ember. Stone comes, Lantern fails, Ember is never asked for.
    await expect(statusLine(page)).toHaveText('Stopped after 1 of 3 tracks: the music site couldn\'t send "Test Lantern: Night". Try again later for the rest.', { timeout: 30_000 });
    expect((await libraryState(page)).libraryIds).toEqual(['aetheria-test-stone']);
    expect(site.hits).not.toContain('tracks/test-ember.ogg');
    expect((await freePlaylist(page, 'song')).map((p) => p.ids), 'the one that came is in its playlist').toEqual([['aetheria-test-stone']]);
    await expect(sheet(page).getByTestId('free-group-song')).toContainText('2 more tracks');
    site.fail.clear();
    await sheet(page).getByTestId('free-add-song').click();
    await expect(statusLine(page)).toHaveText('Added 2 tracks to your library. They\'re in "Aetheria · Songs" too.', { timeout: 30_000 });
    expect((await libraryState(page)).libraryIds).toEqual(['aetheria-test-stone', 'aetheria-test-lantern', 'aetheria-test-ember']);
    expect((await freePlaylist(page, 'song')).map((p) => p.ids)).toEqual([['aetheria-test-stone', 'aetheria-test-lantern', 'aetheria-test-ember']]);
    expect(dialogs).toEqual([]);
  });

  test('F4. a download shorter than the list says is refused: nothing of it comes in', async ({ page }) => {
    test.setTimeout(120_000);
    const site = await serveMusic(page);
    site.short.add('tracks/test-glow.ogg');
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await sheet(page).getByTestId('free-add-instrumental').click();
    await expect(statusLine(page)).toHaveText('The music site couldn\'t send "Test Glow". Try again later.', { timeout: 30_000 });
    expect((await libraryState(page)).libraryIds).toEqual([]);
    expect(await freePlaylist(page, 'instrumental')).toEqual([]);
    expect(dialogs).toEqual([]);
  });

  test('F5. Stop: the add ends after the track in hand; what is in stays; Add gets the rest', async ({ page }) => {
    test.setTimeout(120_000);
    const site = await serveMusic(page);
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    let release!: () => void;
    site.hold = new Promise<void>((r) => (release = r));
    await sheet(page).getByTestId('free-add-all').click();
    await expect(statusLine(page)).toHaveText('Adding 0 of 5 tracks · 0 of 1 MB');
    await expect(sheet(page).getByTestId('free-add-all')).toHaveText('Adding…');
    await expect(sheet(page).getByTestId('free-add-all')).toHaveAccessibleName('Adding… all 5 tracks');
    await expect(sheet(page).getByTestId('free-add-song')).toHaveAttribute('aria-disabled', 'true');
    await expect(sheet(page).getByTestId('free-status').locator('.sr-only'), 'the start, read once').toHaveText('Adding 5 tracks.');
    await expect(sheet(page).getByTestId('free-status-progress'), 'the progress, from its first line, is not read as it changes').toHaveAttribute('aria-live', 'off');
    await expect(sheet(page).getByTestId('free-status').getByRole('button'), 'Stop adding is outside the live region').toHaveCount(0);
    await sheet(page).getByTestId('free-stop').click();
    site.hold = null;
    release();
    await expect(statusLine(page)).toHaveText('Stopped after 0 of 5 tracks. Adding again gets the rest.', { timeout: 30_000 });
    await expect(sheet(page).getByTestId('free-status-end'), 'Stop had the focus: it goes to the end line').toBeFocused();
    expect((await libraryState(page)).libraryIds).toEqual([]);
    await sheet(page).getByTestId('free-add-all').click();
    await expect(statusLine(page)).toContainText('Added 5 tracks', { timeout: 30_000 });
    expect((await libraryState(page)).libraryIds.length).toBe(5);
    expect(dialogs).toEqual([]);
  });

  test('F6. Choose tracks: one track, by its own Add; its row and the groups follow', async ({ page }) => {
    test.setTimeout(120_000);
    const site = await serveMusic(page);
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await sheet(page).getByTestId('free-choose').click();
    const rows = sheet(page).getByTestId('free-track');
    await expect(rows).toHaveCount(5);
    await sheet(page).getByRole('button', { name: 'Add Test Lantern: Night', exact: true }).click();
    await expect(statusLine(page)).toHaveText('Added 1 track to your library. It\'s in "Aetheria · Songs" too.', { timeout: 30_000 });
    expect((await libraryState(page)).libraryIds).toEqual(['aetheria-test-lantern']);
    expect((await libraryState(page)).files?.[0]?.name, 'a title with ":" gets a file name without it').toBe('Test Lantern Night.ogg');
    await expect(sheet(page).getByRole('button', { name: 'Added: Test Lantern: Night is in your library', exact: true })).toHaveText('Added');
    await expect(sheet(page).getByTestId('free-group-song')).toContainText('2 more tracks');
    expect(site.hits.filter((h) => h.endsWith('.ogg'))).toEqual(['tracks/test-lantern.ogg']);
    expect(dialogs).toEqual([]);
  });

  test('F7. a reload keeps them: ids, readings, keys, envelopes and the playlists', async ({ page }) => {
    test.setTimeout(150_000);
    await serveMusic(page);
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await sheet(page).getByTestId('free-add-all').click();
    await expect(statusLine(page)).toContainText('Added 5 tracks', { timeout: 30_000 });
    await expect.poll(async () => (await cacheCounts(page)).blobs, { timeout: 15_000 }).toBe(5);
    await page.waitForTimeout(2500); // the 2 s metadata save
    const before = await libraryState(page);
    await page.reload();
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 20_000 }).toBe(5);
    const after = await libraryState(page);
    expect([after.libraryIds, after.libraryNames, after.crystals, after.origins, after.scanRates]).toEqual([before.libraryIds, before.libraryNames, before.crystals, before.origins, before.scanRates]);
    const c = await cacheCounts(page);
    expect([c.envScan, c.keyed]).toEqual([5, 5]);
    expect((await freePlaylist(page, 'instrumental')).map((p) => p.ids)).toEqual([ids('instrumental')]);
    expect((await freePlaylist(page, 'song')).map((p) => p.ids)).toEqual([ids('song')]);
    await openLibraryTab(page);
    await page.getByTestId('library-import').click();
    await sheet(page).getByTestId('import-free').click();
    for (const g of ['all', 'instrumental', 'song']) await expect(sheet(page).getByTestId(`free-add-${g}`)).toHaveText('Added');
    expect(dialogs).toEqual([]);
  });

  test("F8. the empty Library's offer opens the sheet at Aetheria's music, with the focus on Back", async ({ page }) => {
    test.setTimeout(90_000);
    await serveMusic(page);
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openLibraryTab(page);
    const offer = page.getByTestId('library-empty-free');
    await expect(offer).toHaveText("Or start with Aetheria's 5 free tracks");
    await offer.click();
    await expect(sheet(page).getByTestId('free-music')).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: 'Back to Import music', exact: true })).toBeFocused();
    await sheet(page).getByRole('button', { name: 'Back to Import music', exact: true }).click();
    await expect(sheet(page).getByTestId('import-free')).toBeFocused();
    expect(dialogs).toEqual([]);
  });

  test('F9. nothing is fetched from the music site before a tap; after one, only the music site, only what was asked for', async ({ page }) => {
    test.setTimeout(90_000);
    const site = await serveMusic(page);
    const other: string[] = [];
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith(MUSIC_BASE)) other.push(u); });
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await sheet(page).getByTestId('free-choose').click();
    await page.waitForTimeout(800);
    expect(site.hits, 'opening the panel and its list fetches nothing').toEqual([]);
    await sheet(page).getByRole('button', { name: 'Add Test Glow', exact: true }).click();
    await expect(statusLine(page)).toContainText('Added 1 track', { timeout: 30_000 });
    expect(site.hits).toEqual(['tracks/test-glow.ogg', 'tracks/test-glow.env']);
    expect(other, 'no other site').toEqual([]);
    expect(dialogs).toEqual([]);
  });

  test('F11. a track whose envelope file fails still comes in, without an envelope', async ({ page }) => {
    test.setTimeout(90_000);
    const site = await serveMusic(page);
    site.fail.add('tracks/test-glow.env');
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await sheet(page).getByTestId('free-add-instrumental').click();
    await expect(statusLine(page)).toContainText('Added 2 tracks', { timeout: 30_000 });
    await expect.poll(async () => { const c = await cacheCounts(page); return [c.meta, c.envScan]; }, { timeout: 15_000 }).toEqual([2, 1]);
    expect(dialogs).toEqual([]);
  });

  test('F13. review round 1 (L1): a free track deleted and added again is saved again (its fixed id), and is there after a reload', async ({ page }) => {
    test.setTimeout(150_000);
    await serveMusic(page);
    await seedList(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await sheet(page).getByTestId('free-choose').click();
    await sheet(page).getByRole('button', { name: 'Add Test Glow', exact: true }).click();
    await expect(statusLine(page)).toContainText('Added 1 track', { timeout: 30_000 });
    await expect.poll(async () => (await cacheCounts(page)).blobs, { timeout: 15_000 }).toBe(1);
    await page.keyboard.press('Escape');
    await openLibraryTab(page);
    await rowMenu(page, 'Test Glow').click();
    await page.getByTestId('library-menu-delete').click();
    await page.getByRole('alertdialog', { name: 'Delete this track?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => { const c = await cacheCounts(page); return [c.blobs, c.meta]; }, { timeout: 30_000 }).toEqual([0, 0]);
    await page.getByTestId('library-empty-free').click();
    await sheet(page).getByTestId('free-choose').click();
    await sheet(page).getByRole('button', { name: 'Add Test Glow', exact: true }).click();
    await expect(statusLine(page)).toContainText('Added 1 track', { timeout: 30_000 });
    await expect.poll(async () => { const c = await cacheCounts(page); return [c.blobs, c.meta]; }, { timeout: 15_000 }).toEqual([1, 1]);
    await page.waitForTimeout(2500);
    await page.reload();
    await expect.poll(async () => (await libraryState(page)).libraryIds, { timeout: 20_000 }).toEqual(['aetheria-test-glow']);
    expect((await cacheCounts(page)).blobs).toBe(1);
    expect(dialogs).toEqual([]);
  });

  test("F14. review round 1 (L2): a device that can't save the audio ends the add as failed, not \"Added\"", async ({ page }) => {
    test.setTimeout(120_000);
    await serveMusic(page);
    await seedList(page);
    await stubStorageFull(page);
    const dialogs = await openNewLayout(page);
    await phoneSize(page);
    await openFreePanel(page);
    await sheet(page).getByTestId('free-add-instrumental').click();
    await expect(statusLine(page)).toHaveText("2 of 2 tracks came in, but this device couldn't save them for offline use. Free some space, then add again.", { timeout: 60_000 });
    await expect(sheet(page).getByTestId('import-save-line'), "U1: the save's own warning shows in this view too").toBeVisible();
    expect(dialogs).toEqual([]);
  });
});

test('F15. review round 1 (L3): a Clear in the middle of an add ends it at once; nothing more goes in, and no "Added" line', async ({ page }) => {
  test.setTimeout(120_000);
  const site = await serveMusic(page);
  await seedList(page);
  const dialogs = await openApp(page);
  let release!: () => void;
  site.hold = new Promise<void>((r) => (release = r));
  site.holdPath = 'tracks/test-ember.ogg'; // the fifth: the first four come in as one batch, then the add waits on it
  const block = page.getByTestId('classic-free-music');
  await block.getByRole('button', { name: 'All 5: add 5 tracks', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 30_000 }).toBe(4);
  await expect(block.getByTestId('classic-free-progress')).toBeVisible();
  await page.getByRole('button', { name: 'Clear library and cache' }).click();
  await page.getByRole('button', { name: 'Confirm deleting all 4 tracks from this device' }).click();
  await expect(block.getByTestId('classic-free-progress'), 'the add ends with the Clear').toHaveCount(0, { timeout: 5_000 });
  site.hold = null;
  release();
  await page.waitForTimeout(1500);
  expect((await libraryState(page)).libraryIds).toEqual([]);
  await expect(page.getByText(/Added \d+ tracks? to your library/)).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('F16. the desktop panel: the toast reads the end line, the panel shows it without a voice; the focus goes to Back', async ({ page }) => {
  test.setTimeout(120_000);
  await serveMusic(page);
  await seedList(page);
  const dialogs = await openNewLayout(page);
  await openFreePanel(page);
  await expect(page.getByRole('region', { name: "Aetheria's music" }), 'the desktop panel, named for its view').toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Back to Import music', exact: true })).toBeFocused();
  await sheet(page).getByTestId('free-add-song').click();
  await expect(statusLine(page)).toContainText('Added 3 tracks', { timeout: 30_000 });
  await expect(sheet(page).getByTestId('free-status-end')).toHaveAttribute('aria-live', 'off');
  await expect(page.getByTestId('notices')).toContainText('Added 3 tracks to your library.');
  await expect(sheet(page).getByTestId('import-save'), 'no phone save line in the panel').toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('F10. classic: the three buttons add their groups; the line and Stop under them', async ({ page }) => {
  test.setTimeout(90_000);
  await serveMusic(page);
  await seedList(page);
  const dialogs = await openApp(page);
  const block = page.getByTestId('classic-free-music');
  await expect(block).toContainText("Aetheria's music");
  await expect(block).toContainText('5 free tracks to add');
  await block.getByRole('button', { name: 'Songs: add 3 tracks', exact: true }).click();
  // The end line is the toast's (classic hears it); the block's own line is the progress alone, with no live region.
  await expect(page.getByText('Added 3 tracks to your library. They\'re in "Aetheria · Songs" too.', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(block.getByTestId('classic-free-progress')).toHaveCount(0);
  await expect(block.locator('[role="status"], [aria-live]')).toHaveCount(0);
  expect((await libraryState(page)).libraryIds).toEqual(ids('song'));
  await expect(block.getByRole('button', { name: 'Songs: all in your library', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await block.getByRole('button', { name: 'All 5: add the other 2 tracks', exact: true }).click();
  await expect(page.getByText(/^Added 2 tracks to your library\./)).toBeVisible({ timeout: 30_000 });
  expect((await libraryState(page)).libraryIds.length).toBe(5);
  await expect(block).toContainText('5 free tracks · all in your library');
  expect(dialogs).toEqual([]);
});

test('F12. the shipped list (no test list): 222 tracks, 85 instrumentals and 137 songs, their sizes; nothing fetched', async ({ page }) => {
  test.setTimeout(90_000);
  const site = await serveMusic(page);
  const dialogs = await openNewLayout(page);
  await phoneSize(page);
  await openFreePanel(page);
  await expect(sheet(page).getByTestId('free-group-all')).toContainText(/^All 222 tracks222 tracks · 8\d\d MB · 1\d\.\d h/);
  await expect(sheet(page).getByTestId('free-group-instrumental')).toContainText('85 tracks · 3');
  await expect(sheet(page).getByTestId('free-group-song')).toContainText('137 tracks · 5');
  await sheet(page).getByTestId('free-choose').click();
  await expect(sheet(page).getByTestId('free-track')).toHaveCount(222);
  expect(site.hits).toEqual([]);
  expect(dialogs).toEqual([]);
});
