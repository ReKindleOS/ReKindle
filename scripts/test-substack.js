/*
 * Guards for the Substack relay (firebase-functions/substack.js) and the
 * cursor contract of the reader page (substack.html).
 *
 * Run: node scripts/test-substack.js
 *
 * The relay is public on Google Cloud, so `path`/`host` are an SSRF boundary:
 * assert that only /api/v1/ paths and public hostnames pass, and that the
 * wildcard-DNS / metadata / RFC1918 escapes used by /api/proxy are rejected
 * before any outbound fetch happens.
 *
 * 2026-11-25: Substack moved /api/v1/posts from ?offset=N to ?nextCursor. Any
 * request that still sends offset now gets 400 {"errors":[{"param":"offset",
 * "msg":"Invalid value"}]}. The last block pins the cursor round trip through
 * the relay's query parsing and keeps the page from regressing to offset.
 */
const assert = require("assert");
const {
    parseUpstreamPath,
    isForbiddenHost,
    normalizeSubstackSid,
    buildCookieHeader,
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
allowed("/api/v1/posts?limit=15", "platformer.substack.com");
allowed("/api/v1/posts?limit=15&cursor=eyJwb3N0X2RhdGUiOiIyMDI2In0%3D", "platformer.substack.com");
allowed("/api/v1/posts?limit=2", "www.thefp.com"); // publication custom domain
allowed("/api/v1/posts", "SUBSTACK.COM", "substack.com"); // normalised
assert.strictEqual(parseUpstreamPath("/api/v1/subscriptions", undefined).hostname, "substack.com");
assert.strictEqual(
    parseUpstreamPath("/api/v1/posts?limit=15&cursor=abc%3D", "platformer.substack.com").search,
    "?limit=15&cursor=abc%3D"
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

// --- session cookie normalisation -----------------------------------------
// Newer Substack accounts only carry connect.sid, older ones substack.sid.
// The relay must send the value under both names, and accept a whole cookie
// header pasted from DevTools.
assert.strictEqual(normalizeSubstackSid("  s%3Aabc.def  "), "s%3Aabc.def");
assert.strictEqual(normalizeSubstackSid("connect.sid=s%3Aabc.def"), "s%3Aabc.def");
assert.strictEqual(normalizeSubstackSid("substack.sid=s%3Aabc.def; path=/"), "s%3Aabc.def");
assert.strictEqual(normalizeSubstackSid("connect.sid=s%3Aabc; substack.sid=s%3Aabc"), "s%3Aabc");
assert.strictEqual(normalizeSubstackSid("s%3Aabc;def"), "");        // bare semicolons
assert.strictEqual(normalizeSubstackSid("two words"), "");          // whitespace
assert.strictEqual(normalizeSubstackSid("line\nbreak"), "");        // header injection
assert.strictEqual(normalizeSubstackSid("x".repeat(4097)), "");     // oversized
assert.strictEqual(normalizeSubstackSid(""), "");
assert.strictEqual(
    buildCookieHeader("s%3Aabc"),
    "connect.sid=s%3Aabc; substack.sid=s%3Aabc"
);
assert.strictEqual(buildCookieHeader(""), "");
assert.strictEqual(buildCookieHeader("two words"), "");

// Per-uid bucket: a full burst is allowed, the next request is not.
const uid = "test-user-" + Date.now();
for (let i = 0; i < RATE_CAPACITY; i++) {
    assert.strictEqual(allowRequest(uid), true, "burst request " + i + " should pass");
}
assert.strictEqual(allowRequest(uid), false, "request over capacity should be limited");
assert.strictEqual(allowRequest("another-user"), true, "a different uid has its own bucket");

// --- cursor contract (2026-11-25) -----------------------------------------
// Substack answers any /api/v1/posts request carrying ?offset=N with
// 400 {"errors":[{"location":"query","param":"offset","msg":"Invalid value"}]}
// and pages with an opaque ?cursor=<nextCursor> instead.
const fs = require("fs");
const path = require("path");
const page = fs.readFileSync(path.join(__dirname, "..", "substack.html"), "utf8");

assert.ok(
    !/\/posts\?[^"'`\n]*\boffset=/.test(page),
    "substack.html must page /posts with cursor, not offset (Substack 400s offset)"
);
assert.ok(page.indexOf("nextCursor") !== -1, "substack.html must follow nextCursor");
assert.ok(
    /encodeURIComponent\(state\.(?:pubCursor|subCursors\[[^\]]+\])\s*\|\|\s*''\)/.test(page),
    "substack.html must URL-encode the cursor"
);

// Round trip: the page builds the relay URL, the relay decodes ?path and
// rebuilds the upstream URL. A base64 cursor carries '=' and may carry '+' or
// '/', and a lone unescaped '+' is decoded as a space by qs, so the value must
// survive both hops byte-for-byte.
const CURSORS = [
    "eyJwb3N0X2RhdGUiOiIyMDI2LTExLTE0VDA5OjAwOjQ0LjgxNzQ2OFoifQ==",
    "a+b/c=="
];
CURSORS.forEach(function (raw) {
    const relay = new URL("https://us-central1-rekindle-dd1fa.cloudfunctions.net/substack");
    relay.searchParams.set("path", "/api/v1/posts?limit=15&cursor=" + encodeURIComponent(raw));
    relay.searchParams.set("host", "platformer.substack.com");
    // Express/qs decodes ?path exactly once before the handler sees it.
    const seenPath = new URLSearchParams(relay.search).get("path");
    const target = parseUpstreamPath(seenPath, "platformer.substack.com");
    assert.ok(target, "cursor path must pass the relay guards: " + raw);
    assert.strictEqual(target.searchParams.get("cursor"), raw, "cursor must survive the relay: " + raw);
});

console.log("PASS - Substack relay guards");
