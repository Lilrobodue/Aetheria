// Service Worker Registration and Management

const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '[::1]' ||
  window.location.hostname.match(
    /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/
  )
);

type Config = {
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onOfflineReady?: () => void;
  onNeedRefresh?: () => void;
};

// Precache the exact set of assets this page loaded, so the app works fully
// offline on the next visit. For a no-build app the runtime module graph
// (every imported .tsx/.ts plus the CDN modules) can't be listed by hand, so we
// read it back from the Performance API and hand it to the active service
// worker to cache. Best-effort and safe to call repeatedly.
function precacheLoadedAssets(): void {
  if (!('serviceWorker' in navigator) || typeof performance === 'undefined') return;

  navigator.serviceWorker.ready
    .then((registration) => {
      const target = registration.active || navigator.serviceWorker.controller;
      if (!target) return;

      const sameOrigin = window.location.origin;
      // Cross-origin hosts whose assets are part of the app (not user data).
      const cdnOrigins = [
        'https://aistudiocdn.com',
        'https://cdn.tailwindcss.com',
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com',
      ];
      // Never cache the user's audio — it can be huge and isn't app shell.
      const audioExt = /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus|weba)(\?|$)/i;

      const urls = new Set<string>();
      urls.add(sameOrigin + '/');                    // the offline shell
      urls.add(window.location.href.split('#')[0]);  // the current document

      for (const entry of performance.getEntriesByType('resource')) {
        const name = entry.name;
        if (!name || !/^https?:/i.test(name) || audioExt.test(name)) continue;
        let origin: string;
        try { origin = new URL(name).origin; } catch { continue; }
        if (origin === sameOrigin || cdnOrigins.includes(origin)) {
          urls.add(name);
        }
      }

      target.postMessage({ type: 'CACHE_URLS', urls: Array.from(urls) });
    })
    .catch(() => { /* offline or no active SW — nothing to precache */ });
}

export function register(config?: Config): void {
  if ('serviceWorker' in navigator) {
    const publicUrl = new URL(process.env.PUBLIC_URL || '/', window.location.href);
    if (publicUrl.origin !== window.location.origin) {
      return;
    }

    window.addEventListener('load', () => {
      const swUrl = '/sw.js';

      if (isLocalhost) {
        // This is running on localhost
        checkValidServiceWorker(swUrl, config);
        navigator.serviceWorker.ready.then(() => {
          console.log(
            '[SW] This web app is being served cache-first by a service worker.'
          );
          config?.onOfflineReady?.();
        });
      } else {
        // Is not localhost. Just register service worker
        registerValidSW(swUrl, config);
      }

      // Once the page has fully loaded, hand the SW the complete set of assets
      // this visit pulled in so the NEXT visit works fully offline. Runs again
      // shortly after to catch any resources that finished just after 'load'.
      precacheLoadedAssets();
      setTimeout(precacheLoadedAssets, 4000);
    });
  }
}

function registerValidSW(swUrl: string, config?: Config): void {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      console.log('[SW] Service worker registered successfully:', registration);

      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (installingWorker == null) {
          return;
        }

        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // At this point, the updated precached content has been fetched,
              // but the previous service worker will still serve the older
              // content until all client tabs are closed.
              console.log(
                '[SW] New content is available and will be used when all tabs for this page are closed.'
              );

              // Execute callback
              config?.onUpdate?.(registration);
              config?.onNeedRefresh?.();
            } else {
              // At this point, everything has been precached.
              // It's the perfect time to display a
              // "Content is cached for offline use." message.
              console.log('[SW] Content is cached for offline use.');

              // Execute callback
              config?.onSuccess?.(registration);
              config?.onOfflineReady?.();
            }
          }
        };
      };
    })
    .catch((error) => {
      console.error('[SW] Error during service worker registration:', error);
    });
}

function checkValidServiceWorker(swUrl: string, config?: Config): void {
  // Check if the service worker can be found
  fetch(swUrl, {
    headers: { 'Service-Worker': 'script' },
  })
    .then((response) => {
      // Ensure service worker exists, and that we really are getting a JS file.
      const contentType = response.headers.get('content-type');
      if (
        response.status === 404 ||
        (contentType != null && contentType.indexOf('javascript') === -1)
      ) {
        // No service worker found. Probably a different app. Reload the page.
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => {
            window.location.reload();
          });
        });
      } else {
        // Service worker found. Proceed as normal.
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      console.log('[SW] No internet connection found. App is running in offline mode.');
    });
}

export function unregister(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error(error.message);
      });
  }
}

// Helper function to check if the app is offline
export function isOffline(): boolean {
  return !navigator.onLine;
}

// Helper function to show update available notification
export function showUpdateAvailableNotification(): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Aetheria Update Available', {
      body: 'A new version is available. Reload to update.',
      icon: '/images/icon-192x192.png',
      badge: '/images/icon-192x192.png'
    });
  }
}

// Helper function to request notification permission
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if ('Notification' in window) {
    return await Notification.requestPermission();
  }
  return 'denied';
}

// Network status tracking
export class NetworkStatus {
  private listeners: ((online: boolean) => void)[] = [];

  constructor() {
    window.addEventListener('online', () => this.notifyListeners(true));
    window.addEventListener('offline', () => this.notifyListeners(false));
  }

  private notifyListeners(online: boolean): void {
    this.listeners.forEach(listener => listener(online));
  }

  public addListener(listener: (online: boolean) => void): void {
    this.listeners.push(listener);
  }

  public removeListener(listener: (online: boolean) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  public isOnline(): boolean {
    return navigator.onLine;
  }
}