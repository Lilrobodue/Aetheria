import { expect, type Locator, type Page } from '@playwright/test';
import { ON_DEVICE, test, watchNativeDialogs } from './fixtures';
import { TEST_ORIGIN } from './adb';

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
 * Returns the messages of every alert/confirm/prompt the page raises (the
 * fixture's native-dialog guard records and dismisses them, and fails the test
 * at its end on any): tests assert it stays empty, because a blocking dialog
 * freezes playback on a locked phone. Since v15.4 the app raises none; the row
 * Delete asks in an in-app dialog (confirmDelete).
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
  opts: { query?: string; engine?: 'classic' | 'v2' | 'default' } = {}
): Promise<string[]> {
  const dialogs = watchNativeDialogs(page);
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
 * v16.1: only the library's own saves (meta, and the 'current' state record); a saved playlist's write ('pl:<id>') fails
 * only while window.__failPlaylistSaves is true (it starts false).
 */
export async function controlStateSaves(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__failStateSaves = false;
    w.__failPlaylistSaves = false;
    w.__cacheEvents = [];
    for (const type of ['aetheria:cache-error', 'aetheria:cache-ok']) {
      window.addEventListener(type, (e) =>
        w.__cacheEvents.push({ type: type.slice('aetheria:'.length), ...(e as CustomEvent).detail })
      );
    }
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
      const request = (put as any).apply(this, args);
      const key = (args[0] as any)?.key;
      const isPlaylist = this.name === 'playlist-state' && typeof key === 'string' && key.startsWith('pl:');
      if (w.__failStateSaves && (this.name === 'meta' || (this.name === 'playlist-state' && key === 'current'))) this.transaction.abort();
      else if (w.__failPlaylistSaves && isPlaylist) this.transaction.abort();
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
// Key fit (v15.2): 'true' / 'false', written only when the switch is tapped; unset = the release default (on since
// v15.2.1, off in v15.2). A test about something else that needs it one way says so (seedLayers' keyFit).
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

// ---------------------------------------------------------------------------------------------------------------
// UI kit and isolation (v15.4)
// ---------------------------------------------------------------------------------------------------------------

/** The row Delete's confirmation (an in-app alertdialog since v15.4): press its Delete. */
export async function confirmDelete(page: Page): Promise<void> {
  await page
    .getByRole('alertdialog', { name: 'Delete this track?' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
}

/** The regions the crash drills can break (components/ErrorBoundary.tsx ViewName), and 'root' (a sibling of App). */
export type CrashView =
  | 'visualizer' | 'header' | 'library' | 'harmonic' | 'guidebook' | 'frequency-lab'
  | 'safety' | 'record' | 'tutorial' | 'links' | 'notices' | 'transport' | 'root'
  // v15.5, the new layout (beta).
  | 'shell' | 'now-playing' | 'mini-player' | 'desktop-transport' | 'tab-library' | 'tab-mixes' | 'tab-layers'
  | 'more' | 'sheet-sound' | 'sheet-crystal' | 'sheet-walks' | 'menu'
  // v15.6, the Layers tab's five sections.
  | 'layers-sound' | 'layers-crystal' | 'layers-levels' | 'layers-beat' | 'layers-advanced'
  // v15.7, the Library tab.
  | 'library-list' | 'library-health' | 'library-menu' | 'sheet-import'
  // v15.9, the Mixes tab.
  | 'mixes-walks' | 'mixes-lists' | 'mixes-experimental'
  // v16.0, the queue (the Up next sheet's body).
  | 'queue'
  // v16.1, saved playlists.
  | 'playlists' | 'playlist-detail' | 'playlist-menu' | 'playlist-add'
  // v16.2, smart filters: the filter sheet's body, the bar above the list, the actions' ⋯ sheet.
  | 'library-filters' | 'library-filter-bar' | 'library-filter-actions'
  // v16.3, Create a mix: its sections, its footer, and the ⋯ sheets (a mix's, the footer's).
  | 'mix-builder' | 'mix-builder-footer' | 'mix-menu'
  // v16.3 review: the whole builder, the Start from and Filters sheets' bodies, and a drill inside the builder's model
  // work (not a region: it throws from the summary's memo, under mix-builder-view).
  | 'mix-builder-view' | 'mix-builder-source' | 'mix-builder-filters' | 'mix-builder-model';

/**
 * Make a region throw on its next render, through the app's dev hook window.__aetheriaCrash (ErrorBoundary.tsx; dev
 * builds only, so the test server has it and production does not). A page without it fails here rather than letting
 * a drill pass on "nothing happened".
 */
export async function crash(page: Page, view: CrashView): Promise<void> {
  await page
    .waitForFunction(() => typeof (window as any).__aetheriaCrash === 'function', null, { timeout: 5_000 })
    .catch(() => {
      throw new Error('window.__aetheriaCrash is missing: the crash drills need the dev server (it is stripped from builds)');
    });
  await page.evaluate((v) => (window as any).__aetheriaCrash(v), view);
}

/** On a device, when each page's last tapAt was sent (see tapAt). */
const lastDeviceTap = new WeakMap<Page, number>();
/** Past Android's double-tap window (300 ms), with room for the trip to the phone. */
const DEVICE_TAP_GAP_MS = 400;

/**
 * A finger tap at page coordinates: Playwright's touchscreen locally (the context needs hasTouch); on a device, real
 * CDP touch events, because the phone's own context has no hasTouch.
 *
 * On a device (v15.6): CDP touches go through Chrome's touch emulator, whose gesture detector takes the platform's
 * double-tap setting (on, on Android: 300 ms, 100 dp) and has it on for the page until the page's frame metadata next
 * changes. So each tap's click waits out the window (it lands after this returns), and a second tap inside it, near the
 * first, is a double tap: neither gives a click. A real finger on the app is not affected (its mobile viewport turns
 * double tap off for the phone's own gestures). Taps are spaced past the window; `spaced: false` sends at once (only to
 * show the effect).
 */
export async function tapAt(page: Page, x: number, y: number, o: { spaced?: boolean } = {}): Promise<void> {
  if (!ON_DEVICE) {
    await page.touchscreen.tap(x, y);
    return;
  }
  if (o.spaced !== false) {
    const since = Date.now() - (lastDeviceTap.get(page) ?? 0);
    if (since < DEVICE_TAP_GAP_MS) await page.waitForTimeout(DEVICE_TAP_GAP_MS - since);
  }
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    lastDeviceTap.set(page, Date.now());
    await cdp.detach().catch(() => {});
  }
}

/** The Zen-hidden UI layer: the header's parent (App's UI wrapper). Not by role: while hidden it is inert, so it is
 *  out of the accessibility tree. */
export const zenLayer = (page: Page) => page.locator('header').locator('xpath=..');

/** Turn Zen Mode on and wait until the UI has faded out (3 s after the last mouse move). */
export async function hideZen(page: Page): Promise<void> {
  const toggle = page.getByTitle('Zen Mode (Hide UI)', { exact: true });
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await expect(zenLayer(page), 'Zen Mode hides the UI').toHaveClass(/opacity-0/, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------------------------------------------
// The new layout (v15.5, opt-in beta)
// ---------------------------------------------------------------------------------------------------------------

/** The saved layout choice ('new' / 'classic'; unset = classic). The app writes it only from a tap or ?layout=. */
export const LAYOUT_KEY = 'aetheria.layout.v1';
/** A phone, as the probes and the mockups measured it. */
export const PHONE_VIEWPORT = { width: 411, height: 752 };

/** The new layout's root (the phone or the desktop shell). */
export const newShell = (page: Page) => page.getByTestId('new-shell');

export async function layoutPref(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), LAYOUT_KEY);
}

/**
 * Into the new layout from classic (openApp first: the library's import lives in classic), as a user does: Harmonic
 * Control › Try the new layout. The music keeps playing through it.
 */
export async function optInNewLayout(page: Page): Promise<void> {
  await openHarmonicControl(page);
  await page.getByTestId('try-new-layout').click();
  await newShell(page).waitFor();
}

/**
 * Open the app straight into the new layout (a returning beta user): `via: 'seed'` stores the choice before the first
 * load, 'query' loads /?layout=new (which saves it). Seeds the engine as openApp does, skips the tutorial, counts
 * pause() calls, and accepts the disclaimer (shared by both layouts). Returns the native-dialog list.
 */
export async function openNewLayout(
  page: Page,
  opts: { via?: 'seed' | 'query'; engine?: 'classic' | 'v2' | 'default'; output?: 'headphones' | 'speakers' | 'phone' | 'car' } = {}
): Promise<string[]> {
  const dialogs = watchNativeDialogs(page);
  const engine = opts.engine === 'default' ? null : (opts.engine ?? 'classic');
  await page.addInitScript(
    ({ engine, output, keys, seedLayout }) => {
      try {
        if (sessionStorage.getItem('__e2eNewSeeded') === null) {
          sessionStorage.setItem('__e2eNewSeeded', '1');
          if (engine && localStorage.getItem(keys.engine) === null) localStorage.setItem(keys.engine, engine);
          if (output && localStorage.getItem(keys.output) === null) localStorage.setItem(keys.output, output);
          if (seedLayout) localStorage.setItem(keys.layout, 'new');
        }
      } catch {}
      localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      const w = window as any;
      w.__pauseCount = 0;
      const original = HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
        w.__pauseCount++;
        return original.call(this);
      };
    },
    { engine, output: opts.output ?? null, keys: { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY, layout: LAYOUT_KEY }, seedLayout: opts.via !== 'query' }
  );
  await page.goto(opts.via === 'query' ? '/?layout=new' : '/');
  await acceptDisclaimerNew(page);
  return dialogs;
}

/** The disclaimer over the new layout: accept it if it shows (wait for the shell first). */
export async function acceptDisclaimerNew(page: Page): Promise<void> {
  await newShell(page).waitFor();
  const accept = page.getByRole('button', { name: /I understand, let me begin/ });
  if (await accept.isVisible().catch(() => false)) await accept.click();
}

/** A tab of the phone shell (or a section of the desktop nav). */
export async function tab(page: Page, name: 'now' | 'library' | 'mixes' | 'layers' | 'more'): Promise<void> {
  const button = page.getByTestId(`tab-${name}-button`).or(page.getByTestId(`nav-${name}`));
  await button.click();
}

/** The open sheet (modal on the phone, the panel on the desktop) by its title. */
export const sheet = (page: Page, title: string) =>
  page.getByRole('dialog', { name: title, exact: true }).or(page.getByRole('region', { name: title, exact: true }));

/** The target's box once it has held still across two animation frames (it is re-measured until two agree). */
async function stableBox(page: Page, target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const same = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
  let prev = await target.boundingBox();
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const now = await target.boundingBox();
    if (prev && now && same(prev, now)) return now;
    prev = now;
  }
  throw new Error('tapCount: the target never held still for two frames');
}

/**
 * Counts the taps an action takes (spec §3.11: Crystal 2, Output 2, Walk 2). `tap` is a finger tap at the element's
 * centre (tapAt: Playwright's touchscreen here, real CDP touches on a device); `click` a pointer click.
 */
export function tapCount(page: Page) {
  let n = 0;
  return {
    get count() {
      return n;
    },
    reset() {
      n = 0;
    },
    /**
     * A finger tap at the target's centre, measured once its box has held still for two animation frames (a sheet
     * that just opened, a list that just scrolled). Records, as a test annotation, which element the page says lies
     * under that point. The tap's effect may land later than this returns: on a phone the click comes from Chrome's
     * gesture detector after the touch, so read its outcome with a retrying assertion (expect.poll, toHaveText …).
     */
    async tap(target: Locator, label = `tap ${n + 1}`): Promise<void> {
      await target.scrollIntoViewIfNeeded();
      const box = await stableBox(page, target);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!el) return 'nothing';
        const named = el.closest('button, a, [role="slider"], [role="switch"]') as HTMLElement | null;
        const who = named ?? el;
        return `${who.tagName.toLowerCase()} "${(who.getAttribute('aria-label') || who.textContent || '').trim().slice(0, 40)}"`;
      }, { x, y });
      test.info().annotations.push({ type: `tap at (${Math.round(x)}, ${Math.round(y)}): ${label}`, description: `elementFromPoint → ${hit}` });
      await tapAt(page, x, y);
      n++;
    },
    async click(target: Locator): Promise<void> {
      await target.click();
      n++;
    },
  };
}

/**
 * Record the perf HUD's one-second lines in window.__hud (call before the first load; it switches the HUD on). The
 * HUD's `draws N/s` is what the Visualizer actually rendered (after its 30 fps gate).
 */
export async function recordHudDraws(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('aetheria.perfhud.v1', '1');
    const w = window as any;
    w.__hud = [] as { at: number; draws: number }[];
    const attach = () => {
      const hud = document.querySelector('[data-testid="perf-hud"]');
      if (!hud) return false;
      new MutationObserver(() => {
        const m = /draws ([\d.]+)\/s/.exec(hud.textContent ?? '');
        if (m) w.__hud.push({ at: performance.now(), draws: Number(m[1]) });
      }).observe(hud, { childList: true, characterData: true, subtree: true });
      return true;
    };
    const watch = new MutationObserver(() => {
      if (attach()) watch.disconnect();
    });
    watch.observe(document, { childList: true, subtree: true });
  });
}

/** The HUD's draws per second in the `n` one-second windows that END after now (waits for them). */
export async function drawsPerSecond(page: Page, n = 2): Promise<number[]> {
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction(({ t0, n }) => ((window as any).__hud ?? []).filter((h: any) => h.at > t0).length >= n, { t0, n }, { timeout: 15_000, polling: 200 });
  return page.evaluate(({ t0, n }) => ((window as any).__hud as any[]).filter((h) => h.at > t0).slice(0, n).map((h) => h.draws), { t0, n });
}

/** The new layout's render counts (dev builds: window.__aetheriaRenders), and a reset. */
export async function renders(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({ ...((window as any).__aetheriaRenders ?? {}) }));
}
export async function resetRenders(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__aetheriaRenders = {};
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The Layers tab and Zen in the new layout (v15.6)
// ---------------------------------------------------------------------------------------------------------------

export type LayersSectionName = 'sound' | 'crystal' | 'levels' | 'beat' | 'advanced';

/** A card of the Layers tab (its region's content; `layers-<name>-fallback` while it has crashed). */
export const layersSection = (page: Page, name: LayersSectionName) => page.getByTestId(`layers-${name}`);

/** The eye button that turns the new layout's Zen on and off (Now Playing's top bar; the desktop transport's). */
export const zenToggle = (page: Page) =>
  page.getByTestId('zen-button').or(page.getByTestId('zen-button-desktop')).or(page.getByTestId('zen-button-landscape'));

/** Whether Zen hides the new layout now: its root is inert and transparent (read from the DOM: inert is out of the
 *  accessibility tree). */
export async function shellHidden(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="new-shell"]');
    return !!root && root.hasAttribute('inert') && root.classList.contains('opacity-0');
  });
}

/** Wait until Zen has hidden the new layout (3 s after the last activity, then the fade). */
export async function expectShellHidden(page: Page, message = 'Zen hides the controls', timeout = 6_000): Promise<void> {
  await expect.poll(() => shellHidden(page), { message, timeout, intervals: [100] }).toBe(true);
}

/** On a device the fixture sizes the page as a desktop: the phone shell needs a phone's viewport. */
export async function phoneSize(page: Page): Promise<void> {
  if (ON_DEVICE) await page.setViewportSize(PHONE_VIEWPORT);
}

/** Close the Safety panel when it opened by itself (an unanalysed track does that in classic). A DOM click: on a
 *  411 × 752 phone its Close sits under classic's player bar. */
export async function closeSafetyPanel(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close Safety Panel' });
  if (await close.isVisible().catch(() => false)) await close.evaluate((b) => (b as HTMLButtonElement).click());
}

/**
 * Classic first (the import lives there): v2 with an output answered (Headphones by default) or classic, `count`
 * tones, optionally Auto-Distributed, tone-01 playing (unless `play` is false); then the opt-in into the new layout.
 * layout.spec's playingInNewLayout, shared. Returns the native-dialog list.
 */
export async function playInNewLayout(
  page: Page,
  o: {
    count?: number;
    seconds?: number;
    engine?: 'v2' | 'classic';
    output?: 'headphones' | 'speakers' | 'phone' | 'car';
    autoDistribute?: boolean;
    play?: boolean;
    optIn?: boolean;
  } = {}
): Promise<string[]> {
  const engine = o.engine ?? 'v2';
  const dialogs = await openApp(page, { engine });
  if (engine === 'v2') await seedLayers(page, { engine: 'v2', output: o.output ?? 'headphones' });
  else if (o.output) await seedLayers(page, { engine: 'classic', output: o.output });
  await importTones(page, o.count ?? 3, o.seconds ?? 60);
  if (o.autoDistribute) await page.getByRole('button', { name: /Auto-Distribute Frequencies/ }).click();
  if (o.play !== false) {
    await page.getByText('tone-01', { exact: true }).first().click();
    await expect.poll(async () => (await layerState(page)).music?.time ?? 0, { timeout: 20_000 }).toBeGreaterThan(1);
    await closeSafetyPanel(page);
  } else {
    await page.getByText('tone-01', { exact: true }).first().waitFor({ timeout: 20_000 });
  }
  if (o.optIn !== false) await optInNewLayout(page);
  return dialogs;
}

/** Open the Layers tab (the phone's tab bar, or the desktop's nav) and wait for it. */
export async function openLayersTab(page: Page): Promise<void> {
  await tab(page, 'layers');
  await page.getByTestId('tab-layers').waitFor();
}

/** A jump chip of the Layers tab. */
export const layersJump = (page: Page, name: LayersSectionName) => page.getByTestId(`layers-jump-${name}`);

// ---------------------------------------------------------------------------------------------------------------
// The Library tab (v15.7)
// ---------------------------------------------------------------------------------------------------------------

/** The sort the Library tab saves from its select (the app's own key). */
export const LIBRARY_SORT_KEY = 'aetheria.librarySort.v1';

/** Open the Library tab (the phone's tab bar, or the desktop's nav) and wait for it. */
export async function openLibraryTab(page: Page): Promise<void> {
  await tab(page, 'library');
  await page.getByTestId('tab-library').waitFor();
}

/** A row of the Library tab's list, by its track's name (only rows in or near the view are mounted). */
export const libraryRow = (page: Page, name: string) =>
  page.getByTestId('library-row').filter({ has: page.locator('[data-row-title]').getByText(name, { exact: true }) });

/** A row's play button (the row's tap target). */
export const libraryRowButton = (page: Page, name: string) => libraryRow(page, name).locator('button[data-row-index]');

/** A row's ⋯ (the row menu). */
export const rowMenu = (page: Page, name: string) => page.getByRole('button', { name: `Options for ${name}`, exact: true });

/** The play order's exact state through the dev hook (window.__aetheriaLibrary; dev builds only). */
export interface LibraryState {
  ids: string[];
  names: string[];
  cursor: number;
  current: string | null;
  shuffle: boolean;
  shuffled: number[];
  shufflePos: number;
  walk: string | null;
  segments: number[] | null;
  phases: string[] | null;
  /** v15.8: the walk's position in LO_SHU_WALKS[walk] for each play-order entry (null: no walk). */
  steps: number[] | null;
  libraryIds: string[];
  libraryNames: string[];
  playing: boolean;
  t: number | null;
  src: string | null;
  undo: number | null;
  crystals: Array<number | null>;
  /** Each library track has a harmonicFreq (v15.8: playback-ready: Deep Scan's measurement, or Assign's crystal). */
  scanned: boolean[];
  /** v15.8: where each library track's crystal comes from (utils/mix/distribution.ts crystalOrigin). */
  origins: Array<'scan' | 'scan-replaced' | 'scan-failed' | 'assigned' | 'none'>;
  /** Each play-order entry's / library track's length (null: not read yet). */
  durations: Array<number | null>;
  libraryDurations: Array<number | null>;
}

async function libraryHook(page: Page): Promise<void> {
  await page
    .waitForFunction(() => typeof (window as any).__aetheriaLibrary?.state === 'function', null, { timeout: 10_000 })
    .catch(() => {
      throw new Error('window.__aetheriaLibrary is missing: the Library tab tests need the dev server (it is stripped from builds)');
    });
}

export async function libraryState(page: Page): Promise<LibraryState> {
  await libraryHook(page);
  return page.evaluate(() => (window as any).__aetheriaLibrary.state());
}

/** The latest row tap's Undo through the hook (as its toast's button does), for when the toast has gone. */
export async function libraryUndo(page: Page): Promise<void> {
  await libraryHook(page);
  await page.evaluate(() => (window as any).__aetheriaLibrary.undo());
}

/**
 * "Open the classic library": since v15.7 the peek is the health card's footer (the Library tab). The card folds to
 * one line when all is done, so it is opened first if folded.
 */
export async function peekClassicLibrary(page: Page): Promise<void> {
  if (!(await page.getByTestId('tab-library').isVisible().catch(() => false))) await openLibraryTab(page);
  const toggle = page.getByTestId('library-health-toggle');
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await page.getByRole('button', { name: 'Open the classic library', exact: true }).click();
}

export interface SeedOptions {
  /** The first `real` tracks are real tones of `seconds` (default 40), the rest tiny WAVs with a stated length. */
  real?: number;
  seconds?: number;
  /** 'all': every track a crystal (the 27 in turn, so 27+ tracks fill a walk); 'real': only the real tones have one (a
   *  walk then plays real tones only); 'some': 7 in 10; 'none'. */
  crystals?: 'all' | 'real' | 'some' | 'none';
  /** Key data (Analyse tracks' fields) on every other track. */
  keys?: boolean;
  /** Analyse tracks' visual envelope on 2 in 5. */
  envelopes?: boolean;
  /** Names `${prefix}-0001` … (default 'tone'); `pad: false` gives tone-1 …; `names` gives each its own. */
  prefix?: string;
  pad?: boolean;
  names?: string[];
  /** Per-track fields (by index): a crystal (null: none), a key with its confidence, Analyse tracks' visual envelope;
   *  `unscanned` drops harmonicFreq (Deep Scan's queue, and playTrack decodes it); `scanned` gives it Deep Scan's own
   *  fields (a fractal analysis, harmonicFreq 2.5 Hz off its crystal, that deviation). */
  patch?: Array<{ index: number; crystal?: number | null; key?: string; confidence?: number; visual?: boolean; unscanned?: boolean; scanned?: boolean }>;
}

/**
 * A synthetic library written straight into IndexedDB ('aetheria-db', playlistCache's schema), as an earlier session
 * would have saved it: `n` tracks named tone-0001 …, each with its audio, its metadata (a stated length, so a restore
 * never probes it) and the saved lists (library = play order, nothing current). 5,000 records restore in about a second,
 * where importing them would take minutes of length probes. Done from /manifest.json, so the app can't save over it;
 * load the app afterwards (openSeededNewLayout does both). The ids carry an import time, as the app's own do.
 */
export async function seedLibraryRecords(page: Page, n: number, opts: SeedOptions = {}): Promise<number> {
  await page.goto('/manifest.json');
  return page.evaluate(
    async ({ n, real, seconds, crystals, keys, envelopes, prefix, pad, names, patch }) => {
      const CRY = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
      const KEYS = ['Am', 'C', 'Em', 'G', 'Dm', 'F', 'Bm', 'C#m'];
      const wav = (secs: number, freq: number) => {
        const rate = 8000;
        const len = Math.max(8, Math.round(secs * rate));
        const buf = new ArrayBuffer(44 + len * 2);
        const v = new DataView(buf);
        const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
        v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        w(36, 'data'); v.setUint32(40, len * 2, true);
        for (let i = 0; i < len; i++) {
          const f = Math.min(1, i / 400, (len - i) / 400);
          v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000 * f), true);
        }
        return new Blob([buf], { type: 'audio/wav' });
      };
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
      const t0 = Date.now() - n * 1000;
      const ids: string[] = [];
      const tiny = wav(0.01, 440);
      const width = Math.max(4, String(n).length);
      for (let start = 0; start < n; start += 500) {
        const tx = db.transaction(['blobs', 'meta'], 'readwrite');
        for (let i = start; i < Math.min(n, start + 500); i++) {
          const num = i + 1;
          const name = names?.[i] ?? `${prefix}-${pad ? String(num).padStart(width, '0') : String(num)}`;
          const id = `${t0 + i * 1000}-${Math.random().toString(36).slice(2, 11)}`;
          ids.push(id);
          const isReal = i < real;
          tx.objectStore('blobs').put({ id, fileBlob: isReal ? wav(seconds, 220 + (i % 40) * 17) : tiny, fileName: `${name}.wav`, fileType: 'audio/wav' });
          const meta: any = { id, name, duration: isReal ? seconds : 150 + ((num * 37) % 240) };
          const hz = crystals === 'all' || (crystals === 'real' && isReal) ? CRY[i % 27] : crystals === 'some' && num % 10 < 7 ? CRY[(num * 7) % 27] : 0;
          if (hz) {
            meta.harmonicFreq = hz;
            meta.closestSolfeggio = hz;
            meta.harmonicDeviation = 3;
          }
          if (keys && num % 2 === 0) {
            meta.chroma = Array.from({ length: 12 }, (_, k) => (k === num % 12 ? 0.34 : 0.06));
            meta.chromaA4Hz = 440;
            meta.musicKey = KEYS[num % KEYS.length];
            meta.keyConfidence = 0.62;
            meta.chromaVersion = 1;
          }
          if (envelopes && num % 5 < 2) {
            const a = () => new Uint8Array(20).fill(90);
            meta.visualEnvelope = { fps: 20, sub: a(), bass: a(), mid: a(), high: a() };
          }
          for (const p of patch.filter((x: any) => x.index === i)) {
            if (p.crystal === null) {
              delete meta.harmonicFreq;
              delete meta.closestSolfeggio;
              delete meta.harmonicDeviation;
            } else if (typeof p.crystal === 'number') {
              meta.harmonicFreq = p.crystal;
              meta.closestSolfeggio = p.crystal;
              meta.harmonicDeviation = 3;
            }
            if (p.key) {
              meta.chroma = Array.from({ length: 12 }, (_, k) => (k === 9 ? 0.34 : 0.06));
              meta.chromaA4Hz = 440;
              meta.musicKey = p.key;
              meta.keyConfidence = p.confidence ?? 0.5;
              meta.chromaVersion = 1;
            }
            if (p.visual) {
              const a = () => new Uint8Array(20).fill(90);
              meta.visualEnvelope = { fps: 20, sub: a(), bass: a(), mid: a(), high: a() };
            }
            if (p.unscanned) delete meta.harmonicFreq;
            if (p.scanned && meta.closestSolfeggio) {
              meta.harmonicFreq = meta.closestSolfeggio + 2.5;
              meta.harmonicDeviation = 2.5;
              meta.fractalAnalysis = {
                dominantFrequency: meta.harmonicFreq, harmonicSeries: [meta.harmonicFreq], fractalDimension: 1.4, goldenRatioAlignment: 0.2,
                pattern111Presence: 0.1, dnaResonanceScore: 0.2, safetyLevel: 'SAFE', recommendedVolume: 0.8, infiniteOrderHarmonics: [],
                sacredGeometryAlignment: 0.2, schumannResonanceHarmony: 0.1,
              };
            }
          }
          tx.objectStore('meta').put(meta);
        }
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      }
      const tx = db.transaction('playlist-state', 'readwrite');
      tx.objectStore('playlist-state').put({ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: -1, loShuWalkMode: null, selectedSolfeggio: 396, savedAt: Date.now() });
      await new Promise((resolve) => (tx.oncomplete = resolve));
      db.close();
      return ids.length;
    },
    {
      n,
      real: opts.real ?? Math.min(n, 30),
      seconds: opts.seconds ?? 40,
      crystals: opts.crystals ?? 'all',
      keys: opts.keys ?? false,
      envelopes: opts.envelopes ?? false,
      prefix: opts.prefix ?? 'tone',
      pad: opts.pad ?? true,
      names: opts.names ?? null,
      patch: opts.patch ?? [],
    }
  );
}

/**
 * The new layout over a seeded library (seedLibraryRecords), v2 with Headphones answered (or `engine`): the choices
 * stored before the first load, the tutorial skipped, pause() counted, the disclaimer accepted, the library restored.
 * Returns the native-dialog list.
 */
export async function openSeededNewLayout(
  page: Page,
  n: number,
  opts: SeedOptions & { engine?: 'v2' | 'classic' } = {}
): Promise<string[]> {
  const dialogs = watchNativeDialogs(page);
  const engine = opts.engine ?? 'v2';
  await page.addInitScript(
    ({ engine, keys }) => {
      try {
        if (sessionStorage.getItem('__e2eSeededLib') === null) {
          sessionStorage.setItem('__e2eSeededLib', '1');
          localStorage.setItem(keys.engine, engine);
          if (engine === 'v2') localStorage.setItem(keys.output, 'headphones');
          localStorage.setItem(keys.layout, 'new');
        }
        localStorage.setItem('aetheria_v3_tutorial_seen', 'true');
      } catch {}
      const w = window as any;
      w.__pauseCount = 0;
      const original = HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
        w.__pauseCount++;
        return original.call(this);
      };
    },
    { engine, keys: { engine: LAYER_ENGINE_KEY, output: LAYER_OUTPUT_KEY, layout: LAYOUT_KEY } }
  );
  await seedLibraryRecords(page, n, opts);
  await page.goto('/');
  await acceptDisclaimerNew(page);
  await expect.poll(async () => (await libraryState(page)).libraryIds.length, { message: 'the seeded library restores', timeout: 60_000 }).toBe(n);
  return dialogs;
}

/** Start a Lo Shu walk from Now Playing's Walks sheet (or the desktop's) and wait until it plays. */
export async function startWalk(page: Page, mode: 'A' | 'B' | 'C' | 'combined' | 'ouroboros' | 'cabi'): Promise<void> {
  if (!(await page.getByTestId('view-now').isVisible().catch(() => false)) && !(await page.getByTestId('desktop-walks').isVisible().catch(() => false))) {
    await tab(page, 'now');
  }
  await page.getByTestId('np-walks').or(page.getByTestId('desktop-walks')).click();
  await page.getByTestId(`walk-${mode}`).click();
  await expect.poll(async () => { const s = await libraryState(page); return s.walk === mode && s.playing && (s.t ?? 0) > 0.2; }, { message: `walk ${mode} plays`, timeout: 20_000 }).toBe(true);
}

/** The Library tab's Undo toast (the notices region's card with an Undo button). */
export const undoToast = (page: Page) => page.getByTestId('notices').locator('div[aria-atomic="true"]').filter({ has: page.getByRole('button', { name: 'Undo', exact: true }) });

/** From the next page load on, count IndexedDB deletes and clears on the library's stores in window.__idbDeletes. */
export async function countLibraryDeletes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__idbDeletes = 0;
    const del = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'blobs' || this.name === 'meta') w.__idbDeletes++;
      return (del as any).apply(this, args);
    } as typeof del;
    const clear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function (this: IDBObjectStore) {
      if (this.name === 'blobs' || this.name === 'meta') w.__idbDeletes++;
      return clear.call(this);
    } as typeof clear;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The hide flush (v16.0.1): save-flush.spec.ts, and device.spec.ts's D1 and D2
// ---------------------------------------------------------------------------------------------------------------

/** From the next page load on, count every put of the 'current' record on the 'playlist-state' store in
 *  window.__statePuts: one per metadata + state save, the hide flush's included. statePuts reads it; statePutLibraries
 *  reads the library each put named; window.__statePutTimes holds when each was made (Date.now()). v16.1: a saved
 *  playlist's put ('pl:<id>', the same store) is counted apart, in window.__plPuts (plPuts). */
export async function countStatePuts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__statePuts = 0;
    w.__statePutLibraries = [];
    w.__statePutTimes = [];
    w.__plPuts = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
      const key = (args[0] as any)?.key;
      if (this.name === 'playlist-state' && key === 'current') {
        w.__statePuts++;
        w.__statePutTimes.push(Date.now());
        const order = (args[0] as { originalOrder?: unknown } | undefined)?.originalOrder;
        w.__statePutLibraries.push(Array.isArray(order) ? order.length : null);
      }
      if (this.name === 'playlist-state' && typeof key === 'string' && key.startsWith('pl:')) w.__plPuts++;
      return (put as any).apply(this, args);
    } as typeof put;
  });
}

export async function statePuts(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__statePuts as number);
}

/** The library size (originalOrder's length) of every 'current' put this page made, in order (countStatePuts). */
export async function statePutLibraries(page: Page): Promise<(number | null)[]> {
  return page.evaluate(() => (window as any).__statePutLibraries as (number | null)[]);
}

/** v16.1: the saved playlists' puts counted so far (countStatePuts). */
export async function plPuts(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__plPuts as number);
}

/** One page-lifecycle event: what, when (Date.now()), the visibility then, pagehide/pageshow's persisted, and the
 *  state-record puts counted so far (countStatePuts; null without it). */
export interface LifecycleEvent { e: string; t: number; vis: string; persisted?: boolean; puts: number | null }

/** From the next page load on, log the page's lifecycle (load, visibilitychange, pagehide, pageshow, freeze, resume) to
 *  localStorage['e2e.lifecycle'], synchronously as each event fires, so the log survives a reload, a navigation and a
 *  renderer crash. Registered before the app's own listeners, so an entry's `puts` is the count before any save the
 *  app makes for that event. Every load of the origin appends to the same log; lifecycleLog reads it. */
export async function recordLifecycle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log = (e: string, extra: { persisted?: boolean } = {}) => {
      try {
        const all = JSON.parse(localStorage.getItem('e2e.lifecycle') || '[]');
        const puts = (window as any).__statePuts;
        all.push({ e, t: Date.now(), vis: document.visibilityState, ...extra, puts: typeof puts === 'number' ? puts : null });
        localStorage.setItem('e2e.lifecycle', JSON.stringify(all));
      } catch {
        // No storage here: nothing to log.
      }
    };
    log('load');
    document.addEventListener('visibilitychange', () => log('visibilitychange'));
    window.addEventListener('pagehide', (ev) => log('pagehide', { persisted: (ev as PageTransitionEvent).persisted }));
    window.addEventListener('pageshow', (ev) => log('pageshow', { persisted: (ev as PageTransitionEvent).persisted }));
    document.addEventListener('freeze', () => log('freeze'));
    document.addEventListener('resume', () => log('resume'));
  });
}

export async function lifecycleLog(page: Page): Promise<LifecycleEvent[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('e2e.lifecycle') || '[]'));
}

/** A log as one line: "load pagehide(false) visibilitychange:hidden …". */
export const lifecycleLine = (log: LifecycleEvent[]) =>
  log.map((x) => x.e + (x.persisted !== undefined ? `(${x.persisted})` : '') + (x.e === 'visibilitychange' ? `:${x.vis}` : '')).join(' ');

/** Hosts that are this machine (or, on a device, the phone itself). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether a page at `url` is on a local host but not of the test origin (the user's localhost:3100, say). */
export function isOtherLocalOrigin(url: string): boolean {
  try {
    const u = new URL(url);
    return LOCAL_HOSTS.has(u.hostname) && u.origin !== TEST_ORIGIN;
  } catch {
    return false; // Not a URL: no local origin.
  }
}

/**
 * The URLs of every page the browser knows, other than `page`, that is on a local host but not of the test origin: a
 * page that could share the test tab's renderer process. Page.crash kills that whole process, and a port is not part of
 * a site, so another localhost origin (the user's own localhost:3100 tab, on the phone) is not kept apart from the test
 * origin. Only URLs are read: nothing is navigated, closed or evaluated in another page. On a device the browser is the
 * phone's whole Chrome, every tab of it. (device-hide.spec.ts asks the same over its raw DevTools session.)
 */
export function localPagesBesides(page: Page): string[] {
  const contexts = page.context().browser()?.contexts() ?? [page.context()];
  const others: string[] = [];
  for (const context of contexts) {
    for (const p of context.pages()) {
      if (p !== page && isOtherLocalOrigin(p.url())) others.push(p.url());
    }
  }
  return others;
}

/**
 * Kill the tab's renderer (CDP Page.crash), as Android's background kill or a crash does: no event runs. Only ever the
 * test's own tab: its URL must be the test origin's (on a device the CDP context also holds the user's own tabs). And
 * Page.crash kills the tab's whole renderer process, not only the tab, so it refuses while any other page of a local
 * host but another origin is open anywhere in the browser (localPagesBesides): on the phone, close the localhost:3100
 * tab first. Page.crash never answers (its target is gone), so it is sent and not awaited (an awaited one hangs); the
 * page's crash event says it happened. Playwright then refuses to navigate this page ("Page crashed"): open the app
 * again in a new tab (secondTab).
 */
export async function crashPage(page: Page): Promise<void> {
  const url = page.url();
  if (!url.startsWith(TEST_ORIGIN + '/')) throw new Error(`Refusing to crash ${url}: only a tab of ${TEST_ORIGIN} is the tests' own.`);
  const others = localPagesBesides(page);
  if (others.length) {
    throw new Error(
      `Refusing to crash the test tab: Page.crash kills its whole renderer process, which another local origin can share ` +
        `(a port is not part of a site). Open now: ${others.join(', ')}. Close ${others.length === 1 ? 'that tab' : 'those tabs'} and run it again.`
    );
  }
  const crashed = page.waitForEvent('crash', { timeout: 15_000 });
  const cdp = await page.context().newCDPSession(page);
  cdp.send('Page.crash').catch(() => {});
  await crashed;
}

/**
 * A new tab of the test's browser context (the same profile, so the same origin's storage), for a test whose own tab
 * was closed or crashed. On a device it is a new tab in the phone's Chrome, set up as the fixture sets its own (the
 * service worker stubbed, every media element tracked): close it with closeSecondTab in a finally. Not navigated: add
 * any init scripts, then go to an absolute URL (appUrl: a device context has no baseURL).
 */
export async function secondTab(page: Page): Promise<Page> {
  const tab = await page.context().newPage();
  watchNativeDialogs(tab);
  if (ON_DEVICE) {
    await tab.addInitScript(() => {
      if (navigator.serviceWorker) (navigator.serviceWorker as any).register = () => new Promise(() => {});
      const media = ((window as any).__e2eMedia = new Set<HTMLMediaElement>());
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        media.add(this);
        return play.call(this);
      };
    });
  }
  return tab;
}

/** The fixture's teardown for a secondTab: its media stopped and its media session released, then closed; and no
 *  native dialog opened in it. */
export async function closeSecondTab(tab: Page): Promise<void> {
  const opened = watchNativeDialogs(tab);
  if (!tab.isClosed()) {
    await tab
      .evaluate(() => {
        for (const el of (window as any).__e2eMedia ?? []) {
          try { el.pause(); } catch {}
        }
        try {
          navigator.mediaSession.playbackState = 'none';
          navigator.mediaSession.metadata = null;
        } catch {}
      })
      .catch(() => {});
    if (ON_DEVICE) await tab.waitForTimeout(1000).catch(() => {});
    await tab.goto('about:blank').catch(() => {});
    await tab.close().catch(() => {});
  }
  expect(opened, 'a native dialog opened in the second tab').toEqual([]);
}

/** An absolute URL of the test origin (a device context, and so a secondTab there, has no baseURL). */
export const appUrl = (path = '/') => new URL(path, TEST_ORIGIN).toString();

/** On the tab's first app load: hold the restore's read of the stored audio (restorePlaylist's getAll on 'blobs') until
 *  window.__releaseRestore(), as a large library restoring slowly does. Both of StrictMode's restores are held. */
export async function holdRestore(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (location.pathname !== '/') return;
    try {
      if (sessionStorage.getItem('__e2eHoldRestore') !== null) return;
      sessionStorage.setItem('__e2eHoldRestore', '1');
    } catch {
      return;
    }
    const w = window as any;
    const gate = new Promise<void>((resolve) => (w.__releaseRestore = resolve));
    w.__restoreHeld = 0;
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...args: unknown[]) {
      const request: IDBRequest = (getAll as any).apply(this, args);
      if (this.name !== 'blobs') return request;
      w.__restoreHeld++;
      return new Proxy(request, {
        set(t, k, v) {
          if (k === 'onsuccess' && typeof v === 'function') {
            t.onsuccess = (ev) => { gate.then(() => v.call(t, ev)); };
            return true;
          }
          (t as any)[k] = v;
          return true;
        },
        get(t, k) {
          const x = (t as any)[k];
          return typeof x === 'function' ? x.bind(t) : x;
        },
      });
    } as typeof getAll;
  });
}

/** "Never smaller" (v16.0.1, F12): the saved record's library holds every id in `ids` (the stored library before the
 *  test, less what it deleted). */
export async function expectLibraryAtLeast(page: Page, ids: string[], what = 'the saved library'): Promise<void> {
  const st = await savedState(page);
  const saved = new Set<string>(st?.originalOrder ?? []);
  expect(ids.filter((id) => !saved.has(id)), `${what} never smaller: every stored track still listed`).toEqual([]);
}

/**
 * The flush tests' library (queue.spec's seed), written straight into IndexedDB from /manifest.json: n synthetic tones
 * tone-01 … (tone k lasts `seconds(k)`, by default 6 + 0.25 k s), each with a crystal unless listed in `noCrystal`; the
 * library is the play order, with the cursor at `cursor`. Returns the ids in library order.
 */
export async function seedToneLibrary(
  page: Page,
  o: { n: number; cursor?: number; noCrystal?: number[]; seconds?: number[] }
): Promise<string[]> {
  await page.goto(appUrl('/manifest.json'));
  const seconds = o.seconds ?? Array.from({ length: o.n }, (_, i) => 6 + 0.25 * (i + 1));
  return page.evaluate(async ({ n, cursor, noCrystal, seconds }) => {
    const CRY = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
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
      const id = `${t0 + i * 1000}-f${String(k).padStart(2, '0')}`;
      ids.push(id);
      const name = `tone-${String(k).padStart(2, '0')}`;
      tx.objectStore('blobs').put({ id, fileBlob: wav(seconds[i], 220 + i * 11), fileName: `${name}.wav`, fileType: 'audio/wav' });
      const hz = CRY[i % 27];
      tx.objectStore('meta').put(noCrystal.includes(k)
        ? { id, name, duration: seconds[i] }
        : { id, name, duration: seconds[i], harmonicFreq: hz + 2.5, closestSolfeggio: hz, harmonicDeviation: 2.5, crystalSource: 'scan' });
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    const st = db.transaction('playlist-state', 'readwrite');
    st.objectStore('playlist-state').put({ key: 'current', playlistOrder: ids, originalOrder: ids, currentSongIndex: cursor, loShuWalkMode: null, selectedSolfeggio: 396, savedAt: Date.now() });
    await new Promise((resolve) => (st.oncomplete = resolve));
    db.close();
    return ids;
  }, { n: o.n, cursor: o.cursor ?? 0, noCrystal: o.noCrystal ?? [], seconds });
}
