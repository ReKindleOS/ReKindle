/*
 * Guard the persistent home-menu avatar cache, and the login-window identity
 * reset that clears it (shared-Kindle privacy).
 * Run: node scripts/test-home-avatar-cache.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const home = fs.readFileSync(path.join(root, 'js', 'home.js'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'theme.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(home.includes("'rekindle_home_avatar:'"), 'home avatar cache key');
assert.ok(/if \(paintCachedHomeAvatar\(uid\)\) return;/.test(home), 'cached avatar must skip the RTDB read');
assert.ok(/clearHomeAvatar\(signedOutUid\)/.test(home), 'logout must clear the avatar cache');
assert.ok(/clearHomeAvatar\(previousUid\)/.test(home), 'account switch must clear the old avatar cache');
assert.ok(theme.includes('window.rekindleInvalidateHomeAvatar'), 'profile saves must invalidate the home avatar cache');

// --- Login / Register must not show the previous account's cached identity ---
// (2026-11-26: a shared Kindle kept the last name/avatar in the menu bar and
// the "signed out unexpectedly" prefill in the form.)
assert.ok(/function openLogin\(\) \{[\s\S]{0,800}?resetLoginWindow\(\);/.test(home),
    'openLogin must reset the window before it is shown');
assert.ok(/function resetLoginWindow\(\) \{[\s\S]{0,800}?if \(!currentUser\) \{/.test(home),
    'the reset must be skipped for a live signed-in account');
assert.ok(/removeStoredKeysWithPrefix\('rekindle_home_avatar:'\)/.test(home),
    'opening login must sweep every cached home avatar');
assert.ok(/removeStoredKeysWithPrefix\('rekindle_display_name:'\)/.test(home),
    'opening login must sweep every cached display name');
assert.ok(/localStorage\.removeItem\('rekindle_last_username'\)/.test(home),
    'opening login must drop the last handle used to prefill the form');
assert.ok(/window\.rekindleInvalidateUserCard\(uid\)/.test(home),
    'opening login must drop the user-card cache for the recorded uid');
assert.ok(/sessionStorage\.removeItem\('rekindle_display_name_refreshed:' \+ uid\)/.test(home),
    'opening login must drop the once-per-session name refresh flag');
assert.ok(/if \(badgeIcon\) drawGuestAvatar\(badgeIcon\);/.test(home),
    'opening login must repaint the menu-bar avatar as the guest portrait');
assert.ok(/usernameField\) usernameField\.value = ''/.test(home), 'opening login must blank the username');
assert.ok(/passwordField\) passwordField\.value = ''/.test(home), 'opening login must blank the password');
assert.ok(!/removeStoredKeysWithPrefix\('rekindle_ucard:'\)/.test(home),
    'the shared chat card cache must not be swept with the home identity');

// The Lite/Legacy dashboard has no cached identity (it paints from Auth only),
// but its login window must not keep the previous person's typed values either.
const legacy = fs.readFileSync(path.join(root, 'index_old.html'), 'utf8');
assert.ok(/function openLogin\(\) \{[\s\S]{0,1000}?if \(p\) p\.value = '';/.test(legacy),
    'the legacy dashboard login window must blank the fields too');

// A changed shared script must ship under a new URL: index.html and the
// service-worker precache must pin the same js/home.js version.
const indexVer = (index.match(/js\/home\.js\?v=(\d+)/) || [])[1];
const swVer = (sw.match(/'\.\/js\/home\.js\?v=(\d+)'/) || [])[1];
assert.ok(indexVer, 'index.html must version js/home.js');
assert.strictEqual(indexVer, swVer, 'sw.js must precache the same js/home.js version as index.html');

console.log('PASS - home avatar cache');
