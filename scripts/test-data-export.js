/*
 * Data-export checks.
 *
 * Run: node scripts/test-data-export.js
 *
 * The export is client-only, but it must not leak tokens/keys/IPs or silently
 * omit an app's collection. This pins the redaction, the local-storage
 * allowlist, the manifest and the Settings wiring.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js', 'data-export.js'), 'utf8');
const settings = fs.readFileSync(path.join(ROOT, 'settings.html'), 'utf8');
const firestoreRules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

const local = {
    rekindle_language: 'de',
    rekindle_uid: 'abc',
    rekindle_is_pro: 'true',
    rekindle_location_manual: '{"city":"Sydney"}',
    chat_api_key: 'sk-secret',
    pixel_drawing_abc: '[[1]]',
    unrelated_key: 'nope'
};
const sandbox = {
    window: {
        localStorage: {
            get length() { return Object.keys(local).length; },
            key: function (i) { return Object.keys(local)[i]; },
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(local, k) ? local[k] : null; }
        }
    },
    document: {},
    URL: { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () { } },
    Blob: function () { },
    Date: Date,
    JSON: JSON,
    Object: Object,
    Array: Array,
    String: String,
    console: console,
    setTimeout: setTimeout
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'js/data-export.js' });
const exp = sandbox.window.RekindleDataExport;
assert.ok(exp, 'RekindleDataExport must be exported');

// --- redaction -------------------------------------------------------------
const dirty = {
    title: 'My notes',
    accessToken: 'secret-token',
    refresh_token: 'secret-refresh',
    apiKey: 'sk-live',
    substack_sid: 'sid',
    recovery: { hash: 'abc', salt: 'def' },
    hash: 'deadbeef',
    salt: 'cafebabe',
    ipAddress: '1.2.3.4',
    nested: { password: 'pw', keep: 'yes' },
    customEndpoint: 'https://example.com/?key=sk',
    createdAt: { toDate: function () { return new Date('2026-11-25T00:00:00Z'); } }
};
const clean = exp.sanitize(dirty);
assert.strictEqual(clean.title, 'My notes');
assert.strictEqual(clean.accessToken, undefined);
assert.strictEqual(clean.refresh_token, undefined);
assert.strictEqual(clean.apiKey, undefined);
assert.strictEqual(clean.substack_sid, undefined);
assert.strictEqual(clean.recovery, undefined);
assert.strictEqual(clean.hash, undefined);
assert.strictEqual(clean.salt, undefined);
assert.strictEqual(clean.ipAddress, undefined);
assert.strictEqual(clean.customEndpoint, undefined);
assert.strictEqual(clean.nested.password, undefined);
assert.strictEqual(clean.nested.keep, 'yes');
assert.strictEqual(clean.createdAt, '2026-11-25T00:00:00.000Z');

// --- local allowlist -------------------------------------------------------
const exportedLocal = exp.readLocalStorage();
assert.strictEqual(exportedLocal.rekindle_language, 'de');
assert.strictEqual(exportedLocal.pixel_drawing_abc, '[[1]]');
assert.strictEqual(exportedLocal.rekindle_uid, undefined, 'uid must not be exported');
assert.strictEqual(exportedLocal.rekindle_is_pro, undefined, 'membership cache must not be exported');
assert.strictEqual(exportedLocal.rekindle_location_manual, undefined, 'location must not be exported');
assert.strictEqual(exportedLocal.chat_api_key, undefined, 'API keys must not be exported');
assert.strictEqual(exportedLocal.unrelated_key, undefined, 'unrelated keys must not be exported');

// Static manifest coverage: every user subcollection used by a page should be
// either in the manifest or explicitly out of scope.
const html = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const used = new Set();
const re = /users['"]\)\.doc\([^)]*\)\.collection\(['"]([A-Za-z0-9_]+)['"]\)/g;
let m;
while ((m = re.exec(html))) used.add(m[1]);
const manifest = new Set();
Object.keys(exp.CATEGORIES).forEach(k => exp.CATEGORIES[k].collections.forEach(c => manifest.add(c)));
const outOfScope = new Set([
    // social project, intentionally not in v1
    'topics', 'neighbourhood_posts', 'comments', 'pollVotes',
    // top-level / owner tooling
    'config', 'leaderboards', 'rooms', 'messages'
]);
for (const name of used) {
    assert.ok(manifest.has(name) || outOfScope.has(name),
        'user collection is neither exported nor explicitly out of scope: ' + name);
}

// --- settings wiring -------------------------------------------------------
assert.ok(settings.indexOf('js/data-export.js?v=2') !== -1, 'settings must load the export helper');
assert.ok(settings.indexOf('openExportModal()') !== -1, 'settings must open the export modal');
assert.ok(settings.indexOf('startDataExport()') !== -1, 'settings must start the export');
assert.ok(settings.indexOf('export-category-list') !== -1, 'settings must render category choices');
assert.ok(settings.indexOf('recovery') !== -1, 'settings must include the recovery row');

// No Cloud Function call in the export helper.
assert.ok(source.indexOf('httpsCallable') === -1, 'data export must not call a Cloud Function');
assert.ok(source.indexOf('fetch(') === -1, 'data export must not upload data');

console.log('PASS - data export (redaction, local allowlist, manifest, wiring)');
