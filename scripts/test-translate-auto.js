/*
 * Auto-translation queue behaviour test.
 *
 * Run: node scripts/test-translate-auto.js
 *
 * The feed auto-translator must be serial (one MyMemory request at a time),
 * skip the reader's own language, reuse the session cache, and stop after a
 * budget error. Those are the properties that keep a KindleChat render from
 * firing 30 requests at once.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/translate-client.js'), 'utf8');

function makeStorage() {
    const map = new Map();
    return {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key),
        clear: () => map.clear()
    };
}

function loadClient(fetchImpl, storage) {
    const window = {};
    const load = new Function('window', 'fetch', 'AbortController', 'sessionStorage', 'setTimeout', 'clearTimeout', source);
    load(window, fetchImpl, typeof AbortController === 'undefined' ? undefined : AbortController, storage, setTimeout, clearTimeout);
    return window.rekindleTranslateClient;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    let fetchCalls = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const storage = makeStorage();
    const client = loadClient(function (url) {
        fetchCalls.push(String(url));
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return wait(10).then(() => {
            inFlight--;
            return {
                ok: true,
                json: () => Promise.resolve({
                    responseData: { translatedText: 'translated:' + fetchCalls.length }
                })
            };
        });
    }, storage);

    // source === target is a no-op and must not hit the network.
    const skipped = client.autoTranslate({ id: 'same', text: 'hello', source: 'en', target: 'en', apply: () => { throw new Error('must not apply'); } });
    assert.strictEqual(skipped, false, 'same-language jobs are not queued');
    assert.strictEqual(fetchCalls.length, 0, 'same-language jobs must not fetch');

    const applied = [];
    client.autoTranslate({ id: 'one', text: 'hola amigo', source: 'es', target: 'en', apply: t => applied.push(t) });
    client.autoTranslate({ id: 'two', text: 'bonjour ami', source: 'fr', target: 'en', apply: t => applied.push(t) });
    client.autoTranslate({ id: 'one', text: 'hola amigo', source: 'es', target: 'en', apply: t => applied.push(t) });

    // one 120 ms start delay + two 10 ms requests + 350 ms gaps
    await wait(1100);
    assert.deepStrictEqual(applied.length, 2, 'two unique jobs apply once each (duplicate id is ignored)');
    assert.strictEqual(maxInFlight, 1, 'auto-translation must run one request at a time');
    assert.ok(fetchCalls[0].indexOf('langpair=es%7Cen') !== -1, 'the stored source language must be sent: ' + fetchCalls[0]);

    // Same text again (new id) is served from sessionStorage: no extra request.
    const before = fetchCalls.length;
    const cachedApplied = [];
    client.autoTranslate({ id: 'three', text: 'hola amigo', source: 'es', target: 'en', apply: t => cachedApplied.push(t) });
    await wait(500);
    assert.strictEqual(fetchCalls.length, before, 'a repeated string must be served from cache');
    assert.strictEqual(cachedApplied.length, 1, 'cached result is applied');

    // source:'auto' is the legacy/no-stored-lang path. Same-language and
    // unknown/ASCII-art text must not hit the network (they only retire the
    // pointless Translate link); a foreign string is detected and translated.
    const beforeAuto = fetchCalls.length;
    const originalApplied = [];
    client.autoTranslate({ id: 'auto-same', text: 'hello my friend', source: 'auto', target: 'en', apply: t => originalApplied.push(t) });
    await wait(450);
    assert.strictEqual(fetchCalls.length, beforeAuto, 'auto-detected same language must not fetch');
    assert.deepStrictEqual(originalApplied, ['hello my friend'], 'same-language auto returns the original for the link cleanup');

    const artApplied = [];
    client.autoTranslate({ id: 'auto-art', text: '¯\\_(ツ)_/¯', source: 'auto', target: 'en', apply: t => artApplied.push(t) });
    await wait(450);
    assert.strictEqual(fetchCalls.length, beforeAuto, 'unknown/ASCII art must not be translated');
    assert.deepStrictEqual(artApplied, ['¯\\_(ツ)_/¯'], 'unknown text returns the original for the link cleanup');

    const foreignApplied = [];
    client.autoTranslate({ id: 'auto-foreign', text: 'hola amigo mio', source: 'auto', target: 'en', apply: t => foreignApplied.push(t) });
    await wait(700);
    assert.ok(fetchCalls[fetchCalls.length - 1].indexOf('langpair=es%7Cen') !== -1,
        'auto source must use the detected language pair: ' + fetchCalls[fetchCalls.length - 1]);
    assert.strictEqual(foreignApplied.length, 1, 'foreign auto result is applied');

    // Budget: a session at the cap makes the next explicit translate fail with
    // code 'budget'; the queue must then stop accepting jobs.
    storage.setItem('rk-tr-calls', String(client._sessionBudget));
    client._resetAutoTranslate();
    let failed = null;
    client.autoTranslate({
        id: 'budget',
        text: 'texto nuevo que no esta en cache',
        source: 'es',
        target: 'en',
        apply: () => { throw new Error('budget job must not apply'); },
        onFail: err => { failed = err; }
    });
    await wait(600);
    assert.ok(failed && failed.code === 'budget', 'budget error must reach onFail');
    const rejected = client.autoTranslate({
        id: 'after-budget',
        text: 'otro texto',
        source: 'es',
        target: 'en',
        apply: () => { throw new Error('post-budget job must not apply'); }
    });
    assert.strictEqual(rejected, false, 'the queue must stop after a budget error');

    console.log('PASS - auto-translation queue (serial, language-gated, cached, budget-stopped)');
}

run().catch(err => {
    console.error('FAIL -', err && err.stack ? err.stack : err);
    process.exit(1);
});
