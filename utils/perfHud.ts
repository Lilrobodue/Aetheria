// utils/perfHud.ts
//
// Dev-only performance readout for the release thermal gate. Every release from
// v14.5 is soaked on the phone against a baseline recorded with this HUD (B0),
// because freeing main-thread time lets the visualizer draw more frames and the
// phone run hotter (the v13.5–13.7 lesson). It shows, once a second:
//   draws     frames the Visualizer actually rendered (after its 30 fps gate)
//   rAF       animation frames the browser delivered
//   commits   React commits of App
//   long      long tasks (> 50 ms) and their total time (Chromium only)
//   hex       (own line) while the hex wander runs: accepted moves/s and the
//             mean of tokens gliding, both over the WHOLE grid; the mean of
//             tokens on screen; pace energy; the wander's own time (µs). Absent
//             in windows where the wander didn't run.
//   spec      (own line) while the Spectrum hex mode runs: hexagons drawn per
//             frame (cells, tokens, caps and cores; 0.0 once a pause has faded
//             it out) and the layer's own time per frame (µs). Absent in
//             windows where the Spectrum layer didn't run.
//
// OFF by default and free when off: the counters are a single boolean test.
// Turn it on with ?perf=1 in the URL and off with ?perf=0. The choice is kept
// in localStorage so it also works in the installed PWA, where no URL can be
// typed. The same line is logged to the console for remote DevTools.

const FLAG_KEY = 'aetheria.perfhud.v1';

function readFlag(): boolean {
  try {
    const p = new URLSearchParams(window.location.search).get('perf');
    if (p === '1') localStorage.setItem(FLAG_KEY, '1');
    else if (p === '0') localStorage.removeItem(FLAG_KEY);
    return localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export const perfHudEnabled: boolean = typeof window !== 'undefined' && readFlag();

let draws = 0;
let commits = 0;

/** Visualizer: call once per frame it actually renders. */
export function countDraw(): void {
  if (perfHudEnabled) draws++;
}

/** App: call once per React commit. */
export function countCommit(): void {
  if (perfHudEnabled) commits++;
}

let hexMoves = 0;
let hexFrames = 0;
let hexOnScreen = 0;
let hexGliding = 0;
let hexEnergy = 0;
let hexUs = 0;

/** Visualizer: hex-wander moves accepted this frame. */
export function countHexMoves(n: number): void {
  if (perfHudEnabled) hexMoves += n;
}

/** Visualizer: once per rendered frame in which the hex wander ran. */
export function reportHexFrame(onScreen: number, gliding: number, energy: number, wanderUs: number): void {
  if (!perfHudEnabled) return;
  hexFrames++;
  hexOnScreen += onScreen;
  hexGliding += gliding;
  hexEnergy += energy;
  hexUs += wanderUs;
}

let specFrames = 0;
let specDrawn = 0;
let specUs = 0;

/** Visualizer: once per rendered frame in which the Spectrum layer ran. */
export function reportSpectrumFrame(drawn: number, us: number): void {
  if (!perfHudEnabled) return;
  specFrames++;
  specDrawn += drawn;
  specUs += us;
}

let started = false;

export function startPerfHud(): void {
  if (!perfHudEnabled || started || typeof document === 'undefined') return;
  started = true;

  let rafs = 0;
  const onFrame = () => {
    rafs++;
    requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);

  let longTasks = 0;
  let longMs = 0;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks++;
        longMs += entry.duration;
      }
    });
    observer.observe({ type: 'longtask' } as PerformanceObserverInit);
  } catch {
    // Long-task timing is Chromium-only; the other counters still work.
  }

  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-testid', 'perf-hud');
  el.style.cssText =
    'position:fixed;top:4px;left:4px;z-index:300;pointer-events:none;' +
    'font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cbd5e1;' +
    'background:rgba(0,0,0,.72);padding:4px 6px;border-radius:4px;white-space:pre';
  document.body.appendChild(el);

  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const s = Math.max(0.001, (now - last) / 1000);
    last = now;
    let line =
      `draws ${(draws / s).toFixed(1)}/s · rAF ${(rafs / s).toFixed(1)}/s · ` +
      `commits ${(commits / s).toFixed(1)}/s · long ${longTasks} (${Math.round(longMs)} ms)`;
    if (hexFrames > 0) {
      line +=
        ` · hex ${(hexMoves / s).toFixed(1)}/s on ${(hexOnScreen / hexFrames).toFixed(1)}` +
        ` glide ${(hexGliding / hexFrames).toFixed(1)} e${(hexEnergy / hexFrames).toFixed(2)}` +
        ` ${Math.round(hexUs / hexFrames)}µs`;
    }
    if (specFrames > 0) {
      line += ` · spec ${(specDrawn / specFrames).toFixed(1)}/f ${Math.round(specUs / specFrames)}µs`;
    }
    // The hex and spec parts get their own lines on screen: one line overflows a phone.
    el.textContent = line.replace(' · hex', '\nhex').replace(' · spec', '\nspec');
    console.log('[perf] ' + line);
    draws = 0;
    rafs = 0;
    commits = 0;
    longTasks = 0;
    longMs = 0;
    hexMoves = 0;
    hexFrames = 0;
    hexOnScreen = 0;
    hexGliding = 0;
    hexEnergy = 0;
    hexUs = 0;
    specFrames = 0;
    specDrawn = 0;
    specUs = 0;
  }, 1000);
}
