// utils/mix/source.check.ts (v16.7.3: Source tracks keep 2178 Hz when Auto-Distribute / Assign crystals spreads).
// `node utils/mix/source.check.ts` (npm run check:mix, after spread.check).
//
// The user's decisions (2026-11-04): when a spread runs (planAssign(lib, 'spread'), every press, both layouts), every
// track Deep Scan placed on 2178 Hz (the SOURCE crystal; sourceTrack: its reading's crystal is 2178) keeps 2178; those
// tracks count toward 2178's even share, so other tracks go there only while it is short; one v16.7.1's spread moved away
// goes back on the next press, and the rest re-spread around it. Everything else spreads as v16.7.1 did: a library with
// no Source track gets v16.7.1's plan exactly, and with Source tracks every other track gets
// what v16.7.1 gives with the Source tracks as unreadable scans on 2178 (the oracle, section 3). Against the frozen copy
// in scripts/mix-golden/spread-v1671.ts (its sha256 pinned here; its sections compared with 666132c's own lines when git
// can read them).
// Fix round 1: F1 the health card's spreadCover (the plan's own spreadRole), F2 the moved scans split into off / again /
// back, F3 the words. (F7, Assign's stored score capped under the spread's mark: scorecap.check; none of these libraries
// holds a score at the cap or a v16.7.1-shaped record, which that check covers.)
// v16.8.1 (decisions D2, D3, D3b, 2026-11-05): the Source tracks no longer count toward 2178's share ("full share on
// top": the other tracks spread evenly over all 27, 2178 included), a library too small to cover every crystal fills
// the empty ones first, and the spread's ties go by the file, not the id. So section 3's oracle is now the independent
// restatement (scripts/mix-golden/spread-oracle.ts; v16.7.1 with the Source tracks as unreadable scans stays the
// oracle only where D3b keeps v16.7.3's plan, the files set aside); section 4 compares v16.7.1 with the files set
// aside (the key is then the id, as v16.7.1's), the oracle with them, and v16.7.1 keyed by the file where no stand-in is
// read; section 6 pins the new share. The device question itself is devices.check's.
// Synthetic tones ("tone-NN") and fixed ids only; no Math.random anywhere.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_CRYSTALS, SPREAD_MARK, SPREAD_ORDER, assignConfirmText, assignDoneText, assignNeedsConfirm, assignNothingText, crystalOrigin,
  fileKey, planAssign, readByDeepScan, scanCrystalOf, sourceTrack, spreadAway, spreadFromScan, spreadRole,
} from './distribution.ts';
import type { AssignPlan, AssignSong } from './distribution.ts';
import { SOURCE_FREQ } from '../crystalData.ts';
import { patchById } from '../library/listOps.ts';
import { libraryHealth } from '../../components/shell/library/libraryModel.ts';
// @ts-ignore: the harness's fixture is plain .mjs (no types)
import { buildFixtures, mulberry32 } from '../../scripts/mix-golden/fixture.mjs';
import { restoreV1671, spreadV1671, wordsV1671 } from '../../scripts/mix-golden/spread-v1671.ts';
import { spreadOracle } from '../../scripts/mix-golden/spread-oracle.ts';

let checks = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepStrictEqual(a, b, msg); checks++; };
const realLog = console.log, realRandom = Math.random;
console.log = () => {};
Math.random = () => { throw new Error('Math.random used'); };

type T = AssignSong & Record<string, unknown>;
const AT = ALL_CRYSTALS.indexOf(SOURCE_FREQ);
const apply = (l: readonly T[], p: AssignPlan) => patchById(l as never[], p.patches as never) as unknown as T[];
const ser = (p: AssignPlan) => JSON.stringify([...p.patches.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
/** Every count of a plan, v16.7.3's own (source, off, again, back) aside. */
const counts = (p: AssignPlan) => {
  // (v16.8.2: and its key counts, which v16.7.1 has none of; these libraries have no key data.)
  const { patches, source, off, again, back, readings, open, sourceGiven, keyed, keyFits, noKey, awaitingKey, hadCrystal, hadCrystalMoves, ...rest } = p;
  void patches; void source; void off; void again; void back; void readings; void open; void sourceGiven; void keyed; void keyFits; void noKey; void awaitingKey; void hadCrystal; void hadCrystalMoves;
  return rest;
};
const unique = (l: readonly T[]) => { const seen = new Set<string>(); return l.filter((s) => s && !seen.has(s.id) && !!seen.add(s.id)); };
const unreadable = (s: T) => ['scan', 'scan-replaced'].includes(crystalOrigin(s)) && !(Number.isFinite(s.harmonicFreq) && (s.harmonicFreq as number) > 0);
const on2178 = (l: readonly T[]) => l.filter((s) => s.closestSolfeggio === SOURCE_FREQ).length;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fields = (s: T) => [s.closestSolfeggio ?? null, s.harmonicFreq ?? null, s.harmonicDeviation ?? null, s.crystalSource ?? null];
/** The measured tracks a spread scores from their reading (spreadRole 'open' and read by Deep Scan, with a reading). */
const measuredOpen = (s: T) => spreadRole(s).role === 'open' && readByDeepScan(s) && Number.isFinite(s.harmonicFreq) && (s.harmonicFreq as number) > 0;

// ---- 0. The frozen v16.7.1 copy is 666132c's own code -------------------------------------------------------------
{
  const file = fileURLToPath(new URL('../../scripts/mix-golden/spread-v1671.ts', import.meta.url));
  const frozen = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  // F4.2: pinned, with or without git (LF-normalised: the working tree may hold CRLF).
  eq(createHash('sha256').update(frozen).digest('hex'), '22012499f97dabfecb4251a1ca5698d238584e813cb19bc1aa76f29cae6ee8c0', 'the frozen copy: its pinned sha256');
  const sections = [...frozen.matchAll(/^\/\/ ---- (?:666132c:utils\/mix\/distribution\.ts )?lines (\d+)-(\d+) ----\n([\s\S]*?)(?=\n\/\/ ---- |\n\/\*\* v16\.7\.1's planAssign)/gm)];
  eq(sections.map((m) => `${m[1]}-${m[2]}`), ['120-124', '158-176', '304-314', '324-329', '336-340', '445-556', '559-559', '563-568', '587-594', '640-654', '656-670'], 'the frozen copy: its eleven marked sections');
  let git: string | null = null;
  try {
    git = execFileSync('git', ['show', '666132c:utils/mix/distribution.ts'], { cwd: dirname(file), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { git = null; }
  if (git) {
    const lines = git.replace(/\r\n/g, '\n').split('\n');
    for (const m of sections) eq(m[3].replace(/\n+$/, ''), lines.slice(Number(m[1]) - 1, Number(m[2])).join('\n'), `frozen lines ${m[1]}-${m[2]}: 666132c's, byte for byte`);
  } else {
    realLog('source.check: WARNING: git cannot read 666132c here, so the frozen sections are NOT compared with git (the sha256 pin above still holds the file as reviewed)');
  }
  // v16.8.1: the oracle's score (the only rule it copies) is the frozen copy's, byte for byte; it imports nothing from
  // distribution.ts but the stand-in (D5).
  const oracle = readFileSync(fileURLToPath(new URL('../../scripts/mix-golden/spread-oracle.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  const copied = oracle.match(/\/\/ ---- 666132c:utils\/mix\/distribution\.ts lines 158-176 \(the old score, as the frozen copy holds it\) ----\n([\s\S]*?)\n\/\/ ---- end of the copied lines ----/);
  eq(copied?.[1], sections.find((m) => m[1] === '158')?.[3].replace(/\n+$/, ''), "the oracle's score: the frozen copy's lines 158-176");
  eq([...oracle.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[0]), ["import { GUT_CRYSTALS, HEART_CRYSTALS, HEAD_CRYSTALS, getHarmonicSolfeggio } from '../../utils/crystalData.ts';", "import { standInFreq } from '../../utils/mix/distribution.ts';", "import { musicFit, toneOf } from '../../utils/soundV2/aetheria_sound_v2.ts';"], "the oracle's imports: crystalData, distribution.ts's stand-in alone, and (v16.8.2) the vendored v2's musicFit and toneOf");
}

// ---- the tracks ---------------------------------------------------------------------------------------------------
let n = 0;
const base = (tag: string) => ({ id: `1772000000000-${tag}`, name: `tone-${String(++n).padStart(2, '0')}`, duration: 200 });
/** Deep Scan's own record: its crystal for the reading, the reading's distance, recorded the scan's. */
const scan = (tag: string, hf: number): T => { const c = scanCrystalOf(hf); return { ...base(tag), harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: Math.abs(hf - c), crystalSource: 'scan', isAetheriaCandidate: false } as T; };
/** A legacy scan an older Auto-Distribute moved to `c` (no crystalSource; the deviation relation broken). */
const replaced = (tag: string, hf: number, c: number): T => ({ ...base(tag), harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: 7.77, fractalAnalysis: { dominantFrequency: hf } }) as T;
/** What v16.7.1's spread wrote for a scan it moved to `c`: Assign's, the reading kept, the mark. */
const spread1671 = (tag: string, hf: number, c: number): T => ({ ...base(tag), harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: SPREAD_MARK + Math.abs(hf - c), crystalSource: 'assigned' }) as T;
/** Assign's own placement (no reading: harmonicFreq is the crystal, a fit score). */
const assignedOn = (tag: string, c: number): T => ({ ...base(tag), harmonicFreq: c, closestSolfeggio: c, harmonicDeviation: 3, crystalSource: 'assigned' }) as T;
/** An older Auto-Distribute's placeholder (no recorded origin). */
const placeholderOn = (tag: string, c: number): T => ({ ...base(tag), harmonicFreq: c, closestSolfeggio: c, harmonicDeviation: 12 }) as T;
/** A scan with no usable reading (0 Hz): the spread leaves it where it is (counted there when it is one of the 27). */
const unreadableOn = (tag: string, c: number): T => ({ ...base(tag), harmonicFreq: 0, closestSolfeggio: c, harmonicDeviation: 3, crystalSource: 'scan' }) as T;
const failed = (tag: string): T => ({ ...base(tag), harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999, crystalSource: 'scan' }) as T;
const fresh = (tag: string, k = 0): T => ({ ...base(tag), duration: 60 + ((k * 37) % 400) }) as T;
/** A scan bunched on 174 / 396 / 528 (as assign.spec's BUNCHED). */
const bunched = (tag: string, i: number) => scan(tag, [174, 396, 528][i % 3] + 1.5 + (i % 4) * 0.25);
/** Readings Deep Scan's crystal for which is 2178 (direct, and an octave below). */
const R2178 = [2180.5, 2179.25, 2182, 2175.5, 2178, 1089, 2177.25, 2181];
for (const f of R2178) eq(scanCrystalOf(f), SOURCE_FREQ, `${f} Hz reads as 2178`);
const sourceIds = (l: readonly T[]) => l.filter((s) => sourceTrack(s)).map((s) => s.id);
/** v16.8.1: a track without its file (the golden's fixtures carry one): the spread's key is then its id, as v16.7.1's. */
const withoutFile = (s: T): T => { const { file, ...rest } = s; void file; return rest as T; };

// ---- 1. Which tracks are Source tracks, and what a spread does with each (spreadRole) ----------------------------
ok(sourceTrack(scan('a1', 2180.5)), 'a scan on 2178 (read at 2180.5 Hz)');
ok(sourceTrack(scan('a2', 1089)), 'a scan read an octave below: its crystal is 2178');
{
  const r = replaced('a3', 2179.25, 1935);
  ok(crystalOrigin(r) === 'scan-replaced' && sourceTrack(r), "a scan an older Auto-Distribute moved to 1935, its reading 2178's");
  const s = spread1671('a4', 2182, 741);
  ok(spreadFromScan(s) && spreadAway(s) && sourceTrack(s), "a track v16.7.1's spread moved to 741, its reading 2178's");
}
ok(!sourceTrack(assignedOn('a5', SOURCE_FREQ)), 'a crystal Assign placed on 2178 (no reading): not a Source track');
ok(!sourceTrack(placeholderOn('a6', SOURCE_FREQ)), "an older Auto-Distribute's placeholder on 2178: not one");
ok(!sourceTrack(unreadableOn('a7', SOURCE_FREQ)), 'an unreadable scan on 2178: not one (left where it is)');
ok(!sourceTrack(failed('a8')) && !sourceTrack(fresh('a9')), 'a failed scan, a new track: not');
ok(!sourceTrack(scan('a10', 530.5)), 'a scan elsewhere: not');
ok(!sourceTrack(replaced('a11', 530.5, SOURCE_FREQ)), 'a scan moved ONTO 2178 whose reading is elsewhere: not');
ok(!sourceTrack(spread1671('a12', 530.5, SOURCE_FREQ)), 'a spread track on 2178 whose reading is elsewhere: not');
// An Assign placement's harmonicFreq is its crystal: only 2178's own reads as 2178 (6336 reads as 396, never as 2178).
for (const c of ALL_CRYSTALS) eq(scanCrystalOf(c) === SOURCE_FREQ, c === SOURCE_FREQ, `${c} Hz reads as 2178 only if it is 2178`);
eq(spreadRole(scan('b1', 2180.5)), { role: 'source', crystal: SOURCE_FREQ }, 'spreadRole: a Source track is pinned on 2178');
eq(spreadRole(unreadableOn('b2', 639)), { role: 'stays', crystal: 639 }, 'spreadRole: an unreadable scan on one of the 27 stays and counts there');
eq(spreadRole({ ...unreadableOn('b3', 639), closestSolfeggio: 500 } as T), { role: 'left', crystal: null }, 'spreadRole: an unreadable scan off the 27 is left alone');
for (const s of [scan('b4', 530.5), replaced('b5', 530.5, 741), spread1671('b6', 530.5, 852), assignedOn('b7', SOURCE_FREQ), placeholderOn('b8', 174), failed('b9'), fresh('b10')]) eq(spreadRole(s), { role: 'open', crystal: null }, `spreadRole: ${s.id} is open`);

// ---- 2. Each origin keeps 2178 ----------------------------------------------------------------------------------
const MIXED: T[] = [
  ...Array.from({ length: 30 }, (_, i) => bunched(`m${i}`, i)),
  scan('s1', 2180.5), // on 2178
  replaced('s2', 2179.25, 1935), // an older Auto-Distribute moved it
  spread1671('s3', 2182, 741), // v16.7.1's spread moved it
  scan('s4', 1089), // read an octave below, on 2178
  assignedOn('x1', SOURCE_FREQ), placeholderOn('x2', SOURCE_FREQ), // on 2178 without a reading
  unreadableOn('u1', SOURCE_FREQ), unreadableOn('u2', 639),
  fresh('n1', 1), fresh('n2', 2),
];
{
  const p = planAssign(MIXED, 'spread');
  const after = apply(MIXED, p);
  const get = (tag: string) => after.find((s) => s.id === `1772000000000-${tag}`)!;
  const was = (tag: string) => MIXED.find((s) => s.id === `1772000000000-${tag}`)!;
  eq([p.source, p.restored], [4, 2], 'MIXED: 4 Source tracks, 2 of them back on 2178');
  for (const t of ['s1', 's2', 's3', 's4']) {
    const s = get(t);
    eq([s.closestSolfeggio, s.crystalSource, crystalOrigin(s), s.harmonicFreq, s.harmonicDeviation], [SOURCE_FREQ, 'scan', 'scan', was(t).harmonicFreq, Math.abs((was(t).harmonicFreq as number) - SOURCE_FREQ)], `MIXED ${t}: on 2178, the scan's, its reading kept`);
  }
  for (const t of ['x1', 'x2']) ok(get(t).crystalSource === 'assigned' && !sourceTrack(get(t)), `MIXED ${t}: placed like any track (Assign's), not made a Source track`);
  ok(!p.patches.has(was('u1').id) && !p.patches.has(was('u2').id), 'MIXED: the unreadable scans are left where they are');
  // 2178: 4 Source tracks and an unreadable scan. v16.8.1 (D3): only the unreadable scan is its fill; the 34 open tracks
  // give the 25 crystals with no track one each, then 9 more to the spread order's first 9: 2178, the 14th, gets none.
  eq([p.perCrystal[AT], on2178(after), p.emptyAfter], [5, 5, 0], 'MIXED: 2178 holds its own 5 (a fill of 1, as each crystal past the 9th); every crystal has a track');
  eq(planAssign(after, 'spread').patches.size, 0, 'MIXED: a second press writes nothing');
}

// ---- seeded libraries with Source tracks ------------------------------------------------------------------------
function randomSource(seed: number, size: number): T[] {
  const rnd = mulberry32(9000 + seed);
  return Array.from({ length: size }, (_, i) => {
    const tag = `r${seed}-${i}`;
    const r = rnd();
    const hf = R2178[Math.floor(rnd() * R2178.length)];
    const c = ALL_CRYSTALS[Math.floor(rnd() * 27)];
    if (r < 0.08) return scan(tag, hf); // a Source scan
    if (r < 0.12) return replaced(tag, hf, c === SOURCE_FREQ ? 1935 : c); // a Source scan an older Auto-Distribute moved
    if (r < 0.16) return spread1671(tag, hf, c === SOURCE_FREQ ? 741 : c); // one v16.7.1's spread moved
    if (r < 0.19) return assignedOn(tag, rnd() < 0.5 ? SOURCE_FREQ : c);
    if (r < 0.21) return placeholderOn(tag, rnd() < 0.5 ? SOURCE_FREQ : c);
    if (r < 0.23) return unreadableOn(tag, rnd() < 0.5 ? SOURCE_FREQ : c);
    if (r < 0.25) return failed(tag);
    if (r < 0.65) return scan(tag, ALL_CRYSTALS[Math.floor(rnd() * 6)] + 1.25 + rnd()); // bunched on the first GUT crystals
    if (r < 0.7) return replaced(tag, 530.5, c);
    return fresh(tag, i);
  });
}
/** F1: unreadable scans stacked on one crystal, and many Source tracks: where "a crystal holds two" misleads. */
function stacked(seed: number, size: number): T[] {
  const rnd = mulberry32(7000 + seed);
  const pile = ALL_CRYSTALS[seed % 27];
  return Array.from({ length: size }, (_, i) => {
    const tag = `p${seed}-${i}`;
    const r = rnd();
    if (r < 0.3) return unreadableOn(tag, pile);
    if (r < 0.5) return scan(tag, R2178[i % R2178.length]);
    if (r < 0.55) return { ...unreadableOn(tag, pile), closestSolfeggio: 500 } as T; // off the 27: left alone
    if (r < 0.62) return { ...base(tag), harmonicFreq: R2178[i % R2178.length], harmonicDeviation: 2, crystalSource: 'scan' } as T; // R4: a Source scan with no crystal
    return fresh(tag, i);
  });
}
const fx = buildFixtures();
// (v16.8.2: the keyless fixtures only. FKEY and FKEYU carry key data, which this file's v16.7.1 comparisons and its
// oracle calls without the bands can't place; devices.check and golden step 11 check them.)
const fixtures: Array<[string, T[]]> = Object.entries(fx)
  .filter(([, v]) => Array.isArray(v))
  .map(([k, v]): [string, T[]] => [k, (v as unknown[]).filter((s) => s && typeof s === 'object').map(({ collection, ...s }: any) => s as T)])
  .filter(([, l]) => !l.some((s) => Array.isArray((s as { chroma?: unknown }).chroma)));
const sized = [0, 1, 2, 3, 5, 9, 12, 26, 27, 28, 40, 54, 81, 120];
const randoms: Array<[string, T[]]> = Array.from({ length: 84 }, (_, k) => [`random ${k} (${sized[k % sized.length]})`, randomSource(k, sized[k % sized.length])]);
const piles: Array<[string, T[]]> = Array.from({ length: 30 }, (_, k) => [`stacked ${k}`, stacked(k, [5, 12, 27, 30, 54][k % 5])]);
const withSource = randoms.filter(([, l]) => sourceIds(l).length > 0).length;
ok(withSource >= 50, `most seeded libraries hold Source tracks (${withSource} of ${randoms.length})`);
/** Each library as v16.7.1's spread left it: its Source tracks moved off 2178 where v16.7.1 moved them. */
const alreadySpread: Array<[string, T[]]> = [...fixtures, ...randoms, ['MIXED', MIXED] as [string, T[]], ...piles].map(([k, l]): [string, T[]] => [`${k}, v16.7.1-spread`, apply(l, spreadV1671(l))]);
/** F1's inputs: 27 = 2 Source scans + 25 new tracks after one press; 30/6, 54/40, 12/3, 5/2 (tracks / Source). */
const f1Inputs: Array<[string, T[]]> = [[27, 2], [30, 6], [54, 40], [12, 3], [5, 2]].map(([size, k]): [string, T[]] => {
  const lib = [...Array.from({ length: k }, (_, i) => scan(`f1-${size}-s${i}`, R2178[i % R2178.length])), ...Array.from({ length: size - k }, (_, i) => fresh(`f1-${size}-n${i}`, i))];
  return [`F1 ${size}/${k}, after one press`, apply(lib, planAssign(lib, 'spread'))];
});
const all: Array<[string, T[]]> = [...fixtures, ...randoms, ['MIXED', MIXED], ...piles, ...alreadySpread, ...f1Inputs];

// ---- 3. The rule on every library -------------------------------------------------------------------------------
let compared = 0, oracleSource = 0, splitMoves = 0, coverOffers = 0, evenFills = 0, shortSource = 0;
for (const [k, lib] of all) {
  const u = unique(lib);
  const p = planAssign(lib, 'spread');
  const after = apply(lib, p);
  const afterOf = new Map(unique(after).map((s) => [s.id, s]));
  const src = u.filter((s) => sourceTrack(s));
  // Counts: the Source tracks, the ones that go back, and everything adds up to the library.
  eq(p.source, src.length, `${k}: source counts the Source tracks`);
  eq(p.restored, src.filter((s) => s.closestSolfeggio && s.closestSolfeggio !== SOURCE_FREQ).length, `${k}: restored counts the ones away from 2178 (R4: one with no crystal is given one)`);
  // R3: the tracks with a usable Deep Scan reading, Source ones included.
  eq(p.readings, u.filter((s) => readByDeepScan(s) && Number.isFinite(s.harmonicFreq) && (s.harmonicFreq as number) > 0).length, `${k}: readings counts the tracks Deep Scan read`);
  // Fix round 3: the tracks the spread places (W1, W2) and the Source tracks given 2178 with no crystal before (W3).
  eq(p.open, u.filter((s) => spreadRole(s).role === 'open').length, `${k}: open counts the tracks the spread places`);
  eq(p.sourceGiven, src.filter((s) => !s.closestSolfeggio).length, `${k}: sourceGiven counts the Source tracks with no crystal`);
  eq(p.kept + p.restored + p.anchored + p.given + p.moved + p.movedFailed + p.unchanged + (p.spread ?? 0) + u.filter(unreadable).length, u.length, `${k}: the counts add up to the library`);
  // The health card reads the plan's own numbers (F1: without running it).
  const h = libraryHealth(lib as never);
  eq(h.sourceBack, p.restored, `${k}: the health card's sourceBack is the plan's restored`);
  eq(h.spreadCover, 27 - p.emptyAfter, `${k}: spreadCover is the crystals the spread covers`);
  eq(h.spreadCover > 27 - h.emptyCrystals, p.emptyAfter < h.emptyCrystals, `${k}: the card offers the optional Assign exactly when a spread gives more crystals a track`);
  if (h.spreadCover > 27 - h.emptyCrystals) coverOffers++;
  // Every Source track on 2178, the scan's again, its reading kept; nothing else becomes one.
  for (const s of src) {
    const a = afterOf.get(s.id)!;
    ok(a.closestSolfeggio === SOURCE_FREQ && crystalOrigin(a) === 'scan' && a.harmonicFreq === s.harmonicFreq && a.harmonicDeviation === Math.abs((s.harmonicFreq as number) - SOURCE_FREQ), `${k}: ${s.id}: on 2178, the scan's`);
  }
  eq(new Set(sourceIds(unique(after))), new Set(src.map((s) => s.id)), `${k}: the Source tracks after are the ones before (no placement becomes one)`);
  // The scanned tracks that move (the confirmation's "N scanned tracks move off ..."): never a Source track.
  const movedScans = u.filter(measuredOpen).filter((s) => afterOf.get(s.id)!.closestSolfeggio !== scanCrystalOf(s.harmonicFreq as number) && p.patches.has(s.id));
  eq(p.spread, movedScans.length, `${k}: the spread count is the moved scans, no Source track among them`);
  // F2: the moved scans split by how they move, from the libraries themselves.
  const split = { off: 0, again: 0, back: 0 };
  for (const s of u.filter(measuredOpen)) {
    const had = s.closestSolfeggio, now = afterOf.get(s.id)!.closestSolfeggio, own = scanCrystalOf(s.harmonicFreq as number);
    if (!had || now === had) continue;
    if (had === own) split.off++;
    else if (now === own) split.back++;
    else split.again++;
  }
  eq([p.off, p.again, p.back], [split.off, split.again, split.back], `${k}: off / again / back`);
  if (split.again || split.back) splitMoves++;
  // F2: Assign asks first exactly when a crystal a track has changes.
  eq(assignNeedsConfirm(p), u.some((s) => !!s.closestSolfeggio && afterOf.get(s.id)!.closestSolfeggio !== s.closestSolfeggio), `${k}: Assign asks first exactly when a crystal a track has changes`);
  // Unreadable scans untouched.
  for (const s of u.filter(unreadable)) ok(!p.patches.has(s.id), `${k}: ${s.id}: an unreadable scan is left alone`);
  // A second press writes nothing; order-free and deterministic.
  eq(planAssign(after, 'spread').patches.size, 0, `${k}: a second press writes nothing`);
  const rev = planAssign([...lib].reverse(), 'spread');
  const byId = planAssign([...lib].sort((a, b) => (a.id < b.id ? 1 : -1)), 'spread');
  eq([ser(rev), rev], [ser(p), p], `${k}: the library reversed, the same plan`);
  eq([ser(byId), byId], [ser(p), p], `${k}: by id, the same plan`);
  eq([ser(planAssign(lib, 'spread')), planAssign(lib, 'spread')], [ser(p), p], `${k}: twice, the same plan`);
  if (p.restored > 0) ok(assignNeedsConfirm(p), `${k}: Source tracks go back: Assign asks first`);
  // 'restore' (the way back, not used by the app) is exactly v16.7.1's, Source tracks or not.
  const r = planAssign(lib, 'restore'), r0 = restoreV1671(lib);
  eq([ser(r), { ...r, patches: null }], [ser(r0), { ...r0, patches: null }], `${k}: the way back is v16.7.1's`);

  // v16.8.1, the oracle (was F4.1's: v16.7.1 with each Source track as an unreadable scan on 2178, the old share rule):
  // every track's record after, each crystal's count and the empty crystals as the independent restatement of D2, D3
  // and D3b gives them (scripts/mix-golden/spread-oracle.ts, written from the rule, not from distribution.ts).
  const o = spreadOracle(lib as never);
  const why: string[] = [];
  for (const s of u) if (JSON.stringify(fields(afterOf.get(s.id)!)) !== JSON.stringify(o.after.get(s.id))) why.push(s.id);
  eq(why, [], `${k}: the oracle: every track as the rule places it`);
  eq([p.perCrystal, p.emptyAfter, p.open], [o.perCrystal, o.emptyAfter, o.open], `${k}: the oracle: the crystals' counts`);
  // D3: the fill (the Source tracks aside) is even over all 27 when nothing stays and 27 or more are open; D3b keeps the
  // card's spreadCover rule (above) and, while too few are open to give every empty crystal one, v16.7.3's plan exactly:
  // v16.7.1 with the Source tracks as unreadable scans on 2178 (keyed by the id: the files set aside, as v16.7.1 never
  // read them).
  const fill = p.perCrystal.map((c, i) => c - (i === AT ? src.length : 0));
  if ((p.open ?? 0) >= 27 && !u.some((s) => spreadRole(s).role === 'stays')) { ok(Math.max(...fill) - Math.min(...fill) <= 1, `${k}: the fill is even (${fill})`); evenFills++; }
  if (src.length && (p.open ?? 0) < SPREAD_ORDER.filter((f) => !u.some((s) => spreadRole(s).role === 'stays' && s.closestSolfeggio === f)).length) {
    const srcIds = new Set(src.map((s) => s.id));
    const stand = lib.map((s) => (!s ? s : srcIds.has(s.id) ? ({ id: s.id, name: s.name, duration: s.duration, harmonicFreq: 0, closestSolfeggio: SOURCE_FREQ, harmonicDeviation: 3, crystalSource: 'scan' } as T) : withoutFile(s)));
    const q = spreadV1671(stand);
    const qAfter = new Map(unique(apply(stand, q)).map((s) => [s.id, s]));
    const pNoFile = planAssign(lib.map((s) => (s ? withoutFile(s) : s)), 'spread');
    const aNoFile = new Map(unique(apply(lib.map((s) => (s ? withoutFile(s) : s)), pNoFile)).map((s) => [s.id, s]));
    eq(u.filter((s) => !srcIds.has(s.id) && JSON.stringify(fields(aNoFile.get(s.id)!)) !== JSON.stringify(fields(qAfter.get(s.id)!))).map((s) => s.id), [], `${k}: D3b (too few open tracks): v16.7.3's plan`);
    eq(pNoFile.perCrystal, q.perCrystal, `${k}: D3b: v16.7.3's counts`);
    shortSource++;
  }
  if (src.length) oracleSource++;
  compared++;
}
ok(coverOffers > 20 && splitMoves > 20, `F1 / F2 exercised (${coverOffers} offers, ${splitMoves} libraries with again / back)`);
ok(evenFills >= 20 && shortSource >= 20, `D3 / D3b exercised (${evenFills} even fills, ${shortSource} small libraries with Source tracks as v16.7.3)`);

// ---- 4. No Source track: v16.7.1's plan, exactly -----------------------------------------------------------------
const withoutSource = (l: readonly T[]) => l.filter((s) => !sourceTrack(s));
/** A Source track read elsewhere (its spread mark kept true to the new reading). */
const offReading = (s: T): T => {
  if (!sourceTrack(s)) return s;
  const moved = { ...s, harmonicFreq: 530.5 } as T;
  return spreadFromScan(s) ? ({ ...moved, harmonicDeviation: SPREAD_MARK + Math.abs(530.5 - (s.closestSolfeggio as number)) } as T) : moved;
};
const invariantLibs: Array<[string, T[]]> = [
  ...[...fixtures, ...randoms, ['MIXED', MIXED] as [string, T[]], ...piles, ...alreadySpread].map(([k, l]): [string, T[]] => [`${k} without its Source tracks`, withoutSource(l)]),
  // Readings moved off 2178 (the same libraries, the Source readings read elsewhere now).
  ...randoms.map(([k, l]): [string, T[]] => [`${k}, readings off 2178`, l.map(offReading)]),
];
// And spread.check's own seeded libraries (scans bunched on GUT crystals, failed, assigned, new).
for (let seed = 1; seed <= 60; seed++) {
  const rnd = mulberry32(seed);
  const size = [0, 1, 2, 3, 5, 9, 12, 18, 26, 27, 28, 40, 81][seed % 13];
  const bunch = ALL_CRYSTALS.slice(0, 1 + (seed % 6));
  const scanned = [0, 0.4, 0.9, 1][seed % 4];
  invariantLibs.push([`seeded ${seed}`, Array.from({ length: size }, (_, i) => {
    const r = rnd();
    const tag = `q${seed}-${i}`;
    if (r < scanned) return scan(tag, bunch[Math.floor(rnd() * bunch.length)] + 1.25 + rnd());
    if (r < scanned + 0.05) return failed(tag);
    if (r < scanned + 0.15) return assignedOn(tag, ALL_CRYSTALS[Math.floor(rnd() * 27)]);
    return fresh(tag, i);
  })]);
}
/** The words without the sentences F2 splits and R3's "readings are kept" (each checked on its own in section 7). */
const unsplit = (text: string) => text
  .replace(/\d+ scanned tracks? moves? off the crystal Deep Scan gave (it|them)(; \d+ already off it moves? again)?; Deep Scan's reading is kept\. /, '')
  .replace(/\d+ scanned tracks? already off the crystal Deep Scan gave (it|them) moves? again; Deep Scan's reading is kept\. /, '')
  .replace(/\d+ scanned tracks? go(es)? back to the crystal Deep Scan gave (it|them)\. /, '')
  .replace(/(, )?\d+ (scanned tracks?|tracks?) (moved off Deep Scan's crystal|moved again|back on Deep Scan's crystal)/g, '')
  .replace(/ Deep Scan's readings are kept\./, '')
  .replace(/: \. /, ': every track keeps its crystal. ')
  .replace(/: , /, ': ');
let identical = 0, sameWords = 0, byTheFile = 0;
for (const [k, withFiles] of invariantLibs) {
  eq(sourceIds(withFiles), [], `${k}: no Source track`);
  // v16.8.1 (D2): the spread's key is the file's; v16.7.1's was the id. With the files set aside (the key is then the
  // id, as v16.7.1's) a library with no Source track gets v16.7.1's plan exactly, below; with them, the oracle's.
  const lib = withFiles.map((s) => (s ? withoutFile(s) : s));
  {
    const o = spreadOracle(withFiles as never);
    const after = unique(apply(withFiles, planAssign(withFiles, 'spread')));
    eq(after.filter((s) => JSON.stringify(fields(s)) !== JSON.stringify(o.after.get(s.id))).map((s) => s.id), [], `${k}: with its files: the oracle`);
    // And v16.7.1 keyed by the file: v16.7.1's plan of the library with each id replaced by its file key, the same
    // records (fix round 1, D5r: the stand-ins are seeded by the file key too, so libraries with unmeasured tracks
    // compare as well; F7's stored-score cap aside, and not where a record has a v16.7.1-shaped score at the mark,
    // which v16.7.1 read as a spread track: scorecap.check's case).
    const u0 = unique(withFiles);
    const pseudo = (s: T) => s.crystalSource === 'assigned' && (s.harmonicDeviation as number) >= SPREAD_MARK && !spreadFromScan(s);
    if (withFiles.some((s) => s && s.file) && !u0.some(pseudo) && new Set(u0.map(fileKey)).size === u0.length) {
      const renamed = u0.map((s) => ({ ...withoutFile(s), id: fileKey(s) }) as T);
      const capped = (r: unknown[]) => (r[3] === 'assigned' && r[0] === r[1] && (r[2] as number) > 998 ? [r[0], r[1], 998, r[3]] : r);
      const v = new Map(apply(renamed, spreadV1671(renamed)).map((s) => [s.id, capped(fields(s))]));
      eq(u0.filter((s) => JSON.stringify(fields(after.find((x) => x.id === s.id)!)) !== JSON.stringify(v.get(fileKey(s)))).map((s) => s.id), [], `${k}: v16.7.1 keyed by the file`);
      byTheFile++;
    }
  }
  const a = spreadV1671(lib), b = planAssign(lib, 'spread');
  eq(b.source, 0, `${k}: no Source track counted`);
  eq(ser(b), ser(a), `${k}: the same patches as v16.7.1`);
  eq(counts(b), counts(a), `${k}: the same counts as v16.7.1`);
  // The words: v16.7.1's wherever nothing moves again or back (a first spread), else with F2's sentences set aside.
  const words = (p: AssignPlan) => [assignConfirmText(p).body, assignDoneText(p), assignNothingText(p)];
  const old = wordsV1671(a);
  const words0 = [old.confirm, old.done, old.nothing];
  if (b.again === 0 && b.back === 0 && b.spread === b.off && (b.readings ?? 0) > 0) {
    eq(words(b), words0, `${k}: the same words as v16.7.1`);
    eq(assignNeedsConfirm(b), old.needsConfirm, `${k}: asks first as v16.7.1 did`);
    sameWords++;
  } else {
    eq(words(b).map(unsplit), words0.map(unsplit), `${k}: the same words as v16.7.1 but F2's split sentences`);
  }
  identical++;
}
ok(identical >= 300, `the invariant on ${identical} libraries (${sameWords} with the same words)`);
ok(byTheFile >= 10, `v16.7.1 keyed by the file on ${byTheFile} libraries (fix round 1: stand-ins included, D5r)`);

// ---- 5. Already spread: they come back, and the rest re-spread around them --------------------------------------
let back = 0;
{
  for (const [k, l] of [...fixtures, ...randoms, ['MIXED', MIXED] as [string, T[]]]) {
    const v1 = apply(l, spreadV1671(l));
    const away = unique(v1).filter((s) => sourceTrack(s) && s.closestSolfeggio !== SOURCE_FREQ);
    const p = planAssign(v1, 'spread');
    eq(p.restored, away.length, `${k}: the v16.7.1 spread's Source tracks away from 2178 come back`);
    if (away.length) {
      back++;
      ok(away.every((s) => spreadFromScan(s) || crystalOrigin(s) === 'scan-replaced'), `${k}: they were moved, their reading kept`);
      eq(libraryHealth(v1 as never).sourceBack, away.length, `${k}: the health card offers Assign for them`);
    }
    // The press from the v16.7.1 spread lands where a first v16.7.3 press from the library itself does.
    const fromV1 = apply(v1, p), direct = apply(l, planAssign(l, 'spread'));
    eq(unique(fromV1).map((s) => [s.id, s.closestSolfeggio]).sort(), unique(direct).map((s) => [s.id, s.closestSolfeggio]).sort(), `${k}: from v16.7.1's spread, the same crystals as a first press`);
  }
  ok(back >= 40, `Source tracks come back in ${back} libraries`);
  eq(spreadV1671(MIXED).perCrystal[AT] < 5, true, "MIXED: v16.7.1's spread had moved Source tracks off 2178");
}

// ---- 6. 2178's share: a full share on top of its Source tracks (v16.8.1, D3, D3b) ----------------------------------
// (Was v16.7.3's: the Source tracks are 2178's share, so others join them only while 2178 is short.)
{
  /** A clean library: k Source scans and n - k others (bunched scans and new tracks), every one open. */
  const clean = (n0: number, k: number): T[] => [
    ...Array.from({ length: k }, (_, i) => scan(`c${n0}-${k}-s${i}`, R2178[i % R2178.length])),
    ...Array.from({ length: n0 - k }, (_, i) => (i % 3 === 2 ? fresh(`c${n0}-${k}-n${i}`, i) : bunched(`c${n0}-${k}-b${i}`, i))),
  ];
  let cases = 0;
  for (const size of [1, 3, 10, 26, 27, 28, 40, 53, 54, 55, 56, 80, 81, 82, 108, 109, 160, 270]) {
    for (const k of [0, 1, 2, 3, 4, 5, 6, 10, 30, 80]) {
      if (k > size) continue;
      const lib = clean(size, k);
      const p = planAssign(lib, 'spread');
      const at = p.perCrystal[AT];
      const open = size - k;
      // The fill: each crystal's tracks, 2178's Source tracks aside.
      const fill = p.perCrystal.map((c, i) => c - (i === AT ? k : 0));
      const tag = `${size} tracks, ${k} Source`;
      ok(at >= k && p.source === k, `${tag}: 2178 keeps its Source tracks`);
      ok(Math.max(...fill.filter((_, i) => i !== AT)) - Math.min(...fill.filter((_, i) => i !== AT)) <= 1, `${tag}: the other 26 are even`);
      if (open >= 27) {
        // D3: the open tracks spread evenly over all 27, 2178 included: its fill is a share like any other.
        ok(Math.max(...fill) - Math.min(...fill) <= 1, `${tag}: the fill is even over all 27 (${fill})`);
        ok(fill[AT] === Math.floor(open / 27) || fill[AT] === Math.ceil(open / 27), `${tag}: 2178 gets a full share (${fill[AT]}) on top of its ${k}`);
      } else if (k > 0) {
        // D3b: too few open tracks to give every crystal one: the empty crystals get them, none joins 2178.
        eq(at, k, `${tag}: too few open tracks: none joins 2178 while a crystal is empty`);
      }
      // (With 2 or more Source tracks, 27 tracks can't cover all 27: the Source tracks stay together on 2178.)
      eq(p.emptyAfter, Math.max(0, (k > 0 ? 26 : 27) - open), `${tag}: crystals left empty only for want of tracks`);
      if (k > 0 && open >= 26) eq(p.emptyAfter, 0, `${tag}: every crystal has a track`);
      // The independent restatement agrees.
      const o = spreadOracle(lib as never);
      eq([p.perCrystal, unique(apply(lib, p)).map((s) => JSON.stringify(fields(s)) === JSON.stringify(o.after.get(s.id))).every(Boolean)], [o.perCrystal, true], `${tag}: the oracle`);
      // F1: after the press, the card offers no Assign that would do nothing.
      const h = libraryHealth(apply(lib, p) as never);
      ok(!(h.emptyCrystals > 0 && h.spreadCover > 27 - h.emptyCrystals), `${tag}: after a press, no optional Assign is offered`);
      cases++;
    }
  }
  // The named cases (54 tracks, a share of 2), and the review page's (270 tracks, 6 Source: about 10 a crystal, about
  // 16 on 2178). 2178 is the spread order's 14th, so in a partial round it is among the first 14 crystals to get one.
  eq(planAssign(clean(54, 0), 'spread').perCrystal[AT], 2, '54 tracks, no Source track: 2178 gets its share (2)');
  eq(planAssign(clean(54, 1), 'spread').perCrystal[AT], 3, '54 tracks, 1 Source track: 53 open, 2178 gets 2 of them on top (was 2)');
  eq(planAssign(clean(54, 2), 'spread').perCrystal[AT], 4, '54 tracks, 2 Source tracks: 52 open, 2178 gets 2 on top (was 2)');
  {
    const p = planAssign(clean(54, 10), 'spread');
    eq([p.perCrystal[AT], p.emptyAfter, Math.min(...p.perCrystal)], [12, 0, 1], '54 tracks, 10 Source tracks: 44 open, 2178 holds the 10 and 2 more (was 10 and nothing more); every crystal has a track');
  }
  {
    const p = planAssign(clean(270, 6), 'spread');
    const others = p.perCrystal.filter((_, i) => i !== AT);
    eq([Math.min(...others), Math.max(...others), p.perCrystal[AT] >= 15 && p.perCrystal[AT] <= 16], [9, 10, true], `270 tracks, 6 Source tracks: 9 or 10 on each crystal, ${p.perCrystal[AT]} on 2178`);
  }
  {
    // D3b at its edge, 1 Source track and: 25 others cover 26 crystals (one stays empty); 26 others cover all 27, none
    // of them on 2178 (without D3b, 2178 would take one and a crystal would stay empty); 27 others give 2178 one too.
    const at = (n0: number) => planAssign(clean(n0, 1), 'spread');
    eq([at(26).emptyAfter, at(26).perCrystal[AT], at(27).emptyAfter, at(27).perCrystal[AT], at(28).emptyAfter, at(28).perCrystal[AT]], [1, 1, 0, 1, 0, 2], 'D3b at its edge: 25, 26 and 27 others');
    eq([at(20).emptyAfter, at(20).perCrystal[AT]], [7, 1], '1 Source track and 19 others: 20 crystals covered, the 19 on 19 empty ones (none on 2178)');
  }
  ok(cases >= 120, `${cases} share cases`);
  ok(SPREAD_ORDER.indexOf(SOURCE_FREQ) === 13, '2178 is the spread order\'s 14th (HEART, the fifth round)');
  // F1's inputs: after one press the card used to offer an optional Assign that wrote nothing.
  for (const [k, lib] of f1Inputs) {
    const h = libraryHealth(lib as never);
    eq([h.emptyCrystals > 0, h.total > 27 - h.emptyCrystals, h.spreadCover > 27 - h.emptyCrystals, planAssign(lib, 'spread').patches.size], [h.emptyCrystals > 0, h.total > 27 - h.emptyCrystals, false, 0], `${k}: no optional Assign (the press would write nothing)`);
  }
  ok(f1Inputs.some(([, lib]) => { const h = libraryHealth(lib as never); return h.emptyCrystals > 0 && h.total > 27 - h.emptyCrystals; }), "F1: v16.7.3's first build's rule would have offered it");
}

// ---- 7. The words -------------------------------------------------------------------------------------------------
{
  const FIRST = 'the GUT, HEART and HEAD ranges in turn.';
  // Two go back (MIXED): the confirmation says so first; the notice lists them and closes with SOURCE.
  const p = planAssign(MIXED, 'spread');
  const body = assignConfirmText(p).body;
  ok(body.startsWith(`2 tracks Deep Scan placed on 2178 Hz go back to the SOURCE crystal. Every other track is spread over all 27 crystals, ${FIRST} `), `confirmation: 2 go back, first (${body})`);
  ok(!body.includes('keep the SOURCE crystal'), 'confirmation: not also "keep"');
  ok(body.includes(`${plural(p.off!, 'scanned track moves', 'scanned tracks move')} off the crystal Deep Scan gave them`), 'confirmation: the scans that move off (the Source tracks not among them)');
  const done = assignDoneText(p);
  ok(new RegExp(`^Tracks spread over all 27 crystals: ${p.off} scanned tracks moved off Deep Scan's crystal, 2 tracks back on 2178 Hz, 2 tracks got a crystal, ${p.moved + p.movedFailed} assigned crystals moved\\. `).test(done), `notice: the parts (${done})`);
  ok(done.endsWith(" Deep Scan's readings are kept. Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal."), 'notice: the closing sentence');
  eq(assignNothingText(planAssign(apply(MIXED, p), 'spread')), 'Every track is already spread over all 27 crystals.', 'the second press: the toast, unchanged (every crystal has a track)');

  // One goes back, and nothing else changes: the restored count alone asks first.
  const settled = apply(MIXED, p);
  const one = settled.map((s) => (s.id === '1772000000000-s1' ? ({ ...s, closestSolfeggio: 852, harmonicDeviation: SPREAD_MARK + Math.abs(2180.5 - 852), crystalSource: 'assigned' } as T) : s));
  const p1 = planAssign(one, 'spread');
  eq([p1.patches.size, p1.restored, p1.source, p1.moved + p1.movedFailed + p1.off! + p1.again! + p1.back! + p1.given], [1, 1, 4, 0], 'one moved away: only it changes');
  ok(assignNeedsConfirm(p1), 'one going back alone: Assign asks first');
  ok(assignConfirmText(p1).body.startsWith(`1 track Deep Scan placed on 2178 Hz goes back to the SOURCE crystal. Every other track is spread over all 27 crystals, ${FIRST} Keys`), `confirmation: 1 goes back (${assignConfirmText(p1).body})`);
  ok(/: 1 track back on 2178 Hz\. /.test(assignDoneText(p1)) && assignDoneText(p1).endsWith(' Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.'), `notice: 1 back (${assignDoneText(p1)})`);
  eq(libraryHealth(one as never).sourceBack, 1, 'the health card: 1 can go back');

  // Source tracks already on 2178 while others move: "keep", no "go back".
  const kept = [...Array.from({ length: 30 }, (_, i) => bunched(`k${i}`, i)), scan('k-s1', 2180.5), scan('k-s2', 2179.25)];
  const pk = planAssign(kept, 'spread');
  eq([pk.source, pk.restored, assignNeedsConfirm(pk)], [2, 0, true], 'two on 2178, the bunch moves');
  const bk = assignConfirmText(pk).body;
  ok(bk.startsWith(`Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal. Every other track is spread over all 27 crystals, ${FIRST} `) && !/go(es)? back/.test(bk), `confirmation: they keep it (${bk})`);
  const dk = assignDoneText(pk);
  ok(!dk.includes('back on 2178') && dk.endsWith(' Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.'), 'notice: no "back", the closing sentence');

  // F2: one scanned track going back to its own crystal is the only change: Assign asks first, and says so.
  {
    const t = settled.find((s) => crystalOrigin(s) === 'scan' && !sourceTrack(s) && s.closestSolfeggio === scanCrystalOf(s.harmonicFreq as number))!;
    const elsewhere = ALL_CRYSTALS.find((c) => c !== t.closestSolfeggio && c !== SOURCE_FREQ)!;
    const lib = settled.map((s) => (s.id === t.id ? ({ ...s, closestSolfeggio: elsewhere, harmonicDeviation: SPREAD_MARK + Math.abs((s.harmonicFreq as number) - elsewhere), crystalSource: 'assigned' } as T) : s));
    const q = planAssign(lib, 'spread');
    eq([q.patches.size, q.back, q.off, q.again, q.moved + q.movedFailed + q.restored + q.given], [1, 1, 0, 0, 0], 'one spread track back on its own crystal: the only change');
    ok(assignNeedsConfirm(q), 'a scanned track going back alone: Assign asks first (a crystal it has changes)');
    const b = assignConfirmText(q).body;
    ok(b.includes(' 1 scanned track goes back to the crystal Deep Scan gave it. ') && !b.includes("Deep Scan's reading is kept"), `confirmation: 1 goes back, nothing moves off (${b})`);
    ok(/: 1 track back on Deep Scan's crystal\. /.test(assignDoneText(q)), `notice: 1 back on Deep Scan's crystal (${assignDoneText(q)})`);
  }
  // F2: a record-only change (a scan already on the crystal the spread gives it, its record Assign's from now on) moves
  // no crystal: Assign does not ask (v16.7.1 asked: it counted it in spread).
  {
    const u = settled.find((s) => spreadFromScan(s) && !sourceTrack(s))!;
    const lib = settled.map((s) => (s.id === u.id ? ({ ...s, crystalSource: 'scan', harmonicDeviation: Math.abs((s.harmonicFreq as number) - (s.closestSolfeggio as number)) } as T) : s));
    const q = planAssign(lib, 'spread');
    eq([q.patches.size, q.spread, q.off, q.again, q.back, q.moved + q.movedFailed + q.restored + q.given], [1, 1, 0, 0, 0, 0], 'a record-only change: in spread, in none of off / again / back');
    ok(!assignNeedsConfirm(q) && wordsV1671(q).needsConfirm, "it doesn't ask (v16.7.1's rule did)");
    ok(!/move|go(es)? back/.test(assignConfirmText(q).body.replace('the GUT, HEART and HEAD ranges in turn', '')), `and the words name no move (${assignConfirmText(q).body})`);
  }
  // F3: the toast when nothing is left to do and crystals stay empty because the SOURCE tracks stay together.
  {
    const [, lib] = f1Inputs[0];
    const q = planAssign(lib, 'spread');
    eq([q.patches.size, q.emptyAfter > 0, q.source], [0, true, 2], 'F1 27/2 after a press: nothing to do, a crystal empty, 2 SOURCE tracks');
    eq(assignNothingText(q), 'Every track is already spread over the crystals; tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.', 'the toast says why a crystal is empty');
  }
  // F2: the moved scans by how they move, singular and plural, each sentence only when its count is above 0.
  {
    // One that moves off, one that moves again (spread before), one that goes back: a v16.7.1-spread pair and a scan.
    const lib = [...Array.from({ length: 27 }, (_, i) => scan(`w${i}`, ALL_CRYSTALS[i] === 6336 ? 6336.5 : ALL_CRYSTALS[i] + 1.5)), scan('w-a', 530.5)];
    const p0 = planAssign(lib, 'spread');
    ok(p0.off! >= 1, `a first spread moves scans off (${p0.off})`);
    ok((p0.again ?? 0) === 0 && (p0.back ?? 0) === 0, 'a first spread of fresh scans: nothing moves again or back');
  }
  // R1: only a scan already off its Deep Scan crystal moves (to another one, again): the again words on their own.
  {
    const u = settled.find((s) => spreadFromScan(s) && !sourceTrack(s))!;
    const own = scanCrystalOf(u.harmonicFreq as number);
    const elsewhere = ALL_CRYSTALS.find((c) => c !== u.closestSolfeggio && c !== own && c !== SOURCE_FREQ)!;
    const lib = settled.map((s) => (s.id === u.id ? ({ ...s, closestSolfeggio: elsewhere, harmonicDeviation: SPREAD_MARK + Math.abs((s.harmonicFreq as number) - elsewhere) } as T) : s));
    const q = planAssign(lib, 'spread');
    eq([q.patches.size, q.again, q.off, q.back, q.restored], [1, 1, 0, 0, 0], 'one scan already off its crystal moves again: the only change');
    ok(assignConfirmText(q).body.includes(" 1 scanned track already off the crystal Deep Scan gave it moves again; Deep Scan's reading is kept. "), `confirmation: 1 moves again (${assignConfirmText(q).body})`);
    ok(/: 1 scanned track moved again\. /.test(assignDoneText(q)), `notice: 1 moved again (${assignDoneText(q)})`);
  }
  // R2: every track a SOURCE one: no "Every other track" (there is none).
  {
    const allSource = [scan('v-s1', 2180.5), spread1671('v-s2', 2179.25, 741), replaced('v-s3', 2182, 1935)];
    const q = planAssign(allSource, 'spread');
    eq([q.total, q.source, q.restored], [3, 3, 2], 'three tracks, all SOURCE, two away');
    eq(assignConfirmText(q).body, '2 tracks Deep Scan placed on 2178 Hz go back to the SOURCE crystal. Keys and visual sync are kept.', 'the confirmation: no "Every other track"');
    const one = [spread1671('v-s4', 2180.5, 852)];
    eq(assignConfirmText(planAssign(one, 'spread')).body, '1 track Deep Scan placed on 2178 Hz goes back to the SOURCE crystal. Keys and visual sync are kept.', 'a one-track library: the same');
  }
  // R3: nothing Deep Scan read: the notice doesn't say its readings are kept.
  {
    const unscanned = Array.from({ length: 40 }, (_, i) => fresh(`y${i}`, i));
    const q = planAssign(unscanned, 'spread');
    eq(q.readings, 0, '40 new tracks: no reading');
    ok(!assignDoneText(q).includes('readings'), `the notice says nothing of readings (${assignDoneText(q)})`);
    const withOne = planAssign([...unscanned, scan('y-s', 530.5)], 'spread');
    ok(withOne.readings === 1 && assignDoneText(withOne).includes(" Deep Scan's readings are kept."), 'one scan among them: it does');
  }
  // R4: a Source scan with no crystal (a shape Deep Scan never writes) gets one: given, not restored, and it doesn't ask.
  {
    const bare = { ...base('z-s'), harmonicFreq: 2180.5, harmonicDeviation: 2, crystalSource: 'scan' } as T;
    const q = planAssign([bare], 'spread');
    eq([q.source, q.restored, q.given, q.kept, assignNeedsConfirm(q)], [1, 0, 1, 0, false], 'counted as given, not restored; no question (it had no crystal)');
    eq(libraryHealth([bare] as never).sourceBack, 0, 'the health card: nothing to put back');
    eq(apply([bare], q)[0].closestSolfeggio, SOURCE_FREQ, 'and it is on 2178, the scan\'s');
  }
  // W1 and W2: a SOURCE track away from 2178 and an unreadable scan (left where it is): nothing spreads.
  {
    const lib = [spread1671('t-s1', 2180.5, 852), unreadableOn('t-u1', 639)];
    const q = planAssign(lib, 'spread');
    eq([q.total, q.source, q.open, q.restored], [2, 1, 0, 1], 'one SOURCE track away, one unreadable scan: nothing to spread');
    eq(assignConfirmText(q).body, '1 track Deep Scan placed on 2178 Hz goes back to the SOURCE crystal. Keys and visual sync are kept.', 'the confirmation: no "Every other track" (W1)');
    eq(assignDoneText(q), "Crystals assigned: 1 track back on 2178 Hz. 25 crystals still have no track. CAB readiness: 0/27 crystals at 3 or more. Deep Scan's readings are kept. Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.", "the notice: Assign's own heading (W2)");
    const withOne = planAssign([...lib, fresh('t-n1')], 'spread');
    ok(assignConfirmText(withOne).body.includes(' Every other track is spread over the crystals, ') && assignDoneText(withOne).startsWith('Tracks spread over the crystals: '), 'one new track besides: it spreads, and the words say so');
    const only = planAssign([spread1671('t-s2', 2180.5, 852), spread1671('t-s3', 2179.25, 741)], 'spread');
    eq(assignDoneText(only), "Crystals assigned: 2 tracks back on 2178 Hz. 26 crystals still have no track. CAB readiness: 0/27 crystals at 3 or more. Deep Scan's readings are kept. Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.", 'only SOURCE tracks: the notice (W2)');
  }
  // W3: a SOURCE scan with no crystal is given 2178 as Deep Scan's: not an assigned crystal.
  {
    const bare = { ...base('t-b'), harmonicFreq: 2180.5, harmonicDeviation: 2, crystalSource: 'scan' } as T;
    const q = planAssign([bare, spread1671('t-s4', 2179.25, 741)], 'spread');
    eq([q.given, q.sourceGiven, q.restored], [1, 1, 1], 'given 1 (the bare one), restored 1');
    eq(assignConfirmText(q).body, '1 track Deep Scan placed on 2178 Hz goes back to the SOURCE crystal. 1 track without one gets a crystal. Keys and visual sync are kept.', "the confirmation: no 'Assigned crystals aren't a scan' (W3)");
    const q2 = planAssign([bare, spread1671('t-s5', 2179.25, 741), fresh('t-n2')], 'spread');
    ok(assignConfirmText(q2).body.includes("2 tracks without one get a crystal. Assigned crystals aren't a scan: Deep Scan can still analyse those tracks."), `a new track besides: it is assigned, so the sentence is back (${assignConfirmText(q2).body})`);
  }
  // No Source track: no word of 2178 or SOURCE.
  for (const [k, l] of invariantLibs.slice(0, 40)) {
    const q = planAssign(l, 'spread');
    ok(!/2178|SOURCE/.test(assignConfirmText(q).body + assignDoneText(q) + assignNothingText(q)), `${k}: no Source track, no word of 2178`);
  }
  // Each sentence only when its count is above 0, with its count, on every library.
  let singular = 0;
  for (const [k, l] of all) {
    const q = planAssign(l, 'spread');
    const b = assignConfirmText(q).body, d = assignDoneText(q);
    const src = q.source ?? 0, off = q.off ?? 0, again = q.again ?? 0, bk2 = q.back ?? 0;
    eq(/go(es)? back to the SOURCE crystal\./.test(b), q.restored > 0, `${k}: "go back to the SOURCE crystal" exactly when some do`);
    if (q.restored > 0) ok(b.startsWith(`${plural(q.restored, 'track Deep Scan placed on 2178 Hz goes', 'tracks Deep Scan placed on 2178 Hz go')} back to the SOURCE crystal.${(q.open ?? 0) > 0 ? ' Every other track is spread' : ''}`), `${k}: first, with its count`);
    eq(b.startsWith('Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.'), src > 0 && q.restored === 0, `${k}: "keep the SOURCE crystal" exactly when they all stay`);
    eq(b.includes('Every other track is spread'), src > 0 && (q.open ?? 0) > 0, `${k}: "Every other track" exactly with SOURCE tracks and a track to spread (W1)`);
    eq(d.startsWith('Crystals assigned: '), src > 0 && (q.open ?? 0) === 0, `${k}: Assign's own heading exactly when nothing spreads (W2)`);
    eq(b.includes("Assigned crystals aren't a scan"), q.given - (q.sourceGiven ?? 0) + q.moved + q.movedFailed > 0, `${k}: "Assigned crystals aren't a scan" exactly when Assign places one (W3)`);
    eq(b.includes('Every track is spread'), src === 0, `${k}: "Every track" exactly without SOURCE tracks`);
    eq(b.includes(`${plural(off, 'scanned track moves', 'scanned tracks move')} off the crystal Deep Scan gave ${off === 1 ? 'it' : 'them'}`), off > 0, `${k}: the "move off" sentence with its count`);
    eq(b.includes(off > 0 ? `; ${plural(again, 'already off it moves', 'already off it move')} again;` : `${plural(again, 'scanned track already off the crystal Deep Scan gave it moves', 'scanned tracks already off the crystal Deep Scan gave them move')} again;`), again > 0, `${k}: the "again" words with their count`);
    ok(!/spread before|spread tracks? moved/.test(b + d), `${k}: never "spread before" (R1)`);
    eq(b.includes(`${plural(bk2, 'scanned track goes', 'scanned tracks go')} back to the crystal Deep Scan gave ${bk2 === 1 ? 'it' : 'them'}.`), bk2 > 0, `${k}: the "go back to the crystal Deep Scan gave" sentence with its count`);
    eq(b.includes("; Deep Scan's reading is kept."), off + again > 0, `${k}: "Deep Scan's reading is kept" once, after the ones that move`);
    eq((b.match(/Deep Scan's reading is kept/g) ?? []).length, off + again > 0 ? 1 : 0, `${k}: once`);
    eq(d.includes(`${plural(off, 'scanned track', 'scanned tracks')} moved off Deep Scan's crystal`), off > 0, `${k}: the notice's "moved off" with its count`);
    eq(d.includes(`${plural(again, 'scanned track', 'scanned tracks')} moved again`), again > 0, `${k}: the notice's "moved again" with its count`);
    eq(d.includes(" Deep Scan's readings are kept."), (q.readings ?? 0) > 0, `${k}: "Deep Scan's readings are kept" exactly when the library holds one`);
    eq(d.includes(`${plural(bk2, 'track', 'tracks')} back on Deep Scan's crystal`), bk2 > 0, `${k}: the notice's "back on Deep Scan's crystal" with its count`);
    eq(d.includes(`${plural(q.restored, 'track', 'tracks')} back on 2178 Hz`), q.restored > 0, `${k}: the notice's "back on 2178 Hz" with its count`);
    eq(d.endsWith(' Tracks Deep Scan placed on 2178 Hz keep the SOURCE crystal.'), src > 0, `${k}: the closing sentence exactly with SOURCE tracks`);
    if ([q.restored, off, again, bk2].includes(1)) singular++;
  }
  ok(singular >= 10, `the singular forms exercised (${singular} libraries)`);
}

Math.random = realRandom;
console.log = realLog;
console.log(`source.check: ${checks} checks passed (${compared} libraries, ${oracleSource} with Source tracks under the oracle, ${withSource} of ${randoms.length} seeded ones with Source tracks; the v16.7.1 invariant on ${identical}, v16.7.1 keyed by the file on ${byTheFile}; back from a v16.7.1 spread in ${back})`);
