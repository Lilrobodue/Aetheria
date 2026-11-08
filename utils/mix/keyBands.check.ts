// utils/mix/keyBands.check.ts (v16.8.2 "Key placement"). `node utils/mix/keyBands.check.ts` (npm run check:mix).
//
// The pure half of key placement (utils/mix/keyBands.ts), checked arm by arm:
//   - the constants, the caps tied to the 8 GB phone's capsFor;
//   - every arm of clearKey (K3) and awaitingKey (K4);
//   - bandsOf against musicFit restated by hand here (the roughness sum and the ±600-cent sweep, the tone folded into
//     150-1000 Hz for headphones, the heard A4 = chromaA4Hz × 0.981818) on 3 fixed inputs, and pinned to literals;
//     never the Lo Shu Perfect GUT tones, never without the retune (K5);
//   - contentKey; the cache: get never computes, missing, warm in slices (its yields, progress, cancel), ensureSync,
//     export / import (round trip, another KEY_BANDS_VERSION and malformed entries refused, nothing added), prune.
//   - v16.8.3 (Track Tuning, M1): a Standard track's content key and bands byte-identical to v16.8.2's (the three-part
//     key, bandsOf), whatever garbage its tuning fields hold; a tuned track's key carries "|t<cents>" and its bands are
//     the definition heard at tuneRate(cents); the persisted record never holds a tuned entry (export leaves them out,
//     import refuses one), validKey accepts the suffix only in memory; a retune makes a new key for that track alone.
// Synthetic chroma only; no Math.random.
import { strict as assert } from 'node:assert';
import {
  BANDS_DEF, BandCache, FINGERPRINT_INPUTS, KEY_BANDS_VERSION, KEY_EDGES, KEY_MAX_BYTES, KEY_MAX_SECONDS, NEUTRAL_BAND, awaitingKey, bandOfRel, bandsFingerprint, bandsOf, bandsWith, clearKey, contentKey, fingerprintOf, withinKeyLimits,
  isTunedKey, songBands, validKey,
} from './keyBands.ts';
import type { KeySong } from './keyBands.ts';
import { ALL_CRYSTALS } from './distribution.ts';
import { capsFor } from '../library/analysePass.ts';
import { CHROMA_VERSION } from '../soundV2/keyAnalysis.ts';
import { PERFECT_GUT, toneOf } from '../soundV2/aetheria_sound_v2.ts';
import { canonicalLayerHz } from '../soundV2/layerHost.ts';
import { tuneRate } from '../tuning/trackTuning.ts';

let checks = 0;
let refusals = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepStrictEqual(a, b, msg); checks++; };
const realRandom = Math.random;
Math.random = () => { throw new Error('Math.random used'); };

// ---- 1. the constants ---------------------------------------------------------------------------------------------
eq([...KEY_EDGES], [0.35, 0.55, 0.75], 'KEY_EDGES');
eq(NEUTRAL_BAND, 0.5, 'NEUTRAL_BAND (fix round 1: between fits and partly fits)');
eq(KEY_BANDS_VERSION, 1, 'KEY_BANDS_VERSION');
eq([KEY_MAX_SECONDS, KEY_MAX_BYTES], [720, 104857600], 'the caps: 720 s and 100 MiB');
const phone8 = capsFor(true, 8);
eq([phone8.seconds, phone8.bytes], [KEY_MAX_SECONDS, KEY_MAX_BYTES], "the caps are the 8 GB phone's capsFor");
eq(CHROMA_VERSION, 1, 'CHROMA_VERSION (a bump must bump KEY_BANDS_VERSION too)');

// ---- 2. clearKey: every arm ---------------------------------------------------------------------------------------
const CHROMA_G = [0.1211, 0.0123, 0.0954, 0.0187, 0.1032, 0.0811, 0.0245, 0.1702, 0.0161, 0.0988, 0.0204, 0.2382];
const good = (o: Partial<KeySong> & Record<string, unknown> = {}): KeySong => ({
  chroma: [...CHROMA_G], chromaA4Hz: 440, musicKey: 'G', keyConfidence: 0.8, chromaVersion: CHROMA_VERSION, duration: 200, file: { size: 4_000_000 }, ...o,
});
ok(clearKey(good()), 'a clear key');
const arms: Array<[string, KeySong | null | undefined, boolean]> = [
  ['null', null, false],
  ['undefined', undefined, false],
  ['chromaVersion 0', good({ chromaVersion: 0 }), false],
  ['chromaVersion 2 (another analyser)', good({ chromaVersion: 2 }), false],
  ['no chromaVersion', good({ chromaVersion: undefined }), false],
  ['chroma not an array', good({ chroma: { 0: 1 } }), false],
  ['chroma of 11', good({ chroma: CHROMA_G.slice(0, 11) }), false],
  ['a negative weight', good({ chroma: [-0.01, ...CHROMA_G.slice(1)] }), false],
  ['a NaN weight', good({ chroma: [NaN, ...CHROMA_G.slice(1)] }), false],
  ['a flat zero chroma', good({ chroma: new Array(12).fill(0) }), false],
  ['a typed-array chroma', good({ chroma: Float64Array.from(CHROMA_G) as unknown as number[] }), false],
  ['chromaA4Hz 0', good({ chromaA4Hz: 0 }), false],
  ['chromaA4Hz NaN', good({ chromaA4Hz: NaN }), false],
  ['no chromaA4Hz', good({ chromaA4Hz: undefined }), false],
  ["musicKey ''", good({ musicKey: '' }), false],
  ['no musicKey', good({ musicKey: undefined }), false],
  ['keyConfidence 0.449', good({ keyConfidence: 0.449 }), false],
  ['keyConfidence 0.45 (CLARITY_LO)', good({ keyConfidence: 0.45 }), true],
  ['keyConfidence NaN', good({ keyConfidence: NaN }), false],
  ['no keyConfidence', good({ keyConfidence: undefined }), false],
  ['duration 720', good({ duration: 720 }), true],
  ['duration 720.01', good({ duration: 720.01 }), false],
  ['duration 1800 (a desktop analyses it)', good({ duration: 1800 }), false],
  ['duration 0 (still being read)', good({ duration: 0 }), false],
  ['no duration (unknown)', good({ duration: undefined }), false],
  ['duration NaN', good({ duration: NaN }), false],
  ['duration Infinity', good({ duration: Infinity }), false],
  ['duration -5', good({ duration: -5 }), false],
  ['size 100 MiB', good({ file: { size: KEY_MAX_BYTES } }), true],
  ['size 100 MiB + 1', good({ file: { size: KEY_MAX_BYTES + 1 } }), false],
  ['size 0', good({ file: { size: 0 } }), true],
  ['no file (size unknown)', good({ file: undefined }), false],
  ['file null', good({ file: null }), false],
  ['size NaN', good({ file: { size: NaN } }), false],
  ['no size', good({ file: {} }), false],
];
for (const [what, s, want] of arms) eq(clearKey(s), want, `clearKey: ${what}`);
eq(withinKeyLimits(good({ chromaVersion: 0 })), true, 'withinKeyLimits reads only the length and the size');

// awaitingKey (K4): not clear only because this CHROMA_VERSION hasn't analysed it.
const fresh = (o: Partial<KeySong> & Record<string, unknown> = {}): KeySong => ({ duration: 200, file: { size: 4_000_000 }, ...o });
const waits: Array<[string, KeySong | null, boolean]> = [
  ['a new import', fresh(), true],
  ['an older analyser (chromaVersion 0)', fresh({ chromaVersion: 0, chroma: [...CHROMA_G], chromaA4Hz: 440, musicKey: 'G', keyConfidence: 0.8 }), true],
  ['analysed by this version (clear)', good(), false],
  ['analysed by this version, no clear key', good({ keyConfidence: 0.3 }), false],
  ['analysed by this version, nothing found', fresh({ chromaVersion: CHROMA_VERSION }), false],
  ['given up on (analysisFailedV)', fresh({ analysisFailedV: CHROMA_VERSION }), false],
  ['an older give-up (analysisFailedV 0)', fresh({ analysisFailedV: 0 }), true],
  // (fix round 1: a newer analyser's version reads as "not this version's": this release's Analyse tracks redoes it.)
  ['a newer analyser (chromaVersion 2)', fresh({ chromaVersion: 2, chroma: [...CHROMA_G], chromaA4Hz: 440, musicKey: 'G', keyConfidence: 0.8 }), true],
  ['too long for the phone', fresh({ duration: 721 }), false],
  ['too large for the phone', fresh({ file: { size: KEY_MAX_BYTES + 1 } }), false],
  ['length unknown', fresh({ duration: undefined }), false],
  ['no file', fresh({ file: undefined }), false],
  ['null', null, false],
];
for (const [what, s, want] of waits) eq(awaitingKey(s), want, `awaitingKey: ${what}`);

// ---- 3. bandsOf against musicFit restated by hand -----------------------------------------------------------------
// The v2 spec's roughness (Plomp-Levelt, Sethares' fit), the tone's dissonance against the chroma's 12 pitch classes
// on the grid A4 = a4 (each class folded under the tone, with its octave above), and rel = where it sits between the
// smoothest and roughest pitch of a ±600-cent sweep in 10-cent steps.
const rough = (f1: number, f2: number) => { const s = 0.24 / (0.021 * Math.min(f1, f2) + 19); const x = Math.abs(f2 - f1); return Math.exp(-3.5 * s * x) - Math.exp(-5.75 * s * x); };
const diss = (t: number, w: number[], a4: number) => {
  let d = 0;
  for (let k = 0; k < 12; k++) {
    if (w[k] <= 0) continue;
    let fk = a4 * 2 ** ((k - 9) / 12);
    while (fk > t) fk /= 2;
    while (fk * 2 <= t) fk *= 2;
    d += w[k] * (rough(t, fk) + rough(t, 2 * fk));
  }
  return d;
};
const relByHand = (t: number, chroma: number[], a4: number) => {
  const sum = chroma.reduce((a, b) => a + b, 0);
  const w = chroma.map((v) => v / sum);
  let lo = Infinity, hi = -Infinity;
  for (let c = -600; c < 600; c += 10) { const v = diss(t * 2 ** (c / 1200), w, a4); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return hi > lo + 1e-12 ? Math.min(1, Math.max(0, (diss(t, w, a4) - lo) / (hi - lo))) : 0;
};
/** The headphones tone: the crystal folded by octaves into 150-1000 Hz (headphones' floor, 20 Hz, is under it). */
const toneByHand = (f: number) => { let x = f; while (x > 1000) x /= 2; while (x < 150) x *= 2; return x; };
const bandByHand = (rel: number) => (rel <= 0.35 ? 0 : rel <= 0.55 ? 1 : rel <= 0.75 ? 2 : 3);
const RETUNE = 0.981818;
const INPUTS: Array<[string, number[], number, string]> = [
  ['G major-like at 440', CHROMA_G, 440, '211230111112021112213110112'],
  ['A minor-like at 432.61', [0.0712, 0.0098, 0.0856, 0.0143, 0.1655, 0.0731, 0.0126, 0.0814, 0.0109, 0.3021, 0.0152, 0.1583], 432.61, '213210101110111112311011113'],
  ['near-flat at 446.2', [0.0843, 0.0811, 0.0862, 0.0799, 0.0858, 0.0822, 0.0831, 0.0846, 0.0807, 0.0855, 0.0819, 0.0847], 446.2, '111112122222212111021211111'],
];
for (const [what, chroma, a4, pinned] of INPUTS) {
  const got = Array.from(bandsOf(chroma, a4)).join('');
  const hand = ALL_CRYSTALS.map((f) => bandByHand(relByHand(toneByHand(f), chroma, a4 * RETUNE))).join('');
  eq(got, hand, `bandsOf, ${what}: musicFit restated by hand`);
  eq(got, pinned, `bandsOf, ${what}: the pinned bands`);
  ok(bandsOf(chroma, a4) instanceof Uint8Array && bandsOf(chroma, a4).length === 27, `bandsOf, ${what}: a Uint8Array of 27`);
}
// K5 and the retune: the Lo Shu Perfect GUT tones (75 .. 630 for the first six) and the unretuned A4 give other bands on
// these inputs, so a placement that used either would show here.
{
  const [, chroma, a4] = INPUTS[0];
  const loShu = ALL_CRYSTALS.map((f, i) => bandByHand(relByHand(toneByHand(i < 6 ? PERFECT_GUT[i] : f), chroma, a4 * RETUNE))).join('');
  const raw = ALL_CRYSTALS.map((f) => bandByHand(relByHand(toneByHand(f), chroma, a4))).join('');
  ok(loShu !== INPUTS[0][3], 'the Lo Shu Perfect GUT tones would give other bands (K5: never used)');
  ok(raw !== INPUTS[0][3], 'the stored A4 without the retune would give other bands');
}
// The edges themselves (rel at an edge is in the lower band).
eq([0, 0.35, 0.3500001, 0.55, 0.5500001, 0.75, 0.7500001, 1, NaN].map(bandOfRel), [0, 0, 1, 1, 2, 2, 3, 3, 3], 'bandOfRel at and past each edge');

// ---- 4. contentKey ------------------------------------------------------------------------------------------------
eq(contentKey(good()), `1|440|${CHROMA_G.join(',')}`, 'contentKey: the version, the A4, the 12 weights as stored');
eq(contentKey(good({ chromaA4Hz: 440.25 })), `1|440.25|${CHROMA_G.join(',')}`, 'contentKey: another A4, another key');
eq(contentKey({ chroma: [...CHROMA_G], chromaA4Hz: 440 }), contentKey(good({ musicKey: 'Em', keyConfidence: 0.5, duration: 30 })), 'contentKey reads only the chroma and the A4');

// ---- 5. the cache -------------------------------------------------------------------------------------------------
const lib = (n: number, seed = 0): KeySong[] => Array.from({ length: n }, (_, i) => good({ chroma: CHROMA_G.map((v, k) => (k === (i + seed) % 12 ? v + 0.001 * (i + 1) : v)) }));
{
  const c = new BandCache();
  const songs = [...lib(10), good({ keyConfidence: 0.2 }), good({ duration: 900 }), fresh()];
  eq(c.get(songs[0]), null, 'get: not cached, null');
  eq(c.size, 0, 'get never computes');
  eq(c.missing(songs), 10, 'missing: the clear-key tracks not cached');
  eq(c.ensureSync(songs.slice(0, 4)), 4, 'ensureSync: the content keys made');
  eq(c.missing(songs), 6, 'missing after ensureSync');
  eq(Array.from(c.get(songs[0]) as Uint8Array), Array.from(bandsOf(songs[0].chroma as number[], 440)), 'get: the bands');
  // (fix round 1, T-nit 1: their content IS cached here: the gate is clearKey, never "has a chroma".)
  c.ensureSync([good()]);
  ok(c.map.has(contentKey(good())), '(the unclear tracks\' content cached)');
  eq([c.get(songs[10]), c.get(songs[11]), c.get(songs[12])], [null, null, null], 'get: no clear key, null (cached or not)');
  // The same content twice: one entry, both tracks served.
  const twin = { ...songs[1], duration: 300 };
  ok(c.get(twin) === c.get(songs[1]) && c.missing([twin]) === 0, 'the same content: the same entry');
  // A patched copy (a new object, new chroma) is a new key; the memo checks the fields it was made from.
  const patched = { ...songs[0], chroma: [...CHROMA_G] };
  ok(c.keyOf(patched) === contentKey(patched) && c.keyOf(songs[0]) === contentKey(songs[0]), 'keyOf follows the fields');
}
// warm: slices of sliceMs, a yield between them, progress after each, cancel.
{
  // A fake clock that moves 1.5 ms on every read (the warm reads it about twice per content key).
  let clock = 0;
  const tick = () => { clock += 1.5; return clock; };
  const songs = lib(12);
  const c = new BandCache();
  const yields: number[] = [];
  const progress: number[] = [];
  const r = await c.warm(songs, { sliceMs: 5, yieldFn: async (ms) => { yields.push(ms); }, onProgress: (left) => progress.push(left), now: tick });
  eq([r.added, r.cancelled], [12, false], 'warm: every missing band made');
  ok(yields.length >= 2 && progress[progress.length - 1] === 0 && progress.every((x, i) => i === 0 || x < progress[i - 1]), `warm: in slices, progress falling to 0 (${yields.length} yields, ${progress.join(',')})`);
  eq(c.missing(songs), 0, 'warm: none missing after');
  ok(c.lastWarm !== null && c.lastWarm.added === 12 && c.lastWarm.msPerTrack === r.ms / 12, 'warm: lastWarm, ms per track');
  // (fix round 1, A-SF4 / L-S2: its progress is counted once and decremented: missing() is never called by a warm,
  // whatever the slices, so a warm stays O(n). 2,000 tracks of 40 contents, a slice per content key.)
  {
    const big = Array.from({ length: 2000 }, (_, i) => good({ chroma: CHROMA_G.map((v, k) => (k === 0 ? v + 0.001 * (1 + (i % 40)) : v)) }));
    const spy = new BandCache();
    let calls = 0;
    const real = spy.missing.bind(spy);
    spy.missing = (x: readonly KeySong[]) => { calls++; return real(x); };
    const left: number[] = [];
    let clk = 0;
    await spy.warm(big, { sliceMs: 1, yieldFn: async () => {}, onProgress: (n) => left.push(n), now: () => (clk += 1) });
    eq([calls, left.length, left[left.length - 1]], [0, 40, 0], 'warm: no missing() call (O(n)), one progress report per slice, ending at 0');
    ok(left.every((n, i) => i === 0 || n < left[i - 1]) && left[0] === 2000 - 50, `warm: the count falls by each content's tracks (${left.slice(0, 3).join(', ')} …)`);
  }
  // Cancel after the first yield: what was made is kept, the rest is not.
  const c2 = new BandCache();
  let cancel = false;
  const r2 = await c2.warm(songs, { sliceMs: 5, yieldFn: async () => { cancel = true; }, shouldCancel: () => cancel, now: tick });
  ok(r2.cancelled && r2.added > 0 && r2.added < 12 && c2.missing(songs) === 12 - r2.added, `warm: cancelled after a slice, ${r2.added} kept`);
  const r3 = await new BandCache().warm(songs, { sliceMs: 5, yieldFn: async () => {}, shouldCancel: () => true, now: tick });
  eq([r3.added, r3.cancelled], [0, true], 'warm: cancelled before it starts, nothing made');
  const r4 = await c.warm(songs, { sliceMs: 5, yieldFn: async () => { throw new Error('no yield needed'); }, now: tick });
  eq([r4.added, r4.cancelled], [0, false], 'warm: nothing missing, no work and no yield');
  // The real clock: the bands are the same whatever the slicing.
  const c5 = new BandCache();
  await c5.warm(songs, { sliceMs: 0, yieldFn: async () => {} });
  eq(JSON.stringify(c5.export()), JSON.stringify(c.export()), 'warm: the same bands at any slice');
}
// export / import / prune
{
  const c = new BandCache();
  const songs = lib(6);
  c.ensureSync(songs);
  const ex = c.export();
  eq(ex.v, KEY_BANDS_VERSION, 'export: the version');
  // (Fix round 2, R5.5 / R17: the fingerprint is the version, then each input's bands; the expected one is computed here
  // from the inputs with musicFit restated by hand (section 3), never only a stored literal.)
  const byHand = (def: { edges: readonly number[]; heard: number }) => FINGERPRINT_INPUTS.map(([cc, a]) => ALL_CRYSTALS.map((f) => { const rel = relByHand(toneByHand(f), cc as number[], a * def.heard); let b = 0; while (b < def.edges.length && rel > def.edges[b]) b++; return b; }).join(''));
  // (Fix round 3, F4: the definition's own values come after the version, each as String(n): the edges, the heard factor
  // and the 27 tones, the headphones fold restated by hand here; then the inputs' bands.)
  const defEntries = (d: { edges: readonly number[]; heard: number; tones: readonly number[] }) => [`edges ${d.edges.map(String).join(' ')}`, `heard ${String(d.heard)}`, `tones ${d.tones.map(String).join(' ')}`];
  const handTones = ALL_CRYSTALS.map((f) => toneByHand(f));
  eq(ex.fp, [`v${KEY_BANDS_VERSION}`, ...defEntries({ edges: KEY_EDGES, heard: RETUNE, tones: handTones }), ...byHand({ edges: KEY_EDGES, heard: RETUNE })], 'export: the fingerprint, the version, the definition and the inputs\' bands (computed by hand)');
  eq(bandsFingerprint(), fingerprintOf(BANDS_DEF), 'the fingerprint is fingerprintOf(BANDS_DEF)');
  ok(FINGERPRINT_INPUTS.every(([cc, a]) => Array.from(bandsOf(cc, a)).join('') === Array.from(bandsWith(cc, a, BANDS_DEF)).join('')), 'bandsOf is bandsWith(…, BANDS_DEF)');
  eq(bandsFingerprint(), ['v1', 'edges 0.35 0.55 0.75', 'heard 0.981818', 'tones 174 285 396 417 528 639 741 852 963 603 724.5 846 967.5 544.5 605.25 666 726.75 787.5 876 964.5 526.5 570.75 615 659.25 703.5 747.75 792', '122112110312003302001231312', '012112300310013222101222132', '211230111112021112213110112', '213210101110111112311011113'], 'the fingerprint: pinned (its last two inputs are section 3\'s first two)');
  // (F4: every change to the definition, however small, is seen: each edge alone ±0.001, the heard factor 0.9818, a tone
  // moved by 0.01 Hz; each as fingerprintOf computes it and as the check writes it by hand.)
  const small: Array<[string, { edges: readonly number[]; heard: number; tones: readonly number[] }]> = [];
  for (let e = 0; e < KEY_EDGES.length; e++) for (const d of [0.001, -0.001]) small.push([`edge ${e} ${d > 0 ? '+' : ''}${d}`, { ...BANDS_DEF, edges: KEY_EDGES.map((x, i) => (i === e ? x + d : x)) }]);
  small.push(['the heard factor 0.9818', { ...BANDS_DEF, heard: 0.9818 }]);
  for (const i of [0, 13, 26]) small.push([`tone ${i} +0.01 Hz`, { ...BANDS_DEF, tones: BANDS_DEF.tones.map((t, j) => (j === i ? t + 0.01 : t)) }]);
  for (const [what, d] of small) {
    const fp = fingerprintOf(d);
    ok(fp.length === bandsFingerprint().length && fp.some((x, i) => x !== bandsFingerprint()[i]), `the fingerprint sees ${what}`);
    eq(fp.slice(1, 4), defEntries(d), `the fingerprint under ${what}: its definition entries as written by hand`);
  }
  // What it must see (fpprobe): each a changed definition, computed both by fingerprintOf and by hand.
  const cent = (c: number) => BANDS_DEF.heard * 2 ** (c / 1200);
  const variants: Array<[string, { edges: readonly number[]; heard: number; tones?: readonly number[] }]> = [
    ['a retune 0.5 cent up', { edges: KEY_EDGES, heard: cent(0.5) }],
    ['a retune 0.5 cent down', { edges: KEY_EDGES, heard: cent(-0.5) }],
    ['the edges 0.005 up', { edges: KEY_EDGES.map((e) => e + 0.005), heard: RETUNE }],
    ['the edges 0.005 down', { edges: KEY_EDGES.map((e) => e - 0.005), heard: RETUNE }],
    ['no retune (standard tuning)', { edges: KEY_EDGES, heard: 1 }],
    ['the phone speaker\'s tones', { edges: KEY_EDGES, heard: RETUNE, tones: ALL_CRYSTALS.map((f) => toneOf(canonicalLayerHz(f, false).f, 'phone' as never)) }],
  ];
  for (const [what, v] of variants) {
    const fp = fingerprintOf({ ...BANDS_DEF, ...v });
    ok(fp.slice(1).some((x, i) => x !== bandsFingerprint()[i + 1]), `the fingerprint sees ${what}`);
    if (!v.tones) eq(fp.slice(4), byHand(v), `the fingerprint under ${what}: its bands as by hand`);
    ok(FINGERPRINT_INPUTS.slice(0, 2).every(([cc, a]) => Array.from(bandsWith(cc, a, { ...BANDS_DEF, ...v })).join('') !== Array.from(bandsOf(cc, a)).join('')), `both picked inputs see ${what}`);
  }
  ok(ex.entries.length === 6 && ex.entries.every(([k, b]) => typeof k === 'string' && /^[0-3]{27}$/.test(b)), 'export: 6 entries, 27 digits each');
  const d = new BandCache();
  ok(d.import(JSON.parse(JSON.stringify(ex))), 'import: a round trip through JSON');
  eq(JSON.stringify(d.export()), JSON.stringify(ex), 'import: the same entries');
  eq(d.missing(songs), 0, 'import: nothing missing after');
  const bad: Array<[string, unknown]> = [
    ['null', null], ['a string', 'keyBands'], ['another version', { ...ex, v: 2 }], ['no version', { fp: ex.fp, entries: ex.entries }],
    // (fix round 1: the fingerprint, and each malformed shape with a good fingerprint, so it fails for its own reason)
    ['no fingerprint', { v: 1, entries: ex.entries }],
    ['another fingerprint (another definition)', { ...ex, fp: [ex.fp[0], ex.fp[1].replace(/^./, (d) => String((Number(d) + 1) % 4)), ...ex.fp.slice(2)] }],
    ['a fingerprint missing an input', { ...ex, fp: ex.fp.slice(0, -1) }],
    ['a fingerprint of another version', { ...ex, fp: ['v2', ...ex.fp.slice(1)] }],
    ['fix round 1\'s fingerprint (no version, two inputs)', { ...ex, fp: ex.fp.slice(-2) }],
    ['fix round 2\'s fingerprint (the version and four inputs, no definition)', { ...ex, fp: [ex.fp[0], ...ex.fp.slice(-4)] }],
    ['another edge in the fingerprint', { ...ex, fp: [ex.fp[0], 'edges 0.36 0.55 0.75', ...ex.fp.slice(2)] }],
    ['a fingerprint of one', { ...ex, fp: [ex.fp[0]] }],
    ['entries not an array', { v: 1, fp: ex.fp, entries: {} }],
    ['an entry not a pair', { v: 1, fp: ex.fp, entries: [...ex.entries, ['x']] }],
    ['bands of 26', { v: 1, fp: ex.fp, entries: [[ex.entries[0][0], ex.entries[0][1].slice(1)]] }],
    ['a band of 4', { v: 1, fp: ex.fp, entries: [[ex.entries[0][0], '4' + ex.entries[0][1].slice(1)]] }],
    ['bands as an array', { v: 1, fp: ex.fp, entries: [[ex.entries[0][0], Array.from(ex.entries[0][1])]] }],
    ['a key of another version', { v: 1, fp: ex.fp, entries: [['2' + ex.entries[0][0].slice(1), ex.entries[0][1]]] }],
    ['a key with 11 weights', { v: 1, fp: ex.fp, entries: [[`1|440|${CHROMA_G.slice(1).join(',')}`, ex.entries[0][1]]] }],
    ['a key with A4 0', { v: 1, fp: ex.fp, entries: [[`1|0|${CHROMA_G.join(',')}`, ex.entries[0][1]]] }],
    ['a key with a negative weight', { v: 1, fp: ex.fp, entries: [[`1|440|-0.1,${CHROMA_G.slice(1).join(',')}`, ex.entries[0][1]]] }],
    ['a key not as String(n) writes it', { v: 1, fp: ex.fp, entries: [[`1|440.0|${CHROMA_G.join(',')}`, ex.entries[0][1]]] }],
    ['a good entry then a bad one', { v: 1, fp: ex.fp, entries: [ex.entries[0], [ex.entries[1][0], 'x']] }],
  ];
  for (const [what, rec] of bad) {
    const e = new BandCache();
    eq([e.import(rec), e.size], [false, 0], `import refuses ${what}, nothing added`);
    refusals++;
  }
  // An entry already cached is kept as it is.
  const e = new BandCache();
  e.ensureSync(songs.slice(0, 1));
  const before = e.get(songs[0]);
  ok(e.import(ex) && e.get(songs[0]) === before && e.size === 6, 'import: a cached entry kept, the rest added');
  // prune to the library's current content keys.
  const kept = c.keysOf(songs.slice(0, 2));
  eq(c.prune(kept), 4, 'prune: the others removed');
  eq([c.size, c.missing(songs.slice(0, 2)), c.missing(songs)], [2, 0, 4], 'prune: the kept ones still there');
  eq(c.keysOf([good({ keyConfidence: 0.1 }), fresh()]).size, 0, 'keysOf: only clear-key tracks');
  c.clear();
  eq([c.size, c.lastWarm], [0, null], 'clear');
}

// ---- v16.8.3 (Track Tuning, M1): a tuned track's key and bands; the Standard ones byte-identical -------------------
let tunedChecks = 0;
{
  const c0 = checks;
  const std = good();
  const v1682Key = `1|${std.chromaA4Hz}|${(std.chroma as number[]).join(',')}`;
  eq(contentKey(std), v1682Key, 'a Standard track: v16.8.2\'s three-part content key, exactly');
  eq(Array.from(songBands(std)), Array.from(bandsOf(std.chroma as number[], std.chromaA4Hz as number)), 'a Standard track: songBands is bandsOf');
  // Garbage in the tuning fields is Standard: the same key, the same bands.
  for (const [what, g] of [['0 cents', { tuneCents: 0, tuneFor: 963 }], ['51 cents', { tuneCents: 51, tuneFor: 963 }], ['2.5 cents', { tuneCents: 2.5, tuneFor: 963 }],
    ['tuneFor 1000', { tuneCents: 10, tuneFor: 1000 }], ['cents alone', { tuneCents: 10 }], ['tuneFor alone', { tuneFor: 963 }], ["'10'", { tuneCents: '10', tuneFor: 963 }]] as const) {
    const x = good(g as never);
    eq(contentKey(x), v1682Key, `garbage (${what}): the Standard key`);
    eq(Array.from(songBands(x)), Array.from(bandsOf(x.chroma as number[], x.chromaA4Hz as number)), `garbage (${what}): the Standard bands`);
  }
  // A tuned track: the suffix, and its bands heard at its rate.
  let differ = 0;
  for (const cents of [-50, -14, -1, 1, 23, 50]) {
    const x = good({ tuneCents: cents, tuneFor: 963 } as never);
    eq(contentKey(x), `${v1682Key}|t${cents}`, `a ${cents}-cent tuning: the key ends in |t${cents}`);
    ok(isTunedKey(contentKey(x)) && !isTunedKey(v1682Key), 'isTunedKey');
    const want = Array.from(bandsWith(x.chroma as number[], x.chromaA4Hz as number, { ...BANDS_DEF, heard: tuneRate(cents) }));
    eq(Array.from(songBands(x)), want, `a ${cents}-cent tuning: the definition heard at tuneRate(${cents})`);
    eq(contentKey({ ...x, tuneFor: 174 }), contentKey(x), 'the key reads the cents, not the crystal it was chosen for');
    if (want.join('') !== Array.from(songBands(std)).join('')) differ++;
  }
  ok(differ > 0, `a tuning changes the bands (${differ} of 6 tunings)`);
  // The cache: a tuned track gets its own key and bands; the record never holds one.
  const cache = new BandCache();
  const a = good(), b = good({ chromaA4Hz: 437.5 }), at = { ...a, tuneCents: -14, tuneFor: 963 } as KeySong;
  cache.ensureSync([a, b, at]);
  eq([cache.size, cache.missing([a, b, at])], [3, 0], 'the cache: the tuned track is its own entry');
  eq(Array.from(cache.get(at)!), Array.from(songBands(at)), 'get: a tuned track\'s own bands');
  ok(cache.get(a) !== cache.get(at), 'get: the Standard entry stays apart');
  const ex = cache.export();
  eq(ex.entries.map((e) => e[0]).sort(), [contentKey(a), contentKey(b)].sort(), 'export: never a tuned entry');
  ok(ex.entries.every(([k]) => k.split('|').length === 3), 'export: v16.8.2\'s three-part keys only');
  const back = new BandCache();
  ok(back.import(ex) && back.size === 2 && back.missing([a, b]) === 0 && back.missing([at]) === 1, 'import: the Standard entries; the tuned one is made again (missing 1)');
  const withTuned = { ...ex, entries: [...ex.entries, [contentKey(at), Array.from(songBands(at)).join('')]] };
  eq([new BandCache().import(withTuned)], [false], 'import: a record holding a tuned entry is refused (v16.8.2\'s reader)');
  refusals++;
  // validKey: the suffix in memory only.
  ok(validKey(contentKey(a)) && validKey(contentKey(a), true), 'validKey: a Standard key, persisted or in memory');
  ok(!validKey(contentKey(at)) && validKey(contentKey(at), true), 'validKey: a tuned key in memory only');
  for (const suffix of ['t0', 't51', 't-51', 't2.5', 't+5', 't-0', 't05', 'x5', 't', '']) ok(!validKey(`${contentKey(a)}|${suffix}`, true), `validKey: "|${suffix}" is not a tuning`);
  // A retune makes a new key for that track alone; every other entry stays the same object.
  const lib = [good(), good({ chromaA4Hz: 436.5 }), good({ chromaA4Hz: 441.2 }), good({ chromaA4Hz: 443 })];
  const c2 = new BandCache();
  c2.ensureSync(lib);
  const before = new Map([...c2.map]);
  const retuned = lib.map((x, i) => (i === 2 ? { ...x, tuneCents: 31, tuneFor: 528 } : x));
  eq(c2.missing(retuned), 1, 'a retune: one track to warm');
  eq(c2.ensureSync(retuned), 1, 'a retune: one content key made');
  ok([...before].every(([k, v]) => c2.map.get(k) === v), 'a retune: every entry before is the same object');
  eq([...c2.map.keys()].filter((k) => !before.has(k)), [contentKey(retuned[2])], 'a retune: the new key is that track\'s tuned one');
  // The memo sees a tuning written onto the same object (a check's mutation; the app patches a new object).
  const m = good();
  const k0 = c2.keyOf(m);
  (m as Record<string, unknown>).tuneCents = -7;
  (m as Record<string, unknown>).tuneFor = 852;
  eq(c2.keyOf(m), `${k0}|t-7`, 'keyOf: the memo reads the tuning too');
  // Fix round 1 (P01): warm, App's only fill path, makes exactly ensureSync's keys and bands on a tuned library (Standard,
  // tuned, a Lo Shu tuning, garbage), each its songBands.
  {
    const lib2 = [good(), good({ chromaA4Hz: 436.5, tuneCents: -23, tuneFor: 852 }), good({ chromaA4Hz: 441.2, tuneCents: 31, tuneFor: 528 }), good({ chromaA4Hz: 443 }),
      good({ chromaA4Hz: 438, tuneCents: 50, tuneFor: 174, tuneLoShu: true }), good({ chromaA4Hz: 439, tuneCents: 51, tuneFor: 963 }), good({ chromaA4Hz: 436.5, tuneCents: -1, tuneFor: 963 })];
    const viaSync = new BandCache();
    viaSync.ensureSync(lib2);
    const viaWarm = new BandCache();
    let clk = 0;
    const r = await viaWarm.warm(lib2, { sliceMs: 5, yieldFn: async () => {}, now: () => (clk += 2) });
    eq([...viaWarm.map.keys()].sort(), [...viaSync.map.keys()].sort(), 'P01: warm makes the content keys ensureSync makes, on a tuned library');
    eq([viaWarm.missing(lib2), r.cancelled, r.added], [0, false, viaSync.size], 'P01: warm leaves nothing missing, uncancelled, every key made once');
    for (const x of lib2) eq(Array.from(viaWarm.get(x)!), Array.from(songBands(x)), `P01: warm: ${contentKey(x).split('|').slice(3).join('|') || 'Standard'} has its songBands`);
    for (const x of lib2) eq(Array.from(viaWarm.get(x)!), Array.from(viaSync.get(x)!), 'P01: warm and ensureSync give the same bands');
  }
  tunedChecks = checks - c0;
}

Math.random = realRandom;
console.log(`keyBands.check: ${checks} checks passed (v16.8.3: ${tunedChecks} on tuned keys and bands) (clearKey ${arms.length} arms, awaitingKey ${waits.length}, bandsOf ${INPUTS.length} fixed inputs by hand and pinned, contentKey, the cache: get, missing, warm with cancel, export/import with ${refusals} refusals, prune)`);
