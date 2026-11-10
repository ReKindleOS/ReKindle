/**
 * Link-ban regression + parity tests.
 *
 * Run:  node scripts/test-link-guard.js
 *
 * The case that matters is the 2026-10-26 evasion where a competing site is
 * advertised with the dots replaced by commas/spaces:
 *
 *     "nexora-chat-v12,netlify,app/ NEW WEBSITE v12"
 *
 * Every case below must be answered identically by js/link-guard.js (client)
 * and containsUrl() in workers/rekindle-moderate/worker.js (server). The
 * "allowed" list guards the opposite failure: ordinary chat that happens to
 * put a TLD-shaped word after a comma ("hello, me and my friend") must not be
 * rejected.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'link-guard.js'), 'utf8'),
    sandbox,
    { filename: 'js/link-guard.js' }
);

const client = sandbox.window.rekindleContainsLink;
assert.strictEqual(typeof client, 'function', 'js/link-guard.js must expose window.rekindleContainsLink');

/* Links, in every evasion form seen or expected. */
const BLOCKED = [
    /* The real 2026-10-26 message. */
    'nexora-chat-v12,netlify,app/ NEW WEBSITE v12',
    'Nexora-Chat-V12 , Netlify , App/ NEW WEBSITE v12',
    'nexora-chat-v12 , netlify , app',
    'nexora-chat-v12 netlify app',
    'nexora-chat-v12_netlify_app',
    'nexora-chat-v12|netlify|app',
    'nexora-chat-v12 - netlify - app',
    'nexora-chat-v12[.]netlify[.]app',
    'nexora-chat-v12(dot)netlify(dot)app',
    'nexora-chat-v12 dot netlify dot app',
    'NEXORA-CHAT-V12DOTNETLIFY dot app',
    /* Unicode / invisible separators. */
    'nexora\u3002netlify\u3002app',
    'nexora-chat-v12\u200b.netlify\u200b.app',
    /* Bare hosting descriptions. */
    'netlify,app',
    'netlify app',
    'www netlify app',
    'discord,gg/invite',
    'bit.ly/xyz',
    'join netlify.app',
    'visit example com',
    'example,com',
    'my site is example,com',
    /* Protocols and IPs. */
    'http://x',
    'hxxp://x',
    'h t t p s : / / x',
    '127.0.0.1',
    '192.168.1.1',
    'example . com',
    /* Domains whose TLD is also an ordinary word still count when the label
       is domain-shaped (long, hyphenated or containing a digit). */
    'example.me',
    'example . me',
    'my-site.it',
    'alice123.me',
    'user@example.me'
];

/* Ordinary chat that must not be rejected. */
const ALLOWED = [
    'hello, me and my friend',
    'yes, to me',
    'ok, it is',
    'love, me',
    'no, us',
    'dinner, at 7',
    'I love this online',
    'this is a great app',
    'the dot com boom',
    'red dot app',
    'I use dotnet',
    'send me, link',
    'check this, site',
    'see you, online',
    'good morning, world',
    'watch, tv',
    'v1.2.3 is out',
    'meeting at 12:30',
    'see you at 10, room 5',
    'good game, wp',
    'NEW WEBSITE v12',
    'hello, world',
    'happy birthday, tim',
    /* Sentence punctuation followed by an ordinary word that is also a TLD
       (reported 2026-11-01, 2026-11-03 and 2026-11-09). */
    'I like it. In fact, it is great',
    'thanks. no problem',
    'that is cool. at least I hope so',
    'ok. be there soon',
    'hi. us too',
    'wait. as if',
    'I cannot. my bad',
    'so. to be fair',
    'hello. me and my friend',
    /* Mentions with digits in the name are not domains. */
    '@alice123. me too',
    '@user42. no way',
    'tag @user42. thanks!',
    '@alice123 no way',
    '@alice123 me too',
    '@alice123 app is down',
    'hi @alice123 net is slow',
    'thanks @user42, it works',
    /* Invalid IPs / non-domain dotted numbers. */
    '999.1.1.1',
    '2026. 11. 09',
    /* Ordinary numbers in a sentence are not host signals. */
    'I have 2 app ideas',
    'my 2nd app is broken',
    'room 5 net is down',
    '2026 app update',
    'top 10 apps',
    /* A sentence period ends the hostname run, whatever word follows. */
    'I opened the app. app crashed',
    '@alice123. app is down',
    'hello... me too'
];

(async () => {
    const { containsUrl } = await import('../workers/rekindle-moderate/worker.js');
    assert.strictEqual(typeof containsUrl, 'function', 'worker must export containsUrl');

    for (const text of BLOCKED) {
        assert.strictEqual(client(text), true, 'client must block: ' + JSON.stringify(text));
        assert.strictEqual(containsUrl(text), true, 'worker must block: ' + JSON.stringify(text));
    }

    for (const text of ALLOWED) {
        assert.strictEqual(client(text), false, 'client must allow: ' + JSON.stringify(text));
        assert.strictEqual(containsUrl(text), false, 'worker must allow: ' + JSON.stringify(text));
    }

    /* Empty / missing input is never a link. */
    [null, undefined, '', '   '].forEach(function (value) {
        assert.strictEqual(client(value), false);
        assert.strictEqual(containsUrl(value), false);
    });

    console.log('link guard checks passed (' + BLOCKED.length + ' blocked, ' +
        ALLOWED.length + ' allowed, client/server in sync)');
})().catch(function (err) {
    console.error('link guard checks failed:', err && err.stack ? err.stack : err);
    process.exit(1);
});
