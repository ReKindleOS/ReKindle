/**
 * Reddit relay for rekindle.ink (`reddit.html`)
 *
 * Why this exists (2026-11-25)
 * ----------------------------
 * Reddit switched off anonymous access in November 2026:
 *   - subreddit/thread RSS (`.rss`) returns 404 (RSS ended 2026-11-13);
 *   - anonymous `.json` (www, old, api) returns 403 "You've been blocked by
 *     network security. To continue, log in to your Reddit account or use your
 *     developer token".
 * Every unauthenticated read has to authenticate with a registered OAuth
 * client, and the client secret can never live in a browser bundle. This
 * function is the server-side holder of the app-only ("client_credentials")
 * token and the only thing the page talks to.
 *
 * Contract
 * --------
 *   GET /?path=/r/kindle/hot&limit=25&after=t3_abc123&raw_json=1
 *   Authorization: Bearer <Firebase ID token>   (required)
 *
 *   - `path` is a Reddit *path* only: /r/<sub>[/<sort>],
 *     /r/<sub>/comments/<id>[/<slug>], /comments/<id>. No host, no scheme, no
 *     query string -> no SSRF surface and no way to point this at another API.
 *   - `after`, `limit`, `t` and `sort` are validated against fixed lists; every
 *     other query parameter is dropped. `raw_json=1` is always forced.
 *   - Responses are trimmed to the fields reddit.html renders (title, author,
 *     subreddit, permalink, name; selftext_html/body_html for threads) so the
 *     relay never becomes a general Reddit content mirror.
 *
 * Auth, quotas and caching
 * ------------------------
 *   - A Firebase ID token is required so the endpoint cannot be used as an
 *     open proxy from the project's GCP egress.
 *   - Reddit's free tier is 100 QPM per OAuth client id, shared by *every*
 *     ReKindle user, so listings are cached in-process for 5 minutes and
 *     threads for 10. A per-uid token bucket (30 burst, 12/min) protects the
 *     shared budget from one device.
 *   - `REDDIT_ACCESS=pro` makes the endpoint ReKindle+ only. It is OFF by
 *     default because Reddit's free Data API tier is non-commercial only and
 *     Reddit counts paywalled/upsell-gated features as commercial use. Keep
 *     this app free unless a commercial agreement is in place.
 *
 * Environment (firebase-functions/.env, never the repo):
 *   REDDIT_CLIENT_ID       OAuth app client id (reddit.com/prefs/apps)
 *   REDDIT_CLIENT_SECRET   OAuth app secret. Omit it for an existing
 *                          "installed app" (no secret): the relay then uses the
 *                          installed_client grant with DO_NOT_TRACK_THIS_DEVICE.
 *   REDDIT_USER_AGENT      "<platform>:<app id>:<version> (by /u/<user>)" -- set it;
 *                          Reddit throttles generic/missing User-Agents.
 *
 * Missing credentials return 503 `not_configured`; the page shows an honest
 * "temporarily unavailable" panel instead of the old "all proxies blocked".
 */

const admin = require("firebase-admin");

const ALLOWED_ORIGINS = [
    "https://rekindle.ink",
    "https://beta.rekindle.ink",
    "https://lite.rekindle.ink",
    "https://legacy.rekindle.ink",
    "https://rekindle.pages.dev",
    "http://localhost:8788",
    "http://localhost:3000",
    "http://localhost:8000"
];

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
const DEFAULT_USER_AGENT = "web:ink.rekindle.reddit:v1.0 (by /u/rekindle)";
const UPSTREAM_TIMEOUT_MS = 12000;

const COMMENT_SORTS = ["confidence", "top", "new", "controversial", "old", "random", "qa", "live"];
const TOP_WINDOWS = ["hour", "day", "week", "month", "year", "all"];

// Cache TTLs keep the shared 100 QPM budget usable: a listing is refreshed at
// most every 5 minutes, a thread every 10.
const LISTING_TTL_MS = 5 * 60 * 1000;
const THREAD_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

// Per-uid bucket: 30 burst, 1 token every 5 s (12/min). A normal session loads
// one listing plus the threads the user opens, well inside this.
const RATE_CAPACITY = 30;
const RATE_REFILL_PER_SEC = 0.2;
const buckets = new Map();

// Per-instance guard for the shared client id. Reddit averages over 10 minutes,
// so this is deliberately conservative; in-process cache absorbs most reads.
const GLOBAL_PER_MINUTE = 80;
let minuteWindowStart = 0;
let minuteCount = 0;
let cooldownUntil = 0;

const cache = new Map();
let tokenCache = { value: "", expiresAt: 0 };
let tokenInflight = null;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function redditConfigured() {
    // The secret is optional: an "installed app" has none and uses the
    // installed_client grant instead of client_credentials.
    return !!String(process.env.REDDIT_CLIENT_ID || "").trim();
}

/**
 * Build the access-token request. Confidential apps (web/script) use
 * client_credentials with the secret as the Basic-auth password; an installed
 * app has no secret, so it sends an empty password and the
 * installed_client grant with a per-app device id.
 */
function buildTokenRequest(clientId, clientSecret) {
    const id = String(clientId || "").trim();
    const secret = String(clientSecret || "").trim();
    const authorization = "Basic " + Buffer.from(id + ":" + secret).toString("base64");
    if (secret) {
        return { authorization: authorization, body: "grant_type=client_credentials" };
    }
    return {
        authorization: authorization,
        body: "grant_type=" + encodeURIComponent("https://oauth.reddit.com/grants/installed_client") +
            "&device_id=DO_NOT_TRACK_THIS_DEVICE"
    };
}

function userAgent() {
    const custom = String(process.env.REDDIT_USER_AGENT || "").trim();
    return custom || DEFAULT_USER_AGENT;
}

function proOnly() {
    return String(process.env.REDDIT_ACCESS || "").trim().toLowerCase() === "pro";
}

// ---------------------------------------------------------------------------
// Validation / URL building (exported for scripts/test-reddit.js)
// ---------------------------------------------------------------------------
function normalizeSubreddit(raw) {
    const value = String(raw == null ? "" : raw).trim();
    if (!value || value.length > 221) return null;
    const parts = value.split("+");
    if (parts.length < 1 || parts.length > 10) return null;
    for (let i = 0; i < parts.length; i++) {
        if (!/^[A-Za-z0-9_]{2,21}$/.test(parts[i])) return null;
    }
    return parts.join("+");
}

function buildTarget(upstreamPath, rawQuery, kind) {
    const query = rawQuery && typeof rawQuery === "object" ? rawQuery : {};
    const params = new URLSearchParams();

    const rawLimit = parseInt(query.limit, 10);
    const limit = isNaN(rawLimit) ? 25 : Math.min(100, Math.max(1, rawLimit));
    params.set("limit", String(limit));

    const after = String(query.after == null ? "" : query.after);
    if (after) {
        if (!/^t[0-9]_[a-z0-9]{1,20}$/i.test(after)) return null;
        params.set("after", after);
    }

    const window = String(query.t == null ? "" : query.t);
    if (window) {
        if (TOP_WINDOWS.indexOf(window) === -1) return null;
        params.set("t", window);
    }

    const sort = String(query.sort == null ? "" : query.sort);
    if (sort) {
        if (COMMENT_SORTS.indexOf(sort) === -1) return null;
        params.set("sort", sort);
    }

    // raw_json=1 stops Reddit HTML-escaping <, > and & in JSON strings. The page
    // still passes selftext_html/body_html through DOMParser (safe-html), so
    // this is a readability fix, not a trust boundary.
    params.set("raw_json", "1");

    let url;
    try {
        url = new URL(API_BASE + upstreamPath);
    } catch (e) {
        return null;
    }
    if (url.protocol !== "https:" || url.hostname !== "oauth.reddit.com") return null;
    url.search = params.toString();
    return { url: url, kind: kind, key: url.toString() };
}

/**
 * Turn the untrusted `path` query parameter into an oauth.reddit.com URL.
 * Returns null for anything that is not one of the shapes the app uses.
 */
function parseRedditPath(rawPath, rawQuery) {
    const path = String(rawPath == null ? "" : rawPath).trim();
    if (!path || path.length > 300) return null;
    if (path.charAt(0) !== "/") return null;
    if (path.indexOf("\\") !== -1 || path.indexOf("//") !== -1) return null;
    if (/[\s?#]/.test(path)) return null;
    if (/%2e|%2f|%5c|\.\./i.test(path)) return null;

    let match = path.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]{4,10})(?:\/([A-Za-z0-9_%.-]{1,100}))?\/?$/i);
    if (match) {
        const sub = normalizeSubreddit(match[1]);
        if (!sub) return null;
        const id = match[2].toLowerCase();
        let upstream = "/r/" + sub + "/comments/" + id;
        if (match[3]) upstream += "/" + match[3];
        return buildTarget(upstream, rawQuery, "thread");
    }

    match = path.match(/^\/comments\/([a-z0-9]{4,10})(?:\/([A-Za-z0-9_%.-]{1,100}))?\/?$/i);
    if (match) {
        const id = match[1].toLowerCase();
        let upstream = "/comments/" + id;
        if (match[2]) upstream += "/" + match[2];
        return buildTarget(upstream, rawQuery, "thread");
    }

    match = path.match(/^\/r\/([^/]+)(?:\/(hot|new|top|rising|controversial|best))?\/?$/i);
    if (match) {
        const sub = normalizeSubreddit(match[1]);
        if (!sub) return null;
        const sort = match[2] ? match[2].toLowerCase() : "";
        const upstream = "/r/" + sub + (sort ? "/" + sort : "");
        return buildTarget(upstream, rawQuery, "listing");
    }

    return null;
}

// ---------------------------------------------------------------------------
// Response trimming
// ---------------------------------------------------------------------------
function trimListing(payload) {
    const empty = { data: { children: [], after: null } };
    if (!payload || !payload.data || !Array.isArray(payload.data.children)) return empty;

    const children = [];
    for (let i = 0; i < payload.data.children.length; i++) {
        const child = payload.data.children[i];
        if (!child || child.kind !== "t3" || !child.data) continue;
        const post = child.data;
        children.push({
            kind: "t3",
            data: {
                title: post.title || "",
                author: post.author || "",
                subreddit: post.subreddit || "",
                permalink: post.permalink || "",
                name: post.name || "",
                created_utc: post.created_utc || 0,
                score: typeof post.score === "number" ? post.score : 0,
                num_comments: typeof post.num_comments === "number" ? post.num_comments : 0,
                over_18: post.over_18 === true,
                stickied: post.stickied === true
            }
        });
    }

    return {
        data: {
            children: children,
            after: payload.data.after || null,
            before: payload.data.before || null
        }
    };
}

function trimThread(payload) {
    const result = [
        { data: { children: [] } },
        { data: { children: [] } }
    ];
    if (!Array.isArray(payload)) return result;

    const postListing = payload[0];
    if (postListing && postListing.data && Array.isArray(postListing.data.children)) {
        const post = postListing.data.children[0];
        if (post && post.data) {
            result[0].data.children.push({
                kind: "t3",
                data: {
                    title: post.data.title || "",
                    author: post.data.author || "",
                    selftext_html: post.data.selftext_html || "",
                    permalink: post.data.permalink || "",
                    url: post.data.url || "",
                    is_self: post.data.is_self === true
                }
            });
        }
    }

    const commentListing = payload[1];
    if (commentListing && commentListing.data && Array.isArray(commentListing.data.children)) {
        for (let i = 0; i < commentListing.data.children.length; i++) {
            const child = commentListing.data.children[i];
            if (!child || child.kind !== "t1" || !child.data) continue;
            if (!child.data.body_html && !child.data.body) continue;
            result[1].data.children.push({
                kind: "t1",
                data: {
                    author: child.data.author || "[deleted]",
                    body_html: child.data.body_html || "",
                    permalink: child.data.permalink || "",
                    score: typeof child.data.score === "number" ? child.data.score : 0
                }
            });
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function applyCors(req, res) {
    const origin = req.headers && req.headers.origin;
    if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
        res.set("Access-Control-Allow-Origin", origin);
    } else {
        res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
    }
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Max-Age", "86400");
}

function sendJson(res, status, payload, cacheControl) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", cacheControl || "private, max-age=60");
    res.status(status).json(payload);
}

function sendError(res, status, code, message, retryAfter) {
    if (retryAfter) res.set("Retry-After", String(retryAfter));
    sendJson(res, status, { error: code, message: message }, "no-store");
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function verifyUser(req) {
    const header = (req.headers && req.headers.authorization) || "";
    if (header.indexOf("Bearer ") !== 0) return null;
    const token = header.slice(7).trim();
    if (!token) return null;
    try {
        return await admin.auth().verifyIdToken(token);
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
function allowUid(uid) {
    const now = Date.now();
    let bucket = buckets.get(uid);
    if (!bucket) {
        bucket = { tokens: RATE_CAPACITY, last: now };
        buckets.set(uid, bucket);
        if (buckets.size > 5000) buckets.clear();
    }
    const elapsed = (now - bucket.last) / 1000;
    bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + elapsed * RATE_REFILL_PER_SEC);
    bucket.last = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
}

function allowGlobal() {
    const now = Date.now();
    if (now - minuteWindowStart >= 60000) {
        minuteWindowStart = now;
        minuteCount = 0;
    }
    if (minuteCount >= GLOBAL_PER_MINUTE) return false;
    minuteCount += 1;
    return true;
}

function inCooldown() {
    return cooldownUntil > Date.now();
}

// ---------------------------------------------------------------------------
// Pro check (only used when REDDIT_ACCESS=pro)
// ---------------------------------------------------------------------------
async function isUserPro(uid, email, token) {
    if (token && token.pro === true) return true;
    if (email === "ukiyo@rekindle.ink") return true;

    const db = admin.firestore();
    try {
        const userDoc = await db.collection("users").doc(uid).get();
        if (userDoc.exists) {
            const data = userDoc.data() || {};
            if (data.proExpiresAt) {
                const expires = data.proExpiresAt.toMillis
                    ? data.proExpiresAt.toMillis()
                    : new Date(data.proExpiresAt).getTime();
                if (expires > Date.now()) return true;
            }
        }
    } catch (e) {
        console.warn("reddit: pro user lookup failed:", e && e.message ? e.message : e);
    }

    if (email) {
        try {
            const supporters = await db.collection("config").doc("supporters").get();
            if (supporters.exists) {
                const data = supporters.data() || {};
                const entry = data[email];
                if (entry && entry.expiresAt) {
                    const expires = entry.expiresAt.toMillis
                        ? entry.expiresAt.toMillis()
                        : new Date(entry.expiresAt).getTime();
                    if (expires > Date.now()) return true;
                }
            }
        } catch (e) {
            console.warn("reddit: pro supporter lookup failed:", e && e.message ? e.message : e);
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// OAuth app-only token
// ---------------------------------------------------------------------------
async function fetchToken() {
    if (!redditConfigured()) {
        const err = new Error("not_configured");
        err.code = "not_configured";
        throw err;
    }

    const tokenRequest = buildTokenRequest(
        process.env.REDDIT_CLIENT_ID,
        process.env.REDDIT_CLIENT_SECRET
    );

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 10000);
    let res;
    try {
        res = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
                "Authorization": tokenRequest.authorization,
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": userAgent()
            },
            body: tokenRequest.body,
            signal: controller.signal
        });
    } catch (e) {
        const err = new Error("token_failed");
        err.code = "token_failed";
        throw err;
    } finally {
        clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) {
        let code = "token_failed";
        if (res.status === 401 || res.status === 403) code = "bad_credentials";
        const err = new Error(code);
        err.code = code;
        err.status = res.status;
        err.detail = String(text || "").slice(0, 200);
        throw err;
    }

    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        const err = new Error("token_failed");
        err.code = "token_failed";
        throw err;
    }
    if (!json || !json.access_token) {
        const err = new Error("token_failed");
        err.code = "token_failed";
        throw err;
    }

    const ttl = Math.max(60, Number(json.expires_in) || 3600);
    tokenCache = {
        value: json.access_token,
        // Refresh a minute early so a request never races expiry.
        expiresAt: Date.now() + Math.max(30, ttl - 60) * 1000
    };
    return tokenCache.value;
}

function getToken(force) {
    if (!force && tokenCache.value && Date.now() < tokenCache.expiresAt) {
        return Promise.resolve(tokenCache.value);
    }
    if (tokenInflight) return tokenInflight;
    tokenInflight = fetchToken().then(
        function (value) {
            tokenInflight = null;
            return value;
        },
        function (err) {
            tokenInflight = null;
            throw err;
        }
    );
    return tokenInflight;
}

// ---------------------------------------------------------------------------
// Upstream fetch
// ---------------------------------------------------------------------------
async function fetchReddit(target, token) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, UPSTREAM_TIMEOUT_MS);
    try {
        return await fetch(target.url.toString(), {
            method: "GET",
            redirect: "follow",
            headers: {
                "Authorization": "Bearer " + token,
                "User-Agent": userAgent(),
                "Accept": "application/json"
            },
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

function noteRateHeaders(res) {
    if (!res || !res.headers) return;
    const remaining = parseInt(res.headers.get("x-ratelimit-remaining") || "", 10);
    const reset = parseInt(res.headers.get("x-ratelimit-reset") || "", 10);
    if (!isNaN(remaining) && remaining <= 0 && !isNaN(reset) && reset > 0) {
        cooldownUntil = Date.now() + Math.min(reset, 600) * 1000;
    }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    // LRU touch.
    cache.delete(key);
    cache.set(key, entry);
    return entry;
}

function cacheSet(key, value, ttlMs) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { value: value, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
async function redditHandler(req, res) {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
        sendError(res, 405, "method_not_allowed", "Use GET or HEAD");
        return;
    }

    if (!redditConfigured()) {
        sendError(res, 503, "not_configured",
            "Reddit API credentials are not configured on the server.");
        return;
    }

    const user = await verifyUser(req);
    if (!user || !user.uid) {
        sendError(res, 401, "unauthorized", "Sign in to ReKindle first");
        return;
    }

    if (proOnly()) {
        let pro = false;
        try {
            pro = await isUserPro(user.uid, user.email, user);
        } catch (e) {
            console.warn("reddit: pro check failed:", e && e.message ? e.message : e);
        }
        if (!pro) {
            sendError(res, 403, "pro_required", "Reddit is a ReKindle+ feature.");
            return;
        }
    }

    if (!allowUid(user.uid)) {
        sendError(res, 429, "rate_limited", "Too many requests, slow down", 30);
        return;
    }

    const target = parseRedditPath(req.query && req.query.path, req.query || {});
    if (!target) {
        sendError(res, 403, "target_not_allowed",
            "Only Reddit listing and thread paths are allowed");
        return;
    }

    const cached = cacheGet(target.key);
    if (cached) {
        res.set("X-Rekindle-Cache", "hit");
        if (req.method === "HEAD") {
            res.status(200).send("");
            return;
        }
        sendJson(res, 200, cached.value, "private, max-age=120");
        return;
    }

    if (inCooldown()) {
        sendError(res, 429, "rate_limited",
            "Reddit is rate limiting ReKindle. Try again shortly.", 30);
        return;
    }
    if (!allowGlobal()) {
        sendError(res, 429, "rate_limited", "ReKindle's Reddit budget is busy. Try again shortly.", 20);
        return;
    }

    let lastStatus = 0;
    let lastBody = null;

    for (let attempt = 0; attempt < 2; attempt++) {
        let token;
        try {
            token = await getToken(attempt > 0 && lastStatus === 401);
        } catch (e) {
            if (e && e.code === "bad_credentials") {
                sendError(res, 503, "not_configured",
                    "Reddit rejected the server credentials.");
            } else if (e && e.code === "not_configured") {
                sendError(res, 503, "not_configured",
                    "Reddit API credentials are not configured on the server.");
            } else {
                sendError(res, 502, "upstream_error", "Could not obtain a Reddit token.");
            }
            return;
        }

        let upstream;
        try {
            upstream = await fetchReddit(target, token);
        } catch (e) {
            lastStatus = 0;
            if (attempt === 0) {
                await sleep(600);
                continue;
            }
            sendError(res, 502, "upstream_error", "Reddit did not respond.");
            return;
        }

        noteRateHeaders(upstream);
        lastStatus = upstream.status;

        if (upstream.status === 401 && attempt === 0) {
            // Token revoked/expired early: force a fresh one and retry once.
            tokenCache = { value: "", expiresAt: 0 };
            try { await upstream.arrayBuffer(); } catch (e) { /* drain */ }
            continue;
        }
        if ((upstream.status === 429 || upstream.status >= 500) && attempt === 0) {
            try { await upstream.arrayBuffer(); } catch (e) { /* drain */ }
            await sleep(800);
            continue;
        }

        if (upstream.ok) {
            let payload;
            try {
                const text = await upstream.text();
                payload = JSON.parse(text);
            } catch (e) {
                sendError(res, 502, "upstream_error", "Reddit returned an unreadable response.");
                return;
            }

            const trimmed = target.kind === "thread" ? trimThread(payload) : trimListing(payload);
            const ttl = target.kind === "thread" ? THREAD_TTL_MS : LISTING_TTL_MS;
            cacheSet(target.key, trimmed, ttl);

            if (req.method === "HEAD") {
                res.status(200).send("");
                return;
            }
            res.set("X-Rekindle-Cache", "miss");
            sendJson(res, 200, trimmed, "private, max-age=120");
            return;
        }

        // Keep a short error body for the client/logs, then map the status.
        try {
            lastBody = await upstream.text();
        } catch (e) {
            lastBody = "";
        }

        if (upstream.status === 403) {
            // Reddit returns 403 for private/banned/quarantined communities.
            sendError(res, 403, "reddit_forbidden",
                "Reddit refused access to that community.");
            return;
        }
        if (upstream.status === 404) {
            sendError(res, 404, "not_found", "That subreddit or thread was not found.");
            return;
        }
        if (upstream.status === 429) {
            const retryAfter = parseInt(upstream.headers.get("retry-after") || "", 10);
            sendError(res, 429, "rate_limited", "Reddit is rate limiting ReKindle.",
                !isNaN(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 120) : 30);
            return;
        }

        break;
    }

    console.warn("reddit relay failed", lastStatus, String(lastBody || "").slice(0, 160));
    sendError(res, 502, "upstream_error", "Reddit request failed (" + lastStatus + ").");
}

module.exports = {
    redditHandler,
    buildTokenRequest,
    parseRedditPath,
    normalizeSubreddit,
    buildTarget,
    trimListing,
    trimThread,
    allowUid,
    allowGlobal,
    ALLOWED_ORIGINS,
    RATE_CAPACITY
};
