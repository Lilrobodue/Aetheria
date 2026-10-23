import { expect, type Locator, type Page } from '@playwright/test';
import { ON_DEVICE } from './fixtures';

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
 *
 * The layer engine (v15.0): v2 is the release default, so a new profile plays
 * v2 and asks for its output on the first play. The suites written for classic
 * keep testing it: `engine` (default 'classic') is saved before the app's first
 * load, as a tap on Classic would, unless the profile already holds a choice;
 * later taps and seedLayers change it as usual. 'default' leaves the profile
 * unset, as a new user's.
 */
export async function openApp(
  page: Page,
  opts: { acceptDialogs?: boolean; query?: string; engine?: 'classic' | 'v2' | 'default' } = {}
): Promise<string[]> {
  const dialogs: string[] = [];
  page.on('dialog', async (d) => {
    if (opts.acceptDialogs) {
      await d.accept();
    } else {
      dialogs.push(`${d.type()}: ${d.message()}`);
      await d.dismiss();
    }
  });
  const engine = opts.engine === 'default' ? null : (opts.engine ?? 'classic');
  await page.addInitScript(
    ({ engine, key }) => {
      // Once per tab (its first load), so a test that later clears the choice keeps it cleared.
      try {
        if (engine && sessionStorage.getItem('__e2eEngineSeeded') === null) {
          sessionStorage.setItem('__e2eEngineSeeded', '1');
          if (localStorage.getItem(key) === null) localStorage.setItem(key, engine);
        }
      } catch {
        // No storage here (e.g. about:blank): nothing to seed.
      }
    },
    { engine, key: LAYER_ENGINE_KEY }
  );
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

/**
 * The launch disclaimer: accept it if it shows. From v14.6 it shows only until
 * the current wording is accepted, so "not there" is a normal answer — wait
 * for the app itself (rendered under the disclaimer) before deciding.
 */
export async function acceptDisclaimer(page: Page): Promise<void> {
  await page.getByTitle('Safety Protocols', { exact: true }).waitFor();
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
  await addFiles(page, files);
}

type TestFile = { name: string; mimeType: string; buffer: Buffer };

/**
 * Put files on the "Add files" input, as picking them would. A phone's Chrome
 * can't read this computer's disk (Playwright's setInputFiles hands it local
 * paths), so on a device the files are built in the page and handed to the
 * input with the change event a pick fires.
 */
export async function addFiles(page: Page, files: TestFile[]): Promise<void> {
  if (!ON_DEVICE) {
    await page.getByLabel('Add files').setInputFiles(files);
    return;
  }
  await page.evaluate(
    ({ files }) => {
      const input = document.querySelector('input[aria-label="Add files"]') as HTMLInputElement;
      const picked = new DataTransfer();
      for (const f of files) {
        const binary = atob(f.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        picked.items.add(new File([bytes], f.name, { type: f.mimeType }));
      }
      input.files = picked.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { files: files.map((f) => ({ name: f.name, mimeType: f.mimeType, base64: f.buffer.toString('base64') })) }
  );
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

/**
 * Watch the app's Web Audio graph and media elements (call before openApp; it
 * survives reloads). The app exposes nothing for tests, so this wraps the
 * standard APIs: every connect(), the tone's gain ramp (the app's only
 * linearRampToValueAtTime), the last setTargetAtTime and first .value write
 * per AudioParam, stopped sources, oscillators and channel mergers created,
 * and which element plays music (a blob: src) and which the silent anchor
 * (data:). In-page and in-memory only.
 */
export async function instrumentAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const A: any = ((window as any).__audio = {
      edges: [], last: new Map(), firstSet: new Map(), rampParams: [], ramps: [], envMax: 0,
      toneOscs: [], stopped: new WeakSet(), oscCount: 0, mergerCount: 0,
      music: null, anchor: null, musicPauses: 0,
    });
    const P = AudioParam.prototype as any;
    const ramp = P.linearRampToValueAtTime;
    P.linearRampToValueAtTime = function (v: number, t: number) {
      A.rampParams.push(this);
      A.ramps.push(v);
      return ramp.call(this, v, t);
    };
    const toward = P.setTargetAtTime;
    P.setTargetAtTime = function (v: number, t: number, tau: number) {
      A.last.set(this, { target: v, tau });
      if (A.rampParams.includes(this)) A.envMax = Math.max(A.envMax, v);
      return toward.call(this, v, t, tau);
    };
    const value = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value')!;
    Object.defineProperty(AudioParam.prototype, 'value', {
      ...value,
      set(v: number) {
        if (!A.firstSet.has(this)) A.firstSet.set(this, v);
        value.set!.call(this, v);
      },
    });
    const connect = AudioNode.prototype.connect as any;
    (AudioNode.prototype as any).connect = function (dest: any, ...rest: unknown[]) {
      A.edges.push([this, dest]);
      if (this instanceof OscillatorNode && dest instanceof GainNode && A.rampParams.includes(dest.gain)) A.toneOscs.push(this);
      return connect.call(this, dest, ...rest);
    };
    const stop = AudioScheduledSourceNode.prototype.stop;
    AudioScheduledSourceNode.prototype.stop = function (this: AudioScheduledSourceNode, when?: number) {
      A.stopped.add(this);
      return stop.call(this, when);
    };
    const B = BaseAudioContext.prototype as any;
    const osc = B.createOscillator;
    const merger = B.createChannelMerger;
    B.createOscillator = function () {
      if (this instanceof AudioContext) A.oscCount++;
      return osc.call(this);
    };
    B.createChannelMerger = function (...args: unknown[]) {
      if (this instanceof AudioContext) A.mergerCount++;
      return merger.apply(this, args);
    };
    const play = HTMLMediaElement.prototype.play;
    A.musicEnded = 0;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.getAttribute('src') || '';
      if (src.startsWith('blob:')) {
        // The first time the music element is seen, count its natural ends (v15.1): a gapless swap never lets
        // the track reach `ended`.
        if (!A.musicEndedHooked) {
          A.musicEndedHooked = true;
          this.addEventListener('ended', () => { A.musicEnded++; });
        }
        A.music = this;
      } else if (src.startsWith('data:')) A.anchor = this;
      return play.call(this);
    };
    const pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      if (this === A.music) A.musicPauses++;
      return pause.call(this);
    };
  });
}

export interface LayerState {
  ctxRunning: boolean;
  /** The layer bus (tone + binaural): its value now, first write, last target. */
  bus: number | null;
  busFirst: number | null;
  busLast: { target: number; tau: number } | null;
  /** The sub-bass drone's gain. */
  drone: number | null;
  droneLast: { target: number; tau: number } | null;
  /** Every tone-gain ramp target so far, and the highest envelope target on one. */
  toneTargets: number[];
  envMax: number;
  /** The newest tone oscillator exists and hasn't been stopped. */
  toneSounding: boolean;
  oscCount: number;
  mergerCount: number;
  music: { paused: boolean; ended: boolean; time: number; volume: number; src: string | null; currentSrc: string } | null;
  musicPauses: number;
  anchorPaused: boolean | null;
}

/** Read what instrumentAudio recorded. The master bus is the one node feeding
 *  the recording destination; the layer bus and the drone feed the master bus,
 *  in that order. */
export async function layerState(page: Page): Promise<LayerState> {
  return page.evaluate(() => {
    const A = (window as any).__audio;
    const master = A.edges.find(([, d]: any[]) => d instanceof MediaStreamAudioDestinationNode)?.[0];
    const [bus, drone] = A.edges
      .filter(([s, d]: any[]) => d === master && s instanceof GainNode)
      .map(([s]: any[]) => s as GainNode);
    const tone = A.toneOscs[A.toneOscs.length - 1];
    const m: HTMLMediaElement | null = A.music;
    return {
      ctxRunning: bus ? bus.context.state === 'running' : false,
      bus: bus ? bus.gain.value : null,
      busFirst: bus ? (A.firstSet.get(bus.gain) ?? null) : null,
      busLast: bus ? (A.last.get(bus.gain) ?? null) : null,
      drone: drone ? drone.gain.value : null,
      droneLast: drone ? (A.last.get(drone.gain) ?? null) : null,
      toneTargets: A.ramps.slice(),
      envMax: A.envMax,
      toneSounding: !!tone && !A.stopped.has(tone),
      oscCount: A.oscCount,
      mergerCount: A.mergerCount,
      music: m
        ? { paused: m.paused, ended: m.ended, time: m.currentTime, volume: m.volume, src: m.getAttribute('src'), currentSrc: m.currentSrc }
        : null,
      musicPauses: A.musicPauses,
      anchorPaused: A.anchor ? A.anchor.paused : null,
    };
  });
}

/** Pick a frequency in the "Advanced Frequency Selection" modal (it closes itself). */
export async function pickFrequency(page: Page, hz = 528): Promise<void> {
  await page.getByTitle('Advanced Frequency Selection').click();
  await page.getByRole('button', { name: `${hz}Hz`, exact: true }).click();
}

/** Open Harmonic Control (the header's gear). */
export async function openHarmonicControl(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Harmonic Control', exact: true }).click();
  await page.getByRole('heading', { name: 'Harmonic Control', exact: true }).waitFor();
}

/** Tap a frequency in Harmonic Control's "Traditional Scale (Safe)" grid. */
export async function tapTraditional(page: Page, hz: number): Promise<void> {
  await page
    .getByText('Traditional Scale (Safe)', { exact: true })
    .locator('xpath=..')
    .getByRole('button', { name: String(hz), exact: true })
    .click();
}

/** Harmonic Control's "Layer Intensity" readout, e.g. "1%". */
export const layerIntensity = (page: Page) =>
  page.getByText('Layer Intensity', { exact: true }).locator('xpath=following-sibling::span[1]');

/** Open the Safety Protocols panel unless it is already open (the app opens it
 *  by itself for an unanalysed track). */
export async function openSafety(page: Page): Promise<void> {
  if (await page.getByRole('button', { name: 'Emergency Stop' }).isVisible().catch(() => false)) return;
  await page.getByTitle('Safety Protocols', { exact: true }).click();
  await page.getByRole('button', { name: 'Emergency Stop' }).waitFor();
}

/** Count console messages starting with `prefix` from now on. */
export function countConsole(page: Page, prefix: string): () => number {
  let n = 0;
  page.on('console', (m) => {
    if (m.text().startsWith(prefix)) n++;
  });
  return () => n;
}

/** A song row in the list (it holds the row's Delete button). */
export const rowOf = (page: Page, name: string) =>
  page.locator('div.group').filter({ has: page.getByText(name, { exact: true }) });

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
  /** Analyse tracks (v15.1): metadata records analysed for key data (chromaVersion 1, a chroma or none found). */
  keyed: number;
  /** Records with Analyse tracks' visual envelope, and with Deep Scan's band envelope. */
  envVisual: number;
  envScan: number;
  /** Records Analyse tracks marked as unreadable (analysisFailedV 1). */
  failedMarks: number;
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
      keyed: metas.filter((m) => m.chromaVersion === 1).length,
      envVisual: metas.filter((m) => (m.visualEnvelope?.bass?.length ?? 0) > 0).length,
      envScan: metas.filter((m) => (m.bandEnvelope?.bass?.length ?? 0) > 0).length,
      failedMarks: metas.filter((m) => m.analysisFailedV === 1).length,
    };
    db.close();
    return out;
  });
}

/** Wait until the persisted cache matches (debounced saves take a few seconds). */
export async function expectCache(page: Page, expected: Partial<CacheCounts>, timeout = 15_000): Promise<void> {
  await expect.poll(() => cacheCounts(page), { timeout, intervals: [500, 1000] }).toMatchObject(expected);
}

// Layers v2 (v14.9; the default since v15.0): the "Layer sound: v2 / classic"
// A/B. The keys are the app's own (utils/soundV2/layerHost.ts, soundLog.ts); a
// new profile has none of them until the user taps a choice (openApp saves
// 'classic' for the classic suites unless told otherwise).
export const LAYER_ENGINE_KEY = 'aetheria.layerEngine.v1';
export const LAYER_OUTPUT_KEY = 'aetheria.layerOutput.v1';
// '1' while an "Ask me again" waits for its answer (the saved output stays beside it, in effect).
export const LAYER_OUTPUT_ASK_AGAIN_KEY = 'aetheria.layerOutputAskAgain.v1';
export const DRONE_KEY = 'aetheria.droneEnabled.v1';
export const SOUND_LOG_KEY = 'aetheria.soundSessions.v1';
// The tone level, one per engine (v15.0), saved only when that engine's slider is moved.
export const TONE_LEVEL_V2_KEY = 'aetheria.toneLevelV2.v1';
export const TONE_LEVEL_CLASSIC_KEY = 'aetheria.toneLevelClassic.v1';
// Key fit (v15.2): 'true' / 'false', written only when the switch is tapped; unset = the release default (off).
export const KEY_FIT_KEY = 'aetheria.keyFit.v1';

/** Move a range slider as a drag does: the new value, then an input event (React's onChange). The native value
 *  setter is used because React's own setter on the element would swallow the change. */
export async function setSlider(slider: Locator, value: number): Promise<void> {
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** Store A/B choices the way a tap would, then reload into the app (openApp first). */
export async function seedLayers(
  page: Page,
  s: { engine?: 'classic' | 'v2'; output?: 'headphones' | 'speakers' | 'phone' | 'car'; drone?: boolean; keyFit?: boolean }
): Promise<void> {
  await page.evaluate(
    ({ s, keys }) => {
      if (s.engine) localStorage.setItem(keys.engine, s.engine);
      if (s.output) localStorage.setItem(keys.output, s.output);
      if (s.drone !== undefined) localStorage.setItem(keys.drone, String(s.drone));
      if (s.keyFit !== undefined) localStorage.setItem(keys.keyFit, String(s.keyFit));
    },
    { s, keys: { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY, drone: DRONE_KEY, keyFit: KEY_FIT_KEY } }
  );
  await page.reload();
  await acceptDisclaimer(page);
}

/**
 * The app's v2 dev hook, window.__aetheriaLayers (App.tsx; dev builds only, so
 * the test server has it and production does not). Its effect runs just after
 * the first render, hence the short wait; a page without it fails here rather
 * than letting a test pass on "no player".
 */
async function layersHook(page: Page): Promise<void> {
  await page
    .waitForFunction(() => !!(window as any).__aetheriaLayers, null, { timeout: 5_000 })
    .catch(() => {
      throw new Error('window.__aetheriaLayers is missing: the layer tests need the dev server (it is stripped from builds)');
    });
}

/** The v2 player's state() through the dev hook, or null before it exists. */
export async function layersState(page: Page): Promise<any | null> {
  await layersHook(page);
  return page.evaluate(() => (window as any).__aetheriaLayers.state());
}

/** Whether App holds a v2 player now (never in a classic session; gone 3 s after leaving v2). */
export async function layersCreated(page: Page): Promise<boolean> {
  await layersHook(page);
  return page.evaluate(() => (window as any).__aetheriaLayers.created() as boolean);
}

/** The hook's `mobile`: App's IS_MOBILE_DEVICE (the mobile-ua project and a phone). */
export async function isMobileBuild(page: Page): Promise<boolean> {
  await layersHook(page);
  return page.evaluate(() => (window as any).__aetheriaLayers.mobile as boolean);
}

/** RMS of what the app's analyser sees on the master bus now (×2 visualizer gain; needs instrumentAudio). */
export async function busRms(page: Page): Promise<number> {
  return page.evaluate(() => {
    const A = (window as any).__audio;
    const analyser = A.edges.map(([, d]: any[]) => d).find((d: any) => d instanceof AnalyserNode) as AnalyserNode | undefined;
    if (!analyser) return 0;
    const x = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(x);
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    return Math.sqrt(sum / x.length);
  });
}

/** An init script (after instrumentAudio) that wraps AudioScheduledSourceNode.prototype.stop once more and stamps each
 *  call with performance.now() (instrumentAudio's own wrapper stays untouched); stopsSince counts calls after t. */
export async function recordStops(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stamps: number[] = ((window as any).__stopTimes = []);
    const stop = AudioScheduledSourceNode.prototype.stop;
    AudioScheduledSourceNode.prototype.stop = function (this: AudioScheduledSourceNode, when?: number) {
      stamps.push(performance.now());
      return stop.call(this, when);
    };
  });
}

/** stop() calls on any source after `t` (the page's performance.now()). */
export async function stopsSince(page: Page, t: number): Promise<number> {
  return page.evaluate((t) => {
    const stamps: number[] | undefined = (window as any).__stopTimes;
    if (!stamps) throw new Error('stopsSince needs recordStops before openApp');
    return stamps.filter((s) => s > t).length;
  }, t);
}

/**
 * Write a synthetic bandEnvelope (fps 20, every frame `level` in all four
 * bands, `seconds` long) into the meta record of the library's first track,
 * as a Deep Scan would. Done from /manifest.json as shrinkSavedLibrary does,
 * so the app can't save over it; reload into the app afterwards. The
 * Uint8Arrays survive structured clone (utils/playlistCache.ts).
 */
export async function writeBandEnvelope(page: Page, level: number, seconds: number): Promise<void> {
  await page.goto('/manifest.json');
  await page.evaluate(
    async ({ level, seconds }) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const r = indexedDB.open('aetheria-db');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const get = (store: IDBObjectStore, key: string): Promise<any> =>
        new Promise((resolve, reject) => {
          const r = store.get(key);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      const tx = db.transaction(['playlist-state', 'meta'], 'readwrite');
      const state = await get(tx.objectStore('playlist-state'), 'current');
      const id: string | undefined = state?.originalOrder?.[0];
      const meta = id ? await get(tx.objectStore('meta'), id) : undefined;
      if (!meta) throw new Error('writeBandEnvelope: no saved first track (import one and wait for the cache)');
      const frames = Math.ceil(seconds * 20);
      const band = () => new Uint8Array(frames).fill(level);
      meta.bandEnvelope = { fps: 20, sub: band(), bass: band(), mid: band(), high: band() };
      tx.objectStore('meta').put(meta);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { level, seconds }
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Analyse tracks (v15.1)
// ---------------------------------------------------------------------------------------------------------------

/** One stored metadata record, as Analyse tracks' tests read it. */
export interface MetaRecord {
  id: string;
  name: string;
  duration: number | null;
  harmonicFreq: number | null;
  closestSolfeggio: number | null;
  harmonicDeviation: number | null;
  chromaVersion: number | null;
  chromaIsArray: boolean;
  chroma: number[] | null;
  musicKey: string | null;
  chromaA4Hz: number | null;
  keyConfidence: number | null;
  envScan: number;
  envVisual: number;
  analysisFailedV: number | null;
}

/** Every stored metadata record ('aetheria-db' → meta), in the library's saved order where it has one. */
export async function metaRecords(page: Page): Promise<MetaRecord[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const read = (store: string, op: (s: IDBObjectStore) => IDBRequest): Promise<any> =>
      db.objectStoreNames.contains(store)
        ? new Promise((resolve, reject) => {
            const r = op(db.transaction(store, 'readonly').objectStore(store));
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          })
        : Promise.resolve(undefined);
    const metas: any[] = (await read('meta', (s) => s.getAll())) ?? [];
    const state: any = await read('playlist-state', (s) => s.get('current'));
    db.close();
    const order: string[] = state?.originalOrder ?? [];
    const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    metas.sort((a, b) => rank(a.id) - rank(b.id) || String(a.name).localeCompare(String(b.name)));
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    return metas.map((m) => ({
      id: m.id,
      name: m.name,
      duration: num(m.duration),
      harmonicFreq: num(m.harmonicFreq),
      closestSolfeggio: num(m.closestSolfeggio),
      harmonicDeviation: num(m.harmonicDeviation),
      chromaVersion: num(m.chromaVersion),
      chromaIsArray: Array.isArray(m.chroma),
      chroma: m.chroma ? Array.from(m.chroma as ArrayLike<number>) : null,
      musicKey: typeof m.musicKey === 'string' ? m.musicKey : null,
      chromaA4Hz: num(m.chromaA4Hz),
      keyConfidence: num(m.keyConfidence),
      envScan: m.bandEnvelope?.bass?.length ?? 0,
      envVisual: m.visualEnvelope?.bass?.length ?? 0,
      analysisFailedV: num(m.analysisFailedV),
    }));
  });
}

/** The saved playlist state (the 'playlist-state' store's 'current' record), or null. */
export async function savedState(page: Page): Promise<any | null> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!db.objectStoreNames.contains('playlist-state')) { db.close(); return null; }
    const state = await new Promise((resolve, reject) => {
      const r = db.transaction('playlist-state', 'readonly').objectStore('playlist-state').get('current');
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return state;
  });
}

/** From the next page load on, count blob-save RUNS in window.__blobSaveRuns: each one reads the stored keys
 *  of the 'blobs' store once (playlistCache.ts writeNewBlobs). Recover and Discard read them too. */
export async function countBlobSaves(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__blobSaveRuns = 0;
    const getAllKeys = IDBObjectStore.prototype.getAllKeys;
    IDBObjectStore.prototype.getAllKeys = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'blobs') w.__blobSaveRuns++;
      return (getAllKeys as any).apply(this, args);
    } as typeof getAllKeys;
  });
}

/** From the next page load on, document.hidden and visibilityState follow window.__hidden (false at load);
 *  window.__setHidden(b) changes it and fires visibilitychange, as a screen lock would. */
export async function controllableVisibility(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__hidden = false;
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => !!w.__hidden });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (w.__hidden ? 'hidden' : 'visible') });
    w.__setHidden = (b: boolean) => {
      w.__hidden = !!b;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
}

/** From the next page load on, log every setInterval(fn, 3000) — the app's only such intervals are the two
 *  adaptive-band effects' — as { t, e: 'arm' | 'clear', id } in window.__intervals3s (page clock). */
export async function recordIntervals3s(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { t: number; e: string; id: number }[] = ((window as any).__intervals3s = []);
    const live = new Set<number>();
    const set = window.setInterval, clear = window.clearInterval;
    (window as any).setInterval = (handler: unknown, ms?: number, ...args: unknown[]) => {
      const id: number = set.call(window, handler as TimerHandler, ms, ...args);
      if (ms === 3000 && typeof handler === 'function') {
        live.add(id);
        log.push({ t: performance.now(), e: 'arm', id });
      }
      return id;
    };
    (window as any).clearInterval = (id?: number) => {
      if (id !== undefined && live.delete(id)) log.push({ t: performance.now(), e: 'clear', id });
      clear.call(window, id);
    };
  });
}

/** From the next page load on, record every MediaSession metadata set as { t, title } in window.__metaSets. */
export async function recordMediaMetadata(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sets: { t: number; title: string | null }[] = ((window as any).__metaSets = []);
    const proto = (window as any).MediaSession?.prototype;
    const d = proto && Object.getOwnPropertyDescriptor(proto, 'metadata');
    if (!d || !d.set) return;
    Object.defineProperty(proto, 'metadata', {
      ...d,
      set(v: MediaMetadata | null) {
        sets.push({ t: performance.now(), title: v ? v.title : null });
        d.set!.call(this, v);
      },
    });
  });
}

/** From the next page load on, record each LIVE-context decode (AudioContext, not OfflineAudioContext) as
 *  { start, end } in window.__liveDecodes; while window.__slowLiveDecode is true one resolves 3 s late. */
export async function recordLiveDecodes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__liveDecodes = [];
    w.__slowLiveDecode = false;
    const decode = BaseAudioContext.prototype.decodeAudioData;
    Object.defineProperty(AudioContext.prototype, 'decodeAudioData', {
      configurable: true,
      writable: true,
      value: function (this: AudioContext, data: ArrayBuffer, ...rest: unknown[]) {
        const rec = { start: performance.now(), end: -1 };
        w.__liveDecodes.push(rec);
        const slow = !!w.__slowLiveDecode;
        return (decode as any).call(this, data, ...rest).then(async (buf: AudioBuffer) => {
          if (slow) await new Promise((r) => setTimeout(r, 3000));
          rec.end = performance.now();
          return buf;
        }, (err: unknown) => {
          rec.end = performance.now();
          throw err;
        });
      },
    });
  });
}

/** From the next page load on, count OfflineAudioContext decodes at 22050 Hz (the key analysis's decodes, Analyse
 *  tracks' and Deep Scan's) in window.__keyDecodes. */
export async function countKeyDecodes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__keyDecodes = 0;
    const decode = BaseAudioContext.prototype.decodeAudioData;
    Object.defineProperty(OfflineAudioContext.prototype, 'decodeAudioData', {
      configurable: true,
      writable: true,
      value: function (this: OfflineAudioContext, ...args: unknown[]) {
        if (this.sampleRate === 22050) w.__keyDecodes++;
        return (decode as any).apply(this, args);
      },
    });
  });
}

/** From the next page load on, record how the key analysis (utils/soundV2/keyAnalysis.ts and chroma.ts) yields, in
 *  window.__keyYields: each setTimeout and each MessagePort postMessage called from inside it (found by the call
 *  stack), with the first timers' stacks for a failure message. A hidden, silent desktop page throttles chained
 *  timers to one wake-up a second, then one a minute; a message is never throttled. */
export async function recordKeyYields(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const rec = ((window as any).__keyYields = { timers: 0, messages: 0, timerStacks: [] as string[] });
    const insideKeyAnalysis = (): string | null => {
      const E = Error as unknown as { stackTraceLimit: number };
      const limit = E.stackTraceLimit;
      E.stackTraceLimit = 40;
      const stack = new Error().stack ?? '';
      E.stackTraceLimit = limit;
      return /\/utils\/soundV2\/(keyAnalysis|chroma)\.ts/.test(stack) ? stack : null;
    };
    const setTimer = window.setTimeout;
    (window as any).setTimeout = function (...args: unknown[]) {
      const stack = insideKeyAnalysis();
      if (stack) {
        rec.timers++;
        if (rec.timerStacks.length < 3) rec.timerStacks.push(stack);
      }
      return (setTimer as any).apply(window, args);
    };
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (this: MessagePort, ...args: unknown[]) {
      if (insideKeyAnalysis()) rec.messages++;
      return (post as any).apply(this, args);
    };
  });
}

/** Analyse tracks' dev hook, window.__aetheriaAnalyse (App.tsx; dev builds only, like __aetheriaLayers). */
export async function analyseHook(page: Page): Promise<void> {
  await page
    .waitForFunction(() => !!(window as any).__aetheriaAnalyse, null, { timeout: 5_000 })
    .catch(() => {
      throw new Error('window.__aetheriaAnalyse is missing: the analyse tests need the dev server (it is stripped from builds)');
    });
}

export interface AnalyseState { phase: 'idle' | 'running' | 'holding' | 'parked' | 'stopping'; hold: string | null; done: number; total: number; failed: number; tooLong: number; etaMin: number | null }
export interface AnalyseSummary { outcome: 'finished' | 'stopped' | 'error'; reason?: string; analysed: number; envelopes: number; keys: number; failed: number; tooLong: number; crashSkipped: number; ms: number }
export interface AnalyseStep { kind: 'probe' | 'read' | 'decode' | 'envelope' | 'slice' | 'flush'; at: number; ms: number; left: number | null; into: number | null; leftEnd: number | null; id?: string; band?: number; ids?: string[]; slowed?: boolean }
export interface AnalysePlan { total: number; seconds: number; playingFirst: boolean; retry: boolean; crashSkipped: number }

const hookCall = async <T>(page: Page, fn: string, arg?: unknown): Promise<T> => {
  await analyseHook(page);
  return page.evaluate(({ fn, arg }) => (window as any).__aetheriaAnalyse[fn](arg), { fn, arg }) as Promise<T>;
};
export const analyseState = (page: Page) => hookCall<AnalyseState>(page, 'state');
export const analyseLast = (page: Page) => hookCall<AnalyseSummary | null>(page, 'last');
export const analyseRuns = (page: Page) => hookCall<number>(page, 'runs');
export const analyseLog = (page: Page) => hookCall<AnalyseStep[]>(page, 'log');
export const analysePlan = (page: Page) => hookCall<AnalysePlan | null>(page, 'plan');
export const analysePhases = (page: Page) => hookCall<{ t: number; phase: string; hold: string | null }[]>(page, 'phases');
export const analysePlaying = (page: Page) =>
  hookCall<{ id: string; name: string; envelope: number; source: 'scan' | 'analyse' | null; key: string | null } | null>(page, 'playing');
/** Pace the next run (read at its start): flushMs, duty, nativeLeftS, sliceMs. */
export async function analyseTune(page: Page, o: { flushMs?: number; duty?: number | null; nativeLeftS?: number | null; sliceMs?: number | null }): Promise<void> {
  await analyseHook(page);
  await page.evaluate((o) => (window as any).__aetheriaAnalyse.tune(o), o);
}
/** The hook's `mobile`: App's ANALYSE_MOBILE (the mobile-ua project and a phone). */
export async function analyseMobile(page: Page): Promise<boolean> {
  await analyseHook(page);
  return page.evaluate(() => (window as any).__aetheriaAnalyse.mobile as boolean);
}
/** Wait until `runs()` ≥ n (a run's end: then read analyseLast). */
export async function waitRuns(page: Page, n: number, timeout = 120_000): Promise<void> {
  await analyseHook(page);
  await page.waitForFunction((n) => (window as any).__aetheriaAnalyse.runs() >= n, n, { timeout, polling: 250 });
}

/** The Visualizer's dev hook, window.__aetheriaVisualizer (components/Visualizer.tsx; dev builds only): the frame
 *  count of the envelope its RAF loop samples now, or 0 without one (the visuals then use their fallback motion). */
export async function visualizerEnvelope(page: Page): Promise<number> {
  await page
    .waitForFunction(() => !!(window as any).__aetheriaVisualizer, null, { timeout: 5_000 })
    .catch(() => {
      throw new Error('window.__aetheriaVisualizer is missing: this test needs the dev server (it is stripped from builds)');
    });
  return page.evaluate(() => (window as any).__aetheriaVisualizer.envelope() as number);
}

/**
 * Import files from a URL base (e.g. the read-only parity server) through the "Add files" input: fetched in the
 * page, made into Files and handed over as a pick would (a phone can't read this computer's disk).
 */
export async function importUrls(page: Page, base: string, names: string[]): Promise<void> {
  await page.evaluate(
    async ({ base, names }) => {
      const input = document.querySelector('input[aria-label="Add files"]') as HTMLInputElement;
      const picked = new DataTransfer();
      for (const name of names) {
        const r = await fetch(`${base.replace(/\/$/, '')}/${encodeURIComponent(name)}`);
        if (!r.ok) throw new Error(`importUrls: ${r.status} for file #${names.indexOf(name)}`);
        const blob = await r.blob();
        const type = blob.type || (name.endsWith('.mp3') ? 'audio/mpeg' : name.endsWith('.wav') ? 'audio/wav' : '');
        picked.items.add(new File([blob], name, { type }));
      }
      input.files = picked.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { base, names }
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Key fit (v15.2)
// ---------------------------------------------------------------------------------------------------------------

/** The key fields Analyse tracks stores for a track (types.ts), seeded by seedTracks. */
export interface SeedKey {
  chroma: number[];
  chromaA4Hz: number;
  keyConfidence: number;
  musicKey: string;
}

/**
 * Patch the stored metadata of the library's tracks at these `originalOrder` indexes, from /manifest.json as
 * writeBandEnvelope does (so the app can't save over it): `crystal` sets harmonicFreq = closestSolfeggio (playTrack
 * then uses it without decoding, and the gapless swap can run); `key` writes the four key fields with chromaVersion 1;
 * `key: null` deletes the five; `key: 'empty'` deletes the four and keeps chromaVersion 1 alone (what Analyse tracks
 * stores for a track with no pitch or too short: analysed, never retried). Throws when a record is missing. Reload into
 * the app afterwards (page.goto('/'), acceptDisclaimer).
 */
export async function seedTracks(
  page: Page,
  entries: Array<{ index: number; crystal?: number; key?: SeedKey | null | 'empty' }>
): Promise<void> {
  await page.goto('/manifest.json');
  await page.evaluate(async (entries) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aetheria-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const get = (store: IDBObjectStore, key: string): Promise<any> =>
      new Promise((resolve, reject) => {
        const r = store.get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const tx = db.transaction(['playlist-state', 'meta'], 'readwrite');
    const state = await get(tx.objectStore('playlist-state'), 'current');
    for (const e of entries) {
      const id: string | undefined = state?.originalOrder?.[e.index];
      const meta = id ? await get(tx.objectStore('meta'), id) : undefined;
      if (!meta) throw new Error(`seedTracks: no saved track at index ${e.index} (import first and wait for the cache)`);
      if (e.crystal !== undefined) {
        meta.harmonicFreq = e.crystal;
        meta.closestSolfeggio = e.crystal;
      }
      if (e.key === 'empty') {
        for (const k of ['chroma', 'chromaA4Hz', 'keyConfidence', 'musicKey']) delete meta[k];
        meta.chromaVersion = 1;
      } else if (e.key) {
        meta.chroma = [...e.key.chroma];
        meta.chromaA4Hz = e.key.chromaA4Hz;
        meta.keyConfidence = e.key.keyConfidence;
        meta.musicKey = e.key.musicKey;
        meta.chromaVersion = 1;
      } else if (e.key === null) {
        for (const k of ['chroma', 'chromaA4Hz', 'keyConfidence', 'musicKey', 'chromaVersion']) delete meta[k];
      }
      tx.objectStore('meta').put(meta);
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, entries);
}

/** The duck's state() (keyFit.ts KeyFitDuckState) through the dev hook, or null before the first v2 player. */
export async function keyFitState(page: Page): Promise<any | null> {
  await layersHook(page);
  return page.evaluate(() => (window as any).__aetheriaLayers.keyFit());
}
export const keyFitSwitch = (page: Page) => page.getByRole('switch', { name: 'Key fit' });
export const keyFitChip = (page: Page) => page.getByTestId('key-fit-chip');
export const keyFitStatus = (page: Page) => page.getByTestId('key-fit-status');

/**
 * The layers' RMS on the master bus over the v2 host level, read in one evaluate (critique m6): the host follows the
 * music's φ envelope, so a ratio of two readings is the duck's alone. The mean of `reads` reads `gapMs` apart.
 * Needs instrumentAudio and a v2 player.
 */
export async function meanLayerRms(page: Page, reads = 6, gapMs = 50): Promise<number> {
  let sum = 0;
  for (let i = 0; i < reads; i++) {
    if (i) await page.waitForTimeout(gapMs);
    sum += await page.evaluate(() => {
      const A = (window as any).__audio;
      const analyser = A.edges.map(([, d]: any[]) => d).find((d: any) => d instanceof AnalyserNode) as AnalyserNode | undefined;
      const host = (window as any).__aetheriaLayers?.state()?.host_level;
      if (!analyser || !(host > 0)) return NaN;
      const x = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(x);
      let s = 0;
      for (let k = 0; k < x.length; k++) s += x[k] * x[k];
      return Math.sqrt(s / x.length) / host;
    });
  }
  return sum / reads;
}
