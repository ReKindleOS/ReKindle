/**
 * Substack relay for rekindle.ink
 *
 * `substack.html` used to call `workers/rekindle-substack` (a Cloudflare
 * Worker). Since 2026-10-24 Substack answers a large share of Cloudflare
 * Worker egress requests with `429 Too Many Requests` (17-byte body,
 * `x-served-by: Substack`, no Retry-After). Measured 2026-10-24: 2-3 of 10
 * requests returned 200 for every endpoint, and the same requests from a
 * residential IP returned 200 8/8. Minimal UA vs a full Chrome header set made
 * no difference, and `wrangler dev --remote` reproduced it, so it is the
 * egress IP range, not the request shape.
 *
 * This function runs on Google Cloud (us-central1), the same workaround family
 * as `standardebooks.js` and the Akinator relay. The Cloudflare Worker is left
 * in the repo for rollback, but the app no longer calls it.
 *
 * Contract: GET/HEAD https://.../substack?path=/api/v1/posts%3Flimit%3D15&host=pub.substack.com
 *   - Authorization: Bearer <Firebase ID token> is REQUIRED (verified with
 *     admin.auth().verifyIdToken). Without it this would be an open proxy that
 *     anyone could point at Substack from the project's GCP egress.
 *   - `path` must be an /api/v1/... path. Substack's per-publication API also
 *     lives under /api/v1/ on custom domains, so the host is not restricted to
 *     *.substack.com; it is restricted to public, non-IP hosts plus the path
 *     prefix, which keeps the metadata/RFC1918 SSRF surface closed.
 *   - `host` defaults to substack.com (the reader API). Publication feeds pass
 *     the publication subdomain or custom domain.
 *   - `X-Substack-SID` is forwarded as the `substack.sid` cookie. It is never
 *     logged or stored.
 *   - 2 attempts on 429/5xx with backoff; no response caching (per-user data).
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

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UPSTREAM_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 6 * 1024 * 1024;

// Per-instance bucket keyed by uid. A first feed load fans out one request per
// subscription (batched two at a time), so a normal session is tens of
// requests; 300 capacity with 5/s refill is well above that and still stops a
// scripted crawl.
const RATE_CAPACITY = 300;
const RATE_REFILL_PER_SEC = 5;
const buckets = new Map();

// --- SSRF guards (kept in sync with functions/api/proxy.js) ---------------
function normalizeHost(hostname) {
    return String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
}

function ipv4ToInt(hostname) {
    const parts = String(hostname).split(".");
    if (parts.length !== 4) return null;
    let value = 0;
    for (let i = 0; i < 4; i++) {
        const part = parts[i];
        if (!/^\d{1,3}$/.test(part)) return null;
        const n = Number(part);
        if (n > 255) return null;
        value = (value * 256) + n;
    }
    return value >>> 0;
}

function inCidr(value, cidr, bits) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((cidr & mask) >>> 0);
}

function isForbiddenIPv4(hostname) {
    const value = ipv4ToInt(hostname);
    if (value === null) return false;

    return (
        inCidr(value, 0x00000000, 8) ||   // 0.0.0.0/8
        inCidr(value, 0x0a000000, 8) ||   // 10.0.0.0/8
        inCidr(value, 0x64400000, 10) ||  // 100.64.0.0/10
        inCidr(value, 0x7f000000, 8) ||   // 127.0.0.0/8
        inCidr(value, 0xa9fe0000, 16) ||  // 169.254.0.0/16
        inCidr(value, 0xac100000, 12) ||  // 172.16.0.0/12
        inCidr(value, 0xc0000000, 24) ||  // 192.0.0.0/24
        inCidr(value, 0xc0a80000, 16) ||  // 192.168.0.0/16
        inCidr(value, 0xc6120000, 15) ||  // 198.18.0.0/15
        inCidr(value, 0xe0000000, 4) ||   // 224.0.0.0/4
        inCidr(value, 0xf0000000, 4)      // 240.0.0.0/4
    );
}

function isForbiddenIPv6(hostname) {
    const host = hostname.toLowerCase();
    if (host === "::" || host === "::1") return true;

    // IPv4-mapped/compressed forms: ::ffff:127.0.0.1 and ::ffff:7f00:1
    if (host.indexOf("::ffff:") === 0) {
        const tail = host.slice(7);
        if (tail.indexOf(".") !== -1) return isForbiddenIPv4(tail);
        const groups = tail.split(":");
        if (groups.length === 2 && /^[0-9a-f]{1,4}$/.test(groups[0]) && /^[0-9a-f]{1,4}$/.test(groups[1])) {
            const hi = parseInt(groups[0], 16);
            const lo = parseInt(groups[1], 16);
            return isForbiddenIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
        }
        return true;
    }

    // fc00::/7 (unique local), fe80::/10 (link-local)
    if (/^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host)) return true;

    return false;
}

function isForbiddenHost(hostname) {
    const host = normalizeHost(hostname);
    if (!host) return true;

    if (host === "localhost" || host === "metadata" || host === "metadata.google.internal") return true;
    if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;

    const rebindingSuffixes = [".nip.io", ".sslip.io", ".xip.io", ".localtest.me", ".lvh.me", ".vcap.me", ".traefik.me"];
    for (let i = 0; i < rebindingSuffixes.length; i++) {
        if (host === rebindingSuffixes[i].slice(1) || host.endsWith(rebindingSuffixes[i])) return true;
    }

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isForbiddenIPv4(host);
    if (host.indexOf(":") !== -1) return isForbiddenIPv6(host);

    return false;
}

// --- Request helpers -------------------------------------------------------
function applyCors(req, res) {
    const origin = req.headers && req.headers.origin;
    if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
        res.set("Access-Control-Allow-Origin", origin);
    } else {
        res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
    }
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Substack-SID");
    res.set("Access-Control-Max-Age", "86400");
}

function sendError(res, status, code, message) {
    res.status(status).json({ error: code, message: message });
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * Build the upstream URL from the request. Only https, only /api/v1/ paths,
 * only public hostnames (no IP literals, no internal suffixes, no ports).
 */
function parseUpstreamPath(pathRaw, hostRaw) {
    const path = String(pathRaw || "");
    if (!path.startsWith("/api/v1/")) return null;
    if (path.indexOf("\\") !== -1) return null;

    const host = normalizeHost(hostRaw || "substack.com");
    if (!host || host.indexOf(".") === -1) return null;
    if (!/^[a-z0-9.-]+$/.test(host)) return null;          // no port, no IPv6, no userinfo
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // no IPv4 literals
    if (isForbiddenHost(host)) return null;

    let url;
    try {
        url = new URL("https://" + host + path);
    } catch (e) {
        return null;
    }
    if (url.protocol !== "https:") return null;
    if (url.hostname !== host) return null;
    if (!url.pathname.startsWith("/api/v1/")) return null;
    return url;
}

function allowRequest(uid) {
    const now = Date.now();
    let bucket = buckets.get(uid);
    if (!bucket) {
        bucket = { tokens: RATE_CAPACITY, last: now };
        buckets.set(uid, bucket);
        if (buckets.size > 5000) buckets.clear();
    }
    bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + ((now - bucket.last) / 1000) * RATE_REFILL_PER_SEC);
    bucket.last = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
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

function retryDelayMs(res, attempt) {
    const header = res && res.headers.get("retry-after");
    const secs = parseInt(header || "0", 10);
    if (secs > 0) return Math.min(secs * 1000, 3000);
    return 500 * Math.pow(2, attempt);
}

async function fetchUpstream(url, sid) {
    let lastError = null;
    const attempts = 2;

    for (let attempt = 0; attempt < attempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, UPSTREAM_TIMEOUT_MS);
        const headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://substack.com/"
        };
        if (sid) headers["Cookie"] = "substack.sid=" + sid;

        try {
            const upstream = await fetch(url.toString(), {
                method: "GET",
                redirect: "follow",
                headers: headers,
                signal: controller.signal
            });
            clearTimeout(timer);

            const retryable = upstream.status === 429 || upstream.status >= 500;
            if (retryable && attempt < attempts - 1) {
                const delay = retryDelayMs(upstream, attempt);
                try { await upstream.arrayBuffer(); } catch (e) { /* ignore */ }
                await sleep(delay);
                continue;
            }
            return upstream;
        } catch (e) {
            clearTimeout(timer);
            lastError = e;
            if (attempt < attempts - 1) await sleep(500 * Math.pow(2, attempt));
        }
    }

    throw lastError || new Error("upstream fetch failed");
}

async function substackHandler(req, res) {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
        sendError(res, 405, "method_not_allowed", "Use GET or HEAD");
        return;
    }

    const user = await verifyUser(req);
    if (!user || !user.uid) {
        sendError(res, 401, "unauthorized", "Sign in to ReKindle first");
        return;
    }
    if (!allowRequest(user.uid)) {
        sendError(res, 429, "rate_limited", "Too many requests, slow down");
        return;
    }

    const target = parseUpstreamPath(req.query && req.query.path, req.query && req.query.host);
    if (!target) {
        sendError(res, 403, "target_not_allowed",
            "Only https://<public host>/api/v1/... targets are allowed");
        return;
    }

    const sid = req.headers["x-substack-sid"] || "";
    if (sid && String(sid).length > 4096) {
        sendError(res, 400, "invalid_sid", "SID is too long");
        return;
    }

    let upstream;
    try {
        upstream = await fetchUpstream(target, sid ? String(sid) : "");
    } catch (e) {
        sendError(res, 502, "upstream_unreachable", "Could not reach Substack");
        return;
    }

    // A redirect must not land on an internal host.
    let finalHost = "";
    try { finalHost = new URL(upstream.url).hostname; } catch (e) { finalHost = ""; }
    if (finalHost && isForbiddenHost(finalHost)) {
        sendError(res, 502, "upstream_redirect_blocked", "Blocked redirect target");
        return;
    }

    let body;
    try {
        const buf = Buffer.from(await upstream.arrayBuffer());
        if (buf.length > MAX_BODY_BYTES) {
            sendError(res, 502, "response_too_large", "Substack response was too large");
            return;
        }
        body = buf;
    } catch (e) {
        sendError(res, 502, "upstream_read_failed", "Could not read Substack response");
        return;
    }

    res.status(upstream.status);
    res.set("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.set("Cache-Control", "no-store");
    if (req.method === "HEAD") {
        res.send("");
        return;
    }
    res.send(body);
}

module.exports = {
    substackHandler,
    parseUpstreamPath,
    isForbiddenHost,
    allowRequest,
    ALLOWED_ORIGINS,
    RATE_CAPACITY
};
