/*
 * KindleChat reply-prefix regression.
 *
 * Run: node scripts/test-chat-reply.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'reply-text.js'), 'utf8'), sandbox, { filename: 'js/reply-text.js' });
const build = sandbox.window.rekindleBuildReplyText;
assert.strictEqual(typeof build, 'function');

function check(result, text, prefix) {
    assert.strictEqual(result.text, text);
    assert.strictEqual(result.prefix, prefix);
}
check(build('hello', null), 'hello', '');
check(build('hello', { username: 'alice' }, function (n) { return n; }), '@alice hello', '@alice ');
check(build('@alice hello', { username: 'alice' }, function (n) { return n; }), '@alice hello', '');
check(build('hi', { username: 'alice' }, function () { return 'alice'; }), '@alice hi', '@alice ');
check(build('', { username: 'alice' }, function (n) { return n; }), '@alice ', '@alice ');

const chat = fs.readFileSync(path.join(ROOT, 'kindlechat.html'), 'utf8');
const fn = chat.slice(chat.indexOf('function sendMessage()'), chat.indexOf('function doSendMessage'));
assert.ok(fn.indexOf('rekindleBuildReplyText') !== -1, 'sendMessage must use the pure helper');
const validate = Math.min(
    fn.indexOf('containsUrl(outgoing)') === -1 ? 1e9 : fn.indexOf('containsUrl(outgoing)'),
    fn.indexOf('containsPromotedTerm(outgoing)') === -1 ? 1e9 : fn.indexOf('containsPromotedTerm(outgoing)'),
    fn.indexOf('outgoing.length > 1000') === -1 ? 1e9 : fn.indexOf('outgoing.length > 1000')
);
const insert = fn.indexOf('inputEl.insertBefore');
assert.ok(validate < insert, 'validation must run before the composer is mutated');
assert.ok(fn.indexOf('if (!text) return;') < fn.indexOf('rekindleBuildReplyText'), 'empty text must return before building a reply');
assert.ok(chat.indexOf('js/reply-text.js?v=1') !== -1, 'kindlechat must load the versioned helper');

console.log('PASS - chat reply prefix');
