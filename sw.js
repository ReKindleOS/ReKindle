const CACHE_NAME = 'rekindle-cache-v26'; // Bumped 2026-10-20: force client caches to drop pre-visual-upgrade assets
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './icons.js?v=7',
    './theme.js?v=24',
    './logo.svg',
    './discord.svg',
    './donate.svg',
    './manifest.json',
    './fonts/OpenDyslexic-Regular.woff2',
    './fonts/OpenDyslexic-Bold.woff2'
];

// OpenMoji picker icons (POPULAR_EMOJIS in emojis.js -> EMOJI_SVG_MAP files).
// These are precached at install and served cache-first (filenames are
// codepoint-addressed, so content never changes). REGENERATE this list when
// POPULAR_EMOJIS changes, and bump CACHE_NAME if the openmoji/ art is regenerated.
const EMOJI_ASSETS = [
    './openmoji/1F602.svg',
    './openmoji/1F923.svg',
    './openmoji/1F60A.svg',
    './openmoji/1F60D.svg',
    './openmoji/1F970.svg',
    './openmoji/1F618.svg',
    './openmoji/1F61C.svg',
    './openmoji/1F92A.svg',
    './openmoji/1F60E.svg',
    './openmoji/1F973.svg',
    './openmoji/1F929.svg',
    './openmoji/1F605.svg',
    './openmoji/1F601.svg',
    './openmoji/1F604.svg',
    './openmoji/1F642.svg',
    './openmoji/1F609.svg',
    './openmoji/1F607.svg',
    './openmoji/1F917.svg',
    './openmoji/1F914.svg',
    './openmoji/1F928.svg',
    './openmoji/1F644.svg',
    './openmoji/1F92B.svg',
    './openmoji/1F92D.svg',
    './openmoji/1F62E.svg',
    './openmoji/1F632.svg',
    './openmoji/1F633.svg',
    './openmoji/1F97A.svg',
    './openmoji/1F622.svg',
    './openmoji/1F62D.svg',
    './openmoji/1F631.svg',
    './openmoji/1F92F.svg',
    './openmoji/1F634.svg',
    './openmoji/1F60B.svg',
    './openmoji/2764.svg',
    './openmoji/1F494.svg',
    './openmoji/1F495.svg',
    './openmoji/1F496.svg',
    './openmoji/1F498.svg',
    './openmoji/1F44D.svg',
    './openmoji/1F44E.svg',
    './openmoji/1F44F.svg',
    './openmoji/1F64C.svg',
    './openmoji/1F64F.svg',
    './openmoji/1F4AA.svg',
    './openmoji/1F91D.svg',
    './openmoji/270C.svg',
    './openmoji/1F91E.svg',
    './openmoji/1F44C.svg',
    './openmoji/1F91F.svg',
    './openmoji/1F44B.svg',
    './openmoji/270B.svg',
    './openmoji/1F44A.svg',
    './openmoji/1F63A.svg',
    './openmoji/1F638.svg',
    './openmoji/1F639.svg',
    './openmoji/1F63B.svg',
    './openmoji/1F648.svg',
    './openmoji/1F649.svg',
    './openmoji/1F64A.svg',
    './openmoji/1F47B.svg',
    './openmoji/1F916.svg',
    './openmoji/1F383.svg',
    './openmoji/2728.svg',
    './openmoji/1F525.svg',
    './openmoji/1F4AF.svg',
    './openmoji/2B50.svg',
    './openmoji/1F31F.svg',
    './openmoji/26A1.svg',
    './openmoji/1F308.svg',
    './openmoji/2600.svg',
    './openmoji/1F319.svg',
    './openmoji/2744.svg',
    './openmoji/26C4.svg',
    './openmoji/1F340.svg',
    './openmoji/1F338.svg',
    './openmoji/1F33B.svg',
    './openmoji/1F33C.svg',
    './openmoji/1F355.svg',
    './openmoji/1F354.svg',
    './openmoji/1F35F.svg',
    './openmoji/1F32E.svg',
    './openmoji/1F37F.svg',
    './openmoji/1F369.svg',
    './openmoji/1F36A.svg',
    './openmoji/1F382.svg',
    './openmoji/1F370.svg',
    './openmoji/1F36B.svg',
    './openmoji/1F36C.svg',
    './openmoji/2615.svg',
    './openmoji/1F375.svg',
    './openmoji/1F381.svg',
    './openmoji/1F388.svg',
    './openmoji/1F389.svg',
    './openmoji/1F38A.svg',
    './openmoji/1F384.svg',
    './openmoji/1F3C6.svg',
    './openmoji/1F947.svg',
    './openmoji/26BD.svg',
    './openmoji/1F3C0.svg',
    './openmoji/1F3C8.svg',
    './openmoji/26BE.svg',
    './openmoji/1F3BE.svg',
    './openmoji/1F3AE.svg',
    './openmoji/1F3AF.svg',
    './openmoji/1F3B2.svg',
    './openmoji/1F3B5.svg',
    './openmoji/1F3B6.svg',
    './openmoji/1F3A7.svg',
    './openmoji/1F3B8.svg',
    './openmoji/1F4DA.svg',
    './openmoji/1F4D6.svg',
    './openmoji/1F4A1.svg',
    './openmoji/1F680.svg',
    './openmoji/1F9F8.svg',
    './openmoji/1F3A8.svg'
];

// Install Event: Cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(ASSETS_TO_CACHE).then(() => {
                    // Best-effort emoji precache: never fail install over a single flaky icon
                    return Promise.all(EMOJI_ASSETS.map(asset => cache.add(asset).catch(() => { })));
                });
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
    if (event.request.url && (new URL(event.request.url).hostname === 'firestore.googleapis.com' || new URL(event.request.url).hostname.endsWith('.firestore.googleapis.com'))) return;
    if (event.request.url.includes('/firestore/')) return;
    if (event.request.url.includes('/google.firestore.v1.Firestore')) return;

    const url = new URL(event.request.url);

    // GUARD: Ignore non-GET requests (POST, DELETE, etc.)
    if (event.request.method !== 'GET') return;

    // GUARD: Ignore Cross-Origin requests, UNLESS they are explicitly whitelisted (Firebase SDKs, Analytics)
    const isWhitelistedOrigin =
        (url.hostname === 'gstatic.com' || url.hostname.endsWith('.gstatic.com')) || // Firebase SDKs
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

    // 1b. OpenMoji icons -> Cache First (codepoint-addressed filenames are immutable).
    // Picker icons arrive via precache; any other emoji seen in messages is
    // runtime-cached on first view and never re-downloaded.
    if (url.pathname.indexOf('/openmoji/') === 0) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(response => {
                    if (response) return response;
                    return fetch(event.request).then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    });
                });
            })
        );
        return;
    }

    // 2. JS/Images/Assets -> Stale-While-Revalidate
    // 2. Local Assets (JS/CSS/SVG) -> Stale-While-Revalidate
    if (ASSETS_TO_CACHE.some(asset => {
        const path = asset.split('?')[0].replace(/^\.\//, '');
        return path && url.pathname.endsWith('/' + path);
    })) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(response => {
                    const fetchPromise = fetch(event.request).then(networkResponse => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    }).catch(() => {
                        return response || new Response('Offline', { status: 503 });
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
