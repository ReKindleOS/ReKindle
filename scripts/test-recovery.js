/*
 * Recovery-code checks.
 *
 * Run: node scripts/test-recovery.js
 *
 * Pure lib tests plus static wiring. The handler itself (firebase-functions/
 * recovery.js) is not required here: CI installs root deps only and must not
 * import firebase-functions. The handler's logic is exercised through the pure
 * lib and the deploy-time smoke test.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const lib = require('../firebase-functions/recovery-lib');

// --- code shape ------------------------------------------------------------
assert.strictEqual(lib.normaliseCode('abcd-efgh jkmn'), 'ABCDEFGHJ KMN'.replace(' ', ''));
assert.strictEqual(lib.isValidCode('2345-6789-ABCD-EFGH-JKMN'), true);
assert.strictEqual(lib.isValidCode('2345-6789-ABCD-EFGH-JKM'), false);
assert.strictEqual(lib.isValidCode('2345-6789-ABCD-EFGH-JKM0'), false, '0 is not in the alphabet');
assert.strictEqual(lib.isValidCode('2345-6789-ABCD-EFGH-JKMI'), false, 'I is not in the alphabet');
assert.strictEqual(lib.isValidUsername('Alice123'), true);
assert.strictEqual(lib.isValidUsername('alice@example.com'), false);
assert.strictEqual(lib.isValidUsername(''), false);

// --- hashing ---------------------------------------------------------------
const a = lib.hashCode('uid1', 'salt1', '2345-6789-ABCD-EFGH-JKMN');
const b = lib.hashCode('uid1', 'salt1', '23456789ABCDEFGHJKMN');
const c = lib.hashCode('uid2', 'salt1', '23456789ABCDEFGHJKMN');
assert.strictEqual(a, b, 'grouping must not change the hash');
assert.notStrictEqual(a, c, 'hash must be bound to the uid');
assert.ok(/^[0-9a-f]{64}$/.test(a), 'sha-256 hex');
assert.strictEqual(lib.safeEqualHex(a, b), true);
assert.strictEqual(lib.safeEqualHex(a, c), false);
assert.strictEqual(lib.safeEqualHex(a, 'ab'), false);
assert.strictEqual(lib.safeEqualHex('', ''), false);

// --- rate limit ------------------------------------------------------------
const now = Date.UTC(2026, 10, 25, 0, 0, 0);
let state = null;
for (let i = 0; i < 3; i++) {
    const decision = lib.decideRecoveryAttempt(state, now + i * 1000);
    assert.strictEqual(decision.allowed, true, 'attempt ' + i);
    state = lib.buildLimitState(decision.nextAttempts, now + i * 1000);
}
const blocked = lib.decideRecoveryAttempt(state, now + 5000);
assert.strictEqual(blocked.allowed, false, 'fourth attempt in the window must be blocked');
assert.ok(blocked.retryAfterSeconds > 0);

// --- password policy -------------------------------------------------------
assert.strictEqual(lib.passwordReason('short', 'alice'), 'password-too-short');
assert.strictEqual(lib.passwordReason('alicealice', 'AliceAlice'), 'password-too-guessable');
assert.strictEqual(lib.passwordReason('a-good-password-42', 'alice'), '');

// --- static wiring ---------------------------------------------------------
const settings = fs.readFileSync(path.join(ROOT, 'settings.html'), 'utf8');
const recover = fs.readFileSync(path.join(ROOT, 'recover.html'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'rtdb-rules.json'), 'utf8'));
const functions = fs.readFileSync(path.join(ROOT, 'firebase-functions', 'index.js'), 'utf8');
const deletion = fs.readFileSync(path.join(ROOT, 'firebase-functions', 'account-deletion-lib.js'), 'utf8');

assert.ok(settings.indexOf('js/recovery.js?v=1') !== -1, 'settings must load the recovery helper');
assert.ok(settings.indexOf('openRecoveryModal()') !== -1, 'settings must open the recovery modal');
assert.ok(settings.indexOf("doc('recovery')") !== -1, 'settings must write the recovery record');
assert.ok(recover.indexOf('resetWithRecoveryCode') !== -1, 'recover page must call the callable');
assert.ok(recover.indexOf('js/recovery.js?v=1') !== -1, 'recover page must load the helper');
assert.ok(index.indexOf('recover.html') !== -1, 'login must link to the recovery page');
assert.ok(functions.indexOf('resetWithRecoveryCode') !== -1, 'callable must be exported');
assert.ok(rules.rules.recovery_limits && rules.rules.recovery_limits['.read'] === false,
    'recovery_limits must be service-account only');
assert.ok(deletion.indexOf("'recovery_limits'") !== -1, 'account deletion must remove recovery_limits');

// Browser helper has a pure SHA-256 fallback for older WebKit; it must match
// the server hash exactly.
const clientSandbox = { window: { crypto: { getRandomValues: function (a) { return a; } } } };
clientSandbox.window.window = clientSandbox.window;
vm.createContext(clientSandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'recovery.js'), 'utf8'), clientSandbox, { filename: 'js/recovery.js' });
const client = clientSandbox.window.RekindleRecovery;
client.hashCode('uid1', 'salt1', '2345-6789-ABCD-EFGH-JKMN').then(function (clientHash) {
    const serverHash = crypto.createHash('sha256')
        .update('uid1:salt1:23456789ABCDEFGHJKMN').digest('hex');
    assert.strictEqual(clientHash, serverHash, 'client and server hashes must agree');
    assert.strictEqual(client.isValidCode('2345-6789-ABCD-EFGH-JKMN'), true);
    assert.strictEqual(client.isValidCode('2345-6789-ABCD-EFGH-JKM0'), false);
    console.log('PASS - recovery code (hash, rate limit, policy, wiring)');
}).catch(function (error) {
    console.error(error);
    process.exit(1);
});
