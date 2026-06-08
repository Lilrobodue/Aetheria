# CLAUDE.md — CABI Playlist Persistence & Cache Management

## Context

The Aetheria 432Hz Player stores uploaded songs in browser memory only. A page
reload — whether intentional, accidental, or caused by watchdog recovery — clears
the entire playlist. Users must re-import and re-analyze all tracks from scratch.
This is the most common friction point reported in everyday use.

Currently, the only way to clear the playlist is to reload the page or delete
tracks one at a time via the existing `deleteSong(songId)` function. Once
caching is introduced, reload no longer clears the playlist, so a dedicated
**Clear Playlist** button is required.

## Goal

1. **Persist the playlist** (audio files + metadata) across page reloads using
   IndexedDB for audio blobs and metadata together in one store.
2. **Restore automatically or on user action** when the app loads and finds
   cached data.
3. **Provide a Clear Playlist button** that wipes both the in-memory playlist
   and the IndexedDB cache in one deliberate action.
4. **Respect device constraints** — check available storage before caching;
   degrade gracefully on older/low-storage devices.

## How IndexedDB Works (for context)

IndexedDB stores data on the device's **disk**, not in RAM. A cached playlist
of 30 WAV files (even several GB) does not increase the app's runtime memory
footprint. The browser reads files from disk on demand for playback, streaming
a small buffer (1–5 MB) into RAM at a time. This is safe for 6 GB RAM phones
and older devices — the constraint is disk space, not memory.

## Song Object Shape (current)

From `handleFileUpload` and the analysis pipeline, a fully-processed Song has:

```typescript
interface Song {
  file: File;                        // the audio File blob (from upload)
  id: string;                        // unique ID, e.g. "1718234567890-abc123def"
  name: string;                      // display name (cleaned filename)
  duration: number;                  // seconds (0 until background analysis completes)
  closestSolfeggio?: number;         // assigned frequency (e.g. 528)
  fractalAnalysis?: FractalAnalysisResult;  // deep analysis data
  detectedFrequency?: number;        // raw detected Hz from FFT
}
```

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    IndexedDB: "aetheria-db"               │
│                                                          │
│  Object Store: "songs"                                    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ key: song.id (string)                             │    │
│  │ value: {                                          │    │
│  │   id, name, duration, closestSolfeggio,           │    │
│  │   fractalAnalysis, detectedFrequency,             │    │
│  │   fileBlob: Blob,        ← audio data on DISK     │    │
│  │   fileName: string,      ← original filename      │    │
│  │   fileType: string,      ← MIME type              │    │
│  │ }                                                 │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  Object Store: "playlist-state"                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │ key: "current"                                    │    │
│  │ value: {                                          │    │
│  │   playlistOrder: string[],   ← song IDs in order  │    │
│  │   originalOrder: string[],   ← pre-shuffle order  │    │
│  │   currentSongIndex: number,                       │    │
│  │   loShuWalkMode: string | null,                   │    │
│  │   selectedSolfeggio: number,                      │    │
│  │   savedAt: number,          ← Date.now() stamp    │    │
│  │ }                                                 │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

Two stores keep concerns separate: `songs` holds the heavy data (one entry per
track, keyed by song ID), and `playlist-state` holds the lightweight ordering
and session state (one entry, key `"current"`).

## Core Module: `utils/playlistCache.ts`

### Database Setup

```typescript
const DB_NAME = 'aetheria-db';
const DB_VERSION = 1;
const SONGS_STORE = 'songs';
const STATE_STORE = 'playlist-state';

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
```

### Save Playlist

Called after any playlist mutation (import, reorder, delete, analysis complete,
walk generation). Debounced to avoid hammering IndexedDB during rapid changes
(e.g. batch import of 80 files).

```typescript
interface CachedSong {
  id: string;
  name: string;
  duration: number;
  closestSolfeggio?: number;
  fractalAnalysis?: FractalAnalysisResult;
  detectedFrequency?: number;
  fileBlob: Blob;
  fileName: string;
  fileType: string;
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

    // 1. Save each song (audio blob + metadata) in a single transaction
    const songTx = db.transaction(SONGS_STORE, 'readwrite');
    const songStore = songTx.objectStore(SONGS_STORE);

    // Clear existing songs first, then write current playlist.
    // This avoids orphaned entries from deleted tracks.
    songStore.clear();

    // Deduplicate: a song may appear in both playlist and
    // originalPlaylist — store each unique ID only once.
    const seen = new Set<string>();
    const allSongs = [...playlist, ...originalPlaylist];

    for (const song of allSongs) {
      if (seen.has(song.id)) continue;
      seen.add(song.id);

      const cached: CachedSong = {
        id: song.id,
        name: song.name,
        duration: song.duration,
        closestSolfeggio: song.closestSolfeggio,
        fractalAnalysis: song.fractalAnalysis,
        detectedFrequency: song.detectedFrequency,
        fileBlob: song.file,           // File IS a Blob — IndexedDB accepts it
        fileName: song.file.name,
        fileType: song.file.type,
      };
      songStore.put(cached);
    }

    await new Promise<void>((resolve, reject) => {
      songTx.oncomplete = () => resolve();
      songTx.onerror = () => reject(songTx.error);
    });

    // 2. Save playlist ordering and session state
    const stateTx = db.transaction(STATE_STORE, 'readwrite');
    const stateStore = stateTx.objectStore(STATE_STORE);

    stateStore.put({
      key: 'current',
      playlistOrder: playlist.map(s => s.id),
      originalOrder: originalPlaylist.map(s => s.id),
      currentSongIndex,
      loShuWalkMode,
      selectedSolfeggio,
      savedAt: Date.now(),
    });

    await new Promise<void>((resolve, reject) => {
      stateTx.oncomplete = () => resolve();
      stateTx.onerror = () => reject(stateTx.error);
    });

    console.log(`[PlaylistCache] Saved ${seen.size} songs, playlist order: ${playlist.length} tracks`);
  } catch (err) {
    console.warn('[PlaylistCache] Save failed (non-fatal):', err);
    // Caching is a convenience, not critical. Fail silently.
  }
}
```

### Restore Playlist

Called on app mount. Returns null if no cached data exists.

```typescript
interface RestoredPlaylist {
  playlist: Song[];
  originalPlaylist: Song[];
  currentSongIndex: number;
  loShuWalkMode: LoShuWalkMode | null;
  selectedSolfeggio: number;
  savedAt: number;
}

async function restorePlaylist(): Promise<RestoredPlaylist | null> {
  try {
    const db = await openDB();

    // 1. Load playlist state
    const stateTx = db.transaction(STATE_STORE, 'readonly');
    const stateStore = stateTx.objectStore(STATE_STORE);
    const stateReq = stateStore.get('current');

    const state = await new Promise<any>((resolve, reject) => {
      stateReq.onsuccess = () => resolve(stateReq.result);
      stateReq.onerror = () => reject(stateReq.error);
    });

    if (!state || !state.playlistOrder?.length) return null;

    // 2. Load all cached songs
    const songTx = db.transaction(SONGS_STORE, 'readonly');
    const songStore = songTx.objectStore(SONGS_STORE);
    const allSongsReq = songStore.getAll();

    const cachedSongs: CachedSong[] = await new Promise((resolve, reject) => {
      allSongsReq.onsuccess = () => resolve(allSongsReq.result);
      allSongsReq.onerror = () => reject(allSongsReq.error);
    });

    // Build a lookup map
    const songMap = new Map<string, CachedSong>();
    for (const cs of cachedSongs) songMap.set(cs.id, cs);

    // 3. Reconstruct Song objects from cached data
    const toSong = (id: string): Song | null => {
      const cached = songMap.get(id);
      if (!cached) return null;

      // Reconstruct a File from the stored Blob
      const file = new File([cached.fileBlob], cached.fileName, {
        type: cached.fileType,
      });

      return {
        file,
        id: cached.id,
        name: cached.name,
        duration: cached.duration,
        closestSolfeggio: cached.closestSolfeggio,
        fractalAnalysis: cached.fractalAnalysis,
        detectedFrequency: cached.detectedFrequency,
      };
    };

    // Rebuild in saved order, skipping any missing songs
    const playlist = state.playlistOrder
      .map(toSong)
      .filter((s: Song | null): s is Song => s !== null);

    const originalPlaylist = state.originalOrder
      .map(toSong)
      .filter((s: Song | null): s is Song => s !== null);

    if (playlist.length === 0) return null;

    console.log(
      `[PlaylistCache] Restored ${playlist.length} songs ` +
      `(saved ${new Date(state.savedAt).toLocaleTimeString()})`
    );

    return {
      playlist,
      originalPlaylist,
      currentSongIndex: Math.min(state.currentSongIndex, playlist.length - 1),
      loShuWalkMode: state.loShuWalkMode,
      selectedSolfeggio: state.selectedSolfeggio,
      savedAt: state.savedAt,
    };
  } catch (err) {
    console.warn('[PlaylistCache] Restore failed (non-fatal):', err);
    return null;
  }
}
```

### Clear Cache

Wipes both IndexedDB stores completely.

```typescript
async function clearPlaylistCache(): Promise<void> {
  try {
    const db = await openDB();

    const songTx = db.transaction(SONGS_STORE, 'readwrite');
    songTx.objectStore(SONGS_STORE).clear();
    await new Promise<void>((res, rej) => {
      songTx.oncomplete = () => res();
      songTx.onerror = () => rej(songTx.error);
    });

    const stateTx = db.transaction(STATE_STORE, 'readwrite');
    stateTx.objectStore(STATE_STORE).clear();
    await new Promise<void>((res, rej) => {
      stateTx.oncomplete = () => res();
      stateTx.onerror = () => rej(stateTx.error);
    });

    console.log('[PlaylistCache] Cache cleared');
  } catch (err) {
    console.warn('[PlaylistCache] Clear failed:', err);
  }
}
```

### Storage Estimate Check

Before caching, check if the device has enough disk space. Skip caching (but
don't error) if storage is tight.

```typescript
async function hasStorageCapacity(
  requiredMB: number = 100
): Promise<boolean> {
  try {
    if (!navigator.storage?.estimate) return true; // API not available, assume OK
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
    return true; // Can't check, assume OK
  }
}
```

### Debounced Auto-Save

Wrap `savePlaylist` in a debounce so rapid mutations (batch import, analysis
updates) don't thrash IndexedDB.

```typescript
let saveTimer: ReturnType<typeof setTimeout> | null = null;

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
        playlist, originalPlaylist,
        currentSongIndex, loShuWalkMode, selectedSolfeggio
      );
    }
  }, delayMs);
}
```

### Module Exports

```typescript
export {
  openDB,
  savePlaylist,
  restorePlaylist,
  clearPlaylistCache,
  hasStorageCapacity,
  debouncedSave,
};
```

## Integration in App.tsx

### 1. Import the Cache Module

```typescript
import {
  restorePlaylist,
  clearPlaylistCache,
  debouncedSave,
} from './utils/playlistCache';
```

### 2. Restore on Mount

Add an effect that runs once on mount, before user interaction. If cached data
exists, populate the playlist state. Show a brief "Restored X tracks" toast.

```typescript
const [isRestoring, setIsRestoring] = useState(false);
const [cacheAvailable, setCacheAvailable] = useState(false);

useEffect(() => {
  let cancelled = false;

  (async () => {
    const cached = await restorePlaylist();
    if (cancelled || !cached) return;

    setCacheAvailable(true);
    setIsRestoring(true);

    setPlaylist(cached.playlist);
    setOriginalPlaylist(cached.originalPlaylist);
    setCurrentSongIndex(cached.currentSongIndex);
    if (cached.loShuWalkMode) {
      setLoShuWalkMode(cached.loShuWalkMode);
    }
    setSelectedSolfeggio(cached.selectedSolfeggio as SolfeggioFreq);

    console.log(
      `[Aetheria] Playlist restored: ${cached.playlist.length} tracks ` +
      `from ${new Date(cached.savedAt).toLocaleString()}`
    );

    // Brief UI feedback
    setTimeout(() => setIsRestoring(false), 2000);
  })();

  return () => { cancelled = true; };
}, []);  // mount-only
```

### 3. Auto-Save on Playlist Changes

Add an effect that fires whenever playlist-relevant state changes:

```typescript
useEffect(() => {
  // Don't save during initial restore or if playlist is empty
  if (isRestoring || playlist.length === 0) return;

  debouncedSave(
    playlist,
    originalPlaylist,
    currentSongIndex,
    loShuWalkMode,
    selectedSolfeggio
  );
}, [playlist, originalPlaylist, currentSongIndex, loShuWalkMode, selectedSolfeggio]);
```

### 4. Clear Playlist Handler

A single function that stops playback, clears all in-memory state, AND wipes
the IndexedDB cache.

```typescript
const clearEntirePlaylist = useCallback(async () => {
  // Stop playback
  setIsPlaying(false);
  if (sourceNodeRef.current) {
    try {
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
    } catch {}
    sourceNodeRef.current = null;
  }

  // Revoke any active object URLs to free memory
  if (audioRef.current?.src) {
    try { URL.revokeObjectURL(audioRef.current.src); } catch {}
    audioRef.current.src = '';
  }

  // Clear in-memory state
  setPlaylist([]);
  setOriginalPlaylist([]);
  setFilteredPlaylist([]);
  setCurrentSongIndex(-1);
  clearLoShuWalkMode();

  // Clear IndexedDB cache
  await clearPlaylistCache();

  console.log('[Aetheria] Playlist and cache cleared');
}, []);
```

## UI: Clear Playlist Button

### Placement

Mom's specification: the button sits **below the total playlist time** at the
bottom of the playlist panel. It must be spatially separated from any
restore/import buttons so it requires a deliberate scroll-down-and-click,
never an accidental tap.

### Design

- Muted, non-prominent — slate/red tones, not gold
- Requires a confirmation tap (tap once to arm, tap again to confirm)
- Small text, clearly labeled
- Shows track count in the confirmation to reinforce what's being deleted

### Implementation

Find the playlist footer (currently around line 6659 in App.tsx):

```tsx
{/* EXISTING: Playlist footer — track count + total duration */}
<div className="p-3 bg-black/95 backdrop-blur text-center text-xs
     text-slate-500 border-t border-slate-900 flex justify-between
     px-6 shrink-0 z-20 mb-20">
    <span>
      {searchTerm
        ? `${filteredPlaylist.length}/${playlist.length} Tracks`
        : `${playlist.length} Tracks`
      }
    </span>
    <span className="text-gold-500/80">{getTotalDuration()} Total</span>
</div>

{/* NEW: Clear Playlist button — below the footer, deliberate action */}
{playlist.length > 0 && (
  <div className="px-6 pb-6 pt-2 bg-black/95 shrink-0 -mt-20 mb-0 z-10">
    <ClearPlaylistButton onClear={clearEntirePlaylist} trackCount={playlist.length} />
  </div>
)}
```

### ClearPlaylistButton Component

A two-tap confirmation pattern: first tap arms the button (changes color,
shows track count warning), second tap within 3 seconds confirms the clear.
Auto-disarms after timeout. Prevents accidental wipes.

```tsx
// components/ClearPlaylistButton.tsx

import React, { useState, useRef } from 'react';
import { Trash2 } from 'lucide-react';

interface Props {
  onClear: () => void;
  trackCount: number;
}

const ClearPlaylistButton: React.FC<Props> = ({ onClear, trackCount }) => {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (!armed) {
      // First tap — arm the button
      setArmed(true);
      timerRef.current = setTimeout(() => setArmed(false), 3000);
    } else {
      // Second tap — confirm and clear
      if (timerRef.current) clearTimeout(timerRef.current);
      setArmed(false);
      onClear();
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full text-[11px] py-2.5 rounded-lg border transition-all
        duration-300 flex items-center justify-center gap-2 ${
        armed
          ? 'bg-red-900/30 border-red-500/50 text-red-300 hover:bg-red-900/50'
          : 'bg-slate-900/50 border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700'
      }`}
    >
      <Trash2 size={12} />
      {armed
        ? `Tap again to clear ${trackCount} tracks and cache`
        : 'Clear Playlist & Cache'
      }
    </button>
  );
};

export default ClearPlaylistButton;
```

### Restore Notification (Optional Toast)

When the app loads and restores a cached playlist, show a brief non-intrusive
toast so the user knows their library is back:

```tsx
{/* Restore toast — shows briefly after cache restore */}
{isRestoring && (
  <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50
       bg-emerald-900/90 border border-emerald-500/30 text-emerald-200
       text-xs px-4 py-2 rounded-full backdrop-blur shadow-lg
       animate-in fade-in slide-in-from-bottom-4 duration-500">
    ✓ Restored {playlist.length} tracks from cache
  </div>
)}
```

## Visual Layout Summary

```
┌────────────────────────────────────────┐
│  ♫ Song 1                         3:42 │
│  ♫ Song 2                         4:18 │
│  ♫ Song 3                         5:01 │
│  ...                                   │
│  ♫ Song 30                        3:55 │
├────────────────────────────────────────┤
│  30 Tracks          2:14:36 Total      │ ← existing footer
├────────────────────────────────────────┤
│                                        │
│   🗑  Clear Playlist & Cache            │ ← new button (muted, below footer)
│                                        │
│   After first tap:                     │
│   🗑  Tap again to clear 30 tracks     │ ← armed state (red, 3s timeout)
│         and cache                      │
│                                        │
└────────────────────────────────────────┘
```

## Testing Checklist

- [ ] Import 10+ songs → reload page → playlist restored with all metadata
- [ ] Restored songs play correctly (audio data intact)
- [ ] Frequency assignments (closestSolfeggio) survive the cache round-trip
- [ ] Fractal analysis data survives the cache round-trip
- [ ] Lo Shu walk mode and playlist order restored correctly
- [ ] Clear Playlist button wipes in-memory state immediately
- [ ] Clear Playlist button wipes IndexedDB (verify in DevTools → Application → IndexedDB)
- [ ] Two-tap confirmation prevents accidental clear
- [ ] Armed state auto-disarms after 3 seconds
- [ ] Auto-save debounce: rapid imports don't thrash IndexedDB
- [ ] Low-storage device: caching skips gracefully, app still works without cache
- [ ] 6 GB RAM phone: no playback issues with cached playlist of 30+ tracks
- [ ] Sub-bass drone and solfeggio layer survive playlist restore
- [ ] Restore toast appears briefly and fades
- [ ] Empty cache (first visit): app loads normally, no errors

## Design Guidelines

- Clear button: muted slate tones in idle state, red tones when armed
- Restore toast: emerald tones (success), positioned above the player controls
- All new UI elements follow existing conventions:
  - Dark backgrounds, subtle borders
  - Text: `text-[11px]` for small controls, `text-xs` for labels
  - Transitions: `transition-all duration-300`
  - Font: system sans-serif for controls (matching existing playlist UI)

## Edge Cases

- **Corrupted cache**: If `restorePlaylist` throws or returns incomplete data,
  the app falls through to the normal empty-playlist state. Never crash on
  bad cache data.
- **Storage quota exceeded**: `hasStorageCapacity` check prevents the save;
  the app continues normally without caching. Console warns once.
- **Mixed playlist**: If the user imports new songs after a restore, the
  auto-save captures the combined playlist (cached + new).
- **Walk in progress**: If a Lo Shu walk was active when the page reloaded,
  the walk mode and current index are restored so the journey continues.
- **Duration re-analysis**: Cached songs already have durations, so the
  background duration analyzer should skip songs with `duration > 0` to
  avoid redundant work on restore.

---

*Implementation guide by Claude (Anthropic) in collaboration with Joseph Lewis & Alisha Lewis — 2026*
