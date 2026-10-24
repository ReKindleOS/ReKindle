/*
 * Account deletion regression checks.
 *
 * Run: node scripts/test-account-deletion.js
 *
 * Covers the pure confirmation / recent-login / path-building rules that keep
 * `deleteAccount` safe, plus the handler's preconditions that must reject
 * before any destructive work happens. The actual cross-project sweep is I/O
 * and is verified manually with a test account (see
 * docs/agent/account-deletion.md).
 */
'use strict';

const assert = require('assert');
const path = require('path');

const lib = require('../firebase-functions/account-deletion-lib');

const problems = [];
function check(name, fn) {
    try {
        fn();
        console.log('  ok  ' + name);
    } catch (e) {
        problems.push(name + ': ' + e.message);
        console.error('  FAIL ' + name + ': ' + e.message);
    }
}

async function checkAsync(name, fn) {
    try {
        await fn();
        console.log('  ok  ' + name);
    } catch (e) {
        problems.push(name + ': ' + e.message);
        console.error('  FAIL ' + name + ': ' + e.message);
    }
}

console.log('account-deletion-lib');

check('confirmation matches case-insensitively and ignores surrounding spaces', function () {
    assert.strictEqual(lib.confirmationMatches('Alice', 'alice'), true);
    assert.strictEqual(lib.confirmationMatches('  ALICE ', 'alice'), true);
});

check('confirmation rejects empty, missing and wrong values', function () {
    assert.strictEqual(lib.confirmationMatches('', 'alice'), false);
    assert.strictEqual(lib.confirmationMatches('   ', 'alice'), false);
    assert.strictEqual(lib.confirmationMatches(null, 'alice'), false);
    assert.strictEqual(lib.confirmationMatches('bob', 'alice'), false);
});

check('confirmation cannot be satisfied by an empty username', function () {
    // A malformed profile with no username must never turn the typed check
    // into a no-op: '' === '' would otherwise be true.
    assert.strictEqual(lib.confirmationMatches('', ''), false);
    assert.strictEqual(lib.confirmationMatches('anything', ''), false);
});

check('recent auth accepts a token refreshed just now', function () {
    const now = Date.UTC(2026, 9, 24, 6, 0, 0);
    assert.strictEqual(lib.isRecentAuth(Math.floor(now / 1000) - 5, now), true);
    assert.strictEqual(lib.isRecentAuth(Math.floor(now / 1000) - 599, now), true);
    assert.strictEqual(lib.isRecentAuth(Math.floor(now / 1000) - 600, now), true);
    assert.strictEqual(lib.isRecentAuth(Math.floor(now / 1000) - 601, now), false);
});

check('recent auth rejects an old, future or missing auth_time', function () {
    const now = Date.UTC(2026, 9, 24, 6, 0, 0);
    assert.strictEqual(lib.isRecentAuth(Math.floor(now / 1000) - 601, now), false);
    assert.strictEqual(lib.isRecentAuth(Math.floor(now / 1000) + 120, now), false);
    assert.strictEqual(lib.isRecentAuth(0, now), false);
    assert.strictEqual(lib.isRecentAuth(undefined, now), false);
    assert.strictEqual(lib.isRecentAuth(NaN, now), false);
});

check('emailHandle strips the synthetic domain', function () {
    assert.strictEqual(lib.emailHandle('alice@rekindle.ink'), 'alice');
    assert.strictEqual(lib.emailHandle('first.last+tag@rekindle.ink'), 'first.last+tag');
    assert.strictEqual(lib.emailHandle(''), '');
    assert.strictEqual(lib.emailHandle(null), '');
});

check('pickUsername prefers the first non-empty trimmed value', function () {
    assert.strictEqual(lib.pickUsername(['', '  bob ', 'carol']), 'bob');
    assert.strictEqual(lib.pickUsername([null, undefined, 'carol']), 'carol');
    assert.strictEqual(lib.pickUsername([]), '');
    assert.strictEqual(lib.pickUsername(null), '');
});

check('uid validation rejects path separators and empty values', function () {
    assert.strictEqual(lib.isValidUid('AbC123'), true);
    assert.strictEqual(lib.isValidUid('uid-with_underscore'), true);
    assert.strictEqual(lib.isValidUid(''), false);
    assert.strictEqual(lib.isValidUid('uid/with/slashes'), false);
    assert.strictEqual(lib.isValidUid('uid.with.dots'), false);
    assert.strictEqual(lib.isValidUid(null), false);
});

check('path parts reject RTDB separators', function () {
    assert.strictEqual(lib.isSafePathPart('alice'), true);
    assert.strictEqual(lib.isSafePathPart('first_last+tag'), true);
    assert.strictEqual(lib.isSafePathPart('first.last+tag'), false); // '.' is not a legal RTDB key char
    assert.strictEqual(lib.isSafePathPart('alice/bob'), false);
    assert.strictEqual(lib.isSafePathPart('alice.bob'), false);
    assert.strictEqual(lib.isSafePathPart('alice bob'), false);
    assert.strictEqual(lib.isSafePathPart(''), false);
});

check('primary delete paths cover identity nodes and never touch moderation bans', function () {
    const paths = lib.buildPrimaryUserDeletePaths('uid123', 'alice');
    const keys = Object.keys(paths);
    ['users_public/uid123', 'user_cards/uid123', 'users_private/uid123',
        'presence/uid123', 'timeouts/uid123', 'moderators/uid123',
        'mail_rate_limits/uid123', 'kindlechat/user_limits/alice'].forEach(function (key) {
        assert.ok(keys.indexOf(key) !== -1, 'missing ' + key);
    });
    keys.forEach(function (key) {
        assert.strictEqual(paths[key], null);
        assert.ok(key !== 'banned_ips/uid123', 'must never delete IP bans');
        assert.ok(key.indexOf('mod_actions') === -1, 'must never delete moderator audit log');
        assert.ok(key.indexOf('automod') === -1, 'automod history keeps its retention window');
    });
});

check('primary delete paths omit an unsafe handle but keep uid nodes', function () {
    const paths = lib.buildPrimaryUserDeletePaths('uid123', 'bad/handle');
    assert.strictEqual(paths['kindlechat/user_limits/bad/handle'], undefined);
    assert.strictEqual(paths['users_public/uid123'], null);
});

check('invalid uid produces no destructive paths', function () {
    assert.deepStrictEqual(lib.buildPrimaryUserDeletePaths('bad/uid', 'alice'), {});
    assert.deepStrictEqual(lib.buildSocialUserDeletePaths('bad.uid'), {});
});

check('social delete paths cover rate limits, legacy caches, DMs prefs and profiles', function () {
    const paths = lib.buildSocialUserDeletePaths('uid123');
    ['users_public/uid123', 'user_cards/uid123', 'users_private/uid123',
        'timeouts/uid123', 'kindlechat/server_rate_limits/uid123',
        'kindlechat/user_recent/uid123', 'kindlechat/dm_prefs/uid123'].forEach(function (key) {
        assert.strictEqual(paths[key], null, 'missing ' + key);
    });
});

check('report ownership checks both reporter and reported user', function () {
    assert.strictEqual(lib.shouldDeleteReportForUser({ reporterId: 'u1', reportedUserId: 'u2' }, 'u1'), true);
    assert.strictEqual(lib.shouldDeleteReportForUser({ reporterId: 'u1', reportedUserId: 'u2' }, 'u2'), true);
    assert.strictEqual(lib.shouldDeleteReportForUser({ reporterId: 'u1', reportedUserId: 'u2' }, 'u3'), false);
    assert.strictEqual(lib.shouldDeleteReportForUser(null, 'u1'), false);
    assert.strictEqual(lib.shouldDeleteReportForUser({ reporterId: 'u1' }, 'bad/uid'), false);
});

check('summary counters start at zero and add numerically', function () {
    const summary = lib.emptySummary();
    assert.strictEqual(summary.chatMessages, 0);
    lib.addToSummary(summary, 'chatMessages', 3);
    lib.addToSummary(summary, 'chatMessages', '2');
    assert.strictEqual(summary.chatMessages, 5);
    lib.addToSummary(summary, 'chatMessages', NaN);
    assert.strictEqual(summary.chatMessages, 5);
});

(async function handlerTests() {
    console.log('deleteAccount preconditions');

    const { deleteAccount } = require('../firebase-functions/account-deletion');

    await checkAsync('rejects unauthenticated callers', async function () {
        await assert.rejects(
            () => deleteAccount({ auth: null, data: {} }, { socialApp: {} }),
            (e) => e.code === 'unauthenticated'
        );
    });

    await checkAsync('rejects when the social project is not configured', async function () {
        await assert.rejects(
            () => deleteAccount({
                auth: { uid: 'uid123', token: { email: 'alice@rekindle.ink', auth_time: Math.floor(Date.now() / 1000) } },
                data: { confirmation: 'alice' }
            }, {}),
            (e) => e.code === 'failed-precondition'
        );
    });

    await checkAsync('rejects a stale login before touching data', async function () {
        await assert.rejects(
            () => deleteAccount({
                auth: { uid: 'uid123', token: { email: 'alice@rekindle.ink', auth_time: Math.floor(Date.now() / 1000) - 3600 } },
                data: { confirmation: 'alice' }
            }, { socialApp: {} }),
            (e) => e.code === 'failed-precondition' && e.details && e.details.code === 'recent-login-required'
        );
    });

    await checkAsync('rejects a mismatched typed username before touching data', async function () {
        await assert.rejects(
            () => deleteAccount({
                auth: { uid: 'uid123', token: { email: 'alice@rekindle.ink', auth_time: Math.floor(Date.now() / 1000) } },
                data: { confirmation: 'bob' }
            }, { socialApp: {} }),
            (e) => e.code === 'permission-denied'
        );
    });

    await checkAsync('rejects a blank confirmation before touching data', async function () {
        await assert.rejects(
            () => deleteAccount({
                auth: { uid: 'uid123', token: { email: 'alice@rekindle.ink', auth_time: Math.floor(Date.now() / 1000) } },
                data: { confirmation: '   ' }
            }, { socialApp: {} }),
            (e) => e.code === 'invalid-argument'
        );
    });

    await checkAsync('rejects a non-string confirmation before touching data', async function () {
        await assert.rejects(
            () => deleteAccount({
                auth: { uid: 'uid123', token: { email: 'alice@rekindle.ink', auth_time: Math.floor(Date.now() / 1000) } },
                data: { confirmation: 12345 }
            }, { socialApp: {} }),
            (e) => e.code === 'invalid-argument'
        );
    });

    if (problems.length) {
        console.error('\nFAIL - ' + problems.length + ' account-deletion problem(s):');
        problems.forEach(function (p) { console.error('  ' + p); });
        process.exit(1);
    }
    console.log('\nPASS - account deletion checks (' + path.basename(__filename) + ')');
})().catch(function (e) {
    console.error('FATAL', e);
    process.exit(1);
});
