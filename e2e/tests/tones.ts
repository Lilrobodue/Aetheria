import { type Page } from '@playwright/test';
import { libraryState } from './helpers';

// v15.9: what the mixes specs share (mixes-play.spec.ts, mixes-tab.spec.ts). Synthetic tones only (tone-01 …), each
// with its OWN length (20 s + its index), so the track the music element really plays is known from the element's
// duration, not from the cursor or the title.

export const CRY = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
export const toneName = (i: number) => `tone-${String(i + 1).padStart(2, '0')}`;
export const VIZ_KEY = 'aetheria.vizSettings.v1';
export const EXPERIENCE_KEY = 'aetheria.experienceLevel.v1';

export interface ToneSeed {
  n: number;
  crystal?: (i: number) => number | null;
  scanned?: (i: number) => boolean;
  /** Golden ratio alignment of a scanned track (default 0.2: under Golden Φ's 30 %). */
  golden?: (i: number) => number;
  /** A crystal but no measured frequency (harmonicFreq): playTrack decodes it before it plays. */
  unscanned?: (i: number) => boolean;
  /** The saved play state: order (library indices), cursor, walk. */
  state?: { order: number[]; cursor: number; walk?: unknown };
  /** Tracks whose audio is gone (no blob). */
  noBlob?: number[];
}

/** Write a library straight into IndexedDB (playlistCache's schema), as an earlier session would have saved it. */
export async function seedTones(page: Page, s: ToneSeed): Promise<string[]> {
  await page.goto('/manifest.json');
  const crystals = Array.from({ length: s.n }, (_, i) => (s.crystal ? s.crystal(i) : CRY[i % 27]));
  const scanned = Array.from({ length: s.n }, (_, i) => (s.scanned ? s.scanned(i) : false));
  const golden = Array.from({ length: s.n }, (_, i) => (s.golden ? s.golden(i) : 0.2));
  const unscanned = Array.from({ length: s.n }, (_, i) => (s.unscanned ? s.unscanned(i) : false));
  return page.evaluate(async ({ n, crystals, scanned, golden, unscanned, state, noBlob }) => {
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
      const id = `${t0 + i * 1000}-${Math.random().toString(36).slice(2, 11)}`;
      ids.push(id);
      const name = `tone-${String(i + 1).padStart(2, '0')}`;
      if (!noBlob.includes(i)) tx.objectStore('blobs').put({ id, fileBlob: wav(20 + i, 220 + i * 11), fileName: `${name}.wav`, fileType: 'audio/wav' });
      const meta: any = { id, name, duration: 20 + i };
      const hz = crystals[i];
      if (hz) Object.assign(meta, { harmonicFreq: hz + 2.5, closestSolfeggio: hz, harmonicDeviation: 2.5 });
      if (hz && unscanned[i]) delete meta.harmonicFreq;
      if (hz && scanned[i]) meta.fractalAnalysis = { dominantFrequency: hz, harmonicSeries: [hz], fractalDimension: 1.4, goldenRatioAlignment: golden[i], pattern111Presence: 0.1 + i / 100, dnaResonanceScore: 0.2, safetyLevel: 'SAFE', recommendedVolume: 0.8, infiniteOrderHarmonics: [], sacredGeometryAlignment: 0.2, schumannResonanceHarmony: 0.1 };
      tx.objectStore('meta').put(meta);
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    const order = state ? state.order.map((i: number) => ids[i]) : ids;
    const st = db.transaction('playlist-state', 'readwrite');
    st.objectStore('playlist-state').put({ key: 'current', playlistOrder: order, originalOrder: ids, currentSongIndex: state ? state.cursor : -1, loShuWalkMode: (state?.walk as any)?.mode ?? null, ...(state?.walk ? { walk: state.walk } : {}), selectedSolfeggio: 396, savedAt: Date.now() });
    await new Promise((resolve) => (st.oncomplete = resolve));
    db.close();
    return ids;
  }, { n: s.n, crystals, scanned, golden, unscanned, state: s.state ?? null, noBlob: s.noBlob ?? [] });
}

/** From the next load on: the Visualizer's props (a DevTools-shaped hook), every media element that plays (the music
 *  element is not in the DOM), and every frequency the layers' oscillators are set to. */
export async function mediaHooks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), isDisabled: false,
      inject(r: unknown) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
      onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, setStrictMode() {},
      onCommitFiberRoot(_id: number, root: unknown) { w.__root = root; },
    };
    w.__media = new Set();
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { w.__media.add(this); return play.call(this); };
    w.__osc = [];
    const tagged = new WeakSet();
    const create = BaseAudioContext.prototype.createOscillator;
    BaseAudioContext.prototype.createOscillator = function (this: BaseAudioContext) { const o = create.call(this); tagged.add(o.frequency); return o; };
    for (const m of ['setValueAtTime', 'setTargetAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime'] as const) {
      const f = AudioParam.prototype[m] as any;
      (AudioParam.prototype as any)[m] = function (this: AudioParam, v: number, ...rest: unknown[]) { if (tagged.has(this)) w.__osc.push([performance.now(), Math.round(v * 100) / 100]); return f.call(this, v, ...rest); };
    }
    const desc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value')!;
    Object.defineProperty(AudioParam.prototype, 'value', { get() { return desc.get!.call(this); }, set(v: number) { if (tagged.has(this)) w.__osc.push([performance.now(), Math.round(v * 100) / 100]); desc.set!.call(this, v); } });
    w.__vizProps = () => {
      const stack = [w.__root?.current];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        const p = f.memoizedProps;
        if (p && typeof p === 'object' && 'loShuWalkStep' in p && 'analyser' in p) return { step: p.loShuWalkStep, mode: p.loShuWalkMode, hz: p.selectedFrequency, settings: p.settings };
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      return null;
    };
  });
}
export const vizProps = (page: Page) => page.evaluate(() => (window as any).__vizProps());
export const oscSince = (page: Page, since: number) =>
  page.evaluate((since) => [...new Set(((window as any).__osc as [number, number][]).filter(([t, v]) => t >= since && v > 20).map(([, v]) => v))].sort((a, b) => a - b), since);
export const perfNow = (page: Page) => page.evaluate(() => performance.now());
export const savedViz = (page: Page) => page.evaluate((k) => localStorage.getItem(k), VIZ_KEY);

/** What the music element really plays: its track (by its own length), its time, its src, and the lock-screen card. */
export async function heard(page: Page): Promise<{ name: string | null; t: number; src: string | null; card: string | null }> {
  const s = await libraryState(page);
  return page.evaluate(({ src }) => {
    const el = [...((window as any).__media ?? []), ...((window as any).__e2eMedia ?? []), ...document.querySelectorAll('audio')].find((a: HTMLMediaElement) => a.getAttribute('src') === src) as HTMLAudioElement | undefined;
    const d = el && Number.isFinite(el.duration) ? Math.round(el.duration) : null;
    return {
      name: d === null ? null : `tone-${String(d - 20 + 1).padStart(2, '0')}`,
      t: el ? el.currentTime : -1,
      src,
      card: (navigator as any).mediaSession?.metadata?.title ?? null,
    };
  }, { src: s.src });
}
