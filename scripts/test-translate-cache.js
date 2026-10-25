const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const tmpWorker = path.join(os.tmpdir(), 'rekindle-translate-test-' + process.pid + '.mjs');
fs.writeFileSync(tmpWorker, fs.readFileSync(path.join(root, 'workers', 'rekindle-translate', 'worker.js')));
const workerUrl = pathToFileURL(tmpWorker).href;

function section(name) {
    console.log('  ' + name);
}

function installStubs() {
    const store = new Map();
    let fetchCount = 0;

    const originalFetch = global.fetch;
    const originalCaches = global.caches;

    global.caches = {
        default: {
            match: async function (request) {
                const value = store.get(request.url);
                return value === undefined ? undefined : new Response(value);
            },
            put: async function (request, response) {
                store.set(request.url, await response.text());
            }
        }
    };

    global.fetch = async function (url) {
        fetchCount++;
        const parsed = new URL(String(url));
        const target = parsed.searchParams.get('tl') || 'en';
        // Detect call: sl=auto&tl=en returns the detected language + English text.
        if (parsed.searchParams.get('sl') === 'auto') {
            return new Response(JSON.stringify({
                0: [['Hello']],
                2: 'en',
                6: 1
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // Target call: echo the language code so assertions can identify it.
        return new Response(JSON.stringify({
            0: [[target + ':translated']],
            2: parsed.searchParams.get('sl') || 'en'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    return {
        store: store,
        get fetchCount() { return fetchCount; },
        resetFetchCount: function () { fetchCount = 0; },
        restore: function () {
            global.fetch = originalFetch;
            if (originalCaches === undefined) delete global.caches;
            else global.caches = originalCaches;
        }
    };
}

async function main() {
    const worker = await import(workerUrl);
    const stubs = installStubs();

    try {
        section('full map is cached and skips all Google calls on repeat');
        {
            stubs.store.clear();
            stubs.resetFetchCount();
            const first = await worker.translateToAllLanguages('Hello');
            assert.strictEqual(first.sourceLang, 'en');
            assert.strictEqual(first.translations.en, 'Hello');
            assert.strictEqual(first.translations.es, 'es:translated');
            assert.deepStrictEqual(first.failed, []);
            const firstFetchCount = stubs.fetchCount;
            assert.ok(firstFetchCount >= 10, 'first translation should detect + translate 9 targets');

            stubs.resetFetchCount();
            const second = await worker.translateToAllLanguages('Hello');
            assert.deepStrictEqual(second.translations, first.translations);
            assert.strictEqual(stubs.fetchCount, 0, 'cache hit must not call Google');
        }

        section('retry requests reuse per-language cache entries');
        {
            stubs.store.clear();
            stubs.resetFetchCount();
            await worker.translateToAllLanguages('Hello');
            stubs.resetFetchCount();
            const retry = await worker.translateToAllLanguages('Hello', ['es', 'de'], 'en');
            assert.strictEqual(stubs.fetchCount, 0, 'retry of cached languages must not call Google');
            assert.strictEqual(retry.translations.es, 'es:translated');
            assert.strictEqual(retry.translations.de, 'de:translated');
        }

        section('a client-supplied source language cannot poison the auto cache');
        {
            stubs.store.clear();
            stubs.resetFetchCount();
            await worker.translateToAllLanguages('Bonjour', ['es'], 'fr');
            const callsAfterKnownSource = stubs.fetchCount;
            assert.ok(callsAfterKnownSource > 0);

            stubs.resetFetchCount();
            const auto = await worker.translateToAllLanguages('Bonjour');
            assert.ok(stubs.fetchCount > 0, 'auto path must not reuse the fr/es entry');
            assert.strictEqual(auto.translations.es, 'es:translated');
        }

        section('failed detection is not cached');
        {
            stubs.store.clear();
            stubs.resetFetchCount();
            const originalFetch = global.fetch;
            let detectCalls = 0;
            global.fetch = async function (url) {
                const parsed = new URL(String(url));
                if (parsed.searchParams.get('sl') === 'auto') {
                    detectCalls++;
                    return new Response('nope', { status: 500 });
                }
                return originalFetch(url);
            };
            // onlyLangs disables the whole-map cache, so a second call must
            // detect again. Per-language successes may still be cached.
            await worker.translateToAllLanguages('Hello', ['es']);
            stubs.resetFetchCount();
            await worker.translateToAllLanguages('Hello', ['es']);
            assert.strictEqual(detectCalls, 2, 'failed detection must be retried, not cached');
            global.fetch = originalFetch;
        }

        console.log('PASS - translate cache');
    } finally {
        stubs.restore();
        try { fs.unlinkSync(tmpWorker); } catch (e) { /* ignore */ }
    }
}

main().catch(function (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
