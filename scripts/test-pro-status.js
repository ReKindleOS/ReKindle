/*
 * Client-side ReKindle+ status cache (js/home.js).
 *
 * Run: node scripts/test-pro-status.js
 *
 * Guards the 2026-11-25 fix: the home screen resolves Pro from the ID-token
 * `pro` claim plus users/{uid}.proExpiresAt, caches the verified answer per
 * uid, shares the real expiry with pro-gate.js (rekindle_pro_expiry), and never
 * downgrades a paying account to "free" just because one read failed or has not
 * landed yet — that downgrade is what showed Pro users the ReKindle+ ribbon.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'home.js'), 'utf8');

function slice(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notStrictEqual(start, -1, 'missing marker: ' + startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, 'missing end marker: ' + endMarker);
    return source.slice(start, end);
}

const state = slice('const PRO_FLAG_KEY', 'const ALLOWED_EXIT_AGENT');
const helpers = slice('// --- ReKindle+ cache helpers', 'function monitorUserProfile(');

function makeHarness() {
    const store = new Map();
    const sandbox = {
        console: { log: function () { }, warn: function () { }, error: function () { } },
        Date: Date,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        localStorage: {
            getItem: function (key) { return store.has(key) ? store.get(key) : null; },
            setItem: function (key, value) { store.set(key, String(value)); },
            removeItem: function (key) { store.delete(key); }
        },
        currentUser: null,
        currentFilter: 'all',
        rendered: { grid: 0, featured: 0, favorites: 0, proUI: 0 },
        updateProUI: function () { sandbox.rendered.proUI++; },
        renderAppGrid: function () { sandbox.rendered.grid++; },
        renderFeaturedSection: function () { sandbox.rendered.featured++; },
        renderFavoriteSection: function () { sandbox.rendered.favorites++; }
    };
    sandbox.__store = store;
    sandbox.globalThis = sandbox;
    const code = state + '\n' + helpers + '\n' + `
        globalThis.__api = {
            readCachedPro: readCachedPro,
            cacheProStatus: cacheProStatus,
            clearCachedPro: clearCachedPro,
            proExpiryFromData: proExpiryFromData,
            applyProStatus: applyProStatus,
            applyResolvedProStatus: applyResolvedProStatus,
            setUser: function (user) { currentUser = user; },
            setDoc: function (doc) { proDocSnapshot = doc; },
            setClaim: function (value) { proClaimValue = value; },
            isPro: function () { return isPro; },
            resolved: function () { return proStatusResolved; },
            store: function () { return globalThis.__store; }
        };`;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    sandbox.__api.rendered = sandbox.rendered;
    return sandbox.__api;
}

const DAY = 24 * 60 * 60 * 1000;

// 1. A `pro` claim with no proExpiresAt still means Pro (manual grants, and the
//    users the payments audit found with a claim but an expired document).
{
    const h = makeHarness();
    h.setUser({ uid: 'u-claim', email: 'claim@example.com' });
    h.setDoc({});
    h.setClaim(true);
    h.applyResolvedProStatus();
    assert.strictEqual(h.isPro(), true, 'claim-only grant must be Pro');
    assert.strictEqual(h.resolved(), true, 'status must be resolved');
    assert.strictEqual(h.readCachedPro('u-claim').isPro, true, 'verified Pro must be cached');
    assert.strictEqual(h.store().get('rekindle_is_pro_uid'), 'u-claim');
    assert.ok(Number(h.store().get('rekindle_pro_expiry')) > Date.now(), 'shared expiry must be in the future');
    assert.strictEqual(h.store().get('rekindle_pro_expiry_uid'), 'u-claim');
}

// 2. proExpiresAt is the second source, and the cached expiry must be the real
//    one (pro-gate.js trusts it when its own read fails).
{
    const h = makeHarness();
    const expires = Date.now() + 30 * DAY;
    h.setUser({ uid: 'u-doc', email: 'doc@example.com' });
    h.setDoc({ proExpiresAt: { toMillis: function () { return expires; } } });
    h.setClaim(false);
    h.applyResolvedProStatus();
    assert.strictEqual(h.isPro(), true, 'unexpired proExpiresAt must be Pro');
    assert.strictEqual(Number(h.store().get('rekindle_pro_expiry')), expires, 'cache must store the real expiry');
}

// 3. A verified free account clears the cache, so a later grant elsewhere
//    cannot leave a stale Pro flag behind.
{
    const h = makeHarness();
    h.setUser({ uid: 'u-free', email: 'free@example.com' });
    h.applyProStatus(true, Date.now() + DAY); // stale Pro from an earlier load
    assert.strictEqual(h.readCachedPro('u-free').isPro, true);
    h.setDoc({ proExpiresAt: { toMillis: function () { return Date.now() - 1000; } } });
    h.setClaim(false);
    h.applyResolvedProStatus();
    assert.strictEqual(h.isPro(), false, 'expired document + no claim is free');
    assert.strictEqual(h.readCachedPro('u-free').known, true, 'the free answer is cached too');
    assert.strictEqual(h.readCachedPro('u-free').isPro, false);
    assert.strictEqual(h.store().get('rekindle_pro_expiry'), undefined, 'shared expiry must be cleared');
}

// 4. Incomplete verification must not downgrade: with only the claim read back
//    (listener still pending) a cached Pro account stays Pro.
{
    const h = makeHarness();
    h.setUser({ uid: 'u-slow', email: 'slow@example.com' });
    h.applyProStatus(true, Date.now() + DAY); // cached answer painted at auth
    h.setClaim(false);
    h.applyResolvedProStatus(); // proDocSnapshot is still null
    assert.strictEqual(h.isPro(), true, 'a missing document must not downgrade a Pro user');
    assert.strictEqual(h.resolved(), true, 'the cached answer already counts as resolved');
    h.setDoc({ proExpiresAt: { toMillis: function () { return Date.now() - 1000; } } });
    h.applyResolvedProStatus();
    assert.strictEqual(h.isPro(), false, 'once both halves say free, follow them');
}

// 5. The cache is per account, and clearing it removes every key.
{
    const h = makeHarness();
    h.cacheProStatus('u-a', true, Date.now() + DAY);
    assert.strictEqual(h.readCachedPro('u-a').known, true);
    assert.strictEqual(h.readCachedPro('u-b').known, false, 'another uid must not inherit the cache');
    h.clearCachedPro();
    assert.strictEqual(h.readCachedPro('u-a').known, false);
    assert.strictEqual(h.store().get('rekindle_pro_expiry'), undefined);
    assert.strictEqual(h.store().get('rekindle_is_pro_checked'), undefined);
    // kindlechat/neighbourhood/suggestions read the flag as `!== 'false'`, so a
    // signed-out device must keep an explicit 'false', not a missing key.
    assert.strictEqual(h.store().get('rekindle_is_pro'), 'false');
}

// 6. The developer account is always Pro (mirrors firestore.rules isDeveloper).
{
    const h = makeHarness();
    h.setUser({ uid: 'u-dev', email: 'ukiyo@rekindle.ink' });
    h.setDoc({});
    h.setClaim(false);
    h.applyResolvedProStatus();
    assert.strictEqual(h.isPro(), true, 'developer account must be Pro');
}

// 7. Render side effects only on a change, but the ribbon is always refreshed.
{
    const h = makeHarness();
    h.setUser({ uid: 'u-render', email: 'r@example.com' });
    h.setDoc({});
    h.setClaim(true);
    h.applyResolvedProStatus();
    const first = h.rendered.grid;
    h.applyResolvedProStatus();
    assert.strictEqual(h.rendered.grid, first, 'an unchanged status must not rebuild the grid');
    assert.ok(h.rendered.proUI >= 2, 'updateProUI must run on every resolve');
}

// 8. Static wiring: the ribbon waits for a resolved status, logout/guest clear
//    the cache, and the home screen is what writes the shared expiry.
assert.ok(/var show = proStatusResolved && !isPro/.test(source),
    'the ReKindle+ ribbon must not render before the status is resolved');
assert.ok(/clearCachedPro\(\);/.test(slice('function confirmLogout()', 'function autoDetectScale')),
    'logging out must clear the cached Pro status');
assert.ok(/clearCachedPro\(\);/.test(slice('function handleGuestMode()', 'document.getElementById(\'user-display\')')),
    'Guest Mode must clear the cached Pro status');
assert.ok(/readCachedPro\(user\.uid\)/.test(slice('function handleAuthState(user, previousUid)', 'function handleGuestMode()')),
    'sign-in must paint the cached status for that uid');

console.log('PASS - pro status cache (claim + document, per-uid cache, no downgrade on a missing read)');
