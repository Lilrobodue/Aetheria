// utils/playlists/model.ts (v16.1, saved playlists; spec section 3.2)
//
// The saved playlists' pure model: the stored record and its validation on read, the edits (each returns a new record,
// never mutating), the fingerprints a re-import relinks by, and the resolution of a playlist's entries against the
// library as it is now (by id, else by fingerprint, else missing). No app imports, no IndexedDB: App applies what these
// return, and utils/playlistCache.ts stores it. Node checks it directly (model.check.ts; type stripping, no build).
// Every lookup is a Map (ids come from storage, so never an object's keys). Nothing here is O(n) per entry.
// Comments in utils/ must not hold words that look like style class names (the style build scans this folder).

/** The stored record's schema version. A record with another version is left on disk untouched and not shown. */
export const RECORD_VERSION = 1;
/** Every saved playlist is the record 'pl:<id>' of the playlist-state store (beside 'current'). */
export const KEY_PREFIX = 'pl:';
export const NAME_MAX = 80;
/** Caps, enforced on read and by the edits (a larger record is refused, not truncated). */
export const ENTRIES_MAX = 10_000;
export const PLAYLISTS_MAX = 500;

const ID_RE = /^p[a-z0-9]{6,30}$/;
// A track id: what App made it (Date.now()-random) or any older form; never empty, no control characters, bounded.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const TRACK_ID_MAX = 128;
const FILE_MAX = 512;

export interface PlaylistEntry {
  /** The track's id when it was added (or when an edit last saved the playlist with it present). */
  id: string;
  /** Its title then: what a missing entry shows. */
  name: string;
  /** Its file's name and size in bytes then: the fingerprint a re-import is matched by. */
  file: string;
  size: number;
}

/** Where a playlist was made: shown under its name ("Saved from Up next"). Informational only. */
export type PlaylistFromKind = 'new' | 'queue' | 'playing' | 'duplicate' | 'filter' | 'builder';
export interface PlaylistFrom {
  kind: PlaylistFromKind;
  /** The mix's, walk's or playlist's name it came from, if any. */
  label?: string;
}

export interface PlaylistRecord {
  /** The store's keyPath: KEY_PREFIX + id. */
  key: string;
  v: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  entries: PlaylistEntry[];
  from?: PlaylistFrom;
}

/** What the model needs of a library track (App's Song has these). */
export interface TrackLike {
  id: string;
  name: string;
  file: { name: string; size: number };
  duration?: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Keys, ids, names
// ---------------------------------------------------------------------------------------------------------------

export const keyOf = (id: string): string => KEY_PREFIX + id;
export const isPlaylistId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id);
export const isPlaylistKey = (key: unknown): key is string =>
  typeof key === 'string' && key.startsWith(KEY_PREFIX) && isPlaylistId(key.slice(KEY_PREFIX.length));

/** A new id: 'p' + the time in base 36 + 8 random base-36 characters (rand: [0, 1) values; injected for checks). */
export function newPlaylistId(now: number, rand: () => number = Math.random): string {
  let r = '';
  for (let i = 0; i < 8; i++) r += Math.floor(rand() * 36).toString(36);
  return 'p' + Math.max(0, Math.floor(now)).toString(36) + r;
}

/** A name as typed, cleaned: control characters out, runs of spaces as one, trimmed, at most NAME_MAX characters.
 *  Null when nothing is left (the Save button stays off). */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return Array.from(s).slice(0, NAME_MAX).join('');
}

/** "New playlist", then "New playlist 2", "New playlist 3"… for the first one not taken (case-insensitive). */
export function freeName(base: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const t of taken) used.add(t.toLocaleLowerCase('en-US'));
  const b = cleanName(base) ?? 'Playlist';
  if (!used.has(b.toLocaleLowerCase('en-US'))) return b;
  for (let n = 2; n < 10_000; n++) {
    const c = cleanName(`${b} ${n}`) as string;
    if (!used.has(c.toLocaleLowerCase('en-US'))) return c;
  }
  return b;
}

// ---------------------------------------------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------------------------------------------

/** The fingerprint's Map key, in the form listOps.splitOrphans already matches stored copies by: "name|size". The size
 *  is last and digits only, so the last '|' splits it: no file name can make two different pairs collide. */
export const fpKey = (file: string, size: number): string => `${file}|${size}`;
export const fpOfTrack = (t: TrackLike): string => fpKey(t.file.name, t.file.size);

/** A playlist entry for a library track, as it is now. */
export function entryOf(t: TrackLike): PlaylistEntry {
  return { id: t.id, name: t.name, file: t.file.name, size: t.file.size };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation on read: a record reaches App's state only through here
// ---------------------------------------------------------------------------------------------------------------

const isFiniteTime = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function parseEntry(raw: unknown): PlaylistEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const { id, name, file, size } = e;
  if (typeof id !== 'string' || !id || id.length > TRACK_ID_MAX || CONTROL_RE.test(id)) return null;
  if (typeof name !== 'string' || name.length > 1024) return null;
  if (typeof file !== 'string' || !file || file.length > FILE_MAX) return null;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return null;
  return { id, name, file, size };
}

/** One stored record, or null when it doesn't hold together (it is then left on disk, untouched, and not shown). */
export function parseRecord(raw: unknown): PlaylistRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== RECORD_VERSION) return null;
  if (!isPlaylistId(r.id) || r.key !== keyOf(r.id as string)) return null;
  const name = cleanName(r.name);
  if (!name || typeof r.name !== 'string' || r.name.length > NAME_MAX * 4) return null;
  if (!isFiniteTime(r.createdAt) || !isFiniteTime(r.updatedAt)) return null;
  if (!Array.isArray(r.entries) || r.entries.length > ENTRIES_MAX) return null;
  const entries: PlaylistEntry[] = [];
  for (const x of r.entries) {
    const e = parseEntry(x);
    if (!e) return null; // one bad entry: the record is suspect, so it is not shown (and never rewritten)
    entries.push(e);
  }
  let from: PlaylistFrom | undefined;
  if (r.from !== undefined) {
    const f = r.from as Record<string, unknown> | null;
    const kinds: readonly string[] = ['new', 'queue', 'playing', 'duplicate', 'filter', 'builder'];
    if (!f || typeof f !== 'object' || typeof f.kind !== 'string' || !kinds.includes(f.kind)) return null;
    const label = f.label === undefined ? undefined : cleanName(f.label);
    if (f.label !== undefined && !label) return null;
    from = label ? { kind: f.kind as PlaylistFromKind, label } : { kind: f.kind as PlaylistFromKind };
  }
  const out: PlaylistRecord = { key: keyOf(r.id as string), v: 1, id: r.id as string, name, createdAt: r.createdAt as number, updatedAt: r.updatedAt as number, entries };
  if (from) out.from = from;
  return out;
}

/** Every stored record: the readable ones, newest change first (ties by name, then id), and how many were not. */
export function parseAll(raws: readonly unknown[]): { lists: PlaylistRecord[]; unreadable: number } {
  const byId = new Map<string, PlaylistRecord>();
  let unreadable = 0;
  for (const raw of raws) {
    const p = parseRecord(raw);
    if (!p || byId.has(p.id) || byId.size >= PLAYLISTS_MAX) unreadable++;
    else byId.set(p.id, p);
  }
  return { lists: sortLists([...byId.values()]), unreadable };
}

export function sortLists(lists: PlaylistRecord[]): PlaylistRecord[] {
  return lists.slice().sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'en-US') || (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------------
// The library index and resolution (by id, else by fingerprint, else missing)
// ---------------------------------------------------------------------------------------------------------------

export interface LibraryIndex<T extends TrackLike> {
  byId: Map<string, T>;
  /** The FIRST track of the library (in its order) with each fingerprint: a re-import imported twice relinks to the
   *  first copy, the same one every time. */
  byFp: Map<string, T>;
}

export function indexLibrary<T extends TrackLike>(library: readonly T[]): LibraryIndex<T> {
  const byId = new Map<string, T>();
  const byFp = new Map<string, T>();
  for (const t of library) {
    if (!byId.has(t.id)) byId.set(t.id, t);
    if (t.file && typeof t.file.name === 'string') {
      const k = fpOfTrack(t);
      if (!byFp.has(k)) byFp.set(k, t);
    }
  }
  return { byId, byFp };
}

/** The library track an entry plays: its own id if the library still holds it, else the first track with its
 *  fingerprint (a re-import of the same file), else null (missing). */
export function resolveEntry<T extends TrackLike>(e: PlaylistEntry, idx: LibraryIndex<T>): T | null {
  return idx.byId.get(e.id) ?? idx.byFp.get(fpKey(e.file, e.size)) ?? null;
}

export interface ResolvedRow<T> {
  /** `${entry.id}#${occurrence}`: a playlist can hold a track twice. Stable across a move. */
  key: string;
  index: number;
  entry: PlaylistEntry;
  track: T | null;
}

export interface Resolved<T> {
  rows: ResolvedRow<T>[];
  present: number;
  missing: number;
  /** The present tracks' known lengths, in seconds (unknown ones count 0). */
  seconds: number;
}

export function resolvePlaylist<T extends TrackLike>(pl: PlaylistRecord, idx: LibraryIndex<T>): Resolved<T> {
  const seen = new Map<string, number>();
  const rows: ResolvedRow<T>[] = [];
  let present = 0;
  let seconds = 0;
  pl.entries.forEach((entry, index) => {
    const n = (seen.get(entry.id) ?? 0) + 1;
    seen.set(entry.id, n);
    const track = resolveEntry(entry, idx);
    if (track) {
      present++;
      if (typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0) seconds += track.duration;
    }
    rows.push({ key: `${entry.id}#${n}`, index, entry, track });
  });
  return { rows, present, missing: rows.length - present, seconds };
}

/** The tracks a Play, Shuffle, Play next or Add to queue plays: the present ones, in the playlist's order. */
export function presentTracks<T extends TrackLike>(pl: PlaylistRecord, idx: LibraryIndex<T>): T[] {
  const out: T[] = [];
  for (const e of pl.entries) {
    const t = resolveEntry(e, idx);
    if (t) out.push(t);
  }
  return out;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  count: number;
  present: number;
  missing: number;
  seconds: number;
  updatedAt: number;
}

/** The list view's rows: one pass over every entry of every playlist (O(total entries)). */
export function summaries<T extends TrackLike>(lists: readonly PlaylistRecord[], idx: LibraryIndex<T>): PlaylistSummary[] {
  return lists.map((pl) => {
    let present = 0;
    let seconds = 0;
    for (const e of pl.entries) {
      const t = resolveEntry(e, idx);
      if (!t) continue;
      present++;
      if (typeof t.duration === 'number' && Number.isFinite(t.duration) && t.duration > 0) seconds += t.duration;
    }
    return { id: pl.id, name: pl.name, count: pl.entries.length, present, missing: pl.entries.length - present, seconds, updatedAt: pl.updatedAt };
  });
}

/** The playlists that hold the track (an entry that resolves to it, by id or by fingerprint), in list order: the
 *  delete Dialog's sentence counts them and names the first. One pass, O(total entries). */
export function playlistsWith<T extends TrackLike>(trackId: string, lists: readonly PlaylistRecord[], idx: LibraryIndex<T>): string[] {
  const out: string[] = [];
  for (const pl of lists) {
    for (const e of pl.entries) {
      const t = resolveEntry(e, idx);
      if (t && t.id === trackId) {
        out.push(pl.id);
        break;
      }
    }
  }
  return out;
}

/** The playlist the play order IS (its own entries, the queue's left out): the one whose present tracks are exactly
 *  `orderIds`, in order. `prefer` (the playlist last started this session) wins a tie. Null: none, or more than one
 *  and none preferred. Cheap: only playlists with as many present tracks are compared. */
export function playlistPlaying<T extends TrackLike>(orderIds: readonly string[], lists: readonly PlaylistRecord[], idx: LibraryIndex<T>, prefer: string | null = null): string | null {
  if (orderIds.length === 0) return null;
  const hits: string[] = [];
  for (const pl of lists) {
    if (pl.entries.length < orderIds.length) continue;
    let i = 0;
    let same = true;
    for (const e of pl.entries) {
      const t = resolveEntry(e, idx);
      if (!t) continue;
      if (i >= orderIds.length || t.id !== orderIds[i]) {
        same = false;
        break;
      }
      i++;
    }
    if (same && i === orderIds.length) hits.push(pl.id);
  }
  if (hits.length === 0) return null;
  if (prefer && hits.includes(prefer)) return prefer;
  return hits[0]; // the most recently changed of the ties (lists come sorted)
}

// ---------------------------------------------------------------------------------------------------------------
// Edits: each returns a new record (or null when it can't apply), never mutating its input
// ---------------------------------------------------------------------------------------------------------------

function touched(pl: PlaylistRecord, entries: PlaylistEntry[], now: number): PlaylistRecord {
  return { ...pl, entries, updatedAt: Math.max(now, pl.updatedAt) };
}

/** An edit saves the playlist with every present entry under the id it resolves to now, so a relink by fingerprint
 *  becomes the stored id (records converge on the library's ids; nothing else is rewritten in the background). */
export function relinked<T extends TrackLike>(entries: readonly PlaylistEntry[], idx: LibraryIndex<T> | null): PlaylistEntry[] {
  if (!idx) return entries.slice();
  return entries.map((e) => {
    if (idx.byId.has(e.id)) return e;
    const t = idx.byFp.get(fpKey(e.file, e.size));
    return t ? { ...e, id: t.id } : e;
  });
}

export function createPlaylist(o: { id: string; name: string; tracks: readonly TrackLike[]; now: number; from?: PlaylistFrom }): PlaylistRecord | null {
  const name = cleanName(o.name);
  if (!name || !isPlaylistId(o.id) || o.tracks.length > ENTRIES_MAX) return null;
  const rec: PlaylistRecord = { key: keyOf(o.id), v: 1, id: o.id, name, createdAt: o.now, updatedAt: o.now, entries: o.tracks.map(entryOf) };
  if (o.from) {
    const label = o.from.label === undefined ? null : cleanName(o.from.label);
    rec.from = label ? { kind: o.from.kind, label } : { kind: o.from.kind };
  }
  return rec;
}

export function renamePlaylist(pl: PlaylistRecord, name: string, now: number): PlaylistRecord | null {
  const n = cleanName(name);
  if (!n) return null;
  if (n === pl.name) return pl;
  return { ...pl, name: n, updatedAt: Math.max(now, pl.updatedAt) };
}

export function duplicatePlaylist(pl: PlaylistRecord, o: { id: string; name: string; now: number }): PlaylistRecord | null {
  const name = cleanName(o.name);
  if (!name || !isPlaylistId(o.id) || o.id === pl.id) return null;
  return { key: keyOf(o.id), v: 1, id: o.id, name, createdAt: o.now, updatedAt: o.now, entries: pl.entries.map((e) => ({ ...e })), from: { kind: 'duplicate', label: pl.name } };
}

/** Add tracks at the end (duplicates allowed: walks hold a track more than once). */
export function addTracks<T extends TrackLike>(pl: PlaylistRecord, tracks: readonly TrackLike[], now: number, idx: LibraryIndex<T> | null = null): PlaylistRecord | null {
  if (tracks.length === 0) return pl;
  if (pl.entries.length + tracks.length > ENTRIES_MAX) return null;
  return touched(pl, [...relinked(pl.entries, idx), ...tracks.map(entryOf)], now);
}

/** Remove the entries at these indices (a row's Remove, or Remove missing). */
export function removeAt<T extends TrackLike>(pl: PlaylistRecord, indices: Iterable<number>, now: number, idx: LibraryIndex<T> | null = null): PlaylistRecord {
  const drop = new Set<number>();
  for (const i of indices) if (Number.isInteger(i) && i >= 0 && i < pl.entries.length) drop.add(i);
  if (drop.size === 0) return pl;
  return touched(pl, relinked(pl.entries, idx).filter((_, i) => !drop.has(i)), now);
}

/** Move the entry at `from` to `to` (both in the list as it is; clamped). The others keep their order. */
export function moveEntry<T extends TrackLike>(pl: PlaylistRecord, from: number, to: number, now: number, idx: LibraryIndex<T> | null = null): PlaylistRecord {
  const n = pl.entries.length;
  if (!Number.isInteger(from) || from < 0 || from >= n) return pl;
  const t = Math.max(0, Math.min(n - 1, Math.trunc(to)));
  if (t === from) return pl;
  const list = relinked(pl.entries, idx);
  const [e] = list.splice(from, 1);
  list.splice(t, 0, e);
  return touched(pl, list, now);
}

/** The indices of the missing entries (Remove missing). */
export function missingIndices<T extends TrackLike>(pl: PlaylistRecord, idx: LibraryIndex<T>): number[] {
  const out: number[] = [];
  pl.entries.forEach((e, i) => {
    if (!resolveEntry(e, idx)) out.push(i);
  });
  return out;
}

/** The record an Undo puts back is only put back over the record the op made (the same object): any change since
 *  (another edit, a rename, a delete, a Clear) makes the Undo refuse rather than lose it. */
export function undoApplies(current: PlaylistRecord | null | undefined, after: PlaylistRecord | null): boolean {
  return (current ?? null) === after;
}
