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
//
// SAVED PLAYLISTS (v16.1) live beside the 'current' record in the playlist-state store, one record per playlist under
// the key 'pl:<id>' (DB_VERSION stays 2). Their writer (writePlaylistRecords) writes ONLY those keys: never 'current',
// never blobs or meta. Clear keeps them unless asked (clearPlaylistCache({ playlists: true })).

import type { Song } from '../types';
import type { LoShuWalkMode } from '../constants';
// v15.9: walks survive a reload (the walk is stored with the play order it belongs to, and validated on restore).
import { restoredWalk } from './library/walkRecord';
import type { SavedWalk } from './library/walkRecord';
export type { SavedWalk } from './library/walkRecord';
// v16.0: the queue survives a reload (the waiting and played entries' indices into the play order, on the same record).
import { restoredQueue } from './queue/queueModel';
import type { Mark, SavedQueue } from './queue/queueModel';
export type { SavedQueue } from './queue/queueModel';

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
  // Analyse tracks (v15.1): the visual envelope and the key-analysis fields.
  visualEnvelope?: Song['visualEnvelope'];
  chroma?: Song['chroma'];
  chromaA4Hz?: Song['chromaA4Hz'];
  musicKey?: Song['musicKey'];
  keyConfidence?: Song['keyConfidence'];
  chromaVersion?: Song['chromaVersion'];
  analysisFailedV?: Song['analysisFailedV'];
  crystalSource?: Song['crystalSource'];
}

interface CachedState {
  key: string;
  playlistOrder: string[];
  originalOrder: string[];
  currentSongIndex: number;
  /** Kept for older releases reading a newer record (they end the walk at once, as before v15.9). */
  loShuWalkMode: LoShuWalkMode | null;
  /** v15.9: the walk that built playlistOrder (optional: older records have none). */
  walk?: SavedWalk | null;
  /** v16.0: the queued entries of playlistOrder, as indices (optional: older records have none; older releases ignore
   *  it, and theirs drop a walk holding a queued entry, keeping the order). */
  queue?: SavedQueue | null;
  selectedSolfeggio: number;
  savedAt: number;
}

export interface RestoredPlaylist {
  playlist: Song[];
  originalPlaylist: Song[];
  currentSongIndex: number;
  loShuWalkMode: LoShuWalkMode | null;
  /** v15.9: the stored walk, only when it matches the restored play order exactly (restoredWalk); else null. */
  walk: SavedWalk | null;
  /** v16.0: the queue's marks, only when the stored queue matches the restored play order exactly (restoredQueue). */
  queue: Mark[] | null;
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
  // v16.0.1: the flush connection belongs to the previous database.
  if (flushDb) { flushDb.close(); flushDb = null; }
  // v16.1: so do the playlists' load gate and their pending writes.
  playlistsReadable = false;
  pendingPl.clear();
  plKnown.clear();
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
    visualEnvelope: song.visualEnvelope,
    chroma: song.chroma,
    chromaA4Hz: song.chromaA4Hz,
    musicKey: song.musicKey,
    keyConfidence: song.keyConfidence,
    chromaVersion: song.chromaVersion,
    analysisFailedV: song.analysisFailedV,
    crystalSource: song.crystalSource,
  };
}

/** The key-analysis fields of a stored record, or none if they don't hold together (a record from a broken
 *  or future version): the track is then simply analysed again. chroma must stay a plain Array of 12. */
function keyFieldsOf(meta: CachedMeta | undefined): Pick<Song, 'chroma' | 'chromaA4Hz' | 'musicKey' | 'keyConfidence' | 'chromaVersion'> {
  if (!meta || typeof meta.chromaVersion !== 'number') return {};
  if (meta.chroma === undefined) return { chromaVersion: meta.chromaVersion };   // analysed, no pitch found
  const c = meta.chroma;
  const ok = Array.isArray(c) && c.length === 12 && c.every((v) => Number.isFinite(v)) &&
    Number.isFinite(meta.chromaA4Hz) && typeof meta.musicKey === 'string' && Number.isFinite(meta.keyConfidence);
  return ok
    ? { chroma: c, chromaA4Hz: meta.chromaA4Hz, musicKey: meta.musicKey, keyConfidence: meta.keyConfidence, chromaVersion: meta.chromaVersion }
    : {};
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

/** What one metadata + state save writes (the lists as they were when it was scheduled). */
interface MetaSave {
  playlist: Song[];
  originalPlaylist: Song[];
  currentSongIndex: number;
  walk: SavedWalk | null;
  selectedSolfeggio: number;
  epoch: number;
  queue: SavedQueue | null;
}

// v16.0.1: every metadata + state save takes a version as it starts, and per store it creates its transaction only if
// no newer save has created one already. The hide flush writes its state record at once, through a connection that is
// already open, so an older save still waiting for its own connection could otherwise land after it and put an older
// play state back. (Transactions on one store commit in the order they were created.)
let saveVersion = 0;
const lastIssued = { state: 0, meta: 0 };

function stateRecord(p: MetaSave): CachedState {
  return {
    key: STATE_KEY,
    playlistOrder: p.playlist.map((s) => s.id),
    originalOrder: p.originalPlaylist.map((s) => s.id),
    currentSongIndex: p.currentSongIndex,
    loShuWalkMode: p.walk ? p.walk.mode : null,
    walk: p.walk ?? null,
    queue: p.queue ?? null,
    selectedSolfeggio: p.selectedSolfeggio,
    savedAt: Date.now(),
  };
}

async function saveMetaAndState(
  playlist: Song[],
  originalPlaylist: Song[],
  currentSongIndex: number,
  walk: SavedWalk | null,
  selectedSolfeggio: number,
  epoch: number = cacheEpoch,
  queue: SavedQueue | null = null
): Promise<void> {
  return runMetaSave({ playlist, originalPlaylist, currentSongIndex, walk, selectedSolfeggio, epoch, queue }, ++saveVersion, ++saveSeq, null);
}

/** The save itself. `stateWritten`: the hide flush already put the state record (this waits for it, then writes the
 *  metadata); null: this writes the state record first, as before. */
async function runMetaSave(p: MetaSave, version: number, seq: number, stateWritten: Promise<void> | null): Promise<void> {
  const { playlist, originalPlaylist, epoch } = p;
  let db: IDBDatabase | null = null;
  try {
    // The flush's own state write can still fail after it was issued: its transaction aborts when the browser
    // force-closes the kept connection, or on a disk error. Nothing else would write that record (the flush took the
    // pending save and cancelled its timer), so it is written again below, through this save's own connection.
    let flushFailed = false;
    if (stateWritten) {
      try {
        await stateWritten;
      } catch (err) {
        flushFailed = true;
        console.warn('[PlaylistCache] The flush could not write the play state; writing it again:', err);
      }
    }
    db = await openDB();

    // A Clear happened since this save was scheduled: write nothing.
    if (epoch !== cacheEpoch) return;

    // Ordering / session state FIRST, in its own small transaction: with the
    // audio it is all a restore needs (metadata is optional), and a nearly
    // full device can still fit it when the metadata below doesn't — so an
    // import is not left out of the library just because analysis didn't fit.
    // Only while no newer save has issued one (the version guard). After a failed flush, only if nothing was issued
    // since the flush's own.
    const stateDue = stateWritten
      ? flushFailed && lastIssued.state === version
      : lastIssued.state < version;
    if (stateDue) {
      const stateTx = db.transaction(STATE_STORE, 'readwrite');
      stateTx.objectStore(STATE_STORE).put(stateRecord(p));
      lastIssued.state = version; // issued: set only once the transaction exists (db.transaction can throw)
      await txDone(stateTx);
    }

    // Metadata: put every track's record. No clear() first — a track missing
    // from the lists keeps its stored analysis until it is explicitly deleted
    // (deleteTracksFromCache), so a list bug can't wipe hours of Deep Scan
    // results. Not small: it rewrites every track's record (band envelopes
    // and analyses — tens of MB for a large scanned library, all charged
    // against the quota), so on a nearly full device it can fail; that is
    // reported. Listed after the await so a Clear or a delete that landed
    // during the state write is respected.
    if (epoch !== cacheEpoch) return;
    if (lastIssued.meta > version) return; // a newer save is writing newer metadata
    const wanted = uniqueSongs(playlist, originalPlaylist);
    const metaTx = db.transaction(META_STORE, 'readwrite');
    const metaStore = metaTx.objectStore(META_STORE);
    for (const song of wanted.values()) metaStore.put(toMeta(song));
    lastIssued.meta = version;
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
  walk: SavedWalk | null,
  selectedSolfeggio: number
): Promise<void> {
  await saveBlobs(playlist, originalPlaylist);
  await saveMetaAndState(
    playlist,
    originalPlaylist,
    currentSongIndex,
    walk,
    selectedSolfeggio
  );
}

// ----------------------------------------------------------------------------
// Restore
// ----------------------------------------------------------------------------

// v16.0.1, the load gate: nothing is saved before the saved library has been read back. Open once a restore has
// settled and none is running (StrictMode runs the App's restore twice in development). The App's own continuation of
// a restore (it drops a save scheduled before the restore landed: cancelPendingSaves('meta')) runs in the microtasks
// right after, so no hide event (a task) can fall between the two.
let restoresRunning = 0;
let restoreSettled = false;
const loadGateOpen = (): boolean => restoreSettled && restoresRunning === 0;

async function restorePlaylist(): Promise<RestoredPlaylist | null> {
  restoresRunning++;
  try {
    return await readSavedPlaylist();
  } finally {
    restoresRunning--;
    restoreSettled = true;
  }
}

async function readSavedPlaylist(): Promise<RestoredPlaylist | null> {
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
        visualEnvelope: meta?.visualEnvelope,
        ...keyFieldsOf(meta),
        analysisFailedV: typeof meta?.analysisFailedV === 'number' ? meta.analysisFailedV : undefined,
        crystalSource: meta?.crystalSource === 'scan' || meta?.crystalSource === 'assigned' ? meta.crystalSource : undefined,
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
    // v15.9: the walk, only if every one of its tracks came back in its saved order.
    const walk = restoredWalk(state?.walk, savedPlayOrder, playlist.map((s) => s.id));
    let currentSongIndex = state
      ? Math.min(Math.max(state.currentSongIndex, -1), playlist.length - 1)
      : -1;
    // v16.0: the queue, only if every track of the play order came back in its saved order (as the walk).
    let queue = restoredQueue(state?.queue, savedPlayOrder, playlist.map((s) => s.id), currentSongIndex);
    // The saved play order can resolve to nothing (every track of a mix was
    // deleted). Show the library rather than restoring an empty app.
    if (playlist.length === 0 && originalPlaylist.length > 0) {
      playlist = originalPlaylist.slice();
      currentSongIndex = -1;
      queue = null;
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
      walk,
      queue,
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

/** Clear: every track's audio and metadata, and the play state. v16.1: the saved playlists ('pl:' records) stay unless
 *  `playlists` is true (Clear's "Also delete my playlists" box); kept, their entries show as missing until the files are
 *  imported again (fingerprints). One transaction either way. With the box ticked it deletes exactly the playlists App
 *  has read back and those written since, deleted ones included (plKnown, as at the tap): a record App couldn't read,
 *  which it counts as "left as it was", stays. */
async function clearPlaylistCache(opts: { playlists?: boolean } = {}): Promise<void> {
  // Pending debounced saves still hold the lists from before the Clear; drop
  // them, and make any save already running write nothing.
  cancelPendingSaves();
  cacheEpoch++;
  const alsoPlaylists = opts.playlists === true;
  // v16.1: deleting the playlists too: what is waiting to be written goes, and what is written meanwhile waits until
  // the Clear has committed (then it lands after it: a playlist made after the tap survives).
  let cleared: () => void = () => {};
  const deleting = alsoPlaylists ? [...plKnown] : [];
  if (alsoPlaylists) {
    pendingPl.clear();
    plKnown.clear();
    plClearing = new Promise<void>((resolve) => { cleared = resolve; });
  }
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const tx = db.transaction([BLOBS_STORE, META_STORE, STATE_STORE], 'readwrite');
    tx.objectStore(BLOBS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    const state = tx.objectStore(STATE_STORE);
    // Every key but the playlists': below 'pl:' ('current'), and from 'pl;' up.
    state.delete(IDBKeyRange.upperBound(PL_PREFIX, true));
    state.delete(IDBKeyRange.lowerBound(PL_END));
    // With the box ticked, the playlists App knows, one by one (never the whole 'pl:' range).
    for (const key of deleting) state.delete(key);
    await txDone(tx);
    console.log(`[PlaylistCache] Cache cleared${alsoPlaylists ? `, the saved playlists too (${deleting.length} known, deleted ones included)` : '; saved playlists kept'}`);
  } catch (err) {
    console.warn('[PlaylistCache] Clear failed:', err);
    // Nothing was deleted: App still has those records (a later Clear with the box ticked deletes them).
    for (const key of deleting) plKnown.add(key);
  } finally {
    db?.close();
    if (alsoPlaylists) {
      plClearing = null;
      cleared();
      drainPlaylists();
    }
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
  pendingMeta = null;
}

// ----------------------------------------------------------------------------
// v16.0.1: the hide flush. A change is saved 2 s after it settles (debouncedSaveMeta); a page reloaded, closed,
// navigated away from or killed in the background within those 2 s lost it. When the page is hidden or goes away,
// the save that is waiting runs now: the same save with the same lists, so it writes nothing the debounce would not
// have written 2 s later. Its small state record goes first and at once, through a connection opened while the save
// waited, and is committed explicitly: a page that is going away runs no further task, so a write that first waits
// for an open never starts, and one left to auto-commit is aborted with the page. The metadata follows as before.
// Never the audio.
// ----------------------------------------------------------------------------

let pendingMeta: MetaSave | null = null;
let flushDb: IDBDatabase | null = null;
let flushDbOpening: Promise<IDBDatabase | null> | null = null;
let hideFlushInstalled = false;

/** The connection the flush writes through: opened when a save is first scheduled, kept for the page's life. It
 *  closes for a version change or a delete from anywhere, so it never blocks one. */
function openFlushConnection(): Promise<IDBDatabase | null> {
  if (flushDb) return Promise.resolve(flushDb);
  if (flushDbOpening) return flushDbOpening;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  const name = dbName;
  flushDbOpening = openDB().then(
    (db) => {
      flushDbOpening = null;
      if (name !== dbName) { db.close(); return null; }
      db.onversionchange = () => { db.close(); if (flushDb === db) flushDb = null; };
      db.onclose = () => { if (flushDb === db) flushDb = null; };
      flushDb = db;
      drainPlaylists(true); // v16.1: playlist writes that waited for a connection go now (on this one connection)
      return db;
    },
    () => { flushDbOpening = null; return null; }
  );
  return flushDbOpening;
}

/** Run the waiting metadata + state save now. Returns whether it ran: nothing waiting, or the saved library not read
 *  back yet (the load gate: the save keeps waiting), or a Clear since it was scheduled: nothing is written. */
function flushPendingSave(): boolean {
  const p = pendingMeta;
  if (!p || !loadGateOpen()) return false;
  if (metaTimer) clearTimeout(metaTimer);
  metaTimer = null;
  pendingMeta = null;
  if (p.epoch !== cacheEpoch) return false;
  const version = ++saveVersion;
  const seq = ++saveSeq;
  let stateWritten: Promise<void> | null = null;
  const db = flushDb;
  if (db) {
    try {
      const tx = db.transaction(STATE_STORE, 'readwrite');
      tx.objectStore(STATE_STORE).put(stateRecord(p));
      if (typeof tx.commit === 'function') tx.commit();
      lastIssued.state = version; // issued: set only once nothing above has thrown
      stateWritten = txDone(tx);
    } catch (err) {
      // A connection that is closing: save the usual way (it completes on a hide, not on an unload). If the write
      // fails later instead (its transaction aborts), runMetaSave writes it again the same way.
      console.warn('[PlaylistCache] The flush connection is gone; saving the usual way:', err);
    }
  }
  void runMetaSave(p, version, seq, stateWritten);
  return true;
}

/** Once per page, when the first save is scheduled: a hide (a lock, an app or tab switch: the page lives on and the
 *  whole save completes), pagehide (a reload, a close, a navigation, the back/forward cache) and freeze. */
function installHideFlush(): void {
  if (hideFlushInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  hideFlushInstalled = true;
  // v16.1: and the playlists' writes waiting for a connection (normally none: they go in the tap's own task).
  const flushAll = () => { flushPendingSave(); drainPlaylists(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('freeze', flushAll);
}

// ----------------------------------------------------------------------------
// v16.1: saved playlists. One record per playlist, 'pl:<id>', in the playlist-state store beside 'current'
// (DB_VERSION stays 2; App validates every record before it reaches state: utils/playlists/model.ts parseAll).
// Their own writer, writePlaylistRecords: it puts or deletes ONLY 'pl:<id>' keys of that one store (never 'current',
// never blobs or meta), at once, in the caller's own task (a tap), through the connection the hide flush keeps open,
// committed explicitly; nothing holds it back (not a Deep Scan, not the library's debounce). The load gate: nothing is
// written before the stored playlists have been read back, and a read that failed keeps it shut (never write over what
// couldn't be read). There is no "save all": every write names its records, so an empty list in memory can never write
// over stored ones. A write that finds no open connection waits in pendingPl (per key, the latest wins), and goes when
// the connection opens or the page is hidden or goes away (the v16.0.1 listeners).
// ----------------------------------------------------------------------------

const PL_PREFIX = 'pl:';
const PL_END = 'pl;'; // ';' follows ':', so every key that starts 'pl:' sorts in [PL_PREFIX, PL_END)
const PL_KEY_RE = /^pl:p[a-z0-9]{6,30}$/;
const isPlaylistKey = (key: unknown): key is string => typeof key === 'string' && PL_KEY_RE.test(key);

let playlistsReadable = false;
const pendingPl = new Map<string, { key: string } | null>(); // key: the record to put, or null to delete
let plClearing: Promise<void> | null = null;
let plDrain: Promise<boolean> = Promise.resolve(true);
// Why the latest playlist write failed, for App's words ('storage-full': a QuotaExceededError), or null once one lands.
let plFailure: 'storage-full' | 'failed' | null = null;
// The 'pl:' keys of the playlists App has had (the ones it read back and could read: notePlaylistsRead; and every one
// written since, the deleted ones too: their delete may have failed or still be waiting). A Clear with "Also delete my
// playlists" ticked deletes exactly these, so a record App couldn't read stays on disk, as App says it does.
const plKnown = new Set<string>();

/** Why the latest playlist write failed ('storage-full': this device's storage is full), or null after one landed. */
function playlistWriteFailure(): 'storage-full' | 'failed' | null {
  return plFailure;
}

/** The stored playlists, raw, for App to validate (null: the read failed, and the gate stays shut). It opens the hide
 *  flush's kept connection and reads through it, so every playlist write after this goes out at once. */
async function readSavedPlaylists(): Promise<unknown[] | null> {
  installHideFlush();
  let own: IDBDatabase | null = null;
  try {
    const db = (await openFlushConnection()) ?? (own = await openDB());
    const all = await reqDone(db.transaction(STATE_STORE, 'readonly').objectStore(STATE_STORE).getAll(IDBKeyRange.bound(PL_PREFIX, PL_END, false, true)));
    playlistsReadable = true;
    drainPlaylists();
    return all as unknown[];
  } catch (err) {
    console.warn('[PlaylistCache] Could not read the saved playlists (nothing will be written to them):', err);
    return null;
  } finally {
    own?.close();
  }
}

/** App's read, validated: the keys of the stored playlists it could read (and shows). Only these, and the ones written
 *  since, are deleted by a Clear with the playlists box ticked; a record it couldn't read is left as it was. */
function notePlaylistsRead(keys: readonly string[]): void {
  for (const k of keys) if (isPlaylistKey(k)) plKnown.add(k);
}

/** Put (records) and delete (keys) saved playlists. Refused (false, nothing written) before readSavedPlaylists has
 *  read them, or for any key that is not 'pl:<id>'. Resolves true once written, false if the write failed (App says so
 *  and offers Retry). */
function writePlaylistRecords(puts: readonly { key: string }[], deletes: readonly string[] = []): Promise<boolean> {
  if (!playlistsReadable) return Promise.resolve(false);
  if (!puts.every((r) => !!r && isPlaylistKey(r.key)) || !deletes.every(isPlaylistKey)) return Promise.resolve(false);
  for (const r of puts) plKnown.add(r.key);
  // v16.1 re-review: a delete leaves its key known. The delete may still fail (App keeps the playlist hidden, with
  // Retry) or still be waiting when a Clear drops the pending writes; a ticked Clear then deletes it anyway. Deleting
  // a key that is already gone does nothing, and ids are random, so nothing else can be deleted by it.
  for (const r of puts) pendingPl.set(r.key, r);
  for (const k of deletes) pendingPl.set(k, null);
  return drainPlaylists();
}

/** Write every pending playlist record now, in one transaction on the playlist-state store through the kept
 *  connection, committed explicitly. Without a connection (not opened yet, or closed by another tab's version change)
 *  it opens one and they go then; during a Clear that deletes playlists, they go after it. */
function drainPlaylists(reopened = false): Promise<boolean> {
  if (!pendingPl.size || !playlistsReadable) return plDrain;
  if (plClearing) return plClearing.then(() => drainPlaylists());
  const db = flushDb;
  if (!db) return openFlushConnection().then((d) => (d ? drainPlaylists(true) : false));
  const batch = new Map(pendingPl);
  pendingPl.clear();
  let tx: IDBTransaction;
  try {
    tx = db.transaction(STATE_STORE, 'readwrite');
  } catch (err) {
    // A connection that is closing (InvalidStateError from transaction()): the batch waits again (anything newer for a
    // key wins) for ONE new connection. Anything else drops the batch: false, App says so.
    if ((err as DOMException)?.name !== 'InvalidStateError' || reopened) {
      console.warn('[PlaylistCache] Saving a playlist failed:', err);
      plFailure = isQuotaError(err) ? 'storage-full' : 'failed';
      plDrain = Promise.resolve(false);
      return plDrain;
    }
    for (const [k, r] of batch) if (!pendingPl.has(k)) pendingPl.set(k, r);
    if (flushDb === db) flushDb = null;
    return openFlushConnection().then((d) => (d ? drainPlaylists(true) : false));
  }
  try {
    const store = tx.objectStore(STATE_STORE);
    for (const [key, rec] of batch) {
      if (rec === null) store.delete(key);
      else store.put(rec);
    }
    if (typeof tx.commit === 'function') tx.commit();
  } catch (err) {
    // A record that can't be stored (DataCloneError at put), or a transaction aborted under it (commit then throws
    // InvalidStateError): the batch is dropped, never retried in a loop: false, App says so (Retry writes it again).
    console.warn('[PlaylistCache] Saving a playlist failed:', err);
    plFailure = isQuotaError(err) ? 'storage-full' : 'failed';
    try { tx.abort(); } catch { /* already aborted */ }
    plDrain = Promise.resolve(false);
    return plDrain;
  }
  plDrain = txDone(tx).then(
    () => { plFailure = null; requestPersistentStorageOnce(); return true; },
    (err) => { console.warn('[PlaylistCache] Saving a playlist failed:', err); plFailure = isQuotaError(err) ? 'storage-full' : 'failed'; return false; }
  );
  return plDrain;
}

/** Whether this site's storage is persistent (navigator.storage.persisted), or null when the browser can't say. */
async function storagePersisted(): Promise<boolean | null> {
  try {
    return typeof navigator !== 'undefined' && navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
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
  walk: SavedWalk | null,
  selectedSolfeggio: number,
  delayMs: number = 2000,
  queue: SavedQueue | null = null
): void {
  if (metaTimer) clearTimeout(metaTimer);
  const epoch = cacheEpoch;
  const p: MetaSave = { playlist, originalPlaylist, currentSongIndex, walk, selectedSolfeggio, epoch, queue };
  pendingMeta = p;
  installHideFlush();
  openFlushConnection();
  const fire = () => {
    metaTimer = null;
    // The load gate holds the timer too: a save scheduled before the saved library has been read back (an import while
    // a large library restores) waits, and the restore's continuation drops it; when the restore found nothing, it runs.
    if (!loadGateOpen()) { metaTimer = setTimeout(fire, Math.max(delayMs, 250)); return; }
    if (pendingMeta === p) pendingMeta = null;
    saveMetaAndState(
      playlist,
      originalPlaylist,
      currentSongIndex,
      walk,
      selectedSolfeggio,
      epoch,
      queue
    );
  };
  metaTimer = setTimeout(fire, delayMs);
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
  flushPendingSave,
  // v16.0.1: read-only. False until the saved library has been read back (flushAndReload must not save over it).
  loadGateOpen as isLoadGateOpen,
  // v16.1: saved playlists.
  readSavedPlaylists,
  notePlaylistsRead,
  writePlaylistRecords,
  drainPlaylists,
  playlistWriteFailure,
  storagePersisted,
  requestPersistentStorageOnce,
  __setCacheDbNameForTests,
};
