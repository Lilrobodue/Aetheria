// utils/mix/mix.check.ts (v15.8): the recipes' own rules, without App. `node utils/mix/mix.check.ts` (npm run check:mix).
// The fixtures are the golden harness's (scripts/mix-golden/fixture.mjs, synthetic names only).
import { strict as assert } from 'node:assert';
import {
  gutAlignment, heartAlignment, headAlignment, fullAlignment, crystalSetMix, goldenRatioMix, sequence111, sourceField,
  ultimateAlignment, loShuWalk, walkStepAt,
} from './recipes.ts';
import type { MixInput, MixResult } from './recipes.ts';
import { planAssign } from './distribution.ts';
import { SOLFEGGIO_INFO, LO_SHU_WALKS, GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS, PRESETS, LO_SHU_WALK_COMBINED } from '../crystalData.ts';
// @ts-ignore: the harness's fixture is plain .mjs (no types)
import { buildFixtures, buildHistory, mulberry32 } from '../../scripts/mix-golden/fixture.mjs';

let checks = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; };
const realLog = console.log, realWarn = console.warn;
console.log = () => {}; console.warn = () => {};

const fx = buildFixtures();
const lib = fx.F160;
const H1 = buildHistory(lib) as Record<string, number>;
const deepFreeze = <T,>(o: T): T => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); } return o; };
const frozen = deepFreeze(JSON.parse(JSON.stringify(lib)));
const MODES = ['A', 'B', 'C', 'traditional', 'combined', 'ouroboros', 'cabi'] as const;
const all = (input: MixInput): Record<string, MixResult> => ({
  gut: gutAlignment(input), heart: heartAlignment(input), head: headAlignment(input), full: fullAlignment(input),
  ...Object.fromEntries(PRESETS.map((p) => [`preset:${p.id}`, crystalSetMix(input, p.crystals, p.name)])),
  golden: goldenRatioMix(input), seq111: sequence111(input), source: sourceField(input), ultimate: ultimateAlignment(input),
  ...Object.fromEntries(MODES.map((m) => [`walk:${m}`, loShuWalk(input, m)])),
});

// 1. Crystal data agrees with constants.ts.
ok(JSON.stringify([...GUT_CRYSTALS, ...HEART_CRYSTALS, ...HEAD_CRYSTALS]) === JSON.stringify(SOLFEGGIO_INFO.map((s) => s.freq)), 'the regime lists are SOLFEGGIO_INFO');
ok(JSON.stringify(LO_SHU_WALKS.traditional) === JSON.stringify(GUT_CRYSTALS), 'GUT Alignment\'s order is the traditional walk');
ok(PRESETS.every((p) => p.crystals.every((c) => GUT_CRYSTALS.includes(c))), 'presets are GUT crystals');

// 2. Pure: a frozen library (any write throws), the same seed twice → the same result; history never written.
const histCopy = JSON.stringify(H1);
const seeded = (seed: number, history?: Record<string, number>): MixInput => ({ library: frozen, experience: 'beginner', history, rng: mulberry32(seed) });
const a1 = all(seeded(7, H1));
const a2 = all(seeded(7, H1));
ok(JSON.stringify(a1) === JSON.stringify(a2), 'deterministic for a seed');
ok(JSON.stringify(H1) === histCopy, 'history untouched');
ok(JSON.stringify(all(seeded(7))) !== JSON.stringify(all(seeded(8))), 'the seed reaches the walks');
ok(JSON.stringify(loShuWalk(seeded(7), 'combined')) !== JSON.stringify(loShuWalk(seeded(7, H1), 'combined')), 'the history reaches the walks');

// 3. The rng is the injected one: with Math.random throwing, every recipe and the distributor still run.
const realRandom = Math.random;
Math.random = () => { throw new Error('Math.random used'); };
try {
  all(seeded(3, H1));
  planAssign(JSON.parse(JSON.stringify(fx.F160u))); // v15.8: Assign draws no random number at all (distribution.check.ts)
  checks++;
} finally {
  Math.random = realRandom;
}

// 4. Shape: order XOR toast; entries are the library's own objects; steps fill the sequence positions.
for (const [name, r] of Object.entries(a1)) {
  ok((r.order === null) === (r.toast !== null), `${name}: order xor toast`);
  if (!r.order) continue;
  ok(r.order.every((s) => frozen.includes(s)), `${name}: entries are library objects`);
  if (r.walk) {
    const seq = LO_SHU_WALKS[r.walk.mode];
    const st = r.walk.steps;
    ok(st.length === r.order.length, `${name}: one step per entry`);
    ok(st.every((s, i) => i === 0 || s > st[i - 1]), `${name}: steps increase`);
    ok(r.order.every((s, i) => s.closestSolfeggio === seq[st[i]]), `${name}: each entry is its step's crystal`);
    const have = new Set(frozen.filter((s) => s.closestSolfeggio).map((s) => s.closestSolfeggio));
    ok(JSON.stringify(st) === JSON.stringify(seq.map((f, j) => (have.has(f) ? j : -1)).filter((j) => j >= 0)), `${name}: a position is skipped exactly when no track has its crystal`);
    if (r.segmentsAndPhases?.segments) ok(r.segmentsAndPhases.segments.reduce((x, y) => x + y, 0) === r.order.length, `${name}: segments add up`);
    if (r.segmentsAndPhases?.phases) ok(r.segmentsAndPhases.phases.length === r.order.length, `${name}: one phase per entry`);
  }
}
ok(a1['walk:cabi'].walk!.steps.some((s) => s >= LO_SHU_WALK_COMBINED.length), 'cabi\'s Ouroboros steps sit after the CAB');

// 5. walkStepAt.
ok(walkStepAt(null, 5) === 5 && walkStepAt([0, 2, 3], 1) === 2 && walkStepAt([0, 2], 4) === 4 && walkStepAt([0, 2], -1) === -1, 'walkStepAt');

console.log = realLog; console.warn = realWarn;
console.log(`mix.check: ${checks} checks passed`);
