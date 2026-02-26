// useMediaSession.ts
import { useEffect } from "react";

export interface Track {
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
}

interface UseMediaSessionOptions {
  track: Track | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

export function useMediaSession({
  track,
  isPlaying,
  onPlay,
  onPause,
  onNext,
  onPrevious,
}: UseMediaSessionOptions) {
  // Update metadata when track changes
  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artworkUrl
        ? [
            {
              src: track.artworkUrl,
              sizes: "512x512",
              type: "image/png",
            },
          ]
        : [],
    });
  }, [track]);

  // Wire steering‑wheel / headset / car controls
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", () => {
      onPlay();
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      onPause();
    });

    navigator.mediaSession.setActionHandler("previoustrack", () => {
      onPrevious();
    });

    navigator.mediaSession.setActionHandler("nexttrack", () => {
      onNext();
    });

    return () => {
      // optional cleanup
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
      } catch {
        // some browsers throw if setting null; safe to ignore
      }
    };
  }, [onPlay, onPause, onNext, onPrevious]);

  // Optionally hint playback state to the OS (not widely used but harmless)
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      /* ignore */
    }
  }, [isPlaying]);
}