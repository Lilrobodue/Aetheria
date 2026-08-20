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
  selectedSolfeggio: number;
  savedAt: number;
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

// ----------------------------------------------------------------------------
// Save — blobs (incremental, id-set diff). The ONLY path that writes audio.
// ----------------------------------------------------------------------------

/** Sync the `blobs` store to the current id set: write blobs for newly added
 *  tracks, delete blobs for removed tracks, and — crucially — leave existing
 *  blobs untouched. A metadata-only change produces ZERO blob writes. */
async function saveBlobs(playlist: Song[], originalPlaylist: Song[]): Promise<void> {
  try {
    const db = await openDB();
    const wanted = uniqueSongs(playlist, originalPlaylist);

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
      return; // nothing changed — no audio rewritten
    }

    const tx = db.transaction(BLOBS_STORE, 'readwrite');
    const store = tx.objectStore(BLOBS_STORE);
    for (const song of toAdd) store.put(toBlob(song));
    for (const id of toDelete) store.delete(id);
    await txDone(tx);

    db.close();
    console.log(
      `[PlaylistCache] Blobs synced: +${toAdd.length} -${toDelete.length} (kept ${wanted.size - toAdd.length})`
    );
  } catch (err) {
    console.warn('[PlaylistCache] Blob save failed (non-fatal):', err);
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

    // Metadata: clear + rewrite. No audio here, so this is cheap regardless of
    // how often it runs during a scan.
    const metaTx = db.transaction(META_STORE, 'readwrite');
    const metaStore = metaTx.objectStore(META_STORE);
    metaStore.clear();
    for (const song of wanted.values()) metaStore.put(toMeta(song));
    await txDone(metaTx);

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
      `[PlaylistCache] Meta+state saved: ${wanted.size} tracks, order ${playlist.length}`
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

async function restorePlaylist(): Promise<RestoredPlaylist | null> {
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

    // 2. Blobs + metadata, joined by id.
    const blobs = (await reqDone(
      db.transaction(BLOBS_STORE, 'readonly').objectStore(BLOBS_STORE).getAll()
    )) as CachedBlob[];
    const metas = (await reqDone(
      db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll()
    )) as CachedMeta[];
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
 *  diagnostic to block caching on a perfectly capable device. */
async function hasStorageCapacity(requiredMB: number = 100): Promise<boolean> {
  try {
    if (!navigator.storage?.estimate) return true;
    const est = await navigator.storage.estimate();
    const availableMB = ((est.quota || 0) - (est.usage || 0)) / (1024 * 1024);
    if (availableMB < requiredMB) {
      console.warn(
        `[PlaylistCache] Low storage: ${availableMB.toFixed(0)} MB available, ` +
          `${requiredMB} MB recommended. Skipping cache.`
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
 *  updates of a single import. */
function saveBlobsNow(
  playlist: Song[],
  originalPlaylist: Song[],
  delayMs: number = 300
): void {
  if (blobTimer) clearTimeout(blobTimer);
  blobTimer = setTimeout(async () => {
    if (await hasStorageCapacity()) {
      await saveBlobs(playlist, originalPlaylist);
    }
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
    if (await hasStorageCapacity()) {
      await saveMetaAndState(
        playlist,
        originalPlaylist,
        currentSongIndex,
        loShuWalkMode,
        selectedSolfeggio
      );
    }
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
  saveBlobsNow,
  debouncedSaveMeta,
};
