// utils/mix/scorecap.check.ts (v16.7.3, fix round 1, F7: Assign's stored fit score can no longer look like the spread's
// mark). `node utils/mix/scorecap.check.ts` (npm run check:mix, after source.check).
//
// The user's decision (2026-11-04): "Fix it in v16.7.3". spreadFromScan read crystalSource 'assigned' with a
// harmonicDeviation of SPREAD_MARK (1000) or more as "a scan a spread placed", and Assign stores its fit score there,
// which reaches 2994: such a track counted as scanned, both Deep Scan queues skipped it, and the next press made it
// 'scan', a Deep Scan crystal no scan produced (v16.7.1 does the same: the frozen copy shows it). Both halves:
//   reading  spreadFromScan also needs the mark's own relation (dev = SPREAD_MARK + |reading - crystal|), so a record
//            v16.7.1 stored that way reads as Assign's placement again;
//   writing  the STORED score is capped at ASSIGN_SCORE_CAP (998: under Deep Scan's 999 and the mark), in both of
//            Assign's writers (its own rule and the spread); the fill still ranks by the full score, so no placement
//            moves, and a second press compares the capped value, so it writes nothing.
// Checked: the review's input and a v16.7.1-shaped record; small libraries where scores pass the cap (with and without
// Source tracks, and as v16.7.1's spread left them): plans identical to v16.7.1's but the stored score, a second press
// writing nothing, the Source oracle holding; the stored score never at the mark or 999; the words unchanged.
// Synthetic tones only ("tone-high-N" sends the stand-in high, as the review's input did); no Math.random.
import { strict as assert } from 'node:assert';
import {
  ASSIGN_SCORE_CAP, SPREAD_MARK, crystalOrigin, deepScanQueue, needsDeepScan, planAssign, readByDeepScan, scanCrystalOf, sourceTrack, spreadFromScan,
} from './distribution.ts';
import type { AssignPlan, AssignSong } from './distribution.ts';
import { SOURCE_FREQ } from '../crystalData.ts';
import { patchById } from '../library/listOps.ts';
import { scanValue } from '../library/filterModel.ts';
import { libraryHealth } from '../../components/shell/library/libraryModel.ts';
import { restoreV1671, spreadV1671, wordsV1671 } from '../../scripts/mix-golden/spread-v1671.ts';
import { assignConfirmText, assignDoneText, assignNothingText } from './distribution.ts';

let checks = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepStrictEqual(a, b, msg); checks++; };
const realLog = console.log, realRandom = Math.random;
console.log = () => {};
Math.random = () => { throw new Error('Math.random used'); };

type T = AssignSong & Record<string, unknown>;
const CAP = ASSIGN_SCORE_CAP;
const apply = (l: readonly T[], p: AssignPlan) => patchById(l as never[], p.patches as never) as unknown as T[];
const ser = (p: AssignPlan) => JSON.stringify([...p.patches.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const counts = (p: AssignPlan) => {
  const { patches, source, off, again, back, readings, open, sourceGiven, ...rest } = p;
  void patches; void source; void off; void again; void back; void readings; void open; void sourceGiven;
  return rest;
};
const fields = (s: T) => [s.closestSolfeggio ?? null, s.harmonicFreq ?? null, s.harmonicDeviation ?? null, s.crystalSource ?? null];
/** A record shaped like one of Assign's own placements (no reading: harmonicFreq is its crystal). */
const assignPlacement = (s: T) => s.crystalSource === 'assigned' && s.harmonicFreq === s.closestSolfeggio && Number.isFinite(s.harmonicDeviation);
/** What v16.7.1 could store: Assign's own score at or above the spread's mark, without the mark's relation. */
const pseudoSpread = (s: T) => s.crystalSource === 'assigned' && Number.isFinite(s.harmonicDeviation) && (s.harmonicDeviation as number) >= SPREAD_MARK && !spreadFromScan(s);
/** v16.7.1's after-state as v16.7.3 stores it: Assign's own scores capped. */
const capped = (l: readonly T[]) => l.map((s) => (assignPlacement(s) && (s.harmonicDeviation as number) > CAP ? ({ ...s, harmonicDeviation: CAP } as T) : s));
const R2178 = [2180.5, 2179.25, 2182, 2175.5, 2178, 1089, 2177.25, 2181];
const scan = (id: string, name: string, hf: number): T => { const c = scanCrystalOf(hf); return { id, name, duration: 200, harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: Math.abs(hf - c), crystalSource: 'scan', isAetheriaCandidate: false } as T; };

// ---- 1. The cap ----------------------------------------------------------------------------------------------------
ok((CAP as number) < 999 && (CAP as number) < SPREAD_MARK, 'the cap is under Deep Scan’s "couldn’t read" (999) and the spread’s mark (1000)');
eq(crystalOrigin({ closestSolfeggio: 174, harmonicFreq: 174, harmonicDeviation: CAP, crystalSource: 'scan' }), 'scan', 'a capped value never reads as a failed scan');

// ---- 2. The review's input: one new track whose stand-in matches 6336, placed on 174 (a fit score of 2286) -------------
const notScanned = (l: T[], what: string) => {
  ok(!readByDeepScan(l[0]) && !spreadFromScan(l[0]) && needsDeepScan(l[0]), `${what}: not read by Deep Scan`);
  eq(deepScanQueue(l, { assigned: true }).map((s) => s.id), [l[0].id], `${what}: in Deep Scan's explicit queue ("Also scan the assigned tracks")`);
  eq(deepScanQueue(l).length, 0, `${what}: not in its default queue (it has a crystal)`);
  eq([libraryHealth(l as never).scanned, libraryHealth(l as never).assignedToScan], [0, 1], `${what}: the health card counts it unscanned`);
  eq(scanValue(l[0] as never), 1, `${what}: the filters' scan facet says not scanned`);
};
const h9 = [{ id: '1772000000000-h9', name: 'tone-high-9', duration: 100 } as T];
const old = apply(h9, spreadV1671(h9));
{
  eq(fields(old[0]), [174, 174, 2286, 'assigned'], "the input: v16.7.1 stored {174, hf 174, dev 2286, 'assigned'}");
  eq(spreadV1671(old).patches.get(h9[0].id), { harmonicDeviation: 0, crystalSource: 'scan' }, "and v16.7.1's second press made it a Deep Scan crystal no scan produced");
  const p1 = planAssign(h9, 'spread');
  const a1 = apply(h9, p1);
  eq(fields(a1[0]), [174, 174, CAP, 'assigned'], 'v16.7.3: the same crystal, the score stored capped');
  eq(counts(p1), counts(spreadV1671(h9)), 'and the same counts');
  notScanned(a1, 'after press 1');
  eq(planAssign(a1, 'spread').patches.size, 0, 'press 2 writes nothing');
  eq(planAssign(h9).patches.get(h9[0].id)?.harmonicDeviation, CAP, "Assign's own rule ('keep') stores the capped score too");
}
// ---- 3. A record v16.7.1 already stored this way: Assign's placement again ---------------------------------------
{
  notScanned(old, "v16.7.1's stored record");
  const a2 = apply(old, planAssign(old, 'spread'));
  eq(fields(a2[0]), [174, 174, CAP, 'assigned'], "a press re-places it as Assign's (the score capped), never 'scan'");
  eq(planAssign(a2, 'spread').patches.size, 0, 'and the next press writes nothing');
  ok(planAssign(old).patches.get(old[0].id)?.crystalSource !== 'scan', "Assign's own rule never makes it 'scan' either");
  ok(!planAssign(old, 'restore').patches.has(old[0].id) && restoreV1671(old).patches.get(old[0].id)?.crystalSource === 'scan', "the way back leaves it alone (v16.7.1's made it 'scan')");
  eq(libraryHealth([...old, { ...old[0], id: '1772000000000-h9b', harmonicDeviation: SPREAD_MARK + 0 } as T] as never).scanned, 1, 'a real spread mark (the relation holds: a reading equal to its crystal) still reads as scanned');
}

// ---- 4. Libraries whose scores pass the cap -------------------------------------------------------------------------
/** Small libraries of "tone-high-N" tracks (about one in five puts one on a low crystal with a fit score of 1000 or
 *  more); every other one with a track Deep Scan placed on 2178 Hz. */
function highs(seed: number): T[] {
  const lib = Array.from({ length: 1 + (seed % 5) }, (_, i) => ({ id: `1772000000000-h${seed}-${i}`, name: `tone-high-${seed}-${i}`, duration: 100 }) as T);
  return seed % 2 ? [...lib, scan(`1772000000000-h${seed}-s`, `tone-${String(seed).padStart(2, '0')}`, R2178[seed % R2178.length])] : lib;
}
/** Libraries where two fit scores past the cap compete for one crystal (found by search: the fill must still choose by
 *  the full score, so capping the choice scores too would move a track here; the stored score is capped all the same). */
const ties = [1708, 1951, 2096, 2263].map((s): [string, T[]] => [`tie ${s}`, Array.from({ length: 2 + (s % 4) }, (_, i) => ({ id: `1772000000000-t${s}-${i}`, name: `tone-high-${s}-${i}`, duration: [100, 200, 400][(s + i) % 3] }) as T)]);
const firsts: Array<[string, T[]]> = [...Array.from({ length: 200 }, (_, k): [string, T[]] => [`high ${k}`, highs(k)]), ...ties];
const libs: Array<[string, T[]]> = [...firsts, ...firsts.map(([k, l]): [string, T[]] => [`${k}, v16.7.1-spread`, apply(l, spreadV1671(l))])];
let over = 0, shaped = 0, withSource = 0;
for (const [k, lib] of libs) {
  const p = planAssign(lib, 'spread');
  const after = apply(lib, p);
  // The stored score: capped wherever Assign writes one; no record keeps a v16.7.1-shaped score after a press.
  for (const s of after) if (assignPlacement(s) && !spreadFromScan(s)) ok((s.harmonicDeviation as number) <= CAP, `${k}: ${s.id}: the stored score is capped`);
  ok(!after.some(pseudoSpread), `${k}: no v16.7.1-shaped score left`);
  for (const [, patch] of planAssign(lib).patches) if (patch.crystalSource === 'assigned') ok((patch.harmonicDeviation as number) <= CAP, `${k}: 'keep' stores capped too`);
  eq(planAssign(after, 'spread').patches.size, 0, `${k}: a second press writes nothing`);
  for (const s of after) if (s.crystalSource === 'assigned' && (s.harmonicDeviation as number) >= SPREAD_MARK) ok(spreadFromScan(s), `${k}: ${s.id}: a spread track keeps its mark`);
  const pseudo = lib.filter(pseudoSpread);
  const src = lib.filter((s) => sourceTrack(s));
  if (pseudo.length) {
    shaped++;
    for (const s of pseudo) {
      ok(!readByDeepScan(s) && needsDeepScan(s) && scanValue(s as never) === 1, `${k}: ${s.id}: a v16.7.1-shaped score is not a scan`);
      const a = after.find((x) => x.id === s.id)!;
      ok(a.crystalSource === 'assigned' && a.harmonicFreq === a.closestSolfeggio && (a.harmonicDeviation as number) <= CAP, `${k}: ${s.id}: re-placed as Assign's`);
      ok(!planAssign(lib, 'restore').patches.has(s.id), `${k}: ${s.id}: the way back leaves it alone`);
    }
  }
  // v16.7.1's plan, the stored score aside: every other track as v16.7.1 places it, with each Source track as an
  // unreadable scan on 2178 (source.check's oracle) and each v16.7.1-shaped record with a score under the mark.
  const srcIds = new Set(src.map((s) => s.id));
  const stand = lib.map((s) => (srcIds.has(s.id) ? ({ id: s.id, name: s.name, duration: s.duration, harmonicFreq: 0, closestSolfeggio: SOURCE_FREQ, harmonicDeviation: 3, crystalSource: 'scan' } as T) : pseudoSpread(s) ? ({ ...s, harmonicDeviation: CAP } as T) : s));
  const q = spreadV1671(stand);
  const qAfter = new Map(capped(apply(stand, q)).map((s) => [s.id, s]));
  for (const s of after) {
    if (srcIds.has(s.id)) ok(s.closestSolfeggio === SOURCE_FREQ && s.crystalSource === 'scan', `${k}: ${s.id}: the Source track on 2178`);
    else eq(fields(s), fields(qAfter.get(s.id)!), `${k}: ${s.id}: as v16.7.1 places it, the score capped`);
  }
  eq([p.perCrystal, p.given, p.moved, p.unchanged, p.spread], [q.perCrystal, q.given, q.moved, q.unchanged, q.spread], `${k}: v16.7.1's counts`);
  const hit = apply(stand, q).some((s) => assignPlacement(s) && (s.harmonicDeviation as number) > CAP);
  if (hit) over++;
  if (!hit && !pseudo.length && !src.length) eq(ser(p), ser(spreadV1671(lib)), `${k}: no score at the cap: v16.7.1's patches exactly`);
  // The words: as v16.7.1's (no Source track here moves again or back: the scores change no count).
  if (!src.length && !pseudo.length) {
    const w = wordsV1671(spreadV1671(lib));
    // (Fix round 2, R3: with no Deep Scan reading in the library, the notice no longer says the readings are kept.)
    const done0 = (p.readings ?? 0) > 0 ? w.done : w.done.replace(" Deep Scan's readings are kept.", '');
    eq([assignConfirmText(p).body, assignDoneText(p), assignNothingText(p)], [w.confirm, done0, w.nothing], `${k}: v16.7.1's words`);
  }
  if (src.length) withSource++;
}
ok(over >= 20 && shaped >= 6 && withSource >= 100, `exercised: ${over} libraries with a score past the cap, ${shaped} with v16.7.1-shaped records, ${withSource} with Source tracks`);

Math.random = realRandom;
console.log = realLog;
console.log(`scorecap.check: ${checks} checks passed (${libs.length} libraries: ${over} with a score past the cap, ${shaped} with v16.7.1-shaped records, ${withSource} with Source tracks)`);
