// utils/mix/catalog.ts (v15.9)
//
// The catalogue of every mix a user can start: its id, section, name and sub-line (the recipe, never a claim:
// decision 12), for the new layout's Mixes tab and for the words of the Undo toast in both layouts. Pure, Node-checked
// (utils/mix/mix.check.ts), no React, no storage. mixCounts() gives, in one O(n) pass over the library, how many
// tracks each mix would play right now: exactly the length of the play order its recipe builds (check:mix proves it
// on every golden fixture), so a tile never promises what a tap won't deliver.

import type { Song } from '../../types.ts';
import { SOLFEGGIO_INFO, LO_SHU_WALKS, LO_SHU_WALK_INFO, GUT_CRYSTALS, PRESETS, presetRecipe } from '../crystalData.ts';
import type { LoShuWalkMode } from '../crystalData.ts';

export type MixSection = 'walks' | 'journeys' | 'sets' | 'experimental';
export type MixId =
  | 'walk:A' | 'walk:B' | 'walk:C' | 'walk:combined' | 'walk:ouroboros' | 'walk:cabi'
  | 'gut' | 'heart' | 'head' | 'ultimate' | 'full'
  | 'preset:qi' | 'preset:healing' | 'preset:mood' | 'preset:meditation' | 'preset:flow'
  | 'golden' | 'seq111' | 'source2178';

export interface MixDef {
  id: MixId;
  section: MixSection;
  /** The tile's name (walks: LO_SHU_WALK_INFO.shortName). */
  name: string;
  /** The name the Undo toast and the accessible name use (walks: LO_SHU_WALK_INFO.fullName). */
  fullName: string;
  /** One line: the recipe, in plain words or crystals. */
  sub: string;
  /** What a mix with no tracks lacks: crystals (Assign or Deep Scan) or Deep Scan's measurements. */
  needs: 'crystal' | 'scan';
  /** A walk's mode (its toast counts positions). */
  walk?: LoShuWalkMode;
}

const walkDef = (mode: LoShuWalkMode, sub: string): MixDef => ({
  id: `walk:${mode}` as MixId, section: 'walks', name: LO_SHU_WALK_INFO[mode].shortName, fullName: LO_SHU_WALK_INFO[mode].fullName,
  sub, needs: 'crystal', walk: mode,
});
const presetDef = (id: 'qi' | 'healing' | 'mood' | 'meditation' | 'flow'): MixDef => {
  const p = PRESETS.find((x) => x.id === id)!;
  return { id: `preset:${id}` as MixId, section: 'sets', name: p.name, fullName: p.name, sub: presetRecipe(p), needs: 'crystal' };
};

export const MIXES: readonly MixDef[] = [
  walkDef('A', '1→9, layer by layer'),
  walkDef('B', 'Nine pillars, GUT → HEAD'),
  walkDef('C', 'Flying Star spiral'),
  walkDef('combined', 'Vortex → Ascent → Pillar'),
  walkDef('ouroboros', 'Figure-8 through 2178 Hz'),
  walkDef('cabi', 'CAB, then Ouroboros'),
  { id: 'gut', section: 'journeys', name: 'GUT Alignment', fullName: 'GUT Alignment', sub: 'One track per GUT crystal, 174 → 963 Hz', needs: 'crystal' },
  { id: 'heart', section: 'journeys', name: 'HEART Alignment', fullName: 'HEART Alignment', sub: 'One track per HEART crystal, 1206 → 3150 Hz', needs: 'crystal' },
  { id: 'head', section: 'journeys', name: 'HEAD Alignment', fullName: 'HEAD Alignment', sub: 'One track per HEAD crystal, 3504 → 6336 Hz', needs: 'crystal' },
  { id: 'ultimate', section: 'journeys', name: 'Ultimate', fullName: 'Ultimate', sub: 'One track per crystal, all 27', needs: 'crystal' },
  { id: 'full', section: 'journeys', name: 'Full Alignment', fullName: 'Full Alignment', sub: 'Every track with a crystal, low to high', needs: 'crystal' },
  ...PRESETS.map((p) => presetDef(p.id)), // qi, healing, mood, meditation, flow: PRESETS' order
  { id: 'golden', section: 'experimental', name: 'Golden Φ', fullName: 'Golden Φ', sub: 'Tracks scoring over 30 % on golden ratio', needs: 'scan' },
  { id: 'seq111', section: 'experimental', name: '111 Sequence', fullName: '111 Sequence', sub: 'One track per order, by 111-pattern score', needs: 'scan' },
  { id: 'source2178', section: 'experimental', name: '2178 Hz · SOURCE', fullName: '2178 Hz · SOURCE', sub: 'Scanned 2178 Hz tracks, by geometry score', needs: 'scan' },
];

/** The first crystal of each of the nine orders (the 111 Sequence's positions, recipes.ts sequence111). */
export const ORDER_FIRSTS: readonly number[] = [174, 396, 741, 1206, 1935, 2664, 3504, 4566, 5628];

/**
 * How many entries each mix's play order would have for this library, in one pass (O(n) + the 27 crystals):
 * a walk or a journey fills each position whose crystal has a track (repeats included); Full and the sets count every
 * track on their crystals (a duplicate twice, as the recipes do); the experimental ones count Deep-Scanned tracks.
 */
export function mixCounts(library: readonly Song[]): Record<MixId, number> {
  const all = new Map<number, number>();
  const scanned = new Map<number, number>();
  let golden = 0;
  for (const s of library) {
    const c = s.closestSolfeggio || 0;
    if (c) all.set(c, (all.get(c) ?? 0) + 1);
    if (s.fractalAnalysis) {
      if (c) scanned.set(c, (scanned.get(c) ?? 0) + 1);
      if (s.fractalAnalysis.goldenRatioAlignment > 0.3) golden++;
    }
  }
  const has = (c: number) => (all.get(c) ?? 0) > 0;
  const positions = (seq: readonly number[]) => seq.reduce((n, c) => n + (has(c) ? 1 : 0), 0);
  const crystals = SOLFEGGIO_INFO.map((x) => x.freq);
  const sum = (set: readonly number[]) => set.reduce((n, c) => n + (all.get(c) ?? 0), 0);
  const out = {} as Record<MixId, number>;
  for (const m of ['A', 'B', 'C', 'combined', 'ouroboros', 'cabi'] as const) out[`walk:${m}`] = positions(LO_SHU_WALKS[m]);
  out.gut = positions(GUT_CRYSTALS);
  out.heart = positions(crystals.filter((f) => f >= 1000 && f <= 3150));
  out.head = positions(crystals.filter((f) => f >= 3504));
  out.ultimate = positions(crystals);
  out.full = sum(crystals);
  for (const p of PRESETS) out[`preset:${p.id}` as MixId] = sum(p.crystals);
  out.golden = golden;
  out.seq111 = ORDER_FIRSTS.reduce((n, c) => n + ((scanned.get(c) ?? 0) > 0 ? 1 : 0), 0);
  out.source2178 = scanned.get(2178) ?? 0;
  return out;
}

const RANDOM_WALKS: readonly string[] = ['combined', 'ouroboros', 'cabi'];

/** The Undo toast's words when a mix starts: a walk counts its positions; anything else its tracks. */
export function mixStartText(name: string, count: number, walk: LoShuWalkMode | null): string {
  if (walk) {
    const len = LO_SHU_WALKS[walk]?.length ?? count;
    return `Playing ${name}: ${count} of ${len} positions.${RANDOM_WALKS.includes(walk) ? ' Tap again for a new draw.' : ''}`;
  }
  return `Playing ${name}: ${count} track${count === 1 ? '' : 's'}.`;
}
