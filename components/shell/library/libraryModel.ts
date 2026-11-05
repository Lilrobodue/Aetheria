// components/shell/library/libraryModel.ts (v15.7, the Library tab)
//
// The Library tab's pure rules and words: the sort (saved as aetheria.librarySort.v1, from the select only), the
// search, a row's facts, the order a row tap plays and how its Undo rebuilds the earlier one, Track info's rows, the
// health card's counts and lines, and the Import sheet's words. Free of React and of the app's state; every helper is
// total (NaN, ±Infinity, negatives, empty and unknown values give a string or a safe value). Node checks it directly
// (libraryModel.check.ts, `npm run check:shell`): erasable TypeScript, imports with their .ts extension.
//
// The data-safety rule (spec §3.4): nothing here writes anything. libraryOrderFor and rebuildOrder build play orders
// from the LIBRARY's own Song objects, by id, so an order made here never holds a track the library doesn't, and an
// Undo never brings back a stale copy of a track's metadata.

import { formatTime, formatTotal, regimeName, regimeOf } from '../shellModel.ts';
import { passButtonText, passEta, passEtaMinutes } from '../../../utils/library/analysePass.ts';
import type { PassProgress } from '../../../utils/library/analysePass.ts';
import { CHROMA_VERSION } from '../../../utils/soundV2/keyAnalysis.ts';
import { BUSY_EXPORT, BUSY_STOPPING, BUSY_STOPPING_LONG } from '../../../utils/export/exportWords.ts';
import { ALL_CRYSTALS, crystalOrigin, deepScanQueue, readByDeepScan, scanCrystalChanged, spreadFromScan, spreadRole } from '../../../utils/mix/distribution.ts';
import { SOURCE_FREQ } from '../../../utils/crystalData.ts';
import type { CrystalSource } from '../../../utils/mix/distribution.ts';

/** What the tab reads of a track (types.ts Song; `file` only for Track info). */
export interface LibSong {
  id: string;
  name: string;
  duration?: number;
  harmonicFreq?: number;
  closestSolfeggio?: number;
  harmonicDeviation?: number;
  fractalAnalysis?: unknown;
  /** v15.8: who placed the crystal (absent before v15.8: utils/mix/distribution.ts crystalOrigin derives it). */
  crystalSource?: CrystalSource;
  isAetheriaCandidate?: boolean;
  bandEnvelope?: { bass?: { length: number } } | null;
  visualEnvelope?: { bass?: { length: number } } | null;
  musicKey?: string;
  keyConfidence?: number;
  chromaVersion?: number;
  analysisFailedV?: number;
  file?: { name?: string; size?: number } | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

// ---------------------------------------------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------------------------------------------

/** Written only from the Sort select's change; read lazily; anything unknown means Library order. */
export const LIBRARY_SORT_KEY = 'aetheria.librarySort.v1';

export type LibrarySort = 'library' | 'name' | 'newest' | 'length' | 'crystal';

export const LIBRARY_SORTS: ReadonlyArray<{ id: LibrarySort; label: string }> = [
  { id: 'library', label: 'Library order' },
  { id: 'name', label: 'Name' },
  { id: 'newest', label: 'Newest first' },
  { id: 'length', label: 'Length' },
  { id: 'crystal', label: 'Crystal' },
];

export function parseLibrarySort(raw: unknown): LibrarySort {
  return raw === 'name' || raw === 'newest' || raw === 'length' || raw === 'crystal' ? raw : 'library';
}

export function sortLabel(sort: LibrarySort): string {
  return LIBRARY_SORTS.find((s) => s.id === sort)?.label ?? 'Library order';
}

const collator = typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
  ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  : null;

const lowerCache = new WeakMap<object, string>();
/** The track's name in lower case, once per Song object (a by-id patch replaces only the objects it patches). */
function lowerName(s: LibSong): string {
  let v = lowerCache.get(s);
  if (v === undefined) {
    v = String(s.name ?? '').toLowerCase();
    lowerCache.set(s, v);
  }
  return v;
}

const lengthOf = (s: LibSong) => (Number.isFinite(s.duration) && (s.duration as number) > 0 ? (s.duration as number) : Infinity);
const crystalOf = (s: LibSong) => (Number.isFinite(s.closestSolfeggio) && (s.closestSolfeggio as number) > 0 ? (s.closestSolfeggio as number) : Infinity);

/**
 * The whole library in the chosen order, each id once (its first entry). Library order is the library as it is
 * (import order); Newest first is it reversed; Name is numeric-aware and case-blind; Length is shortest first and
 * Crystal lowest first, unknown last. Ties keep library order (the sort is stable).
 */
export function sortLibrary<T extends LibSong>(songs: readonly T[], sort: LibrarySort): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of songs) {
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  if (sort === 'newest') return out.reverse();
  if (sort === 'name') {
    return out.sort((a, b) => (collator ? collator.compare(String(a.name ?? ''), String(b.name ?? '')) : lowerName(a) < lowerName(b) ? -1 : lowerName(a) > lowerName(b) ? 1 : 0));
  }
  if (sort === 'length') return out.sort((a, b) => cmpNum(lengthOf(a), lengthOf(b)));
  if (sort === 'crystal') return out.sort((a, b) => cmpNum(crystalOf(a), crystalOf(b)));
  return out;
}

function cmpNum(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** The query as the search uses it: trimmed, lower case. */
export function normalQuery(query: string): string {
  return String(query ?? '').trim().toLowerCase();
}

/** The sorted list narrowed to names containing the query (case-blind substring, as classic's search). O(n). */
export function filterLibrary<T extends LibSong>(sorted: readonly T[], query: string): T[] {
  const q = normalQuery(query);
  if (!q) return sorted as T[];
  const out: T[] = [];
  for (const s of sorted) if (lowerName(s).includes(q)) out.push(s);
  return out;
}

/** The rows the list shows: the whole library in the sort, narrowed by the query (v14.20 adds facets here). */
export function libraryView<T extends LibSong>(songs: readonly T[], o: { query: string; sort: LibrarySort }): T[] {
  return filterLibrary(sortLibrary(songs, o.sort), o.query);
}

// ---------------------------------------------------------------------------------------------------------------
// A row
// ---------------------------------------------------------------------------------------------------------------

/** 'Am' → "A minor", 'F#' → "F♯ major"; '' or junk → ''. */
export function keyName(key: unknown): string {
  if (typeof key !== 'string') return '';
  const m = /^([A-G])(#|♯|b|♭)?(m)?$/.exec(key.trim());
  if (!m) return '';
  const acc = m[2] === '#' || m[2] === '♯' ? '♯' : m[2] ? '♭' : '';
  return `${m[1]}${acc} ${m[3] ? 'minor' : 'major'}`;
}

/** The crystal as the row says it ("528 Hz"), or null without one. */
export function crystalText(s: LibSong): string | null {
  const hz = s.closestSolfeggio;
  return Number.isFinite(hz) && (hz as number) > 0 ? `${Math.round(hz as number)} Hz` : null;
}

export type RowState = 'playing' | 'paused' | null;

/** A row's one line of facts: "3:15 · 528 Hz · A minor" ("Reading length…" until the length is known, "No crystal
 *  yet" without one, the key only when analysed), with "Playing · " or "Paused · " first on the current track's row. */
export function rowFacts(s: LibSong, state: RowState | boolean = null): string {
  const st: RowState = state === true ? 'playing' : state === false ? null : state;
  const parts: string[] = [];
  parts.push(Number.isFinite(s.duration) && (s.duration as number) > 0 ? formatTime(s.duration as number) : 'Reading length…');
  parts.push(crystalText(s) ?? 'No crystal yet');
  const k = keyName(s.musicKey);
  if (k) parts.push(k);
  return `${st === 'playing' ? 'Playing · ' : st === 'paused' ? 'Paused · ' : ''}${parts.join(' · ')}`;
}

/** The regime of a track's crystal, for its dot (null: a hollow ring). */
export function rowRegime(s: LibSong): ReturnType<typeof regimeOf> | null {
  const hz = s.closestSolfeggio;
  return Number.isFinite(hz) && (hz as number) > 0 ? regimeOf(hz as number) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The tab's lines
// ---------------------------------------------------------------------------------------------------------------

/** "11 of 440 tracks match". */
export function matchCountText(n: number, total: number): string {
  const a = count(n);
  const t = count(total);
  return `${a} of ${t} ${plural(t, 'track', 'tracks')} ${a === 1 ? 'matches' : 'match'}`;
}

/** What plays, for the summary line: "your library", "Lo Shu walk · Vortex", "a play order (12 tracks)". */
export function playingFromText(o: { hasTrack: boolean; walkName: string | null; sameIds: boolean; orderCount: number; scanning: boolean }): string {
  if (!o.hasTrack) return o.scanning ? 'Scanning the library…' : 'Nothing playing';
  if (o.walkName) return `Playing from Lo Shu walk · ${o.walkName}`;
  if (o.sameIds) return 'Playing from your library';
  const n = count(o.orderCount);
  return `Playing from a play order (${n} ${plural(n, 'track', 'tracks')})`;
}

/** "440 tracks · 4 h 2 min · Playing from your library". */
export function summaryText(n: number, totalSeconds: number, from: string): string {
  const c = count(n);
  return `${c} ${plural(c, 'track', 'tracks')} · ${formatTotal(totalSeconds)} · ${from}`;
}

/** The search field's placeholder. */
export function searchPlaceholder(n: number): string {
  const c = count(n);
  return `Search ${c} ${plural(c, 'track', 'tracks')}`;
}

export const SEARCH_HINT = 'a tap plays your whole library from that track';

/** The empty state and the Import sheet's formats lines (App.tsx AUDIO_FILE_RE and AUDIO_MIME_DENY_RE). */
export const FORMATS_LINE = 'Plays MP3, WAV, FLAC, M4A, AAC, OGG, Opus, WebM and AIFF.';
export const FORMATS_SKIPPED = 'Playlists (.m3u), WMA and Apple Lossless are skipped.';

// ---------------------------------------------------------------------------------------------------------------
// The row tap and its Undo (App's startPlayOrder / playFromLibrary / undoPlayOrder)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The play order a Library row starts: `null` → the library itself (the same array, as restoreLibrary uses);
 * otherwise the ids (the list's sort) mapped to the library's own Song objects, ids no longer in the library skipped,
 * each id once, and any library track missing from `orderIds` (imported since the list rendered) appended in library
 * order. O(n). Every entry is a library track, so the order never holds a track the library doesn't.
 */
export function libraryOrderFor<T extends { id: string }>(library: readonly T[], orderIds: readonly string[] | null): T[] {
  if (!orderIds) return library as T[];
  const byId = new Map<string, T>();
  for (const s of library) if (!byId.has(s.id)) byId.set(s.id, s);
  const out: T[] = [];
  const used = new Set<string>();
  for (const id of orderIds) {
    const s = byId.get(id);
    if (!s || used.has(id)) continue;
    used.add(id);
    out.push(s);
  }
  for (const s of library) {
    if (used.has(s.id)) continue;
    used.add(s.id);
    out.push(s);
  }
  return out;
}

/** True when `list` holds exactly these ids in this order. */
export function sameIds(list: readonly { id: string }[], ids: readonly string[]): boolean {
  if (list.length !== ids.length) return false;
  for (let i = 0; i < ids.length; i++) if (list[i].id !== ids[i]) return false;
  return true;
}

/**
 * True while the play order is still the one a row tap started (`tapIds`), allowing only what the library itself did
 * since: a track deleted (gone from both lists) and a track imported (in the library, appended to the play order when
 * it was the library). Any other change (a walk, a mix, another tap's order) makes it false. O(n).
 */
export function stillTapOrder(play: readonly { id: string }[], tapIds: readonly string[], library: readonly { id: string }[]): boolean {
  const lib = new Set<string>();
  for (const s of library) lib.add(s.id);
  const tap = new Set(tapIds);
  const expected = tapIds.filter((id) => lib.has(id));
  const kept: string[] = [];
  for (const s of play) {
    if (tap.has(s.id)) kept.push(s.id);
    else if (!lib.has(s.id)) return false; // not the tap's and not the library's
  }
  if (kept.length !== expected.length) return false;
  for (let i = 0; i < kept.length; i++) if (kept[i] !== expected[i]) return false;
  return true;
}

/** True when both lists hold the same ids, as many times each (any order): "the library, sorted". O(n). */
export function sameIdSet(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  if (a.length !== b.length) return false;
  const n = new Map<string, number>();
  for (const s of a) n.set(s.id, (n.get(s.id) ?? 0) + 1);
  for (const s of b) {
    const k = n.get(s.id);
    if (!k) return false;
    n.set(s.id, k - 1);
  }
  return true;
}

export interface RebuiltOrder<T> {
  order: T[];
  cursor: number;
  /** Some saved ids are no longer in the library (deleted since). */
  dropped: boolean;
  /** The track under the saved cursor is one of them. */
  removedCurrent: boolean;
}

/**
 * The earlier play order for an Undo, from its saved ids and the library AS IT IS NOW: each id mapped to the library's
 * current Song object (never the snapshot's, which could undo a scan's patch), ids deleted since dropped, and the
 * cursor moved by the drops before it (removeIdsWithCursor's rule); -1 when its own track went. Repeats stay (a walk
 * can hold a track more than once).
 */
export function rebuildOrder<T extends { id: string }>(ids: readonly string[], cursor: number, library: readonly T[]): RebuiltOrder<T> {
  const byId = new Map<string, T>();
  for (const s of library) if (!byId.has(s.id)) byId.set(s.id, s);
  const order: T[] = [];
  let before = 0;
  let removedCurrent = false;
  for (let i = 0; i < ids.length; i++) {
    const s = byId.get(ids[i]);
    if (s) {
      order.push(s);
      continue;
    }
    if (i < cursor) before++;
    else if (i === cursor) removedCurrent = true;
  }
  const valid = Number.isInteger(cursor) && cursor >= 0 && cursor < ids.length;
  const next = removedCurrent || !valid ? -1 : cursor - before;
  return { order, cursor: next >= 0 && next < order.length ? next : -1, dropped: order.length !== ids.length, removedCurrent };
}

/** The Undo toast's words after a row tap: from a walk, from another play order, or from the library itself. */
export function libraryTapText(walkName: string | null, fromLibrary: boolean): string {
  const base = 'Playing your library from this track.';
  if (walkName) return `${base} The ${walkName} walk stopped.`;
  if (!fromLibrary) return `${base} The earlier play order stopped.`;
  return base;
}

export const UNDO_CHANGED_TEXT = "The play order changed since, so the earlier one can't come back.";
export const TAP_GONE_TEXT = 'That track is no longer in your library.';

// ---------------------------------------------------------------------------------------------------------------
// Track info
// ---------------------------------------------------------------------------------------------------------------

export interface InfoRow {
  label: string;
  value: string;
  note?: string;
  /** v16.6: the note's evidence tag (the assigned crystal: Design choice); the dialog renders it beside the note. */
  tag?: 'design';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EARLIEST_ADDED = Date.UTC(2020, 0, 1);

/** The import date an id carries (`${Date.now()}-…`, App's handleFileUpload): "25 Oct 2026", or null when the id
 *  doesn't start with a time between 2020 and tomorrow. */
export function addedDate(id: unknown, now: number): string | null {
  if (typeof id !== 'string') return null;
  const m = /^(\d{12,14})-/.exec(id);
  if (!m) return null;
  const t = Number(m[1]);
  const limit = Number.isFinite(now) ? now + 86_400_000 : NaN;
  if (!(t >= EARLIEST_ADDED) || !(t <= limit)) return null;
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "4.1 MB", "512 KB", "900 B"; null for a size that isn't a finite, non-negative number. */
export function formatBytes(size: unknown): string | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round(size)} B`;
}

export const ASSIGNED_NOTE = 'An assigned crystal, not a measured pitch.';

// v15.8: where a crystal comes from is utils/mix/distribution.ts crystalOrigin's answer (the field Deep Scan and Assign
// record, or, on tracks from before v15.8, what they stored), the same rule Deep Scan's queue and Assign use.

/** Deep Scan ran on the track (its crystal is Deep Scan's, was replaced, or the scan failed). */
export function deepScanned(s: LibSong): boolean {
  const o = crystalOrigin(s);
  return o === 'scan' || o === 'scan-replaced' || o === 'scan-failed';
}

/** The crystal is Deep Scan's own: a scan, or one an older Auto-Distribute re-stored without changing its crystal. */
export function crystalFromDeepScan(s: LibSong): boolean {
  const o = crystalOrigin(s);
  return o === 'scan' || (o === 'scan-replaced' && !scanCrystalChanged(s));
}

/** Where a track's crystal came from. */
export function crystalSource(s: LibSong): string {
  const o = crystalOrigin(s);
  if (o === 'scan-failed') return "Deep Scan couldn't read this track; a placeholder crystal";
  if (crystalFromDeepScan(s)) return 'From Deep Scan';
  // v16.7.1: Assign crystals spreads every track, so it no longer puts Deep Scan's crystal back.
  if (spreadFromScan(s)) return "Spread by Assign crystals; Deep Scan's own reading is kept";
  if (o === 'scan-replaced') return "Deep Scan's crystal was replaced by an older Auto-Distribute";
  return 'Assigned, not scanned yet';
}

const hasBass = (e: LibSong['bandEnvelope']) => (e?.bass?.length ?? 0) > 0;

/** Track info's rows (mockup library-track-info-phone): Length, Crystal, Key, Visual sync, File, Added. */
export function trackInfoRows(s: LibSong, now: number): InfoRow[] {
  const rows: InfoRow[] = [];
  const d = s.duration;
  rows.push({ label: 'Length', value: Number.isFinite(d) && (d as number) > 0 ? formatTime(d as number) : d === 0 ? 'Reading…' : 'Unknown' });
  const hz = s.closestSolfeggio;
  if (Number.isFinite(hz) && (hz as number) > 0) {
    rows.push({ label: 'Crystal', value: `${Math.round(hz as number)} Hz · ${regimeName(regimeOf(hz as number))}`, note: `${crystalSource(s)}. ${ASSIGNED_NOTE}`, tag: 'design' });
  } else {
    rows.push({ label: 'Crystal', value: 'None yet' });
  }
  const key = keyName(s.musicKey);
  const analysed = s.chromaVersion === CHROMA_VERSION;
  if (analysed && key) {
    const conf = Number.isFinite(s.keyConfidence) ? ` · confidence ${(s.keyConfidence as number).toFixed(2)}` : '';
    rows.push({ label: 'Key', value: `${key}${conf}`, note: s.fractalAnalysis ? 'From Deep Scan or Analyse tracks' : 'From Analyse tracks' });
  } else if (analysed) {
    rows.push({ label: 'Key', value: 'No clear key' });
  } else if (s.analysisFailedV === CHROMA_VERSION) {
    rows.push({ label: 'Key', value: "Couldn't be read" });
  } else {
    rows.push({ label: 'Key', value: 'Not analysed yet' });
  }
  rows.push({ label: 'Visual sync', value: hasBass(s.bandEnvelope) ? 'From Deep Scan' : hasBass(s.visualEnvelope) ? 'From Analyse tracks' : 'None yet' });
  const fileName = typeof s.file?.name === 'string' && s.file.name ? s.file.name : null;
  const size = formatBytes(s.file?.size);
  if (fileName || size) rows.push({ label: 'File', value: [fileName, size].filter(Boolean).join(' · ') });
  const added = addedDate(s.id, now);
  if (added) rows.push({ label: 'Added', value: added });
  return rows;
}

/** Track info as plain text, for Copy: the name, then "Label: value (note)" per row. */
export function trackInfoText(s: LibSong, now: number): string {
  const lines = [String(s.name ?? '')];
  for (const r of trackInfoRows(s, now)) lines.push(`${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// The health card (Stage B)
// ---------------------------------------------------------------------------------------------------------------

/** Deep Scan's own estimate per track, minutes (App's scanLibrary). */
export const SCAN_MIN_PER_TRACK = 2.5;

export interface LibraryHealth {
  /** Library tracks, each id once. */
  total: number;
  /** No crystal (closestSolfeggio): what Assign gives one. */
  noCrystal: number;
  /** Deep Scan's default queue (deepScanQueue: no measurement and no assigned crystal, v15.7's scope): what Scan does. */
  unscanned: number;
  /** The assigned tracks the explicit "Also scan" adds to it (deepScanQueue with { assigned: true }; decision 6). */
  assignedToScan: number;
  /** Deep Scan ran on it (deepScanned). */
  scanned: number;
  /** Deep Scan crystals an older Auto-Distribute changed (scanCrystalChanged). (v16.7.1: Assign spreads them with the rest.) */
  scanReplaced: number;
  /** Of the 27 crystals, how many no track has. */
  emptyCrystals: number;
  /** Tracks with a crystal that v15.8's Assign would still place (an older Auto-Distribute's placeholders, failed
   *  scans). v16.7.1: the health line no longer reads it (a spread places every track). */
  placeable: number;
  /** v16.7.3: tracks Deep Scan read at 2178 Hz (distribution.ts sourceTrack) that are on another crystal: Assign puts
   *  them back on 2178. By the plan's own rule, so it is exactly planAssign(lib, 'spread').restored (source.check). */
  sourceBack: number;
  /** v16.7.3 (F1): the crystals a spread would cover: the crystals its pinned tracks hold (spreadRole: Source tracks on
   *  2178, unreadable scans on their own) and one each for the open tracks while any remain (the fill's first round), at
   *  most 27. So it is exactly 27 − planAssign(lib, 'spread').emptyAfter (source.check), without running the plan. */
  spreadCover: number;
}

/** One O(n) pass, each id once, by each action's own rule (so a number never promises what its button won't do). */
export function libraryHealth(songs: readonly LibSong[]): LibraryHealth {
  const seen = new Set<string>();
  const used = new Set<number>();
  const unique: LibSong[] = [];
  let noCrystal = 0;
  let scanned = 0;
  let scanReplaced = 0;
  let placeable = 0;
  let sourceBack = 0;
  const pinned = new Set<number>();
  let openTracks = 0;
  for (const s of songs) {
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    unique.push(s);
    if (!s.closestSolfeggio) noCrystal++;
    else used.add(s.closestSolfeggio);
    const o = crystalOrigin(s);
    if (readByDeepScan(s) || o === 'scan-failed') scanned++; // v16.7.1 (from v16.8): a spread track was read too
    if (scanCrystalChanged(s)) scanReplaced++;
    // Assign's own rule (planAssign): it keeps scans, put-backs and anchors (a recorded assigned crystal of the 27).
    const anchor = s.crystalSource === 'assigned' && ALL_CRYSTALS.includes(s.closestSolfeggio as number);
    if (s.closestSolfeggio && o !== 'scan' && o !== 'scan-replaced' && !anchor) placeable++;
    // v16.7.3: what a spread does with it (distribution.ts spreadRole, the plan's own rule; O(1), the reading's crystal
    // is memoized): a Source track away from 2178 goes back (sourceBack); the pinned crystals and the open tracks give
    // the crystals a spread covers (F1).
    const { role, crystal } = spreadRole(s);
    if (role === 'open') openTracks++;
    else if (crystal !== null) pinned.add(crystal);
    if (role === 'source' && s.closestSolfeggio && s.closestSolfeggio !== SOURCE_FREQ) sourceBack++; // (fix round 2, R4: one with no crystal gets one, it doesn't go back)
  }
  const unscanned = deepScanQueue(unique).length;
  const assignedToScan = deepScanQueue(unique, { assigned: true }).length - unscanned;
  const emptyCrystals = ALL_CRYSTALS.filter((f) => !used.has(f)).length;
  const spreadCover = Math.min(27, pinned.size + openTracks);
  return { total: unique.length, noCrystal, unscanned, assignedToScan, scanned, scanReplaced, emptyCrystals, placeable, sourceBack, spreadCover };
}

export type HealthAction = 'assign' | 'analyse' | 'scan' | 'scan-assigned' | 'stop-scan' | 'review';

export interface HealthLine {
  id: 'crystals' | 'analyse' | 'scan' | 'scan-assigned' | 'lengths' | 'orphans';
  title: string;
  line: string;
  /** A second, quieter line. */
  sub?: string;
  /** ✓ instead of a dot. */
  done: boolean;
  /** A brighter dot: counted in "N to do". */
  todo: boolean;
  action?: { label: string; kind: HealthAction; blocked: boolean };
  /** 0..1 while Analyse tracks runs. */
  progress?: number;
}

export interface HealthInput {
  health: LibraryHealth;
  pass: PassProgress;
  analyseCounts: { todo: number; todoSeconds: number; failed: number; failedSeconds: number; tooLong: number };
  isScanning: boolean;
  scanProgress: number;
  restoring: boolean;
  mobile: boolean;
  durationsLeft: number;
  orphans: { fresh: number; duplicates: number } | null;
  /** v16.5 review (B10): an export runs: Analyse tracks and Deep Scan wait for it. */
  exporting?: boolean;
  /** v16.5 final: a cancelled export that was let go is still stopping (its decode may run on): they wait for it too. */
  exportStopping?: boolean;
  /** v16.5 export memory: and for a minute or more (the line adds "or reload Aetheria"). */
  exportStoppingLong?: boolean;
}

export interface HealthModel {
  lines: HealthLine[];
  /** "2 to do", "Analysing…", "Scanning…", "All set". */
  status: string;
  toDo: number;
  /** Decision 5 A: open while there is something to do or a pass runs; one line otherwise. */
  autoOpen: boolean;
  /** The folded line ("All set · Deep Scan optional"). */
  folded: string;
}

/** Orphan wording, as classic's banner counts them. */
export function orphanText(fresh: number, duplicates: number): string {
  const f = count(fresh);
  const d = count(duplicates);
  if (f > 0) return `${f} stored ${plural(f, 'track is', 'tracks are')} not in your library`;
  return `${d} stored ${plural(d, 'copy', 'copies')} of tracks already in your library`;
}

/** The health card's lines, status and fold, from the library and the existing passes' state. */
export function healthModel(i: HealthInput): HealthModel {
  const h = i.health;
  const lines: HealthLine[] = [];
  const analysing = i.pass.phase !== 'idle';

  // Crystals (Assign = Auto-Distribute). v16.7.1: Assign spreads every track, scanned ones too, over the 27 crystals
  // (planAssign(lib, 'spread')), on any library size. Its button shows when a track has no crystal (to do), or when
  // a spread would give more crystals a track (optional; v16.7.3, F1: spreadCover, not "some crystal holds two": Source
  // tracks pinned together on 2178, or unreadable scans on one crystal, can't be spread out). Otherwise the
  // line only informs. (v15.8's "can get Deep Scan's crystal back" is gone: a spread doesn't put crystals back.)
  // v16.7.3: a spread keeps the tracks Deep Scan read at 2178 Hz on 2178, so one an older spread moved away goes back on
  // the next press: Assign is to do then (sourceBack, the plan's own count; a library already spread would otherwise read
  // "All N tracks have one" and offer nothing).
  const all = h.total === 1 ? 'The track has one' : `All ${h.total} have one`;
  const assignAction = (todo: boolean, line: string): HealthLine => ({
    id: 'crystals',
    title: 'Crystals',
    line,
    sub: i.isScanning ? 'Unavailable while Deep Scan runs' : undefined,
    done: false,
    todo,
    action: { label: 'Assign', kind: 'assign', blocked: i.isScanning },
  });
  const gaps = `${h.emptyCrystals} ${plural(h.emptyCrystals, 'crystal has', 'crystals have')} no track`;
  if (h.noCrystal > 0) {
    lines.push(assignAction(true, `${h.noCrystal} of ${h.total} tracks have none`));
  } else if (h.sourceBack > 0) {
    lines.push(assignAction(true, `${all} · ${h.sourceBack} can go back to 2178 Hz, the crystal Deep Scan gave ${plural(h.sourceBack, 'it', 'them')}`));
  } else if (h.emptyCrystals > 0 && h.spreadCover > 27 - h.emptyCrystals) {
    lines.push(assignAction(false, `${all} · ${gaps}`));
  } else {
    lines.push({
      id: 'crystals',
      title: 'Crystals',
      line: h.total === 1 ? 'The track has one' : `All ${h.total} tracks have one`,
      sub: h.emptyCrystals > 0 && h.total > 0 ? `${gaps}.` : undefined,
      done: true,
      todo: false,
    });
  }

  // Keys and visual sync (Analyse tracks), in passButtonText's own words.
  const t = passButtonText(i.pass, i.analyseCounts, { deepScan: i.isScanning, restoring: i.restoring, mobile: i.mobile });
  const c = i.analyseCounts;
  if (analysing) {
    const stopping = i.pass.phase === 'stopping';
    const sub = t.sub.replace(/ · tap to stop$/, '');
    lines.push({
      id: 'analyse',
      title: 'Keys and visual sync',
      line: stopping ? 'Stopping…' : `${t.title} · ${sub}`,
      sub: 'Pauses around track changes and while the screen is off',
      done: false,
      todo: true,
      action: { label: 'Stop', kind: 'analyse', blocked: stopping },
      progress: i.pass.total > 0 ? Math.min(1, Math.max(0, i.pass.done / i.pass.total)) : 0,
    });
  } else if (c.todo > 0) {
    lines.push({
      id: 'analyse',
      title: 'Keys and visual sync',
      line: `${c.todo} to analyse · ${passEta(passEtaMinutes(c.todoSeconds, i.mobile))}`,
      sub: t.blocked ? t.sub : undefined,
      done: false,
      todo: true,
      action: { label: `Analyse ${c.todo}`, kind: 'analyse', blocked: t.blocked },
    });
  } else if (c.failed > 0) {
    lines.push({
      id: 'analyse',
      title: 'Keys and visual sync',
      line: `${c.failed} couldn't be read`,
      sub: t.blocked ? t.sub : undefined,
      done: false,
      todo: false,
      action: { label: 'Try again', kind: 'analyse', blocked: t.blocked },
    });
  } else {
    lines.push({
      id: 'analyse',
      title: 'Keys and visual sync',
      line: c.tooLong > 0 ? `All analysed · ${c.tooLong} too long for this device` : 'All analysed',
      done: true,
      todo: false,
    });
  }

  // Deep Scan (optional). v15.8 (decision 6): Scan measures the tracks with no measurement and no assigned crystal
  // (v15.7's scope) and stops; a separate, explicit line offers the assigned ones (the same pass, the same Stop).
  const scanTime = `about ${formatTotal(h.unscanned * SCAN_MIN_PER_TRACK * 60)}`;
  if (i.isScanning) {
    const pct = Number.isFinite(i.scanProgress) ? Math.min(100, Math.max(0, Math.round(i.scanProgress))) : 0;
    lines.push({ id: 'scan', title: 'Deep Scan', line: `Scanning · ${pct} %`, done: false, todo: false, action: { label: 'Stop', kind: 'stop-scan', blocked: false } });
  } else if (h.unscanned === 0 && h.assignedToScan === 0) {
    lines.push({ id: 'scan', title: 'Deep Scan', line: h.total === 1 ? 'The track is scanned' : `All ${h.total} tracks scanned`, done: true, todo: false });
  } else if (h.unscanned === 0) {
    // Nothing for Scan to do, yet not every track was scanned: the assigned ones (the next line offers them).
    lines.push({ id: 'scan', title: 'Deep Scan', line: `${h.scanned} of ${h.total} scanned`, done: false, todo: false });
  } else if (analysing) {
    lines.push({
      id: 'scan',
      title: 'Deep Scan',
      line: `${h.unscanned} unscanned · ${scanTime}`,
      sub: 'Unavailable while Analyse tracks runs',
      done: false,
      todo: false,
      action: { label: 'Scan', kind: 'scan', blocked: true },
    });
  } else {
    lines.push({
      id: 'scan',
      title: 'Deep Scan',
      line: `Optional · ${h.unscanned} unscanned · ${scanTime}`,
      sub: i.mobile ? 'Slow on a phone, and keeps it busy.' : undefined,
      done: false,
      todo: false,
      action: { label: 'Scan', kind: 'scan', blocked: false },
    });
  }
  if (h.assignedToScan > 0 && !i.isScanning) {
    const a = h.assignedToScan;
    lines.push({
      id: 'scan-assigned',
      title: 'Deep Scan, assigned tracks',
      line: `Also scan the ${a} assigned ${plural(a, 'track', 'tracks')} (about ${formatTotal(a * SCAN_MIN_PER_TRACK * 60)})`,
      sub: analysing ? 'Unavailable while Analyse tracks runs' : i.mobile ? 'Slow on a phone, and keeps it busy.' : undefined,
      done: false,
      todo: false,
      action: { label: 'Scan', kind: 'scan-assigned', blocked: analysing },
    });
  }

  // Track lengths (the duration queue).
  const left = count(i.durationsLeft);
  if (left > 0) lines.push({ id: 'lengths', title: 'Track lengths', line: `Reading ${left} more…`, done: false, todo: false });

  // Stored tracks the library doesn't list (the Recover offer, in the Import sheet).
  const o = i.orphans;
  if (o && count(o.fresh) + count(o.duplicates) > 0) {
    lines.push({
      id: 'orphans',
      title: 'Stored tracks not in your library',
      line: orphanText(o.fresh, o.duplicates),
      done: false,
      todo: true,
      action: { label: 'Review', kind: 'review', blocked: false },
    });
  }

  // v16.5 review (B10): while an export runs, Analyse tracks and Deep Scan don't start (their decodes would stack on
  // the export's): their buttons are held, with the reason. A running pass's Stop stays.
  if (i.exporting) {
    for (const l of lines) {
      const a = l.action;
      if (!a || a.label === 'Stop' || (a.kind !== 'analyse' && a.kind !== 'scan' && a.kind !== 'scan-assigned')) continue;
      l.action = { ...a, blocked: true };
      l.sub = BUSY_EXPORT;
    }
  }
  // v16.5 final: and while a cancelled export that was let go is still stopping (abandon() can't stop its decode).
  if (i.exportStopping && !i.exporting) {
    for (const l of lines) {
      const a = l.action;
      if (!a || a.label === 'Stop' || (a.kind !== 'analyse' && a.kind !== 'scan' && a.kind !== 'scan-assigned')) continue;
      l.action = { ...a, blocked: true };
      l.sub = i.exportStoppingLong ? BUSY_STOPPING_LONG : BUSY_STOPPING;
    }
  }

  const toDo = lines.filter((l) => l.todo).length;
  const status = analysing ? 'Analysing…' : i.isScanning ? 'Scanning…' : toDo > 0 ? `${toDo} to do` : 'All set';
  const autoOpen = toDo > 0 || analysing || i.isScanning || left > 0;
  const folded = h.unscanned > 0 || h.assignedToScan > 0 ? 'All set · Deep Scan optional' : 'All set';
  return { lines, status, toDo, autoOpen, folded };
}

/** The card's footer (the classic peek). v16.1: Clear and the diagnostics are the card's own Library tools now. */
export const HEALTH_FOOTER = 'The classic library view is one tap away.';

/** Assign's confirmation (v15.8: from the plan, asked only when crystals tracks already have would change). */
export { assignConfirmText, assignNeedsConfirm } from '../../../utils/mix/distribution.ts';

// ---------------------------------------------------------------------------------------------------------------
// The Import sheet (Stage B)
// ---------------------------------------------------------------------------------------------------------------

export interface LastImport {
  added: number;
  skipped: number;
  joinedPlayOrder: boolean;
  at: number;
}

/** The last import's lines: the headline, then the quieter ones. */
export function lastImportLines(l: LastImport, durationsLeft: number): { head: string; lines: string[]; quiet: string | null } {
  const a = count(l.added);
  const s = count(l.skipped);
  const head = a > 0 ? `Added ${a} ${plural(a, 'track', 'tracks')} to your library` : 'No tracks added';
  const lines: string[] = [];
  if (s > 0) lines.push(`Skipped ${s} ${plural(s, 'file that is', 'files that are')} not playable audio.`);
  const left = count(durationsLeft);
  if (left > 0) lines.push(`Reading track lengths · ${left} left`);
  const quiet = a > 0 && !l.joinedPlayOrder ? "The list that's playing is unchanged." : null;
  return { head, lines, quiet };
}

/** The Recover offer's words (classic's banner counts, the mockup's sentences). */
export function recoverWords(fresh: number, duplicates: number): { head: string; body: string; extra: string | null; recover: string } {
  const f = count(fresh);
  const d = count(duplicates);
  return {
    head: orphanText(f, d),
    body: f > 0 ? 'Their audio is still on this device, from an earlier version.' : 'They can be removed: the library keeps its own.',
    extra: f > 0 && d > 0 ? `${d} more ${plural(d, 'is a copy', 'are copies')} of tracks you have and will be removed.` : null,
    recover: f > 0 ? `Recover ${f}` : 'Remove copies',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// v16.7, desktop polish: "/" asks for Library › Tracks with the search field focused (spec §3.6; moreModel's
// requestMoreView pattern). The mounted Library tab answers (it shows Tracks; its Tracks body focuses and selects the
// field); with none mounted, the view and a focus flag are left in App's libraryViewRef, read when the body mounts.
// ---------------------------------------------------------------------------------------------------------------

/** What the request writes (contexts.ts LibraryViewState's fields). */
export interface LibrarySearchView {
  view?: 'tracks' | 'playlists';
  focusSearch?: boolean;
}

const searchListeners = new Set<() => void>();

/** The Library tab and its Tracks body, while mounted: called when "/" asks for the search. */
export function onLibrarySearchRequest(fn: () => void): () => void {
  searchListeners.add(fn);
  return () => {
    searchListeners.delete(fn);
  };
}

/** Library › Tracks with the search field focused: the view and the flag first (a body mounting reads them), then the
 *  mounted listeners. */
export function requestLibrarySearch(viewRef?: { current: LibrarySearchView } | null): void {
  if (viewRef) {
    viewRef.current.view = 'tracks';
    viewRef.current.focusSearch = true;
  }
  for (const fn of Array.from(searchListeners)) fn();
}

/** The Tracks body: whether the field is to take the focus now (the flag is cleared: it acts once). */
export function takeSearchFocus(viewRef?: { current: LibrarySearchView } | null): boolean {
  if (!viewRef || !viewRef.current.focusSearch) return false;
  viewRef.current.focusSearch = false;
  return true;
}
