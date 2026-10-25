/**
 * Unit tests for js/worker-client.js, the shared outage parser used by
 * Neighbourhood and Topics (KindleChat has an equivalent local copy).
 *
 * The case that matters is the Cloudflare 1027 page: HTTP 429, `text/plain`
 * body `error code: 1027`, no CORS headers. When the browser lets the body
 * through it must become { error } (so the page's existing error branch shows
 * a friendly message), not a JSON parse exception. A rejected fetch is covered
 * by isTransportFailure()/errorMessage().
 *
 * Run: node scripts/test-worker-client.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, Date: Date, Promise: Promise, JSON: JSON };
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'worker-client.js'), 'utf8'),
    sandbox,
    { filename: 'js/worker-client.js' }
);

const client = sandbox.window.rekindleWorkerClient;
assert.ok(client, 'js/worker-client.js must expose window.rekindleWorkerClient');

(async () => {
    /* 0. Before any outage is seen, ordinary errors keep their own message. */
    assert.strictEqual(client.outageActive(), false);
    assert.strictEqual(client.errorMessage(new Error('nope')), null);

    /* 1. The 1027 page (non-JSON 429) becomes a friendly error, not a throw. */
    const outage = await client.readJson(new Response('error code: 1027', {
        status: 429,
        headers: { 'Content-Type': 'text/plain' }
    }));
    assert.strictEqual(outage.__outage, true);
    assert.strictEqual(outage.error, client.outageMessage());
    assert.strictEqual(client.outageActive(), true, 'the cooldown must arm');

    /* 2. A real worker JSON error is passed through unchanged. */
    const denied = await client.readJson(new Response(JSON.stringify({
        error: 'Links and URLs are not allowed.'
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    assert.strictEqual(denied.error, 'Links and URLs are not allowed.');
    assert.strictEqual(denied.__status, 400);

    /* 3. A successful body is parsed. */
    const ok = await client.readJson(new Response(JSON.stringify({ success: true, id: 'x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    }));
    assert.deepStrictEqual({ success: ok.success, id: ok.id }, { success: true, id: 'x' });

    /* 4. A 500 HTML/plain page is an outage too. */
    const err500 = await client.readJson(new Response('Internal error', { status: 500 }));
    assert.strictEqual(err500.__outage, true);

    /* 5. Transport failures (CORS-blocked fetch) map to the outage message. */
    assert.strictEqual(client.isTransportFailure(new TypeError('Load failed')), true);
    assert.strictEqual(client.isTransportFailure(new TypeError('Failed to fetch')), true);
    assert.strictEqual(client.isTransportFailure(new Error('HTTP 400')), false);
    assert.strictEqual(client.errorMessage(new TypeError('Load failed')), client.outageMessage());

    /* 6. A non-outage non-JSON reply still throws (do not silently succeed). */
    let threw = false;
    try {
        await client.readJson(new Response('not json', { status: 400 }));
    } catch (e) {
        threw = true;
    }
    assert.strictEqual(threw, true);

    console.log('worker client outage checks passed');
})().catch(function (err) {
    console.error('worker client outage checks failed:', err && err.stack ? err.stack : err);
    process.exit(1);
});
