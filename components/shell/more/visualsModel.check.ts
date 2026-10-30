// Checks for components/shell/more/visualsModel.ts (v16.4, the Visuals sheet: its summaries, its words, the throttle).
// Run with: node components/shell/more/visualsModel.check.ts   (npm run check:shell; Node 22.18+ strips the types)
// Exits non-zero on any failure.

import {
  VISUALS_SECTIONS,
  VISUALS_PAUSED_KEY,
  parseVisualsPaused,
  pauseVisualsLine,
  userPauseHolds,
  HEX_MODES,
  COLOR_MODES,
  PALETTE_DESCRIPTION,
  wanderLine,
  FRAME_RATES,
  FRAME_RATE_HINT,
  frameRateOf,
  sacredGeometryLine,
  cubeLine,
  PATHS,
  speedText,
  reactivityText,
  opacityText,
  rippleText,
  positionText,
  visualsSummary,
  lookStatus,
  hexesStatus,
  overlaysStatus,
  motionStatus,
  comfortStatus,
  visualsSubtitle,
  makeThrottle,
  SLIDER_WRITE_MS,
} from './visualsModel.ts';
import type { ThrottleClock } from './visualsModel.ts';

let passed = 0;
const failures: string[] = [];
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) passed++;
  else failures.push(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// The groups.
eq(VISUALS_SECTIONS.map((s) => s.title), ['Look', 'Hexes', 'Overlays', 'Motion', 'Comfort'], 'the five groups, in order');

// Pause visuals: only 'true' pauses; the rule yields to a visual recording only, and never in classic.
eq(VISUALS_PAUSED_KEY, 'aetheria.visualsPaused.v1', 'the key');
eq([parseVisualsPaused('true'), parseVisualsPaused('false'), parseVisualsPaused(null), parseVisualsPaused(undefined), parseVisualsPaused('1')], [true, false, false, false, false], 'the stored value');
eq(pauseVisualsLine(false), 'Stops the visualizer: a still, dark background. The music plays on. Saved.', 'the line, off');
eq(pauseVisualsLine(true), 'The visualizer is stopped: a still, dark background. The music plays on. Saved.', 'the line, on');
eq(
  [null, 'audio', 'video', 'both'].map((k) => userPauseHolds(true, true, k as 'audio' | 'video' | 'both' | null)),
  [true, true, false, false],
  'the pause holds under Audio Only, not under a visual recording'
);
eq([userPauseHolds(false, true, null), userPauseHolds(true, false, null)], [false, false], 'classic never pauses; off never pauses');

// Classic's words.
eq(HEX_MODES.map((m) => m.label), ['Radial Pulse (Gentle)', 'Spectrum Lens (Epic)', 'Energy Wave (Flowing)'], 'the hex modes');
eq(COLOR_MODES.map((m) => [m.id, m.label]), [['chakra', 'Chakra'], ['cycle', 'Hypnotic'], ['static', 'Static'], ['spectrum', 'Spectrum']], 'the colour modes');
eq(COLOR_MODES[0].title, 'Chakra palette tied to the current Solfeggio frequency', "Chakra's classic title");
eq(PALETTE_DESCRIPTION.includes('Lo Shu cube'), true, "the palette line keeps classic's non-breaking space");
eq(wanderLine(true, false), 'Off-colour hexes glide to a neighbouring cell every few seconds, faster when the music is busy.', 'wander on');
eq(wanderLine(false, false), 'Off-colour hexes stay in their original places.', 'wander off');
eq([wanderLine(true, true), wanderLine(false, true)], ['Held still: this device asks for reduced motion.', 'Held still: this device asks for reduced motion.'], 'reduced motion holds it still');
eq(FRAME_RATES.map((r) => r.label), ['Standard · 30 fps', 'Cooler · ~20 fps'], 'the frame rates');
eq(FRAME_RATE_HINT, 'Cooler draws the visualizer at ~20 fps instead of 30: a little less smooth.', 'the hint');
eq([frameRateOf(undefined), frameRateOf('standard'), frameRateOf('cooler'), frameRateOf('x')], ['standard', 'standard', 'cooler', 'standard'], 'unset is Standard');
eq([sacredGeometryLine(true), sacredGeometryLine(false)], ['Sacred forms appear based on frequency.', 'Particles return to chaos/cloud state.'], 'sacred geometry');
eq(cubeLine(true, 'chakra'), '27 sub-cubes (GUT/HEART/HEAD × Lo Shu 1–9), tinted by chakra palette.', 'the cube, chakra');
eq(cubeLine(true, 'spectrum'), '27 sub-cubes (GUT/HEART/HEAD × Lo Shu 1–9), tinted by visible-light wavelength.', 'the cube, spectrum');
eq(cubeLine(false, 'chakra'), 'Render the 3×3×3 Lo Shu cube as a visualizer overlay.', 'the cube, off');
eq(PATHS.map((p) => p.label), ['Vortex', 'Ascent', 'Pillar', 'Ouroboros'], 'the four paths');
eq([speedText(1), speedText(0.1), reactivityText(1), reactivityText(0.1), opacityText(0.6), rippleText(50), positionText(134.6)], ['1.0x', '0.1x', '100%', '10%', '60 %', '50%', '135°'], 'the readouts');

// The Visualizer row's summary, for every mode × colour × wander × rate × paused.
const DEFAULTS = { hexVisualMode: 'spectrum', colorMode: 'chakra', showHexagons: true };
eq(visualsSummary(DEFAULTS, false), 'Spectrum Lens · Chakra · wandering hexes · 30 fps', 'the defaults (hexWander and frameRate unset)');
let all = 0;
for (const mode of HEX_MODES) {
  for (const colour of COLOR_MODES) {
    for (const wander of [undefined, true, false]) {
      for (const rate of [undefined, 'standard', 'cooler']) {
        for (const paused of [false, true]) {
          const got = visualsSummary({ ...DEFAULTS, hexVisualMode: mode.id, colorMode: colour.id, hexWander: wander, frameRate: rate }, paused);
          const want = paused
            ? 'Paused · the music plays on'
            : `${mode.short} · ${colour.label} · ${wander === false ? 'still hexes' : 'wandering hexes'} · ${rate === 'cooler' ? '~20 fps' : '30 fps'}`;
          if (got === want) all++;
          else failures.push(`summary ${mode.id}/${colour.id}/${wander}/${rate}/${paused}: got ${got}, want ${want}`);
        }
      }
    }
  }
}
eq(all, 3 * 4 * 3 * 3 * 2, 'every summary');
eq(visualsSummary({ ...DEFAULTS, showHexagons: false }, false), 'Spectrum Lens · Chakra · no hex grid · 30 fps', 'the grid off');
eq(visualsSummary(DEFAULTS, false, true), 'Spectrum Lens · Chakra · still hexes · 30 fps', 'reduced motion');
eq(visualsSummary(null, false), 'Spectrum Lens · Chakra · wandering hexes · 30 fps', 'total on missing input');
eq(visualsSummary({ hexVisualMode: 'nonsense', colorMode: 42 as unknown as string }, false), 'Spectrum Lens · Chakra · wandering hexes · 30 fps', 'unknown values');

// The group statuses.
eq([lookStatus({ hexVisualMode: 'pulse' }), lookStatus({ hexVisualMode: 'wave' }), lookStatus(null)], ['Radial Pulse', 'Energy Wave', 'Spectrum Lens'], 'Look');
eq([hexesStatus(DEFAULTS, false), hexesStatus({ ...DEFAULTS, hexWander: false }, false), hexesStatus(DEFAULTS, true), hexesStatus({ showHexagons: false }, false)], ['wandering', 'still', 'held still', 'grid off'], 'Hexes');
eq(overlaysStatus({ morphEnabled: true }), 'sacred geometry', 'Overlays, the defaults');
eq(overlaysStatus({ showLoShuCube: true, showWaterRipples: true, morphEnabled: false }), 'Lo Shu cube · ripples', 'Overlays, the cube and ripples');
eq(overlaysStatus({ showTreeOfLife: true, enableTrails: true, morphEnabled: false }), 'Tree of Life · trails', 'Overlays, the tree and trails');
eq(overlaysStatus({ morphEnabled: false }), 'none', 'Overlays, none');
eq([motionStatus({ speed: 1, particleDensity: 'medium' }), motionStatus({ speed: 2.5, particleDensity: 'high' }), motionStatus(null)], ['1.0x · Medium', '2.5x · High', '1.0x · Medium'], 'Motion');
eq([comfortStatus(undefined, false), comfortStatus('cooler', false), comfortStatus('cooler', true)], ['30 fps', '~20 fps', 'paused'], 'Comfort');

// The sheet's subtitle.
eq(visualsSubtitle({ car: false, userPaused: false, pausedNow: false, panel: false }), 'Changes show above as you make them', 'the phone');
eq(visualsSubtitle({ car: false, userPaused: false, pausedNow: false, panel: true }), 'Changes show beside this panel as you make them', 'the desktop');
eq(visualsSubtitle({ car: false, userPaused: true, pausedNow: true, panel: false }), 'Paused · the music plays on', 'paused');
eq(visualsSubtitle({ car: false, userPaused: true, pausedNow: false, panel: false }), 'Changes show above as you make them', 'a visual recording overrides the pause');
eq(visualsSubtitle({ car: true, userPaused: true, pausedNow: true, panel: false }), 'The Car screen keeps the visuals off.', 'Car first');

// The throttle, on a fake clock.
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: ThrottleClock = {
    now: () => t,
    set: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clear: (h) => {
      timers.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
    }
    t = end;
  };
  return { clock, advance, pending: () => timers.size };
}

{
  const { clock, advance } = fakeClock();
  const writes: number[] = [];
  const th = makeThrottle<number>((v) => writes.push(v), 250, clock);
  th.push(1);
  eq(writes, [1], 'leading: the first value is written at once');
  advance(100);
  th.push(2);
  advance(50);
  th.push(3);
  eq(writes, [1], 'inside the window nothing more is written');
  advance(100);
  eq(writes, [1, 3], "trailing: the window's latest value at its end");
  th.push(4);
  eq(writes, [1, 3], 'right after a trailing write, the next waits for its window');
  th.flush();
  eq(writes, [1, 3, 4], 'release writes the final value at once');
  th.flush();
  eq(writes, [1, 3, 4], 'a second release writes nothing new');
}
{
  const { clock, advance, pending } = fakeClock();
  const writes: number[] = [];
  const th = makeThrottle<number>((v) => writes.push(v), 250, clock);
  th.push(1);
  advance(10);
  th.push(2);
  th.flush();
  th.cancel();
  advance(1000);
  eq(writes, [1, 2], 'unmount: a last flush, then nothing more');
  th.push(9);
  advance(1000);
  eq(writes, [1, 2], 'no write after cancel');
  eq(pending(), 0, 'no timer left after cancel');
}
{
  eq(SLIDER_WRITE_MS >= 250, true, 'a drag writes at most one value per 250 ms (decisions.md)');
  // A drag of T ms, one input every 33 ms (the V4 drag): at most ceil(T / 250) + 1 writes, the last one the final value.
  for (const steps of [5, 10, 45, 90]) {
    const { clock, advance } = fakeClock();
    const writes: number[] = [];
    const th = makeThrottle<number>((v) => writes.push(v), SLIDER_WRITE_MS, clock);
    for (let i = 1; i <= steps; i++) {
      th.push(i);
      advance(33);
    }
    th.flush();
    const T = steps * 33;
    eq(writes.length <= Math.ceil(T / 250) + 1, true, `a ${T} ms drag: ${writes.length} writes ≤ ${Math.ceil(T / 250) + 1}`);
    eq(writes[writes.length - 1], steps, `a ${T} ms drag ends on its final value`);
  }
}

console.log(`visualsModel: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
