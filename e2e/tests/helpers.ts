import { expect, type Page } from '@playwright/test';

/** A short mono 16-bit PCM sine WAV (8 kHz), small enough to import dozens. */
export function toneWav(seconds: number, freq: number): Buffer {
  const rate = 8000;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 400, (n - i) / 400);
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000 * fade), 44 + i * 2);
  }
  return buf;
}

/**
 * Open the app past the first-run tutorial and the launch disclaimer.
 * Returns the messages of every alert/confirm/prompt the page raises: tests
 * assert it stays empty, because a blocking dialog freezes playback on a locked
 * phone (Playwright would otherwise auto-dismiss them unseen). With
 * `acceptDialogs` (the row Delete confirm) dialogs are accepted, not recorded.
 * Also counts HTMLMediaElement.pause() calls in window.__pauseCount: the
 * gapless advance never pauses, the playTrack fallback does.
 */
export async function openApp(page: Page, opts: { acceptDialogs?: boolean; query?: string } = {}): Promise<string[]> {
  const dialogs: string[] = [];
  page.on('dialog', async (d) => {
    if (opts.acceptDialogs) {
      await d.accept();
    } else {
      dialogs.push(`${d.type()}: ${d.message()}`);
      await d.dismiss();
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
    const w = window as any;
    w.__pauseCount = 0;
    const original = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      w.__pauseCount++;
      return original.call(this);
    };
  });
  await page.goto('/' + (opts.query ?? ''));
  await acceptDisclaimer(page);
  return dialogs;
}

/** The launch disclaimer (shown until accepted; from v14.6 once per text version). */
export async function acceptDisclaimer(page: Page): Promise<void> {
  const accept = page.getByRole('button', { name: /I understand, let me begin/ });
  if (await accept.isVisible().catch(() => false)) await accept.click();
}

export async function pauseCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__pauseCount as number);
}

/** Import `count` tones named `${prefix}-01` … through the "Add files" input. */
export async function importTones(page: Page, count: number, seconds: number, prefix = 'tone'): Promise<void> {
  const files = Array.from({ length: count }, (_, i) => ({
    name: `${prefix}-${String(i + 1).padStart(2, '0')}.wav`,
    mimeType: 'audio/wav',
    buffer: toneWav(seconds, 220 + i * 37),
  }));
  await page.getByLabel('Add files').setInputFiles(files);
}

/**
 * Simulate a v14.4 library shrink: the saved lists keep only their first
 * `keep` tracks while every track's audio stays stored, so the rest come back
 * as orphans. Done from another same-origin page, so the app can't save over
 * the edit; the page is left on /manifest.json.
 */
export async function shrinkSavedLibrary(page: Page, keep: number): Promise<void> {
  await page.goto('/manifest.json');
  await page.evaluate(async (keep) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('playlist-state', 'readwrite');
    const store = tx.objectStore('playlist-state');
    const state: any = await new Promise((resolve) => {
      const r = store.get('current');
      r.onsuccess = () => resolve(r.result);
    });
    state.originalOrder = state.originalOrder.slice(0, keep);
    state.playlistOrder = state.playlistOrder.slice(0, keep);
    state.currentSongIndex = -1;
    store.put(state);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, keep);
}

/**
 * From the next page load on, navigator.storage.estimate reports a full device
 * while window.__storageFull is true (it starts true on every load; set it to
 * false to free the space). The app's audio saves check it before writing.
 */
export async function stubStorageFull(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__storageFull = true;
    const storage = navigator.storage as any;
    const estimate = storage.estimate.bind(storage);
    storage.estimate = async () => (w.__storageFull ? { quota: 1024 * 1024, usage: 1024 * 1024 } : estimate());
  });
}

/**
 * From the next page load on: metadata and state saves fail the way they do on
 * a full device (their transaction aborts) while window.__failStateSaves is
 * true (it starts false), and every cache report is recorded in
 * window.__cacheEvents as { type: 'cache-error' | 'cache-ok', what, seq, ... }.
 */
export async function controlStateSaves(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__failStateSaves = false;
    w.__cacheEvents = [];
    for (const type of ['aetheria:cache-error', 'aetheria:cache-ok']) {
      window.addEventListener(type, (e) =>
        w.__cacheEvents.push({ type: type.slice('aetheria:'.length), ...(e as CustomEvent).detail })
      );
    }
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
      const request = (put as any).apply(this, args);
      if (w.__failStateSaves && (this.name === 'meta' || this.name === 'playlist-state')) this.transaction.abort();
      return request;
    } as typeof put;
  });
}

/** Seconds elapsed in the current track, from the transport readout "m:ss / m:ss". */
export async function elapsedSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId('transport-time').textContent()) ?? '';
  const m = /(\d+):(\d{2})/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

export interface CacheCounts {
  blobs: number;
  meta: number;
  library: number;
  playOrder: number;
  /** Stored metadata records that carry an analysis (harmonicFreq). */
  analysed: number;
  /** Saved library entries counted with repeats (library counts unique ids). */
  libraryRaw: number;
}

/** What the app has persisted in IndexedDB ('aetheria-db'). */
export async function cacheCounts(page: Page): Promise<CacheCounts> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const has = (s: string) => db.objectStoreNames.contains(s);
    const count = (s: string) =>
      has(s)
        ? new Promise<number>((resolve, reject) => {
            const r = db.transaction(s, 'readonly').objectStore(s).count();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          })
        : Promise.resolve(0);
    const state: any = has('playlist-state')
      ? await new Promise((resolve, reject) => {
          const r = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('current');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        })
      : undefined;
    const metas: any[] = has('meta')
      ? await new Promise((resolve, reject) => {
          const r = db.transaction('meta', 'readonly').objectStore('meta').getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        })
      : [];
    const out = {
      analysed: metas.filter((m) => m.harmonicFreq != null).length,
      blobs: await count('blobs'),
      meta: await count('meta'),
      library: state ? new Set(state.originalOrder).size : 0,
      libraryRaw: state ? state.originalOrder.length : 0,
      playOrder: state ? state.playlistOrder.length : 0,
    };
    db.close();
    return out;
  });
}

/** Wait until the persisted cache matches (debounced saves take a few seconds). */
export async function expectCache(page: Page, expected: Partial<CacheCounts>, timeout = 15_000): Promise<void> {
  await expect.poll(() => cacheCounts(page), { timeout, intervals: [500, 1000] }).toMatchObject(expected);
}
