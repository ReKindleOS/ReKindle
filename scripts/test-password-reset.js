/*
 * Forgotten-password reset regression checks.
 *
 * Run: node scripts/test-password-reset.js
 *
 * Covers the pure policy/rate-limit rules in
 * `firebase-functions/password-reset-lib.js` and the handler preconditions that
 * must reject before Auth is touched. The handler is exercised with injected
 * fake Auth/RTDB dependencies, so no credentials or emulator are needed.
 *
 * The real reset (Auth update + RTDB audit) is verified manually against a
 * throwaway account; see docs/agent/password-recovery.md.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const lib = require('../firebase-functions/password-reset-lib');

/*
 * CI installs only the root dependencies, where `firebase-functions` may be
 * absent. `password-reset.js` imports its runtime at load time. Follow the
 * account-deletion test: stub only when the real package cannot be resolved,
 * so a broken import path still fails loudly in a functions checkout.
 */
function ensureFunctionsRuntime() {
    try {
        require.resolve('firebase-functions/logger', {
            paths: [path.join(__dirname, '..', 'firebase-functions')]
        });
        return;
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw e;
    }

    class HttpsError extends Error {
        constructor(code, message, details) {
            super(message);
            this.name = 'HttpsError';
            this.code = code;
            this.details = details;
        }
    }
    function noop() { }
    const stubs = {
        'firebase-functions/logger': { log: noop, info: noop, warn: noop, error: noop, debug: noop },
        'firebase-functions/v2/https': { HttpsError: HttpsError }
    };
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function (request) {
        if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
        return originalLoad.apply(this, arguments);
    };
    console.log('note: firebase-functions is not installed; using runtime stubs');
}

ensureFunctionsRuntime();

const handler = require('../firebase-functions/password-reset');

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

/* -------------------------------------------------------------------------- */
/* Fake RTDB                                                                   */
/* -------------------------------------------------------------------------- */

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createFakeRtdb(initial) {
    const data = clone(initial) || {};
    const pushes = [];
    let pushFails = false;

    function getPath(pathValue) {
        if (!pathValue) return data;
        const parts = String(pathValue).split('/');
        let node = data;
        for (let i = 0; i < parts.length; i++) {
            if (node === null || typeof node !== 'object') return null;
            node = node[parts[i]];
            if (node === undefined) return null;
        }
        return clone(node);
    }

    function setPath(pathValue, value) {
        const parts = String(pathValue).split('/');
        let node = data;
        for (let i = 0; i < parts.length - 1; i++) {
            if (node[parts[i]] === null || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
            node = node[parts[i]];
        }
        if (value === null) delete node[parts[parts.length - 1]];
        else node[parts[parts.length - 1]] = clone(value);
    }

    function makeRef(pathValue) {
        return {
            path: pathValue,
            once: async function () {
                const value = getPath(pathValue);
                return { val: function () { return value; }, exists: function () { return value !== null; } };
            },
            transaction: async function (update) {
                const current = getPath(pathValue);
                const next = update(current);
                if (next === undefined) {
                    return { committed: false, snapshot: { val: function () { return current; } } };
                }
                setPath(pathValue, next);
                return { committed: true, snapshot: { val: function () { return clone(next); } } };
            },
            push: async function (value) {
                if (pushFails) throw new Error('push failed');
                pushes.push({ path: pathValue, value: clone(value) });
                return { key: '-fake' };
            }
        };
    }

    return {
        ref: makeRef,
        pushes: pushes,
        get: function (pathValue) { return getPath(pathValue); },
        setPushFailure: function (fail) { pushFails = !!fail; }
    };
}

function createAuthSpy(failure) {
    const calls = [];
    return {
        calls: calls,
        updateUser: async function (uid, properties) {
            if (failure) throw failure;
            calls.push({ uid: uid, properties: clone(properties) });
            return { uid: uid };
        }
    };
}

const NOW = 1760000000000;
const UID = 'abc123';

function makeRequest(overrides) {
    const base = {
        auth: {
            uid: UID,
            token: { email: 'alice@rekindle.ink', auth_time: Math.floor(NOW / 1000) - 3600 }
        },
        data: { username: 'Alice', newPassword: 'correct-horse-battery' }
    };
    const merged = overrides || {};
    return {
        auth: merged.auth === undefined ? base.auth : merged.auth,
        data: merged.data === undefined ? base.data : merged.data
    };
}

function makeDeps(rtdb, auth, options) {
    const opts = options || {};
    const deps = {
        auth: auth,
        rtdb: rtdb,
        now: function () { return NOW; },
        serverTimestamp: opts.serverTimestamp === undefined ? NOW : opts.serverTimestamp
    };
    return deps;
}

async function expectHttpsError(fn, code, detailCode) {
    await assert.rejects(fn, function (err) {
        assert.strictEqual(err.code, code, 'expected code ' + code + ', got ' + err.code + ' (' + err.message + ')');
        if (detailCode) {
            assert.ok(err.details && err.details.code === detailCode,
                'expected details.code ' + detailCode + ', got ' + JSON.stringify(err.details));
        }
        return true;
    });
}

/* -------------------------------------------------------------------------- */
/* Password policy                                                             */
/* -------------------------------------------------------------------------- */

check('policy requires a non-empty password', function () {
    assert.strictEqual(lib.validateNewPassword('', 'alice'), lib.PASSWORD_REASONS.REQUIRED);
    assert.strictEqual(lib.validateNewPassword('   ', 'alice'), lib.PASSWORD_REASONS.REQUIRED);
    assert.strictEqual(lib.validateNewPassword(null, 'alice'), lib.PASSWORD_REASONS.REQUIRED);
    assert.strictEqual(lib.validateNewPassword(undefined, 'alice'), lib.PASSWORD_REASONS.REQUIRED);
    assert.strictEqual(lib.validateNewPassword(12345678, 'alice'), lib.PASSWORD_REASONS.REQUIRED);
});

check('policy enforces the 8 character minimum', function () {
    assert.strictEqual(lib.MIN_PASSWORD_LENGTH, 8);
    assert.strictEqual(lib.validateNewPassword('1234567', 'alice'), lib.PASSWORD_REASONS.TOO_SHORT);
    assert.strictEqual(lib.validateNewPassword('12345678', 'alice'), '');
    assert.strictEqual(lib.validateNewPassword('correct horse', 'alice'), '');
});

check('policy rejects passwords longer than 128 characters', function () {
    assert.strictEqual(lib.MAX_PASSWORD_LENGTH, 128);
    assert.strictEqual(lib.validateNewPassword('a'.repeat(128), 'alice'), '');
    assert.strictEqual(lib.validateNewPassword('a'.repeat(129), 'alice'), lib.PASSWORD_REASONS.TOO_LONG);
});

check('policy rejects the username itself', function () {
    assert.strictEqual(lib.validateNewPassword('alice123', 'alice'), '');
    assert.strictEqual(lib.validateNewPassword('aliceuser', 'aliceuser'), lib.PASSWORD_REASONS.TOO_GUESSABLE);
    assert.strictEqual(lib.validateNewPassword('AliceUser', 'aliceuser'), lib.PASSWORD_REASONS.TOO_GUESSABLE);
    assert.strictEqual(lib.validateNewPassword('  ALICEUSER  ', 'aliceuser'), lib.PASSWORD_REASONS.TOO_GUESSABLE);
});

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                               */
/* -------------------------------------------------------------------------- */

check('fresh state allows the first reset', function () {
    const decision = lib.decideResetAttempt(null, NOW);
    assert.strictEqual(decision.allowed, true);
    assert.deepStrictEqual(decision.nextAttempts, [NOW]);
});

check('three resets inside the hour are allowed, the fourth is not', function () {
    let state = lib.buildResetLimitState([], NOW);
    for (let i = 0; i < lib.MAX_RESETS_PER_WINDOW; i++) {
        const at = NOW - (i * 60 * 1000);
        const decision = lib.decideResetAttempt(state, at);
        assert.strictEqual(decision.allowed, true, 'attempt ' + (i + 1) + ' should be allowed');
        state = lib.buildResetLimitState(decision.nextAttempts, at);
    }
    const blocked = lib.decideResetAttempt(state, NOW);
    assert.strictEqual(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 3600,
        'retryAfterSeconds should be within the hour, got ' + blocked.retryAfterSeconds);
    assert.strictEqual(blocked.nextAttempts, null);
});

check('the hourly window slides', function () {
    const state = lib.buildResetLimitState([NOW - 61 * 60 * 1000, NOW - 50 * 60 * 1000, NOW - 40 * 60 * 1000], NOW);
    const decision = lib.decideResetAttempt(state, NOW);
    assert.strictEqual(decision.allowed, true);
    assert.deepStrictEqual(decision.nextAttempts,
        [NOW - 61 * 60 * 1000, NOW - 50 * 60 * 1000, NOW - 40 * 60 * 1000, NOW]);
});

check('five resets inside the day block until the oldest expires', function () {
    const attempts = [];
    for (let i = 0; i < lib.MAX_RESETS_PER_DAY; i++) attempts.push(NOW - (i + 2) * 60 * 60 * 1000);
    // All are older than an hour, so the hourly rule does not fire.
    const decision = lib.decideResetAttempt(lib.buildResetLimitState(attempts, NOW), NOW);
    assert.strictEqual(decision.allowed, false);
    assert.ok(decision.retryAfterSeconds > 0);
    assert.ok(decision.retryAfterSeconds <= 24 * 60 * 60);
});

check('attempts older than a day are discarded', function () {
    const stale = NOW - (lib.RESET_DAY_MS + 60 * 1000);
    const decision = lib.decideResetAttempt(
        lib.buildResetLimitState([stale, stale, stale, stale, stale], NOW), NOW);
    assert.strictEqual(decision.allowed, true);
    assert.deepStrictEqual(decision.nextAttempts, [NOW]);
});

check('garbage rate-limit state is ignored, not trusted', function () {
    const decision = lib.decideResetAttempt(
        { attempts: ['nope', null, -1, 0, NaN, Infinity, NOW] }, NOW);
    assert.strictEqual(decision.allowed, true);
    assert.deepStrictEqual(decision.nextAttempts, [NOW]);
});

check('an invalid clock denies instead of allowing', function () {
    assert.strictEqual(lib.decideResetAttempt(null, 0).allowed, false);
    assert.strictEqual(lib.decideResetAttempt(null, -1).allowed, false);
    assert.strictEqual(lib.decideResetAttempt(null, NaN).allowed, false);
});

check('a burst of attempts stays blocked', function () {
    const attempts = [];
    for (let i = 0; i < 30; i++) attempts.push(NOW - 1000 - i);
    const decision = lib.decideResetAttempt(lib.buildResetLimitState(attempts, NOW), NOW);
    assert.strictEqual(decision.allowed, false, '30 attempts in the day must stay blocked');
});

check('path builders reject unsafe uids', function () {
    assert.strictEqual(lib.passwordResetLimitPath(UID), 'password_reset_limits/' + UID);
    assert.strictEqual(lib.securityEventsPath(UID), 'security_events/' + UID);
    assert.strictEqual(lib.passwordResetLimitPath('../x'), '');
    assert.strictEqual(lib.securityEventsPath('a/b'), '');
    assert.strictEqual(lib.securityEventsPath(''), '');
    assert.strictEqual(lib.securityEventsPath(null), '');
});

/* -------------------------------------------------------------------------- */
/* Handler preconditions                                                       */
/* -------------------------------------------------------------------------- */

async function handlerCheck(name, fn) {
    await checkAsync(name, fn);
}

(async function () {
    await handlerCheck('rejects a caller with no session', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy();
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(makeRequest({ auth: null }), makeDeps(rtdb, auth));
        }, 'unauthenticated');
        assert.strictEqual(auth.calls.length, 0);
    });

    await handlerCheck('rejects a missing username or password before any write', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy();
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(
                makeRequest({ data: { username: '', newPassword: 'correct-horse' } }), makeDeps(rtdb, auth));
        }, 'invalid-argument', 'missing-fields');
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(
                makeRequest({ data: { username: 'alice', newPassword: '' } }), makeDeps(rtdb, auth));
        }, 'invalid-argument', 'missing-fields');
        assert.strictEqual(auth.calls.length, 0);
    });

    await handlerCheck('rejects a mismatched username and consumes nothing', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy();
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(
                makeRequest({ data: { username: 'bob', newPassword: 'correct-horse' } }), makeDeps(rtdb, auth));
        }, 'permission-denied', 'confirmation-mismatch');
        assert.strictEqual(auth.calls.length, 0);
        assert.strictEqual(rtdb.get('password_reset_limits/' + UID), null);
    });

    await handlerCheck('accepts a case-insensitive username with whitespace', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy();
        const result = await handler.resetForgottenPassword(
            makeRequest({ data: { username: '  ALICE ', newPassword: 'correct-horse' } }), makeDeps(rtdb, auth));
        assert.strictEqual(result.success, true);
        assert.strictEqual(auth.calls.length, 1);
    });

    await handlerCheck('rejects a short password before touching Auth', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy();
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(
                makeRequest({ data: { username: 'alice', newPassword: 'short12' } }), makeDeps(rtdb, auth));
        }, 'invalid-argument', 'password-too-short');
        assert.strictEqual(auth.calls.length, 0);
        assert.strictEqual(rtdb.get('password_reset_limits/' + UID), null);
    });

    await handlerCheck('rejects the username used as the password', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy();
        const request = makeRequest({
            auth: { uid: UID, token: { email: 'aliceuser@rekindle.ink', auth_time: 1 } },
            data: { username: 'aliceuser', newPassword: 'AliceUser' }
        });
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(request, makeDeps(rtdb, auth));
        }, 'invalid-argument', 'password-too-guessable');
        assert.strictEqual(auth.calls.length, 0);
    });

    await handlerCheck('changes the password and records the attempt and audit entry', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy();
        const result = await handler.resetForgottenPassword(makeRequest(), makeDeps(rtdb, auth));

        assert.deepStrictEqual(result, { success: true, changedAt: NOW });
        assert.deepStrictEqual(auth.calls, [{ uid: UID, properties: { password: 'correct-horse-battery' } }]);

        assert.deepStrictEqual(rtdb.get('password_reset_limits/' + UID), { attempts: [NOW], updatedAt: NOW });

        assert.strictEqual(rtdb.pushes.length, 1);
        assert.strictEqual(rtdb.pushes[0].path, 'security_events/' + UID);
        assert.strictEqual(rtdb.pushes[0].value.type, 'password_reset_without_current');
        assert.strictEqual(rtdb.pushes[0].value.at, NOW);
        // The password must never reach the audit trail or any stored node.
        const stored = JSON.stringify(rtdb.pushes) + JSON.stringify(rtdb.get('password_reset_limits/' + UID));
        assert.ok(stored.indexOf('correct-horse-battery') === -1, 'password leaked into RTDB');
    });

    await handlerCheck('blocks a fourth reset inside the hour without touching Auth', async function () {
        // Three attempts in the last few minutes.
        const seeded = createFakeRtdb({
            password_reset_limits: {
                [UID]: {
                    attempts: [NOW - 3000, NOW - 2000, NOW - 1000],
                    updatedAt: NOW - 1000
                }
            }
        });
        const auth = createAuthSpy();
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(makeRequest(), makeDeps(seeded, auth));
        }, 'resource-exhausted', 'rate-limited');
        assert.strictEqual(auth.calls.length, 0);
        assert.strictEqual(seeded.pushes.length, 0);
        const limit = seeded.get('password_reset_limits/' + UID);
        assert.deepStrictEqual(limit.attempts, [NOW - 3000, NOW - 2000, NOW - 1000], 'blocked call must not consume an attempt');
    });

    await handlerCheck('returns a retry delay when rate limited', async function () {
        const seeded = createFakeRtdb({
            password_reset_limits: {
                [UID]: { attempts: [NOW - 1000, NOW - 500, NOW], updatedAt: NOW }
            }
        });
        const auth = createAuthSpy();
        await assert.rejects(function () {
            return handler.resetForgottenPassword(makeRequest(), makeDeps(seeded, auth));
        }, function (err) {
            assert.strictEqual(err.code, 'resource-exhausted');
            assert.ok(err.details && err.details.retryAfterSeconds >= 1);
            return true;
        });
    });

    await handlerCheck('a failed Auth update still consumes an attempt', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy({ code: 'auth/internal-error', message: 'boom' });
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(makeRequest(), makeDeps(rtdb, auth));
        }, 'internal');
        const limit = rtdb.get('password_reset_limits/' + UID);
        assert.deepStrictEqual(limit.attempts, [NOW]);
        assert.strictEqual(rtdb.pushes.length, 0);
    });

    await handlerCheck('maps a missing Auth user to not-found', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy({ code: 'auth/user-not-found', message: 'gone' });
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(makeRequest(), makeDeps(rtdb, auth));
        }, 'not-found', 'account-missing');
    });

    await handlerCheck('maps weak-password rejections to invalid-argument', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy({ code: 'auth/password-does-not-meet-requirements', message: 'policy' });
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(makeRequest(), makeDeps(rtdb, auth));
        }, 'invalid-argument', 'password-rejected');
    });

    await handlerCheck('an audit failure does not fail the password change', async function () {
        const rtdb = createFakeRtdb({});
        rtdb.setPushFailure(true);
        const auth = createAuthSpy();
        const result = await handler.resetForgottenPassword(makeRequest(), makeDeps(rtdb, auth));
        assert.strictEqual(result.success, true);
        assert.strictEqual(auth.calls.length, 1);
    });

    await handlerCheck('falls back to users_public when the token has no email', async function () {
        const rtdb = createFakeRtdb({ users_public: { [UID]: { username: 'alice' } } });
        const auth = createAuthSpy();
        const request = makeRequest({
            auth: { uid: UID, token: { email: '', auth_time: 1 } },
            data: { username: 'Alice', newPassword: 'correct-horse' }
        });
        const result = await handler.resetForgottenPassword(request, makeDeps(rtdb, auth));
        assert.strictEqual(result.success, true);
    });

    await handlerCheck('refuses when no username can be resolved', async function () {
        const rtdb = createFakeRtdb({});
        const auth = createAuthSpy();
        const request = makeRequest({
            auth: { uid: UID, token: {} },
            data: { username: 'alice', newPassword: 'correct-horse' }
        });
        await expectHttpsError(function () {
            return handler.resetForgottenPassword(request, makeDeps(rtdb, auth));
        }, 'permission-denied', 'confirmation-mismatch');
        assert.strictEqual(auth.calls.length, 0);
    });

    if (problems.length) {
        console.error('FAIL - ' + problems.length + ' problem(s):');
        problems.forEach(function (problem) { console.error('  ' + problem); });
        process.exit(1);
    }
    console.log('PASS - password reset policy, rate limits and handler preconditions');
})().catch(function (err) {
    console.error('FAIL - unexpected error:', err);
    process.exit(1);
});
