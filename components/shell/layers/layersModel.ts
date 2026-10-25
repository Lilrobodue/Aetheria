// components/shell/layers/layersModel.ts (v15.6, the Layers tab)
//
// The Layers tab's pure rules and words: the five sections, the experience filter for the crystals (decision 11 of
// the plan: optional, off by default, its ceilings the select's own words), what each engine actually plays for the
// crystal (the neutral answer to "is this crystal too high for me?"), the comfort lines, the beat bands, the section
// statuses, and the Undo toast's words for the tone lowering. Every helper is total (NaN, ±Infinity, negatives and
// unknown levels give a string or a safe number). Node checks it directly (layersModel.check.ts, `npm run check:shell`):
// erasable TypeScript, imports with their .ts extension.

import { formatTime } from '../shellModel.ts';
import type { CrystalSection } from '../shellModel.ts';
import { formatDb, gainToDb, sliderGain, TONE_SLIDER_DEFAULT } from '../../../utils/soundV2/layerHost.ts';
import { GAMMA_DESCRIPTION_V2 } from '../../layers/layerCopy.ts';

// ---------------------------------------------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------------------------------------------

export type LayersSection = 'sound' | 'crystal' | 'levels' | 'beat' | 'advanced';

/** The five sections, in the plan's order: the jump row's chips and the page's cards. */
export const LAYERS_SECTIONS: ReadonlyArray<{ id: LayersSection; title: string }> = [
  { id: 'sound', title: 'Sound' },
  { id: 'crystal', title: 'Crystal' },
  { id: 'levels', title: 'Levels' },
  { id: 'beat', title: 'Beat' },
  { id: 'advanced', title: 'Advanced' },
];

/** The card's DOM id and its h2's (the jump row scrolls to the one and focuses the other). */
export const sectionId = (s: LayersSection): string => `layers-sec-${s}`;
export const headingId = (s: LayersSection): string => `layers-h-${s}`;

/**
 * The jump row's current section, from each card's top (px from the scroller's top edge, in page order) and the
 * scroller's height: the last card whose top lies in the upper 40 % (so a card counts as soon as it fills the top of
 * the page, and a short last card still counts at the end of the page); the first when none does.
 */
export function currentSectionIndex(tops: ReadonlyArray<number>, height: number): number {
  const band = (Number.isFinite(height) && height > 0 ? height : 0) * 0.4;
  let at = 0;
  for (let i = 0; i < tops.length; i++) if (Number.isFinite(tops[i]) && tops[i] <= band) at = i;
  return at;
}

// ---------------------------------------------------------------------------------------------------------------
// The experience filter (Advanced)
// ---------------------------------------------------------------------------------------------------------------

/** Saved from the switch's tap only (and "Show all"); unset = off, so the new layout shows all 27 unless asked. */
export const CRYSTAL_FILTER_KEY = 'aetheria.crystalFilter.v1';

/** The saved switch: exactly 'true' is on; anything else (unset, junk) is off. */
export function parseCrystalFilter(raw: string | null | undefined): boolean {
  return raw === 'true';
}

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/** The select's options (neutral words; the ceilings are the Hz these labels name, as the Frequency Lab filters). */
export const EXPERIENCE_LEVELS: ReadonlyArray<{ id: ExperienceLevel; name: string; label: string }> = [
  { id: 'beginner', name: 'Beginner', label: 'Beginner · up to 963 Hz' },
  { id: 'intermediate', name: 'Intermediate', label: 'Intermediate · up to 2,000 Hz' },
  { id: 'advanced', name: 'Advanced', label: 'Advanced · up to 5,000 Hz' },
  { id: 'expert', name: 'Expert', label: 'Expert · all 27' },
];

/** The highest crystal a level shows. Anything unknown is the most careful level's (963 Hz). */
export function crystalCeiling(level: unknown): number {
  switch (level) {
    case 'intermediate':
      return 2000;
    case 'advanced':
      return 5000;
    case 'expert':
      return Infinity;
    default:
      return 963;
  }
}

/** The level's name for the filter note ("Intermediate"); unknown → "Beginner", as the ceiling. */
export function levelName(level: unknown): string {
  return EXPERIENCE_LEVELS.find((l) => l.id === level)?.name ?? 'Beginner';
}

export interface FilteredCrystals {
  sections: CrystalSection[];
  /** Cells shown (the kept ones beyond the ceiling included). */
  shown: number;
  /** Cells in all (27). */
  total: number;
}

/**
 * The crystal grid under the experience filter: the cells up to the level's ceiling, plus any cell whose number is in
 * `keepHz` (the playing crystal and the track's own always show). Off: every cell. A regime left empty disappears.
 */
export function filterCrystals(sections: readonly CrystalSection[], on: boolean, level: unknown, keepHz: ReadonlyArray<number | null>): FilteredCrystals {
  const total = sections.reduce((n, s) => n + s.cells.length, 0);
  if (!on) return { sections: sections.slice(), shown: total, total };
  const ceiling = crystalCeiling(level);
  const keep = new Set(keepHz.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)));
  const out: CrystalSection[] = [];
  let shown = 0;
  for (const s of sections) {
    const cells = s.cells.filter((c) => c.raw <= ceiling || keep.has(c.hz));
    if (cells.length === 0) continue;
    shown += cells.length;
    out.push({ ...s, cells });
  }
  return { sections: out, shown, total };
}

/** "Showing 13 of 27 · experience filter: Intermediate" (the Show all button follows it). */
export function filterNote(shown: number, total: number, level: unknown): string {
  const n = (x: number) => (Number.isFinite(x) && x >= 0 ? String(Math.round(x)) : '0');
  return `Showing ${n(shown)} of ${n(total)} · experience filter: ${levelName(level)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The crystal: what each engine actually plays
// ---------------------------------------------------------------------------------------------------------------

/** One decimal at most, no trailing zero: 724.5, 615, 62.2. */
const hz1 = (x: number): string => String(Math.round(x * 10) / 10);

/**
 * The tile's line: what is heard for the crystal. v2 folds every crystal into an audible tone (`heardHz`, the player's
 * own tone); classic plays crystals up to 639 Hz at pitch and the higher ones as a low hum (its solfeggioHz). 'off':
 * Music only, or v2's Car fallback.
 */
export function heardLine(mode: 'v2' | 'classic' | 'off', crystalHz: number, heardHz: number | null): string {
  if (mode === 'off') return 'The layers are off.';
  const heard = typeof heardHz === 'number' && Number.isFinite(heardHz) && heardHz > 0 ? heardHz : null;
  if (mode === 'v2') return heard === null ? 'v2 plays it as a tone under the music.' : `v2 plays it as a ${hz1(heard)} Hz tone under the music.`;
  if (heard === null) return 'Classic plays it under the music.';
  if (Number.isFinite(crystalHz) && Math.abs(heard - crystalHz) < 0.05) return `Classic plays it at ${hz1(heard)} Hz.`;
  return `Classic plays it as a ${Math.round(heard)} Hz hum.`;
}

/** The Crystal card's status: "528 Hz playing" / "528 Hz selected" (silent). */
export function crystalStatus(hz: number, sounding: boolean): string {
  const n = Number.isFinite(hz) ? String(hz) : '—';
  return `${n} Hz ${sounding ? 'playing' : 'selected'}`;
}

/** Under the tile: the track's own crystal, when there is one. */
export function trackCrystalLine(trackHz: number | null, crystalHz: number): string | null {
  if (trackHz === null || !Number.isFinite(trackHz)) return null;
  return trackHz === crystalHz ? "This is the track's own crystal." : `This track's crystal is ${trackHz} Hz.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Comfort guidance (in place of the auto-opening Safety panel; neutral, where the controls are)
// ---------------------------------------------------------------------------------------------------------------

export const COMFORT_LEVELS = 'Keep the layers comfortable. If anything feels unpleasant, lower them or turn on Music only.';
export const COMFORT_CRYSTAL_V2 =
  'v2 plays every crystal as an audible tone between 150 and 1,000 Hz under the music; high crystals sound an octave or ' +
  'more lower. Keep the layers comfortable; Music only turns them off.';
export const COMFORT_CRYSTAL_CLASSIC =
  'Classic plays crystals up to 639 Hz at pitch and higher ones as a low hum under the music. Keep the layers ' +
  'comfortable; Music only turns them off.';

/** The comfort line under the crystal grid, for the engine that plays the layers. */
export function crystalComfortLine(v2: boolean): string {
  return v2 ? COMFORT_CRYSTAL_V2 : COMFORT_CRYSTAL_CLASSIC;
}

/**
 * The Undo toast after the high-frequency check lowered the tone for the track (same trigger and amount as before; the
 * level comes back at the next track unless the user has set it since, App's toneLoweringRef). It names no frequency:
 * the trigger is an unreliable reading. Classic in %, v2 in dB on its validated level (layerCopy's formatDb).
 */
export function toneLoweredText(v2: boolean, before: number, after: number): string {
  if (v2) {
    const db = (v: number): string => {
      const g = gainToDb(sliderGain(v, TONE_SLIDER_DEFAULT));
      return g === null ? 'off' : formatDb(g);
    };
    return `Tone level lowered from ${db(before)} to ${db(after)} for this track.`;
  }
  const pct = (v: number): string => (Number.isFinite(v) ? `${Math.max(0, Math.round(v * 100))} %` : '—');
  return `Tone level lowered from ${pct(before)} to ${pct(after)} for this track.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Beat
// ---------------------------------------------------------------------------------------------------------------

/** The five presets (constants.ts BINAURAL_PRESETS' names and beats), in neutral words: no benefit claims. */
export const BEAT_BANDS: ReadonlyArray<{ name: string; delta: number; range: string }> = [
  { name: 'Delta', delta: 2, range: 'The 0.5–4 Hz band' },
  { name: 'Theta', delta: 6, range: 'The 4–8 Hz band' },
  { name: 'Alpha', delta: 10, range: 'The 8–13 Hz band' },
  { name: 'Beta', delta: 20, range: 'The 13–30 Hz band' },
  { name: 'Gamma', delta: 40, range: 'The band above 30 Hz' },
];

/** A band row's subtitle: its range (v2's Gamma: the existing design-choice note), " · now" on the band delivered. */
export function bandSubtitle(name: string, v2: boolean, now: boolean): string {
  const band = BEAT_BANDS.find((b) => b.name === name);
  const base = v2 && name === 'Gamma' ? GAMMA_DESCRIPTION_V2 : (band?.range ?? '');
  return now ? `${base} · now` : base;
}

/** The Beat card's status: the beat actually delivered (the chip's words), after "Adaptive · " while it is on. */
export function beatStatus(adaptive: boolean, beatText: string): string {
  const text = typeof beatText === 'string' ? beatText : '—';
  return adaptive ? `Adaptive · ${text}` : text;
}

// ---------------------------------------------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------------------------------------------

export const PHI_CLASSIC_LINE = 'Volume ratios 1.0 : 0.618 : 0.382. Binaural phase: 137.5° golden-angle offset.';
/** Classic's φ envelope (utils/phiIntegration.ts getPhiIntensityMultiplier), in the points its line names: full (1.0)
 *  at 38.2 %, a step down to 0.8, full again at 61.8 %, about 0.8 at the end. layersModel.check.ts checks them against
 *  the function itself. */
export const TRACK_SHAPE_CLASSIC_POINTS = { firstFullAt: 0.382, stepTo: 0.8, fullAgainAt: 0.618, endsAt: 0.8 } as const;
export const TRACK_SHAPE_CLASSIC_LINE =
  'The layers rise from silence to full at 38.2%, step down to 0.8 and climb back to full at 61.8%, then ease to about 0.8 at the end.';
export const NEEDS_PHI = 'Needs φ integration';

/** "This track peaks at 2:00 (61.8 %)."; null without a track length. */
export function trackPeakLine(peakS: number | null): string | null {
  if (typeof peakS !== 'number' || !Number.isFinite(peakS) || peakS <= 0) return null;
  return `This track peaks at ${formatTime(peakS)} (61.8 %).`;
}

/** The Advanced card's status. */
export function advancedStatus(phiMode: boolean): string {
  return phiMode ? 'φ on' : 'φ off';
}
