const CACHE_NAME = 'aetheria-v1';
const OFFLINE_URL = '/';

// Files to cache for offline support
const STATIC_CACHE_URLS = [
  '/',
  '/index.html',
  '/index.tsx',
  '/App.tsx',
  '/src/index.css',
  '/manifest.json',
  '/images/icon-192x192.png'
];

// External CDN resources to cache
const CDN_CACHE_URLS = [
  'https://cdn.tailwindcss.com',
  'https://aistudiocdn.com/react@^19.2.0',
  'https://aistudiocdn.com/react-dom@^19.2.0/client',
  'https://aistudiocdn.com/lucide-react@^0.554.0'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        
        // Cache static files
        await cache.addAll(STATIC_CACHE_URLS);
        
        // Cache CDN resources with error handling
        for (const url of CDN_CACHE_URLS) {
          try {
            await cache.add(url);
          } catch (error) {
            console.warn(`[SW] Failed to cache ${url}:`, error);
          }
        }
        
        console.log('[SW] All files cached successfully');
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
          return networkResponse;
        } catch (error) {
          // If network fails, serve from cache or offline page
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match('/');
          
          if (cachedResponse) {
            return cachedResponse;
          } else {
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
        }
      })()
    );
    return;
  }

  // Handle other requests (CSS, JS, images, etc.)
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      
      try {
        // Try cache first (cache-first strategy for assets)
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          // Update cache in background for next time
          fetch(request).then(response => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
          }).catch(() => {
            // Ignore network errors in background update
          });
          
          return cachedResponse;
        }

        // If not in cache, try network
        const networkResponse = await fetch(request);
        
        // Cache successful responses
        if (networkResponse.ok) {
          // Don't cache POST requests or non-successful responses
          if (request.method === 'GET') {
            cache.put(request, networkResponse.clone());
          }
        }
        
        return networkResponse;
      } catch (error) {
        // If both cache and network fail, return a fallback for essential files
        if (url.pathname.endsWith('.css')) {
          return new Response('/* Offline - CSS unavailable */', {
            headers: { 'Content-Type': 'text/css' }
          });
        } else if (url.pathname.endsWith('.js')) {
          return new Response('// Offline - JS unavailable', {
            headers: { 'Content-Type': 'text/javascript' }
          });
        }
        
        // For other files, just throw the error
        throw error;
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