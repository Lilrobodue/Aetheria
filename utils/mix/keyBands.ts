// utils/mix/keyBands.ts (v16.8.2 "Key placement"): how a track's measured key fits each crystal's tone, in four bands.
//
//   clearKey(s)            the track has key data Assign may place it by (decision K3)
//   awaitingKey(s)         it could have one but hasn't been analysed by this CHROMA_VERSION yet (the Crystals row's
//                          sub-line, K4)
//   bandsOf(chroma, a4)    27 bands, in ALL_CRYSTALS order: Key fit's own rel of the crystal's canonical tone against the
//                          track's chroma, cut at KEY_EDGES (0 fits .. 3 the full 6 dB clash)
//   contentKey(s)          what the bands depend on, exactly as stored (the cache's key)
//   BandCache              the bands by content: read synchronously (get), filled only by warm (sliced) or ensureSync
//
// The spread (distribution.ts planAssign(lib, 'spread', { bands })) compares a track's band on a crystal before Deep
// Scan's compatibility, so a track with a clear key goes first to the crystals whose tone fits it; a track without one
// gets NEUTRAL_BAND everywhere and is placed exactly as before (decisions U1, K1, K2).
//
// The same file gives the same bands on every device (U4, K5): the tones are the canonical Solfeggio, HEART and HEAD
// crystals' (never the per-device Lo Shu Perfect GUT tones, never the phone speaker's), heard at the stored chromaA4Hz
// times the app's one retune; and only the key data a phone can make counts (the 720 s / 100 MiB caps below).
//
// Pure: no DOM, no React, no storage (App persists the cache's export through utils/playlistCache.ts). Erasable
// TypeScript only, so Node runs keyBands.check.ts on it directly.

import { musicFit, toneOf, CLARITY_LO } from '../soundV2/aetheria_sound_v2.ts';
import { hasKeyData } from '../soundV2/keyFit.ts';
import { canonicalLayerHz } from '../soundV2/layerHost.ts';
import { CHROMA_VERSION } from '../soundV2/keyAnalysis.ts';
import { PITCH_SHIFT_FACTOR } from '../../constants.ts';
import { ALL_CRYSTALS, NEUTRAL_BAND, keyRanks } from './distribution.ts';
import type { AssignOptions, AssignSong } from './distribution.ts';

/** The band edges on Key fit's rel (K1): rel <= 0.35 fits (no duck), <= 0.55 under 3 dB, <= 0.75 3 to 6 dB, above it
 *  the full 6 dB clash. */
export const KEY_EDGES: readonly number[] = [0.35, 0.55, 0.75];
/** The band a track with no clear key has on every crystal (0.5, fix round 1): after the fitting tracks, before the
 *  partly fitting ones. With it everywhere the spread is v16.8.1's, patch for patch. The planner owns it
 *  (distribution.ts, which can't import this module: it would bring the analyser into every mix check). */
export { NEUTRAL_BAND };
/** Bump it whenever the edges, the tones, the heard pitch or the analyser's CHROMA_VERSION change: every cached and
 *  persisted band is then made again (it is part of contentKey, and BandCache.import refuses another). */
export const KEY_BANDS_VERSION = 1;
/**
 * The 8 GB phone's Analyse tracks caps (utils/library/analysePass.ts capsFor: 720 s and 100 MiB, deviceMemory > 4),
 * applied on EVERY device. A desktop analyses up to 1,800 s and 1 GiB (and its Deep Scan key step has no byte cap),
 * so a longer or larger track would have key data on the PC and none on the phone, and the two would place it, and
 * through the fill everything after it, differently (survey §1.3, measure/results.md Q5: 66 of 270 tracks moved without
 * this rule, 0 with it). So placement reads key data only for what the phone can analyse too. (A <= 4 GB phone's caps
 * are lower; the user's phones are both 8 GB class.)
 */
export const KEY_MAX_SECONDS = 720;
export const KEY_MAX_BYTES = 100 * 2 ** 20;

/** What the rule reads of a track (a Song, a LibSong, a check's fixture). */
export interface KeySong {
  chroma?: unknown;
  chromaA4Hz?: number;
  musicKey?: string;
  keyConfidence?: number;
  chromaVersion?: number;
  analysisFailedV?: number;
  duration?: number;
  file?: { readonly size?: number } | null;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Within the phone's caps: a stored length, finite, above 0 and at most KEY_MAX_SECONDS (an unknown length is not:
 *  lengths still being read hold the plan, so this only leaves out files whose length can't be read), and the file's
 *  size (what fileKey reads, file.size; a restored track's File carries its blob's) at most KEY_MAX_BYTES. */
export function withinKeyLimits(s: KeySong): boolean {
  const d = s.duration;
  if (!fin(d) || d <= 0 || d > KEY_MAX_SECONDS) return false;
  const size = s.file ? s.file.size : undefined;
  return fin(size) && size >= 0 && size <= KEY_MAX_BYTES;
}

/** K3: a clear key, which placement may use. Every one of: key data of this CHROMA_VERSION; Key fit's own gate
 *  (hasKeyData: 12 finite non-negative weights with a positive sum, and a finite chromaA4Hz > 0); a key name; a
 *  confidence of at least CLARITY_LO (0.45, where Key fit starts to act); within the phone's caps. Total. */
export function clearKey(s: KeySong | null | undefined): boolean {
  if (!s || typeof s !== 'object') return false;
  if (s.chromaVersion !== CHROMA_VERSION) return false;
  if (!hasKeyData(s)) return false;
  if (typeof s.musicKey !== 'string' || s.musicKey === '') return false;
  if (!fin(s.keyConfidence) || s.keyConfidence < CLARITY_LO) return false;
  return withinKeyLimits(s);
}

/** K4: not clear only because this CHROMA_VERSION hasn't analysed it yet: within the phone's caps, and not given up on
 *  by Analyse tracks (analysisFailedV at this version). Analyse tracks would give it key data. */
export function awaitingKey(s: KeySong | null | undefined): boolean {
  if (!s || typeof s !== 'object') return false;
  return s.chromaVersion !== CHROMA_VERSION && s.analysisFailedV !== CHROMA_VERSION && withinKeyLimits(s);
}

/** Each crystal's canonical tone, as Key fit plays and scores it (keyFit.ts keyFitFor: toneOf(canonical Hz, output)),
 *  on the Solfeggio GUT scale (canonicalLayerHz(f, false): never Lo Shu's Perfect GUT, a per-device setting) and for
 *  headphones (never the phone speaker's floor, another per-device choice). K5. */
const TONES: readonly number[] = ALL_CRYSTALS.map((f) => toneOf(canonicalLayerHz(f, false).f, 'headphones'));

/** Fix round 2 (R5.5): what the bands are made with, in one place: the band edges, each crystal's tone and the heard
 *  pitch (the factor on chromaA4Hz). bandsOf is bandsWith(…, BANDS_DEF); the fingerprint is computed from a definition
 *  (fingerprintOf), so a check can show it would see a changed one. */
export interface BandsDef { readonly edges: readonly number[]; readonly tones: readonly number[]; readonly heard: number }
export const BANDS_DEF: BandsDef = { edges: KEY_EDGES, tones: TONES, heard: PITCH_SHIFT_FACTOR };

/** The band of one rel on `edges`: 0 at or under edges[0], .. 3 above the last. A rel that isn't a number (musicFit
 *  never gives one for data hasKeyData passes) reads as the clash. */
function bandOn(rel: number, edges: readonly number[]): number {
  if (!fin(rel)) return edges.length;
  let b = 0;
  while (b < edges.length && rel > edges[b]) b++;
  return b;
}
/** The band of one rel on KEY_EDGES. */
export function bandOfRel(rel: number): number {
  return bandOn(rel, KEY_EDGES);
}

/**
 * The 27 bands of a track's key data, in ALL_CRYSTALS order: musicFit's rel of each crystal's canonical tone against
 * the chroma, the track heard at chromaA4Hz × PITCH_SHIFT_FACTOR (constants.ts: every track plays varispeed at it, so
 * its notes are heard that much lower; Key fit's own a4Heard). v16.8.3 will make the retune per track: it must feed
 * this, the same on every device, with a KEY_BANDS_VERSION bump.
 */
export function bandsOf(chroma: readonly number[], chromaA4Hz: number): Uint8Array {
  return bandsWith(chroma, chromaA4Hz, BANDS_DEF);
}
/** The 27 bands under another definition (the fingerprint's checks; the app uses bandsOf). */
export function bandsWith(chroma: readonly number[], chromaA4Hz: number, def: BandsDef): Uint8Array {
  const out = new Uint8Array(def.tones.length);
  const a4 = chromaA4Hz * def.heard;
  for (let i = 0; i < def.tones.length; i++) out[i] = bandOn(musicFit(def.tones[i], chroma as number[], a4).rel, def.edges);
  return out;
}

/** What the bands depend on, exactly as stored: the version, the A4 and the 12 weights (their own decimal text). */
export function contentKey(s: { chroma?: unknown; chromaA4Hz?: number }): string {
  return `${KEY_BANDS_VERSION}|${s.chromaA4Hz}|${(s.chroma as number[]).join(',')}`;
}

/** The persisted form (App's 'keyBands:v1' record holds it): each content key with its 27 bands as digits, and (fix
 *  round 1, A-N11 / L-N4) the fingerprint: the bands of FINGERPRINT_INPUTS as this release computes them. */
export interface KeyBandsExport {
  v: number;
  fp: string[];
  entries: [string, string][];
}
/** Fixed chromas and A4s (synthetic). Their bands, recomputed at import, catch a definition changed without a
 *  KEY_BANDS_VERSION bump (the tones, the edges, the retune): the whole record is refused and made again. Fix round 2
 *  (R5.5): the first two were picked (fix2/fp-search.ts) so that each sees a retune of 0.5 cent either way and an edge
 *  moved by 0.005 either way (keyBands.check shows it); the last two are fix round 1's. */
export const FINGERPRINT_INPUTS: ReadonlyArray<readonly [readonly number[], number]> = [
  [[0.0131, 0.1255, 0.0772, 0.0136, 0.269, 0.0116, 0.0979, 0.0101, 0.1033, 0.1776, 0.0058, 0.0951], 441.51],
  [[0.0065, 0.2255, 0.128, 0.0145, 0.0642, 0.0106, 0.2403, 0.0137, 0.0995, 0.136, 0.0161, 0.0451], 431.89],
  [[0.1211, 0.0123, 0.0954, 0.0187, 0.1032, 0.0811, 0.0245, 0.1702, 0.0161, 0.0988, 0.0204, 0.2382], 440],
  [[0.0712, 0.0098, 0.0856, 0.0143, 0.1655, 0.0731, 0.0126, 0.0814, 0.0109, 0.3021, 0.0152, 0.1583], 432.61],
];
/** The fingerprint of a definition: the version first (fix round 2, R5.5: a deliberate change to the bands' rule bumps
 *  KEY_BANDS_VERSION, which refuses the record even where the inputs' bands happen not to change); then (fix round 3,
 *  F4) the definition's own values, each written with String(n), so any change to an edge, the heard factor or a tone
 *  is seen however small; then the bands of each FINGERPRINT_INPUTS entry as digits, for a change to musicFit's code. */
export function fingerprintOf(def: BandsDef): string[] {
  return [
    `v${KEY_BANDS_VERSION}`,
    `edges ${def.edges.map(String).join(' ')}`,
    `heard ${String(def.heard)}`,
    `tones ${def.tones.map(String).join(' ')}`,
    ...FINGERPRINT_INPUTS.map(([c, a]) => Array.from(bandsWith(c, a, def)).join('')),
  ];
}
let fingerprintMemo: string[] | null = null;
/** This release's fingerprint: fingerprintOf(BANDS_DEF), computed once. */
export function bandsFingerprint(): string[] {
  if (!fingerprintMemo) fingerprintMemo = fingerprintOf(BANDS_DEF);
  return fingerprintMemo;
}
export interface WarmOptions {
  /** Work this long between yields (the analyser's: 5 ms on a phone, 8 on a desktop). */
  sliceMs: number;
  /** Awaited between slices with the slice's work ms (App's: a MessageChannel round trip, parked while a phone's page
   *  is hidden). */
  yieldFn: (workMs: number) => Promise<void>;
  /** Checked before the first slice and after every yield: true stops the warm (what it made so far is kept). */
  shouldCancel?: () => boolean;
  /** After every slice: the clear-key tracks of `songs` still without bands. */
  onProgress?: (left: number) => void;
  now?: () => number;
}
export interface WarmResult {
  /** Content keys made. */
  added: number;
  /** Stopped by shouldCancel before it was done. */
  cancelled: boolean;
  /** Work ms (the bands themselves, yields excluded), and per content key made (0 when none). */
  ms: number;
  msPerTrack: number;
}

const BANDS_RE = /^[0-3]{27}$/;
const exactNumber = (t: string): boolean => t !== '' && fin(Number(t)) && String(Number(t)) === t;
/** A content key of this version: the version, an A4 above 0 and 12 non-negative weights, each as String(n) writes it. */
function validKey(k: unknown): boolean {
  if (typeof k !== 'string') return false;
  const parts = k.split('|');
  if (parts.length !== 3 || parts[0] !== String(KEY_BANDS_VERSION)) return false;
  if (!exactNumber(parts[1]) || !(Number(parts[1]) > 0)) return false;
  const w = parts[2].split(',');
  return w.length === 12 && w.every((x) => exactNumber(x) && Number(x) >= 0);
}

/**
 * The bands by content (K6). get(s) is synchronous and never computes: a track with no clear key gets null, and so
 * does a clear-key track not warmed yet (callers never plan while missing(songs) > 0: the Assign press warms first,
 * the health card's plan is held). Bands are made only by warm (sliced, cancellable) or ensureSync (the checks).
 */
export class BandCache {
  map: Map<string, Uint8Array> = new Map();
  /** The latest warm's figures (the dev hook reports them), or null before one made anything. */
  lastWarm: WarmResult | null = null;
  /** contentKey per track object (a patch makes a new object), checked against the fields it was made from. */
  memo: WeakMap<object, { a4: unknown; chroma: unknown; key: string }> = new WeakMap();

  keyOf(s: KeySong): string {
    const m = this.memo.get(s as object);
    if (m && m.a4 === s.chromaA4Hz && m.chroma === s.chroma) return m.key;
    const key = contentKey(s);
    this.memo.set(s as object, { a4: s.chromaA4Hz, chroma: s.chroma, key });
    return key;
  }

  /** The cached bands of a clear-key track, or null (no clear key, or not cached). The spread's provider. */
  get = (s: KeySong): Uint8Array | null => {
    if (!clearKey(s)) return null;
    return this.map.get(this.keyOf(s)) ?? null;
  };

  /** Fix round 2 (R1): a track's ranks for the spread, keyRanks of its cached bands (distribution.ts NEUTRAL_BAND has
   *  the rule: a track that fits no crystal gets FIT_NOWHERE_BAND on its best ones), each made once per bands array. */
  rankMemo: WeakMap<Uint8Array, ArrayLike<number>> = new WeakMap();
  ranks = (s: KeySong): ArrayLike<number> | null => {
    const b = this.get(s);
    if (!b) return null;
    let r = this.rankMemo.get(b);
    if (!r) this.rankMemo.set(b, (r = keyRanks(b)));
    return r;
  };

  /** What every spread in the app is planned with (planAssign(lib, 'spread', cache.planOptions)): this cache's ranks
   *  (fix round 2, R1: its bands by NEUTRAL_BAND's rule), and awaitingKey for the plan's count. One object, so every
   *  caller passes the same provider. */
  planOptions: AssignOptions = { bands: this.ranks as (s: AssignSong) => ArrayLike<number> | null, awaiting: awaitingKey as (s: AssignSong) => boolean };

  /** The clear-key tracks of `songs` whose bands aren't cached. */
  missing(songs: readonly KeySong[]): number {
    let n = 0;
    for (const s of songs) if (clearKey(s) && !this.map.has(this.keyOf(s))) n++;
    return n;
  }

  /** The content keys of the clear-key tracks of `songs` (what a prune keeps). */
  keysOf(songs: readonly KeySong[]): Set<string> {
    const keys = new Set<string>();
    for (const s of songs) if (clearKey(s)) keys.add(this.keyOf(s));
    return keys;
  }

  get size(): number {
    return this.map.size;
  }

  /** The missing bands of `songs`, one content key at a time, sliceMs of work between yields. */
  async warm(songs: readonly KeySong[], o: WarmOptions): Promise<WarmResult> {
    const now = o.now ?? (() => performance.now());
    // (Fix round 1, A-SF4 / L-S2: the clear-key tracks still missing are counted here, once, and each content key made
    // takes its tracks off: onProgress never walks the library again, so a warm stays O(n).)
    const todo: KeySong[] = [];
    const tracksOf = new Map<string, number>();
    let left = 0;
    for (const s of songs) {
      if (!clearKey(s)) continue;
      const k = this.keyOf(s);
      if (this.map.has(k)) continue;
      left++;
      const n = tracksOf.get(k);
      if (n === undefined) { tracksOf.set(k, 1); todo.push(s); } else tracksOf.set(k, n + 1);
    }
    let added = 0, ms = 0;
    const done = (cancelled: boolean): WarmResult => {
      const r = { added, cancelled, ms, msPerTrack: added ? ms / added : 0 };
      if (added) this.lastWarm = r;
      return r;
    };
    if (o.shouldCancel && o.shouldCancel()) return done(true);
    let i = 0;
    while (i < todo.length) {
      const t0 = now();
      do {
        const s = todo[i++];
        const k = this.keyOf(s);
        if (!this.map.has(k)) {
          this.map.set(k, bandsOf(s.chroma as number[], s.chromaA4Hz as number));
          added++;
        }
        left -= tracksOf.get(k) ?? 0;
      } while (i < todo.length && now() - t0 < o.sliceMs);
      const work = now() - t0;
      ms += work;
      if (o.onProgress) o.onProgress(Math.max(0, left));
      if (i >= todo.length) break;
      await o.yieldFn(work);
      if (o.shouldCancel && o.shouldCancel()) return done(true);
    }
    return done(false);
  }

  /** Every missing band of `songs`, now (the checks and the golden; App always warms). The content keys made. */
  ensureSync(songs: readonly KeySong[]): number {
    let added = 0;
    for (const s of songs) {
      if (!clearKey(s)) continue;
      const k = this.keyOf(s);
      if (this.map.has(k)) continue;
      this.map.set(k, bandsOf(s.chroma as number[], s.chromaA4Hz as number));
      added++;
    }
    return added;
  }

  /** Keep only these content keys (App: the library's own, before it writes the record). The entries removed. */
  prune(keep: ReadonlySet<string>): number {
    let removed = 0;
    for (const k of [...this.map.keys()]) if (!keep.has(k)) { this.map.delete(k); removed++; }
    return removed;
  }

  clear(): void {
    this.map.clear();
    this.lastWarm = null;
  }

  export(): KeyBandsExport {
    return { v: KEY_BANDS_VERSION, fp: [...bandsFingerprint()], entries: [...this.map.entries()].map(([k, b]): [string, string] => [k, Array.from(b).join('')]) };
  }

  /** A persisted record, validated whole: another KEY_BANDS_VERSION, another fingerprint, a malformed entry or a shape that isn't one is
   *  refused (false, nothing added: App ignores the record and the warm makes the bands again). Entries already cached
   *  are kept as they are. */
  import(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const r = obj as { v?: unknown; fp?: unknown; entries?: unknown };
    if (r.v !== KEY_BANDS_VERSION || !Array.isArray(r.entries)) return false;
    // (Fix round 1: the fingerprint, recomputed: another definition of the bands refuses the whole record.)
    const fp = bandsFingerprint();
    if (!Array.isArray(r.fp) || r.fp.length !== fp.length || r.fp.some((x, i) => x !== fp[i])) return false;
    const parsed: [string, Uint8Array][] = [];
    for (const e of r.entries) {
      if (!Array.isArray(e) || e.length !== 2 || !validKey(e[0]) || typeof e[1] !== 'string' || !BANDS_RE.test(e[1])) return false;
      parsed.push([e[0], Uint8Array.from(e[1], (c) => c.charCodeAt(0) - 48)]);
    }
    for (const [k, b] of parsed) if (!this.map.has(k)) this.map.set(k, b);
    return true;
  }
}
