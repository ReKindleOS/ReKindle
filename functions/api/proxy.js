/**
 * ReKindle CORS proxy.
 *
 * This endpoint exists for CalDAV/CardDAV and a handful of public feeds whose
 * origins do not send CORS headers. It is deliberately NOT a general-purpose
 * open proxy:
 *
 *   - GET / HEAD only (nothing in the app needs a proxied write)
 *   - http(s) only, no embedded credentials
 *   - private / loopback / link-local / metadata hosts are rejected
 *   - redirects are followed manually and re-validated on every hop
 *   - only a small allowlist of end-to-end headers is forwarded
 *   - 10s timeout and 10 MB response ceiling
 *   - no wildcard CORS headers (all callers are same-origin Pages projects)
 *
 * Some upstreams block Cloudflare egress outright, so this proxy cannot help
 * them: `site.api.espn.com` returns 403 "Access Denied" to Pages IPs (but sends
 * `access-control-allow-origin: *`, so `scores.html` fetches it directly).
 *
 * The guard helpers are exported so `scripts/test-proxy-guard.js` can exercise
 * them without a Workers runtime.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

const ALLOWED_METHODS = ['GET', 'HEAD'];

// Only forward headers that the upstream actually needs. In particular,
// cookies, Origin, Referer and Cloudflare-injected headers must never cross
// the proxy boundary.
const FORWARDED_HEADERS = [
    'accept',
    'accept-language',
    'authorization',
    'if-none-match',
    'range'
];

const ALLOWED_ORIGIN_HOSTS = [
    'rekindle.ink',
    'beta.rekindle.ink',
    'lite.rekindle.ink',
    'legacy.rekindle.ink'
];

function normalizeHost(hostname) {
    return String(hostname || '')
        .trim()
        .toLowerCase()
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .replace(/\.$/, '');
}

function ipv4ToInt(hostname) {
    const parts = hostname.split('.');
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
    if (host === '::' || host === '::1') return true;

    // IPv4-mapped/compressed forms: ::ffff:127.0.0.1 and ::ffff:7f00:1
    if (host.indexOf('::ffff:') === 0) {
        const tail = host.slice(7);
        if (tail.indexOf('.') !== -1) return isForbiddenIPv4(tail);
        const groups = tail.split(':');
        if (groups.length === 2 && /^[0-9a-f]{1,4}$/.test(groups[0]) && /^[0-9a-f]{1,4}$/.test(groups[1])) {
            const hi = parseInt(groups[0], 16);
            const lo = parseInt(groups[1], 16);
            return isForbiddenIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
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

    // Local / internal DNS names.
    if (host === 'localhost' || host === 'metadata' || host === 'metadata.google.internal') return true;
    if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;

    // Wildcard-DNS services that resolve arbitrary hostnames (including
    // 127.0.0.1 / RFC1918 literals) are a common SSRF bypass.
    var rebindingSuffixes = ['.nip.io', '.sslip.io', '.xip.io', '.localtest.me', '.lvh.me', '.vcap.me', '.traefik.me'];
    for (var i = 0; i < rebindingSuffixes.length; i++) {
        if (host === rebindingSuffixes[i].slice(1) || host.endsWith(rebindingSuffixes[i])) return true;
    }

    // Literal IPs. URL parsing canonicalises numeric IPv4 forms, so
    // `new URL('http://2130706433/')` reaches here as 127.0.0.1.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isForbiddenIPv4(host);
    if (host.indexOf(':') !== -1) return isForbiddenIPv6(host);

    return false;
}

function validateProxyUrl(raw) {
    let url;
    try {
        url = new URL(String(raw));
    } catch (e) {
        return { ok: false, status: 400, reason: 'invalid_url' };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, status: 403, reason: 'forbidden_protocol' };
    }
    if (url.username || url.password) {
        return { ok: false, status: 403, reason: 'credentials_in_url' };
    }
    if (!url.hostname || isForbiddenHost(url.hostname)) {
        return { ok: false, status: 403, reason: 'forbidden_host' };
    }

    return { ok: true, url: url };
}

function originAllowed(origin) {
    if (!origin) return true; // native/curl clients do not send Origin
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
            ALLOWED_ORIGIN_HOSTS.indexOf(parsed.hostname) !== -1;
    } catch (e) {
        return false;
    }
}

async function readBodyWithLimit(response, maxBytes) {
    if (!response.body) return new Uint8Array(0);

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) {
        const err = new Error('too_large');
        err.code = 'too_large';
        throw err;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;

    while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = result.value;
        total += chunk.byteLength;
        if (total > maxBytes) {
            try { await reader.cancel(); } catch (e) { }
            const err = new Error('too_large');
            err.code = 'too_large';
            throw err;
        }
        chunks.push(chunk);
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
        out.set(chunks[i], offset);
        offset += chunks[i].byteLength;
    }
    return out;
}

function buildResponseHeaders(upstream) {
    const headers = new Headers();
    const copy = ['content-type', 'cache-control', 'etag', 'last-modified', 'content-disposition', 'accept-ranges', 'content-range'];
    for (let i = 0; i < copy.length; i++) {
        const value = upstream.headers.get(copy[i]);
        if (value) headers.set(copy[i], value);
    }
    headers.set('x-content-type-options', 'nosniff');
    return headers;
}

function errorResponse(status, message) {
    return new Response(message, {
        status: status,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
}

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: { allow: 'GET, HEAD, OPTIONS' }
        });
    }

    if (ALLOWED_METHODS.indexOf(request.method) === -1) {
        return errorResponse(405, 'Method not allowed');
    }

    // Cheap browser barrier. A direct client can spoof this, but it stops
    // arbitrary third-party pages from using the proxy from a browser.
    if (!originAllowed(request.headers.get('origin'))) {
        return errorResponse(403, 'Forbidden');
    }

    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get('url');
    if (!target) return errorResponse(400, 'Missing url parameter');

    let current = validateProxyUrl(target);
    if (!current.ok) return errorResponse(current.status, 'Forbidden');

    const forwardHeaders = new Headers();
    for (let i = 0; i < FORWARDED_HEADERS.length; i++) {
        const value = request.headers.get(FORWARDED_HEADERS[i]);
        if (value) forwardHeaders.set(FORWARDED_HEADERS[i], value);
    }
    forwardHeaders.set('accept-encoding', 'identity');
    forwardHeaders.set('user-agent', 'ReKindle-App/1.0 (https://rekindle.ink)');

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    try {
        let response = null;
        let redirects = 0;

        while (true) {
            response = await fetch(current.url.toString(), {
                method: request.method,
                headers: forwardHeaders,
                redirect: 'manual',
                signal: controller.signal
            });

            const status = response.status;
            if (status >= 300 && status < 400 && response.headers.get('location')) {
                if (redirects >= MAX_REDIRECTS) {
                    return errorResponse(502, 'Too many redirects');
                }
                const next = new URL(response.headers.get('location'), current.url);
                const checked = validateProxyUrl(next.toString());
                if (!checked.ok) return errorResponse(403, 'Forbidden');
                current = checked;
                redirects++;
                continue;
            }
            break;
        }

        const headers = buildResponseHeaders(response);

        if (request.method === 'HEAD' || response.status === 204 || response.status === 205 || response.status === 304) {
            return new Response(null, { status: response.status, headers: headers });
        }

        const body = await readBodyWithLimit(response, MAX_BYTES);
        return new Response(body, { status: response.status, headers: headers });
    } catch (e) {
        if (e && e.code === 'too_large') return errorResponse(413, 'Response too large');
        if (e && e.name === 'AbortError') return errorResponse(504, 'Upstream timeout');
        return errorResponse(502, 'Proxy request failed');
    } finally {
        clearTimeout(timer);
    }
}

export {
    ALLOWED_METHODS,
    MAX_BYTES,
    MAX_REDIRECTS,
    isForbiddenHost,
    validateProxyUrl,
    originAllowed,
    readBodyWithLimit
};
