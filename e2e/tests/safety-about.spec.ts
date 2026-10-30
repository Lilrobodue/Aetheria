import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  PHONE_VIEWPORT,
  LAYOUT_KEY,
  acceptDisclaimerNew,
  instrumentAudio,
  layerState,
  layersState,
  libraryState,
  newShell,
  openApp,
  openHarmonicControl,
  phoneSize,
  tab,
} from './helpers';
import { watchNativeDialogs } from './fixtures';
import {
  AWAKE_KEY,
  DISCLAIMER_KEY,
  MUSIC_ONLY_KEY,
  TUTORIAL_KEY,
  inAxTree,
  moreRow,
  moreView,
  openMorePage,
  playingSeeded,
  stored,
  textNodes,
} from './moreKit';

// v16.4, Safety & comfort and About (spec §3.4–3.6, §5.3 safety-about.spec): Stop all sound and Music only (the same
// actions as ⋯ and Layers), Keep screen awake (the wake lock's gate, in both layouts), the safety statement (the
// first-run modal's own nodes), About (the version, the update card that never reloads by itself, the offline status
// and Check for updates), the new layout's 4-card tour (modal, its own first run), and Links (classic's words, the PWA
// guard). Every test fails on v16.1, which has none of these pages (§5.4).

/** The statement's words (its six sections and the liability line), hashed as disclaimer.spec hashes the modal's. */
const STATEMENT_PIN = 'da490da699eb';

/** v16.4 re-review: how long the app shares a wake-lock request in flight, read from its source (the module touches
 *  navigator when loaded, so it isn't imported here). */
const WAKE_LOCK_PENDING_MS = Number(
  /export const WAKE_LOCK_PENDING_MS = (\d+);/.exec(readFileSync(new URL('../../utils/stabilityManager.ts', import.meta.url), 'utf8'))?.[1]
);

/**
 * v16.4 review: a wake-lock stub whose requests land only when the test grants them (window.__wlGrant()), counting
 * requests, releases and the locks held (granted and not released). With it the page's own races show: the switch
 * flipped, a pause, or the visibility handler while a request is in flight. v16.4 re-review: __wlGrant('newest' |
 * 'oldest') grants one only (a request left unanswered, then answered very late).
 */
async function lateWakeLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__wl = { requests: 0, releases: 0, held: 0, waiting: 0 };
    const grants: Array<() => void> = [];
    w.__wlGrant = (which: 'all' | 'newest' | 'oldest' = 'all') => {
      const picked = which === 'all' ? grants.splice(0) : which === 'newest' ? grants.splice(-1) : grants.splice(0, 1);
      for (const g of picked) g();
      w.__wl.waiting = grants.length;
      return picked.length;
    };
    const sentinel = () => {
      const t: any = new EventTarget();
      t.released = false;
      t.type = 'screen';
      t.release = async () => {
        if (t.released) return;
        t.released = true;
        w.__wl.releases++;
        w.__wl.held--;
        t.dispatchEvent(new Event('release'));
      };
      return t;
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: () => {
          w.__wl.requests++;
          w.__wl.waiting++;
          return new Promise((resolve) => {
            grants.push(() => {
              w.__wl.held++;
              resolve(sentinel());
            });
          });
        },
      },
    });
  });
}

type WakeLockCounts = { requests: number; releases: number; held: number; waiting: number };
const wakeLocks = (page: Page) => page.evaluate(() => ({ ...(window as any).__wl })) as Promise<WakeLockCounts>;

/** Grant every request in flight (or the newest or the oldest only), then let the page's handlers run. */
async function grantWakeLocks(page: Page, which: 'all' | 'newest' | 'oldest' = 'all'): Promise<number> {
  const n = await page.evaluate((which) => (window as any).__wlGrant(which) as number, which);
  await page.waitForTimeout(300);
  return n;
}

/**
 * v16.4 review: a stub service worker for About (the suite blocks real ones). window.__sw holds what the test sets:
 * the controller, the cache keys (caches.keys() is counted), the registration's installing and active workers;
 * newWorker(state) starts an install, finish('installed' | 'redundant' | 'error') ends it as a real worker would.
 */
async function stubServiceWorker(page: Page, init: { controller?: boolean; keys?: string[] } = {}): Promise<void> {
  await page.addInitScript((init) => {
    const container = navigator.serviceWorker;
    if (!container) return;
    const worker = (state: string) => Object.assign(new EventTarget(), { state, scriptURL: '/sw.js', postMessage() {} });
    const sw: any = {
      keys: init.keys ?? [],
      keysCalls: 0,
      controller: init.controller ? worker('activated') : null,
      installing: null,
      active: worker('activating'),
      updates: 0,
    };
    sw.setController = (on: boolean) => {
      sw.controller = on ? worker('activated') : null;
    };
    sw.newWorker = (state: string) => {
      sw.installing = worker(state);
    };
    sw.finish = (end: 'installed' | 'redundant' | 'error') => {
      const wk = sw.installing;
      if (!wk) return;
      if (end === 'error') {
        wk.dispatchEvent(new Event('error'));
        return;
      }
      sw.installing = null;
      wk.state = end;
      wk.dispatchEvent(new Event('statechange'));
    };
    (window as any).__sw = sw;
    // (defineProperties, not Object.assign: assign would copy the getters' values once.)
    const reg = Object.defineProperties(new EventTarget(), {
      installing: { get: () => sw.installing },
      waiting: { get: () => null },
      active: { get: () => sw.active },
      update: {
        value: async () => {
          sw.updates++;
        },
      },
    });
    try {
      Object.defineProperty(container, 'controller', { configurable: true, get: () => sw.controller });
      Object.defineProperty(container, 'getRegistration', { configurable: true, value: async () => reg });
    } catch {}
    try {
      Object.defineProperty(caches, 'keys', {
        configurable: true,
        value: async () => {
          sw.keysCalls++;
          return [...sw.keys];
        },
      });
    } catch {}
  }, init);
}

/** The music element is paused and the v2 layers are stopped (no request). */
async function expectAllStopped(page: Page, what: string): Promise<void> {
  await expect.poll(async () => (await layerState(page)).music?.paused, { message: `${what}: the music pauses` }).toBe(true);
  await expect.poll(async () => (await layersState(page))?.requested ?? null, { message: `${what}: the v2 layers stop` }).toBeNull();
}

test.describe('phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('S1. Stop all sound in Safety & comfort stops the music (one pause) and the layers, as ⋯ › Stop all does @mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await instrumentAudio(page);
    const dialogs = await playingSeeded(page);
    await expect.poll(async () => (await layersState(page))?.requested ?? null, { message: 'the v2 layers play' }).not.toBeNull();
    await openMorePage(page, 'safety');
    await expect(page.getByTestId('more-safety')).toContainText('The music, the tone, the beat and the drone');
    const pausesBefore = await page.evaluate(() => (window as any).__audio.musicPauses as number);
    await page.getByTestId('safety-stop-all').click();
    await expectAllStopped(page, 'Safety & comfort');
    expect((await page.evaluate(() => (window as any).__audio.musicPauses as number)) - pausesBefore, 'one pause()').toBe(1);
    // Again from ⋯ › Stop all sound: the same end state.
    await page.getByTestId('mini-player').getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
    await expect.poll(async () => (await layersState(page))?.requested ?? null).not.toBeNull();
    await tab(page, 'now');
    await page.getByTestId('np-menu-button').click();
    const p2 = await page.evaluate(() => (window as any).__audio.musicPauses as number);
    await page.getByTestId('menu-stop-all').click();
    await expectAllStopped(page, '⋯ › Stop all');
    expect((await page.evaluate(() => (window as any).__audio.musicPauses as number)) - p2, 'one pause()').toBe(1);
    expect(dialogs).toEqual([]);
  });

  test('S2. Music only in Safety & comfort is Layers\' switch: one state, saved; one "Music only" switch on each page', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await playingSeeded(page);
    await openMorePage(page, 'safety');
    const sw = page.getByTestId('more').getByRole('switch', { name: 'Music only', exact: true });
    await expect(sw).toHaveCount(1);
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('safety-music-only')).toContainText('Tone, beat and drone off. The music plays on. Saved.');
    await expect(page.getByTestId('safety-comfort')).toContainText('Keep the layers comfortable. If anything feels unpleasant, lower them or turn on Music only.');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    // (App saves Music only from an effect, after the commit: polled.)
    await expect.poll(() => stored(page, MUSIC_ONLY_KEY)).toBe('true');
    await tab(page, 'layers');
    const layers = page.getByTestId('tab-layers').getByRole('switch', { name: 'Music only', exact: true });
    await expect(layers).toHaveCount(1);
    await expect(layers, "Layers' switch shows it").toHaveAttribute('aria-checked', 'true');
    await layers.click();
    await expect.poll(() => stored(page, MUSIC_ONLY_KEY)).toBe('false');
    await tab(page, 'more');
    await expect(page.getByTestId('more').getByRole('switch', { name: 'Music only', exact: true })).toHaveAttribute('aria-checked', 'false');
    expect(dialogs).toEqual([]);
  });

  test('S3. Keep screen awake: on by default (a play takes the lock); off releases it and takes none on play or on return; on again takes one; classic honours it @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => {
      const w = window as any;
      w.__wl = { requests: 0, releases: 0, held: 0 };
      const sentinel = () => {
        const t: any = new EventTarget();
        t.released = false;
        t.type = 'screen';
        t.release = async () => {
          if (t.released) return;
          t.released = true;
          w.__wl.releases++;
          w.__wl.held--;
          t.dispatchEvent(new Event('release'));
        };
        return t;
      };
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async () => {
            w.__wl.requests++;
            w.__wl.held++;
            return sentinel();
          },
        },
      });
    });
    const wl = () => page.evaluate(() => ({ ...(window as any).__wl })) as Promise<{ requests: number; releases: number; held: number }>;
    const dialogs = await playingSeeded(page);
    await expect.poll(async () => (await wl()).held, { message: 'by default a play takes the lock' }).toBe(1);
    await openMorePage(page, 'safety');
    expect(await stored(page, AWAKE_KEY), 'unset until a tap').toBeNull();
    const sw = page.getByTestId('safety-keep-awake').getByRole('switch');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('safety-keep-awake')).toContainText('While music plays, the screen stays on. Off: it sleeps as your phone is set to, and the music plays on. Saved.');
    // Off: the held lock goes.
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(await stored(page, AWAKE_KEY)).toBe('false');
    await expect.poll(async () => (await wl()).held, { message: 'off releases the held lock' }).toBe(0);
    const off = await wl();
    // A pause and a play, and a return to the page: none.
    const mini = page.getByTestId('mini-player');
    await mini.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await mini.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(800);
    expect((await wl()).requests, 'no request while off (a play, a return to the page)').toBe(off.requests);
    // On again while playing: one, at once.
    await sw.click();
    expect(await stored(page, AWAKE_KEY)).toBe('true');
    await expect.poll(async () => (await wl()).requests, { message: 'on again while playing takes one' }).toBe(off.requests + 1);
    expect((await wl()).held).toBe(1);
    // Classic honours the same switch.
    await sw.click();
    await expect.poll(async () => (await wl()).held).toBe(0);
    const offAgain = await wl();
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await moreRow(page, 'more-back-to-classic').click();
    await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
    const bar = page.getByTestId('player-bar');
    await bar.getByRole('button', { name: 'Pause', exact: true }).first().evaluate((b) => (b as HTMLButtonElement).click());
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await bar.getByRole('button', { name: 'Play', exact: true }).first().evaluate((b) => (b as HTMLButtonElement).click());
    await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
    await page.waitForTimeout(800);
    expect((await wl()).requests, 'classic: no request while off').toBe(offAgain.requests);
    expect(dialogs).toEqual([]);
  });

  // v16.4 review: the wake lock's races, page-side (the device test can't always see Android's lock). The stub's
  // requests land only when granted, so each race is set up exactly. At most one lock is ever held.
  test('S3b. a late wake lock: Keep screen awake switched off while the request is in flight, the lock that lands is released @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await lateWakeLock(page);
    const dialogs = await playingSeeded(page);
    await expect.poll(async () => (await wakeLocks(page)).waiting, { message: 'the play asks for a lock' }).toBe(1);
    await openMorePage(page, 'safety');
    const sw = page.getByTestId('safety-keep-awake').getByRole('switch');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await grantWakeLocks(page);
    const c = await wakeLocks(page);
    expect(c.held, 'off while in flight: the lock that lands is released').toBe(0);
    expect(c.requests, 'one request').toBe(1);
    expect(dialogs).toEqual([]);
  });

  test('S3c. a late wake lock: a pause while the request is in flight, the lock that lands is released @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await lateWakeLock(page);
    const dialogs = await playingSeeded(page);
    await expect.poll(async () => (await wakeLocks(page)).waiting, { message: 'the play asks for a lock' }).toBe(1);
    await grantWakeLocks(page);
    expect((await wakeLocks(page)).held, 'playing: one lock').toBe(1);
    const mini = page.getByTestId('mini-player');
    // A pause releases it; a play asks again; a pause before that request lands.
    await mini.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await expect.poll(async () => (await wakeLocks(page)).held, { message: 'a pause releases the lock' }).toBe(0);
    await mini.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(true);
    await expect.poll(async () => (await wakeLocks(page)).waiting, { message: 'the play asks again' }).toBe(1);
    await mini.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await grantWakeLocks(page);
    expect((await wakeLocks(page)).held, 'paused: the lock that lands is released').toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('S3d. a late wake lock: Keep screen awake off and on again while the request is in flight takes one lock, and off then holds none @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await lateWakeLock(page);
    const dialogs = await playingSeeded(page);
    await expect.poll(async () => (await wakeLocks(page)).waiting, { message: 'the play asks for a lock' }).toBe(1);
    await openMorePage(page, 'safety');
    const sw = page.getByTestId('safety-keep-awake').getByRole('switch');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(300);
    await grantWakeLocks(page);
    const on = await wakeLocks(page);
    expect(on.requests, 'off and on while in flight: still the one request').toBe(1);
    expect(on.held, 'one lock').toBe(1);
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await wakeLocks(page)).held, { message: 'off: none held' }).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('S3e. a late wake lock: the keep-alive effect and the visibility handler racing take one lock, and a pause releases it @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    await lateWakeLock(page);
    const dialogs = await playingSeeded(page);
    // The play's request (the keep-alive effect) is in flight when the page says it is visible again.
    await expect.poll(async () => (await wakeLocks(page)).waiting, { message: 'the play asks for a lock' }).toBe(1);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    await grantWakeLocks(page);
    const c = await wakeLocks(page);
    expect(c.requests, 'the visibility handler shares the request in flight').toBe(1);
    expect(c.held, 'one lock').toBe(1);
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await expect.poll(async () => (await wakeLocks(page)).held, { message: 'a pause: none held' }).toBe(0);
    expect(dialogs).toEqual([]);
  });

  // v16.4 re-review: a request the browser never answers was shared by every later call for the page's life (the
  // screen could sleep while music played until a reload). It is shared for WAKE_LOCK_PENDING_MS only.
  test('S3f. a wake-lock request the browser never answers: 5 s on, a return to the page asks again and holds one; the old one, answered at last, is released at once; a pause holds none @mobile', async ({ page }) => {
    test.setTimeout(150_000);
    expect(WAKE_LOCK_PENDING_MS, "the app's bounded life, read from its source").toBeGreaterThan(0);
    await lateWakeLock(page);
    const dialogs = await playingSeeded(page);
    await expect.poll(async () => (await wakeLocks(page)).waiting, { message: 'the play asks for a lock' }).toBe(1);
    // Unanswered. Past the bounded life, the page's return (the screen woken) asks again.
    await page.waitForTimeout(WAKE_LOCK_PENDING_MS + 500);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(async () => (await wakeLocks(page)).requests, { message: 'a return to the page 5 s on asks again' }).toBe(2);
    await grantWakeLocks(page, 'newest');
    expect((await wakeLocks(page)).held, 'the new request: one lock').toBe(1);
    // The browser answers the first at last: it lands while one is held, and is released at once.
    await grantWakeLocks(page, 'oldest');
    const c = await wakeLocks(page);
    expect(c, 'the old one released on landing: still one lock').toMatchObject({ requests: 2, held: 1, releases: 1, waiting: 0 });
    await page.getByTestId('mini-player').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).playing).toBe(false);
    await expect.poll(async () => (await wakeLocks(page)).held, { message: 'a pause: none held' }).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('S4. the statement page shows the first-run modal\'s own sections and liability line, word for word; reading it changes nothing', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = watchNativeDialogs(page);
    await page.addInitScript((k) => {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      if (sessionStorage.getItem('__s4') === null) {
        sessionStorage.setItem('__s4', '1');
        localStorage.setItem(k, 'new');
      }
    }, LAYOUT_KEY);
    await page.goto('/');
    await page.getByTestId('disclaimer').waitFor();
    // The modal's statement: its box's text nodes, without the acknowledgement ("By tapping …"), which is modal-only.
    const modal = await page.getByTestId('disclaimer').evaluate((root) => {
      const box = root.querySelector('.text-left')!;
      const parts: string[] = [];
      for (const child of Array.from(box.children)) {
        if (child.tagName === 'P' && (child.textContent ?? '').includes('By tapping')) continue;
        const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (t) parts.push(t);
        }
      }
      return parts;
    });
    await page.getByRole('button', { name: /I understand, let me begin/ }).click();
    await newShell(page).waitFor();
    await phoneSize(page);
    const accepted = await stored(page, DISCLAIMER_KEY);
    await openMorePage(page, 'statement');
    const ours = [...(await textNodes(page.getByTestId('statement-sections'))), ...(await textNodes(page.getByTestId('statement-liability')))];
    expect(ours, 'the same words, node for node').toEqual(modal);
    const pin = createHash('sha256').update(ours.join(' ')).digest('hex').slice(0, 12);
    expect(pin, "the statement's words are unchanged (a change is a DISCLAIMER_VERSION bump)").toBe(STATEMENT_PIN);
    await expect(page.getByTestId('statement-version')).toHaveText('Shown when you first open Aetheria, and again whenever it changes (this version: 2026-10-21).');
    expect(await stored(page, DISCLAIMER_KEY), 'reading it leaves the accepted version alone').toBe(accepted);
    await expect(page.getByTestId('disclaimer')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('S5. About: the version (the header badge in classic), the update card in the toast\'s words that never reloads by itself, Later, Reload; offline status with no worker', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = await playingSeeded(page);
    await openMorePage(page, 'about');
    const about = page.getByTestId('more-about');
    await expect(page.getByTestId('about-version')).toHaveText('Version v16.4 · new layout (beta)');
    await expect(about).toContainText('Nothing about your listening sessions leaves your device.');
    // The suite blocks service workers: not saved, and nothing to ask for an update.
    await expect(page.getByTestId('about-offline')).toContainText('Not saved for offline use yet');
    await expect(page.getByTestId('about-offline')).toContainText('It is saved after the first full load with a connection');
    await expect(page.getByTestId('about-network')).toContainText('Online');
    await expect(page.getByTestId('about-check')).toBeDisabled();
    await expect(page.getByTestId('about-update')).toHaveCount(0);
    // An update: the card, in the shared toast's words (playing: "Reloading stops the music.").
    await page.evaluate(() => {
      (window as any).__noReload = 1;
      window.dispatchEvent(new Event('aetheria:update-ready'));
    });
    await expect(page.getByTestId('about-update')).toHaveText(/^A new version of Aetheria is ready\. Reloading stops the music\./);
    await expect(page.getByTestId('about-reload')).toBeEnabled();
    // Nothing tapped: no reload in 5 s.
    await page.waitForTimeout(5000);
    expect(await page.evaluate(() => (window as any).__noReload), 'no reload by itself').toBe(1);
    // Later hides the card and the shared toast.
    await page.getByTestId('about-later').click();
    await expect(page.getByTestId('about-update')).toHaveCount(0);
    await expect(page.getByText('A new version of Aetheria is ready.', { exact: false })).toHaveCount(0);
    // Reload reloads (App's flushAndReload).
    await page.evaluate(() => window.dispatchEvent(new Event('aetheria:update-ready')));
    await Promise.all([page.waitForEvent('load', { timeout: 60_000 }), page.getByTestId('about-reload').click()]);
    await acceptDisclaimerNew(page);
    expect(await page.evaluate(() => (window as any).__noReload ?? null), 'a new page').toBeNull();
    // The version equals classic's header badge.
    await tab(page, 'more');
    if ((await moreView(page)) !== 'about') await openMorePage(page, 'about');
    const version = ((await page.getByTestId('about-version').textContent()) ?? '').replace(/^Version (\S+) .*$/, '$1');
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await moreRow(page, 'more-back-to-classic').click();
    await expect(page.locator('header h1 > span').first()).toHaveText(version);
    expect(dialogs).toEqual([]);
  });

  test('S5b. Check for updates asks the registration: "This is the latest version." or "Downloading the new version…"; it never reloads', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      const w = window as any;
      w.__updates = 0;
      w.__installing = null;
      // A new worker as the registration shows it while it installs (v16.4 review: About follows its state).
      w.__worker = (state: string) => Object.assign(new EventTarget(), { state });
      const reg = {
        get installing() {
          return w.__installing;
        },
        waiting: null,
        update: async () => {
          w.__updates++;
        },
      };
      try {
        Object.defineProperty(navigator.serviceWorker, 'getRegistration', { configurable: true, value: async () => reg });
      } catch {}
    });
    const dialogs = await playingSeeded(page);
    await openMorePage(page, 'about');
    const check = page.getByTestId('about-check');
    await expect(check).toBeEnabled();
    await page.evaluate(() => ((window as any).__noReload = 1));
    await check.click();
    await expect(page.getByTestId('about-check-line')).toHaveText('This is the latest version.');
    expect(await page.evaluate(() => (window as any).__updates)).toBe(1);
    await page.evaluate(() => ((window as any).__installing = (window as any).__worker('installing')));
    await check.click();
    await expect(page.getByTestId('about-check-line')).toHaveText('Downloading the new version…');
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as any).__noReload), 'no reload').toBe(1);
    expect(dialogs).toEqual([]);
  });

  // v16.4 review: About's status lines never go stale. A stub service worker (the suite blocks real ones): its
  // controller, caches.keys() (counted), a registration with its workers, all set from the test.
  test('S5c. "Downloading the new version…" clears once the new worker installs, and says it couldn\'t when the install fails or errors; never a reload while playing', async ({ page }) => {
    test.setTimeout(150_000);
    await stubServiceWorker(page);
    const dialogs = await playingSeeded(page);
    await openMorePage(page, 'about');
    await page.evaluate(() => ((window as any).__noReload = 1));
    const check = page.getByTestId('about-check');
    const line = page.getByTestId('about-check-line');
    for (const [end, after] of [
      ['installed', null],
      ['redundant', "Couldn't check for updates."],
      ['error', "Couldn't check for updates."],
    ] as const) {
      await page.evaluate(() => (window as any).__sw.newWorker('installing'));
      await check.click();
      await expect(line).toHaveText('Downloading the new version…');
      await page.evaluate((end) => (window as any).__sw.finish(end), end);
      if (after === null) await expect.soft(line, `${end}: the downloading line clears`).toHaveCount(0);
      else await expect.soft(line, `${end}: the line says so`).toHaveText(after);
    }
    expect(await page.evaluate(() => (window as any).__noReload), 'no reload').toBe(1);
    expect((await libraryState(page)).playing, 'the music plays on').toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('S5d. the offline line follows the service worker (a new controller, its cached message, a worker\'s state), with no timer', async ({ page }) => {
    test.setTimeout(150_000);
    await stubServiceWorker(page);
    const dialogs = await playingSeeded(page);
    const offline = page.getByTestId('about-offline');
    const reopen = async () => {
      if ((await page.getByTestId('more').count()) && (await moreView(page)) === 'about') await page.getByRole('button', { name: 'Back to More', exact: true }).click();
      await openMorePage(page, 'about');
      await expect(offline).toContainText('Not saved for offline use yet');
    };
    // A new controller, with this version's cache.
    await reopen();
    const calls = await page.evaluate(() => (window as any).__sw.keysCalls as number);
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => (window as any).__sw.keysCalls as number), 'no timer reads the caches').toBe(calls);
    await page.evaluate(() => {
      const sw = (window as any).__sw;
      sw.setController(true);
      sw.keys = ['aetheria-v16.4-offline'];
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    });
    await expect.soft(offline, 'a new controller').toContainText('Works offline');
    // The worker's OFFLINE_READY message (it cached the page's files).
    await page.evaluate(() => ((window as any).__sw.keys = []));
    await reopen();
    await page.evaluate(() => {
      (window as any).__sw.keys = ['aetheria-v16.4-offline'];
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OFFLINE_READY', added: 0, total: 9 } }));
    });
    await expect.soft(offline, "the worker's cached message").toContainText('Works offline');
    // A worker's state change (the registration's active worker).
    await page.evaluate(() => ((window as any).__sw.keys = []));
    await reopen();
    await page.evaluate(() => {
      const sw = (window as any).__sw;
      sw.keys = ['aetheria-v16.4-offline'];
      sw.active.state = 'activated';
      sw.active.dispatchEvent(new Event('statechange'));
    });
    await expect.soft(offline, "a worker's state").toContainText('Works offline');
    expect(dialogs).toEqual([]);
  });

  test('S5e. only this version\'s offline cache counts: another version\'s says "Not saved for offline use yet"', async ({ page }) => {
    test.setTimeout(150_000);
    await stubServiceWorker(page, { controller: true, keys: ['aetheria-v16.3-offline', 'aetheria-v16.5-offline'] });
    const dialogs = await playingSeeded(page);
    await openMorePage(page, 'about');
    const offline = page.getByTestId('about-offline');
    await expect(offline, "another version's cache").toContainText('Not saved for offline use yet');
    await page.evaluate(() => ((window as any).__sw.keys = ['aetheria-v16.3-offline', 'aetheria-v16.4-offline']));
    await page.getByRole('button', { name: 'Back to More', exact: true }).click();
    await openMorePage(page, 'about');
    await expect(offline, "this version's").toContainText('Works offline');
    expect(dialogs).toEqual([]);
  });

  test('S6. the new layout\'s first run: the disclaimer, then the 4-card tour (modal), Done saves it; About › Show the tour; classic keeps its Quick Guide', async ({ page }) => {
    test.setTimeout(150_000);
    const dialogs = watchNativeDialogs(page);
    await page.goto('/?layout=new');
    await page.getByRole('button', { name: /I understand, let me begin/ }).click();
    await phoneSize(page);
    const tour = page.getByRole('dialog', { name: 'Tour, card 1 of 4', exact: true });
    await expect(tour).toBeVisible();
    await expect(page.getByText('Quick Guide', { exact: true })).toHaveCount(0);
    await expect(tour).toContainText('Welcome to Aetheria');
    await expect(tour).toContainText('An advanced music player that takes the songs you already love and does three things.');
    // Modal: the shell behind is out of reach and out of the accessibility tree.
    expect(await page.evaluate(() => document.getElementById('root')!.inert), '#root inert').toBe(true);
    expect(await inAxTree(page, 'button', 'Next track'), "Now Playing's Next track is not exposed").toBe(false);
    expect(await inAxTree(page, 'button', 'Next'), "the tour's Next is").toBe(true);
    const next = page.getByTestId('tour').getByRole('button', { name: 'Next', exact: true });
    await next.click();
    await expect(page.getByRole('dialog', { name: 'Tour, card 2 of 4', exact: true })).toContainText('27 crystals, three ranges');
    await next.click();
    // Card 3 names the Guidebook where v16.4 has it (v16.4 review: there is no More › Guide yet).
    const card3 = page.getByRole('dialog', { name: 'Tour, card 3 of 4', exact: true });
    await expect(card3).toContainText(
      'The Guidebook: In the classic layout for now: More › Guide, Record, Journal, scan scores, then the book icon in the sidebar. Plain language or the technical view.'
    );
    await expect(card3).not.toContainText('More › Guide, in plain language');
    await next.click();
    const last = page.getByRole('dialog', { name: 'Tour, card 4 of 4', exact: true });
    await expect(last).toContainText('Where things are');
    await expect(last).toContainText('Library: your tracks and playlists.');
    expect(await stored(page, TUTORIAL_KEY), 'not seen until it is closed').toBeNull();
    await last.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('tour')).toHaveCount(0);
    expect(await stored(page, TUTORIAL_KEY)).toBe('true');
    // About › Show the tour reopens it; Close gives the focus back to the row.
    await openMorePage(page, 'about');
    await page.getByTestId('about-tour-row').click();
    await expect(page.getByRole('dialog', { name: 'Tour, card 1 of 4', exact: true })).toBeVisible();
    await page.getByTestId('tour').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('tour')).toHaveCount(0);
    await expect(page.getByTestId('about-tour-row')).toBeFocused();
    // The in-test control: classic's first run still shows its Quick Guide.
    await page.evaluate(() => localStorage.clear());
    await page.goto('/?layout=classic');
    await page.getByRole('button', { name: /I understand, let me begin/ }).click();
    await expect(page.getByText('Quick Guide', { exact: true })).toBeVisible();
    await expect(page.getByTestId('tour')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('S7. Links: classic\'s sections, titles, sub-lines, addresses and footer; an https tap opens the browser (window.open), mailto passes through', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = await openApp(page);
    // Classic's panel, as data.
    await page.getByTitle('Links & Resources', { exact: true }).click();
    const classicLinks = await page.evaluate(() => {
      const panel = Array.from(document.querySelectorAll('div')).find((d) => d.className.includes('z-[54]'))!;
      const sections = Array.from(panel.querySelectorAll('div.uppercase.text-center')).map((d) => (d.textContent ?? '').trim());
      const links = Array.from(panel.querySelectorAll('a[href]')).map((a) => ({
        href: a.getAttribute('href'),
        title: (a.querySelector('h4')?.textContent ?? '').trim(),
        sub: (a.querySelector('p')?.textContent ?? '').trim(),
      }));
      const footer = Array.from(panel.querySelectorAll('div.text-center.pt-4 > div')).map((d) => (d.textContent ?? '').trim()).filter((t) => t && t !== '🙏');
      return { sections, links, footer };
    });
    expect(classicLinks.links.length, "classic's links read").toBeGreaterThan(20);
    // The new layout's page.
    await page.evaluate((k) => localStorage.setItem(k, 'new'), LAYOUT_KEY);
    await page.reload();
    await acceptDisclaimerNew(page);
    await phoneSize(page);
    await openMorePage(page, 'links');
    await expect(page.getByTestId('more-links')).toContainText('They open in your browser; the music keeps playing here.');
    const ours = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="more-links"]')!;
      const sections = Array.from(root.querySelectorAll('[data-testid="links-section-label"]')).map((d) => (d.textContent ?? '').trim());
      const links = Array.from(root.querySelectorAll('a[data-testid="links-row"]')).map((a) => ({
        href: a.getAttribute('href'),
        title: (a.querySelector('[data-testid="links-title"]')?.textContent ?? '').trim(),
        sub: (a.querySelector('[data-testid="links-sub"]')?.textContent ?? '').trim(),
      }));
      const footer = Array.from(root.querySelectorAll('[data-testid="links-footer"] > div')).map((d) => (d.textContent ?? '').trim());
      return { sections, links, footer };
    });
    expect(ours).toEqual(classicLinks);
    // The guard.
    await page.evaluate(() => {
      const w = window as any;
      w.__opens = [];
      window.open = ((...args: unknown[]) => {
        w.__opens.push(args);
        return null;
      }) as typeof window.open;
      window.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest('a[href^="mailto:"]');
        if (!a) return;
        w.__mailPrevented = e.defaultPrevented;
        e.preventDefault(); // the test's own: no mail app here
      });
    });
    const url = page.url();
    const first = page.getByTestId('links-row').first();
    const href = await first.getAttribute('href');
    await first.click();
    await expect.poll(() => page.evaluate(() => (window as any).__opens)).toEqual([[href, '_blank', 'noopener,noreferrer']]);
    expect(page.url(), 'the player stays').toBe(url);
    const mail = page.locator('a[data-testid="links-row"][href^="mailto:"]');
    await mail.scrollIntoViewIfNeeded();
    await mail.click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__opens.length), 'mailto: no window.open').toBe(1);
    expect(await page.evaluate(() => (window as any).__mailPrevented), 'mailto: passes through the guard').toBe(false);
    expect(page.url()).toBe(url);
    expect(dialogs).toEqual([]);
  });
});
