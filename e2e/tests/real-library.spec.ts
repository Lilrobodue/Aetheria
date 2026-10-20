import { test as base, expect, chromium, type Browser, type Page } from '@playwright/test';
import { adb, mediaSession } from './adb';
import { acceptDisclaimer } from './helpers';

// Real-load checks against the library YOU loaded on the phone, in your open
// tab of your own dev server (http://localhost:3100). Opt in on a device run:
//
//   E2E_REAL_LIBRARY=1 npm run test:device -- --project=android-real
//
// Strictly non-destructive: it attaches to your tab (never opens, closes,
// clears or navigates away from anything) and only reloads, plays, seeks,
// skips and pauses — no import, delete, Clear, Discard, Auto-Distribute, Deep
// Scan or walks. Playback position and the cursor are the only things a save
// may change. The last test turns the screen off (a secure lock stays locked).
export const USER_ORIGIN = 'http://localhost:3100';

const test = base.extend<{}, { phone: Browser; userTab: Page }>({
  phone: [
    async ({}, use) => {
      const browser = await chromium.connectOverCDP('http://localhost:9222');
      await use(browser);
      await browser.close(); // disconnects only; the CDP init scripts go with it
    },
    { scope: 'worker' },
  ],
  userTab: [
    async ({ phone }, use) => {
      const tab = phone.contexts()[0].pages().find((p) => p.url().replace(/[?#].*$/, '') === USER_ORIGIN + '/');
      if (!tab) throw new Error(`Open your library at ${USER_ORIGIN} on the phone first.`);
      await tab.bringToFront(); // a background tab doesn't render, so taps would wait for ever
      // Counts pause() calls (the gapless swap never pauses; the fallback
      // does) and remembers the media elements, so a test can jump near a
      // track's end. In-memory only.
      await tab.addInitScript(() => {
        const w = window as any;
        w.__pauseCount = 0;
        w.__media = new Set();
        const pause = HTMLMediaElement.prototype.pause;
        HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
          w.__pauseCount++;
          return pause.call(this);
        };
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
          w.__media.add(this);
          return play.call(this);
        };
      });
      await use(tab);
    },
    { scope: 'worker' },
  ],
});
test.describe.configure({ mode: 'serial' });

/** Track names in library order, and the library size, from the stored state. */
async function storedLibrary(tab: Page): Promise<{ count: number; names: string[] }> {
  return tab.evaluate(async () => {
    const req = (r: IDBRequest) => new Promise<any>((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const state = await req(db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('current'));
    const metas: any[] = await req(db.transaction('meta', 'readonly').objectStore('meta').getAll());
    db.close();
    const ids: string[] = [...new Set<string>(state?.originalOrder ?? [])];
    const name = new Map(metas.map((m) => [m.id, m.name]));
    return { count: ids.length, names: ids.map((id) => name.get(id) ?? id) };
  });
}

const pauseCount = (tab: Page) => tab.evaluate(() => (window as any).__pauseCount as number);
const title = (tab: Page) => tab.getByTestId('now-playing-title').textContent();

/** Jump the playing track to `secondsLeft` before its end (waits for its metadata). */
async function jumpNearEnd(tab: Page, secondsLeft = 6): Promise<void> {
  await tab.evaluate(async (left) => {
    for (let i = 0; i < 50; i++) {
      const el = [...((window as any).__media as Set<HTMLMediaElement>)].find(
        (m) => !m.paused && isFinite(m.duration) && m.duration > 30
      );
      if (el && el.currentTime < el.duration - left - 2) {
        el.currentTime = el.duration - left;
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('no playing track to jump');
  }, secondsLeft);
}

/** Click without layout or hit-testing — works with the screen off. */
const press = (tab: Page, name: string) => tab.getByRole('button', { name, exact: true }).dispatchEvent('click');

test('your library restores in full @real', async ({ userTab }) => {
  const stored = await storedLibrary(userTab);
  expect(stored.count).toBeGreaterThan(0);
  const lines: { at: number; text: string; type: string }[] = [];
  userTab.on('console', (m) => lines.push({ at: Date.now(), text: m.text(), type: m.type() }));
  userTab.on('pageerror', (e) => lines.push({ at: Date.now(), text: e.message, type: 'error' }));
  const t0 = Date.now();
  await userTab.reload({ waitUntil: 'load' });
  await expect.poll(() => lines.find((l) => l.text.includes('[PlaylistCache] Restored')), { timeout: 60_000 }).toBeTruthy();
  const restoredAfter = lines.find((l) => l.text.includes('[PlaylistCache] Restored'))!.at - t0;
  await acceptDisclaimer(userTab);
  await expect(userTab.getByText(/^\d+ Tracks$/)).toHaveText(`${stored.count} Tracks`);
  console.log(`[real] ${stored.count} tracks restored ${restoredAfter} ms after the reload started`);
  expect(lines.filter((l) => l.type === 'error' && !/favicon/i.test(l.text)).map((l) => l.text)).toEqual([]);
});

test('plays your tracks, skips forward and back @real', async ({ userTab }) => {
  const { names } = await storedLibrary(userTab);
  await userTab.getByText(names[0], { exact: true }).first().click();
  await expect.poll(() => title(userTab)).toBe(names[0]);
  await expect.poll(() => mediaSession()?.state, { timeout: 15_000 }).toBe('playing');
  await press(userTab, 'Next track');
  await expect.poll(() => title(userTab)).not.toBe(names[0]);
  await press(userTab, 'Previous track');
  await expect.poll(() => title(userTab)).toBe(names[0]);
  await press(userTab, 'Pause');
  await expect.poll(() => mediaSession()?.state, { timeout: 15_000 }).toBe('paused');
});

test('Reload for an update saves and brings back the whole library @real', async ({ userTab }) => {
  const { count } = await storedLibrary(userTab);
  await userTab.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
  const t0 = Date.now();
  await Promise.all([userTab.waitForEvent('load', { timeout: 90_000 }), press(userTab, 'Reload')]);
  console.log(`[real] update flush + reload: ${Date.now() - t0} ms`);
  await acceptDisclaimer(userTab);
  await expect(userTab.getByText(/^\d+ Tracks$/)).toHaveText(`${count} Tracks`, { timeout: 60_000 });
  expect((await storedLibrary(userTab)).count).toBe(count);
});

test('with the screen off, your tracks advance gaplessly and the lock-screen card follows @real', async ({ userTab }) => {
  const { names } = await storedLibrary(userTab);
  await userTab.getByText(names[0], { exact: true }).first().click();
  await expect.poll(() => mediaSession(), { timeout: 15_000 }).toMatchObject({ state: 'playing' });
  const pausesBefore = await pauseCount(userTab);
  const seen = [mediaSession()!.title];
  let pausesDuringAdvances = -1;
  await jumpNearEnd(userTab);
  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  try {
    for (let i = 0; i < 3; i++) {
      await expect
        .poll(() => {
          const s = mediaSession();
          return s?.state === 'playing' && s.title && s.title !== seen[seen.length - 1] ? s.title : null;
        }, { timeout: 25_000, intervals: [500] })
        .not.toBeNull();
      seen.push(mediaSession()!.title);
      if (i < 2) await jumpNearEnd(userTab);
    }
    // Read before the clean-up Pause below (which pauses the music and the anchor).
    pausesDuringAdvances = (await pauseCount(userTab)) - pausesBefore;
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
    await press(userTab, 'Pause').catch(() => {});
  }
  console.log(`[real] lock-screen card followed: ${seen.join(' → ')}`);
  for (const t of seen) expect(names.some((n) => n.startsWith(t))).toBe(true);
  // The gapless swap never pauses the element; the fallback (which can drop
  // the card) always does.
  expect(pausesDuringAdvances).toBe(0);
});
