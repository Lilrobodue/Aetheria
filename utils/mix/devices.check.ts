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
// v16.8.2 ("Key placement"): two libraries in three carry key data (synthetic chroma arrays with a key, a confidence and
// an A4; some unclear, some by another analyser, some too long or too large for the phone), planned as the app plans them
// (App's BandCache's planOptions, the bands warmed first). The second device holds the same key data (properties (a));
// its lengths stay on the same side of 720 s (a length either side of it is the same residual case as the stand-in's
// thresholds: the plan waits while lengths are read, and both devices' probes agree within 0.05 s, measure/results.md).
// The oracle places by the key band too. Then: (b) a track over 720 s or 100 MiB gives the same crystals with or without
// key data; (c) key data of another chromaVersion reads as none; (d) a keyless library (and every library with its keys
// stripped) gets v16.8.1's plan and words exactly (scripts/mix-golden/spread-v1681.ts, v16.8.1's own code, its sha256
// pinned and its sections compared with git); (e) the Source tracks stay on 2178 and the fill's counts are the same
// multiset as without keys. Section 2b (v16.7.1 keyed by the file) runs on the libraries with their keys stripped. 2c:
// on "general" libraries of 270 (every track a clear key), at least 55 % of the keyed tracks land on a crystal whose
// tone fits their key (band 0), against at most 30 % with the bands off.
// v16.8.3 ("Track Tuning", M1: Assign follows the tuning), section 2g: libraries with key data and a share of their
// clear-key tracks tuned (some by Track info's own fitShift for their crystal, some Lo Shu, A1). (f) No tuning anywhere
// (garbage tuning fields included) gives v16.8.2's plan patch for patch: today's cache against v16.8.2's provider
// restated (keyRanks of bandsOf), and distribution.ts is v16.8.2's file (its sha256, pinned); (g) the same tunings on a
// second device give the same crystals; (h) the oracle, restating the per-track factor, places every tuned library as the
// code does; (i) a retune changes only that track's content key's bands; (j) Assign never writes or clears a tuning; (k)
// A1: tuneLoShu never changes a plan (Perfect GUT is a per-device setting the planner never reads), so a device with it on
// and one with it off give the same crystals; (l) the tunings matter (some libraries plan otherwise without them).
//
//   node utils/mix/devices.check.ts                     the working tree
//   node utils/mix/devices.check.ts --collect           failures counted by kind instead of stopping at the first
//                                                       (a negative control: run with a resolve hook that hands this
//                                                       file another release's planAssign; 9541b9d's must fail)
// Synthetic tones and chroma only ("tone-…"); a seeded generator, never Math.random.
import { strict as assert } from 'node:assert';
import * as LIVE from './distribution.ts';
import type { AssignPlan, AssignSong } from './distribution.ts';
import { SOURCE_FREQ } from '../crystalData.ts';
import { patchById } from '../library/listOps.ts';
import { fpKey } from '../playlists/model.ts';
import { libraryHealth } from '../../components/shell/library/libraryModel.ts';
import { oracleRole, spreadOracle } from '../../scripts/mix-golden/spread-oracle.ts';
import { spreadV1671 } from '../../scripts/mix-golden/spread-v1671.ts';
import { spreadV1681, wordsV1681 } from '../../scripts/mix-golden/spread-v1681.ts';
import { BandCache, KEY_MAX_BYTES, KEY_MAX_SECONDS, awaitingKey, bandsOf, clearKey, contentKey } from './keyBands.ts';
import { LO_SHU_CRYSTALS, fitShift, solfeggioTone, validTuning } from '../tuning/trackTuning.ts';
import { musicFit, toneOf, smoothstep } from '../soundV2/aetheria_sound_v2.ts';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore: the harness's fixture is plain .mjs (no types)
import { mulberry32 } from '../../scripts/mix-golden/fixture.mjs';

const COLLECT = process.argv.includes('--collect');
/** fix round 1: print §2d's table (band-0 share, mean duck, worse than v16.8.1) for NEUTRAL 1.5, 0.5 without R1
 *  (bec9f23) and 0.5 with R1 (fix round 2: a track that fits nowhere ranks 0.25 on its best crystals), and the
 *  fit-nowhere tracks' own band 3 share and duck. */
const TABLE = process.argv.includes('--table');
/** v16.8.2: scripts/mix-golden/spread-v1681.ts as reviewed (sha256 of its LF text). */
const FROZEN_V1681_SHA = 'dcb453f49ef2b2b72f386ada6f1877aabc5108df3c3dc9adb1178c23da2a248c';
/** v16.8.2: the commit whose utils/mix/distribution.ts the frozen v16.8.1 copy's sections are compared with: v16.8.1 as it
 *  shipped. The one place it is named: e428022, v16.8.1 on main (220fa83's tree, the tip of v16.8.1-devices, squashed
 *  onto 9541b9d; `git diff 220fa83 e428022` is empty, so its distribution.ts is the same file). */
const FROZEN_V1681_REF = 'e428022';
/** v16.8.3: utils/mix/distribution.ts at 862d960 (v16.8.2), sha256 of its LF text: M1 changes nothing in the planner
 *  (the spread reads each track's own bands), so the file must stay v16.8.2's. */
const DISTRIBUTION_V1682_SHA = 'e81d532276e7826acc855901b2e65b39fba0e0eff572abce845d6629b60b8c00';
/** fix round 1 (§2d), measured on these fixtures (the report has the table) and set with a margin: the keyed open
 *  tracks on a fitting crystal at least, on a worse band than v16.8.1 at most (%). */
// Measured: 10 % keyed 95.9 % fit, 0.0 % worse (NEUTRAL 1.5 gave 51.9 % and 3.2 %); 30 % keyed 88.1 % and 1.5 % (62.2 %, 2.5 %).
// Fix round 2 (R1) re-measured: 10 % keyed 95.9 % fit, 0.0 % worse; 30 % keyed 88.2 % and 0.8 % (bec9f23: 88.1 %, 1.5 %). The bars stand.
const ARRIVING_FITS_10 = 90, ARRIVING_WORSE_10 = 1, ARRIVING_FITS_30 = 82, ARRIVING_WORSE_30 = 3;
/** Fix round 2 (R1): 54-track libraries at 30 % and 60 % keyed, the keyed tracks that fit no crystal (no band 0): on
 *  band 3 at most (%), their mean duck at most (dB). Measured with a margin (`--table` prints before and after R1):
 *  30 %: 43 such tracks, 0.0 % on band 3, 1.20 dB (bec9f23: 25.6 %, 3.50 dB); 60 %: 73, 1.4 %, 1.45 dB (6.8 %, 2.14 dB). */
const NOWHERE_BAND3_MAX = 5, NOWHERE_DUCK_MAX = 2;
const { ALL_CRYSTALS, SPREAD_MARK, scanCrystalOf, planAssign, keyRanks, FIT_NOWHERE_BAND } = LIVE;

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
let tuningSeen = '';
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
// ---- v16.8.2: key data (synthetic chroma, never a recording's) ------------------------------------------------------
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
/** 96 key readings, as Analyse tracks stores them: a key's idealised weights (tonic 3, fifth 2.5, third 2, the other scale
 *  notes 1, the rest 0.15) with noise, at 4 dp, every tonic, a third of them minor; the A4 mostly near 440 (2 dp), some
 *  at 432, 436.5 or 445. */
const KEY_POOL = Array.from({ length: 96 }, (_, i) => {
  const r = mulberry32(64000 + i);
  const tonic = Math.floor(r() * 12), minor = r() < 0.35;
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const w = new Array(12).fill(0.15);
  scale.forEach((d, j) => { w[(tonic + d) % 12] = j === 0 ? 3 : j === 4 ? 2.5 : j === 2 ? 2 : 1; });
  const noisy = w.map((v) => v * (0.6 + 0.8 * r()));
  const sum = noisy.reduce((a, b) => a + b, 0);
  const a4 = r() < 0.8 ? round(438.5 + r() * 3, 2) : [432, 436.5, 445][Math.floor(r() * 3)];
  return { chroma: noisy.map((v) => round(v / sum, 4)), chromaA4Hz: a4, musicKey: KEY_NAMES[tonic] + (minor ? 'm' : '') };
});
const KEY_FIELDS = ['chroma', 'chromaA4Hz', 'musicKey', 'keyConfidence', 'chromaVersion'];
/** The library with key data (its own generator, so the tracks are the same as without): with `all`, a clear key on
 *  every track; otherwise most tracks, some unclear (confidence under 0.45), some analysed with nothing found, some
 *  by another analyser (chromaVersion 0), some too long (over 720 s) or too large (over 100 MiB) for the phone, and a
 *  fifth never analysed. */
function withKeys(lib: readonly T[], seed: number, o: { all?: boolean; share?: number } = {}): T[] {
  const r = mulberry32(73000 + seed);
  return lib.map((s, i) => {
    // (fix round 1, §2d: keys still arriving, `share` of the tracks with a clear key, the rest never analysed.)
    if (o.share !== undefined) {
      if (r() >= o.share) return s;
      const q = KEY_POOL[Math.floor(r() * KEY_POOL.length)];
      return { ...s, chroma: [...q.chroma], chromaA4Hz: q.chromaA4Hz, musicKey: q.musicKey, keyConfidence: round(0.46 + r() * 0.5, 3), chromaVersion: 1 } as T;
    }
    if (!o.all && r() < 0.2) return s;
    const p = KEY_POOL[Math.floor(r() * KEY_POOL.length)];
    const u = r();
    const k: Record<string, unknown> = { chroma: [...p.chroma], chromaA4Hz: p.chromaA4Hz, musicKey: p.musicKey, keyConfidence: round(0.46 + r() * 0.5, 3), chromaVersion: 1 };
    if (!o.all) {
      if (u < 0.1) k.keyConfidence = round(0.2 + r() * 0.249, 3);
      else if (u < 0.15) return { ...s, chromaVersion: 1 } as T;
      else if (u < 0.22) k.chromaVersion = 0;
      else if (u < 0.27) return { ...s, ...k, duration: KEY_MAX_SECONDS + 1 + Math.floor(r() * 1080) } as T;
      else if (u < 0.31) return { ...s, ...k, file: { ...(s.file as object), size: KEY_MAX_BYTES + 1 + i } } as T;
    }
    return { ...s, ...k } as T;
  });
}
const stripKeys = (s: T): T => { const c = { ...s } as Record<string, unknown>; for (const f of KEY_FIELDS) delete c[f]; return c as T; };
const hasKeyFields = (s: T) => Array.isArray(s.chroma);
const tooBig = (s: T) => !(typeof s.duration === 'number' && s.duration > 0 && s.duration <= KEY_MAX_SECONDS) || !(((s.file as { size?: number } | undefined)?.size ?? Infinity) <= KEY_MAX_BYTES);
/** App's one cache, and the options every spread is planned with (its bands, warmed first: ensureSync). */
const CACHE = new BandCache();
const OPTS = CACHE.planOptions;
const plan = (l: readonly T[]) => { CACHE.ensureSync(l as never); return planAssign(l, 'spread', OPTS); };
/** A plan's counts without v16.8.2's own (v16.8.1 has none of them). */
const countsV1681 = (p: AssignPlan) => { const { patches, keyed, keyFits, noKey, awaitingKey, hadCrystal, hadCrystalMoves, ...rest } = p; void patches; void keyed; void keyFits; void noKey; void awaitingKey; void hadCrystal; void hadCrystalMoves; return rest; };
const sortedPatches = (p: AssignPlan) => [...p.patches.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

/** An unmeasured open track: the spread scores it from its stand-in (D5r: seeded by the file key). */
const standInRead = (s: T) => LIVE.spreadRole(s).role === 'open' && !LIVE.readByDeepScan(s);
/** standInFreq's length band: under 120 s, 120 to 300 s (an unknown length counts as 180 s), over 300 s. */
const band = (d: number | undefined) => { const x = d || 180; return x > 300 ? 2 : x < 120 ? 0 : 1; };
/** The same files and readings on another device: fresh ids for every track (made at import, per device), another
 *  order (seeded), and other lengths (fix round 2, revR-tests): any for a measured track (the spread doesn't read it),
 *  and within the same stand-in band for an unmeasured one (an unknown length included: the residual case aside). */
/** v16.8.2: where a length sits for key placement: unknown (0), known and within the phone's 720 s (1), over it (2). */
const keyClass = (d: number | undefined) => (typeof d === 'number' && Number.isFinite(d) && d > 0 ? (d <= KEY_MAX_SECONDS ? 1 : 2) : 0);
function secondDevice(lib: readonly T[], seed: number): T[] {
  const rnd = mulberry32(57000 + seed);
  // v16.8.2: every length stays in its key class (an unknown one unknown), a stand-in's in its band too.
  const lengthIn = (b: number, k: number) => (b === 0 ? 1 + Math.floor(rnd() * 119) : b === 1 ? 120 + Math.floor(rnd() * 181) : k === 1 ? 301 + Math.floor(rnd() * 420) : 721 + Math.floor(rnd() * 1080));
  const anyIn = (k: number) => (k === 1 ? 1 + Math.floor(rnd() * 720) : 721 + Math.floor(rnd() * 1080));
  const out = lib.map((s) => {
    const k = keyClass(s.duration);
    return {
      ...s,
      id: `${1790000000000 + Math.floor(rnd() * 1e9)}-${Math.floor(rnd() * 36 ** 8).toString(36)}`,
      duration: k === 0 ? (rnd() < 0.5 ? 0 : undefined) : standInRead(s) ? lengthIn(band(s.duration), k) : anyIn(k),
    };
  });
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

// ---- 1b. The frozen v16.8.1 copy is v16.8.1's own code (FROZEN_V1681_REF) ---------------------------------------
{
  const file = fileURLToPath(new URL('../../scripts/mix-golden/spread-v1681.ts', import.meta.url));
  const frozen = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  same('v1681', createHash('sha256').update(frozen).digest('hex'), FROZEN_V1681_SHA, 'the frozen v16.8.1 copy: its pinned sha256 (LF)');
  const sections = [...frozen.matchAll(/^\/\/ ---- lines (\d+)-(\d+) ----\n([\s\S]*?)(?=\n\/\/ ---- |\n\/\*\* v16\.8\.1's planAssign)/gm)];
  same('v1681', sections.map((m) => `${m[1]}-${m[2]}`), ['72-72', '226-230', '272-289', '476-480', '615-776', '779-779', '792-799', '818-829', '875-913', '915-938'], 'the frozen v16.8.1 copy: its ten marked sections');
  let git: string | null = null;
  try { git = execFileSync('git', ['show', `${FROZEN_V1681_REF}:utils/mix/distribution.ts`], { cwd: dirname(file), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { git = null; }
  if (git) {
    const lines = git.replace(/\r\n/g, '\n').split('\n');
    for (const m of sections) same('v1681', m[3].replace(/\n+$/, ''), lines.slice(Number(m[1]) - 1, Number(m[2])).join('\n'), `frozen v16.8.1 lines ${m[1]}-${m[2]}: ${FROZEN_V1681_REF}'s, byte for byte`);
  } else realLog(`devices.check: WARNING: git cannot read ${FROZEN_V1681_REF} here, so the frozen v16.8.1 sections are NOT compared with git (the sha256 pin holds the file as reviewed)`);
}

// ---- 2. Two devices, the same files: the same crystals ------------------------------------------------------------
const SIZES = [0, 1, 2, 3, 5, 8, 13, 20, 26, 27, 28, 30, 40, 53, 54, 55, 81, 100, 160, 270];
const KINDS: Kind[] = ['scanned', 'scanned', 'partly', 'stays', 'unscanned'];
const RATES = [0, 0, 0.03, 0.08, 0.2, 0.6];
let libs = 0, withSource = 0, withStays = 0, fullyScanned = 0, withStandIns = 0, standIns = 0, balanced = 0, small = 0, byV1671 = 0, byV1671Short = 0, moved = 0;
let keyedLibs = 0, keyedTracks = 0, keyFitTracks = 0, keyMoved = 0, overCapLibs = 0, otherVersionLibs = 0, byV1681 = 0;
let staysWaiting = 0; // (fix round 2, R22: libraries where an unreadable scan that stays waits for a key)
const runs: Array<[number, number, Kind, number]> = [];
for (let seed = 0; seed < 2400; seed++) runs.push([seed, SIZES[seed % SIZES.length], KINDS[seed % KINDS.length], RATES[Math.floor(seed / SIZES.length) % RATES.length]]);
for (const [seed, size, kind, rate] of [...runs, [9001, 600, 'scanned', 0.02] as const, [9002, 1000, 'partly', 0.01] as const, [9003, 1000, 'scanned', 0.05] as const]) {
  // v16.8.2: two in three with key data (their tracks otherwise the same as without).
  const keyedLib = seed % 3 !== 0;
  const lib = keyedLib ? withKeys(library(seed, size, kind as Kind, rate), seed) : library(seed, size, kind as Kind, rate);
  const tag = `#${seed} (${size} ${kind}, Source ${rate}${keyedLib ? ', keys' : ''})`;
  const keys = new Set(lib.map(fk));
  ok('setup', keys.size === lib.length, `${tag}: every file key unique`);
  const pA = plan(lib);
  const a = apply(lib, pA);
  // (a) The second device holds the same key data: the same crystals.
  const lib2 = secondDevice(lib, seed);
  const pB = plan(lib2);
  const b = apply(lib2, pB);
  // The user's goal: every track's record, matched by its file, identical on both devices.
  same('devices', byFile(b), byFile(a), `${tag}: the second device, the same files: the same records`);
  same('devices', counts(pB), counts(pA), `${tag}: the second device: the same counts`);
  standIns += lib.filter(standInRead).length;
  if (lib.some(standInRead)) withStandIns++;
  // The independent oracle (D2, D3, D3b; v16.8.2: the key band), on the first device.
  const o = spreadOracle(lib as never);
  const why = a.filter((s) => JSON.stringify(recOf(s)) !== JSON.stringify(o.after.get(s.id))).map((s) => s.id);
  same('oracle', why, [], `${tag}: every track as the oracle places it`);
  same('oracle', [pA.perCrystal, pA.emptyAfter, pA.open, pA.source, pA.keyed, pA.keyFits], [o.perCrystal, o.emptyAfter, o.open, [...o.role.values()].filter((r) => r === 'source').length, o.keyed, o.keyFits], `${tag}: the oracle's counts`);
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
  const again = plan(a);
  ok('idempotent', again.patches.size === 0, `${tag}: a second press writes nothing`);
  // D8: the press's moves are the tracks whose crystal changes (counted from the libraries), and after it none: the
  // health card's optional Assign hides after one press.
  const before = new Map(lib.map((s) => [s.id, s.closestSolfeggio ?? null]));
  same('d8', LIVE.crystalMoves(pA), a.filter((s) => (s.closestSolfeggio ?? null) !== before.get(s.id)).length, `${tag}: crystalMoves counts the crystals that change`);
  same('d8', LIVE.crystalMoves(again), 0, `${tag}: after the press, nothing to move`);
  if (LIVE.crystalMoves(pA) > 0) moved++;
  // v16.8.2: the library with its keys stripped (every key field gone): keyless, so (d) v16.8.1's plan and words, and
  // section 2b reads it.
  const bare = keyedLib ? lib.map(stripKeys) : lib;
  const pBare = plan(bare);
  const aBare = apply(bare, pBare);
  {
    const old = spreadV1681(bare);
    same('v1681', sortedPatches(pBare), sortedPatches(old), `${tag}${keyedLib ? ', keys stripped' : ''}: (d) v16.8.1's patches`);
    same('v1681', countsV1681(pBare), countsV1681(old), `${tag}: (d) v16.8.1's counts`);
    same('v1681', [pBare.keyed, pBare.keyFits, pBare.noKey], [0, 0, pBare.open], `${tag}: (d) no track placed by key`);
    // (fix round 1, B1: the confirmation's count and the Crystals sub-line's are the same, from the same function.)
    same('words', pA.awaitingKey, libraryHealth(lib as never).awaitingKey, `${tag}: the plan's awaitingKey = the health card's`);
    // (Fix round 2, R22: and both equal a count made here, by the oracle's own roles: an open track only, never a Source
    // track nor an unreadable scan that stays.)
    { const seen = new Set<string>(); let n = 0; for (const x of lib) { if (seen.has(x.id)) continue; seen.add(x.id); if (oracleRole(x as never) === 'open' && awaitingKey(x as never)) n++; } same('words', pA.awaitingKey, n, `${tag}: awaitingKey counts the open tracks only (the oracle's roles)`); if (lib.some((x) => oracleRole(x as never) === 'stays' && awaitingKey(x as never))) staysWaiting++; }
    const w = wordsV1681(old);
    same('v1681', [LIVE.assignConfirmText(pBare).body, LIVE.assignDoneText(pBare), LIVE.assignNothingText(pBare), LIVE.assignNeedsConfirm(pBare)], [w.confirm, w.done, w.nothing, w.needsConfirm], `${tag}: (d) v16.8.1's words (awaitingKey ${pBare.awaitingKey})`);
    byV1681++;
  }
  if (keyedLib) {
    keyedLibs++;
    keyedTracks += pA.keyed ?? 0;
    keyFitTracks += pA.keyFits ?? 0;
    if (JSON.stringify(byFile(a)) !== JSON.stringify(byFile(aBare))) keyMoved++;
    // (b) A track the phone can't analyse (over 720 s or 100 MiB) is placed the same with or without its key data.
    if (lib.some((x) => hasKeyFields(x) && tooBig(x))) {
      const pb = plan(lib.map((x) => (hasKeyFields(x) && tooBig(x) ? stripKeys(x) : x)));
      same('caps', sortedPatches(pb), sortedPatches(pA), `${tag}: (b) over 720 s or 100 MiB: the same crystals without its key data`);
      same('caps', counts(pb), counts(pA), `${tag}: (b) and the same counts`);
      overCapLibs++;
    }
    // (c) Key data of another chromaVersion reads as none.
    if (lib.some((x) => hasKeyFields(x) && x.chromaVersion !== 1)) {
      const pc = plan(lib.map((x) => (hasKeyFields(x) && x.chromaVersion !== 1 ? ({ ...stripKeys(x), chromaVersion: x.chromaVersion } as T) : x)));
      same('version', sortedPatches(pc), sortedPatches(pA), `${tag}: (c) another chromaVersion: as with no key data`);
      same('version', counts(pc), counts(pA), `${tag}: (c) and the same counts`);
      otherVersionLibs++;
    }
    // (e) The Source tracks stay on 2178 (checked above, with keys), and the fill (Source tracks aside) is the same
    // multiset of counts as without keys.
    const srcN = lib.filter((x) => LIVE.sourceTrack(x)).length;
    const fillOf = (pc: number[]) => pc.map((n, i) => n - (i === AT ? srcN : 0)).sort((x, y) => x - y);
    same('multiset', fillOf(pA.perCrystal), fillOf(pBare.perCrystal), `${tag}: (e) the fill's counts, the same multiset as without keys`);
  }
  // 2b. The frozen v16.7.1 spread (scripts/mix-golden/spread-v1671.ts, 666132c's own code) keyed by the file: each id
  // renamed to its file key (so its tie-break and, as D5r, its stand-ins read the file). Without the Source tracks it is
  // v16.8.1's plan for every other track (they no longer count toward 2178's share, D3); when too few tracks are open to
  // give every crystal with no unreadable scan one (D3b), v16.7.3's shape: each Source track an unreadable scan on 2178.
  // F7's stored-score cap aside (v16.7.1 stored the full score). v16.8.2: on the library with its keys stripped.
  {
    const renamed = (s: T) => { const { file, ...r } = s; void file; return { ...r, id: fk(s) } as T; };
    const srcKeys = new Set(src.map(fk));
    const rest = bare.filter((s) => !LIVE.sourceTrack(s));
    const emptyOfStays = ALL_CRYSTALS.filter((f) => !rest.some((s) => LIVE.spreadRole(s).role === 'stays' && s.closestSolfeggio === f)).length;
    const shortLib = src.length > 0 && rest.filter((s) => LIVE.spreadRole(s).role === 'open').length < emptyOfStays;
    const ren = shortLib ? bare.map((s) => (LIVE.sourceTrack(s) ? ({ id: fk(s), name: s.name, duration: s.duration, harmonicFreq: 0, closestSolfeggio: SOURCE_FREQ, harmonicDeviation: 3, crystalSource: 'scan' } as T) : renamed(s))) : rest.map(renamed);
    const capped = (r: unknown[]) => (r[3] === 'assigned' && r[0] === r[1] && (r[2] as number) > LIVE.ASSIGN_SCORE_CAP ? [r[0], r[1], LIVE.ASSIGN_SCORE_CAP, r[3]] : r);
    const want = apply(ren, spreadV1671(ren)).filter((s) => !srcKeys.has(s.id)).map((s): [string, unknown[]] => [s.id, capped(recOf(s))]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    same('v1671', byFile(aBare).filter(([k]) => !srcKeys.has(k)), want, `${tag}: v16.7.1 keyed by the file${shortLib ? ' (v16.7.3’s shape: too few open)' : src.length ? ' (without the Source tracks)' : ''}`);
    byV1671++;
    if (shortLib) byV1671Short++;
  }
  libs++;
  if (src.length) withSource++;
  if (stays) withStays++;
  if (kind === 'scanned') fullyScanned++;
}
ok('setup', libs >= 2000 && withSource >= 900 && withStays >= 300 && fullyScanned >= 900 && balanced >= 500 && small >= 100 && withStandIns >= 800 && byV1671Short >= 100 && moved >= 1500, `exercised: ${libs} libraries, ${withSource} with Source tracks, ${withStays} with unreadable scans that stay, ${fullyScanned} fully scanned, ${withStandIns} with stand-ins, ${balanced} balance cases, ${small} small with Source, ${byV1671} against v16.7.1 (${byV1671Short} short), ${moved} with moves`);
ok('setup', keyedLibs >= 1500 && keyedTracks >= 30000 && keyMoved >= 1000 && overCapLibs >= 800 && otherVersionLibs >= 800 && byV1681 === libs, `v16.8.2 exercised: ${keyedLibs} libraries with keys (${keyedTracks} tracks placed by key, ${keyFitTracks} on a fitting crystal; ${keyMoved} where the keys move a crystal), ${overCapLibs} with tracks over the caps, ${otherVersionLibs} with another chromaVersion, ${byV1681} against v16.8.1`);

// ---- 2c. The fit: most keyed tracks land on a crystal whose tone fits their key ---------------------------------
const fit = { keyed: 0, on: 0, off: 0 };
for (let seed = 0; seed < 8; seed++) {
  const lib = withKeys(library(5000 + seed, 270, 'scanned', 0.02), 5000 + seed, { all: true });
  const pOn = plan(lib);
  const off = apply(lib, planAssign(lib, 'spread'));
  fit.keyed += pOn.keyed ?? 0;
  fit.on += pOn.keyFits ?? 0;
  for (const x of off) { if (LIVE.spreadRole(lib.find((y) => y.id === x.id)!).role !== 'open') continue; const b = CACHE.get(x as never); if (b && b[ALL_CRYSTALS.indexOf(x.closestSolfeggio as number)] === 0) fit.off++; } // (fix round 1, T-nit 2: the open keyed tracks only)
}
ok('fit', fit.keyed >= 2000 && fit.on / fit.keyed >= 0.55 && fit.off / fit.keyed <= 0.3, `2c: ${fit.keyed} keyed tracks: ${(100 * fit.on / fit.keyed).toFixed(1)} % on a fitting crystal with the bands (>= 55 %), ${(100 * fit.off / fit.keyed).toFixed(1)} % without (<= 30 %)`);

ok('words', staysWaiting >= 50, `R22: ${staysWaiting} libraries hold an unreadable scan that stays and waits for a key (none counted)`);

// ---- 2g. v16.8.3 (Track Tuning, M1): Assign follows the tuning ---------------------------------------------------
{
  const distText = readFileSync(new URL('./distribution.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  same('tuning', createHash('sha256').update(distText).digest('hex'), DISTRIBUTION_V1682_SHA, '(f) distribution.ts is v16.8.2\'s file (M1 changes only the bands)');
  /** v16.8.2's band provider, restated (its BandCache.ranks): keyRanks of bandsOf for a clear-key track. */
  const v1682Memo = new Map<string, ArrayLike<number>>();
  const v1682Ranks = (x: T) => { const k = `${x.chromaA4Hz}|${(x.chroma as number[]).join(',')}`; let r = v1682Memo.get(k); if (!r) v1682Memo.set(k, (r = keyRanks(bandsOf(x.chroma as number[], x.chromaA4Hz as number)))); return r; };
  const v1682Opts = { bands: (x: T) => (clearKey(x as never) ? v1682Ranks(x) : null), awaiting: OPTS.awaiting };
  const shiftMemo = new Map<string, number | null>();
  const shiftFor = (x: T, f: number) => { const k = `${x.chromaA4Hz}|${(x.chroma as number[]).join(',')}|${f}`; if (!shiftMemo.has(k)) shiftMemo.set(k, fitShift(x.chroma, x.chromaA4Hz, solfeggioTone(f))); return shiftMemo.get(k)!; };
  /** A share of the clear-key tracks tuned: the first one in a library by Track info's own fitShift for its crystal (when
   *  that gives a shift), the rest any whole cents in ±50 for their crystal or another; some A1 Lo Shu ones; some garbage
   *  (Standard). */
  let fitUsed = false;
  const tune = (lib: readonly T[], seed: number, share: number): T[] => {
    fitUsed = false;
    const r = mulberry32(81000 + seed);
    let first = true;
    return lib.map((x) => {
      if (!clearKey(x as never) || r() >= share) return x;
      const own = x.closestSolfeggio && ALL_CRYSTALS.includes(x.closestSolfeggio) ? x.closestSolfeggio : ALL_CRYSTALS[Math.floor(r() * 27)];
      let cents = 0;
      if (first) { first = false; const sh = shiftFor(x, own); if (sh) { cents = sh; fitUsed = true; } }
      if (!cents) { cents = Math.floor(r() * 101) - 50; if (cents === 0) cents = 7; }
      const u = r();
      if (u < 0.1) return { ...x, tuneCents: 51, tuneFor: own } as T; // garbage: Standard
      if (u < 0.25) { const f = LO_SHU_CRYSTALS[Math.floor(r() * 6)]; return { ...x, tuneCents: cents, tuneFor: f, tuneLoShu: true } as T; }
      return { ...x, tuneCents: cents, tuneFor: r() < 0.7 ? own : ALL_CRYSTALS[Math.floor(r() * 27)] } as T;
    });
  };
  const strip = (x: T, f: string[]) => { const c = { ...x } as Record<string, unknown>; for (const k of f) delete c[k]; return c as T; };
  const TUNE_FIELDS = ['tuneCents', 'tuneFor', 'tuneLoShu'];
  const garbage = (lib: readonly T[], seed: number) => { const r = mulberry32(82000 + seed); return lib.map((x) => (r() < 0.3 ? ({ ...x, ...[{ tuneCents: 0, tuneFor: 963 }, { tuneCents: 2.5, tuneFor: 528 }, { tuneCents: 12, tuneFor: 1000 }, { tuneCents: 12 }, { tuneFor: 963 }][Math.floor(r() * 5)] } as T) : x)); };
  let tunedLibs = 0, tunedTracks = 0, tuningMoved = 0, retunes = 0, loShuLibs = 0, fitLibs = 0;
  const TSIZES = [20, 27, 54, 100, 270];
  for (let seed = 0; seed < 240; seed++) {
    const size = TSIZES[seed % TSIZES.length];
    const kind = (['scanned', 'partly', 'unscanned', 'stays'] as Kind[])[seed % 4];
    const base = withKeys(library(7000 + seed, size, kind, [0, 0.03][seed % 2]), 7000 + seed, { all: seed % 3 === 0 });
    const tag = `2g #${seed} (${size} ${kind})`;
    // (f) no tuning anywhere, and garbage tuning fields: v16.8.2's plan, patch for patch.
    for (const [what, l] of [['no tuning', base], ['garbage tunings', garbage(base, seed)]] as const) {
      const now = plan(l);
      const old = planAssign(l, 'spread', v1682Opts as never);
      same('tuning', sortedPatches(now), sortedPatches(old), `${tag}: (f) ${what}: v16.8.2's patches`);
      same('tuning', counts(now), counts(old), `${tag}: (f) ${what}: v16.8.2's counts`);
      ok('tuning', l.every((x) => !clearKey(x as never) || contentKey(x as never).split('|').length === 3), `${tag}: (f) ${what}: every content key v16.8.2's`);
    }
    const lib = tune(base, seed, 0.25);
    const tuned = lib.filter((x) => validTuning(x as never) !== null);
    if (!tuned.length) continue;
    tunedLibs++;
    tunedTracks += tuned.length;
    if (lib.some((x) => (x as Record<string, unknown>).tuneLoShu === true)) loShuLibs++;
    const pA = plan(lib);
    const a = apply(lib, pA);
    // (g) a second device with the same files and the same tunings.
    const lib2 = secondDevice(lib, 7000 + seed);
    const b = apply(lib2, plan(lib2));
    same('tuning', byFile(b), byFile(a), `${tag}: (g) the same tunings on a second device: the same records`);
    // (h) the oracle, the per-track factor restated.
    const o = spreadOracle(lib as never);
    same('tuning', a.filter((x) => JSON.stringify(recOf(x)) !== JSON.stringify(o.after.get(x.id))).map((x) => x.id), [], `${tag}: (h) every track as the oracle places it, with tunings`);
    same('tuning', [pA.perCrystal, pA.keyed, pA.keyFits], [o.perCrystal, o.keyed, o.keyFits], `${tag}: (h) the oracle's counts`);
    // (j) Assign never writes or clears a tuning.
    ok('tuning', [...pA.patches.values()].every((x) => !Object.keys(x).some((k) => k.startsWith('tune'))), `${tag}: (j) no patch carries a tuning field`);
    same('tuning', a.map((x) => [x.id, (x as Record<string, unknown>).tuneCents, (x as Record<string, unknown>).tuneFor, (x as Record<string, unknown>).tuneLoShu]), lib.map((x) => [x.id, (x as Record<string, unknown>).tuneCents, (x as Record<string, unknown>).tuneFor, (x as Record<string, unknown>).tuneLoShu]), `${tag}: (j) every tuning survives the apply`);
    // (k) A1: tuneLoShu never changes the plan.
    const noLo = lib.map((x) => strip(x, ['tuneLoShu']));
    same('tuning', sortedPatches(plan(noLo)), sortedPatches(pA), `${tag}: (k) tuneLoShu never changes the plan (Perfect GUT on or off)`);
    // (l) the tunings matter, and (i) a retune changes only that track's key.
    const bare = lib.map((x) => strip(x, TUNE_FIELDS));
    if (JSON.stringify(byFile(apply(bare, plan(bare)))) !== JSON.stringify(byFile(a))) tuningMoved++;
    if (seed % 4 === 0) {
      // (A copy of the run's cache, the library's bands made already: a fresh cache would make them all again.)
      const cache = new BandCache();
      for (const [key, v] of CACHE.map) cache.map.set(key, v);
      cache.ensureSync(lib as never);
      const before = new Map([...cache.map]);
      // (A Standard clear-key track whose tuned key isn't cached yet: none of the run's libraries has made it.)
      const rc = 1 + (seed % 49);
      const k = lib.findIndex((x) => clearKey(x as never) && validTuning(x as never) === null && !cache.map.has(contentKey({ ...x, tuneCents: rc, tuneFor: 963 } as never)));
      if (k >= 0) {
        const re = lib.map((x, i) => (i === k ? ({ ...x, tuneCents: rc, tuneFor: 963 } as T) : x));
        same('tuning', cache.ensureSync(re as never), 1, `${tag}: (i) a retune makes one content key`);
        ok('tuning', [...before].every(([key, v]) => cache.map.get(key) === v), `${tag}: (i) every other entry the same object`);
        same('tuning', [...cache.map.keys()].filter((key) => !before.has(key)), [contentKey(re[k] as never)], `${tag}: (i) the new key is the retuned track's`);
        retunes++;
      }
    }
    if (fitUsed) fitLibs++;
  }
  ok('tuning', tunedLibs >= 150 && tunedTracks >= 2000 && tuningMoved >= 50 && retunes >= 40 && loShuLibs >= 60 && fitLibs >= 50, `2g exercised: ${tunedLibs} tuned libraries (${tunedTracks} tuned tracks; ${loShuLibs} with Lo Shu ones; ${fitLibs} with a Track info fit), ${tuningMoved} where the tunings move a crystal, ${retunes} retunes`);
  tuningSeen = `${tunedLibs} tuned libraries, ${tunedTracks} tuned tracks, ${tuningMoved} moved by their tunings, ${retunes} retunes`;
}

// ---- 2d. Keys still arriving (fix round 1, L-S1): a fitting crystal first, then no key, then a partly fitting one ---
// NEUTRAL_BAND (0.5) sits between "fits" (0) and "partly fits" (1). pK, the smallest case: one keyed track among 26
// keyless ones, its band 1 on 174 Hz (SPREAD_ORDER's first) and 0 on 2907 Hz; every crystal is empty when the fill
// starts. With 1.5 it went to 174 Hz (the first crystal where it was band 0 or 1); now to 2907 Hz, where it fits.
// Then libraries where only a share of the tracks have a key yet (Source tracks, unreadable scans that stay and
// stand-ins as in section 2): the keyed open tracks on a band-0 crystal, and those on a worse band than v16.8.1 gave
// them (the frozen copy), each held to a bar measured with a margin (`--table` prints both NEUTRALs side by side).
{
  const pk = Array.from({ length: 27 }, (_, i) => ({ id: `pk${i}`, name: `tone-pk-${i}`, duration: 200, file: { name: `tone-pk-${i}.wav`, size: 1000 + i } })) as T[];
  const pkBands = ALL_CRYSTALS.map((f) => (f === 174 ? 1 : f === 2907 ? 0 : 3));
  const pkPlan = planAssign(pk, 'spread', { bands: (x) => (x.id === 'pk0' ? pkBands : null) });
  same('neutral', [pkPlan.patches.get('pk0')?.closestSolfeggio, pkPlan.keyFits], [2907, 1], 'pK: the keyed track goes to its band-0 crystal (2907 Hz), not the earlier band-1 one (174 Hz)');
  same('neutral', planAssign(pk, 'spread', { bands: (x) => (x.id === 'pk0' ? pkBands : ALL_CRYSTALS.map(() => 1.5)) }).patches.get('pk0')?.closestSolfeggio, 174, 'pK: (with 1.5 on the others, the old NEUTRAL, it would go to 174 Hz)');
  // (R1 leaves pK as it is: the track fits 2907 Hz, so its ranks are its bands.)
  same('neutral', planAssign(pk, 'spread', { bands: (x) => (x.id === 'pk0' ? keyRanks(pkBands) : null) }).patches.get('pk0')?.closestSolfeggio, 2907, 'pK: with its ranks (R1), the same');
}
// pG (fix round 2, R1; the logic review's smallest fit-nowhere case): 27 tracks, one keyed whose key fits no crystal
// (band 1 on 174 Hz, the spread's first crystal, band 3 everywhere else) and 26 keyless. With R1 its ranks are 0.25 on
// 174 Hz (its best band) and 3 elsewhere, so it gets 174 Hz before a keyless track (0.5) does. Without R1 (its bands
// as they are, bec9f23) it lost every crystal to the keyless tracks and ended on 6336 Hz, band 3.
{
  const pg = Array.from({ length: 27 }, (_, i) => ({ id: `pg${i}`, name: `tone-pg-${i}`, duration: 200, file: { name: `tone-pg-${i}.wav`, size: 1000 + i } })) as T[];
  const pgBands = ALL_CRYSTALS.map((f) => (f === 174 ? 1 : 3));
  same('fitnowhere', Array.from(keyRanks(pgBands)), ALL_CRYSTALS.map((f) => (f === 174 ? FIT_NOWHERE_BAND : 3)), 'keyRanks: a track that fits nowhere ranks 0.25 on its best crystals, its band elsewhere');
  same('fitnowhere', FIT_NOWHERE_BAND, 0.25, 'FIT_NOWHERE_BAND is 0.25 (between a fit, 0, and NEUTRAL_BAND, 0.5)');
  const two = ALL_CRYSTALS.map((f) => (f === 396 || f === 741 ? 2 : 3));
  same('fitnowhere', Array.from(keyRanks(two)), ALL_CRYSTALS.map((f) => (f === 396 || f === 741 ? FIT_NOWHERE_BAND : 3)), 'keyRanks: every crystal with its best band (two here) ranks 0.25');
  const fits = ALL_CRYSTALS.map((f) => (f === 174 ? 1 : f === 2907 ? 0 : 3));
  ok('fitnowhere', keyRanks(fits) === fits, 'keyRanks: a track that fits some crystal keeps its bands (the same array)');
  const pgR1 = planAssign(pg, 'spread', { bands: (x) => (x.id === 'pg0' ? keyRanks(pgBands) : null) });
  same('fitnowhere', [pgR1.patches.get('pg0')?.closestSolfeggio, pgR1.keyFits, pgR1.keyed], [174, 0, 1], 'pG: the track that fits nowhere gets 174 Hz, its best band (band 1), not a fit (keyFits 0)');
  const pgRaw = planAssign(pg, 'spread', { bands: (x) => (x.id === 'pg0' ? pgBands : null) });
  same('fitnowhere', pgRaw.patches.get('pg0')?.closestSolfeggio, 6336, 'pG: without R1 (its bands as they are, bec9f23) it went to 6336 Hz, band 3');
  // The app's provider is the rule: BandCache.planOptions gives keyRanks of the cached bands, for every KEY_POOL key.
  let nowhere = 0;
  for (const q of KEY_POOL) {
    const x = { id: 'pg-q', name: 'tone-pg-q', duration: 200, file: { name: 'tone-pg-q.wav', size: 1 }, chroma: [...q.chroma], chromaA4Hz: q.chromaA4Hz, musicKey: q.musicKey, keyConfidence: 0.8, chromaVersion: 1 } as T;
    CACHE.ensureSync([x] as never);
    const b = CACHE.get(x as never)!;
    if (!b.includes(0)) nowhere++;
    same('fitnowhere', Array.from(OPTS.bands!(x)!), Array.from(keyRanks(b)), `planOptions: keyRanks of the cached bands (${q.musicKey} at ${q.chromaA4Hz})`);
  }
  ok('fitnowhere', nowhere > 0, `KEY_POOL holds keys that fit no crystal (${nowhere} of ${KEY_POOL.length}), so the sections above plan them`);
}
const TONES_HEARD = ALL_CRYSTALS.map((f) => toneOf(f, 'headphones'));
/** v16.8.3: the rate a track is heard at, restated: 0.981818, times 2^(cents/1200) for a tuned one (M1). */
const heardFactor = (x: T) => { const c = validTuning(x as never); return c === null ? 0.981818 : 0.981818 * Math.pow(2, c / 1200); };
const duckOf = (x: T, f: number) => 6 * smoothstep(0.35, 0.75, musicFit(TONES_HEARD[ALL_CRYSTALS.indexOf(f)], x.chroma as number[], (x.chromaA4Hz as number) * heardFactor(x)).rel);
const ONE_HALF_AND_HALF = ALL_CRYSTALS.map(() => 1.5);
/** How the keyed tracks are given to the spread: 'r1' the app's (planOptions: ranks, fix round 2); 'raw' their bands
 *  as they are (bec9f23, NEUTRAL 0.5 without R1); '1.5' their bands with 1.5 on every keyless track (96d4639). */
type Mode = 'r1' | 'raw' | '1.5';
const modeOpts = (mode: Mode) => (mode === 'r1' ? OPTS : mode === 'raw' ? { bands: (x: T) => CACHE.get(x as never), awaiting: OPTS.awaiting } : { bands: (x: T) => CACHE.get(x as never) ?? ONE_HALF_AND_HALF, awaiting: OPTS.awaiting });
/** The keyed open tracks of libraries `share` keyed: on band 0, on a worse band than v16.8.1, the mean duck (dB); and
 *  of them the ones that fit no crystal (fix round 2): on band 3, their duck. `sizes`: the libraries' sizes in turn. */
function arriving(share: number, mode: Mode, sizes: number[] = [54, 100, 270]): { keyed: number; fits: number; worse: number; duck: number; nowhere: number; nowhere3: number; nowhereDuck: number } {
  const m = { keyed: 0, fits: 0, worse: 0, duck: 0, nowhere: 0, nowhere3: 0, nowhereDuck: 0 };
  for (let k = 0; k < 48; k++) {
    const seed = 6000 + Math.round(share * 1000) + k + (sizes.length === 1 ? 500 : 0);
    const lib = withKeys(library(seed, sizes[k % sizes.length], (['scanned', 'partly', 'stays', 'unscanned'] as Kind[])[k % 4], [0, 0.03, 0.1][k % 3]), seed, { share });
    CACHE.ensureSync(lib as never);
    const p = planAssign(lib, 'spread', modeOpts(mode) as never);
    const now = new Map(apply(lib, p).map((x) => [x.id, x.closestSolfeggio as number]));
    const was = new Map(apply(lib, spreadV1681(lib)).map((x) => [x.id, x.closestSolfeggio as number]));
    for (const x of lib) {
      if (!clearKey(x as never) || LIVE.spreadRole(x).role !== 'open') continue;
      const b = CACHE.get(x as never)!;
      const at = ALL_CRYSTALS.indexOf(now.get(x.id)!), before = ALL_CRYSTALS.indexOf(was.get(x.id)!);
      m.keyed++;
      if (b[at] === 0) m.fits++;
      if (b[at] > b[before]) m.worse++;
      const d = duckOf(x, now.get(x.id)!);
      m.duck += d;
      if (!b.includes(0)) { m.nowhere++; if (b[at] === 3) m.nowhere3++; m.nowhereDuck += d; }
    }
  }
  return m;
}
const pct = (a: number, b: number) => (100 * a) / Math.max(1, b);
const arrivingBars: Record<string, { fits: number; worse: number }> = { 0.1: { fits: ARRIVING_FITS_10, worse: ARRIVING_WORSE_10 }, 0.3: { fits: ARRIVING_FITS_30, worse: ARRIVING_WORSE_30 } };
const arrivingSeen: string[] = [];
for (const share of [0.1, 0.3]) {
  const m = arriving(share, 'r1');
  const fits = pct(m.fits, m.keyed), worse = pct(m.worse, m.keyed);
  arrivingSeen.push(`${share * 100} %: ${m.keyed} keyed, ${fits.toFixed(1)} % fit, ${worse.toFixed(1)} % worse`);
  ok('arriving', m.keyed >= 200 && fits >= arrivingBars[share].fits && worse <= arrivingBars[share].worse, `2d: ${share * 100} % keyed: ${m.keyed} keyed open tracks, ${fits.toFixed(1)} % on a fitting crystal (>= ${arrivingBars[share].fits} %), ${worse.toFixed(1)} % on a worse band than v16.8.1 (<= ${arrivingBars[share].worse} %)`);
}
// Fix round 2 (R1): the keyed tracks that fit no crystal, in 54-track libraries (where the logic review found them
// losing every crystal to the keyless tracks) at 30 % and 60 % keyed: on band 3 at most NOWHERE_BAND3_MAX %, their
// mean duck at most NOWHERE_DUCK_MAX dB.
const nowhereSeen: string[] = [];
for (const share of [0.3, 0.6]) {
  const m = arriving(share, 'r1', [54]);
  const b3 = pct(m.nowhere3, m.nowhere), duck = m.nowhereDuck / Math.max(1, m.nowhere);
  nowhereSeen.push(`${share * 100} %: ${m.nowhere} fit nowhere, ${b3.toFixed(1)} % on band 3, ${duck.toFixed(2)} dB`);
  ok('fitnowhere', m.nowhere >= 20 && b3 <= NOWHERE_BAND3_MAX && duck <= NOWHERE_DUCK_MAX, `2d (R1): 54 tracks, ${share * 100} % keyed: ${m.nowhere} keyed tracks fit no crystal: ${b3.toFixed(1)} % on band 3 (<= ${NOWHERE_BAND3_MAX} %), mean duck ${duck.toFixed(2)} dB (<= ${NOWHERE_DUCK_MAX})`);
}
if (TABLE) {
  realLog('§2d table: share keyed | mode | keyed | band 0 | mean duck dB | worse than v16.8.1 || fit nowhere: n | band 3 | duck dB');
  realLog('  (modes: 1.5 = 96d4639, raw = bec9f23 (0.5, no R1), r1 = this build)');
  for (const share of [0.1, 0.3, 0.6, 1]) for (const mode of ['1.5', 'raw', 'r1'] as Mode[]) {
    const m = arriving(share, mode);
    realLog(`  ${share * 100} % | ${mode} | ${m.keyed} | ${pct(m.fits, m.keyed).toFixed(1)} % | ${(m.duck / Math.max(1, m.keyed)).toFixed(2)} | ${pct(m.worse, m.keyed).toFixed(1)} % || ${m.nowhere} | ${pct(m.nowhere3, m.nowhere).toFixed(1)} % | ${(m.nowhereDuck / Math.max(1, m.nowhere)).toFixed(2)}`);
  }
  realLog('§2d fit-nowhere row, 54-track libraries: share keyed | mode | fit nowhere | band 3 | duck dB');
  for (const share of [0.3, 0.6]) for (const mode of ['1.5', 'raw', 'r1'] as Mode[]) {
    const m = arriving(share, mode, [54]);
    realLog(`  ${share * 100} % | ${mode} | ${m.nowhere} | ${pct(m.nowhere3, m.nowhere).toFixed(1)} % | ${(m.nowhereDuck / Math.max(1, m.nowhere)).toFixed(2)}`);
  }
}

// ---- 2e. The confirmation's key words, true for the plan (fix round 1, B1, B2) -------------------------------------
{
  const words = (l: readonly T[]) => LIVE.assignConfirmText(plan(l)).body;
  const keyedTone = (s: T, i: number): T => ({ ...s, ...KEY_POOL[i % KEY_POOL.length], chroma: [...KEY_POOL[i % KEY_POOL.length].chroma], keyConfidence: 0.8, chromaVersion: 1 }) as T;
  // W1 (the logic review): 30 scanned tracks, all keyed, and 120 analysed imports with no crystal: "most tracks move"
  // counts the tracks that had a crystal, not the ones given one.
  const scanned30 = library(8801, 30, 'scanned', 0).map(keyedTone);
  const fresh120 = Array.from({ length: 120 }, (_, i) => keyedTone({ id: `w1-${i}`, name: `tone-w1-${i}`, duration: 200, file: { name: `tone-w1-${i}.wav`, size: 5000 + i } } as T, i + 7));
  const w1 = plan([...scanned30, ...fresh120]);
  ok('words', w1.hadCrystal === 30 && (w1.hadCrystalMoves ?? 0) <= 30 && !words([...scanned30, ...fresh120]).includes('of 150)'), `W1: "most tracks move" counts the 30 that had a crystal (${w1.hadCrystalMoves} of ${w1.hadCrystal}), never of 150`);
  if ((w1.hadCrystalMoves ?? 0) > 15) ok('words', words([...scanned30, ...fresh120]).includes(`This time most tracks move (${w1.hadCrystalMoves} of 30).`), 'W1: the sentence, of 30');
  // The boundary: exactly half moving is not "most"; one more is.
  const p = { ...w1, keyed: 1, awaitingKey: 0 };
  const at = (had: number, moves: number) => LIVE.assignConfirmText({ ...p, hadCrystal: had, hadCrystalMoves: moves } as AssignPlan).body.includes('This time most tracks move');
  same('words', [at(10, 5), at(10, 6), at(1, 1), at(2, 2), at(0, 0)], [false, true, false, true, false], 'most tracks move: not at half (5 of 10), at 6 of 10; never for 1 track; 2 of 2');
  // The singular, exactly; the plural.
  ok('words', LIVE.assignConfirmText({ ...p, awaitingKey: 1 } as AssignPlan).body.includes('1 track has no key yet: Analyse tracks to place it by key too.'), 'the no-key sentence: the singular');
  ok('words', LIVE.assignConfirmText({ ...p, awaitingKey: 3 } as AssignPlan).body.includes('3 tracks have no key yet: Analyse tracks to place them by key too.'), 'the no-key sentence: the plural');
  // Only Source tracks waiting: no no-key sentence (they aren't placed, by key or otherwise).
  const srcOnly = [...library(8802, 40, 'scanned', 0).map(keyedTone), ...[0, 1, 2].map((i) => ({ id: `src-w-${i}`, name: `tone-src-w-${i}`, duration: 200, file: { name: `tone-src-w-${i}.wav`, size: 7000 + i }, ...scanRec(R2178[i]) }) as T)];
  ok('words', !words(srcOnly).includes('no key yet') && plan(srcOnly).awaitingKey === 0 && libraryHealth(srcOnly as never).awaitingKey === 0, 'only Source tracks waiting: no no-key sentence, 0 counted (the plan and the card)');
}

// ---- 2f. The residual (fix round 1, the tests review's edge720): a stored length either side of 720 s --------------
// devices.check's second device keeps every length on its side of the phone's cap (section 2); here one track's length
// reads 719.98 s on one device and 720.03 s on the other (both probes agree within 0.05 s: measure/results.md), so it
// has a clear key on one and not the other, and the even spread passes that on. A documented residual, not a pass on
// equality: over these 40 libraries (54 to 270 scanned keyed tracks) the tracks whose crystal differs stay within
// EDGE720_MAX_MEDIAN / EDGE720_MAX, so a regression that widens the cascade fails here. Same files, same key data: always
// 0 (section 2). Measured (fix round 3, re-measured with R1): this section 0-38, median 8; the tests review's own
// fixture (rev1/tests/edge720.ts) 0-34, median 7. With NEUTRAL 1.5 and no R1 they were 0-25, median 5, and 0-13, median
// 4. These libraries are fully keyed, so the flipped track is their only keyless one: NEUTRAL 0.5 places it among the
// keyed tracks (1.5 put it after them all), and R1 moves the fit-nowhere ones ahead of it, which widens the cascade. So
// of the gap between the tests review's 1.5 figure (median 4) and this section's (median 8), about three quarters is
// NEUTRAL 0.5 with R1 (the same fixture goes from 4 to 7) and a quarter the fixture (7 against 8). In libraries that
// keep keyless tracks (most real ones) the medians are alike but not the means (the survey pool, re-measured at fix
// round 4 with R1, this build against 1.5: 270 fully analysed, mean 9.0 / 7.4, median 6 / 6, max 35 / 30; 1,000
// tracks, mean 17.5 / 17.5). For the user: in a fully keyed library one track either side of 720 s changes a median of 7-8
// crystals on the other device.
const EDGE720_MAX_MEDIAN = 15, EDGE720_MAX = 60;
const edge720: number[] = [];
for (let k = 0; k < 40; k++) {
  const lib = library(7200 + k, [54, 100, 270][k % 3], 'scanned', 0).map((s, i) => ({ ...s, ...KEY_POOL[(k * 7 + i) % KEY_POOL.length], chroma: [...KEY_POOL[(k * 7 + i) % KEY_POOL.length].chroma], keyConfidence: 0.8, chromaVersion: 1 }) as T);
  const j = (k * 13) % lib.length;
  const pc = lib.map((s, i) => (i === j ? ({ ...s, duration: 719.98 } as T) : s));
  const phone = lib.map((s, i) => (i === j ? ({ ...s, duration: 720.03 } as T) : s));
  const a = new Map(byFile(apply(pc, plan(pc)))), b = new Map(byFile(apply(phone, plan(phone))));
  edge720.push([...a.keys()].filter((key) => JSON.stringify(a.get(key)) !== JSON.stringify(b.get(key))).length);
}
edge720.sort((x, y) => x - y);
ok('residual', edge720[edge720.length >> 1] <= EDGE720_MAX_MEDIAN && edge720[edge720.length - 1] <= EDGE720_MAX, `2f: one track either side of 720 s: ${edge720[0]}-${edge720[edge720.length - 1]} tracks differ (median ${edge720[edge720.length >> 1]}; bars ${EDGE720_MAX_MEDIAN} / ${EDGE720_MAX})`);

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
console.log(`devices.check: ${checks} checks passed (2g tunings: ${tuningSeen}; 2d keys arriving: ${arrivingSeen.join('; ')}; 2d fit nowhere (54 tracks): ${nowhereSeen.join('; ')}; ${staysWaiting} libraries with an unreadable scan that stays and waits for a key (R22); 2f one track either side of 720 s: ${edge720[0]}-${edge720[edge720.length - 1]} tracks differ, median ${edge720[edge720.length >> 1]}; fit ${(100 * fit.on / fit.keyed).toFixed(1)} % with the bands, ${(100 * fit.off / fit.keyed).toFixed(1)} % without; ${keyedLibs} libraries with keys, ${keyedTracks} tracks placed by key, ${overCapLibs} (b), ${otherVersionLibs} (c), ${byV1681} (d); ${libs} libraries: ${withSource} with Source tracks, ${withStays} with unreadable scans that stay, ${fullyScanned} fully scanned, ${balanced} balance cases, ${small} small with Source, ${withStandIns} with stand-ins (${standIns} unmeasured tracks, every one with a fresh id on the second device), ${byV1671} against v16.7.1 keyed by the file (${byV1671Short} short), ${moved} where a press moves crystals)`);
