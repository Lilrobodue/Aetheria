import { test as base, expect, ON_DEVICE } from './fixtures';
import { TEST_ORIGIN } from './adb';
import { openApp, acceptDisclaimer, cacheCounts } from './helpers';

// v16.8.5, the phone gate's big save (spec §3.4): an import of synthetic WAV-sized tones totalling about 11.5 GiB,
// through the app's real import path (the "Add files" input's change event, as a pick fires it), is stored whole; the
// progress toast shows, then "N tracks saved for offline use."; a reload restores every track; the time of each step is
// recorded; then the app's Clear empties the test origin and its usage is back to about 0.
//
// Runs ONLY when asked for (playwright.config.ts ignores this file unless E2E_BIG_SAVE is set), on the coordinator's
// phone gate, never production:
//   cd e2e
//   E2E_DEVICE=SCAIOC637555A3M E2E_PORT=3299 E2E_REUSE_SERVER=1 E2E_BIG_SAVE=1 \
//     npx playwright test tests/big-save.spec.ts --project=android --reporter=line
// (the gate's server already serves localhost:3299 through `adb reverse`; without E2E_REUSE_SERVER the config starts one).
// A desktop dry run of the script itself, small (62 files of 2 MB: still over the 50-track threshold):
//   E2E_PORT=3195 E2E_BIG_SAVE=1 E2E_BIG_SAVE_GIB=0.12 E2E_BIG_SAVE_FILE_MB=2 npx playwright test tests/big-save.spec.ts --project=desktop
//
// Safe beside the user's own app in another origin:
//   - the fixture's device tab is a NEW tab at the test origin (localhost:<E2E_PORT>, never 3100); it clears only that
//     origin's storage before the test, and closes only its own tab after; the user's tabs are not touched or read;
//   - nothing plays: no media session, no audio focus taken from the user's music;
//   - the files are built in the page by reference (a 44-byte header and ONE 64 KB block Blob repeated), so the page
//     holds 64 KB per file, not 80 MB; Chrome's blob store keeps the one block per file, and IndexedDB writes the bytes;
//   - at the end the app's Clear empties the test origin; if the test fails part-way (or times out), a CDP clear of
//     the TEST origin only (Storage.clearDataForOrigin, as the fixture does) takes the stored GiB back off the phone.
//
// v16.8.5 fix round 1:
//   - T1 (rev1's blocker): on a real profile the app holds the cleared library's files until the page reloads (Clear
//     keeps their bytes until then: a later release), so after the Clear the test reloads, accepts the statement, and
//     only then waits (up to 2 min) for the usage to be back within 64 MB of the start. The run counts as cleared only
//     once that check passes; until then the backstop below clears the origin.
//   - T2: on a device, the usage must show the bytes themselves (at least 95 % of them, within 2 min of the save): the
//     files are built by reference, so a stored reference instead of the bytes would pass every other check. Not on
//     the desktop, whose Playwright context is off the record (its usage stays near 0 whatever is stored).
//   - T3, N7: the save's end is its own cache-ok (or every blob stored), not the end line alone (App leaves that out
//     while another toast is up); a warning ends the wait at once, and fails.
//   - N5: the waits fit inside the test's timeout (fix round 2 below), and the backstop runs from a fixture's teardown
//     through a CDP session on a tab of its own, so it also runs after a timeout, when the test's tab is already closed.
//
// v16.8.5 fix round 2:
//   - N-f, the time budget, worst case. The explicit waits: listing 5 + save 60 + usage 2 (T2) + restore 10 + Clear 3 +
//     reload 1 + usage 2 = 83 min. Every action and navigation without a timeout of its own gets the 2 min defaults set
//     below: openApp's page load, its statement wait and tap (6), the restore's reload, statement wait and tap (6), the
//     two Clear taps (4), and the last statement wait and tap (4) = 20 min. 103 min in all, of 115: 12 min of margin.
//   - N-g: the save's wait fails when no progress report arrives for 5 min (a silent stall: no progress and no error, as
//     a transaction that never settles leaves it), not after the whole 60 (the ROG writes a 256 MiB batch in about 1 s).
//   - N-i: the backstop depends on the page fixture, so its teardown runs first (before the device page's own, whose
//     page.evaluate has no timeout and could hang on a hung renderer), and each of its calls has a timeout of its own.
//     The shared device page fixture is unchanged.
//
// v16.8.5 fix round 3: N-6, a helper tab that opens after its 30 s is closed when it does; N-8, the save wait's looks
// at the page each have the stall window to answer, so a hung renderer ends the wait as a stall, not after 60 min;
// N-9, the stall time is said as "20 s" or "5 min".

const GIB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const TOTAL = Number(process.env.E2E_BIG_SAVE_GIB || 11.5) * GIB;
const FILE = Number(process.env.E2E_BIG_SAVE_FILE_MB || 80) * MB;
const COUNT = Math.ceil(TOTAL / FILE);
const MIN = 60_000;
// Fix round 2 (N-g): the longest the save may go without a progress report (E2E_BIG_SAVE_STALL_S, for a dry run of it).
const STALL_MS = Number(process.env.E2E_BIG_SAVE_STALL_S || 300) * 1000;
// Fix round 3 (N-9): said as "20 s" or "5 min".
const STALL_WORDS = STALL_MS % MIN === 0 ? `${STALL_MS / MIN} min` : `${STALL_MS / 1000} s`;

// Set while the test origin may hold what this run stored; the fixture below clears it then.
let mayHoldBytes = false;
/** `p`, or a rejection after `ms` (a hung renderer or browser never answers). */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer in ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
const test = base.extend<{ originBackstop: void }>({
  originBackstop: [
    // Fix round 2 (N-i): it depends on `page`, so Playwright tears it down first, before the page fixture's teardown.
    async ({ context, page }, use) => {
      void page;
      await use();
      if (!mayHoldBytes) return;
      mayHoldBytes = false;
      const origin = new URL(TEST_ORIGIN).origin;
      if (origin !== TEST_ORIGIN || new URL(origin).hostname !== 'localhost') return; // the TEST origin only, never another
      // A tab of its own (about:blank, as the device fixture's own clear runs), so this works when the test's tab is
      // already closed (after a timeout) or hung. Not a browser-level session: Chrome answers Storage.clearDataForOrigin
      // there with "Internal error" (measured on an on-disk profile through connectOverCDP, fix round 1's probe).
      // Fix round 3 (N-6): a tab that opens only after the 30 s is closed when it does, so no about:blank tab is left in
      // the phone's Chrome (it isn't at the test origin, so the fixture's own tidy-up wouldn't close it). Best effort:
      // a tab that opens after Playwright has let go of the phone's Chrome stays; close it by hand.
      const opening = context.newPage();
      const helper = await within(opening, 30_000, 'a new tab').catch(() => {
        opening.then((late) => late.close().catch(() => {}), () => {});
        return null;
      });
      const cdp = helper ? await within(context.newCDPSession(helper), 30_000, 'a CDP session').catch(() => null) : null;
      if (!cdp) {
        console.log(`[big-save] the test stopped before its Clear, and no CDP session could be opened: clear ${origin} by hand`);
      } else {
        await within(cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }), 60_000, 'the clear').then(
          () => console.log(`[big-save] the test stopped before its Clear was confirmed: cleared ${origin}'s storage (only that origin)`),
          (e) => console.log(`[big-save] the backstop clear of ${origin} failed: ${String(e).slice(0, 200)}`)
        );
        await within(cdp.detach(), 10_000, 'the detach').catch(() => {});
      }
      if (helper) await within(helper.close(), 10_000, 'the tab close').catch(() => {});
    },
    { auto: true },
  ],
});

test('big save: about 11.5 GiB of synthetic tones is stored whole, with the progress toast; a reload restores all; Clear empties the test origin', async ({ page }) => {
  test.setTimeout(115 * MIN); // fix round 2 (N-f): 103 min worst case (the note above)
  // N5: every action and navigation without its own timeout (the statement's wait, the reloads) gets 2 min, so the
  // waits stay inside the test's timeout and a stop surfaces as its own failure, with the backstop still to run.
  page.setDefaultTimeout(2 * MIN);
  page.setDefaultNavigationTimeout(2 * MIN);
  const origin = new URL(TEST_ORIGIN).origin;
  expect(new URL(origin).hostname, 'the test origin is local, never production').toBe('localhost');
  const times: Record<string, number | string> = { files: COUNT, fileMB: FILE / MB, totalGiB: +((COUNT * FILE) / GIB).toFixed(2) };
  const note = (k: string, v: number | string) => {
    times[k] = v;
    console.log(`[big-save] ${k}: ${v}`);
  };

  // Every card about offline use, as it changes (the progress card's lines, the end line, any warning), and the
  // cache's reports (the save's end is its cache-ok).
  await page.addInitScript(() => {
    const w = window as any;
    const log: { t: number; text: string; id: string | null }[] = (w.__offlineCards = []);
    const events: any[] = (w.__bigEvents = []);
    for (const type of ['aetheria:cache-progress', 'aetheria:cache-ok', 'aetheria:cache-error']) {
      window.addEventListener(type, (e) => events.push({ type: type.slice('aetheria:'.length), ...(e as CustomEvent).detail }));
    }
    let last = '';
    const look = () => {
      const cards = [...document.querySelectorAll('div[aria-atomic="true"]')].filter((d) => /offline use/.test(d.textContent ?? ''));
      const key = cards.map((d) => d.textContent).join('|');
      if (key === last) return;
      last = key;
      for (const d of cards) log.push({ t: Date.now(), text: (d.textContent ?? '').trim(), id: d.getAttribute('data-testid') });
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const usage = () => page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);

  try {
    await openApp(page);
    const startUsage = await usage();
    note('usageAtStartMB', Math.round(startUsage / MB));

    // The import: built in the page, handed to the "Add files" input as a pick.
    const t0 = Date.now();
    mayHoldBytes = true;
    await page.evaluate(
      ({ count, bytes }) => {
        const BLOCK = 64 * 1024;
        const blocks = Math.max(1, Math.round((bytes - 44) / BLOCK));
        const rate = 8000;
        const picked = new DataTransfer();
        for (let f = 0; f < count; f++) {
          const samples = BLOCK / 2;
          const cycles = Math.max(1, Math.round(((220 + (f % 40) * 13) * samples) / rate));
          const pcm = new Int16Array(samples);
          for (let i = 0; i < samples; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * cycles * i) / samples) * 6000);
          const block = new Blob([pcm]);
          const dataBytes = blocks * BLOCK;
          const head = new DataView(new ArrayBuffer(44));
          const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) head.setUint8(o + i, s.charCodeAt(i)); };
          tag(0, 'RIFF'); head.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE'); tag(12, 'fmt ');
          head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true);
          head.setUint32(24, rate, true); head.setUint32(28, rate * 2, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true);
          tag(36, 'data'); head.setUint32(40, dataBytes, true);
          const parts: BlobPart[] = [head.buffer];
          for (let b = 0; b < blocks; b++) parts.push(block);
          picked.items.add(new File(parts, `bigsave-${String(f + 1).padStart(3, '0')}.wav`, { type: 'audio/wav' }));
        }
        const input = document.querySelector('input[aria-label="Add files"]') as HTMLInputElement;
        input.files = picked.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { count: COUNT, bytes: FILE }
    );
    // Listed: the saved library order names every track (the state record, written 2 s after the import settles).
    await expect.poll(async () => (await cacheCounts(page)).library, { timeout: 5 * MIN, intervals: [2_000] }).toBe(COUNT);
    note('importListedS', +((Date.now() - t0) / 1000).toFixed(1));

    // The end (T3, N7): the save's own cache-ok (the save whose progress counted COUNT tracks), or every blob stored.
    // A warning ends the wait at once, and fails below. The progress toast is read from the cards' log (it may come and
    // go between two looks); the end line is noted, not required (App leaves it out while another toast is up).
    // Fix round 2 (N-g): so does a stall, no new progress report for 5 min (counted from this wait's start).
    // Fix round 3 (N-8): each look at the page has the stall window to answer. A hung renderer never answers, so the
    // wait ends as a stall then (the window plus one poll), not when the 60 min run out.
    let verdict = '';
    let progressSeen = -1;
    let progressAt = Date.now();
    const unanswered = `stalled: the page did not answer in ${STALL_WORDS}`;
    // rev4 N3: a look that fails at once (the renderer crashed, the page navigated) says why, not "did not answer".
    let lookErr = '';
    const noLook = (e: unknown) => { lookErr = String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 200); return null; };
    const lookVerdict = () => (!lookErr || / no answer in /.test(lookErr) ? unanswered : `stalled: the page failed: ${lookErr}`);
    await expect
      .poll(async () => {
        lookErr = '';
        const seen = await within(page.evaluate((count) => {
          const w = window as any;
          const evs: any[] = w.__bigEvents;
          const seqs = new Set(evs.filter((e) => e.type === 'cache-progress' && e.total === count).map((e) => e.seq));
          const bad = (w.__offlineCards as { text: string }[]).find((c) => /could not be saved/.test(c.text));
          const err = evs.find((e) => e.type === 'cache-error' && e.what === 'tracks');
          const ok = evs.some((e) => e.type === 'cache-ok' && e.what === 'tracks' && seqs.has(e.seq));
          const lastCard = (w.__offlineCards as { text: string }[]).slice(-1)[0]?.text ?? 'no card yet';
          const progress = evs.filter((e) => e.type === 'cache-progress').length;
          return { bad: bad?.text ?? (err ? JSON.stringify(err) : null), ok, lastCard, progress };
        }, COUNT), STALL_MS, 'the page').catch(noLook);
        if (!seen) return (verdict = lookVerdict());
        if (seen.bad) return (verdict = `warning: ${seen.bad}`);
        if (seen.ok) return (verdict = 'saved (cache-ok)');
        const blobs = await within(cacheCounts(page), STALL_MS, 'the page').then((c) => c.blobs, noLook);
        if (blobs === null) return (verdict = lookVerdict());
        if (blobs === COUNT) return (verdict = 'saved (every blob stored)');
        if (seen.progress !== progressSeen) {
          progressSeen = seen.progress;
          progressAt = Date.now();
        } else if (Date.now() - progressAt > STALL_MS) {
          return (verdict = `stalled: no progress report for ${STALL_WORDS} (${blobs} of ${COUNT} stored; ${seen.lastCard})`);
        }
        return (verdict = `saving (${blobs} of ${COUNT} stored; ${seen.lastCard})`);
      }, { timeout: 60 * MIN, intervals: [5_000] })
      .toMatch(/^(saved|warning|stalled)/);
    expect(verdict, 'the save ended with everything stored, no warning, no stall').toMatch(/^saved/);
    const savedS = (Date.now() - t0) / 1000;
    note('savedS', +savedS.toFixed(1));
    note('savedBy', verdict);
    note('saveMBperS', +((COUNT * FILE) / MB / savedS).toFixed(1));
    const counts = await cacheCounts(page);
    expect(counts.blobs, 'every track stored').toBe(COUNT);
    const storedBytes = await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('aetheria-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all: any[] = await new Promise((res) => { const r = db.transaction('blobs', 'readonly').objectStore('blobs').getAll(); r.onsuccess = () => res(r.result); });
      db.close();
      return all.reduce((s, b) => s + (b.fileBlob?.size ?? 0), 0);
    });
    note('storedGiB', +(storedBytes / GIB).toFixed(2));
    expect(storedBytes, 'all the bytes stored').toBeGreaterThanOrEqual(COUNT * (FILE - 64 * 1024));
    const cards = (await page.evaluate(() => (window as any).__offlineCards)) as { t: number; text: string; id: string | null }[];
    const progress = cards.filter((c) => c.id === 'cache-progress');
    expect(progress.length, 'the progress toast showed').toBeGreaterThan(0);
    note('progressShownS', +((progress[0].t - t0) / 1000).toFixed(1));
    note('progressLines', [...new Set(progress.map((c) => c.text.replace(/^Saving for offline use: (\d+) of (\d+) tracks.*$/, '$1/$2')))].join(' '));
    note('endLineShown', cards.some((c) => c.text === `${COUNT} tracks saved for offline use.`) ? 'yes' : 'no');

    // T2 (a device only): the usage shows the bytes themselves, not references to the page's 64 KB blocks.
    if (ON_DEVICE) {
      const want = 0.95 * COUNT * FILE;
      await expect
        .poll(async () => (await usage()) - startUsage, { timeout: 2 * MIN, intervals: [2_000], message: `the usage grows by at least ${(want / GIB).toFixed(2)} GiB` })
        .toBeGreaterThanOrEqual(want);
    }
    const est = await page.evaluate(async () => { const e = await navigator.storage.estimate(); return { usage: e.usage ?? 0, quota: e.quota ?? 0 }; });
    note('usageAfterSaveGiB', +(est.usage / GIB).toFixed(2));
    note('estimateFreeGiB', +((est.quota - est.usage) / GIB).toFixed(2));

    // A reload: every track comes back (nothing is played).
    const t1 = Date.now();
    await page.reload();
    await acceptDisclaimer(page);
    await expect(page.getByText(new RegExp(`Restored ${COUNT} tracks from cache`))).toBeVisible({ timeout: 10 * MIN });
    note('restoreS', +((Date.now() - t1) / 1000).toFixed(1));
    const after = await cacheCounts(page);
    expect(after, 'the library and its audio after the reload').toMatchObject({ blobs: COUNT, library: COUNT });
    await expect(page.getByText('bigsave-001', { exact: true })).toBeVisible();

    // Clear (classic's two taps), then (T1) a reload: the page held the cleared library's files until then, so only
    // after it does the test origin's usage come back to about where it started.
    const t2 = Date.now();
    await page.getByRole('button', { name: 'Clear library and cache', exact: true }).click();
    await page.getByRole('button', { name: `Confirm deleting all ${COUNT} tracks from this device`, exact: true }).click();
    await expect.poll(async () => (await cacheCounts(page)).blobs, { timeout: 3 * MIN }).toBe(0);
    note('clearS', +((Date.now() - t2) / 1000).toFixed(1));
    note('usageAfterClearBeforeReloadMB', Math.round((await usage()) / MB));
    await page.reload({ timeout: MIN });
    await acceptDisclaimer(page);
    await expect
      .poll(usage, { timeout: 2 * MIN, intervals: [2_000], message: 'the usage is back within 64 MB of the start' })
      .toBeLessThan(startUsage + 64 * MB);
    mayHoldBytes = false; // cleared and confirmed: no backstop needed
    note('usageAfterClearAndReloadMB', Math.round((await usage()) / MB));
    note('clearAndReloadS', +((Date.now() - t2) / 1000).toFixed(1));
  } finally {
    test.info().annotations.push({ type: 'big-save', description: JSON.stringify(times) });
  }
});
