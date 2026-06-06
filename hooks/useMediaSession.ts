// useMediaSession.ts
import { useEffect, useRef } from "react";

export interface Track {
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
}

interface UseMediaSessionOptions {
  track: Track | null;
  isPlaying: boolean;
  /** Current playback time in seconds. Passed to setPositionState so the
   *  lock-screen / car-display scrubber shows accurate progress. */
  currentTime?: number;
  /** Track duration in seconds. */
  duration?: number;
  /** Playback rate (1 = normal, 0.98 = 432Hz pitch shift, etc.). Defaults to 1. */
  playbackRate?: number;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  /** Relative skip in seconds (negative = backward). Wired to the
   *  seekbackward / seekforward media actions (car & lock-screen ±skip). */
  onSeek?: (deltaSeconds: number) => void;
  /** Absolute seek as a fraction (0..1) of duration. Wired to the seekto
   *  action the OS fires when the user drags the lock-screen / car scrubber.
   *  A fraction keeps the seek accurate regardless of the pitch-shift factor
   *  baked into the reported duration. */
  onSeekToFraction?: (fraction: number) => void;
}

export function useMediaSession({
  track,
  isPlaying,
  currentTime,
  duration,
  playbackRate = 1,
  onPlay,
  onPause,
  onNext,
  onPrevious,
  onSeek,
  onSeekToFraction,
}: UseMediaSessionOptions) {
  // Update metadata when track changes
  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return;

    // Create multiple artwork sizes for better device compatibility
    const artworkSizes = [
      { sizes: "96x96", type: "image/png" },
      { sizes: "128x128", type: "image/png" },
      { sizes: "192x192", type: "image/png" },
      { sizes: "256x256", type: "image/png" },
      { sizes: "384x384", type: "image/png" },
      { sizes: "512x512", type: "image/png" }
    ];

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || "Unknown Track",
        artist: track.artist || "Unknown Artist",
        album: track.album || "Unknown Album",
        artwork: track.artworkUrl
          ? artworkSizes.map(size => ({
              src: track.artworkUrl!,
              ...size
            }))
          : [],
      });
    } catch (error) {
      console.error("Failed to set media metadata:", error);
    }
  }, [track]);

  // Keep the latest callbacks in a ref so the action handlers can be
  // registered ONCE and still call the current functions. Previously the
  // handlers were re-registered on every render (onPlay/onPause/onNext/
  // onPrevious are new function identities each render), and each
  // re-registration briefly nulled the handlers in cleanup — which made the
  // lock-screen controls (notably the previous-track button) flicker in and
  // out.
  const callbacksRef = useRef({ onPlay, onPause, onNext, onPrevious, onSeek, onSeekToFraction, duration });
  useEffect(() => {
    callbacksRef.current = { onPlay, onPause, onNext, onPrevious, onSeek, onSeekToFraction, duration };
  }, [onPlay, onPause, onNext, onPrevious, onSeek, onSeekToFraction, duration]);

  // Wire media controls ONCE. Handlers read callbacksRef, so they never go
  // stale and never need to be torn down on a normal render.
  useEffect(() => {
    if (!("mediaSession" in navigator)) {
      console.log("Media Session API not supported");
      return;
    }

    const actions: Array<{
      action: MediaSessionAction;
      handler: MediaSessionActionHandler;
    }> = [
      { action: "play", handler: () => callbacksRef.current.onPlay() },
      { action: "pause", handler: () => callbacksRef.current.onPause() },
      { action: "previoustrack", handler: () => callbacksRef.current.onPrevious() },
      { action: "nexttrack", handler: () => callbacksRef.current.onNext() },
      { action: "stop", handler: () => callbacksRef.current.onPause() },
      {
        action: "seekbackward",
        handler: (details) => {
          const offset = (details && (details as any).seekOffset) || 10;
          callbacksRef.current.onSeek?.(-offset);
        },
      },
      {
        action: "seekforward",
        handler: (details) => {
          const offset = (details && (details as any).seekOffset) || 10;
          callbacksRef.current.onSeek?.(offset);
        },
      },
      {
        action: "seekto",
        handler: (details) => {
          const seekTime = (details as any)?.seekTime;
          const dur = callbacksRef.current.duration;
          if (typeof seekTime === "number" && typeof dur === "number" && dur > 0) {
            const fraction = Math.max(0, Math.min(1, seekTime / dur));
            callbacksRef.current.onSeekToFraction?.(fraction);
          }
        },
      },
    ];

    actions.forEach(({ action, handler }) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (error) {
        console.log(`Action "${action}" not supported`, error);
      }
    });

    return () => {
      actions.forEach(({ action }) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore errors during cleanup
        }
      });
    };
    // Register once — handlers are stable (they call callbacksRef.current).
  }, []);

  // Keep the lock-screen play/pause icon in sync with the real player.
  //
  // NOTE: we intentionally do NOT spin up a throwaway "silent" <audio> element
  // here. That old trick created a second media element on every play, which on
  // mobile stole the media-session focus from the real player — causing the
  // lock-screen controls to detach (previous-track button flickering), the
  // play/pause button to work only once, and playback to die after a track or
  // two with the screen off. The real <audio> element driving the Web Audio
  // graph is what holds the session; nothing else is needed.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch (error) {
      console.error("Failed to set playback state:", error);
    }
  }, [isPlaying]);

  // Position state — drives the lock-screen / car-display scrubber.
  // Without these calls the OS has no reliable position info and falls
  // back to extrapolation that visibly glitches on every React render
  // that touches the media session (we were seeing this every ~1s).
  //
  // Throttling matters: timeupdate fires ~4×/sec in the foreground and
  // App.tsx ticks setCurrTime even more often via the audio analysis
  // loop. Calling setPositionState every tick itself causes the lock
  // screen to flicker. Instead: update unconditionally on track/play
  // changes (sub-second responsiveness for skip + play/pause) and
  // throttle continuous time-ticks to once per second (smooth enough
  // that the OS's own extrapolation handles the in-between frames).
  const lastPositionUpdateRef = useRef<number>(0);
  const lastReportedTrackRef = useRef<Track | null>(null);
  const lastReportedPlayingRef = useRef<boolean>(false);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== "function") return;
    if (duration === undefined || currentTime === undefined) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (!Number.isFinite(currentTime) || currentTime < 0) return;

    const trackChanged = lastReportedTrackRef.current !== track;
    const playStateChanged = lastReportedPlayingRef.current !== isPlaying;
    const now = Date.now();
    const sinceLast = now - lastPositionUpdateRef.current;

    // Force-update on track or play-state change. Otherwise throttle to
    // 1 Hz — fast enough to keep the scrubber honest under playback
    // drift, slow enough not to fight the OS's own interpolation.
    if (!trackChanged && !playStateChanged && sinceLast < 1000) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: playbackRate || 1,
      });
      lastPositionUpdateRef.current = now;
      lastReportedTrackRef.current = track;
      lastReportedPlayingRef.current = isPlaying;
    } catch (error) {
      // Some browsers throw if values are invalid (e.g. NaN duration on
      // a still-loading track). Safe to ignore — the next valid update
      // will succeed.
    }
  }, [track, isPlaying, currentTime, duration, playbackRate]);
}