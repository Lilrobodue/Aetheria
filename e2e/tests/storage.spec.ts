import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  openApp,
  acceptDisclaimer,
  acceptDisclaimerNew,
  openLibraryTab,
  importTones,
  addSynthWavs,
  audioRoom,
  cacheLimits,
  expectCache,
  controlStateSaves,
  elapsedSeconds,
  phoneSize,
  tab,
  stubStorageFull,
  rowMenu,
  confirmDelete,
  libraryState,
  libraryRowButton,
  PHONE_VIEWPORT,
  LAYER_ENGINE_KEY,
  LAYER_OUTPUT_KEY,
} from './helpers';

// v16.8.5, big libraries save (spec §3.2, S-1..S-4). The app no longer asks navigator.storage.estimate before storing
// audio: Chrome's free figure is a reported cap (on Android always usage + 10 GiB), not the real limit, and a 23.87 GB
// import was refused whole. Real write errors decide, and the audio goes in batches (256 MB, each its own transaction),
// so a quota error keeps every batch before it. A save of more than 50 tracks or 1 GB shows its progress, then
// "N tracks saved for offline use."; when some can't be stored, "N of M tracks could not be saved … the browser has no
// more room for this app.". Synthetic tones only (8 kHz mono WAVs built in the page: addSynthWavs, importTones).
// The quota error is the page-side fake (helpers.ts installQuotaFake: the transaction aborts at its commit and its
// error reads QuotaExceededError), exact, the same on the desktop, the mobile UA and a phone, and it leaves nothing
// behind in the browser (why not Chrome's own, through CDP: the note before S-3).
// Fix round 1 adds: S-2c (Chrome's own quota form, the commit refused) and S-2w (a plain write failure); S-3p (a phone
// importing through the modal Import sheet, which shows the save and reads it out once); G1-G3 (Dismiss sticks, a
// Clear ends it, it never covers another toast); A5 (the end line never covers a state warning), A6 (no lapse during a
// batch slower than the toast's two minutes, on Playwright's clock), A7 (no progress toast on the Car screen).
// Fix round 2 adds (after S-3p): S-3m-a..d (another modal sheet over #root at the start, for the whole save, from the
// Import sheet on, and a failure under it: each line read once, the end line held until heard), S-3f (the Import sheet's
// failed line, and a later small failure's), S-3h (the sheet keeps the line's room), G2s (no stale line after a Clear),
// A4e (App's total-0 end), S-3s ("0 of 1 track."), S-2k (a save that can't read the stored tracks says nothing), W1 (an
// end line in the slot a withdrawn warning leaves), H1 (the health card doesn't follow the line), A7w (the Car screen
// gives back a covered warning); S-2's batches hold two puts; S-3 asserts the desktop panel shows no save line.
// Fix round 3: the live-region model counts nothing put into #root within two frames (and 16 ms) of its return from
// inert, as Chrome announces none (T1, the note at slowBatchesAndWatchCards); a held line goes in again 500 ms after
// #root is live again, so the S-3m tests wait for it (D1), and record #root's state as each report came (T6); S-3m-b
// checks the Import sheet has no stale end line after (P4), S-3m-d that the warning stays sticky and is put in once
// (P5); S-3m-e..g pin hearUnheard's guards (a Clear, a withdrawal, another toast), S-3m-h a modal closed and opened
// again within the 500 ms, S-3m-i two saves ending under one modal; S-3n and S-3u each of C2's later-failure
// conditions alone; H1 bounds the sheet's body (2 a line change + 4) with a tone playing, to the end line's render.

const MB = 1024 * 1024;
const NO_ROOM = 'the browser has no more room for this app';

/** From the next page load on, navigator.storage.estimate reports `free` bytes past the real usage. */
async function estimateReports(page: Page, free: number): Promise<void> {
  await page.addInitScript((free) => {
    const storage = navigator.storage as any;
    const real = storage.estimate.bind(storage);
    (window as any).__estimateCalls = 0;
    storage.estimate = async () => {
      (window as any).__estimateCalls++;
      const e = await real();
      return { ...e, quota: (e.usage ?? 0) + free };
    };
  }, free);
}

/** From the next page load on, every audio batch (a readwrite transaction on 'blobs' alone) reaches the app `ms` after
 *  it committed (`firstMs` for the first batch, when given), so a save's progress spans seconds; and every card of the
 *  notices about offline use is logged as it changes in window.__offlineCards: { t, cards: [{ id, live, text }] } (the
 *  progress card's data-testid and aria-live). v16.8.5 fix round 1, logged as well:
 *    __progressSeen  when the progress card appeared (each time), and __progressLog its comings and goings { t, on };
 *    __sheetLines    the Import sheet's save line as it changes { t, text, live } (A1);
 *    __saveEvents    the cache's reports { t, type, ...detail };
 *    __announced     what a screen reader would read out { t, text, where }: text added to, or changed in, a live region
 *                    (aria-live polite/assertive, or role status/alert/log) that was already there, read as its nearest
 *                    aria-atomic card; never under aria-live="off", an inert subtree (#root under a modal sheet) or
 *                    aria-hidden, nor content inserted together with its region. Once per card per change.
 *                    Fix round 3 (T1): in #root, only once #root has been live for at least two animation frames and
 *                    16 ms. rev3's app lens measured it with Chrome's own events (a WinEvent hook on
 *                    EVENT_OBJECT_LIVEREGIONCHANGED, which Chrome fires from the same event generator as Android's
 *                    announcements): a card put in synchronously, in a microtask, at setTimeout 0 or after one
 *                    animation frame from #root's inert going off was not announced (Chrome exposes #root's subtree
 *                    again together with it in one accessibility update); after two frames, or 16 ms or more, it was,
 *                    once. rev4 measured the rule itself as "once the first frame after #root's return has rendered"
 *                    (a setTimeout 0 after that first frame was announced), so two frames and 16 ms is a safe
 *                    over-approximation: it can call a real announcement unheard (a false failure), never the other way.
 *                    #root's inert changes are logged too, in __rootLog { t, inert }.
 *  v16.8.5 fix round 2, switched from the test (all off at load):
 *    __holdKeysMs     a save's read of the stored tracks (the 'blobs' getAllKeys) answers this many ms late, so a test
 *                     can open another modal sheet before the save's first line;
 *    __holdFail       while true, an audio batch's failure (its transaction's error and abort) is held from the app until
 *                     __releaseFail() (a test deletes tracks meanwhile);
 *    __renderSnaps    the dev render counts (window.__aetheriaRenders) at each cache report { type, seq, r }.
 *  Fix round 3, also: each __saveEvents entry has `rootInert` and `importOpen` (#root inert, the Import sheet open, as
 *  the event came; T6); __keysReads counts the saves' reads of the stored tracks (one at each save's start);
 *  __holdClearMs (off at load) holds a Clear's commit (its readwrite transaction over 'blobs' and the other stores) from
 *  the app this many ms, as a big library's Clear takes; __cardAdds logs each offline-use card element put in
 *  { t, text, where } (a card put in again is a new element). */
async function slowBatchesAndWatchCards(page: Page, ms: number, opts: { firstMs?: number } = {}): Promise<void> {
  await page.addInitScript(({ ms, firstMs }) => {
    const w = window as any;
    w.__holdKeysMs = 0;
    w.__holdFail = false;
    w.__keysReads = 0;
    w.__holdClearMs = 0;
    const heldFails: (() => void)[] = [];
    w.__releaseFail = () => { w.__holdFail = false; heldFails.splice(0).forEach((f) => f()); };
    const getAllKeys = IDBObjectStore.prototype.getAllKeys;
    IDBObjectStore.prototype.getAllKeys = function (this: IDBObjectStore, ...args: unknown[]) {
      const request = (getAllKeys as any).apply(this, args);
      if (this.name === 'blobs') w.__keysReads++;
      const late = w.__holdKeysMs;
      if (this.name !== 'blobs' || !(late > 0)) return request;
      return new Proxy(request, {
        set(t: any, k, v) {
          if (k === 'onsuccess' && typeof v === 'function') { t.onsuccess = (ev: Event) => setTimeout(() => v.call(t, ev), late); return true; }
          t[k] = v;
          return true;
        },
        get(t: any, k) { const x = t[k]; return typeof x === 'function' ? x.bind(t) : x; },
      });
    } as typeof getAllKeys;
    const real = IDBDatabase.prototype.transaction;
    let batches = 0;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: unknown[]) {
      const tx: IDBTransaction = (real as any).apply(this, args);
      // Fix round 3: a Clear's commit (its one readwrite transaction over 'blobs' and the other stores), held.
      const clearLate = w.__holdClearMs;
      if (Array.isArray(args[0]) && args[0].includes('blobs') && args[1] === 'readwrite' && clearLate > 0) {
        return new Proxy(tx, {
          set(t: any, k, v) {
            if (k === 'oncomplete' && typeof v === 'function') { t.oncomplete = (ev: Event) => setTimeout(() => v.call(t, ev), clearLate); return true; }
            t[k] = v;
            return true;
          },
          get(t: any, k) { const x = t[k]; return typeof x === 'function' ? x.bind(t) : x; },
        });
      }
      if (args[0] !== 'blobs' || args[1] !== 'readwrite') return tx;
      const late = ++batches === 1 && typeof firstMs === 'number' ? firstMs : ms;
      return new Proxy(tx, {
        set(t: any, k, v) {
          if (k === 'oncomplete' && typeof v === 'function') {
            t.oncomplete = (ev: Event) => setTimeout(() => v.call(t, ev), late);
            return true;
          }
          if ((k === 'onerror' || k === 'onabort') && typeof v === 'function') {
            t[k] = (ev: Event) => { if (w.__holdFail) heldFails.push(() => v.call(t, ev)); else v.call(t, ev); };
            return true;
          }
          t[k] = v;
          return true;
        },
        get(t: any, k) {
          const x = t[k];
          return typeof x === 'function' ? x.bind(t) : x;
        },
      });
    } as typeof real;
    const log: { t: number; cards: { id: string | null; live: string | null; text: string }[] }[] = (w.__offlineCards = []);
    const seen: number[] = (w.__progressSeen = []);
    const onOff: { t: number; on: boolean }[] = (w.__progressLog = []);
    const lines: { t: number; text: string; live: string | null }[] = (w.__sheetLines = []);
    const events: any[] = (w.__saveEvents = []);
    const announced: { t: number; text: string; where: string }[] = (w.__announced = []);
    const snaps: any[] = (w.__renderSnaps = []);
    const rootLog: { t: number; inert: boolean }[] = (w.__rootLog = []);
    const cardAdds: { t: number; text: string; where: string }[] = (w.__cardAdds = []);
    for (const type of ['aetheria:cache-progress', 'aetheria:cache-ok', 'aetheria:cache-error']) {
      window.addEventListener(type, (e) => {
        const d = (e as CustomEvent).detail ?? {};
        // Fix round 3 (T6): #root's state and the Import sheet's as the report came, not after a later poll.
        const rootInert = !!(document.getElementById('root') as any)?.inert;
        const importOpen = !!document.querySelector('[data-testid="sheet-import"]');
        events.push({ t: performance.now(), type: type.slice('aetheria:'.length), rootInert, importOpen, ...d });
        snaps.push({ t: performance.now(), type: type.slice('aetheria:'.length), seq: d.seq, what: d.what, r: { ...(w.__aetheriaRenders ?? {}) } });
      });
    }
    let last = '';
    let had = false;
    let lastLine = '';
    const look = () => {
      const t = performance.now();
      const cards = [...document.querySelectorAll('div[aria-atomic="true"]')]
        .filter((d) => /offline use/.test(d.textContent ?? ''))
        .map((d) => ({ id: d.getAttribute('data-testid'), live: d.getAttribute('aria-live'), text: (d.textContent ?? '').trim() }));
      const key = JSON.stringify(cards);
      if (key !== last) {
        last = key;
        log.push({ t, cards });
      }
      const has = !!document.querySelector('[data-testid="cache-progress"]');
      if (has !== had) {
        if (has) seen.push(t);
        onOff.push({ t, on: has });
        had = has;
      }
      const el = document.querySelector('[data-testid="import-save-line"]');
      const line = el ? JSON.stringify([el.textContent, el.getAttribute('aria-live')]) : '';
      if (line !== lastLine) {
        lastLine = line;
        if (el) lines.push({ t, text: (el.textContent ?? '').trim(), live: el.getAttribute('aria-live') });
      }
    };
    const regionOf = (el: Element): { region: Element; live: string } | null => {
      for (let x: Element | null = el; x; x = x.parentElement) {
        const a = x.getAttribute('aria-live');
        if (a) return { region: x, live: a };
        const role = x.getAttribute('role');
        if (role === 'status' || role === 'log') return { region: x, live: 'polite' };
        if (role === 'alert') return { region: x, live: 'assertive' };
      }
      return null;
    };
    // Fix round 3 (T1): when #root last came back from inert, and how many animation frames have run since (2: done).
    let liveSince = -Infinity;
    let liveFrames = 2;
    let liveGen = 0;
    const rootSettled = () => liveFrames >= 2 && performance.now() - liveSince >= 16;
    const offline = /offline use|could not be saved/;
    const listen = (records: MutationRecord[]) => {
      // #root's inert changes in this batch, in order (each record's new value is the next one's old value, or now's).
      const root = document.getElementById('root');
      const inertRecs = records.filter((r) => r.type === 'attributes' && r.attributeName === 'inert' && r.target === root);
      let cameBack = false;
      inertRecs.forEach((r, i) => {
        const was = r.oldValue !== null;
        const now = i + 1 < inertRecs.length ? inertRecs[i + 1].oldValue !== null : !!root?.hasAttribute('inert');
        if (was === now) return;
        rootLog.push({ t: performance.now(), inert: now });
        if (!now) cameBack = true;
      });
      if (cameBack) {
        liveSince = performance.now();
        liveFrames = 0;
        const gen = ++liveGen;
        requestAnimationFrame(() => {
          if (gen !== liveGen) return;
          liveFrames = 1;
          requestAnimationFrame(() => { if (gen === liveGen) liveFrames = 2; });
        });
      }
      const added = new Set<Node>();
      for (const r of records) if (r.type === 'childList') r.addedNodes.forEach((n) => added.add(n));
      const cameWith = (el: Node) => {
        for (let x: Node | null = el; x; x = x.parentNode) if (added.has(x)) return true;
        return false;
      };
      for (const r of records) {
        if (r.type !== 'childList') continue;
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1 || !(n as Element).isConnected || !(n as Element).matches('div[aria-atomic="true"]')) return;
          const text = (n.textContent ?? '').trim();
          if (offline.test(text)) cardAdds.push({ t: performance.now(), text, where: (n as Element).closest('#root') ? 'root' : 'portal' });
        });
      }
      const said = new Set<Node>();
      for (const r of records) {
        const nodes = r.type === 'childList' ? [...r.addedNodes] : r.type === 'characterData' ? [r.target] : [];
        for (const n of nodes) {
          const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
          if (!el || !el.isConnected) continue;
          const found = regionOf(el);
          if (!found || found.live === 'off') continue;
          if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue;
          if (cameWith(found.region)) continue; // a live region inserted with its text is not read out
          // T1: in #root, nothing put in within two frames (and 16 ms) of its return from inert is announced.
          if (el.closest('#root') && !rootSettled()) continue;
          const atomic = el.closest('[aria-atomic="true"]');
          const unit: Node = atomic && found.region.contains(atomic) ? atomic : n;
          if (said.has(unit)) continue;
          said.add(unit);
          const text = (unit.textContent ?? '').trim();
          if (text) announced.push({ t: performance.now(), text, where: el.closest('#root') ? 'root' : 'portal' });
        }
      }
    };
    new MutationObserver((records) => { listen(records); look(); }).observe(document, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ['aria-live', 'data-testid', 'inert'],
    });
  }, { ms, firstMs: opts.firstMs });
}

type CardLog = { t: number; cards: { id: string | null; live: string | null; text: string }[] }[];
// v16.8.5 fix round 1 (T8 N8): the floor for "at most one change a second", with a margin, not the throttle's own 1000 ms.
// The throttle counts from its decision (App's Date.now() as it shows a line); this log, from the DOM change React makes
// after it. A slow render of the earlier change (a long task on a busy phone) shortens the gap measured by its delay, so
// the floor allows 250 ms of it. An unthrottled toast changes with every batch (400 ms apart in these tests), still under.
const THROTTLE_FLOOR_MS = 750;
// Fix round 2 (C3): "0 of 1 track." for one track.
const progressLine = (saved: number, total: number) => `Saving for offline use: ${saved} of ${total} track${total === 1 ? '' : 's'}. Keep the app open until it's done.`;

/** The progress card's shown lines (in order, each with when it appeared and its aria-live), and the end line's. */
function readCards(log: CardLog) {
  const progress: { t: number; saved: number; total: number; live: string | null }[] = [];
  let endAt = -1;
  for (const e of log) {
    for (const c of e.cards) {
      const m = /^Saving for offline use: (\d+) of (\d+) tracks?\. Keep the app open until it's done\.$/.exec(c.text);
      if (m && c.id === 'cache-progress') {
        const prev = progress[progress.length - 1];
        if (!prev || prev.saved !== Number(m[1]) || prev.total !== Number(m[2])) progress.push({ t: e.t, saved: Number(m[1]), total: Number(m[2]), live: c.live });
      }
      if (/^\d+ tracks? saved for offline use\.$/.test(c.text) && endAt < 0) endAt = e.t;
    }
  }
  return { progress, endAt };
}

test('S-1. the estimate says 50 MB free: an import of about 120 MB is stored whole with no warning, and after a reload every track comes back and plays @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  await estimateReports(page, 50 * MB);
  const dialogs = await openApp(page);
  expect(await page.evaluate(async () => { const e = await navigator.storage.estimate(); return (e.quota ?? 0) - (e.usage ?? 0); }), 'the stub reports 50 MB free').toBe(50 * MB);
  await page.evaluate(() => { (window as any).__estimateCalls = 0; }); // (that one was the test's own)
  await addSynthWavs(page, 6, 20 * MB, 'roomy');
  await expectCache(page, { blobs: 6, library: 6 }, 60_000);
  await expect(page.getByText(/could not be saved/)).toHaveCount(0);
  // Fix round 1 (T8 N4): the app never asked the estimate (the gate is gone, and nothing else consults it).
  expect(await page.evaluate(() => (window as any).__estimateCalls), 'the app made no estimate() call while saving').toBe(0);
  const stored = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all: any[] = await new Promise((res) => { const r = db.transaction('blobs', 'readonly').objectStore('blobs').getAll(); r.onsuccess = () => res(r.result); });
    db.close();
    return all.reduce((s, b) => s + (b.fileBlob?.size ?? 0), 0);
  });
  expect(stored, 'about 120 MB of audio stored (more than the 50 MB the estimate said was free)').toBeGreaterThan(115 * MB);

  await page.reload();
  await acceptDisclaimer(page);
  await expect(page.getByText(/Restored 6 tracks from cache/)).toBeVisible({ timeout: 30_000 });
  await expectCache(page, { blobs: 6, library: 6 });
  await page.getByText('roomy-01', { exact: true }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('roomy-01');
  await expect.poll(() => elapsedSeconds(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Next track' }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('roomy-02');
  await expect(page.getByText(/could not be saved/)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__estimateCalls), 'none in the restore either').toBe(0);
  expect(dialogs).toEqual([]);
});

test('S-2. a quota error after about 60 MB: the earlier batches stay, the warning says "4 of 6" in the new words, and a reload brings back exactly the stored ones @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  await audioRoom(page, 60 * MB);
  // Two tracks to a batch (each file is 20 MiB + 44 B, so 41 MiB holds two, and 40 MiB only one): the first batch fits
  // the 60 MiB of room, the second doesn't. Fix round 2 (rev2 tests N-e): two puts to a batch, so the failing batch's
  // own puts are several (S-2c: Chrome's form aborts after the LAST of them succeeds).
  await cacheLimits(page, { batchBytes: 41 * MB });
  await controlStateSaves(page); // records the reports (no state failure is switched on)
  const dialogs = await openApp(page);
  await addSynthWavs(page, 6, 20 * MB, 'room');
  const warning = page.getByText(`4 of 6 tracks could not be saved for offline use: ${NO_ROOM}. Those play now but won't be here after a reload.`, { exact: true });
  await expect(warning).toBeVisible({ timeout: 60_000 });
  // The audio of two, and the library order and metadata of all six (saved 2 s after the import settles: a reload
  // inside that window keeps the order through the hide flush but may lose the metadata, as since v16.0.1).
  await expectCache(page, { blobs: 2, library: 6, meta: 6 }, 30_000);
  const events: any[] = await page.evaluate(() => (window as any).__cacheEvents);
  const err = events.find((e) => e.type === 'cache-error' && e.what === 'tracks');
  expect(err, 'one tracks report').toMatchObject({ count: 4, total: 6, reason: 'storage-full' });
  expect(events.some((e) => e.type === 'cache-ok' && e.what === 'tracks' && e.seq === err.seq), 'no cache-ok for the partial save').toBe(false);
  const storedIds = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all: any[] = await new Promise((res) => { const r = db.transaction('blobs', 'readonly').objectStore('blobs').getAll(); r.onsuccess = () => res(r.result); });
    db.close();
    return all.map((b) => b.fileName).sort();
  });
  expect(storedIds, 'the earliest two, in library order').toEqual(['room-01.wav', 'room-02.wav']);
  // They play now (the import is in memory).
  await page.getByText('room-05', { exact: true }).click();
  await expect(page.getByTestId('now-playing-title')).toHaveText('room-05');
  await expect.poll(() => elapsedSeconds(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

  await page.reload();
  await acceptDisclaimer(page);
  await expect(page.getByText(/Restored 2 tracks from cache/)).toBeVisible({ timeout: 30_000 });
  await expectCache(page, { blobs: 2, library: 2 });
  // (Its row, and maybe the restored now-playing title too.)
  await expect(page.getByText('room-01', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('room-02', { exact: true }).first()).toBeVisible();
  for (const gone of ['room-03', 'room-04', 'room-05', 'room-06']) await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

// v16.8.5 fix round 1 (T4, T6): S-2 in the other two ways a batch fails. 'commit' is Chrome's own quota form (every put
// succeeds, then the commit is refused: no request error, only the abort, so the app settles through txDone's onabort);
// 'plain' is a write that failed for another reason (an AbortError): "N of M … Those play now", without the room clause.
for (const [form, words] of [
  ['commit', `4 of 6 tracks could not be saved for offline use: ${NO_ROOM}. Those play now but won't be here after a reload.`],
  ['plain', "4 of 6 tracks could not be saved for offline use. Those play now but won't be here after a reload."],
] as const) {
  test(`S-2${form === 'commit' ? 'c' : 'w'}. ${form === 'commit' ? "Chrome's own quota form (the commit refused, no request error)" : 'a plain write failure (not the quota)'} after about 60 MB: the earlier batches stay, and the warning says "4 of 6" in its words @mobile`, async ({ page }) => {
    test.setTimeout(120_000);
    await audioRoom(page, 60 * MB, form);
    await cacheLimits(page, { batchBytes: 41 * MB }); // two tracks to a batch, as S-2
    await controlStateSaves(page);
    const dialogs = await openApp(page);
    await addSynthWavs(page, 6, 20 * MB, 'room');
    await expect(page.getByText(words, { exact: true })).toBeVisible({ timeout: 60_000 });
    const events: any[] = await page.evaluate(() => (window as any).__cacheEvents);
    const err = events.find((e) => e.type === 'cache-error' && e.what === 'tracks');
    expect(err, 'one tracks report').toMatchObject({ count: 4, total: 6, reason: form === 'commit' ? 'storage-full' : 'write-failed' });
    expect(events.filter((e) => e.type === 'cache-error' && e.what === 'tracks').length, 'exactly one').toBe(1);
    if (form === 'commit') expect(await page.evaluate(() => (window as any).__putErrors), 'no request failed: only the commit').toBe(0);
    await expectCache(page, { blobs: 2 }, 30_000);
    await expect(page.getByText(/could not be saved for offline use: the browser/)).toHaveCount(form === 'commit' ? 1 : 0);
    expect(dialogs).toEqual([]);
  });
}

// Why no test drives Chrome's own quota error (CDP Storage.overrideQuotaForOrigin): this build measured it on the
// computer. A probe of 10 MB blob transactions under a usage + 60 MB override was refused (QuotaExceededError on the
// transaction, at commit) only at the 10th, 90 MB in, 5 of 5 rounds; the app's own save of 6 × 20 MB in 40 MB batches
// under the same override was let in whole (cache-ok). Chrome counts a blob against the override after it is written,
// so where it stops depends on timing and transaction size: not a test instrument. S-2's page-side fake is exact.

for (const layout of ['classic', 'new'] as const) {
  test.describe(`S-3 in the ${layout} layout`, () => {
    test.use({ layoutSeed: layout });
    test(`S-3. a save over the progress threshold (${layout}): the progress toast, updated in place at most once a second and read once, then "8 tracks saved for offline use." @mobile`, async ({ page }) => {
      test.setTimeout(120_000);
      await cacheLimits(page, { progressTracks: 3, batchBytes: 1 }); // more than 3 tracks shows it; one track per batch
      // A batch every 400 ms: unthrottled, the toast would change that often (well under the floor below).
      await slowBatchesAndWatchCards(page, 400);
      if (layout === 'classic') {
        await openApp(page);
      } else {
        await page.addInitScript(() => localStorage.setItem('aetheria_v3_tutorial_seen', 'true'));
        await page.goto('/');
        await acceptDisclaimerNew(page);
        await openLibraryTab(page);
        await page.getByTestId('library-import').click();
      }
      await importTones(page, 8, 2, 'prog');
      const done = page.getByText('8 tracks saved for offline use.', { exact: true });
      await expect(page.getByTestId('cache-progress')).toBeVisible({ timeout: 10_000 });
      if (layout === 'new') {
        // Fix round 2 (rev2 tests N-h): the desktop's Import panel isn't modal (the toast beside it says it all): no line.
        await expect(page.getByTestId('sheet-import'), 'the Import panel is open').toBeVisible();
        await expect(page.getByTestId('import-save'), 'no save line in the desktop panel').toHaveCount(0);
      }
      await expect(done).toBeVisible({ timeout: 30_000 });
      if (layout === 'new') await expect(page.getByTestId('import-save'), 'nor at the end').toHaveCount(0);
      await expect(page.getByTestId('cache-progress')).toHaveCount(0);
      await expect(done, 'not sticky: it goes after 5 s').toHaveCount(0, { timeout: 8_000 });
      await expectCache(page, { blobs: 8 });

      const { progress, endAt } = readCards(await page.evaluate(() => (window as any).__offlineCards));
      test.info().annotations.push({ type: 'progress lines', description: progress.map((p) => `${p.saved}/${p.total} @${Math.round(p.t)} ${p.live ?? '-'}`).join(', ') });
      expect(progress[0], 'it starts at 0 of 8, read out (no aria-live="off")').toMatchObject({ saved: 0, total: 8, live: null });
      expect(progress.length, 'it updated in place at least once').toBeGreaterThanOrEqual(2);
      for (let i = 1; i < progress.length; i++) {
        expect(progress[i].saved, 'it only grows').toBeGreaterThan(progress[i - 1].saved);
        expect(progress[i].total).toBe(8);
        expect(progress[i].live, 'its updates are not read out again').toBe('off');
        expect(progress[i].t - progress[i - 1].t, 'at most one change a second (see THROTTLE_FLOOR_MS)').toBeGreaterThanOrEqual(THROTTLE_FLOOR_MS);
      }
      expect(endAt, 'then the end line').toBeGreaterThan(progress[progress.length - 1].t);
      await expect(page.getByText(/could not be saved/)).toHaveCount(0);
      // Fix round 1 (A1): read out once at its start and once at its end (the toast, #root live: no sheet over it).
      const said: { text: string }[] = await page.evaluate(() => (window as any).__announced);
      expect(said.filter((a) => /Saving for offline use/.test(a.text)).map((a) => a.text), 'the start read once').toEqual([progressLine(0, 8)]);
      expect(said.filter((a) => /saved for offline use\./.test(a.text)).length, 'the end read once').toBe(1);
    });
  });
}

// v16.8.5 fix round 1 (T9, for A1): a phone in the new layout imports through the Import sheet, which is modal there
// (#root inert under it, the toast hidden behind it). The sheet shows the save itself, topmost at its own point, and
// reads its start and its end out once each (the toast under the sheet is not heard).
test.describe('S-3 on a phone, through the Import sheet', () => {
  test.use({ layoutSeed: 'new', viewport: PHONE_VIEWPORT });
  test('S-3p. the Import sheet (modal on the phone) shows the save: its line is on top, updates at most once a second, ends with "8 tracks saved for offline use.", and the start and the end are each read once @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 400);
    await page.addInitScript(() => localStorage.setItem('aetheria_v3_tutorial_seen', 'true'));
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await phoneSize(page);
    await openLibraryTab(page);
    await page.getByTestId('library-import').click();
    const sheet = page.getByRole('dialog', { name: 'Import music', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('import-save'), 'its live region is there before the import').toHaveCount(1);
    await importTones(page, 8, 2, 'sheet');
    const line = sheet.getByTestId('import-save-line');
    /** Is the line the topmost element at its own centre (nothing over it: not hidden behind anything)? */
    const onTop = () => line.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width > 0 && r.height > 0 && !!hit && el.contains(hit);
    });
    await expect(line).toHaveText(/^Saving for offline use: \d of 8 tracks\. Keep the app open until it's done\.$/, { timeout: 10_000 });
    expect(await onTop(), 'the progress line is on top at its point').toBe(true);
    expect(await page.evaluate(() => (document.getElementById('root') as any).inert), '#root is inert under the sheet').toBe(true);
    await expect(line).toHaveText(/^Saving for offline use: [1-7] of 8 tracks/, { timeout: 15_000 });
    expect(await onTop(), 'still on top as it updates').toBe(true);
    await expect(line).toHaveText('8 tracks saved for offline use.', { timeout: 30_000 });
    expect(await onTop(), 'the end line is on top').toBe(true);
    await expect(line, 'the end line goes after 5 s, as the toast does').toHaveCount(0, { timeout: 8_000 });
    await expectCache(page, { blobs: 8 });

    const lines: { t: number; text: string; live: string | null }[] = await page.evaluate(() => (window as any).__sheetLines);
    test.info().annotations.push({ type: 'sheet lines', description: lines.map((l) => `${l.text.slice(0, 32)} @${Math.round(l.t)} ${l.live ?? '-'}`).join(' | ') });
    const progress = lines.map((l) => ({ ...l, m: /^Saving for offline use: (\d+) of (\d+) tracks\./.exec(l.text) })).filter((l) => l.m);
    expect(progress[0]?.text, 'it starts at 0 of 8').toBe(progressLine(0, 8));
    expect(progress[0]?.live, 'the start is read out (no aria-live="off")').toBeNull();
    const steps = progress.filter((l, i) => i === 0 || l.text !== progress[i - 1].text);
    expect(steps.length, 'it updated in place at least once').toBeGreaterThanOrEqual(2);
    for (let i = 1; i < steps.length; i++) {
      expect(Number(steps[i].m![1]), 'it only grows').toBeGreaterThan(Number(steps[i - 1].m![1]));
      expect(steps[i].live, 'its updates are not read out again').toBe('off');
      expect(steps[i].t - steps[i - 1].t, 'at most one change a second (THROTTLE_FLOOR_MS)').toBeGreaterThanOrEqual(THROTTLE_FLOOR_MS);
    }
    const said: { text: string; where: string }[] = await page.evaluate(() => (window as any).__announced);
    test.info().annotations.push({ type: 'read out', description: said.map((a) => `${a.where}: ${a.text.slice(0, 48)}`).join(' | ') });
    expect(said.filter((a) => /Saving for offline use/.test(a.text)).map((a) => [a.where, a.text]), 'the start read once, by the sheet').toEqual([['portal', progressLine(0, 8)]]);
    expect(said.filter((a) => /saved for offline use\./.test(a.text)).map((a) => [a.where, a.text]), 'the end read once, by the sheet').toEqual([['portal', '8 tracks saved for offline use.']]);
  });
});

// ---- v16.8.5 fix round 2 -------------------------------------------------------------------------------------------
// C1: a save's end (or a tracks warning) that lands under another modal sheet (#root inert, so the toast isn't heard) is
// held and put in again, read once, when #root is live again; the end line's 5 s start then. C2: the Import sheet's
// line follows every later tracks failure. C3: "0 of 1 track.". C5: the sheet keeps the line's room. C6: the line
// reaches the Import sheet's body alone. And rev2's unpinned paths (the tests lens's SF-a..c, N-a..N-d).

/** The new layout, Output already chosen (Now Playing's Output opens the Sound sheet, as for a returning user), the
 *  phone's size on a device (the describe's viewport otherwise), on the Library tab. */
async function openShell(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
    if (sessionStorage.getItem('__outputSeeded') === null) {
      sessionStorage.setItem('__outputSeeded', '1');
      localStorage.setItem(key, 'headphones');
    }
  }, LAYER_OUTPUT_KEY);
  await page.goto('/');
  await acceptDisclaimerNew(page);
  await phoneSize(page);
  await openLibraryTab(page);
}
const importSheet = (page: Page) => page.getByRole('dialog', { name: 'Import music', exact: true });
async function openImportSheet(page: Page): Promise<void> {
  await openLibraryTab(page);
  await page.getByTestId('library-import').click();
  await expect(page.getByTestId('sheet-import')).toBeVisible(); // the phone's modal sheet, or the desktop's panel
}
const rootInert = (page: Page) => page.evaluate(() => !!(document.getElementById('root') as any).inert);
/** Another modal sheet over #root: Sound (Now Playing's Output). */
async function openSoundSheet(page: Page): Promise<void> {
  await tab(page, 'now');
  await page.getByTestId('np-output').click();
  await expect(page.getByTestId('sheet-sound')).toBeVisible();
  expect(await rootInert(page), '#root is inert under the Sound sheet').toBe(true);
}
/** Close the top sheet (Escape) and wait for it to go. Returns when the close began (the page's performance.now()). */
async function closeSheet(page: Page, testId: string): Promise<number> {
  const at = await page.evaluate(() => performance.now());
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(testId)).toHaveCount(0);
  return at;
}
type Said = { t: number; text: string; where: string };
const saidOf = (page: Page) => page.evaluate(() => (window as any).__announced as Said[]);
const saidAs = (said: Said[], re: RegExp) => said.filter((a) => re.test(a.text)).map((a) => [a.where, a.text]);
/** Nothing about offline use is read out twice. */
function expectNothingTwice(said: Said[]): void {
  const texts = said.filter((a) => /offline use/.test(a.text)).map((a) => a.text);
  expect(texts.filter((t, i) => texts.indexOf(t) !== i), 'nothing read out twice').toEqual([]);
}
const saveEvents = (page: Page) => page.evaluate(() => (window as any).__saveEvents as any[]);
/** Wait for the end (`type`) of the tracks save whose progress showed. */
async function waitSaveEnd(page: Page, type: 'cache-ok' | 'cache-error', timeout = 40_000): Promise<void> {
  await expect
    .poll(async () => {
      const ev = await saveEvents(page);
      const seqs = new Set(ev.filter((e) => e.type === 'cache-progress').map((e) => e.seq));
      return ev.some((e) => e.type === type && e.what === 'tracks' && seqs.has(e.seq));
    }, { timeout, message: `the save's ${type}` })
    .toBe(true);
}
// Fix round 3: the page's clock; a wait until `ms` after `from` on it.
const pageNow = (page: Page) => page.evaluate(() => performance.now());
async function waitUntil(page: Page, from: number, ms: number): Promise<void> {
  const left = from + ms - (await pageNow(page));
  if (left > 0) await page.waitForTimeout(left);
}
/** Fix round 3 (D1): wait until what `re` matches has been read out `n` times (a held line goes in again 500 ms after
 *  #root is live again, so not at once), and return all that was read. */
async function waitSaid(page: Page, re: RegExp, n = 1, timeout = 5_000): Promise<Said[]> {
  await expect.poll(async () => (await saidOf(page)).filter((a) => re.test(a.text)).length, { timeout, message: `read out ${n} time(s): ${re}` }).toBe(n);
  return saidOf(page);
}
const cardAddsOf = (page: Page) => page.evaluate(() => (window as any).__cardAdds as Said[]);
/** The tracks save whose progress showed first: its first report and its end (`type`), as recorded (T6: with #root's
 *  state as each came). */
function saveOf(ev: any[], type: 'cache-ok' | 'cache-error'): { first: any; end: any } {
  const first = ev.find((e) => e.type === 'cache-progress');
  const end = ev.find((e) => e.type === type && e.what === 'tracks' && e.seq === first?.seq);
  return { first, end };
}
const SOME_FAILED = `4 of 6 tracks could not be saved for offline use: ${NO_ROOM}. Those play now but won't be here after a reload.`;
// Six 2 s tones are 32,044 bytes each: room for two of them, so the third batch (one track to a batch) fails.
const ROOM_FOR_TWO = 80_000;

test.describe('a big save with another modal sheet over #root (a phone, the new layout)', () => {
  test.use({ layoutSeed: 'new', viewport: PHONE_VIEWPORT });

  test('S-3m-a. the Sound sheet open at the start, closed about 1.5 s later, just after a progress change: the first line after the close is read once, then the end once; nothing twice @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 700);
    await openShell(page);
    await openImportSheet(page);
    await page.evaluate(() => { (window as any).__holdKeysMs = 3500; }); // the save's first line waits for the Sound sheet
    await importTones(page, 8, 2, 'snd');
    await closeSheet(page, 'sheet-import');
    await openSoundSheet(page);
    await expect.poll(async () => (await saveEvents(page)).some((e) => e.type === 'cache-progress'), { timeout: 10_000, message: 'the save starts' }).toBe(true);
    // Fix round 3 (T6): #root's state as the first report came, not after the poll (a slow phone could make that late).
    expect(saveOf(await saveEvents(page), 'cache-ok').first.rootInert, 'it started under the Sound sheet').toBe(true);
    await page.waitForTimeout(1500);
    // Closed just after a change of the progress card, so the next change (about a second on) comes well after #root is
    // live again: a change within a frame of #root's return is not read (T1), and the ones after it are quiet.
    const changes: number = await page.evaluate(() => (window as any).__offlineCards.length);
    await expect.poll(() => page.evaluate(() => (window as any).__offlineCards.length), { timeout: 5_000, intervals: [20] }).toBeGreaterThan(changes);
    const closedAt = await closeSheet(page, 'sheet-sound');
    await waitSaveEnd(page, 'cache-ok');
    await expect(page.getByText('8 tracks saved for offline use.', { exact: true })).toBeVisible();
    const said = await saidOf(page);
    test.info().annotations.push({ type: 'read out', description: said.map((a) => `${Math.round(a.t - closedAt)} ${a.where}: ${a.text.slice(0, 40)}`).join(' | ') });
    const lines = said.filter((a) => /^Saving for offline use/.test(a.text));
    expect(lines.length, 'one progress line read out: the first change after the close').toBe(1);
    expect(lines[0].t, 'after the close').toBeGreaterThan(closedAt);
    expect(lines[0].where).toBe('root');
    expect(saidAs(said, /saved for offline use\./), 'the end read once, by the toast').toEqual([['root', '8 tracks saved for offline use.']]);
    expectNothingTwice(said);
  });

  test('S-3m-b. the Sound sheet open for the whole save, closed after: the end waits (still up 6 s on), is read once after the close, and shows its 5 s from then; the Import sheet then has no stale end line @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 300);
    await openShell(page);
    await openImportSheet(page);
    await page.evaluate(() => { (window as any).__holdKeysMs = 3500; });
    await importTones(page, 6, 2, 'held');
    await closeSheet(page, 'sheet-import');
    await openSoundSheet(page);
    await waitSaveEnd(page, 'cache-ok');
    const s = saveOf(await saveEvents(page), 'cache-ok');
    expect(s.first.rootInert, 'the save started under the Sound sheet (T6)').toBe(true);
    expect(s.end.rootInert, 'and ended under it').toBe(true);
    const end = page.getByText('6 tracks saved for offline use.', { exact: true });
    await page.waitForTimeout(6_000); // past the end line's 5 s: no one has heard it, so it waits
    await expect(end, 'the end line waits while no one can hear it').toHaveCount(1);
    const closedAt = await closeSheet(page, 'sheet-sound');
    await expect(end).toBeVisible();
    await waitSaid(page, /saved for offline use\./);
    await waitUntil(page, closedAt, 4_000);
    await expect(end, 'still up 4 s after the close: its 5 s started after it').toBeVisible();
    await expect(end, 'and it goes after them').toHaveCount(0, { timeout: 4_000 });
    // rev3 tests SF-3 (P4): the sheet's end line, held with it, got its 5 s then too: 6 s on, the sheet has none.
    await waitUntil(page, closedAt, 6_000);
    await openImportSheet(page);
    await page.waitForTimeout(500);
    // rev4 SF-1: one look, no retry (toHaveCount would wait up to 5 s more, so a line kept 9 s would pass).
    expect(await importSheet(page).getByTestId('import-save-line').count(), "no stale end line in the Import sheet: its 5 s ran from the close").toBe(0);
    const said = await saidOf(page);
    test.info().annotations.push({ type: 'read out', description: said.map((a) => `${Math.round(a.t - closedAt)} ${a.where}: ${a.text.slice(0, 40)}`).join(' | ') });
    expect(saidAs(said, /^Saving for offline use/), 'the save ended before anyone could hear its start: only its end is read').toEqual([]);
    const ends = said.filter((a) => /saved for offline use\./.test(a.text));
    expect(ends.map((a) => [a.where, a.text]), 'the end read once, by the toast').toEqual([['root', '6 tracks saved for offline use.']]);
    expect(ends[0].t, 'after the close').toBeGreaterThan(closedAt);
    // rev4 N2: the 500 ms wait itself (so TalkBack reads the opener focus returns to first), not just "after the close".
    expect(ends[0].t - closedAt, 'read after the 500 ms wait').toBeGreaterThan(400);
    expectNothingTwice(said);
  });

  test('S-3m-c. the start in the Import sheet, then the Sound sheet, the end under it: the end is read once after the close; nothing twice @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 900);
    await openShell(page);
    await openImportSheet(page);
    await importTones(page, 6, 2, 'cross');
    await expect(importSheet(page).getByTestId('import-save-line')).toHaveText(/^Saving for offline use: \d of 6 tracks/, { timeout: 10_000 });
    await closeSheet(page, 'sheet-import');
    await openSoundSheet(page);
    await waitSaveEnd(page, 'cache-ok');
    expect(saveOf(await saveEvents(page), 'cache-ok').end.rootInert, 'the save ended under the Sound sheet').toBe(true);
    await page.waitForTimeout(800);
    const closedAt = await closeSheet(page, 'sheet-sound');
    await expect(page.getByText('6 tracks saved for offline use.', { exact: true })).toBeVisible();
    await waitSaid(page, /saved for offline use\./);
    await page.waitForTimeout(1000);
    const said = await saidOf(page);
    test.info().annotations.push({ type: 'read out', description: said.map((a) => `${Math.round(a.t - closedAt)} ${a.where}: ${a.text.slice(0, 40)}`).join(' | ') });
    expect(saidAs(said, /^Saving for offline use/), 'the start read once, by the Import sheet').toEqual([['portal', progressLine(0, 6)]]);
    const ends = said.filter((a) => /saved for offline use\./.test(a.text));
    expect(ends.map((a) => [a.where, a.text]), 'the end read once, by the toast').toEqual([['root', '6 tracks saved for offline use.']]);
    expect(ends[0].t, 'after the close').toBeGreaterThan(closedAt);
    expectNothingTwice(said);
  });

  test('S-3m-d. a save that fails under the Sound sheet: its "4 of 6" warning is read once after the close, and put in once, it stays (sticky) 6.5 s on; nothing twice @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await audioRoom(page, ROOM_FOR_TWO);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 300);
    await openShell(page);
    await openImportSheet(page);
    await page.evaluate(() => { (window as any).__holdKeysMs = 3500; });
    await importTones(page, 6, 2, 'full');
    await closeSheet(page, 'sheet-import');
    await openSoundSheet(page);
    await waitSaveEnd(page, 'cache-error');
    const s = saveOf(await saveEvents(page), 'cache-error');
    expect(s.first.rootInert, 'the save started under the Sound sheet (T6)').toBe(true);
    expect(s.end.rootInert, 'and failed under it').toBe(true);
    await page.waitForTimeout(800);
    const closedAt = await closeSheet(page, 'sheet-sound');
    const warning = page.getByText(SOME_FAILED, { exact: true });
    await expect(warning).toBeVisible();
    await waitSaid(page, /could not be saved/);
    // rev3 tests SF-3 (P5): put back sticky, as it was: still up 6.5 s after the close (past a timed toast's 5 s, which
    // would end it and bring back the covered copy, a new element, read again), and put in only once.
    await waitUntil(page, closedAt, 6_500);
    await expect(warning, 'still up 6.5 s after the close: sticky').toBeVisible();
    const adds = (await cardAddsOf(page)).filter((a) => a.t > closedAt && a.text === SOME_FAILED);
    expect(adds.length, 'put in once after the close').toBe(1);
    const said = await saidOf(page);
    test.info().annotations.push({ type: 'read out', description: said.map((a) => `${Math.round(a.t - closedAt)} ${a.where}: ${a.text.slice(0, 40)}`).join(' | ') });
    const warned = said.filter((a) => /could not be saved/.test(a.text));
    expect(warned.map((a) => [a.where, a.text]), 'the warning read once, by the toast').toEqual([['root', SOME_FAILED]]);
    expect(warned[0].t, 'after the close').toBeGreaterThan(closedAt);
    expectNothingTwice(said);
  });

  // ---- fix round 3 (rev3: tests SF-2, N-3, N-4; app N1) -------------------------------------------------------------
  // T3 (SF-2): hearUnheard's guards, each on its own path. A Clear while held (the Clear dialog is a kit alertdialog:
  // #root inert under it). __holdClearMs: the Clear's commit takes 1.5 s, as a big library's does, so its own toast
  // comes after the held line's 500 ms (that toast would otherwise take the slot first, and hide a missing guard).
  test("S-3m-e. a big save ends under the Clear dialog, then Clear: only the Clear's line is read; the old end is never put back @mobile", async ({ page }) => {
    test.setTimeout(120_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 300);
    await openShell(page);
    await openImportSheet(page);
    await page.evaluate(() => { (window as any).__holdKeysMs = 3500; });
    await importTones(page, 6, 2, 'gone');
    await closeSheet(page, 'sheet-import');
    const toggle = page.getByTestId('library-health-toggle');
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.getByTestId('library-tools-clear').click();
    const d = page.getByRole('alertdialog', { name: 'Clear your library?' });
    await expect(d).toBeVisible();
    await waitSaveEnd(page, 'cache-ok');
    expect(saveOf(await saveEvents(page), 'cache-ok').end.rootInert, 'the save ended under the Clear dialog').toBe(true);
    await page.evaluate(() => { (window as any).__holdClearMs = 1500; });
    await page.waitForTimeout(800); // past the dialog's 600 ms guard
    const closedAt = await pageNow(page);
    await d.getByTestId('clear-library-confirm').click();
    await expect(d).toHaveCount(0);
    const cleared = 'Cleared your library: 6 tracks.';
    await expect(page.getByText(cleared, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    const said = await saidOf(page);
    test.info().annotations.push({ type: 'read out', description: said.map((a) => `${Math.round(a.t - closedAt)} ${a.where}: ${a.text.slice(0, 40)}`).join(' | ') });
    expect(saidAs(said, /offline use|Cleared your library/), "only the Clear's line is read").toEqual([['root', cleared]]);
    const adds = (await cardAddsOf(page)).filter((a) => a.t > closedAt && /saved for offline use\./.test(a.text));
    expect(adds, 'the cleared save\'s end line is never put back').toEqual([]);
    await expect(page.getByText('6 tracks saved for offline use.', { exact: true })).toHaveCount(0);
  });

  // R03: a held warning that a later save withdraws while the modal is still up (withdrawStickyToast keeps the toast
  // count: the warning's own check is the guard). The later save is queued behind the failing one, and is small (no
  // progress, no end line of its own), so only the withdrawal acts.
  test('S-3m-f. a warning held under the Sound sheet, withdrawn there by a later save that stores the rest: nothing is put back at the close @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await audioRoom(page, ROOM_FOR_TWO);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 300);
    await openShell(page);
    await openImportSheet(page);
    await page.evaluate(() => { (window as any).__holdKeysMs = 3500; });
    const reads: number = await page.evaluate(() => (window as any).__keysReads);
    await importTones(page, 6, 2, 'full');
    await expect.poll(() => page.evaluate(() => (window as any).__keysReads), { timeout: 10_000, message: 'the first save started' }).toBeGreaterThan(reads);
    await importTones(page, 1, 2, 'late'); // a second save, queued behind the first
    await closeSheet(page, 'sheet-import');
    await openSoundSheet(page);
    await expect.poll(async () => (await saveEvents(page)).some((e) => e.type === 'cache-progress'), { timeout: 10_000, message: 'the first save shows progress' }).toBe(true);
    await page.evaluate(() => { (window as any).__aetheriaCacheLimits = { progressTracks: 1000, batchBytes: 1 }; }); // the second shows none
    await waitSaveEnd(page, 'cache-error');
    await page.evaluate(() => { (window as any).__audioRoom.left = 1e12; }); // room again for the second
    const err = saveOf(await saveEvents(page), 'cache-error').end;
    expect(err.rootInert, 'the warning came under the Sound sheet').toBe(true);
    await expect
      .poll(async () => (await saveEvents(page)).some((e) => e.type === 'cache-ok' && e.what === 'tracks' && e.seq > err.seq), { timeout: 30_000, message: 'the second save stores the rest' })
      .toBe(true);
    const ok = (await saveEvents(page)).find((e) => e.type === 'cache-ok' && e.what === 'tracks' && e.seq > err.seq);
    expect(ok.rootInert, 'and withdrew the warning under the Sound sheet').toBe(true);
    const warning = page.getByText(SOME_FAILED, { exact: true });
    await expect(warning, 'withdrawn').toHaveCount(0);
    await page.waitForTimeout(500);
    const closedAt = await closeSheet(page, 'sheet-sound');
    await page.waitForTimeout(1500);
    await expect(page.getByText(/could not be saved/), 'nothing put back at the close').toHaveCount(0);
    expect((await cardAddsOf(page)).filter((a) => a.t > closedAt), 'no card put in after the close').toEqual([]);
    expect(saidAs(await saidOf(page), /could not be saved/), 'the withdrawn warning is never read').toEqual([]);
    await expectCache(page, { blobs: 7 });
  });

  // R02: a toast raised under the modal while the end line is held replaces it (the toast count moves on). A playlist
  // write that fails (the browser's quota), from the dev hook in a tap's task as in S-4b: its sticky toast with Retry.
  test('S-3m-g. a toast raised under the Sound sheet while the end line is held: at the close that toast stays, and the end line is not put back @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await controlStateSaves(page);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 300);
    await openShell(page);
    await openImportSheet(page);
    await page.evaluate(() => { (window as any).__holdKeysMs = 3500; });
    await importTones(page, 6, 2, 'held');
    await closeSheet(page, 'sheet-import');
    await openSoundSheet(page);
    await waitSaveEnd(page, 'cache-ok');
    expect(saveOf(await saveEvents(page), 'cache-ok').end.rootInert, 'the save ended under the Sound sheet').toBe(true);
    const end = page.getByText('6 tracks saved for offline use.', { exact: true });
    await expect(end, 'held').toHaveCount(1);
    await page.waitForFunction(() => (window as any).__aetheriaPlaylists?.state?.()?.status === 'ready', null, { timeout: 15_000 });
    await page.evaluate(() => { (window as any).__failPlaylistSaves = true; (window as any).__failAsQuota = true; });
    await page.evaluate(() => {
      const w = window as any;
      const ids: string[] = w.__aetheriaLibrary.state().ids;
      const b = document.createElement('button');
      b.addEventListener('click', () => { w.__aetheriaPlaylists.create('Evening', ids); });
      document.body.appendChild(b);
      b.click();
      b.remove();
    });
    const toast = page.getByText(`Couldn’t save the change to Evening: ${NO_ROOM}.`, { exact: true });
    await expect(toast, 'raised under the Sound sheet').toHaveCount(1, { timeout: 15_000 });
    await expect(end, 'it replaced the held end line').toHaveCount(0);
    expect(await rootInert(page)).toBe(true);
    const closedAt = await closeSheet(page, 'sheet-sound');
    await page.waitForTimeout(1500);
    await expect(toast, 'the toast raised under the modal stays').toBeVisible();
    await expect(end, 'the end line is not put back').toHaveCount(0);
    expect((await cardAddsOf(page)).filter((a) => a.t > closedAt && /saved for offline use\./.test(a.text)), 'not put in again').toEqual([]);
    expect(saidAs(await saidOf(page), /saved for offline use\./), 'nor read').toEqual([]);
  });

  // T7 (app N1, tests N-3): the observer's voice() check and the wait's stop. The Sound sheet closed and, 150 ms after
  // #root is live again (within the 500 ms), opened again: nothing goes in under it; the end is read after its close.
  test('S-3m-h. the Sound sheet closed and opened again within the wait: nothing is put in or read under it, and the end is read once after its close @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 300);
    await openShell(page);
    await openImportSheet(page);
    await page.evaluate(() => { (window as any).__holdKeysMs = 3500; });
    await importTones(page, 6, 2, 'again');
    await closeSheet(page, 'sheet-import');
    await openSoundSheet(page);
    await waitSaveEnd(page, 'cache-ok');
    expect(saveOf(await saveEvents(page), 'cache-ok').end.rootInert, 'the save ended under the Sound sheet').toBe(true);
    const end = page.getByText('6 tracks saved for offline use.', { exact: true });
    await page.waitForTimeout(800);
    const closedAt = await pageNow(page);
    await page.keyboard.press('Escape');
    // In the page: as soon as #root is live again, Output's tap 150 ms later opens the Sound sheet again.
    await page.evaluate(() => new Promise<void>((resolve) => {
      const root = document.getElementById('root') as any;
      const again = () => setTimeout(() => { (document.querySelector('[data-testid="np-output"]') as HTMLElement).click(); resolve(); }, 150);
      if (!root.inert) { again(); return; }
      new MutationObserver((_, o) => { if (!root.inert) { o.disconnect(); again(); } }).observe(root, { attributes: true, attributeFilter: ['inert'] });
    }));
    await expect(page.getByTestId('sheet-sound')).toBeVisible();
    expect(await rootInert(page), '#root inert again under it').toBe(true);
    const log: { t: number; inert: boolean }[] = await page.evaluate(() => (window as any).__rootLog);
    const live = log.find((x) => x.t > closedAt && !x.inert);
    const back = log.find((x) => live && x.t > live.t && x.inert);
    expect(live && back && back.t - live.t, 'opened again within the 500 ms of #root being live').toBeLessThan(450);
    await page.waitForTimeout(1500); // past the 500 ms from the first close
    expect((await cardAddsOf(page)).filter((a) => a.t > back!.t), 'nothing put in under the second sheet').toEqual([]);
    expect((await saidOf(page)).filter((a) => a.t > closedAt), 'nothing read meanwhile').toEqual([]);
    await expect(end, 'still held').toHaveCount(1);
    const closed2 = await closeSheet(page, 'sheet-sound');
    const said = await waitSaid(page, /saved for offline use\./);
    await page.waitForTimeout(1000);
    test.info().annotations.push({ type: 'read out', description: said.map((a) => `${Math.round(a.t - closedAt)} ${a.where}: ${a.text.slice(0, 40)}`).join(' | ') });
    const ends = said.filter((a) => /saved for offline use\./.test(a.text));
    expect(ends.map((a) => [a.where, a.text]), 'the end read once, by the toast').toEqual([['root', '6 tracks saved for offline use.']]);
    expect(ends[0].t, 'after the second close').toBeGreaterThan(closed2);
    expectNothingTwice(await saidOf(page));
  });

  // T8 (tests N-4): two saves ending under one modal. The later end line takes the held one's place (heldEndUp); only it
  // is read, once, after the close.
  test('S-3m-i. two saves end under the Sound sheet: only the later end line is read, once, after the close @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 300);
    await openShell(page);
    await openImportSheet(page);
    await page.evaluate(() => { (window as any).__holdKeysMs = 3500; });
    const reads: number = await page.evaluate(() => (window as any).__keysReads);
    await importTones(page, 6, 2, 'one');
    await expect.poll(() => page.evaluate(() => (window as any).__keysReads), { timeout: 10_000, message: 'the first save started' }).toBeGreaterThan(reads);
    await importTones(page, 4, 2, 'two'); // a second save, queued behind the first
    await closeSheet(page, 'sheet-import');
    await openSoundSheet(page);
    await expect
      .poll(async () => {
        const ev = await saveEvents(page);
        const seqs = [...new Set(ev.filter((e) => e.type === 'cache-progress').map((e) => e.seq))];
        return seqs.filter((q) => ev.some((e) => e.type === 'cache-ok' && e.what === 'tracks' && e.seq === q)).length;
      }, { timeout: 40_000, message: 'both saves ended' })
      .toBe(2);
    const oks = (await saveEvents(page)).filter((e) => e.type === 'cache-ok' && e.what === 'tracks');
    expect(oks.map((e) => e.rootInert), 'both ended under the Sound sheet').toEqual([true, true]);
    await page.waitForTimeout(800);
    const closedAt = await closeSheet(page, 'sheet-sound');
    const said = await waitSaid(page, /saved for offline use\./);
    await page.waitForTimeout(1000);
    test.info().annotations.push({ type: 'read out', description: said.map((a) => `${Math.round(a.t - closedAt)} ${a.where}: ${a.text.slice(0, 40)}`).join(' | ') });
    const ends = (await saidOf(page)).filter((a) => /saved for offline use\./.test(a.text));
    expect(ends.map((a) => [a.where, a.text]), 'only the later end line, read once').toEqual([['root', '4 tracks saved for offline use.']]);
    expect(ends[0].t, 'after the close').toBeGreaterThan(closedAt);
    await expect(page.getByText('6 tracks saved for offline use.', { exact: true }), 'the earlier one is not left up').toHaveCount(0);
    expectNothingTwice(await saidOf(page));
  });
});

test.describe("the Import sheet's own lines (a phone, the new layout)", () => {
  test.use({ layoutSeed: 'new', viewport: PHONE_VIEWPORT });

  // rev2 tests SF-a, and C2 (the app lens's stale.spec scenario).
  test('S-3f. a save that fails part-way with the Import sheet open: "4 of 6" in the sheet, read once; a later small failure replaces it with its count, read once; it outlives the toast\'s Dismiss; a later save that stores the rest takes it away @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await audioRoom(page, ROOM_FOR_TWO);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 300);
    await openShell(page);
    await openImportSheet(page);
    const line = importSheet(page).getByTestId('import-save-line');
    await importTones(page, 6, 2, 'part');
    await expect(line).toHaveText(SOME_FAILED, { timeout: 30_000 });
    // C2: a later small save (no progress: the threshold raised) that fails whole, the sheet still open: the 4, and 1 more.
    await page.evaluate(() => { (window as any).__aetheriaCacheLimits = { progressTracks: 1000, batchBytes: 1 }; });
    await importTones(page, 1, 2, 'late');
    const five = `5 tracks could not be saved for offline use: ${NO_ROOM}. They play now but won't be here after a reload.`;
    await expect(line, "the later failure's words replace the sheet's line").toHaveText(five, { timeout: 30_000 });
    expect(saidAs(await saidOf(page), /could not be saved/), 'each read once, by the sheet').toEqual([['portal', SOME_FAILED], ['portal', five]]);
    // The toast's Dismiss: the sheet's line is its own surface, and stays (it is true until the tracks are stored).
    await closeSheet(page, 'sheet-import');
    const card = page.locator('div[aria-atomic="true"]').filter({ hasText: 'could not be saved' });
    await expect(card).toHaveText(five);
    await card.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(card).toHaveCount(0);
    await openImportSheet(page);
    await expect(line, "it outlives the toast's Dismiss").toHaveText(five);
    // Room again: a later small save stores the rest, and the line goes with the warning it copies.
    await page.evaluate(() => { (window as any).__audioRoom.left = 1e12; });
    await importTones(page, 1, 2, 'room');
    await expect.poll(async () => (await saveEvents(page)).some((e) => e.type === 'cache-ok' && e.what === 'tracks'), { timeout: 30_000, message: 'the save that stores the rest' }).toBe(true);
    await expect(line, 'withdrawn with the warning').toHaveCount(0);
    await expectCache(page, { blobs: 8 }, 15_000);
    const said = await saidOf(page);
    test.info().annotations.push({ type: 'read out', description: said.map((a) => `${a.where}: ${a.text.slice(0, 40)}`).join(' | ') });
    expectNothingTwice(said);
  });

  // Fix round 3 (rev3 tests SF-4): each of C2's two later-failure conditions on its own. P3: the Import sheet open as
  // the phone's modal, no line yet, and a small save (no progress) that fails whole: its warning is the sheet's line.
  test('S-3n. the Import sheet opened fresh, no line: a small save that fails whole puts its warning in the sheet, read once there @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await stubStorageFull(page); // every audio batch fails (the browser's quota)
    await cacheLimits(page, { progressTracks: 1000, batchBytes: 1 }); // no progress for it
    await slowBatchesAndWatchCards(page, 0);
    await openShell(page);
    await openImportSheet(page);
    const line = importSheet(page).getByTestId('import-save-line');
    await expect(line, 'no line before').toHaveCount(0);
    await importTones(page, 2, 2, 'fresh');
    await expect.poll(async () => (await saveEvents(page)).some((e) => e.type === 'cache-error' && e.what === 'tracks'), { timeout: 30_000, message: 'the save fails' }).toBe(true);
    const ev = await saveEvents(page);
    expect(ev.filter((e) => e.type === 'cache-progress'), 'a small save: no progress').toEqual([]);
    expect(ev.find((e) => e.type === 'cache-error' && e.what === 'tracks').importOpen, 'the sheet was open').toBe(true);
    const two = `2 tracks could not be saved for offline use: ${NO_ROOM}. They play now but won't be here after a reload.`;
    await expect(line, 'its warning in the sheet').toHaveText(two, { timeout: 5_000 });
    await page.waitForTimeout(500);
    expect(saidAs(await saidOf(page), /could not be saved/), 'read once, by the sheet').toEqual([['portal', two]]);
  });

  // C2's `lineUp` alone: a line up while the sheet is closed (a save that failed part-way with it open), then a later
  // small failure with the sheet closed (its read of the stored tracks held until then): opened, the sheet shows it.
  test("S-3u. the sheet's failed line is up and the sheet closed: a later small failure replaces it, and the sheet opened shows the new count @mobile", async ({ page }) => {
    test.setTimeout(150_000);
    await audioRoom(page, ROOM_FOR_TWO);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 300);
    await openShell(page);
    await openImportSheet(page);
    const line = importSheet(page).getByTestId('import-save-line');
    await importTones(page, 6, 2, 'part');
    await expect(line).toHaveText(SOME_FAILED, { timeout: 30_000 });
    // A later small save (no progress) that starts only after the sheet has closed, and fails whole: the 4, and 1 more.
    await page.evaluate(() => { const w = window as any; w.__aetheriaCacheLimits = { progressTracks: 1000, batchBytes: 1 }; w.__holdKeysMs = 3000; });
    await importTones(page, 1, 2, 'late');
    await closeSheet(page, 'sheet-import');
    await expect.poll(async () => (await saveEvents(page)).filter((e) => e.type === 'cache-error' && e.what === 'tracks').length, { timeout: 30_000, message: 'the later save fails' }).toBe(2);
    const later = (await saveEvents(page)).filter((e) => e.type === 'cache-error' && e.what === 'tracks')[1];
    expect([later.count, later.importOpen], 'five tracks, with the sheet closed').toEqual([5, false]);
    const five = `5 tracks could not be saved for offline use: ${NO_ROOM}. They play now but won't be here after a reload.`;
    await openImportSheet(page);
    await expect(line, "the sheet's line follows the later failure").toHaveText(five);
  });

  // C5 (app N1): the sheet doesn't jump under a finger.
  test("S-3h. the Import sheet keeps the line's room: none before the save; from the first line on, the tallest line's, until it closes @mobile", async ({ page }) => {
    test.setTimeout(120_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 400);
    await openShell(page);
    await openImportSheet(page);
    const box = () =>
      page.evaluate(() => {
        const r = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
        const region = document.querySelector('[data-testid="import-save"]') as HTMLElement;
        const last = r('[data-testid="import-last"]');
        const sheetH = r('[data-testid="sheet-import"] [role="dialog"]')!.height;
        return {
          regionH: region.getBoundingClientRect().height,
          regionMargin: getComputedStyle(region).marginTop,
          // The sheet's height without the last-import card (whose lines change as the import settles).
          rest: sheetH - (last ? last.height : 0),
          lineH: r('[data-testid="import-save-line"]')?.height ?? 0,
        };
      });
    const b0 = await box();
    expect([b0.regionH, b0.regionMargin], 'before any save line the region takes no room').toEqual([0, '0px']);
    await importTones(page, 8, 2, 'room');
    const line = importSheet(page).getByTestId('import-save-line');
    await expect(line).toHaveText(/^Saving for offline use: [1-7] of 8 tracks/, { timeout: 15_000 });
    const b1 = await box();
    await expect(line).toHaveText('8 tracks saved for offline use.', { timeout: 30_000 });
    const b2 = await box();
    await expect(line).toHaveCount(0, { timeout: 8_000 });
    const b3 = await box();
    test.info().annotations.push({ type: 'boxes', description: JSON.stringify({ b0, b1, b2, b3 }) });
    expect(b1.regionH, 'the progress line takes its room').toBeGreaterThan(0);
    expect(b2.lineH, 'the end line is the shorter (one line, the progress two)').toBeLessThan(b1.lineH);
    expect(b2.regionH, 'the room stays at the tallest line').toBeCloseTo(b1.regionH, 0);
    expect(b3.regionH, 'and with no line').toBeCloseTo(b1.regionH, 0);
    expect(b3.regionMargin, 'its gap kept too').toBe('12px');
    expect(b2.rest, 'the sheet keeps its height').toBeCloseTo(b1.rest, 0);
    expect(b3.rest, 'the sheet keeps its height').toBeCloseTo(b1.rest, 0);
    // A new opening starts with no room kept.
    await closeSheet(page, 'sheet-import');
    await openImportSheet(page);
    const b4 = await box();
    expect([b4.regionH, b4.regionMargin], 'opened again: no room kept').toEqual([0, '0px']);
  });

  // rev2 tests N-b: the line's generation filter.
  test('G2s. a Clear mid-save with the Import sheet closed: opened after it, the sheet shows no save line @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 700);
    await openShell(page);
    await openImportSheet(page);
    await importTones(page, 16, 2, 'wipe');
    await expect(importSheet(page).getByTestId('import-save-line')).toHaveText(/^Saving for offline use: [1-9] of 16 tracks/, { timeout: 15_000 });
    await closeSheet(page, 'sheet-import');
    const toggle = page.getByTestId('library-health-toggle');
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.getByTestId('library-tools-clear').click();
    const d = page.getByRole('alertdialog', { name: 'Clear your library?' });
    await expect(d).toBeVisible();
    await page.waitForTimeout(700); // past the dialog's 600 ms guard
    await d.getByTestId('clear-library-confirm').click();
    await expectCache(page, { blobs: 0 }, 15_000);
    const ev = await saveEvents(page);
    const seq = ev.find((e) => e.type === 'cache-progress')?.seq;
    expect(ev.some((e) => e.type === 'cache-ok' && e.what === 'tracks' && e.seq === seq), 'the Clear came mid-save').toBe(false);
    await page.waitForTimeout(1500);
    await openImportSheet(page);
    await page.waitForTimeout(1000);
    await expect(importSheet(page).getByTestId('import-save-line'), 'no stale line from the cleared save').toHaveCount(0);
  });

  // rev2 tests N-d: App's total-0 path, end to end.
  test("A4e. everything a big save had left to store is deleted while its batch fails: its toast goes, no end line shows, and the sheet's line goes @mobile", async ({ page }) => {
    test.setTimeout(120_000);
    await stubStorageFull(page); // every audio batch fails (the browser's quota)
    await cacheLimits(page, { progressBytes: 1 }); // a one-track save shows its progress
    await slowBatchesAndWatchCards(page, 0);
    await openShell(page);
    await openImportSheet(page);
    await page.evaluate(() => { (window as any).__holdFail = true; }); // its batch's failure waits for the delete
    await importTones(page, 1, 2, 'gone');
    await expect(importSheet(page).getByTestId('import-save-line')).toHaveText(progressLine(0, 1), { timeout: 10_000 });
    await closeSheet(page, 'sheet-import');
    const card = page.getByTestId('cache-progress');
    await expect(card).toHaveText(progressLine(0, 1));
    await rowMenu(page, 'gone-01').click();
    await page.getByTestId('library-menu-delete').click();
    await confirmDelete(page);
    await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the track is deleted' }).toBe(0);
    await page.evaluate(() => (window as any).__releaseFail());
    await expect.poll(async () => (await saveEvents(page)).some((e) => e.type === 'cache-ok' && e.what === 'tracks'), { timeout: 10_000, message: "the save's cache-ok" }).toBe(true);
    const ev = await saveEvents(page);
    expect(ev.filter((e) => e.type === 'cache-progress').map((e) => `${e.saved}/${e.total}`), 'its last progress: nothing left').toEqual(['0/1', '0/0']);
    expect(ev.filter((e) => e.type === 'cache-error'), 'no warning').toEqual([]);
    await expect(card, 'its toast goes').toHaveCount(0, { timeout: 3_000 });
    await page.waitForTimeout(800);
    await openImportSheet(page);
    await expect(importSheet(page).getByTestId('import-save-line'), "and the sheet's line").toHaveCount(0);
    const log: CardLog = await page.evaluate(() => (window as any).__offlineCards);
    expect(log.flatMap((e) => e.cards).filter((c) => /saved for offline use\.|could not be saved/.test(c.text)), 'no end line, no warning').toEqual([]);
  });
});

// C3 (logic N3): the progress line's singular.
test('S-3s. one track over the byte threshold: "Saving for offline use: 0 of 1 track.", then "1 track saved for offline use." @mobile', async ({ page }) => {
  await cacheLimits(page, { progressBytes: 1 }); // any track is over 1 byte: a one-track save shows its progress
  await slowBatchesAndWatchCards(page, 1500); // its one batch reaches the app 1.5 s after it commits
  await openApp(page);
  await importTones(page, 1, 2, 'one');
  await expect(page.getByTestId('cache-progress')).toHaveText("Saving for offline use: 0 of 1 track. Keep the app open until it's done.", { timeout: 10_000 });
  await expect(page.getByText('1 track saved for offline use.', { exact: true })).toBeVisible({ timeout: 15_000 });
});

// rev2 tests SF-c, App's side: a later save that fails before it knows its tracks says nothing.
test('S-2k. a later save whose read of the stored tracks fails reports nothing: the "4 of 6" warning stands @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await audioRoom(page, ROOM_FOR_TWO);
  await cacheLimits(page, { batchBytes: 1 });
  await controlStateSaves(page);
  await page.addInitScript(() => {
    const w = window as any;
    w.__failKeysRead = false;
    w.__keysReadsFailed = 0;
    const getAllKeys = IDBObjectStore.prototype.getAllKeys;
    IDBObjectStore.prototype.getAllKeys = function (this: IDBObjectStore, ...args: unknown[]) {
      const request = (getAllKeys as any).apply(this, args);
      if (this.name === 'blobs' && w.__failKeysRead) {
        w.__keysReadsFailed++;
        try { this.transaction.abort(); } catch { /* already over */ }
      }
      return request;
    } as typeof getAllKeys;
  });
  await openApp(page);
  await importTones(page, 6, 2, 'keys');
  const warning = page.getByText(SOME_FAILED, { exact: true });
  await expect(warning).toBeVisible({ timeout: 30_000 });
  // Room again, but the next save's read of the stored tracks fails: it doesn't know what it would store.
  const before: number = await page.evaluate(() => { const w = window as any; w.__audioRoom.left = 1e12; w.__failKeysRead = true; return w.__cacheEvents.length; });
  await importTones(page, 1, 2, 'next');
  await expect.poll(() => page.evaluate(() => (window as any).__keysReadsFailed), { timeout: 15_000, message: "the next save's read failed" }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  const after: any[] = (await page.evaluate(() => (window as any).__cacheEvents)).slice(before);
  expect(after.filter((e) => e.what === 'tracks'), 'no tracks report from it: no cache-ok, no cache-error').toEqual([]);
  await expect(warning, 'the warning stands').toBeVisible();
  await expectCache(page, { blobs: 2 });
});

// rev2 tests N-c: call 3's order (the end line decided after the withdrawal).
test('W1. a tracks warning withdrawn by a later big save: the end line takes the slot it leaves @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await audioRoom(page, ROOM_FOR_TWO);
  await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
  await slowBatchesAndWatchCards(page, 500);
  await openApp(page);
  await importTones(page, 6, 2, 'first');
  const warning = page.getByText(SOME_FAILED, { exact: true });
  await expect(warning).toBeVisible({ timeout: 30_000 });
  // Room again: the next save stores the 4 and 4 more (8, over the threshold: its progress covers the warning).
  await page.evaluate(() => { (window as any).__audioRoom.left = 1e12; });
  await importTones(page, 4, 2, 'more');
  const card = page.getByTestId('cache-progress');
  await expect(card).toHaveText(/^Saving for offline use: \d of 8 tracks/, { timeout: 10_000 });
  // Dismissed: the warning it covered is back in the slot (and the progress stays away, G1).
  await card.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(warning, 'the warning back in the slot').toBeVisible();
  await expect(page.getByText('8 tracks saved for offline use.', { exact: true }), 'the save withdraws the warning, and its end line takes the slot').toBeVisible({ timeout: 30_000 });
  await expect(warning).toHaveCount(0);
});

// C6 (app N3): the line re-renders the Import sheet's body only, never the health card (LibraryStatusContext).
for (const where of ['desktop', 'phone'] as const) {
  test.describe(`the health card during a save (${where})`, () => {
    test.use({ layoutSeed: 'new', ...(where === 'phone' ? { viewport: PHONE_VIEWPORT } : {}) });
    test(`H1. ${where}: no health card render from the save's first line to its end line's own render; the line re-renders only the Import sheet's body, at most 2 a change + 4 @mobile`, async ({ page }) => {
      test.setTimeout(120_000);
      await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
      await slowBatchesAndWatchCards(page, 700);
      await openShell(page);
      await openImportSheet(page);
      if (where === 'phone') {
        // Fix round 3 (rev3 tests SF-4): a tone plays through the save, so App renders for its own reasons too (it
        // re-renders while playing), and a body that followed App rather than the line would show.
        await importTones(page, 1, 90, 'long');
        await expectCache(page, { blobs: 1 }, 30_000);
        await closeSheet(page, 'sheet-import');
        await libraryRowButton(page, 'long-01').click();
        await page.waitForTimeout(2500);
        await openImportSheet(page);
      }
      await page.evaluate(() => { (window as any).__holdKeysMs = 4000; }); // the import settles before the save starts
      await importTones(page, 8, 2, 'calm');
      // The phone keeps its Import sheet open (the line's one reader); the desktop's panel closes, back to the Library.
      if (where === 'desktop') await closeSheet(page, 'sheet-import');
      await waitSaveEnd(page, 'cache-ok');
      // Fix round 3 (rev3 tests N-2): the window ends after the end line's own render (the cache-ok's report comes
      // before it), in the sheet on the phone, the toast on the desktop.
      const endLine = where === 'phone' ? importSheet(page).getByTestId('import-save-line') : page.getByText(/^8 tracks saved for offline use\.$/);
      await expect(endLine).toHaveText('8 tracks saved for offline use.', { timeout: 10_000 });
      await page.waitForTimeout(300);
      const last = await page.evaluate(() => ({ t: performance.now(), r: { ...((window as any).__aetheriaRenders ?? {}) } }));
      const snaps: any[] = await page.evaluate(() => (window as any).__renderSnaps);
      const seq = snaps.find((s) => s.type === 'cache-progress')?.seq;
      const first = snaps.find((s) => s.type === 'cache-progress' && s.seq === seq);
      const d = (name: string) => (last.r[name] ?? 0) - (first.r[name] ?? 0);
      const lines: { t: number }[] = await page.evaluate(() => (window as any).__sheetLines);
      const changes = lines.filter((l) => l.t > first.t && l.t <= last.t).length;
      const bound = 2 * changes + 4;
      test.info().annotations.push({ type: 'renders in the save', description: JSON.stringify({ App: d('App'), HealthCard: d('HealthCard'), ImportBody: d('ImportBody'), ms: Math.round(last.t - first.t), lineChanges: changes, bound }) });
      expect(first.r.HealthCard ?? 0, 'the health card is mounted (it rendered before the save)').toBeGreaterThan(0);
      expect(d('HealthCard'), 'no health card render during the save').toBe(0);
      if (where === 'phone') {
        expect(changes, 'the line changed in the window, its end line included').toBeGreaterThanOrEqual(3);
        expect(d('App'), 'App rendered more than the bound (the tone plays), so the bound tells the two apart').toBeGreaterThan(bound);
        expect(d('ImportBody'), 'the Import sheet follows the line').toBeGreaterThan(0);
        expect(d('ImportBody'), `at most 2 renders a line change (StrictMode) + 4 (the room's growth), not App's ${d('App')}`).toBeLessThanOrEqual(bound);
      }
    });
  });
}

// rev2 tests N-a: the Car take-down gives back a warning the progress toast covered.
test.describe('on the Car screen, a covered warning (a phone, Output = Car)', () => {
  test.use({ layoutSeed: 'new', viewport: PHONE_VIEWPORT });
  test('A7w. the Car screen takes down a progress toast that covered a state warning: the warning comes back while the save runs @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await controlStateSaves(page);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 900);
    await page.addInitScript(({ engine, output }) => {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      localStorage.setItem(engine, 'v2');
      localStorage.setItem(output, 'car');
    }, { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY });
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await phoneSize(page);
    await expect(page.getByTestId('view-car')).toBeVisible({ timeout: 30_000 });
    await openLibraryTab(page);
    await page.getByTestId('library-import').click();
    // From now on the library's metadata saves fail (the browser's quota): a state warning, up before the big save.
    await page.evaluate(() => { (window as any).__failStateSaves = true; (window as any).__failAsQuota = true; });
    await importTones(page, 1, 2, 'first');
    const stateWarning = page.getByText(`Your latest library changes could not be saved: ${NO_ROOM}. Recent analysis and list changes may be missing after a reload.`, { exact: true });
    await expect(stateWarning).toHaveCount(1, { timeout: 20_000 });
    await importTones(page, 12, 2, 'drive');
    await expect(page.getByTestId('import-save-line')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    const card = page.getByTestId('cache-progress');
    await expect(card, 'on the Library tab the progress toast shows').toBeVisible();
    await expect(stateWarning, 'over the state warning').toHaveCount(0);
    await tab(page, 'now');
    await expect(page.getByTestId('view-car')).toBeVisible();
    await expect(card, 'gone from the Car screen').toHaveCount(0, { timeout: 1_000 });
    await expect(stateWarning, 'the warning it covered is back').toBeVisible();
    const ev = await saveEvents(page);
    const seq = ev.find((e) => e.type === 'cache-progress')?.seq;
    expect(ev.some((e) => e.type === 'cache-ok' && e.what === 'tracks' && e.seq === seq), 'while the save still runs').toBe(false);
  });
});

// v16.8.5 fix round 1 (T5): the toast's promises (the build's report §2.6), rev1's probes G1-G3.
test('G1. a dismissed progress toast stays away for the rest of its save; the end line still shows @mobile', async ({ page }) => {
  await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
  await slowBatchesAndWatchCards(page, 700);
  await openApp(page);
  await importTones(page, 8, 2, 'gone');
  const card = page.getByTestId('cache-progress');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole('button', { name: 'Dismiss', exact: true }).click();
  const at = await page.evaluate(() => performance.now());
  await expect(page.getByText('8 tracks saved for offline use.', { exact: true })).toBeVisible({ timeout: 30_000 });
  const seen: number[] = await page.evaluate(() => (window as any).__progressSeen);
  expect(seen.filter((t) => t > at), 'the progress card never came back after Dismiss').toEqual([]);
  const events: any[] = await page.evaluate(() => (window as any).__saveEvents);
  expect(events.filter((e) => e.type === 'cache-progress' && e.t > at).length, 'the save went on reporting after the Dismiss').toBeGreaterThanOrEqual(2);
});

test('G2. a Clear mid-save ends the progress toast for good @mobile', async ({ page }) => {
  await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
  await slowBatchesAndWatchCards(page, 200);
  await openApp(page);
  await importTones(page, 16, 2, 'wipe');
  const card = page.getByTestId('cache-progress');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(/Saving for offline use: [3-9] of 16/, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm deleting all 16 tracks from this device', exact: true }).click();
  const at = await page.evaluate(() => performance.now());
  await expectCache(page, { blobs: 0 }, 15_000);
  await page.waitForTimeout(2500);
  const seen: number[] = await page.evaluate(() => (window as any).__progressSeen);
  expect(seen.filter((t) => t > at + 50), 'no progress card after the Clear').toEqual([]);
  await expect(card).toHaveCount(0);
  await expect(page.getByText(/saved for offline use\./)).toHaveCount(0);
});

test('G3. the progress toast never covers the reload notice @mobile', async ({ page }) => {
  await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
  await slowBatchesAndWatchCards(page, 700);
  await openApp(page);
  await importTones(page, 10, 2, 'held');
  await expect(page.getByTestId('cache-progress')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => { (window as any).__samePage = true; window.dispatchEvent(new Event('aetheria:update-ready')); });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  const notice = page.getByText('Saving your library before reloading…');
  await expect(notice).toBeVisible();
  const at = await page.evaluate(() => performance.now());
  // The save has seconds to go: the notice stays, and the progress card doesn't come back over it.
  let looks = 0;
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(400);
    // One look at a time (a reload between two evaluates must not read the new page's empty list as a pass or throw).
    const r = await page
      .evaluate(() => ({ same: (window as any).__samePage === true, seen: (window as any).__progressSeen as number[] }))
      .catch(() => ({ same: false, seen: [] as number[] }));
    if (!r.same) break; // reloaded: the save ended
    looks++;
    expect(r.seen.filter((t) => t > at), 'no progress card over the reload notice').toEqual([]);
  }
  expect(looks, 'the save was still running for at least two looks').toBeGreaterThanOrEqual(2);
});

// v16.8.5 fix round 1 (T10): A5-A7, the toast's other rules.
test('A5. the end line never covers a state warning raised during the save @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await controlStateSaves(page);
  await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
  await slowBatchesAndWatchCards(page, 900);
  await openApp(page);
  await importTones(page, 8, 2, 'meta');
  await expect(page.getByTestId('cache-progress')).toBeVisible({ timeout: 10_000 });
  // From now on the library's metadata saves fail (the browser's quota): the next one, a moment after the import.
  await page.evaluate(() => { (window as any).__failStateSaves = true; (window as any).__failAsQuota = true; });
  const stateWarning = page.getByText(`Your latest library changes could not be saved: ${NO_ROOM}. Recent analysis and list changes may be missing after a reload.`, { exact: true });
  await expect(stateWarning).toBeVisible({ timeout: 20_000 });
  const tracksSeq = await page.evaluate(() => ((window as any).__saveEvents as any[]).find((e) => e.type === 'cache-progress')?.seq);
  await expect.poll(() => page.evaluate((seq) => ((window as any).__saveEvents as any[]).some((e) => e.type === 'cache-ok' && e.what === 'tracks' && e.seq === seq), tracksSeq), { timeout: 30_000 }).toBe(true);
  const events: any[] = await page.evaluate(() => (window as any).__saveEvents);
  const stateErrAt = events.find((e) => e.type === 'cache-error' && e.what === 'state')?.t ?? Infinity;
  const okAt = events.find((e) => e.type === 'cache-ok' && e.what === 'tracks' && e.seq === tracksSeq).t;
  expect(stateErrAt, 'the state warning came while the save was still running').toBeLessThan(okAt);
  await page.waitForTimeout(1000);
  await expect(stateWarning, 'the state warning is still up after the save ended').toBeVisible();
  const log: CardLog = await page.evaluate(() => (window as any).__offlineCards);
  expect(log.flatMap((e) => e.cards).filter((c) => /saved for offline use\./.test(c.text)), 'no end line over it').toEqual([]);
});

test("A6. a batch slower than the toast's two minutes: the progress toast stays up while it writes, then ends with the save @mobile", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
  await slowBatchesAndWatchCards(page, 0, { firstMs: 130_000 }); // the first batch's commit reaches the app 130 s late
  await openApp(page);
  await importTones(page, 4, 2, 'slow');
  const card = page.getByTestId('cache-progress');
  await expect(card).toHaveText(progressLine(0, 4), { timeout: 10_000 });
  await page.clock.fastForward(125_000); // past the toast's 120 s, the batch still writing
  await page.waitForTimeout(300);
  await expect(card, 'still up past its 120 s while its save runs').toHaveText(progressLine(0, 4));
  const onOff: { on: boolean }[] = await page.evaluate(() => (window as any).__progressLog);
  expect(onOff.map((x) => x.on), 'it never went in between').toEqual([true]);
  await page.clock.fastForward(10_000); // the slow batch lands; the rest are quick
  await expect(page.getByText('4 tracks saved for offline use.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(card, 'and it ends with the save').toHaveCount(0);
  await expectCache(page, { blobs: 4 });
});

test.describe('on the Car screen (a phone, Output = Car)', () => {
  test.use({ layoutSeed: 'new', viewport: PHONE_VIEWPORT });
  test('A7. no progress toast on the Car screen: one up when it appears goes, none comes back while the save runs; the end line still shows @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await cacheLimits(page, { progressTracks: 3, batchBytes: 1 });
    await slowBatchesAndWatchCards(page, 900);
    await page.addInitScript(({ engine, output }) => {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      localStorage.setItem(engine, 'v2');
      localStorage.setItem(output, 'car');
    }, { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY });
    await page.goto('/');
    await acceptDisclaimerNew(page);
    await phoneSize(page);
    await expect(page.getByTestId('view-car')).toBeVisible({ timeout: 30_000 });
    // The import, from the Library tab's Import sheet (the Car screen has none); then back to Now Playing: Car.
    await openLibraryTab(page);
    await page.getByTestId('library-import').click();
    await importTones(page, 12, 2, 'drive');
    await expect(page.getByTestId('import-save-line')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    const card = page.getByTestId('cache-progress');
    await expect(card, 'on the Library tab the toast shows').toBeVisible();
    await tab(page, 'now');
    await expect(page.getByTestId('view-car')).toBeVisible();
    const carAt = await page.evaluate(() => performance.now());
    await expect(card, 'gone from the Car screen').toHaveCount(0, { timeout: 1_000 });
    await expect(page.getByText('12 tracks saved for offline use.', { exact: true }), 'the end line shows on the Car screen').toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('view-car')).toBeVisible();
    const seen: number[] = await page.evaluate(() => (window as any).__progressSeen);
    expect(seen.filter((t) => t > carAt), 'no progress card came back on the Car screen').toEqual([]);
    const events: any[] = await page.evaluate(() => (window as any).__saveEvents);
    expect(events.filter((e) => e.type === 'cache-progress' && e.t > carAt + 1000).length, 'the save went on for seconds on the Car screen').toBeGreaterThanOrEqual(3);
  });
});

test('S-3b. a small save (not over the threshold) shows no progress and no end line @mobile', async ({ page }) => {
  await cacheLimits(page, { progressTracks: 3 });
  await slowBatchesAndWatchCards(page, 0);
  await openApp(page);
  await importTones(page, 3, 2, 'small');
  await expectCache(page, { blobs: 3 });
  await page.waitForTimeout(1500);
  const log: CardLog = await page.evaluate(() => (window as any).__offlineCards);
  expect(log.flatMap((e) => e.cards), 'no offline-use card at all').toEqual([]);
});

test('S-4a. a state save the browser has no room for: the warning names the browser, not the device @mobile', async ({ page }) => {
  await controlStateSaves(page);
  await openApp(page);
  await importTones(page, 2, 2, 'state');
  await expectCache(page, { blobs: 2, library: 2 });
  await page.evaluate(() => { (window as any).__failStateSaves = true; (window as any).__failAsQuota = true; });
  await importTones(page, 1, 2, 'more');
  await expect(page.getByText(`Your latest library changes could not be saved: ${NO_ROOM}. Recent analysis and list changes may be missing after a reload.`, { exact: true })).toBeVisible({ timeout: 15_000 });
  const events: any[] = await page.evaluate(() => (window as any).__cacheEvents);
  expect(events.some((e) => e.type === 'cache-error' && e.what === 'state' && e.reason === 'storage-full'), 'a storage-full state report').toBe(true);
  await expect(page.getByText(/device's storage/)).toHaveCount(0);
});

test('S-4b. a playlist write the browser has no room for: the sticky toast names the browser, with Retry @mobile', async ({ page }) => {
  await controlStateSaves(page);
  await openApp(page);
  await importTones(page, 2, 2, 'list');
  await expectCache(page, { blobs: 2, library: 2 });
  await page.waitForFunction(() => (window as any).__aetheriaPlaylists?.state?.()?.status === 'ready', null, { timeout: 15_000 });
  await page.evaluate(() => { (window as any).__failPlaylistSaves = true; (window as any).__failAsQuota = true; });
  // Make a playlist of the two through the dev hook, inside a click (a tap's task, as the UI makes it).
  await page.evaluate(() => {
    const w = window as any;
    const ids: string[] = w.__aetheriaLibrary.state().ids;
    const b = document.createElement('button');
    b.addEventListener('click', () => { w.__aetheriaPlaylists.create('Evening', ids); });
    document.body.appendChild(b);
    b.click();
    b.remove();
  });
  const toast = page.getByText(`Couldn’t save the change to Evening: ${NO_ROOM}.`, { exact: true });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  // Room again: Retry writes it.
  await page.evaluate(() => { (window as any).__failPlaylistSaves = false; });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(toast).toBeHidden();
  const keys = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all: any[] = await new Promise((res) => { const r = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').getAllKeys(); r.onsuccess = () => res(r.result); });
    db.close();
    return all.map(String).filter((k) => k.startsWith('pl:'));
  });
  expect(keys.length, 'the playlist is stored after Retry').toBe(1);
});
