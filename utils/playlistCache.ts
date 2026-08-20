// utils/playlistCache.ts
//
// CABI Playlist Persistence & Cache Management.
//
// The Aetheria player keeps uploaded songs in browser memory only, so any page
// reload (intentional, accidental, or watchdog recovery) wipes the playlist and
// forces a full re-import + re-analysis. This module persists the playlist —
// audio blobs AND analysis metadata — to IndexedDB (on-disk, not RAM) so it
// survives reloads, and restores it on next launch.
//
// PERFORMANCE-CRITICAL DESIGN — why blobs and metadata live in SEPARATE stores:
//   The first version stored each track as ONE combined record (audio blob +
//   metadata together). Every metadata change — and a deep scan streams in
//   duration, fractal/interval analysis and a band envelope per track, firing
//   hundreds of playlist updates — rewrote that whole record, i.e. re-wrote the
//   entire multi-GB audio library to disk over and over. On phones that meant
//   sustained heavy disk I/O, heat, and a scan that crawled because the writes
//   fought the (already CPU-bound) analysis.
//   The fix: keep audio in `blobs` and metadata in `meta`. Audio is heavy but
//   changes ONLY when tracks are added/removed (the id set), so blobs are
//   written incrementally and NEVER rewritten for a metadata change. Metadata
//   is light (~tens of KB/track incl. the Uint8Array band envelope) and can be
//   rewritten freely. Scan-time churn now touches only `meta`, never the audio.
//
// LARGE-LIBRARY DESIGN — why writes are chunked:
//   Blobs used to go out in ONE transaction covering every newly-added track.
//   IndexedDB aborts a transaction as a unit, so a multi-thousand-track import
//   that ran past quota persisted NOTHING — not a partial library — and the
//   failure was swallowed to a console.warn, so the user only found out when a
//   reload came back empty. Writes are now split into count- and byte-bounded
//   chunks, each its own transaction, so hitting quota costs the tail rather
//   than the whole library, and the outcome is reported back to the caller so
//   the UI can say so out loud. Because the add/delete diff is computed against
//   getAllKeys() on the store itself, a partial write simply resumes on the
//   next save — no extra bookkeeping is needed to make it self-heal.
//   Metadata is written in the same spirit: only tracks whose signature
//   actually changed are put, instead of clear()-ing and rewriting every record
//   (which at a few thousand tracks meant rewriting every ~24 KB band envelope
//   on every debounced save).
//
// Other invariants:
//  - Caching is a CONVENIENCE, never critical. Every operation fails silently
//    (console.warn) so a storage error can never crash playback or import.
//    Failures are now also REPORTED (see BlobSaveResult) — reporting is not the
//    same as throwing, and nothing here ever throws into the player.
//  - Restore joins `blobs` + `meta` by id, preserving every Song field
//    (harmonicFreq, analyses, bandEnvelope) so restored tracks aren't degraded.

import type { Song } from '../types';
import type { LoShuWalkMode } from '../constants';

const DB_NAME = 'aetheria-db';
// v2: split the old combined `songs` store into `blobs` + `meta`. The schema is
// not back-compatible; we deliberately DROP any v1 cache on upgrade (the user
// re-imports once) rather than migrate.
const DB_VERSION = 2;
const LEGACY_SONGS_STORE = 'songs';
const BLOBS_STORE = 'blobs';
const META_STORE = 'meta';
const STATE_STORE = 'playlist-state';
const STATE_KEY = 'current';

// Blob writes are split into chunks bounded by BOTH a track count and a byte
// total, so one transaction never carries the whole library. The byte bound is
// what actually matters near quota; the count bound keeps per-transaction
// latency sane for libraries of small files.
const BLOB_CHUNK_COUNT = 25;
const BLOB_CHUNK_BYTES = 200 * 1024 * 1024; // 200 MB

// Restore reads stores in key-ranged slices rather than one getAll() over the
// whole store, so a multi-thousand-track library doesn't arrive as a single
// enormous request.
const RESTORE_CHUNK = 200;

// Headroom left free beyond the payload we are about to write, so a save never
// fills the origin quota to the brim. Applied PER CHUNK, so it must stay small:
// at 100 MB a 2 MB chunk demanded 102 MB of free space, which on a device
// anywhere near its quota blocked every write while looking like a disk-space
// problem. The real limit is enforced by the QuotaExceededError branch below;
// this is only a "don't run it right to the edge" margin.
const CAPACITY_HEADROOM_MB = 10;


// ----------------------------------------------------------------------------
// Cached shapes
// ----------------------------------------------------------------------------

/** Audio only. Heavy, but written once per track and never rewritten for a
 *  metadata change. The File is split into a Blob + name + type so we can
 *  reconstruct a real File on restore. */
interface CachedBlob {
  id: string;
  fileBlob: Blob;
  fileName: string;
  fileType: string;
}

/** Everything about a track EXCEPT the audio. Light enough to rewrite freely.
 *  bandEnvelope's Uint8Arrays survive IndexedDB structured clone. */
interface CachedMeta {
  id: string;
  name: string;
  duration?: number;
  harmonicFreq?: number;
  closestSolfeggio?: number;
  harmonicDeviation?: number;
  fractalAnalysis?: Song['fractalAnalysis'];
  intervalAnalysis?: Song['intervalAnalysis'];
  isAetheriaCandidate?: boolean;
  bandEnvelope?: Song['bandEnvelope'];
}

interface CachedState {
  key: string;
  playlistOrder: string[];
  originalOrder: string[];
  currentSongIndex: number;
  loShuWalkMode: LoShuWalkMode | null;
  selectedSolfeggio: number;
  savedAt: number;
}

export interface RestoredPlaylist {
  playlist: Song[];
  originalPlaylist: Song[];
  currentSongIndex: number;
  loShuWalkMode: LoShuWalkMode | null;
  selectedSolfeggio: number;
  savedAt: number;
}

/** Outcome of a blob sync, so the UI can tell the user when their library did
 *  NOT fully persist instead of failing invisibly. `pending` is how many tracks
 *  still have no cached audio after this pass; they retry on the next save. */
export interface BlobSaveResult {
  written: number;
  deleted: number;
  pending: number;
  total: number;
  quotaExceeded: boolean;
  /** Real numbers from the Storage API, filled in when the cache runs short.
   *  Surfaced in the UI so a storage problem reports itself rather than needing
   *  a console on a phone to diagnose. */
  availableMB?: number;
  quotaMB?: number;
}

// ----------------------------------------------------------------------------
// Database setup
// ----------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      // Drop the legacy v1 combined store (blob+meta together). We chose
      // drop-and-reimport over migration; this also frees the old blobs.
      if (db.objectStoreNames.contains(LEGACY_SONGS_STORE)) {
        db.deleteObjectStore(LEGACY_SONGS_STORE);
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolve when a transaction completes; reject (or abort) on error. */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Promise wrapper around a single IDBRequest. */
function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** True for the one error worth treating specially: the disk/quota wall. Chrome
 *  reports it as a DOMException named QuotaExceededError; older engines only set
 *  the legacy numeric code 22. Everything else stays a generic non-fatal warn. */
function isQuotaError(err: unknown): boolean {
  const e = err as (DOMException & { code?: number }) | null;
  if (!e) return false;
  return e.name === 'QuotaExceededError' || e.code === 22;
}

// ----------------------------------------------------------------------------
// Serialization
// ----------------------------------------------------------------------------

function toBlob(song: Song): CachedBlob {
  return {
    id: song.id,
    fileBlob: song.file, // File IS a Blob — IndexedDB stores it directly.
    fileName: song.file.name,
    fileType: song.file.type,
  };
}

function toMeta(song: Song): CachedMeta {
  return {
    id: song.id,
    name: song.name,
    duration: song.duration,
    harmonicFreq: song.harmonicFreq,
    closestSolfeggio: song.closestSolfeggio,
    harmonicDeviation: song.harmonicDeviation,
    fractalAnalysis: song.fractalAnalysis,
    intervalAnalysis: song.intervalAnalysis,
    isAetheriaCandidate: song.isAetheriaCandidate,
    bandEnvelope: song.bandEnvelope,
  };
}

/** Dedupe songs across playlist + originalPlaylist (a track can appear in both),
 *  keeping only those that still carry a File. */
function uniqueSongs(playlist: Song[], originalPlaylist: Song[]): Map<string, Song> {
  const map = new Map<string, Song>();
  for (const s of [...playlist, ...originalPlaylist]) {
    if (s.file && !map.has(s.id)) map.set(s.id, s);
  }
  return map;
}

/** A cheap fingerprint of everything toMeta() would write. Comparing these lets
 *  us put ONLY the tracks that actually changed. The heavy fields (analyses,
 *  band envelope) are represented by presence/length rather than content — they
 *  are written once by the scan and never edited afterwards, so that is enough
 *  to notice the transition from absent to present. */
function metaSignature(song: Song): string {
  return [
    song.name,
    song.duration ?? '',
    song.harmonicFreq ?? '',
    song.closestSolfeggio ?? '',
    song.harmonicDeviation ?? '',
    song.fractalAnalysis ? '1' : '0',
    song.intervalAnalysis ? '1' : '0',
    song.isAetheriaCandidate ? '1' : '0',
    // Optional-chained all the way down on purpose. This runs inside
    // saveMetaAndState's try block, and a throw here would abort BEFORE the
    // playlist-state record is written — and without that record restore
    // returns null, i.e. the whole library silently disappears. A malformed
    // envelope must never be able to cost the user their cache.
    song.bandEnvelope?.sub?.length ?? '0',
  ].join('|');
}

/** id -> last-written meta signature. Module-level and in-memory: on a cold
 *  start it is empty, so the first save after load writes everything (exactly
 *  the old behaviour, no regression) and every save after that is incremental.
 *  restorePlaylist() seeds it so a restored library skips that first full
 *  rewrite too. */
const metaSignatures = new Map<string, string>();

// ----------------------------------------------------------------------------
// Persistent-storage request
// ----------------------------------------------------------------------------

let persistChecked = false;

/** Ask the browser to make this origin's storage persistent, once per session.
 *  Without it IndexedDB is "best-effort" and Chrome may evict a multi-GB music
 *  library under disk pressure with no warning. Granting depends on engagement
 *  heuristics (installed PWA, bookmarked, notification permission), so a false
 *  return is normal rather than an error — log it and carry on. */
async function requestPersistentStorage(): Promise<boolean> {
  if (persistChecked) return true;
  persistChecked = true;
  try {
    if (!navigator.storage?.persist) return false;
    if (navigator.storage.persisted && (await navigator.storage.persisted())) {
      console.log('[PlaylistCache] Storage already persistent');
      return true;
    }
    const granted = await navigator.storage.persist();
    console.log(
      granted
        ? '[PlaylistCache] Persistent storage GRANTED — library is safe from eviction'
        : '[PlaylistCache] Persistent storage denied — cache is best-effort and may be evicted'
    );
    return granted;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Save — blobs (incremental id-set diff, chunked). The ONLY path writing audio.
// ----------------------------------------------------------------------------

/** Split songs into transaction-sized chunks by count AND accumulated bytes. A
 *  single file larger than the byte bound still gets its own chunk rather than
 *  being dropped. */
function chunkSongs(songs: Song[]): Song[][] {
  const chunks: Song[][] = [];
  let current: Song[] = [];
  let bytes = 0;
  for (const song of songs) {
    const size = song.file?.size || 0;
    if (
      current.length > 0 &&
      (current.length >= BLOB_CHUNK_COUNT || bytes + size > BLOB_CHUNK_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(song);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Sync the `blobs` store to the current id set: write blobs for newly added
 *  tracks, delete blobs for removed tracks, and — crucially — leave existing
 *  blobs untouched. A metadata-only change produces ZERO blob writes.
 *
 *  Adds go out in chunks, so running out of disk part-way through keeps
 *  everything already written. The next call recomputes the diff from the
 *  store's own keys and resumes exactly where this one stopped. */
async function saveBlobs(
  playlist: Song[],
  originalPlaylist: Song[]
): Promise<BlobSaveResult> {
  const wanted = uniqueSongs(playlist, originalPlaylist);
  const result: BlobSaveResult = {
    written: 0,
    deleted: 0,
    pending: 0,
    total: wanted.size,
    quotaExceeded: false,
  };

  try {
    const db = await openDB();

    // Read existing keys (own readonly tx — avoids the "transaction went
    // inactive across an await" pitfall before we issue writes).
    const existing = (await reqDone(
      db.transaction(BLOBS_STORE, 'readonly').objectStore(BLOBS_STORE).getAllKeys()
    )) as string[];
    const existingSet = new Set(existing);

    const toAdd: Song[] = [];
    for (const [id, song] of wanted) {
      if (!existingSet.has(id)) toAdd.push(song);
    }
    const toDelete: string[] = [];
    for (const id of existingSet) {
      if (!wanted.has(id)) toDelete.push(id);
    }

    if (toAdd.length === 0 && toDelete.length === 0) {
      db.close();
      return result; // nothing changed — no audio rewritten
    }

    // Deletes first: they free space, which is exactly what the adds may need.
    if (toDelete.length > 0) {
      const delTx = db.transaction(BLOBS_STORE, 'readwrite');
      const delStore = delTx.objectStore(BLOBS_STORE);
      for (const id of toDelete) delStore.delete(id);
      await txDone(delTx);
      result.deleted = toDelete.length;
    }

    if (toAdd.length > 0) {
      const addBytes = toAdd.reduce((acc, s) => acc + (s.file?.size || 0), 0);
      console.log(
        `[PlaylistCache] Caching ${toAdd.length} new tracks ` +
          `(${(addBytes / 1048576).toFixed(0)} MB) in chunks`
      );

      // Worth asking before committing gigabytes to a cache the browser is
      // otherwise free to evict.
      await requestPersistentStorage();

      // Capacity is checked PER CHUNK, against that chunk's size only.
      //
      // It was briefly checked against the whole import up front, refusing to
      // write anything unless the entire library fit — which defeated the point
      // of chunking and was a straight regression against the old flat 100 MB
      // floor. On phones, where estimate() reports a far smaller quota than on
      // desktop, a few-hundred-track library tripped it and cached NOTHING, so
      // every launch re-imported and re-scanned from scratch. Write as much as
      // actually fits; the remainder resumes on the next save.
      for (const chunk of chunkSongs(toAdd)) {
        const chunkMB = chunk.reduce((a, s) => a + (s.file?.size || 0), 0) / 1048576;
        if (!(await hasStorageCapacity(chunkMB + CAPACITY_HEADROOM_MB))) {
          result.quotaExceeded = true;
          Object.assign(result, await storageSnapshot());
          console.warn(
            `[PlaylistCache] Stopping after ${result.written} of ${toAdd.length} new tracks — ` +
              `not enough room for the next ${chunkMB.toFixed(0)} MB. Everything written so far is kept.`
          );
          break;
        }
        try {
          const tx = db.transaction(BLOBS_STORE, 'readwrite');
          const store = tx.objectStore(BLOBS_STORE);
          for (const song of chunk) store.put(toBlob(song));
          await txDone(tx);
          result.written += chunk.length;
        } catch (err) {
          if (isQuotaError(err)) {
            result.quotaExceeded = true;
            Object.assign(result, await storageSnapshot());
            console.warn(
              `[PlaylistCache] Out of storage after ${result.written} of ${toAdd.length} ` +
                `new tracks. Everything written so far is kept; the rest retries next save.`
            );
            break;
          }
          // A non-quota failure on one chunk shouldn't abandon the rest.
          console.warn('[PlaylistCache] Blob chunk failed (non-fatal):', err);
        }
      }
      result.pending = toAdd.length - result.written;
    }

    db.close();
    console.log(
      `[PlaylistCache] Blobs synced: +${result.written} -${result.deleted} ` +
        `(kept ${wanted.size - result.written - result.pending}, pending ${result.pending})`
    );
    return result;
  } catch (err) {
    if (isQuotaError(err)) result.quotaExceeded = true;
    console.warn('[PlaylistCache] Blob save failed (non-fatal):', err);
    return result;
  }
}

// ----------------------------------------------------------------------------
// Save — metadata + session state (light; safe to rewrite often)
// ----------------------------------------------------------------------------

async function saveMetaAndState(
  playlist: Song[],
  originalPlaylist: Song[],
  currentSongIndex: number,
  loShuWalkMode: LoShuWalkMode | null,
  selectedSolfeggio: number
): Promise<void> {
  try {
    const db = await openDB();
    const wanted = uniqueSongs(playlist, originalPlaylist);

    // Metadata: write only what changed. This used to clear() the store and
    // re-put every record — at a few thousand tracks that rewrote every band
    // envelope (~24 KB each) on every debounced save.
    const existingMetaKeys = (await reqDone(
      db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAllKeys()
    )) as string[];

    const dirty: Song[] = [];
    for (const song of wanted.values()) {
      if (metaSignatures.get(song.id) !== metaSignature(song)) dirty.push(song);
    }
    const staleKeys = existingMetaKeys.filter((id) => !wanted.has(id));

    if (dirty.length > 0 || staleKeys.length > 0) {
      const metaTx = db.transaction(META_STORE, 'readwrite');
      const metaStore = metaTx.objectStore(META_STORE);
      for (const song of dirty) metaStore.put(toMeta(song));
      for (const id of staleKeys) metaStore.delete(id);
      await txDone(metaTx);

      // Record signatures only once the transaction actually committed, so a
      // failed write is retried next time rather than assumed saved.
      for (const song of dirty) metaSignatures.set(song.id, metaSignature(song));
      for (const id of staleKeys) metaSignatures.delete(id);
    }

    // Lightweight ordering / session state.
    const stateTx = db.transaction(STATE_STORE, 'readwrite');
    const state: CachedState = {
      key: STATE_KEY,
      playlistOrder: playlist.map((s) => s.id),
      originalOrder: originalPlaylist.map((s) => s.id),
      currentSongIndex,
      loShuWalkMode,
      selectedSolfeggio,
      savedAt: Date.now(),
    };
    stateTx.objectStore(STATE_STORE).put(state);
    await txDone(stateTx);

    db.close();
    console.log(
      `[PlaylistCache] Meta+state saved: ${dirty.length} changed / ` +
        `${staleKeys.length} removed of ${wanted.size} tracks, order ${playlist.length}`
    );
  } catch (err) {
    console.warn('[PlaylistCache] Meta save failed (non-fatal):', err);
  }
}

/** Full save (blobs + meta + state). Kept for callers that want a one-shot
 *  persist; the App drives blobs and meta on separate cadences instead. */
async function savePlaylist(
  playlist: Song[],
  originalPlaylist: Song[],
  currentSongIndex: number,
  loShuWalkMode: LoShuWalkMode | null,
  selectedSolfeggio: number
): Promise<void> {
  await saveBlobs(playlist, originalPlaylist);
  await saveMetaAndState(
    playlist,
    originalPlaylist,
    currentSongIndex,
    loShuWalkMode,
    selectedSolfeggio
  );
}

// ----------------------------------------------------------------------------
// Restore
// ----------------------------------------------------------------------------

/** Read an entire object store in key-ranged slices. One getAll() over a
 *  multi-thousand-record blob store materialises every record in a single
 *  request; slicing keeps each request bounded and lets us report progress. */
async function getAllChunked<T>(
  db: IDBDatabase,
  storeName: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<T[]> {
  const keys = (await reqDone(
    db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys()
  )) as IDBValidKey[];

  const out: T[] = [];
  for (let i = 0; i < keys.length; i += RESTORE_CHUNK) {
    const slice = keys.slice(i, i + RESTORE_CHUNK);
    // getAllKeys() returns keys in sorted order, so a bound over the first and
    // last of a contiguous slice selects exactly that slice.
    const range = IDBKeyRange.bound(slice[0], slice[slice.length - 1]);
    const rows = (await reqDone(
      db.transaction(storeName, 'readonly').objectStore(storeName).getAll(range)
    )) as T[];
    out.push(...rows);
    onProgress?.(Math.min(out.length, keys.length), keys.length);
  }
  return out;
}

async function restorePlaylist(
  onProgress?: (loaded: number, total: number) => void
): Promise<RestoredPlaylist | null> {
  try {
    const db = await openDB();

    // 1. Playlist state.
    const state = (await reqDone(
      db.transaction(STATE_STORE, 'readonly').objectStore(STATE_STORE).get(STATE_KEY)
    )) as CachedState | undefined;

    if (!state || !state.playlistOrder?.length) {
      db.close();
      return null;
    }

    // 2. Blobs + metadata, joined by id. Both read in slices so a large library
    //    doesn't arrive as one enormous request.
    const blobs = await getAllChunked<CachedBlob>(db, BLOBS_STORE, onProgress);
    const metas = await getAllChunked<CachedMeta>(db, META_STORE);
    db.close();

    const blobMap = new Map<string, CachedBlob>();
    for (const b of blobs) blobMap.set(b.id, b);
    const metaMap = new Map<string, CachedMeta>();
    for (const m of metas) metaMap.set(m.id, m);

    // A track needs its audio to be playable; metadata is optional (a track
    // imported but not yet scanned restores playable and gets re-analyzed).
    const toSong = (id: string): Song | null => {
      const blob = blobMap.get(id);
      if (!blob) return null;
      const meta = metaMap.get(id);
      const file = new File([blob.fileBlob], blob.fileName, { type: blob.fileType });
      return {
        file,
        id,
        name: meta?.name ?? blob.fileName,
        duration: meta?.duration,
        harmonicFreq: meta?.harmonicFreq,
        closestSolfeggio: meta?.closestSolfeggio,
        harmonicDeviation: meta?.harmonicDeviation,
        fractalAnalysis: meta?.fractalAnalysis,
        intervalAnalysis: meta?.intervalAnalysis,
        isAetheriaCandidate: meta?.isAetheriaCandidate,
        bandEnvelope: meta?.bandEnvelope,
      };
    };

    const playlist = state.playlistOrder
      .map(toSong)
      .filter((s): s is Song => s !== null);
    const originalPlaylist = state.originalOrder
      .map(toSong)
      .filter((s): s is Song => s !== null);

    if (playlist.length === 0) return null;

    // Seed the signature map from what is already on disk, so the first settle
    // save after a restore writes only genuinely-new metadata instead of
    // rewriting the whole library.
    metaSignatures.clear();
    for (const song of [...playlist, ...originalPlaylist]) {
      if (metaMap.has(song.id)) metaSignatures.set(song.id, metaSignature(song));
    }

    console.log(
      `[PlaylistCache] Restored ${playlist.length} songs ` +
        `(saved ${new Date(state.savedAt).toLocaleTimeString()})`
    );

    return {
      playlist,
      originalPlaylist: originalPlaylist.length ? originalPlaylist : playlist,
      currentSongIndex: Math.min(
        Math.max(state.currentSongIndex, -1),
        playlist.length - 1
      ),
      loShuWalkMode: state.loShuWalkMode ?? null,
      selectedSolfeggio: state.selectedSolfeggio,
      savedAt: state.savedAt,
    };
  } catch (err) {
    console.warn('[PlaylistCache] Restore failed (non-fatal):', err);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Clear
// ----------------------------------------------------------------------------

async function clearPlaylistCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([BLOBS_STORE, META_STORE, STATE_STORE], 'readwrite');
    tx.objectStore(BLOBS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    tx.objectStore(STATE_STORE).clear();
    await txDone(tx);
    db.close();
    // The in-memory signature map mirrors the meta store; dropping one without
    // the other would make the next save think everything is already written.
    metaSignatures.clear();
    console.log('[PlaylistCache] Cache cleared');
  } catch (err) {
    console.warn('[PlaylistCache] Clear failed:', err);
  }
}

// ----------------------------------------------------------------------------
// Storage capacity guard
// ----------------------------------------------------------------------------

/** True if the device looks like it has at least `requiredMB` free. When the
 *  Storage API is unavailable or throws, assume OK — we never want a missing
 *  diagnostic to block caching on a perfectly capable device.
 *  Callers pass the size of the payload they are about to write; the default is
 *  only a floor, for callers with nothing heavy to save. */
/** Current quota/usage in MB, or null if the Storage API isn't available. */
async function storageSnapshot(): Promise<{ availableMB: number; quotaMB: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    const quotaMB = (est.quota || 0) / 1048576;
    return { availableMB: quotaMB - (est.usage || 0) / 1048576, quotaMB };
  } catch {
    return null;
  }
}

async function hasStorageCapacity(requiredMB: number = 100): Promise<boolean> {
  try {
    if (!navigator.storage?.estimate) return true;
    const est = await navigator.storage.estimate();
    const availableMB = ((est.quota || 0) - (est.usage || 0)) / (1024 * 1024);
    if (availableMB < requiredMB) {
      console.warn(
        `[PlaylistCache] Low storage: ${availableMB.toFixed(0)} MB available, ` +
          `${requiredMB.toFixed(0)} MB needed. Skipping cache.`
      );
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

// ----------------------------------------------------------------------------
// Debounced savers — separate cadences for the two concerns
// ----------------------------------------------------------------------------

let blobTimer: ReturnType<typeof setTimeout> | null = null;
let metaTimer: ReturnType<typeof setTimeout> | null = null;

/** Persist blob deltas. Driven by id-set changes (import/delete), which are
 *  rare, so a short debounce just coalesces the paired playlist/originalPlaylist
 *  updates of a single import. `onResult` receives the outcome so the UI can
 *  report a library that only partially persisted. */
function saveBlobsNow(
  playlist: Song[],
  originalPlaylist: Song[],
  onResult?: (result: BlobSaveResult) => void,
  delayMs: number = 300
): void {
  if (blobTimer) clearTimeout(blobTimer);
  blobTimer = setTimeout(async () => {
    // The capacity check lives inside saveBlobs now, where the actual byte
    // count of the pending writes is known.
    const result = await saveBlobs(playlist, originalPlaylist);
    onResult?.(result);
  }, delayMs);
}

/** Persist metadata + session state. Driven by playlist/state changes; the App
 *  suppresses this during an active deep scan and lets it fire once on settle. */
function debouncedSaveMeta(
  playlist: Song[],
  originalPlaylist: Song[],
  currentSongIndex: number,
  loShuWalkMode: LoShuWalkMode | null,
  selectedSolfeggio: number,
  delayMs: number = 2000
): void {
  if (metaTimer) clearTimeout(metaTimer);
  metaTimer = setTimeout(async () => {
    // NO capacity pre-check here, deliberately.
    //
    // Metadata and the playlist-state record are kilobytes, and state is the
    // INDEX — restore reads playlistOrder first and bails out entirely without
    // it. Gating it behind a megabyte-scale free-space check (it used to share
    // the audio's flat 100 MB floor) meant a device near its quota could hold a
    // perfectly good set of audio blobs and still restore nothing, because the
    // few-KB index was the one write that got skipped. Always attempt it; the
    // try/catch inside saveMetaAndState is the correct place for a real failure.
    await saveMetaAndState(
      playlist,
      originalPlaylist,
      currentSongIndex,
      loShuWalkMode,
      selectedSolfeggio
    );
  }, delayMs);
}

export {
  openDB,
  savePlaylist,
  saveBlobs,
  saveMetaAndState,
  restorePlaylist,
  clearPlaylistCache,
  hasStorageCapacity,
  requestPersistentStorage,
  saveBlobsNow,
  debouncedSaveMeta,
};
