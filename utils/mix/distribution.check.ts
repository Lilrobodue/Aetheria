// utils/mix/distribution.check.ts (v15.8): Assign crystals' own rules, without App. `node utils/mix/distribution.check.ts`
// (npm run check:mix). On FLEG (a v15.7 library replayed with v15.7's own code: Deep Scan, the old Auto-Distribute,
// later imports and scans; each track's true history stored with it), F160, F3, an empty library and a 5,000-track
// copy: no randomness, the same plan every time and in any order, a second press writes nothing, Deep Scan's crystals
// kept or put back, every other track placed (empty crystals first) and still unscanned. Decision 5: a crystal Assign
// placed before is an anchor (an import places only the new tracks, a delete moves no one). Decision 6: Deep Scan's
// default queue leaves assigned tracks alone; the explicit one adds them after.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  ALL_CRYSTALS, crystalOrigin, needsDeepScan, deepScanQueue, planAssign, standInFreq, assignConfirmText, assignDoneText,
  assignNothingText, assignNeedsConfirm, scanCrystalOf, scanCrystalChanged,
} from './distribution.ts';
import type { AssignPlan } from './distribution.ts';
import { getHarmonicSolfeggio, SOLFEGGIO_INFO } from '../crystalData.ts';
import { patchById } from '../library/listOps.ts';
import type { Song } from '../../types.ts';
// @ts-ignore: the harness's fixture is plain .mjs (no types)
import { buildFixtures, flegTruth, mulberry32 } from '../../scripts/mix-golden/fixture.mjs';

let checks = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepStrictEqual(a, b, msg); checks++; };
const realLog = console.log, realWarn = console.warn, realRandom = Math.random;
console.log = () => {}; console.warn = () => {}; // getHarmonicSolfeggio logs every match
const noRandom = () => { throw new Error('Math.random used'); };

const fx = buildFixtures();
const fleg: Song[] = fx.FLEG;
const truth: Record<string, string> = flegTruth();
const apply = (l: readonly Song[], p: AssignPlan) => patchById(l as Song[], p.patches as Map<string, Partial<Song>>);
const ser = (p: AssignPlan) => JSON.stringify([...p.patches.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const CRYSTAL_FIELDS = ['closestSolfeggio', 'harmonicFreq', 'harmonicDeviation', 'crystalSource'];

// 1. Where a crystal comes from: FLEG's replayed history, 230 of 230.
const expectOrigin: Record<string, string> = { 'scan-replaced': 'scan-replaced', 'scan-failed-then-AD': 'assigned', placeholder: 'assigned', scan: 'scan', none: 'none' };
ok(fleg.length === 230, 'FLEG has 230 tracks');
for (const s of fleg) ok(crystalOrigin(s) === expectOrigin[truth[s.id]], `FLEG ${s.id}: ${truth[s.id]} → ${crystalOrigin(s)}`);
const tally = (l: readonly Song[]) => l.reduce((m: Record<string, number>, s) => ((m[crystalOrigin(s)] = (m[crystalOrigin(s)] ?? 0) + 1), m), {});
eq(tally(fleg), { 'scan-replaced': 90, assigned: 110, scan: 10, none: 20 }, 'FLEG: 10 scans, 90 replaced, 110 old placeholders, 20 never placed');
// The recorded field wins over the derivation; a failed scan is told apart; no measurement, no scan.
ok(crystalOrigin({ crystalSource: 'assigned', isAetheriaCandidate: true, harmonicFreq: 530, closestSolfeggio: 528, harmonicDeviation: 2 }) === 'assigned', 'recorded: assigned');
ok(crystalOrigin({ crystalSource: 'scan', harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999 }) === 'scan-failed', 'recorded: a failed scan');
ok(crystalOrigin({ crystalSource: 'scan', harmonicFreq: 640, closestSolfeggio: 528, harmonicDeviation: 3 }) === 'scan', 'recorded: scan, whatever the relation');
ok(crystalOrigin({ fractalAnalysis: null as never, harmonicFreq: 530.5, closestSolfeggio: 528, harmonicDeviation: 2.5 }) === 'scan', 'derived: a null fractal analysis is still a scan');
ok(crystalOrigin({ fractalAnalysis: {} as never, closestSolfeggio: 528 }) === 'assigned', 'derived: a scan marker without a harmonicFreq is not a scan (no measurement)');
ok(crystalOrigin({ harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999 }) === 'scan-failed', 'derived: the 999 fallback');
ok(crystalOrigin({}) === 'none', 'nothing: none');
for (const bad of [NaN, Infinity, -1, 0]) ok(['assigned', 'scan-replaced', 'none'].includes(crystalOrigin({ isAetheriaCandidate: false, harmonicFreq: bad, closestSolfeggio: 528, harmonicDeviation: bad })), `total on ${bad}`);

// 2. The old Auto-Distribute never left a placeholder that passes for a scan: v15.7's own distributor (lifted from git
//    016fc28 in memory), 50 seeded runs over F160.
const fnv1a = (str: string) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const standInTracks: Song[] = [...fx.F160, ...fx.F160u, ...fx.FLEG].filter((s: unknown) => typeof s === 'object').map(({ collection, ...s }: any) => s);
{
  const root = fileURLToPath(new URL('../..', import.meta.url));
  let app: string | null = null;
  try { app = execFileSync('git', ['show', '016fc28:App.tsx'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { app = null; }
  if (app) {
    const ts = createRequire(root + '/package.json')('typescript');
    const sf = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const text = (name: string) => sf.statements.find((st: any) => ts.isVariableStatement(st) && st.declarationList.declarations.some((d: any) => d.name.getText(sf) === name))!.getText(sf);
    const js = ts.transpileModule([text('getHarmonicSolfeggio'), text('distributeUsingHarmonicOctaves'), text('distributeUsingHarmonicOctavesMaster'), 'module.exports = distributeUsingHarmonicOctavesMaster;'].join('\n'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const m = { exports: null as any };
    new Function('module', 'console', 'SOLFEGGIO_INFO', js)(m, { log() {}, warn() {} }, SOLFEGGIO_INFO);
    const f160 = (fx.F160 as Song[]).map(({ collection, ...s }: any) => s);
    let tracks = 0, same = 0;
    for (let seed = 1; seed <= 50; seed++) {
      Math.random = mulberry32(seed);
      try {
        for (const s of m.exports(f160, [...ALL_CRYSTALS]) as Song[]) {
          tracks++;
          if (Math.abs((s.harmonicDeviation as number) - Math.abs((s.harmonicFreq as number) - (s.closestSolfeggio as number))) < 1e-6) same++;
        }
      } finally { Math.random = realRandom; }
    }
    eq([tracks, same], [8000, 0], 'v15.7 Auto-Distribute, 50 seeds × 160 tracks: no placement keeps the scan relation');
    // The stand-in is v15.7's name-and-length heuristic, draw for draw: the old distributor, given one unscanned track
    // and Math.random = the track's own seeded generator (mulberry32(fnv1a(id))), stores the same placeholder.
    let compared = 0, differ = 0;
    for (const s of standInTracks) {
      const { harmonicFreq, closestSolfeggio, harmonicDeviation, fractalAnalysis, isAetheriaCandidate, ...bare } = s as any;
      Math.random = mulberry32(fnv1a(s.id));
      try {
        const [placed] = m.exports([bare], [...ALL_CRYSTALS]) as Song[];
        compared++;
        if (placed.harmonicFreq !== standInFreq(s)) differ++;
      } finally { Math.random = realRandom; }
    }
    eq([compared, differ], [standInTracks.length, 0], `the stand-in is v15.7's heuristic, draw for draw (${standInTracks.length} tracks)`);
  } else {
    realLog('distribution.check: no git history here; the v15.7 coincidence count and the verbatim stand-in are skipped');
  }
}
// The stand-ins pinned (also without git): a checksum of every fixture track's, to 6 decimals.
eq(createHash('sha256').update(standInTracks.map((s) => standInFreq(s).toFixed(6)).join(',')).digest('hex').slice(0, 16), 'ff03eda634c74d77', `the stand-ins of ${standInTracks.length} fixture tracks, pinned`);

// 3. The plan on FLEG, with Math.random throwing (no randomness anywhere).
Math.random = noRandom;
try {
  const p1 = planAssign(fleg);
  const p2 = planAssign(fleg);
  ok(ser(p1) === ser(p2), 'deterministic');
  ok(ser(p1) === ser(planAssign([...fleg].reverse())), 'order-free (the library reversed)');
  ok(ser(p1) === ser(planAssign([...fleg].sort((a, b) => (a.id < b.id ? 1 : -1)))), 'order-free (by id, descending)');
  const after = apply(fleg, p1);
  const again = planAssign(after);
  eq([again.patches.size, again.kept, again.anchored, again.unchanged, again.restored, again.given, again.moved, again.movedFailed], [0, 100, 130, 0, 0, 0, 0, 0], 'a second press: nothing to write (100 from Deep Scan, 130 anchored)');
  eq(assignNothingText(again), 'Every track already has its crystal (100 from Deep Scan, 130 assigned).', 'the second press’s toast');
  // Deep Scan's crystals: kept, or put back from the track's own measurement (harmonicFreq untouched).
  let restoredSame = 0;
  for (const s of fleg) {
    const o = crystalOrigin(s);
    const p = p1.patches.get(s.id);
    if (o === 'scan') ok(!p, 'a scanned crystal is kept, unwritten');
    if (o === 'scan-replaced') {
      const c = getHarmonicSolfeggio(s.harmonicFreq as number);
      ok(p && p.closestSolfeggio === c && p.harmonicDeviation === Math.abs((s.harmonicFreq as number) - c) && p.crystalSource === 'scan' && !('harmonicFreq' in p), 'restored to its own scan, harmonicFreq untouched');
      if (c === s.closestSolfeggio) restoredSame++;
    }
    if (o === 'assigned' || o === 'none' || o === 'scan-failed') {
      ok(p && p.crystalSource === 'assigned' && p.harmonicFreq === p.closestSolfeggio && ALL_CRYSTALS.includes(p.closestSolfeggio as number), 'placed: assigned, harmonicFreq = the crystal (playback-ready)');
    }
    if (p) ok(Object.keys(p).every((k) => CRYSTAL_FIELDS.includes(k)), 'only the four crystal fields');
  }
  // The counts: a put-back that lands on the same crystal is "kept"; only real crystal changes are moves.
  eq([p1.total, p1.kept + p1.restored, p1.restored, p1.given, p1.patches.size], [230, 100, 90 - restoredSame, 20, 220], 'FLEG: 100 Deep Scan crystals (kept or put back), 20 given, 220 patches');
  ok(p1.moved + p1.unchanged === 110, 'FLEG: the 110 old placeholders moved or kept their crystal');
  const placedOld = fleg.filter((s) => crystalOrigin(s) === 'assigned');
  eq(p1.moved, placedOld.filter((s) => p1.patches.get(s.id)!.closestSolfeggio !== s.closestSolfeggio).length, 'moved = old placeholders whose crystal changes');
  ok(assignNeedsConfirm(p1), 'FLEG: existing crystals change, so the new layout asks first');
  // Old placeholders are not inputs: scrambling their stored values changes no placement.
  const scrambled = fleg.map((s) => (crystalOrigin(s) === 'assigned' ? { ...s, harmonicFreq: 123.4, closestSolfeggio: 6336, harmonicDeviation: 5 } : s));
  const pS = planAssign(scrambled);
  for (const s of placedOld) ok(pS.patches.get(s.id)?.closestSolfeggio === p1.patches.get(s.id)!.closestSolfeggio, 'an old placeholder’s values change nothing');
  // After: every track has a crystal, every crystal a track; assigned tracks stay in Deep Scan's queue, scans don't.
  ok(after.every((s) => s.closestSolfeggio), 'every track has a crystal');
  eq(p1.emptyAfter, 0, 'no empty crystal (enough tracks)');
  ok(after.filter((s) => crystalOrigin(s) === 'assigned').every((s) => needsDeepScan(s)), 'assigned tracks are in Deep Scan’s queue');
  ok(after.filter((s) => crystalOrigin(s) === 'scan').every((s) => !needsDeepScan(s)), 'scans are not');
  eq(tally(after), { scan: 100, assigned: 130 }, 'after: 100 scan, 130 assigned');
  // Deep Scan's queues (decision 6): by default the tracks with no crystal; with { assigned: true } the assigned after.
  const before = deepScanQueue(fleg);
  eq(before.length, 20, 'before, the default: the 20 with no crystal');
  ok(before.every((s) => !s.closestSolfeggio && crystalOrigin(s) === 'none'), 'no assigned or scanned track in the default queue');
  const beforeAll = deepScanQueue(fleg, { assigned: true });
  eq(beforeAll.length, 130, 'before, with the assigned: 20 then the 110 old placeholders');
  ok(JSON.stringify(beforeAll.slice(0, 20)) === JSON.stringify(before) && beforeAll.slice(20).every((s) => crystalOrigin(s) === 'assigned'), 'no-crystal tracks first');
  ok(JSON.stringify(beforeAll.slice(20).map((s) => fleg.indexOf(s))) === JSON.stringify(beforeAll.slice(20).map((s) => fleg.indexOf(s)).sort((a, b) => a - b)), 'each group in library order');
  eq([deepScanQueue(after).length, deepScanQueue(after, { assigned: true }).length], [0, 130], 'after: nothing by default; the 130 assigned when asked');
  eq(deepScanQueue([{ closestSolfeggio: 528 }, { harmonicFreq: 400 }, { harmonicFreq: 528, closestSolfeggio: 528 }]).length, 2, 'the default: a crystal without a harmonicFreq (v15.7 scanned it), a harmonicFreq without a crystal');
  // The words.
  const confirm = assignConfirmText(p1);
  eq(confirm.title, 'Assign crystals?', 'the dialog’s title');
  ok(confirm.body.startsWith('Tracks Deep Scan placed keep their crystal. ') && confirm.body.endsWith('Keys and visual sync are kept.'), 'the dialog’s first and last sentences');
  ok(confirm.body.includes(`${p1.restored} get back the crystal Deep Scan gave them, which an older Auto-Distribute had replaced.`) && confirm.body.includes('20 tracks without one get a crystal.') && confirm.body.includes(`${p1.moved} crystals an older Auto-Distribute assigned move once; from then on, Assign keeps them where they are.`), 'the dialog’s counts');
  const done = assignDoneText(p1);
  ok(done.startsWith(`Crystals assigned: 20 tracks got a crystal, ${p1.moved} placeholder crystals changed, ${p1.restored} tracks got Deep Scan's crystal back. Deep Scan's crystals: ${p1.kept} kept, ${p1.restored} put back. Every crystal has a track, so walks have no gaps.`), 'the notice');
  // Fix 3: the put-backs counted are the real differences (the old Auto-Distribute re-stored some scans on their own crystal).
  eq(fleg.filter((s) => scanCrystalChanged(s)).length, p1.restored, 'scanCrystalChanged counts exactly the crystals Assign puts back');
  const reStored = fleg.filter((s) => crystalOrigin(s) === 'scan-replaced' && !scanCrystalChanged(s));
  eq(reStored.length, 90 - p1.restored, 'FLEG: the old Auto-Distribute re-stored the others on their own crystal');
  ok(reStored.every((s) => p1.patches.get(s.id)?.closestSolfeggio === s.closestSolfeggio && p1.patches.get(s.id)?.crystalSource === 'scan'), 'those keep their crystal (only the record is rewritten)');
  ok(done.endsWith('Assigned tracks stay unscanned: Deep Scan can still analyse them.'), 'the notice’s last sentence');

  // 3b. Decision 5: a crystal Assign placed before is an anchor.
  const crystalsOf = (l: readonly Song[]) => new Map(l.map((s) => [s.id, s.closestSolfeggio]));
  const movedBetween = (a: readonly Song[], b: readonly Song[]) => { const m = crystalsOf(b); return a.filter((s) => m.has(s.id) && m.get(s.id) !== s.closestSolfeggio).length; };
  {
    // +1 import: only the new track is placed; nothing else moves. On FLEG and on a ~920-track library (the review's).
    for (const [label, base0] of [['FLEG', fleg], ['920 tracks', Array.from({ length: 4 }, (_, k) => fleg.map((s) => ({ ...s, id: `${s.id}-k${k}` }))).flat()]] as const) {
      const base = apply(base0, planAssign(base0));
      eq(planAssign(base).patches.size, 0, `${label}: after the first Assign, a second press writes nothing`);
      const imported = [...base, { id: '1771000000000-imp01', name: 'later-import', duration: 200 } as Song];
      const pi = planAssign(imported);
      eq([pi.patches.size, pi.given, pi.moved, pi.movedFailed, pi.restored, [...pi.patches.keys()]], [1, 1, 0, 0, 0, ['1771000000000-imp01']], `${label}: +1 import, then Assign: only the new track is placed`);
      eq(movedBetween(base, apply(imported, pi)), 0, `${label}: +1 import moves 0 existing tracks`);
      ok(!assignNeedsConfirm(pi), `${label}: an import's Assign asks nothing (only given)`);
      // A delete: nothing moves, and a crystal the delete empties stays empty (no unplaced track to fill it).
      for (const victim of [5, 7, 120]) {
        const deleted = base.filter((_, i) => i !== victim);
        const pd = planAssign(deleted);
        eq(pd.patches.size, 0, `${label}: a delete (#${victim}), then Assign: 0 writes`);
      }
      const at = base[0].closestSolfeggio;
      const emptied = base.filter((s) => s.closestSolfeggio !== at);
      const pe = planAssign(emptied);
      eq([pe.patches.size, pe.emptyAfter], [0, 1], `${label}: every track of one crystal deleted: nothing moves in to fill it`);
      ok(assignNothingText(pe).startsWith('Every track already has its crystal'), `${label}: the toast says so`);
      // Then an import: the new track fills that crystal first, and nothing else moves.
      const refill = [...emptied, { id: '1771000000000-imp02', name: 'later-import-2', duration: 200 } as Song];
      const pr = planAssign(refill);
      eq([pr.patches.size, pr.patches.get('1771000000000-imp02')?.closestSolfeggio, pr.emptyAfter], [1, at, 0], `${label}: the next import fills the empty crystal`);
    }
    // Anchors stay even where a fresh placement would differ: 30 recorded at 174, then one import.
    const anchored = Array.from({ length: 30 }, (_, i) => ({ id: `1771100000000-a${i}`, name: `tone-${i}`, duration: 200, closestSolfeggio: 174, harmonicFreq: 174, harmonicDeviation: 3, crystalSource: 'assigned' as const }));
    const pa = planAssign([...anchored, { id: '1771100000000-new', name: 'tone-new', duration: 200 }]);
    eq([pa.anchored, pa.moved, pa.patches.size, pa.patches.get('1771100000000-new')?.closestSolfeggio], [30, 0, 1, 285], 'anchors kept like scans; the new track fills the lowest empty crystal');
    // An anchor whose playback-ready marker went missing gets it back, without moving.
    const pm = planAssign([{ ...anchored[0], harmonicFreq: undefined }]);
    eq([...pm.patches.entries()], [[anchored[0].id, { harmonicFreq: 174 }]], 'an anchor without its harmonicFreq: only the marker written back');
    eq(planAssign(apply([{ ...anchored[0], harmonicFreq: undefined }] as Song[], pm)).patches.size, 0, 'and then nothing');
    // A failed scan recorded by v15.8's Deep Scan is placed, and the words name it as such (never "Auto-Distribute assigned").
    const failed = { id: '1771200000000-f', name: 'drum-room', duration: 200, harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999, crystalSource: 'scan' as const };
    const pfail = planAssign([failed, ...anchored.slice(0, 3).map((s, i) => ({ ...s, closestSolfeggio: ALL_CRYSTALS[i], harmonicFreq: ALL_CRYSTALS[i] }))]);
    const fPatch = pfail.patches.get(failed.id)!;
    ok(fPatch.crystalSource === 'assigned' && fPatch.harmonicFreq === fPatch.closestSolfeggio, 'a failed scan is placed (assigned, playback-ready)');
    if (fPatch.closestSolfeggio !== 528) {
      eq(pfail.movedFailed, 1, 'its move is counted as a failed scan’s');
      ok(assignConfirmText(pfail).body.includes('1 placeholder crystal of a failed Deep Scan moves.') && !assignConfirmText(pfail).body.includes('Auto-Distribute assigned'), 'the dialog names a failed scan’s placeholder');
    } else eq(pfail.unchanged, 1, 'its crystal kept: counted unchanged');
  }
  // The words never give "every crystal has a track" as a reason, and say it only when it is true.
  {
    const plans = [p1, again, planAssign(fx.F3), planAssign(fx.F160u), planAssign((fx.F160 as Song[]).map(({ collection, ...s }: any) => s)), planAssign(fx.F26)];
    for (const p of plans) {
      const c = assignConfirmText(p).body, d = assignDoneText(p);
      ok(!/so every crystal/.test(c) && !/so every crystal/.test(d), 'no "so every crystal has a track" as a reason');
      ok(c.includes('every crystal has a track') === (p.emptyBefore > 0 && p.emptyAfter === 0), 'the dialog says every crystal will have a track exactly when Assign fills the last gaps');
      ok(d.includes('Every crystal has a track') === (p.emptyAfter === 0), 'the notice says every crystal has a track exactly when it is true');
    }
  }

  // 4. Fill first: FLEG's scans leave gaps; given exactly as many unscanned tracks, each fills a different gap.
  const scans = after.filter((s) => crystalOrigin(s) === 'scan');
  const covered = new Set(scans.map((s) => s.closestSolfeggio));
  const gaps = ALL_CRYSTALS.filter((f) => !covered.has(f)).length;
  ok(gaps === 16, 'FLEG’s scans leave 16 crystals empty');
  const few = [...scans, ...fleg.filter((s) => truth[s.id] === 'none').slice(0, gaps)];
  const pf = planAssign(few);
  const placed = [...pf.patches.values()].filter((x) => x.crystalSource === 'assigned').map((x) => x.closestSolfeggio);
  ok(placed.length === gaps && placed.every((f) => !covered.has(f)) && new Set(placed).size === placed.length, 'each fills a different gap');
  eq(pf.emptyAfter, 0, 'no gap left');

  // 5. Fewer than 27 tracks, an empty library, duplicates, F160.
  const p3 = planAssign(fx.F3);
  eq([p3.patches.size, p3.given, [...p3.patches.values()].map((x) => x.closestSolfeggio)], [3, 3, [174, 285, 396]], 'three tracks: three crystals, the lowest empty ones first (no 27 minimum)');
  ok(assignDoneText(p3).includes('24 crystals still have no track.') && !assignNeedsConfirm(p3), 'three tracks: the notice says how many crystals have none; no question (only given)');
  const p0 = planAssign([]);
  eq([p0.patches.size, assignNothingText(p0)], [0, 'Your library is empty.'], 'an empty library: nothing');
  ok(ser(planAssign([...fleg, fleg[5], fleg[7], fleg[5]])) === ser(p1), 'duplicates: the same plan (patchById applies it to every copy)');
  const dupLib = [...fleg, fleg[5]];
  const dupAfter = apply(dupLib, p1);
  ok(dupAfter[5] === dupAfter[230] || JSON.stringify(dupAfter[5]) === JSON.stringify(dupAfter[230]), 'both copies patched alike');
  const f160 = (fx.F160 as Song[]).map(({ collection, ...s }: any) => s as Song);
  const pF = planAssign(f160);
  ok(ser(planAssign([...f160].reverse())) === ser(pF) && planAssign(apply(f160, pF)).patches.size === 0, 'F160: order-free and idempotent');
  ok([...pF.patches.entries()].every(([id, p]) => { const s = f160.find((x) => x.id === id)!; return crystalOrigin(s) !== 'scan' && Object.keys(p).every((k) => CRYSTAL_FIELDS.includes(k)); }), 'F160: no scan written, only crystal fields');
  ok(standInFreq(f160[0]) === standInFreq({ ...f160[0] }) && standInFreq(f160[0]) !== standInFreq({ ...f160[0], id: f160[0].id + 'x' }), 'the stand-in depends on the id');

  // 6. Scale: 5,000 tracks (FLEG repeated with new ids), well under a second.
  const big: Song[] = [];
  for (let k = 0; big.length < 5000; k++) for (const s of fleg) { if (big.length >= 5000) break; big.push({ ...s, id: `${s.id}-x${k}` }); }
  const t0 = performance.now();
  const pb = planAssign(big);
  const ms = performance.now() - t0;
  ok(pb.total === 5000 && pb.emptyAfter === 0 && planAssign(apply(big, pb)).patches.size === 0, '5,000 tracks: placed, idempotent');
  ok(ms < 2000, `5,000 tracks in ${ms.toFixed(0)} ms`);
} finally {
  Math.random = realRandom;
  console.log = realLog; console.warn = realWarn;
}
console.log(`distribution.check: ${checks} checks passed`);
