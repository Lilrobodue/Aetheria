// v15.8 golden harness: the deterministic synthetic fixtures (no real names anywhere; a seeded PRNG, never
// Math.random, so two runs build byte-identical fixtures).
//
// F160 is the main fixture: 160 tracks covering every branch the mix recipes take:
//   - 27 crystals with uneven counts: 852 and 4212 have NO track (walk gaps → the cube drift), 1449 has one (a CAB
//     trio repeats it), 2421 two, 2178 nine (CABI's six SOURCE visits get distinct picks), the 111 Sequence's nine
//     "first frequencies" four or more each;
//   - 120 scanned tracks (harmonicFreq + closestSolfeggio + harmonicDeviation), 2 with a crystal but no harmonicFreq
//     (Auto-Distribute treats them as unscanned), 38 unscanned whose names hit every branch of Auto-Distribute's
//     name heuristic (and two precedence cases), with durations 0 / missing / <120 / 120–300 / >300;
//   - harmonicDeviation 0 (which `|| 999` sorts LAST), missing, 999, and ties inside the 0.1 thresholds;
//   - fractalAnalysis on ~3/4 of scanned tracks: golden ratio around the 0.3 cut and tied within 0.1, 111 presence
//     tied within 0.05, DNA, sacred geometry 0 (pre-fix) or > 0 (2178's mixed, so SOURCE ranks by geometry);
//   - ids in a shuffled timestamp order, so the walks' id tiebreak differs from library order;
//   - six tracks flagged `collection: k` (k = an index into the Collection title list that only App.tsx holds): the
//     harness gives them their in-memory names at run time, never in a file.
// Variants: F160g (2178's geometry all 0), F160d (two tracks twice), F26 (one per crystal, 852 missing), FGUT (GUT
// crystals only), F3 (three unscanned), F0 (empty), F160u (160 unscanned), F111gap (F160 with the 111 Sequence's
// First order unscanned), FLEG (a v15.7 library replayed with v15.7's own code: Deep Scan, the old Auto-Distribute,
// later imports and scans; stored as data in fixtures-fleg.json, synthetic names, with each track's true history).

import { readFileSync } from 'node:fs';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTS = {
  174: 6, 285: 5, 396: 6, 417: 4, 528: 8, 639: 5, 741: 6, 852: 0, 963: 4,
  1206: 5, 1449: 1, 1692: 4, 1935: 5, 2178: 9, 2421: 2, 2664: 5, 2907: 4, 3150: 4,
  3504: 5, 3858: 4, 4212: 0, 4566: 5, 4920: 6, 5274: 4, 5628: 5, 5982: 4, 6336: 4,
};
export const CRYSTALS = Object.keys(COUNTS).map(Number);

const DEV = [0, 0.05, 0.08, 0.15, 0.5, 1.2, 3.33, 7.9, 12, 25, 48, 99, 999, undefined, 0, 0.12, 2.0, 2.05];
const GOLD = [0.05, 0.12, 0.2, 0.29, 0.3, 0.301, 0.31, 0.35, 0.42, 0.42, 0.5, 0.61, 0.7, 0.705, 0.88, 0.395];
const P111 = [0.1, 0.12, 0.14, 0.3, 0.33, 0.6, 0.62, 0.8, 0.05, 0.5];
const DNA = [0.2, 0.25, 0.4, 0.45, 0.46, 0.7, 0.9, 0.31, 0.1];
const GEOM = [0, 0, 0.004, 0.2, 0.205, 0.5, 0, 0.75, 0.3, 0.31, 0.009];
const UNSCANNED = [
  'bass-walk', 'low-hum', 'sub-drop', 'vocal-take', 'voice-memo', 'sing-along', 'guitar-loop', 'string-bed',
  'piano-sketch', 'key-change', 'drum-room', 'kick-test', 'snare-roll', 'lead-line', 'melody-idea', 'pad-wash',
  'atmosphere-one', 'ambient-field', 'high-shimmer', 'treble-air', 'cymbal-swell', 'hi-hat-tick',
  'bass-vocal', 'pad-high', // precedence: the earlier branch wins
  'tone-a', 'tone-b', 'tone-c', 'tone-d', 'tone-e', 'tone-f', 'tone-g', 'tone-h', 'tone-i', 'tone-j', 'tone-k',
  'tone-l', 'tone-m', 'tone-n',
];
const DURS = [0, undefined, 45, 119, 120, 121, 200, 300, 301, 600, 240, 95];

function song(id, name, extra = {}) {
  return { id, name, file: { name: name + '.wav', size: 1000 + name.length * 17, type: 'audio/wav' }, ...extra };
}

export function buildF160() {
  const r = mulberry32(158);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const specs = [];
  let n = 0;
  for (const c of CRYSTALS) {
    for (let k = 0; k < COUNTS[c]; k++) {
      n++;
      const s = { name: `mix-${String(n).padStart(3, '0')}`, duration: 120 + Math.round(r() * 420) };
      s.harmonicFreq = +(c * (0.5 + r()) ).toFixed(3);
      s.closestSolfeggio = c;
      const dev = pick(DEV);
      if (dev !== undefined) s.harmonicDeviation = dev;
      if (n % 4 !== 0) {
        s.fractalAnalysis = {
          dominantFrequency: s.harmonicFreq,
          goldenRatioAlignment: pick(GOLD),
          pattern111Presence: pick(P111),
          dnaResonanceScore: pick(DNA),
          sacredGeometryAlignment: pick(GEOM),
        };
      }
      specs.push(s);
    }
  }
  // Two tracks with a crystal but no harmonicFreq (Auto-Distribute gives them a placeholder; walks still use them).
  specs.push({ name: 'mix-121', duration: 200, closestSolfeggio: 963, harmonicDeviation: 4 });
  specs.push({ name: 'mix-122', duration: 330, closestSolfeggio: 3858, fractalAnalysis: { dominantFrequency: 3858, goldenRatioAlignment: 0.9, pattern111Presence: 0.2, dnaResonanceScore: 0.3, sacredGeometryAlignment: 0.1 } });
  UNSCANNED.forEach((nm, i) => {
    const d = DURS[i % DURS.length];
    const s = { name: nm };
    if (d !== undefined) s.duration = d;
    specs.push(s);
  });
  if (specs.length !== 160) throw new Error('F160 has ' + specs.length);
  // Library order: a seeded shuffle, then the first five forced to plain scanned tracks (Golden's Details lists the
  // first five names).
  const order = specs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // Ids: timestamps in a different shuffled order, base36 suffix.
  const stamps = specs.map((_, i) => 1761000000000 + i * 1000);
  for (let i = stamps.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [stamps[i], stamps[j]] = [stamps[j], stamps[i]];
  }
  const lib = order.map((si, pos) => {
    const s = specs[si];
    const id = `${stamps[pos]}-${Math.floor(r() * 36 ** 6).toString(36).padStart(6, '0')}`;
    const { name, ...rest } = s;
    return song(id, name, rest);
  });
  // Six Collection-flagged scanned tracks, all past position 5.
  const flaggable = lib.map((s, i) => [s, i]).filter(([s, i]) => i >= 8 && s.closestSolfeggio && s.harmonicFreq);
  const step = Math.floor(flaggable.length / 6);
  for (let k = 0; k < 6; k++) flaggable[k * step][0].collection = (k * 5 + 2) % 26;
  return lib;
}

export function buildFixtures() {
  const F160 = buildF160();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const F160g = clone(F160).map((s) => (s.closestSolfeggio === 2178 && s.fractalAnalysis ? { ...s, fractalAnalysis: { ...s.fractalAnalysis, sacredGeometryAlignment: 0 } } : s));
  const F160d = clone(F160);
  // Two tracks twice (the harness makes each the SAME object again): a scanned 2178 and a 528, so the generators that
  // keep duplicates (Full, the presets, Golden, SOURCE) and Auto-Distribute's dedupe both show.
  for (const c of [2178, 528]) F160d.push('__dup__:' + F160d.findIndex((s) => s.closestSolfeggio === c && s.fractalAnalysis));
  const F26 = CRYSTALS.filter((c) => c !== 852).map((c, i) => song(`17620000${String(i).padStart(5, '0')}-f26${i}`, `one-${String(i + 1).padStart(2, '0')}`, { duration: 180, harmonicFreq: c, closestSolfeggio: c, harmonicDeviation: (i % 5) * 0.7, fractalAnalysis: { dominantFrequency: c, goldenRatioAlignment: 0.31 + (i % 4) * 0.1, pattern111Presence: 0.2, dnaResonanceScore: 0.3, sacredGeometryAlignment: i % 2 ? 0.2 : 0 } }));
  // GUT only (three per GUT crystal, two thirds scanned deeply): Ultimate's and 111's no-high-crystal timings, Full
  // Alignment without its notice, HEART/HEAD not found.
  const FGUT = CRYSTALS.slice(0, 9).flatMap((c, i) => [0, 1, 2].map((k) => song(`17640000${String(i * 3 + k).padStart(5, '0')}-g${i}${k}`, `gut-${String(i * 3 + k + 1).padStart(2, '0')}`, { duration: 150 + k * 90, harmonicFreq: c * (1 + k / 10), closestSolfeggio: c, harmonicDeviation: [0, 1.5, 7][k], ...(k < 2 ? { fractalAnalysis: { dominantFrequency: c, goldenRatioAlignment: [0.2, 0.45, 0.31][(i + k) % 3], pattern111Presence: [0.3, 0.1, 0.32][(i + k) % 3], dnaResonanceScore: 0.4, sacredGeometryAlignment: 0 } } : {}) })));
  const F3 = ['three-a', 'three-b', 'three-c'].map((nm, i) => song(`1763000000${i}-f3${i}`, nm, { duration: 2 }));
  const F0 = [];
  const F160u = clone(F160).map((s) => {
    const { harmonicFreq, closestSolfeggio, harmonicDeviation, fractalAnalysis, ...rest } = s;
    return rest;
  });
  // The 111 Sequence with its First order unscanned (174's tracks lose their fractal analysis): its message's labels.
  const F111gap = clone(F160).map((s) => (s.closestSolfeggio === 174 ? (({ fractalAnalysis, ...rest }) => rest)(s) : s));
  // A legacy library (v15.7 history replayed: Deep Scan, the old Auto-Distribute, later imports and scans), for Assign.
  const FLEG = JSON.parse(readFileSync(new URL('./fixtures-fleg.json', import.meta.url), 'utf8')).library;
  return { F160, F160g, F160d, F26, FGUT, F3, F0, F160u, F111gap, FLEG };
}

/** A play history H1 over 50 scanned F160 tracks: ties (same timestamp) and distinct times. */
export function buildHistory(lib) {
  const r = mulberry32(4242);
  const h = {};
  const scanned = lib.filter((s) => s.closestSolfeggio);
  const times = [1000, 2000, 2000, 3000, 4000, 4000, 4000, 5000, 6000, 7000];
  for (let i = 0; i < scanned.length; i += 2) {
    if (Object.keys(h).length >= 50) break;
    h[scanned[i].id] = times[Math.floor(r() * times.length)];
  }
  return h;
}

/** FLEG's replayed history per track id: 'scan', 'scan-replaced', 'placeholder', 'scan-failed-then-AD' or 'none'. */
export function flegTruth() {
  return JSON.parse(readFileSync(new URL('./fixtures-fleg.json', import.meta.url), 'utf8')).truth;
}
