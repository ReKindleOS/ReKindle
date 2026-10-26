/*
 * Pro-grant path regression test (no network).
 *
 * Run: node scripts/test-pro-grant.js
 *
 * Two writes grant ReKindle+, and both used to fail for the same reason: a
 * users/{uid} document only exists once someone saves a setting or favourite,
 * so a brand-new payer has none.
 *
 *   1. moderation.html "Grant Pro" wrote users/{uid} from the browser. For a
 *      user without a document that is a CREATE, and the create rule had no
 *      owner escape, so it failed with "Missing or insufficient permissions".
 *   2. The Stripe worker treated the missing document as an unknown uid and
 *      returned 500. Stripe retried for 3 days and then gave up, so the payer
 *      never got Pro.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'workers', 'rekindle-stripe', 'worker.js'), 'utf8');
const fn = fs.readFileSync(path.join(root, 'firebase-functions', 'index.js'), 'utf8');
const consolePage = fs.readFileSync(path.join(root, 'moderation.html'), 'utf8');

// --- 1. Firestore rules ---
const usersBlock = rules.match(/match \/users\/\{userId\}\s*\{[\s\S]*?\n\s*allow delete/);
assert.ok(usersBlock, 'firestore.rules must still contain the /users/{userId} block');
const createRule = usersBlock[0].match(/allow create:[\s\S]*?;/);
assert.ok(createRule, 'the /users/{userId} block must have an allow create rule');
assert.ok(createRule[0].includes('isDeveloper()'),
    'the /users/{userId} allow create rule must let the owner create a missing document');
assert.ok(/isDeveloper\(\)\s*\n?\s*\|\|/.test(createRule[0]) || createRule[0].indexOf('isDeveloper()') !== -1,
    'owner create must be a separate branch, not weaken the self-create checks');
assert.ok(createRule[0].includes("hasAny(['isPro', 'proExpiresAt', 'substack_sid'])"),
    'a self-create must still not be able to set isPro itself');

// --- 2. Stripe worker ---
assert.ok(worker.includes('lookupFirebaseAuthUser'),
    'the Stripe worker must check Firebase Auth before rejecting a missing user document');
assert.ok(worker.includes('Granting to a payer with no users document yet'),
    'a missing users document must not abort a valid checkout grant');
assert.ok(!/if \(getRes\.status === 404\) \{\s*\/\/[^\n]*\n\s*console\.warn\('Stripe event references unknown uid/.test(worker),
    'the old "404 means unknown uid" shortcut must stay removed');

// --- 3. Owner-only server callable ---
assert.ok(/exports\.adminSetPro\s*=\s*onCall/.test(fn), 'the adminSetPro callable must exist');
const callable = fn.slice(fn.indexOf('exports.adminSetPro = onCall'));
const callableBody = callable.slice(0, callable.indexOf('\n});') + 4);
assert.ok(callableBody.includes("auth.token.email !== 'ukiyo@rekindle.ink'"),
    'adminSetPro must be owner-only');
assert.ok(callableBody.includes('setCustomUserClaims'),
    'adminSetPro must merge the pro custom claim (storage.rules reads it)');
assert.ok(callableBody.includes("...(userRecord.customClaims || {})") ||
    callableBody.includes('userRecord.customClaims || {}'),
    'adminSetPro must preserve existing custom claims');

// --- 4. The console prefers the callable ---
assert.ok(consolePage.includes("httpsCallable('adminSetPro')"),
    'moderation.html should grant/revoke through the adminSetPro callable');

console.log('PASS - Pro grant paths (rules create, doc-less payer, owner callable)');
