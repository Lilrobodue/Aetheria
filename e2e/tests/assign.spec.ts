import { type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, expect, ON_DEVICE, watchNativeDialogs } from './fixtures';
import {
  acceptDisclaimer,
  acceptDisclaimerNew,
  addFiles,
  confirmDelete,
  countConsole,
  libraryState,
  libraryRowButton,
  metaRecords,
  rowOf,
  openLibraryTab,
  openSeededNewLayout,
  pauseCount,
  peekClassicLibrary,
  phoneSize,
  savedState,
  toneWav,
  LAYER_ENGINE_KEY,
  LAYER_OUTPUT_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
  type LibraryState,
} from './helpers';
import { planAssign, assignConfirmText, assignDoneText, assignNothingText, crystalOrigin, scanCrystalChanged, scanCrystalOf, sourceTrack, spreadFromScan, ALL_CRYSTALS, SPREAD_MARK, SPREAD_ORDER } from '../../utils/mix/distribution.ts';
import type { AssignPlan } from '../../utils/mix/distribution.ts';
import { patchById } from '../../utils/library/listOps.ts';
import { GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS, SOURCE_FREQ } from '../../utils/crystalData.ts';
// v16.7.3: v16.7.1's spread, frozen (it builds "a library v16.7.1 already spread").
import { spreadV1671 } from '../../scripts/mix-golden/spread-v1671.ts';

// v15.8, Assign crystals (classic: Auto-Distribute Frequencies), decisions 2026-10-26: Deep Scan's crystals stay (one
// an older Auto-Distribute replaced is put back), every other track is placed the same way on every press, and placed
// tracks stay "not scanned" yet play at once. On FLEG, a v15.7 library replayed with v15.7's own code (Deep Scan, the
// old Auto-Distribute, later imports and scans; synthetic names, scripts/mix-golden/fixtures-fleg.json), seeded straight
// into IndexedDB with short tones. The expectation is utils/mix/distribution.ts's own plan, computed here in Node.
// v16.7.1 (the hotfix): every press spreads (planAssign(lib, 'spread'), v16.8's): every track, scanned ones too, over
// all 27 crystals; a scanned track moved off Deep Scan's crystal keeps its reading and counts as scanned.
// v16.7.3: a track Deep Scan placed on 2178 Hz (the SOURCE crystal) stays on 2178 (S2, S3 at the end). FLEG, BUNCHED and
// the fresh tones of tests 5 and A1 have no such track, so their expectations are v16.7.1's (each test says so in Node).

const FLEG: any[] = JSON.parse(readFileSync(new URL('../../scripts/mix-golden/fixtures-fleg.json', import.meta.url), 'utf8')).library;
/** FLEG as seeded: every length stored (no probe; a missing one as 200 s), so the app's stand-ins see the same. */
const SEEDED = FLEG.map(({ file, ...m }) => ({ ...m, duration: m.duration || 200 }));
const quietly = <T,>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };
const PLAN: AssignPlan = quietly(() => planAssign(SEEDED, 'spread'));
/** FLEG after the spread, as Node computes it: the origins and the stored crystalSource the page must show. */
const AFTER: any[] = patchById(SEEDED as never[], PLAN.patches as never) as any[];
const AFTER_ORIGINS = AFTER.map((s) => crystalOrigin(s)).reduce((m: Record<string, number>, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const AFTER_STORED = AFTER.map((s) => String(s.crystalSource)).reduce((m: Record<string, number>, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const AFTER_READ = AFTER.filter((s) => ['scan', 'scan-replaced'].includes(crystalOrigin(s)) || spreadFromScan(s)).length;
const crystalAfter = (id: string) => PLAN.patches.get(id)?.closestSolfeggio ?? SEEDED.find((s) => s.id === id)!.closestSolfeggio;
const tally = (xs: readonly string[]) => xs.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const ASSIGN = /^Auto-Distribute Frequencies/;

/** FLEG into this origin's IndexedDB, as an earlier session would have saved it (6 s tones). */
async function seedFleg(page: Page, library: any[] = SEEDED): Promise<void> {
  await page.goto('/manifest.json');
  await page.evaluate(async (lib) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['blobs', 'meta']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('playlist-state')) d.createObjectStore('playlist-state', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const rate = 8000, len = rate * 6, buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
    const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 330 * i) / rate) * 6000 * Math.min(1, i / 400, (len - i) / 400)), true);
    const tone = new Blob([buf], { type: 'audio/wav' });
    const put = (store: string, recs: any[]) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      for (const r of recs) tx.objectStore(store).put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await put('blobs', lib.map((s: any) => ({ id: s.id, fileBlob: tone, fileName: `${s.name}.wav`, fileType: 'audio/wav' })));
    await put('meta', lib);
    await put('playlist-state', [{ key: 'current', playlistOrder: lib.map((s: any) => s.id), originalOrder: lib.map((s: any) => s.id), currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 528, savedAt: Date.now() }]);
    db.close();
  }, library);
}

/** From the next load on: decodeAudioData calls (window.__decodes) and IndexedDB puts into 'meta' (window.__metaPuts). */
async function countDecodesAndMetaPuts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__decodes = 0;
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: unknown[]) { w.__decodes++; return (decode as any).apply(this, a); } as typeof decode;
    w.__metaPuts = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...a: unknown[]) { if (this.name === 'meta') w.__metaPuts++; return (put as any).apply(this, a); } as typeof put;
  });
}

/** FLEG seeded, then the app in `layout` (the classic engine: no output question), the library restored. */
async function openFleg(page: Page, layout: 'classic' | 'new', library: any[] = SEEDED): Promise<string[]> {
  const dialogs = watchNativeDialogs(page);
  await page.addInitScript(({ layout, keys }) => {
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      if (sessionStorage.getItem('__e2eFleg') === null) {
        sessionStorage.setItem('__e2eFleg', '1');
        localStorage.setItem(keys.engine, 'v2');
        localStorage.setItem(keys.output, 'headphones');
        if (layout === 'new') localStorage.setItem(keys.layout, 'new');
      }
    } catch {}
    const w = window as any;
    w.__pauseCount = 0;
    const pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) { w.__pauseCount++; return pause.call(this); };
  }, { layout, keys: { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY, layout: LAYOUT_KEY } });
  await seedFleg(page, library);
  await page.goto('/');
  if (layout === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'FLEG restores', timeout: 60_000 }).toBe(library.length);
  return dialogs;
}

/** crystalSource as stored in the meta records, tallied (undefined: not recorded). */
const storedSources = (page: Page) =>
  page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all: any[] = await new Promise((resolve) => { const r = db.transaction('meta', 'readonly').objectStore('meta').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close();
    return all.reduce((m: Record<string, number>, x) => ((m[String(x.crystalSource)] = (m[String(x.crystalSource)] ?? 0) + 1), m), {});
  });

const asPlanned = (s: LibraryState) => s.libraryIds.filter((id, i) => s.crystals[i] !== crystalAfter(id));

test.beforeEach(async ({ page, viewport }) => {
  if (ON_DEVICE && viewport) await page.setViewportSize(viewport);
});

test.describe('a legacy library (classic, and the new layout to play)', () => {
  test('1. Assign on a legacy library: every track spread over all 27 crystals as planned (v16.7.1), the notice; a second press writes nothing; a reload keeps the crystals and their origins', async ({ page }) => {
    test.setTimeout(240_000);
    await countDecodesAndMetaPuts(page);
    const dialogs = await openFleg(page, 'classic');
    const s0 = await libraryState(page);
    expect(tally(s0.origins), 'FLEG as its history left it').toEqual({ 'scan-replaced': 90, assigned: 110, scan: 10, none: 20 });
    expect(PLAN.spread, 'the plan moves scanned tracks off Deep Scan’s crystal').toBeGreaterThan(0);
    expect([SEEDED.filter(sourceTrack).length, PLAN.source], 'v16.7.3: FLEG has no track Deep Scan placed on 2178 Hz (v16.7.1’s placements)').toEqual([0, 0]);
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => tally((await libraryState(page)).origins), { message: 'after: as the spread says', timeout: 15_000 }).toEqual(AFTER_ORIGINS);
    const s1 = await libraryState(page);
    expect(asPlanned(s1), 'every crystal as planAssign says').toEqual([]);
    expect(ALL_CRYSTALS.filter((f) => !s1.crystals.includes(f)), 'every one of the 27 crystals has a track').toEqual([]);
    expect(s1.scanned.every(Boolean), 'every track playback-ready (harmonicFreq)').toBe(true);
    await expect(page.getByText(assignDoneText(PLAN), { exact: true }), 'the notice').toBeVisible();
    // The save settles (a debounced meta save), then a second press: nothing to do, nothing written.
    await expect.poll(() => storedSources(page), { message: 'the meta save', timeout: 15_000 }).toEqual(AFTER_STORED);
    await page.waitForTimeout(2500);
    const puts = await page.evaluate(() => (window as any).__metaPuts);
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect(page.getByText('Every track is already spread over all 27 crystals.', { exact: true })).toBeVisible();
    await page.waitForTimeout(3500);
    expect(await page.evaluate(() => (window as any).__metaPuts) - puts, 'no meta write after the second press').toBe(0);
    expect((await libraryState(page)).crystals, 'the crystals are the same').toEqual(s1.crystals);
    // A reload: the same crystals and origins (crystalSource stored where Assign wrote it).
    await page.reload();
    await acceptDisclaimer(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(FLEG.length);
    const s2 = await libraryState(page);
    expect([s2.crystals, tally(s2.origins)], 'after the reload').toEqual([s1.crystals, AFTER_ORIGINS]);
    // The restored tracks carry the field: the next save (a play rewrites every meta record) stores it again.
    const putsBefore = await page.evaluate(() => (window as any).__metaPuts);
    await page.locator('aside').getByText(s2.libraryNames[0], { exact: true }).first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__metaPuts), { message: 'a meta save after the reload', timeout: 15_000 }).toBeGreaterThan(putsBefore + 200);
    await expect.poll(() => storedSources(page), { message: 'and it keeps crystalSource', timeout: 15_000 }).toEqual(AFTER_STORED);
    expect(dialogs).toEqual([]);
  });

  test('2. an assigned track plays at once on its own crystal: no decode, the tone and the card on it; two gapless advances across assigned tracks without a pause()', async ({ page }) => {
    test.setTimeout(180_000);
    await countDecodesAndMetaPuts(page);
    // In the new layout: its Library search finds the row in a 230-track list, and a tap plays the library from it.
    const dialogs = await openFleg(page, 'new');
    await phoneSize(page);
    await openLibraryTab(page);
    // Three tracks in a row that had no crystal at all (later imports): Assign gives them theirs, and they must play
    // without a decode (an old placeholder already had a harmonicFreq, so it would prove nothing).
    const before = await libraryState(page);
    const i = before.origins.findIndex((o, k) => o === 'none' && before.origins[k + 1] === 'none' && before.origins[k + 2] === 'none');
    expect(i, 'three tracks without a crystal in a row').toBeGreaterThanOrEqual(0);
    expect(before.scanned.slice(i, i + 3), 'no harmonicFreq before Assign').toEqual([false, false, false]);
    await page.getByTestId('health-crystals-action').click();
    await page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true }).getByRole('button', { name: 'Assign', exact: true }).click();
    await expect.poll(async () => tally((await libraryState(page)).origins), { timeout: 15_000 }).toEqual(AFTER_ORIGINS);
    const s = await libraryState(page);
    expect(s.origins.slice(i, i + 3), 'now assigned').toEqual(['assigned', 'assigned', 'assigned']);
    const name = s.libraryNames[i];
    const d0 = await page.evaluate(() => (window as any).__decodes);
    await page.getByTestId('library-search').fill(name);
    await libraryRowButton(page, name).click();
    await expect.poll(async () => { const t = await libraryState(page); return t.current === name && t.playing; }, { message: `${name} plays`, timeout: 20_000 }).toBe(true);
    const crystal = s.crystals[i] as number;
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.album ?? null), { message: 'the card names its crystal' }).toMatch(new RegExp(`^${crystal}Hz • `));
    expect(await page.evaluate(() => (window as any).__decodes) - d0, 'no decode: the assigned crystal is playback-ready').toBe(0);
    await expect.poll(async () => (await savedState(page))?.selectedSolfeggio, { message: 'the tone is its crystal', timeout: 10_000 }).toBe(crystal);
    const pauses = await pauseCount(page);
    for (const k of [1, 2]) {
      await expect.poll(async () => (await libraryState(page)).current, { message: `gapless to the next assigned track (${k})`, timeout: 20_000 }).toBe(s.libraryNames[i + k]);
    }
    expect(await pauseCount(page) - pauses, 'the gapless swap never pauses').toBe(0);
    expect(await page.evaluate(() => (window as any).__decodes) - d0, 'still no decode').toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('3. classic’s Deep Scan after Assign scans the two new imports (no crystal) and stops: it never enters the assigned tracks (decision 6)', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openFleg(page, 'classic');
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => tally((await libraryState(page)).origins), { timeout: 15_000 }).toEqual(AFTER_ORIGINS);
    await addFiles(page, [{ name: 'later-1.wav', mimeType: 'audio/wav', buffer: toneWav(3, 300) }, { name: 'later-2.wav', mimeType: 'audio/wav', buffer: toneWav(3, 360) }]);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 20_000 }).toBe(FLEG.length + 2);
    const before = await libraryState(page);
    await page.locator('aside').getByRole('button', { name: /^Deep Scan/ }).click();
    await expect(page.getByText(/^Analyzing: later-1 \(1\/2\)$/), 'the two new imports, nothing else').toBeVisible({ timeout: 30_000 });
    // It stops after them: the button is idle again, and every assigned track is as it was.
    await expect(page.locator('aside').getByRole('button', { name: /^Deep Scan/ })).toHaveAttribute('title', 'Start Deep Scan (slow)', { timeout: 60_000 }); // v16.6 (F4)
    const after = await libraryState(page);
    const t2 = tally(after.origins);
    // v16.7.1: the spread's assigned tracks (130 placed, and the scanned ones it moved, their reading kept) untouched.
    expect([t2.assigned, (t2.scan ?? 0) + (t2['scan-failed'] ?? 0)], 'the assigned untouched; the 2 imports scanned').toEqual([AFTER_ORIGINS.assigned, AFTER_ORIGINS.scan + 2]);
    const assignedIds = before.libraryIds.filter((_, i) => before.origins[i] === 'assigned');
    expect(assignedIds.map((id) => after.crystals[after.libraryIds.indexOf(id)]), 'their crystals unchanged').toEqual(assignedIds.map((id) => before.crystals[before.libraryIds.indexOf(id)]));
    // Pressed again: nothing left in its scope, and it says why, without claiming the assigned tracks are scanned.
    await page.locator('aside').getByRole('button', { name: /^Deep Scan/ }).click();
    await expect(page.getByText("Every track without a crystal is scanned. 130 tracks have an assigned crystal, not a scan; the new layout's Library tab can scan them too.", { exact: true })).toBeVisible();
    expect(dialogs).toEqual([]);
  });
});

test.describe('phone, the new layout', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  const healthLine = (page: Page, id: string) => page.getByTestId(`health-${id}-line`);
  const healthAction = (page: Page, id: string) => page.getByTestId(`health-${id}-action`);
  /** Track info's Crystal note for a track (the search finds its row). */
  async function crystalNote(page: Page, name: string): Promise<string> {
    await page.getByTestId('library-search').fill(name);
    await page.getByRole('button', { name: `Options for ${name}`, exact: true }).click();
    await page.getByTestId('library-menu-info').click();
    const info = page.getByRole('dialog', { name: 'Track info', exact: true });
    const row = info.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Crystal$/ }) });
    const note = (await row.locator('dd span').textContent()) ?? '';
    await info.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(info).toHaveCount(0);
    await page.getByTestId('library-search').fill('');
    return note;
  }

  test('3b. the card’s Scan measures the no-crystal tracks and stops; its explicit "Also scan the N assigned tracks" queues them after (decision 6)', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = await openFleg(page, 'new');
    await phoneSize(page);
    await openLibraryTab(page);
    await expect(healthLine(page, 'scan')).toHaveText('Optional · 20 unscanned · about 50 min');
    await expect(healthLine(page, 'scan-assigned')).toHaveText('Also scan the 110 assigned tracks (about 4 h 35 min)');
    // (The new layout shows no per-track progress toast: the card's line and the end summary say it.)
    await healthAction(page, 'scan').click();
    await expect(page.getByTestId('notices'), 'it ends after the 20').toContainText('Processed: 20/20 files', { timeout: 120_000 });
    await expect.poll(async () => tally((await libraryState(page)).origins).none ?? 0, { timeout: 15_000 }).toBe(0);
    const s1 = await libraryState(page);
    expect(tally(s1.origins).assigned, 'the default scan entered no assigned track').toBe(110);
    await expect(healthLine(page, 'scan')).toHaveText(/^1\d\d of 230 scanned$/);
    await expect(healthAction(page, 'scan'), 'nothing left in its scope').toHaveCount(0);
    await expect(healthLine(page, 'scan-assigned')).toHaveText('Also scan the 110 assigned tracks (about 4 h 35 min)');
    // The explicit one queues the assigned tracks (the same pass, the same Stop).
    await healthAction(page, 'scan-assigned').click();
    await expect(healthLine(page, 'scan')).toHaveText(/^Scanning · \d+ %$/, { timeout: 15_000 });
    await expect(page.getByTestId('health-scan-assigned'), 'one scan line while it runs').toHaveCount(0);
    await expect.poll(async () => tally((await libraryState(page)).origins).assigned ?? 0, { message: 'it measures assigned tracks', timeout: 60_000 }).toBeLessThan(110);
    if (await healthLine(page, 'scan').textContent().then((x) => /^Scanning/.test(x ?? ''))) await healthAction(page, 'scan').click();
    await expect(healthLine(page, 'scan')).not.toHaveText(/^Scanning/, { timeout: 30_000 });
    expect(dialogs).toEqual([]);
  });

  test('4. the health card, Assign’s question and Track info on a legacy library: before and after', async ({ page }) => {
    test.setTimeout(240_000);
    const dialogs = await openFleg(page, 'new');
    await phoneSize(page);
    await openLibraryTab(page);
    await expect(healthLine(page, 'crystals')).toHaveText('20 of 230 tracks have none');
    await expect(healthLine(page, 'scan')).toHaveText('Optional · 20 unscanned · about 50 min');
    await expect(healthLine(page, 'scan-assigned')).toHaveText('Also scan the 110 assigned tracks (about 4 h 35 min)');
    // Track info: where each crystal comes from.
    const s0 = await libraryState(page);
    const nameOf = (o: string) => s0.libraryNames[s0.origins.indexOf(o)];
    // A crystal an older Auto-Distribute changed, and one it re-stored on Deep Scan's own crystal (fix 3: that one reads
    // "From Deep Scan", and the card counts only the first kind).
    const byName = (name: string) => SEEDED[s0.libraryNames.indexOf(name)];
    const replaced = s0.libraryNames.find((n, i) => s0.origins[i] === 'scan-replaced' && scanCrystalChanged(byName(n)))!;
    const reStored = s0.libraryNames.find((n, i) => s0.origins[i] === 'scan-replaced' && !scanCrystalChanged(byName(n)))!;
    expect(await crystalNote(page, nameOf('scan'))).toBe('From Deep Scan. An assigned crystal, not a measured pitch.');
    expect(await crystalNote(page, replaced)).toBe("Deep Scan's crystal was replaced by an older Auto-Distribute. An assigned crystal, not a measured pitch.");
    expect(await crystalNote(page, reStored), 'Deep Scan’s crystal, re-stored').toBe('From Deep Scan. An assigned crystal, not a measured pitch.');
    expect(await crystalNote(page, nameOf('assigned'))).toBe('Assigned, not scanned yet. An assigned crystal, not a measured pitch.');
    // Assign asks first (crystals tracks have would change), with the plan's counts; Cancel changes nothing.
    await healthAction(page, 'crystals').click();
    const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
    await expect(ask).toBeVisible();
    await expect(ask.getByTestId('dialog-body')).toHaveText(assignConfirmText(PLAN).body);
    await expect(ask.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel takes the first focus').toBeFocused();
    await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(ask).toHaveCount(0);
    await page.waitForTimeout(500);
    expect((await libraryState(page)).crystals, 'Cancel changes nothing').toEqual(s0.crystals);
    await healthAction(page, 'crystals').click();
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByTestId('notices'), 'the notice, as a toast').toContainText(assignDoneText(PLAN).slice(0, 80));
    await expect(healthLine(page, 'crystals')).toHaveText('All 230 tracks have one');
    await expect(healthLine(page, 'scan')).toHaveText('100 of 230 scanned');
    await expect(healthAction(page, 'scan'), 'nothing left in Scan’s default scope').toHaveCount(0);
    await expect(healthLine(page, 'scan-assigned')).toHaveText('Also scan the 130 assigned tracks (about 5 h 25 min)');
    expect(asPlanned(await libraryState(page)), 'every crystal as planned').toEqual([]);
    // v16.7.1: a scanned track the spread moved says so (and counts as scanned: "100 of 230 scanned" above).
    const spreadName = s0.libraryNames.find((_, k) => spreadFromScan(AFTER[k]))!;
    expect(AFTER_READ, 'Node: every measured track still read by Deep Scan').toBe(100);
    expect(await crystalNote(page, spreadName), 'a spread track').toBe("Spread by Assign crystals; Deep Scan's own reading is kept. An assigned crystal, not a measured pitch.");
    expect(dialogs).toEqual([]);
  });

  test('5. fewer than 27 tracks: Assign gives three tones three crystals, one in each range (v16.7.1: the spread’s order), without asking; then the card only informs (no Assign it couldn’t use)', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 3, { crystals: 'none' });
    await phoneSize(page);
    await openLibraryTab(page);
    await expect(healthLine(page, 'crystals')).toHaveText('3 of 3 tracks have none');
    await healthAction(page, 'crystals').click();
    await expect(page.getByTestId('assign-dialog'), 'no question: only new crystals').toHaveCount(0);
    await expect.poll(async () => [...(await libraryState(page)).crystals].sort((a, b) => (a ?? 0) - (b ?? 0)), { timeout: 10_000 }).toEqual([...SPREAD_ORDER.slice(0, 3)].sort((a, b) => a - b));
    expect((await libraryState(page)).origins).toEqual(['assigned', 'assigned', 'assigned']);
    await expect(healthLine(page, 'crystals')).toHaveText('All 3 tracks have one');
    await expect(page.getByTestId('health-crystals')).toContainText('24 crystals have no track.');
    await expect(healthAction(page, 'crystals'), 'no Assign: it has no track left to place there').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('a legacy library, after its first Assign', () => {
  test('6. v16.7.1: an import then Assign spreads again with the new track (every crystal keeps a track); a second press writes nothing', async ({ page }) => {
    test.setTimeout(240_000);
    await countDecodesAndMetaPuts(page);
    const dialogs = await openFleg(page, 'classic');
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => tally((await libraryState(page)).origins), { timeout: 15_000 }).toEqual(AFTER_ORIGINS);
    // +1 import, then Assign: the spread takes the new track in (v16.7.1: every press spreads every track); no question
    // in classic. (v15.8's "a delete then Assign writes nothing" was Keep's rule: a spread re-places the rest.)
    await addFiles(page, [{ name: 'later-x.wav', mimeType: 'audio/wav', buffer: toneWav(3, 300) }]);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 20_000 }).toBe(FLEG.length + 1);
    await page.waitForTimeout(3000); // the import's saves settle
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => { const s = await libraryState(page); return s.crystals[s.libraryNames.indexOf('later-x')]; }, { message: 'the new track gets a crystal', timeout: 15_000 }).toBeGreaterThan(0);
    const s2 = await libraryState(page);
    expect(ALL_CRYSTALS.filter((f) => !s2.crystals.includes(f)), 'every crystal still has a track').toEqual([]);
    await expect(page.getByText(/^Tracks spread over all 27 crystals: (.+, )?1 track got a crystal[,.]/)).toBeVisible();
    // A second press: nothing to do, nothing written, nothing moves.
    await page.waitForTimeout(3500); // the Assign's saves settle
    const puts = await page.evaluate(() => (window as any).__metaPuts);
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect(page.getByText('Every track is already spread over all 27 crystals.', { exact: true })).toBeVisible();
    await page.waitForTimeout(3500);
    expect(await page.evaluate(() => (window as any).__metaPuts) - puts, 'no meta write').toBe(0);
    expect((await libraryState(page)).crystals, 'nothing moved').toEqual(s2.crystals);
    expect(dialogs).toEqual([]);
  });

  test('7. classic’s words don’t fake a scan: Library diagnostics count Deep Scan’s measurements (spread tracks too), the Quick guide and the Guidebook say what Assign does', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openFleg(page, 'classic');
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => tally((await libraryState(page)).origins), { timeout: 15_000 }).toEqual(AFTER_ORIGINS);
    await page.getByRole('button', { name: /^Library\s*Diagnostics/ }).click();
    const readout = page.getByRole('dialog', { name: 'Library diagnostics', exact: true });
    // v16.7.1 (from v16.8): a spread track (its reading kept) is analysed, not assigned.
    await expect(readout).toContainText('Analyzed tracks: 100');
    await expect(readout).toContainText('Unanalyzed tracks: 130 (130 with an assigned crystal)');
    await expect(readout, 'Deep Scan has nothing in its scope: no "Scan N remaining"').not.toContainText('remaining tracks');
    await readout.getByRole('button', { name: 'Close', exact: true }).click();
    // The Quick guide's Auto-Distribute line (its second page).
    await page.getByRole('button', { name: 'Quick guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome to Aetheria' }).waitFor();
    await expect.poll(async () => { if (await page.getByRole('heading', { name: '2. Scan & Distribute' }).isVisible()) return true; await page.getByRole('button', { name: 'Next', exact: true }).click(); return false; }, { message: 'the Quick guide’s second page', timeout: 10_000 }).toBe(true);
    // v16.7.3: and the tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.
    await expect(page.getByText("Spreads every song, scanned ones too, over the 27 crystals across the GUT, HEART, and HEAD ranges in turn. Deep Scan's own reading stays with each scanned song. Songs Deep Scan placed on 2178 Hz keep the SOURCE crystal.")).toBeVisible();
    await expect(page.getByText('Assigns every song to its closest Aetheria frequency')).toHaveCount(0);
    await page.getByText('Quick Guide', { exact: true }).locator('xpath=..').getByRole('button').first().click();
    // The Guidebook's quick start.
    await page.getByRole('button', { name: /The Guidebook/ }).click();
    await expect(page.getByText('every song, scanned ones too, is spread over the 27 Aetheria frequencies across the GUT, HEART and HEAD ranges; songs Deep Scan placed on 2178 Hz keep the SOURCE crystal')).toHaveCount(1);
    await expect(page.getByText('songs Deep Scan scanned keep their crystal')).toHaveCount(0);
    await expect(page.getByText('the player analyzes your music and assigns each song to its closest Aetheria frequency')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// v16.3 (A1): Assign asks getHarmonicSolfeggio quietly (the plan's "Map" item was v15.8's; the per-track console lines
// are the rest of the original note). The plan is the same; only the logging goes.
// ---------------------------------------------------------------------------------------------------------------
test.describe('v16.3, Assign without the per-track console lines', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  test('A1. a first Assign of 60 fresh tones writes no "Analyzing frequency" line, and the page applies planAssign’s plan', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 60, { crystals: 'none' });
    await phoneSize(page);
    const before = await libraryState(page);
    const records = await metaRecords(page);
    const songs = before.libraryIds.map((id) => {
      const m = records.find((r) => r.id === id)!;
      return { id: m.id, name: m.name, duration: m.duration ?? undefined } as any;
    });
    const plan = quietly(() => planAssign(songs, 'spread'));
    expect(plan.patches.size, 'every tone gets a crystal').toBe(60);
    const lines = countConsole(page, 'Analyzing frequency');
    const anyLog = countConsole(page, '');
    await openLibraryTab(page);
    await page.getByTestId('health-crystals-action').click();
    await expect.poll(async () => (await libraryState(page)).crystals.every((c) => c !== null), { message: 'every tone has a crystal', timeout: 15_000 }).toBe(true);
    const after = await libraryState(page);
    expect(after.crystals, 'the plan the page applied is planAssign’s').toEqual(after.libraryIds.map((id) => plan.patches.get(id)?.closestSolfeggio ?? null));
    await page.waitForTimeout(500);
    expect(lines(), 'no "Analyzing frequency" line').toBe(0);
    test.info().annotations.push({ type: 'console lines during the Assign (all kinds)', description: String(anyLog()) });
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// v16.7.1 (the hotfix): "we do need auto distribute working like it did". A library Deep Scan read in full, bunched on
// three GUT crystals (HEART and HEAD empty): classic's Auto-Distribute spreads it over all 27 crystals and the three
// ranges, as planAssign(lib, 'spread') says, and a reload (after the stored meta has it) keeps it.
// ---------------------------------------------------------------------------------------------------------------
const BUNCH = [174, 396, 528];
const BUNCHED: any[] = Array.from({ length: 36 }, (_, i) => {
  const hf = BUNCH[i % 3] + 1.5 + (i % 4) * 0.25; // a reading near its crystal (Deep Scan's crystal is scanCrystalOf it)
  const cc = quietly(() => scanCrystalOf(hf));
  return { id: `1771700000000-b${String(i).padStart(2, '0')}`, name: `tone-${String(i + 1).padStart(2, '0')}`, duration: 200, harmonicFreq: hf, closestSolfeggio: cc, harmonicDeviation: Math.abs(hf - cc), crystalSource: 'scan', isAetheriaCandidate: false };
});
const BUNCHED_PLAN: AssignPlan = quietly(() => planAssign(BUNCHED, 'spread'));
const rangesOf = (crystals: readonly (number | null)[]) => (['GUT', 'HEART', 'HEAD'] as const).filter((r, k) => [GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS][k].some((f) => crystals.includes(f)));

test.describe('v16.7.1, Auto-Distribute after a full Deep Scan', () => {
  test('S1. a fully scanned library bunched on 3 GUT crystals: Auto-Distribute spreads it so every one of the 27 crystals and all 3 ranges have tracks; Deep Scan’s readings kept; a reload keeps it', async ({ page }) => {
    test.setTimeout(180_000);
    expect(new Set(BUNCHED.map((s) => s.closestSolfeggio)).size, 'Node: the fixture bunches on 3 crystals').toBe(3);
    expect(BUNCHED_PLAN.source, 'v16.7.3: no reading at 2178 Hz (v16.7.1’s plan)').toBe(0);
    const dialogs = await openFleg(page, 'classic', BUNCHED);
    const s0 = await libraryState(page);
    expect([new Set(s0.crystals).size, rangesOf(s0.crystals), tally(s0.origins)], 'before: 3 crystals, the GUT range only, every track scanned').toEqual([3, ['GUT'], { scan: 36 }]);
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => { const c = (await libraryState(page)).crystals; return ALL_CRYSTALS.filter((f) => !c.includes(f)).length; }, { message: 'every one of the 27 crystals has a track', timeout: 15_000 }).toBe(0);
    const s1 = await libraryState(page);
    expect(rangesOf(s1.crystals), 'all 3 ranges have tracks').toEqual(['GUT', 'HEART', 'HEAD']);
    expect(s1.crystals, 'as planAssign(lib, "spread") says').toEqual(s1.libraryIds.map((id) => BUNCHED_PLAN.patches.get(id)?.closestSolfeggio ?? BUNCHED.find((s) => s.id === id)!.closestSolfeggio));
    await expect(page.getByText(assignDoneText(BUNCHED_PLAN), { exact: true }), 'the notice').toBeVisible();
    expect(assignDoneText(BUNCHED_PLAN)).toMatch(/^Tracks spread over all 27 crystals: \d+ scanned tracks moved off Deep Scan's crystal\. Every crystal has a track/);
    // The stored meta has it (the debounced save), each track's reading kept, before the reload.
    const want = new Map(s1.libraryIds.map((id, i) => [id, s1.crystals[i]]));
    await expect.poll(async () => (await metaRecords(page)).filter((m) => m.closestSolfeggio !== want.get(m.id)).length, { message: 'the meta save', timeout: 20_000 }).toBe(0);
    const stored = await metaRecords(page);
    expect(stored.map((m) => m.harmonicFreq), "Deep Scan's readings kept").toEqual(stored.map((m) => BUNCHED.find((s) => s.id === m.id)!.harmonicFreq));
    await page.reload();
    await acceptDisclaimer(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(BUNCHED.length);
    const s2 = await libraryState(page);
    expect([s2.libraryIds, s2.crystals], 'after the reload: the same crystals').toEqual([s1.libraryIds, s1.crystals]);
    expect([ALL_CRYSTALS.filter((f) => !s2.crystals.includes(f)), rangesOf(s2.crystals)], 'after the reload: all 27, all 3 ranges').toEqual([[], ['GUT', 'HEART', 'HEAD']]);
    // Classic's diagnostics still count all 36 as read by Deep Scan (a spread track keeps its reading).
    await page.getByRole('button', { name: /^Library\s*Diagnostics/ }).click();
    const readout = page.getByRole('dialog', { name: 'Library diagnostics', exact: true });
    await expect(readout).toContainText('Analyzed tracks: 36');
    await expect(readout).toContainText('Unanalyzed tracks: 0');
    await readout.getByRole('button', { name: 'Close', exact: true }).click();
    expect(dialogs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// v16.7.3 (the user's decision 2026-11-04): "i hoped that source tracks would not get displaced if they were scanned at
// 2178 hz originally". A track Deep Scan placed on 2178 Hz (the SOURCE crystal: a reading scanCrystalOf maps to 2178)
// stays on 2178, recorded as the scan's, when Auto-Distribute spreads; it counts toward 2178's share; one v16.7.1's
// spread moved off it goes back on the next press. sourced(prefix): BUNCHED's 36 readings and 4 placed on 2178 Hz, every
// track scanned, with ids of its own per test (fix round 1, F4.3: S2's and S3's libraries never share an id, so a stale
// tab of one can't stand in for the other). V1671: S3's library as v16.7.1's own spread left it (the frozen copy): every
// crystal covered, Source tracks away.
// ---------------------------------------------------------------------------------------------------------------
const SOURCE_READINGS = [2180.5, 2179.25, 2182, 2177.25];
const sourced = (prefix: string): any[] => {
  const list: any[] = BUNCHED.map((s, i) => ({ ...s, id: `${prefix}-b${String(i).padStart(2, '0')}` }));
  SOURCE_READINGS.forEach((hf, k) => list.splice(4 + k * 9, 0, { id: `${prefix}-s${k}`, duration: 200, harmonicFreq: hf, closestSolfeggio: SOURCE_FREQ, harmonicDeviation: Math.abs(hf - SOURCE_FREQ), crystalSource: 'scan', isAetheriaCandidate: false }));
  return list.map((s, i) => ({ ...s, name: `tone-${String(i + 1).padStart(2, '0')}` }));
};
const SOURCED: any[] = sourced('1771800000000');
const SOURCED_PLAN: AssignPlan = quietly(() => planAssign(SOURCED, 'spread'));
const S3_LIB: any[] = sourced('1771900000000');
const S3_FIRST: AssignPlan = quietly(() => planAssign(S3_LIB, 'spread'));
const V1671: any[] = patchById(S3_LIB as never[], quietly(() => spreadV1671(S3_LIB)).patches as never) as any[];
const V1671_AWAY: any[] = V1671.filter((s) => sourceTrack(s) && s.closestSolfeggio !== SOURCE_FREQ);
const V1671_PLAN: AssignPlan = quietly(() => planAssign(V1671, 'spread'));
const AT = ALL_CRYSTALS.indexOf(SOURCE_FREQ);
const sourceIdsOf = (lib: any[]): string[] => lib.filter((s) => sourceTrack(s)).map((s) => s.id);
/** Each Source track's crystal and origin, as the page has them. */
const sourceState = (s: LibraryState, lib: any[]) => sourceIdsOf(lib).map((id) => [s.crystals[s.libraryIds.indexOf(id)], s.origins[s.libraryIds.indexOf(id)]]);
const ON_2178 = SOURCE_READINGS.map(() => [SOURCE_FREQ, 'scan']);
/** The stored meta's crystal fields, by id. */
const storedCrystals = (page: Page) =>
  page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all: any[] = await new Promise((resolve) => { const r = db.transaction('meta', 'readonly').objectStore('meta').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close();
    return Object.fromEntries(all.map((m) => [m.id, [m.closestSolfeggio ?? null, m.crystalSource ?? null, m.harmonicFreq ?? null, m.harmonicDeviation ?? null]]));
  });
/** What the stored meta must hold after `plan` on `lib`. */
const wantStored = (lib: any[], plan: AssignPlan) =>
  Object.fromEntries(lib.map((s) => { const p = { ...s, ...(plan.patches.get(s.id) ?? {}) }; return [s.id, [p.closestSolfeggio ?? null, p.crystalSource ?? null, p.harmonicFreq ?? null, p.harmonicDeviation ?? null]]; }));

test.describe('v16.7.3, Source tracks keep 2178 Hz', () => {
  test('S2. a fully scanned library with 4 tracks Deep Scan placed on 2178 Hz: classic’s Auto-Distribute spreads the rest over every crystal and keeps the 4 on 2178 as Deep Scan’s (2178 holds max(Source, share)); the stored meta has it; a reload keeps the ids and the crystals', async ({ page }) => {
    test.setTimeout(180_000);
    // Node: 4 Source tracks, already on 2178 (nothing to put back); 2178 keeps them and gets no other (share 2).
    expect([sourceIdsOf(SOURCED).length, SOURCED.length, SOURCED_PLAN.source, SOURCED_PLAN.restored], 'Node: the fixture').toEqual([4, 40, 4, 0]);
    expect(SOURCED.some((s) => S3_LIB.some((x) => x.id === s.id)), 'Node: S2 and S3 share no id').toBe(false);
    const share = Math.ceil(SOURCED.length / 27);
    expect(SOURCED_PLAN.perCrystal[AT], 'Node: 2178 holds max(Source, share)').toBe(Math.max(4, share));
    const dialogs = await openFleg(page, 'classic', SOURCED);
    const s0 = await libraryState(page);
    expect([[...new Set(s0.crystals)].sort((a, b) => (a ?? 0) - (b ?? 0)), tally(s0.origins)], 'before: 3 GUT crystals and 2178, every track scanned').toEqual([[174, 396, 528, SOURCE_FREQ], { scan: 40 }]);
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => { const c = (await libraryState(page)).crystals; return ALL_CRYSTALS.filter((f) => !c.includes(f)).length; }, { message: 'every one of the 27 crystals has a track', timeout: 15_000 }).toBe(0);
    const s1 = await libraryState(page);
    expect(s1.crystals, 'as planAssign(lib, "spread") says').toEqual(s1.libraryIds.map((id) => SOURCED_PLAN.patches.get(id)?.closestSolfeggio ?? SOURCED.find((s) => s.id === id)!.closestSolfeggio));
    expect(sourceState(s1, SOURCED), 'the 4 placed on 2178 Hz: on 2178, Deep Scan’s').toEqual(ON_2178);
    expect(s1.crystals.filter((c) => c === SOURCE_FREQ).length, '2178 holds max(Source, share): no other track joins them').toBe(Math.max(4, share));
    expect(rangesOf(s1.crystals), 'all 3 ranges').toEqual(['GUT', 'HEART', 'HEAD']);
    await expect(page.getByText(assignDoneText(SOURCED_PLAN), { exact: true }), 'the notice').toBeVisible();
    expect(assignDoneText(SOURCED_PLAN)).toMatch(/^Tracks spread over all 27 crystals: \d+ scanned tracks moved off Deep Scan's crystal\. .* Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal\.$/);
    // The stored meta has it (the debounced save): the crystals, crystalSource 'scan' on the 4, every reading kept.
    const want = wantStored(SOURCED, SOURCED_PLAN);
    await expect.poll(async () => { const got = await storedCrystals(page); return SOURCED.filter((s) => JSON.stringify(got[s.id]) !== JSON.stringify(want[s.id])).length; }, { message: 'the meta save', timeout: 20_000 }).toBe(0);
    const stored = await storedCrystals(page);
    expect(sourceIdsOf(SOURCED).map((id) => stored[id].slice(0, 3)), 'stored: on 2178, the scan’s, the reading kept').toEqual(sourceIdsOf(SOURCED).map((id) => [SOURCE_FREQ, 'scan', SOURCED.find((s) => s.id === id)!.harmonicFreq]));
    await page.reload();
    await acceptDisclaimer(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(SOURCED.length);
    const s2 = await libraryState(page);
    expect([s2.libraryIds, s2.crystals], 'after the reload: the same ids and crystals').toEqual([s1.libraryIds, s1.crystals]);
    expect(sourceState(s2, SOURCED), 'after the reload: the 4 on 2178, Deep Scan’s').toEqual(ON_2178);
    expect(dialogs).toEqual([]);
  });
});

test.describe('v16.7.3, phone, the new layout: a library v16.7.1 already spread', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  const healthLine = (page: Page, id: string) => page.getByTestId(`health-${id}-line`);
  const healthAction = (page: Page, id: string) => page.getByTestId(`health-${id}-action`);

  test('S3. Source tracks v16.7.1’s spread moved off 2178: the health card offers Assign (v16.7.2’s said “All 40 tracks have one”), the confirmation says they go back, then they are on 2178 as Deep Scan’s and the rest re-spread; a reload keeps it; a second press writes nothing', async ({ page }) => {
    test.setTimeout(240_000);
    // Node: v16.7.1's own spread moved Source tracks off 2178 (Assign's, the reading kept, the mark) and covered every
    // crystal, so v16.7.2's health card had nothing to offer.
    const k = V1671_AWAY.length;
    expect(k, 'Node: v16.7.1 moved Source tracks off 2178').toBeGreaterThan(0);
    expect(V1671_AWAY.every((s) => spreadFromScan(s) && s.crystalSource === 'assigned' && s.harmonicDeviation >= SPREAD_MARK && S3_LIB.find((x) => x.id === s.id)!.harmonicFreq === s.harmonicFreq), 'Node: as v16.7.1 marks them').toBe(true);
    expect(ALL_CRYSTALS.filter((f) => !V1671.some((s) => s.closestSolfeggio === f)), 'Node: every crystal covered').toEqual([]);
    expect([V1671_PLAN.restored, V1671_PLAN.source], 'Node: the press puts them back').toEqual([k, 4]);
    await countDecodesAndMetaPuts(page);
    const dialogs = await openFleg(page, 'new', V1671);
    await phoneSize(page);
    await openLibraryTab(page);
    expect(sourceState(await libraryState(page), S3_LIB).filter(([c]) => c !== SOURCE_FREQ).length, 'seeded: away from 2178').toBe(k);
    await expect(healthLine(page, 'crystals')).toHaveText(`All 40 have one · ${k} can go back to 2178 Hz, the crystal Deep Scan gave ${k === 1 ? 'it' : 'them'}`);
    await expect(healthAction(page, 'crystals')).toHaveText('Assign');
    // Assign asks first (crystals tracks have change), and says they go back, first.
    await healthAction(page, 'crystals').click();
    const ask = page.getByRole('alertdialog', { name: 'Assign crystals?', exact: true });
    await expect(ask.getByTestId('dialog-body')).toHaveText(assignConfirmText(V1671_PLAN).body);
    expect(assignConfirmText(V1671_PLAN).body, 'the words').toMatch(new RegExp(`^${k} ${k === 1 ? 'track Deep Scan placed on 2178 Hz goes' : 'tracks Deep Scan placed on 2178 Hz go'} back to the SOURCE crystal\\. Every other track is spread over all 27 crystals, `));
    await ask.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect.poll(async () => sourceState(await libraryState(page), S3_LIB), { message: 'back on 2178, Deep Scan’s', timeout: 15_000 }).toEqual(ON_2178);
    const s1 = await libraryState(page);
    expect(s1.crystals, 'as planAssign(lib, "spread") says (the rest re-spread around them)').toEqual(s1.libraryIds.map((id) => V1671_PLAN.patches.get(id)?.closestSolfeggio ?? V1671.find((s) => s.id === id)!.closestSolfeggio));
    expect(s1.crystals, 'the same crystals as a first v16.7.3 press on the library itself').toEqual(s1.libraryIds.map((id) => S3_FIRST.patches.get(id)?.closestSolfeggio ?? S3_LIB.find((s) => s.id === id)!.closestSolfeggio));
    expect(ALL_CRYSTALS.filter((f) => !s1.crystals.includes(f)), 'every crystal still has a track').toEqual([]);
    // The notice (a toast here), in full: "N tracks back on 2178 Hz" in its parts and the closing SOURCE sentence.
    const done = assignDoneText(V1671_PLAN);
    expect(done, 'Node: the notice').toMatch(new RegExp(`(: |, )${k} ${k === 1 ? 'track' : 'tracks'} back on 2178 Hz[,.] .* Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal\\.$`));
    await expect(page.getByTestId('notices'), 'the notice, as a toast').toContainText(done);
    await expect(healthLine(page, 'crystals')).toHaveText('All 40 tracks have one');
    await expect(healthAction(page, 'crystals'), 'nothing left to offer').toHaveCount(0);
    const want = wantStored(V1671, V1671_PLAN);
    await expect.poll(async () => { const got = await storedCrystals(page); return V1671.filter((s) => JSON.stringify(got[s.id]) !== JSON.stringify(want[s.id])).length; }, { message: 'the meta save', timeout: 20_000 }).toBe(0);
    // A reload keeps it.
    await page.reload();
    await acceptDisclaimerNew(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(V1671.length);
    const s2 = await libraryState(page);
    expect([s2.libraryIds, s2.crystals], 'after the reload: the same ids and crystals').toEqual([s1.libraryIds, s1.crystals]);
    expect(sourceState(s2, S3_LIB), 'after the reload: on 2178, Deep Scan’s').toEqual(ON_2178);
    // A second press (Auto-Distribute itself, through the classic peek: the card offers none): nothing to do, nothing written.
    // The count is taken once the restore's own rewrite has landed: a few seconds after a reload the app rewrites every
    // meta record by itself (a probe saw 0 puts 2 s after the peek, then all 40 by 5 s, with no press). So: until that
    // rewrite has written every record (puts ≥ the library's size), then until 4 s pass with no write; at most 60 s (it
    // runs on the phone too).
    await peekClassicLibrary(page);
    const metaPuts = () => page.evaluate(() => (window as any).__metaPuts as number);
    const t0 = Date.now();
    await expect.poll(metaPuts, { message: 'the restore’s own rewrite of every record', timeout: 60_000 }).toBeGreaterThanOrEqual(V1671.length);
    let puts = await metaPuts();
    while (Date.now() - t0 < 60_000) {
      await page.waitForTimeout(4000);
      const now = await metaPuts();
      if (now === puts) break;
      puts = now;
    }
    expect(Date.now() - t0, 'the saves settled within 60 s').toBeLessThan(60_000);
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect(page.getByText('Every track is already spread over all 27 crystals.', { exact: true })).toBeVisible();
    await page.waitForTimeout(3500);
    expect(await metaPuts() - puts, 'no meta write after the second press').toBe(0);
    expect((await libraryState(page)).crystals, 'nothing moved').toEqual(s1.crystals);
    expect(dialogs).toEqual([]);
  });
});
