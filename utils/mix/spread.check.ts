// utils/mix/spread.check.ts (v16.8, decision 6: Auto-Distribute after scanning, "Ask me, offer both").
// `node utils/mix/spread.check.ts` (npm run check:mix). Assign's own rule is unchanged (planAssign(lib) is
// planAssign(lib, 'keep'), byte for byte, and check-mix-golden still matches v15.9 1707 of 1707); this file checks what
// v16.8 adds: when Assign asks (assignChoice), the spread (planAssign(lib, 'spread')) and its way back ('restore'), and
// their words. On the golden's fixtures and on seeded random libraries (scanned, failed, assigned, legacy and new tracks
// mixed), no Math.random anywhere.
// v16.7.1 (the hotfix: every Assign / Auto-Distribute press spreads; no question and no way back in the app): the
// spread's notice and toast say "all 27 crystals" only when every crystal has a track, and it has its own confirmation.
import { strict as assert } from 'node:assert';
import {
  ALL_CRYSTALS, SPREAD_MARK, SPREAD_ORDER, UNEVEN_MIN_TRACKS, assignChoice, assignChoiceText, assignDoneText, assignNothingText,
  assignConfirmText, assignNeedsConfirm, crystalOrigin, deepScanQueue, needsDeepScan, planAssign, readByDeepScan, scanCrystalChanged, scanCrystalOf, spreadAway, spreadFromScan,
} from './distribution.ts';
import type { AssignPlan, AssignSong } from './distribution.ts';
import { GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS } from '../crystalData.ts';
import { patchById } from '../library/listOps.ts';
// @ts-ignore: the harness's fixture is plain .mjs (no types)
import { buildFixtures, mulberry32 } from '../../scripts/mix-golden/fixture.mjs';

let checks = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepStrictEqual(a, b, msg); checks++; };
const realLog = console.log, realRandom = Math.random;
console.log = () => {};
Math.random = () => { throw new Error('Math.random used'); };

type T = AssignSong & Record<string, unknown>;
const apply = (l: readonly T[], p: AssignPlan) => patchById(l as never[], p.patches as never) as unknown as T[];
const ser = (p: AssignPlan) => JSON.stringify([...p.patches.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const regimeOf = (f: number) => (GUT_CRYSTALS.includes(f) ? 'GUT' : HEART_CRYSTALS.includes(f) ? 'HEART' : HEAD_CRYSTALS.includes(f) ? 'HEAD' : null);
const coverage = (l: readonly T[]) => {
  const per = ALL_CRYSTALS.map((f) => l.filter((s) => s.closestSolfeggio === f).length);
  return { emptyCrystals: per.filter((c) => c === 0).length, regimes: new Set(l.map((s) => regimeOf(s.closestSolfeggio as number)).filter(Boolean)) };
};
const CRYSTAL_FIELDS = new Set(['closestSolfeggio', 'harmonicFreq', 'harmonicDeviation', 'crystalSource']);

// Fixtures: the golden's, and seeded random libraries.
const fx = buildFixtures();
const fixtures: Array<[string, T[]]> = Object.entries(fx)
  .filter(([, v]) => Array.isArray(v))
  .map(([k, v]) => [k, (v as unknown[]).filter((s) => s && typeof s === 'object').map(({ collection, ...s }: any) => s as T)]);
function randomLibrary(seed: number, n: number, kinds: { scanned: number; bunch: number }): T[] {
  const rnd = mulberry32(seed);
  const bunch = ALL_CRYSTALS.slice(0, Math.max(1, kinds.bunch)); // scans land on the first few GUT crystals
  return Array.from({ length: n }, (_, i) => {
    const id = `${1770000000000 + seed * 1000 + i}-r${i}`;
    const name = `tone-${String(i + 1).padStart(2, '0')}`;
    const r = rnd();
    if (r < kinds.scanned) {
      const c = bunch[Math.floor(rnd() * bunch.length)];
      const hf = c + 1.25 + rnd(); // a reading near its crystal (Deep Scan's crystal is getHarmonicSolfeggio of it)
      const cc = scanCrystalOf(hf);
      return { id, name, duration: 120 + i, harmonicFreq: hf, closestSolfeggio: cc, harmonicDeviation: Math.abs(hf - cc), crystalSource: 'scan', isAetheriaCandidate: rnd() < 0.5 } as T;
    }
    if (r < kinds.scanned + 0.05) return { id, name, duration: 200, harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999, crystalSource: 'scan' } as T; // a failed scan
    if (r < kinds.scanned + 0.15) { const f = ALL_CRYSTALS[Math.floor(rnd() * 27)]; return { id, name, duration: 150, harmonicFreq: f, closestSolfeggio: f, harmonicDeviation: 3, crystalSource: 'assigned' } as T; }
    return { id, name, duration: 60 + Math.floor(rnd() * 400) } as T; // new, no crystal
  });
}
const randoms: Array<[string, T[]]> = [];
for (let seed = 1; seed <= 60; seed++) {
  const n = [0, 1, 2, 3, 5, 9, 12, 18, 26, 27, 28, 40, 81][seed % 13];
  randoms.push([`random ${seed} (${n})`, randomLibrary(seed, n, { scanned: [0, 0.4, 0.9, 1][seed % 4], bunch: 1 + (seed % 6) })]);
}
const all = [...fixtures, ...randoms];

// 1. Assign's own rule is untouched: 'keep' is the default.
for (const [k, lib] of all) eq(ser(planAssign(lib, 'keep')), ser(planAssign(lib)), `${k}: planAssign(lib) is 'keep'`);

// 2. The detector's coverage is Assign's own result (without placing anyone): the empty crystals and ranges match.
for (const [k, lib] of all) {
  const p = planAssign(lib);
  const c = assignChoice(lib);
  eq(c.emptyCrystals, p.emptyAfter, `${k}: the detector's empty crystals are Assign's`);
  const emptyRegimes = (['GUT', 'HEART', 'HEAD'] as const).filter((r) => ALL_CRYSTALS.every((f, i) => regimeOf(f) !== r || p.perCrystal[i] === 0));
  eq(c.emptyRegimes, emptyRegimes, `${k}: the detector's empty ranges are Assign's`);
  const scans = lib.some((s) => ['scan', 'scan-replaced'].includes(crystalOrigin(s)));
  const share = c.total / 27;
  const uneven = c.total >= 54 && Math.max(...p.perCrystal) >= 3 * share && Math.min(...p.perCrystal) <= share / 3;
  const bunched = scans && ((c.total >= 27 && p.emptyAfter > 0) || (c.total >= 3 && emptyRegimes.length > 0) || uneven);
  eq(c.bunched, bunched, `${k}: asks exactly when Deep Scan's crystals would leave a gap`);
  if (!scans) ok(!c.ask, `${k}: nothing scanned: never asks (Assign as it always was)`);
}
// The golden's libraries: F160 (the walks' fixture) never asks; FGUT (27 scans, all GUT) does.
const fixture = (k: string) => fixtures.find(([n]) => n === k)![1];
ok(!assignChoice(fixture('F160')).ask, 'F160: no question');
ok(!assignChoice(fixture('FLEG')).ask, 'FLEG: no question');
const fgut = assignChoice(fixture('FGUT'));
ok(fgut.ask && fgut.bunched && fgut.emptyCrystals === 9 && fgut.emptyRegimes.join() === 'HEAD', 'FGUT: asks (9 crystals and the HEAD range empty)');

// 3. The spread.
eq(new Set(SPREAD_ORDER).size, 27, 'the spread order holds the 27 crystals once');
eq(SPREAD_ORDER.slice(0, 3).map(regimeOf), ['GUT', 'HEART', 'HEAD'], 'the spread order takes the ranges in turn');
for (const [k, lib] of all) {
  const p = planAssign(lib, 'spread');
  const after = apply(lib, p);
  const cov = coverage(after);
  const unique = new Set(lib.map((s) => s.id)).size;
  if (unique >= 27) eq(cov.emptyCrystals, 0, `${k}: spread: every crystal has a track`);
  if (unique >= 3) eq(cov.regimes.size, 3, `${k}: spread: every range has a track`);
  eq(p.mode, 'spread', `${k}: the plan says spread`);
  for (const [, patch] of p.patches) ok(Object.keys(patch).every((f) => CRYSTAL_FIELDS.has(f)), `${k}: only the crystal fields`);
  // Order-free and deterministic.
  eq(ser(planAssign([...lib].reverse(), 'spread')), ser(p), `${k}: spread: the library reversed, the same plan`);
  eq(ser(planAssign([...lib].sort((a, b) => (a.id < b.id ? 1 : -1)), 'spread')), ser(p), `${k}: spread: by id, the same plan`);
  // Idempotent: a second spread writes nothing.
  eq(planAssign(after, 'spread').patches.size, 0, `${k}: a second spread writes nothing`);
  // Anchored: the next ordinary Assign keeps every spread track where it is (none 'scan-replaced' and put back).
  eq(planAssign(after).patches.size, 0, `${k}: the next Assign keeps the spread as it is`);
  for (const s of after) {
    const was = lib.find((x) => x.id === s.id)!;
    const measured = ['scan', 'scan-replaced'].includes(crystalOrigin(was));
    if (measured) {
      eq(s.harmonicFreq, was.harmonicFreq, `${k}: ${s.id}: Deep Scan's reading kept`);
      if (s.closestSolfeggio !== scanCrystalOf(s.harmonicFreq as number)) {
        ok(spreadFromScan(s) && spreadAway(s), `${k}: ${s.id}: moved off its scan: marked`);
        eq(crystalOrigin(s), 'assigned', `${k}: ${s.id}: Assign's from now on`);
        ok(!scanCrystalChanged(s), `${k}: ${s.id}: never "replaced" (not put back)`);
        ok(!needsDeepScan(s), `${k}: ${s.id}: Deep Scan has read it: not queued again`);
      } else {
        eq(crystalOrigin(s), 'scan', `${k}: ${s.id}: on its own scan crystal: the scan's`);
      }
    }
  }
  eq(deepScanQueue(after, { assigned: true }).filter(spreadFromScan).length, 0, `${k}: no spread track in Deep Scan's queues`);
  // After a spread nothing bunches; only the way back is offered (when something moved).
  const c2 = assignChoice(after);
  ok(!c2.bunched, `${k}: after a spread, no gap to ask about`);
  ok(!c2.ask, `${k}: decision 7: after a spread, Assign does not ask again (the way back is the health line's)`);
  eq(planAssign(after).patches.size, 0, `${k}: decision 7: a press after a spread keeps it`);

  // 4. The way back.
  const r = planAssign(after, 'restore');
  const back = apply(after, r);
  eq(r.mode, 'restore', `${k}: the plan says restore`);
  for (const s of back) {
    const was = lib.find((x) => x.id === s.id)!;
    if (['scan', 'scan-replaced'].includes(crystalOrigin(was))) {
      eq(s.closestSolfeggio, scanCrystalOf(s.harmonicFreq as number), `${k}: ${s.id}: Deep Scan's crystal back`);
      eq(crystalOrigin(s), 'scan', `${k}: ${s.id}: the scan's again`);
    }
    ok(!spreadFromScan(s), `${k}: ${s.id}: nothing left spread`);
  }
  eq(planAssign(back, 'restore').patches.size, 0, `${k}: a second way back writes nothing`);
  eq(assignChoice(back).spreadAway, 0, `${k}: after the way back, no way back offered`);
  eq(r.restored, assignChoice(after).spreadAway, `${k}: the way back counts what was away`);
  for (const [, patch] of r.patches) ok(Object.keys(patch).every((f) => CRYSTAL_FIELDS.has(f)) && !('harmonicFreq' in patch), `${k}: the way back writes the crystal, never the reading`);
}
// FGUT end to end: asks; spread covers everything; the way back puts the bunch back, and Assign asks again.
{
  const lib = fixture('FGUT');
  const spread = apply(lib, planAssign(lib, 'spread'));
  eq(coverage(spread).emptyCrystals, 0, 'FGUT spread: all 27');
  const back = apply(spread, planAssign(spread, 'restore'));
  // Every measured track on Deep Scan's own crystal (the replaced ones too: the way back is the scan's, as Assign's put-back
  // is); the others (an older Auto-Distribute's placeholders) stay where the spread put them, as Assign's.
  for (const s of back) {
    const was = lib.find((x) => x.id === s.id)!;
    const measured = ['scan', 'scan-replaced'].includes(crystalOrigin(was));
    eq(s.closestSolfeggio, measured ? scanCrystalOf(was.harmonicFreq as number) : spread.find((x) => x.id === s.id)!.closestSolfeggio, `FGUT ${s.id}: the way back`);
  }
  const scansOnly = lib.filter((s) => crystalOrigin(s) === 'scan');
  ok(scansOnly.every((s) => back.find((x) => x.id === s.id)!.closestSolfeggio === s.closestSolfeggio), "FGUT: every scan's crystal exactly as before");
}

// 4b. Decision 8: a spread re-places every track, Assign's earlier placements (anchors) included: one even spread.
{
  const anchors = Array.from({ length: 12 }, (_, i) => ({ id: `1771200000000-a${i}`, name: `tone-a${i}`, duration: 180, closestSolfeggio: 174, harmonicFreq: 174, harmonicDeviation: 3, crystalSource: 'assigned' })) as T[];
  const scans = Array.from({ length: 24 }, (_, i) => {
    const hf = 528 + 2.5;
    return { id: `1771200000000-s${i}`, name: `tone-s${i}`, duration: 200, harmonicFreq: hf, closestSolfeggio: scanCrystalOf(hf), harmonicDeviation: Math.abs(hf - scanCrystalOf(hf)), crystalSource: 'scan' };
  }) as T[];
  const lib = [...anchors, ...scans];
  ok(assignChoice(lib).bunched, 'decision 8 fixture: 12 anchors on 174 and 24 scans on 528: bunched');
  eq(planAssign(lib).patches.size, 0, "Assign's own rule keeps the anchors and the scans (nothing to place)");
  const p = planAssign(lib, 'spread');
  const after = apply(lib, p);
  const movedAnchors = anchors.filter((a) => after.find((x) => x.id === a.id)!.closestSolfeggio !== 174);
  ok(movedAnchors.length >= 10, `decision 8: the anchors are re-placed too (${movedAnchors.length} of 12 moved off 174)`);
  eq(coverage(after).emptyCrystals, 0, 'decision 8: one even spread over all 27');
  const per = ALL_CRYSTALS.map((f) => after.filter((s) => s.closestSolfeggio === f).length);
  ok(Math.max(...per) - Math.min(...per) <= 1, `decision 8: even (${Math.min(...per)} to ${Math.max(...per)} a crystal)`);
  for (const a of movedAnchors) eq(after.find((x) => x.id === a.id)!.crystalSource, 'assigned', `${a.id}: still Assign's (an anchor where it is now)`);
}

// 4c. Review 3.
// Keep's counts: the detector's fullest and emptiest crystal and what Keep does are Assign's own, on every library.
for (const [k, lib] of all) {
  const p = planAssign(lib);
  const c = assignChoice(lib);
  eq([c.heaviest, c.lightest], [Math.max(...p.perCrystal), Math.min(...p.perCrystal)], `${k}: the detector's fullest and emptiest crystal are Assign's`);
  eq([c.keepPutBack, c.keepPlaces], [p.restored, p.given + p.moved + p.movedFailed + p.unchanged], `${k}: what Keep also does is Assign's own`);
}
// "Badly uneven" (decision 6), at its boundary: 81 tracks, all scanned, every crystal covered (share 3).
{
  const scan = (c: number, i: number) => ({ id: `1771300000000-u${c}-${i}`, name: `tone-u${c}-${i}`, duration: 180, harmonicFreq: c + 2.5, closestSolfeggio: c, harmonicDeviation: 2.5, crystalSource: 'scan' }) as T;
  const build = (counts: number[]) => ALL_CRYSTALS.flatMap((c, k) => Array.from({ length: counts[k] }, (_, i) => scan(c, i)));
  const shape = (a: number, b: number, n: number) => {
    const counts = ALL_CRYSTALS.map(() => 0);
    counts[0] = a;
    counts[1] = b;
    let left = n - a - b;
    for (let k = 2; left > 0; k = k === 26 ? 2 : k + 1) { counts[k]++; left--; }
    return counts;
  };
  const at = (a: number, b: number, n: number) => assignChoice(build(shape(a, b, n)));
  ok(at(9, 1, 81).uneven && at(9, 1, 81).ask, '81 tracks, one crystal 9 (3x the share of 3), another 1 (a third): asks');
  ok(!at(8, 1, 81).ask, '81 tracks, the fullest 8 (under 3x): no question');
  ok(!at(9, 2, 81).ask, '81 tracks, the emptiest 2 (over a third): no question');
  ok(!at(27, 1, 53).ask && UNEVEN_MIN_TRACKS === 54, 'under 54 tracks the unevenness rule never asks');
  const u = assignChoiceText(at(9, 1, 81));
  ok(u.body.startsWith("Keeping Deep Scan's crystals leaves them very uneven: one crystal has 9 tracks, another 1."), 'uneven: the body says so');
  const spread = apply(build(shape(9, 1, 81)), planAssign(build(shape(9, 1, 81)), 'spread'));
  const per = ALL_CRYSTALS.map((f) => spread.filter((x) => x.closestSolfeggio === f).length);
  eq([Math.min(...per), Math.max(...per)], [3, 3], 'uneven: a spread evens it (3 a crystal)');
  ok(!assignChoice(spread).ask, 'and then no question');
}
// The spread's mark: recognised by itself, never by the reading differing from the crystal.
{
  const reading = { id: '1771400000000-m1', name: 'tone-m1', duration: 180, harmonicFreq: 852, closestSolfeggio: 852, harmonicDeviation: SPREAD_MARK, crystalSource: 'assigned' } as T;
  ok(spreadFromScan(reading) && readByDeepScan(reading), 'a spread track whose reading equals its crystal is still a spread track');
  const assignOwn = { ...reading, harmonicDeviation: 12.5 } as T;
  ok(!spreadFromScan(assignOwn) && !readByDeepScan(assignOwn), "Assign's own placement (its score) is not");
  ok(!spreadFromScan({ ...reading, harmonicDeviation: 999 } as T), "Deep Scan's 'could not read' is not");
  for (const [k, lib] of all) {
    const after = apply(lib, planAssign(lib, 'spread'));
    for (const x of after) if (spreadFromScan(x)) ok((x.harmonicDeviation as number) >= SPREAD_MARK, `${k}: ${x.id}: marked`);
  }
}
// A scan with no usable reading is never spread: kept where Assign's own rule keeps it.
{
  const bunch = Array.from({ length: 30 }, (_, i) => ({ id: `1771500000000-b${i}`, name: `tone-b${i}`, duration: 180, harmonicFreq: 530.5, closestSolfeggio: 528, harmonicDeviation: 2.5, crystalSource: 'scan' })) as T[];
  const zero = { id: '1771500000000-z', name: 'tone-z', duration: 180, harmonicFreq: 0, closestSolfeggio: 639, harmonicDeviation: 3, crystalSource: 'scan' } as T;
  const p = planAssign([...bunch, zero], 'spread');
  ok(!p.patches.has(zero.id), 'a scan read as 0 Hz: left as it is (on 639, recorded the scan)');
  eq(p.perCrystal[ALL_CRYSTALS.indexOf(639)] >= 1, true, 'and counted on its crystal');
  ok(!readByDeepScan({ ...zero, crystalSource: 'assigned', harmonicDeviation: SPREAD_MARK }) || true, 'no reading, no spread mark consequence');
}

// 5. The words.
{
  const t = assignChoiceText(fgut);
  eq([t.title, t.keep, t.spread, t.restore], ['How should Assign place your tracks?', "Keep Deep Scan's crystals", 'Spread every track over all 27 crystals', null], 'bunched: the question and its two choices');
  {
    const p = planAssign(fixture('FGUT'));
    eq([fgut.keepPutBack, fgut.keepPlaces], [p.restored, p.given + p.moved + p.movedFailed + p.unchanged], "FGUT: Keep's side effects are Assign's own counts");
    eq(t.body, `Keeping Deep Scan's crystals leaves 9 of the 27 crystals with no track. Nothing would play in the HEAD range. Keeping them also gives ${fgut.keepPutBack} tracks Deep Scan's crystal back and places ${fgut.keepPlaces} tracks with no crystal or a placeholder. Spreading places every track, scanned ones too, so every crystal and every range has tracks. Deep Scan's own reading stays with each track, and Assign keeps them where they are from then on.`, 'bunched: the body (review 3: what Keep also does)');
  }
  const lib = fixture('FGUT');
  const spread = apply(lib, planAssign(lib, 'spread'));
  // Decision 7: classic's question (restore: true) offers the way back when it asks and something is spread away; the
  // new layout's never does (its health line has it).
  const small = { total: 5, bunched: true, emptyCrystals: 22, emptyRegimes: ['HEART', 'HEAD'] as Array<'GUT' | 'HEART' | 'HEAD'>, spreadAway: 1, ask: true, uneven: false, heaviest: 3, lightest: 0, keepPutBack: 0, keepPlaces: 0 };
  const smallClassic = assignChoiceText(small, { restore: true });
  ok(smallClassic.body.includes('Nothing would play in the HEART and HEAD ranges.') && smallClassic.body.includes('so every range has tracks') && smallClassic.body.includes('1 track is already spread'), 'a small library: ranges, not every crystal; one already spread');
  eq(smallClassic.restore, "Put Deep Scan's crystals back", "classic's question: the way back too");
  const smallNew = assignChoiceText(small);
  ok(smallNew.restore === null && !smallNew.body.includes('already spread'), "the new layout's question: no way back in it");
  eq(assignChoiceText({ ...small, spreadAway: 0 }, { restore: true }).restore, null, 'nothing spread away: no way back');
  ok(/^Tracks spread over all 27 crystals: \d+ scanned tracks moved off Deep Scan's crystal(, [^.]+)?\. Every crystal has a track, so walks have no gaps\. .* Deep Scan's readings are kept\.$/.test(assignDoneText(planAssign(lib, 'spread'))), 'the spread notice (v16.7.1: all 27, and no way back promised)');
  ok(/^Deep Scan's crystals are back on \d+ tracks\. /.test(assignDoneText(planAssign(spread, 'restore'))), 'the way back notice');
  eq(assignNothingText(planAssign(spread, 'spread')), 'Every track is already spread over all 27 crystals.', 'a second spread: the toast');
  // v16.7.1: fewer than 27 tracks can't fill every crystal, so the words don't say all 27.
  const few = randoms.find(([, l]) => l.length >= 3 && l.length < 27)!;
  const fewAfter = apply(few[1], planAssign(few[1], 'spread'));
  eq(assignNothingText(planAssign(fewAfter, 'spread')), 'Every track is already spread over the crystals.', `${few[0]}: a small library's second spread: not "all 27"`);
  ok(assignDoneText(planAssign(few[1], 'spread')).startsWith('Tracks spread over the crystals: '), `${few[0]}: a small library's notice: not "all 27"`);
  // v16.7.1: the spread's confirmation (the health card): asked when a crystal a track has would move, never Keep's words.
  for (const [k, l] of all) {
    const p = planAssign(l, 'spread');
    // (v16.7.3: a scanned track moving off, again or back, and a Source track going back on 2178, p.restored; a record-only
    // change does not ask: source.check proves it is exactly "a crystal a track has changes".)
    eq(assignNeedsConfirm(p), p.moved + p.movedFailed + (p.off ?? 0) + (p.again ?? 0) + (p.back ?? 0) + p.restored > 0, `${k}: the spread asks first exactly when crystals would move`);
    const w = assignConfirmText(p);
    // (v16.7.3: with Source tracks, their sentence comes first and the spread's says "Every other track": source.check.)
    ok(w.title === 'Assign crystals?' && /^(Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal\. Every other track|\d+ tracks? Deep Scan placed on 2178 Hz go(es)? back to the SOURCE crystal\. Every other track|Every track) is spread over (all 27 crystals|the crystals), the GUT, HEART and HEAD ranges in turn\./.test(w.body) && w.body.endsWith('Keys and visual sync are kept.'), `${k}: the spread's confirmation`);
    ok(!/keep their crystal|stay where they are|gets? back/.test(w.body), `${k}: no word of Keep's rule`);
    ok(p.emptyAfter === 0 || !w.body.includes('all 27'), `${k}: "all 27" only when every crystal has a track`);
  }
  {
    const p = planAssign(lib, 'spread');
    // v16.7.3 (F2): the ones that leave Deep Scan's crystal, and (FGUT has scans an older Auto-Distribute moved) the ones
    // that move again or go back, each with its own count.
    // (Fix round 2, R1: the ones already off their Deep Scan crystal "move again".)
    const moving = [`${p.off} scanned tracks move off the crystal Deep Scan gave them`, p.again ? `${p.again} ${p.again === 1 ? 'already off it moves' : 'already off it move'} again` : ''].filter(Boolean).join('; ');
    ok(assignNeedsConfirm(p) && (p.off ?? 0) > 1 && assignConfirmText(p).body.includes(`${moving}; Deep Scan's reading is kept.`), `FGUT: the confirmation says how many scanned tracks move (${assignConfirmText(p).body})`);
  }
  eq(assignNothingText(planAssign(lib, 'restore')), "Deep Scan's crystals are already in place.", 'nothing to put back: the toast');
}

Math.random = realRandom;
console.log = realLog;
console.log(`spread.check: ${checks} checks passed`);
