// components/shell/more/visualsModel.ts (v16.4, the More area: the Visuals sheet)
//
// The Visuals sheet's pure rules (decision 1 A: a sheet over the playing visuals; the desktop's 420 px panel): its five
// groups and their status lines, the Visualizer row's one-line summary, every control's words (classic's own, in
// sentence case where classic shouts), and the slider throttle that keeps a drag inside the visualizer's 30 fps cap.
// Free of app imports, so Node checks it directly (visualsModel.check.ts: `npm run check:shell`).

// ---------------------------------------------------------------------------------------------------------------
// The groups
// ---------------------------------------------------------------------------------------------------------------

export type VisualsSection = 'look' | 'hexes' | 'overlays' | 'motion' | 'comfort';

/** The sticky jump row's chips, in the page's order (the mockup measured all five to fit 379 px). */
export const VISUALS_SECTIONS: ReadonlyArray<{ id: VisualsSection; title: string }> = [
  { id: 'look', title: 'Look' },
  { id: 'hexes', title: 'Hexes' },
  { id: 'overlays', title: 'Overlays' },
  { id: 'motion', title: 'Motion' },
  { id: 'comfort', title: 'Comfort' },
];

/** The ids and test ids of the Visuals sheet's cards and chips (SectionCard / JumpRow `prefix`). */
export const VISUALS_PREFIX = 'visuals';

// ---------------------------------------------------------------------------------------------------------------
// Pause visuals (new in v16.4): the new layout's own switch, saved from its tap only
// ---------------------------------------------------------------------------------------------------------------

export const VISUALS_PAUSED_KEY = 'aetheria.visualsPaused.v1';

/** Only 'true' pauses: unset, unreadable or anything else is today's (the visuals run). */
export function parseVisualsPaused(raw: string | null | undefined): boolean {
  return raw === 'true';
}

export const PAUSE_VISUALS_LABEL = 'Pause visuals';
export const PAUSE_VISUALS_OFF = 'Stops the visualizer: a still, dark background. The music plays on. Saved.';
export const PAUSE_VISUALS_ON = 'The visualizer is stopped: a still, dark background. The music plays on. Saved.';
/** While a visual recording overrides the switch (it captures the canvas). */
export const PAUSE_VISUALS_RECORDING = 'The visuals run while a visual recording runs.';

export function pauseVisualsLine(on: boolean): string {
  return on ? PAUSE_VISUALS_ON : PAUSE_VISUALS_OFF;
}

/**
 * Whether the user's pause holds now: the new layout only (classic never reads it), and never during a recording that
 * captures the canvas (Visuals Only, AV Mix). An Audio Only recording does not override it, so a photosensitive user's
 * pause holds while audio records. App's `userPausedNow` is this.
 */
export function userPauseHolds(shellOn: boolean, userPaused: boolean, recordingKind: 'audio' | 'video' | 'both' | null): boolean {
  return shellOn && userPaused && recordingKind !== 'video' && recordingKind !== 'both';
}

// ---------------------------------------------------------------------------------------------------------------
// Words (classic's, App's Visualization Engine and the Lo Shu popover)
// ---------------------------------------------------------------------------------------------------------------

export type HexMode = 'pulse' | 'spectrum' | 'wave';
export const HEX_MODES: ReadonlyArray<{ id: HexMode; label: string; short: string }> = [
  { id: 'pulse', label: 'Radial Pulse (Gentle)', short: 'Radial Pulse' },
  { id: 'spectrum', label: 'Spectrum Lens (Epic)', short: 'Spectrum Lens' },
  { id: 'wave', label: 'Energy Wave (Flowing)', short: 'Energy Wave' },
];

export type ColorMode = 'chakra' | 'cycle' | 'static' | 'spectrum';
/** Classic's "Color Mode" buttons; `title` is each one's classic tooltip, shown here as the pressed one's line. */
export const COLOR_MODES: ReadonlyArray<{ id: ColorMode; label: string; title: string }> = [
  { id: 'chakra', label: 'Chakra', title: 'Chakra palette tied to the current Solfeggio frequency' },
  { id: 'cycle', label: 'Hypnotic', title: 'RGB cycle synced to audio energy' },
  { id: 'static', label: 'Static', title: 'Single colour locked to the current chakra/spectrum primary' },
  { id: 'spectrum', label: 'Spectrum', title: 'Visible-light wavelength of the active frequency, modulated by audio' },
];

export type Palette = 'chakra' | 'spectrum';
export const PALETTES: ReadonlyArray<{ id: Palette; label: string }> = [
  { id: 'chakra', label: 'Chakra' },
  { id: 'spectrum', label: 'Spectrum' },
];
/** The Lo Shu popover's "Colour Mode" description, verbatim (its &nbsp; too). */
export const PALETTE_DESCRIPTION =
  'Chakra: the traditional Solfeggio palette. Spectrum: the colour each frequency would have if octave-shifted into visible light. Affects the visualizer, the Lo Shu cube, and grid cells.';

/** The Wandering hexes row's status line (classic's three). */
export function wanderLine(on: boolean, reducedMotion: boolean): string {
  if (reducedMotion) return 'Held still: this device asks for reduced motion.';
  if (!on) return 'Off-colour hexes stay in their original places.';
  return 'Off-colour hexes glide to a neighbouring cell every few seconds, faster when the music is busy.';
}

export type FrameRate = 'standard' | 'cooler';
export const FRAME_RATES: ReadonlyArray<{ id: FrameRate; label: string }> = [
  { id: 'standard', label: 'Standard · 30 fps' },
  { id: 'cooler', label: 'Cooler · ~20 fps' },
];
export const FRAME_RATE_HINT = 'Cooler draws the visualizer at ~20 fps instead of 30: a little less smooth.';
/** Unset (never tapped) is Standard, as every reader treats it. */
export function frameRateOf(v: unknown): FrameRate {
  return v === 'cooler' ? 'cooler' : 'standard';
}

export function sacredGeometryLine(on: boolean): string {
  return on ? 'Sacred forms appear based on frequency.' : 'Particles return to chaos/cloud state.';
}

/** The Lo Shu Cube's line (classic's two; the tint follows the crystal palette). */
export function cubeLine(on: boolean, palette: Palette): string {
  return on
    ? `27 sub-cubes (GUT/HEART/HEAD × Lo Shu 1–9), tinted by ${palette === 'spectrum' ? 'visible-light wavelength' : 'chakra palette'}.`
    : 'Render the 3×3×3 Lo Shu cube as a visualizer overlay.';
}

export const PATH_ILLUMINATION = 'Path Illumination';
export const PATH_ILLUMINATION_LINE = 'Light up walk paths without loading a playlist. Toggle individually or combine.';
export type PathKey = 'loShuShowVortex' | 'loShuShowAscent' | 'loShuShowPillar' | 'loShuShowOuroboros';
export const PATHS: ReadonlyArray<{ key: PathKey; label: string; sub: string }> = [
  { key: 'loShuShowVortex', label: 'Vortex', sub: 'C · 5→6→7→8→9→1→2→3→4 spiral' },
  { key: 'loShuShowAscent', label: 'Ascent', sub: 'A · 1→9 per layer' },
  { key: 'loShuShowPillar', label: 'Pillar', sub: 'B · vertical GUT→HEART→HEAD' },
  { key: 'loShuShowOuroboros', label: 'Ouroboros', sub: 'I · figure-8 crossing SOURCE 3×' },
];

export type Density = 'low' | 'medium' | 'high';
export const DENSITIES: ReadonlyArray<{ id: Density; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

// The readouts, as classic shows them (Hex opacity had none in classic: "60 %").
export const speedText = (v: number): string => `${Number(v).toFixed(1)}x`;
export const sizeText = (v: number): string => `${Number(v).toFixed(1)}x`;
export const reactivityText = (v: number): string => `${(Number(v) * 100).toFixed(0)}%`;
export const opacityText = (v: number): string => `${Math.round(Number(v) * 100)} %`;
export const rippleText = (v: number): string => `${Number(v).toFixed(0)}%`;
export const positionText = (v: number): string => `${Math.round(Number(v))}°`;

// ---------------------------------------------------------------------------------------------------------------
// Summaries and status lines (from the settings, never the clock)
// ---------------------------------------------------------------------------------------------------------------

/** The subset of VizSettings these read (any missing key reads as its default). */
export interface VizLike {
  hexVisualMode?: string;
  colorMode?: string;
  showHexagons?: boolean;
  hexWander?: boolean;
  frameRate?: string;
  showTreeOfLife?: boolean;
  morphEnabled?: boolean;
  enableTrails?: boolean;
  showWaterRipples?: boolean;
  showLoShuCube?: boolean;
  speed?: number;
  particleDensity?: string;
}

export const PAUSED_SUMMARY = 'Paused · the music plays on';

function hexShort(mode: unknown): string {
  return (HEX_MODES.find((m) => m.id === mode) ?? HEX_MODES[1]).short;
}
function colourLabel(mode: unknown): string {
  return (COLOR_MODES.find((m) => m.id === mode) ?? COLOR_MODES[0]).label;
}

/**
 * The More root's Visualizer row: "Spectrum Lens · Chakra · wandering hexes · 30 fps", or "Paused · the music plays on"
 * while the user's Pause visuals is on. Total on missing input.
 */
export function visualsSummary(s: VizLike | null | undefined, paused: boolean, reducedMotion = false): string {
  if (paused) return PAUSED_SUMMARY;
  const v = s ?? {};
  const hexes = v.showHexagons === false ? 'no hex grid' : v.hexWander === false || reducedMotion ? 'still hexes' : 'wandering hexes';
  const fps = frameRateOf(v.frameRate) === 'cooler' ? '~20 fps' : '30 fps';
  return `${hexShort(v.hexVisualMode)} · ${colourLabel(v.colorMode)} · ${hexes} · ${fps}`;
}

export function lookStatus(s: VizLike | null | undefined): string {
  return hexShort(s?.hexVisualMode);
}

export function hexesStatus(s: VizLike | null | undefined, reducedMotion: boolean): string {
  if (s?.showHexagons === false) return 'grid off';
  if (reducedMotion) return 'held still';
  return s?.hexWander === false ? 'still' : 'wandering';
}

export function overlaysStatus(s: VizLike | null | undefined): string {
  const v = s ?? {};
  const on: string[] = [];
  if (v.showLoShuCube) on.push('Lo Shu cube');
  if (v.showTreeOfLife) on.push('Tree of Life');
  if (v.showWaterRipples) on.push('ripples');
  if (v.enableTrails) on.push('trails');
  if (v.morphEnabled !== false) on.push('sacred geometry');
  return on.length ? on.join(' · ') : 'none';
}

export function motionStatus(s: VizLike | null | undefined): string {
  const speed = Number.isFinite(Number(s?.speed)) ? Number(s?.speed) : 1;
  const d = DENSITIES.find((x) => x.id === s?.particleDensity) ?? DENSITIES[1];
  return `${speedText(speed)} · ${d.label}`;
}

export function comfortStatus(frameRate: unknown, paused: boolean): string {
  if (paused) return 'paused';
  return frameRateOf(frameRate) === 'cooler' ? '~20 fps' : '30 fps';
}

/** The sheet's subtitle: the Car screen first, then a pause that holds, then where the changes show. */
export function visualsSubtitle(o: { car: boolean; userPaused: boolean; pausedNow: boolean; panel: boolean }): string {
  if (o.car) return 'The Car screen keeps the visuals off.';
  if (o.userPaused && o.pausedNow) return PAUSED_SUMMARY;
  return o.panel ? 'Changes show beside this panel as you make them' : 'Changes show above as you make them';
}

// ---------------------------------------------------------------------------------------------------------------
// The slider throttle
// ---------------------------------------------------------------------------------------------------------------

/**
 * Every visual-setting change restarts the Visualizer's render loop, and the restart's first frame skips its 30 fps
 * limiter (Visualizer.tsx, untouchable): a drag that writes on every input pushes it past its cap (36.3 draws/s
 * measured). So a slider writes at most once per `ms` while it moves (the first value at once, the latest at the end
 * of each window), and its final value on release (`flush`). `cancel` drops anything pending for good (unmount, after a
 * last flush). The readout follows the finger from the slider's own state meanwhile.
 */
export interface Throttle<T> {
  push(v: T): void;
  flush(): void;
  cancel(): void;
}

export interface ThrottleClock {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realClock: ThrottleClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * A drag's write interval. decisions.md: the drag is gated at ≤ 31 draws/s, writes at most one per 250 ms. Measured
 * (v16.4): at 250 ms (4 a second) each write's restart frame lifted a finger drag to 31–32 draws/s on the dev server
 * (median 31.1–31.9) and to the gate's edge on the production build (median 31.0, max 32.0); at 333 ms (3 a second)
 * the same drag held 30–30.2. So 333: still at most one per 250 ms, inside the gate with room.
 */
export const SLIDER_WRITE_MS = 333;

export function makeThrottle<T>(write: (v: T) => void, ms: number = SLIDER_WRITE_MS, clock: ThrottleClock = realClock): Throttle<T> {
  let last = -Infinity;
  let pending: { v: T } | null = null;
  let timer: unknown = null;
  let dead = false;
  const emit = () => {
    if (!pending || dead) return;
    const v = pending.v;
    pending = null;
    last = clock.now();
    write(v);
  };
  const onTimer = () => {
    timer = null;
    emit();
  };
  return {
    push(v: T) {
      if (dead) return;
      const now = clock.now();
      if (timer === null && now - last >= ms) {
        pending = null;
        last = now;
        write(v);
        return;
      }
      pending = { v };
      if (timer === null) timer = clock.set(onTimer, Math.max(0, ms - (now - last)));
    },
    flush() {
      if (timer !== null) {
        clock.clear(timer);
        timer = null;
      }
      emit();
    },
    cancel() {
      dead = true;
      if (timer !== null) clock.clear(timer);
      timer = null;
      pending = null;
    },
  };
}
