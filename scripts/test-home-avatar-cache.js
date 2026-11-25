/*
 * Guard the persistent home-menu avatar cache.
 * Run: node scripts/test-home-avatar-cache.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const home = fs.readFileSync(path.join(root, 'js', 'home.js'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'theme.js'), 'utf8');

assert.ok(home.includes("'rekindle_home_avatar:'"), 'home avatar cache key');
assert.ok(/if \(paintCachedHomeAvatar\(uid\)\) return;/.test(home), 'cached avatar must skip the RTDB read');
assert.ok(/clearHomeAvatar\(signedOutUid\)/.test(home), 'logout must clear the avatar cache');
assert.ok(/clearHomeAvatar\(previousUid\)/.test(home), 'account switch must clear the old avatar cache');
assert.ok(theme.includes('window.rekindleInvalidateHomeAvatar'), 'profile saves must invalidate the home avatar cache');

console.log('PASS - home avatar cache');
