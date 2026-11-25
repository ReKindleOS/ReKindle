/*
 * Guard the shared Google OAuth redirect handling.
 * Run: node scripts/test-google-oauth.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'google-oauth.js'), 'utf8');

function load(location) {
    let replaced = null;
    const sandbox = {
        URLSearchParams: URLSearchParams,
        document: { title: 'Calendar' },
        window: {
            location: location,
            history: {
                replaceState: function (state, title, url) { replaced = url; }
            }
        }
    };
    sandbox.window.window = sandbox.window;
    vm.runInNewContext(src, sandbox);
    return { window: sandbox.window, replaced: function () { return replaced; } };
}

let ctx = load({ origin: 'https://rekindle.ink', pathname: '/calendar', search: '?date=2026-11-25', hash: '' });
assert.strictEqual(ctx.window.rekindleGoogleRedirectUri(), 'https://rekindle.ink/calendar');

ctx = load({
    origin: 'https://rekindle.ink',
    pathname: '/calendar',
    search: '',
    hash: '#access_token=tok&state=%3Fdate%3D2026-11-25%26new%3D1'
});
assert.strictEqual(ctx.replaced(), '/calendar?date=2026-11-25&new=1#access_token=tok&state=%3Fdate%3D2026-11-25%26new%3D1');

ctx = load({
    origin: 'https://rekindle.ink',
    pathname: '/calendar',
    search: '',
    hash: '#access_token=tok'
});
assert.strictEqual(ctx.replaced(), null, 'no state should not rewrite the URL');

for (const file of ['calendar.html', 'tasks.html', 'contacts.html', 'quicktodo.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes('js/google-oauth.js?v=1'), file + ' must load the OAuth helper');
    assert.ok(html.includes('window.rekindleGoogleRedirectUri'), file + ' must use the canonical redirect URI');
    assert.ok(html.includes("'state': window.location.search"), file + ' must preserve the query via OAuth state');
    assert.ok(html.includes('window.location.pathname + window.location.search'), file + ' must keep the query after token cleanup');
}

console.log('PASS - Google OAuth redirect state');
