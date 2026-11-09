// utils/soundV2/adaptiveBand.check.ts (v16.8.4 "Adaptive gamma"). Checks for utils/soundV2/adaptiveBand.ts.
// Run with: node utils/soundV2/adaptiveBand.check.ts   (npm run check:sound; Node 22.18+ strips the types). Exits
// non-zero on any failure.
//
// What it shows (the spec's §2.1):
//   1. the 33 crystal tones and, derived here from the vendored plan(), the 11 whose carrier differs between Beta (20)
//      and Gamma (40) on headphones: printed, and equal to the table the user reviewed (the list is never a literal in
//      the app; the table below is this check's expectation only);
//   2. Smooth (Adaptive on, binaural): every field equals plan(…band)'s but carrier_hz and partner_hz, which differ on
//      exactly those 11 below Gamma (and never at Gamma, where Smooth is plan(…40) itself); the carrier is Gamma's;
//   3. partner_hz = carrier_hz + beat_hz on every path;
//   4. every other path (Sticky, Adaptive off, the pulse, tone only, every output) is deep-equal to today's call;
//   5. the caps by render; the hysteresis as today (layerHost's vectors, and random runs against BandHysteresis with
//      v16.8.3's Beta cap wherever Gamma can't be asked for, and with the pulse's Alpha cap);
//   6. Sticky's hold: 10 ticks, refused ticks reset the hysteresis, a start at Gamma, re-entry, Smooth without a hold,
//      the pulse without a hold; and an independent restatement of the rule over random runs;
//   7. parseGammaMode against odd input;
//   8. the control's words (layerCopy): the text, its counts, its "an octave or two" and its 30 s are the ones derived
//      here (fix round 1: the corrected words; the note off headphones repeats nothing of the presets note).

import type { Band, Plan } from './aetheria_sound_v2.ts';
import { BANDS, BAND_ORDER, bandForIntensity, plan } from './aetheria_sound_v2.ts';
import type { BeatRender } from './layerHost.ts';
import { BandHysteresis, capBand, canonicalLayerHz, NON_CANONICAL_EXCEPTIONS } from './layerHost.ts';
import { ALL_CRYSTALS } from '../mix/distribution.ts';
import {
  AdaptiveBand,
  adaptiveCap,
  adaptivePlan,
  parseGammaMode,
  KEY_ADAPTIVE_GAMMA,
  DEFAULT_GAMMA_MODE,
  GAMMA_HOLD_TICKS,
} from './adaptiveBand.ts';
import type { GammaMode } from './adaptiveBand.ts';
import * as copy from '../../components/layers/layerCopy.ts';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (ok) passed++;
  else failures.push(what);
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const RENDERS: BeatRender[] = ['binaural', 'pulse', 'off'];
const OUTPUTS = ['headphones', 'speakers', 'phone'] as const;
const MODES: GammaMode[] = ['smooth', 'sticky'];
/** Today's call (App.tsx at 6303c43, the plan effect; renderLayers' planFor). */
const today = (f: number, planOutput: string, band: Band, render: BeatRender): Plan | null =>
  plan(f, planOutput, render === 'binaural' ? 'binaural' : 'monaural', BANDS[band]);

// ---- 1. The tones, and the 11 -------------------------------------------------------------------------------------
const tones: Array<{ crystal: number; gut: boolean; f: number }> = [];
{
  const seen = new Set<number>();
  for (const gut of [false, true]) {
    for (const c of ALL_CRYSTALS) {
      const f = canonicalLayerHz(c, gut).f;
      if (!(f > 0) || seen.has(f)) continue;
      seen.add(f);
      tones.push({ crystal: c, gut, f });
    }
  }
}
check(tones.length === 33, `33 crystal tones (the 27 crystals, and the 6 Lo Shu tones Perfect GUT swaps in): ${tones.length}`);
const carrierAt = (f: number, beat: number): number => plan(f, 'headphones', 'binaural', beat)!.carrier_hz;
const moves = (f: number): boolean => Math.abs(carrierAt(f, BANDS.beta) - carrierAt(f, BANDS.gamma)) > 1e-9;
const moved = tones.filter((t) => moves(t.f));
const derived = moved.map((t) => `${t.gut ? `Lo Shu ${t.f}` : t.f}: ${+carrierAt(t.f, 20).toFixed(1)} + 20 → ${+carrierAt(t.f, 40).toFixed(1)} + 40`);
console.log(`  the ${moved.length} of ${tones.length} tones whose beat pair moves at Gamma (derived from plan()):`);
for (const line of derived) console.log(`    ${line}`);
// The table the user reviewed (v1684-spec.md §2.1, review/gamma.html), measured at 6303c43 by ..\gamma\carriers2.mts.
const REVIEWED: Array<[string, number, number]> = [
  ['174', 348, 696], ['417', 208.5, 834], ['852', 213, 426], ['963', 240.8, 481.5], ['1692', 211.5, 423],
  ['1935', 241.9, 483.8], ['3504', 219, 438], ['3858', 241.1, 482.3], ['Lo Shu 75', 300, 600], ['Lo Shu 186', 372, 744],
  ['Lo Shu 408', 204, 816],
];
check(moved.length === 11, `11 tones move (${moved.length})`);
check(same(derived, REVIEWED.map(([n, b, g]) => `${n}: ${b} + 20 → ${g} + 40`)), `the derived list is the reviewed table:\n      ${derived.join('\n      ')}`);
// Up an octave on nine; two octaves on 417 and Lo Shu 408 (208.5 → 834, 204 → 816: Gamma's octave of the carrier, 417 and
// 408, is the tone itself, so plan() takes the octave above it).
{
  const ratio = (f: number) => carrierAt(f, 40) / carrierAt(f, 20);
  const two = moved.filter((t) => Math.abs(ratio(t.f) - 4) < 1e-9).map((t) => t.f);
  check(moved.every((t) => Math.abs(ratio(t.f) - 2) < 1e-9 || Math.abs(ratio(t.f) - 4) < 1e-9), 'each of the 11 moves up by whole octaves');
  check(same(two, [417, 408]), `two octaves on 417 and Lo Shu 408 only (${two.join(', ')})`);
  console.log(`  up one octave on ${moved.length - two.length}, two on ${two.join(' and ')}`);
}
// Delta, Theta and Alpha share Beta's carrier on every tone (L = max(200, 10 × beat) is 200 for them all), so the 11 are
// the only tones whose carrier moves at any band step.
check(tones.every((t) => (['delta', 'theta', 'alpha'] as Band[]).every((b) => carrierAt(t.f, BANDS[b]) === carrierAt(t.f, BANDS.beta))), 'below Gamma every band shares one carrier, on every tone');
// 111 Hz (a non-crystal that still plays, NON_CANONICAL_EXCEPTIONS) doesn't move either.
const extras = NON_CANONICAL_EXCEPTIONS.map((f) => ({ crystal: f, gut: false, f }));
check(extras.length === 1 && !moves(111), '111 Hz: its carrier stays at Gamma');
const all = [...tones, ...extras];

// ---- 2, 3. Smooth -----------------------------------------------------------------------------------------------
{
  const perBand: Record<string, number> = {};
  let fields = 0;
  for (const t of all) {
    for (const band of BAND_ORDER) {
      const s = adaptivePlan(t.f, 'headphones', band, 'smooth', true, 'binaural')!;
      const p = plan(t.f, 'headphones', 'binaural', BANDS[band])!;
      const g = plan(t.f, 'headphones', 'binaural', BANDS.gamma)!;
      check(same(Object.keys(s), Object.keys(p)), `Smooth ${t.f} ${band}: the plan's fields, in plan()'s order`);
      for (const k of Object.keys(p) as Array<keyof Plan>) {
        if (k === 'carrier_hz' || k === 'partner_hz') continue;
        fields++;
        check(Object.is(s[k], p[k]), `Smooth ${t.f} ${band}: ${k} is the band's (${String(s[k])} vs ${String(p[k])})`);
      }
      check(s.carrier_hz === g.carrier_hz, `Smooth ${t.f} ${band}: Gamma's carrier (${s.carrier_hz} vs ${g.carrier_hz})`);
      check(s.beat_hz === BANDS[band], `Smooth ${t.f} ${band}: the band's beat`);
      check(s.partner_hz === s.carrier_hz + s.beat_hz, `Smooth ${t.f} ${band}: partner = carrier + beat`);
      const differs = s.carrier_hz !== p.carrier_hz || s.partner_hz !== p.partner_hz;
      check(differs === (moves(t.f) && band !== 'gamma'), `Smooth ${t.f} ${band}: differs from plan(…band) only on the 11, below Gamma (${differs})`);
      if (band === 'gamma') check(same(s, p), `Smooth ${t.f} at Gamma: plan(…40) itself`);
      if (differs) perBand[band] = (perBand[band] ?? 0) + 1;
    }
  }
  check(same(perBand, { delta: 11, theta: 11, alpha: 11, beta: 11 }), `Smooth differs on 11 tones at each band below Gamma, none at Gamma: ${JSON.stringify(perBand)}`);
  console.log(`  Smooth: ${all.length} tones × 5 bands, ${fields} fields equal to the band's plan; carrier and partner differ on ${JSON.stringify(perBand)}`);
}

// ---- 3, 4. Every other path is today's call, field for field ------------------------------------------------------
{
  let paths = 0;
  for (const t of all) {
    for (const planOutput of OUTPUTS) {
      for (const render of RENDERS) {
        for (const band of BAND_ORDER) {
          for (const mode of MODES) {
            for (const adaptive of [true, false]) {
              const got = adaptivePlan(t.f, planOutput, band, mode, adaptive, render);
              check(!!got && got.partner_hz === got.carrier_hz + got.beat_hz, `partner = carrier + beat (${t.f} ${planOutput} ${render} ${band} ${mode} ${adaptive})`);
              if (mode === 'smooth' && adaptive && render === 'binaural') continue;
              paths++;
              check(same(got, today(t.f, planOutput, band, render)), `${t.f} ${planOutput} ${render} ${band} ${mode} adaptive ${adaptive}: today's plan`);
            }
          }
        }
      }
    }
  }
  console.log(`  ${paths} non-Smooth paths deep-equal to today's call`);
  // Adaptive must be exactly on; no frequency, no plan.
  check(same(adaptivePlan(852, 'headphones', 'beta', 'smooth', 1 as unknown as boolean, 'binaural'), today(852, 'headphones', 'beta', 'binaural')), 'Smooth needs Adaptive exactly on');
  for (const f of [0, -1, NaN, Infinity]) check(adaptivePlan(f, 'headphones', 'beta', 'smooth', true, 'binaural') === null, `no plan for ${f}`);
  // A mode that isn't 'sticky' reads as the default (Smooth): the state is always parsed, so this is the fallback only.
  check(same(adaptivePlan(852, 'headphones', 'beta', 'Sticky' as GammaMode, true, 'binaural'), adaptivePlan(852, 'headphones', 'beta', 'smooth', true, 'binaural')), 'an unknown mode plays as Smooth');
}

// ---- 5. The caps and the hysteresis ------------------------------------------------------------------------------
check(adaptiveCap('binaural') === 'gamma' && adaptiveCap('pulse') === 'alpha' && adaptiveCap('off') === null, 'caps: Gamma binaural, Alpha for the pulse, none with no beat');
check(adaptiveCap('x' as BeatRender) === null, 'an unknown render: no adaptive band');
/** A target band as an intensity readIntensity could give (the middle of its range in bandForIntensity). */
const I: Record<Band, number> = { delta: 0.05, theta: 0.25, alpha: 0.45, beta: 0.65, gamma: 0.85 };
check(BAND_ORDER.every((b) => bandForIntensity(I[b]) === b), 'the intensities stand for their bands');
/** Ticks with these targets from `start`, the current band following each step: '-' or the band stepped to. */
function run(ab: AdaptiveBand, start: Band, intensities: number[]): string[] {
  let cur = start;
  return intensities.map((i) => {
    const next = ab.tick(i, cur);
    if (next) cur = next;
    return next ?? '-';
  });
}
/** layerHost.check's vectors take the current band as fixed; so does this. */
const fixed = (ab: AdaptiveBand, current: Band, targets: Band[]): string => targets.map((b) => ab.tick(I[b], current) ?? '-').join(',');
for (const mode of MODES) {
  const hp = (start: Band) => new AdaptiveBand(mode, 'binaural', start);
  check(fixed(hp('alpha'), 'alpha', ['delta', 'theta']) === '-,theta', `${mode}: alternating targets on one side step on the 2nd tick`);
  check(fixed(hp('alpha'), 'alpha', ['delta', 'beta', 'delta', 'delta']) === '-,-,-,theta', `${mode}: a flip of direction restarts the count`);
  check(fixed(hp('alpha'), 'alpha', ['delta', 'alpha', 'delta', 'delta']) === '-,-,-,theta', `${mode}: a target equal to the current band resets`);
  check(fixed(new AdaptiveBand(mode, 'pulse', 'beta'), 'beta', ['gamma', 'gamma']) === '-,alpha', `${mode}: the pulse's cap below the current band steps down`);
  check(fixed(hp('alpha'), 'alpha', ['gamma', 'gamma']) === '-,beta', `${mode}: one band per step`);
  check(new AdaptiveBand(mode, 'binaural', 'alpha').tick(I.delta, 'x' as Band) === null, `${mode}: an unknown band never steps`);
  check(run(hp('alpha'), 'alpha', [1, 1, 1, 1, 1, 1]).join(',') === '-,beta,-,gamma,-,-', `${mode}: binaural reaches Gamma, a band every second tick`);
  check(run(new AdaptiveBand(mode, 'pulse', 'delta'), 'delta', Array(12).fill(1)).join(',') === '-,theta,-,alpha,-,-,-,-,-,-,-,-', `${mode}: the pulse stops at Alpha`);
  check(run(new AdaptiveBand(mode, 'off', 'alpha'), 'alpha', Array(6).fill(1)).every((x) => x === '-'), `${mode}: no beat, no steps`);
}
/** A seeded generator (the same runs every time). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
/** The reference loop: BandHysteresis with capBand to `cap` (v16.8.3's loop had cap = beta binaural, alpha pulse). */
function reference(cap: Band, start: Band, intensities: number[]): string[] {
  const h = new BandHysteresis();
  let cur = start;
  return intensities.map((i) => {
    const next = h.tick(capBand(bandForIntensity(i), cap), cur);
    if (next) cur = next;
    return next ?? '-';
  });
}
/** Sticky's rule restated independently: ticks at Gamma are counted; while fewer than 10 have been counted, a tick is
 *  refused and the hysteresis restarts. */
function stickyOracle(start: Band, intensities: number[]): string[] {
  const h = new BandHysteresis();
  let cur = start, n = 0;
  return intensities.map((i) => {
    if (cur === 'gamma') {
      n += 1;
      if (n < 10) { // the spec's number, not the constant
        h.reset();
        return '-';
      }
    } else n = 0;
    const next = h.tick(capBand(bandForIntensity(i), 'gamma'), cur);
    if (next) cur = next;
    return next ?? '-';
  });
}
{
  const rnd = lcg(16_8_4);
  let runs = 0, reachedGamma = 0, held = 0;
  for (let r = 0; r < 400; r++) {
    // Runs of a few ticks at one level, as a track's sections are.
    const xs: number[] = [];
    while (xs.length < 160) {
      const level = rnd(), len = 1 + Math.floor(rnd() * 14);
      for (let k = 0; k < len; k++) xs.push(Math.min(0.999, Math.max(0, level + (rnd() - 0.5) * 0.1)));
    }
    const start = BAND_ORDER[Math.floor(rnd() * 5)];
    const low = xs.map((x) => x * 0.7499); // never Gamma's 0.75
    for (const mode of MODES) {
      // The pulse: v16.8.3's loop exactly (cap Alpha), from any band.
      check(same(run(new AdaptiveBand(mode, 'pulse', start), start, xs), reference('alpha', start, xs)), `run ${r} ${mode}: the pulse is v16.8.3's loop`);
      // Binaural where Gamma is never asked for and the band isn't Gamma: v16.8.3's Beta-capped loop exactly.
      if (start !== 'gamma') check(same(run(new AdaptiveBand(mode, 'binaural', start), start, low), reference('beta', start, low)), `run ${r} ${mode}: below Gamma, v16.8.3's loop (Beta cap)`);
      runs += 2;
    }
    const smooth = run(new AdaptiveBand('smooth', 'binaural', start), start, xs);
    check(same(smooth, reference('gamma', start, xs)), `run ${r}: Smooth is the hysteresis with the Gamma cap, no hold`);
    const sticky = run(new AdaptiveBand('sticky', 'binaural', start), start, xs);
    check(same(sticky, stickyOracle(start, xs)), `run ${r}: Sticky is the restated rule`);
    if (smooth.includes('gamma') || start === 'gamma') reachedGamma++;
    if (!same(smooth, sticky)) held++;
  }
  check(reachedGamma > 100 && held > 50, `the random runs reach Gamma (${reachedGamma} of 400) and the hold changes ${held}`);
  console.log(`  hysteresis: ${runs} random runs as v16.8.3's loop; ${reachedGamma} of 400 reach Gamma, Sticky differs from Smooth on ${held}`);
}

// ---- 6. Sticky's hold ---------------------------------------------------------------------------------------------
{
  check(GAMMA_HOLD_TICKS === 10 && GAMMA_HOLD_TICKS * 3 >= 30, 'the hold is 10 ticks: 30 s at the 3 s tick');
  // From Beta: loud for 2 ticks (the step into Gamma at the 2nd), then quiet.
  const upThenQuiet = [1, 1, ...Array(20).fill(0)];
  const st = run(new AdaptiveBand('sticky', 'binaural', 'beta'), 'beta', upThenQuiet);
  const sm = run(new AdaptiveBand('smooth', 'binaural', 'beta'), 'beta', upThenQuiet);
  const into = st.indexOf('gamma'), down = st.indexOf('beta');
  check(into === 1 && sm.indexOf('gamma') === 1, 'both step into Gamma on the 2nd loud tick');
  check(down - into === 11, `Sticky: the step down comes on the 11th tick at Gamma (${down - into}): 10 counted, the 10th the first that agrees`);
  check(st.slice(into + 1, down).every((x) => x === '-'), 'Sticky: nothing in between');
  check(sm.indexOf('beta') - sm.indexOf('gamma') === 2, 'Smooth: no hold (the step down two ticks after the step in)');
  // Refused ticks reset the hysteresis: a run whose ticks alternate during the hold still needs two agreeing ticks after
  // it (a hold that only dropped the step would leave the count half-done and step on the first tick after it).
  for (const lead of [8, 9]) {
    const xs = [1, 1, ...Array(lead).fill(0), 0, 0, 0];
    const r = run(new AdaptiveBand('sticky', 'binaural', 'beta'), 'beta', xs);
    check(r.indexOf('beta') - r.indexOf('gamma') === 11, `refused ticks reset the hysteresis (${lead} quiet ticks first): the step still on the 11th`);
  }
  // The 10th tick at Gamma agrees, the 11th is loud again: no step; then two quiet ticks step.
  {
    const xs = [1, 1, ...Array(9).fill(0), 0, 1, 0, 0];
    const r = run(new AdaptiveBand('sticky', 'binaural', 'beta'), 'beta', xs);
    check(r.indexOf('beta') === 1 + 13, `after the hold, a step needs two agreeing ticks as usual (${r.join(',')})`);
    const q = run(new AdaptiveBand('sticky', 'binaural', 'beta'), 'beta', [1, 1, ...Array(9).fill(0), 1, 0, 0]);
    check(q.indexOf('beta') === 1 + 12, `a loud 10th tick at Gamma: the two quiet ticks after it step (${q.join(',')})`);
  }
  // A start at Gamma (a new track, a resume): the hold counts from construction.
  {
    const r = run(new AdaptiveBand('sticky', 'binaural', 'gamma'), 'gamma', Array(14).fill(0));
    check(r.indexOf('beta') === 10, `a start at Gamma holds 10 ticks too (the step on tick ${r.indexOf('beta') + 1})`);
    const s = run(new AdaptiveBand('smooth', 'binaural', 'gamma'), 'gamma', Array(4).fill(0));
    check(s.indexOf('beta') === 1, 'Smooth from Gamma: two ticks');
  }
  // Re-entry holds again; a hold isn't carried below Gamma.
  {
    const xs = [1, 1, ...Array(11).fill(0), 1, 1, 1, 1, ...Array(12).fill(0)];
    const r = run(new AdaptiveBand('sticky', 'binaural', 'beta'), 'beta', xs);
    const ins = r.flatMap((x, k) => (x === 'gamma' ? [k] : [])), outs = r.flatMap((x, k) => (x === 'beta' ? [k] : []));
    check(ins.length === 2 && outs.length === 2 && outs[0] - ins[0] === 11 && outs[1] - ins[1] === 11, `each entry into Gamma holds 10 ticks (${r.join(',')})`);
  }
  // The pulse never holds (Gamma is out of its reach: a Gamma left from headphones steps down as in v16.8.3).
  check(run(new AdaptiveBand('sticky', 'pulse', 'gamma'), 'gamma', [0, 0]).join(',') === '-,beta', 'Sticky under the pulse: no hold');
  // During the hold no number of agreeing ticks steps.
  check(run(new AdaptiveBand('sticky', 'binaural', 'gamma'), 'gamma', Array(9).fill(0)).every((x) => x === '-'), 'the hold refuses every tick before the 10th');
  // An unparsed mode reads as Smooth.
  check(new AdaptiveBand('STICKY' as GammaMode, 'binaural', 'gamma').mode === 'smooth', 'AdaptiveBand parses its mode');
}

// ---- 7. The setting -----------------------------------------------------------------------------------------------
check(KEY_ADAPTIVE_GAMMA === 'aetheria.adaptiveGamma.v1' && DEFAULT_GAMMA_MODE === 'smooth', 'the key, and Smooth by default');
check(parseGammaMode('smooth') === 'smooth' && parseGammaMode('sticky') === 'sticky', 'parseGammaMode: the two values');
for (const raw of [null, undefined, '', 'Smooth', 'STICKY', ' sticky', 'sticky ', '"sticky"', 'sticky\n', 'true', '1', 1, 0, true, {}, [], ['sticky'], NaN]) {
  check(parseGammaMode(raw) === 'smooth', `parseGammaMode(${JSON.stringify(raw) ?? String(raw)}) is the default`);
}

// ---- 8. The words (components/layers/layerCopy.ts): the reviewed text, and its numbers are this check's ----------------
{
  check(copy.GAMMA_MODE_LEGEND === 'Gamma in Adaptive', 'the legend');
  check(same(copy.GAMMA_MODE_ITEMS.map((x) => x.id), ['smooth', 'sticky']) && same(copy.GAMMA_MODE_ITEMS.map((x) => x.title), ['Smooth', 'Sticky']), 'Smooth, then Sticky');
  const [smooth, sticky] = copy.GAMMA_MODE_ITEMS.map((x) => x.subtitle);
  // v16.8.4 fix round 1 (rev1 logic S1, S2, N1): the corrected words (the reviewed ones said "an octave" and "a short fade").
  check(smooth === 'No fade. On 11 of the 33 tones the beat pair sits an octave or two higher all track.', 'Smooth: the fix round 1 words');
  check(sticky === 'The usual beat pair. On 11 tones the layers drop out for a few seconds when Gamma starts or ends; once reached, Gamma holds at least 30 s.', 'Sticky: the fix round 1 words');
  check(smooth.includes(`On ${moved.length} of the ${tones.length} tones`) && sticky.includes(`On ${moved.length} tones`), `the counts are the derived ones (${moved.length} of ${tones.length})`);
  check(sticky.includes(`once reached, Gamma holds at least ${GAMMA_HOLD_TICKS * 3} s`), 'the hold in the words is the hold (10 ticks × 3 s), once reached');
  // "an octave or two": each of the moved tones' carriers goes up by a whole octave or two from Beta's to Gamma's, never
  // more, never less, never down (so a tone moving three octaves, or none, or part of one, fails here), and both happen.
  const octavesUp = (f: number): number => Math.log2(carrierAt(f, BANDS.gamma) / carrierAt(f, BANDS.beta));
  const anOctaveOrTwo = (octaves: number[]): boolean =>
    octaves.length > 0 && octaves.every((o) => Math.abs(o - Math.round(o)) < 1e-9 && Math.round(o) >= 1 && Math.round(o) <= 2);
  // Fix round 2 (rev2 tests N4): and near-whole ones (1.25, 1.9), so a loose whole-octave tolerance fails here too.
  check(anOctaveOrTwo([1, 2, 1]) && !anOctaveOrTwo([1, 3]) && !anOctaveOrTwo([1, 0]) && !anOctaveOrTwo([1, 0.5]) && !anOctaveOrTwo([1, 1.25]) && !anOctaveOrTwo([1, 1.9]) && !anOctaveOrTwo([1, -1]) && !anOctaveOrTwo([]),
    'the "an octave or two" rule itself refuses three octaves, none, part of one (0.5, 1.25, 1.9), one down and an empty list');
  const ups = moved.map((t) => octavesUp(t.f));
  const upsText = ups.map((o) => +o.toFixed(6)).join(', ');
  check(moved.length === 11 && anOctaveOrTwo(ups), `each of the ${moved.length} moves up an octave or two (${upsText})`);
  check(same([...new Set(ups.map((o) => Math.round(o)))].sort(), [1, 2]), `both happen: one octave and two (${upsText})`);
  check(smooth.includes('the beat pair sits an octave or two higher all track'), 'the Smooth words say "an octave or two", and "the beat pair"');
  // Off headphones: just "Headphones only." (the drone's own words); the presets note, on the same card, says the rest.
  check(copy.GAMMA_MODE_OFF_HEADPHONES === 'Headphones only.' && copy.GAMMA_MODE_OFF_HEADPHONES === copy.DRONE_HEADPHONES_ONLY, 'the note off headphones: "Headphones only."');
  {
    const sentences = (s: string) => s.split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean);
    const shared = sentences(copy.GAMMA_MODE_OFF_HEADPHONES).filter((x) => sentences(copy.PRESETS_NOTE_V2).includes(x));
    check(shared.length === 0, `the note off headphones repeats no sentence of the presets note (${JSON.stringify(shared)})`);
  }
  check(copy.PRESETS_NOTE_V2 === 'Adaptive reaches Gamma on headphones. Off headphones the beat is a gentle pulse, capped at Alpha.', 'the presets note');
  check(adaptiveCap('pulse') === 'alpha' && copy.PRESETS_NOTE_V2.endsWith('capped at Alpha.') && adaptiveCap('binaural') === 'gamma' && copy.PRESETS_NOTE_V2.startsWith('Adaptive reaches Gamma'), 'the note says the caps');
}

console.log(`adaptiveBand: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures.slice(0, 30)) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
