const CACHE_NAME = 'aetheria-v11.5-offline';
const OFFLINE_URL = '/';

// Files to cache for offline support
const STATIC_CACHE_URLS = [
  '/',
  '/index.html',
  '/index.tsx',
  '/App.tsx',
  '/src/index.css',
  '/manifest.json',
  '/images/icon-192x192.png',
  '/images/icon-512x512.png'
];

// External CDN resources to cache
const CDN_CACHE_URLS = [
  'https://cdn.tailwindcss.com',
  'https://aistudiocdn.com/react@^19.2.0',
  'https://aistudiocdn.com/react-dom@^19.2.0/client',
  'https://aistudiocdn.com/lucide-react@^0.554.0'
];

// Cache a single URL, choosing the correct fetch mode by origin.
//
// Same-origin assets and the ES-module CDN (aistudiocdn) MUST use a normal CORS
// fetch so the cached response can satisfy module imports. Other cross-origin
// assets — notably cdn.tailwindcss.com, which is loaded as a classic <script>
// and sends no Access-Control-Allow-Origin header — are blocked by a default
// (cors) fetch ("No 'Access-Control-Allow-Origin' header is present"). We fetch
// those with mode:'no-cors', yielding an opaque response that caches fine and
// replays for the classic no-cors request. Returns true if something was cached.
async function cacheUrl(cache, rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, self.location.origin);
  } catch {
    return false;
  }
  const needsCors =
    parsed.origin === self.location.origin ||
    parsed.origin === 'https://aistudiocdn.com';
  try {
    const request = needsCors
      ? new Request(rawUrl)
      : new Request(rawUrl, { mode: 'no-cors' });
    const response = await fetch(request);
    // CORS / same-origin responses must be ok; opaque (no-cors) responses
    // report ok=false but are still valid to cache and replay.
    if (response.ok || response.type === 'opaque') {
      await cache.put(rawUrl, response);
      return true;
    }
  } catch (err) {
    // Unreachable or blocked — caller decides whether to log.
  }
  return false;
}

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);

        // Cache each URL individually. We deliberately do NOT use
        // cache.addAll(): it is atomic, so a single 404 (e.g. a path that
        // doesn't exist at this deploy's web root) rejects the whole install
        // with "Failed to fetch" and leaves the cache empty. Per-URL
        // try/catch lets the install succeed with whatever is reachable and
        // just logs the rest.
        for (const url of [...STATIC_CACHE_URLS, ...CDN_CACHE_URLS]) {
          const cached = await cacheUrl(cache, url);
          if (!cached) console.warn(`[SW] Skipped caching ${url}`);
        }

        console.log('[SW] Install caching complete');
      } catch (error) {
        console.error('[SW] Cache installation failed:', error);
      }
    })()
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  event.waitUntil(
    (async () => {
      // Delete old caches
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
      
      // Take control of all clients
      await self.clients.claim();
      console.log('[SW] Service worker activated');
    })()
  );
});

// Graceful last-resort response when BOTH network and cache miss. Returns a
// content-type-correct stub for CSS/JS modules so the page degrades instead of
// hard-erroring, otherwise a 503. Never throws, so respondWith() can't reject.
function offlineFallback(url, request, error) {
  if (url.pathname.endsWith('.css')) {
    return new Response('/* Offline - CSS unavailable */', {
      headers: { 'Content-Type': 'text/css' }
    });
  }
  if (/\.(m?js|tsx?|jsx)$/i.test(url.pathname)) {
    return new Response('// Offline - module unavailable', {
      headers: { 'Content-Type': 'text/javascript' }
    });
  }
  console.warn('[SW] No cache and network failed for:', request.url, error);
  return new Response('Service temporarily unavailable', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' }
  });
}

// Fetch event - serve cached content when offline
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Handle navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Try to fetch from network first
          const networkResponse = await fetch(request);
          // Keep the offline shell fresh: stash the latest index.html under
          // '/' so an offline navigation always gets the current shell.
          if (networkResponse && networkResponse.ok) {
            const shellCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then(c => c.put('/', shellCopy)).catch(() => {});
          }
          return networkResponse;
        } catch (error) {
          // Network failed — serve the cached shell, falling back to a
          // built-in offline page. Every branch here is guarded so the
          // promise passed to respondWith() can NEVER reject: an unguarded
          // throw is what shows up as "FetchEvent ... resulted in a network
          // error response: the promise was rejected."
          try {
            const cache = await caches.open(CACHE_NAME);
            const cachedResponse = await cache.match('/');
            if (cachedResponse) {
              return cachedResponse;
            }
          } catch (cacheError) {
            console.warn('[SW] Cache lookup failed during navigation fallback:', cacheError);
          }
          // Return a basic offline page if nothing is cached
          return new Response(`
              <!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Aetheria - Offline</title>
                <style>
                  body {
                    background: #020617;
                    color: #fbbf24;
                    font-family: sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    margin: 0;
                    text-align: center;
                  }
                </style>
              </head>
              <body>
                <div>
                  <h1>Aetheria</h1>
                  <p>You're offline. Please check your connection and try again.</p>
                  <button onclick="window.location.reload()">Retry</button>
                </div>
              </body>
              </html>
            `, {
              headers: { 'Content-Type': 'text/html' }
            });
        }
      })()
    );
    return;
  }

  // Same-origin app source (HTML / TS / JS / CSS) changes on every deploy, so
  // serve it NETWORK-FIRST: always try the network and only fall back to cache
  // when offline. This is what makes a fresh deploy show up on the first reload
  // instead of the second. Version-pinned CDN libraries (react, lucide,
  // tailwind) and static media (images, manifest, fonts) stay CACHE-FIRST for
  // speed — they don't change between deploys.
  const isSameOrigin = url.origin === self.location.origin;
  const isAppSource = isSameOrigin && /\.(html|tsx?|jsx?|mjs|css)$/i.test(url.pathname);

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // --- NETWORK-FIRST: app source ---
      if (isAppSource) {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            // Keep the cached copy fresh as an offline fallback.
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (error) {
          const cachedResponse = await cache.match(request);
          if (cachedResponse) return cachedResponse;
          return offlineFallback(url, request, error);
        }
      }

      // --- CACHE-FIRST: CDN libraries, images, manifest, fonts, etc. ---
      try {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          // Revalidate in the background for next time (best-effort).
          fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
          }).catch(() => {
            // Ignore network errors in background update
          });
          return cachedResponse;
        }

        // Not cached yet — fetch and cache the successful response.
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        // Both cache and network failed — return a graceful response rather
        // than throwing (a throw rejects respondWith() and logs as
        // "Uncaught (in promise) Failed to fetch").
        return offlineFallback(url, request, error);
      }
    })()
  );
});

// Handle background sync (if needed)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync event:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Handle background synchronization tasks here
      console.log('[SW] Performing background sync')
    );
  }
});

// Handle push notifications (for future use)
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received');
  
  const options = {
    body: event.data ? event.data.text() : 'New notification from Aetheria',
    icon: '/images/icon-192x192.png',
    badge: '/images/icon-192x192.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    },
    actions: [
      {
        action: 'explore',
        title: 'Open Aetheria',
        icon: '/images/icon-192x192.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/images/icon-192x192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Aetheria', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click received.');

  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  } else if (event.action === 'close') {
    // Just close the notification
    return;
  } else {
    // Default action - open app
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Message handling for background audio control
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  // Handle background audio state
  if (event.data && event.data.type === 'AUDIO_STATE') {
    // Store audio state for recovery
    self.audioState = event.data.state;
  }

  // Offline precache: the page sends the full list of resource URLs it
  // actually loaded (the whole module graph + CDN deps, gathered from the
  // Performance API). We fetch and cache any not already stored. This is what
  // makes the app TRULY work offline for a no-build app — we can't enumerate
  // every .tsx/.ts module by hand, so we let a successful online visit tell us
  // exactly what to keep. Best-effort and idempotent (skips already-cached).
  if (event.data && event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      let added = 0;
      await Promise.all(event.data.urls.map(async (rawUrl) => {
        const existing = await cache.match(rawUrl);
        if (existing) return;
        // cacheUrl picks cors vs no-cors by origin, so cross-origin classic
        // scripts (e.g. Tailwind) cache as opaque instead of CORS-failing.
        if (await cacheUrl(cache, rawUrl)) added++;
      }));
      const total = event.data.urls.length;
      console.log(`[SW] Offline precache: cached ${added} new of ${total} requested`);

      // Tell the page caching is done so it can confirm offline-readiness.
      // `added` lets the UI show the toast only when something new was cached
      // (first visit / after a deploy), not on every steady-state load.
      const readyMsg = { type: 'OFFLINE_READY', added, total };
      const source = event.source;
      if (source) {
        source.postMessage(readyMsg);
      } else {
        const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
        clientsList.forEach((client) => client.postMessage(readyMsg));
      }
    })());
  }
});

// Periodic background sync for keeping audio alive
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'keep-audio-alive') {
    event.waitUntil(
      // Send message to all clients to keep audio context alive
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'KEEP_ALIVE' });
        });
      })
    );
  }
});