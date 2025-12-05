// PWA and Service Worker type definitions

declare global {
  interface Window {
    // Service Worker registration
    swRegistration?: ServiceWorkerRegistration;
    
    // PWA install prompt
    deferredPrompt?: BeforeInstallPromptEvent;
    
    // Network status
    navigator: Navigator & {
      onLine: boolean;
      connection?: {
        effectiveType: '2g' | '3g' | '4g' | 'slow-2g';
        downlink: number;
        rtt: number;
        saveData: boolean;
      };
    };
  }

  interface Navigator {
    // Service Worker support
    serviceWorker: ServiceWorkerContainer;
    
    // Share API
    share?: (data: ShareData) => Promise<void>;
    
    // Media session
    mediaSession?: MediaSession;
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{
      outcome: 'accepted' | 'dismissed';
      platform: string;
    }>;
  }

  interface MediaSession {
    metadata: MediaMetadata | null;
    playbackState: MediaSessionPlaybackState;
    setActionHandler(
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ): void;
  }

  interface MediaMetadata {
    title: string;
    artist?: string;
    album?: string;
    artwork?: MediaImage[];
  }

  interface MediaImage {
    src: string;
    sizes?: string;
    type?: string;
  }

  type MediaSessionPlaybackState = 'none' | 'paused' | 'playing';
  type MediaSessionAction = 
    | 'play' 
    | 'pause' 
    | 'stop' 
    | 'seekbackward' 
    | 'seekforward' 
    | 'seekto' 
    | 'previoustrack' 
    | 'nexttrack';

  type MediaSessionActionHandler = (details: MediaSessionActionDetails) => void;

  interface MediaSessionActionDetails {
    action: MediaSessionAction;
    seekOffset?: number;
    seekTime?: number;
  }
}

export interface PWAConfig {
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onOfflineReady?: () => void;
  onNeedRefresh?: () => void;
}

export interface ShareData {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
}

export interface NotificationOptions {
  body?: string;
  icon?: string;
  badge?: string;
  image?: string;
  data?: any;
  tag?: string;
  silent?: boolean;
  vibrate?: number[];
  timestamp?: number;
  renotify?: boolean;
  requireInteraction?: boolean;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  action: string;
  title: string;
  icon?: string;
}

export interface CacheStrategy {
  name: string;
  pattern: RegExp;
  strategy: 'cacheFirst' | 'networkFirst' | 'staleWhileRevalidate';
  options?: {
    maxEntries?: number;
    maxAgeSeconds?: number;
  };
}

export {};