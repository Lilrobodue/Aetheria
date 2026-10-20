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
// Other invariants:
//  - Caching is a CONVENIENCE, never critical. Every operation fails silently
//    (console.warn) so a storage error can never crash playback or import.
//  - Restore joins `blobs` + `meta` by id, preserving every Song field
//    (harmonicFreq, analyses, bandEnvelope) so restored tracks aren't degraded.
//
// DELETION IS EXPLICIT (v14.5). The saves below only ever ADD audio and PUT
// metadata; nothing is inferred from "this id is no longer in the lists".
// Until v14.4 the blob sync deleted every stored track missing from
// playlist ∪ originalPlaylist, so any bug that shrank the library in memory
// (Deep Scan, Auto-Distribute or an import while a mix was showing) deleted the
// rest of the library's audio from disk. Now only deleteTracksFromCache (the
// Delete action) and clearPlaylistCache (Clear) remove anything. Deleted ids are
// tombstoned for the session so a save scheduled before the delete can't
// write them back, and Clear bumps an epoch so a pending or running save from
// before it writes nothing.

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
  /** null when there was no saved state (only orphans were found). */
  selectedSolfeggio: number | null;
  savedAt: number;
  /** Stored tracks the saved library no longer references — audio a v14.4
   *  library-shrink bug left behind (or a skipped sync). Offered for recovery. */
  orphans: Song[];
}

// ----------------------------------------------------------------------------
// Database setup
// ----------------------------------------------------------------------------

let dbName = DB_NAME;

/** Dev pages only (tools/cache-check): point the cache at a throwaway database
 *  so its round-trip tests never touch the real library. */
function __setCacheDbNameForTests(name: string): void {
  dbName = name;
}

// Session tombstones: ids removed by deleteTracksFromCache. A save that was
// scheduled with an older list (before the delete) skips them.
const tombstones = new Set<string>();

// Bumped by clearPlaylistCache. A save captures the epoch when it is scheduled
// and writes nothing if a Clear happened in between.
let cacheEpoch = 0;

/** Changes with every Clear (synchronously, as the Clear starts). Lets the App
 *  tell whether lists it captured before an await still belong to the current
 *  cache, whatever React has or hasn't re-rendered yet. */
function cacheGeneration(): number {
  return cacheEpoch;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);

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

/** Resolve when a transaction completes; reject (or abort) on error. A failed
 *  request's error event reaches tx.onerror BEFORE the abort sets tx.error, so
 *  reject with the request's own error (Firefox and Safari raise
 *  QuotaExceededError on the request; Chrome aborts at commit instead). */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBRequest | null)?.error ?? tx.error);
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
 *  keeping only those that still carry a File and were not deleted this
 *  session. */
function uniqueSongs(playlist: Song[], originalPlaylist: Song[]): Map<string, Song> {
  const map = new Map<string, Song>();
  for (const s of [...playlist, ...originalPlaylist]) {
    if (s.file && !map.has(s.id) && !tombstones.has(s.id)) map.set(s.id, s);
  }
  return map;
}

// ----------------------------------------------------------------------------
// Save — blobs (incremental, ADD-ONLY). The ONLY path that writes audio.
// ----------------------------------------------------------------------------

// Every save takes a number in start order. A save that started AFTER a
// reported failure saw the same tracks (lists only grow by import), so its
// success means they are stored now — the App withdraws the warning then, and
// only then (an older save finishing late says nothing about them).
let saveSeq = 0;

// Blob saves that are queued or writing now. A reload aborts an IndexedDB
// write mid-way, and the tracks it was storing would not come back, so the
// App's Reload (and anything that must know what is stored) waits for these.
const runningBlobSaves = new Set<Promise<void>>();
// Blob saves run one at a time, in call order. Each reads the stored keys
// after the previous one has committed, so it never counts (or writes again)
// tracks an earlier save is still storing — overlapping saves did both, and
// could report a stored import as "could not be saved". It also keeps seq in
// snapshot order. writeNewBlobs never rejects, so the chain can't break.
let blobChain: Promise<void> = Promise.resolve();

/** Write blobs for tracks that are not stored yet, and leave every stored blob
 *  untouched. A metadata-only change produces ZERO blob writes, and a list that
 *  lost tracks deletes NOTHING — removal goes through deleteTracksFromCache.
 *  Never rejects: failures are caught and reported. `epoch` is taken now, so a
 *  Clear cancels a save still waiting its turn. */
function saveBlobs(
  playlist: Song[],
  originalPlaylist: Song[],
  epoch: number = cacheEpoch
): Promise<void> {
  const running = blobChain.then(() => writeNewBlobs(playlist, originalPlaylist, epoch));
  blobChain = running;
  runningBlobSaves.add(running);
  running.then(() => runningBlobSaves.delete(running));
  return running;
}

async function writeNewBlobs(
  playlist: Song[],
  originalPlaylist: Song[],
  epoch: number
): Promise<void> {
  const seq = ++saveSeq;
  let db: IDBDatabase | null = null;
  // The tracks this save is storing, for the error report.
  let storing: Song[] = [];
  try {
    db = await openDB();

    // Read existing keys (own readonly tx — avoids the "transaction went
    // inactive across an await" pitfall before we issue writes).
    const existing = (await reqDone(
      db.transaction(BLOBS_STORE, 'readonly').objectStore(BLOBS_STORE).getAllKeys()
    )) as string[];
    const existingSet = new Set(existing);

    // Listed after the reads, so a delete that landed during them is skipped
    // (uniqueSongs leaves out tombstoned ids).
    for (const [id, song] of uniqueSongs(playlist, originalPlaylist)) {
      if (!existingSet.has(id)) storing.push(song);
    }
    if (epoch !== cacheEpoch) return;
    if (storing.length === 0) {
      reportCacheOk('tracks', seq); // every track in the lists is stored
      return;
    }

    const availableMB = await availableStorageMB();

    // Re-check after the await (in the same synchronous block as the write or
    // the report): a delete or a Clear may have landed meanwhile, and a track
    // it removed is neither written back, counted for room, nor reported.
    storing = storing.filter((s) => !tombstones.has(s.id));
    if (epoch !== cacheEpoch) return;
    if (storing.length === 0) {
      reportCacheOk('tracks', seq);
      return;
    }

    // Room for these files (plus a margin)? Sized from the files themselves,
    // not a flat figure, so a large import fails visibly instead of silently.
    const neededMB = storing.reduce((sum, s) => sum + (s.file?.size || 0), 0) / (1024 * 1024) + 50;
    if (availableMB < neededMB) {
      console.warn(
        `[PlaylistCache] Low storage: ${availableMB.toFixed(0)} MB available, ` +
          `${neededMB.toFixed(0)} MB needed for ${storing.length} track(s). Not stored.`
      );
      reportCacheError(storing.length, 'storage-full', 'tracks', seq);
      return;
    }

    const tx = db.transaction(BLOBS_STORE, 'readwrite');
    const store = tx.objectStore(BLOBS_STORE);
    for (const song of storing) store.put(toBlob(song));
    await txDone(tx);

    requestPersistentStorageOnce();
    reportCacheOk('tracks', seq);
    console.log(
      `[PlaylistCache] Blobs added: +${storing.length} (stored ${existingSet.size + storing.length})`
    );
  } catch (err) {
    console.warn('[PlaylistCache] Blob save failed:', err);
    // Tracks it was storing won't be here after a reload: say so — leaving out
    // any a delete removed meanwhile. (A failure before they were known, e.g.
    // the database not opening, stays a warning.)
    storing = storing.filter((s) => !tombstones.has(s.id));
    if (storing.length && epoch === cacheEpoch) {
      reportCacheError(storing.length, isQuotaError(err) ? 'storage-full' : 'write-failed', 'tracks', seq);
    }
  } finally {
    db?.close();
  }
}

function isQuotaError(err: unknown): boolean {
  return (err as DOMException)?.name === 'QuotaExceededError';
}

/** Tell the App that the cache could not store something, so it can say so
 *  instead of failing silently. `tracks`: audio that will be gone after a
 *  reload. `state`: the library order and analysis results (metadata). */
function reportCacheError(
  count: number,
  reason: 'storage-full' | 'write-failed',
  what: 'tracks' | 'state',
  seq: number
): void {
  try {
    window.dispatchEvent(new CustomEvent('aetheria:cache-error', { detail: { count, reason, what, seq } }));
  } catch {
    // No window (tests) — nothing to tell.
  }
}

/** Tell the App that a save stored everything it was given, so a warning
 *  from an EARLIER save (lower seq) about those tracks or that state can go. */
function reportCacheOk(what: 'tracks' | 'state', seq: number): void {
  try {
    window.dispatchEvent(new CustomEvent('aetheria:cache-ok', { detail: { what, seq } }));
  } catch {
    // No window (tests) — nothing to tell.
  }
}

// Ask once per session to keep the library out of the browser's evictable
// storage: without it, a phone short of space can delete the whole database.
// Chrome grants it silently for installed or engaged PWAs.
let persistRequested = false;
function requestPersistentStorageOnce(): void {
  if (persistRequested) return;
  persistRequested = true;
  try {
    navigator.storage?.persist?.().then(
      (granted) => console.log(`[PlaylistCache] Persistent storage ${granted ? 'granted' : 'not granted'}`),
      () => {}
    );
  } catch {
    // Storage API unavailable — keep going.
  }
}

// ----------------------------------------------------------------------------
// Delete — the ONLY path that removes a track from the cache
// ----------------------------------------------------------------------------

/** Remove tracks' audio AND metadata in one transaction, and tombstone the ids
 *  for this session so an earlier-scheduled save can't write them back. */
async function deleteTracksFromCache(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) tombstones.add(id);
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const tx = db.transaction([BLOBS_STORE, META_STORE], 'readwrite');
    const blobs = tx.objectStore(BLOBS_STORE);
    const metas = tx.objectStore(META_STORE);
    for (const id of ids) {
      blobs.delete(id);
      metas.delete(id);
    }
    await txDone(tx);
    console.log(`[PlaylistCache] Deleted ${ids.length} track${ids.length === 1 ? '' : 's'} from the cache`);
  } catch (err) {
    console.warn('[PlaylistCache] Delete failed (non-fatal):', err);
  } finally {
    db?.close();
  }
}

/** Ids whose audio is stored. Used to CONFIRM a track is on disk before
 *  removing another copy of it, so a read that fails returns an empty set:
 *  "unknown" must count as "not stored". */
async function storedTrackIds(): Promise<Set<string>> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const keys = (await reqDone(
      db.transaction(BLOBS_STORE, 'readonly').objectStore(BLOBS_STORE).getAllKeys()
    )) as IDBValidKey[];
    return new Set(keys.map(String));
  } catch (err) {
    console.warn('[PlaylistCache] Could not read the stored track ids:', err);
    return new Set();
  } finally {
    db?.close();
  }
}

// ----------------------------------------------------------------------------
// Save — metadata + session state (no audio; rewritten often)
// ----------------------------------------------------------------------------

async function saveMetaAndState(
  playlist: Song[],
  originalPlaylist: Song[],
  currentSongIndex: number,
  loShuWalkMode: LoShuWalkMode | null,
  selectedSolfeggio: number,
  epoch: number = cacheEpoch
): Promise<void> {
  const seq = ++saveSeq;
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();

    // A Clear happened since this save was scheduled: write nothing.
    if (epoch !== cacheEpoch) return;

    // Ordering / session state FIRST, in its own small transaction: with the
    // audio it is all a restore needs (metadata is optional), and a nearly
    // full device can still fit it when the metadata below doesn't — so an
    // import is not left out of the library just because analysis didn't fit.
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

    // Metadata: put every track's record. No clear() first — a track missing
    // from the lists keeps its stored analysis until it is explicitly deleted
    // (deleteTracksFromCache), so a list bug can't wipe hours of Deep Scan
    // results. Not small: it rewrites every track's record (band envelopes
    // and analyses — tens of MB for a large scanned library, all charged
    // against the quota), so on a nearly full device it can fail; that is
    // reported. Listed after the await so a Clear or a delete that landed
    // during the state write is respected.
    if (epoch !== cacheEpoch) return;
    const wanted = uniqueSongs(playlist, originalPlaylist);
    const metaTx = db.transaction(META_STORE, 'readwrite');
    const metaStore = metaTx.objectStore(META_STORE);
    for (const song of wanted.values()) metaStore.put(toMeta(song));
    await txDone(metaTx);

    reportCacheOk('state', seq);
    console.log(
      `[PlaylistCache] Meta+state saved: ${wanted.size} tracks, order ${playlist.length}`
    );
  } catch (err) {
    console.warn('[PlaylistCache] Meta save failed (non-fatal):', err);
    if (epoch === cacheEpoch) {
      reportCacheError(playlist.length, isQuotaError(err) ? 'storage-full' : 'write-failed', 'state', seq);
    }
  } finally {
    db?.close();
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

async function restorePlaylist(): Promise<RestoredPlaylist | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();

    // 1. Playlist state. It can be missing (or name no stored track); stored
    //    audio is then offered back as orphans rather than silently ignored.
    const state = (await reqDone(
      db.transaction(STATE_STORE, 'readonly').objectStore(STATE_STORE).get(STATE_KEY)
    )) as CachedState | undefined;

    // 2. Blobs + metadata, joined by id.
    const blobs = (await reqDone(
      db.transaction(BLOBS_STORE, 'readonly').objectStore(BLOBS_STORE).getAll()
    )) as CachedBlob[];
    const metas = (await reqDone(
      db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll()
    )) as CachedMeta[];

    const blobMap = new Map<string, CachedBlob>();
    for (const b of blobs) blobMap.set(b.id, b);
    const metaMap = new Map<string, CachedMeta>();
    for (const m of metas) metaMap.set(m.id, m);

    // Metadata whose audio is gone can never be restored (a failed or skipped
    // blob write). Saves no longer clear() the meta store, so prune it here to
    // keep it from growing without bound. This removes no audio. Housekeeping
    // only: if it fails, the restore goes on.
    const deadMeta = metas.filter((m) => !blobMap.has(m.id)).map((m) => m.id);
    let pruned = 0;
    if (deadMeta.length) {
      try {
        const tx = db.transaction(META_STORE, 'readwrite');
        for (const id of deadMeta) tx.objectStore(META_STORE).delete(id);
        await txDone(tx);
        pruned = deadMeta.length;
      } catch (err) {
        console.warn('[PlaylistCache] Metadata prune failed (non-fatal):', err);
      }
    }

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
    const songsOf = (ids: readonly string[]): Song[] =>
      ids.map(toSong).filter((s): s is Song => s !== null);

    const savedPlayOrder = state?.playlistOrder ?? [];
    // The library holds each track once, and every track of the play order.
    // Installs hit by the v14.4 library-shrink bug can carry a walk's repeated
    // entries in the saved library order; keep the first occurrence of each id.
    // (The PLAY order may legitimately repeat a track — walks do — so it is
    // left as saved.)
    const libraryOrder: string[] = [];
    const seenInLibrary = new Set<string>();
    for (const id of [...(state?.originalOrder ?? []), ...savedPlayOrder]) {
      if (seenInLibrary.has(id)) continue;
      seenInLibrary.add(id);
      libraryOrder.push(id);
    }
    const originalPlaylist = songsOf(libraryOrder);

    let playlist = songsOf(savedPlayOrder);
    let currentSongIndex = state
      ? Math.min(Math.max(state.currentSongIndex, -1), playlist.length - 1)
      : -1;
    // The saved play order can resolve to nothing (every track of a mix was
    // deleted). Show the library rather than restoring an empty app.
    if (playlist.length === 0 && originalPlaylist.length > 0) {
      playlist = originalPlaylist.slice();
      currentSongIndex = -1;
    }

    // Stored audio that neither saved list references: offered for recovery.
    const orphans = songsOf(blobs.map((b) => b.id).filter((id) => !seenInLibrary.has(id)));

    if (playlist.length === 0 && originalPlaylist.length === 0 && orphans.length === 0) return null;

    console.log(
      `[PlaylistCache] Restored ${originalPlaylist.length} library track(s), ${playlist.length} in the play order` +
        (state ? ` (saved ${new Date(state.savedAt).toLocaleTimeString()})` : ' (no saved state)') +
        (orphans.length ? `; ${orphans.length} stored track(s) not in the library` : '') +
        (pruned ? `; pruned ${pruned} metadata record(s) without audio` : '')
    );

    // A library stored before v14.5 never asked to be kept out of evictable
    // storage (that request follows a new import); ask now.
    requestPersistentStorageOnce();

    return {
      playlist,
      originalPlaylist,
      currentSongIndex,
      loShuWalkMode: state?.loShuWalkMode ?? null,
      selectedSolfeggio: state ? state.selectedSolfeggio : null,
      savedAt: state?.savedAt ?? 0,
      orphans,
    };
  } catch (err) {
    console.warn('[PlaylistCache] Restore failed (non-fatal):', err);
    return null;
  } finally {
    db?.close();
  }
}

// ----------------------------------------------------------------------------
// Clear
// ----------------------------------------------------------------------------

async function clearPlaylistCache(): Promise<void> {
  // Pending debounced saves still hold the lists from before the Clear; drop
  // them, and make any save already running write nothing.
  cancelPendingSaves();
  cacheEpoch++;
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const tx = db.transaction([BLOBS_STORE, META_STORE, STATE_STORE], 'readwrite');
    tx.objectStore(BLOBS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    tx.objectStore(STATE_STORE).clear();
    await txDone(tx);
    console.log('[PlaylistCache] Cache cleared');
  } catch (err) {
    console.warn('[PlaylistCache] Clear failed:', err);
  } finally {
    db?.close();
  }
}

// ----------------------------------------------------------------------------
// Storage capacity guard
// ----------------------------------------------------------------------------

/** Free space the browser will give this site, in MB. Infinity when the
 *  Storage API is unavailable, throws or reports no quota — a missing
 *  diagnostic must never block caching on a perfectly capable device. */
async function availableStorageMB(): Promise<number> {
  try {
    if (!navigator.storage?.estimate) return Infinity;
    const est = await navigator.storage.estimate();
    if (typeof est.quota !== 'number') return Infinity;
    return (est.quota - (est.usage || 0)) / (1024 * 1024);
  } catch {
    return Infinity;
  }
}

/** True if the device looks like it has at least `requiredMB` free. */
async function hasStorageCapacity(requiredMB: number = 100): Promise<boolean> {
  const availableMB = await availableStorageMB();
  if (availableMB < requiredMB) {
    console.warn(
      `[PlaylistCache] Low storage: ${availableMB.toFixed(0)} MB available, ` +
        `${requiredMB.toFixed(0)} MB recommended. Skipping cache.`
    );
    return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// Debounced savers — separate cadences for the two concerns
// ----------------------------------------------------------------------------

let blobTimer: ReturnType<typeof setTimeout> | null = null;
let metaTimer: ReturnType<typeof setTimeout> | null = null;

/** Drop any debounced save that has not fired yet ('meta': only the metadata
 *  and state save — a blob save only ever adds audio, so it can stand). */
function cancelPendingSaves(which: 'all' | 'meta' = 'all'): void {
  if (which === 'all' && blobTimer) {
    clearTimeout(blobTimer);
    blobTimer = null;
  }
  if (metaTimer) clearTimeout(metaTimer);
  metaTimer = null;
}

/** Resolve once every blob save already writing has finished. (One still
 *  waiting on its debounce timer is not included: cancel it and save the
 *  current lists directly instead.) */
async function waitForBlobSaves(): Promise<void> {
  await Promise.all(Array.from(runningBlobSaves));
}

/** Persist new blobs. Driven by id-set changes (import/delete), which are
 *  rare, so a short debounce just coalesces the paired playlist/originalPlaylist
 *  updates of a single import. */
function saveBlobsNow(
  playlist: Song[],
  originalPlaylist: Song[],
  delayMs: number = 300
): void {
  if (blobTimer) clearTimeout(blobTimer);
  const epoch = cacheEpoch;
  // The capacity check lives in saveBlobs, sized from the new files.
  blobTimer = setTimeout(() => {
    blobTimer = null;
    saveBlobs(playlist, originalPlaylist, epoch);
  }, delayMs);
}

/** Persist metadata + session state. Driven by playlist/state changes; the App
 *  suppresses this during an active deep scan and lets it fire once on settle.
 *  No free-space precheck: a flat 100 MB gate used to skip this save silently
 *  on a nearly full phone, state record included, while it would still have
 *  fit. The save now runs; the small state record goes first, and a write that
 *  doesn't fit fails and is reported. */
function debouncedSaveMeta(
  playlist: Song[],
  originalPlaylist: Song[],
  currentSongIndex: number,
  loShuWalkMode: LoShuWalkMode | null,
  selectedSolfeggio: number,
  delayMs: number = 2000
): void {
  if (metaTimer) clearTimeout(metaTimer);
  const epoch = cacheEpoch;
  metaTimer = setTimeout(() => {
    metaTimer = null;
    saveMetaAndState(
      playlist,
      originalPlaylist,
      currentSongIndex,
      loShuWalkMode,
      selectedSolfeggio,
      epoch
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
  deleteTracksFromCache,
  storedTrackIds,
  cacheGeneration,
  cancelPendingSaves,
  waitForBlobSaves,
  hasStorageCapacity,
  saveBlobsNow,
  debouncedSaveMeta,
  __setCacheDbNameForTests,
};
