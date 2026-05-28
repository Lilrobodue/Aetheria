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

  // Install the visibilitychange re-acquire handler exactly once per page
  // lifetime. The handler reads `this.wakeLock` and `this.intendedHeld`
  // at call time, so a single listener covers every future acquire/release
  // cycle.
  //
  // The previous code attached a fresh listener inside every
  // requestWakeLock() call. Over a 19-hour 240-track session that produced
  // ~240 stacked listeners on document; when the browser auto-released
  // the lock on tab-hide, all 240 fired on tab-return and each one called
  // requestWakeLock() in parallel — adding 240 more listeners. Exponential
  // growth, console flooded, native-memory accumulation.
  private ensureVisibilityHandler() {
    if (this.visibilityHandlerInstalled) return;
    document.addEventListener('visibilitychange', async () => {
      // On return-to-visible: if we're supposed to hold a lock but don't,
      // re-acquire. Covers both the auto-release-on-hide case and the
      // request-denied-while-hidden case.
      if (!document.hidden && this.intendedHeld && (this.wakeLock === null || this.wakeLock.released)) {
        await this.requestWakeLock();
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

    try {
      this.wakeLock = await (navigator as any).wakeLock.request('screen');
      console.log('Wake lock acquired');

      // Release listener is attached to the sentinel object itself, so it
      // GCs with the sentinel on release — no document-level accumulation.
      this.wakeLock.addEventListener('release', () => {
        console.log('Wake lock released');
      });

      return true;
    } catch (error) {
      console.error('Failed to acquire wake lock:', error);
      return false;
    }
  }

  async releaseWakeLock() {
    this.intendedHeld = false;
    if (this.wakeLock && !this.wakeLock.released) {
      await this.wakeLock.release();
      this.wakeLock = null;
      console.log('Wake lock released');
    }
  }
}

// Export singleton instance
export const stabilityManager = StabilityManager.getInstance();
export const wakeLockManager = new WakeLockManager();