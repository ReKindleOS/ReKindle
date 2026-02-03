const CACHE_NAME = 'rekindle-cache-v5'; // Bumped version to force update
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './icons.js',
    './theme.js',
    './logo.svg',
    './discord.svg',
    './donate.svg',
    './manifest.json'
];

// Install Event: Cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
    // FORCE UPDATE:
    self.skipWaiting();
});

// Activate Event: Cleanup old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Clients claimed.');
            return self.clients.claim();
        })
    );
});

// Fetch Event: Strategy Router
self.addEventListener('fetch', event => {
    // 0. ABSOLUTE IGNORE: Firestore & Google APIs
    // We must return immediately for these to let the browser handle the XHR/WebSockets natively.
    // Using .href includes is the safest catch-all.
    if (event.request.url.includes('firestore.googleapis.com')) return;
    if (event.request.url.includes('/firestore/')) return;
    if (event.request.url.includes('/google.firestore.v1.Firestore')) return;

    const url = new URL(event.request.url);

    // GUARD: Ignore non-GET requests (POST, DELETE, etc.)
    if (event.request.method !== 'GET') return;

    // GUARD: Ignore Cross-Origin requests, UNLESS they are explicitly whitelisted (Firebase SDKs, Analytics)
    const isWhitelistedOrigin =
        url.hostname.includes('gstatic.com') || // Firebase SDKs
        url.hostname.includes('counter.dev'); // Analytics

    if (!url.origin.includes(self.location.origin) && !isWhitelistedOrigin) return;

    // 1. HTML / Root -> Network First
    if (event.request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname === '/') {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    return caches.match('./index.html') || caches.match('./');
                })
        );
        return;
    }

    // 2. JS/Images/Assets -> Stale-While-Revalidate
    // 2. Local Assets (JS/CSS/SVG) -> Stale-While-Revalidate
    if (ASSETS_TO_CACHE.some(asset => url.pathname.endsWith(asset.replace('./', '')))) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(response => {
                    const fetchPromise = fetch(event.request).then(networkResponse => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                    return response || fetchPromise;
                });
            })
        );
        return;
    }

    // 3. External Whitelisted Scripts (Firebase SDKs etc) -> Stale-While-Revalidate
    // We cache these to speed up load, but check for updates in background.
    if (isWhitelistedOrigin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(response => {
                    const fetchPromise = fetch(event.request).then(networkResponse => {
                        // Check if valid response before caching
                        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(e => {
                        // Network failed? Return nothing (or maybe cache if we had it?)
                        // Handled by response || fetchPromise generally
                        console.log("External fetch failed", e);
                    });
                    return response || fetchPromise;
                });
            })
        );
        return;
    }

    // 3. Default (or other strategies for apps)
    // For now, let everything else go to network (or browser default cache)
});
// Message Event: Handle commands from the main thread
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        console.log('Service Worker: Clearing all caches...');
        event.waitUntil(
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => caches.delete(cacheName))
                );
            }).then(() => {
                console.log('Service Worker: Caches cleared.');
                // Optionally notify the client that clearing is done
                if (event.ports && event.ports[0]) {
                    event.ports[0].postMessage({ type: 'CACHE_CLEARED' });
                }
            })
        );
    }
});
