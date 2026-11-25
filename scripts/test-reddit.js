/*
 * Guards for the Reddit relay (firebase-functions/reddit.js).
 *
 * Run: node scripts/test-reddit.js
 *
 * The relay is public on Google Cloud and holds the only Reddit OAuth secret,
 * so `path` is a security boundary: assert that only listing/thread paths pass
 * and that hosts, traversal, encoded separators, unknown sorts and malformed
 * cursors are rejected before any outbound request. Also pin the payload trim
 * (the relay must not become a general Reddit mirror) and the per-uid /
 * per-instance budgets that protect the shared 100 QPM client id.
 *
 * The handler block at the end stubs `firebase-admin` through Module._load (the
 * CI only installs root deps, so never rely on functions/node_modules) and
 * stubs `fetch`: it pins the OAuth token exchange, token refresh on an upstream
 * 401, the five-minute listing cache and the error mapping the page relies on.
 * No network and no real credentials are used.
 */
const assert = require("assert");
const Module = require("module");

// --- stub firebase-admin before the relay loads ---------------------------
const originalLoad = Module._load;
const fakeAdmin = {
    auth: function () {
        return {
            verifyIdToken: async function (token) {
                if (token !== "good-token") throw new Error("invalid token");
                return { uid: "test-uid", email: "test@example.com" };
            }
        };
    },
    firestore: function () {
        return {
            collection: function () {
                return { doc: function () { return { get: async function () { return { exists: false }; } }; } };
            }
        };
    }
};
Module._load = function (request) {
    if (request === "firebase-admin") return fakeAdmin;
    return originalLoad.apply(this, arguments);
};

const {
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
} = require("../firebase-functions/reddit.js");

Module._load = originalLoad;

function allowed(path, query) {
    const target = parseRedditPath(path, query || {});
    assert.ok(target, `expected ${path} to be allowed`);
    assert.strictEqual(target.url.protocol, "https:");
    assert.strictEqual(target.url.hostname, "oauth.reddit.com");
    return target;
}

function blocked(path, query) {
    assert.strictEqual(parseRedditPath(path, query || {}), null, `expected ${path} to be blocked`);
}

// --- token grant selection --------------------------------------------------
const confidential = buildTokenRequest("test-id", "test-secret");
assert.strictEqual(confidential.body, "grant_type=client_credentials");
assert.strictEqual(
    Buffer.from(confidential.authorization.slice(6), "base64").toString(),
    "test-id:test-secret"
);

const installed = buildTokenRequest("test-id", "");
assert.ok(installed.body.indexOf("installed_client") !== -1);
assert.ok(installed.body.indexOf("device_id=DO_NOT_TRACK_THIS_DEVICE") !== -1);
assert.strictEqual(
    Buffer.from(installed.authorization.slice(6), "base64").toString(),
    "test-id:"
);

// --- allowed shapes --------------------------------------------------------
allowed("/r/kindle");
allowed("/r/kindle/hot");
allowed("/r/kindle/new");
allowed("/r/kindle/top", { t: "week" });
allowed("/r/kindle/controversial", { t: "all" });
allowed("/r/popular");
allowed("/r/all");
allowed("/r/kindle+books");
allowed("/r/Kindle_Deals");
assert.strictEqual(allowed("/r/kindle/hot").kind, "listing");
assert.strictEqual(allowed("/r/kindle/comments/abc123").kind, "thread");
assert.strictEqual(allowed("/comments/abc123").kind, "thread");
assert.strictEqual(allowed("/r/kindle/comments/abc123/some_title").kind, "thread");

// --- path traversal / host escapes ----------------------------------------
blocked("https://oauth.reddit.com/r/kindle");
blocked("//oauth.reddit.com/r/kindle");
blocked("r/kindle");
blocked("/r/kindle/../../latest/meta-data");
blocked("/r/kindle/comments/abc123/%2e%2e/%2e%2e/latest");
blocked("/r/kindle%2f..%2fx");
blocked("/r\\kindle");
blocked("/r/kindle?limit=5");
blocked("/r/kindle#x");
blocked("/r/kindle /hot");
blocked("/");
blocked("/r/");
blocked("/user/spez");
blocked("/r/kindle/about");
blocked("/r/kindle/wiki/index");
blocked("/api/v1/me");
blocked("/r/kindle/comments/abc123/extra/segment");
blocked("/comments/abc123/extra/segment");
blocked("/r/" + "a".repeat(22));
blocked("/r/kindle/" + "x".repeat(400));

// --- query validation ------------------------------------------------------
assert.strictEqual(allowed("/r/kindle/hot", { limit: "999" }).url.searchParams.get("limit"), "100");
assert.strictEqual(allowed("/r/kindle/hot", { limit: "0" }).url.searchParams.get("limit"), "1");
assert.strictEqual(allowed("/r/kindle/hot", { limit: "abc" }).url.searchParams.get("limit"), "25");
assert.strictEqual(allowed("/r/kindle/hot").url.searchParams.get("raw_json"), "1");
assert.strictEqual(allowed("/r/kindle/hot", { after: "t3_abc123" }).url.searchParams.get("after"), "t3_abc123");
blocked("/r/kindle/hot", { after: "https://evil.example" });
blocked("/r/kindle/hot", { after: "t3_../x" });
blocked("/r/kindle/hot", { t: "fortnight" });
blocked("/r/kindle/hot", { sort: "hot" });        // comment sorts only
assert.strictEqual(
    allowed("/r/kindle/comments/abc123", { sort: "top" }).url.searchParams.get("sort"),
    "top"
);
blocked("/r/kindle/comments/abc123", { sort: "hot" });
assert.strictEqual(
    allowed("/r/kindle/hot", { path: "/r/evil", host: "evil.example", raw_json: "0" }).url.pathname,
    "/r/kindle/hot"
);

// --- subreddit names -------------------------------------------------------
assert.strictEqual(normalizeSubreddit("kindle"), "kindle");
assert.strictEqual(normalizeSubreddit("Kindle+Books"), "Kindle+Books");
assert.strictEqual(normalizeSubreddit("a"), null);
assert.strictEqual(normalizeSubreddit("a".repeat(22)), null);
assert.strictEqual(normalizeSubreddit("a".repeat(21)), "a".repeat(21));
assert.strictEqual(normalizeSubreddit("bad/name"), null);
assert.strictEqual(normalizeSubreddit("bad name"), null);
assert.strictEqual(normalizeSubreddit(""), null);

// --- response trimming -----------------------------------------------------
const listing = trimListing({
    data: {
        after: "t3_next",
        children: [
            { kind: "t3", data: { title: "A", author: "u1", subreddit: "kindle", permalink: "/r/kindle/comments/a/x/", name: "t3_a", secret: "drop me" } },
            { kind: "more", data: { count: 2 } },
            { kind: "t1", data: { body: "comment in a listing" } }
        ]
    }
});
assert.strictEqual(listing.data.children.length, 1);
assert.strictEqual(listing.data.after, "t3_next");
assert.strictEqual(listing.data.children[0].data.title, "A");
assert.strictEqual(listing.data.children[0].data.secret, undefined);

assert.deepStrictEqual(trimListing(null), { data: { children: [], after: null } });
assert.deepStrictEqual(trimListing({ data: {} }), { data: { children: [], after: null } });

const thread = trimThread([
    { data: { children: [{ kind: "t3", data: { title: "Post", author: "op", selftext_html: "&lt;p&gt;hi&lt;/p&gt;", permalink: "/r/kindle/comments/a/x/", url: "https://example.com", junk: 1 } }] } },
    { data: { children: [
        { kind: "t1", data: { author: "c1", body_html: "&lt;p&gt;yo&lt;/p&gt;", permalink: "/r/kindle/comments/a/x/c1/", score: 3 } },
        { kind: "more", data: { count: 1 } },
        { kind: "t1", data: { author: "deleted" } }
    ] } }
]);
assert.strictEqual(thread[0].data.children.length, 1);
assert.strictEqual(thread[0].data.children[0].data.junk, undefined);
assert.strictEqual(thread[1].data.children.length, 1);
assert.strictEqual(thread[1].data.children[0].data.author, "c1");
assert.deepStrictEqual(trimThread({}), [{ data: { children: [] } }, { data: { children: [] } }]);

// --- CORS allowlist --------------------------------------------------------
assert.ok(ALLOWED_ORIGINS.indexOf("https://rekindle.ink") !== -1);
assert.ok(ALLOWED_ORIGINS.indexOf("https://beta.rekindle.ink") !== -1);

// --- handler (stubbed OAuth + upstream) -----------------------------------
function makeRes() {
    return {
        statusCode: 0,
        body: null,
        headers: {},
        set: function (key, value) { this.headers[key] = value; return this; },
        status: function (code) { this.statusCode = code; return this; },
        json: function (payload) { this.body = payload; return this; },
        send: function (payload) { this.body = payload; return this; }
    };
}

let tokenCalls = 0;
let apiCalls = 0;
let upstreamStatus = 200;

function upstreamBody(url) {
    if (url.indexOf("/comments/") !== -1) {
        return [
            { kind: "Listing", data: { children: [
                { kind: "t3", data: { title: "Post", author: "op", selftext_html: "&lt;p&gt;body&lt;/p&gt;", permalink: "/r/kindle/comments/abc123/x/" } }
            ] } },
            { kind: "Listing", data: { children: [
                { kind: "t1", data: { author: "c1", body_html: "&lt;p&gt;comment&lt;/p&gt;", permalink: "/r/kindle/comments/abc123/x/c1/" } }
            ] } }
        ];
    }
    return {
        kind: "Listing",
        data: {
            after: "t3_next",
            children: [
                { kind: "t3", data: { title: "Hello", author: "a", subreddit: "kindle", permalink: "/r/kindle/comments/abc123/x/", name: "t3_abc123", secret: "drop" } }
            ]
        }
    };
}

global.fetch = async function (url) {
    if (String(url).indexOf("access_token") !== -1) {
        tokenCalls += 1;
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
            status: 200,
            headers: { "content-type": "application/json" }
        });
    }
    apiCalls += 1;
    if (upstreamStatus !== 200) {
        return new Response("blocked", { status: upstreamStatus, headers: { "content-type": "text/plain" } });
    }
    return new Response(JSON.stringify(upstreamBody(String(url))), {
        status: 200,
        headers: { "content-type": "application/json", "x-ratelimit-remaining": "90" }
    });
};

async function callRelay(path, token) {
    const res = makeRes();
    await redditHandler({
        method: "GET",
        headers: { authorization: "Bearer " + (token || "good-token") },
        query: { path: path }
    }, res);
    return res;
}

(async function () {
    process.env.REDDIT_CLIENT_ID = "test-client-id";
    process.env.REDDIT_CLIENT_SECRET = "test-client-secret";

    let res = await callRelay("/r/kindle/hot");
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["X-Rekindle-Cache"], "miss");
    assert.strictEqual(res.body.data.children.length, 1);
    assert.strictEqual(res.body.data.children[0].data.secret, undefined);
    assert.strictEqual(tokenCalls, 1, "one app-only token should be fetched");

    const apiBefore = apiCalls;
    res = await callRelay("/r/kindle/hot");
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["X-Rekindle-Cache"], "hit");
    assert.strictEqual(apiCalls, apiBefore, "a cache hit must not call Reddit");

    res = await callRelay("/r/kindle/comments/abc123");
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body[0].data.children[0].data.title, "Post");
    assert.strictEqual(res.body[1].data.children.length, 1);

    res = await callRelay("/r/kindle/hot", "bad-token");
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.error, "unauthorized");

    res = await callRelay("https://evil.example/r/kindle");
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.error, "target_not_allowed");

    // An upstream 401 forces one token refresh and one retry.
    upstreamStatus = 401;
    const tokensBefore = tokenCalls;
    const originalWarn = console.warn;
    let retry;
    console.warn = function () {};
    try {
        retry = await callRelay("/r/kindle/new");
    } finally {
        console.warn = originalWarn;
    }
    assert.strictEqual(retry.statusCode, 502); // second attempt also 401 -> mapped error
    assert.ok(tokenCalls > tokensBefore, "401 should force a token refresh");
    upstreamStatus = 200;

    delete process.env.REDDIT_CLIENT_ID;
    res = makeRes();
    await redditHandler({ method: "GET", headers: { authorization: "Bearer good-token" }, query: { path: "/r/kindle/hot" } }, res);
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.error, "not_configured");

    // --- per-uid token bucket ---------------------------------------------
    const uid = "test-user-" + Date.now();
    for (let i = 0; i < RATE_CAPACITY; i++) {
        assert.strictEqual(allowUid(uid), true, "burst request " + i + " should pass");
    }
    assert.strictEqual(allowUid(uid), false, "request over capacity should be limited");
    assert.strictEqual(allowUid(uid + "-other"), true, "a different uid has its own bucket");

    // --- per-instance global budget (last: it mutates module state) ------
    let passed = 0;
    for (let i = 0; i < 200; i++) {
        if (allowGlobal()) passed += 1;
    }
    assert.ok(passed >= 1 && passed <= 80, "global budget should be capped at 80/min, got " + passed);

    console.log("test-reddit: ok");
})().catch(function (err) {
    console.error(err);
    process.exit(1);
});
