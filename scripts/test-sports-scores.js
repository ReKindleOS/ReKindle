/*
 * scores.html transport and favourites guard.
 *
 * Run: node scripts/test-sports-scores.js
 *
 * ESPN's scoreboard API sends `access-control-allow-origin: *`, but its CDN
 * answers Cloudflare Pages egress with `403 Access Denied`. Routing it through
 * /api/proxy therefore broke every league except NRL (2026-11-17) and spent a
 * Pages Function invocation per league. Direct fetch is the fix, so this test
 * fails if a future edit puts ESPN back behind the proxy.
 *
 * It also pins the favourites key: ESPN team ids repeat across sports (NFL
 * id 2 = BUF, NBA id 2 = BOS), so `favoriteKey` must include the league.
 *
 * Hermetic: reads the checked-in HTML only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'scores.html'), 'utf8');

assert.ok(
    html.indexOf('https://site.api.espn.com/apis/site/v2/sports/') !== -1,
    'scores.html must build the ESPN scoreboard URL directly'
);
assert.ok(
    !/\/api\/proxy\?url=/.test(html),
    'scores.html must not route ESPN through /api/proxy (ESPN 403s Cloudflare egress)'
);
assert.ok(
    html.indexOf("fetch('/api/nrl-scores')") !== -1,
    'NRL must keep using its dedicated /api/nrl-scores function'
);

/* ---- favourites key, executed from the page's own inline script ---- */
const inline = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inline, 'scores.html must keep its inline app script');

const store = new Map();
const sandbox = {
    window: {},
    document: { getElementById: () => null },
    localStorage: {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value)
    },
    console: { log() {}, warn() {}, error() {} }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(inline[1], sandbox, { filename: 'scores.html' });

assert.strictEqual(sandbox.favoriteKey('basketball/nba', 2), 'basketball/nba:2');
assert.notStrictEqual(
    sandbox.favoriteKey('football/nfl', 2),
    sandbox.favoriteKey('basketball/nba', 2),
    'the same ESPN team id in two sports must not share a favourites key'
);

// An id-only legacy entry is migrated to the league-qualified key.
store.set('rekindle_scores_favs', JSON.stringify({
    '2': { id: '2', name: 'BOS', league: 'basketball/nba' }
}));
assert.deepStrictEqual(Object.keys(sandbox.loadFavorites()), ['basketball/nba:2']);

/* ---- expanded catalog ---- */
const leagues = vm.runInContext('LEAGUES', sandbox);
assert.ok(leagues.length >= 100, 'the catalog must keep the expanded league list (got ' + leagues.length + ')');

const slugs = new Set();
const groups = new Set();
leagues.forEach((league) => {
    assert.ok(league.name && league.name.trim(), 'every league needs a display name');
    assert.ok(league.slug && league.slug.trim(), league.name + ' needs a slug');
    assert.ok(league.group && league.group.trim(), league.name + ' needs a group');
    assert.ok(!slugs.has(league.slug), 'duplicate league slug: ' + league.slug);
    slugs.add(league.slug);
    groups.add(league.group);
});
assert.ok(groups.size >= 10, 'the menu must cover at least 10 sports (got ' + groups.size + ')');

const grouped = sandbox.getGroups();
assert.strictEqual(
    grouped.reduce((total, group) => total + group.leagues.length, 0),
    leagues.length,
    'every league must appear in exactly one sport group'
);

const nrl = leagues.find((league) => league.slug === 'nrl');
assert.ok(nrl && nrl.source === 'nrl-scores', 'NRL must stay on the dedicated endpoint');

/* ---- 60-day event window ---- */
const now = Date.now();
assert.strictEqual(sandbox.isCurrentEvent({ date: new Date(now - 2 * 86400000).toISOString() }), true, 'a game from two days ago must be shown');
assert.strictEqual(sandbox.isCurrentEvent({ date: new Date(now + 5 * 86400000).toISOString() }), true, 'an upcoming game must be shown');
assert.strictEqual(sandbox.isCurrentEvent({ date: new Date(now - 90 * 86400000).toISOString() }), false, 'a three-month-old final must be hidden');
assert.strictEqual(sandbox.isCurrentEvent({}), true, 'events without a date must not be dropped');
assert.strictEqual(sandbox.isCurrentEvent({ date: new Date(now - 10 * 86400000).toDateString() }), true, 'NRL-style date labels must be parsed');

// The NRL scraper must emit a date, or its out-of-season final can never age out.
const nrlFunction = fs.readFileSync(path.join(__dirname, '..', 'functions/api/nrl-scores.js'), 'utf8');
assert.ok(/date:\s*dateLabel/.test(nrlFunction), 'NRL events must carry a date for the 60-day window');

console.log('PASS - ' + leagues.length + ' leagues in ' + groups.size + ' sports, direct ESPN transport, league-scoped favourites, 60-day window');
