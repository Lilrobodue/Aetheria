// utils/mix/builder.ts (v16.3, Create a mix)
//
// The mix builder as a pure model: settings in, a MixResult out (the same type every Mixes-tab mix returns, so App's
// existing start path, the queue and v16.1's Save take it as they are). It COMPOSES today's recipes (recipes.ts): the
// source (the library, a playlist's tracks or the queue's waiting tracks) is narrowed by v16.2's filter model, and the
// recipe runs on what is left, exactly as it runs on the library today. Three stages:
//   1. the pool: the source's tracks, in their order, through filterPass (BUILDER_FACETS: the Library's facets without
//      the crystal one, which is Follow's job, plus the experimental scores from scanScores.ts);
//   2. the pick, by Follow: a walk (loShuWalk), a crystal set with 1 / 3 / all tracks per crystal (the journeys'
//      recipes and crystalSetMix, or pickPerCrystal for the combinations no recipe has), an experimental ranking
//      (Golden Φ, the 111 Sequence, 2178 Hz · SOURCE) or any crystal;
//   3. the order: the pattern (the pick as it comes; a walk stays a walk), crystal low to high, a shuffle with the least
//      recently played first (App's getLruShuffledIndices, rng injected), or the source's order. Any order but the
//      pattern makes a walk a plain mix (no cube steps).
// Every Mixes-tab mix is one setting (settingsOf), and with it the builder returns exactly the recipe's result: the
// golden harness, run with every recipe replaced by buildMix(settingsOf(…)), gives 1,707 of 1,707 runs identical.
// builderSummary is the footer's live count and length: no Math.random, no console, no App state.
// No React, no DOM, no storage: Node checks it (builder.check.ts). No word here may read as a style name (tailwind.config.js
// scans utils/).

import type { Song } from '../../types.ts';
import {
  gutAlignment, heartAlignment, headAlignment, ultimateAlignment, fullAlignment, crystalSetMix, loShuWalk, goldenRatioMix,
  sequence111, sourceField,
} from './recipes.ts';
import type { ExperienceLevel, MixInput, MixResult } from './recipes.ts';
import { ALL_CRYSTALS } from './distribution.ts';
import { GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS, PRESETS, LO_SHU_WALKS, LO_SHU_WALK_INFO, SOURCE_FREQ } from '../crystalData.ts';
import type { LoShuWalkMode, PresetId } from '../crystalData.ts';
import { MIXES, ORDER_FIRSTS } from './catalog.ts';
import type { MixId } from './catalog.ts';
import { LIBRARY_FACETS, NO_FILTERS, activeChips, buildFacetIndex, filterPass, parseFilters, serializeFilters, filtersOn } from '../library/filterModel.ts';
import type { FacetDef, FacetIndex, Filters } from '../library/filterModel.ts';
import { EXPERIMENTAL_FACETS, SCAN_SCORES, scoreChipText } from '../library/scanScores.ts';

// ---------------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------------

export type SetId = `preset:${PresetId}` | 'gut' | 'heart' | 'head' | 'all' | 'custom';
export type Follow =
  | { kind: 'walk'; mode: LoShuWalkMode }
  | { kind: 'set'; set: SetId; crystals?: readonly number[] }
  | { kind: 'golden' }
  | { kind: 'seq111' }
  | { kind: 'source2178' }
  | { kind: 'any' };
export type PerCrystal = 1 | 3 | 'all';
export type Order = 'pattern' | 'low-high' | 'shuffle' | 'source';
export type SourceRef = { kind: 'library' } | { kind: 'playlist'; id: string } | { kind: 'queue' };

export interface BuilderSettings {
  source: SourceRef;
  follow: Follow;
  /** Crystal sets only (the rest have their own rule). */
  per: PerCrystal;
  filters: Filters;
  order: Order;
}

/** The builder's facets: the Library's (v16.2) without the crystal one (Follow picks crystals), then the scores. */
export const BUILDER_FACETS: readonly FacetDef<any>[] = [...LIBRARY_FACETS.filter((f) => f.id !== 'crystal'), ...EXPERIMENTAL_FACETS];

export const DEFAULT_SETTINGS: BuilderSettings = Object.freeze({
  source: { kind: 'library' },
  follow: { kind: 'set', set: 'preset:qi' },
  per: 'all',
  filters: NO_FILTERS,
  order: 'pattern',
}) as BuilderSettings;

const presetOf = (set: SetId) => (set.startsWith('preset:') ? PRESETS.find((p) => `preset:${p.id}` === set) ?? null : null);

/** A set's crystals, in its pattern (every list is ascending today; a custom set is kept ascending). */
export function setCrystals(f: Extract<Follow, { kind: 'set' }>): readonly number[] {
  const p = presetOf(f.set);
  if (p) return p.crystals;
  if (f.set === 'gut') return GUT_CRYSTALS;
  if (f.set === 'heart') return HEART_CRYSTALS;
  if (f.set === 'head') return HEAD_CRYSTALS;
  if (f.set === 'all') return ALL_CRYSTALS;
  return cleanCrystals(f.crystals ?? []);
}
/** A custom set: the 27 only, each once, ascending. */
export function cleanCrystals(c: readonly unknown[]): number[] {
  const want = new Set(c.filter((x): x is number => typeof x === 'number'));
  return ALL_CRYSTALS.filter((x) => want.has(x));
}

/** Every Mixes-tab mix as builder settings: the library, no filters, its own pattern. */
export function settingsOf(id: MixId): BuilderSettings {
  const base = { source: { kind: 'library' } as SourceRef, filters: NO_FILTERS, order: 'pattern' as Order };
  if (id.startsWith('walk:')) return { ...base, follow: { kind: 'walk', mode: id.slice(5) as LoShuWalkMode }, per: 'all' };
  if (id.startsWith('preset:')) return { ...base, follow: { kind: 'set', set: id as SetId }, per: 'all' };
  switch (id) {
    case 'gut': return { ...base, follow: { kind: 'set', set: 'gut' }, per: 1 };
    case 'heart': return { ...base, follow: { kind: 'set', set: 'heart' }, per: 1 };
    case 'head': return { ...base, follow: { kind: 'set', set: 'head' }, per: 1 };
    case 'ultimate': return { ...base, follow: { kind: 'set', set: 'all' }, per: 1 };
    case 'full': return { ...base, follow: { kind: 'set', set: 'all' }, per: 'all' };
    case 'golden': return { ...base, follow: { kind: 'golden' }, per: 'all' };
    case 'seq111': return { ...base, follow: { kind: 'seq111' }, per: 'all' };
    default: return { ...base, follow: { kind: 'source2178' }, per: 'all' };
  }
}

/** The Mixes-tab mix these settings pick and order as (whatever the source and filters), or null. */
export function mixShapeOf(s: BuilderSettings): MixId | null {
  if (s.order !== 'pattern') return null;
  const f = s.follow;
  if (f.kind === 'walk') return f.mode === 'traditional' ? null : (`walk:${f.mode}` as MixId);
  if (f.kind === 'golden') return 'golden';
  if (f.kind === 'seq111') return 'seq111';
  if (f.kind === 'source2178') return 'source2178';
  if (f.kind === 'any') return null;
  if (f.set === 'custom') return null;
  if (s.per === 'all') return f.set === 'all' ? 'full' : f.set.startsWith('preset:') ? (f.set as MixId) : null;
  if (s.per === 1) return f.set === 'gut' ? 'gut' : f.set === 'heart' ? 'heart' : f.set === 'head' ? 'head' : f.set === 'all' ? 'ultimate' : null;
  return null;
}
/** The same as a Mixes-tab mix: its shape, on the whole library, unfiltered. */
export function namedMixOf(s: BuilderSettings): MixId | null {
  return s.source.kind === 'library' && !filtersOn(s.filters) ? mixShapeOf(s) : null;
}

/** Which "tracks per crystal" a Follow offers (null: its own rule, shown as a line). */
export function perOptions(f: Follow): readonly PerCrystal[] | null {
  return f.kind === 'set' ? [1, 3, 'all'] : null;
}
/** Which orders a Follow offers, the pattern first (an order the same as the pattern for every set is left out). */
export function orderOptions(f: Follow): readonly Order[] {
  if (f.kind === 'walk' || f.kind === 'golden') return ['pattern', 'low-high', 'shuffle', 'source'];
  if (f.kind === 'any') return ['pattern', 'low-high', 'shuffle'];
  return ['pattern', 'shuffle', 'source'];
}
/** The settings with an order this Follow offers, and `per` reset where it has no say. */
export function normalized(s: BuilderSettings): BuilderSettings {
  const order = orderOptions(s.follow).includes(s.order) ? s.order : 'pattern';
  const per = perOptions(s.follow) ? s.per : 'all';
  const follow = s.follow.kind === 'set' && s.follow.set === 'custom' ? { kind: 'set' as const, set: 'custom' as const, crystals: cleanCrystals(s.follow.crystals ?? []) } : s.follow;
  return order === s.order && per === s.per && follow === s.follow ? s : { ...s, follow, order, per };
}

// ---------------------------------------------------------------------------------------------------------------
// The parts: the journeys' ranking, the per-crystal picker, the LRU shuffle (verbatim from the recipes and App)
// ---------------------------------------------------------------------------------------------------------------

/** GUT / HEART / HEAD Alignment's best match (recipes.ts, verbatim): golden ratio score when it differs by more than
 *  0.1, else the deviation (`|| 999`, so 0 sorts last: a kept quirk). */
export const rankJourney = (a: Song, b: Song): number => {
  const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
  const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;
  if (Math.abs(aGolden - bGolden) > 0.1) return bGolden - aGolden;
  return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
};
/** Ultimate's (recipes.ts, verbatim): the golden ratio score, then the DNA score, then the deviation. */
export const rankUltimate = (a: Song, b: Song): number => {
  const aGolden = a.fractalAnalysis?.goldenRatioAlignment || 0;
  const bGolden = b.fractalAnalysis?.goldenRatioAlignment || 0;
  if (Math.abs(aGolden - bGolden) > 0.1) return bGolden - aGolden;
  const aDNA = a.fractalAnalysis?.dnaResonanceScore || 0;
  const bDNA = b.fractalAnalysis?.dnaResonanceScore || 0;
  if (Math.abs(aDNA - bDNA) > 0.1) return bDNA - aDNA;
  return (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
};

/**
 * Up to `k` tracks per crystal, the crystals in the given order, each crystal's best first (the journeys' loop,
 * verbatim, with k): a track is used once (a repeated entry of the source counts as used). k = 1 is exactly
 * GUT / HEART / HEAD Alignment's pick (rankJourney) and Ultimate's (rankUltimate); builder.check.ts holds it so.
 */
export function pickPerCrystal(pool: readonly Song[], crystals: readonly number[], k: number, rank: (a: Song, b: Song) => number): Song[] {
  const out: Song[] = [];
  const usedIds = new Set<string>();
  crystals.forEach((freq) => {
    const candidates = pool.filter((s) => s.closestSolfeggio === freq && !usedIds.has(s.id));
    if (candidates.length > 0) {
      candidates.sort(rank);
      let taken = 0;
      for (const c of candidates) {
        if (taken >= k) break;
        if (usedIds.has(c.id)) continue;
        out.push(c);
        usedIds.add(c.id);
        taken++;
      }
    }
  });
  return out;
}

/** App's getLruShuffledIndices (verbatim), with the random source injected: least recently played first (never played
 *  first of all), a Fisher-Yates shuffle within each tier. Returns the items in that order. */
export function lruShuffle<T extends { id: string }>(songs: readonly T[], history: Readonly<Record<string, number>>, rng: () => number): T[] {
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < songs.length; i++) {
    const t = history[songs[i].id] || 0;
    const arr = buckets.get(t);
    if (arr) arr.push(i);
    else buckets.set(t, [i]);
  }
  const orderedTimestamps = [...buckets.keys()].sort((a, b) => a - b);
  const result: number[] = [];
  for (const t of orderedTimestamps) {
    const group = buckets.get(t)!;
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    result.push(...group);
  }
  return result.map((i) => songs[i]);
}

const CRYSTAL_RANK = new Map<number, number>(ALL_CRYSTALS.map((c, i) => [c, i]));
const ON_A_CRYSTAL = (s: Song) => CRYSTAL_RANK.has(s.closestSolfeggio as number);

// ---------------------------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------------------------

export interface BuildInput {
  /** The source's tracks, in its order: the library's own Song objects (App resolves a playlist or the queue by id). */
  tracks: readonly Song[];
  history?: Readonly<Record<string, number>>;
  rng?: () => number;
  experience?: ExperienceLevel;
}
export interface BuiltMix {
  /** What applyMix / the queue / Save take. A reordered walk has `walk: null`. */
  result: MixResult;
  /** The toast's, the Undo's, the play order's label and Save's default name. */
  name: string;
  /** The toast counts positions (a walk kept as a walk). */
  positions: boolean;
  /** The Mixes-tab mix it is, when it is exactly one (the library, no filters, the pattern). */
  named: MixId | null;
}

const found = (order: Song[]): MixResult => ({
  order, play: true, walk: null, chakraOrder: true, notices: [], closeWalkMenu: false, closeDrawerOnPhone: true, toast: null,
});
export const BUILDER_EMPTY_TEXT = 'No tracks fit this mix. Change what it follows or remove a filter.';
const nothing = (): MixResult => ({
  order: null, play: false, walk: null, chakraOrder: true, notices: [], closeWalkMenu: false, closeDrawerOnPhone: false,
  toast: { text: BUILDER_EMPTY_TEXT, durationMs: 6000 },
});

/** Stage 1: the pool (the source, through the filters; its order and its repeats kept). */
export function poolOf(tracks: readonly Song[], filters: Filters, index?: FacetIndex<Song>): Song[] {
  if (!filtersOn(filters)) return tracks.slice();
  return filterPass(index ?? buildFacetIndex(tracks, BUILDER_FACETS as readonly FacetDef<Song>[]), filters).results;
}

/** Stage 2: the pick, by Follow, from the pool (the recipe itself wherever one exists). */
export function pick(pool: readonly Song[], s: BuilderSettings, input: Omit<MixInput, 'library'>, name: string): MixResult {
  const mi: MixInput = { ...input, library: pool };
  const f = s.follow;
  switch (f.kind) {
    case 'walk': return loShuWalk(mi, f.mode);
    case 'golden': return goldenRatioMix(mi);
    case 'seq111': return sequence111(mi);
    case 'source2178': return sourceField(mi);
    case 'any': {
      const order = pool.filter(ON_A_CRYSTAL);
      return order.length ? found(order) : nothing();
    }
    default: {
      const crystals = setCrystals(f);
      if (!crystals.length) return nothing();
      if (s.per === 'all') {
        if (f.set === 'all') return fullAlignment(mi);
        const r = crystalSetMix(mi, crystals, name);
        return r;
      }
      if (s.per === 1) {
        if (f.set === 'gut') return gutAlignment(mi);
        if (f.set === 'heart') return heartAlignment(mi);
        if (f.set === 'head') return headAlignment(mi);
        if (f.set === 'all') return ultimateAlignment(mi);
      }
      const order = pickPerCrystal(pool, crystals, s.per === 1 ? 1 : 3, f.set === 'all' ? rankUltimate : rankJourney);
      return order.length ? found(order) : nothing();
    }
  }
}

/** Stage 3: the order. The pattern returns the pick as it is; any other order makes a walk a plain mix. */
export function reorder(r: MixResult, s: BuilderSettings, pool: readonly Song[], history: Readonly<Record<string, number>>, rng: () => number): MixResult {
  if (s.order === 'pattern' || !r.order) return r;
  let order: Song[];
  if (s.order === 'low-high') {
    order = r.order.map((x, i) => [x, i] as const).sort((a, b) => ((CRYSTAL_RANK.get(a[0].closestSolfeggio as number) ?? 99) - (CRYSTAL_RANK.get(b[0].closestSolfeggio as number) ?? 99)) || a[1] - b[1]).map((p) => p[0]);
  } else if (s.order === 'source') {
    const at = new Map<string, number>();
    pool.forEach((x, i) => { if (!at.has(x.id)) at.set(x.id, i); });
    order = r.order.map((x, i) => [x, i] as const).sort((a, b) => ((at.get(a[0].id) ?? 0) - (at.get(b[0].id) ?? 0)) || a[1] - b[1]).map((p) => p[0]);
  } else {
    order = lruShuffle(r.order, history, rng);
  }
  return { ...r, order, walk: null, segmentsAndPhases: undefined, notices: [] };
}

/** Settings → the mix (App calls this at the tap, with Math.random and the play history: what plays is what was asked). */
export function buildMix(input: BuildInput, sIn: BuilderSettings, sourceName: string = 'your library'): BuiltMix {
  const s = normalized(sIn);
  const history = input.history ?? {};
  const rng = input.rng ?? Math.random;
  const named = namedMixOf(s);
  const name = builderName(s, sourceName);
  const pool = poolOf(input.tracks, s.filters);
  const picked = pick(pool, s, { experience: input.experience ?? 'beginner', history, rng }, name);
  const result = reorder(picked, s, pool, history, rng);
  return { result, name, positions: s.follow.kind === 'walk' && s.order === 'pattern', named };
}

// ---------------------------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------------------------

const MIX_NAME = new Map<MixId, string>(MIXES.map((m) => [m.id, m.fullName]));
const SET_NAMES: Readonly<Record<string, string>> = { gut: 'GUT', heart: 'HEART', head: 'HEAD', all: 'All 27 crystals' };
/** What a Follow is called on its own ("Grounding", "Flying Star Vortex", "Custom: 528 · 639 Hz"). */
export function followName(f: Follow): string {
  if (f.kind === 'walk') return LO_SHU_WALK_INFO[f.mode]?.fullName ?? 'Lo Shu walk';
  if (f.kind === 'golden') return MIX_NAME.get('golden')!;
  if (f.kind === 'seq111') return MIX_NAME.get('seq111')!;
  if (f.kind === 'source2178') return MIX_NAME.get('source2178')!;
  if (f.kind === 'any') return 'Any crystal';
  const p = presetOf(f.set);
  if (p) return p.name;
  if (f.set !== 'custom') return SET_NAMES[f.set];
  const c = setCrystals(f);
  return c.length ? `Custom: ${c.length > 4 ? `${c.length} crystals` : `${c.join(' · ')} Hz`}` : 'Custom';
}
/** The picked filters as words, up to three, then "+N more" (filterModel's rule; the scores in scanScores' words). */
export function filterWords(f: Filters): string {
  const chips = activeChips(f, BUILDER_FACETS).map((c) => {
    const d = c.facet.startsWith('x-') ? SCAN_SCORES.find((x) => `x-${x.id}` === c.facet) : null;
    return d ? scoreChipText(d) : c.label;
  });
  const shown = chips.slice(0, 3);
  return `${shown.join(' · ')}${chips.length > 3 ? ` +${chips.length - 3} more` : ''}`;
}
const ORDER_WORDS: Readonly<Record<Order, string>> = { pattern: '', 'low-high': 'low to high', shuffle: 'shuffled', source: 'in source order' };
/** The mix's name: a Mixes-tab mix's own when it is one; else what it follows, how many per crystal, its order, its
 *  source and its filters ("Grounding · 1 per crystal · shuffled · from Evening · Under 3 min"), at most 80 characters. */
export function builderName(sIn: BuilderSettings, sourceName: string = 'your library'): string {
  const s = normalized(sIn);
  const shape = mixShapeOf(s);
  const parts: string[] = [];
  if (shape) parts.push(MIX_NAME.get(shape)!);
  else {
    parts.push(followName(s.follow));
    if (s.follow.kind === 'set' && s.per !== 'all') parts.push(`${s.per} per crystal`);
    if (s.order !== 'pattern') parts.push(s.order === 'source' ? (s.source.kind === 'library' ? 'in library order' : s.source.kind === 'queue' ? 'in queue order' : 'in playlist order') : ORDER_WORDS[s.order]);
  }
  if (s.source.kind !== 'library') parts.push(`from ${sourceName}`);
  if (filtersOn(s.filters)) parts.push(filterWords(s.filters));
  const full = parts.join(' · ');
  return full.length <= 80 ? full : `${full.slice(0, 79).trimEnd()}…`;
}

// ---------------------------------------------------------------------------------------------------------------
// The live summary (the footer): no Math.random, no console, no App state
// ---------------------------------------------------------------------------------------------------------------

export interface BuilderSummary {
  /** The source's tracks, and how many are left after the filters. */
  sourceTotal: number;
  pool: number;
  /** Of the pool: tracks with no crystal yet (no mix can hold them; Assign crystals gives them one). */
  noCrystal: number;
  /** The entries the mix would have (a walk: the positions it fills). */
  count: number;
  /** A walk's size in positions, else null. */
  positions: number | null;
  /** Their length in seconds (unknown lengths count 0). */
  seconds: number;
  /** A random walk (CAB, Ouroboros, CABI): its length changes with each draw; this is one draw's. */
  approx: boolean;
  /** The crystals the mix follows that have no track in the pool (ascending). */
  missing: number[];
  /** It plays as a walk (the cube follows its steps). */
  walk: boolean;
  /** The Mixes-tab mix it is exactly, or null. */
  named: MixId | null;
  name: string;
  /** v16.3 review: built from the queue, how many of the queued entries the mix leaves out (Play makes the queue the
   *  mix, so they leave it; one draw's for a random walk). 0 for the library or a playlist. */
  left: number;
}

const RANDOM_WALKS: readonly string[] = ['combined', 'ouroboros', 'cabi'];
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The recipes log as they pick (Golden Φ every track): the summary runs them without it. */
function quietly<T>(fn: () => T): T {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
}
const secs = (s: Song) => (typeof s.duration === 'number' && Number.isFinite(s.duration) && s.duration > 0 ? s.duration : 0);

/** The entries of `source` that `mix` leaves out, in the source's order. Each of the mix's entries accounts for one
 *  entry of the source with its id (the first not yet counted), so a track queued twice and picked once leaves one copy,
 *  and a walk that repeats a track never counts more copies than the source has. v16.3 review: Play from the queue,
 *  the queued tracks a built mix doesn't hold (what the footer and the toast count; what stays queued if that ever
 *  becomes the rule: builderViewModel's QUEUE_UNPICKED). */
export function leftOut<T extends { id: string }>(source: readonly T[], mix: readonly { id: string }[]): T[] {
  const room = new Map<string, number>();
  for (const x of mix) room.set(x.id, (room.get(x.id) ?? 0) + 1);
  const out: T[] = [];
  for (const x of source) {
    const n = room.get(x.id) ?? 0;
    if (n > 0) room.set(x.id, n - 1);
    else out.push(x);
  }
  return out;
}

/** Each Lo Shu walk's filled positions over a pool, from the pool's crystals alone: the walk choices' counts (v16.3
 *  review: one summary per tap, spec §3.6, not one per walk). Ascent, Pillar and Vortex fill a position while its crystal
 *  still has a track not used yet (each track once); CAB, Ouroboros and CABI fill every position whose crystal has a
 *  track (they repeat one). Equal to builderSummary's count for each walk (builder.check G). O(pool + positions). */
export function walkCounts(pool: readonly Song[]): Record<string, number> {
  const onCrystal = new Map<unknown, Set<string>>();
  for (const t of pool) {
    let ids = onCrystal.get(t.closestSolfeggio);
    if (!ids) onCrystal.set(t.closestSolfeggio, (ids = new Set<string>()));
    ids.add(t.id);
  }
  const out: Record<string, number> = {};
  for (const mode of WALK_MODES) {
    const seq: readonly number[] = LO_SHU_WALKS[mode as LoShuWalkMode] ?? [];
    let n = 0;
    if (RANDOM_WALKS.includes(mode)) {
      for (const c of seq) if (onCrystal.has(c)) n++;
    } else {
      const taken = new Map<number, number>();
      for (const c of seq) {
        const k = taken.get(c) ?? 0;
        if (k < (onCrystal.get(c)?.size ?? 0)) { n++; taken.set(c, k + 1); }
      }
    }
    out[mode] = n;
  }
  return out;
}

/** The crystals a Follow uses, ascending (none for Golden Φ and any crystal). */
export function followCrystals(f: Follow): readonly number[] {
  if (f.kind === 'walk') return ALL_CRYSTALS.filter((c) => (LO_SHU_WALKS[f.mode] ?? []).includes(c));
  if (f.kind === 'seq111') return ORDER_FIRSTS;
  if (f.kind === 'source2178') return [SOURCE_FREQ];
  if (f.kind === 'set') return setCrystals(f);
  return [];
}

/**
 * The footer's numbers for these settings over an index of the source's tracks (buildFacetIndex(tracks, BUILDER_FACETS),
 * memoised by the view on the tracks): the filters' pass, then the pick with a fixed seed and an empty history (the
 * count never depends on the draw; a random walk's length does, and says so). Pure; O(n x facets) + the pick.
 */
export function builderSummary(index: FacetIndex<Song>, sIn: BuilderSettings, sourceName: string = 'your library'): BuilderSummary {
  const s = normalized(sIn);
  const pool = filtersOn(s.filters) ? filterPass(index, s.filters).results : (index.songs as Song[]);
  let noCrystal = 0;
  const have = new Set<number>();
  const haveScanned = new Set<number>();
  for (const t of pool) {
    if (!ON_A_CRYSTAL(t)) { noCrystal++; continue; }
    have.add(t.closestSolfeggio as number);
    if (t.fractalAnalysis) haveScanned.add(t.closestSolfeggio as number);
  }
  const f = s.follow;
  const missing = followCrystals(f).filter((c) => !(f.kind === 'seq111' || f.kind === 'source2178' ? haveScanned : have).has(c));
  let count = 0;
  let seconds = 0;
  let walk = false;
  let picked: Song[] | null = null; // the pick's entries, where the count is not read straight off the pool
  if (f.kind === 'golden') {
    // Golden Φ's own rule (recipes.ts), without running it: it logs every track.
    for (const t of pool) if (t.fractalAnalysis && (t.fractalAnalysis as { goldenRatioAlignment: number }).goldenRatioAlignment > 0.3) { count++; seconds += secs(t); }
  } else if (f.kind === 'set' && s.per === 'all') {
    const want = new Set(setCrystals(f));
    for (const t of pool) if (want.has(t.closestSolfeggio as number)) { count++; seconds += secs(t); }
  } else if (f.kind === 'any') {
    count = pool.length - noCrystal;
    for (const t of pool) if (ON_A_CRYSTAL(t)) seconds += secs(t);
  } else {
    const r = quietly(() => pick(pool, s, { experience: 'beginner', history: {}, rng: seeded(1) }, ''));
    if (r.order) {
      picked = r.order;
      count = r.order.length;
      for (const t of r.order) seconds += secs(t);
      walk = !!r.walk && s.order === 'pattern';
    }
  }
  return {
    sourceTotal: index.songs.length, pool: pool.length, noCrystal, count, seconds,
    positions: f.kind === 'walk' && s.order === 'pattern' ? (LO_SHU_WALKS[f.mode]?.length ?? null) : null,
    approx: f.kind === 'walk' && RANDOM_WALKS.includes(f.mode),
    missing, walk, named: namedMixOf(s), name: builderName(s, sourceName),
    // From the queue: every entry the pick doesn't hold (Golden Φ, a whole set and any crystal take distinct entries of
    // the pool, so the rest of the source is what is left).
    left: s.source.kind !== 'queue' ? 0 : picked ? leftOut(index.songs as Song[], picked).length : index.songs.length - count,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Saved: aetheria.builder.v1 (localStorage; written from a tap only, never from an effect or a load)
// ---------------------------------------------------------------------------------------------------------------

export const BUILDER_KEY = 'aetheria.builder.v1';
const WALK_MODES: readonly string[] = ['A', 'B', 'C', 'combined', 'ouroboros', 'cabi'];
const SET_IDS: readonly string[] = [...PRESETS.map((p) => `preset:${p.id}`), 'gut', 'heart', 'head', 'all', 'custom'];
const PL_ID = /^p[a-z0-9]{6,30}$/;

/** The saved string → settings. Anything unreadable is the default; unknown fields are dropped. */
export function parseBuilderSettings(raw: unknown): BuilderSettings {
  if (typeof raw !== 'string' || raw.length > 4096) return DEFAULT_SETTINGS;
  let o: any;
  try { o = JSON.parse(raw); } catch { return DEFAULT_SETTINGS; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return DEFAULT_SETTINGS;
  const src = o.source;
  const source: SourceRef = src && src.kind === 'playlist' && typeof src.id === 'string' && PL_ID.test(src.id) ? { kind: 'playlist', id: src.id }
    : src && src.kind === 'queue' ? { kind: 'queue' } : { kind: 'library' };
  const fo = o.follow;
  let follow: Follow = DEFAULT_SETTINGS.follow;
  if (fo && typeof fo === 'object') {
    if (fo.kind === 'walk' && WALK_MODES.includes(fo.mode)) follow = { kind: 'walk', mode: fo.mode };
    else if (fo.kind === 'set' && SET_IDS.includes(fo.set)) follow = fo.set === 'custom' ? { kind: 'set', set: 'custom', crystals: cleanCrystals(Array.isArray(fo.crystals) ? fo.crystals.slice(0, 27) : []) } : { kind: 'set', set: fo.set };
    else if (fo.kind === 'golden' || fo.kind === 'seq111' || fo.kind === 'source2178' || fo.kind === 'any') follow = { kind: fo.kind };
  }
  const per: PerCrystal = o.per === 1 || o.per === 3 ? o.per : 'all';
  const order: Order = ['pattern', 'low-high', 'shuffle', 'source'].includes(o.order) ? o.order : 'pattern';
  const filters = parseFilters(JSON.stringify({ v: 1, f: o.f && typeof o.f === 'object' && !Array.isArray(o.f) ? o.f : {} }), BUILDER_FACETS);
  return normalized({ source, follow, per, filters, order });
}
/** Settings → the saved string ({"v":1,…}: the source, follow, per, order and the picked filters). */
export function serializeBuilderSettings(sIn: BuilderSettings): string {
  const s = normalized(sIn);
  const f = JSON.parse(serializeFilters(s.filters, BUILDER_FACETS)).f;
  const follow = s.follow.kind === 'set' && s.follow.set === 'custom' ? { kind: 'set', set: 'custom', crystals: [...setCrystals(s.follow)] } : s.follow;
  return JSON.stringify({ v: 1, source: s.source, follow, per: s.per, order: s.order, f });
}
