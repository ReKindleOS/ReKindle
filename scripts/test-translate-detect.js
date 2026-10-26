/*
 * Language detection + provider guards for js/translate-client.js.
 *
 * Run: node scripts/test-translate-detect.js
 *
 * Why: detection used to be a POST to a LibreTranslate instance. That host sends
 * `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true`,
 * which WebKit (Kindle + Safari) rejects — real beta failures were:
 *
 *   Origin https://beta.rekindle.ink is not allowed by Access-Control-Allow-Origin. Status code: 200
 *   Fetch API cannot load https://translate.disroot.org/detect due to access control checks.
 *
 * Detection is now local and must stay offline: this test fails if `detect()`
 * touches the network at all, and pins the languages the app actually offers.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/translate-client.js'), 'utf8');

// Load the client against a stub window. `fetch` throws so any network use fails
// the test rather than silently hitting a third party from CI.
let fetchCalls = 0;
function fakeFetch() {
    fetchCalls++;
    return Promise.reject(new Error('network disabled in tests'));
}

const window = {};
const load = new Function('window', 'fetch', 'AbortController', 'sessionStorage', 'setTimeout', 'clearTimeout', source);
load(window, fakeFetch, typeof AbortController === 'undefined' ? undefined : AbortController, undefined, setTimeout, clearTimeout);

const client = window.rekindleTranslateClient;
assert.ok(client, 'the client must register window.rekindleTranslateClient');
assert.strictEqual(typeof client._detectSync, 'function', 'detectSync must be exposed for tests');
assert.strictEqual(typeof client.detect, 'function', 'detect must stay a callable API');
assert.strictEqual(typeof client.translate, 'function', 'translate must stay a callable API');

// The provider that broke must not come back.
assert.ok(!/translate\.disroot\.org/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the disroot/LibreTranslate provider must not return (WebKit rejects its CORS headers)');
assert.ok(!/libreTranslate\s*\(/.test(source), 'no LibreTranslate code path may remain');

const cases = [
    // English
    ['Hello my name is', 'en'],
    ['help me please', 'en'],
    ['LOL', 'en'],
    ['@rainy CUTE IS 8 ?', 'en'],
    // Spanish
    ['Me gusta moverlo moverlo', 'es'],
    ['Quiero ir a casa', 'es'],
    ['¿Dónde está el baño?', 'es'],
    // French
    ['Bonjour, comment ça va ?', 'fr'],
    ['Je ne sais pas', 'fr'],
    // German
    ['Das ist sehr gut und danke', 'de'],
    ['Ich weiß nicht', 'de'],
    ['Straße', 'de'],
    // Italian
    ['Ciao, come stai? grazie mille', 'it'],
    ['Non lo so', 'it'],
    // Portuguese
    ['Olá, obrigado por isso não', 'pt'],
    ['Eu não sei', 'pt'],
    ['não sei', 'pt'],
    // Scripts
    ['Привет, как дела?', 'ru'],
    ['こんにちは元気ですか', 'ja'],
    ['你好吗我今天很好', 'zh'],
    ['안녕하세요 반갑습니다', 'ko']
];

const failures = [];
for (const [text, expected] of cases) {
    const got = client._detectSync(text);
    if (got !== expected) failures.push(JSON.stringify(text) + ' -> ' + got + ' (expected ' + expected + ')');
}
assert.deepStrictEqual(failures, [], 'detection mismatches:\n  ' + failures.join('\n  '));

// Empty/whitespace input must not throw and must honour the caller's fallback.
assert.strictEqual(client._detectSync(''), 'en', 'empty text falls back to en');
assert.strictEqual(client._detectSync('   ', 'es'), 'es', 'empty text honours the fallback');
assert.strictEqual(client._detectSync('1234 !!!'), 'en', 'no letters falls back to en');

// detect() is async and still works after the rewrite.
Promise.resolve()
    .then(() => client.detect('Bonjour tout le monde'))
    .then(lang => {
        assert.strictEqual(lang, 'fr', 'async detect must resolve the same answer');
        // Same-language translation short-circuits before any request.
        return client.translate('Hello', 'en', 'en');
    })
    .then(out => {
        assert.strictEqual(out, 'Hello', 'source === target returns the text unchanged');
        assert.strictEqual(fetchCalls, 0, 'detection and same-language translation must not touch the network');
        console.log('PASS - translate detection (' + cases.length + ' languages pinned, no network used)');
    })
    .catch(err => {
        console.error('FAIL -', err.message);
        process.exit(1);
    });
