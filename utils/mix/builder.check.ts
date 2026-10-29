// utils/mix/builder.check.ts (v16.3): the builder's checks (npm run check:builder; check:mix runs it too).
//   node utils/mix/builder.check.ts            the checks
//   node utils/mix/builder.check.ts --bench    plus the summary's cost at 450 / 1,000 / 5,000 tracks
// Every expectation is computed here by an oracle written for this file, never by the builder's own helpers.
// Synthetic tracks only (tone-NNNN); the golden fixtures come from scripts/mix-golden/fixture.mjs.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Song } from '../../types.ts';
import * as B from './builder.ts';
import * as R from './recipes.ts';
import { MIXES, mixCounts } from './catalog.ts';
import type { MixId } from './catalog.ts';
import { ALL_CRYSTALS } from './distribution.ts';
import { PRESETS, GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS, SOLFEGGIO_INFO, LO_SHU_WALKS } from '../crystalData.ts';
import { buildFacetIndex, NO_FILTERS, withFacet } from '../library/filterModel.ts';
// @ts-ignore: a plain .mjs module (the golden harness's fixtures)
import { buildFixtures, buildHistory, mulberry32 } from '../../scripts/mix-golden/fixture.mjs';

let passed = 0;
let failed = 0;
const fails: string[] = [];
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; if (fails.length < 40) fails.push(m); } };
const realLog = console.log;
const realWarn = console.warn;
const quiet = <T>(fn: () => T): T => { console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = realLog; console.warn = realWarn; } };
const ids = (a: readonly Song[] | null | undefined) => (a ? a.map((s) => s.id) : null);
const counting = (seed: number) => { const r = mulberry32(seed); const f = Object.assign(() => { f.calls++; return r(); }, { calls: 0 }); return f; };
const resultKey = (r: R.MixResult) => JSON.stringify({ ...r, order: ids(r.order) });

// ---- fixtures and random libraries --------------------------------------------------------------------------------
const FX: Record<string, Song[]> = {};
for (const [k, list] of Object.entries(buildFixtures() as Record<string, unknown[]>)) {
  FX[k] = (list as any[]).map((s, _i, a) => (typeof s === 'string' ? a[Number(s.slice(8))] : s)) as Song[];
}
const H1 = buildHistory(FX.F160) as Record<string, number>;

function randomLib(seed: number, nMax = 80): Song[] {
  const r = mulberry32(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const n = Math.floor(r() * nMax);
  const out: Song[] = [];
  for (let i = 0; i < n; i++) {
    if (out.length && r() < 0.06) { out.push(pick(out)); continue; } // a repeated entry (a playlist's, a duplicate)
    const cr = r() < 0.08 ? pick([undefined, 0, NaN, 111, 527.5, -5]) : pick(ALL_CRYSTALS);
    const s: any = { id: `17${String(Math.floor(r() * 1e9)).padStart(9, '0')}-${i}`, name: `tone-${String(i).padStart(4, '0')}`, duration: pick([0, undefined, 45, 179.99, 180, 240, 300, 420, 600, 700, NaN]) };
    if (cr !== undefined) s.closestSolfeggio = cr;
    const dev = pick([undefined, 0, 0.05, 0.08, 1, 1.05, 2, 30, 999]);
    if (dev !== undefined) s.harmonicDeviation = dev;
    if (r() < 0.7) s.fractalAnalysis = r() < 0.1 ? null : { goldenRatioAlignment: pick([0, 0.05, 0.1, 0.15, 0.29, 0.3, 0.31, 0.5, 0.9, NaN]), dnaResonanceScore: pick([0, 0.1, 0.25, 0.3, 0.31, 0.6]), pattern111Presence: pick([0, 0.1, 0.2, 0.21, 0.5]), sacredGeometryAlignment: pick([0, 0.2, 0.5]) };
    if (r() < 0.3) s.isAetheriaCandidate = r() < 0.5;
    if (r() < 0.4) { s.chromaVersion = 1; s.musicKey = pick(['Am', 'C', '']); s.keyConfidence = pick([0.3, 0.6, 0.8]); }
    if (r() < 0.5) s.visualEnvelope = { bass: { length: r() < 0.9 ? 40 : 0 } };
    out.push(s as Song);
  }
  return out;
}

// ---- the recipes, as each Mixes-tab mix calls them -----------------------------------------------------------------
const recipeOf = (id: MixId | 'walk:traditional') => (input: R.MixInput): R.MixResult => {
  if (id.startsWith('walk:')) return R.loShuWalk(input, id.slice(5) as any);
  if (id.startsWith('preset:')) { const p = PRESETS.find((x) => `preset:${x.id}` === id)!; return R.crystalSetMix(input, [...p.crystals], p.name); }
  const f: Record<string, (i: R.MixInput) => R.MixResult> = {
    gut: R.gutAlignment, heart: R.heartAlignment, head: R.headAlignment, ultimate: R.ultimateAlignment, full: R.fullAlignment,
    golden: R.goldenRatioMix, seq111: R.sequence111, source2178: R.sourceField,
  };
  return f[id](input);
};
const IDS = MIXES.map((m) => m.id);

// =====================================================================================================================
// A. Every Mixes-tab mix is one setting, named as the tab names it.
// =====================================================================================================================
for (const m of MIXES) {
  const s = B.settingsOf(m.id);
  ok(B.namedMixOf(s) === m.id, `A ${m.id}: namedMixOf(settingsOf) = ${B.namedMixOf(s)}`);
  ok(B.builderName(s) === m.fullName, `A ${m.id}: name "${B.builderName(s)}" vs "${m.fullName}"`);
  ok(B.orderOptions(s.follow)[0] === 'pattern', `A ${m.id}: the pattern first`);
  ok(JSON.stringify(B.normalized(s)) === JSON.stringify(s), `A ${m.id}: settingsOf is normalized`);
}
ok(new Set(IDS.map((id) => JSON.stringify(B.settingsOf(id)))).size === IDS.length, 'A: 19 distinct settings');
// No other setting names a mix: on another source, with a filter, or in another order, it is not that mix.
for (const id of IDS) {
  const s = B.settingsOf(id);
  ok(B.namedMixOf({ ...s, source: { kind: 'queue' } }) === null, `A ${id}: from the queue it is not the mix`);
  ok(B.namedMixOf({ ...s, filters: withFacet(NO_FILTERS, 'length', ['lt3'], B.BUILDER_FACETS) }) === null, `A ${id}: filtered it is not`);
  ok(B.namedMixOf({ ...s, order: 'shuffle' }) === null, `A ${id}: shuffled it is not`);
}

// =====================================================================================================================
// B. With a mix's setting, the builder returns exactly the recipe's result, random draws included.
// =====================================================================================================================
let bRuns = 0;
for (const [fname, lib] of Object.entries(FX)) {
  for (const [hname, history] of [['none', {}], ['H1', H1]] as const) {
    if (hname === 'H1' && fname !== 'F160') continue;
    for (const seed of [1, 2, 3]) {
      for (const id of [...IDS, 'walk:traditional' as const]) {
        const r1 = counting(seed);
        const want = quiet(() => recipeOf(id)({ library: lib, experience: 'beginner', history, rng: r1 }));
        const r2 = counting(seed);
        const s = id === 'walk:traditional' ? { ...B.settingsOf('walk:A'), follow: { kind: 'walk', mode: 'traditional' } as B.Follow } : B.settingsOf(id);
        const got = quiet(() => B.buildMix({ tracks: lib, history, rng: r2 }, s));
        ok(resultKey(got.result) === resultKey(want), `B ${fname}/${hname}/${seed} ${id}: result differs`);
        ok(r1.calls === r2.calls, `B ${fname} ${id}: draws ${r2.calls} vs ${r1.calls}`);
        ok(got.positions === id.startsWith('walk:'), `B ${id}: positions`);
        bRuns++;
      }
    }
  }
}

// =====================================================================================================================
// C. pickPerCrystal(k = 1) is the journeys' own pick; D. k = 3 by an independent oracle.
// =====================================================================================================================
const HEART_BY_INFO = SOLFEGGIO_INFO.filter((s) => s.freq >= 1000 && s.freq <= 3150).map((s) => s.freq).sort((a, b) => a - b);
const HEAD_BY_INFO = SOLFEGGIO_INFO.filter((s) => s.freq >= 3504).map((s) => s.freq).sort((a, b) => a - b);
ok(JSON.stringify(HEART_BY_INFO) === JSON.stringify(HEART_CRYSTALS) && JSON.stringify(HEAD_BY_INFO) === JSON.stringify(HEAD_CRYSTALS), 'C: the regime lists are the recipes\' lists');
const oracleK = (pool: readonly Song[], crystals: readonly number[], k: number, rank: (a: Song, b: Song) => number): Song[] => {
  const used = new Set<string>();
  const out: Song[] = [];
  for (const c of crystals) {
    const cand = pool.map((s, i) => ({ s, i })).filter((x) => x.s.closestSolfeggio === c && !used.has(x.s.id));
    cand.sort((a, b) => rank(a.s, b.s) || a.i - b.i);
    let n = 0;
    for (const x of cand) { if (n >= k) break; if (used.has(x.s.id)) continue; used.add(x.s.id); out.push(x.s); n++; }
  }
  return out;
};
const libs: [string, Song[]][] = [...Object.entries(FX), ...Array.from({ length: 1500 }, (_, i) => [`rnd${i}`, randomLib(1000 + i)] as [string, Song[]])];
for (const [name, lib] of libs) {
  const mi: R.MixInput = { library: lib, experience: 'beginner' };
  const g = quiet(() => R.gutAlignment(mi).order), h = quiet(() => R.heartAlignment(mi).order), d = quiet(() => R.headAlignment(mi).order), u = quiet(() => R.ultimateAlignment(mi).order);
  ok(JSON.stringify(ids(B.pickPerCrystal(lib, GUT_CRYSTALS, 1, B.rankJourney))) === JSON.stringify(ids(g) ?? []), `C ${name}: GUT`);
  ok(JSON.stringify(ids(B.pickPerCrystal(lib, HEART_CRYSTALS, 1, B.rankJourney))) === JSON.stringify(ids(h) ?? []), `C ${name}: HEART`);
  ok(JSON.stringify(ids(B.pickPerCrystal(lib, HEAD_CRYSTALS, 1, B.rankJourney))) === JSON.stringify(ids(d) ?? []), `C ${name}: HEAD`);
  ok(JSON.stringify(ids(B.pickPerCrystal(lib, ALL_CRYSTALS, 1, B.rankUltimate))) === JSON.stringify(ids(u) ?? []), `C ${name}: Ultimate`);
  for (const [set, crystals] of [['qi', PRESETS[0].crystals], ['flow', PRESETS[4].crystals], ['all', ALL_CRYSTALS]] as const) {
    const rank = set === 'all' ? B.rankUltimate : B.rankJourney;
    ok(JSON.stringify(ids(B.pickPerCrystal(lib, crystals, 3, rank))) === JSON.stringify(ids(oracleK(lib, crystals, 3, rank))), `D ${name} ${set}: k = 3`);
    const three = B.pickPerCrystal(lib, crystals, 3, rank);
    ok(new Set(three.map((s) => s.id)).size === three.length, `D ${name} ${set}: an id at most once`);
  }
}

// The builder's own choice of rule for the combinations no recipe has: a preset, a regime or a custom set with 1 or 3
// per crystal ranks as the journeys do; all 27 with 3 per crystal as Ultimate does. The rankers here are re-typed from
// recipes.ts, not the builder's.
const oJourney = (a: Song, b: Song) => { const ag = a.fractalAnalysis?.goldenRatioAlignment || 0, bg = b.fractalAnalysis?.goldenRatioAlignment || 0; return Math.abs(ag - bg) > 0.1 ? bg - ag : (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999); };
const oUltimate = (a: Song, b: Song) => {
  const ag = a.fractalAnalysis?.goldenRatioAlignment || 0, bg = b.fractalAnalysis?.goldenRatioAlignment || 0;
  if (Math.abs(ag - bg) > 0.1) return bg - ag;
  const ad = a.fractalAnalysis?.dnaResonanceScore || 0, bd = b.fractalAnalysis?.dnaResonanceScore || 0;
  return Math.abs(ad - bd) > 0.1 ? bd - ad : (a.harmonicDeviation || 999) - (b.harmonicDeviation || 999);
};
for (const [name, lib] of libs.slice(0, 600)) {
  for (const [set, crystals] of [['preset:flow', PRESETS[4].crystals], ['preset:qi', PRESETS[0].crystals], ['gut', GUT_CRYSTALS], ['custom', [174, 963, 2178]], ['all', ALL_CRYSTALS]] as [B.SetId, readonly number[]][]) {
    for (const per of [1, 3] as const) {
      if (per === 1 && set !== 'custom' && !set.startsWith('preset:')) continue; // a recipe's (section B)
      const s: B.BuilderSettings = { ...B.DEFAULT_SETTINGS, follow: set === 'custom' ? { kind: 'set', set, crystals } : { kind: 'set', set }, per };
      const got = quiet(() => B.buildMix({ tracks: lib }, s)).result.order;
      const want = oracleK(lib, crystals, per, set === 'all' ? oUltimate : oJourney);
      ok(JSON.stringify(ids(got) ?? []) === JSON.stringify(ids(want)), `D ${name} ${set} ${per} per crystal: the rule`);
    }
  }
}

// =====================================================================================================================
// E. The pool: no filters keeps every entry (the same objects, in order, repeats kept); filters by an oracle.
// =====================================================================================================================
const lenBucket = (s: Song) => { const d = s.duration as number; if (typeof d !== 'number' || !Number.isFinite(d) || !(d > 0)) return 'unknown'; return d < 180 ? 'lt3' : d < 300 ? '3to5' : d < 600 ? '5to10' : 'ge10'; };
const goldenOver = (s: Song) => { const v = (s.fractalAnalysis as any)?.goldenRatioAlignment; return typeof v === 'number' && Number.isFinite(v) && v > 0.3; };
for (const [name, lib] of libs.slice(0, 400)) {
  const p = B.poolOf(lib, NO_FILTERS);
  ok(p.length === lib.length && p.every((s, i) => s === lib[i]), `E ${name}: no filters keeps every entry`);
  const f = withFacet(withFacet(NO_FILTERS, 'length', ['lt3', '5to10'], B.BUILDER_FACETS), 'x-golden', ['over'], B.BUILDER_FACETS);
  const want = lib.filter((s) => ['lt3', '5to10'].includes(lenBucket(s)) && goldenOver(s));
  ok(JSON.stringify(ids(B.poolOf(lib, f))) === JSON.stringify(ids(want)), `E ${name}: length OR, AND the golden score`);
}
ok(!B.BUILDER_FACETS.some((f) => f.id === 'crystal'), 'E: no crystal facet (Follow picks crystals)');
// The shared cut-off (scanScores.ts, v16.2 decision 4 A): the Golden Φ mix picks exactly the tracks the "Golden ratio
// score over 30 %" chip keeps (as a multiset; Golden Φ then ranks them).
for (const [name, lib] of libs.slice(0, 600)) {
  const gold = quiet(() => R.goldenRatioMix({ library: lib, experience: 'beginner' })).order ?? [];
  const chip = B.poolOf(lib, withFacet(NO_FILTERS, 'x-golden', ['over'], B.BUILDER_FACETS));
  ok(JSON.stringify(ids(gold)!.slice().sort()) === JSON.stringify(ids(chip)!.slice().sort()), `E ${name}: Golden Φ = the golden ratio chip`);
}
ok(['x-golden', 'x-p111', 'x-dna', 'x-candidate'].every((id) => B.BUILDER_FACETS.some((f) => f.id === id)), 'E: the four experimental facets');

// =====================================================================================================================
// F. The order stage.
// =====================================================================================================================
// App's own shuffle, lifted from App.tsx (the TypeScript AST), Math.random seeded: lruShuffle must equal it.
// (TS_FROM: a checkout whose node_modules has typescript, for a copy of this file outside the repo.)
const req = createRequire(process.env.TS_FROM ? process.env.TS_FROM + '/package.json' : import.meta.url);
let appLru: ((songs: { id: string }[], h: Record<string, number>) => number[]) | null = null;
try {
  const ts = req('typescript');
  const text = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
  const sf = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const st = sf.statements.find((x: any) => ts.isVariableStatement(x) && x.declarationList.declarations.some((d: any) => d.name.getText(sf) === 'getLruShuffledIndices'));
  const js = ts.transpileModule(st.getText(sf) + '\nmodule.exports = getLruShuffledIndices;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m: any = { exports: {} };
  new Function('module', 'exports', js)(m, m.exports);
  appLru = m.exports;
} catch (e) { ok(false, 'F: could not lift getLruShuffledIndices: ' + e); }
for (let k = 0; k < 400 && appLru; k++) {
  const lib = randomLib(5000 + k, 60);
  const r = mulberry32(77 + k);
  const hist: Record<string, number> = {};
  for (const s of lib) if (r() < 0.5) hist[s.id] = [1000, 2000, 2000, 3000][Math.floor(r() * 4)];
  const realRandom = Math.random;
  Math.random = mulberry32(k + 1);
  let want: string[];
  try { want = appLru(lib, hist).map((i) => lib[i].id); } finally { Math.random = realRandom; }
  const got = B.lruShuffle(lib, hist, mulberry32(k + 1)).map((s) => s.id);
  ok(JSON.stringify(got) === JSON.stringify(want), `F ${k}: lruShuffle is App's getLruShuffledIndices`);
  const times = B.lruShuffle(lib, hist, mulberry32(k + 9)).map((s) => hist[s.id] || 0);
  ok(times.every((t, i) => i === 0 || times[i - 1] <= t), `F ${k}: least recently played first`);
}
const crystalIdx = (s: Song) => { const i = ALL_CRYSTALS.indexOf(s.closestSolfeggio as number); return i < 0 ? 99 : i; };
for (const [name, lib] of [...Object.entries(FX), ...libs.slice(10, 300)]) {
  for (const id of ['walk:C', 'walk:combined', 'preset:flow', 'golden', 'ultimate'] as MixId[]) {
    const base = B.settingsOf(id);
    const pat = quiet(() => B.buildMix({ tracks: lib, history: {}, rng: mulberry32(5) }, base));
    for (const order of B.orderOptions(base.follow)) {
      if (order === 'pattern') continue;
      const got = quiet(() => B.buildMix({ tracks: lib, history: {}, rng: mulberry32(5) }, { ...base, order }));
      if (!pat.result.order) { ok(got.result.order === null, `F ${name} ${id} ${order}: still nothing`); continue; }
      const o = got.result.order!;
      ok(JSON.stringify([...ids(o)!].sort()) === JSON.stringify([...ids(pat.result.order)!].sort()), `F ${name} ${id} ${order}: the same tracks`);
      ok(got.result.walk === null && !got.positions, `F ${name} ${id} ${order}: no longer a walk`);
      if (order === 'low-high') {
        const want = pat.result.order.map((s, i) => ({ s, i })).sort((a, b) => crystalIdx(a.s) - crystalIdx(b.s) || a.i - b.i).map((x) => x.s.id);
        ok(JSON.stringify(ids(o)) === JSON.stringify(want), `F ${name} ${id}: low to high, stable`);
      }
      if (order === 'source') {
        const first = (sid: string) => lib.findIndex((s) => s.id === sid);
        const want = pat.result.order.map((s, i) => ({ s, i })).sort((a, b) => first(a.s.id) - first(b.s.id) || a.i - b.i).map((x) => x.s.id);
        ok(JSON.stringify(ids(o)) === JSON.stringify(want), `F ${name} ${id}: source order, stable`);
      }
    }
  }
}

// =====================================================================================================================
// G. The summary: its count and length are what the build gives (any draw for the count; the seed-1 draw for a random
// walk's length), and its missing crystals, no-crystal count and name by oracles.
// =====================================================================================================================
const settingsPool: B.BuilderSettings[] = [];
for (const id of IDS) settingsPool.push(B.settingsOf(id));
for (const set of ['preset:qi', 'preset:meditation', 'gut', 'heart', 'head', 'all', 'custom'] as B.SetId[]) {
  for (const per of [1, 3, 'all'] as B.PerCrystal[]) {
    for (const order of ['pattern', 'shuffle', 'source'] as B.Order[]) {
      settingsPool.push({ ...B.DEFAULT_SETTINGS, follow: set === 'custom' ? { kind: 'set', set, crystals: [963, 174, 2178, 5] } : { kind: 'set', set }, per, order });
    }
  }
}
for (const order of ['pattern', 'low-high', 'shuffle'] as B.Order[]) settingsPool.push({ ...B.DEFAULT_SETTINGS, follow: { kind: 'any' }, order });
const filterSets = [NO_FILTERS, withFacet(NO_FILTERS, 'length', ['3to5', '5to10'], B.BUILDER_FACETS), withFacet(NO_FILTERS, 'x-golden', ['over'], B.BUILDER_FACETS), withFacet(withFacet(NO_FILTERS, 'sync', ['yes'], B.BUILDER_FACETS), 'x-p111', ['over'], B.BUILDER_FACETS)];
let gRuns = 0;
let wRuns = 0;
let lRuns = 0;
// The queued entries a mix leaves out, by an oracle of its own: each mix entry takes one source copy of its id.
const leftOracle = (source: readonly Song[], mix: readonly Song[]): number => {
  const want: Record<string, number> = {};
  for (const x of mix) want[x.id] = (want[x.id] || 0) + 1;
  let n = 0;
  for (const x of source) { if (want[x.id] > 0) want[x.id]--; else n++; }
  return n;
};
for (const [name, lib] of [...Object.entries(FX), ...libs.slice(20, 140)]) {
  const index = buildFacetIndex(lib, B.BUILDER_FACETS as any);
  for (const s0 of settingsPool) {
    for (const filters of filterSets) {
      const s = { ...s0, filters };
      const sum = B.builderSummary(index, s);
      const pool = B.poolOf(lib, filters);
      const b1 = quiet(() => B.buildMix({ tracks: lib, history: {}, rng: mulberry32(1) }, s));
      const n1 = b1.result.order ? b1.result.order.length : 0;
      ok(sum.count === n1, `G ${name} ${JSON.stringify(s.follow)}/${s.per}/${s.order}: count ${sum.count} vs ${n1}`);
      if (sum.approx) {
        const b2 = quiet(() => B.buildMix({ tracks: lib, history: H1, rng: mulberry32(99) }, s));
        ok((b2.result.order ? b2.result.order.length : 0) === sum.count, `G ${name}: a random walk's count is the same for any draw`);
      } else {
        const secs = (b1.result.order ?? []).reduce((t, x) => t + (typeof x.duration === 'number' && Number.isFinite(x.duration) && x.duration > 0 ? x.duration : 0), 0);
        ok(Math.abs(sum.seconds - secs) < 1e-6, `G ${name} ${JSON.stringify(s.follow)}: seconds ${sum.seconds} vs ${secs}`);
      }
      const onCrystal = pool.filter((x) => ALL_CRYSTALS.includes(x.closestSolfeggio as number));
      ok(sum.pool === pool.length && sum.noCrystal === pool.length - onCrystal.length, `G ${name}: pool and no-crystal counts`);
      const f = s.follow;
      const used = f.kind === 'walk' ? ALL_CRYSTALS.filter((c) => LO_SHU_WALKS[f.mode].includes(c)) : f.kind === 'set' ? B.setCrystals(f) : f.kind === 'seq111' ? [174, 396, 741, 1206, 1935, 2664, 3504, 4566, 5628] : f.kind === 'source2178' ? [2178] : [];
      const needScan = f.kind === 'seq111' || f.kind === 'source2178';
      const wantMissing = used.filter((c) => !onCrystal.some((x) => x.closestSolfeggio === c && (!needScan || x.fractalAnalysis)));
      ok(JSON.stringify(sum.missing) === JSON.stringify(wantMissing), `G ${name} ${JSON.stringify(f)}: missing ${sum.missing} vs ${wantMissing}`);
      ok(sum.walk === (!!b1.result.walk && s.order === 'pattern'), `G ${name}: walk flag`);
      ok(sum.approx === (f.kind === 'walk' && ['combined', 'ouroboros', 'cabi'].includes(f.mode)), `G ${name}: only a random walk's length is one draw's`);
      ok(sum.named === (s.source.kind === 'library' && filters === NO_FILTERS ? B.mixShapeOf(s) : null), `G ${name}: named`);
      gRuns++;
    }
  }
  // v16.3 review: the walk choices' counts (walkCounts, from the pool's crystals) are each walk's summary count, and
  // from the queue the summary's "left" is the queued entries the build leaves out (an oracle of its own; one draw's
  // for a random walk, so only its range there).
  for (const filters of filterSets) {
    const wc = B.walkCounts(B.poolOf(lib, filters));
    for (const mode of ['A', 'B', 'C', 'combined', 'ouroboros', 'cabi'] as const) {
      const want = B.builderSummary(index, { ...B.DEFAULT_SETTINGS, filters, follow: { kind: 'walk', mode } }).count;
      ok(wc[mode] === want, `G ${name} walk ${mode}: walkCounts ${wc[mode]} vs the summary's ${want}`);
      wRuns++;
    }
  }
  if (lRuns < 40 * 2 * settingsPool.length) {
    for (const s0 of settingsPool) {
      for (const filters of [filterSets[0], filterSets[1]]) {
        const s = { ...s0, filters, source: { kind: 'queue' } as B.SourceRef };
        const sum = B.builderSummary(index, s, 'your queue');
        const b1 = quiet(() => B.buildMix({ tracks: lib, history: {}, rng: mulberry32(1) }, s, 'your queue'));
        if (sum.approx) ok(sum.left >= 0 && sum.left <= lib.length, `G ${name}: left in range`);
        else ok(sum.left === leftOracle(lib, b1.result.order ?? []), `G ${name} ${JSON.stringify(s.follow)}/${s.per}: left ${sum.left} vs ${leftOracle(lib, b1.result.order ?? [])}`);
        ok(B.builderSummary(index, { ...s, source: { kind: 'library' } }).left === 0, `G ${name}: left is 0 for the library`);
        lRuns++;
      }
    }
  }
}
// The Mixes tab's own counts agree with the builder's on the library (mixCounts is v15.9's live count).
for (const [name, lib] of Object.entries(FX)) {
  const index = buildFacetIndex(lib, B.BUILDER_FACETS as any);
  const mc = mixCounts(lib);
  for (const id of IDS) ok(B.builderSummary(index, B.settingsOf(id)).count === mc[id], `G ${name} ${id}: the tab's count ${mc[id]}`);
}

// =====================================================================================================================
// H. Saved settings: a round trip, and hostile values.
// =====================================================================================================================
for (const s of settingsPool.slice(0, 80)) {
  const t = B.serializeBuilderSettings(s);
  ok(B.serializeBuilderSettings(B.parseBuilderSettings(t)) === t, `H: round trip ${t}`);
}
const ser = (s: B.BuilderSettings) => B.serializeBuilderSettings(s);
const D0 = ser(B.DEFAULT_SETTINGS);
for (const raw of [null, 7, '', 'x'.repeat(5000), '{', '[]', '{"v":2}', '{"v":1,"follow":{"kind":"walk","mode":"Z"}}', '{"v":1,"follow":"walk"}',
  '{"v":1,"source":{"kind":"playlist","id":"__proto__"}}', '{"v":1,"per":2}', '{"v":1,"order":"random"}', '{"__proto__":{"v":1}}']) {
  const p = B.parseBuilderSettings(raw);
  ok(ser(p).length < 4096, `H: ${String(raw).slice(0, 30)} parses safely`);
  if (raw !== '{"v":1,"follow":{"kind":"walk","mode":"Z"}}' && typeof raw === 'string' && !raw.startsWith('{"v":1,')) ok(ser(p) === D0, `H: ${String(raw).slice(0, 30)} → the default`);
}
{
  const p = B.parseBuilderSettings('{"v":1,"source":{"kind":"playlist","id":"__proto__"},"follow":{"kind":"set","set":"custom","crystals":[963,174,174,5,"528",2178]},"per":3,"order":"source","f":{"crystal":["528"],"length":["lt3","nope"],"x-golden":["under","over"]}}');
  ok(p.source.kind === 'library', 'H: a bad playlist id falls back to the library');
  ok(p.follow.kind === 'set' && JSON.stringify(B.setCrystals(p.follow as any)) === '[174,963,2178]', 'H: custom crystals: the 27 only, once, ascending');
  ok(!('crystal' in p.filters) && JSON.stringify(p.filters.length) === '["lt3"]' && JSON.stringify(p.filters['x-golden']) === '["over"]', 'H: filters by the builder\'s facets (no crystal; hidden values dropped)');
  ok(p.per === 3 && p.order === 'source', 'H: per and order kept');
  const c2 = B.parseBuilderSettings(B.serializeBuilderSettings({ ...B.DEFAULT_SETTINGS, follow: { kind: 'set', set: 'custom', crystals: [639, 528] } }));
  ok(c2.follow.kind === 'set' && JSON.stringify(B.setCrystals(c2.follow as any)) === '[528,639]', 'H: a custom set is saved with its crystals');
  const w = B.parseBuilderSettings('{"v":1,"follow":{"kind":"walk","mode":"C"},"per":3,"order":"source"}');
  ok(w.per === 'all' && w.order === 'source', 'H: a walk has no per; its orders include the source');
  const a = B.parseBuilderSettings('{"v":1,"follow":{"kind":"any"},"order":"source"}');
  ok(a.order === 'pattern', 'H: any crystal: its pattern is the source order');
}

// =====================================================================================================================
// I. Purity, names, edges.
// =====================================================================================================================
{
  const lib = randomLib(424242, 120);
  const deep = (o: any) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deep(v); return o; };
  const before = JSON.stringify(lib);
  deep(lib);
  let threw = false;
  try {
    const index = buildFacetIndex(lib, B.BUILDER_FACETS as any);
    for (const s of settingsPool.slice(0, 60)) { quiet(() => B.buildMix({ tracks: lib, history: {}, rng: mulberry32(3) }, { ...s, filters: filterSets[1] })); B.builderSummary(index, s); }
  } catch (e) { threw = true; }
  ok(!threw && JSON.stringify(lib) === before, 'I: frozen inputs, nothing written');
}
ok(B.builderName({ ...B.DEFAULT_SETTINGS, per: 1 }) === 'Grounding · 1 per crystal', 'I: name with per');
ok(B.builderName({ ...B.settingsOf('walk:C'), order: 'shuffle', source: { kind: 'playlist', id: 'pabcdef12' } }, 'Evening') === 'Flying Star Vortex · shuffled · from Evening', 'I: name with order and source');
ok(B.builderName({ ...B.settingsOf('walk:C'), filters: withFacet(NO_FILTERS, 'x-golden', ['over'], B.BUILDER_FACETS) }) === 'Flying Star Vortex · Golden ratio score over 30 %', 'I: a score filter in words');
ok(B.builderName({ ...B.settingsOf('preset:qi'), order: 'source', source: { kind: 'queue' } }, 'your queue') === 'Grounding · in queue order · from your queue', 'I: queue order');
ok(B.builderName({ ...B.DEFAULT_SETTINGS, follow: { kind: 'set', set: 'custom', crystals: [528, 639] } }) === 'Custom: 528 · 639 Hz', 'I: a custom set');
{
  const long = B.builderName({ ...B.DEFAULT_SETTINGS, follow: { kind: 'set', set: 'custom', crystals: [528, 639, 741] }, per: 3, order: 'shuffle', source: { kind: 'playlist', id: 'pabcdef12' }, filters: withFacet(withFacet(withFacet(NO_FILTERS, 'length', ['lt3', '3to5', '5to10'], B.BUILDER_FACETS), 'x-golden', ['over'], B.BUILDER_FACETS), 'x-dna', ['over'], B.BUILDER_FACETS) }, 'A playlist with a rather long name indeed');
  ok(long.length <= 80 && long.endsWith('…'), `I: names stop at 80 characters (${long.length})`);
}
{
  const empty = quiet(() => B.buildMix({ tracks: [] }, B.DEFAULT_SETTINGS));
  ok(empty.result.order === null && !!empty.result.toast, 'I: an empty source gives no order, with the recipe\'s toast');
  const none = quiet(() => B.buildMix({ tracks: FX.F160 }, { ...B.DEFAULT_SETTINGS, follow: { kind: 'set', set: 'custom', crystals: [] } }));
  ok(none.result.order === null && none.result.toast?.text === B.BUILDER_EMPTY_TEXT, 'I: a custom set with no crystal gives nothing');
  const any = quiet(() => B.buildMix({ tracks: FX.F160d }, { ...B.DEFAULT_SETTINGS, follow: { kind: 'any' } }));
  ok(!!any.result.order && any.result.order.every((s) => ALL_CRYSTALS.includes(s.closestSolfeggio as number)) && any.result.order.length === FX.F160d.filter((s) => ALL_CRYSTALS.includes(s.closestSolfeggio as number)).length, 'I: any crystal: every entry with one of the 27, repeats kept');
  const dupAll = quiet(() => B.buildMix({ tracks: FX.F160d }, { ...B.DEFAULT_SETTINGS, follow: { kind: 'set', set: 'heart' }, per: 'all' }));
  const dup3 = quiet(() => B.buildMix({ tracks: FX.F160d }, { ...B.DEFAULT_SETTINGS, follow: { kind: 'set', set: 'heart' }, per: 3 }));
  ok(dupAll.result.order!.length === FX.F160d.filter((s) => HEART_CRYSTALS.includes(s.closestSolfeggio as number)).length, 'I: all per crystal keeps a repeated entry');
  ok(new Set(dup3.result.order!.map((s) => s.id)).size === dup3.result.order!.length, 'I: 3 per crystal uses a track once');
}

// v16.3 review: a stored deviation that is not a number (a string) never throws: the SOURCE recipe's log line reads it
// only as a number (it logs N/A), so the summary, the walk counts and the build run on.
{
  const hostile = FX.F160.map((x, i) => (i % 7 === 0 ? ({ ...x, closestSolfeggio: 2178, harmonicDeviation: '1.5' as any, fractalAnalysis: x.fractalAnalysis ?? { goldenRatioAlignment: 0.4, sacredGeometryAlignment: 0.2 } } as Song) : x));
  const index = buildFacetIndex(hostile, B.BUILDER_FACETS as any);
  let threw: unknown = null;
  let n = -1;
  try {
    n = B.builderSummary(index, B.settingsOf('source2178')).count;
    quiet(() => B.buildMix({ tracks: hostile }, B.settingsOf('source2178')));
    B.walkCounts(hostile);
  } catch (e) { threw = e; }
  ok(threw === null && n === hostile.filter((x) => x.closestSolfeggio === 2178 && x.fractalAnalysis).length, `I: a string deviation never throws (${String(threw)})`);
}
{
  const t = (id: string) => ({ id });
  const q = [t('a'), t('b'), t('a'), t('c'), t('d')];
  ok(JSON.stringify(B.leftOut(q, [t('a'), t('c'), t('a'), t('a')]).map((x) => x.id)) === '["b","d"]', 'I: leftOut: a repeated pick takes no more copies than queued');
  ok(JSON.stringify(B.leftOut(q, [t('a')]).map((x) => x.id)) === '["b","a","c","d"]', 'I: leftOut: one copy picked, the later one left, in queue order');
  ok(B.leftOut(q, []).length === 5 && B.leftOut([], q).length === 0, 'I: leftOut: edges');
}

realLog(`builder.check: ${passed} passed, ${failed} failed (B: ${bRuns} recipe comparisons; G: ${gRuns} summaries, ${wRuns} walk counts, ${lRuns} queue left-outs)`);
for (const f of fails) realLog('FAIL', f);

if (process.argv.includes('--bench')) {
  const NAMES = (i: number) => `tone-${String(i).padStart(4, '0')}`;
  const big = (n: number): Song[] => Array.from({ length: n }, (_, i) => ({
    id: `177100000${i}-x`, name: NAMES(i), duration: 90 + ((i * 37) % 600), closestSolfeggio: i % 41 === 0 ? undefined : ALL_CRYSTALS[(i * 7) % 27],
    harmonicFreq: 1, harmonicDeviation: (i % 9) + 1, crystalSource: i % 5 === 0 ? 'scan' : 'assigned',
    fractalAnalysis: i % 5 === 0 ? { goldenRatioAlignment: (i % 10) / 10, dnaResonanceScore: (i % 7) / 7, pattern111Presence: (i % 4) / 4, sacredGeometryAlignment: 0.2 } : undefined,
  } as any));
  const time = (fn: () => unknown, reps: number) => { fn(); fn(); const t0 = performance.now(); for (let i = 0; i < reps; i++) fn(); return +((performance.now() - t0) / reps).toFixed(3); };
  for (const n of [450, 1000, 5000]) {
    const lib = big(n);
    let index = buildFacetIndex(lib, B.BUILDER_FACETS as any);
    const row: Record<string, number> = { index: time(() => { index = buildFacetIndex(lib, B.BUILDER_FACETS as any); }, 10) };
    for (const [label, s] of [
      ['preset all', B.settingsOf('preset:qi')], ['GUT 1', B.settingsOf('gut')], ['set 3 + 2 filters', { ...B.DEFAULT_SETTINGS, per: 3 as const, filters: filterSets[3] }],
      ['Vortex', B.settingsOf('walk:C')], ['CAB', B.settingsOf('walk:combined')], ['CABI', B.settingsOf('walk:cabi')], ['Ultimate', B.settingsOf('ultimate')],
      ['Golden', B.settingsOf('golden')], ['111', B.settingsOf('seq111')], ['any, shuffled', { ...B.DEFAULT_SETTINGS, follow: { kind: 'any' } as B.Follow, order: 'shuffle' as const }],
    ] as [string, B.BuilderSettings][]) row[`summary ${label}`] = time(() => B.builderSummary(index, s), 10);
    row['build CAB at the tap'] = time(() => quiet(() => B.buildMix({ tracks: lib, history: {}, rng: Math.random }, B.settingsOf('walk:combined'))), 5);
    realLog(`bench n=${n}: ${JSON.stringify(row)}`);
  }
}
if (failed) process.exit(1);
