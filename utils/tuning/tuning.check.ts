// utils/tuning/tuning.check.ts (v16.8.3 "Track Tuning"). `node utils/tuning/tuning.check.ts` (npm run check:tuning, and
// check:mix).
//
// The pure half of a track's tuning (utils/tuning/trackTuning.ts), arm by arm:
//   - the constants: the ±50 limit, the fit's edge equal to keyBands' KEY_EDGES[0];
//   - validTuning's edges (0, ±1, ±50, ±51, 2.5, NaN, a tuneFor not one of the 27, …);
//   - tuneRate and trackRate: the Standard identity (Object.is(trackRate(untuned), PITCH_SHIFT_FACTOR): the same float),
//     every valid shift exactly tuneRate(c), the clamp's bounds, totality (throwing getters, proxies, odd inputs);
//   - fitShift against a full scan restated here (every whole cent in ±50, the rule's two passes in |s| order), on the
//     committed fixture (tuning.fixture.json: 12 synthetic renders' key readings) × the 27 crystals' tones; the fixture
//     holds tie cases and cases where the 0.30 pass wins over a smaller 0.35 shift; the limit argument; bad inputs;
//     its answer is band 0 in keyBands at that tuning;
//   - tuneLabel / tuneChip / tuneSpoken / speedPercent;
//   - withTrackTuning / tuneById: both fields together, or both removed.
//   - the composing guide's table (composeTable.ts, generated): 27 crystals, each with at least two options; every
//     option within ±45 c; its Hz 440·2^(c/1200) to 0.1; the keys valid; A1's Lo Shu sets on exactly the six; its sha256;
//     and the page's lines (compose.ts).
//   - Amendment A1 (the Lo Shu fit): the six swapped crystals and their tones from canonicalLayerHz (equal to the shell's
//     PERFECT_GUT_MAP), fitShift at the six Lo Shu tones against the same full scan, tuneLoShu valid only with the six
//     and never changing the rate.
//   - Fix round 1: offeredShift (S1: 0 for a key already within the edge at Standard, else fitShift); the Lo Shu tone on
//     an output (S2: the phone's octave); restoredTuning reads each field once (N5); the chip's spoken name (N2); the
//     Compose page's phone line, on the computed set (S2).
// Synthetic data only; no Math.random.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  FIT_REL_EDGE, FIT_REL_MARGIN, LIVE_TUNE_SWITCH, LO_SHU_CRYSTALS, TUNE_LIMIT_CENTS, TUNE_MAX_RATE, TUNE_MIN_RATE, fitShift, loShuHz, loShuTone, offeredShift, relAt, signed, solfeggioTone, speedPercent,
  restoredTuning, trackRate, tuneById, tuningChipText, tuneChip, tuneChipName, tuneLabel, tuneRate, tuneSpoken, validLoShu, validTuning, withTrackTuning,
} from './trackTuning.ts';
import { PERFECT_GUT_MAP } from '../../components/shell/shellModel.ts';
import { PITCH_SHIFT_FACTOR } from '../../constants.ts';
import { ALL_CRYSTALS } from '../mix/distribution.ts';
import { musicFit, toneOf } from '../soundV2/aetheria_sound_v2.ts';
import { canonicalLayerHz } from '../soundV2/layerHost.ts';
import { BANDS_DEF, KEY_EDGES, songBands } from '../mix/keyBands.ts';
import { createHash } from 'node:crypto';
import { COMPOSE_LIMIT_CENTS, COMPOSE_PER_CRYSTAL, COMPOSE_TABLE } from './composeTable.ts';
import { COMPOSE_GROUPS, COMPOSE_NONE, at440Line, composeEntry, composeLines, composeStart, crystalPhoneDiffers, keyText, loShuPhoneDiffers, optionLine, phoneOctaveUp } from './compose.ts';

let checks = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepStrictEqual(a, b, msg); checks++; };
const same = (a: number, b: number, msg: string) => { assert.ok(Object.is(a, b), `${msg} (${a} vs ${b})`); checks++; };
const realRandom = Math.random;
Math.random = () => { throw new Error('Math.random used'); };

const PSF = 0.981818; // constants.ts's PITCH_SHIFT_FACTOR, restated

// ---- 1. the constants ---------------------------------------------------------------------------------------------
eq(TUNE_LIMIT_CENTS, 50, 'the limit is ±50 cents (decision T2)');
same(PITCH_SHIFT_FACTOR, PSF, 'Standard is 0.981818');
eq([FIT_REL_MARGIN, FIT_REL_EDGE], [0.3, 0.35], 'rule c: 0.30, else 0.35');
eq(FIT_REL_EDGE, KEY_EDGES[0], 'the fit\'s edge is keyBands\' band 0 (Key fit\'s no-duck edge)');
eq(typeof LIVE_TUNE_SWITCH, 'boolean', 'LIVE_TUNE_SWITCH is one constant');
eq(ALL_CRYSTALS.length, 27, '27 crystals');

// ---- 2. validTuning -----------------------------------------------------------------------------------------------
const t = (tuneCents: unknown, tuneFor: unknown = 963) => ({ tuneCents, tuneFor });
const edges: Array<[string, unknown, number | null]> = [
  ['0 cents (Standard is no tuning)', t(0), null],
  ['−0 cents', t(-0), null],
  ['+1', t(1), 1],
  ['−1', t(-1), -1],
  ['+50', t(50), 50],
  ['−50', t(-50), -50],
  ['+51', t(51), null],
  ['−51', t(-51), null],
  ['2.5', t(2.5), null],
  ['−49.9', t(-49.9), null],
  ['NaN', t(NaN), null],
  ['Infinity', t(Infinity), null],
  ["'10' (a string)", t('10'), null],
  ['null cents', t(null), null],
  ['no cents', { tuneFor: 963 }, null],
  ['tuneFor 1000 (not a crystal)', t(10, 1000), null],
  ['tuneFor 963.5', t(10, 963.5), null],
  ['tuneFor 111 (not one of the 27)', t(10, 111), null],
  ['tuneFor 519 (a Lo Shu Perfect tone, not a crystal)', t(10, 519), null],
  ["tuneFor '963'", t(10, '963'), null],
  ['no tuneFor', { tuneCents: 10 }, null],
  ['null', null, null],
  ['undefined', undefined, null],
  ['a number', 12, null],
  ['a string', 'x', null],
  ['an empty object', {}, null],
];
for (const [name, s, want] of edges) eq(validTuning(s as never), want, `validTuning: ${name}`);
for (const f of ALL_CRYSTALS) eq(validTuning(t(-7, f)), -7, `validTuning: tuneFor ${f} is a crystal`);
for (let c = -60; c <= 60; c++) eq(validTuning(t(c, 2178)), c !== 0 && Math.abs(c) <= 50 ? c : null, `validTuning: ${c} cents`);

// ---- 3. tuneRate and trackRate ------------------------------------------------------------------------------------
same(tuneRate(0), PITCH_SHIFT_FACTOR, 'tuneRate(0) is PITCH_SHIFT_FACTOR itself');
for (let c = -50; c <= 50; c++) {
  if (c === 0) continue;
  same(tuneRate(c), PSF * Math.pow(2, c / 1200), `tuneRate(${c}) = PSF × 2^(c/1200)`);
  same(trackRate(t(c, 528)), tuneRate(c), `trackRate of a ${c}-cent tuning is tuneRate(${c})`);
}
ok(tuneRate(-1) < PSF && tuneRate(1) > PSF && tuneRate(-50) < tuneRate(-49) && tuneRate(49) < tuneRate(50), 'tuneRate rises with the cents');
same(TUNE_MIN_RATE, tuneRate(-50), 'the clamp: tuneRate(−50)');
same(TUNE_MAX_RATE, tuneRate(50), 'the clamp: tuneRate(+50)');
ok(Math.abs(TUNE_MIN_RATE / PSF - 0.97153) < 1e-5 && Math.abs(TUNE_MAX_RATE / PSF - 1.02930) < 1e-5, 'the clamp: 2.85 % slower to 2.93 % faster');
// The Standard identity: the same float, for every input that isn't a valid tuning.
const throwing = { get tuneCents(): number { throw new Error('boom'); }, tuneFor: 528 };
const throwingFor = { tuneCents: 10, get tuneFor(): number { throw new Error('boom'); } };
const proxy = new Proxy({}, { get() { throw new Error('proxy'); }, has() { throw new Error('proxy'); } });
const untuned: Array<[string, unknown]> = [
  ['undefined', undefined], ['null', null], ['{}', {}], ['a Song without the fields', { id: 'a', name: 'b', closestSolfeggio: 528 }],
  ['0 cents', t(0)], ['51 cents', t(51)], ['−51 cents', t(-51)], ['2.5 cents', t(2.5)], ['NaN', t(NaN)], ['Infinity', t(Infinity)], ['−Infinity', t(-Infinity)],
  ['tuneFor 1000', t(10, 1000)], ['no tuneFor', { tuneCents: 10 }], ['a string', 'abc'], ['a number', 5], ['true', true],
  ['a throwing getter', throwing], ['a throwing tuneFor', throwingFor], ['a throwing proxy', proxy], ['an array', [10, 528]],
];
for (const [name, s] of untuned) same(trackRate(s as never), PITCH_SHIFT_FACTOR, `trackRate(${name}) is PITCH_SHIFT_FACTOR`);
for (const c of [-50, -1, 1, 50]) { const r = trackRate(t(c, 174)); ok(r >= TUNE_MIN_RATE && r <= TUNE_MAX_RATE, `trackRate(${c}) within the clamp`); }
// O(1): a million calls on a tuned track take well under a second (it never computes a fit).
{
  const s = t(-14, 963);
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 1_000_000; i++) acc += trackRate(s);
  const ms = performance.now() - t0;
  ok(ms < 1500 && acc > 0, `trackRate is O(1): 1e6 calls in ${ms.toFixed(0)} ms`);
}

// ---- 4. fitShift against a full scan --------------------------------------------------------------------------------
// The tones: keyBands' (the canonical Solfeggio tone for headphones, never Lo Shu's), restated.
const TONES = ALL_CRYSTALS.map((f) => toneOf(canonicalLayerHz(f, false).f, 'headphones'));
for (let i = 0; i < 27; i++) same(solfeggioTone(ALL_CRYSTALS[i]), TONES[i], `solfeggioTone(${ALL_CRYSTALS[i]})`);
for (let i = 0; i < 27; i++) same(BANDS_DEF.tones[i], TONES[i], `keyBands' tone ${ALL_CRYSTALS[i]} is the one fitShift fits`);
// A1: the six Lo Shu tones, the device's (canonicalLayerHz(f, true)) for headphones.
eq([...LO_SHU_CRYSTALS], Object.keys(PERFECT_GUT_MAP).map(Number).sort((a, b) => a - b), 'A1: the six swapped crystals are the shell’s PERFECT_GUT_MAP keys');
for (const f of ALL_CRYSTALS) {
  const lo = PERFECT_GUT_MAP[f];
  eq(loShuHz(f), lo === undefined ? null : lo, `A1: loShuHz(${f})`);
  eq(loShuTone(f), lo === undefined ? null : toneOf(lo, 'headphones'), `A1: loShuTone(${f})`);
}
eq([loShuHz(111), loShuHz(1000), loShuTone(75)], [null, null, null], 'A1: not a crystal: no Lo Shu tone');
const LO_TONES = LO_SHU_CRYSTALS.map((f) => toneOf(canonicalLayerHz(f, true).f, 'headphones'));
ok(LO_TONES.every((x, i) => x !== TONES[ALL_CRYSTALS.indexOf(LO_SHU_CRYSTALS[i])]), 'A1: each Lo Shu tone differs from its Solfeggio tone');
const FIX = JSON.parse(readFileSync(new URL('./tuning.fixture.json', import.meta.url), 'utf8')) as { reads: Array<{ chroma: number[]; chromaA4Hz: number }> };
ok(FIX.reads.length >= 10, `the fixture: ${FIX.reads.length} readings`);
/** The rule restated: every whole cent's rel, then the two passes in |s| order, the negative first. */
function scan(chroma: number[], a4: number, tone: number, lim = 50): { want: number | null; rels: Map<number, number> } {
  const rels = new Map<number, number>();
  for (let s = -lim; s <= lim; s++) rels.set(s, musicFit(tone, chroma, a4 * (s === 0 ? PSF : PSF * Math.pow(2, s / 1200))).rel);
  const order: number[] = [0];
  for (let a = 1; a <= lim; a++) order.push(-a, a);
  const first = (edge: number) => { for (const s of order) if ((rels.get(s) as number) <= edge) return s; return null; };
  return { want: first(0.3) ?? first(0.35), rels };
}
let zeros = 0, nulls = 0, shifts = 0, ties = 0, orderWins = 0, edgeOnly = 0, n = 0;
const fixtureShifts: Array<number | null> = [];
// The 27 Solfeggio tones, then (A1) the six Lo Shu tones.
const ALL_TONES = [...TONES, ...LO_TONES];
const toneName = (i: number) => (i < 27 ? `${ALL_CRYSTALS[i]} Hz` : `Lo Shu ${PERFECT_GUT_MAP[LO_SHU_CRYSTALS[i - 27]]} Hz`);
const loShu = { zeros: 0, nulls: 0, shifts: 0 };
for (const r of FIX.reads) {
  for (let i = 0; i < ALL_TONES.length; i++) {
    const got = fitShift(r.chroma, r.chromaA4Hz, ALL_TONES[i]);
    const { want, rels } = scan(r.chroma, r.chromaA4Hz, ALL_TONES[i]);
    if (i >= 27) { if (got === null) loShu.nulls++; else if (got === 0) loShu.zeros++; else loShu.shifts++; }
    fixtureShifts.push(got);
    n++;
    if (got !== want) assert.fail(`fitShift on reading ${n} at ${toneName(i)}: ${got}, the full scan says ${want}`);
    checks++;
    if (got === null) { nulls++; continue; }
    if (got === 0) zeros++; else shifts++;
    const rel = rels.get(got) as number;
    if (relAt(r.chroma, r.chromaA4Hz, ALL_TONES[i], got) !== rel) assert.fail('relAt is the scan\'s rel');
    // Track info, keyBands and Key fit agree: at the answer the crystal is band 0 in the track's own bands (M1).
    if (i < 27) {
      const tuned = { chroma: r.chroma, chromaA4Hz: r.chromaA4Hz, ...(got === 0 ? {} : { tuneCents: got, tuneFor: ALL_CRYSTALS[i] }) };
      if (songBands(tuned)[i] !== 0) assert.fail(`fitShift's ${got} at ${toneName(i)}: keyBands' band there is ${songBands(tuned)[i]}, not 0`);
      checks++;
    }
    // A tie: both −|s| and +|s| meet the edge the answer met.
    const edge = rel <= 0.3 ? 0.3 : 0.35;
    if (got !== 0 && (rels.get(-got) as number) <= edge && (rels.get(Math.abs(got)) as number) <= edge) { ties++; ok(got < 0, 'a tie gives the negative'); }
    // The 0.30 pass wins over a smaller shift that only reaches 0.35.
    if (rel <= 0.3) {
      const smaller = [...rels].some(([s, v]) => Math.abs(s) < Math.abs(got) && v <= 0.35);
      if (smaller) orderWins++;
    } else edgeOnly++;
  }
}
eq(fixtureShifts.length, FIX.reads.length * 33, 'every reading at every crystal, and at the six Lo Shu tones');
ok(loShu.shifts > 0 && loShu.zeros + loShu.nulls > 0, `A1: the Lo Shu tones get shifts (${loShu.shifts}) and none or 0 (${loShu.zeros + loShu.nulls})`);
ok(zeros > 0 && nulls > 0 && shifts > 0, `the fixture has each answer: 0 (${zeros}), none (${nulls}), a shift (${shifts})`);
ok(ties > 0, `the fixture has tie cases (${ties})`);
ok(orderWins > 0, `the fixture has cases where the 0.30 pass beats a smaller 0.35 shift (${orderWins})`);
ok(edgeOnly > 0, `the fixture has cases only the 0.35 pass reaches (${edgeOnly})`);
// Hand-made: the tie rule and the order of the passes, on a chroma and tone where they matter (found in the fixture).
{
  const r = FIX.reads[0];
  for (let i = 0; i < 27; i++) {
    for (const lim of [0, 5, 20]) eq(fitShift(r.chroma, r.chromaA4Hz, TONES[i], lim), scan(r.chroma, r.chromaA4Hz, TONES[i], lim).want, `fitShift with the limit ${lim} (${ALL_CRYSTALS[i]} Hz)`);
  }
  for (const lim of [60, 1000, NaN]) eq(fitShift(r.chroma, r.chromaA4Hz, TONES[3], lim), fitShift(r.chroma, r.chromaA4Hz, TONES[3]), `a limit of ${lim} is ±50 at most`);
}
const C = FIX.reads[1].chroma, A4 = FIX.reads[1].chromaA4Hz, T0 = TONES[8];
const bad: Array<[string, unknown, unknown, unknown]> = [
  ['no chroma', undefined, A4, T0], ['11 weights', C.slice(0, 11), A4, T0], ['a NaN weight', [NaN, ...C.slice(1)], A4, T0], ['a negative weight', [-0.1, ...C.slice(1)], A4, T0],
  ['all zeros', new Array(12).fill(0), A4, T0], ['a typed array', Float64Array.from(C), A4, T0], ['A4 0', C, 0, T0], ['A4 NaN', C, NaN, T0], ['A4 −440', C, -440, T0],
  ["A4 '440'", C, '440', T0], ['tone 0', C, A4, 0], ['tone NaN', C, A4, NaN], ['tone −528', C, A4, -528],
];
for (const [name, c, a, tone] of bad) eq(fitShift(c, a, tone), null, `fitShift: ${name} → null`);

// ---- 5. the words -------------------------------------------------------------------------------------------------
eq([tuneLabel(23), tuneLabel(-14), tuneLabel(1), tuneLabel(-1), tuneLabel(50)], ['+23 cents', '−14 cents', '+1 cent', '−1 cent', '+50 cents'], 'tuneLabel');
eq([tuneChip(23), tuneChip(-14)], ['Tuned +23 c', 'Tuned −14 c'], 'tuneChip');
eq([tuningChipText(t(-14, 963)), tuningChipText(t(23, 174)), tuningChipText({ ...t(-14, 174), tuneLoShu: true })], ['Tuned −14 c', 'Tuned +23 c', 'Tuned −14 c'], 'Now Playing’s chip while tuned (T4)');
for (const [name, x] of [['no tuning', {}], ['0 cents', t(0)], ['51 cents', t(51)], ['tuneFor 1000', t(10, 1000)], ['null', null], ['undefined', undefined]] as const) eq(tuningChipText(x as never), null, `no chip for ${name} (Standard)`);
ok(!tuneLabel(-14).includes('-') && !tuneChip(-14).includes('-'), 'a true minus sign, never a hyphen');
eq([tuneSpoken(23), tuneSpoken(-14), tuneSpoken(-1)], ['plus 23 cents', 'minus 14 cents', 'minus 1 cent'], 'tuneSpoken');
eq([signed(5), signed(-5), signed(0)], ['+5', '−5', '0'], 'signed');
ok(Math.abs(speedPercent(-14) + 0.8055) < 1e-3 && Math.abs(speedPercent(23) - 1.3374) < 1e-3, 'speedPercent: −14 c is 0.8 % slower, +23 c 1.3 % faster');

// ---- 6. A1: tuneLoShu ---------------------------------------------------------------------------------------------
{
  const lo = (tuneCents: unknown, tuneFor: unknown, tuneLoShu: unknown) => ({ tuneCents, tuneFor, tuneLoShu });
  for (const f of LO_SHU_CRYSTALS) ok(validLoShu(lo(-14, f, true)), `validLoShu: ${f} is one of the six`);
  for (const f of ALL_CRYSTALS.filter((x) => !LO_SHU_CRYSTALS.includes(x))) ok(!validLoShu(lo(-14, f, true)), `validLoShu: ${f} is not one of the six`);
  const no: Array<[string, unknown]> = [
    ["tuneLoShu 'true'", lo(-14, 174, 'true')], ['tuneLoShu 1', lo(-14, 174, 1)], ['tuneLoShu false', lo(-14, 174, false)], ['no tuneLoShu', t(-14, 174)],
    ['an invalid tuning (51)', lo(51, 174, true)], ['0 cents', lo(0, 174, true)], ['tuneFor 75 (the Lo Shu tone, not the crystal)', lo(-14, 75, true)], ['null', null],
  ];
  for (const [name, s] of no) ok(!validLoShu(s as never), `validLoShu: ${name} is not a Lo Shu tuning`);
  // The rate reads the cents only.
  for (const c of [-50, -14, 1, 23, 50]) for (const f of LO_SHU_CRYSTALS) {
    same(trackRate(lo(c, f, true)), trackRate(t(c, f)), `A1: tuneLoShu never changes the rate (${c} c on ${f})`);
    same(trackRate(lo(c, f, 'x')), tuneRate(c), `A1: an odd tuneLoShu, the cents' rate (${c} c on ${f})`);
  }
  same(trackRate(lo(0, 174, true)), PITCH_SHIFT_FACTOR, 'A1: tuneLoShu alone is Standard');
  const song = { id: 'a', name: 'tone-a', closestSolfeggio: 174 };
  const a = withTrackTuning(song, -14, 174, true) as Record<string, unknown>;
  eq([a.tuneCents, a.tuneFor, a.tuneLoShu], [-14, 174, true], 'withTrackTuning(…, loShu) on one of the six');
  const b = withTrackTuning(song, -14, 963, true) as Record<string, unknown>;
  ok(b.tuneCents === -14 && !('tuneLoShu' in b), 'withTrackTuning(…, loShu) on 963: no tuneLoShu (not one of the six)');
  const c = withTrackTuning(a, 10, 174) as Record<string, unknown>;
  ok(c.tuneCents === 10 && !('tuneLoShu' in c), 'a Solfeggio fit drops tuneLoShu');
  const d = withTrackTuning(a, null) as Record<string, unknown>;
  ok(!('tuneCents' in d) && !('tuneFor' in d) && !('tuneLoShu' in d), 'null removes all three');
  const e = tuneById([a as typeof song, song], 'a', 23, 285, true) as unknown as Array<Record<string, unknown>>;
  eq([e[0].tuneCents, e[0].tuneFor, e[0].tuneLoShu], [23, 285, true], 'tuneById passes loShu');
}

// ---- 8. the restore (playlistCache's toSong: restoredTuning) -------------------------------------------------------
{
  eq(restoredTuning({ tuneCents: -14, tuneFor: 963 }), { tuneCents: -14, tuneFor: 963 }, 'restore: a valid tuning, both fields');
  eq(restoredTuning({ tuneCents: -14, tuneFor: 174, tuneLoShu: true }), { tuneCents: -14, tuneFor: 174, tuneLoShu: true }, 'restore: A1, a Lo Shu tuning on one of the six');
  eq(restoredTuning({ tuneCents: -14, tuneFor: 963, tuneLoShu: true }), { tuneCents: -14, tuneFor: 963 }, 'restore: A1, tuneLoShu dropped off the six');
  eq(restoredTuning({ tuneCents: -14, tuneFor: 174, tuneLoShu: 'yes' }), { tuneCents: -14, tuneFor: 174 }, 'restore: A1, an odd tuneLoShu dropped');
  const garbage: Array<[string, unknown]> = [
    ['51 cents', { tuneCents: 51, tuneFor: 963 }], ['2.5 cents', { tuneCents: 2.5, tuneFor: 963 }], ['tuneFor 1000', { tuneCents: 10, tuneFor: 1000 }],
    ['cents without tuneFor', { tuneCents: 10 }], ['tuneFor without cents', { tuneFor: 963 }], ['0 cents', { tuneCents: 0, tuneFor: 963 }],
    ['tuneLoShu alone', { tuneLoShu: true, tuneFor: 174 }], ['nothing', {}], ['undefined', undefined], ['null', null],
    ["cents '10'", { tuneCents: '10', tuneFor: 963 }],
  ];
  for (const [name, m] of garbage) {
    const r = restoredTuning(m as never);
    eq(Object.keys(r), [], `restore: ${name} restores as Standard, with no keys at all`);
  }
}

// ---- 7. the patch -------------------------------------------------------------------------------------------------
{
  const song = { id: 'a', name: 'tone-a', closestSolfeggio: 963 };
  const tuned = withTrackTuning(song, -14, 963) as Record<string, unknown>;
  eq([tuned.tuneCents, tuned.tuneFor, tuned.id, tuned.closestSolfeggio], [-14, 963, 'a', 963], 'withTrackTuning sets both fields');
  ok(tuned !== song && !('tuneCents' in song), 'a new object; the old one untouched');
  const back = withTrackTuning(tuned, null) as Record<string, unknown>;
  ok(!('tuneCents' in back) && !('tuneFor' in back) && back.id === 'a', 'null removes both fields');
  for (const [name, c, f] of [['51 cents', 51, 963], ['0 cents', 0, 963], ['2.5 cents', 2.5, 963], ['tuneFor 1000', 10, 1000], ['no tuneFor', 10, undefined]] as const) {
    const x = withTrackTuning(tuned, c as number, f as number | undefined) as Record<string, unknown>;
    ok(!('tuneCents' in x) && !('tuneFor' in x), `withTrackTuning(${name}) removes both (never one without the other)`);
  }
  const b = { id: 'b', name: 'tone-b' };
  const list = [song, b, song];
  const out = tuneById(list, 'a', 20, 528);
  ok(out !== list && out[1] === b && (out[0] as Record<string, unknown>).tuneCents === 20 && (out[2] as Record<string, unknown>).tuneCents === 20, 'tuneById: every repeat of the id, the others the same objects');
  ok(tuneById(list, 'zz', 20, 528) === list, 'tuneById: no such id, the same list');
}

// ---- 9. the composing guide's table (T9; A1) ----------------------------------------------------------------------
/** The table as generated from the survey's guide.json and guide-loshu.json (scripts/tuning/gen-compose-table.mjs). Fix
 *  round 1 (N4): re-generated with a key already at 440 left out of the options within ±5 cents (was be908c71…). Fix
 *  round 2 (N1): re-generated with a key already at 440 left out where its robust window reaches 440 (was 7165e2ba…):
 *  285 D −22, 1449 B −8 and F♯ −8, 1935 E −6, 3858 F♯m −7 and 4920 G♯ +15 go, the next best take their places. */
const COMPOSE_TABLE_SHA = 'c8be98d60fd6506a8f0c6c5d3e83765306d470bba8f321b832ab8adf1a4c7726';
{
  const KEY = /^[A-G]#?m?$/;
  eq(createHash('sha256').update(JSON.stringify(COMPOSE_TABLE)).digest('hex'), COMPOSE_TABLE_SHA, 'the compose table is the one generated (its sha256)');
  eq(COMPOSE_TABLE.map((e) => e.crystal), [...ALL_CRYSTALS], 'the compose table: the 27 crystals, in order');
  eq([COMPOSE_LIMIT_CENTS, COMPOSE_PER_CRYSTAL], [45, 3], 'within ±45 cents, the best three per crystal');
  const sets = COMPOSE_TABLE.flatMap((e) => [{ what: `${e.crystal}`, set: e as { at440: readonly string[]; options: readonly { key: string; cents: number; hz: number }[] } }, ...(e.loShu ? [{ what: `Lo Shu ${e.loShu.hz}`, set: e.loShu }] : [])]);
  // (Fix round 1, N4: the keys at a plain 440 are answers too; 2178 and 2907 have only those now.)
  for (const e of COMPOSE_TABLE) ok(e.at440.length + e.options.length >= 2 && e.options.length <= 3, `${e.crystal}: at least two answers (${e.at440.length} at 440, ${e.options.length} options)`);
  for (const { what, set } of sets) for (const o of set.options) ok(!(set.at440.includes(o.key) && Math.abs(o.cents) <= 5), `N4: ${what}: ${o.key} at ${o.cents} c is not a key already at 440 said again`);
  eq([composeEntry(2178)!.options.length, composeEntry(2907)!.options.length, composeLines(composeEntry(2178)!)], [0, 0, [at440Line(composeEntry(2178)!.at440)]], 'N4: 2178 and 2907: their keys at 440, said once');
  eq(composeEntry(417)!.loShu!.options.map((o) => [o.key, o.cents]), [['C#m', -1]], 'N4: the Lo Shu set of 417: C♯ and G♯ at 440, then C♯m (not C♯ again)');
  // (Fix round 2, N1: a key already at 440 whose robust window reaches 440 is the same answer, however far its cents.)
  eq(composeEntry(1935)!.options.map((o) => [o.key, o.cents]), [['G#m', -10], ['D', -4], ['Bm', -2]], 'N1: 1935: F♯m −2 c and E −6 c (keys at 440, windows reaching it) give way to the next best');
  const gone: Array<[number, string, number]> = [[285, 'D', -22], [1449, 'B', -8], [1449, 'F#', -8], [1935, 'E', -6], [3858, 'F#m', -7], [4920, 'G#', 15]];
  for (const [f, k, c] of gone) ok(!composeEntry(f)!.options.some((o) => o.key === k && o.cents === c) && composeEntry(f)!.at440.includes(k), `N1: ${f}: ${k} ${c} c (its window reaches 440, where ${k} is listed) is not said again`);
  eq([285, 1449, 3858, 4920].map((f) => composeEntry(f)!.options.map((o) => `${o.key} ${o.cents}`)), [['Gm -22', 'G -20'], ['A -3', 'F#m -9', 'Bm -2'], ['E -11', 'G#m -16', 'D -9'], ['G#m 15', 'D# 12', 'A#m 15']], 'N1: the four other crystals that change, and what takes their places');
  ok(composeEntry(285)!.at440.length + composeEntry(285)!.options.length === 3, 'N1: 285 keeps three answers (D at 440, Gm and G)');
  for (const { what, set } of sets) {
    for (const o of set.options) {
      ok(KEY.test(o.key) && Number.isInteger(o.cents) && Math.abs(o.cents) <= 45, `${what}: ${o.key} ${o.cents} c: a key, within ±45 c`);
      ok(Math.abs(o.hz - 440 * Math.pow(2, o.cents / 1200)) <= 0.05 + 1e-9 && Math.round(o.hz * 10) === o.hz * 10, `${what}: ${o.key} at ${o.hz} Hz = 440·2^(${o.cents}/1200) to 0.1`);
    }
    for (const k of set.at440) ok(KEY.test(k), `${what}: ${k} at 440 is a key`);
  }
  eq(COMPOSE_TABLE.filter((e) => e.loShu).map((e) => [e.crystal, e.loShu!.hz]), LO_SHU_CRYSTALS.map((f) => [f, loShuHz(f)]), 'A1: Lo Shu sets on exactly the six, each at its Lo Shu tone');
  eq(composeEntry(963)?.options[0], { key: 'E', cents: -14, hz: 436.5 }, 'the review page’s example: 963 Hz, E at 436.5 Hz (−14 c)');
  // The page's lines.
  eq(optionLine({ key: 'F#m', cents: -10, hz: 437.5 }), 'F♯m · Set A4 to 437.5 Hz in your DAW · −10 cents', 'an option’s line');
  eq(at440Line(['E', 'G', 'F#m']), 'E, G, F♯m · Leave A4 at 440 Hz in your DAW · 0 cents', 'the keys at a plain 440, one line');
  eq(keyText('C#'), 'C♯', 'a true sharp');
  eq(composeLines(composeEntry(2907)!)[0], at440Line(composeEntry(2907)!.at440), 'the keys at 440 first, where there are any');
  eq(composeLines(composeEntry(963)!).length, 3, '963: three lines, no keys at 440');
  eq([composeLines(composeEntry(417)!.loShu!).filter((l) => l.startsWith('G♯ · Set A4')).length, composeLines(composeEntry(417)!.loShu!)[0].includes('G♯')], [0, true], 'an option at 0 c already said at 440 is not said twice');
  eq(composeLines({ at440: [], options: [] }), [COMPOSE_NONE], 'nothing robust: "No robust option within ±45 cents"');
  eq(COMPOSE_GROUPS.map((g) => [g.label, g.crystals.length]), [['GUT', 9], ['HEART', 9], ['HEAD', 9]], 'the picker: GUT, HEART, HEAD, nine each');
  eq([composeStart(963, 528, 528, (x) => x), composeStart(null, 528, 963, (x) => x), composeStart(null, null, 519, (x) => (x === 519 ? 528 : x)), composeStart(111, null, 111, (x) => x)], [963, 528, 528, 174], 'where the page opens: asked, the track’s, the playing crystal (its Lo Shu tone mapped back), the first');
}

// ---- 10. fix round 1 ---------------------------------------------------------------------------------------------
{
  // S1: offeredShift is fitShift for a key that doesn't fit at Standard, and 0 for one already within the edge there.
  let margin = 0, same0 = 0, kept = 0;
  for (const r of FIX.reads) for (const tone of ALL_TONES) {
    const fs = fitShift(r.chroma, r.chromaA4Hz, tone);
    const rel0 = scan(r.chroma, r.chromaA4Hz, tone).rels.get(0) as number;
    const got = offeredShift(r.chroma, r.chromaA4Hz, tone);
    eq(got, fs === null ? null : rel0 <= 0.35 ? 0 : fs, 'S1: offeredShift: 0 within the edge at Standard, else fitShift');
    if (fs !== null && fs !== 0 && rel0 <= 0.35) margin++;
    else if (fs === 0) same0++;
    else if (fs !== null) kept++;
  }
  ok(margin > 0 && same0 > 0 && kept > 0, `S1: margin cases (${margin}), already fits (${same0}), shifts kept (${kept})`);
  for (const [name, c, a, tone] of bad) eq(offeredShift(c, a, tone), null, `offeredShift: ${name} → null`);
  // S2: the Lo Shu tone on an output: the phone's own speaker plays 75 and 186 an octave up; the rest as headphones.
  for (const f of LO_SHU_CRYSTALS) {
    for (const out of ['headphones', 'speakers', 'phone']) eq(loShuTone(f, out), toneOf(PERFECT_GUT_MAP[f], out), `S2: loShuTone(${f}, ${out})`);
  }
  eq(LO_SHU_CRYSTALS.filter((f) => loShuTone(f, 'phone') !== loShuTone(f)), [174, 285], 'S2: on the phone, Lo Shu 75 and 186 move an octave up');
  eq([loShuTone(174, 'phone'), loShuTone(285, 'phone')], [300, 372], 'S2: to 300 and 372 Hz');
  // S2: the Compose page's line, on the computed set (toneOf), never a list.
  eq(ALL_CRYSTALS.filter(crystalPhoneDiffers), ALL_CRYSTALS.filter((f) => toneOf(canonicalLayerHz(f, false).f, 'phone') !== TONES[ALL_CRYSTALS.indexOf(f)]), 'S2: the crystals whose tone the phone plays an octave up');
  eq(ALL_CRYSTALS.filter(crystalPhoneDiffers), [174], 'S2: (that is 174 → 348)');
  eq(ALL_CRYSTALS.filter(loShuPhoneDiffers), [174, 285], 'S2: the Lo Shu tones: 75 → 300 and 186 → 372');
  eq([phoneOctaveUp(174), phoneOctaveUp(528), phoneOctaveUp(0), phoneOctaveUp(NaN)], [true, false, false, false], 'S2: phoneOctaveUp');
  // N5: restoredTuning reads each field once, and checks what it read.
  {
    const reads: Record<string, number> = {};
    const once = (k: string, v: unknown) => ({ get() { reads[k] = (reads[k] ?? 0) + 1; return v; }, enumerable: true });
    const m = Object.defineProperties({}, { tuneCents: once('tuneCents', -14), tuneFor: once('tuneFor', 174), tuneLoShu: once('tuneLoShu', true) });
    eq(restoredTuning(m as never), { tuneCents: -14, tuneFor: 174, tuneLoShu: true }, 'N5: a getter record restores');
    eq(reads, { tuneCents: 1, tuneFor: 1, tuneLoShu: 1 }, 'N5: each field read once');
    let n = 0;
    const flip = { tuneCents: 5, get tuneFor() { n++; return n === 1 ? 963 : 'garbage'; } };
    eq(restoredTuning(flip as never), { tuneCents: 5, tuneFor: 963 }, 'N5: a field that changes between reads: what was checked is what is kept');
    const boom = { tuneCents: 5, get tuneFor(): number { throw new Error('boom'); } };
    eq(restoredTuning(boom as never), {}, 'N5: a record that throws when read restores as Standard');
  }
  // N2: the chip's spoken name, from tuneLabel.
  eq([tuneChipName(1), tuneChipName(-1), tuneChipName(-14), tuneChipName(23)], ['Tuned +1 cent', 'Tuned −1 cent', 'Tuned −14 cents', 'Tuned +23 cents'], 'N2: the spoken name of the chip');
}

Math.random = realRandom;
console.log(`tuning.check: ${checks} checks passed (fitShift on ${n} fixture cases: ${zeros} already fit, ${shifts} shifts, ${nulls} none; ${ties} ties, ${orderWins} where 0.30 wins over a smaller 0.35, ${edgeOnly} only at 0.35).`);
