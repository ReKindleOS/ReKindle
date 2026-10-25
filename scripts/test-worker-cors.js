/**
 * Guards the CORS preflight headers on the social Workers.
 *
 * Why this exists (2026-10-25): Cloudflare Workers Free allows 100k requests/day
 * across Workers AND Pages Functions. Every cross-origin JSON POST without a
 * cached preflight costs TWO requests (OPTIONS + POST). The chat Workers were
 * spending roughly half their daily quota on preflights, the account crossed the
 * limit, and every Worker started returning the CORS-less `error code: 1027`
 * page. KindleChat then showed "Unable to post: Load failed" for every message
 * (see docs/agent/usage-limits.md).
 *
 * `Access-Control-Max-Age` makes browsers reuse the preflight (Chromium caps it
 * at 2h, Safari at 10min), so one chat post costs one request instead of two.
 * Do not remove it, and do not shrink it below Safari's 600s floor.
 *
 * Run: node scripts/test-worker-cors.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MIN_MAX_AGE = 600; // Safari clamps Access-Control-Max-Age to 600s

(async () => {
    const moderate = await import('../workers/rekindle-moderate/worker.js');
    const { corsHeaders } = moderate;

    /* 1. The helper reflects an allowed origin and sets the preflight cache. */
    const allowed = corsHeaders('https://rekindle.ink');
    assert.strictEqual(allowed['Access-Control-Allow-Origin'], 'https://rekindle.ink',
        'an allowed origin must be reflected, not wildcarded');
    assert.strictEqual(String(allowed['Vary']).toLowerCase(), 'origin',
        'must Vary on Origin because the allowed origin is reflected');
    assert.ok(Number(allowed['Access-Control-Max-Age']) >= MIN_MAX_AGE,
        'preflight cache must be at least 600s');
    assert.ok(/POST/.test(allowed['Access-Control-Allow-Methods']));
    assert.ok(/OPTIONS/.test(allowed['Access-Control-Allow-Methods']));
    assert.ok(/authorization/i.test(allowed['Access-Control-Allow-Headers']),
        'the Authorization header must be allowed by the preflight');

    /* 2. Unknown origins still fail closed. */
    const denied = corsHeaders('https://evil.example');
    assert.strictEqual(denied['Access-Control-Allow-Origin'], 'null');

    /* 3. The real OPTIONS handler returns 204 with those headers. */
    const res = await moderate.default.fetch(
        new Request('https://rekindle-moderate.rekindle-social.workers.dev/', {
            method: 'OPTIONS',
            headers: { Origin: 'https://rekindle.ink' }
        }),
        {}
    );
    assert.strictEqual(res.status, 204, 'OPTIONS must answer 204');
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), 'https://rekindle.ink');
    assert.ok(Number(res.headers.get('Access-Control-Max-Age')) >= MIN_MAX_AGE,
        'the OPTIONS response must carry Access-Control-Max-Age');

    /* 4. The translation Worker has no exported helper; keep its copy honest. */
    const translateSrc = fs.readFileSync(
        path.join(__dirname, '..', 'workers', 'rekindle-translate', 'worker.js'), 'utf8');
    assert.ok(/Access-Control-Max-Age/.test(translateSrc),
        'rekindle-translate must cache its preflight too');
    assert.ok(/['"]Vary['"]\s*:/.test(translateSrc),
        'rekindle-translate must Vary on Origin');

    console.log('worker CORS preflight checks passed');
})().catch(function (err) {
    console.error('worker CORS preflight checks failed:', err && err.stack ? err.stack : err);
    process.exit(1);
});
