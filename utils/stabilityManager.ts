// Stability Manager for Aetheria
// Handles memory management, crash recovery, and performance optimization

export class StabilityManager {
  private static instance: StabilityManager;
  private memoryCheckInterval: number | null = null;
  private lastCheckpoint: any = null;
  private audioContextRefs: WeakSet<AudioContext> = new WeakSet();
  private errorCount = 0;
  private readonly MAX_ERROR_COUNT = 5;
  private readonly MEMORY_WARNING_THRESHOLD = 0.8; // 80% memory usage

  private constructor() {
    this.setupGlobalErrorHandlers();
    this.startMemoryMonitoring();
    this.setupVisibilityHandling();
  }

  static getInstance(): StabilityManager {
    if (!StabilityManager.instance) {
      StabilityManager.instance = new StabilityManager();
    }
    return StabilityManager.instance;
  }

  // Global error handlers
  private setupGlobalErrorHandlers() {
    // Handle unhandled errors
    window.addEventListener('error', (event) => {
      console.error('Global error:', event.error);
      this.handleError(event.error);
      event.preventDefault();
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled rejection:', event.reason);
      this.handleError(event.reason);
      event.preventDefault();
    });

    // Handle memory pressure events (Safari)
    if ('onmemorywarning' in window) {
      (window as any).onmemorywarning = () => {
        console.warn('Memory warning received');
        this.handleMemoryPressure();
      };
    }
  }

  // Memory monitoring
  private startMemoryMonitoring() {
    if ('memory' in performance) {
      this.memoryCheckInterval = window.setInterval(() => {
        const memory = (performance as any).memory;
        const usage = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
        
        if (usage > this.MEMORY_WARNING_THRESHOLD) {
          console.warn(`High memory usage: ${(usage * 100).toFixed(2)}%`);
          this.handleMemoryPressure();
        }
      }, 10000); // Check every 10 seconds
    }
  }

  // Handle visibility changes (app going to background)
  private setupVisibilityHandling() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // App going to background
        this.saveCheckpoint();
        this.reduceMemoryUsage();
      } else {
        // App coming to foreground
        this.restoreFromCheckpoint();
      }
    });

    // Handle page freeze/unfreeze (newer API)
    if ('onfreeze' in document) {
      document.addEventListener('freeze', () => {
        this.saveCheckpoint();
        this.suspendHeavyOperations();
      });

      document.addEventListener('resume', () => {
        this.restoreFromCheckpoint();
        this.resumeOperations();
      });
    }
  }

  // Error handling
  private handleError(error: any) {
    this.errorCount++;
    
    if (this.errorCount > this.MAX_ERROR_COUNT) {
      // Too many errors, initiate recovery
      console.error('Too many errors, initiating recovery');
      this.recoverFromCrash();
    }

    // Log error to console with stack trace
    console.error('Stability Manager caught error:', error);
    
    // Send error to service worker for persistence
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'ERROR_LOG',
        error: {
          message: error?.message || String(error),
          stack: error?.stack,
          timestamp: Date.now()
        }
      });
    }
  }

  // Memory pressure handling
  private handleMemoryPressure() {
    console.log('Handling memory pressure');
    
    // Force garbage collection if available (Chrome with --js-flags="--expose-gc")
    if ('gc' in window) {
      (window as any).gc();
    }

    // Reduce visualizer quality
    this.postMessageToApp({ type: 'REDUCE_QUALITY' });

    // Clear caches
    this.clearCaches();

    // Reduce buffer sizes
    this.optimizeBuffers();
  }

  // Save checkpoint for recovery
  saveCheckpoint(data?: any) {
    try {
      const checkpoint = {
        timestamp: Date.now(),
        currentSongIndex: data?.currentSongIndex,
        isPlaying: data?.isPlaying,
        volume: data?.volume,
        selectedFrequency: data?.selectedFrequency,
        playlist: data?.playlist?.map((s: any) => ({
          id: s.id,
          name: s.name,
          duration: s.duration
        }))
      };

      this.lastCheckpoint = checkpoint;
      
      // Save to localStorage for persistence
      localStorage.setItem('aetheria_checkpoint', JSON.stringify(checkpoint));
      
      // Send to service worker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'AUDIO_STATE',
          state: checkpoint
        });
      }
    } catch (error) {
      console.error('Failed to save checkpoint:', error);
    }
  }

  // Restore from checkpoint
  //
  // Gated on `force`: only true crash recovery should restore unconditionally.
  // visibilitychange / freeze-resume callers leave `force=false`, which makes
  // the restore a no-op once we have in-memory state for the session.
  //
  // Why: localStorage is updated by a periodic checkpoint interval that lags
  // React state by up to a few seconds. If the user tabs away and back while
  // a song is playing, the visibilitychange-visible path used to read that
  // slightly-stale state and `setCurrentSongIndex` to a value behind the
  // current track — rewinding the shuffle queue and causing the same tracks
  // to play again on the next advance. React state already survives tab
  // switches and page freezes, so restoring localStorage on those events was
  // never load-bearing; only an actual page reload after a crash needs it.
  private restoreFromCheckpoint(force = false) {
    if (this.lastCheckpoint && !force) {
      return;
    }
    try {
      const saved = localStorage.getItem('aetheria_checkpoint');
      if (saved) {
        this.lastCheckpoint = JSON.parse(saved);
        this.postMessageToApp({ type: 'RESTORE_STATE', state: this.lastCheckpoint });
      }
    } catch (error) {
      console.error('Failed to restore checkpoint:', error);
    }
  }

  // Crash recovery
  private recoverFromCrash() {
    console.log('Initiating crash recovery');

    // Reset error count
    this.errorCount = 0;

    // Clear problematic data
    this.clearCaches();

    // Force-restore from localStorage. This is the only caller that
    // legitimately needs to overwrite in-memory state — visibility/resume
    // events leave the default `force=false` so they skip if we already
    // have current state for the session.
    this.restoreFromCheckpoint(true);

    // Reload if necessary
    if (this.errorCount > this.MAX_ERROR_COUNT * 2) {
      console.log('Reloading application');
      window.location.reload();
    }
  }

  // Memory optimization methods
  private clearCaches() {
    // Clear image caches
    const images = document.getElementsByTagName('img');
    Array.from(images).forEach(img => {
      if (img.src.startsWith('blob:')) {
        URL.revokeObjectURL(img.src);
      }
    });

    // Clear audio caches
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          if (name.includes('audio-cache')) {
            caches.delete(name);
          }
        });
      });
    }
  }

  private optimizeBuffers() {
    this.postMessageToApp({ type: 'OPTIMIZE_BUFFERS' });
  }

  private reduceMemoryUsage() {
    this.postMessageToApp({ type: 'REDUCE_MEMORY' });
  }

  private suspendHeavyOperations() {
    this.postMessageToApp({ type: 'SUSPEND_HEAVY_OPS' });
  }

  private resumeOperations() {
    this.postMessageToApp({ type: 'RESUME_OPS' });
  }

  // Communication with main app
  private postMessageToApp(message: any) {
    window.postMessage({ ...message, source: 'stability-manager' }, window.location.origin);
  }

  // Audio context management
  registerAudioContext(ctx: AudioContext) {
    this.audioContextRefs.add(ctx);
  }

  // Cleanup
  cleanup() {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
    }
  }

  // Get system status
  getSystemStatus() {
    const status: any = {
      errorCount: this.errorCount,
      hasCheckpoint: !!this.lastCheckpoint,
      checkpointAge: this.lastCheckpoint ? Date.now() - this.lastCheckpoint.timestamp : null,
    };

    if ('memory' in performance) {
      const memory = (performance as any).memory;
      status.memory = {
        used: memory.usedJSHeapSize,
        total: memory.jsHeapSizeLimit,
        usage: memory.usedJSHeapSize / memory.jsHeapSizeLimit
      };
    }

    return status;
  }
}

// v16.4 re-review: how long a wake-lock request in flight is shared. A request the browser has not answered by then is
// left to land on its own (WakeLockManager.acquire keeps it only if it is the one lock wanted), and the next caller
// asks again: before, a request that never settled was shared by every later call for the page's life, so the screen
// could sleep while music played until a reload.
export const WAKE_LOCK_PENDING_MS = 5000;

// Wake Lock Manager for preventing screen sleep during playback
export class WakeLockManager {
  private wakeLock: any = null;
  private isSupported = 'wakeLock' in navigator;
  private visibilityHandlerInstalled = false;
  // Tracks whether we *want* to be holding a lock right now. Separate from
  // `this.wakeLock` because the browser can deny the request (hidden tab)
  // or auto-release the lock (also tab-hide). Intent drives the retry on
  // visibility return.
  private intendedHeld = false;
  // v16.4, Keep screen awake (More › Safety & comfort; App's keepAwake, saved from its switch). Off: no lock is taken or
  // held while music plays, so the screen sleeps as the device is set to. The intent above is kept, so turning it back
  // on while playing takes a lock at once. App's pinned keep-alive effect still asks and releases as before: this is
  // the gate that decides whether a lock is taken. On (unset) is the behaviour before v16.4.
  private enabled = true;
  // v16.4 review: the one request in flight, or null. At most one lock is ever held: a caller while a request is
  // pending shares it, and a lock that lands when it is no longer wanted (the switch went off, or the music stopped
  // asking) is released at once. Before, a second request (the switch off and on again, or the keep-alive effect and
  // the visibility handler together) overwrote the first lock, which was never released and kept the screen on until
  // the page was hidden.
  // v16.4 re-review: with when it was asked (`since`). It is shared for WAKE_LOCK_PENDING_MS only; after that the next
  // caller asks again, and the old request, should it ever land, is released at once unless it is the one lock wanted
  // and none is held (so still at most one).
  private pending: { promise: Promise<boolean>; since: number } | null = null;
  // The clock for `since` (an instance field, so a test can drive it).
  private now = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      const held = this.wakeLock;
      this.wakeLock = null;
      if (held && !held.released) {
        held.release().catch(() => {});
      }
      // A request still in flight is released when it lands (acquire reads `enabled` after its await).
    } else if (this.intendedHeld) {
      // requestWakeLock decides: none while hidden, none while a live lock is held or a request is in flight (one asked
      // under WAKE_LOCK_PENDING_MS ago).
      void this.requestWakeLock();
    }
  }

  // Install the visibilitychange re-acquire handler exactly once per page
  // lifetime. The handler reads `this.intendedHeld` at call time, so a
  // single listener covers every future acquire/release cycle.
  //
  // The previous code attached a fresh listener inside every
  // requestWakeLock() call. Over a 19-hour 240-track session that produced
  // ~240 stacked listeners on document; when the browser auto-released
  // the lock on tab-hide, all 240 fired on tab-return and each one called
  // requestWakeLock() in parallel — adding 240 more listeners. Exponential
  // growth, console flooded, native-memory accumulation.
  private ensureVisibilityHandler() {
    if (this.visibilityHandlerInstalled) return;
    document.addEventListener('visibilitychange', () => {
      // On return-to-visible: if we're supposed to hold a lock, ask again.
      // Covers both the auto-release-on-hide case and the request-denied-
      // while-hidden case. requestWakeLock is the one gate (v16.4 review):
      // Keep screen awake off, a live lock already held, or a request in
      // flight all take none there.
      if (!document.hidden && this.intendedHeld) {
        void this.requestWakeLock();
      }
    });
    this.visibilityHandlerInstalled = true;
  }

  async requestWakeLock() {
    if (!this.isSupported) {
      console.log('Wake Lock API not supported');
      return false;
    }

    this.intendedHeld = true;
    this.ensureVisibilityHandler();

    // v16.4: Keep screen awake is off.
    if (!this.enabled) {
      return false;
    }

    // Already holding a live lock — nothing to do.
    if (this.wakeLock !== null && !this.wakeLock.released) {
      return true;
    }

    // Browsers reject wake lock requests when the page is hidden. Trying
    // would log a NotAllowedError per attempt — and during background
    // playback we get one attempt per track. Bail silently; the visibility
    // handler above will re-issue once the user returns to the tab.
    if (document.hidden) {
      return false;
    }

    // v16.4 review: one request at a time; a caller while one is in flight shares it. v16.4 re-review: for
    // WAKE_LOCK_PENDING_MS; one the browser hasn't answered by then is no longer waited for, and this caller asks again.
    if (this.pending && this.now() - this.pending.since < WAKE_LOCK_PENDING_MS) {
      return this.pending.promise;
    }
    const entry: { promise: Promise<boolean>; since: number } = { promise: Promise.resolve(false), since: this.now() };
    this.pending = entry;
    entry.promise = this.acquire(entry);
    return entry.promise;
  }

  // The request itself. Its first await comes before anything can settle (the browser is asked a microtask later), so
  // `pending` is always set by the time it is cleared here. It clears `pending` only if it is still the request in
  // flight (v16.4 re-review: an older one, no longer waited for, can land after a newer one was asked).
  private async acquire(entry: { promise: Promise<boolean>; since: number }): Promise<boolean> {
    let lock: any;
    try {
      lock = await Promise.resolve().then(() => (navigator as any).wakeLock.request('screen'));
    } catch (error) {
      if (this.pending === entry) this.pending = null;
      console.error('Failed to acquire wake lock:', error);
      return false;
    }
    if (this.pending === entry) this.pending = null;

    // Landed when no longer wanted: Keep screen awake went off (v16.4), or the music stopped asking (a pause while it
    // was in flight). Or (v16.4 re-review) a live lock is already held: this is the second of two requests in flight,
    // which happens only once one went unanswered for WAKE_LOCK_PENDING_MS and the next caller asked again; whichever
    // lands first is kept. Released at once, so at most one lock is held.
    const holding = this.wakeLock !== null && !this.wakeLock.released;
    if (!this.enabled || !this.intendedHeld || holding) {
      lock.release().catch(() => {});
      return holding && this.enabled && this.intendedHeld;
    }

    this.wakeLock = lock;
    console.log('Wake lock acquired');

    // Release listener is attached to the sentinel object itself, so it
    // GCs with the sentinel on release — no document-level accumulation.
    this.wakeLock.addEventListener('release', () => {
      console.log('Wake lock released');
    });

    return true;
  }

  async releaseWakeLock() {
    this.intendedHeld = false;
    // v16.4 review: let go of the reference first, so a request that lands while this release is awaited is never
    // overwritten by a late `null` (it would then be held with nothing left to release it). A request still in flight
    // is released when it lands (acquire reads `intendedHeld` after its await).
    const held = this.wakeLock;
    this.wakeLock = null;
    if (held && !held.released) {
      try {
        await held.release();
      } catch {}
      console.log('Wake lock released');
    }
  }
}

// Export singleton instance
export const stabilityManager = StabilityManager.getInstance();
export const wakeLockManager = new WakeLockManager();