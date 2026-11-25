/*
 * Private live-game code checks.
 *
 * Run: node scripts/test-live-codes.js
 *
 * This is the kid-safe social layer: an 8-character code, a private lobby and
 * no chat/search/notifications. The test pins the rule shape (host-only create,
 * auth-only child read, no list read), the code format, the dashboard filter and
 * the eight live-game hooks.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'rtdb-rules.json'), 'utf8'));
const home = fs.readFileSync(path.join(ROOT, 'js', 'home.js'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// --- helper behaviour ------------------------------------------------------
const sandbox = {
    window: { crypto: { getRandomValues: function (arr) { for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 11) & 255; } } },
    document: { getElementById: function () { return null; }, addEventListener: function () { } },
    navigator: {},
    Uint8Array: Uint8Array,
    Math: Math,
    Date: Date,
    Promise: Promise,
    setInterval: setInterval,
    clearInterval: clearInterval
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'live-codes.js'), 'utf8'), sandbox, { filename: 'js/live-codes.js' });
const codes = sandbox.window.RekindleLiveCodes;
assert.ok(codes, 'RekindleLiveCodes must be exported');

assert.strictEqual(codes.normalise(' abcd-efgh '), 'ABCDEFGH');
assert.strictEqual(codes.group('ABCDEFGH'), 'ABCD-EFGH');
assert.strictEqual(codes.isValidCode('ABCD-EFGH'), true);
assert.strictEqual(codes.isValidCode('ABCD-EFG'), false);
assert.strictEqual(codes.isValidCode('ABCD-EFGI'), false, 'I is not in the unambiguous alphabet');
assert.strictEqual(codes.isValidCode('ABCD-EFG0'), false, '0 is not in the unambiguous alphabet');
for (let i = 0; i < 50; i++) {
    const code = codes.makeCode();
    assert.strictEqual(code.length, 8);
    assert.strictEqual(codes.isValidCode(code), true, 'generated code must be valid: ' + code);
}

// --- rules -----------------------------------------------------------------
const rule = rules.rules.game_codes;
assert.ok(rule, 'game_codes rules must exist');
assert.strictEqual(rule['.read'], false, 'the code collection must not be listable');
assert.ok(rule.$code, 'per-code rule must exist');
assert.ok(/auth != null/.test(rule.$code['.read']), 'a known code may be read by a signed-in user');
assert.ok(/!data\.exists\(\)/.test(rule.$code['.write']), 'create is guarded');
assert.ok(/hostUid/.test(rule.$code['.write']), 'only the host may create a code');
assert.ok(/!newData\.exists\(\)/.test(rule.$code['.write']), 'only the host may delete a code');
assert.ok(/hasChildren/.test(rule.$code['.validate']), 'code fields are validated');
assert.ok(/games/.test(rule.$code['.validate']), 'code must point at a game the caller hosts');
assert.ok(/matches\(\/\^\(uno\|chess\|checkers\|connect4\|dotsandboxes\|tictactoe\|yahtzee\|pictionary\)\$\/\)/.test(rule.$code['.validate']),
    'only known games may publish codes');

// --- dashboard -------------------------------------------------------------
assert.ok(index.indexOf('js/live-codes.js?v=1') !== -1, 'index must load the code helper');
assert.ok(index.indexOf('id="live-code-input"') !== -1, 'index must render the join input');
assert.ok(index.indexOf('onclick="joinWithCode()"') !== -1, 'index must wire the join button');
assert.ok(home.indexOf('function joinWithCode()') !== -1, 'home.js must define joinWithCode');
assert.ok(home.indexOf('!match.private') !== -1, 'home.js must hide private lobbies');
assert.ok((home.match(/!match\.private/g) || []).length >= 2, 'both the list and badge must filter private lobbies');

// --- eight live games ------------------------------------------------------
const games = {
    liveuno: 'uno',
    livechess: 'chess',
    livecheckers: 'checkers',
    liveconnect4: 'connect4',
    livedotsandboxes: 'dotsandboxes',
    livetictactoe: 'tictactoe',
    liveyahtzee: 'yahtzee',
    livepictionary: 'pictionary'
};
for (const [page, game] of Object.entries(games)) {
    const html = fs.readFileSync(path.join(ROOT, page + '.html'), 'utf8');
    assert.ok(html.indexOf('js/live-codes.js?v=1') !== -1, page + ' must load js/live-codes.js');
    assert.ok(html.indexOf('RekindleLiveCodes.attach') !== -1, page + ' must attach the invite control');
    assert.ok(html.indexOf("game: '" + game + "'") !== -1, page + ' must publish the right game key');
    assert.ok(html.indexOf('hostUid: currentUser.uid') !== -1, page + ' must publish the host uid');
}

// No new Cloud Function or scheduled job for codes.
const functions = fs.readFileSync(path.join(ROOT, 'firebase-functions', 'index.js'), 'utf8');
assert.ok(functions.indexOf('game_codes') === -1, 'live codes must not need a Cloud Function');

console.log('PASS - private live codes (' + Object.keys(games).length + ' games, host-only codes, private dashboard filter)');
