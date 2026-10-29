// utils/library/scanScores.ts (v16.3, from the v16.2 spec's design, decision 4 A; v16.5 imports it too)
//
// ONE definition of Deep Scan's experimental scores: their names, notes and cut-offs, and how to read them off a
// track. v16.3's builder (the "experimental group" of filters) and v16.5's Advanced (the Library row badges and Track
// info's section) both read this module, so the words and the numbers cannot drift apart.
//
// The cut-offs are the ones the new layout already shows (decision 4 A): the Golden mix's "over 30 %" (utils/mix
// catalog and recipes) and the Library diagnostics readout's golden 30 %, 111 20 %, DNA 30 % (App's
// showPlaylistDiagnostics, which v16.1 brings into the new layout). Classic's own row badges (70 / 50 / 60 %) stay as they
// are in classic. Every cut-off is "over" (exclusive), as every shipped one reads.
//
// None of these is a measurement: Deep Scan's spectrum aliases (memory: the detector artefact), and the sacred geometry
// score rewards noise. The words say so. Free of React and of the app's state; no word here may read as a style name
// (tailwind.config.js scans utils/).

import type { FacetDef, FilterSong } from './filterModel.ts';

/** What the scores read of a track (types.ts Song). */
export interface ScoreSong extends FilterSong {
  fractalAnalysis?: unknown;
  isAetheriaCandidate?: boolean;
}

export type ScanScoreId = 'golden' | 'p111' | 'dna' | 'geometry' | 'schumann' | 'candidate';

export interface ScanScoreDef {
  id: ScanScoreId;
  /** The score's name everywhere: filters, badges, Track info. */
  name: string;
  /** A badge's short text ("Φ"). */
  short: string;
  /** A one-line caution, where the name alone would mislead. */
  note?: string;
  /** A track "has" the score above this (exclusive); null: no cut-off (shown in Track info only, never filtered). */
  over: number | null;
  /** 0..1 (a yes/no reading is 1 or 0); null with no Deep Scan reading. */
  read: (s: ScoreSong) => number | null;
}

const field = (s: ScoreSong, k: string): number | null => {
  const fa = s.fractalAnalysis;
  if (!fa || typeof fa !== 'object') return null;
  const v = (fa as Record<string, unknown>)[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export const SCAN_SCORES: readonly ScanScoreDef[] = [
  { id: 'golden', name: 'Golden ratio score', short: 'Φ', over: 0.3, read: (s) => field(s, 'goldenRatioAlignment') },
  { id: 'p111', name: '111 pattern score', short: '111', over: 0.2, read: (s) => field(s, 'pattern111Presence') },
  { id: 'dna', name: 'DNA resonance score', short: 'DNA', note: 'A name for a score, not a biological measure.', over: 0.3, read: (s) => field(s, 'dnaResonanceScore') },
  { id: 'geometry', name: 'Sacred geometry score', short: 'Geometry', note: 'Higher for noisy sound than for pure tones.', over: null, read: (s) => field(s, 'sacredGeometryAlignment') },
  { id: 'schumann', name: 'Schumann harmony score', short: 'Schumann', over: null, read: (s) => field(s, 'schumannResonanceHarmony') },
  {
    id: 'candidate',
    name: 'Aetheria number',
    short: 'Aetheria',
    note: "Deep Scan's reading is a multiple of 3 between 150 and 6500 Hz whose digits sum to 3, 6 or 9.",
    over: 0.5,
    read: (s) => (typeof s.isAetheriaCandidate === 'boolean' ? (s.isAetheriaCandidate ? 1 : 0) : null),
  },
];

/** The lead line wherever the scores show (v16.5's Track info section; v16.3's experimental group). */
export const SCAN_SCORES_LEAD = "Scores from Deep Scan's reading of the spectrum, which is not a pitch measurement. Not evidence of any effect.";

/** "Golden ratio score over 30 %", "Aetheria number". */
export function scoreChipText(d: ScanScoreDef): string {
  if (d.id === 'candidate' || d.over === null) return d.name;
  return `${d.name} over ${Math.round(d.over * 100)} %`;
}
/** A track has the score (over the cut-off); null without a reading or a cut-off. */
export function hasScore(d: ScanScoreDef, s: ScoreSong): boolean | null {
  const v = d.read(s);
  if (v === null || d.over === null) return null;
  return v > d.over;
}

/** v16.3's experimental group, as filter facets: one per score with a cut-off, each with one chip ("over"). */
export const EXPERIMENTAL_FACETS: readonly FacetDef<ScoreSong>[] = SCAN_SCORES.filter((d) => d.over !== null).map((d) => ({
  id: `x-${d.id}`,
  values: ['over', 'under', 'none'],
  hidden: ['under', 'none'],
  valueOf: (s: ScoreSong) => {
    const h = hasScore(d, s);
    return h === null ? 2 : h ? 0 : 1;
  },
}));
