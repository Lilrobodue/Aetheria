import { type Page } from '@playwright/test';
import { test, expect, ON_DEVICE } from './fixtures';
import {
  acceptDisclaimer,
  acceptDisclaimerNew,
  cacheCounts,
  confirmDelete,
  countBlobSaves,
  countLibraryDeletes,
  libraryState,
  metaRecords,
  rowOf,
  savedState,
  startWalk,
  tab,
  undoToast,
  LAYER_ENGINE_KEY,
  LAYOUT_KEY,
  PHONE_VIEWPORT,
} from './helpers';

// v16.0, the queue, Stage A (spec §5.5): driven through the dev hook window.__aetheriaQueue, in both layouts. Queued
// tracks are INSERTED into the playing list, so the pinned advance code (in-app Next, the gapless swap, the media
// session's Next that the car and the lock screen call) plays them as the next entry; these tests prove it, and the
// anchor rule, the one batch (shuffle), the walk's snapshot, the persistence and the data safety around it.
// The probe's method (scratchpad v160/probes): synthetic tones only, tone k lasting 6 + 0.25 k seconds; what the music
// element plays is read from its source (the blob URL minted for that track's File), not from the cursor or the title;
// the media-session handlers the OS calls are captured (window.__ms.nexttrack is the car's and the lock screen's Next);
// a decode gate holds an unscanned track's start. A queue call is made inside a click event (a tap's priority).

const toneName = (k: number) => `tone-${String(k).padStart(2, '0')}`;
const secondsOf = (k: number) => 6 + 0.25 * k;
const CRY = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];

interface Seed {
  n: number;
  /** 1-based tones with a crystal but no measured frequency: Next decodes them (the gapless swap still takes them). */
  unscanned?: number[];
  /** 1-based tones with no crystal at all: the swap refuses them, playTrack decodes them. */
  noCrystal?: number[];
  /** The saved play state: order (1-based tones), cursor, walk, queue. */
  state?: { order: number[]; cursor: number; walk?: unknown; queue?: unknown };
  /** 1-based tones whose audio is gone. */
  noBlob?: number[];
}

async function seed(page: Page, s: Seed): Promise<string[]> {
  await page.goto('/manifest.json');
  return page.evaluate(async ({ n, unscanned, noCrystal, state, noBlob, CRY }) => {
    const wav = (secs: number, freq: number) => {
      const rate = 4000, len = Math.round(secs * rate), buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
      const w = (o: number, x: string) => { for (let i = 0; i < x.length; i++) v.setUint8(o + i, x.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
      v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      w(36, 'data'); v.setUint32(40, len * 2, true);
      for (let i = 0; i < len; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 5000 * Math.min(1, i / 400, (len - i) / 400)), true);
      return new Blob([buf], { type: 'audio/wav' });
    };
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db', 2);
      r.onupgradeneeded = () => { const d = r.result; for (const x of ['blobs', 'meta']) d.createObjectStore(x, { keyPath: 'id' }); d.createObjectStore('playlist-state', { keyPath: 'key' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const t0 = Date.now() - n * 1000;
    const ids: string[] = [];
    const tx = db.transaction(['blobs', 'meta'], 'readwrite');
    for (let i = 0; i < n; i++) {
      const k = i + 1;
      const id = `${t0 + i * 1000}-q${String(k).padStart(2, '0')}`;
      ids.push(id);
      const name = `tone-${String(k).padStart(2, '0')}`;
      const secs = 6 + 0.25 * k;
      if (!noBlob.includes(k)) tx.objectStore('blobs').put({ id, fileBlob: wav(secs, 220 + i * 11), fileName: `${name}.wav`, fileType: 'audio/wav' });
      const meta: any = { id, name, duration: secs };
      const hz = CRY[i % 27];
      if (!noCrystal.includes(k)) Object.assign(meta, { harmonicFreq: hz + 2.5, closestSolfeggio: hz, harmonicDeviation: 2.5, crystalSource: 'scan' });
      if (unscanned.includes(k)) delete meta.harmonicFreq;
      tx.objectStore('meta').put(meta);
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    const order = state ? state.order.map((k: number) => ids[k - 1]) : ids;
    const st = db.transaction('playlist-state', 'readwrite');
    st.objectStore('playlist-state').put({
      key: 'current', playlistOrder: order, originalOrder: ids, currentSongIndex: state ? state.cursor : -1,
      loShuWalkMode: (state?.walk as any)?.mode ?? null, ...(state?.walk ? { walk: state.walk } : {}), ...(state?.queue ? { queue: state.queue } : {}),
      selectedSolfeggio: 396, savedAt: Date.now(),
    });
    await new Promise((resolve) => (st.oncomplete = resolve));
    db.close();
    return ids;
  }, { n: s.n, unscanned: s.unscanned ?? [], noCrystal: s.noCrystal ?? [], state: s.state ?? null, noBlob: s.noBlob ?? [], CRY });
}

/** Before the app: the music element (play() hook), its pauses, the media-session handlers the OS calls, a decode gate,
 *  and which tone each blob URL plays. */
async function instrument(page: Page, o: { layout?: 'classic' | 'new' } = {}): Promise<void> {
  await page.addInitScript(({ keys, layout }) => {
    const w = window as any;
    try {
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      if (sessionStorage.getItem('__queueSeeded') === null) {
        sessionStorage.setItem('__queueSeeded', '1');
        localStorage.setItem(keys.engine, 'classic');
        if (layout === 'new') localStorage.setItem(keys.layout, 'new');
      }
    } catch {}
    w.__pauses = 0;
    // Every track the music element starts, in order (a repeat of the same track's play(), e.g. the watchdog's, is one).
    w.__plays = [];
    // Every play() of the music element (a restart of the same track counts), and a refusal on demand (the browser's
    // autoplay block, as a locked phone gives it).
    w.__playCalls = 0;
    w.__failNextPlay = false;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = String(this.getAttribute('src') ?? this.src);
      if (!src.startsWith('data:')) {
        w.__playCalls++;
        if (w.__failNextPlay) {
          w.__failNextPlay = false;
          return Promise.reject(new DOMException('blocked (test)', 'NotAllowedError'));
        }
        w.__el = this;
        const name = w.__urlName?.get(src) ?? null;
        if (name && w.__plays[w.__plays.length - 1] !== name) w.__plays.push(name);
      }
      (w.__media ??= new Set()).add(this);
      return play.call(this);
    };
    const pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      if (this === w.__el) w.__pauses++;
      return pause.call(this);
    };
    w.__ms = {};
    if ('mediaSession' in navigator) {
      const set = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { w.__ms[a] = h; return set(a, h); };
    }
    w.__holdDecode = false;
    w.__decodeHeld = 0;
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: any[]) {
      if (!w.__holdDecode) return (decode as any).apply(this, a);
      w.__decodeHeld++;
      return new Promise((res, rej) => { w.__releaseDecode = () => (decode as any).apply(this, a).then(res, rej); });
    } as any;
    w.__urlName = new Map();
    const mint = URL.createObjectURL;
    URL.createObjectURL = function (obj: any) { const u = mint.call(URL, obj); if (obj && typeof obj.name === 'string') w.__urlName.set(u, obj.name.replace(/\.wav$/, '')); return u; } as any;
    w.__heard = () => (w.__el ? (w.__urlName.get(w.__el.getAttribute('src')) ?? null) : null);
    w.__card = () => (navigator as any).mediaSession?.metadata?.title ?? null;
    // A queue call inside a click event: a tap's priority (React renders it at once).
    w.__tap = (f: () => void) => { const b = document.createElement('button'); b.addEventListener('click', () => f()); document.body.appendChild(b); b.click(); b.remove(); };
  }, { keys: { engine: LAYER_ENGINE_KEY, layout: LAYOUT_KEY }, layout: o.layout ?? 'classic' });
}

async function open(page: Page, s: Seed, o: { layout?: 'classic' | 'new' } = {}): Promise<string[]> {
  await instrument(page, o);
  const ids = await seed(page, s);
  await page.goto('/');
  if (o.layout === 'new') await acceptDisclaimerNew(page);
  else await acceptDisclaimer(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { timeout: 60_000 }).toBe(s.n - (s.noBlob?.length ?? 0));
  await page.waitForFunction(() => typeof (window as any).__aetheriaQueue?.state === 'function', null, { timeout: 10_000 });
  return ids;
}

const heard = (page: Page) => page.evaluate(() => (window as any).__heard() as string | null);
const card = (page: Page) => page.evaluate(() => (window as any).__card() as string | null);
const pauses = (page: Page) => page.evaluate(() => (window as any).__pauses as number);
const qstate = (page: Page) => page.evaluate(() => (window as any).__aetheriaQueue.state());
const idOf = async (page: Page, name: string) => { const s = await libraryState(page); return s.libraryIds[s.libraryNames.indexOf(name)]; };

/** Play next / Add to queue, as a tap. */
async function queue(page: Page, names: string[], mode: 'next' | 'queue'): Promise<void> {
  const ids = await Promise.all(names.map((n) => idOf(page, n)));
  await page.evaluate(({ ids, mode }) => (window as any).__tap(() => (window as any).__aetheriaQueue.add(ids, mode)), { ids, mode });
}
/** A queue edit (as the sheet makes it), as a tap. */
async function edit(page: Page, op: unknown): Promise<void> {
  await page.evaluate((op) => (window as any).__tap(() => (window as any).__aetheriaQueue.edit(op)), op);
}
/** The waiting entry named `name`: { index, id }. */
async function waitingEntry(page: Page, name: string): Promise<{ index: number; id: string }> {
  const q = await qstate(page);
  const s = await libraryState(page);
  const index = (q.waiting as number[]).find((i) => s.names[i] === name)!;
  return { index, id: s.ids[index] };
}
const carNext = (page: Page) => page.evaluate(() => (window as any).__ms.nexttrack());
const carPrev = (page: Page) => page.evaluate(() => (window as any).__ms.previoustrack());

const aside = (page: Page) => page.locator('aside');
/** Classic: a drawer row's tap (playTrack, as a user's pick). */
async function playClassic(page: Page, name: string): Promise<void> {
  const row = aside(page).getByText(name, { exact: true }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expectHeard(page, name, 0.2);
}
/** Classic's Pause, and wait for the element to stop (a test about the queue's state, not about what plays next). */
async function pauseNow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => (window as any).__el?.paused)).toBe(true);
}
const nextButton = (page: Page) => page.getByRole('button', { name: 'Next track', exact: true }).first();
const prevButton = (page: Page) => page.getByRole('button', { name: 'Previous track', exact: true }).first();
const shuffleButton = (page: Page) => page.getByRole('button', { name: 'Shuffle', exact: true }).first();

/** The element plays `name` (past `t` seconds), and the title (the cursor) and the lock-screen card name it. Within 5 s
 *  by default: every tone lasts 6.25 s or more, so a later track can never stand in for the one expected. */
async function expectHeard(page: Page, name: string, t = 0.05, timeout = 5_000): Promise<void> {
  await expect
    .poll(async () => {
      const s = await libraryState(page);
      const el = await page.evaluate(() => { const e = (window as any).__el; return e ? { paused: e.paused, t: e.currentTime } : null; });
      return { heard: await heard(page), title: s.current, card: await card(page), playing: !!el && !el.paused && el.t > t };
    }, { message: `${name} plays, and the title and the card name it`, timeout })
    .toEqual({ heard: name, title: name, card: name, playing: true });
}
const playsCount = (page: Page) => page.evaluate(() => (window as any).__plays.length as number);
/** The first track the element started after mark `n` (playsCount before the action) is `name`, and it plays now, named
 *  by the title and the card: nothing else started in between. */
async function expectNextPlay(page: Page, n: number, name: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => playsCount(page), { message: `a track starts after mark ${n}`, timeout }).toBeGreaterThan(n);
  expect(await page.evaluate((n) => (window as any).__plays[n], n), 'the first track started is the expected one').toBe(name);
  await expectHeard(page, name);
}
/** In-app Next (classic's, or `button`): the first track it starts is `name`. */
async function nextPlays(page: Page, name: string, button?: ReturnType<Page['getByRole']>): Promise<void> {
  const n = await playsCount(page);
  await (button ?? nextButton(page)).click();
  await expectNextPlay(page, n, name);
}
/** The car's / lock screen's Next (the media-session handler the OS calls): the first track it starts is `name`. */
async function carPlays(page: Page, name: string): Promise<void> {
  const n = await playsCount(page);
  await carNext(page);
  await expectNextPlay(page, n, name);
}
/** `from` runs out: the first track the advance starts (the gapless swap, or the fallback) is `name`. */
async function swapPlays(page: Page, from: string, name: string): Promise<void> {
  const n = await playsCount(page);
  expect(await heard(page), `${from} still plays`).toBe(from);
  await expectNextPlay(page, n, name, 30_000);
}
/** Wait until the element plays something other than `name` (the track ran out). */
async function waitLeaves(page: Page, name: string, timeout = 20_000): Promise<void> {
  await expect.poll(() => heard(page), { message: `${name} ends`, timeout }).not.toBe(name);
}
const namesNow = async (page: Page) => (await libraryState(page)).names;

test.beforeEach(async ({ page }) => {
  if (ON_DEVICE) await page.setViewportSize({ width: 1280, height: 800 });
});

// ---------------------------------------------------------------------------------------------------------------
// Q1. The core regression, sequential: Play next of tone-10 while tone-01 plays, then each of the three advance paths.
// ---------------------------------------------------------------------------------------------------------------
test.describe('Q1. Play next plays next (sequential)', () => {
  test('Q1a. in-app Next plays the queued track, then the play order goes on; classic lists it in place @mobile', async ({ page }) => {
    await open(page, { n: 12 });
    await playClassic(page, toneName(1));
    await queue(page, [toneName(10)], 'next');
    await expect.poll(() => namesNow(page)).toEqual([1, 10, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    expect((await qstate(page)).marks).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Classic follows the queue: its drawer lists the play order, the queued entry in its place.
    await expect.poll(() => aside(page).locator('div.group').evaluateAll((rows) => rows.slice(0, 3).map((r) => (r.textContent ?? '').match(/tone-\d{2}/)?.[0]))).toEqual([1, 10, 2].map(toneName));
    await nextPlays(page, toneName(10));
    expect((await qstate(page)).marks[1], 'the queued entry played').toBe(2);
    await nextPlays(page, toneName(2));
  });

  test('Q1b. the track runs out: the gapless swap starts the queued track (no pause), then the play order goes on', async ({ page }) => {
    await open(page, { n: 12 });
    await playClassic(page, toneName(1));
    await queue(page, [toneName(10)], 'next');
    const p0 = await pauses(page);
    await swapPlays(page, toneName(1), toneName(10));
    expect(await pauses(page), 'the swap never pauses').toBe(p0);
    await swapPlays(page, toneName(10), toneName(2));
    expect(await pauses(page), 'nor the next one').toBe(p0);
  });

  test('Q1c. the car / lock-screen Next plays the queued track, then the play order goes on @mobile', async ({ page }) => {
    await open(page, { n: 12 });
    await playClassic(page, toneName(1));
    await queue(page, [toneName(10)], 'next');
    await carPlays(page, toneName(10));
    await carPlays(page, toneName(2));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Q2. Shuffle on: the same three paths; the rest of the shuffle order is kept (insert and shift, no regeneration).
// ---------------------------------------------------------------------------------------------------------------
test('Q2. shuffle: Play next plays next by Next, the swap and car Next; every other entry keeps its shuffle place', async ({ page }) => {
  test.setTimeout(150_000);
  await open(page, { n: 12 });
  await shuffleButton(page).click();
  await playClassic(page, toneName(1));
  const seqNames = (s: { names: string[]; shuffled: number[] }) => s.shuffled.map((i) => s.names[i]);
  for (const path of ['next', 'swap', 'car'] as const) {
    const before = await libraryState(page);
    const cur = before.current!;
    const x = [10, 11, 12].map(toneName).find((n) => n !== cur && seqNames(before)[before.shufflePos + 1] !== n)!;
    await queue(page, [x], 'next');
    await expect.poll(async () => (await libraryState(page)).ids.length).toBe(before.ids.length + 1);
    const after = await libraryState(page);
    const seq = seqNames(after);
    expect(seq[after.shufflePos], `${path}: the cursor keeps its track`).toBe(cur);
    expect(seq[after.shufflePos + 1], `${path}: the queued track is next in the shuffle order`).toBe(x);
    // Every other entry keeps its place in the sequence (compared by song, the new entry left out).
    const without = (a: string[], pos: number) => a.filter((_, j) => j !== pos);
    expect(without(seq, after.shufflePos + 1), `${path}: the rest of the shuffle order is unchanged`).toEqual(seqNames(before));
    const p0 = await pauses(page);
    const n = await playsCount(page);
    if (path === 'next') await nextButton(page).click();
    else if (path === 'car') await carNext(page);
    // The swap: the track runs out; the first track started after it is the queued one.
    await expectNextPlay(page, n, x, 30_000);
    if (path === 'swap') expect(await pauses(page), 'the swap never pauses').toBe(p0);
    const s = await libraryState(page);
    expect(s.shuffled[s.shufflePos], `${path}: shufflePos follows the cursor`).toBe(s.cursor);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Q3. A walk (CAB from the Walks sheet, the new layout on a phone): the walk stays, the queued entry is step −1, the
// source line says so, the cube holds the last walk step, and the walk then goes on at its next step.
// ---------------------------------------------------------------------------------------------------------------
test.describe('Q3. a queued track inside a walk', () => {
  test.use({ viewport: PHONE_VIEWPORT });
  test('Q3. Next: the walk stays (segments kept, step −1), the source line, the cube, then the walk’s step 2', async ({ page }) => {
    test.setTimeout(150_000);
    if (ON_DEVICE) await page.setViewportSize(PHONE_VIEWPORT);
    await page.addInitScript(() => {
      const w = window as any;
      w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), isDisabled: false, inject(r: unknown) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; }, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, setStrictMode() {}, onCommitFiberRoot(_i: number, root: unknown) { w.__root = root; } };
      w.__vizStep = () => { const stack = [w.__root?.current]; while (stack.length) { const f = stack.pop(); if (!f) continue; const p = f.memoizedProps; if (p && typeof p === 'object' && 'loShuWalkStep' in p && 'analyser' in p) return p.loShuWalkStep; if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child); } return null; };
    });
    await open(page, { n: 30 }, { layout: 'new' });
    await startWalk(page, 'combined');
    const w0 = await libraryState(page);
    expect(w0.cursor).toBe(0);
    const x = w0.libraryNames.find((n) => n !== w0.names[0] && n !== w0.names[1])!;
    await queue(page, [x], 'next');
    await expect.poll(async () => (await libraryState(page)).names[1]).toBe(x);
    const w1 = await libraryState(page);
    expect(w1.walk, 'the walk stays').toBe('combined');
    expect(w1.segments, 'its segments are unchanged').toEqual(w0.segments);
    expect(w1.steps![1], 'the queued entry is step −1').toBe(-1);
    expect(w1.phases ? w1.phases[1] : '', 'with no phase').toBe('');
    expect([w1.steps![0], ...w1.steps!.slice(2)], 'the walk’s own steps are unchanged').toEqual(w0.steps);
    const count = w0.steps!.length;
    await expect(page.getByTestId('np-source')).toHaveText(new RegExp(`^Lo Shu walk · CAB · step 1 of ${count}`));
    await nextPlays(page, x, page.getByTestId('view-now').getByRole('button', { name: 'Next track', exact: true }));
    await expect(page.getByTestId('np-source')).toHaveText(`Your queue · 1 of 1 · then CAB step 2 of ${count}`);
    expect(await page.evaluate(() => (window as any).__vizStep()), 'the cube holds the last walk step').toBe(w0.steps![0]);
    expect((await libraryState(page)).walk).toBe('combined');
    await nextPlays(page, w0.names[1], page.getByTestId('view-now').getByRole('button', { name: 'Next track', exact: true }));
    await expect(page.getByTestId('np-source')).toHaveText(new RegExp(`^Lo Shu walk · CAB · step 2 of ${count} · Vortex 2/`));
    expect(await page.evaluate(() => (window as any).__vizStep()), 'the cube follows the walk again').toBe(w0.steps![1]);
  });

  test('Q3b. the swap and car Next play the queued track inside the walk, which stays', async ({ page }) => {
    test.setTimeout(150_000);
    if (ON_DEVICE) await page.setViewportSize(PHONE_VIEWPORT);
    await open(page, { n: 30 }, { layout: 'new' });
    await startWalk(page, 'A');
    const w0 = await libraryState(page);
    const others = w0.libraryNames.filter((n) => !w0.names.slice(0, 4).includes(n));
    await queue(page, [others[0]], 'next');
    await expect.poll(async () => (await libraryState(page)).names[1]).toBe(others[0]);
    await swapPlays(page, w0.names[0], others[0]);
    await queue(page, [others[1]], 'next');
    await expect.poll(async () => (await libraryState(page)).names[2]).toBe(others[1]);
    await carPlays(page, others[1]);
    await carPlays(page, w0.names[1]);
    const s = await libraryState(page);
    expect(s.walk, 'the walk stays through all of it').toBe('A');
    expect(s.steps!.filter((x) => x === -1).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Q4. Order: Add to queue keeps its order; Play next goes before the waiting ones; a move reorders.
// ---------------------------------------------------------------------------------------------------------------
test('Q4. three Add to queue play in order; Play next after them plays first; moving the third to the top plays it first', async ({ page }) => {
  test.setTimeout(150_000);
  await open(page, { n: 12 });
  await playClassic(page, toneName(1));
  await pauseNow(page);
  for (const k of [5, 6, 7]) await queue(page, [toneName(k)], 'queue');
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([5, 6, 7].map(toneName));
  await queue(page, [toneName(8)], 'next');
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([8, 5, 6, 7].map(toneName));
  // tone-07 (the 4th) to the top.
  await edit(page, { move: { ...(await waitingEntry(page, toneName(7))), to: 0 } });
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([7, 8, 5, 6].map(toneName));
  for (const k of [7, 8, 5, 6, 2]) {
    await nextPlays(page, toneName(k));
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Q5. The stale windows (survey E1, E2): the anchor rule and the functional cursor shift.
// ---------------------------------------------------------------------------------------------------------------
test.describe('Q5. the stale windows', () => {
  test('Q5a. Play next inside the swap’s own timeupdate: the swap’s track stays current, the queued one plays after it', async ({ page }) => {
    await open(page, { n: 12 });
    await playClassic(page, toneName(1));
    const x = await idOf(page, toneName(10));
    // A listener added after the app's: in the same dispatch it runs right after the swap, before React commits it.
    await page.evaluate((x) => {
      const w = window as any;
      const el = w.__el;
      const start = el.getAttribute('src');
      const on = () => {
        if (el.getAttribute('src') === start) return;
        el.removeEventListener('timeupdate', on);
        w.__inSwap = { heard: w.__heard(), cursor: w.__aetheriaLibrary.state().current };
        w.__aetheriaQueue.add([x], 'next');
      };
      el.addEventListener('timeupdate', on);
    }, x);
    await expect.poll(() => page.evaluate(() => (window as any).__inSwap), { timeout: 20_000 }).toEqual({ heard: toneName(2), cursor: toneName(1) });
    await expectHeard(page, toneName(2));
    await expect.poll(() => namesNow(page)).toEqual([1, 2, 10, 3].map(toneName).concat([4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName)));
    expect((await libraryState(page)).cursor).toBe(1);
    await carPlays(page, toneName(10));
  });

  test('Q5b. Next onto an unscanned track, its decode held, then Play next: the starting track lands named, car Next plays the queued one', async ({ page }) => {
    await open(page, { n: 12, unscanned: [2] });
    await playClassic(page, toneName(1));
    await page.evaluate(() => { (window as any).__holdDecode = true; });
    await nextButton(page).click();
    await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
    expect(await heard(page), 'the element holds the starting track').toBe(toneName(2));
    expect((await libraryState(page)).current, 'the cursor has not moved yet').toBe(toneName(1));
    await queue(page, [toneName(10)], 'next');
    await expect.poll(() => namesNow(page)).toEqual([1, 2, 10, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
    await expectHeard(page, toneName(2));
    expect((await libraryState(page)).cursor).toBe(1);
    await carPlays(page, toneName(10));
  });

  test('Q5d. a copy of the playing track starting (no crystal: its start decodes), then Play next: the write waits for it, the copy lands named, car Next plays the queued one', async ({ page }) => {
    // Review probe D: Play next of the playing track puts a copy of it next; when the track runs out, the swap refuses a
    // track with no crystal and playTrack decodes the copy. The element plays the same track as the cursor's then, which
    // is no proof the start has landed: a write that took it so went in before the starting copy, and the copy's
    // playTrack then put the cursor on the queued track while the element played the copy.
    test.setTimeout(90_000);
    await open(page, { n: 12, noCrystal: [1] });
    await playClassic(page, toneName(1));
    await queue(page, [toneName(1)], 'next');
    await expect.poll(() => namesNow(page)).toEqual([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    await page.evaluate(() => { (window as any).__holdDecode = true; });
    // tone-01 runs out: playNext → playTrack(1), the copy, held in its decode.
    await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 20_000 });
    expect(await heard(page), 'the element holds the starting copy').toBe(toneName(1));
    expect((await libraryState(page)).cursor, 'the cursor has not moved yet').toBe(0);
    await queue(page, [toneName(5)], 'next');
    await page.waitForTimeout(300);
    expect(await namesNow(page), 'nothing written while the copy is starting').toEqual([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    expect((await qstate(page)).pending, 'the write waits').toBe(1);
    await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
    await expect.poll(async () => (await libraryState(page)).cursor, { message: 'the copy lands at its own entry' }).toBe(1);
    await expectHeard(page, toneName(1));
    await expect.poll(() => namesNow(page)).toEqual([1, 1, 5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    expect((await qstate(page)).waitingNames).toEqual([toneName(5)]);
    await carPlays(page, toneName(5));
  });

  test('Q5e. Play next of the playing track, then Play next inside the swap onto that copy (before its commit): it goes after the copy and plays next', async ({ page }) => {
    // Re-review probe E: with no start pending, the element playing the cursor's own track counted as settled; in the
    // swap's window that is the copy starting, and the write went in before it (marked played, never heard).
    await open(page, { n: 12 });
    await playClassic(page, toneName(1));
    await queue(page, [toneName(1)], 'next');
    await expect.poll(() => namesNow(page)).toEqual([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    const x = await idOf(page, toneName(5));
    // A listener added after the app's: in the dispatch where the swap called play() (the same source: a copy), tap.
    await page.evaluate((x) => {
      const w = window as any;
      const el = w.__el;
      const at = w.__playCalls;
      const on = () => {
        if (w.__playCalls === at) return;
        el.removeEventListener('timeupdate', on);
        w.__inSwap = { cursor: w.__aetheriaLibrary.state().cursor };
        w.__tap(() => w.__aetheriaQueue.add([x], 'next'));
      };
      el.addEventListener('timeupdate', on);
    }, x);
    await expect.poll(() => page.evaluate(() => (window as any).__inSwap), { timeout: 20_000 }).toEqual({ cursor: 0 });
    await expect.poll(() => namesNow(page)).toEqual([1, 1, 5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    await expect.poll(async () => (await libraryState(page)).cursor, { message: 'the copy is current' }).toBe(1);
    expect((await qstate(page)).waitingNames, 'still waiting, never marked played').toEqual([toneName(5)]);
    await carPlays(page, toneName(5));
  });

  test('Q5c. Play next half a second before the end: the swap starts the queued track', async ({ page }) => {
    await open(page, { n: 12 });
    await playClassic(page, toneName(1));
    const x = await idOf(page, toneName(10));
    const p0 = await pauses(page);
    await page.evaluate((x) => {
      const w = window as any;
      const el = w.__el;
      const t = setInterval(() => {
        if (el.duration - el.currentTime <= 0.5) {
          clearInterval(t);
          w.__lateAt = +(el.duration - el.currentTime).toFixed(3);
          w.__tap(() => w.__aetheriaQueue.add([x], 'next'));
        }
      }, 5);
    }, x);
    await swapPlays(page, toneName(1), toneName(10));
    expect(await page.evaluate(() => (window as any).__lateAt)).toBeGreaterThan(0.35);
    expect(await pauses(page), 'gapless').toBe(p0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Q6. A write while another start is in flight waits for it.
// ---------------------------------------------------------------------------------------------------------------
test.describe('Q6. waiting for a start in flight', () => {
  test('Q6a. Previous with a held decode, then Play next: nothing changes until it lands, then it goes after the landed track', async ({ page }) => {
    await open(page, { n: 12, unscanned: [2] });
    await playClassic(page, toneName(3));
    await page.evaluate(() => { (window as any).__holdDecode = true; });
    await prevButton(page).click();
    await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
    const before = await namesNow(page);
    await queue(page, [toneName(10)], 'next');
    await page.waitForTimeout(600);
    expect(await namesNow(page), 'nothing changes while the start is in flight').toEqual(before);
    expect((await qstate(page)).pending).toBe(1);
    await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
    await expectHeard(page, toneName(2));
    await expect.poll(() => namesNow(page)).toEqual([1, 2, 10, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    expect((await qstate(page)).pending).toBe(0);
    await nextPlays(page, toneName(10));
  });

  test('Q6b. shuffle: Previous at the first position (a fresh shuffle order) with a held decode; the queue follows the landed track', async ({ page }) => {
    await open(page, { n: 12, unscanned: [2] });
    await shuffleButton(page).click();
    await playClassic(page, toneName(3));
    expect((await libraryState(page)).shufflePos).toBe(0);
    await queue(page, [toneName(10)], 'next');
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([toneName(10)]);
    await page.evaluate(() => { (window as any).__holdDecode = true; });
    await prevButton(page).click();
    await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
    await expectHeard(page, toneName(2));
    await expect.poll(async () => { const s = await libraryState(page); return s.names[s.shuffled[s.shufflePos + 1]]; }, { message: 'the queued track straight after the landed one' }).toBe(toneName(10));
    await nextPlays(page, toneName(10));
  });

  test('Q6c. a start that never lands: after 15 s the write is dropped with a toast, nothing changed', async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, { n: 12, unscanned: [2] });
    await playClassic(page, toneName(3));
    // Paused first: while the music is meant to play, the (pinned) watchdog restarts a paused element, and a 15 s held
    // decode would let it play on past the start being tested.
    await pauseNow(page);
    await page.evaluate(() => { (window as any).__holdDecode = true; });
    await prevButton(page).click();
    await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
    const before = await namesNow(page);
    await queue(page, [toneName(10)], 'next');
    await page.waitForTimeout(3000);
    expect((await qstate(page)).pending, 'still waiting after 3 s').toBe(1);
    await expect(page.getByRole('status').getByText('A track is still starting. Try again in a moment.')).toBeVisible({ timeout: 20_000 });
    expect(await namesNow(page)).toEqual(before);
    expect((await qstate(page)).pending).toBe(0);
    await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
    await expectHeard(page, toneName(2));
    expect(await namesNow(page)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Q7. Deletes (the pinned deleteSong, untouched): the marks follow, the music stops only for the playing track.
// ---------------------------------------------------------------------------------------------------------------
test.describe('Q7. deletes', () => {
  async function deleteTrack(page: Page, name: string): Promise<void> {
    const row = rowOf(page, name).first();
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    await row.getByTitle('Delete song').click();
    await confirmDelete(page);
    await expect.poll(async () => (await libraryState(page)).libraryNames.includes(name)).toBe(false);
  }

  test('Q7a. deleting the playing queued track stops it; the rest of the queue keeps its place', async ({ page }) => {
    await open(page, { n: 12 });
    await playClassic(page, toneName(1));
    await queue(page, [toneName(10)], 'queue');
    await queue(page, [toneName(11)], 'queue');
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([10, 11].map(toneName));
    await nextPlays(page, toneName(10));
    await deleteTrack(page, toneName(10));
    await expect.poll(async () => {
      const s = await libraryState(page);
      const el = await page.evaluate(() => { const e = (window as any).__el; return { paused: e.paused, src: e.getAttribute('src') }; });
      return { cursor: s.cursor, paused: el.paused, src: el.src };
    }).toEqual({ cursor: -1, paused: true, src: null });
    expect((await qstate(page)).waitingNames, 'the rest of the queue').toEqual([toneName(11)]);
    expect(await namesNow(page)).toEqual([1, 11, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12].map(toneName));
  });

  test('Q7b. deleting a waiting queued track takes it out of the queue; the cursor keeps its track; the next queued plays next', async ({ page }) => {
    await open(page, { n: 12 });
    await playClassic(page, toneName(1));
    await queue(page, [toneName(10)], 'queue');
    await queue(page, [toneName(11)], 'queue');
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([10, 11].map(toneName));
    await deleteTrack(page, toneName(10));
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([toneName(11)]);
    expect((await libraryState(page)).current).toBe(toneName(1));
    await nextPlays(page, toneName(11));
  });

  test('Q7c. shuffle: deleting an unrelated track keeps the queue next (the shuffle order made afresh gathers it)', async ({ page }) => {
    await open(page, { n: 12 });
    await shuffleButton(page).click();
    await playClassic(page, toneName(1));
    await queue(page, [toneName(10)], 'queue');
    await queue(page, [toneName(11)], 'queue');
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([10, 11].map(toneName));
    const s0 = await libraryState(page);
    const unrelated = s0.names.find((n) => ![1, 10, 11].map(toneName).includes(n))!;
    await deleteTrack(page, unrelated);
    await expect.poll(async () => { const s = await libraryState(page); return [s.names[s.shuffled[s.shufflePos]], s.names[s.shuffled[s.shufflePos + 1]], s.names[s.shuffled[s.shufflePos + 2]]]; })
      .toEqual([1, 10, 11].map(toneName));
    await nextPlays(page, toneName(10));
  });

  test('Q7d. shuffle, the cursor past the first position: deleting the track physically before it keeps the queue waiting and next; a later Add goes after it', async ({ page }) => {
    // Review probe A: deleteSong changes the order's length and leaves the shuffle order (a fresh one, the queue gathered,
    // comes a commit later). The settle read that stale order: the queue was marked played, and an Add went before it.
    test.setTimeout(150_000);
    await open(page, { n: 14 });
    await shuffleButton(page).click();
    await playClassic(page, toneName(7));
    // Next until the track physically before the cursor comes later in the shuffle order (it then sits between them).
    let s = await libraryState(page);
    for (let k = 0; k < 12; k++) {
      s = await libraryState(page);
      const c = s.cursor;
      if (s.shufflePos >= 1 && c >= 1 && s.shuffled.indexOf(c - 1) > s.shuffled.indexOf(c) + 1) break;
      await nextPlays(page, s.names[s.shuffled[s.shufflePos + 1]]);
    }
    s = await libraryState(page);
    expect(s.shuffled.indexOf(s.cursor - 1), 'the track before the cursor comes later in the shuffle order').toBeGreaterThan(s.shuffled.indexOf(s.cursor) + 1);
    expect(s.shuffled.indexOf(s.cursor), 'the cursor is past the first position').toBeGreaterThan(0);
    const current = s.current!;
    const before = s.names[s.cursor - 1];
    const pool = s.libraryNames.filter((n) => n !== current && n !== before);
    const [x, y, z] = [pool[pool.length - 1], pool[pool.length - 2], pool[pool.length - 3]];
    await queue(page, [x], 'queue');
    await queue(page, [y], 'queue');
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([x, y]);
    await pauseNow(page);
    await deleteTrack(page, before);
    await page.waitForTimeout(500);
    expect((await qstate(page)).waitingNames, 'both still waiting after the delete').toEqual([x, y]);
    await expect.poll(async () => { const t = await libraryState(page); return [1, 2].map((d) => t.names[t.shuffled[t.shufflePos + d]]); }, { message: 'and next in the play sequence' }).toEqual([x, y]);
    await queue(page, [z], 'queue');
    await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'a later Add goes after them' }).toEqual([x, y, z]);
    await nextPlays(page, x);
    await nextPlays(page, y);
    await nextPlays(page, z);
  });

  test('Q7e. shuffle switched on inside a tap’s Undo window, then Undo: the old play order comes back with its queue waiting and next, and it plays', async ({ page }) => {
    // Review, the second trigger: the Undo's snapshot had no shuffle order (shuffle was off), so the shuffle order made
    // for the tap's play order stayed on; with the same length nothing made a fresh one, and the settle marked the
    // restored queue played by that other order's sequence.
    test.setTimeout(150_000);
    await open(page, { n: 12 }, { layout: 'new' });
    await tab(page, 'library');
    const rowButton = (k: number) => page.getByTestId('library-row').filter({ hasText: toneName(k) }).locator('button[data-row-index]');
    await rowButton(1).click();
    await expectHeard(page, toneName(1));
    await queue(page, [toneName(10)], 'queue');
    await queue(page, [toneName(11)], 'queue');
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([10, 11].map(toneName));
    const before = await libraryState(page);
    await rowButton(5).click();
    await expectHeard(page, toneName(5));
    await expect.poll(() => namesNow(page), { message: 'the tap’s order: as long as the one before it' }).toEqual([1, 2, 3, 4, 5, 10, 11, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    await shuffleButton(page).click();
    await expect.poll(async () => { const s = await libraryState(page); return s.shuffle && s.shuffled.length === s.ids.length; }).toBe(true);
    await page.evaluate(() => (window as any).__aetheriaLibrary.undo());
    await expect.poll(async () => (await libraryState(page)).ids).toEqual(before.ids);
    await expectHeard(page, toneName(1));
    expect((await libraryState(page)).shuffle, 'shuffle stays on').toBe(true);
    await page.waitForTimeout(400);
    expect((await qstate(page)).waitingNames, 'the queue came back waiting').toEqual([10, 11].map(toneName));
    await expect.poll(async () => { const s = await libraryState(page); return [0, 1, 2].map((d) => s.names[s.shuffled[s.shufflePos + d]]); }, { message: 'next in the play sequence' }).toEqual([1, 10, 11].map(toneName));
    await nextPlays(page, toneName(10));
    await nextPlays(page, toneName(11));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Q8. Data safety: the queue never writes the library or the stored audio.
// ---------------------------------------------------------------------------------------------------------------
test('Q8. every queue write (×3), each Undo, the carry and the shuffle switch: the library, its audio and its records untouched', async ({ page }) => {
  test.setTimeout(240_000);
  await countBlobSaves(page);
  await countLibraryDeletes(page);
  await open(page, { n: 30 });
  await playClassic(page, toneName(1));
  await pauseNow(page);
  await page.waitForTimeout(2600); // the restore's own settle-save first
  const lib0 = (await libraryState(page)).libraryIds;
  const meta0 = await metaRecords(page);
  const stored = async () => { const c = await cacheCounts(page); return { blobs: c.blobs, meta: c.meta, library: c.library, libraryRaw: c.libraryRaw }; };
  const counts0 = await stored();
  const blob0 = await page.evaluate(() => (window as any).__blobSaveRuns);
  const undo = async () => { await page.evaluate(() => (window as any).__tap(() => (window as any).__aetheriaQueue.undo())); await page.waitForTimeout(150); };
  for (let round = 0; round < 3; round++) {
    const a = toneName(10 + round), b = toneName(20 + round), c = toneName(25 + round);
    await queue(page, [a], 'next');
    await queue(page, [b], 'queue');
    await queue(page, [c], 'queue');
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([a, b, c]);
    await edit(page, { move: { ...(await waitingEntry(page, c)), to: 0 } });
    await edit(page, { remove: await waitingEntry(page, b) });
    await undo();
    await edit(page, { clear: true });
    await undo();
    await queue(page, [toneName(5)], 'next');
    await undo();
    await expect.poll(async () => (await qstate(page)).waitingNames.length).toBe(3);
    await shuffleButton(page).click();
    await page.waitForTimeout(200);
    await shuffleButton(page).click();
    await page.waitForTimeout(200);
    await edit(page, { clear: true });
    await expect.poll(async () => (await qstate(page)).waitingNames.length).toBe(0);
  }
  // The carry: a mix with two tracks queued (startPlayOrder), and its Undo.
  await queue(page, [toneName(12)], 'queue');
  await queue(page, [toneName(13)], 'queue');
  const mix = aside(page).getByRole('button', { name: /^(Grounding 174·285·396·417)/ }).first();
  await mix.scrollIntoViewIfNeeded();
  await mix.click();
  await expect.poll(async () => (await libraryState(page)).names.slice(0, 3)).toEqual([1, 12, 13].map(toneName));
  await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([12, 13].map(toneName));
  await page.waitForTimeout(2600); // the last metadata save
  expect((await libraryState(page)).libraryIds, 'the library: the same ids, in order').toEqual(lib0);
  expect(await stored(), 'the stored counts').toEqual(counts0);
  expect(await page.evaluate(() => (window as any).__idbDeletes), 'no stored track or record deleted').toBe(0);
  expect(await page.evaluate(() => (window as any).__blobSaveRuns), 'no audio saved').toBe(blob0);
  expect(await metaRecords(page), 'every metadata record as it was').toEqual(meta0);
});

// ---------------------------------------------------------------------------------------------------------------
// Q9. Persistence: the queue (and a walk holding a queued entry) survives a reload; not a broken record.
// ---------------------------------------------------------------------------------------------------------------
test.describe('Q9. persistence', () => {
  test('Q9a. three queued, paused, saved: after a reload the marks are back and Next plays them in order', async ({ page }) => {
    await open(page, { n: 12 });
    await playClassic(page, toneName(1));
    for (const k of [10, 11, 12]) await queue(page, [toneName(k)], 'queue');
    await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
    await expect.poll(async () => (await savedState(page))?.queue ?? null, { timeout: 10_000 }).toEqual({ waiting: [1, 2, 3], played: [] });
    await page.reload();
    await acceptDisclaimer(page);
    await expect.poll(async () => (await qstate(page)).waitingNames, { timeout: 20_000 }).toEqual([10, 11, 12].map(toneName));
    expect((await libraryState(page)).current).toBe(toneName(1));
    for (const k of [10, 11, 12, 2]) {
      await nextPlays(page, toneName(k));
    }
  });

  test('Q9b. a saved walk with a queued entry is back with its steps (the −1 rule) and its queue', async ({ page }) => {
    // Saved by an earlier session: Ascent over tones 1-5 with tone-09 queued after the first.
    const walk = { mode: 'A', segments: null, phases: null, steps: [0, -1, 1, 2, 3, 4] };
    await open(page, { n: 9, state: { order: [1, 9, 2, 3, 4, 5], cursor: 0, walk, queue: { waiting: [1], played: [] } } }, { layout: 'new' });
    await expect.poll(async () => { const s = await libraryState(page); return [s.walk, s.steps]; }, { timeout: 20_000 }).toEqual(['A', [0, -1, 1, 2, 3, 4]]);
    expect((await qstate(page)).waitingNames).toEqual([toneName(9)]);
    expect((await libraryState(page)).current).toBe(toneName(1));
  });

  test('Q9c. a record with one track’s audio gone restores no queue and no walk', async ({ page }) => {
    const walk = { mode: 'A', segments: null, phases: null, steps: [0, -1, 1, 2, 3, 4] };
    await open(page, { n: 9, noBlob: [3], state: { order: [1, 9, 2, 3, 4, 5], cursor: 0, walk, queue: { waiting: [1], played: [] } } }, { layout: 'new' });
    await expect.poll(async () => (await libraryState(page)).names, { timeout: 20_000 }).toEqual([1, 9, 2, 4, 5].map(toneName));
    const s = await libraryState(page);
    expect([s.walk, s.steps]).toEqual([null, null]);
    expect((await qstate(page)).marks).toBe(null);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Q10. Undo.
// ---------------------------------------------------------------------------------------------------------------
test('Q10. Undo: Play next’s removes it; once it has started, nothing, and says so; Clear’s re-queues in order; Remove’s puts it back', async ({ page }) => {
  test.setTimeout(150_000);
  await open(page, { n: 12 });
  await playClassic(page, toneName(1));
  await pauseNow(page);
  const undoButton = () => page.getByRole('status').getByRole('button', { name: 'Undo', exact: true });
  // Play next, Undo.
  await queue(page, [toneName(10)], 'next');
  await expect(page.getByRole('status')).toContainText('Playing next: tone-10.');
  await undoButton().click();
  await expect.poll(() => namesNow(page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
  expect((await qstate(page)).marks).toBe(null);
  // Play next, it starts, Undo: it stays, and the toast says so.
  await queue(page, [toneName(10)], 'next');
  await nextPlays(page, toneName(10));
  await undoButton().click();
  await expect(page.getByRole('status')).toContainText('tone-10 has already started, so it stays in the play order.');
  expect((await libraryState(page)).names[1]).toBe(toneName(10));
  await pauseNow(page);
  // Three queued, Clear, Undo: back in their order.
  for (const k of [5, 6, 7]) await queue(page, [toneName(k)], 'queue');
  await expect(page.getByRole('status')).toContainText('Added to your queue: tone-07 is 3rd.');
  await edit(page, { clear: true });
  await expect(page.getByRole('status')).toContainText('Cleared 3 queued tracks.');
  expect((await qstate(page)).waitingNames).toEqual([]);
  await undoButton().click();
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([5, 6, 7].map(toneName));
  // Remove the middle one, Undo: back at its place.
  await edit(page, { remove: await waitingEntry(page, toneName(6)) });
  await expect(page.getByRole('status')).toContainText('Removed tone-06 from your queue.');
  expect((await qstate(page)).waitingNames).toEqual([5, 7].map(toneName));
  await undoButton().click();
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([5, 6, 7].map(toneName));
  // An Undo after the queue changed refuses.
  await edit(page, { remove: await waitingEntry(page, toneName(5)) });
  await edit(page, { move: { ...(await waitingEntry(page, toneName(7))), to: 0 } });
  await undoButton().click();
  await expect(page.getByRole('status')).toContainText("The queue changed since, so that can't be undone.");
  expect((await qstate(page)).waitingNames).toEqual([7, 6].map(toneName));
});

// ---------------------------------------------------------------------------------------------------------------
// Q11. The shuffle switch.
// ---------------------------------------------------------------------------------------------------------------
test('Q11a. queue 2, shuffle on: they are next in the new shuffle order and play next', async ({ page }) => {
  await open(page, { n: 12 });
  await playClassic(page, toneName(1));
  await pauseNow(page);
  await queue(page, [toneName(10)], 'queue');
  await queue(page, [toneName(11)], 'queue');
  await shuffleButton(page).click();
  await expect.poll(async () => { const s = await libraryState(page); return s.shuffle && s.shuffled.length === s.ids.length ? [s.names[s.shuffled[s.shufflePos]], s.names[s.shuffled[s.shufflePos + 1]], s.names[s.shuffled[s.shufflePos + 2]]] : null; })
    .toEqual([1, 10, 11].map(toneName));
  await nextPlays(page, toneName(10));
  await nextPlays(page, toneName(11));
});

test('Q11b. Previous under shuffle leaves the queue after the track it left; the switch off brings it physically next, and it plays', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, { n: 12 });
  await shuffleButton(page).click();
  await playClassic(page, toneName(1)); // a pick: this track first, shuffle position 0
  await pauseNow(page);
  expect((await libraryState(page)).shufflePos).toBe(0);
  await nextButton(page).click();
  await expect.poll(async () => (await libraryState(page)).shufflePos).toBe(1);
  const yName = (await libraryState(page)).current!;
  await expectHeard(page, yName);
  await pauseNow(page);
  await queue(page, [toneName(8)], 'queue');
  await queue(page, [toneName(9)], 'queue');
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([8, 9].map(toneName));
  await prevButton(page).click();
  await expectHeard(page, toneName(1));
  await pauseNow(page);
  // The queue sits physically after the track stepped back from: the switch off gathers it after the cursor.
  const s1 = await libraryState(page);
  expect(s1.names.slice(s1.cursor, s1.cursor + 3), 'not in place before the switch').not.toEqual([1, 8, 9].map(toneName));
  await shuffleButton(page).click();
  await expect.poll(async () => { const s = await libraryState(page); return s.shuffle ? null : s.names.slice(s.cursor, s.cursor + 3); }).toEqual([1, 8, 9].map(toneName));
  expect(yName).not.toBe(toneName(1));
  await nextPlays(page, toneName(8));
  await nextPlays(page, toneName(9));
});

// ---------------------------------------------------------------------------------------------------------------
// Q13. Writes in a row: each starts from the one before it (found by S9b: a second write in the same task, or a second
// write waiting for a start, computed from the play state before the first and undid it).
// ---------------------------------------------------------------------------------------------------------------
test('Q13. three writes in one task, and two waiting for the same start, all apply, in order', async ({ page }) => {
  await open(page, { n: 12, unscanned: [2] });
  await playClassic(page, toneName(3));
  await pauseNow(page);
  const ids = await Promise.all([5, 6, 7].map((k) => idOf(page, toneName(k))));
  await page.evaluate((ids) => (window as any).__tap(() => { for (const id of ids) (window as any).__aetheriaQueue.add([id], 'queue'); }), ids);
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([5, 6, 7].map(toneName));
  await edit(page, { clear: true });
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([]);
  // Two writes while a Previous is still starting: both wait, then both apply after the landed track, in order.
  await page.evaluate(() => { (window as any).__holdDecode = true; });
  await prevButton(page).click();
  await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
  await queue(page, [toneName(10)], 'queue');
  await queue(page, [toneName(11)], 'queue');
  expect((await qstate(page)).pending).toBe(2);
  await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
  await expectHeard(page, toneName(2));
  await expect.poll(() => namesNow(page)).toEqual([1, 2, 10, 11, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
  await nextPlays(page, toneName(10));
  await nextPlays(page, toneName(11));
});

test('Q15. a start whose play() was refused, then Play resumes the element: Play next applies at once (that start is over), and plays next', async ({ page }) => {
  // Re-review probe G: a refused play() never records its play, so the start stayed pending; Play then resumed the
  // element directly, and every write on the cursor's own track waited, then was dropped after 15 s.
  test.setTimeout(120_000);
  await open(page, { n: 12 }, { layout: 'new' });
  await tab(page, 'library');
  const rowButton = (k: number) => page.getByTestId('library-row').filter({ hasText: toneName(k) }).locator('button[data-row-index]');
  await rowButton(1).click();
  await expectHeard(page, toneName(1));
  await page.evaluate(() => (window as any).__ms.pause());
  await expect.poll(() => page.evaluate(() => (window as any).__el?.paused)).toBe(true);
  await rowButton(5).click();
  await expectHeard(page, toneName(5));
  await page.evaluate(() => (window as any).__aetheriaLibrary.undo()); // it was paused: the earlier order, unloaded
  await expect.poll(async () => { const s = await libraryState(page); return s.current === toneName(1) && !s.src; }).toBe(true);
  await page.evaluate(() => { const w = window as any; w.__failNextPlay = true; w.__ms.play(); }); // playTrack: play() refused
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as any).__el?.paused), 'the refused start left it paused').toBe(true);
  await page.evaluate(() => (window as any).__ms.play()); // the element has its source: resumed directly
  await expectHeard(page, toneName(1), 0.7);
  await queue(page, [toneName(9)], 'next');
  await expect.poll(async () => (await qstate(page)).waitingNames, { message: 'applied at once', timeout: 3000 }).toEqual([toneName(9)]);
  expect((await qstate(page)).pending).toBe(0);
  await nextPlays(page, toneName(9));
});

test('Q16. shuffle switched off while a classic-list pick is still starting: the gather waits for it, the pick lands named, then the queue is next', async ({ page }) => {
  // Re-review 5: the switch-off gather moved the waiting entries to after the (old) cursor while the pick's playTrack
  // held its captured index; landing, it named another track.
  test.setTimeout(150_000);
  await open(page, { n: 12, unscanned: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  await shuffleButton(page).click();
  await playClassic(page, toneName(1));
  // Next until the track after the cursor in the shuffle order sits physically after it (P before Y).
  let s = await libraryState(page);
  for (let k = 0; k < 10 && !(s.shuffled[s.shufflePos + 1] > s.cursor); k++) {
    await nextPlays(page, s.names[s.shuffled[s.shufflePos + 1]]);
    s = await libraryState(page);
  }
  const p = s.cursor, y = s.shuffled[s.shufflePos + 1];
  expect(y, 'the next track sits physically after the current one').toBeGreaterThan(p);
  const pName = s.names[p], yName = s.names[y];
  await nextPlays(page, yName);
  await pauseNow(page);
  const tIndex = p + 1;
  const tName = s.names[tIndex];
  const others = s.libraryNames.filter((n) => ![pName, yName, tName].includes(n));
  const [q1, q2] = [others[others.length - 1], others[others.length - 2]];
  await queue(page, [q1], 'queue');
  await queue(page, [q2], 'queue');
  await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([q1, q2]);
  await prevButton(page).click();
  await expectHeard(page, pName);
  await pauseNow(page);
  // The waiting entries sit after Y, the pick T between P and them: a gather now would shift T's index.
  await page.evaluate(() => { (window as any).__holdDecode = true; });
  const row = aside(page).getByText(tName, { exact: true }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
  const before = await namesNow(page);
  await shuffleButton(page).click();
  await expect.poll(async () => (await libraryState(page)).shuffle).toBe(false);
  await page.waitForTimeout(400);
  expect(await namesNow(page), 'no gather while the pick is starting').toEqual(before);
  await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
  await expectHeard(page, tName);
  await expect.poll(async () => { const t = await libraryState(page); return t.names.slice(t.cursor, t.cursor + 3); }, { message: 'then gathered after the landed pick' }).toEqual([tName, q1, q2]);
  await nextPlays(page, q1);
});

test('Q14. a Library tap still starting (its decode held): Play next goes in at once after the tapped track (the start’s entry is recorded), which lands named; the queued track plays next', async ({ page }) => {
  // The anchor's recorded entry (review 2): a start issued outside the pinned advance code records where it lands, so a
  // write during its decode needs no wait; one the pinned code issued, with the same track as the cursor's, waits (Q5d).
  test.setTimeout(120_000);
  await open(page, { n: 12, unscanned: [5] }, { layout: 'new' });
  await tab(page, 'library');
  const rowButton = (k: number) => page.getByTestId('library-row').filter({ hasText: toneName(k) }).locator('button[data-row-index]');
  await rowButton(1).click();
  await expectHeard(page, toneName(1));
  await page.evaluate(() => { (window as any).__holdDecode = true; });
  await rowButton(5).click();
  await page.waitForFunction(() => typeof (window as any).__releaseDecode === 'function', null, { timeout: 10_000 });
  expect(await heard(page), 'the element holds the tapped track').toBe(toneName(5));
  expect((await libraryState(page)).cursor, 'its start has not landed').toBe(0);
  await queue(page, [toneName(10)], 'next');
  await expect.poll(() => namesNow(page), { message: 'in at once, after the tapped track' }).toEqual([1, 2, 3, 4, 5, 10, 6, 7, 8, 9, 10, 11, 12].map(toneName));
  expect((await qstate(page)).pending, 'no wait').toBe(0);
  await page.evaluate(() => { const w = window as any; w.__holdDecode = false; w.__releaseDecode(); });
  await expectHeard(page, toneName(5));
  expect((await libraryState(page)).cursor).toBe(4);
  await nextPlays(page, toneName(10));
});

// ---------------------------------------------------------------------------------------------------------------
// Q12. A new play order carries the queue (decision 2 A).
// ---------------------------------------------------------------------------------------------------------------
test.describe('Q12. the carry', () => {
  test('Q12a. queue 2, tap a Library row: it plays, then the 2, then the library from it; the toast says so; Undo: the old order with its 2', async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, { n: 12 }, { layout: 'new' });
    await tab(page, 'library');
    await page.getByTestId('library-row').filter({ hasText: toneName(1) }).locator('button[data-row-index]').click();
    await expectHeard(page, toneName(1));
    await queue(page, [toneName(10)], 'queue');
    await queue(page, [toneName(11)], 'queue');
    const before = await libraryState(page);
    const row = page.getByTestId('library-row').filter({ hasText: toneName(5) }).locator('button[data-row-index]');
    await row.click();
    await expectHeard(page, toneName(5));
    await expect.poll(() => namesNow(page)).toEqual([1, 2, 3, 4, 5, 10, 11, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    expect((await libraryState(page)).cursor).toBe(4);
    expect((await qstate(page)).waitingNames).toEqual([10, 11].map(toneName));
    await expect(undoToast(page)).toContainText('Your 2 queued tracks play next.');
    await undoToast(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await libraryState(page)).ids).toEqual(before.ids);
    await expectHeard(page, toneName(1));
    expect((await qstate(page)).waitingNames).toEqual([10, 11].map(toneName));
    await nextPlays(page, toneName(10));
  });

  test('Q12b. a mix carries the queue too; a tap on the playing row with a queue resumes, never restarts', async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, { n: 12 }, { layout: 'new' });
    await tab(page, 'library');
    const rowButton = (k: number) => page.getByTestId('library-row').filter({ hasText: toneName(k) }).locator('button[data-row-index]');
    await rowButton(1).click();
    await expectHeard(page, toneName(1), 1);
    await queue(page, [toneName(10)], 'next');
    await expect.poll(() => namesNow(page)).toEqual([1, 10, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    // "Is this the library": the play order's own entries are; the queued one doesn't make it "a play order".
    await expect(page.getByTestId('library-summary')).toContainText('Playing from your library');
    // The playing row: resumes (no restart), the queue stays.
    const t0 = await page.evaluate(() => (window as any).__el.currentTime);
    await rowButton(1).click();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__el.currentTime), 'not restarted').toBeGreaterThan(t0);
    expect(await namesNow(page)).toEqual([1, 10, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(toneName));
    // A mix (the Mixes tab's Grounding: 174, 285, 396, 417 → tone-01, tone-02, tone-03, tone-04).
    await tab(page, 'mixes');
    await page.getByTestId('mix-preset:qi').click();
    await expect.poll(() => namesNow(page), { timeout: 15_000 }).toEqual([1, 10, 2, 3, 4].map(toneName));
    await expectHeard(page, toneName(1));
    await nextPlays(page, toneName(10));
  });

  test('Q12c. a tap on the Library row of a queued track plays it, and it is not carried as well (it plays once); the rest of the queue is', async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, { n: 12 }, { layout: 'new' });
    await tab(page, 'library');
    const rowButton = (k: number) => page.getByTestId('library-row').filter({ hasText: toneName(k) }).locator('button[data-row-index]');
    await rowButton(1).click();
    await expectHeard(page, toneName(1));
    await queue(page, [toneName(9)], 'queue');
    await queue(page, [toneName(11)], 'queue');
    await expect.poll(async () => (await qstate(page)).waitingNames).toEqual([9, 11].map(toneName));
    await rowButton(9).click();
    await expectHeard(page, toneName(9));
    await expect.poll(() => namesNow(page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 10, 11, 12].map(toneName));
    expect((await namesNow(page)).filter((n) => n === toneName(9)), 'tone-09 once in the play order').toHaveLength(1);
    expect((await qstate(page)).waitingNames).toEqual([toneName(11)]);
    await expect(undoToast(page)).toContainText('Your queued track plays next.');
    await nextPlays(page, toneName(11));
    await nextPlays(page, toneName(10));
  });
});
