// utils/mix/devices.check.ts (v16.8.1 "Same Crystals Everywhere"). `node utils/mix/devices.check.ts` (npm run check:mix).
//
// The user's goal, checked directly: two devices that hold the same files end up with the same crystals after Deep
// Scan and Auto-Distribute. Thousands of generated libraries, each file key (name and size) unique: fully scanned
// (with and without Source tracks), partly scanned, with unreadable scans that stay, spread and legacy records, from 0
// to 1,000 tracks. Each runs planAssign(lib, 'spread') as the app does, and again on a "second device" copy: the same
// files and readings, fresh ids (made at import, per device) and another library order. Every track's record after,
// matched by its file key, must be identical, for every track, measured or not (D5r: an unmeasured track's stand-in is
// seeded by its file key too). The one residual case: standInFreq also reads the track's length (180 s while it isn't
// known; ×0.8 over 300 s, ×1.2 under 120 s), so a length one device hasn't read yet, or one either side of a threshold,
// can still give another stand-in; so the second device's lengths differ only within a band for an unmeasured track
// (any length for a measured one, which the spread never reads). Also: the plan against the
// independent oracle (scripts/mix-golden/spread-oracle.ts) and against the frozen v16.7.1 spread keyed by the file
// (section 2b), the Source tracks on 2178, the fill's balance (D3), spreadCover (D3b), the press moving no crystal the
// second time (D8), needsRescan / rescanQueue / rescanPatch (D4) and fileKey against the playlists' fingerprint.
//
//   node utils/mix/devices.check.ts                     the working tree
//   node utils/mix/devices.check.ts --collect           failures counted by kind instead of stopping at the first
//                                                       (a negative control: run with a resolve hook that hands this
//                                                       file another release's planAssign; 9541b9d's must fail)
// Synthetic tones only ("tone-…"); a seeded generator, never Math.random.
import { strict as assert } from 'node:assert';
import * as LIVE from './distribution.ts';
import type { AssignPlan, AssignSong } from './distribution.ts';
import { SOURCE_FREQ } from '../crystalData.ts';
import { patchById } from '../library/listOps.ts';
import { fpKey } from '../playlists/model.ts';
import { libraryHealth } from '../../components/shell/library/libraryModel.ts';
import { spreadOracle } from '../../scripts/mix-golden/spread-oracle.ts';
import { spreadV1671 } from '../../scripts/mix-golden/spread-v1671.ts';
// @ts-ignore: the harness's fixture is plain .mjs (no types)
import { mulberry32 } from '../../scripts/mix-golden/fixture.mjs';

const COLLECT = process.argv.includes('--collect');
const { ALL_CRYSTALS, SPREAD_MARK, scanCrystalOf, planAssign } = LIVE;

let checks = 0;
const failures: Record<string, number> = {};
const firstFailure: Record<string, string> = {};
const fail = (kind: string, msg: string) => {
  if (!COLLECT) assert.fail(msg);
  failures[kind] = (failures[kind] ?? 0) + 1;
  firstFailure[kind] ??= msg;
};
const ok = (kind: string, cond: unknown, msg: string) => { checks++; if (!cond) fail(kind, msg); };
const same = (kind: string, a: unknown, b: unknown, msg: string) => {
  checks++;
  try { assert.deepStrictEqual(a, b); } catch { fail(kind, `${msg}: ${JSON.stringify(a)?.slice(0, 300)} vs ${JSON.stringify(b)?.slice(0, 300)}`); }
};
const realLog = console.log, realRandom = Math.random;
console.log = () => {};
Math.random = () => { throw new Error('Math.random used'); };

type T = AssignSong & Record<string, unknown>;
const apply = (l: readonly T[], p: AssignPlan) => patchById(l as never[], p.patches as never) as unknown as T[];
const recOf = (s: T) => [s.closestSolfeggio ?? null, s.harmonicFreq ?? null, s.harmonicDeviation ?? null, s.crystalSource ?? null];
const fk = (s: T) => (s.file ? `${(s.file as { name: string }).name}|${(s.file as { size: number }).size}` : s.id);
const AT = ALL_CRYSTALS.indexOf(SOURCE_FREQ);

// ---- the tracks ---------------------------------------------------------------------------------------------------
const R2178 = [2180.5, 2179.25, 2182, 2175.5, 2178, 1089, 2177.25, 2181, 1089.5];
for (const f of R2178) ok('setup', scanCrystalOf(f) === SOURCE_FREQ, `${f} Hz reads as 2178`);
/** Readings: bunched near a few crystals (the ties a scanned library is made of), or anywhere from 60 Hz to 6.4 kHz. */
function readingOf(rnd: () => number, bunch: readonly number[]): number {
  if (rnd() < 0.7) return bunch[Math.floor(rnd() * bunch.length)] * (rnd() < 0.2 ? 0.5 : 1) + Math.round(rnd() * 8) * 0.25;
  return Math.round((60 + rnd() * 6340) * 100) / 100;
}
const scanRec = (hf: number): Partial<T> => { const c = scanCrystalOf(hf); return { harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: Math.abs(hf - c), crystalSource: 'scan', isAetheriaCandidate: false, fractalAnalysis: { dominantFrequency: hf } } as Partial<T>; };
const spreadRec = (hf: number, c: number): Partial<T> => ({ harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: SPREAD_MARK + Math.abs(hf - c), crystalSource: 'assigned', isAetheriaCandidate: false, fractalAnalysis: { dominantFrequency: hf } }) as Partial<T>;
const replacedRec = (hf: number, c: number): Partial<T> => ({ harmonicFreq: hf, closestSolfeggio: c, harmonicDeviation: 7.77, fractalAnalysis: { dominantFrequency: hf } }) as Partial<T>;

type Kind = 'scanned' | 'partly' | 'stays' | 'unscanned';
/** One library: `size` tracks of `kind`, Source tracks at `sourceRate`, each with its own file (unique keys). */
function library(seed: number, size: number, kind: Kind, sourceRate: number): T[] {
  const rnd = mulberry32(31000 + seed);
  const bunch = ALL_CRYSTALS.filter(() => rnd() < 0.2).slice(0, 1 + Math.floor(rnd() * 5));
  if (!bunch.length) bunch.push(ALL_CRYSTALS[seed % 27]);
  const pile = ALL_CRYSTALS[Math.floor(rnd() * 27)];
  const sizes: number[] = [];
  const used = new Set<string>();
  return Array.from({ length: size }, (_, i) => {
    // Unique keys, some sharing a name (another size) or a size (another name).
    const name = `tone-${seed}-${rnd() < 0.05 && i > 0 ? i - 1 : i}`;
    let bytes = rnd() < 0.05 && sizes.length ? sizes[0] : 20000 + Math.floor(rnd() * 900000);
    while (used.has(`${name}.wav|${bytes}`)) bytes++;
    used.add(`${name}.wav|${bytes}`);
    sizes.push(bytes);
    const base = { id: `${1771000000000 + seed * 100000 + i}-${(seed * 7919 + i * 104729).toString(36)}`, name, duration: 60 + Math.floor(rnd() * 500), file: { name: `${name}.wav`, size: bytes } };
    const r = rnd();
    const c = ALL_CRYSTALS[Math.floor(rnd() * 27)];
    const src = rnd() < sourceRate;
    const hf = src ? R2178[Math.floor(rnd() * R2178.length)] : readingOf(rnd, bunch);
    // Fully scanned: Deep Scan's records, the spread's, legacy ones an older Auto-Distribute moved.
    const scannedTrack = (): Partial<T> => (r < 0.6 ? scanRec(hf) : r < 0.85 ? spreadRec(hf, scanCrystalOf(hf) === c ? ALL_CRYSTALS[(ALL_CRYSTALS.indexOf(c) + 1) % 27] : c) : replacedRec(hf, c));
    let rec: Partial<T>;
    if (kind === 'scanned') rec = scannedTrack();
    else if (kind === 'stays') rec = rnd() < 0.25 ? ({ harmonicFreq: 0, closestSolfeggio: rnd() < 0.7 ? pile : c, harmonicDeviation: 3, crystalSource: 'scan' } as Partial<T>) : rnd() < 0.05 ? ({ harmonicFreq: 0, closestSolfeggio: 500, harmonicDeviation: 3, crystalSource: 'scan' } as Partial<T>) : scannedTrack();
    else if (kind === 'unscanned') rec = rnd() < 0.5 ? {} : ({ harmonicFreq: c, closestSolfeggio: c, harmonicDeviation: 3, crystalSource: 'assigned' } as Partial<T>);
    else {
      const u = rnd();
      rec = u < 0.55 ? scannedTrack()
        : u < 0.7 ? ({ harmonicFreq: c, closestSolfeggio: c, harmonicDeviation: 2 + Math.floor(rnd() * 40), crystalSource: 'assigned' } as Partial<T>)
        : u < 0.78 ? ({ harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999, crystalSource: 'scan' } as Partial<T>)
        : u < 0.85 ? ({ harmonicFreq: c, closestSolfeggio: c, harmonicDeviation: 12 } as Partial<T>)
        : u < 0.9 ? ({ harmonicFreq: 0, closestSolfeggio: c, harmonicDeviation: 3, crystalSource: 'scan' } as Partial<T>)
        : {};
    }
    return { ...base, ...rec } as T;
  });
}
/** An unmeasured open track: the spread scores it from its stand-in (D5r: seeded by the file key). */
const standInRead = (s: T) => LIVE.spreadRole(s).role === 'open' && !LIVE.readByDeepScan(s);
/** standInFreq's length band: under 120 s, 120 to 300 s (an unknown length counts as 180 s), over 300 s. */
const band = (d: number | undefined) => { const x = d || 180; return x > 300 ? 2 : x < 120 ? 0 : 1; };
/** The same files and readings on another device: fresh ids for every track (made at import, per device), another
 *  order (seeded), and other lengths (fix round 2, revR-tests): any for a measured track (the spread doesn't read it),
 *  and within the same stand-in band for an unmeasured one (an unknown length included: the residual case aside). */
function secondDevice(lib: readonly T[], seed: number): T[] {
  const rnd = mulberry32(57000 + seed);
  const lengthIn = (b: number) => (b === 0 ? 1 + Math.floor(rnd() * 119) : b === 1 ? (rnd() < 0.2 ? 0 : 120 + Math.floor(rnd() * 181)) : 301 + Math.floor(rnd() * 900));
  const out = lib.map((s) => ({
    ...s,
    id: `${1790000000000 + Math.floor(rnd() * 1e9)}-${Math.floor(rnd() * 36 ** 8).toString(36)}`,
    duration: standInRead(s) ? lengthIn(band(s.duration)) : Math.floor(rnd() * 1200),
  }));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const byFile = (l: readonly T[]) => l.map((s): [string, unknown[]] => [fk(s), recOf(s)]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
/** Every count of a plan but its patches (keyed by the per-device id). */
const counts = (p: AssignPlan) => { const { patches, ...rest } = p; void patches; return rest; };

// ---- 1. fileKey is the playlists' fingerprint ---------------------------------------------------------------------
{
  const s = { id: 'x', name: 'tone', file: { name: 'tone-01.wav', size: 96044 } };
  ok('fileKey', LIVE.fileKey(s) === fpKey('tone-01.wav', 96044), 'fileKey is fpKey(name, size)');
  ok('fileKey', LIVE.fileKey({ id: '1771-ab', name: 'tone' }) === '1771-ab', 'no file: the id');
}

// ---- 2. Two devices, the same files: the same crystals ------------------------------------------------------------
const SIZES = [0, 1, 2, 3, 5, 8, 13, 20, 26, 27, 28, 30, 40, 53, 54, 55, 81, 100, 160, 270];
const KINDS: Kind[] = ['scanned', 'scanned', 'partly', 'stays', 'unscanned'];
const RATES = [0, 0, 0.03, 0.08, 0.2, 0.6];
let libs = 0, withSource = 0, withStays = 0, fullyScanned = 0, withStandIns = 0, standIns = 0, balanced = 0, small = 0, byV1671 = 0, byV1671Short = 0, moved = 0;
const runs: Array<[number, number, Kind, number]> = [];
for (let seed = 0; seed < 2400; seed++) runs.push([seed, SIZES[seed % SIZES.length], KINDS[seed % KINDS.length], RATES[Math.floor(seed / SIZES.length) % RATES.length]]);
for (const [seed, size, kind, rate] of [...runs, [9001, 600, 'scanned', 0.02] as const, [9002, 1000, 'partly', 0.01] as const, [9003, 1000, 'scanned', 0.05] as const]) {
  const lib = library(seed, size, kind as Kind, rate);
  const tag = `#${seed} (${size} ${kind}, Source ${rate})`;
  const keys = new Set(lib.map(fk));
  ok('setup', keys.size === lib.length, `${tag}: every file key unique`);
  const pA = planAssign(lib, 'spread');
  const a = apply(lib, pA);
  const lib2 = secondDevice(lib, seed);
  const pB = planAssign(lib2, 'spread');
  const b = apply(lib2, pB);
  // The user's goal: every track's record, matched by its file, identical on both devices.
  same('devices', byFile(b), byFile(a), `${tag}: the second device, the same files: the same records`);
  same('devices', counts(pB), counts(pA), `${tag}: the second device: the same counts`);
  standIns += lib.filter(standInRead).length;
  if (lib.some(standInRead)) withStandIns++;
  // The independent oracle (D2, D3, D3b), on the first device.
  const o = spreadOracle(lib as never);
  const why = a.filter((s) => JSON.stringify(recOf(s)) !== JSON.stringify(o.after.get(s.id))).map((s) => s.id);
  same('oracle', why, [], `${tag}: every track as the oracle places it`);
  same('oracle', [pA.perCrystal, pA.emptyAfter, pA.open, pA.source], [o.perCrystal, o.emptyAfter, o.open, [...o.role.values()].filter((r) => r === 'source').length], `${tag}: the oracle's counts`);
  // D3: the Source tracks on 2178, the scan's; the fill (no Source track) even when nothing stays.
  const src = lib.filter((s) => LIVE.sourceTrack(s));
  for (const s of src) { const x = a.find((y) => y.id === s.id)!; ok('source', x.closestSolfeggio === SOURCE_FREQ && x.crystalSource === 'scan', `${tag}: ${s.id}: on 2178`); }
  const stays = [...o.role.values()].includes('stays');
  const fill = pA.perCrystal.map((n, i) => n - (i === AT ? src.length : 0));
  if ((pA.open ?? 0) >= 27 && !stays) { ok('balance', Math.max(...fill) - Math.min(...fill) <= 1, `${tag}: the fill differs by at most 1 across the 27 (${fill})`); balanced++; }
  // D3b: 27 − emptyAfter = min(27, pinned crystals + open tracks) = the health card's spreadCover.
  same('cover', 27 - pA.emptyAfter, Math.min(27, o.pinnedCrystals + o.open), `${tag}: 27 − emptyAfter = min(27, pinned + open)`);
  same('cover', libraryHealth(lib as never).spreadCover, 27 - pA.emptyAfter, `${tag}: the health card's spreadCover`);
  if (src.length && o.open < 27) small++;
  ok('idempotent', planAssign(a, 'spread').patches.size === 0, `${tag}: a second press writes nothing`);
  // D8: the press's moves are the tracks whose crystal changes (counted from the libraries), and after it none: the
  // health card's optional Assign hides after one press.
  const before = new Map(lib.map((s) => [s.id, s.closestSolfeggio ?? null]));
  same('d8', LIVE.crystalMoves(pA), a.filter((s) => (s.closestSolfeggio ?? null) !== before.get(s.id)).length, `${tag}: crystalMoves counts the crystals that change`);
  same('d8', LIVE.crystalMoves(planAssign(a, 'spread')), 0, `${tag}: after the press, nothing to move`);
  if (LIVE.crystalMoves(pA) > 0) moved++;
  // 2b. The frozen v16.7.1 spread (scripts/mix-golden/spread-v1671.ts, 666132c's own code) keyed by the file: each id
  // renamed to its file key (so its tie-break and, as D5r, its stand-ins read the file). Without the Source tracks it is
  // v16.8.1's plan for every other track (they no longer count toward 2178's share, D3); when too few tracks are open to
  // give every crystal with no unreadable scan one (D3b), v16.7.3's shape: each Source track an unreadable scan on 2178.
  // F7's stored-score cap aside (v16.7.1 stored the full score).
  {
    const renamed = (s: T) => { const { file, ...r } = s; void file; return { ...r, id: fk(s) } as T; };
    const srcKeys = new Set(src.map(fk));
    const rest = lib.filter((s) => !LIVE.sourceTrack(s));
    const emptyOfStays = ALL_CRYSTALS.filter((f) => !rest.some((s) => LIVE.spreadRole(s).role === 'stays' && s.closestSolfeggio === f)).length;
    const shortLib = src.length > 0 && rest.filter((s) => LIVE.spreadRole(s).role === 'open').length < emptyOfStays;
    const ren = shortLib ? lib.map((s) => (LIVE.sourceTrack(s) ? ({ id: fk(s), name: s.name, duration: s.duration, harmonicFreq: 0, closestSolfeggio: SOURCE_FREQ, harmonicDeviation: 3, crystalSource: 'scan' } as T) : renamed(s))) : rest.map(renamed);
    const capped = (r: unknown[]) => (r[3] === 'assigned' && r[0] === r[1] && (r[2] as number) > LIVE.ASSIGN_SCORE_CAP ? [r[0], r[1], LIVE.ASSIGN_SCORE_CAP, r[3]] : r);
    const want = apply(ren, spreadV1671(ren)).filter((s) => !srcKeys.has(s.id)).map((s): [string, unknown[]] => [s.id, capped(recOf(s))]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    same('v1671', byFile(a).filter(([k]) => !srcKeys.has(k)), want, `${tag}: v16.7.1 keyed by the file${shortLib ? ' (v16.7.3’s shape: too few open)' : src.length ? ' (without the Source tracks)' : ''}`);
    byV1671++;
    if (shortLib) byV1671Short++;
  }
  libs++;
  if (src.length) withSource++;
  if (stays) withStays++;
  if (kind === 'scanned') fullyScanned++;
}
ok('setup', libs >= 2000 && withSource >= 900 && withStays >= 300 && fullyScanned >= 900 && balanced >= 500 && small >= 100 && withStandIns >= 800 && byV1671Short >= 100 && moved >= 1500, `exercised: ${libs} libraries, ${withSource} with Source tracks, ${withStays} with unreadable scans that stay, ${fullyScanned} fully scanned, ${withStandIns} with stand-ins, ${balanced} balance cases, ${small} small with Source, ${byV1671} against v16.7.1 (${byV1671Short} short), ${moved} with moves`);

// ---- 3. The same file twice, and no file: the id decides, as the last resort ----------------------------------------
{
  const one = { id: '1771-a', name: 'tone-a', duration: 200, file: { name: 'tone-a.wav', size: 5000 }, ...scanRec(530.5) } as T;
  const twin = { ...one, id: '1771-b' } as T;
  const lib = [...library(77, 40, 'scanned', 0), one, twin];
  const p = planAssign(lib, 'spread');
  ok('duplicates', p.total === 42, 'the same file twice: both placed (two ids)');
  same('duplicates', planAssign([...lib].reverse(), 'spread').patches, p.patches, 'and order-free');
}

// ---- 4. needsRescan / rescanQueue (D4) -----------------------------------------------------------------------------
{
  const with48 = (s: Partial<T>) => ({ ...s, scanRate: LIVE.DEEP_SCAN_RATE });
  ok('rescan', LIVE.DEEP_SCAN_RATE === 48000, 'DEEP_SCAN_RATE is 48 kHz');
  const cases: Array<[string, Partial<T>, boolean]> = [
    ['a scan', scanRec(530.5), true],
    ['a scan read at 48 kHz', with48(scanRec(530.5)), false],
    ['a Source scan', scanRec(2180.5), true],
    ['a spread track (the reading kept)', spreadRec(530.5, 852), true],
    ['a spread track read at 48 kHz', with48(spreadRec(530.5, 852)), false],
    ['a legacy scan an older Auto-Distribute moved', replacedRec(530.5, 852), true],
    // (Fix round 1, rev-logic 4e: an unreadable scan is in the plain Deep Scan's own scope: listed there, never twice.)
    ['an unreadable scan', { harmonicFreq: 0, closestSolfeggio: 639, harmonicDeviation: 3, crystalSource: 'scan' } as Partial<T>, false],
    ["a failed scan's placeholder", { harmonicFreq: 440, closestSolfeggio: 528, harmonicDeviation: 999, crystalSource: 'scan' } as Partial<T>, false],
    ["Assign's placement", { harmonicFreq: 852, closestSolfeggio: 852, harmonicDeviation: 3, crystalSource: 'assigned' } as Partial<T>, false],
    ["an older Auto-Distribute's placeholder", { harmonicFreq: 852, closestSolfeggio: 852, harmonicDeviation: 12 } as Partial<T>, false],
    ['a new import', {}, false],
  ];
  const lib = cases.map(([what, rec], i) => ({ id: `r${i}`, name: `tone-r${i}`, ...rec, what }) as unknown as T);
  for (const s of lib) ok('rescan', LIVE.needsRescan(s) === cases[lib.indexOf(s)][2], `needsRescan: ${(s as any).what}`);
  same('rescan', LIVE.rescanQueue(lib).map((s) => s.id), lib.filter((_, i) => cases[i][2]).map((s) => s.id), 'rescanQueue: the older readings, in library order');
  ok('rescan', LIVE.rescanQueue(lib).every((s) => LIVE.readByDeepScan(s)), 'every one read by Deep Scan');
  ok('rescan', !LIVE.rescanQueue(lib).some((s) => LIVE.deepScanQueue([s]).length > 0), 'none the plain Deep Scan lists');
  // Fix round 1 (rev-logic 4d): a track Scan again couldn't read this session is skipped until a reload.
  same('rescan', LIVE.rescanQueue(lib, new Set(['r0', 'r3'])).map((s) => s.id), lib.filter((s, i) => cases[i][2] && s.id !== 'r0' && s.id !== 'r3').map((s) => s.id), 'rescanQueue: the session skip');
  same('rescan', LIVE.rescanQueue(lib, new Set()).map((s) => s.id), LIVE.rescanQueue(lib).map((s) => s.id), 'an empty skip skips nothing');
  same('rescan', [libraryHealth(lib as never).olderReadings, libraryHealth(lib as never, new Set(['r0', 'r3'])).olderReadings], [LIVE.rescanQueue(lib).length, LIVE.rescanQueue(lib).length - 2], "the health card's count follows it");
  // rescanPatch: where a track read anew sits.
  const after = (s: Partial<T>, hf: number) => ({ ...s, ...LIVE.rescanPatch(s, hf) }) as T;
  const onOwn = after(scanRec(530.5), 640.25);
  same('rescan', recOf(onOwn), [scanCrystalOf(640.25), 640.25, Math.abs(640.25 - scanCrystalOf(640.25)), 'scan'], 'a scan on its own crystal moves to the new reading\'s, the scan\'s');
  ok('rescan', scanCrystalOf(640.25) !== 528, '(the new reading is another crystal\'s)');
  const src = after(scanRec(2180.5), 530.5);
  same('rescan', [src.closestSolfeggio, src.crystalSource, LIVE.sourceTrack(src)], [528, 'scan', false], 'a Source track read elsewhere now leaves 2178 for its new crystal');
  const moved = after(spreadRec(530.5, 852), 640.25);
  same('rescan', [moved.closestSolfeggio, moved.crystalSource, moved.harmonicFreq, moved.harmonicDeviation, LIVE.spreadFromScan(moved)], [852, 'assigned', 640.25, SPREAD_MARK + Math.abs(640.25 - 852), true], 'a spread track keeps its crystal, its mark against the new reading');
  const toSource = after(spreadRec(530.5, 852), 2180.5);
  same('rescan', [toSource.closestSolfeggio, LIVE.sourceTrack(toSource), LIVE.spreadAway(toSource), libraryHealth([toSource] as never).sourceBack], [852, true, true, 1], 'a spread track that now reads 2178: a Source track away from it (the card offers it back)');
  const legacy = after(replacedRec(530.5, 852), 640.25);
  same('rescan', [legacy.closestSolfeggio, legacy.harmonicDeviation, legacy.harmonicFreq, LIVE.crystalOrigin(legacy)], [852, 7.77, 640.25, 'scan-replaced'], "a legacy scan an older Auto-Distribute moved keeps its crystal and record");
  const unreadable = after({ harmonicFreq: 0, closestSolfeggio: 639, harmonicDeviation: 3, crystalSource: 'scan' } as Partial<T>, 530.5);
  same('rescan', [unreadable.closestSolfeggio, unreadable.crystalSource], [528, 'scan'], 'an unreadable scan read now goes to its reading\'s crystal');
  // Fix round 2 (revR-tests 2): rescanReadPatch, the whole patch one Scan again read writes.
  const old = { ...scanRec(530.5), fractalAnalysis: { dominantFrequency: 530.5, old: true }, intervalAnalysis: { classification: 'older' }, bandEnvelope: { fps: 20, old: true } } as Partial<T>;
  const read = (o: Partial<LIVE.RescanRead>) => ({ ...old, ...LIVE.rescanReadPatch(old, { hf: 640.25, fractal: { dominantFrequency: 652 }, intervals: { classification: 'new' }, intervalsThrew: false, envelope: { fps: 20, fresh: true }, isAetheriaCandidate: true, ...o }) }) as Record<string, unknown>;
  const full = read({});
  same('rescan', [full.harmonicFreq, full.closestSolfeggio, full.crystalSource, full.scanRate, full.isAetheriaCandidate, full.fractalAnalysis, full.intervalAnalysis, full.bandEnvelope], [640.25, scanCrystalOf(640.25), 'scan', LIVE.DEEP_SCAN_RATE, true, { dominantFrequency: 652 }, { classification: 'new' }, { fps: 20, fresh: true }], 'rescanReadPatch: the reading, its crystal, its rate and every new field');
  same('rescan', read({ fractal: null }).fractalAnalysis, null, 'the fractal step fell back: null, as a first Deep Scan writes it (not the older one)');
  same('rescan', read({ intervals: undefined, intervalsThrew: true }).intervalAnalysis, { classification: 'older' }, 'the interval step threw: the older interval data kept');
  ok('rescan', 'intervalAnalysis' in LIVE.rescanReadPatch(old, { hf: 640.25, fractal: null, intervals: undefined, intervalsThrew: false, envelope: undefined, isAetheriaCandidate: false }) && read({ intervals: undefined }).intervalAnalysis === undefined, 'fewer than 2 peaks: none, as a first scan writes it');
  same('rescan', read({ envelope: undefined }).bandEnvelope, { fps: 20, old: true }, 'no envelope made: the older one kept');
  same('rescan', [read({}).harmonicDeviation, (({ ...LIVE.rescanReadPatch(spreadRec(530.5, 852), { hf: 640.25, fractal: null, intervals: undefined, intervalsThrew: false, envelope: undefined, isAetheriaCandidate: false }) }) as Record<string, unknown>).closestSolfeggio], [Math.abs(640.25 - scanCrystalOf(640.25)), undefined], 'where the track sits is rescanPatch\'s (a spread track keeps its crystal)');
}

Math.random = realRandom;
console.log = realLog;
if (COLLECT) {
  console.log(`devices.check --collect: ${checks} checks, failures by kind ${JSON.stringify(failures)}`);
  for (const [k, m] of Object.entries(firstFailure)) console.log(`  first ${k}: ${m.slice(0, 400)}`);
  process.exit(Object.keys(failures).length ? 1 : 0);
}
console.log(`devices.check: ${checks} checks passed (${libs} libraries: ${withSource} with Source tracks, ${withStays} with unreadable scans that stay, ${fullyScanned} fully scanned, ${balanced} balance cases, ${small} small with Source, ${withStandIns} with stand-ins (${standIns} unmeasured tracks, every one with a fresh id on the second device), ${byV1671} against v16.7.1 keyed by the file (${byV1671Short} short), ${moved} where a press moves crystals)`);
