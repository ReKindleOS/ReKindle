const CACHE_NAME = 'rekindle-kill-switch-v3';

self.addEventListener('install', (event) => {
    // Force this service worker to become the active one immediately
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Take control of all open pages immediately
    event.waitUntil(
        clients.claim().then(() => {
            // Delete ALL caches found
            return caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        console.log('Deleting cache:', cacheName);
                        return caches.delete(cacheName);
                    })
                );
            });
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Do not cache anything. Just pass the request through to the network.
    // This bypasses the redirection error by not using the cache or `Response` constructor.
    event.respondWith(fetch(event.request));
});