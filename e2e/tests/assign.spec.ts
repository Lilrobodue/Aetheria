import { type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, expect, ON_DEVICE, watchNativeDialogs } from './fixtures';
import {
  acceptDisclaimer,
  acceptDisclaimerNew,
  addFiles,
  confirmDelete,
  libraryState,
  libraryRowButton,
  rowOf,
  openLibraryTab,
  openSeededNewLayout,
  pauseCount,
  phoneSize,
  savedState,
  toneWav,
  LAYER_ENGINE_KEY,
  LAYER_OUTPUT_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
  type LibraryState,
} from './helpers';
import { planAssign, assignConfirmText, assignDoneText, assignNothingText, scanCrystalChanged } from '../../utils/mix/distribution.ts';
import type { AssignPlan } from '../../utils/mix/distribution.ts';

// v15.8, Assign crystals (classic: Auto-Distribute Frequencies), decisions 2026-10-26: Deep Scan's crystals stay (one
// an older Auto-Distribute replaced is put back), every other track is placed the same way on every press, and placed
// tracks stay "not scanned" yet play at once. On FLEG, a v15.7 library replayed with v15.7's own code (Deep Scan, the
// old Auto-Distribute, later imports and scans; synthetic names, scripts/mix-golden/fixtures-fleg.json), seeded straight
// into IndexedDB with short tones. The expectation is utils/mix/distribution.ts's own plan, computed here in Node.

const FLEG: any[] = JSON.parse(readFileSync(new URL('../../scripts/mix-golden/fixtures-fleg.json', import.meta.url), 'utf8')).library;
/** FLEG as seeded: every length stored (no probe; a missing one as 200 s), so the app's stand-ins see the same. */
const SEEDED = FLEG.map(({ file, ...m }) => ({ ...m, duration: m.duration || 200 }));
const quietly = <T,>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };
const PLAN: AssignPlan = quietly(() => planAssign(SEEDED));
const crystalAfter = (id: string) => PLAN.patches.get(id)?.closestSolfeggio ?? SEEDED.find((s) => s.id === id)!.closestSolfeggio;
const tally = (xs: readonly string[]) => xs.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const ASSIGN = /^Auto-Distribute Frequencies/;

/** FLEG into this origin's IndexedDB, as an earlier session would have saved it (6 s tones). */
async function seedFleg(page: Page): Promise<void> {
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
  }, SEEDED);
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
async function openFleg(page: Page, layout: 'classic' | 'new'): Promise<string[]> {
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
  await seedFleg(page);
  await page.goto('/');
  if (layout === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'FLEG restores', timeout: 60_000 }).toBe(FLEG.length);
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
  test('1. Assign on a legacy library: Deep Scan’s crystals kept or put back, every other track placed as planned, the notice; a second press writes nothing; a reload keeps the crystals and their origins', async ({ page }) => {
    test.setTimeout(240_000);
    await countDecodesAndMetaPuts(page);
    const dialogs = await openFleg(page, 'classic');
    const s0 = await libraryState(page);
    expect(tally(s0.origins), 'FLEG as its history left it').toEqual({ 'scan-replaced': 90, assigned: 110, scan: 10, none: 20 });
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => tally((await libraryState(page)).origins), { message: 'after: 100 scan, 130 assigned', timeout: 15_000 }).toEqual({ scan: 100, assigned: 130 });
    const s1 = await libraryState(page);
    expect(asPlanned(s1), 'every crystal as planAssign says').toEqual([]);
    expect(s1.scanned.every(Boolean), 'every track playback-ready (harmonicFreq)').toBe(true);
    await expect(page.getByText(assignDoneText(PLAN), { exact: true }), 'the notice').toBeVisible();
    // The save settles (a debounced meta save), then a second press: nothing to do, nothing written.
    await expect.poll(() => storedSources(page), { message: 'the meta save', timeout: 15_000 }).toEqual({ assigned: 130, scan: 90, undefined: 10 });
    await page.waitForTimeout(2500);
    const puts = await page.evaluate(() => (window as any).__metaPuts);
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect(page.getByText('Every track already has its crystal (100 from Deep Scan, 130 assigned).', { exact: true })).toBeVisible();
    await page.waitForTimeout(3500);
    expect(await page.evaluate(() => (window as any).__metaPuts) - puts, 'no meta write after the second press').toBe(0);
    expect((await libraryState(page)).crystals, 'the crystals are the same').toEqual(s1.crystals);
    // A reload: the same crystals and origins (crystalSource stored where Assign wrote it, derived for the 10 untouched).
    await page.reload();
    await acceptDisclaimer(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(FLEG.length);
    const s2 = await libraryState(page);
    expect([s2.crystals, tally(s2.origins)], 'after the reload').toEqual([s1.crystals, { scan: 100, assigned: 130 }]);
    // The restored tracks carry the field: the next save (a play rewrites every meta record) stores it again.
    const putsBefore = await page.evaluate(() => (window as any).__metaPuts);
    await page.locator('aside').getByText(s2.libraryNames[0], { exact: true }).first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__metaPuts), { message: 'a meta save after the reload', timeout: 15_000 }).toBeGreaterThan(putsBefore + 200);
    await expect.poll(() => storedSources(page), { message: 'and it keeps crystalSource', timeout: 15_000 }).toEqual({ assigned: 130, scan: 90, undefined: 10 });
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
    await expect.poll(async () => tally((await libraryState(page)).origins), { timeout: 15_000 }).toEqual({ scan: 100, assigned: 130 });
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
    await expect.poll(async () => tally((await libraryState(page)).origins), { timeout: 15_000 }).toEqual({ scan: 100, assigned: 130 });
    await addFiles(page, [{ name: 'later-1.wav', mimeType: 'audio/wav', buffer: toneWav(3, 300) }, { name: 'later-2.wav', mimeType: 'audio/wav', buffer: toneWav(3, 360) }]);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 20_000 }).toBe(FLEG.length + 2);
    const before = await libraryState(page);
    await page.locator('aside').getByRole('button', { name: /^Deep Scan/ }).click();
    await expect(page.getByText(/^Analyzing: later-1 \(1\/2\)$/), 'the two new imports, nothing else').toBeVisible({ timeout: 30_000 });
    // It stops after them: the button is idle again, and every assigned track is as it was.
    await expect(page.locator('aside').getByRole('button', { name: /^Deep Scan/ })).toHaveAttribute('title', 'Start deep fractal analysis (slow but thorough)', { timeout: 60_000 });
    const after = await libraryState(page);
    const t2 = tally(after.origins);
    expect([t2.assigned, (t2.scan ?? 0) + (t2['scan-failed'] ?? 0)], 'the 130 assigned untouched; the 2 imports scanned').toEqual([130, 102]);
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
    expect(await crystalNote(page, replaced)).toBe("Deep Scan's crystal was replaced by an older Auto-Distribute; Assign crystals puts it back. An assigned crystal, not a measured pitch.");
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
    expect(await crystalNote(page, replaced), 'the put-back crystal is Deep Scan’s again').toBe('From Deep Scan. An assigned crystal, not a measured pitch.');
    expect(dialogs).toEqual([]);
  });

  test('5. fewer than 27 tracks: Assign gives three tones three crystals, the lowest empty ones, without asking; then the card only informs (no Assign it couldn’t use)', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await openSeededNewLayout(page, 3, { crystals: 'none' });
    await phoneSize(page);
    await openLibraryTab(page);
    await expect(healthLine(page, 'crystals')).toHaveText('3 of 3 tracks have none');
    await healthAction(page, 'crystals').click();
    await expect(page.getByTestId('assign-dialog'), 'no question: only new crystals').toHaveCount(0);
    await expect.poll(async () => [...(await libraryState(page)).crystals].sort((a, b) => (a ?? 0) - (b ?? 0)), { timeout: 10_000 }).toEqual([174, 285, 396]);
    expect((await libraryState(page)).origins).toEqual(['assigned', 'assigned', 'assigned']);
    await expect(healthLine(page, 'crystals')).toHaveText('All 3 tracks have one');
    await expect(page.getByTestId('health-crystals')).toContainText('24 crystals have no track.');
    await expect(healthAction(page, 'crystals'), 'no Assign: it has no track left to place there').toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('a legacy library, after its first Assign', () => {
  test('6. decision 5: an import then Assign places only the new track (0 existing crystals move); a delete then Assign writes nothing', async ({ page }) => {
    test.setTimeout(240_000);
    await countDecodesAndMetaPuts(page);
    const dialogs = await openFleg(page, 'classic');
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => tally((await libraryState(page)).origins), { timeout: 15_000 }).toEqual({ scan: 100, assigned: 130 });
    const s1 = await libraryState(page);
    // +1 import, then Assign: only the new track is placed; no question in classic either way.
    await addFiles(page, [{ name: 'later-x.wav', mimeType: 'audio/wav', buffer: toneWav(3, 300) }]);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 20_000 }).toBe(FLEG.length + 1);
    await page.waitForTimeout(3000); // the import's saves settle
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => { const s = await libraryState(page); return s.crystals[s.libraryNames.indexOf('later-x')]; }, { message: 'the new track gets a crystal', timeout: 15_000 }).toBeGreaterThan(0);
    const s2 = await libraryState(page);
    const moved = s1.libraryIds.filter((id, i) => s2.crystals[s2.libraryIds.indexOf(id)] !== s1.crystals[i]);
    expect(moved, 'no existing track moves').toEqual([]);
    await expect(page.getByText(/^Crystals assigned: 1 track got a crystal\. Deep Scan's crystals: 100 kept\. 130 crystals Assign placed before stay\./)).toBeVisible();
    // A delete, then Assign: nothing to do, nothing written, nothing moves.
    const victim = s2.libraryNames[0];
    await rowOf(page, victim).first().getByTitle('Delete song').evaluate((b) => (b as HTMLElement).click());
    await confirmDelete(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 15_000 }).toBe(FLEG.length);
    await page.waitForTimeout(3500); // the delete's saves settle
    const puts = await page.evaluate(() => (window as any).__metaPuts);
    const s3 = await libraryState(page);
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect(page.getByText(/^Every track already has its crystal \(\d+ from Deep Scan, 131 assigned\)\.$/)).toBeVisible();
    await page.waitForTimeout(3500);
    expect(await page.evaluate(() => (window as any).__metaPuts) - puts, 'no meta write').toBe(0);
    expect((await libraryState(page)).crystals, 'nothing moved').toEqual(s3.crystals);
    expect(dialogs).toEqual([]);
  });

  test('7. classic’s words don’t fake a scan: Library diagnostics count Deep Scan’s measurements, the Quick guide and the Guidebook say what Assign does', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = await openFleg(page, 'classic');
    await page.locator('aside').getByRole('button', { name: ASSIGN }).click();
    await expect.poll(async () => tally((await libraryState(page)).origins), { timeout: 15_000 }).toEqual({ scan: 100, assigned: 130 });
    await page.getByRole('button', { name: /^Library\s*Diagnostics/ }).click();
    const readout = page.getByRole('dialog', { name: 'Library diagnostics', exact: true });
    await expect(readout).toContainText('Analyzed tracks: 100');
    await expect(readout).toContainText('Unanalyzed tracks: 130 (130 with an assigned crystal)');
    await expect(readout, 'Deep Scan has nothing in its scope: no "Scan N remaining"').not.toContainText('remaining tracks');
    await readout.getByRole('button', { name: 'Close', exact: true }).click();
    // The Quick guide's Auto-Distribute line (its second page).
    await page.getByRole('button', { name: 'Quick guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome to Aetheria' }).waitFor();
    await expect.poll(async () => { if (await page.getByRole('heading', { name: '2. Scan & Distribute' }).isVisible()) return true; await page.getByRole('button', { name: 'Next', exact: true }).click(); return false; }, { message: 'the Quick guide’s second page', timeout: 10_000 }).toBe(true);
    await expect(page.getByText('Keeps the frequencies Deep Scan found and gives every other song one of the 27 across the GUT, HEART, and HEAD ranges, empty ones first.')).toBeVisible();
    await expect(page.getByText('Assigns every song to its closest Aetheria frequency')).toHaveCount(0);
    await page.getByText('Quick Guide', { exact: true }).locator('xpath=..').getByRole('button').first().click();
    // The Guidebook's quick start.
    await page.getByRole('button', { name: /The Guidebook/ }).click();
    await expect(page.getByText('songs Deep Scan measured keep their frequency, and every other song is given one of the 27 Aetheria frequencies')).toHaveCount(1);
    await expect(page.getByText('the player analyzes your music and assigns each song to its closest Aetheria frequency')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});
