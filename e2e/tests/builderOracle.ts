// v16.3: the seed's table and the oracles builder.spec.ts and mix-queue.spec.ts compare with (builderSeed.ts re-exports
// them). No imports: plain data and a few lines of arithmetic, written independently of utils/mix.

export const BUILDER_KEY = 'aetheria.builder.v1';
export const N = 30;
export const toneName = (k: number) => `tone-${String(k + 1).padStart(2, '0')}`;

/** The 27 crystals, ascending (the cube's order). */
export const ALL27 = [174, 285, 396, 417, 528, 639, 741, 852, 963, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907, 3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 5982, 6336];
export const GROUNDING = [174, 285, 396, 417];
export const GUT = ALL27.slice(0, 9);
export const HEART = ALL27.slice(9, 18);

export const CRY: Array<number | null> = [
  174, 285, 396, 417, 528, 639, 741, 963, 174, 285,
  396, 417, 1206, 1449, 1692, 1935, 2178, 2421, 2664, 2907,
  3150, 3504, 3858, 4212, 4566, 4920, 5274, 5628, 174, null,
];
export interface Row {
  crystal: number | null;
  /** The stored length (s). */
  duration: number;
  /** harmonicDeviation (never 0 here). */
  dev: number;
  /** Deep Scan's scores (a sixth of the tones), else null: no fractal analysis. */
  scores: { golden: number; p111: number; dna: number } | null;
}
const SCORES: Record<number, { golden: number; p111: number; dna: number }> = {
  0: { golden: 0.45, p111: 0.25, dna: 0.4 },
  6: { golden: 0.35, p111: 0.1, dna: 0.2 },
  12: { golden: 0.25, p111: 0.3, dna: 0.31 },
  18: { golden: 0.6, p111: 0.05, dna: 0.1 },
  24: { golden: 0.32, p111: 0.22, dna: 0.5 },
};
export const ROWS: Row[] = Array.from({ length: N }, (_, k) => ({
  crystal: CRY[k],
  duration: [150, 240, 420, 700][k % 4],
  dev: ((k * 7) % 11) + 1,
  scores: SCORES[k] ?? null,
}));

// ---------------------------------------------------------------------------------------------------------------
// Oracles (independent of utils/mix): tone indexes in, tone indexes out
// ---------------------------------------------------------------------------------------------------------------

const golden = (k: number) => ROWS[k].scores?.golden ?? 0;
/** The journeys' best match: the golden ratio score when it differs by more than 0.1, else the smaller deviation. */
export const journeyRank = (a: number, b: number) => (Math.abs(golden(a) - golden(b)) > 0.1 ? golden(b) - golden(a) : ROWS[a].dev - ROWS[b].dev);
/** Up to `per` tones per crystal, the crystals in turn, each crystal's best first; a tone at most once. */
export function perCrystal(ks: readonly number[], crystals: readonly number[], per: number): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  for (const c of crystals) {
    const cand = ks.filter((k) => ROWS[k].crystal === c && !used.has(k));
    cand.sort(journeyRank); // a stable sort: ties keep the source's order
    for (const k of cand.slice(0, per)) { used.add(k); out.push(k); }
  }
  return out;
}
/** A preset's (crystalSetMix's) order: every tone on the crystals, by the set's crystal order, then the deviation. */
export function setAll(ks: readonly number[], crystals: readonly number[]): number[] {
  return ks.filter((k) => ROWS[k].crystal !== null && crystals.includes(ROWS[k].crystal!)).sort((a, b) => crystals.indexOf(ROWS[a].crystal!) - crystals.indexOf(ROWS[b].crystal!) || ROWS[a].dev - ROWS[b].dev);
}
export const libraryKs = Array.from({ length: N }, (_, k) => k);
export const secondsOf = (ks: readonly number[]) => ks.reduce((t, k) => t + ROWS[k].duration, 0);

/** The playlist "Evening": these tones, in this order (not the library's). */
export const EVENING = [16, 4, 1, 28, 12, 9, 22, 6, 13, 20];

/** B4's 60 tones: the 27 crystals twice, then 6 without one; scores on every third and on both 2178 Hz tones. */
export const ROWS60: Row[] = Array.from({ length: 60 }, (_, k) => ({
  crystal: k < 54 ? ALL27[k % 27] : null,
  duration: [150, 240, 420, 700][k % 4],
  dev: ((k * 7) % 11) + 1,
  scores: k < 54 && (k % 3 === 0 || ALL27[k % 27] === 2178) ? { golden: [0.2, 0.35, 0.5, 0.7][Math.floor(k / 3) % 4], p111: [0.06, 0.1, 0.3, 0.02][k % 4], dna: [0.1, 0.2, 0.06, 0.4][Math.floor(k / 2) % 4] } : null,
}));
/** Every Mixes-tab mix (utils/mix/catalog.ts ids). */
export const MIX_IDS = ['walk:A', 'walk:B', 'walk:C', 'walk:combined', 'walk:ouroboros', 'walk:cabi', 'gut', 'heart', 'head', 'ultimate', 'full', 'preset:qi', 'preset:healing', 'preset:mood', 'preset:meditation', 'preset:flow', 'golden', 'seq111', 'source2178'];

/** The Lo Shu walks' positions (constants.ts LO_SHU_WALKS, written out): Ascent, Pillar, Vortex; CAB is Vortex, Ascent,
 *  Pillar in turn. */
export const WALK_A = ALL27;
export const WALK_B = [174, 1206, 3504, 285, 1449, 3858, 396, 1692, 4212, 417, 1935, 4566, 528, 2178, 4920, 639, 2421, 5274, 741, 2664, 5628, 852, 2907, 5982, 963, 3150, 6336];
export const WALK_C = [528, 639, 741, 852, 963, 174, 285, 396, 417, 2178, 2421, 2664, 2907, 3150, 1206, 1449, 1692, 1935, 4920, 5274, 5628, 5982, 6336, 3504, 3858, 4212, 4566];
export const WALK_CAB = [...WALK_C, ...WALK_A, ...WALK_B];
/** The filled positions' crystals (a position whose crystal has a tone here). */
export const filled = (seq: readonly number[], ks: readonly number[] = libraryKs) => seq.filter((c) => ks.some((k) => ROWS[k].crystal === c));
/** Ascent / Pillar / Vortex's pick: each position's best unused tone (golden ratio score by more than 0.1, then the
 *  deviation by more than 0.1, then the id: the seed's ids rise with k). */
export function walkPick(ks: readonly number[], seq: readonly number[]): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  for (const c of seq) {
    const cand = ks.filter((k) => ROWS[k].crystal === c && !used.has(k)).sort((a, b) => (Math.abs(golden(a) - golden(b)) > 0.1 ? golden(b) - golden(a) : Math.abs(ROWS[a].dev - ROWS[b].dev) > 0.1 ? ROWS[a].dev - ROWS[b].dev : a - b));
    if (cand.length) { used.add(cand[0]); out.push(cand[0]); }
  }
  return out;
}


/** A length as the app writes it (shellModel.formatTotal, written out): "4 h 19 min", "14 min", "45 s". */
export function fmtTotal(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Each Mixes-tab mix's tile name and full name (utils/mix/catalog.ts MIXES, written out). */
export const MIX_NAMES: Readonly<Record<string, [string, string]>> = {
  'walk:A': ['Ascent', 'Layer Ascent'], 'walk:B': ['Pillar', 'Pillar Walk'], 'walk:C': ['Vortex', 'Flying Star Vortex'],
  'walk:combined': ['CAB', 'Combined Walk — Calling a CAB (C·A·B)'], 'walk:ouroboros': ['Ouroboros', 'Ouroboros ♾️'], 'walk:cabi': ['CABI', 'Calling a CABI · C·A·B·I'],
  gut: ['GUT Alignment', 'GUT Alignment'], heart: ['HEART Alignment', 'HEART Alignment'], head: ['HEAD Alignment', 'HEAD Alignment'],
  ultimate: ['Ultimate', 'Ultimate'], full: ['Full Alignment', 'Full Alignment'], 'preset:qi': ['Grounding', 'Grounding'],
  'preset:healing': ['Stillness', 'Stillness'], 'preset:mood': ['Uplift', 'Uplift'], 'preset:meditation': ['Meditation', 'Meditation'],
  'preset:flow': ['Flow', 'Flow'], golden: ['Golden Φ', 'Golden Φ'], seq111: ['111 Sequence', '111 Sequence'], source2178: ['2178 Hz · SOURCE', '2178 Hz · SOURCE'],
};
