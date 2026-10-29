// utils/library/filterModel.ts (v16.2, smart filters)
//
// The Library's smart filters as a pure model: the facets (what each track is, by one value per facet), one pass that
// gives the matching tracks AND every chip's count, the saved form (aetheria.libraryFilters.v1) and the words. Free of
// React and of the app's state; Node checks it directly (filterModel.check.ts, npm run check:filters). It never writes
// anything: a filter narrows what the Library SHOWS, never the library (check:writers rule 2 keeps it away from the
// library's storage).
//
// The rule (the plan's): OR within a facet, AND across facets, and the text (the Library's own search field) on top.
// A chip's count is how many tracks would show if that chip's facet were cleared and everything else stayed: the usual
// faceted-search count, so a count never reads 0 only because a sibling chip is not picked, and the counts of a facet's
// picked chips add up to the tracks shown.
//
// Cost: buildFacetIndex is O(n x facets), once per library change or sort (the list's memo); filterPass is O(n x facets)
// per chip tap or (deferred) keystroke, on small typed arrays, with no allocation per track but the results array.
//
// v16.3's builder uses the same API on any set of tracks (the library, a playlist's tracks, the queue) and adds its
// experimental facets (utils/library/scanScores.ts) to the list: a facet is data (FacetDef), not code here.
// No word in these comments may read as a style name: tailwind.config.js scans utils/.

import { ALL_CRYSTALS, crystalOrigin } from '../mix/distribution.ts';
import type { CrystalSource } from '../mix/distribution.ts';
import { GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS } from '../crystalData.ts';
import { CHROMA_VERSION } from '../soundV2/keyAnalysis.ts';
import { CLARITY_HI, CLARITY_LO } from '../soundV2/aetheria_sound_v2.ts';

/** What the filters read of a track (types.ts Song, or the Library tab's LibSong). */
export interface FilterSong {
  id: string;
  name: string;
  duration?: number;
  harmonicFreq?: number;
  closestSolfeggio?: number;
  harmonicDeviation?: number;
  fractalAnalysis?: unknown;
  isAetheriaCandidate?: boolean;
  crystalSource?: CrystalSource;
  bandEnvelope?: { bass?: { length: number } } | null;
  visualEnvelope?: { bass?: { length: number } } | null;
  musicKey?: string;
  keyConfidence?: number;
  chromaVersion?: number;
  analysisFailedV?: number;
}

/** A facet: every value a track can take (it takes exactly one), the ones no chip offers, and the rule. */
export interface FacetDef<S = FilterSong> {
  id: string;
  values: readonly string[];
  /** Values with no chip: a track holding one never matches while the facet is active. */
  hidden: readonly string[];
  valueOf: (s: S) => number;
}

// ---------------------------------------------------------------------------------------------------------------
// The facets
// ---------------------------------------------------------------------------------------------------------------

/** Assigned crystal: the 27 (ascending), then no crystal, then a stored number outside the 27 (no chip; old data). */
const CRYSTAL_VALUES: readonly string[] = [...ALL_CRYSTALS.map(String), 'none', 'other'];
const CRYSTAL_INDEX = new Map<number, number>(ALL_CRYSTALS.map((c, i) => [c, i]));
const C_NONE = ALL_CRYSTALS.length;
const C_OTHER = C_NONE + 1;
/** A crystal is a finite number above 0 (the row's crystalText rule); anything else is "No crystal". */
export function crystalValue(s: FilterSong): number {
  const c = s.closestSolfeggio;
  if (typeof c !== 'number' || !Number.isFinite(c) || !(c > 0)) return C_NONE;
  return CRYSTAL_INDEX.get(c) ?? C_OTHER;
}

/** Length buckets, in seconds: under 3 min, 3 to 5, 5 to 10, 10 and over (decision 3 A), then "not read yet". */
export const LENGTH_EDGES: readonly number[] = [180, 300, 600];
const LENGTH_VALUES: readonly string[] = ['lt3', '3to5', '5to10', 'ge10', 'unknown'];
export function lengthValue(s: FilterSong): number {
  const d = s.duration;
  if (typeof d !== 'number' || !Number.isFinite(d) || !(d > 0)) return LENGTH_EDGES.length + 1;
  let i = 0;
  while (i < LENGTH_EDGES.length && d >= LENGTH_EDGES[i]) i++;
  return i;
}

/** Deep Scan: measured (its crystal, or one an older Auto-Distribute replaced), not measured, or it couldn't read it. */
const SCAN_VALUES: readonly string[] = ['scanned', 'unscanned', 'failed'];
export function scanValue(s: FilterSong): number {
  const o = crystalOrigin(s);
  return o === 'scan' || o === 'scan-replaced' ? 0 : o === 'scan-failed' ? 2 : 1;
}

/** Visual sync: a band envelope from Deep Scan or from Analyse tracks (Track info's rule, analysePass.hasEnvelope). */
const SYNC_VALUES: readonly string[] = ['yes', 'no'];
const hasBass = (e: FilterSong['bandEnvelope']) => (e?.bass?.length ?? 0) > 0;
export function syncValue(s: FilterSong): number {
  return hasBass(s.bandEnvelope) || hasBass(s.visualEnvelope) ? 0 : 1;
}

/** Key: the 24 keys (sharps, as the analyser names them: C..B, then Cm..Bm), then analysed with no clear key, not
 *  analysed yet, and couldn't be read. The order is Track info's: analysed first, then failed, else not analysed. */
const PITCHES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const KEY_VALUES: readonly string[] = [...PITCHES, ...PITCHES.map((p) => `${p}m`), 'noclear', 'unanalysed', 'failed'];
const LETTER: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'A#m' → 21, 'Bbm' → 22 … ; anything else (including '') → -1. */
export function keyIndex(k: unknown): number {
  if (typeof k !== 'string') return -1;
  const m = /^([A-G])(#|♯|b|♭)?(m)?$/.exec(k.trim());
  if (!m) return -1;
  const semi = (LETTER[m[1]] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? 11 : 0)) % 12;
  return semi + (m[3] ? 12 : 0);
}
export function keyValue(s: FilterSong): number {
  if (s.chromaVersion === CHROMA_VERSION) {
    const k = keyIndex(s.musicKey);
    return k >= 0 ? k : 24;
  }
  return s.analysisFailedV === CHROMA_VERSION ? 26 : 25;
}

/** Key confidence, at Key fit's own edges (CLARITY_LO 0.45, CLARITY_HI 0.75): Key fit acts fully from 0.75, partly
 *  between, not under 0.45. "na": not analysed, or no confidence stored (no chip). */
const CONF_VALUES: readonly string[] = ['strong', 'partial', 'weak', 'na'];
export function confidenceValue(s: FilterSong): number {
  const c = s.keyConfidence;
  if (s.chromaVersion !== CHROMA_VERSION || typeof c !== 'number' || !Number.isFinite(c)) return 3;
  return c >= CLARITY_HI ? 0 : c >= CLARITY_LO ? 1 : 2;
}

export type LibraryFacetId = 'crystal' | 'length' | 'scan' | 'sync' | 'key' | 'confidence';

/** The Library's facets, in the filter sheet's order. */
export const LIBRARY_FACETS: readonly FacetDef<FilterSong>[] = [
  { id: 'crystal', values: CRYSTAL_VALUES, hidden: ['other'], valueOf: crystalValue },
  { id: 'length', values: LENGTH_VALUES, hidden: [], valueOf: lengthValue },
  { id: 'scan', values: SCAN_VALUES, hidden: [], valueOf: scanValue },
  { id: 'sync', values: SYNC_VALUES, hidden: [], valueOf: syncValue },
  { id: 'key', values: KEY_VALUES, hidden: [], valueOf: keyValue },
  { id: 'confidence', values: CONF_VALUES, hidden: ['na'], valueOf: confidenceValue },
];

/** The regimes, as groups of the crystal facet: a regime chip picks (or drops) its nine crystals. */
export const REGIMES: ReadonlyArray<{ id: 'gut' | 'heart' | 'head'; name: string; crystals: readonly number[] }> = [
  { id: 'gut', name: 'GUT', crystals: GUT_CRYSTALS },
  { id: 'heart', name: 'HEART', crystals: HEART_CRYSTALS },
  { id: 'head', name: 'HEAD', crystals: HEAD_CRYSTALS },
];

// ---------------------------------------------------------------------------------------------------------------
// The filters (what is picked): facet id → picked values, each list in the facet's own order, no empty lists
// ---------------------------------------------------------------------------------------------------------------

export type Filters = Readonly<Record<string, readonly string[]>>;
export const NO_FILTERS: Filters = Object.freeze({}) as Filters;

const facetOf = (facets: readonly FacetDef<any>[], id: string) => facets.find((f) => f.id === id);
const ordered = (facet: FacetDef<any>, vals: Iterable<string>): string[] => {
  const want = new Set(vals);
  return facet.values.filter((v) => want.has(v) && !facet.hidden.includes(v));
};

/** A new Filters with `values` as the facet's pick (unknown and hidden values dropped; empty removes the facet). */
export function withFacet(f: Filters, id: string, values: Iterable<string>, facets: readonly FacetDef<any>[] = LIBRARY_FACETS): Filters {
  const facet = facetOf(facets, id);
  if (!facet) return f;
  const out: Record<string, readonly string[]> = {};
  for (const k of Object.keys(f)) if (k !== id) out[k] = f[k];
  const v = ordered(facet, values);
  if (v.length) out[id] = v;
  return out;
}
/** A chip's tap: picked → not, not → picked. */
export function toggleValue(f: Filters, id: string, value: string, facets: readonly FacetDef<any>[] = LIBRARY_FACETS): Filters {
  const cur = f[id] ?? [];
  return withFacet(f, id, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value], facets);
}
/** A regime chip's tap: all nine picked → none of them; else all nine (the others' picks stay). */
export function toggleRegime(f: Filters, regime: 'gut' | 'heart' | 'head'): Filters {
  const r = REGIMES.find((x) => x.id === regime);
  if (!r) return f;
  const cur = new Set(f.crystal ?? []);
  const nine = r.crystals.map(String);
  const all = nine.every((c) => cur.has(c));
  for (const c of nine) all ? cur.delete(c) : cur.add(c);
  return withFacet(f, 'crystal', cur);
}
export function regimeState(f: Filters, regime: 'gut' | 'heart' | 'head'): 'all' | 'some' | 'none' {
  const r = REGIMES.find((x) => x.id === regime);
  const cur = new Set(f.crystal ?? []);
  const n = r ? r.crystals.filter((c) => cur.has(String(c))).length : 0;
  return n === 0 ? 'none' : r && n === r.crystals.length ? 'all' : 'some';
}
/** How many values are picked, over every facet (the Filters button's badge). */
export function pickedCount(f: Filters): number {
  let n = 0;
  for (const k of Object.keys(f)) n += f[k].length;
  return n;
}
export const filtersOn = (f: Filters): boolean => pickedCount(f) > 0;

// ---------------------------------------------------------------------------------------------------------------
// The index and the pass
// ---------------------------------------------------------------------------------------------------------------

export interface FacetIndex<S> {
  songs: readonly S[];
  facets: readonly FacetDef<S>[];
  /** songs.length × facets.length value indexes, row by row. */
  codes: Uint8Array;
  /** Each track's name in lower case (the search's own rule: libraryModel.filterLibrary). */
  lower: readonly string[];
  /** Each track's length in seconds, 0 when unknown (for the shown total). */
  seconds: Float64Array;
}

/** Once per library change or sort: every track's value per facet. O(n × facets). Duplicates stay (a playlist's). */
export function buildFacetIndex<S extends FilterSong>(songs: readonly S[], facets: readonly FacetDef<S>[] = LIBRARY_FACETS as readonly FacetDef<S>[]): FacetIndex<S> {
  const n = songs.length;
  const F = facets.length;
  const codes = new Uint8Array(n * F);
  const lower: string[] = new Array(n);
  const seconds = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = songs[i];
    for (let f = 0; f < F; f++) codes[i * F + f] = facets[f].valueOf(s);
    lower[i] = String(s.name ?? '').toLowerCase();
    const d = s.duration;
    seconds[i] = typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : 0;
  }
  return { songs, facets, codes, lower, seconds };
}

export interface FilterResult<S> {
  /** The tracks that match, in the index's order. */
  results: S[];
  /** Per facet (the index's order), per value: the tracks that would match with that facet cleared. */
  counts: readonly Int32Array[];
  /** The tracks indexed (the "of M"). */
  total: number;
  /** The matching tracks' known length, in seconds. */
  seconds: number;
}

/** The query as the search uses it: trimmed, lower case (libraryModel.normalQuery). */
export const normalText = (text: string): string => String(text ?? '').trim().toLowerCase();

/**
 * One pass: the results and every chip's count. A track failing no facet (and matching the text) shows, and counts
 * once in every facet; a track failing exactly one facet (and matching the text) counts only in that facet, for its
 * own value; a track failing two or more, or the text, counts nowhere.
 */
export function filterPass<S>(index: FacetIndex<S>, filters: Filters, text: string = ''): FilterResult<S> {
  const { songs, facets, codes, lower, seconds } = index;
  const F = facets.length;
  const n = songs.length;
  const picked: (Uint8Array | null)[] = facets.map((facet) => {
    const vals = filters[facet.id];
    if (!vals || !vals.length) return null;
    const m = new Uint8Array(facet.values.length);
    let any = false;
    for (const v of vals) {
      const k = facet.values.indexOf(v);
      if (k >= 0 && !facet.hidden.includes(v)) {
        m[k] = 1;
        any = true;
      }
    }
    return any ? m : null;
  });
  const active: number[] = [];
  for (let f = 0; f < F; f++) if (picked[f]) active.push(f);
  const counts = facets.map((facet) => new Int32Array(facet.values.length));
  const q = normalText(text);
  const results: S[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (q && !lower[i].includes(q)) continue;
    const row = i * F;
    let fails = 0;
    let failed = -1;
    for (let a = 0; a < active.length; a++) {
      const f = active[a];
      if (!(picked[f] as Uint8Array)[codes[row + f]]) {
        fails++;
        failed = f;
        if (fails > 1) break;
      }
    }
    if (fails === 0) {
      results.push(songs[i]);
      total += seconds[i];
      for (let f = 0; f < F; f++) counts[f][codes[row + f]]++;
    } else if (fails === 1) {
      counts[failed][codes[row + failed]]++;
    }
  }
  return { results, counts, total: n, seconds: total };
}

/** A chip's count from a pass ("528" in 'crystal'), 0 for an unknown one. */
export function countOf<S>(r: FilterResult<S>, facets: readonly FacetDef<any>[], id: string, value: string): number {
  const f = facets.findIndex((x) => x.id === id);
  if (f < 0) return 0;
  const k = facets[f].values.indexOf(value);
  return k < 0 ? 0 : r.counts[f][k];
}
/** A regime chip's count: its nine crystals' counts. */
export function regimeCount<S>(r: FilterResult<S>, regime: 'gut' | 'heart' | 'head'): number {
  const g = REGIMES.find((x) => x.id === regime);
  return g ? g.crystals.reduce((n, c) => n + countOf(r, LIBRARY_FACETS, 'crystal', String(c)), 0) : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Saved: aetheria.libraryFilters.v1 (localStorage; written from a chip, a chip's ×, or Clear only; the text never)
// ---------------------------------------------------------------------------------------------------------------

export const LIBRARY_FILTERS_KEY = 'aetheria.libraryFilters.v1';
const MAX_SAVED = 4096;

/** The saved string → Filters. Anything unreadable is no filters; unknown facets and values are dropped. */
export function parseFilters(raw: unknown, facets: readonly FacetDef<any>[] = LIBRARY_FACETS): Filters {
  if (typeof raw !== 'string' || raw.length > MAX_SAVED) return NO_FILTERS;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return NO_FILTERS;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || (o as { v?: unknown }).v !== 1) return NO_FILTERS;
  const picks = (o as { f?: unknown }).f;
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) return NO_FILTERS;
  let out: Filters = NO_FILTERS;
  for (const facet of facets) {
    if (!Object.prototype.hasOwnProperty.call(picks, facet.id)) continue;
    const vals = (picks as Record<string, unknown>)[facet.id];
    if (!Array.isArray(vals) || vals.length > facet.values.length) continue;
    out = withFacet(out, facet.id, vals.filter((v): v is string => typeof v === 'string'), facets);
  }
  return out;
}
/** Filters → the saved string ({"v":1,"f":{…}}), the facets in their order, the values in theirs. */
export function serializeFilters(f: Filters, facets: readonly FacetDef<any>[] = LIBRARY_FACETS): string {
  const picks: Record<string, string[]> = {};
  for (const facet of facets) {
    const v = f[facet.id] ? ordered(facet, f[facet.id]) : [];
    if (v.length) picks[facet.id] = v;
  }
  return JSON.stringify({ v: 1, f: picks });
}

// ---------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------

export const FACET_TITLES: Readonly<Record<LibraryFacetId, string>> = {
  crystal: 'Assigned crystal',
  length: 'Length',
  scan: 'Deep Scan',
  sync: 'Visual sync',
  key: 'Key',
  confidence: 'Key confidence',
};
/** The crystal group's help line (plan v14.20; memory: Deep Scan's frequency reading is an artefact). */
export const CRYSTAL_HELP = 'The crystal Deep Scan or Assign crystals gave each track. Not a measured pitch.';
export const CONFIDENCE_HELP = 'How sure the key analysis is. Key fit acts fully from 0.75, partly from 0.45, not below.';
export const NO_KEYS_YET = 'No keys yet. Analyse tracks, in the health card, finds them.';

const mins = (s: number) => `${Math.round(s / 60)} min`;
const LENGTH_LABELS: readonly string[] = [
  `Under ${mins(LENGTH_EDGES[0])}`,
  ...LENGTH_EDGES.slice(1).map((e, i) => `${Math.round(LENGTH_EDGES[i] / 60)}–${mins(e)}`),
  `${mins(LENGTH_EDGES[LENGTH_EDGES.length - 1])} or more`,
  'Length not read yet',
];
const KEY_WORDS = (v: string): string => {
  if (v === 'noclear') return 'No clear key';
  if (v === 'unanalysed') return 'Not analysed yet';
  if (v === 'failed') return "Couldn't be read";
  const minor = v.endsWith('m');
  return `${(minor ? v.slice(0, -1) : v).replace('#', '♯')} ${minor ? 'minor' : 'major'}`;
};
/** A chip's words. */
export function valueLabel(id: string, value: string): string {
  if (id === 'crystal') return value === 'none' ? 'No crystal' : value === 'other' ? 'Other' : `${value} Hz`;
  if (id === 'length') {
    const k = LENGTH_VALUES.indexOf(value);
    return k >= 0 ? LENGTH_LABELS[k] : value;
  }
  if (id === 'scan') return value === 'scanned' ? 'Scanned' : value === 'failed' ? "Couldn't read" : 'Not scanned';
  if (id === 'sync') return value === 'yes' ? 'Synced' : 'Not synced';
  if (id === 'key') return KEY_WORDS(value);
  if (id === 'confidence') return value === 'strong' ? 'Clear (0.75 and up)' : value === 'partial' ? 'Partly clear (0.45–0.75)' : value === 'weak' ? 'Unclear (under 0.45)' : 'None';
  return value;
}
/** An active chip's words: the facet named where the value alone is unclear ("Deep Scan: Not scanned"). */
export function activeLabel(id: string, value: string): string {
  const v = valueLabel(id, value);
  if (id === 'scan') return `Deep Scan: ${v.toLowerCase()}`;
  if (id === 'sync') return value === 'yes' ? 'Visual sync' : 'No visual sync';
  if (id === 'confidence') return `Key ${v.split(' (')[0].toLowerCase()}`;
  if (id === 'key' && (value === 'noclear' || value === 'unanalysed' || value === 'failed')) return value === 'noclear' ? 'No clear key' : value === 'failed' ? "Key couldn't be read" : 'Key not analysed';
  return v;
}

export interface ActiveChip {
  facet: string;
  value: string;
  label: string;
}
/** The picked values as the active-chip row shows them: a whole regime as one chip ("GUT"), then each value. */
export function activeChips(f: Filters, facets: readonly FacetDef<any>[] = LIBRARY_FACETS): ActiveChip[] {
  const out: ActiveChip[] = [];
  for (const facet of facets) {
    const vals = f[facet.id];
    if (!vals || !vals.length) continue;
    if (facet.id === 'crystal') {
      const set = new Set(vals);
      const whole = REGIMES.filter((r) => r.crystals.every((c) => set.has(String(c))));
      for (const r of whole) {
        out.push({ facet: 'regime', value: r.id, label: r.name });
        for (const c of r.crystals) set.delete(String(c));
      }
      for (const v of facet.values) if (set.has(v)) out.push({ facet: 'crystal', value: v, label: activeLabel('crystal', v) });
      continue;
    }
    for (const v of vals) out.push({ facet: facet.id, value: v, label: activeLabel(facet.id, v) });
  }
  return out;
}
/**
 * The empty result's way out, from the same pass: the active facet whose clearing would show the most tracks (its
 * picks' words, "528 Hz or 639 Hz", and that count), first in facet order on a tie; null when the result is not empty,
 * or when clearing any one facet still shows nothing (then Clear filters, or clearing the search, is the way out).
 */
export function emptyHint<S>(r: FilterResult<S>, f: Filters, facets: readonly FacetDef<any>[] = LIBRARY_FACETS): { facet: string; label: string; count: number } | null {
  if (r.results.length > 0) return null;
  let best: { facet: string; label: string; count: number } | null = null;
  facets.forEach((facet, i) => {
    if (!(f[facet.id] ?? []).length) return;
    let n = 0;
    for (const c of r.counts[i]) n += c;
    if (n > 0 && (!best || n > best.count)) {
      const label = activeChips({ [facet.id]: f[facet.id] }, facets).map((c) => c.label).join(' or ');
      best = { facet: facet.id, label, count: n };
    }
  });
  return best;
}

/** The filters as a short name (a saved playlist's default, the play order's label): up to 3 chips, then "+N more". */
export function filterName(f: Filters, facets: readonly FacetDef<any>[] = LIBRARY_FACETS): string {
  const chips = activeChips(f, facets);
  if (!chips.length) return 'Library';
  const shown = chips.slice(0, 3).map((c) => c.label);
  const more = chips.length - shown.length;
  return `${shown.join(' · ')}${more > 0 ? ` +${more} more` : ''}`;
}
