/*
 * The BYO AI key migration in chat.html.
 *
 * Run: node scripts/test-chat-key-migration.js
 *
 * History this pins (all in chat.html):
 *   - 2026-04-22 .. 2026-05-14: `chat_api_key` was stored in plain text.
 *   - 2026-05-14 onward: stored through setSecureItem (base64 + XOR), so the
 *     legacy value is already obfuscated when the 2026-11-24 per-account
 *     scoping migration reads it.
 *   - 2026-11-24: a build live for about an hour re-obfuscated that raw value,
 *     leaving the scoped key double-encoded (unreadable). readStoredApiKey()
 *     repairs those.
 *
 * The migration must therefore be format-aware: copy an obfuscated legacy
 * value through the accessors (never raw, never re-obfuscated), and wrap a
 * plain legacy value exactly once.
 *
 * Hermetic: reads the checked-in HTML and runs its marked helper block.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'chat.html'), 'utf8');

const START = '// ---- chat key storage helpers';
const END = '// ---- end chat key storage helpers ----';
const start = html.indexOf(START);
const end = html.indexOf(END);
assert.ok(start !== -1 && end > start, 'chat.html must keep the marked chat key helper block');
const block = html.slice(start, end);

const UID = 'user-1';
const SCOPED = 'chat_api_key:' + UID;

function harness(seed, uid) {
    const store = new Map(Object.entries(seed || {}));
    const sandbox = {
        localStorage: {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: (key) => store.delete(key)
        },
        currentUserId: uid === undefined ? UID : uid,
        firebase: { auth: () => ({ currentUser: null }) },
        btoa,
        atob,
        console
    };
    vm.createContext(sandbox);
    vm.runInContext(block, sandbox, { filename: 'chat.html:chat-key-helpers' });
    return { sandbox, store };
}

/* ---- 1. the normal case: legacy value written by setSecureItem ---- */
{
    const key = 'sk-proj-abc123-EXAMPLE';
    const { sandbox, store } = harness({ rekindle_uid: UID });
    store.set('chat_api_key', sandbox.obfuscate(key));
    sandbox.migrateLegacyApiKey();
    assert.strictEqual(sandbox.readStoredApiKey(), key, 'an obfuscated legacy key must survive the migration');
    assert.strictEqual(store.has('chat_api_key'), false, 'the legacy key must be removed after migrating');
}

/* ---- 2. a plain legacy key (pre-2026-05-14 devices) ---- */
{
    const key = 'sk-ant-api03-plain-example';
    const { sandbox } = harness({ chat_api_key: key, rekindle_uid: UID });
    sandbox.migrateLegacyApiKey();
    assert.strictEqual(sandbox.readStoredApiKey(), key, 'a plain legacy key must be wrapped once, not lost');
}

/* ---- 3. a plain legacy key that looks like base64 (hex keys) ---- */
{
    const key = '0123456789abcdef0123456789abcdef';
    const { sandbox } = harness({ chat_api_key: key, rekindle_uid: UID });
    sandbox.migrateLegacyApiKey();
    assert.strictEqual(sandbox.readStoredApiKey(), key, 'a plain base64-shaped key must not be decoded as obfuscated');
}

/* ---- 4. repair of the double-encoded values from the 2026-11-24 build ---- */
{
    const key = 'sk-proj-double-encoded';
    const { sandbox, store } = harness({ rekindle_uid: UID });
    store.set(SCOPED, sandbox.obfuscate(sandbox.obfuscate(key)));
    assert.strictEqual(sandbox.readStoredApiKey(), key, 'a double-encoded stored key must be recovered');
    assert.strictEqual(store.get(SCOPED), sandbox.obfuscate(key), 'the repair must rewrite the value single-encoded');
    assert.strictEqual(sandbox.readStoredApiKey(), key, 'the repaired value must read back cleanly');
}

/* ---- 5. a healthy key that happens to be base64 must not be "repaired" ---- */
{
    const key = 'abcdef0123456789abcdef0123456789';
    const { sandbox, store } = harness({ rekindle_uid: UID });
    const healthy = sandbox.obfuscate(key);
    store.set(SCOPED, healthy);
    assert.strictEqual(sandbox.readStoredApiKey(), key, 'a genuine base64-shaped key must be left alone');
    assert.strictEqual(store.get(SCOPED), healthy, 'a healthy stored value must not be rewritten');
}

/* ---- 6. a different account on the device is never migrated ---- */
{
    const otherKey = 'sk-other-user';
    const { sandbox, store } = harness({ rekindle_uid: 'user-2' });
    store.set('chat_api_key', sandbox.obfuscate(otherKey));
    sandbox.migrateLegacyApiKey();
    assert.strictEqual(store.has('chat_api_key'), true, "another account's legacy key must be left for its owner");
    assert.strictEqual(store.has(SCOPED), false, 'nothing may be written for the wrong account');
}

/* ---- 7. an existing scoped key is not overwritten by a stale legacy one ---- */
{
    const key = 'sk-current';
    const { sandbox, store } = harness({ rekindle_uid: UID });
    store.set(SCOPED, sandbox.obfuscate(key));
    store.set('chat_api_key', sandbox.obfuscate('sk-stale'));
    sandbox.migrateLegacyApiKey();
    assert.strictEqual(sandbox.readStoredApiKey(), key, 'the current account key must win over a stale legacy copy');
}

/* ---- 8. signed out: the legacy key is left untouched ---- */
{
    const { sandbox, store } = harness({ chat_api_key: 'sk-guest' }, null);
    sandbox.migrateLegacyApiKey();
    assert.strictEqual(store.has('chat_api_key'), true, 'a signed-out visitor must not consume the legacy key');
    assert.strictEqual(store.has('chat_api_key:anon'), false, 'nothing may be written under the anon uid');
}

/* ---- 9. no key at all stays empty (never "undefined"/garbage) ---- */
{
    const { sandbox } = harness({ rekindle_uid: UID });
    sandbox.migrateLegacyApiKey();
    assert.strictEqual(sandbox.readStoredApiKey(), null, 'an absent key must read as null');
}

console.log('PASS - chat key migration: obfuscated + plain legacy, double-encode repair, per-account isolation');
