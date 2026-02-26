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

  // Wire media controls with enhanced mobile support
  useEffect(() => {
    if (!("mediaSession" in navigator)) {
      console.log("Media Session API not supported");
      return;
    }

    const actions: Array<{
      action: MediaSessionAction;
      handler: MediaSessionActionHandler;
    }> = [
      { 
        action: "play", 
        handler: () => {
          console.log("Media session: play");
          onPlay();
        }
      },
      { 
        action: "pause", 
        handler: () => {
          console.log("Media session: pause");
          onPause();
        }
      },
      { 
        action: "previoustrack", 
        handler: () => {
          console.log("Media session: previous");
          onPrevious();
        }
      },
      { 
        action: "nexttrack", 
        handler: () => {
          console.log("Media session: next");
          onNext();
        }
      },
      // Additional actions for better mobile support
      { 
        action: "stop", 
        handler: () => {
          console.log("Media session: stop");
          onPause();
        }
      },
      { 
        action: "seekbackward", 
        handler: (details) => {
          console.log("Media session: seek backward", details);
          // Could implement 10s backward seek here if needed
        }
      },
      { 
        action: "seekforward", 
        handler: (details) => {
          console.log("Media session: seek forward", details);
          // Could implement 10s forward seek here if needed
        }
      }
    ];

    // Set all action handlers
    actions.forEach(({ action, handler }) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (error) {
        console.log(`Action "${action}" not supported`, error);
      }
    });

    return () => {
      // Cleanup
      actions.forEach(({ action }) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore errors during cleanup
        }
      });
    };
  }, [onPlay, onPause, onNext, onPrevious]);

  // Update playback state with mobile-specific handling
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
      
      // For mobile devices, we may need to trigger a fake audio play
      // to ensure the media session is recognized
      if (isPlaying && 'Audio' in window) {
        // Create a silent audio element to ensure media session is active
        const silentAudio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn9rrvmMhBSuBzvLZiTQIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWT' +
                          'AsQVqzn67JlHQU+k9j0t3EqAyd1yPDbkj0JFV+05+2mVBEKQJve6b1hIAUrf87y2IkwBBxqwO7fnEoHDlag5OmyYBYDPJjY9Lh5J' +
                          'Qcve8vz5IUqCRJdt+DopFEZDj+a3uS9YSEGMoDD7tiJOQkcaLvs45hNFgtTqOPwtmYcBTuS1/XNeSYGLHfH+N+ROwkUXrTm66pVFQ' +
                          'pGnt/rvmQiBCuAyu/diTQGGWm+8OKcTwUMUqnl7rllHQY3kNn1unElBSh6yu7fjjEIHGq98uOYSgwPVKzm67hkGgU9k9n0uHIlBCt3' +
                          'yPDdjzwLF1+y5+umVRYJPpza6btgIAUpfs/02YkyBRpqvu/gnEwNDlOq5O22ZBwFN5DY88p3KAcuhM330YQpBh1ywu3enEwHC1eq' +
                          '4+u0YhMJPZva6b1iIwUufc/y14k7Bhto');
        silentAudio.volume = 0.001; // Very quiet
        silentAudio.play().catch(() => {
          // Ignore autoplay errors
        });
        
        // Stop it immediately
        setTimeout(() => {
          silentAudio.pause();
          silentAudio.remove();
        }, 100);
      }
    } catch (error) {
      console.error("Failed to set playback state:", error);
    }
  }, [isPlaying]);

  // Position state update (if you have duration/position info)
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    
    // This would need actual position/duration from your app
    // For now, we'll just set a placeholder
    try {
      // navigator.mediaSession.setPositionState({
      //   duration: 180, // 3 minutes
      //   playbackRate: 1,
      //   position: 0
      // });
    } catch (error) {
      console.log("setPositionState not supported");
    }
  }, [track]);
}