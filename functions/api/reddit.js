export async function onRequest(context) {
    const url = new URL(context.request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
        return new Response("Missing url param", { status: 400 });
    }

    // Security: Only allow reddit domains
    let target;
    try {
        target = new URL(targetUrl);
        const allowed = [
            'reddit.com', 'old.reddit.com', 'api.reddit.com', 'www.reddit.com',
            'redd.it', 'i.redd.it', 'preview.redd.it', 'v.redd.it',
            'imgur.com', 'i.imgur.com'
        ];
        const isAllowed = allowed.some(h => target.hostname === h || target.hostname.endsWith('.' + h));
        if (!isAllowed) {
            return new Response("Forbidden: Domain not allowed", { status: 403 });
        }
    } catch (e) {
        return new Response("Invalid URL", { status: 400 });
    }

    if (context.request.method !== "GET" && context.request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
    }

    // Try Cloudflare edge cache first. Keyed only on the target URL so all
    // users share the cached copy of a subreddit feed or image.
    const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
    const cacheKey = cache ? new Request(targetUrl, { method: "GET" }) : null;
    if (cache && cacheKey) {
        try {
            const cached = await cache.match(cacheKey);
            if (cached) {
                return withCors(cached);
            }
        } catch (e) {
            console.error("Cache read failed:", e);
        }
    }

    // Choose TTL by content type. RSS feeds change quickly; images rarely do.
    const feedLike = target.pathname.endsWith('.rss') || target.pathname.startsWith('/r/');
    const imageLike = /\.(jpeg|jpg|png|gif|webp|avif)($|\?)/i.test(target.pathname + target.search);
    const maxAge = imageLike ? 300 : feedLike ? 60 : 30;

    // Reddit aggressively blocks non-browser user agents and cloud IPs.
    // We send a full set of modern Chrome headers to look as browser-like as possible.
    const browserHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.reddit.com/",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Ch-Ua": "\"Google Chrome\";v=\"135\", \"Not-A.Brand\";v=\"8\", \"Chromium\";v=\"135\"",
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": "\"Windows\"",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1"
    };

    // For feeds, prefer old.reddit.com because www.reddit.com aggressively
    // rate-limits shared cloud IPs. Keep the requested URL as a fallback.
    const urlsToTry = [targetUrl];
    if (feedLike && (target.hostname === 'www.reddit.com' || target.hostname === 'reddit.com')) {
        const oldUrl = new URL(targetUrl);
        oldUrl.hostname = 'old.reddit.com';
        urlsToTry.unshift(oldUrl.toString());
    }

    let lastResponse = null;
    let lastError = null;
    const maxAttempts = 3;

    for (const urlToFetch of urlsToTry) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt > 0) {
                const delay = computeRetryDelay(lastResponse, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            try {
                const response = await fetch(urlToFetch, { headers: browserHeaders });
                lastResponse = response;

                if (response.status === 200) {
                    if (cache && cacheKey) {
                        try {
                            // Split the body stream so we can cache one copy and return the other.
                            const [cacheBody, returnBody] = response.body.tee();

                            const cacheHeaders = new Headers(response.headers);
                            cacheHeaders.set("Cache-Control", "public, max-age=" + maxAge);
                            cacheHeaders.delete("Set-Cookie");

                            const cacheResponse = new Response(cacheBody, {
                                status: response.status,
                                statusText: response.statusText,
                                headers: cacheHeaders
                            });

                            const storePromise = cache.put(cacheKey, cacheResponse).catch(function() {});
                            if (typeof context.waitUntil === 'function') {
                                context.waitUntil(storePromise);
                            } else {
                                // In environments without waitUntil, await the store so it isn't dropped.
                                await storePromise;
                            }

                            return new Response(returnBody, {
                                status: response.status,
                                statusText: response.statusText,
                                headers: withCorsHeaders(response.headers)
                            });
                        } catch (cacheErr) {
                            console.error("Cache write failed:", cacheErr);
                        }
                    }

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: withCorsHeaders(response.headers)
                    });
                }

                // Retry on rate limits and server errors.
                if (response.status === 429 || response.status >= 500) {
                    continue;
                }

                // Non-retryable response (403, 404, etc.). Try the next URL if available.
                break;
            } catch (e) {
                // Network-level failure. Retry.
                lastError = e;
            }
        }
    }

    // Return whatever response we ended up with, or a generic error.
    if (lastResponse) {
        return new Response(lastResponse.body, {
            status: lastResponse.status,
            statusText: lastResponse.statusText,
            headers: withCorsHeaders(lastResponse.headers)
        });
    }

    return new Response(lastError ? lastError.message : "Failed to fetch Reddit", { status: 502 });
}

function withCorsHeaders(headers) {
    const h = new Headers(headers);
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    return h;
}

function withCors(response) {
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: withCorsHeaders(response.headers)
    });
}

function computeRetryDelay(response, attempt) {
    if (response && response.headers) {
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds) && seconds > 0) {
                return Math.min(seconds * 1000, 10000);
            }
        }
    }
    return Math.min(1000 * Math.pow(2, attempt), 8000);
}
