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
// Design notes:
//  - Two object stores keep concerns separate: `songs` holds the heavy per-track
//    data (audio blob + metadata, keyed by song id) and `playlist-state` holds
//    the lightweight ordering/session state (one entry, key "current").
//  - Caching is a CONVENIENCE, never critical. Every operation fails silently
//    (console.warn) so a storage error can never crash playback or import.
//  - The cached shape mirrors the FULL Song interface in types.ts — including
//    harmonicFreq, harmonicDeviation, intervalAnalysis, isAetheriaCandidate and
//    bandEnvelope — so a restored track keeps its analysis and its pre-scanned
//    visualizer envelope. Caching only a subset would silently degrade restored
//    tracks (flat visualizer, missing harmonic data, redundant re-analysis).

import type { Song } from '../types';
import type { LoShuWalkMode } from '../constants';

const DB_NAME = 'aetheria-db';
const DB_VERSION = 1;
const SONGS_STORE = 'songs';
const STATE_STORE = 'playlist-state';
const STATE_KEY = 'current';

// ----------------------------------------------------------------------------
// Cached shapes
// ----------------------------------------------------------------------------

/** A Song serialized for IndexedDB. The File is split into a Blob + name + type
 *  so we can reconstruct a fresh File on restore. Every other Song field is
 *  preserved verbatim (Uint8Arrays in bandEnvelope survive structured clone). */
interface CachedSong {
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
  // Audio data on disk:
  fileBlob: Blob;
  fileName: string;
  fileType: string;
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

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SONGS_STORE)) {
        db.createObjectStore(SONGS_STORE, { keyPath: 'id' });
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

// ----------------------------------------------------------------------------
// Save
// ----------------------------------------------------------------------------

/** Serialize a Song for storage. The File is itself a Blob, so it can be stored
 *  directly; we keep name/type alongside to rebuild a real File on restore. */
function toCached(song: Song): CachedSong {
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
    fileBlob: song.file,
    fileName: song.file.name,
    fileType: song.file.type,
  };
}

async function savePlaylist(
  playlist: Song[],
  originalPlaylist: Song[],
  currentSongIndex: number,
  loShuWalkMode: LoShuWalkMode | null,
  selectedSolfeggio: number
): Promise<void> {
  try {
    const db = await openDB();

    // 1. Write every unique song (blob + metadata) in one transaction.
    //    Clear first so tracks deleted since the last save don't linger as
    //    orphans. A song can appear in both playlist and originalPlaylist
    //    (pre-shuffle order), so dedupe by id.
    const songTx = db.transaction(SONGS_STORE, 'readwrite');
    const songStore = songTx.objectStore(SONGS_STORE);
    songStore.clear();

    const seen = new Set<string>();
    for (const song of [...playlist, ...originalPlaylist]) {
      if (!song.file || seen.has(song.id)) continue;
      seen.add(song.id);
      songStore.put(toCached(song));
    }
    await txDone(songTx);

    // 2. Write the lightweight ordering / session state.
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
      `[PlaylistCache] Saved ${seen.size} songs, playlist order: ${playlist.length} tracks`
    );
  } catch (err) {
    console.warn('[PlaylistCache] Save failed (non-fatal):', err);
    // Caching is a convenience, not critical. Fail silently.
  }
}

// ----------------------------------------------------------------------------
// Restore
// ----------------------------------------------------------------------------

async function restorePlaylist(): Promise<RestoredPlaylist | null> {
  try {
    const db = await openDB();

    // 1. Load playlist state.
    const stateTx = db.transaction(STATE_STORE, 'readonly');
    const stateReq = stateTx.objectStore(STATE_STORE).get(STATE_KEY);
    const state: CachedState | undefined = await new Promise((resolve, reject) => {
      stateReq.onsuccess = () => resolve(stateReq.result);
      stateReq.onerror = () => reject(stateReq.error);
    });

    if (!state || !state.playlistOrder?.length) {
      db.close();
      return null;
    }

    // 2. Load all cached songs.
    const songTx = db.transaction(SONGS_STORE, 'readonly');
    const allReq = songTx.objectStore(SONGS_STORE).getAll();
    const cachedSongs: CachedSong[] = await new Promise((resolve, reject) => {
      allReq.onsuccess = () => resolve(allReq.result || []);
      allReq.onerror = () => reject(allReq.error);
    });
    db.close();

    const songMap = new Map<string, CachedSong>();
    for (const cs of cachedSongs) songMap.set(cs.id, cs);

    // 3. Rebuild Song objects from cached data, skipping any missing ids.
    const toSong = (id: string): Song | null => {
      const cached = songMap.get(id);
      if (!cached) return null;
      const file = new File([cached.fileBlob], cached.fileName, {
        type: cached.fileType,
      });
      return {
        file,
        id: cached.id,
        name: cached.name,
        duration: cached.duration,
        harmonicFreq: cached.harmonicFreq,
        closestSolfeggio: cached.closestSolfeggio,
        harmonicDeviation: cached.harmonicDeviation,
        fractalAnalysis: cached.fractalAnalysis,
        intervalAnalysis: cached.intervalAnalysis,
        isAetheriaCandidate: cached.isAetheriaCandidate,
        bandEnvelope: cached.bandEnvelope,
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
      // Fall back to the playlist order if the pre-shuffle order didn't survive.
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

    const songTx = db.transaction(SONGS_STORE, 'readwrite');
    songTx.objectStore(SONGS_STORE).clear();
    await txDone(songTx);

    const stateTx = db.transaction(STATE_STORE, 'readwrite');
    stateTx.objectStore(STATE_STORE).clear();
    await txDone(stateTx);

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
// Debounced auto-save
// ----------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounce savePlaylist so rapid mutations (batch import of dozens of files,
 *  streaming analysis updates) don't thrash IndexedDB. The capacity check runs
 *  at fire time, not schedule time, so the most up-to-date estimate is used. */
function debouncedSave(
  playlist: Song[],
  originalPlaylist: Song[],
  currentSongIndex: number,
  loShuWalkMode: LoShuWalkMode | null,
  selectedSolfeggio: number,
  delayMs: number = 2000
): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ok = await hasStorageCapacity();
    if (ok) {
      await savePlaylist(
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
  restorePlaylist,
  clearPlaylistCache,
  hasStorageCapacity,
  debouncedSave,
};
