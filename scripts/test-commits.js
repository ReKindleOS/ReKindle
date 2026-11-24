/*
 * Guards for the /api/commits GitHub proxy.
 *
 * Run: node scripts/test-commits.js
 *
 * The endpoint is the changelog page's only data source. These tests keep the
 * payload compact, the paging metadata correct, and upstream/rate-limit
 * failures mapped to the errors the page knows how to display.
 */
const assert = require('assert');

(async () => {
    const commits = await import('../functions/api/commits.js');
    const { normalizeCommit, totalPagesFromLink, onRequest } = commits;

    // Compact, single-line payload.
    const normalised = normalizeCommit({
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        html_url: 'https://github.com/ReKindleOS/ReKindle/commit/abcdef1234567890abcdef1234567890abcdef12',
        commit: {
            message: '  Fix   the thing\n\nLong body that the page does not render.  ',
            author: { name: 'ReKindle', date: '2026-10-22T06:40:56Z' }
        },
        author: { login: 'rekindleos' }
    });
    assert.strictEqual(normalised.short, 'abcdef1');
    assert.strictEqual(normalised.message, 'Fix the thing');
    assert.strictEqual(normalised.author, 'ReKindle');
    assert.strictEqual(normalised.login, 'rekindleos');
    assert.strictEqual(normalised.date, '2026-10-22T06:40:56Z');
    assert.strictEqual(normalised.url.indexOf('https://github.com/ReKindleOS/ReKindle/commit/'), 0);

    // Fallbacks never throw on partial GitHub data.
    const sparse = normalizeCommit({ sha: '1234567' });
    assert.strictEqual(sparse.short, '1234567');
    assert.strictEqual(sparse.author, 'Unknown');
    assert.strictEqual(sparse.message, '');
    assert.strictEqual(sparse.url, 'https://github.com/ReKindleOS/ReKindle/commit/1234567');

    // Long first lines are trimmed so one commit cannot dominate the list.
    const long = normalizeCommit({ sha: 'abc', commit: { message: 'x'.repeat(500) } });
    assert.strictEqual(long.message.length, 240);
    assert.strictEqual(long.message.slice(-3), '...');

    // Link header paging.
    assert.strictEqual(totalPagesFromLink(
        '<https://api.github.com/repositories/1/commits?per_page=100&page=2>; rel="next", ' +
        '<https://api.github.com/repositories/1/commits?per_page=100&page=8>; rel="last"'
    ), 8);
    assert.strictEqual(totalPagesFromLink(null), null);
    assert.strictEqual(totalPagesFromLink('<https://api.github.com/x>; rel="next"'), null);

    // Method guard happens before any upstream fetch.
    const post = await onRequest({
        request: new Request('https://rekindle.ink/api/commits', { method: 'POST' })
    });
    assert.strictEqual(post.status, 405);

    const realFetch = global.fetch;
    try {
        let requestedUrl = '';
        let requestedHeaders = null;
        global.fetch = async function (url, options) {
            requestedUrl = String(url);
            requestedHeaders = options && options.headers;
            return new Response(JSON.stringify([{
                sha: 'fedcba9876543210',
                html_url: 'https://github.com/ReKindleOS/ReKindle/commit/fedcba9876543210',
                commit: { message: 'A commit', author: { name: 'Tester', date: '2026-10-22T00:00:00Z' } }
            }]), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                    'link': '<https://api.github.com/x?page=1>; rel="last"'
                }
            });
        };

        const ok = await onRequest({
            request: new Request('https://rekindle.ink/api/commits?page=1&per_page=100')
        });
        const payload = await ok.json();
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(payload.repo, 'ReKindleOS/ReKindle');
        assert.strictEqual(payload.page, 1);
        assert.strictEqual(payload.commits.length, 1);
        assert.strictEqual(payload.commits[0].short, 'fedcba9');
        assert.strictEqual(payload.hasMore, false);
        assert.strictEqual(payload.totalPages, 1);
        assert.ok(requestedUrl.indexOf('per_page=100') !== -1, 'per_page is forwarded');
        assert.ok(requestedUrl.indexOf('page=1') !== -1, 'page is forwarded');
        assert.ok(requestedHeaders && requestedHeaders['User-Agent'], 'GitHub requires a User-Agent');

        // 403 with an exhausted rate limit is surfaced as a retryable error.
        global.fetch = async function () {
            return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
                status: 403,
                headers: {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120)
                }
            });
        };
        const limited = await onRequest({
            request: new Request('https://rekindle.ink/api/commits?page=1')
        });
        const limitedPayload = await limited.json();
        assert.strictEqual(limited.status, 503);
        assert.strictEqual(limitedPayload.error, 'rate_limited');
        assert.ok(Number(limited.headers.get('retry-after')) > 0, 'rate limit response tells the client when to retry');
    } finally {
        global.fetch = realFetch;
    }

    // --- Page-1 freshness revalidation (Atom feed head) ---------------------
    const { parseHeadSha } = commits;
    const headA = 'a'.repeat(40);
    const headB = 'b'.repeat(40);
    const atom = '<?xml version="1.0"?><feed><entry>' +
        '<id>tag:github.com,2008:Grit::Commit/' + headB + '</id>' +
        '<title>New commit</title></entry></feed>';

    assert.strictEqual(parseHeadSha(atom), headB, 'Atom head SHA is parsed');
    assert.strictEqual(parseHeadSha('<feed></feed>'), null);
    assert.strictEqual(parseHeadSha(null), null);

    function fakeCache() {
        const store = new Map();
        return {
            store: store,
            match: async function (request) {
                return store.get(request.url) || null;
            },
            put: async function (request, response) {
                store.set(request.url, response);
            }
        };
    }

    function pageResponse(head) {
        return new Response(JSON.stringify({
            page: 1,
            perPage: 100,
            commits: [{
                sha: head,
                short: head.slice(0, 7),
                message: 'Old cached commit',
                author: 'ReKindle',
                date: '2026-11-24T04:00:00Z',
                url: 'https://github.com/ReKindleOS/ReKindle/commit/' + head
            }],
            hasMore: true,
            totalPages: 9
        }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'X-Changelog-Head': head }
        });
    }

    const pageUrl = 'https://rekindle.ink/api/commits?page=1&per_page=100';
    const realCaches = global.caches;
    try {
        const cache = fakeCache();
        global.caches = { default: cache };
        cache.store.set(pageUrl, pageResponse(headA));

        let restCalls = 0;
        global.fetch = async function (url) {
            if (String(url).indexOf('.atom') !== -1) {
                return new Response(atom, { status: 200 });
            }
            restCalls++;
            return new Response(JSON.stringify([{
                sha: headB,
                html_url: 'https://github.com/ReKindleOS/ReKindle/commit/' + headB,
                commit: { message: 'New commit', author: { name: 'ReKindle', date: '2026-11-24T05:00:00Z' } }
            }]), { status: 200, headers: { 'content-type': 'application/json' } });
        };

        const refreshed = await onRequest({ request: new Request(pageUrl) });
        const refreshedPayload = await refreshed.json();
        assert.strictEqual(refreshed.status, 200);
        assert.strictEqual(refreshedPayload.commits[0].sha, headB, 'stale page 1 is replaced with the new head');
        assert.strictEqual(refreshed.headers.get('X-Changelog-Head'), headB);
        assert.strictEqual(restCalls, 1, 'one REST request refreshes page 1');
        assert.strictEqual(cache.store.get(pageUrl).headers.get('X-Changelog-Head'), headB, 'cache now holds the new head');

        // Same head: the hour cache is reused without another REST call.
        const cached = await onRequest({ request: new Request(pageUrl) });
        const cachedPayload = await cached.json();
        assert.strictEqual(cachedPayload.commits[0].sha, headB);
        assert.strictEqual(restCalls, 1, 'matching head serves the cached page');

        // Feed failure: keep serving the cached page rather than erroring.
        const failedCache = fakeCache();
        global.caches = { default: failedCache };
        failedCache.store.set(pageUrl, pageResponse(headA));
        let failedRestCalls = 0;
        global.fetch = async function (url) {
            if (String(url).indexOf('.atom') !== -1) throw new Error('feed down');
            failedRestCalls++;
            return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
        };
        const fallback = await onRequest({ request: new Request(pageUrl) });
        const fallbackPayload = await fallback.json();
        assert.strictEqual(fallback.status, 200);
        assert.strictEqual(fallbackPayload.commits[0].sha, headA);
        assert.strictEqual(failedRestCalls, 0, 'a failed feed check never forces an error page');
    } finally {
        global.fetch = realFetch;
        if (realCaches === undefined) {
            delete global.caches;
        } else {
            global.caches = realCaches;
        }
    }

    console.log('PASS - commits proxy');
})().catch(err => {
    console.error('FAIL - commits proxy:', err);
    process.exit(1);
});
