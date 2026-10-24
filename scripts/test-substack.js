/*
 * Guards for the Substack relay (firebase-functions/substack.js).
 *
 * Run: node scripts/test-substack.js
 *
 * The relay is public on Google Cloud, so `path`/`host` are an SSRF boundary:
 * assert that only /api/v1/ paths and public hostnames pass, and that the
 * wildcard-DNS / metadata / RFC1918 escapes used by /api/proxy are rejected
 * before any outbound fetch happens.
 */
const assert = require("assert");
const {
    parseUpstreamPath,
    isForbiddenHost,
    allowRequest,
    ALLOWED_ORIGINS,
    RATE_CAPACITY
} = require("../firebase-functions/substack.js");

function allowed(path, host, expectedHost) {
    const url = parseUpstreamPath(path, host);
    assert.ok(url, `expected ${path} on ${host} to be allowed`);
    assert.strictEqual(url.protocol, "https:");
    assert.strictEqual(url.hostname, expectedHost || host);
    return url;
}

function blocked(path, host) {
    assert.strictEqual(parseUpstreamPath(path, host), null, `expected ${path} on ${host} to be blocked`);
}

// --- allowed targets -------------------------------------------------------
allowed("/api/v1/subscriptions", "substack.com");
allowed("/api/v1/subscriptions/page_v2", "substack.com");
allowed("/api/v1/posts?limit=15&offset=0&sort=new", "platformer.substack.com");
allowed("/api/v1/posts?limit=2", "www.thefp.com"); // publication custom domain
allowed("/api/v1/posts", "SUBSTACK.COM", "substack.com"); // normalised
assert.strictEqual(parseUpstreamPath("/api/v1/subscriptions", undefined).hostname, "substack.com");
assert.strictEqual(
    parseUpstreamPath("/api/v1/posts?limit=15&offset=0&sort=new", "platformer.substack.com").search,
    "?limit=15&offset=0&sort=new"
);

// --- path / host validation ------------------------------------------------
blocked("/subscriptions", "substack.com");            // legacy shape, not /api/v1/
blocked("/api/v1", "substack.com");                   // prefix needs the slash
blocked("/not-api", "substack.com");
blocked("//api/v1/x", "substack.com");
blocked("/api/v1/../../latest/meta-data", "substack.com");
blocked("/api/v1/%2e%2e/%2e%2e/latest/meta-data", "substack.com");
blocked("/api/v1\\x", "substack.com");

blocked("/api/v1/x", "localhost");
blocked("/api/v1/x", "foo.localhost");
blocked("/api/v1/x", "metadata.google.internal");
blocked("/api/v1/x", "foo.internal");
blocked("/api/v1/x", "foo.local");
blocked("/api/v1/x", "169.254.169.254");
blocked("/api/v1/x", "10.0.0.1");
blocked("/api/v1/x", "127.0.0.1");
blocked("/api/v1/x", "substack.com:8080");
blocked("/api/v1/x", "[::1]");
assert.strictEqual(parseUpstreamPath("/api/v1/x", "").hostname, "substack.com"); // missing host = reader API
blocked("/api/v1/x", "foo.nip.io");

// --- helper-level checks ---------------------------------------------------
assert.strictEqual(isForbiddenHost("169.254.169.254"), true);
assert.strictEqual(isForbiddenHost("10.1.2.3"), true);
assert.strictEqual(isForbiddenHost("192.168.1.1"), true);
assert.strictEqual(isForbiddenHost("metadata.google.internal"), true);
assert.strictEqual(isForbiddenHost("substack.com"), false);
assert.strictEqual(isForbiddenHost("platformer.substack.com"), false);

// CORS must cover the deployed origins.
["https://rekindle.ink", "https://beta.rekindle.ink", "https://lite.rekindle.ink"].forEach(function (origin) {
    assert.ok(ALLOWED_ORIGINS.indexOf(origin) !== -1, "missing origin " + origin);
});

// Per-uid bucket: a full burst is allowed, the next request is not.
const uid = "test-user-" + Date.now();
for (let i = 0; i < RATE_CAPACITY; i++) {
    assert.strictEqual(allowRequest(uid), true, "burst request " + i + " should pass");
}
assert.strictEqual(allowRequest(uid), false, "request over capacity should be limited");
assert.strictEqual(allowRequest("another-user"), true, "a different uid has its own bucket");

console.log("PASS - Substack relay guards");
