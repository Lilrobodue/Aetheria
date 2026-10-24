// components/shell/shellModel.ts (v15.5, the new layout beta)
//
// The new layout's pure rules: which layout opens, the words the views show (the play order's source line, the
// time, the φ phase, the Car screen's line, the library summary), and the crystal grid. Free of app imports, so Node
// checks it directly (shellModel.check.ts: `npm run check:shell`, type stripping, no build step).

/** The saved layout choice. Written only by a tap (the opt-in, Back to classic, the crash fallback) or ?layout=. */
export const LAYOUT_KEY = 'aetheria.layout.v1';

export type LayoutPref = 'classic' | 'new';
export type ShellTab = 'now' | 'library' | 'mixes' | 'layers' | 'more';
export type ShellSheet = 'sound' | 'crystal' | 'walks' | 'menu';
/** The classic panel a stub "peeks" into (decision 4). */
export type PeekPanel = 'library' | 'mixes' | 'sound';

export function isLayoutPref(v: unknown): v is LayoutPref {
  return v === 'new' || v === 'classic';
}

/**
 * The layout to open with. A valid `?layout=` beats the saved choice; a missing or invalid value of either means
 * classic (the default), so nothing but 'new' ever opens the beta.
 */
export function parseLayoutPref(stored: string | null | undefined, query: string | null | undefined): LayoutPref {
  if (isLayoutPref(query)) return query;
  if (isLayoutPref(stored)) return stored;
  return 'classic';
}

export const TABS: ReadonlyArray<{ id: ShellTab; label: string; short: string }> = [
  { id: 'now', label: 'Now Playing', short: 'Playing' },
  { id: 'library', label: 'Library', short: 'Library' },
  { id: 'mixes', label: 'Mixes', short: 'Mixes' },
  { id: 'layers', label: 'Layers', short: 'Layers' },
  { id: 'more', label: 'More', short: 'More' },
];

// ---------------------------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------------------------

/** "1:12", "1:02:03"; anything not a finite, positive number is "0:00". */
export function formatTime(s: number): string {
  const total = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** A library's total length: "2 h 14 min", "14 min", "45 s". */
export function formatTotal(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** The φ marks on the seek bar (App's INV_PHI_SQUARED and INV_PHI). */
export const PHI_BUILD_END = 0.3819660112501051;
export const PHI_PEAK = 0.6180339887498949;

/** The φ phase word, as classic's badge: Build to 38.2 %, Peak to 61.8 %, then Resolve. Null without a duration. */
export function phiPhase(t: number, d: number): 'Build' | 'Peak' | 'Resolve' | null {
  if (!(d > 0) || !Number.isFinite(t)) return null;
  const p = t / d;
  if (p <= PHI_BUILD_END) return 'Build';
  if (p <= PHI_PEAK) return 'Peak';
  return 'Resolve';
}

// ---------------------------------------------------------------------------------------------------------------
// Where the play order comes from
// ---------------------------------------------------------------------------------------------------------------

/** The segments of the multi-part walks, in play order (as classic's walk-progress chip names them). */
const WALK_SEGMENT_NAMES: Readonly<Record<string, readonly string[]>> = {
  combined: ['Vortex', 'Ascent', 'Pillar'],
  cabi: ['Vortex', 'Ascent', 'Pillar', 'Ouroboros'],
};

/** "Ascent 4/27" for the track at `index` of a multi-part walk (CAB, CABI); null for a single walk or bad counts. */
export function walkSegment(mode: string | null, segments: readonly number[] | null, index: number): string | null {
  const names = mode ? WALK_SEGMENT_NAMES[mode] : undefined;
  if (!names || !segments || segments.length !== names.length || index < 0) return null;
  let start = 0;
  for (let i = 0; i < segments.length; i++) {
    if (index < start + segments[i]) return `${names[i]} ${index - start + 1}/${segments[i]}`;
    start += segments[i];
  }
  return null;
}

/**
 * The source line over the title. A walk: "Lo Shu walk · Vortex · step 3 of 27" (+ " · Ascent 4/27" in a CAB or
 * CABI, + its phase token at a SOURCE crossing); the library in its own order: "Library · 12 of 28"; anything else
 * (a mix, a filter, a shuffle of part of it): "Play order · 4 of 30". With nothing loaded it gives the count.
 */
export function sourceLine(
  walkName: string | null,
  sameOrder: boolean,
  index: number,
  count: number,
  segment?: string | null,
  phase?: string | null
): string {
  const at = index >= 0 && index < count ? index + 1 : 0;
  if (walkName) {
    let line = `Lo Shu walk · ${walkName}`;
    if (at) line += ` · step ${at} of ${count}`;
    if (segment) line += ` · ${segment}`;
    if (phase) line += ` · ${phase}`;
    return line;
  }
  const head = sameOrder ? 'Library' : 'Play order';
  if (count <= 0) return sameOrder ? 'Library · no tracks yet' : 'Play order · empty';
  if (at) return `${head} · ${at} of ${count}`;
  return `${head} · ${count} track${count === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Crystals
// ---------------------------------------------------------------------------------------------------------------

export type Regime = 'gut' | 'perfect' | 'heart' | 'source' | 'head';

/** The 27 crystals (constants.ts SOLFEGGIO_INFO's frequencies), ascending, per regime. */
export const CRYSTALS: Readonly<Record<'gut' | 'heart' | 'head', readonly number[]>> = {
  gut: [174, 285, 396, 417, 528, 639, 741, 852, 963],
  heart: [1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150],
  head: [3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336],
};

/** Lo Shu Perfect GUT (App.tsx LO_SHU_PERFECT_MAP): the GUT crystals' 111 Hz-family twins. 741/852/963 are both. */
export const PERFECT_GUT_MAP: Readonly<Record<number, number>> = { 174: 75, 285: 186, 396: 297, 417: 408, 528: 519, 639: 630 };
const PERFECT_VALUES = new Set<number>([111, 75, 186, 297, 408, 519, 630]);

/** What a crystal plays as (App's applyLoShuPerfectMap). */
export function perfectMap(hz: number, perfectGut: boolean): number {
  return perfectGut ? (PERFECT_GUT_MAP[hz] ?? hz) : hz;
}

/**
 * A frequency's regime, as the app colours it: GUT to 963 Hz, HEART to 3150, HEAD above (App.tsx getFrequencyRegime),
 * with the two specials of the palette: 2178 Hz is the SOURCE centre, and 111 Hz and the Perfect GUT twins are the
 * 111 Hz family (Perfect).
 */
export function regimeOf(hz: number): Regime {
  if (hz === 2178) return 'source';
  if (PERFECT_VALUES.has(hz)) return 'perfect';
  if (hz <= 963) return 'gut';
  if (hz <= 3150) return 'heart';
  return 'head';
}

/** The regime's name, as the chips say it. */
export function regimeName(r: Regime): string {
  return r === 'gut' || r === 'perfect' ? 'GUT' : r === 'heart' ? 'HEART' : r === 'source' ? 'SOURCE' : 'HEAD';
}

/** The regime's dot (complete literals: tailwind.config.js scans this file). Colour on a dot or a bar, never on text. */
export const REGIME_DOT: Readonly<Record<Regime, string>> = {
  gut: 'bg-regime-gut',
  perfect: 'bg-regime-perfect',
  heart: 'bg-regime-heart',
  source: 'bg-regime-source',
  head: 'bg-regime-head',
};

export interface CrystalCell {
  /** The crystal's own frequency (what selectFrequency takes). */
  raw: number;
  /** What it plays as, and the number the cell shows. */
  hz: number;
}

export interface CrystalSection {
  regime: 'gut' | 'heart' | 'head';
  name: string;
  range: string;
  cells: CrystalCell[];
}

/** The Crystal sheet's three sections of nine, ascending, each cell's number with Perfect GUT applied. */
export function crystalSections(perfectGut: boolean): CrystalSection[] {
  return (['gut', 'heart', 'head'] as const).map((regime) => {
    const cells = CRYSTALS[regime].map((raw) => ({ raw, hz: perfectMap(raw, perfectGut) }));
    const shown = cells.map((c) => c.hz);
    return {
      regime,
      name: regimeName(regime),
      range: `${Math.min(...shown)}–${Math.max(...shown)} Hz`,
      cells,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The Car screen
// ---------------------------------------------------------------------------------------------------------------

/**
 * The Car screen's one line about the layers. Music only first (no layers in either engine); classic has no Car
 * render; v2's failure fallback plays no layers; v2 plays a quiet tone for the crystal (heard folded into 150–1000 Hz,
 * toneOf: so the line names the crystal, not a tone pitch) and no beat.
 */
export function carLine(engine: 'v2' | 'classic', v2Failed: boolean, hz: number, musicOnly: boolean): string {
  if (musicOnly) return 'Only the music · Music only is on';
  if (engine !== 'v2') return 'Classic layers ignore Car output';
  if (v2Failed) return 'Only the music · the layers are off';
  return `Music and a quiet tone for the ${hz} Hz crystal · no beat`;
}
